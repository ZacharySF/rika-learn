/**
 * HACKER NEWS via the Algolia search API: community threads about the
 * topic. The link is always the HN thread (from the API's objectID), so a
 * learner lands on the discussion rather than an arbitrary story URL.
 */
import type { Candidate } from "../../../core/learn/contracts.ts";
import {
	DAY_MS,
	ParseError,
	asArray,
	asNumber,
	asRecord,
	asString,
	cached,
	candidate,
	getJson,
	normalizeKey,
	safely,
} from "./http.ts";
import type { SourceAdapter, SourceContext, SourceQuery } from "./types.ts";

const TTL_MS = DAY_MS;

export const hackernews: SourceAdapter = {
	id: "hackernews",
	resolves: [],

	search(query: SourceQuery, ctx: SourceContext, onError?: (reason: string) => void): Promise<Candidate[]> {
		const limit = Math.max(1, Math.min(20, query.limit));
		return safely("hackernews", onError, () =>
			cached(ctx, `hackernews:search:${limit}:${normalizeKey(query.query)}`, TTL_MS, async () => {
				const params = new URLSearchParams({ query: query.query, tags: "story", hitsPerPage: String(limit) });
				const body = asRecord(await getJson(ctx, `https://hn.algolia.com/api/v1/search?${params}`));
				if (!body || !Array.isArray(body.hits)) throw new ParseError("no hits in Hacker News reply");
				return asArray(body.hits).flatMap((entry) => {
					const hit = asRecord(entry);
					const id = asString(hit?.objectID);
					const title = asString(hit?.title);
					if (!id || !title || !/^\d+$/.test(id)) return [];
					const comments = asNumber(hit?.num_comments);
					const publishedAt = asString(hit?.created_at);
					const year = publishedAt ? Number(publishedAt.slice(0, 4)) : Number.NaN;
					return [
						candidate({
							source: "hackernews",
							kind: "discussion",
							title,
							url: `https://news.ycombinator.com/item?id=${id}`,
							by: "Hacker News",
							description: comments !== undefined ? `${comments} comments` : undefined,
							year: Number.isFinite(year) ? year : undefined,
							signals: { points: asNumber(hit?.points), publishedAt },
						}),
					];
				});
			}),
		);
	},
};
