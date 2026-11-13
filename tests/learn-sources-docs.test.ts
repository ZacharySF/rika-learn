/**
 * Official docs adapter: the only place a model-written URL is ever
 * fetched, and only when robots.txt allows it, the URL is public http(s)
 * and the page answers 2xx (after redirects). search() is always [].
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { docs } from "../src/agent/learn/sources/docs.ts";
import { fakeSources, notFound, redirected, stageQuery, text, type Route } from "./learn-sources-fakes.ts";

const PAGE = "<!doctype html><html><head><title>The Synthetic Book &mdash; Docs</title></head><body>hi</body></html>";

const route: Route = (url) => {
	if (url.pathname === "/robots.txt") return text("User-agent: *\nDisallow: /private/\n");
	if (url.pathname === "/book/") return text(PAGE, 200, "text/html; charset=utf-8");
	if (url.pathname === "/old/") return redirected(PAGE, "https://docs.example.test/book/");
	if (url.pathname === "/manual.pdf") return text("%PDF-1.7", 200, "application/pdf");
	if (url.pathname === "/private/page") return text(PAGE, 200, "text/html");
	return notFound();
};

const item = (url: string) => ({ kind: "docs" as const, title: "Synthetic Book", url });

describe("docs.resolve", () => {
	it("checks robots.txt, fetches the page and keeps its <title>", async () => {
		const fake = fakeSources(route);
		const hit = await docs.resolve?.(item("https://docs.example.test/book/"), stageQuery(), fake.ctx);
		assert.deepEqual(hit, {
			source: "docs",
			kind: "docs",
			title: "The Synthetic Book — Docs",
			url: "https://docs.example.test/book/",
			by: "docs.example.test",
			canon: true,
		});
		assert.deepEqual(
			fake.calls.map((c) => c.url.pathname),
			["/robots.txt", "/book/"],
		);
	});

	it("keeps the final URL after a redirect", async () => {
		const fake = fakeSources(route);
		const hit = await docs.resolve?.(item("https://docs.example.test/old/"), stageQuery(), fake.ctx);
		assert.equal(hit?.url, "https://docs.example.test/book/");
	});

	it("refuses a robots-disallowed URL without fetching it", async () => {
		const fake = fakeSources(route);
		assert.equal(await docs.resolve?.(item("https://docs.example.test/private/page"), stageQuery(), fake.ctx), null);
		assert.deepEqual(
			fake.calls.map((c) => c.url.pathname),
			["/robots.txt"],
		);
	});

	it("refuses when robots.txt cannot be checked (5xx)", async () => {
		const fake = fakeSources((url) => (url.pathname === "/robots.txt" ? text("", 503) : route(url, { url, headers: {} })));
		assert.equal(await docs.resolve?.(item("https://docs.example.test/book/"), stageQuery(), fake.ctx), null);
		assert.equal(fake.calls.length, 1);
	});

	it("refuses a redirect into a robots-disallowed path", async () => {
		const fake = fakeSources((url, call) =>
			url.pathname === "/moved/" ? redirected(PAGE, "https://docs.example.test/private/page") : route(url, call),
		);
		assert.equal(await docs.resolve?.(item("https://docs.example.test/moved/"), stageQuery(), fake.ctx), null);
	});

	it("drops non-2xx pages", async () => {
		const fake = fakeSources(route);
		assert.equal(await docs.resolve?.(item("https://docs.example.test/missing/"), stageQuery(), fake.ctx), null);
	});

	it("refuses non-http(s), private and malformed URLs without any request", async () => {
		const fake = fakeSources(route);
		for (const url of ["file:///etc/passwd", "http://localhost:3000/x", "http://127.0.0.1/x", "http://10.0.0.8/", "http://[::1]/", "not a url"]) {
			assert.equal(await docs.resolve?.(item(url), stageQuery(), fake.ctx), null, url);
		}
		assert.equal(await docs.resolve?.({ kind: "docs", title: "No URL" }, stageQuery(), fake.ctx), null);
		assert.equal(await docs.resolve?.({ kind: "reading", title: "Wrong kind", url: "https://docs.example.test/book/" }, stageQuery(), fake.ctx), null);
		assert.equal(fake.calls.length, 0);
	});

	it("keeps a non-HTML docs page under the model's title without reading it", async () => {
		const fake = fakeSources(route);
		const hit = await docs.resolve?.(item("https://docs.example.test/manual.pdf"), stageQuery(), fake.ctx);
		assert.equal(hit?.title, "Synthetic Book");
	});

	it("answers a repeated check from the cache", async () => {
		const fake = fakeSources(route);
		await docs.resolve?.(item("https://docs.example.test/book/"), stageQuery(), fake.ctx);
		await docs.resolve?.(item("https://docs.example.test/book/"), stageQuery(), fake.ctx);
		assert.equal(fake.calls.length, 2);
	});

	it("returns null on a network failure", async () => {
		const fake = fakeSources((url) => {
			if (url.pathname === "/robots.txt") return text("");
			throw new TypeError("fetch failed");
		});
		assert.equal(await docs.resolve?.(item("https://docs.example.test/book/"), stageQuery(), fake.ctx), null);
	});
});

describe("docs.search", () => {
	it("returns [] without requests: docs come from the roadmap's named resources only", async () => {
		const fake = fakeSources(route);
		assert.deepEqual(await docs.search(stageQuery(), fake.ctx), []);
		assert.equal(fake.calls.length, 0);
		assert.deepEqual(docs.resolves, ["docs"]);
	});
});
