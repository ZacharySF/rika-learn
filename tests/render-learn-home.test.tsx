/**
 * Learn entry render tests: the five-step depth picker, the cost hint,
 * the saved-roadmaps list, the one-question-at-a-time priming step and
 * the two spending dialogs. Pure components, SSR via renderToStaticMarkup
 * (same classic-JSX shim as render-sidebar.test.tsx). Synthetic data only.
 */
import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DepthPicker } from "../components/learn/depth-picker.tsx";
import { PrimingQuestions, WorkingState } from "../components/learn/priming.tsx";
import { CeilingDialog, ModelNeededDialog, ReviewSheet } from "../components/learn/spend-dialogs.tsx";
import { CostHint, RoadmapList, costHintText } from "../components/learn/learn-home.tsx";
import type { PrimingQuestion, RoadmapSummary, SpendReview } from "../src/core/index.ts";

const noop = () => {};

function count(html: string, needle: string): number {
	return html.split(needle).length - 1;
}

describe("DepthPicker", () => {
	const html = renderToStaticMarkup(<DepthPicker value="normal" onChange={noop} />);

	it("shows five steps, each with its name and time span", () => {
		assert.equal(count(html, 'type="radio"'), 5);
		const steps: [string, string][] = [
			["Normal", "a couple of hours"],
			["High", "a few hours"],
			["Super", "a couple of weeks"],
			["Ultra", "a semester"],
			["Ultraviolet", "semesters to years"],
		];
		for (const [label, span] of steps) {
			assert.ok(html.includes(`>${label}<`), label);
			assert.ok(html.includes(span), span);
		}
		assert.ok(html.includes('role="radiogroup"'));
	});

	it("has Normal checked and only Normal", () => {
		const normal = html.match(/<input[^>]*value="normal"[^>]*>/)?.[0] ?? "";
		assert.ok(normal.includes('checked=""'), normal);
		assert.equal(count(html, 'checked=""'), 1);
	});

	it("explains the chosen depth in plain words", () => {
		assert.match(html, /3–5 stages/);
	});
});

describe("CostHint", () => {
	it("names the model, the price and the YouTube searches left", () => {
		assert.equal(
			costHintText({ modelName: "Cheap Model", usd: 0.031, youtubeLeft: 88 }),
			"Uses Cheap Model · about $0.03 · 88 YouTube searches left today",
		);
		assert.equal(costHintText({ modelName: "Cheap Model", usd: 0.001, youtubeLeft: null }), "Uses Cheap Model · less than $0.01");
		const html = renderToStaticMarkup(<CostHint modelName={null} usd={null} youtubeLeft={null} onOpenSettings={noop} />);
		assert.ok(html.includes("No model picked yet"));
	});
});

describe("RoadmapList", () => {
	const roadmaps: RoadmapSummary[] = [
		{ id: "rm_a", topic: "synthetic topic", title: "Synthetic roadmap A", depth: "high", status: "ready", createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-02T00:00:00Z", topics: 12, done: 3 },
		{ id: "rm_b", topic: "other topic", title: "Synthetic roadmap B", depth: "ultra", status: "building", createdAt: "2026-11-03T00:00:00Z", updatedAt: "2026-11-03T00:00:00Z", topics: 0, done: 0 },
	];
	const html = renderToStaticMarkup(<RoadmapList roadmaps={roadmaps} onDelete={noop} />);

	it("shows title, depth, progress and status per roadmap", () => {
		assert.ok(html.includes("Synthetic roadmap A"));
		assert.ok(html.includes("3 of 12 topics done"));
		assert.ok(html.includes("High"));
		assert.ok(html.includes("Ready"));
		assert.ok(html.includes("Building"));
		assert.ok(html.includes('href="/learn/rm_a"'));
	});

	it("offers a delete per roadmap, named after it", () => {
		assert.ok(html.includes('aria-label="Delete Synthetic roadmap A"'));
		assert.ok(html.includes('aria-label="Delete Synthetic roadmap B"'));
	});

	it("says so when there are none", () => {
		assert.ok(renderToStaticMarkup(<RoadmapList roadmaps={[]} onDelete={noop} />).includes("No roadmaps yet"));
	});
});

describe("PrimingQuestions", () => {
	const question: PrimingQuestion = {
		id: "q1",
		question: "Have you multiplied two matrices before?",
		options: [
			{ id: "a", label: "Never" },
			{ id: "b", label: "A few times" },
			{ id: "c", label: "Often" },
		],
	};
	const html = renderToStaticMarkup(<PrimingQuestions question={question} index={0} total={3} onAnswer={noop} onSkip={noop} />);

	it("shows one question with its position", () => {
		assert.ok(html.includes("A few quick questions so the roadmap starts at your level"));
		assert.ok(html.includes("Question 1 of 3"));
		assert.ok(html.includes("Have you multiplied two matrices before?"));
	});

	it("offers every option plus Not sure and Skip questions", () => {
		for (const label of ["Never", "A few times", "Often", "Not sure", "Skip questions"]) assert.ok(html.includes(label), label);
	});

	it("the working state says what is happening", () => {
		const working = renderToStaticMarkup(<WorkingState label="Writing your questions…" />);
		assert.ok(working.includes("Writing your questions…"));
		assert.ok(working.includes('role="status"'));
	});
});

describe("spending dialogs", () => {
	const review: SpendReview = { phase: "build", estimateUsd: 0.12, spentTodayUsd: 0.45, ceilingUsd: 0.5, model: "Cheap Model" };

	it("the review sheet shows estimate, spent today, limit and model", () => {
		const html = renderToStaticMarkup(<ReviewSheet review={review} onApprove={noop} onChangeLimit={noop} onCancel={noop} />);
		assert.ok(html.includes("This would go over today&#x27;s limit"));
		assert.ok(html.includes("$0.12"));
		assert.ok(html.includes("$0.45"));
		assert.ok(html.includes("$0.50"));
		assert.ok(html.includes("Cheap Model"));
		for (const label of ["Go ahead this time", "Change limit", "Cancel"]) assert.ok(html.includes(label), label);
		assert.ok(html.includes('role="dialog"'));
	});

	it("the first-run dialog explains the limit and defaults to $0.50", () => {
		const html = renderToStaticMarkup(<CeilingDialog initialUsd={null} onSave={noop} onCancel={noop} />);
		assert.ok(html.includes("Set a daily spending limit"));
		assert.ok(html.includes("your own provider key"));
		assert.ok(html.includes('value="0.50"'));
		assert.ok(html.includes("Save"));
	});

	it("the model notice points at Settings", () => {
		const html = renderToStaticMarkup(<ModelNeededDialog message="No model is set up." onOpenSettings={noop} onCancel={noop} />);
		assert.ok(html.includes("No model is set up."));
		assert.ok(html.includes("Open Settings"));
	});
});
