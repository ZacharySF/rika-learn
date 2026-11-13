/**
 * SPENDING (docs/01-learn-design.md q11, research/07 §4.4). Learn estimates
 * each call (or batch) from a token budget per depth and the model's
 * catalogue price, then decides: no limit yet → ask for one; under the
 * daily limit → run; over it → review sheet. The real cost of every call
 * is recorded afterwards from the provider's usage report.
 */
import type { CostEstimate, DepthId, SpendDecision, SpendPhase } from "./contracts.ts";
import { depthSpec } from "./depth.ts";

/** USD per million tokens, as pi-ai's model catalogue reports it. */
export interface ModelPrice {
	input: number;
	output: number;
}

export type TokenEstimate = Omit<CostEstimate, "usd">;

// Token budgets [INFERENCE from research/07 §4.4]: the system prompts are
// byte-stable; outputs are ~90 tokens per stage line and ~70 per topic.
const PRIME = { input: 1400, output: 450 };
const SKELETON_INPUT = 2200;
const FILL_INPUT = 1700;
const TOKENS_PER_STAGE = 90;
const TOKENS_PER_TRACK = 60;
const TOKENS_PER_TOPIC = 70;
const CANON_TOKENS = 160;
const HEADER_TOKENS = 200;

function fillOutput(depth: DepthId): number {
	return HEADER_TOKENS / 2 + depthSpec(depth).topicsPerStage.max * TOKENS_PER_TOPIC + CANON_TOKENS;
}

export function estimateLearnTokens(depth: DepthId, phase: SpendPhase, opts: { youtube: boolean }): TokenEstimate {
	const spec = depthSpec(depth);
	if (phase === "prime") return { calls: 1, inputTokens: PRIME.input, outputTokens: PRIME.output, youtubeSearches: 0 };
	if (phase === "fill") {
		return { calls: 1, inputTokens: FILL_INPUT, outputTokens: fillOutput(depth), youtubeSearches: opts.youtube ? 1 : 0 };
	}
	const skeletonOut =
		HEADER_TOKENS +
		(spec.tracks?.max ?? 0) * TOKENS_PER_TRACK +
		spec.stages.max * TOKENS_PER_STAGE +
		(spec.topicsInSkeleton ? spec.topics.max * TOKENS_PER_TOPIC : 0);
	const eagerStages = spec.lazy ? (spec.stagesPerTrack?.max ?? 0) : spec.stages.max;
	const fills = spec.topicsInSkeleton ? 0 : eagerStages;
	return {
		calls: 1 + fills,
		inputTokens: SKELETON_INPUT + fills * FILL_INPUT,
		outputTokens: skeletonOut + fills * fillOutput(depth),
		youtubeSearches: opts.youtube ? eagerStages : 0,
	};
}

export function estimateLearnCost(depth: DepthId, phase: SpendPhase, price: ModelPrice, opts: { youtube: boolean }): CostEstimate {
	const tokens = estimateLearnTokens(depth, phase, opts);
	const usd = (tokens.inputTokens * price.input + tokens.outputTokens * price.output) / 1_000_000;
	return { ...tokens, usd };
}

/** YYYY-MM-DD in the machine's local time zone. */
export function localDay(date: Date): string {
	const mm = String(date.getMonth() + 1).padStart(2, "0");
	const dd = String(date.getDate()).padStart(2, "0");
	return `${date.getFullYear()}-${mm}-${dd}`;
}

export interface SpendEntry {
	at: string;
	usd: number;
}

/** What Learn spent on `now`'s local calendar day. */
export function spentOnDay(entries: readonly SpendEntry[], now: Date): number {
	const today = localDay(now);
	let sum = 0;
	for (const entry of entries) {
		const at = new Date(entry.at);
		if (Number.isNaN(at.getTime()) || !Number.isFinite(entry.usd)) continue;
		if (localDay(at) === today) sum += entry.usd;
	}
	return sum;
}

export interface SpendRequest {
	ceilingUsd: number | null;
	spentTodayUsd: number;
	estimateUsd: number;
	/** The learner chose "Go ahead this time" on the review sheet. */
	approved: boolean;
	phase: SpendPhase;
	model: string;
}

export function decideSpend(req: SpendRequest): SpendDecision {
	if (req.ceilingUsd === null) return { kind: "needs-ceiling" };
	if (req.approved || req.estimateUsd <= 0) return { kind: "auto" };
	// Float sums (0.2 + 0.01) land a hair over the limit; compare in micro-dollars.
	const after = Math.round((req.spentTodayUsd + req.estimateUsd) * 1e6);
	if (after <= Math.round(req.ceilingUsd * 1e6)) return { kind: "auto" };
	return {
		kind: "review",
		review: {
			phase: req.phase,
			estimateUsd: req.estimateUsd,
			spentTodayUsd: req.spentTodayUsd,
			ceilingUsd: req.ceilingUsd,
			model: req.model,
		},
	};
}
