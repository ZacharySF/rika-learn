/**
 * YOUTUBE (research/07 §2.2, docs/learn.md "Sources"): the Data API v3
 * with the learner's own key. search.list has its own bucket of 100 calls
 * a day, so each stage search makes EXACTLY one search.list (25 results)
 * and one videos.list (≤ 50 ids, 1 unit) for durations, captions flag,
 * counts and embeddability. The daily meter is spent before searching.
 * Results are cached at most 30 days, as the API policy allows. Never
 * scraped, captions never requested. No resolve: videos the roadmap names
 * are matched against the stage's results by the caller.
 */
import type { Candidate } from "../../../core/learn/contracts.ts";
import {
	DAY_MS,
	ParseError,
	asArray,
	asNumber,
	asRecord,
	asString,
	candidate,
	clip,
	failureReason,
	getJson,
	httpUrl,
	isoDurationSeconds,
	languageCode,
	minutesOf,
	normalizeKey,
} from "./http.ts";
import type { SourceAdapter, SourceContext, SourceQuery } from "./types.ts";

const API = "https://www.googleapis.com/youtube/v3";
/** YouTube API Services policy: cached data is refreshed or deleted within 30 days. */
export const YOUTUBE_CACHE_MAX_AGE_MS = 30 * DAY_MS;
const SEARCH_RESULTS = 25;
const DETAILS_BATCH = 50;
export const QUOTA_REASON = "YouTube search limit reached for today";

async function searchIds(ctx: SourceContext, key: string, query: SourceQuery): Promise<string[]> {
	const params = new URLSearchParams({
		part: "snippet",
		q: query.query,
		type: "video",
		maxResults: String(SEARCH_RESULTS),
		videoEmbeddable: "true",
		safeSearch: "moderate",
		relevanceLanguage: languageCode(query.language),
		videoDuration: query.videoDuration ?? "any",
		key,
	});
	const body = asRecord(await getJson(ctx, `${API}/search?${params}`));
	if (!body || !Array.isArray(body.items)) throw new ParseError("no items in YouTube search reply");
	const ids = asArray(body.items).flatMap((item) => {
		const id = asString(asRecord(asRecord(item)?.id)?.videoId);
		return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? [id] : [];
	});
	return [...new Set(ids)];
}

function toCandidate(item: Record<string, unknown>, id: string): Candidate | null {
	const snippet = asRecord(item.snippet);
	const details = asRecord(item.contentDetails);
	const stats = asRecord(item.statistics);
	const status = asRecord(item.status);
	// Only public, embeddable, finished videos can be played in Learn.
	if (status?.privacyStatus !== "public" || status.embeddable !== true) return null;
	if ((asString(snippet?.liveBroadcastContent) ?? "none") !== "none") return null;
	const seconds = isoDurationSeconds(details?.duration);
	const title = asString(snippet?.title);
	if (!title || !seconds) return null;
	const publishedAt = asString(snippet?.publishedAt);
	const year = publishedAt ? Number(publishedAt.slice(0, 4)) : Number.NaN;
	const thumbnails = asRecord(snippet?.thumbnails);
	return candidate({
		source: "youtube",
		kind: "video",
		title,
		url: `https://www.youtube.com/watch?v=${id}`,
		by: asString(snippet?.channelTitle),
		description: clip(asString(snippet?.description)),
		minutes: minutesOf(seconds),
		year: Number.isFinite(year) ? year : undefined,
		thumbnail: httpUrl(asRecord(thumbnails?.medium)?.url) ?? httpUrl(asRecord(thumbnails?.default)?.url),
		videoId: id,
		signals: {
			views: asNumber(stats?.viewCount),
			likes: asNumber(stats?.likeCount),
			captions: details?.caption === "true",
			embeddable: true,
			publishedAt,
			channelId: asString(snippet?.channelId),
		},
	});
}

async function videoDetails(ctx: SourceContext, key: string, ids: readonly string[]): Promise<Candidate[]> {
	const params = new URLSearchParams({
		part: "snippet,contentDetails,statistics,status",
		id: ids.join(","),
		key,
	});
	const body = asRecord(await getJson(ctx, `${API}/videos?${params}`));
	if (!body || !Array.isArray(body.items)) throw new ParseError("no items in YouTube videos reply");
	const byId = new Map<string, Record<string, unknown>>();
	for (const entry of asArray(body.items)) {
		const item = asRecord(entry);
		const id = asString(item?.id);
		if (item && id) byId.set(id, item);
	}
	// Keep search.list's relevance order.
	return ids.flatMap((id) => {
		const item = byId.get(id);
		const found = item ? toCandidate(item, id) : null;
		return found ? [found] : [];
	});
}

export const youtube: SourceAdapter = {
	id: "youtube",
	resolves: [],

	async search(query: SourceQuery, ctx: SourceContext, onError?: (reason: string) => void): Promise<Candidate[]> {
		const key = ctx.keys.youtube;
		if (!key) return [];
		const limit = Math.max(1, query.limit);
		const cacheKey = `youtube:v1:${languageCode(query.language)}:${query.videoDuration ?? "any"}:${normalizeKey(query.query)}`;
		const hit = ctx.cache.get<Candidate[]>(cacheKey, YOUTUBE_CACHE_MAX_AGE_MS);
		if (hit) return hit.slice(0, limit);
		if (ctx.youtubeQuota && !ctx.youtubeQuota.spend()) {
			onError?.(QUOTA_REASON);
			return [];
		}
		try {
			const ids = await searchIds(ctx, key, query);
			const found = ids.length > 0 ? await videoDetails(ctx, key, ids.slice(0, DETAILS_BATCH)) : [];
			ctx.cache.set(cacheKey, found);
			return found.slice(0, limit);
		} catch (error) {
			onError?.(failureReason("youtube", error));
			return [];
		}
	},
};
