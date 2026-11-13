/**
 * GITHUB AWESOME-LISTS (research/07 §2.1): repository search for
 * "awesome <topic>" by stars. Unauthenticated search is limited to a few
 * requests a minute, so results are per topic (not per stage) and cached
 * for a week. Links only; the lists' prose is never copied.
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
	clip,
	getJson,
	httpUrl,
	normalizeKey,
	safely,
} from "./http.ts";
import type { SourceAdapter, SourceContext, SourceQuery } from "./types.ts";

const TTL_MS = 7 * DAY_MS;

export const awesome: SourceAdapter = {
	id: "awesome",
	resolves: [],

	search(query: SourceQuery, ctx: SourceContext, onError?: (reason: string) => void): Promise<Candidate[]> {
		const limit = Math.max(1, Math.min(10, query.limit));
		const topic = normalizeKey(query.topic);
		return safely("awesome", onError, () =>
			cached(ctx, `awesome:search:${limit}:${topic}`, TTL_MS, async () => {
				const params = new URLSearchParams({
					q: `awesome ${topic} in:name`,
					sort: "stars",
					order: "desc",
					per_page: String(limit),
				});
				const body = asRecord(
					await getJson(ctx, `https://api.github.com/search/repositories?${params}`, {
						headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
					}),
				);
				if (!body || !Array.isArray(body.items)) throw new ParseError("no items in GitHub reply");
				return asArray(body.items).flatMap((entry) => {
					const repo = asRecord(entry);
					const title = asString(repo?.full_name);
					const url = httpUrl(repo?.html_url);
					if (!title || !url) return [];
					const pushedAt = asString(repo?.pushed_at);
					const year = pushedAt ? Number(pushedAt.slice(0, 4)) : Number.NaN;
					return [
						candidate({
							source: "awesome",
							kind: "repo",
							title,
							url,
							by: asString(asRecord(repo?.owner)?.login),
							description: clip(asString(repo?.description)),
							year: Number.isFinite(year) ? year : undefined,
							signals: { stars: asNumber(repo?.stargazers_count), publishedAt: pushedAt },
						}),
					];
				});
			}),
		);
	},
};
