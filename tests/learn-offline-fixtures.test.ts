/**
 * The offline fixture network (LH_LEARN_OFFLINE_DEMO=1): every source
 * endpoint answered with synthetic, deterministic, query-shaped data, so
 * the whole pipeline (search, resolve, robots, sitemaps, YouTube's two
 * calls) runs with no network. Unknown URLs are 404.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SOURCE_IDS } from "../src/core/learn/contracts.ts";
import { SOURCE_ADAPTERS, adapterFor } from "../src/agent/learn/sources/index.ts";
import { OFFLINE_DOCS_HOSTS, offlineFetch } from "../src/agent/learn/sources/offline-fixtures.ts";
import type { SourceContext } from "../src/agent/learn/sources/types.ts";
import { memoryCache, stageQuery } from "./learn-sources-fakes.ts";

function offlineContext(): SourceContext {
	const now = () => Date.UTC(2026, 10, 13);
	return {
		fetch: offlineFetch,
		keys: { youtube: "offline-demo", brave: "offline-demo" },
		cache: memoryCache(now),
		now,
		userAgent: "rika-learn-offline/1.0",
	};
}

const rust = stageQuery({ topic: "rust", stageTitle: "Ownership", query: "rust ownership", limit: 5 });

describe("SOURCE_ADAPTERS", () => {
	it("has one adapter per source id", () => {
		assert.deepEqual(Object.keys(SOURCE_ADAPTERS).sort(), [...SOURCE_IDS].sort());
		for (const id of SOURCE_IDS) assert.equal(adapterFor(id).id, id);
	});
});

describe("offlineFetch", () => {
	it("answers unknown URLs with 404", async () => {
		assert.equal((await offlineFetch("https://unknown.example.test/anything")).status, 404);
		assert.equal((await offlineFetch(new URL("https://api.github.com/not-search"))).status, 404);
	});

	it("gives every searching source query-shaped results, with no errors", async () => {
		const ctx = offlineContext();
		const errors: string[] = [];
		const results = await Promise.all(
			SOURCE_IDS.filter((id) => id !== "docs" && id !== "freecodecamp").map(async (id) => ({
				id,
				found: await adapterFor(id).search(rust, ctx, (reason) => errors.push(`${id}: ${reason}`)),
			})),
		);
		assert.deepEqual(errors, []);
		for (const { id, found } of results) {
			assert.ok(found.length > 0, `${id} found something`);
			assert.ok(
				found.some((c) => /rust/i.test(c.title)),
				`${id} titles mention the query: ${found.map((c) => c.title).join(" | ")}`,
			);
			for (const c of found) {
				assert.equal(c.source, id);
				assert.match(c.url, /^https:\/\//);
			}
		}
	});

	it("gives YouTube embeddable videos with ids and durations that fit a medium search", async () => {
		const found = await adapterFor("youtube").search(rust, offlineContext());
		assert.ok(found.length >= 3);
		for (const video of found) {
			assert.match(video.videoId ?? "", /^[A-Za-z0-9_-]{11}$/);
			assert.ok(video.minutes !== undefined && video.minutes >= 4 && video.minutes <= 20, `${video.minutes} min`);
			assert.equal(video.signals?.embeddable, true);
		}
	});

	it("serves robots.txt and the freeCodeCamp sitemap so a programming topic matches", async () => {
		const robots = await offlineFetch("https://www.freecodecamp.org/robots.txt");
		assert.match(await robots.text(), /Allow: \//);
		const found = await adapterFor("freecodecamp").search(stageQuery({ query: "rust" }), offlineContext());
		assert.ok(found.length > 0);
		assert.ok(found.every((c) => c.url.startsWith("https://www.freecodecamp.org/news/")));
	});

	it("confirms the kinds of resources a roadmap names", async () => {
		const ctx = offlineContext();
		const book = await adapterFor("openlibrary").resolve?.({ kind: "book", title: "The Rust Programming Language", by: "Steve Klabnik" }, rust, ctx);
		assert.equal(book?.title, "The Rust Programming Language");
		const paper = await adapterFor("semanticscholar").resolve?.({ kind: "paper", title: "Ownership Types for Safe Programming" }, rust, ctx);
		assert.equal(paper?.canon, true);
		const arxivPaper = await adapterFor("arxiv").resolve?.({ kind: "paper", title: "Ownership Types for Safe Programming" }, rust, ctx);
		assert.equal(arxivPaper?.canon, true);
		const course = await adapterFor("mitlearn").resolve?.({ kind: "course", title: "Rust Programming" }, rust, ctx);
		assert.equal(course?.kind, "course");
		const article = await adapterFor("wikipedia").resolve?.({ kind: "reading", title: "Rust (programming language)" }, rust, ctx);
		assert.equal(article?.canon, true);
		const host = OFFLINE_DOCS_HOSTS[0];
		const page = await adapterFor("docs").resolve?.({ kind: "docs", title: "The Book", url: `https://${host}/book/` }, rust, ctx);
		assert.equal(page?.url, `https://${host}/book/`);
		assert.ok(OFFLINE_DOCS_HOSTS.includes("doc.rust-lang.org"));
		const unknown = await adapterFor("docs").resolve?.({ kind: "docs", title: "Nope", url: "https://unknown.example.test/docs/" }, rust, ctx);
		assert.equal(unknown, null);
	});

	it("is deterministic: the same query gives the same results", async () => {
		const a = await adapterFor("youtube").search(rust, offlineContext());
		const b = await adapterFor("youtube").search(rust, offlineContext());
		assert.deepEqual(a, b);
		const other = await adapterFor("youtube").search({ ...rust, query: "rust lifetimes" }, offlineContext());
		assert.notDeepEqual(
			other.map((v) => v.videoId),
			a.map((v) => v.videoId),
		);
	});

	it("needs a key for the keyed APIs, like the real ones", async () => {
		const response = await offlineFetch("https://www.googleapis.com/youtube/v3/search?part=snippet&q=rust");
		assert.equal(response.status, 403);
	});
});
