/**
 * Semantic Scholar adapter: graph paper search with a fixed field list,
 * kind paper, citations and influential citations as signals, tldr as the
 * description; resolve by title.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { semanticscholar } from "../src/agent/learn/sources/semanticscholar.ts";
import { fakeSources, json, stageQuery, text, type Route } from "./learn-sources-fakes.ts";

const PAPERS = [
	{
		paperId: "abc123",
		title: "A Synthetic Survey of Vector Spaces",
		year: 2019,
		url: "https://www.semanticscholar.org/paper/abc123",
		citationCount: 950,
		influentialCitationCount: 80,
		tldr: { text: "Surveys vector spaces for tests." },
		authors: [{ name: "Ada Example" }, { name: "Bo Sample" }, { name: "Cy Third" }],
		openAccessPdf: { url: "https://pdf.example.test/abc123.pdf" },
	},
	{ paperId: "nourl", title: "Missing URL" },
];

const route: Route = () => json({ total: 2, offset: 0, data: PAPERS });

describe("semanticscholar.search", () => {
	it("calls paper/search with the fixed fields", async () => {
		const fake = fakeSources(route);
		await semanticscholar.search(stageQuery({ limit: 7 }), fake.ctx);
		const url = fake.calls[0]?.url;
		assert.equal(url?.origin + (url?.pathname ?? ""), "https://api.semanticscholar.org/graph/v1/paper/search");
		assert.equal(url?.searchParams.get("query"), "vector spaces introduction");
		assert.equal(
			url?.searchParams.get("fields"),
			"title,year,url,citationCount,influentialCitationCount,tldr,authors,openAccessPdf",
		);
		assert.equal(url?.searchParams.get("limit"), "7");
	});

	it("parses papers", async () => {
		const fake = fakeSources(route);
		assert.deepEqual(await semanticscholar.search(stageQuery(), fake.ctx), [
			{
				source: "semanticscholar",
				kind: "paper",
				title: "A Synthetic Survey of Vector Spaces",
				url: "https://www.semanticscholar.org/paper/abc123",
				by: "Ada Example, Bo Sample et al.",
				description: "Surveys vector spaces for tests.",
				year: 2019,
				signals: { citations: 950, influential: 80 },
			},
		]);
	});

	it("returns [] and a reason on failure", async () => {
		const fake = fakeSources(() => text("", 429));
		assert.deepEqual(await semanticscholar.search(stageQuery(), fake.ctx, fake.onError), []);
		assert.deepEqual(fake.errors, ["Semantic Scholar is limiting requests right now; try again later."]);
	});

	it("answers a repeated search from the cache", async () => {
		const fake = fakeSources(route);
		await semanticscholar.search(stageQuery(), fake.ctx);
		await semanticscholar.search(stageQuery(), fake.ctx);
		assert.equal(fake.calls.length, 1);
	});
});

describe("semanticscholar.resolve", () => {
	it("confirms a paper by title", async () => {
		const fake = fakeSources(route);
		const hit = await semanticscholar.resolve?.({ kind: "paper", title: "A synthetic survey of vector spaces" }, stageQuery(), fake.ctx);
		assert.equal(hit?.url, "https://www.semanticscholar.org/paper/abc123");
		assert.equal(hit?.canon, true);
		assert.equal(fake.calls[0]?.url.searchParams.get("query"), "A synthetic survey of vector spaces");
	});

	it("returns null for an unknown title or a failure", async () => {
		const fake = fakeSources(route);
		assert.equal(await semanticscholar.resolve?.({ kind: "paper", title: "Attention Is All You Need" }, stageQuery(), fake.ctx), null);
		const down = fakeSources(() => text("", 500));
		assert.equal(await semanticscholar.resolve?.({ kind: "paper", title: "A Synthetic Survey of Vector Spaces" }, stageQuery(), down.ctx), null);
	});
});
