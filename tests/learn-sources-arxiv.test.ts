/**
 * arXiv adapter: the export API's Atom feed parsed without a DOM, kind
 * paper, at least 3 s between requests to export.arxiv.org.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { arxiv, parseArxivFeed } from "../src/agent/learn/sources/arxiv.ts";
import { fakeSources, stageQuery, text, type Route } from "./learn-sources-fakes.ts";

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <title type="html">ArXiv Query: synthetic</title>
  <entry>
    <id>http://arxiv.org/abs/2401.00001v2</id>
    <published>2024-01-02T00:00:00Z</published>
    <title>A Synthetic Survey of
      Vector Spaces &amp; Bases</title>
    <summary>  We survey vector spaces
      for <b>tests</b>.  </summary>
    <author><name>Ada Example</name></author>
    <author><name>Bo Sample</name></author>
    <author><name>Cy Third</name></author>
    <link href="http://arxiv.org/abs/2401.00001v2" rel="alternate" type="text/html"/>
    <link title="pdf" href="http://arxiv.org/pdf/2401.00001v2" rel="related" type="application/pdf"/>
  </entry>
  <entry>
    <id>http://arxiv.org/api/errors#incorrect_id_format</id>
    <title>Error</title>
    <summary>incorrect id format</summary>
  </entry>
</feed>`;

const route: Route = () => text(FEED, 200, "application/atom+xml");

describe("parseArxivFeed", () => {
	it("reads entries, decodes entities, collapses whitespace, upgrades to https", () => {
		assert.deepEqual(parseArxivFeed(FEED), [
			{
				source: "arxiv",
				kind: "paper",
				title: "A Synthetic Survey of Vector Spaces & Bases",
				url: "https://arxiv.org/abs/2401.00001v2",
				by: "Ada Example, Bo Sample et al.",
				description: "We survey vector spaces for tests.",
				year: 2024,
				signals: { publishedAt: "2024-01-02T00:00:00Z" },
			},
		]);
	});

	it("returns [] for a feed with no entries", () => {
		assert.deepEqual(parseArxivFeed("<feed></feed>"), []);
	});
});

describe("arxiv.search", () => {
	it("queries the export API with every word and a result cap", async () => {
		const fake = fakeSources(route);
		await arxiv.search(stageQuery({ limit: 4 }), fake.ctx);
		const url = fake.calls[0]?.url;
		assert.equal(url?.origin + (url?.pathname ?? ""), "https://export.arxiv.org/api/query");
		assert.equal(url?.searchParams.get("search_query"), "all:vector AND all:spaces AND all:introduction");
		assert.equal(url?.searchParams.get("max_results"), "4");
		assert.equal(url?.searchParams.get("sortBy"), "relevance");
	});

	it("parses the feed into candidates", async () => {
		const fake = fakeSources(route);
		const found = await arxiv.search(stageQuery(), fake.ctx);
		assert.equal(found.length, 1);
		assert.equal(found[0]?.url, "https://arxiv.org/abs/2401.00001v2");
	});

	it("returns [] and a reason on failure", async () => {
		const fake = fakeSources(() => text("", 503));
		assert.deepEqual(await arxiv.search(stageQuery(), fake.ctx, fake.onError), []);
		assert.deepEqual(fake.errors, ["arXiv answered with an error (HTTP 503)."]);
		const notAtom = fakeSources(() => text("<html>maintenance</html>"));
		assert.deepEqual(await arxiv.search(stageQuery(), notAtom.ctx, notAtom.onError), []);
		assert.deepEqual(notAtom.errors, ["arXiv sent a reply that could not be read."]);
	});

	it("answers a repeated search from the cache", async () => {
		const fake = fakeSources(route);
		await arxiv.search(stageQuery(), fake.ctx);
		await arxiv.search(stageQuery(), fake.ctx);
		assert.equal(fake.calls.length, 1);
	});

	it("waits at least 3 s between two requests", async () => {
		const fake = fakeSources(route);
		const started = Date.now();
		await arxiv.search(stageQuery({ query: "first" }), fake.ctx);
		await arxiv.search(stageQuery({ query: "second" }), fake.ctx);
		assert.equal(fake.calls.length, 2);
		assert.ok(Date.now() - started >= 2950, "paced by the per-host interval");
	});
});

describe("arxiv.resolve", () => {
	it("looks a paper up by exact title phrase", async () => {
		const fake = fakeSources(route);
		const hit = await arxiv.resolve?.({ kind: "paper", title: "A synthetic survey of vector spaces & bases" }, stageQuery(), fake.ctx);
		assert.equal(hit?.canon, true);
		assert.equal(hit?.url, "https://arxiv.org/abs/2401.00001v2");
		assert.equal(fake.calls[0]?.url.searchParams.get("search_query"), 'ti:"A synthetic survey of vector spaces bases"');
	});

	it("returns null when the title does not match", async () => {
		const fake = fakeSources(route);
		assert.equal(await arxiv.resolve?.({ kind: "paper", title: "Deep Residual Learning" }, stageQuery(), fake.ctx), null);
	});
});
