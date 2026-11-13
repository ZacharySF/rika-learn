/**
 * BRAVE SEARCH (research/07 §2.1): paid web search with the learner's own
 * key, off by default, to fill gaps. No key means no request. Each query
 * costs money, so results are cached for a week.
 */
import type { Candidate } from "../../../core/learn/contracts.ts";
import {
	DAY_MS,
	ParseError,
	asArray,
	asRecord,
	asString,
	cached,
	candidate,
	clip,
	getJson,
	httpUrl,
	languageCode,
	normalizeKey,
	plainText,
	safely,
} from "./http.ts";
import type { SourceAdapter, SourceContext, SourceQuery } from "./types.ts";

const TTL_MS = 7 * DAY_MS;

export const brave: SourceAdapter = {
	id: "brave",
	resolves: [],

	async search(query: SourceQuery, ctx: SourceContext, onError?: (reason: string) => void): Promise<Candidate[]> {
		const key = ctx.keys.brave;
		if (!key) return [];
		const lang = languageCode(query.language);
		const limit = Math.max(1, Math.min(20, query.limit));
		return safely("brave", onError, () =>
			cached(ctx, `brave:search:${lang}:${limit}:${normalizeKey(query.query)}`, TTL_MS, async () => {
				const params = new URLSearchParams({ q: query.query, count: String(limit), search_lang: lang });
				const body = asRecord(
					await getJson(ctx, `https://api.search.brave.com/res/v1/web/search?${params}`, {
						headers: { "X-Subscription-Token": key },
					}),
				);
				if (!body) throw new ParseError("not an object from Brave");
				// A query with no web hits has no `web` block at all.
				return asArray(asRecord(body.web)?.results).flatMap((entry) => {
					const result = asRecord(entry);
					const url = httpUrl(result?.url);
					const title = asString(result?.title);
					if (!url || !title) return [];
					const description = asString(result?.description);
					return [
						candidate({
							source: "brave",
							kind: "reading",
							title: plainText(title),
							url,
							by: asString(asRecord(result?.profile)?.name) ?? asString(asRecord(result?.meta_url)?.hostname),
							description: clip(description ? plainText(description) : undefined),
						}),
					];
				});
			}),
		);
	},
};
