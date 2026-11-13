/**
 * Settings → Learn render tests: source toggles with their plain
 * descriptions, the "needs your key" hints with a way to add the key,
 * the YouTube quota meter, the daily limit with today's spend, and the
 * model line. Pure view, synthetic settings.
 */
import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { LearnSectionView } from "../components/settings/learn-section.tsx";
import { SOURCE_INFO, defaultLearnSettings, type LearnSettingsView } from "../src/core/index.ts";

const noop = () => {};

function view(overrides: Partial<LearnSettingsView> = {}): LearnSettingsView {
	const settings = { ...defaultLearnSettings(), dailyCeilingUsd: 0.5 };
	return {
		settings,
		sources: SOURCE_INFO.map((info) => ({
			id: info.id,
			label: info.label,
			description: info.description,
			...(info.key ? { key: info.key } : {}),
			enabled: settings.sources[info.id],
			available: !info.key,
			...(info.key ? { reason: "Key missing" } : {}),
		})),
		model: { provider: "synthetic", id: "cheap-1", name: "Cheap Model", fromSlot: true },
		youtube: { used: 12, limit: 100, resetsAt: "2026-11-14T08:00:00.000Z" },
		spentTodayUsd: 0.12,
		keys: { youtube: false, brave: false },
		...overrides,
	};
}

function render(v: LearnSettingsView) {
	return renderToStaticMarkup(
		<LearnSectionView view={v} catalog={undefined} onToggleSource={noop} onOpenKey={noop} onCeilingCommit={noop} onPickModel={noop} onClearModel={noop} onOpenAgent={noop} />,
	);
}

describe("LearnSectionView", () => {
	const html = render(view());

	it("lists every source with its description and a toggle", () => {
		for (const info of SOURCE_INFO) {
			assert.ok(html.includes(info.label), info.label);
		}
		assert.ok(html.includes("Short reference articles that explain each stage."));
		assert.ok(html.split('role="switch"').length - 1 >= SOURCE_INFO.length);
	});

	it("shows the key hints with a button to add each key", () => {
		assert.ok(html.includes("Needs your YouTube key"));
		assert.ok(html.includes("Needs your Brave key"));
		assert.ok(html.split("Add key").length - 1 >= 2);
	});

	it("shows the YouTube quota meter", () => {
		assert.ok(html.includes("12 of 100 searches used today, resets at"));
		assert.ok(html.includes('aria-valuenow="12"'));
		assert.ok(html.includes('aria-valuemax="100"'));
	});

	it("shows the daily limit with today's spend", () => {
		assert.ok(html.includes("Daily spending limit"));
		assert.ok(html.includes("Spent today: $0.12"));
		assert.ok(html.includes('value="0.50"'));
	});

	it("names the model and where it comes from", () => {
		assert.ok(html.includes("Learn uses Cheap Model (your cheap model slot)"));
		assert.ok(!html.includes("Use cheap slot"), "nothing to clear while the slot is used");
		const pinned = render(view({ model: { provider: "synthetic", id: "big-1", name: "Big Model", fromSlot: false }, settings: { ...defaultLearnSettings(), dailyCeilingUsd: 1, model: { provider: "synthetic", id: "big-1" } } }));
		assert.ok(pinned.includes("Learn uses Big Model (picked here)"));
		assert.ok(pinned.includes("Use cheap slot"));
	});

	it("with no model it points at the Agent settings", () => {
		const none = render(view({ model: null }));
		assert.ok(none.includes("No model yet"));
	});

	it("hides the key hints once the keys exist", () => {
		const keyed = render(view({ sources: view().sources.map((s) => ({ ...s, available: true })), keys: { youtube: true, brave: true } }));
		assert.ok(!keyed.includes("Needs your YouTube key"));
	});
});
