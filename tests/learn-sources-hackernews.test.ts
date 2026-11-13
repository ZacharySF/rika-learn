/**
 * Hacker News adapter (Algolia search API): stories only, the link is the
 * HN thread built from the API's objectID, points kept as a signal.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hackernews } from "../src/agent/learn/sources/hackernews.ts";
import { fakeSources, json, stageQuery, text, type Route } from "./learn-sources-fakes.ts";

const route: Route = () =>
	json({
		hits: [
			{
				objectID: "4100001",
				title: "Ask HN: How did you learn vector spaces?",
				url: "https://blog.example.test/vectors",
				author: "synthetic_user",
				points: 321,
				num_comments: 87,
				created_at: "2024-05-01T10:00:00.000Z",
			},
			{ objectID: "not-a-number", title: "Bad id" },
			{ objectID: "4100002", title: "" },
		],
	});

describe("hackernews.search", () => {
	it("queries stories on hn.algolia.com", async () => {
		const fake = fakeSources(route);
		await hackernews.search(stageQuery({ limit: 3 }), fake.ctx);
		const url = fake.calls[0]?.url;
		assert.equal(url?.origin + (url?.pathname ?? ""), "https://hn.algolia.com/api/v1/search");
		assert.equal(url?.searchParams.get("query"), "vector spaces introduction");
		assert.equal(url?.searchParams.get("tags"), "story");
		assert.equal(url?.searchParams.get("hitsPerPage"), "3");
	});

	it("links the HN thread, not the story's own URL", async () => {
		const fake = fakeSources(route);
		const found = await hackernews.search(stageQuery(), fake.ctx);
		assert.deepEqual(found, [
			{
				source: "hackernews",
				kind: "discussion",
				title: "Ask HN: How did you learn vector spaces?",
				url: "https://news.ycombinator.com/item?id=4100001",
				by: "Hacker News",
				description: "87 comments",
				year: 2024,
				signals: { points: 321, publishedAt: "2024-05-01T10:00:00.000Z" },
			},
		]);
	});

	it("returns [] and a reason on failure", async () => {
		const fake = fakeSources(() => text("", 502));
		assert.deepEqual(await hackernews.search(stageQuery(), fake.ctx, fake.onError), []);
		assert.deepEqual(fake.errors, ["Hacker News answered with an error (HTTP 502)."]);
		const garbled = fakeSources(() => json({ nothing: true }));
		assert.deepEqual(await hackernews.search(stageQuery(), garbled.ctx, garbled.onError), []);
		assert.deepEqual(garbled.errors, ["Hacker News sent a reply that could not be read."]);
	});

	it("answers a repeated search from the cache", async () => {
		const fake = fakeSources(route);
		await hackernews.search(stageQuery(), fake.ctx);
		await hackernews.search(stageQuery(), fake.ctx);
		assert.equal(fake.calls.length, 1);
	});

	it("has no resolve", () => {
		assert.equal(hackernews.resolve, undefined);
		assert.deepEqual(hackernews.resolves, []);
	});
});
