/**
 * Spending (docs/01-learn-design.md q11): calls under the learner's daily
 * limit run without asking; the first run asks for a limit; anything over
 * it goes to a review sheet.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decideSpend, estimateLearnCost, estimateLearnTokens, localDay, spentOnDay } from "../src/core/learn/cost.ts";

const flash = { input: 0.15, output: 0.47 }; // USD per million tokens

describe("estimateLearnTokens / estimateLearnCost", () => {
	it("grows with depth (lazy depths count only the eager first track)", () => {
		const cost = (d: "normal" | "high" | "super" | "ultra" | "ultraviolet") => estimateLearnCost(d, "build", flash, { youtube: true }).usd;
		assert.ok(cost("high") > cost("normal"));
		assert.ok(cost("super") > cost("high"));
		assert.ok(cost("ultraviolet") > cost("ultra"));
		assert.ok(cost("ultra") > cost("high"));
	});

	it("stays near the research estimates on a flash-class model", () => {
		const normal = estimateLearnCost("normal", "build", flash, { youtube: true });
		assert.ok(normal.usd < 0.01, `normal build ${normal.usd}`);
		const uv = estimateLearnCost("ultraviolet", "build", flash, { youtube: true });
		assert.ok(uv.usd < 0.1, `eager ultraviolet ${uv.usd}`);
	});

	it("counts one YouTube search per eagerly filled stage", () => {
		assert.equal(estimateLearnTokens("normal", "build", { youtube: true }).youtubeSearches, 5);
		assert.equal(estimateLearnTokens("ultra", "build", { youtube: true }).youtubeSearches, 4, "first track only");
		assert.equal(estimateLearnTokens("normal", "build", { youtube: false }).youtubeSearches, 0);
		assert.equal(estimateLearnTokens("ultra", "fill", { youtube: true }).youtubeSearches, 1);
	});

	it("priming and stage fill are single small calls", () => {
		assert.equal(estimateLearnTokens("super", "prime", { youtube: true }).calls, 1);
		assert.equal(estimateLearnTokens("super", "fill", { youtube: true }).calls, 1);
		assert.ok(estimateLearnCost("normal", "prime", flash, { youtube: false }).usd < 0.001);
	});

	it("Super fills every stage in the build; Normal writes topics in the skeleton", () => {
		assert.equal(estimateLearnTokens("normal", "build", { youtube: false }).calls, 1);
		assert.equal(estimateLearnTokens("super", "build", { youtube: false }).calls, 11);
	});

	it("a free model costs nothing", () => {
		assert.equal(estimateLearnCost("ultraviolet", "build", { input: 0, output: 0 }, { youtube: false }).usd, 0);
	});
});

describe("spentOnDay", () => {
	const now = new Date(2026, 10, 13, 15, 0, 0);
	it("sums today's entries in local time", () => {
		const entries = [
			{ at: new Date(2026, 10, 13, 0, 5).toISOString(), usd: 0.01 },
			{ at: new Date(2026, 10, 13, 14, 0).toISOString(), usd: 0.02 },
			{ at: new Date(2026, 10, 12, 23, 59).toISOString(), usd: 5 },
			{ at: "garbage", usd: 9 },
		];
		assert.equal(Number(spentOnDay(entries, now).toFixed(6)), 0.03);
	});

	it("localDay formats YYYY-MM-DD", () => {
		assert.equal(localDay(now), "2026-11-13");
	});
});

describe("decideSpend", () => {
	const base = { estimateUsd: 0.01, spentTodayUsd: 0.2, phase: "build" as const, model: "Qwen Flash" };

	it("asks for a limit on first run", () => {
		assert.deepEqual(decideSpend({ ...base, ceilingUsd: null, approved: false }), { kind: "needs-ceiling" });
		assert.deepEqual(decideSpend({ ...base, ceilingUsd: null, approved: true }), { kind: "needs-ceiling" }, "approval does not replace the limit");
	});

	it("runs without asking under the limit (including exactly at it)", () => {
		assert.deepEqual(decideSpend({ ...base, ceilingUsd: 0.5, approved: false }), { kind: "auto" });
		assert.deepEqual(decideSpend({ ...base, ceilingUsd: 0.21, approved: false }), { kind: "auto" });
	});

	it("shows a review sheet over the limit, with the numbers", () => {
		const decision = decideSpend({ ...base, ceilingUsd: 0.2, approved: false });
		assert.equal(decision.kind, "review");
		if (decision.kind === "review") {
			assert.deepEqual(decision.review, { phase: "build", estimateUsd: 0.01, spentTodayUsd: 0.2, ceilingUsd: 0.2, model: "Qwen Flash" });
		}
	});

	it("an explicit approval lets one call through over the limit", () => {
		assert.deepEqual(decideSpend({ ...base, ceilingUsd: 0.2, approved: true }), { kind: "auto" });
	});

	it("a zero limit reviews every paid call but lets free ones run", () => {
		assert.equal(decideSpend({ ...base, spentTodayUsd: 0, ceilingUsd: 0, approved: false }).kind, "review");
		assert.equal(decideSpend({ ...base, estimateUsd: 0, spentTodayUsd: 0, ceilingUsd: 0, approved: false }).kind, "auto");
	});
});
