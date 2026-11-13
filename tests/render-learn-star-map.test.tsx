/**
 * SSR pins — the Learn star map (components/learn/star-map.tsx) and its
 * legend. The map is the one Learn view a keyboard or screen-reader user
 * cannot eyeball, so the pins are about reachability: every topic is a
 * focusable star that says its status in words, the legend explains every
 * glyph, a pending stage offers its load action, the selection is marked.
 * Synthetic roadmap only.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MapLegend } from "@/components/learn/map-legend";
import { StarMap } from "@/components/learn/star-map";
import type { Roadmap, Stage, Topic, TopicState } from "@/src/core";

function topic(id: string, title: string, state: TopicState, prereqs: string[] = []): Topic {
	return { id, title, objective: "Learn it.", minutes: 20, prereqs, state };
}

function stage(id: string, title: string, topics: Topic[], hours: number): Stage {
	return {
		id,
		title,
		why: "It matters.",
		hours,
		query: title,
		prereqs: [],
		canon: [],
		topics,
		fill: topics.length > 0 ? "filled" : "pending",
		resources: { picks: [], more: [] },
	};
}

const ROADMAP: Roadmap = {
	version: 1,
	id: "rm_star",
	topic: "knots",
	depth: "high",
	createdAt: "2026-11-13T00:00:00.000Z",
	updatedAt: "2026-11-13T00:00:00.000Z",
	status: "ready",
	title: "Knots, from loops to hitches",
	volatility: "evergreen",
	research: false,
	hours: 6,
	priming: [],
	tracks: [],
	stages: [
		stage(
			"s1",
			"Basic loops",
			[
				topic("t1", "Overhand loop", "done"),
				topic("t2", "Figure eight", "learning", ["t1"]),
				topic("t3", "Bowline", "todo", ["t1"]),
				topic("t4", "Running bowline", "todo", ["t2"]),
			],
			2,
		),
		stage("s2", "Hitches", [topic("t5", "Clove hitch", "skipped"), topic("t6", "Trucker's hitch", "todo", ["t4"])], 1.5),
		stage("s3", "Splices", [], 2.5),
	],
	model: { provider: "faux", id: "faux" },
	spend: { usd: 0, calls: 0 },
	youtubeSearches: 0,
};

function render(selectedTopicId?: string): string {
	return renderToStaticMarkup(
		<StarMap roadmap={ROADMAP} selectedTopicId={selectedTopicId} onSelectTopic={() => {}} onOpenStage={() => {}} />,
	);
}

/** The opening tag of the element carrying `attr`. */
function tagWith(html: string, attr: string): string {
	const at = html.indexOf(attr);
	assert.ok(at > -1, `missing ${attr}`);
	return html.slice(html.lastIndexOf("<", at), html.indexOf(">", at) + 1);
}

describe("StarMap", () => {
	it("draws one focusable star per topic, named with its status in words", () => {
		const html = render();
		const stars = html.match(/<g[^>]*data-topic-id="[^"]+"[^>]*>/g) ?? [];
		assert.equal(stars.length, 6);
		for (const tag of stars) {
			assert.match(tag, /role="button"/);
			assert.match(tag, /tabindex="0"/);
		}
		const expected: [string, string][] = [
			["t1", "Overhand loop — Done"],
			["t2", "Figure eight — Learning"],
			["t3", "Bowline — Ready to start"],
			["t4", "Running bowline — Waiting on an earlier topic"],
			["t5", "Clove hitch — Skipped"],
			["t6", "Trucker&#x27;s hitch — Waiting on an earlier topic"],
		];
		for (const [id, label] of expected) {
			const tag = tagWith(html, `data-topic-id="${id}"`);
			assert.ok(tag.includes(`aria-label="${label}"`), `${id}: ${tag}`);
			assert.ok(tag.includes(`data-status=`), `${id} carries its status for styling`);
		}
	});

	it("gives every star a native tooltip", () => {
		const html = render();
		assert.match(html, /<title>Overhand loop — Done<\/title>/);
		assert.match(html, /<title>Bowline — Ready to start<\/title>/);
	});

	it("marks the selected star, and only it", () => {
		const html = render("t3");
		const selected = tagWith(html, 'data-topic-id="t3"');
		assert.match(selected, /aria-pressed="true"/);
		assert.match(selected, /data-selected="true"/);
		for (const id of ["t1", "t2", "t4", "t5", "t6"]) {
			const tag = tagWith(html, `data-topic-id="${id}"`);
			assert.match(tag, /aria-pressed="false"/);
			assert.ok(!tag.includes('data-selected="true"'));
		}
		assert.ok(!render().includes('data-selected="true"'), "no selection, no mark");
	});

	it("labels each stage with its number, progress and hours", () => {
		const html = render();
		assert.match(html, /BASIC LOOPS|Basic loops/);
		assert.match(html, /1 of 4 done · 2 h/);
		assert.match(html, /1 of 2 done · 1.5 h/);
		assert.match(html, /Start here/);
		for (const n of ["1", "2", "3"]) assert.ok(html.includes(`data-stage-number="${n}"`), `badge ${n}`);
	});

	it("offers to load a pending stage", () => {
		const html = render();
		const button = tagWith(html, 'data-load-stage="s3"');
		assert.match(button, /role="button"/);
		assert.match(button, /tabindex="0"/);
		assert.match(html, /Load this stage/);
		assert.equal((html.match(/data-load-stage=/g) ?? []).length, 1, "only the pending stage");
	});

	it("shows the legend inside the map, open by default", () => {
		const html = render();
		assert.match(html, /How to read the map/);
		for (const words of ["Done", "Learning", "Ready to start", "Waiting on an earlier topic", "Skipped"]) {
			assert.ok(html.includes(`>${words}<`), `legend row ${words}`);
		}
		assert.match(html, /Each star is a topic\. Each cluster is a stage, numbered in the order to learn them\./);
		assert.match(html, /Lines show what to learn first\. Click a star to see it and mark your progress\./);
		assert.match(html, /Hide legend/);
		assert.match(html, /aria-expanded="true"/);
	});

	it("has visible zoom controls", () => {
		const html = render();
		assert.match(html, /aria-label="Zoom in"/);
		assert.match(html, /aria-label="Zoom out"/);
		assert.match(html, /Reset view/);
	});
});

describe("MapLegend", () => {
	it("collapses to a Show legend toggle", () => {
		const html = renderToStaticMarkup(<MapLegend defaultOpen={false} />);
		assert.match(html, /Show legend/);
		assert.match(html, /aria-expanded="false"/);
		assert.ok(!html.includes("Waiting on an earlier topic"));
	});
});
