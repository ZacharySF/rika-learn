/**
 * OPEN LIBRARY (research/07 §2.1): search.json lookups for textbooks.
 * Its terms allow lookups, not bulk use, at 1 request a second without a
 * contact User-Agent; requests are paced to that regardless.
 */
import type { Candidate, CanonItem } from "../../../core/learn/contracts.ts";
import {
	DAY_MS,
	ParseError,
	asArray,
	asNumber,
	asRecord,
	asString,
	authorMatches,
	cached,
	candidate,
	getJson,
	normalizeKey,
	safely,
	safelyResolve,
	titlesMatch,
} from "./http.ts";
import type { SourceAdapter, SourceContext, SourceQuery } from "./types.ts";

const FIELDS = "key,title,author_name,first_publish_year,edition_count";
const TTL_MS = 30 * DAY_MS;
const PACE = { minIntervalMs: 1000 };

interface Work {
	candidate: Candidate;
	authors: string[];
}

async function searchWorks(ctx: SourceContext, params: Record<string, string>): Promise<Work[]> {
	const query = new URLSearchParams({ ...params, fields: FIELDS });
	const body = asRecord(await getJson(ctx, `https://openlibrary.org/search.json?${query}`, PACE));
	if (!body || !Array.isArray(body.docs)) throw new ParseError("no docs in Open Library reply");
	return asArray(body.docs).flatMap((entry) => {
		const doc = asRecord(entry);
		const key = asString(doc?.key);
		const title = asString(doc?.title);
		// Only work keys ("/works/OL123W") become links.
		if (!key || !title || !/^\/works\/OL\d+W$/.test(key)) return [];
		const authors = asArray(doc?.author_name).flatMap((a) => (typeof a === "string" && a.trim() ? [a.trim()] : []));
		const editions = asNumber(doc?.edition_count);
		return [
			{
				authors,
				candidate: candidate({
					source: "openlibrary",
					kind: "book",
					title,
					url: `https://openlibrary.org${key}`,
					by: authors.length > 0 ? authors.slice(0, 2).join(", ") : undefined,
					year: asNumber(doc?.first_publish_year),
					signals: { editions },
				}),
			},
		];
	});
}

export const openlibrary: SourceAdapter = {
	id: "openlibrary",
	resolves: ["book"],

	search(query: SourceQuery, ctx: SourceContext, onError?: (reason: string) => void): Promise<Candidate[]> {
		const limit = Math.max(1, Math.min(20, query.limit));
		return safely("openlibrary", onError, () =>
			cached(ctx, `openlibrary:search:${limit}:${normalizeKey(query.query)}`, TTL_MS, async () =>
				(await searchWorks(ctx, { q: query.query, limit: String(limit) })).map((w) => w.candidate),
			),
		);
	},

	resolve(item: CanonItem, _query: SourceQuery, ctx: SourceContext): Promise<Candidate | null> {
		const params: Record<string, string> = { title: item.title, limit: "5" };
		if (item.by) params.author = item.by;
		return safelyResolve(() =>
			cached(ctx, `openlibrary:resolve:${normalizeKey(item.title)}:${normalizeKey(item.by ?? "")}`, TTL_MS, async () => {
				const works = await searchWorks(ctx, params);
				// The most-published matching work is the one people mean.
				const best = works
					.filter((w) => titlesMatch(item.title, w.candidate.title) && authorMatches(item.by, w.authors))
					.sort((a, b) => (b.candidate.signals?.editions ?? 0) - (a.candidate.signals?.editions ?? 0))[0];
				return best ? { ...best.candidate, canon: true } : null;
			}),
		);
	},
};
