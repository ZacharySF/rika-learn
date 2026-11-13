/**
 * Learn settings (Settings → Learn): source toggles, the daily spending
 * limit, the model pin and the language — sanitized on read, patched on
 * write. Plus YouTube's quota day (midnight Pacific).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyLearnSettingsPatch, sanitizeLearnSettings, youtubeDay, youtubeResetsAt } from "../src/core/learn/settings.ts";
import { SOURCE_INFO, defaultLearnSettings } from "../src/core/learn/sources.ts";
import { SOURCE_IDS } from "../src/core/learn/contracts.ts";

describe("defaults", () => {
	it("every source has a toggle; Brave is off, the rest on; no limit yet", () => {
		const s = defaultLearnSettings();
		assert.deepEqual(Object.keys(s.sources).sort(), [...SOURCE_IDS].sort());
		assert.equal(s.sources.brave, false);
		assert.equal(s.sources.youtube, true);
		assert.equal(s.dailyCeilingUsd, null);
		assert.equal(s.model, undefined);
		assert.deepEqual(SOURCE_INFO.map((i) => i.id), [...SOURCE_IDS]);
	});
});

describe("sanitizeLearnSettings", () => {
	it("keeps valid fields and fills the rest from the defaults", () => {
		const s = sanitizeLearnSettings({ sources: { brave: true, wikipedia: false, nope: true }, dailyCeilingUsd: 0.5, language: "de", model: { provider: "openrouter", id: "qwen/qwen3.8-flash" } });
		assert.equal(s.sources.brave, true);
		assert.equal(s.sources.wikipedia, false);
		assert.equal(s.sources.youtube, true);
		assert.ok(!("nope" in s.sources));
		assert.equal(s.dailyCeilingUsd, 0.5);
		assert.equal(s.language, "de");
		assert.deepEqual(s.model, { provider: "openrouter", id: "qwen/qwen3.8-flash" });
	});

	it("drops broken values", () => {
		const s = sanitizeLearnSettings({ sources: "x", dailyCeilingUsd: -3, language: "", model: { provider: "x" } });
		assert.deepEqual(s, defaultLearnSettings());
		assert.deepEqual(sanitizeLearnSettings(null), defaultLearnSettings());
	});
});

describe("applyLearnSettingsPatch", () => {
	const base = defaultLearnSettings();

	it("sets the limit, toggles sources, pins and clears the model", () => {
		let r = applyLearnSettingsPatch(base, { dailyCeilingUsd: 0.25, sources: { hackernews: false } });
		assert.ok(r.ok);
		if (!r.ok) return;
		assert.equal(r.settings.dailyCeilingUsd, 0.25);
		assert.equal(r.settings.sources.hackernews, false);
		assert.equal(r.settings.sources.wikipedia, true, "untouched toggles stay");
		r = applyLearnSettingsPatch(r.settings, { model: { provider: "p", id: "m" } });
		assert.ok(r.ok && r.settings.model?.id === "m");
		if (!r.ok) return;
		r = applyLearnSettingsPatch(r.settings, { model: null });
		assert.ok(r.ok && r.settings.model === undefined, "null clears the pin (back to the cheap slot)");
	});

	it("refuses bad input with a plain message", () => {
		for (const bad of [[], "x", { dailyCeilingUsd: -1 }, { dailyCeilingUsd: 1e9 }, { sources: { youtube: "yes" } }, { sources: { mars: true } }, { model: { id: "m" } }, { language: 7 }]) {
			const r = applyLearnSettingsPatch(base, bad);
			assert.equal(r.ok, false, JSON.stringify(bad));
			if (!r.ok) assert.ok(r.error.length > 5);
		}
	});
});

describe("youtubeDay / youtubeResetsAt", () => {
	it("uses Pacific time (search quota resets at midnight Pacific)", () => {
		// 2026-11-13 07:30 UTC = 2026-11-12 23:30 PST
		const now = Date.UTC(2026, 10, 13, 7, 30);
		assert.equal(youtubeDay(now), "2026-11-12");
		assert.equal(youtubeResetsAt(now), new Date(Date.UTC(2026, 10, 13, 8, 0)).toISOString());
		assert.equal(youtubeDay(Date.UTC(2026, 10, 13, 8, 0)), "2026-11-13");
	});
});
