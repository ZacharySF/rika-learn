/**
 * The build pipeline (research/07 §4.2) with a scripted faux model and
 * fake sources: the skeleton streams in line by line, resources come only
 * from source answers, named resources that cannot be found are dropped,
 * Ultra fills only its first track and the rest fill lazily on open.
 * No network, no real model.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createFauxCore, fauxAssistantMessage } from "@earendil-works/pi-ai";
import type { PiEngine } from "../src/agent/models.ts";
import { buildRoadmap, fillStage, writePrimingQuestions, type LearnDeps } from "../src/agent/learn/build.ts";
import type { SourceAdapter, SourceContext } from "../src/agent/learn/sources/types.ts";
import type { Candidate, DepthId, Roadmap } from "../src/core/learn/contracts.ts";

function contextText(context: { messages: unknown[] }): string {
	return JSON.stringify(context.messages);
}

type Reply = (prompt: string) => string;

function engine(reply: Reply, tokensPerSecond = 20000): { engine: PiEngine; calls: () => number } {
	const faux = createFauxCore({ tokensPerSecond, models: [{ id: "faux-flash", cost: { input: 0.15, output: 0.47, cacheRead: 0, cacheWrite: 0 } }] });
	const step = (context: { messages: unknown[] }) => fauxAssistantMessage(reply(contextText(context)));
	faux.setResponses(Array.from({ length: 50 }, () => step));
	return { engine: { model: faux.getModel(), streamFn: faux.streamSimple }, calls: () => faux.state.callCount };
}

function roadmap(depth: DepthId): Roadmap {
	return {
		version: 1,
		id: "rm_test",
		topic: "linear algebra",
		depth,
		createdAt: "2026-11-13T10:00:00.000Z",
		updatedAt: "2026-11-13T10:00:00.000Z",
		status: "building",
		title: "",
		volatility: "evergreen",
		research: false,
		hours: 0,
		priming: [{ questionId: "q1", question: "Matrices?", answer: "Never" }],
		tracks: [],
		stages: [],
		model: { provider: "faux", id: "faux-flash" },
		spend: { usd: 0, calls: 0 },
		youtubeSearches: 0,
	};
}

/** In-memory stand-in for the store-backed update the server wires. */
function harness(depth: DepthId, eng: PiEngine, adapters: SourceAdapter[]) {
	let current = roadmap(depth);
	const snapshots: Roadmap[] = [];
	const spend: number[] = [];
	let searches = 0;
	const ctx: SourceContext = {
		fetch: (() => {
			throw new Error("no network in tests");
		}) as unknown as typeof fetch,
		keys: { youtube: "AIza-test" },
		cache: { get: () => undefined, set: () => {} },
		now: () => Date.UTC(2026, 10, 13),
		userAgent: "rika-learn-test",
		youtubeQuota: {
			remaining: () => 100 - searches,
			spend: () => {
				searches++;
				return true;
			},
		},
	};
	const deps: LearnDeps = {
		engine: eng,
		adapters,
		sourceContext: ctx,
		language: "en",
		update(mutate) {
			const next = structuredClone(current);
			mutate(next);
			current = next;
			snapshots.push(structuredClone(next));
			return next;
		},
		recordSpend: (usd) => spend.push(usd),
		now: () => Date.UTC(2026, 10, 13),
	};
	return { deps, get: () => current, snapshots, spend, searches: () => searches };
}

const youtube: SourceAdapter = {
	id: "youtube",
	resolves: [],
	async search(query, ctx) {
		ctx.youtubeQuota?.spend();
		const slug = query.stageTitle.toLowerCase().replace(/\W+/g, "-");
		return [
			{ source: "youtube", kind: "video", title: `${query.stageTitle} explained`, by: "3Blue1Brown", url: `https://www.youtube.com/watch?v=${slug}-a`, minutes: 12, videoId: `${slug}-a`, signals: { views: 2e6, captions: true } },
			{ source: "youtube", kind: "video", title: `Essence of linear algebra: ${query.stageTitle}`, by: "3Blue1Brown", url: `https://www.youtube.com/watch?v=${slug}-b`, minutes: 15, videoId: `${slug}-b`, signals: { views: 5e6 } },
		] satisfies Candidate[];
	},
};

const wikipedia: SourceAdapter = {
	id: "wikipedia",
	resolves: ["reading"],
	async search(query) {
		return [{ source: "wikipedia", kind: "reading", title: `${query.stageTitle} (mathematics)`, url: `https://en.wikipedia.org/wiki/${encodeURIComponent(query.stageTitle)}` }];
	},
};

const openlibrary: SourceAdapter = {
	id: "openlibrary",
	resolves: ["book"],
	async search() {
		return [];
	},
	async resolve(item) {
		return item.title === "Linear Algebra Done Right"
			? { source: "openlibrary", kind: "book", title: "Linear Algebra Done Right", by: "Sheldon Axler", url: "https://openlibrary.org/works/OL1W", canon: true }
			: null;
	},
};

const NORMAL = [
	'{"roadmap":{"title":"Linear algebra from zero","level":{"label":"Beginner","summary":"Has not met matrices."},"volatility":"evergreen","research":false,"hours":2}}',
	'{"stage":{"id":"s1","title":"Vectors","why":"Everything builds on vectors.","hours":0.7,"query":"vectors linear algebra","canon":[{"kind":"video","title":"Essence of linear algebra","by":"3Blue1Brown"},{"kind":"course","title":"Totally Invented Course 999"},{"kind":"book","title":"Linear Algebra Done Right","by":"Axler"}]}}',
	'{"topic":{"id":"t1","stage":"s1","title":"What a vector is","objective":"Explain a vector as an arrow and a list.","minutes":20}}',
	'{"topic":{"id":"t2","stage":"s1","title":"Adding vectors","objective":"Add vectors tip to tail.","minutes":20,"prereqs":["t1"]}}',
	'{"stage":{"id":"s2","title":"Matrices","why":"Matrices move vectors.","hours":0.7,"query":"matrices linear transformations","prereqs":["s1"]}}',
	'{"topic":{"id":"t3","stage":"s2","title":"Matrix as a transformation","objective":"Describe a matrix as a map of space.","minutes":25,"prereqs":["t2"]}}',
	'{"topic":{"id":"t4","stage":"s2","title":"Matrix multiplication","objective":"Multiply two matrices.","minutes":25,"prereqs":["t3"]}}',
	'{"stage":{"id":"s3","title":"Determinants","why":"How much space stretches.","hours":0.6,"query":"determinant intuition"}}',
	'{"topic":{"id":"t5","stage":"s3","title":"Determinant as area","objective":"Explain the determinant as scaled area.","minutes":30,"prereqs":["t4"]}}',
].join("\n");

describe("buildRoadmap — Normal", () => {
	it("streams stages in, attaches ranked resources and finishes ready", async () => {
		const { engine: eng, calls } = engine(() => NORMAL, 3000);
		const h = harness("normal", eng, [youtube, wikipedia, openlibrary]);
		await buildRoadmap(h.deps);
		const r = h.get();
		assert.equal(r.status, "ready");
		assert.equal(r.title, "Linear algebra from zero");
		assert.equal(r.level?.label, "Beginner");
		assert.deepEqual(r.stages.map((s) => s.id), ["s1", "s2", "s3"]);
		assert.equal(calls(), 1, "Normal is one model call");
		for (const stage of r.stages) {
			assert.equal(stage.fill, "filled");
			assert.equal(stage.resources.picks[0]?.kind, "video", `${stage.id} starts with a video`);
			assert.ok(stage.resources.picks.length >= 2);
		}
		const building = h.snapshots.filter((s) => s.status === "building");
		assert.ok(building.some((s) => s.stages.length === 1), "the first stage was visible before the rest were written");
		assert.equal(h.searches(), 3, "one YouTube search per stage");
		assert.equal(r.youtubeSearches, 3);
		assert.equal(r.spend.calls, 1);
		assert.ok(h.spend.length === 1);
	});

	it("keeps only resources the sources returned; named ones that exist are marked, invented ones dropped", async () => {
		const { engine: eng } = engine(() => NORMAL);
		const h = harness("normal", eng, [youtube, wikipedia, openlibrary]);
		await buildRoadmap(h.deps);
		const s1 = h.get().stages[0]!;
		const all = [...s1.resources.picks, ...s1.resources.more];
		const allowed = /^https:\/\/(www\.youtube\.com\/watch\?v=|en\.wikipedia\.org\/wiki\/|openlibrary\.org\/works\/)/;
		for (const r of all) assert.match(r.url, allowed, `${r.url} came from a source`);
		assert.ok(!all.some((r) => /Invented/.test(r.title)), "unresolved canon dropped");
		const book = all.find((r) => r.source === "openlibrary");
		assert.equal(book?.canon, true, "the named book resolved through Open Library");
		const named = all.find((r) => r.title.startsWith("Essence of linear algebra"));
		assert.equal(named?.canon, true, "the named video matched the stage's one search");
		const used = new Set(h.get().stages.flatMap((s) => s.resources.picks.map((p) => p.id)));
		assert.equal(used.size, h.get().stages.flatMap((s) => s.resources.picks).length, "no pick repeats across stages");
	});

	it("marks the roadmap as failed when the model writes nothing usable", async () => {
		const { engine: eng } = engine(() => "Great question! Here is how I would learn it.");
		const h = harness("normal", eng, [wikipedia]);
		await buildRoadmap(h.deps);
		assert.equal(h.get().status, "error");
		assert.match(h.get().error ?? "", /usable roadmap/);
	});
});

const ULTRA = [
	'{"roadmap":{"title":"Linear algebra, a semester","hours":130}}',
	'{"track":{"id":"k1","title":"Foundations","why":"Vectors and matrices."}}',
	'{"stage":{"id":"s1","track":"k1","title":"Vectors","why":"Start here.","hours":8,"query":"vectors"}}',
	'{"stage":{"id":"s2","track":"k1","title":"Matrices","why":"Maps of space.","hours":8,"query":"matrices"}}',
	'{"track":{"id":"k2","title":"Spectral theory","why":"Eigen-everything."}}',
	'{"stage":{"id":"s3","track":"k2","title":"Eigenvalues","why":"Directions that stay.","hours":10,"query":"eigenvalues"}}',
	'{"stage":{"id":"s4","track":"k2","title":"Diagonalization","why":"Simplify matrices.","hours":10,"query":"diagonalization"}}',
].join("\n");

function fill(stage: string): string {
	return JSON.stringify({
		topics: [
			{ id: `${stage}-a`, title: `${stage} idea one`, objective: "Explain the first idea.", minutes: 60 },
			{ id: `${stage}-b`, title: `${stage} idea two`, objective: "Apply the second idea.", minutes: 60, prereqs: [`${stage}-a`] },
		],
		canon: [{ kind: "book", title: "Linear Algebra Done Right", by: "Axler" }],
	});
}

function ultraReply(prompt: string): string {
	const m = /Fill this stage with[^\\]*\\nStage (s\d+)/.exec(prompt);
	return m ? fill(m[1]!) : ULTRA;
}

describe("buildRoadmap — Ultra (lazy expansion)", () => {
	it("builds every track and stage but fills only the first track", async () => {
		const { engine: eng, calls } = engine(ultraReply);
		const h = harness("ultra", eng, [youtube, wikipedia, openlibrary]);
		await buildRoadmap(h.deps);
		const r = h.get();
		assert.equal(r.status, "ready");
		assert.deepEqual(r.tracks.map((t) => t.id), ["k1", "k2"]);
		assert.deepEqual(r.stages.map((s) => [s.id, s.fill]), [
			["s1", "filled"],
			["s2", "filled"],
			["s3", "pending"],
			["s4", "pending"],
		]);
		assert.equal(r.stages[0]!.topics.length, 2);
		assert.equal(r.stages[2]!.topics.length, 0);
		assert.equal(r.stages[2]!.resources.picks.length, 0);
		assert.equal(calls(), 3, "skeleton + two eager fills");
		assert.equal(h.searches(), 2, "YouTube searched only for filled stages");
	});

	it("fills a pending stage when it is opened", async () => {
		const { engine: eng, calls } = engine(ultraReply);
		const h = harness("ultra", eng, [youtube, wikipedia, openlibrary]);
		await buildRoadmap(h.deps);
		await fillStage("s3", h.deps);
		const s3 = h.get().stages[2]!;
		assert.equal(s3.fill, "filled");
		assert.deepEqual(s3.topics.map((t) => t.id), ["s3-a", "s3-b"]);
		assert.deepEqual(s3.topics[1]!.prereqs, ["s3-a"]);
		assert.equal(s3.resources.picks[0]?.kind, "video");
		assert.equal(calls(), 4);
		assert.equal(h.get().stages[3]!.fill, "pending", "other stages stay lazy");
		const bookPicks = h.get().stages.flatMap((s) => s.resources.picks).filter((p) => p.source === "openlibrary");
		assert.ok(bookPicks.length <= 1, "the same book is a pick in one stage only");
	});

	it("an unusable fill answer marks only that stage as failed", async () => {
		const { engine: eng } = engine((prompt) => (/Stage s3/.test(prompt) ? "no json at all" : ultraReply(prompt)));
		const h = harness("ultra", eng, [wikipedia]);
		await buildRoadmap(h.deps);
		await fillStage("s3", h.deps);
		const s3 = h.get().stages[2]!;
		assert.equal(s3.fill, "error");
		assert.match(s3.error ?? "", /Try again/);
		assert.equal(h.get().status, "ready");
	});
});

describe("buildRoadmap — Super", () => {
	it("writes stages first, then fills every stage", async () => {
		const skeleton = [
			'{"roadmap":{"title":"Rust in two weeks","volatility":"fast","hours":30}}',
			...Array.from({ length: 7 }, (_, i) => `{"stage":{"id":"s${i + 1}","title":"Part ${i + 1}","why":"x","hours":4,"query":"rust part ${i + 1}"}}`),
		].join("\n");
		const { engine: eng, calls } = engine((prompt) => {
			const m = /Fill this stage with[^\\]*\\nStage (s\d+)/.exec(prompt);
			return m ? fill(m[1]!) : skeleton;
		});
		const h = harness("super", eng, [youtube, wikipedia]);
		await buildRoadmap(h.deps);
		const r = h.get();
		assert.equal(r.status, "ready");
		assert.ok(r.stages.every((s) => s.fill === "filled" && s.topics.length === 2));
		assert.equal(calls(), 8);
		assert.equal(r.volatility, "fast");
	});
});

describe("writePrimingQuestions", () => {
	it("asks the model with the prober doctrine and returns at most three questions", async () => {
		let seen = "";
		const { engine: eng } = engine((prompt) => {
			seen = prompt;
			return JSON.stringify({
				questions: [
					{ question: "Have you used vectors?", options: ["Never", "A little", "Often"] },
					{ question: "Matrices?", options: ["Never", "Yes"] },
					{ question: "Eigenvalues?", options: ["No", "Yes"] },
					{ question: "Fourth?", options: ["a", "b"] },
				],
			});
		});
		const out = await writePrimingQuestions({ engine: eng, topic: "linear algebra", depth: "high", doctrine: "FLOOR-AND-CEILING-DOCTRINE" });
		assert.equal(out.questions.length, 3);
		assert.match(seen, /FLOOR-AND-CEILING-DOCTRINE/);
		assert.match(seen, /linear algebra/);
		assert.ok(out.usd >= 0);
	});
});
