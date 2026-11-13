/**
 * Priming (docs/01-learn-design.md q3): up to three quick questions settle
 * the starting level before the build. The model writes them; the core
 * validates them and runs the one-question-at-a-time answer flow.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	MAX_PRIMING_QUESTIONS,
	NOT_SURE,
	answerPriming,
	parsePrimingQuestions,
	primingSummary,
	skipPriming,
	startPriming,
} from "../src/core/learn/priming.ts";

const three = {
	questions: [
		{ question: "Have you multiplied two matrices by hand?", options: ["Never", "Once or twice", "Often"] },
		{ question: "Which describes vectors for you?", options: [{ label: "New to me" }, { label: "Arrows with length" }, { label: "Elements of a vector space" }] },
		{ question: "Have you met eigenvalues?", options: ["No", "Heard of them", "I can compute them"] },
	],
};

describe("parsePrimingQuestions", () => {
	it("keeps at most three valid questions with ids", () => {
		const qs = parsePrimingQuestions(JSON.stringify({ questions: [...three.questions, three.questions[0]] }));
		assert.equal(qs.length, MAX_PRIMING_QUESTIONS);
		assert.deepEqual(qs.map((q) => q.id), ["q1", "q2", "q3"]);
		assert.deepEqual(qs[1]!.options.map((o) => o.label), ["New to me", "Arrows with length", "Elements of a vector space"]);
		assert.deepEqual(qs[0]!.options.map((o) => o.id), ["q1-o1", "q1-o2", "q1-o3"]);
	});

	it("drops questions with fewer than two real options and strips model-written 'not sure' options", () => {
		const qs = parsePrimingQuestions(
			JSON.stringify({
				questions: [
					{ question: "Only one?", options: ["Yes"] },
					{ question: "Level?", options: ["Beginner", "Beginner", "Not sure", "I don't know", "Advanced"] },
					{ question: "", options: ["a", "b"] },
				],
			}),
		);
		assert.equal(qs.length, 1);
		assert.deepEqual(qs[0]!.options.map((o) => o.label), ["Beginner", "Advanced"]);
	});

	it("caps options at four and accepts fenced JSON", () => {
		const qs = parsePrimingQuestions('```json\n{"questions":[{"question":"Pick","options":["a","b","c","d","e"]}]}\n```');
		assert.equal(qs[0]!.options.length, 4);
	});

	it("returns no questions for an unusable answer (the build can start straight away)", () => {
		assert.deepEqual(parsePrimingQuestions("I think you are a beginner."), []);
		assert.deepEqual(parsePrimingQuestions('{"questions":[]}'), []);
	});
});

describe("the answer flow", () => {
	const questions = parsePrimingQuestions(JSON.stringify(three));

	it("asks one question at a time and finishes after the last", () => {
		let state = startPriming(questions);
		assert.equal(state.index, 0);
		assert.equal(state.done, false);
		state = answerPriming(state, "Once or twice");
		assert.equal(state.index, 1);
		state = answerPriming(state, NOT_SURE);
		state = answerPriming(state, "No");
		assert.equal(state.done, true);
		assert.deepEqual(
			state.answers.map((a) => [a.questionId, a.answer]),
			[
				["q1", "Once or twice"],
				["q2", NOT_SURE],
				["q3", "No"],
			],
		);
	});

	it("refuses answers that are not one of the options", () => {
		const state = startPriming(questions);
		assert.throws(() => answerPriming(state, "Something else"));
	});

	it("skip ends the flow with the answers given so far", () => {
		let state = startPriming(questions);
		state = answerPriming(state, "Often");
		state = skipPriming(state);
		assert.equal(state.done, true);
		assert.equal(state.answers.length, 1);
		assert.throws(() => answerPriming(state, "Never"), /finished/);
	});

	it("no questions means the flow is already done", () => {
		assert.equal(startPriming([]).done, true);
	});
});

describe("primingSummary", () => {
	it("writes the answers for the build prompt", () => {
		const text = primingSummary([{ questionId: "q1", question: "Have you multiplied matrices?", answer: "Often" }]);
		assert.match(text, /Have you multiplied matrices\?/);
		assert.match(text, /Often/);
	});

	it("says so when the learner skipped", () => {
		assert.match(primingSummary([]), /skipped/i);
	});
});
