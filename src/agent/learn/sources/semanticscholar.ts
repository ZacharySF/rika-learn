/**
 * SEMANTIC SCHOLAR (research/07 §2.1): graph paper search, for well-cited
 * papers and surveys. The keyless pool is shared by everyone, so requests
 * are spaced a second apart and a 429 is reported, not retried.
 */
import type { Candidate, CanonItem } from "../../../core/learn/contracts.ts";
import {
	DAY_MS,
	ParseError,
	asArray,
	asNumber,
	asRecord,
	asString,
	authorsLine,
	cached,
	candidate,
	clip,
	getJson,
	httpUrl,
	normalizeKey,
	safely,
	safelyResolve,
	titlesMatch,
} from "./http.ts";
import type { SourceAdapter, SourceContext, SourceQuery } from "./types.ts";

const FIELDS = "title,year,url,citationCount,influentialCitationCount,tldr,authors,openAccessPdf";
const TTL_MS = 7 * DAY_MS;
const PACE = { minIntervalMs: 1000 };

function byLine(authors: unknown): string | undefined {
	return authorsLine(
		asArray(authors).flatMap((a) => {
			const name = asString(asRecord(a)?.name);
			return name ? [name] : [];
		}),
	);
}

async function searchPapers(ctx: SourceContext, text: string, limit: number): Promise<Candidate[]> {
	const params = new URLSearchParams({ query: text, fields: FIELDS, limit: String(limit) });
	const body = asRecord(await getJson(ctx, `https://api.semanticscholar.org/graph/v1/paper/search?${params}`, PACE));
	if (!body) throw new ParseError("not an object from Semantic Scholar");
	// No matches come back without a `data` array.
	return asArray(body.data).flatMap((entry) => {
		const paper = asRecord(entry);
		const title = asString(paper?.title);
		const url = httpUrl(paper?.url);
		if (!title || !url) return [];
		return [
			candidate({
				source: "semanticscholar",
				kind: "paper",
				title,
				url,
				by: byLine(paper?.authors),
				description: clip(asString(asRecord(paper?.tldr)?.text)),
				year: asNumber(paper?.year),
				signals: { citations: asNumber(paper?.citationCount), influential: asNumber(paper?.influentialCitationCount) },
			}),
		];
	});
}

export const semanticscholar: SourceAdapter = {
	id: "semanticscholar",
	resolves: ["paper"],

	search(query: SourceQuery, ctx: SourceContext, onError?: (reason: string) => void): Promise<Candidate[]> {
		const limit = Math.max(1, Math.min(20, query.limit));
		return safely("semanticscholar", onError, () =>
			cached(ctx, `semanticscholar:search:${limit}:${normalizeKey(query.query)}`, TTL_MS, () =>
				searchPapers(ctx, query.query, limit),
			),
		);
	},

	resolve(item: CanonItem, _query: SourceQuery, ctx: SourceContext): Promise<Candidate | null> {
		return safelyResolve(() =>
			cached(ctx, `semanticscholar:resolve:${normalizeKey(item.title)}`, TTL_MS, async () => {
				const match = (await searchPapers(ctx, item.title, 5)).find((p) => titlesMatch(item.title, p.title));
				return match ? { ...match, canon: true } : null;
			}),
		);
	},
};
