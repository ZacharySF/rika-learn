/**
 * Open Library adapter: search.json with a fixed field list, kind book,
 * work links built from the API's work key, resolve by title + author.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { openlibrary } from "../src/agent/learn/sources/openlibrary.ts";
import { fakeSources, json, stageQuery, text, type Route } from "./learn-sources-fakes.ts";

const DOCS = [
	{ key: "/works/OL100W", title: "Introduction to Linear Algebra", author_name: ["Gilbert Strang"], first_publish_year: 1993, edition_count: 12 },
	{ key: "/works/OL200W", title: "Linear Algebra Done Right", author_name: ["Sheldon Axler", "Second Author", "Third Author"], first_publish_year: 1995, edition_count: 9 },
	{ key: "/books/OL5M", title: "An edition, not a work", author_name: ["Someone"] },
	{ key: "/works/OL300W", author_name: ["No Title"] },
];

const route: Route = () => json({ numFound: DOCS.length, docs: DOCS });

describe("openlibrary.search", () => {
	it("calls search.json with the fixed fields and the limit", async () => {
		const fake = fakeSources(route);
		await openlibrary.search(stageQuery({ limit: 4 }), fake.ctx);
		const url = fake.calls[0]?.url;
		assert.equal(url?.origin + (url?.pathname ?? ""), "https://openlibrary.org/search.json");
		assert.equal(url?.searchParams.get("q"), "vector spaces introduction");
		assert.equal(url?.searchParams.get("fields"), "key,title,author_name,first_publish_year,edition_count");
		assert.equal(url?.searchParams.get("limit"), "4");
		assert.equal(fake.calls[0]?.headers["user-agent"], fake.ctx.userAgent);
	});

	it("parses works into book candidates", async () => {
		const fake = fakeSources(route);
		const found = await openlibrary.search(stageQuery(), fake.ctx);
		assert.equal(found.length, 2, "non-work keys and untitled docs are dropped");
		assert.deepEqual(found[0], {
			source: "openlibrary",
			kind: "book",
			title: "Introduction to Linear Algebra",
			url: "https://openlibrary.org/works/OL100W",
			by: "Gilbert Strang",
			year: 1993,
			signals: { editions: 12 },
		});
		assert.equal(found[1]?.by, "Sheldon Axler, Second Author");
	});

	it("returns [] and a reason on failure", async () => {
		const fake = fakeSources(() => text("", 500));
		assert.deepEqual(await openlibrary.search(stageQuery(), fake.ctx, fake.onError), []);
		assert.deepEqual(fake.errors, ["Open Library answered with an error (HTTP 500)."]);
		const offline = fakeSources(() => {
			throw new TypeError("fetch failed");
		});
		assert.deepEqual(await openlibrary.search(stageQuery(), offline.ctx, offline.onError), []);
		assert.deepEqual(offline.errors, ["Open Library could not be reached."]);
	});

	it("answers a repeated search from the cache", async () => {
		const fake = fakeSources(route);
		await openlibrary.search(stageQuery(), fake.ctx);
		await openlibrary.search(stageQuery(), fake.ctx);
		assert.equal(fake.calls.length, 1);
	});
});

describe("openlibrary.resolve", () => {
	it("looks up by title and author and confirms the matching work", async () => {
		const fake = fakeSources(route);
		const hit = await openlibrary.resolve?.({ kind: "book", title: "Introduction to Linear Algebra", by: "Gilbert Strang" }, stageQuery(), fake.ctx);
		assert.equal(hit?.url, "https://openlibrary.org/works/OL100W");
		assert.equal(hit?.canon, true);
		const url = fake.calls[0]?.url;
		assert.equal(url?.searchParams.get("title"), "Introduction to Linear Algebra");
		assert.equal(url?.searchParams.get("author"), "Gilbert Strang");
	});

	it("rejects a title match by the wrong author, and an unknown title", async () => {
		const fake = fakeSources(route);
		assert.equal(await openlibrary.resolve?.({ kind: "book", title: "Introduction to Linear Algebra", by: "Sheldon Axler" }, stageQuery(), fake.ctx), null);
		assert.equal(await openlibrary.resolve?.({ kind: "book", title: "Calculus Made Easy" }, stageQuery(), fake.ctx), null);
	});

	it("resolves books", () => {
		assert.deepEqual(openlibrary.resolves, ["book"]);
	});
});
