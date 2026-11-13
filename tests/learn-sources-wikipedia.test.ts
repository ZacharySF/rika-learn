/**
 * Wikipedia adapter: Action API search (small srlimit), then the REST
 * summary per title; links come from the summary's content_urls.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { wikipedia } from "../src/agent/learn/sources/wikipedia.ts";
import { fakeSources, json, notFound, stageQuery, text, type Route } from "./learn-sources-fakes.ts";

function summary(title: string, extra: Record<string, unknown> = {}) {
	const slug = title.replaceAll(" ", "_");
	return {
		type: "standard",
		title,
		description: `Synthetic description of ${title}`,
		extract: `${title} is a synthetic article used in tests.`,
		thumbnail: { source: `https://upload.example.test/${slug}.png` },
		content_urls: { desktop: { page: `https://en.wikipedia.org/wiki/${slug}` } },
		...extra,
	};
}

const route: Route = (url) => {
	if (url.pathname === "/w/api.php") {
		return json({
			query: {
				search: [
					{ title: "Vector space", wordcount: 4000 },
					{ title: "Vector (disambiguation)", wordcount: 50 },
					{ title: "Basis (linear algebra)", wordcount: 1000 },
				],
			},
		});
	}
	if (url.pathname.startsWith("/api/rest_v1/page/summary/")) {
		const title = decodeURIComponent(url.pathname.slice("/api/rest_v1/page/summary/".length)).replaceAll("_", " ");
		if (title === "Vector (disambiguation)") return json(summary(title, { type: "disambiguation" }));
		return json(summary(title));
	}
	return notFound();
};

describe("wikipedia.search", () => {
	it("searches with a small srlimit, then fetches each summary, with our User-Agent", async () => {
		const fake = fakeSources(route);
		await wikipedia.search(stageQuery({ limit: 10 }), fake.ctx);
		const search = fake.calls[0]?.url;
		assert.equal(search?.origin, "https://en.wikipedia.org");
		assert.equal(search?.searchParams.get("action"), "query");
		assert.equal(search?.searchParams.get("list"), "search");
		assert.equal(search?.searchParams.get("srsearch"), "vector spaces introduction");
		assert.ok(Number(search?.searchParams.get("srlimit")) <= 5);
		assert.equal(search?.searchParams.get("format"), "json");
		assert.equal(fake.calls.length, 4, "one search + three summaries");
		assert.equal(fake.calls[1]?.url.pathname, "/api/rest_v1/page/summary/Vector_space");
		assert.ok(fake.calls.every((c) => c.headers["user-agent"] === fake.ctx.userAgent));
	});

	it("uses the learner's language wiki", async () => {
		const fake = fakeSources(route);
		await wikipedia.search(stageQuery({ language: "de" }), fake.ctx);
		assert.equal(fake.calls[0]?.url.host, "de.wikipedia.org");
	});

	it("parses summaries to reading candidates and drops disambiguation pages", async () => {
		const fake = fakeSources(route);
		const found = await wikipedia.search(stageQuery(), fake.ctx);
		assert.deepEqual(
			found.map((c) => c.title),
			["Vector space", "Basis (linear algebra)"],
		);
		const first = found[0];
		assert.equal(first?.source, "wikipedia");
		assert.equal(first?.kind, "reading");
		assert.equal(first?.url, "https://en.wikipedia.org/wiki/Vector_space");
		assert.equal(first?.by, "Wikipedia");
		assert.match(first?.description ?? "", /synthetic article/);
		assert.equal(first?.minutes, 20, "4000 words at 200 words a minute");
		assert.equal(first?.thumbnail, "https://upload.example.test/Vector_space.png");
	});

	it("returns [] and a reason on failure", async () => {
		const fake = fakeSources(() => text("busy", 503));
		assert.deepEqual(await wikipedia.search(stageQuery(), fake.ctx, fake.onError), []);
		assert.deepEqual(fake.errors, ["Wikipedia answered with an error (HTTP 503)."]);
		const broken = fakeSources(() => text("not json"));
		assert.deepEqual(await wikipedia.search(stageQuery(), broken.ctx, broken.onError), []);
		assert.equal(broken.errors.length, 1);
	});

	it("skips a summary that fails instead of failing the search", async () => {
		const fake = fakeSources((url, call) => (url.pathname.endsWith("/Vector_space") ? text("gone", 404) : route(url, call)));
		const found = await wikipedia.search(stageQuery(), fake.ctx, fake.onError);
		assert.deepEqual(found.map((c) => c.title), ["Basis (linear algebra)"]);
	});

	it("answers a repeated search from the cache", async () => {
		const fake = fakeSources(route);
		const first = await wikipedia.search(stageQuery(), fake.ctx);
		const count = fake.calls.length;
		assert.deepEqual(await wikipedia.search(stageQuery(), fake.ctx), first);
		assert.equal(fake.calls.length, count);
	});
});

describe("wikipedia.resolve", () => {
	it("confirms a reading by exact-ish title", async () => {
		const fake = fakeSources(route);
		const hit = await wikipedia.resolve?.({ kind: "reading", title: "vector space" }, stageQuery(), fake.ctx);
		assert.equal(hit?.url, "https://en.wikipedia.org/wiki/Vector_space");
		assert.equal(hit?.canon, true);
		assert.equal(fake.calls[0]?.url.searchParams.get("srsearch"), "vector space");
	});

	it("returns null when no result title matches", async () => {
		const fake = fakeSources(route);
		assert.equal(await wikipedia.resolve?.({ kind: "reading", title: "Tensor calculus" }, stageQuery(), fake.ctx), null);
		const down = fakeSources(() => text("", 500));
		assert.equal(await wikipedia.resolve?.({ kind: "reading", title: "Vector space" }, stageQuery(), down.ctx), null);
	});

	it("resolves readings only", () => {
		assert.deepEqual(wikipedia.resolves, ["reading"]);
	});
});
