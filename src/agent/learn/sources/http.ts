/**
 * POLITE FETCH for the source adapters (research/07 §1 "PoliteHttp"):
 * every request carries the identifying User-Agent, times out, waits for
 * its host's minimum interval, and never retries (a 429 is reported, not
 * hammered). Also the small text helpers the adapters share, so each
 * adapter stays a thin mapping from one API's JSON to Candidate[].
 */
import type { Candidate, SourceId } from "../../../core/learn/contracts.ts";
import { sourceInfo } from "../../../core/learn/sources.ts";
import type { SourceContext } from "./types.ts";

export const DEFAULT_TIMEOUT_MS = 15_000;
export const DAY_MS = 24 * 60 * 60 * 1000;

/** A non-2xx answer. Kept apart from network errors so the reason the
 *  learner sees can say which one happened. */
export class HttpError extends Error {
	constructor(
		readonly status: number,
		readonly url: string,
	) {
		super(`HTTP ${status} from ${url}`);
		this.name = "HttpError";
	}
}

/** The reply was not the shape the adapter expected. */
export class ParseError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ParseError";
	}
}

export interface GetOptions {
	headers?: Record<string, string>;
	timeoutMs?: number;
	/** Least time between two requests to this URL's host. */
	minIntervalMs?: number;
}

/** Next free slot per host, per fetch implementation: keying on the fetch
 *  keeps every test's fake fetch independent while production (one real
 *  fetch) shares one schedule across all stages. Pacing is wall-clock
 *  politeness, so it uses the real clock, not ctx.now. */
const nextSlot = new WeakMap<typeof fetch, Map<string, number>>();

async function waitForHost(ctx: SourceContext, host: string, minIntervalMs: number): Promise<void> {
	let hosts = nextSlot.get(ctx.fetch);
	if (!hosts) {
		hosts = new Map();
		nextSlot.set(ctx.fetch, hosts);
	}
	const now = Date.now();
	const slot = Math.max(now, hosts.get(host) ?? 0);
	// Reserve before waiting so concurrent callers queue behind each other.
	hosts.set(host, slot + minIntervalMs);
	const wait = slot - now;
	if (wait > 0) await sleep(wait, ctx.signal);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	const { promise, resolve, reject } = Promise.withResolvers<void>();
	if (signal?.aborted) {
		reject(signal.reason);
		return promise;
	}
	const onAbort = () => {
		clearTimeout(timer);
		reject(signal?.reason);
	};
	const timer = setTimeout(() => {
		signal?.removeEventListener("abort", onAbort);
		resolve();
	}, ms);
	signal?.addEventListener("abort", onAbort, { once: true });
	return promise;
}

/** GET with User-Agent, timeout and host pacing. Returns any status;
 *  throws only when no response arrived. The timeout signal stays on the
 *  response, so reading the body is bounded too. */
export async function getResponse(ctx: SourceContext, url: string, options: GetOptions = {}): Promise<Response> {
	const parsed = new URL(url);
	if (options.minIntervalMs) await waitForHost(ctx, parsed.host, options.minIntervalMs);
	const timeout = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
	const signal = ctx.signal ? AbortSignal.any([ctx.signal, timeout]) : timeout;
	return ctx.fetch(url, {
		method: "GET",
		headers: { "User-Agent": ctx.userAgent, ...options.headers },
		redirect: "follow",
		signal,
	});
}

/** GET a 2xx text body (throws HttpError otherwise). `url` is the final
 *  URL after redirects (the request URL when the fetch does not say). */
export async function getText(
	ctx: SourceContext,
	url: string,
	options: GetOptions = {},
): Promise<{ text: string; url: string; status: number }> {
	const response = await getResponse(ctx, url, options);
	if (!response.ok) {
		await response.body?.cancel().catch(() => undefined);
		throw new HttpError(response.status, url);
	}
	return { text: await response.text(), url: response.url || url, status: response.status };
}

/** GET a 2xx JSON body (throws HttpError or ParseError otherwise). */
export async function getJson(ctx: SourceContext, url: string, options: GetOptions = {}): Promise<unknown> {
	const { text } = await getText(ctx, url, {
		...options,
		headers: { Accept: "application/json", ...options.headers },
	});
	try {
		return JSON.parse(text) as unknown;
	} catch {
		throw new ParseError(`not JSON from ${url}`);
	}
}

/** Read at most `maxBytes` of a body (a model-named URL may point at a
 *  huge file); the rest is cancelled. */
export async function readTextCapped(response: Response, maxBytes: number): Promise<string> {
	if (!response.body) return "";
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	while (size < maxBytes) {
		const { done, value } = await reader.read();
		if (done) break;
		chunks.push(value);
		size += value.byteLength;
	}
	if (size >= maxBytes) await reader.cancel().catch(() => undefined);
	const bytes = new Uint8Array(Math.min(size, maxBytes));
	let offset = 0;
	for (const chunk of chunks) {
		const part = chunk.subarray(0, bytes.length - offset);
		bytes.set(part, offset);
		offset += part.length;
		if (offset >= bytes.length) break;
	}
	return new TextDecoder().decode(bytes);
}

/** Cache-by-key with a max age: return the cached value when fresh,
 *  else produce, store (successes only) and return it. */
export async function cached<T>(
	ctx: SourceContext,
	key: string,
	maxAgeMs: number,
	produce: () => Promise<T>,
): Promise<T> {
	const hit = ctx.cache.get<T>(key, maxAgeMs);
	if (hit !== undefined) return hit;
	const value = await produce();
	ctx.cache.set(key, value);
	return value;
}

/** One plain sentence for the learner: which source, what went wrong. */
export function failureReason(source: SourceId, error: unknown): string {
	const label = sourceInfo(source).label;
	if (error instanceof HttpError) {
		if (error.status === 429) return `${label} is limiting requests right now; try again later.`;
		if (error.status === 401 || error.status === 403) return `${label} refused the request (HTTP ${error.status}); check the key.`;
		return `${label} answered with an error (HTTP ${error.status}).`;
	}
	if (error instanceof ParseError) return `${label} sent a reply that could not be read.`;
	if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
		return `${label} took too long to answer.`;
	}
	return `${label} could not be reached.`;
}

/** Run a search so it never throws: any failure becomes [] plus a reason. */
export async function safely(
	source: SourceId,
	onError: ((reason: string) => void) | undefined,
	run: () => Promise<Candidate[]>,
): Promise<Candidate[]> {
	try {
		return await run();
	} catch (error) {
		onError?.(failureReason(source, error));
		return [];
	}
}

/** Run a resolve so it never throws: failure = not confirmed. */
export async function safelyResolve(run: () => Promise<Candidate | null>): Promise<Candidate | null> {
	try {
		return await run();
	} catch {
		return null;
	}
}

/** A Candidate without undefined fields (and without empty signals), so
 *  stored and compared records only carry what the API returned. */
export function candidate(fields: Candidate): Candidate {
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(fields)) {
		if (value === undefined) continue;
		if (key === "signals") {
			const signals = Object.fromEntries(Object.entries(value as object).filter(([, v]) => v !== undefined));
			if (Object.keys(signals).length > 0) out.signals = signals;
			continue;
		}
		out[key] = value;
	}
	return out as unknown as Candidate;
}

/** "Ada, Bo et al.": the by-line for papers with many authors. */
export function authorsLine(names: readonly string[]): string | undefined {
	if (names.length === 0) return undefined;
	return names.length > 2 ? `${names.slice(0, 2).join(", ")} et al.` : names.join(", ");
}

/** ISO-8601 duration ("PT1H2M3S", "P1DT2H") in seconds; undefined when
 *  it does not parse. */
export function isoDurationSeconds(value: unknown): number | undefined {
	if (typeof value !== "string") return undefined;
	const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(value.trim());
	if (!match || value.trim() === "P" || value.trim() === "PT") return undefined;
	const [, d, h, m, s] = match;
	return Number(d ?? 0) * 86_400 + Number(h ?? 0) * 3600 + Number(m ?? 0) * 60 + Number(s ?? 0);
}

/** Whole minutes for a duration, never 0 for a non-empty one. */
export function minutesOf(seconds: number | undefined): number | undefined {
	return seconds && seconds > 0 ? Math.max(1, Math.round(seconds / 60)) : undefined;
}

// ── Shared text helpers ─────────────────────────────────────────────

/** Narrow unknown JSON without trusting it. */
export function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

export function asArray(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

export function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function asNumber(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
	return undefined;
}

/** Only absolute http(s) URLs ever become a Candidate link. */
export function httpUrl(value: unknown): string | undefined {
	const text = asString(value);
	if (!text) return undefined;
	try {
		const url = new URL(text);
		return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined;
	} catch {
		return undefined;
	}
}

/** The named entities page titles and API snippets actually use. */
const ENTITIES: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: " ",
	mdash: "—",
	ndash: "–",
	hellip: "…",
	middot: "·",
	lsquo: "‘",
	rsquo: "’",
	ldquo: "“",
	rdquo: "”",
	copy: "©",
	reg: "®",
	trade: "™",
};

export function decodeEntities(text: string): string {
	return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
		if (name[0] === "#") {
			const code = name[1] === "x" || name[1] === "X" ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));
			return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
		}
		return ENTITIES[name.toLowerCase()] ?? whole;
	});
}

/** Plain text from an HTML snippet: tags dropped, entities decoded,
 *  whitespace collapsed. */
export function plainText(html: string): string {
	// Block tags separate words; inline tags (<b>, <em>) must not split them.
	const spaced = html.replace(/<\/?(?:p|br|div|li|ul|ol|h[1-6]|tr|td|th|section|article)\b[^>]*>/gi, " ");
	return decodeEntities(spaced.replace(/<[^>]*>/g, ""))
		.replace(/\s+/g, " ")
		.trim();
}

/** Descriptions are at most ~300 characters (contracts.ts). */
export function clip(text: string | undefined, max = 300): string | undefined {
	if (!text) return undefined;
	const plain = text.replace(/\s+/g, " ").trim();
	if (!plain) return undefined;
	if (plain.length <= max) return plain;
	const cut = plain.slice(0, max - 1);
	const space = cut.lastIndexOf(" ");
	return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** Lowercase word tokens (letters and digits of any script). */
export function words(text: string): string[] {
	return text
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.split(/[^\p{L}\p{N}+#]+/u)
		.filter(Boolean);
}

/** Lowercase, punctuation-free form used in cache keys. */
export function normalizeKey(text: string): string {
	return words(text).join(" ");
}

const LEADING_ARTICLES: Record<string, true> = { the: true, a: true, an: true };

function titleWords(text: string): string[] {
	const list = words(text);
	while (list.length > 1 && LEADING_ARTICLES[list[0] ?? ""]) list.shift();
	return list;
}

/** "Exact-ish" title match for resolving a model-named resource: equal
 *  after normalising, or one is the other plus a subtitle/edition while
 *  still covering most of it ("Introduction to Linear Algebra" matches
 *  "Introduction to Linear Algebra, Fifth Edition" but "Linear Algebra"
 *  does not match "Linear Algebra and Its Applications"). */
export function titlesMatch(wanted: string, found: string): boolean {
	const a = titleWords(wanted);
	const b = titleWords(found);
	if (a.length === 0 || b.length === 0) return false;
	const [short, long] = a.length <= b.length ? [a, b] : [b, a];
	for (let i = 0; i < short.length; i++) if (short[i] !== long[i]) return false;
	return short.length === long.length || (short.length >= 2 && short.length / long.length >= 0.6);
}

/** Whether a model-named author plausibly is one of the API's authors:
 *  any shared name word of 3+ letters (surnames, mostly). */
export function authorMatches(wanted: string | undefined, found: readonly string[]): boolean {
	if (!wanted) return true;
	const want = new Set(words(wanted).filter((w) => w.length >= 3));
	if (want.size === 0) return true;
	return found.some((name) => words(name).some((w) => want.has(w)));
}

/** A valid UI language code for the APIs that take one. */
export function languageCode(language: string): string {
	const code = language.trim().toLowerCase();
	return /^[a-z]{2,3}$/.test(code) ? code : "en";
}
