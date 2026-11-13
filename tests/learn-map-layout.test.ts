/**
 * Star-map layout (src/core/learn/map-layout.ts): the pure geometry behind
 * the Learn map. Pinned here because the map is the one view where a
 * regression is silent (stars stacked on each other, stage 1 not at the
 * start, a pending stage missing) and the component is only SSR-tested.
 * Synthetic roadmaps only.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DepthId, Roadmap, Stage, Topic, TopicState, Track } from "@/src/core/learn/contracts.ts";
import { layoutStarMap, type StarMapLayout } from "@/src/core/learn/map-layout.ts";

function topic(id: string, prereqs: string[] = [], state: TopicState = "todo", minutes = 30): Topic {
	return { id, title: `Topic ${id}`, objective: "Learn the thing.", minutes, prereqs, state };
}

function stage(id: string, topics: Topic[], extra: Partial<Stage> = {}): Stage {
	return {
		id,
		title: `Stage ${id}`,
		why: "Because it matters.",
		hours: 2,
		query: id,
		prereqs: [],
		canon: [],
		topics,
		fill: topics.length > 0 ? "filled" : "pending",
		resources: { picks: [], more: [] },
		...extra,
	};
}

function roadmap(stages: Stage[], depth: DepthId = "normal", tracks: Track[] = []): Roadmap {
	return {
		version: 1,
		id: "rm_test",
		topic: "synthetic",
		depth,
		createdAt: "2026-11-13T00:00:00.000Z",
		updatedAt: "2026-11-13T00:00:00.000Z",
		status: "ready",
		title: "Synthetic roadmap",
		volatility: "evergreen",
		research: false,
		hours: 6,
		priming: [],
		tracks,
		stages,
		model: { provider: "faux", id: "faux" },
		spend: { usd: 0, calls: 0 },
		youtubeSearches: 0,
	};
}

/** n stages × k topics; topic j depends on topic j-1 of the same stage, and
 *  the first topic of each stage on the last topic of the previous stage. */
function grid(n: number, k: number, opts: { pendingFrom?: number; tracks?: number; depth?: DepthId } = {}): Roadmap {
	const stages: Stage[] = [];
	const tracks: Track[] = [];
	const trackCount = opts.tracks ?? 0;
	for (let t = 0; t < trackCount; t++) tracks.push({ id: `t${t}`, title: `Track ${t}`, why: "Why." });
	for (let i = 0; i < n; i++) {
		const pending = opts.pendingFrom !== undefined && i >= opts.pendingFrom;
		const topics: Topic[] = [];
		if (!pending) {
			for (let j = 0; j < k; j++) {
				const prereqs = j > 0 ? [`s${i}t${j - 1}`] : i > 0 && !(opts.pendingFrom !== undefined && i - 1 >= opts.pendingFrom) ? [`s${i - 1}t${k - 1}`] : [];
				topics.push(topic(`s${i}t${j}`, prereqs, j === 0 ? "done" : "todo", 15 + ((i * 7 + j * 13) % 50)));
			}
		}
		const trackId = trackCount > 0 ? `t${Math.floor((i * trackCount) / n)}` : undefined;
		stages.push(stage(`s${i}`, topics, trackId ? { trackId } : {}));
	}
	return roadmap(stages, opts.depth ?? "normal", tracks);
}

const BOX = { width: 1000, height: 700 };

function assertInside(layout: StarMapLayout, box: { width: number; height: number }): void {
	for (const s of layout.stars) {
		assert.ok(s.x - s.size >= 0 && s.x + s.size <= box.width, `star ${s.topicId} x=${s.x} outside`);
		assert.ok(s.y - s.size >= 0 && s.y + s.size <= box.height, `star ${s.topicId} y=${s.y} outside`);
	}
	for (const st of layout.stages) {
		assert.ok(st.x - st.radius >= 0 && st.x + st.radius <= box.width, `stage ${st.id} x outside`);
		assert.ok(st.y - st.radius >= 0 && st.y + st.radius <= box.height, `stage ${st.id} y outside`);
		assert.ok(st.labelX >= 0 && st.labelX <= box.width, `stage ${st.id} labelX outside`);
		assert.ok(st.labelY >= 0 && st.labelY <= box.height, `stage ${st.id} labelY outside`);
	}
	for (const d of layout.dust) {
		assert.ok(d.x >= 0 && d.x <= box.width && d.y >= 0 && d.y <= box.height, "dust outside");
	}
}

function assertNoOverlap(layout: StarMapLayout): void {
	const stars = layout.stars;
	for (let i = 0; i < stars.length; i++) {
		for (let j = i + 1; j < stars.length; j++) {
			const a = stars[i]!;
			const b = stars[j]!;
			const d = Math.hypot(a.x - b.x, a.y - b.y);
			assert.ok(d >= a.size + b.size, `${a.topicId} and ${b.topicId} overlap (d=${d.toFixed(2)})`);
		}
	}
}

/** The first and last coordinate pair of an SVG path. */
function endpoints(path: string): { start: [number, number]; end: [number, number] } {
	const nums = (path.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
	assert.ok(nums.length >= 4, `path ${path} has too few numbers`);
	return { start: [nums[0]!, nums[1]!], end: [nums[nums.length - 2]!, nums[nums.length - 1]!] };
}

/** Distance from the galaxy's core along the (possibly widened) spiral:
 *  the galaxy is an ellipse in wide boxes, so x is measured unwidened. */
function outward(layout: StarMapLayout, s: { x: number; y: number }): number {
	assert.ok(layout.stretch >= 1 && layout.stretch <= 2, `stretch ${layout.stretch}`);
	return Math.hypot((s.x - layout.centre.x) / layout.stretch, s.y - layout.centre.y);
}

describe("layoutStarMap", () => {
	it("is deterministic: the same roadmap and box give the same layout", () => {
		const rm = grid(5, 4);
		assert.deepEqual(layoutStarMap(rm, BOX), layoutStarMap(rm, BOX));
		// a structurally equal copy too (no identity or call-order state)
		assert.deepEqual(layoutStarMap(structuredClone(rm), BOX), layoutStarMap(rm, BOX));
	});

	it("places one star per topic and one cluster per stage, in roadmap order", () => {
		const rm = grid(3, 3);
		const layout = layoutStarMap(rm, BOX);
		assert.deepEqual(
			layout.stages.map((s) => s.id),
			["s0", "s1", "s2"],
		);
		assert.equal(layout.stars.length, 9);
		const ids = new Set(layout.stars.map((s) => s.topicId));
		assert.equal(ids.size, 9);
		for (const star of layout.stars) assert.equal(star.stageId, star.topicId.split("t")[0]);
	});

	it("keeps everything inside the box, for wide and narrow boxes", () => {
		for (const box of [BOX, { width: 380, height: 420 }, { width: 1600, height: 500 }]) {
			assertInside(layoutStarMap(grid(3, 3), box), box);
			assertInside(layoutStarMap(grid(8, 6), box), box);
		}
	});

	it("never overlaps two stars", () => {
		assertNoOverlap(layoutStarMap(grid(3, 3), BOX));
		assertNoOverlap(layoutStarMap(grid(7, 8), BOX));
		assertNoOverlap(layoutStarMap(grid(12, 12), { width: 380, height: 420 }));
	});

	it("puts stage 1 at the core and each later stage further out", () => {
		for (const rm of [grid(3, 3), grid(10, 6), grid(16, 10, { tracks: 4, depth: "ultra" })]) {
			const layout = layoutStarMap(rm, BOX);
			const r = layout.stages.map((s) => outward(layout, s));
			assert.ok(r[0]! < 0.01, "stage 1 is the core");
			for (let i = 1; i < r.length; i++) assert.ok(r[i]! > r[i - 1]!, `stage ${i} r=${r[i]} not beyond ${r[i - 1]}`);
		}
	});

	it("keeps stage clusters apart", () => {
		const layout = layoutStarMap(grid(10, 8), BOX);
		for (let i = 0; i < layout.stages.length; i++) {
			for (let j = i + 1; j < layout.stages.length; j++) {
				const a = layout.stages[i]!;
				const b = layout.stages[j]!;
				assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= a.radius + b.radius, `${a.id} and ${b.id} clusters overlap`);
			}
		}
	});

	it("keeps each star inside its own stage cluster", () => {
		const layout = layoutStarMap(grid(6, 7), BOX);
		const byId = new Map(layout.stages.map((s) => [s.id, s]));
		for (const star of layout.stars) {
			const st = byId.get(star.stageId)!;
			assert.ok(Math.hypot(star.x - st.x, star.y - st.y) + star.size <= st.radius + 1e-6, `${star.topicId} outside its cluster`);
		}
	});

	it("puts prerequisites within a stage nearer the cluster centre than their dependants", () => {
		const rm = roadmap([
			// declared out of order: the dependant comes first
			stage("a", [topic("a3", ["a2"]), topic("a2", ["a1"]), topic("a1"), topic("a4", ["a1"])]),
			stage("b", [topic("b1", ["a3"]), topic("b2", ["b1"])]),
			stage("c", [topic("c1")]),
		]);
		const layout = layoutStarMap(rm, BOX);
		const stars = new Map(layout.stars.map((s) => [s.topicId, s]));
		const stages = new Map(layout.stages.map((s) => [s.id, s]));
		const dist = (id: string) => {
			const s = stars.get(id)!;
			const st = stages.get(s.stageId)!;
			return Math.hypot(s.x - st.x, s.y - st.y);
		};
		assert.ok(dist("a1") < dist("a2"));
		assert.ok(dist("a2") < dist("a3"));
		assert.ok(dist("a1") < dist("a4"));
		assert.ok(dist("b1") < dist("b2"));
	});

	it("counts progress per stage and carries hours", () => {
		const rm = roadmap([
			stage("a", [topic("a1", [], "done"), topic("a2", [], "skipped"), topic("a3", [], "learning"), topic("a4")], { hours: 3 }),
			stage("b", [], { hours: 1.5 }),
			stage("c", [topic("c1")]),
		]);
		const [a, b] = layoutStarMap(rm, BOX).stages;
		assert.equal(a!.total, 4);
		assert.equal(a!.done, 2, "done and skipped both count as finished");
		assert.equal(a!.hours, 3);
		assert.equal(a!.pending, false);
		assert.equal(b!.pending, true);
		assert.equal(b!.total, 0);
		assert.equal(b!.hours, 1.5);
	});

	it("gives pending stages a cluster but no stars", () => {
		const rm = grid(6, 5, { pendingFrom: 2 });
		const layout = layoutStarMap(rm, BOX);
		assert.equal(layout.stages.length, 6);
		for (const st of layout.stages.slice(2)) {
			assert.equal(st.pending, true);
			assert.ok(st.radius > 0, "pending stages still get a visible outline");
			assert.equal(layout.stars.filter((s) => s.stageId === st.id).length, 0);
		}
		assert.equal(layout.stars.length, 10);
		assertInside(layout, BOX);
	});

	it("draws one edge per known prerequisite, from the prerequisite star to the dependant", () => {
		const rm = grid(4, 3);
		rm.stages[0]!.topics[0]!.prereqs = ["not-a-topic"]; // unknown ids draw nothing
		const layout = layoutStarMap(rm, BOX);
		const stars = new Map(layout.stars.map((s) => [s.topicId, s]));
		const expected = rm.stages.flatMap((s) => s.topics.flatMap((t) => t.prereqs.filter((p) => stars.has(p)).map((p) => `${p}>${t.id}`)));
		assert.deepEqual(
			layout.edges.map((e) => `${e.from}>${e.to}`).sort(),
			expected.sort(),
		);
		for (const edge of layout.edges) {
			const { start, end } = endpoints(edge.path);
			const from = stars.get(edge.from)!;
			const to = stars.get(edge.to)!;
			assert.ok(Math.abs(start[0] - from.x) < 0.01 && Math.abs(start[1] - from.y) < 0.01, `${edge.from} start mismatch`);
			assert.ok(Math.abs(end[0] - to.x) < 0.01 && Math.abs(end[1] - to.y) < 0.01, `${edge.to} end mismatch`);
			assert.match(edge.path, /[QC]/, "edges are soft curves, not straight lines");
		}
	});

	it("links the stages in order with a route", () => {
		const layout = layoutStarMap(grid(5, 3), BOX);
		assert.deepEqual(
			layout.route.map((r) => `${r.from}>${r.to}`),
			["s0>s1", "s1>s2", "s2>s3", "s3>s4"],
		);
		for (const seg of layout.route) {
			const { start, end } = endpoints(seg.path);
			const a = layout.stages.find((s) => s.id === seg.from)!;
			const b = layout.stages.find((s) => s.id === seg.to)!;
			assert.ok(Math.abs(start[0] - a.x) < 0.01 && Math.abs(start[1] - a.y) < 0.01);
			assert.ok(Math.abs(end[0] - b.x) < 0.01 && Math.abs(end[1] - b.y) < 0.01);
		}
	});

	it("gives the stages of one track one hue family", () => {
		const rm = grid(16, 4, { tracks: 4, depth: "ultra" });
		const layout = layoutStarMap(rm, BOX);
		const hueOf = new Map(layout.stages.map((s) => [s.id, s.hue]));
		const gap = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
		for (const track of rm.tracks) {
			const hues = rm.stages.filter((s) => s.trackId === track.id).map((s) => hueOf.get(s.id)!);
			for (const h of hues) assert.ok(gap(h, hues[0]!) <= 24, `track ${track.id} hues drift: ${hues.join(",")}`);
		}
		const first = rm.stages.filter((s) => s.trackId === "t0").map((s) => hueOf.get(s.id)!);
		const second = rm.stages.filter((s) => s.trackId === "t1").map((s) => hueOf.get(s.id)!);
		assert.ok(gap(first[0]!, second[0]!) > 40, "neighbouring tracks read as different families");
	});

	it("handles the largest roadmap: 48 stages, lazily filled", () => {
		const rm = grid(48, 10, { tracks: 8, depth: "ultraviolet", pendingFrom: 6 });
		for (const box of [BOX, { width: 380, height: 420 }]) {
			const layout = layoutStarMap(rm, box);
			assert.equal(layout.stages.length, 48);
			assert.equal(layout.stars.length, 60);
			assertInside(layout, box);
			assertNoOverlap(layout);
			const r = layout.stages.map((s) => outward(layout, s));
			for (let i = 1; i < r.length; i++) assert.ok(r[i]! > r[i - 1]!);
		}
		// fully filled too
		const full = layoutStarMap(grid(48, 12, { tracks: 8, depth: "ultraviolet" }), BOX);
		assert.equal(full.stars.length, 576);
		assertInside(full, BOX);
		assertNoOverlap(full);
	});

	it("handles an empty roadmap", () => {
		const layout = layoutStarMap(roadmap([]), BOX);
		assert.deepEqual(layout.stages, []);
		assert.deepEqual(layout.stars, []);
		assert.deepEqual(layout.edges, []);
	});
});
