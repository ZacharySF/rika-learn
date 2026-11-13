/**
 * RANKING AND DEDUPE (research/07 §4.6–4.7). Deterministic and local: no
 * model call decides the order. Per stage the learner sees one best video,
 * then one (Normal) or two readings or exercises; everything else that
 * survived the filters goes under "More", best first.
 *
 * View and like counts are only used as a filter (YouTube policy: no
 * computed quality score is shown), and the reason line is plain words.
 */
import type { CanonItem, Candidate, DepthId, Resource, ResourceKind, SourceId, StageResources } from "./contracts.ts";
import { depthSpec } from "./depth.ts";

const TRACKING = /^(utm_.*|fbclid|gclid|mc_cid|mc_eid|ref|ref_src)$/i;
const YOUTUBE_HOSTS = new Set(["youtube.com", "youtube-nocookie.com"]);

/** One URL per resource: lower-case host without www/m, no tracking
 *  parameters or fragment, sorted query, no trailing slash, and every
 *  YouTube form rewritten to youtube.com/watch?v=<id>. */
export function canonicalUrl(raw: string): string {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return raw;
	}
	const host = url.hostname.toLowerCase().replace(/^(www|m)\./, "");
	let videoId: string | undefined;
	if (host === "youtu.be") videoId = url.pathname.split("/")[1];
	else if (YOUTUBE_HOSTS.has(host)) {
		videoId = url.pathname === "/watch" ? (url.searchParams.get("v") ?? undefined) : /^\/(embed|shorts|live)\/([^/]+)/.exec(url.pathname)?.[2];
	}
	if (videoId) return `https://youtube.com/watch?v=${videoId}`;
	const params = [...url.searchParams.entries()].filter(([key]) => !TRACKING.test(key)).sort(([a], [b]) => a.localeCompare(b));
	const query = params.length > 0 ? `?${new URLSearchParams(params).toString()}` : "";
	const path = url.pathname.replace(/\/+$/, "");
	const port = url.port ? `:${url.port}` : "";
	return `${url.protocol}//${host}${port}${path}${query}`;
}

const STOPWORDS = new Set(
	"a an and are as at be by for from how in into is it of on or the this to what with your you vs via introduction intro basics".split(" "),
);

/** Lower-case word stems (a trailing plural "s" dropped), stopwords out. */
export function titleTokens(text: string): string[] {
	const out: string[] = [];
	for (const raw of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
		if (!raw || STOPWORDS.has(raw)) continue;
		out.push(raw.length > 3 && raw.endsWith("s") && !raw.endsWith("ss") ? raw.slice(0, -1) : raw);
	}
	return out;
}

/** Jaccard overlap of the two titles' token sets (0–1). */
export function titleSimilarity(a: string, b: string): number {
	const x = new Set(titleTokens(a));
	const y = new Set(titleTokens(b));
	if (x.size === 0 || y.size === 0) return 0;
	let both = 0;
	for (const t of x) if (y.has(t)) both++;
	return both / (x.size + y.size - both);
}

/** Which result kinds can confirm a model-named kind. */
const CANON_KINDS: Record<ResourceKind, readonly ResourceKind[]> = {
	video: ["video", "course"],
	course: ["course", "video"],
	book: ["book"],
	paper: ["paper"],
	docs: ["docs", "reading"],
	reading: ["reading", "docs", "exercise"],
	exercise: ["exercise", "reading"],
	repo: ["repo"],
	discussion: ["discussion"],
};

/** The real result that a model-named resource refers to, or null (then
 *  the named resource is dropped — it is never shown unconfirmed). */
export function matchCanon(item: CanonItem, pool: readonly Candidate[]): Candidate | null {
	const wanted = new Set(titleTokens(item.title));
	if (wanted.size === 0) return null;
	const by = new Set(titleTokens(item.by ?? ""));
	let best: { candidate: Candidate; score: number } | null = null;
	for (const candidate of pool) {
		if (!CANON_KINDS[item.kind].includes(candidate.kind)) continue;
		const have = new Set(titleTokens(candidate.title));
		let hits = 0;
		for (const t of wanted) if (have.has(t)) hits++;
		let score = hits / wanted.size;
		if (by.size > 0 && candidate.by) {
			const theirs = new Set(titleTokens(candidate.by));
			if ([...by].some((t) => theirs.has(t))) score += 0.1;
		}
		if (score >= 0.8 && (!best || score > best.score)) best = { candidate, score };
	}
	return best ? { ...best.candidate, canon: true } : null;
}

function merge(into: Candidate, other: Candidate): Candidate {
	const merged: Candidate = { ...other, ...into };
	for (const key of Object.keys(other) as (keyof Candidate)[]) {
		if (merged[key] === undefined) Object.assign(merged, { [key]: other[key] });
	}
	if (into.canon || other.canon) merged.canon = true;
	if (into.signals || other.signals) merged.signals = { ...other.signals, ...into.signals };
	return merged;
}

/** One entry per canonical URL (fields merged, the canon flag kept), then
 *  near-identical titles from the same author or channel collapsed. */
export function dedupeCandidates(candidates: readonly Candidate[]): Candidate[] {
	const byUrl = new Map<string, Candidate>();
	for (const candidate of candidates) {
		const key = canonicalUrl(candidate.url);
		const seen = byUrl.get(key);
		byUrl.set(key, seen ? merge(seen, candidate) : candidate);
	}
	const out: Candidate[] = [];
	for (const candidate of byUrl.values()) {
		const twin = candidate.by
			? out.findIndex((c) => c.by?.toLowerCase() === candidate.by?.toLowerCase() && titleSimilarity(c.title, candidate.title) > 0.8)
			: -1;
		if (twin < 0) out.push(candidate);
		else if (candidate.canon && !out[twin]!.canon) out[twin] = candidate;
	}
	return out;
}

export interface RankContext {
	stage: { title: string; query: string; topics: readonly { title: string; objective: string; minutes: number }[] };
	depth: DepthId;
	volatility: "evergreen" | "fast";
	now: number;
}

/** Channels with a long record of careful teaching [INFERENCE, research/07 §4.6]. */
const KNOWN_CHANNELS = [
	"3blue1brown",
	"mit opencourseware",
	"freecodecamp.org",
	"statquest with josh starmer",
	"khan academy",
	"crashcourse",
	"computerphile",
	"cs50",
	"numberphile",
	"veritasium",
];

const VIDEO_MINUTES: Record<DepthId, [number, number]> = {
	normal: [6, 25],
	high: [6, 25],
	super: [10, 45],
	ultra: [20, 90],
	ultraviolet: [20, 90],
};

const READING_KINDS = new Set<ResourceKind>(["reading", "exercise", "docs", "course", "book", "paper", "repo"]);
const HYGIENE = /#shorts|\breaction\b|\blive ?stream|\bmeme\b/i;
const MORE_LIMIT = 12;

function kindWeight(kind: ResourceKind, depth: DepthId): number {
	const deep = depth === "ultra" || depth === "ultraviolet";
	const atLeastSuper = deep || depth === "super";
	switch (kind) {
		case "video":
			return 1;
		case "docs":
			return 0.9;
		case "exercise":
			return 0.75;
		case "reading":
			return 0.7;
		case "course":
			return deep ? 0.9 : 0.6;
		case "book":
			return atLeastSuper ? 0.8 : 0.3;
		case "paper":
			return deep ? 0.7 : 0.25;
		case "repo":
			return 0.5;
		case "discussion":
			return 0.35;
	}
}

const SOURCE_PHRASE: Record<SourceId, string> = {
	wikipedia: "Wikipedia overview",
	mitlearn: "From MIT OpenCourseWare",
	freecodecamp: "freeCodeCamp tutorial",
	openlibrary: "Book on Open Library",
	docs: "Official documentation",
	youtube: "Video",
	arxiv: "Paper on arXiv",
	semanticscholar: "Paper on Semantic Scholar",
	hackernews: "Discussion on Hacker News",
	awesome: "Curated list on GitHub",
	brave: "Web result",
};

function log10p(n: number | undefined): number {
	return n && n > 0 ? Math.log10(1 + n) : 0;
}

function yearOf(c: Candidate): number | undefined {
	if (c.year) return c.year;
	const published = c.signals?.publishedAt ? Date.parse(c.signals.publishedAt) : Number.NaN;
	return Number.isNaN(published) ? undefined : new Date(published).getUTCFullYear();
}

function stageTerms(ctx: RankContext): Set<string> {
	return new Set(titleTokens([ctx.stage.title, ctx.stage.query, ...ctx.stage.topics.map((t) => `${t.title} ${t.objective}`)].join(" ")));
}

/** Score one candidate, or null when a filter drops it. */
function score(c: Candidate, ctx: RankContext, terms: Set<string>): { score: number; reason: string } | null {
	const known = !!c.by && KNOWN_CHANNELS.includes(c.by.toLowerCase());
	const have = new Set(titleTokens(`${c.title} ${c.description ?? ""}`));
	let hits = 0;
	for (const t of terms) if (have.has(t)) hits++;
	const relevance = Math.min(1, hits / Math.max(1, Math.min(4, terms.size)));
	if (!c.canon && relevance < 0.2) return null;

	let total = kindWeight(c.kind, ctx.depth) + relevance + (c.canon ? 1 : 0);
	const parts: string[] = [c.canon ? "Recommended for this stage" : ""];

	if (c.kind === "video") {
		if (HYGIENE.test(c.title)) return null;
		const ageDays = c.signals?.publishedAt ? (ctx.now - Date.parse(c.signals.publishedAt)) / 86_400_000 : Number.POSITIVE_INFINITY;
		const views = c.signals?.views;
		if (!c.canon && !known && views !== undefined && views < 1000 && !(ageDays < 183)) return null;
		const [lo, hi] = VIDEO_MINUTES[ctx.depth];
		const minutes = c.minutes;
		if (known) parts.push("Known teaching channel");
		if (minutes !== undefined) {
			if (minutes < 3) return null;
			if (minutes >= lo && minutes <= hi) {
				total += 0.5;
				parts.push("Right length");
			} else if (minutes < lo) {
				total -= 0.3;
				parts.push("Quick overview");
			} else if (minutes > hi * 2.5 && !(ctx.depth === "ultra" || ctx.depth === "ultraviolet")) {
				total -= 0.6;
				parts.push("Long lecture");
			} else {
				total -= 0.2;
				parts.push("Long lecture");
			}
		}
		if (c.signals?.captions) {
			total += 0.1;
			parts.push("Has captions");
		}
		if (known) total += 0.3;
	} else {
		parts.push(SOURCE_PHRASE[c.source]);
	}

	if (ctx.volatility === "fast") {
		const year = yearOf(c);
		const age = year === undefined ? undefined : new Date(ctx.now).getUTCFullYear() - year;
		if (age !== undefined && age <= 2) total += 0.3;
		else if (age !== undefined && age > 5) total -= 0.3;
	}
	total += Math.min(0.4, log10p(c.signals?.citations) * 0.1) + Math.min(0.2, log10p(c.signals?.influential) * 0.08);
	total += Math.min(0.3, log10p(c.signals?.editions) * 0.1) + Math.min(0.3, log10p(c.signals?.stars) * 0.06);
	total += Math.min(0.2, log10p(c.signals?.points) * 0.05);
	if ((c.signals?.citations ?? 0) >= 1000) parts.push("Highly cited");

	// Whole phrases only, at most 12 words; the channel and minutes are
	// already on the resource's own line, so the reason never repeats them.
	let reason = "";
	for (const part of parts.filter(Boolean)) {
		const next = reason ? `${reason} · ${part}` : part;
		if (next.split(/\s+/).length > 12) break;
		reason = next;
	}
	return { score: Math.round(total * 1000) / 1000, reason };
}

function byScore(a: Resource, b: Resource): number {
	return b.score - a.score || a.title.localeCompare(b.title);
}

function select(sorted: readonly Resource[], readings: number, taken: ReadonlyMap<string, number>): StageResources {
	const free = sorted.filter((r) => !taken.has(r.id));
	const video = free.find((r) => r.kind === "video");
	const reads = free.filter((r) => READING_KINDS.has(r.kind)).slice(0, readings);
	const picks = video ? [video, ...reads] : reads;
	const chosen = new Set(picks.map((r) => r.id));
	const more = sorted
		.filter((r) => !chosen.has(r.id))
		.map((r) => {
			const stage = taken.get(r.id);
			return stage === undefined ? r : { ...r, reason: `${r.reason} (also in stage ${stage + 1})` };
		})
		.slice(0, MORE_LIMIT);
	return { picks, more };
}

/** Dedupe, filter, score and split one stage's candidates. */
export function rankStage(candidates: readonly Candidate[], ctx: RankContext): StageResources {
	const terms = stageTerms(ctx);
	const ranked: Resource[] = [];
	for (const c of dedupeCandidates(candidates)) {
		const scored = score(c, ctx, terms);
		if (scored) ranked.push({ ...c, id: canonicalUrl(c.url), ...scored });
	}
	ranked.sort(byScore);
	return select(ranked, depthSpec(ctx.depth).readings, new Map());
}

/** Across a roadmap a resource is a pick in at most one stage (the first);
 *  later stages show it under More with "(also in stage N)" and promote
 *  their next best instead. */
export function assignAcrossStages(stages: readonly StageResources[], depth: DepthId): StageResources[] {
	const taken = new Map<string, number>();
	const readings = depthSpec(depth).readings;
	return stages.map((resources, index) => {
		const sorted = [...resources.picks, ...resources.more].map((r) => ({ ...r, reason: r.reason.replace(/ \(also in stage \d+\)$/, "") })).sort(byScore);
		const out = select(sorted, readings, taken);
		for (const pick of out.picks) if (!taken.has(pick.id)) taken.set(pick.id, index);
		return out;
	});
}
