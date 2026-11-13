/**
 * YouTube adapter: the learner's Data API key, exactly one search.list
 * and one videos.list per stage search, the daily search meter spent
 * before searching, results cached for at most 30 days. Never scraped,
 * never asks for captions.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { YoutubeQuota } from "../src/agent/learn/sources/types.ts";
import { youtube } from "../src/agent/learn/sources/youtube.ts";
import { DAY, fakeSources, json, notFound, stageQuery, text, type Route } from "./learn-sources-fakes.ts";

const IDS = ["vidAAAAAAA1", "vidBBBBBBB2", "vidCCCCCCC3", "vidDDDDDDD4", "vidEEEEEEE5"];

function details(id: string, extra: { privacyStatus?: string; embeddable?: boolean } = {}) {
	return {
		id,
		snippet: {
			title: `Vector spaces lesson ${id}`,
			description: `Synthetic lesson ${id}.\n00:00 Intro`,
			channelId: "UCsynthetic",
			channelTitle: "Synthetic Maths",
			publishedAt: "2023-04-05T06:07:08Z",
			thumbnails: { medium: { url: `https://i.ytimg.com/vi/${id}/mqdefault.jpg` } },
			liveBroadcastContent: "none",
		},
		contentDetails: { duration: "PT12M30S", caption: id === IDS[0] ? "true" : "false" },
		statistics: { viewCount: "12345", likeCount: "678" },
		status: { embeddable: extra.embeddable ?? true, privacyStatus: extra.privacyStatus ?? "public" },
	};
}

function route(searchIds: string[] = IDS): Route {
	return (url) => {
		if (url.pathname === "/youtube/v3/search") {
			return json({
				items: [
					...searchIds.map((videoId) => ({ id: { kind: "youtube#video", videoId }, snippet: { title: "search title" } })),
					{ id: { kind: "youtube#channel", channelId: "UCx" } },
				],
			});
		}
		if (url.pathname === "/youtube/v3/videos") {
			const ids = (url.searchParams.get("id") ?? "").split(",");
			const items = ids
				.filter((id) => id !== IDS[4])
				.map((id) =>
					id === IDS[2] ? details(id, { privacyStatus: "unlisted" }) : id === IDS[3] ? details(id, { embeddable: false }) : details(id),
				);
			return json({ items });
		}
		return notFound();
	};
}

function quota(left: number): YoutubeQuota & { spent: number } {
	const meter = {
		spent: 0,
		remaining: () => left - meter.spent,
		spend: () => {
			if (meter.spent >= left) return false;
			meter.spent++;
			return true;
		},
	};
	return meter;
}

const KEY = { keys: { youtube: "yt-test-key" } };

describe("youtube.search", () => {
	it("makes no request without a key", async () => {
		const fake = fakeSources(route());
		assert.deepEqual(await youtube.search(stageQuery(), fake.ctx, fake.onError), []);
		assert.equal(fake.calls.length, 0);
	});

	it("makes exactly one search.list and one videos.list with the right parameters", async () => {
		const meter = quota(100);
		const fake = fakeSources(route(), { ...KEY, youtubeQuota: meter });
		await youtube.search(stageQuery({ language: "de", videoDuration: "medium" }), fake.ctx);
		assert.deepEqual(
			fake.calls.map((c) => c.url.pathname),
			["/youtube/v3/search", "/youtube/v3/videos"],
		);
		const search = fake.calls[0]?.url.searchParams;
		assert.equal(fake.calls[0]?.url.origin, "https://www.googleapis.com");
		assert.equal(search?.get("part"), "snippet");
		assert.equal(search?.get("q"), "vector spaces introduction");
		assert.equal(search?.get("type"), "video");
		assert.equal(search?.get("maxResults"), "25");
		assert.equal(search?.get("videoEmbeddable"), "true");
		assert.equal(search?.get("safeSearch"), "moderate");
		assert.equal(search?.get("relevanceLanguage"), "de");
		assert.equal(search?.get("videoDuration"), "medium");
		assert.equal(search?.get("key"), "yt-test-key");
		const videos = fake.calls[1]?.url.searchParams;
		assert.equal(videos?.get("part"), "snippet,contentDetails,statistics,status");
		assert.equal(videos?.get("id"), IDS.join(","));
		assert.equal(videos?.get("key"), "yt-test-key");
		assert.equal(meter.spent, 1);
		assert.ok(fake.calls.every((c) => !c.url.pathname.includes("caption")), "never requests captions");
	});

	it("passes videoDuration=any when the stage allows any length", async () => {
		const fake = fakeSources(route(), KEY);
		await youtube.search(stageQuery({ videoDuration: "any" }), fake.ctx);
		assert.equal(fake.calls[0]?.url.searchParams.get("videoDuration"), "any");
	});

	it("asks videos.list for at most 50 ids", async () => {
		const many = Array.from({ length: 60 }, (_, i) => `many${String(i).padStart(7, "0")}`);
		const fake = fakeSources(route(many), KEY);
		await youtube.search(stageQuery(), fake.ctx);
		assert.equal(fake.calls.length, 2);
		assert.equal(fake.calls[1]?.url.searchParams.get("id")?.split(",").length, 50);
	});

	it("parses details and drops non-public, non-embeddable and missing videos", async () => {
		const fake = fakeSources(route(), KEY);
		const found = await youtube.search(stageQuery({ limit: 10 }), fake.ctx);
		assert.deepEqual(
			found.map((c) => c.videoId),
			[IDS[0], IDS[1]],
		);
		assert.deepEqual(found[0], {
			source: "youtube",
			kind: "video",
			title: `Vector spaces lesson ${IDS[0]}`,
			url: `https://www.youtube.com/watch?v=${IDS[0]}`,
			by: "Synthetic Maths",
			description: `Synthetic lesson ${IDS[0]}. 00:00 Intro`,
			minutes: 13,
			year: 2023,
			thumbnail: `https://i.ytimg.com/vi/${IDS[0]}/mqdefault.jpg`,
			videoId: IDS[0],
			signals: {
				views: 12345,
				likes: 678,
				captions: true,
				embeddable: true,
				publishedAt: "2023-04-05T06:07:08Z",
				channelId: "UCsynthetic",
			},
		});
		assert.equal(found[1]?.signals?.captions, false);
	});

	it("returns at most query.limit candidates", async () => {
		const fake = fakeSources(route(), KEY);
		assert.equal((await youtube.search(stageQuery({ limit: 1 }), fake.ctx)).length, 1);
	});

	it("skips videos.list when the search found nothing", async () => {
		const fake = fakeSources(route([]), KEY);
		assert.deepEqual(await youtube.search(stageQuery(), fake.ctx), []);
		assert.equal(fake.calls.length, 1);
	});

	it("stops with a plain reason when today's searches are used up", async () => {
		const meter = quota(0);
		const fake = fakeSources(route(), { ...KEY, youtubeQuota: meter });
		assert.deepEqual(await youtube.search(stageQuery(), fake.ctx, fake.onError), []);
		assert.equal(fake.calls.length, 0);
		assert.deepEqual(fake.errors, ["YouTube search limit reached for today"]);
	});

	it("serves a repeat from the cache without a request or a search spent, for up to 30 days", async () => {
		const meter = quota(100);
		const fake = fakeSources(route(), { ...KEY, youtubeQuota: meter });
		const first = await youtube.search(stageQuery(), fake.ctx);
		fake.clock.now += 30 * DAY - 1;
		assert.deepEqual(await youtube.search(stageQuery(), fake.ctx), first);
		assert.equal(fake.calls.length, 2);
		assert.equal(meter.spent, 1);
		fake.clock.now += 2;
		await youtube.search(stageQuery(), fake.ctx);
		assert.equal(fake.calls.length, 4, "older than 30 days: searched again");
		assert.equal(meter.spent, 2);
	});

	it("keys the cache by query and parameters", async () => {
		const fake = fakeSources(route(), KEY);
		await youtube.search(stageQuery(), fake.ctx);
		await youtube.search(stageQuery({ videoDuration: "any" }), fake.ctx);
		await youtube.search(stageQuery({ language: "fr" }), fake.ctx);
		await youtube.search(stageQuery({ limit: 2 }), fake.ctx);
		assert.equal(fake.calls.length, 6, "limit is applied after the cache; the other two are new searches");
	});

	it("returns [] and a reason when search.list or videos.list fails", async () => {
		const fake = fakeSources(() => text("quotaExceeded", 403), KEY);
		assert.deepEqual(await youtube.search(stageQuery(), fake.ctx, fake.onError), []);
		assert.deepEqual(fake.errors, ["YouTube refused the request (HTTP 403); check the key."]);
		const half = fakeSources((url, call) => (url.pathname === "/youtube/v3/videos" ? text("", 500) : route()(url, call)), KEY);
		assert.deepEqual(await youtube.search(stageQuery(), half.ctx, half.onError), []);
		assert.deepEqual(half.errors, ["YouTube answered with an error (HTTP 500)."]);
	});

	it("has no resolve: named videos are matched against the stage's search results", () => {
		assert.equal(youtube.resolve, undefined);
		assert.deepEqual(youtube.resolves, []);
	});
});
