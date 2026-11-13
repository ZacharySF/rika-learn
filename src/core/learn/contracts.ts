/**
 * LEARN CONTRACTS (rika-learn fork, 2026-11-13): the shapes of the "learn
 * anything" roadmap feature. Pure and browser-safe: the UI renders these,
 * the store persists them, the agent layer fills them.
 *
 * Words the UI uses (docs/01-learn-design.md "Terms"):
 * - Roadmap: a learning plan made of stages, topics, resources, progress.
 * - Track: a group of stages (Ultra and Ultraviolet only).
 * - Stage: one step of a roadmap.
 * - Topic: one thing to learn inside a stage (a star on the map).
 * - Depth: Normal, High, Super, Ultra or Ultraviolet.
 * - Source: an opt-in place resources come from.
 */

export const DEPTH_IDS = ["normal", "high", "super", "ultra", "ultraviolet"] as const;
export type DepthId = (typeof DEPTH_IDS)[number];

export function isDepthId(value: unknown): value is DepthId {
	return typeof value === "string" && (DEPTH_IDS as readonly string[]).includes(value);
}

/** The learner's own mark on a topic. "todo" = not marked yet. */
export const TOPIC_STATES = ["todo", "learning", "done", "skipped"] as const;
export type TopicState = (typeof TOPIC_STATES)[number];

export function isTopicState(value: unknown): value is TopicState {
	return typeof value === "string" && (TOPIC_STATES as readonly string[]).includes(value);
}

export const RESOURCE_KINDS = [
	"video",
	"reading",
	"exercise",
	"course",
	"book",
	"paper",
	"docs",
	"repo",
	"discussion",
] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];

export function isResourceKind(value: unknown): value is ResourceKind {
	return typeof value === "string" && (RESOURCE_KINDS as readonly string[]).includes(value);
}

export const SOURCE_IDS = [
	"wikipedia",
	"mitlearn",
	"freecodecamp",
	"openlibrary",
	"docs",
	"youtube",
	"arxiv",
	"semanticscholar",
	"hackernews",
	"awesome",
	"brave",
] as const;
export type SourceId = (typeof SOURCE_IDS)[number];

export function isSourceId(value: unknown): value is SourceId {
	return typeof value === "string" && (SOURCE_IDS as readonly string[]).includes(value);
}

/** A resource the MODEL named ("3Blue1Brown: Essence of Linear Algebra").
 *  It is only a lookup request: it is shown only after a source API
 *  confirms it exists. `url` is accepted for kind "docs" only, and only
 *  kept after the docs adapter fetched it (robots.txt allowing). */
export interface CanonItem {
	kind: ResourceKind;
	title: string;
	by?: string;
	url?: string;
}

/** Signals a source returns with a candidate. Used for ranking only; view
 *  and like counts are never turned into a displayed score. */
export interface CandidateSignals {
	views?: number;
	likes?: number;
	captions?: boolean;
	embeddable?: boolean;
	publishedAt?: string;
	channelId?: string;
	citations?: number;
	influential?: number;
	editions?: number;
	points?: number;
	stars?: number;
}

/** One resource as a source API returned it. `url` always comes from an
 *  API response (or a fetched page), never from the model. */
export interface Candidate {
	source: SourceId;
	kind: ResourceKind;
	title: string;
	url: string;
	/** Author, channel, publisher or site. */
	by?: string;
	/** At most ~300 characters. */
	description?: string;
	/** Video length or estimated reading time. */
	minutes?: number;
	year?: number;
	thumbnail?: string;
	/** YouTube video id when the resource is a YouTube video. */
	videoId?: string;
	signals?: CandidateSignals;
	/** Set during resolution: the model named it AND an API confirmed it. */
	canon?: boolean;
}

/** A ranked resource attached to a stage. */
export interface Resource extends Candidate {
	/** The canonical URL (rank.ts canonicalUrl) — the dedupe key. */
	id: string;
	/** Short plain-language reason it was picked ("Named by the roadmap · 17 min"). */
	reason: string;
	score: number;
}

/** What a stage shows: the picks (one best video first, then one or two
 *  readings or exercises) and "More" (the ranked rest). */
export interface StageResources {
	picks: Resource[];
	more: Resource[];
}

export interface Topic {
	id: string;
	title: string;
	/** One sentence, starts with a verb, at most 20 words. */
	objective: string;
	minutes: number;
	/** Topic ids (anywhere in the roadmap) to learn first. */
	prereqs: string[];
	state: TopicState;
}

/** Whether a stage's topics and resources have been loaded. Lazy depths
 *  (Ultra, Ultraviolet) leave stages outside the first track "pending"
 *  until the learner opens them. */
export type FillState = "pending" | "filling" | "filled" | "error";

export interface Stage {
	id: string;
	/** Set on Ultra and Ultraviolet roadmaps. */
	trackId?: string;
	title: string;
	/** Why this stage matters, at most 15 words. */
	why: string;
	hours: number;
	/** The one search query used for this stage (one YouTube search per stage). */
	query: string;
	/** Stage ids to finish first. */
	prereqs: string[];
	canon: CanonItem[];
	topics: Topic[];
	fill: FillState;
	error?: string;
	resources: StageResources;
}

export interface Track {
	id: string;
	title: string;
	why: string;
}

/** The starting level the priming answers settled (shown to the learner). */
export interface LevelRead {
	label: string;
	summary: string;
}

export interface PrimingOption {
	id: string;
	label: string;
}

/** One quick question asked before the build. The UI always adds a
 *  "Not sure" option, so questions carry 2–4 real options. */
export interface PrimingQuestion {
	id: string;
	question: string;
	options: PrimingOption[];
}

export interface PrimingAnswer {
	questionId: string;
	question: string;
	/** The chosen option's label, or "Not sure". */
	answer: string;
}

export type RoadmapStatus = "building" | "ready" | "error";

export interface ModelRef {
	provider: string;
	id: string;
}

export interface Roadmap {
	version: 1;
	id: string;
	/** What the learner typed. */
	topic: string;
	depth: DepthId;
	createdAt: string;
	updatedAt: string;
	status: RoadmapStatus;
	error?: string;
	/** Model-written title ("Linear algebra, from vectors to eigenvalues"). */
	title: string;
	level?: LevelRead;
	/** "fast" topics (frameworks, AI tools) prefer recent resources. */
	volatility: "evergreen" | "fast";
	/** Research-flavoured topics pull papers in from Super up. */
	research: boolean;
	hours: number;
	priming: PrimingAnswer[];
	tracks: Track[];
	stages: Stage[];
	model: ModelRef;
	spend: { usd: number; calls: number };
	youtubeSearches: number;
}

// ─── Spending ─────────────────────────────────────────────────────────────

/** What a model call (or a batch of calls) is expected to cost. */
export interface CostEstimate {
	calls: number;
	inputTokens: number;
	outputTokens: number;
	usd: number;
	/** YouTube search.list calls the build will make (0 when YouTube is off). */
	youtubeSearches: number;
}

export type SpendPhase = "prime" | "build" | "fill";

/** The facts the review sheet shows when a call would go over the limit. */
export interface SpendReview {
	phase: SpendPhase;
	estimateUsd: number;
	spentTodayUsd: number;
	ceilingUsd: number;
	/** Model display name. */
	model: string;
}

export type SpendDecision =
	| { kind: "auto" }
	| { kind: "needs-ceiling" }
	| { kind: "review"; review: SpendReview };

// ─── API views ────────────────────────────────────────────────────────────

export interface SourceView {
	id: SourceId;
	label: string;
	description: string;
	key?: string;
	/** The learner's toggle. */
	enabled: boolean;
	/** False when the source needs a key that is missing. */
	available: boolean;
	/** Why it is unavailable, in plain words. */
	reason?: string;
}

/** GET/PUT /api/learn/settings. */
export interface LearnSettingsView {
	settings: LearnSettings;
	sources: SourceView[];
	/** The model Learn will use; null when no model is configured. */
	model: { provider: string; id: string; name: string; fromSlot: boolean } | null;
	youtube: { used: number; limit: number; resetsAt: string };
	spentTodayUsd: number;
	keys: { youtube: boolean; brave: boolean };
}

// ─── Bridge to rika (docs/learn.md "Bridge to rika") ────────────────────────

export interface FlashcardsPayload {
	deck: string;
	tags: string[];
	roadmap: { id: string; title: string };
	stage: { id: string; title: string };
	cards: { guid: string; front: string; back: string; url?: string }[];
}

export interface CalendarEvent {
	source_key: string;
	title: string;
	/** YYYY-MM-DD, local. */
	date: string;
	/** HH:MM, local. */
	start: string;
	minutes: number;
	notes: string;
	attachments: { title: string; url: string }[];
}

export interface CalendarPayload {
	roadmap: { id: string; title: string };
	stage: { id: string; title: string };
	events: CalendarEvent[];
}

export type BridgeMessage =
	| { source: "rika-learn"; version: 1; id: string; type: "flashcards"; payload: FlashcardsPayload }
	| { source: "rika-learn"; version: 1; id: string; type: "calendar"; payload: CalendarPayload };

export interface OutboxItem {
	id: string;
	createdAt: string;
	message: BridgeMessage;
}

/** The list row for saved roadmaps. */
export interface RoadmapSummary {
	id: string;
	topic: string;
	title: string;
	depth: DepthId;
	status: RoadmapStatus;
	createdAt: string;
	updatedAt: string;
	topics: number;
	done: number;
}

export interface LearnSettings {
	/** Source toggles. Keyed sources (youtube, brave) also need their key. */
	sources: Record<SourceId, boolean>;
	/** Daily spending limit for Learn model calls, in US dollars. null =
	 *  not set yet: the first model call asks the learner to set it. */
	dailyCeilingUsd: number | null;
	/** The model Learn uses. Absent = the cheap model slot. */
	model?: ModelRef;
	/** Language code for sources that support one (YouTube, Wikipedia). */
	language: string;
}

/** Plain-language status of a topic for the map and the timeline. */
export type TopicStatus = "locked" | "ready" | "learning" | "done" | "skipped";

/** "locked" = something it needs is not done or skipped yet; "ready" =
 *  everything it needs is done or skipped (or it needs nothing). */
export function topicStatus(topic: Topic, stateOf: (topicId: string) => TopicState | undefined): TopicStatus {
	if (topic.state === "done") return "done";
	if (topic.state === "skipped") return "skipped";
	if (topic.state === "learning") return "learning";
	for (const id of topic.prereqs) {
		const state = stateOf(id);
		if (state !== undefined && state !== "done" && state !== "skipped") return "locked";
	}
	return "ready";
}

/** Map every topic of a roadmap to its status. */
export function roadmapTopicStatuses(roadmap: Pick<Roadmap, "stages">): Map<string, TopicStatus> {
	const states = new Map<string, TopicState>();
	for (const stage of roadmap.stages) for (const topic of stage.topics) states.set(topic.id, topic.state);
	const out = new Map<string, TopicStatus>();
	for (const stage of roadmap.stages) {
		for (const topic of stage.topics) out.set(topic.id, topicStatus(topic, (id) => states.get(id)));
	}
	return out;
}

export function summarizeRoadmap(roadmap: Roadmap): RoadmapSummary {
	let topics = 0;
	let done = 0;
	for (const stage of roadmap.stages) {
		for (const topic of stage.topics) {
			topics++;
			if (topic.state === "done" || topic.state === "skipped") done++;
		}
	}
	return {
		id: roadmap.id,
		topic: roadmap.topic,
		title: roadmap.title,
		depth: roadmap.depth,
		status: roadmap.status,
		createdAt: roadmap.createdAt,
		updatedAt: roadmap.updatedAt,
		topics,
		done,
	};
}
