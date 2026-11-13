/**
 * GitHub awesome-lists adapter: repository search "awesome <topic>
 * in:name" sorted by stars, kind repo, stars as a signal.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { awesome } from "../src/agent/learn/sources/awesome.ts";
import { fakeSources, json, stageQuery, text, type Route } from "./learn-sources-fakes.ts";

const route: Route = () =>
	json({
		total_count: 2,
		items: [
			{
				full_name: "synthetic/awesome-linear-algebra",
				html_url: "https://github.com/synthetic/awesome-linear-algebra",
				description: "A curated list of <synthetic> linear algebra resources",
				stargazers_count: 4200,
				owner: { login: "synthetic" },
				pushed_at: "2025-02-03T00:00:00Z",
			},
			{ full_name: "evil/repo", html_url: "javascript:alert(1)", stargazers_count: 1 },
		],
	});

describe("awesome.search", () => {
	it("searches repositories named awesome + topic, by stars", async () => {
		const fake = fakeSources(route);
		await awesome.search(stageQuery({ limit: 4 }), fake.ctx);
		const url = fake.calls[0]?.url;
		assert.equal(url?.origin + (url?.pathname ?? ""), "https://api.github.com/search/repositories");
		assert.equal(url?.searchParams.get("q"), "awesome linear algebra in:name");
		assert.equal(url?.searchParams.get("sort"), "stars");
		assert.equal(url?.searchParams.get("order"), "desc");
		assert.equal(url?.searchParams.get("per_page"), "4");
		assert.equal(fake.calls[0]?.headers.accept, "application/vnd.github+json");
	});

	it("parses repos and drops non-http links", async () => {
		const fake = fakeSources(route);
		assert.deepEqual(await awesome.search(stageQuery(), fake.ctx), [
			{
				source: "awesome",
				kind: "repo",
				title: "synthetic/awesome-linear-algebra",
				url: "https://github.com/synthetic/awesome-linear-algebra",
				by: "synthetic",
				description: "A curated list of <synthetic> linear algebra resources",
				year: 2025,
				signals: { stars: 4200, publishedAt: "2025-02-03T00:00:00Z" },
			},
		]);
	});

	it("returns [] and a reason on failure (rate limit)", async () => {
		const fake = fakeSources(() => text("", 403));
		assert.deepEqual(await awesome.search(stageQuery(), fake.ctx, fake.onError), []);
		assert.equal(fake.errors.length, 1);
		assert.match(fake.errors[0] ?? "", /GitHub awesome-lists/);
	});

	it("answers a repeated search for the same topic from the cache", async () => {
		const fake = fakeSources(route);
		await awesome.search(stageQuery(), fake.ctx);
		await awesome.search(stageQuery({ query: "another stage query" }), fake.ctx);
		assert.equal(fake.calls.length, 1, "awesome lists are per topic, not per stage");
	});

	it("has no resolve", () => {
		assert.equal(awesome.resolve, undefined);
	});
});
