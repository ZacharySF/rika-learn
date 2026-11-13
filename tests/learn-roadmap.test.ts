/**
 * Roadmap parsing and validation (research/07 §4.2–4.3): the skeleton
 * streams one JSON object per line; each line is validated on its own,
 * invalid lines are dropped, and the assembler enforces ids, references,
 * acyclic prerequisites and the depth's size caps.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	NdjsonLineReader,
	RoadmapAssembler,
	extractJsonObject,
	parseSkeletonLine,
	parseStageFill,
	rescaleMinutes,
} from "../src/core/learn/roadmap.ts";
import type { Stage } from "../src/core/learn/contracts.ts";

describe("NdjsonLineReader", () => {
	it("returns only complete lines and keeps the partial tail", () => {
		const reader = new NdjsonLineReader();
		assert.deepEqual(reader.push('{"a":1}\n{"b"'), ['{"a":1}']);
		assert.deepEqual(reader.push(':2}\n\n{"c":3}'), ['{"b":2}']);
		assert.deepEqual(reader.flush(), ['{"c":3}']);
		assert.deepEqual(reader.flush(), []);
	});

	it("handles CRLF and chunk boundaries inside a line", () => {
		const reader = new NdjsonLineReader();
		const out = [..."{\"x\":1}\r\n{\"y\":2}\r\n"].flatMap((ch) => reader.push(ch));
		assert.deepEqual(out, ['{"x":1}', '{"y":2}']);
	});
});

describe("parseSkeletonLine", () => {
	it("parses each line type", () => {
		const roadmap = parseSkeletonLine(
			'{"roadmap":{"title":"Linear algebra basics","level":{"label":"Beginner","summary":"Knows arithmetic."},"volatility":"evergreen","research":false,"hours":2}}',
		);
		assert.equal(roadmap.kind, "roadmap");
		if (roadmap.kind === "roadmap") {
			assert.equal(roadmap.value.title, "Linear algebra basics");
			assert.equal(roadmap.value.level?.label, "Beginner");
			assert.equal(roadmap.value.hours, 2);
		}
		const stage = parseSkeletonLine(
			'{"stage":{"id":"s1","title":"Vectors","why":"Everything builds on vectors.","hours":0.5,"query":"vectors intro linear algebra","prereqs":[],"canon":[{"kind":"video","title":"Essence of linear algebra","by":"3Blue1Brown"}]}}',
		);
		assert.equal(stage.kind, "stage");
		if (stage.kind === "stage") {
			assert.equal(stage.value.query, "vectors intro linear algebra");
			assert.deepEqual(stage.value.canon, [{ kind: "video", title: "Essence of linear algebra", by: "3Blue1Brown" }]);
		}
		const topic = parseSkeletonLine(
			'{"topic":{"id":"t1","stage":"s1","title":"What a vector is","objective":"Explain a vector as an arrow and a list.","minutes":15,"prereqs":[]}}',
		);
		assert.equal(topic.kind, "topic");
		const track = parseSkeletonLine('{"track":{"id":"k1","title":"Foundations","why":"Start here."}}');
		assert.equal(track.kind, "track");
	});

	it("ignores blank lines and code fences", () => {
		assert.equal(parseSkeletonLine("").kind, "ignored");
		assert.equal(parseSkeletonLine("```json").kind, "ignored");
		assert.equal(parseSkeletonLine("```").kind, "ignored");
	});

	it("rejects malformed JSON and unknown or incomplete objects", () => {
		assert.equal(parseSkeletonLine('{"stage":{"id":"s1"').kind, "invalid");
		assert.equal(parseSkeletonLine('{"banana":{}}').kind, "invalid");
		assert.equal(parseSkeletonLine('{"stage":{"id":"s1"}}').kind, "invalid", "stage without a title");
		assert.equal(parseSkeletonLine('{"topic":{"id":"t1","title":"x"}}').kind, "invalid", "topic without a stage");
		assert.equal(parseSkeletonLine("Great question! Here is your roadmap").kind, "invalid");
	});

	it("keeps canon URLs only for docs and only http(s)", () => {
		const line = parseSkeletonLine(
			JSON.stringify({
				stage: {
					id: "s1",
					title: "Setup",
					query: "install",
					canon: [
						{ kind: "docs", title: "The Book", url: "https://doc.rust-lang.org/book/" },
						{ kind: "video", title: "Some video", url: "https://youtube.com/watch?v=invented" },
						{ kind: "docs", title: "Bad", url: "javascript:alert(1)" },
						{ kind: "textbook", title: "Linear Algebra Done Right", by: "Axler" },
						{ kind: "podcast", title: "Unknown kind" },
						{ kind: "reading", title: "" },
					],
				},
			}),
		);
		assert.equal(line.kind, "stage");
		if (line.kind !== "stage") return;
		assert.deepEqual(line.value.canon, [
			{ kind: "docs", title: "The Book", url: "https://doc.rust-lang.org/book/" },
			{ kind: "video", title: "Some video" },
			{ kind: "docs", title: "Bad" },
			{ kind: "book", title: "Linear Algebra Done Right", by: "Axler" },
		]);
	});

	it("trims objectives to 20 words and whys to 15", () => {
		const long = Array.from({ length: 30 }, (_, i) => `w${i}`).join(" ");
		const topic = parseSkeletonLine(JSON.stringify({ topic: { id: "t", stage: "s", title: "T", objective: long, minutes: 5 } }));
		assert.equal(topic.kind, "topic");
		if (topic.kind === "topic") assert.equal(topic.value.objective.split(" ").length, 20);
		const stage = parseSkeletonLine(JSON.stringify({ stage: { id: "s", title: "S", why: long, query: "q" } }));
		if (stage.kind === "stage") assert.equal(stage.value.why.split(" ").length, 15);
	});

	it("defaults the query to the title and the minutes to a sane value", () => {
		const stage = parseSkeletonLine('{"stage":{"id":"s1","title":"Matrices"}}');
		if (stage.kind === "stage") assert.equal(stage.value.query, "Matrices");
		const topic = parseSkeletonLine('{"topic":{"id":"t1","stage":"s1","title":"Rows","objective":"Read rows.","minutes":-4}}');
		if (topic.kind === "topic") assert.ok(topic.value.minutes > 0);
	});
});

function feed(assembler: RoadmapAssembler, lines: unknown[]) {
	for (const line of lines) assembler.apply(parseSkeletonLine(JSON.stringify(line)));
}

describe("RoadmapAssembler", () => {
	it("builds stages with topics in order", () => {
		const a = new RoadmapAssembler("normal");
		feed(a, [
			{ roadmap: { title: "Vectors", volatility: "evergreen", research: false, hours: 2 } },
			{ stage: { id: "s1", title: "Basics", query: "vector basics" } },
			{ topic: { id: "t1", stage: "s1", title: "Arrows", objective: "Draw vectors.", minutes: 20 } },
			{ topic: { id: "t2", stage: "s1", title: "Lists", objective: "Write vectors as lists.", minutes: 20, prereqs: ["t1"] } },
			{ stage: { id: "s2", title: "Operations", query: "vector addition", prereqs: ["s1"] } },
			{ topic: { id: "t3", stage: "s2", title: "Adding", objective: "Add two vectors.", minutes: 20, prereqs: ["t2"] } },
		]);
		assert.equal(a.header?.title, "Vectors");
		assert.deepEqual(a.stages.map((s) => s.id), ["s1", "s2"]);
		assert.deepEqual(a.stages[0]!.topics.map((t) => t.id), ["t1", "t2"]);
		assert.deepEqual(a.stages[1]!.prereqs, ["s1"]);
		assert.deepEqual(a.stages[1]!.topics[0]!.prereqs, ["t2"]);
		assert.equal(a.stages[0]!.topics[0]!.state, "todo");
		assert.equal(a.stages[0]!.fill, "filling");
	});

	it("reports what each accepted line added", () => {
		const a = new RoadmapAssembler("normal");
		const event = a.apply(parseSkeletonLine('{"stage":{"id":"s1","title":"Basics","query":"q"}}'));
		assert.deepEqual(event, { type: "stage", id: "s1" });
		assert.equal(a.apply(parseSkeletonLine('{"stage":{"id":"s1","title":"Again","query":"q"}}')), null, "duplicate id rejected");
		assert.equal(a.rejected.length, 1);
	});

	it("drops prerequisites that are unknown or point forward, so the graph stays acyclic", () => {
		const a = new RoadmapAssembler("normal");
		feed(a, [
			{ stage: { id: "s1", title: "A", query: "a", prereqs: ["s2", "s1"] } },
			{ topic: { id: "t1", stage: "s1", title: "One", objective: "Do one.", minutes: 10, prereqs: ["t2", "t1", "ghost"] } },
			{ topic: { id: "t2", stage: "s1", title: "Two", objective: "Do two.", minutes: 10, prereqs: ["t1"] } },
		]);
		assert.deepEqual(a.stages[0]!.prereqs, []);
		assert.deepEqual(a.stages[0]!.topics[0]!.prereqs, []);
		assert.deepEqual(a.stages[0]!.topics[1]!.prereqs, ["t1"]);
	});

	it("rejects topics for unknown stages and merges duplicate titles in a stage", () => {
		const a = new RoadmapAssembler("normal");
		feed(a, [
			{ stage: { id: "s1", title: "A", query: "a" } },
			{ topic: { id: "t1", stage: "s9", title: "Lost", objective: "x", minutes: 5 } },
			{ topic: { id: "t2", stage: "s1", title: "Vectors!", objective: "x", minutes: 5 } },
			{ topic: { id: "t3", stage: "s1", title: "vectors", objective: "y", minutes: 5 } },
		]);
		assert.deepEqual(a.stages[0]!.topics.map((t) => t.id), ["t2"]);
		assert.equal(a.rejected.length, 2);
	});

	it("caps stages and topics per stage to the depth", () => {
		const a = new RoadmapAssembler("normal");
		for (let s = 1; s <= 9; s++) {
			feed(a, [{ stage: { id: `s${s}`, title: `Stage ${s}`, query: `q${s}` } }]);
			for (let t = 1; t <= 9; t++) {
				feed(a, [{ topic: { id: `s${s}t${t}`, stage: `s${s}`, title: `Topic ${s}.${t}`, objective: "Do it.", minutes: 5 } }]);
			}
		}
		assert.equal(a.stages.length, 5);
		for (const stage of a.stages) assert.equal(stage.topics.length, 4);
	});

	it("assigns tracks on Ultra and creates one when the model forgot", () => {
		const a = new RoadmapAssembler("ultra");
		feed(a, [
			{ roadmap: { title: "Physics", hours: 130 } },
			{ stage: { id: "s1", title: "Units", query: "units" } },
			{ track: { id: "k2", title: "Mechanics", why: "Motion." } },
			{ stage: { id: "s2", track: "k2", title: "Kinematics", query: "kinematics" } },
			{ stage: { id: "s3", track: "nope", title: "Forces", query: "forces" } },
		]);
		assert.equal(a.tracks.length, 2);
		assert.equal(a.stages[0]!.trackId, a.tracks[0]!.id);
		assert.equal(a.stages[1]!.trackId, "k2");
		assert.equal(a.stages[2]!.trackId, "k2", "unknown track → the latest track");
		assert.equal(a.stages[0]!.fill, "pending");
	});

	it("drops track ids on depths without tracks", () => {
		const a = new RoadmapAssembler("high");
		feed(a, [
			{ track: { id: "k1", title: "Nope" } },
			{ stage: { id: "s1", track: "k1", title: "A", query: "a" } },
		]);
		assert.equal(a.tracks.length, 0);
		assert.equal(a.stages[0]!.trackId, undefined);
	});
});

describe("extractJsonObject", () => {
	it("finds the object inside fences or chatter", () => {
		assert.deepEqual(extractJsonObject('```json\n{"a":1}\n```'), { a: 1 });
		assert.deepEqual(extractJsonObject('Sure: {"a":{"b":2}} done'), { a: { b: 2 } });
		assert.equal(extractJsonObject("no json"), null);
	});
});

function stage(partial: Partial<Stage> = {}): Stage {
	return {
		id: "s3",
		title: "Eigenvalues",
		why: "",
		hours: 10,
		query: "eigenvalues",
		prereqs: [],
		canon: [],
		topics: [],
		fill: "pending",
		resources: { picks: [], more: [] },
		...partial,
	};
}

describe("parseStageFill (lazy expansion)", () => {
	it("validates topics and canon, generating ids that do not clash", () => {
		const fill = parseStageFill(
			JSON.stringify({
				topics: [
					{ title: "Characteristic polynomial", objective: "Compute det(A - λI).", minutes: 40 },
					{ id: "x1", title: "Eigenvectors", objective: "Find eigenvectors.", minutes: 50, prereqs: ["Characteristic polynomial"] },
					{ id: "x1", title: "Diagonalization", objective: "Diagonalize a matrix.", minutes: 60, prereqs: ["x1", "old-topic"] },
					{ title: "" },
				],
				canon: [{ kind: "video", title: "Eigenvectors and eigenvalues", by: "3Blue1Brown" }],
			}),
			stage(),
			"ultra",
			new Set(["old-topic", "x1-taken"]),
		);
		assert.ok(fill);
		assert.equal(fill.topics.length, 3);
		const ids = fill.topics.map((t) => t.id);
		assert.equal(new Set(ids).size, 3, "unique ids");
		assert.ok(!ids.includes("old-topic"));
		assert.deepEqual(fill.topics[1]!.prereqs, [fill.topics[0]!.id], "prereq by title resolves");
		assert.deepEqual(fill.topics[2]!.prereqs.sort(), [fill.topics[1]!.id, "old-topic"].sort());
		assert.equal(fill.canon.length, 1);
	});

	it("returns null when the answer has no usable topics", () => {
		assert.equal(parseStageFill("nothing here", stage(), "ultra", new Set()), null);
		assert.equal(parseStageFill('{"topics":[]}', stage(), "ultra", new Set()), null);
	});

	it("caps topics to the depth", () => {
		const topics = Array.from({ length: 30 }, (_, i) => ({ title: `T${i}`, objective: "Do.", minutes: 30 }));
		const fill = parseStageFill(JSON.stringify({ topics }), stage(), "ultra", new Set());
		assert.equal(fill?.topics.length, 12);
	});
});

describe("rescaleMinutes", () => {
	it("scales topic minutes into the depth's hour budget (±25%)", () => {
		const stages = [
			stage({ id: "a", topics: [{ id: "1", title: "a", objective: "", minutes: 300, prereqs: [], state: "todo" }] }),
			stage({ id: "b", topics: [{ id: "2", title: "b", objective: "", minutes: 300, prereqs: [], state: "todo" }] }),
		];
		const out = rescaleMinutes(stages, "normal");
		const total = out.flatMap((s) => s.topics).reduce((n, t) => n + t.minutes, 0);
		assert.ok(total <= 3 * 60 * 1.25, `total ${total} within budget`);
		assert.equal(out[0]!.hours, Math.round((out[0]!.topics[0]!.minutes / 60) * 2) / 2 || 0.5);
	});

	it("leaves totals already inside the budget alone", () => {
		const stages = [stage({ topics: [{ id: "1", title: "a", objective: "", minutes: 120, prereqs: [], state: "todo" }] })];
		assert.equal(rescaleMinutes(stages, "normal")[0]!.topics[0]!.minutes, 120);
	});
});
