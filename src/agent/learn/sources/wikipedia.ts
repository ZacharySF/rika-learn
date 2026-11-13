/**
 * WIKIPEDIA (research/07 §2.1): Action API `list=search` for titles, then
 * the REST summary per title for the link, extract and thumbnail.
 * Wikimedia asks for an identifying User-Agent (sent by http.ts) and
 * allows ~200 requests a minute with one, so requests to a wiki host are
 * spaced 300 ms apart.
 */
import type { Candidate, CanonItem } from "../../../core/learn/contracts.ts";
import {
	DAY_MS,
	asArray,
	asNumber,
	asRecord,
	asString,
	cached,
	candidate,
	clip,
	getJson,
	httpUrl,
	languageCode,
	normalizeKey,
	ParseError,
	safely,
	safelyResolve,
	titlesMatch,
} from "./http.ts";
import type { SourceAdapter, SourceContext, SourceQuery } from "./types.ts";

const MAX_RESULTS = 3;
const TTL_MS = 7 * DAY_MS;
const PACE = { minIntervalMs: 300 };
const WORDS_PER_MINUTE = 200;

interface Hit {
	title: string;
	words?: number;
}

async function searchTitles(ctx: SourceContext, lang: string, text: string, limit: number): Promise<Hit[]> {
	const params = new URLSearchParams({
		action: "query",
		list: "search",
		srsearch: text,
		srlimit: String(limit),
		srprop: "wordcount",
		format: "json",
		formatversion: "2",
	});
	const body = asRecord(await getJson(ctx, `https://${lang}.wikipedia.org/w/api.php?${params}`, PACE));
	const query = asRecord(body?.query);
	if (!query) throw new ParseError("no query in Wikipedia search reply");
	return asArray(query.search).flatMap((entry) => {
		const record = asRecord(entry);
		const title = asString(record?.title);
		return title ? [{ title, words: asNumber(record?.wordcount) }] : [];
	});
}

/** The summary as a Candidate, or null for disambiguation pages and
 *  summaries without a page link. */
async function summary(ctx: SourceContext, lang: string, hit: Hit): Promise<Candidate | null> {
	const path = encodeURIComponent(hit.title.replaceAll(" ", "_"));
	const body = asRecord(await getJson(ctx, `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${path}`, PACE));
	if (!body || body.type === "disambiguation") return null;
	const url = httpUrl(asRecord(asRecord(body.content_urls)?.desktop)?.page);
	const title = asString(body.title) ?? hit.title;
	if (!url) return null;
	return candidate({
		source: "wikipedia",
		kind: "reading",
		title,
		url,
		by: "Wikipedia",
		description: clip(asString(body.extract) ?? asString(body.description)),
		minutes: hit.words ? Math.max(1, Math.round(hit.words / WORDS_PER_MINUTE)) : undefined,
		thumbnail: httpUrl(asRecord(body.thumbnail)?.source),
	});
}

async function summaries(ctx: SourceContext, lang: string, hits: Hit[]): Promise<Candidate[]> {
	// One missing summary should not cost the other results.
	const found = await Promise.all(hits.map((hit) => summary(ctx, lang, hit).catch(() => null)));
	return found.filter((c): c is Candidate => c !== null);
}

export const wikipedia: SourceAdapter = {
	id: "wikipedia",
	resolves: ["reading"],

	search(query: SourceQuery, ctx: SourceContext, onError?: (reason: string) => void): Promise<Candidate[]> {
		const lang = languageCode(query.language);
		const limit = Math.max(1, Math.min(MAX_RESULTS, query.limit));
		return safely("wikipedia", onError, () =>
			cached(ctx, `wikipedia:search:${lang}:${limit}:${normalizeKey(query.query)}`, TTL_MS, async () =>
				summaries(ctx, lang, await searchTitles(ctx, lang, query.query, limit)),
			),
		);
	},

	resolve(item: CanonItem, query: SourceQuery, ctx: SourceContext): Promise<Candidate | null> {
		const lang = languageCode(query.language);
		return safelyResolve(() =>
			cached(ctx, `wikipedia:resolve:${lang}:${normalizeKey(item.title)}`, TTL_MS, async () => {
				const hits = await searchTitles(ctx, lang, item.title, MAX_RESULTS);
				const match = hits.find((hit) => titlesMatch(item.title, hit.title));
				const found = match ? await summary(ctx, lang, match) : null;
				return found ? { ...found, canon: true } : null;
			}),
		);
	},
};
