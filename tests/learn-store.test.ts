/**
 * The Learn store (data/learn/): roadmaps, settings, the spend ledger, the
 * YouTube quota, the source cache and the bridge outbox. Runs against a
 * temp directory; synthetic data only.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { createLearnStore } from "../src/store/learn.ts";
import type { BridgeMessage, Roadmap } from "../src/core/learn/contracts.ts";

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "rl-learn-store-"));
after(() => fs.rmSync(ROOT, { recursive: true, force: true }));

function roadmap(id: string): Roadmap {
	return {
		version: 1,
		id,
		topic: "synthetic topic",
		depth: "normal",
		createdAt: "2026-11-13T10:00:00.000Z",
		updatedAt: "2026-11-13T10:00:00.000Z",
		status: "building",
		title: "",
		volatility: "evergreen",
		research: false,
		hours: 0,
		priming: [],
		tracks: [],
		stages: [],
		model: { provider: "faux", id: "m" },
		spend: { usd: 0, calls: 0 },
		youtubeSearches: 0,
	};
}

describe("roadmaps", () => {
	const store = createLearnStore(path.join(ROOT, "a"));

	it("saves, lists newest first, updates and deletes", () => {
		store.saveRoadmap(roadmap("rm_one"));
		store.saveRoadmap({ ...roadmap("rm_two"), createdAt: "2026-11-13T11:00:00.000Z" });
		assert.deepEqual(store.listRoadmaps().map((r) => r.id), ["rm_two", "rm_one"]);
		const updated = store.updateRoadmap("rm_one", (r) => {
			r.title = "Changed";
		});
		assert.equal(updated?.title, "Changed");
		assert.notEqual(updated?.updatedAt, "2026-11-13T10:00:00.000Z", "updatedAt moves");
		assert.equal(store.getRoadmap("rm_one")?.title, "Changed");
		assert.equal(store.updateRoadmap("rm_missing", () => {}), null);
		assert.equal(store.deleteRoadmap("rm_two"), true);
		assert.equal(store.deleteRoadmap("rm_two"), false);
		assert.equal(store.getRoadmap("rm_two"), null);
	});

	it("refuses ids that could escape the folder", () => {
		assert.equal(store.getRoadmap("../settings"), null);
		assert.throws(() => store.saveRoadmap(roadmap("../evil")));
	});

	it("skips corrupt files", () => {
		fs.writeFileSync(path.join(ROOT, "a", "roadmaps", "rm_bad.json"), "{nope");
		assert.ok(store.listRoadmaps().every((r) => r.id !== "rm_bad"));
		assert.equal(store.getRoadmap("rm_bad"), null);
	});
});

describe("settings", () => {
	it("reads defaults, writes sanitized values", () => {
		const store = createLearnStore(path.join(ROOT, "b"));
		assert.equal(store.readSettings().dailyCeilingUsd, null);
		const saved = store.writeSettings({ ...store.readSettings(), dailyCeilingUsd: 0.5 });
		assert.equal(saved.dailyCeilingUsd, 0.5);
		assert.equal(createLearnStore(path.join(ROOT, "b")).readSettings().dailyCeilingUsd, 0.5);
	});
});

describe("spend ledger", () => {
	it("appends entries and reads them back, tolerating a corrupt line", () => {
		const store = createLearnStore(path.join(ROOT, "c"));
		store.appendSpend({ at: "2026-11-13T10:00:00.000Z", usd: 0.01, phase: "build", model: "faux/m", roadmapId: "rm_one" });
		fs.appendFileSync(path.join(ROOT, "c", "spend.jsonl"), "garbage\n");
		store.appendSpend({ at: "2026-11-13T11:00:00.000Z", usd: 0.02, phase: "fill", model: "faux/m" });
		assert.deepEqual(store.readSpend().map((e) => e.usd), [0.01, 0.02]);
	});
});

describe("YouTube quota", () => {
	it("counts searches per Pacific day and stops at the limit", () => {
		const store = createLearnStore(path.join(ROOT, "d"));
		const day1 = Date.UTC(2026, 10, 13, 20, 0);
		assert.equal(store.youtubeUsed(day1), 0);
		for (let i = 0; i < 100; i++) assert.equal(store.youtubeSpend(day1), true);
		assert.equal(store.youtubeSpend(day1), false, "the 101st search is refused");
		assert.equal(store.youtubeUsed(day1), 100);
		assert.equal(store.youtubeUsed(day1 + 86_400_000), 0, "next day resets");
	});
});

describe("source cache", () => {
	it("returns values younger than the max age only", () => {
		let now = 1_000_000;
		const store = createLearnStore(path.join(ROOT, "e"), () => now);
		store.cache.set("youtube:q", { ids: ["a"] });
		assert.deepEqual(store.cache.get("youtube:q", 1000), { ids: ["a"] });
		now += 2000;
		assert.equal(store.cache.get("youtube:q", 1000), undefined);
		assert.equal(store.cache.get("missing", 1000), undefined);
	});
});

describe("bridge outbox", () => {
	it("adds, lists and acks messages", () => {
		const store = createLearnStore(path.join(ROOT, "f"));
		const message: BridgeMessage = {
			source: "rika-learn",
			version: 1,
			id: "m1",
			type: "flashcards",
			payload: { deck: "Learn::X::Y", tags: [], roadmap: { id: "r", title: "R" }, stage: { id: "s", title: "S" }, cards: [] },
		};
		const item = store.outboxAdd(message);
		assert.ok(item.id);
		assert.equal(store.outboxList().length, 1);
		assert.equal(store.outboxList()[0]!.message.id, "m1");
		assert.equal(store.outboxAck([item.id, "unknown"]), 1);
		assert.equal(store.outboxList().length, 0);
	});
});
