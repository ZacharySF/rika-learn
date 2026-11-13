/**
 * PRIMING (docs/01-learn-design.md q3): up to three quick multiple-choice
 * questions settle the learner's starting level before the build. The
 * model writes them (src/agent/learn/priming.ts, using the prober's
 * floor-and-ceiling doctrine); this module validates them and runs the
 * one-question-at-a-time flow the UI shows.
 */
import type { PrimingAnswer, PrimingQuestion } from "./contracts.ts";
import { extractJsonObject, normalizeTitle } from "./roadmap.ts";

export const MAX_PRIMING_QUESTIONS = 3;
const MAX_OPTIONS = 4;
/** The UI adds this option to every question. */
export const NOT_SURE = "Not sure";

const UNSURE = new Set(["not sure", "i don t know", "i dont know", "unsure", "don t know", "no idea"]);

function optionLabel(raw: unknown): string {
	const value = typeof raw === "object" && raw !== null && "label" in raw ? raw.label : raw;
	return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, 120) : "";
}

/** A model answer → at most three questions with 2–4 distinct options. */
export function parsePrimingQuestions(answer: string): PrimingQuestion[] {
	const json = extractJsonObject(answer);
	if (!json || !Array.isArray(json.questions)) return [];
	const out: PrimingQuestion[] = [];
	for (const raw of json.questions) {
		if (out.length >= MAX_PRIMING_QUESTIONS) break;
		if (typeof raw !== "object" || raw === null || !("question" in raw) || !("options" in raw)) continue;
		const question = typeof raw.question === "string" ? raw.question.replace(/\s+/g, " ").trim().slice(0, 200) : "";
		if (!question || !Array.isArray(raw.options)) continue;
		const labels: string[] = [];
		const seen = new Set<string>();
		for (const option of raw.options) {
			const label = optionLabel(option);
			const norm = normalizeTitle(label);
			if (!label || seen.has(norm) || UNSURE.has(norm)) continue;
			seen.add(norm);
			labels.push(label);
			if (labels.length >= MAX_OPTIONS) break;
		}
		if (labels.length < 2) continue;
		const id = `q${out.length + 1}`;
		out.push({ id, question, options: labels.map((label, i) => ({ id: `${id}-o${i + 1}`, label })) });
	}
	return out;
}

export interface PrimingState {
	questions: PrimingQuestion[];
	/** The question being asked. */
	index: number;
	answers: PrimingAnswer[];
	done: boolean;
}

export function startPriming(questions: PrimingQuestion[]): PrimingState {
	return { questions, index: 0, answers: [], done: questions.length === 0 };
}

/** Answer the current question with one of its labels or NOT_SURE. */
export function answerPriming(state: PrimingState, label: string): PrimingState {
	if (state.done) throw new Error("priming is finished");
	const question = state.questions[state.index];
	if (!question) throw new Error("priming is finished");
	if (label !== NOT_SURE && !question.options.some((o) => o.label === label)) {
		throw new Error(`"${label}" is not an answer to "${question.question}"`);
	}
	const answers = [...state.answers, { questionId: question.id, question: question.question, answer: label }];
	const index = state.index + 1;
	return { questions: state.questions, index, answers, done: index >= state.questions.length };
}

/** "Skip questions": build with whatever was answered so far. */
export function skipPriming(state: PrimingState): PrimingState {
	return { ...state, done: true };
}

/** The answers as the build prompt reads them. */
export function primingSummary(answers: readonly PrimingAnswer[]): string {
	if (answers.length === 0) return "The learner skipped the questions; infer the level from the request and start gently.";
	return answers.map((a) => `Q: ${a.question}\nA: ${a.answer}`).join("\n");
}
