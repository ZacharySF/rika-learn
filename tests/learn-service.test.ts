/**
 * The Learn service (src/server/learn.ts) end to end, in offline demo mode:
 * the faux model and the synthetic fixture network stand in for the real
 * ones, under an isolated LH_DATA_DIR. Covers the spending gate (first-run
 * limit, auto-approve, review sheet, approval), a full streamed Normal
 * build, progress, exports and the bridge outbox.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import type { Roadmap } from "../src/core/learn/contracts.ts";

// ── the seam, BEFORE any config-loading import ─────────────────────────────
// config.ts reads LH_DATA_DIR when it loads, so every app module below is
// imported dynamically after the env is set (the chat-kind test's pattern).
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "rl-learn-service-"));
process.env.LH_DATA_DIR = path.join(TMP, "data");
process.env.LH_AUTH_FILE = path.join(TMP, "auth.json");
process.env.LH_LEARN_OFFLINE_DEMO = "1";

const learn = await import("../src/server/learn.ts");
const { subscribe } = await import("../src/core/events.ts");
const { isBridgeMessage } = await import("../src/core/learn/bridge.ts");
const { stores } = await import("../src/server/stores.ts");

after(() => fs.rmSync(TMP, { recursive: true, force: true }));

type Body = Record<string, unknown>;

/** Resolves once `check` holds, re-checking on every learn-changed event
 *  (the same signal the UI refetches on). The builds are real background
 *  work on the faux model, so the only timer is the give-up deadline. */
async function waitFor(check: () => boolean, ms = 90_000): Promise<void> {
	if (check()) return;
	const { promise, resolve, reject } = Promise.withResolvers<void>();
	const off = subscribe((e) => {
		if (e.type === "learn-changed" && check()) resolve();
	});
	const deadline = setTimeout(() => reject(new Error("timed out")), ms);
	try {
		await promise;
	} finally {
		off();
		clearTimeout(deadline);
	}
}

describe("the spending gate", () => {
	it("asks for a daily limit on first use", async () => {
		const r = await learn.primeRequest({ topic: "music theory", depth: "normal" });
		assert.equal(r.status, 409);
		assert.equal((r.body as Body).needs, "ceiling");
		assert.equal(learn.createRoadmapRequest({ topic: "music theory", depth: "normal", answers: [] }).status, 409);
	});

	it("rejects a bad limit and saves a good one", () => {
		assert.equal(learn.updateLearnSettings({ dailyCeilingUsd: -1 }).status, 400);
		const r = learn.updateLearnSettings({ dailyCeilingUsd: 0.5 });
		assert.equal(r.status, 200);
		assert.equal((r.body as { settings: { dailyCeilingUsd: number } }).settings.dailyCeilingUsd, 0.5);
	});

	it("runs priming without asking under the limit", async () => {
		const r = await learn.primeRequest({ topic: "music theory", depth: "normal" });
		assert.equal(r.status, 200);
		const questions = (r.body as { questions: { options: unknown[] }[] }).questions;
		assert.ok(questions.length >= 1 && questions.length <= 3);
		assert.ok(stores.learnStore.readSpend().some((e) => e.phase === "prime"), "the call was booked on the ledger");
	});

	it("shows a review sheet over the limit, and lets an approved call through", () => {
		learn.updateLearnSettings({ dailyCeilingUsd: 0 });
		const r = learn.createRoadmapRequest({ topic: "music theory", depth: "ultraviolet", answers: [] });
		assert.equal(r.status, 402);
		const review = (r.body as { review: Body }).review;
		assert.equal(review.phase, "build");
		assert.equal(review.ceilingUsd, 0);
		assert.ok((review.estimateUsd as number) > 0);
		const estimate = learn.learnEstimate("ultraviolet", "build");
		assert.equal((estimate.body as { decision: Body }).decision.kind, "review");
		learn.updateLearnSettings({ dailyCeilingUsd: 5 });
	});

	it("validates the request", async () => {
		assert.equal((await learn.primeRequest({ topic: "   " })).status, 400);
		assert.equal(learn.createRoadmapRequest({ topic: "x".repeat(500) }).status, 400);
	});
});

describe("a Normal build, offline", () => {
	let id = "";

	it("starts, streams stages in and finishes with resources", async () => {
		const events: string[] = [];
		const off = subscribe((e) => {
			if (e.type === "learn-changed") events.push(e.roadmapId);
		});
		const created = learn.createRoadmapRequest({
			topic: "music theory",
			depth: "normal",
			answers: [{ questionId: "q1", question: "How much have you used music theory before?", answer: "Never" }],
		});
		assert.equal(created.status, 201);
		id = (created.body as { id: string }).id;
		const read = () => (learn.getRoadmap(id).body as { roadmap: Roadmap }).roadmap;
		assert.equal(read().status, "building");
		await waitFor(() => read().stages.length >= 1);
		assert.equal(read().status, "building", "the first stage shows while the rest are being written");
		await waitFor(() => read().status !== "building");
		off();
		const roadmap = read();
		assert.equal(roadmap.status, "ready", roadmap.error);
		assert.ok(roadmap.stages.length >= 3);
		assert.ok(events.filter((x) => x === id).length > 3, "windows were told to refetch as it grew");
		for (const stage of roadmap.stages) {
			assert.equal(stage.fill, "filled");
			assert.equal(stage.resources.picks[0]?.kind, "video");
		}
		assert.equal(roadmap.youtubeSearches, roadmap.stages.length);
		assert.equal(learn.learnSettingsView().youtube.used, roadmap.stages.length);
	});

	it("lists the roadmap with its progress", () => {
		const list = (learn.listRoadmaps().body as { roadmaps: { id: string; done: number; topics: number }[] }).roadmaps;
		const row = list.find((r) => r.id === id);
		assert.ok(row);
		assert.equal(row.done, 0);
		assert.ok(row.topics > 0);
	});

	it("marks topic progress", () => {
		const roadmap = (learn.getRoadmap(id).body as { roadmap: Roadmap }).roadmap;
		const topic = roadmap.stages[0]!.topics[0]!;
		assert.equal(learn.setTopicStateRequest(id, topic.id, { state: "nope" }).status, 400);
		assert.equal(learn.setTopicStateRequest(id, "ghost", { state: "done" }).status, 404);
		const r = learn.setTopicStateRequest(id, topic.id, { state: "done" });
		assert.equal(r.status, 200);
		const list = (learn.listRoadmaps().body as { roadmaps: { id: string; done: number }[] }).roadmaps;
		assert.equal(list.find((x) => x.id === id)?.done, 1);
	});

	it("exports Flashcards and Calendar messages for rika", () => {
		const stageId = (learn.getRoadmap(id).body as { roadmap: Roadmap }).roadmap.stages[0]!.id;
		const cards = learn.exportRequest(id, new URLSearchParams({ kind: "flashcards", stage: stageId }));
		assert.equal(cards.status, 200);
		assert.ok(isBridgeMessage(cards.body));
		const calendar = learn.exportRequest(id, new URLSearchParams({ kind: "calendar", stage: stageId, date: "2026-11-14", time: "18:00", minutes: "45" }));
		assert.equal(calendar.status, 200);
		assert.ok(isBridgeMessage(calendar.body));
		assert.equal(learn.exportRequest(id, new URLSearchParams({ kind: "calendar", stage: stageId, date: "tomorrow" })).status, 400);
		assert.equal(learn.exportRequest(id, new URLSearchParams({ kind: "flashcards", stage: "ghost" })).status, 404);

		assert.equal(learn.outboxAdd({ nope: true }).status, 400);
		const added = learn.outboxAdd(cards.body);
		assert.equal(added.status, 201);
		const items = (learn.outboxList().body as { items: { id: string }[] }).items;
		assert.equal(items.length, 1);
		assert.equal((learn.outboxAck({ ids: [items[0]!.id] }).body as { removed: number }).removed, 1);
	});

	it("deletes a finished roadmap", () => {
		assert.equal(learn.deleteRoadmap(id).status, 200);
		assert.equal(learn.getRoadmap(id).status, 404);
	});
});

describe("an Ultra build fills lazily", () => {
	it("fills the first track, then a later stage on request", async () => {
		const created = learn.createRoadmapRequest({ topic: "music theory", depth: "ultra", answers: [] });
		assert.equal(created.status, 201);
		const id = (created.body as { id: string }).id;
		const read = () => (learn.getRoadmap(id).body as { roadmap: Roadmap }).roadmap;
		await waitFor(() => read().status !== "building", 120_000);
		const roadmap = read();
		assert.equal(roadmap.status, "ready", roadmap.error);
		const first = roadmap.tracks[0]!.id;
		assert.ok(roadmap.stages.filter((s) => s.trackId === first).every((s) => s.fill === "filled"));
		const pending = roadmap.stages.find((s) => s.fill === "pending");
		assert.ok(pending, "later tracks wait until opened");
		assert.equal(learn.fillStageRequest(id, pending.id, {}).status, 202);
		await waitFor(() => read().stages.find((s) => s.id === pending.id)?.fill !== "filling", 60_000);
		const filled = read().stages.find((s) => s.id === pending.id)!;
		assert.equal(filled.fill, "filled", filled.error);
		assert.ok(filled.topics.length > 0);
		assert.equal(learn.fillStageRequest(id, "ghost", {}).status, 404);
	});
});
