/**
 * freeCodeCamp adapter: robots.txt-checked sitemap index → post sitemaps,
 * slug words matched against the query, titles from slugs, the sitemap
 * cached for 7 days.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { freecodecamp, titleFromSlug } from "../src/agent/learn/sources/freecodecamp.ts";
import { DAY, fakeSources, notFound, stageQuery, text, type Route } from "./learn-sources-fakes.ts";

const INDEX = `<?xml version="1.0" encoding="utf-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>https://www.freecodecamp.org/news/sitemap-pages.xml</loc></sitemap>
  <sitemap><loc>https://www.freecodecamp.org/news/sitemap-posts.xml</loc><lastmod>2026-11-10T16:01:58.435Z</lastmod></sitemap>
  <sitemap><loc>https://elsewhere.example.test/news/sitemap-posts.xml</loc></sitemap>
  <sitemap><loc>https://www.freecodecamp.org/news/sitemap-tags.xml</loc></sitemap>
</sitemapindex>`;

const POSTS = `<?xml version="1.0" encoding="utf-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://www.freecodecamp.org/news/rust-ownership-explained/</loc><lastmod>2026-01-01T00:00:00Z</lastmod></url>
  <url><loc>https://www.freecodecamp.org/news/build-a-cli-in-rust-ownership-projects/</loc><lastmod>2026-03-01T00:00:00Z</lastmod></url>
  <url><loc>https://www.freecodecamp.org/news/learn-rust-for-beginners/</loc><lastmod>2025-01-01T00:00:00Z</lastmod></url>
  <url><loc>https://www.freecodecamp.org/news/how-css-grid-works/</loc><lastmod>2026-02-01T00:00:00Z</lastmod></url>
  <url><loc>https://elsewhere.example.test/news/rust-ownership-elsewhere/</loc></url>
</urlset>`;

function route(robots = "User-Agent: *\nAllow: /\n"): Route {
	return (url) => {
		if (url.host !== "www.freecodecamp.org") return notFound();
		if (url.pathname === "/robots.txt") return text(robots);
		if (url.pathname === "/news/sitemap.xml") return text(INDEX, 200, "application/xml");
		if (url.pathname === "/news/sitemap-posts.xml") return text(POSTS, 200, "application/xml");
		return notFound();
	};
}

const rust = stageQuery({ topic: "rust", query: "rust ownership" });

describe("titleFromSlug", () => {
	it("turns a slug into a sentence-case title", () => {
		assert.equal(titleFromSlug("rust-ownership-explained"), "Rust ownership explained");
	});
});

describe("freecodecamp.search", () => {
	it("checks robots.txt, reads the index, then only freeCodeCamp post sitemaps", async () => {
		const fake = fakeSources(route());
		await freecodecamp.search(rust, fake.ctx);
		assert.deepEqual(
			fake.calls.map((c) => c.url.href),
			[
				"https://www.freecodecamp.org/robots.txt",
				"https://www.freecodecamp.org/news/sitemap.xml",
				"https://www.freecodecamp.org/news/sitemap-posts.xml",
			],
		);
	});

	it("matches slug words, ranks by overlap then recency, titles from slugs", async () => {
		const fake = fakeSources(route());
		const found = await freecodecamp.search(rust, fake.ctx);
		assert.deepEqual(found, [
			{
				source: "freecodecamp",
				kind: "exercise",
				title: "Build a cli in rust ownership projects",
				url: "https://www.freecodecamp.org/news/build-a-cli-in-rust-ownership-projects/",
				by: "freeCodeCamp",
			},
			{
				source: "freecodecamp",
				kind: "reading",
				title: "Rust ownership explained",
				url: "https://www.freecodecamp.org/news/rust-ownership-explained/",
				by: "freeCodeCamp",
			},
		]);
	});

	it("needs one matching word for a one-word query", async () => {
		const fake = fakeSources(route());
		const found = await freecodecamp.search(stageQuery({ query: "rust" }), fake.ctx);
		assert.equal(found.length, 3);
	});

	it("reuses the sitemap for 7 days, then fetches it again", async () => {
		const fake = fakeSources(route());
		await freecodecamp.search(rust, fake.ctx);
		await freecodecamp.search(stageQuery({ query: "css grid" }), fake.ctx);
		assert.equal(fake.calls.length, 3, "second search: no requests");
		fake.clock.now += 7 * DAY + 1;
		await freecodecamp.search(rust, fake.ctx);
		assert.equal(fake.calls.length, 6, "robots + index + posts again");
	});

	it("fetches nothing more when robots.txt disallows the sitemap", async () => {
		const fake = fakeSources(route("User-agent: *\nDisallow: /news/\n"));
		assert.deepEqual(await freecodecamp.search(rust, fake.ctx, fake.onError), []);
		assert.equal(fake.calls.length, 1);
		assert.deepEqual(fake.errors, ["freeCodeCamp's robots.txt does not allow reading its article list."]);
	});

	it("returns [] and a reason on failure", async () => {
		const fake = fakeSources((url) => (url.pathname === "/robots.txt" ? text("") : text("", 500)));
		assert.deepEqual(await freecodecamp.search(rust, fake.ctx, fake.onError), []);
		assert.deepEqual(fake.errors, ["freeCodeCamp answered with an error (HTTP 500)."]);
	});

	it("has no resolve", () => {
		assert.equal(freecodecamp.resolve, undefined);
	});
});
