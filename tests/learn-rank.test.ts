/**
 * Ranking and dedupe (research/07 §4.6–4.7): canonical URLs, merging the
 * same resource from several sources, matching model-named resources
 * against real results, and choosing one best video + one or two readings
 * per stage with the rest under "More".
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	assignAcrossStages,
	canonicalUrl,
	dedupeCandidates,
	matchCanon,
	rankStage,
	titleSimilarity,
	type RankContext,
} from "../src/core/learn/rank.ts";
import type { Candidate } from "../src/core/learn/contracts.ts";

describe("canonicalUrl", () => {
	it("normalizes hosts, tracking params, fragments and trailing slashes", () => {
		assert.equal(canonicalUrl("https://WWW.Example.com/Path/?utm_source=x&b=2&a=1&fbclid=z#frag"), "https://example.com/Path?a=1&b=2");
		assert.equal(canonicalUrl("http://example.com/"), "http://example.com");
	});

	it("rewrites every YouTube form to watch?v=", () => {
		const want = "https://youtube.com/watch?v=abc123DEF45";
		assert.equal(canonicalUrl("https://youtu.be/abc123DEF45?t=30"), want);
		assert.equal(canonicalUrl("https://m.youtube.com/watch?v=abc123DEF45&feature=share"), want);
		assert.equal(canonicalUrl("https://www.youtube-nocookie.com/embed/abc123DEF45"), want);
		assert.equal(canonicalUrl("https://www.youtube.com/watch?v=abc123DEF45&list=PL1"), want);
	});

	it("returns the input for non-URLs", () => {
		assert.equal(canonicalUrl("not a url"), "not a url");
	});
});

function cand(partial: Partial<Candidate> & Pick<Candidate, "title" | "url">): Candidate {
	return { source: "wikipedia", kind: "reading", ...partial };
}

describe("dedupeCandidates", () => {
	it("merges the same canonical URL, keeping the canon flag and filling gaps", () => {
		const out = dedupeCandidates([
			cand({ source: "mitlearn", kind: "video", title: "Lecture 1", url: "https://youtu.be/aaaaaaaaaaa" }),
			cand({ source: "youtube", kind: "video", title: "Lecture 1: Vectors", url: "https://www.youtube.com/watch?v=aaaaaaaaaaa", minutes: 40, canon: true }),
		]);
		assert.equal(out.length, 1);
		assert.equal(out[0]!.canon, true);
		assert.equal(out[0]!.minutes, 40);
	});

	it("collapses near-identical titles from the same channel", () => {
		const out = dedupeCandidates([
			cand({ source: "youtube", kind: "video", title: "Vectors explained part 1", by: "Chan", url: "https://youtu.be/bbbbbbbbbbb" }),
			cand({ source: "youtube", kind: "video", title: "Vectors explained, part 1!", by: "Chan", url: "https://youtu.be/ccccccccccc" }),
			cand({ source: "youtube", kind: "video", title: "Vectors explained part 1", by: "Other", url: "https://youtu.be/ddddddddddd" }),
		]);
		assert.equal(out.length, 2);
	});
});

describe("titleSimilarity / matchCanon", () => {
	it("scores token overlap", () => {
		assert.equal(titleSimilarity("Essence of Linear Algebra", "essence of linear algebra"), 1);
		assert.ok(titleSimilarity("Essence of linear algebra", "Cooking pasta") < 0.2);
	});

	const pool = [
		cand({ source: "youtube", kind: "video", title: "Essence of linear algebra, chapter 1: Vectors", by: "3Blue1Brown", url: "https://youtu.be/fNk_zzaMoSs" }),
		cand({ source: "openlibrary", kind: "book", title: "Linear Algebra Done Right", by: "Sheldon Axler", url: "https://openlibrary.org/works/OL1W" }),
	];

	it("matches a named resource against real results by title (and kind)", () => {
		const hit = matchCanon({ kind: "video", title: "Essence of Linear Algebra", by: "3Blue1Brown" }, pool);
		assert.equal(hit?.url, "https://youtu.be/fNk_zzaMoSs");
		assert.equal(hit?.canon, true);
		assert.equal(matchCanon({ kind: "book", title: "Linear algebra done right", by: "Axler" }, pool)?.source, "openlibrary");
	});

	it("returns null (the item is dropped) when nothing real matches", () => {
		assert.equal(matchCanon({ kind: "video", title: "Invented Course That Does Not Exist" }, pool), null);
		assert.equal(matchCanon({ kind: "paper", title: "Linear Algebra Done Right" }, pool), null, "kind must fit");
	});
});

const ctx: RankContext = {
	stage: {
		title: "Vectors",
		query: "vectors linear algebra introduction",
		topics: [{ title: "What a vector is", objective: "Explain vectors as arrows.", minutes: 15 }],
	},
	depth: "normal",
	volatility: "evergreen",
	now: Date.UTC(2026, 10, 13),
};

describe("rankStage", () => {
	const pool: Candidate[] = [
		cand({ source: "youtube", kind: "video", title: "Vectors | Essence of linear algebra", by: "3Blue1Brown", url: "https://youtu.be/v1", minutes: 10, signals: { views: 9_000_000, captions: true } }),
		cand({ source: "youtube", kind: "video", title: "Vectors in 60 seconds #shorts", by: "Someone", url: "https://youtu.be/v2", minutes: 1, signals: { views: 50_000 } }),
		cand({ source: "youtube", kind: "video", title: "Vectors intro", by: "Tiny channel", url: "https://youtu.be/v3", minutes: 12, signals: { views: 120 } }),
		cand({ source: "youtube", kind: "video", title: "Linear algebra vectors full lecture", by: "Uni", url: "https://youtu.be/v4", minutes: 170, signals: { views: 80_000 } }),
		cand({ source: "wikipedia", kind: "reading", title: "Euclidean vector", url: "https://en.wikipedia.org/wiki/Euclidean_vector" }),
		cand({ source: "freecodecamp", kind: "exercise", title: "Linear algebra vectors tutorial", url: "https://www.freecodecamp.org/news/vectors" }),
		cand({ source: "hackernews", kind: "discussion", title: "Ask HN: How to learn linear algebra", url: "https://news.ycombinator.com/item?id=1", signals: { points: 300 } }),
		cand({ source: "wikipedia", kind: "reading", title: "Cooking pasta", url: "https://en.wikipedia.org/wiki/Pasta" }),
	];

	it("picks one best video first, then readings (Normal: one)", () => {
		const out = rankStage(pool, ctx);
		assert.equal(out.picks[0]!.kind, "video");
		assert.equal(out.picks[0]!.url, "https://youtu.be/v1");
		assert.equal(out.picks.length, 2);
		assert.notEqual(out.picks[1]!.kind, "video");
		assert.notEqual(out.picks[1]!.kind, "discussion");
	});

	it("High and deeper show two readings or exercises", () => {
		const out = rankStage(pool, { ...ctx, depth: "high" });
		assert.equal(out.picks.length, 3);
	});

	it("puts the ranked rest under More and drops Shorts, tiny channels and unrelated pages", () => {
		const out = rankStage(pool, ctx);
		const urls = [...out.picks, ...out.more].map((r) => r.url);
		assert.ok(!urls.includes("https://youtu.be/v2"), "#shorts dropped");
		assert.ok(!urls.includes("https://youtu.be/v3"), "under 1k views and not named dropped");
		assert.ok(!urls.includes("https://en.wikipedia.org/wiki/Pasta"), "irrelevant dropped");
		assert.ok(out.more.some((r) => r.kind === "discussion"), "discussions go under More");
		for (let i = 1; i < out.more.length; i++) assert.ok(out.more[i - 1]!.score >= out.more[i]!.score, "More is sorted");
	});

	it("named (canon) resources outrank search hits and say so", () => {
		const out = rankStage([...pool, cand({ source: "openlibrary", kind: "book", title: "Vectors primer", url: "https://openlibrary.org/works/OL9W", canon: true })], ctx);
		assert.equal(out.picks[1]!.url, "https://openlibrary.org/works/OL9W");
		assert.match(out.picks[1]!.reason, /Recommended for this stage/);
	});

	it("gives every pick a short plain reason", () => {
		for (const r of rankStage(pool, ctx).picks) {
			assert.ok(r.reason.length > 0);
			assert.ok(r.reason.split(/\s+/).length <= 12, r.reason);
		}
		const video = rankStage(pool, ctx).picks[0]!;
		assert.match(video.reason, /Right length/, "says why the length fits");
		assert.match(video.reason, /Has captions/);
		assert.match(video.reason, /Known teaching channel/);
		assert.doesNotMatch(video.reason, /3Blue1Brown|10 min/, "channel and minutes are already on the meta line");
	});

	it("prefers recent resources for fast-moving topics", () => {
		const recent = cand({ source: "wikipedia", kind: "reading", title: "Vectors linear algebra guide", url: "https://a.test/new", year: 2026 });
		const old = cand({ source: "wikipedia", kind: "reading", title: "Vectors linear algebra guide", url: "https://a.test/old", year: 2012 });
		const fast = rankStage([old, recent], { ...ctx, volatility: "fast" });
		assert.equal(fast.picks[0]!.url, "https://a.test/new");
	});

	it("handles an empty pool", () => {
		assert.deepEqual(rankStage([], ctx), { picks: [], more: [] });
	});
});

describe("assignAcrossStages", () => {
	it("a resource is a pick in at most one stage; later stages promote their next best", () => {
		const a = rankStage(
			[
				cand({ source: "youtube", kind: "video", title: "Vectors linear algebra", url: "https://youtu.be/same", minutes: 10, signals: { views: 1e6 } }),
				cand({ source: "wikipedia", kind: "reading", title: "Vectors", url: "https://w.test/v" }),
			],
			ctx,
		);
		const b = rankStage(
			[
				cand({ source: "youtube", kind: "video", title: "Vectors linear algebra", url: "https://youtu.be/same", minutes: 10, signals: { views: 1e6 } }),
				cand({ source: "youtube", kind: "video", title: "Vectors linear algebra two", url: "https://youtu.be/other", minutes: 12, signals: { views: 1e5 } }),
				cand({ source: "wikipedia", kind: "reading", title: "Vectors basics", url: "https://w.test/b" }),
			],
			ctx,
		);
		const [first, second] = assignAcrossStages([a, b], "normal");
		assert.equal(first!.picks[0]!.url, "https://youtu.be/same");
		assert.equal(second!.picks[0]!.url, "https://youtu.be/other");
		const repeat = second!.more.find((r) => r.url === "https://youtu.be/same");
		assert.ok(repeat, "the repeat moves to More");
		assert.match(repeat.reason, /also in stage 1/);
	});
});
