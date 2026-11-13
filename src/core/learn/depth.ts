/**
 * DEPTH SIZING (research/07 §4.1). Five named steps; each carries the time
 * span the picker shows, the size budget the prompt asks for and the
 * validator enforces, which sources it searches, and how it is built:
 *
 * - Normal, High: one streamed call writes stages AND topics.
 * - Super: one streamed call writes the stages; each stage is then filled
 *   (topics + resources) in parallel.
 * - Ultra, Ultraviolet: one streamed call writes tracks and stages; only
 *   the first track is filled straight away, the rest fill when opened.
 */
import type { DepthId, SourceId } from "./contracts.ts";

export interface Range {
	min: number;
	max: number;
}

export interface DepthSpec {
	id: DepthId;
	label: string;
	/** What the picker shows under the name. */
	span: string;
	/** Total learner time. */
	hours: Range;
	stages: Range;
	/** Total topics across the roadmap once every stage is filled. */
	topics: Range;
	topicsPerStage: Range;
	tracks: Range | null;
	stagesPerTrack: Range | null;
	/** Readings or exercises shown next to the one video. */
	readings: 1 | 2;
	/** YouTube videoDuration filter. */
	videoDuration: "medium" | "any";
	/** Stages outside the first track fill when opened. */
	lazy: boolean;
	/** The skeleton call also writes the topics (Normal, High). */
	topicsInSkeleton: boolean;
}

export const DEPTHS: readonly DepthSpec[] = [
	{
		id: "normal",
		label: "Normal",
		span: "a couple of hours",
		hours: { min: 1.5, max: 3 },
		stages: { min: 3, max: 5 },
		topics: { min: 8, max: 15 },
		topicsPerStage: { min: 2, max: 4 },
		tracks: null,
		stagesPerTrack: null,
		readings: 1,
		videoDuration: "medium",
		lazy: false,
		topicsInSkeleton: true,
	},
	{
		id: "high",
		label: "High",
		span: "a few hours",
		hours: { min: 3, max: 8 },
		stages: { min: 5, max: 7 },
		topics: { min: 15, max: 30 },
		topicsPerStage: { min: 3, max: 5 },
		tracks: null,
		stagesPerTrack: null,
		readings: 2,
		videoDuration: "medium",
		lazy: false,
		topicsInSkeleton: true,
	},
	{
		id: "super",
		label: "Super",
		span: "a couple of weeks",
		hours: { min: 20, max: 40 },
		stages: { min: 7, max: 10 },
		topics: { min: 40, max: 80 },
		topicsPerStage: { min: 5, max: 8 },
		tracks: null,
		stagesPerTrack: null,
		readings: 2,
		videoDuration: "any",
		lazy: false,
		topicsInSkeleton: false,
	},
	{
		id: "ultra",
		label: "Ultra",
		span: "a semester",
		hours: { min: 120, max: 150 },
		stages: { min: 12, max: 16 },
		topics: { min: 120, max: 200 },
		topicsPerStage: { min: 8, max: 12 },
		tracks: { min: 3, max: 4 },
		stagesPerTrack: { min: 4, max: 4 },
		readings: 2,
		videoDuration: "any",
		lazy: true,
		topicsInSkeleton: false,
	},
	{
		id: "ultraviolet",
		label: "Ultraviolet",
		span: "semesters to years",
		hours: { min: 300, max: 1500 },
		stages: { min: 20, max: 48 },
		topics: { min: 300, max: 1000 },
		topicsPerStage: { min: 6, max: 12 },
		tracks: { min: 4, max: 8 },
		stagesPerTrack: { min: 5, max: 8 },
		readings: 2,
		videoDuration: "any",
		lazy: true,
		topicsInSkeleton: false,
	},
];

export const DEFAULT_DEPTH: DepthId = "normal";

export function depthSpec(id: DepthId): DepthSpec {
	const spec = DEPTHS.find((d) => d.id === id);
	if (!spec) throw new Error(`unknown depth ${id}`);
	return spec;
}

/** Sources every depth searches (when the learner has them switched on). */
const BASE_SOURCES: readonly SourceId[] = [
	"wikipedia",
	"mitlearn",
	"freecodecamp",
	"docs",
	"youtube",
	"hackernews",
	"brave",
];

/** Which sources a depth searches. Super adds books and awesome-lists;
 *  papers come in for research topics from Super, and always from Ultra. */
export function depthSources(id: DepthId, research: boolean): SourceId[] {
	const out: SourceId[] = [...BASE_SOURCES];
	const rank = DEPTHS.findIndex((d) => d.id === id);
	if (rank >= 2) out.push("openlibrary", "awesome");
	if (rank >= 3 || (rank === 2 && research)) out.push("arxiv", "semanticscholar");
	return out;
}

/** The stages filled during the build. Lazy depths fill the first track
 *  only; the rest wait until the learner opens them. */
export function eagerStageIds(
	id: DepthId,
	tracks: readonly { id: string }[],
	stages: readonly { id: string; trackId?: string }[],
): string[] {
	if (!depthSpec(id).lazy) return stages.map((s) => s.id);
	const first = tracks[0]?.id ?? stages[0]?.trackId;
	return stages.filter((s) => s.trackId === first).map((s) => s.id);
}

/** Hard caps the roadmap validator applies to what the model writes. */
export interface DepthCaps {
	maxStages: number;
	maxTracks: number;
	maxTopicsPerStage: number;
	maxCanonPerStage: number;
}

export function clampToDepth(id: DepthId): DepthCaps {
	const spec = depthSpec(id);
	return {
		maxStages: spec.stages.max,
		maxTracks: spec.tracks?.max ?? 0,
		maxTopicsPerStage: spec.topicsPerStage.max,
		maxCanonPerStage: 6,
	};
}
