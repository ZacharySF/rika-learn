/**
 * Depth sizing (research/07 §4.1): five named depths, each with its time
 * span, size budget, which sources it uses, and whether stages fill
 * lazily (Ultra, Ultraviolet build tracks + stages and fill only the
 * first track up front).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	DEFAULT_DEPTH,
	DEPTHS,
	depthSpec,
	depthSources,
	eagerStageIds,
	clampToDepth,
} from "../src/core/learn/depth.ts";
import { DEPTH_IDS } from "../src/core/learn/contracts.ts";

describe("DEPTHS", () => {
	it("has the five steps in order, Normal first and default", () => {
		assert.deepEqual(DEPTHS.map((d) => d.id), [...DEPTH_IDS]);
		assert.deepEqual(DEPTHS.map((d) => d.label), ["Normal", "High", "Super", "Ultra", "Ultraviolet"]);
		assert.equal(DEFAULT_DEPTH, "normal");
	});

	it("shows a plain time span for each step", () => {
		assert.deepEqual(DEPTHS.map((d) => d.span), [
			"a couple of hours",
			"a few hours",
			"a couple of weeks",
			"a semester",
			"semesters to years",
		]);
	});

	it("sizes grow with depth (hours, stages)", () => {
		for (let i = 1; i < DEPTHS.length; i++) {
			const prev = DEPTHS[i - 1]!;
			const cur = DEPTHS[i]!;
			assert.ok(cur.hours.max > prev.hours.max, `${cur.id} hours grow`);
			assert.ok(cur.stages.max >= prev.stages.max, `${cur.id} stages grow`);
		}
	});

	it("matches the research budget for Normal and High", () => {
		const normal = depthSpec("normal");
		assert.deepEqual(normal.stages, { min: 3, max: 5 });
		assert.deepEqual(normal.topics, { min: 8, max: 15 });
		assert.equal(normal.tracks, null);
		assert.equal(normal.lazy, false);
		assert.equal(normal.readings, 1);
		const high = depthSpec("high");
		assert.deepEqual(high.stages, { min: 5, max: 7 });
		assert.deepEqual(high.topics, { min: 15, max: 30 });
		assert.equal(high.readings, 2);
	});

	it("Ultra and Ultraviolet have tracks and fill lazily", () => {
		for (const id of ["ultra", "ultraviolet"] as const) {
			const spec = depthSpec(id);
			assert.ok(spec.tracks, `${id} has tracks`);
			assert.equal(spec.lazy, true);
		}
		assert.deepEqual(depthSpec("ultraviolet").tracks, { min: 4, max: 8 });
		assert.deepEqual(depthSpec("ultraviolet").stages, { min: 20, max: 48 });
		assert.deepEqual(depthSpec("ultra").stages, { min: 12, max: 16 });
	});

	it("uses long videos only from Super up", () => {
		assert.equal(depthSpec("normal").videoDuration, "medium");
		assert.equal(depthSpec("high").videoDuration, "medium");
		assert.equal(depthSpec("super").videoDuration, "any");
	});
});

describe("depthSources", () => {
	it("Normal and High skip books, awesome-lists and papers", () => {
		for (const id of ["normal", "high"] as const) {
			const sources = depthSources(id, false);
			assert.ok(sources.includes("youtube"));
			assert.ok(sources.includes("wikipedia"));
			assert.ok(!sources.includes("openlibrary"));
			assert.ok(!sources.includes("awesome"));
			assert.ok(!sources.includes("arxiv"));
		}
	});

	it("Super adds books and awesome-lists; papers only for research topics", () => {
		assert.ok(depthSources("super", false).includes("openlibrary"));
		assert.ok(depthSources("super", false).includes("awesome"));
		assert.ok(!depthSources("super", false).includes("arxiv"));
		assert.ok(depthSources("super", true).includes("arxiv"));
		assert.ok(depthSources("super", true).includes("semanticscholar"));
	});

	it("Ultra adds papers for every topic", () => {
		assert.ok(depthSources("ultra", false).includes("arxiv"));
		assert.ok(depthSources("ultraviolet", false).includes("semanticscholar"));
	});
});

describe("eagerStageIds (lazy expansion)", () => {
	const stages = [
		{ id: "s1", trackId: "t1" },
		{ id: "s2", trackId: "t1" },
		{ id: "s3", trackId: "t2" },
		{ id: "s4", trackId: "t3" },
	];
	const tracks = [{ id: "t1" }, { id: "t2" }, { id: "t3" }];

	it("fills every stage for non-lazy depths", () => {
		assert.deepEqual(eagerStageIds("super", tracks, stages), ["s1", "s2", "s3", "s4"]);
	});

	it("fills only the first track for Ultra and Ultraviolet", () => {
		assert.deepEqual(eagerStageIds("ultra", tracks, stages), ["s1", "s2"]);
		assert.deepEqual(eagerStageIds("ultraviolet", tracks, stages), ["s1", "s2"]);
	});

	it("falls back to the first stage's track when the track list is empty", () => {
		assert.deepEqual(eagerStageIds("ultra", [], stages), ["s1", "s2"]);
	});
});

describe("clampToDepth", () => {
	it("caps stage and per-stage topic counts to the depth", () => {
		const spec = depthSpec("normal");
		assert.equal(clampToDepth("normal").maxStages, spec.stages.max);
		assert.ok(clampToDepth("normal").maxTopicsPerStage >= Math.ceil(spec.topics.max / spec.stages.max));
		assert.equal(clampToDepth("ultraviolet").maxStages, 48);
	});
});
