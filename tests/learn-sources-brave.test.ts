/**
 * Brave Search adapter: web search with the learner's key in
 * X-Subscription-Token; no key means no request at all.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { brave } from "../src/agent/learn/sources/brave.ts";
import { fakeSources, json, stageQuery, text, type Route } from "./learn-sources-fakes.ts";

const route: Route = () =>
	json({
		web: {
			results: [
				{
					title: "<strong>Vector spaces</strong> explained",
					url: "https://tutorial.example.test/vector-spaces",
					description: "A synthetic <strong>introduction</strong> to vector spaces.",
					profile: { name: "Example Tutorials" },
					meta_url: { hostname: "tutorial.example.test" },
				},
				{ title: "No link" },
			],
		},
	});

describe("brave.search", () => {
	it("makes no request without a key", async () => {
		const fake = fakeSources(route);
		assert.deepEqual(await brave.search(stageQuery(), fake.ctx, fake.onError), []);
		assert.equal(fake.calls.length, 0);
	});

	it("sends the key header and the query", async () => {
		const fake = fakeSources(route, { keys: { brave: "brave-test-key" } });
		await brave.search(stageQuery({ limit: 6, language: "fr" }), fake.ctx);
		const call = fake.calls[0];
		assert.equal(call?.url.origin + (call?.url.pathname ?? ""), "https://api.search.brave.com/res/v1/web/search");
		assert.equal(call?.url.searchParams.get("q"), "vector spaces introduction");
		assert.equal(call?.url.searchParams.get("count"), "6");
		assert.equal(call?.url.searchParams.get("search_lang"), "fr");
		assert.equal(call?.headers["x-subscription-token"], "brave-test-key");
		assert.equal(call?.url.searchParams.get("key"), null, "the key never goes in the URL");
	});

	it("parses web results into readings with tags stripped", async () => {
		const fake = fakeSources(route, { keys: { brave: "k" } });
		assert.deepEqual(await brave.search(stageQuery(), fake.ctx), [
			{
				source: "brave",
				kind: "reading",
				title: "Vector spaces explained",
				url: "https://tutorial.example.test/vector-spaces",
				by: "Example Tutorials",
				description: "A synthetic introduction to vector spaces.",
			},
		]);
	});

	it("returns [] and a reason on failure", async () => {
		const fake = fakeSources(() => text("", 401), { keys: { brave: "bad" } });
		assert.deepEqual(await brave.search(stageQuery(), fake.ctx, fake.onError), []);
		assert.deepEqual(fake.errors, ["Brave Search refused the request (HTTP 401); check the key."]);
	});

	it("answers a repeated (paid) search from the cache", async () => {
		const fake = fakeSources(route, { keys: { brave: "k" } });
		await brave.search(stageQuery(), fake.ctx);
		await brave.search(stageQuery(), fake.ctx);
		assert.equal(fake.calls.length, 1);
	});
});
