/**
 * Roadmap view render tests: the header, the Timeline | Map toggle, the
 * stage card (picks first, then "More (n)", the topic progress control,
 * prerequisites in plain words) and the pending / filling / error states,
 * plus the map's topic details panel. Pure components, synthetic roadmap.
 */
import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ResourceList, StageCard, TopicProgress } from "../components/learn/stage-card.tsx";
import { RoadmapHeader, TopicDetails, ViewToggle } from "../components/learn/roadmap-parts.tsx";
import { CalendarForm } from "../components/learn/stage-actions.tsx";
import { indexRoadmap } from "../components/learn/roadmap-index.ts";
import type { Resource, Roadmap, Stage } from "../src/core/index.ts";

const noop = () => {};

function resource(overrides: Partial<Resource>): Resource {
	return {
		id: overrides.url ?? "https://example.test/r",
		source: "wikipedia",
		kind: "reading",
		title: "Synthetic resource",
		url: "https://example.test/r",
		reason: "Explains the basics",
		score: 1,
		...overrides,
	};
}

function stage(overrides: Partial<Stage>): Stage {
	return {
		id: "s1",
		title: "Stage title",
		why: "Why it matters",
		hours: 2,
		query: "synthetic query",
		prereqs: [],
		canon: [],
		topics: [],
		fill: "filled",
		resources: { picks: [], more: [] },
		...overrides,
	};
}

const filled = stage({
	id: "s2",
	title: "Matrices as maps",
	why: "Every later idea is a matrix acting on space",
	hours: 1.5,
	prereqs: ["s1"],
	topics: [
		{ id: "t3", title: "Matrix product", objective: "Compute the product of two matrices.", minutes: 25, prereqs: ["t1"], state: "learning" },
		{ id: "t4", title: "Identity matrix", objective: "Recognise the identity and what it does.", minutes: 10, prereqs: [], state: "todo" },
	],
	resources: {
		picks: [
			resource({ id: "v1", kind: "reading", source: "wikipedia", title: "Matrix multiplication article", url: "https://example.test/article" }),
			resource({
				id: "v2",
				kind: "video",
				source: "youtube",
				title: "Synthetic video lecture",
				url: "https://example.test/watch",
				by: "Synthetic Channel",
				minutes: 17,
				thumbnail: "https://example.test/thumb.jpg",
				reason: "Named by the roadmap · 17 min",
			}),
		],
		more: [
			resource({ id: "m1", title: "More one", url: "https://example.test/m1", kind: "exercise", source: "freecodecamp" }),
			resource({ id: "m2", title: "More two", url: "https://example.test/m2", kind: "book", source: "openlibrary" }),
			resource({ id: "m3", title: "More three", url: "https://example.test/m3", kind: "paper", source: "arxiv" }),
		],
	},
});

const roadmap: Roadmap = {
	version: 1,
	id: "rm_test",
	topic: "linear algebra",
	depth: "ultra",
	createdAt: "2026-11-01T00:00:00Z",
	updatedAt: "2026-11-01T00:00:00Z",
	status: "building",
	title: "Synthetic linear algebra",
	level: { label: "Comfortable with vectors", summary: "Knows vectors, new to matrices." },
	volatility: "evergreen",
	research: false,
	hours: 130,
	priming: [],
	tracks: [{ id: "k1", title: "Foundations", why: "The base" }],
	stages: [
		stage({
			id: "s1",
			trackId: "k1",
			title: "Vectors",
			topics: [
				{ id: "t1", title: "Vector addition", objective: "Add two vectors.", minutes: 10, prereqs: [], state: "done" },
				{ id: "t2", title: "Scaling", objective: "Scale a vector.", minutes: 10, prereqs: [], state: "todo" },
			],
		}),
		{ ...filled, trackId: "k1" },
		stage({ id: "s3", trackId: "k1", title: "Later stage", fill: "pending" }),
	],
	model: { provider: "synthetic", id: "cheap-1" },
	spend: { usd: 0.02, calls: 2 },
	youtubeSearches: 2,
};

const index = indexRoadmap(roadmap);

function card(s: Stage, number: number, expanded = true) {
	return renderToStaticMarkup(
		<StageCard stage={s} number={number} index={index} expanded={expanded} onToggle={noop} onRetry={noop} onSetTopic={noop} onTeach={noop} actions={<span>stage-actions-slot</span>} />,
	);
}

describe("StageCard (filled)", () => {
	const html = card({ ...filled, trackId: "k1" }, 2);

	it("shows title, why, hours and the stage it needs first", () => {
		assert.ok(html.includes("Matrices as maps"));
		assert.ok(html.includes("Every later idea is a matrix acting on space"));
		assert.ok(html.includes("1.5 h"));
		assert.ok(html.includes("Learn first: Stage 1"));
	});

	it("lists the picks with the video first, then More (n)", () => {
		const video = html.indexOf("Synthetic video lecture");
		const reading = html.indexOf("Matrix multiplication article");
		const more = html.indexOf("More (3)");
		assert.ok(video > -1 && reading > -1 && more > -1);
		assert.ok(video < reading, "video first");
		assert.ok(reading < more, "More comes after the picks");
		assert.ok(html.includes('src="https://example.test/thumb.jpg"'));
		assert.ok(html.includes("Synthetic Channel"));
		assert.ok(html.includes("17 min"));
		assert.ok(html.includes("Reading"));
		assert.ok(html.includes("Wikipedia"));
		assert.ok(html.includes("Explains the basics"));
		assert.ok(html.includes("More one") && html.includes("Exercise"));
	});

	it("opens every link in a new tab without leaking the opener", () => {
		const links = html.match(/<a [^>]*href="https:\/\/example\.test[^"]*"[^>]*>/g) ?? [];
		assert.ok(links.length >= 5);
		for (const link of links) {
			assert.ok(link.includes('target="_blank"'), link);
			assert.ok(link.includes('rel="noopener noreferrer"'), link);
		}
	});

	it("shows topics with objective, minutes, needs and the progress control", () => {
		assert.ok(html.includes("Compute the product of two matrices."));
		assert.ok(html.includes("25 min"));
		assert.ok(html.includes("Needs: Vector addition"));
		assert.ok(html.includes("stage-actions-slot"));
		assert.ok(html.includes("Teach me this"));
	});
});

describe("TopicProgress", () => {
	it("is a three-button control with the active state pressed", () => {
		const html = renderToStaticMarkup(<TopicProgress state="learning" title="Matrix product" onChange={noop} />);
		assert.ok(html.includes(">Done<") && html.includes(">Learning<") && html.includes(">Skip<"));
		assert.match(html, /aria-pressed="true"[^>]*>Learning</);
		assert.equal(html.split('aria-pressed="true"').length - 1, 1);
	});
});

describe("StageCard states", () => {
	it("pending: collapsed with Not loaded yet and no topics", () => {
		const html = card(stage({ id: "s3", title: "Later stage", fill: "pending" }), 3, false);
		assert.ok(html.includes("Not loaded yet"));
		assert.ok(html.includes('aria-expanded="false"'));
		assert.ok(!html.includes("stage-actions-slot"));
	});

	it("filling: a working line", () => {
		const html = card(stage({ fill: "filling" }), 1);
		assert.ok(html.includes("Finding topics and resources…"));
	});

	it("error: the message and a Retry", () => {
		const html = card(stage({ fill: "error", error: "The model did not answer." }), 1);
		assert.ok(html.includes("The model did not answer."));
		assert.ok(html.includes("Retry"));
	});
});

describe("RoadmapHeader", () => {
	const html = renderToStaticMarkup(<RoadmapHeader roadmap={roadmap} index={index} connected />);

	it("shows title, topic, depth with span, level, progress and hours", () => {
		assert.ok(html.includes("Synthetic linear algebra"));
		assert.ok(html.includes("linear algebra"));
		assert.ok(html.includes("Ultra · a semester"));
		assert.ok(html.includes("Comfortable with vectors"));
		assert.ok(html.includes("1 of 4 topics done"));
		assert.ok(html.includes("130 h"));
		assert.ok(html.includes("Connected to rika"));
	});

	it("says it is still building", () => {
		assert.ok(html.includes("Building… stages appear as they are written"));
	});
});

describe("ViewToggle", () => {
	it("offers Timeline and Map with the current one pressed", () => {
		const html = renderToStaticMarkup(<ViewToggle view="timeline" onChange={noop} />);
		assert.match(html, /aria-pressed="true"[^>]*>Timeline</);
		assert.match(html, /aria-pressed="false"[^>]*>Map</);
	});
});

describe("TopicDetails", () => {
	it("shows the topic, its status, the progress control, the stage's picks and Show in timeline", () => {
		const html = renderToStaticMarkup(<TopicDetails roadmap={roadmap} index={index} topicId="t3" onSetTopic={noop} onShowInTimeline={noop} onTeach={noop} />);
		assert.ok(html.includes("Matrix product"));
		assert.ok(html.includes("Compute the product of two matrices."));
		assert.ok(html.includes("Learning"));
		assert.ok(html.includes("Synthetic video lecture"));
		assert.ok(html.includes("Show in timeline"));
	});

	it("asks to pick a star when nothing is selected", () => {
		const html = renderToStaticMarkup(<TopicDetails roadmap={roadmap} index={index} topicId={null} onSetTopic={noop} onShowInTimeline={noop} />);
		assert.ok(html.includes("Pick a star"));
	});
});

describe("CalendarForm", () => {
	it("defaults to tomorrow at 18:00 for 60 minutes", () => {
		const html = renderToStaticMarkup(<CalendarForm today={new Date(2026, 10, 13, 9)} busy={false} onSubmit={noop} onCancel={noop} />);
		assert.ok(html.includes('value="2026-11-14"'));
		assert.ok(html.includes('value="18:00"'));
		assert.ok(html.includes('value="60"'));
	});
});

describe("resource lines say each thing once", () => {
	const html = renderToStaticMarkup(
		<ResourceList
			resources={{
				picks: [
					resource({ id: "y", kind: "video", source: "youtube", title: "Video pick", url: "https://example.test/y", by: "Synthetic Channel", minutes: 17, reason: "Recommended for this stage · Has captions" }),
					resource({ id: "w", source: "wikipedia", title: "Article pick", url: "https://example.test/w", by: "Wikipedia", minutes: 11, reason: "Wikipedia overview" }),
				],
				more: [
					resource({ id: "m", kind: "course", source: "mitlearn", title: "Course pick", url: "https://example.test/m", by: "MIT OpenCourseWare", minutes: 40, reason: "University course" }),
					resource({ id: "h", kind: "discussion", source: "hackernews", title: "Thread pick", url: "https://example.test/h", by: "synthetic-user", reason: "hacker news" }),
				],
			}}
		/>,
	);
	const occurrences = (needle: string) => html.split(needle).length - 1;

	it("shows the source label once, then a different author, then minutes", () => {
		assert.ok(!html.includes("Wikipedia · Wikipedia"));
		assert.ok(html.includes(">Wikipedia · 11 min<"));
		assert.ok(html.includes(">YouTube · Synthetic Channel · 17 min<"));
		assert.ok(html.includes(">Hacker News · synthetic-user<"));
	});

	it("drops an author the source label already names", () => {
		assert.ok(html.includes(">MIT Learn / OpenCourseWare · 40 min<"));
		assert.ok(!html.includes("MIT OpenCourseWare"));
	});

	it("shows the reason once, and not at all when it only repeats the source", () => {
		assert.equal(occurrences("Wikipedia overview"), 1);
		assert.equal(occurrences("Recommended for this stage · Has captions"), 1);
		assert.equal(occurrences("University course"), 1);
		assert.equal(occurrences(">hacker news<"), 0);
	});
});
