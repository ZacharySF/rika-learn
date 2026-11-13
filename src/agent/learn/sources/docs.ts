/**
 * OFFICIAL DOCS (research/07 §2.1, docs/learn.md "Sources"): the only
 * adapter that fetches a URL the model wrote, and only to confirm it. The
 * URL must be public http(s), robots.txt must allow it (before the fetch
 * and again for the final URL after redirects) and the page must answer
 * 2xx. The kept link is the final URL; the title is the page's <title>.
 */
import type { Candidate, CanonItem } from "../../../core/learn/contracts.ts";
import { DAY_MS, candidate, getResponse, plainText, readTextCapped, safelyResolve } from "./http.ts";
import { robotsAllows } from "./robots.ts";
import type { SourceAdapter, SourceContext, SourceQuery } from "./types.ts";

const TTL_MS = 7 * DAY_MS;
/** research/07 §4.8: at most one page request per host every 2 s, 2 MB cap. */
const FETCH = { minIntervalMs: 2000, timeoutMs: 20_000 };
const MAX_PAGE_BYTES = 2 * 1024 * 1024;

/** Public http(s) only: no credentials, no IP literals (docs sites have
 *  names), no local or internal names. Keeps a model-written URL from
 *  reaching this machine or its network. */
export function publicHttpUrl(value: string | undefined): URL | null {
	if (!value) return null;
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return null;
	}
	if (url.protocol !== "https:" && url.protocol !== "http:") return null;
	if (url.username || url.password) return null;
	const host = url.hostname.toLowerCase();
	if (host.startsWith("[") || /^\d+(\.\d+){0,3}$/.test(host) || /^0x[0-9a-f]+$/.test(host)) return null;
	if (!host.includes(".") || /\.(localhost|local|internal|lan|home|arpa)$/.test(host)) return null;
	return url;
}

async function confirm(item: CanonItem, url: URL, ctx: SourceContext): Promise<Candidate | null> {
	if (!(await robotsAllows(url.href, ctx))) return null;
	const response = await getResponse(ctx, url.href, FETCH);
	if (!response.ok) {
		await response.body?.cancel().catch(() => undefined);
		return null;
	}
	const final = publicHttpUrl(response.url || url.href);
	if (!final || (final.href !== url.href && !(await robotsAllows(final.href, ctx)))) {
		await response.body?.cancel().catch(() => undefined);
		return null;
	}
	let title: string | undefined;
	if (/\bx?html\b/i.test(response.headers.get("content-type") ?? "")) {
		const html = await readTextCapped(response, MAX_PAGE_BYTES);
		const raw = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
		title = raw ? plainText(raw) || undefined : undefined;
	} else {
		// A PDF or other file: confirmed by the 2xx, not read.
		await response.body?.cancel().catch(() => undefined);
	}
	return candidate({
		source: "docs",
		kind: "docs",
		title: title ?? item.title,
		url: final.href,
		by: final.hostname,
		canon: true,
	});
}

export const docs: SourceAdapter = {
	id: "docs",
	resolves: ["docs"],

	/** Docs come only from the roadmap's named resources. */
	async search(): Promise<Candidate[]> {
		return [];
	},

	resolve(item: CanonItem, _query: SourceQuery, ctx: SourceContext): Promise<Candidate | null> {
		const url = item.kind === "docs" ? publicHttpUrl(item.url) : null;
		if (!url) return Promise.resolve(null);
		const key = `docs:resolve:${url.href}`;
		const hit = ctx.cache.get<Candidate>(key, TTL_MS);
		if (hit) return Promise.resolve(hit);
		// Only confirmations are cached: a refusal may be a passing outage.
		return safelyResolve(async () => {
			const found = await confirm(item, url, ctx);
			if (found) ctx.cache.set(key, found);
			return found;
		});
	},
};
