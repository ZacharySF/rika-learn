/**
 * ROADMAP PARSING AND VALIDATION (research/07 §4.2–4.3). The skeleton
 * call streams one JSON object per line so stage k's resource search can
 * start while stage k+1 is still being written. Every line is validated
 * on its own; a bad line is dropped, never guessed at. The assembler then
 * enforces what a single line cannot: unique ids, known references,
 * prerequisites that only point backwards (so the graph is acyclic), and
 * the depth's size caps.
 */
import type { CanonItem, DepthId, LevelRead, ResourceKind, Stage, Topic, Track } from "./contracts.ts";
import { isResourceKind } from "./contracts.ts";
import { clampToDepth, depthSpec, type DepthCaps } from "./depth.ts";

/** Splits a text stream into complete lines; the partial tail waits. */
export class NdjsonLineReader {
	private buffer = "";

	push(chunk: string): string[] {
		this.buffer += chunk;
		const parts = this.buffer.split("\n");
		this.buffer = parts.pop() ?? "";
		return parts.map((line) => line.replace(/\r$/, "")).filter((line) => line.trim() !== "");
	}

	flush(): string[] {
		const rest = this.buffer.replace(/\r$/, "");
		this.buffer = "";
		return rest.trim() === "" ? [] : [rest];
	}
}

export interface RoadmapHeader {
	title: string;
	level?: LevelRead;
	volatility: "evergreen" | "fast";
	research: boolean;
	hours: number;
}

export type SkeletonStage = Omit<Stage, "topics" | "fill" | "resources" | "error"> & { trackId?: string };
export type SkeletonTopic = Topic & { stage: string };

export type SkeletonLine =
	| { kind: "roadmap"; value: RoadmapHeader }
	| { kind: "track"; value: Track }
	| { kind: "stage"; value: SkeletonStage }
	| { kind: "topic"; value: SkeletonTopic }
	| { kind: "invalid"; reason: string }
	| { kind: "ignored" };

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, max = 200): string {
	if (typeof value !== "string") return "";
	return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function words(value: unknown, max: number): string {
	const parts = text(value, 400).split(" ").filter(Boolean);
	return parts.slice(0, max).join(" ");
}

function id(value: unknown): string {
	if (typeof value === "number" && Number.isFinite(value)) return String(value);
	return text(value, 64);
}

function positive(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function idList(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.map(id).filter(Boolean);
}

/** Words models use for kinds, mapped onto ours. */
const KIND_ALIASES: Record<string, ResourceKind> = {
	article: "reading",
	tutorial: "reading",
	website: "reading",
	guide: "reading",
	textbook: "book",
	playlist: "video",
	lecture: "video",
	documentation: "docs",
	doc: "docs",
	practice: "exercise",
	project: "exercise",
	repository: "repo",
	survey: "paper",
};

function kindOf(value: unknown): ResourceKind | null {
	const raw = text(value, 32).toLowerCase();
	if (isResourceKind(raw)) return raw;
	return KIND_ALIASES[raw] ?? null;
}

function httpUrl(value: unknown): string | undefined {
	const raw = text(value, 500);
	if (!raw) return undefined;
	try {
		const url = new URL(raw);
		return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : undefined;
	} catch {
		return undefined;
	}
}

/** Model-named resources. A URL is kept only on docs items (the docs
 *  adapter still has to fetch it before it is shown). */
export function parseCanon(value: unknown, max = 6): CanonItem[] {
	if (!Array.isArray(value)) return [];
	const out: CanonItem[] = [];
	for (const raw of value) {
		if (!isObject(raw)) continue;
		const kind = kindOf(raw.kind);
		const title = text(raw.title, 160);
		if (!kind || !title) continue;
		const item: CanonItem = { kind, title };
		const by = text(raw.by, 80);
		if (by) item.by = by;
		if (kind === "docs") {
			const url = httpUrl(raw.url);
			if (url) item.url = url;
		}
		out.push(item);
		if (out.length >= max) break;
	}
	return out;
}

function parseLevel(value: unknown): LevelRead | undefined {
	if (!isObject(value)) return undefined;
	const label = text(value.label, 40);
	if (!label) return undefined;
	return { label, summary: text(value.summary, 300) };
}

function parseTopic(raw: Json, stageId?: string): SkeletonTopic | null {
	const stage = stageId ?? id(raw.stage);
	const title = text(raw.title, 120);
	if (!stage || !title) return null;
	return {
		id: id(raw.id),
		stage,
		title,
		objective: words(raw.objective, 20),
		minutes: Math.round(positive(raw.minutes, 20)),
		prereqs: idList(raw.prereqs),
		state: "todo",
	};
}

/** One skeleton line → a typed value, or why it was refused. */
export function parseSkeletonLine(line: string): SkeletonLine {
	const trimmed = line.trim();
	if (trimmed === "" || trimmed.startsWith("```")) return { kind: "ignored" };
	let parsed: unknown;
	try {
		parsed = JSON.parse(trimmed.replace(/,\s*$/, ""));
	} catch {
		return { kind: "invalid", reason: "not JSON" };
	}
	if (!isObject(parsed)) return { kind: "invalid", reason: "not an object" };

	if (isObject(parsed.roadmap)) {
		const r = parsed.roadmap;
		const title = text(r.title, 120);
		if (!title) return { kind: "invalid", reason: "roadmap without a title" };
		const header: RoadmapHeader = {
			title,
			volatility: r.volatility === "fast" ? "fast" : "evergreen",
			research: r.research === true,
			hours: positive(r.hours, 0),
		};
		const level = parseLevel(r.level);
		if (level) header.level = level;
		return { kind: "roadmap", value: header };
	}
	if (isObject(parsed.track)) {
		const t = parsed.track;
		const trackId = id(t.id);
		const title = text(t.title, 120);
		if (!trackId || !title) return { kind: "invalid", reason: "track without an id or title" };
		return { kind: "track", value: { id: trackId, title, why: words(t.why, 15) } };
	}
	if (isObject(parsed.stage)) {
		const s = parsed.stage;
		const stageId = id(s.id);
		const title = text(s.title, 120);
		if (!stageId || !title) return { kind: "invalid", reason: "stage without an id or title" };
		const stage: SkeletonStage = {
			id: stageId,
			title,
			why: words(s.why, 15),
			hours: positive(s.hours, 0),
			query: text(s.query, 120) || title,
			prereqs: idList(s.prereqs),
			canon: parseCanon(s.canon),
		};
		const track = id(s.track);
		if (track) stage.trackId = track;
		return { kind: "stage", value: stage };
	}
	if (isObject(parsed.topic)) {
		const topic = parseTopic(parsed.topic);
		if (!topic || !topic.id) return { kind: "invalid", reason: "topic without an id, stage or title" };
		return { kind: "topic", value: topic };
	}
	return { kind: "invalid", reason: "unknown line type" };
}

/** Lower-case letters and digits only: "Vectors!" and "vectors" match. */
export function normalizeTitle(title: string): string {
	return title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export type AssemblerEvent = { type: "roadmap" | "track" | "stage" | "topic"; id: string };

/** Applies validated lines in stream order. */
export class RoadmapAssembler {
	header: RoadmapHeader | null = null;
	readonly tracks: Track[] = [];
	readonly stages: Stage[] = [];
	readonly rejected: string[] = [];
	private readonly topicIds = new Set<string>();
	private readonly caps: DepthCaps;
	private readonly hasTracks: boolean;
	private readonly lazy: boolean;

	constructor(private readonly depth: DepthId) {
		this.caps = clampToDepth(depth);
		const spec = depthSpec(depth);
		this.hasTracks = spec.tracks !== null;
		this.lazy = spec.lazy;
	}

	private reject(reason: string): null {
		this.rejected.push(reason);
		return null;
	}

	apply(line: SkeletonLine): AssemblerEvent | null {
		switch (line.kind) {
			case "ignored":
				return null;
			case "invalid":
				return this.reject(line.reason);
			case "roadmap":
				if (this.header) return this.reject("second roadmap line");
				this.header = line.value;
				return { type: "roadmap", id: "roadmap" };
			case "track":
				return this.addTrack(line.value);
			case "stage":
				return this.addStage(line.value);
			case "topic":
				return this.addTopic(line.value);
		}
	}

	private addTrack(track: Track): AssemblerEvent | null {
		if (!this.hasTracks) return this.reject("tracks are not used at this depth");
		if (this.tracks.some((t) => t.id === track.id)) return this.reject(`duplicate track ${track.id}`);
		if (this.tracks.length >= this.caps.maxTracks) return this.reject("too many tracks");
		this.tracks.push(track);
		return { type: "track", id: track.id };
	}

	private addStage(value: SkeletonStage): AssemblerEvent | null {
		if (this.stages.some((s) => s.id === value.id)) return this.reject(`duplicate stage ${value.id}`);
		if (this.stages.length >= this.caps.maxStages) return this.reject("too many stages");
		const known = new Set(this.stages.map((s) => s.id));
		const stage: Stage = {
			id: value.id,
			title: value.title,
			why: value.why,
			hours: value.hours,
			query: value.query,
			prereqs: [...new Set(value.prereqs.filter((p) => known.has(p)))],
			canon: value.canon,
			topics: [],
			fill: this.lazy ? "pending" : "filling",
			resources: { picks: [], more: [] },
		};
		if (this.hasTracks) {
			let trackId = value.trackId && this.tracks.some((t) => t.id === value.trackId) ? value.trackId : this.tracks.at(-1)?.id;
			if (!trackId) {
				const created: Track = { id: "track-1", title: this.header?.title ?? "Start here", why: "" };
				this.tracks.push(created);
				trackId = created.id;
			}
			stage.trackId = trackId;
		}
		this.stages.push(stage);
		return { type: "stage", id: stage.id };
	}

	private addTopic(value: SkeletonTopic): AssemblerEvent | null {
		const stage = this.stages.find((s) => s.id === value.stage);
		if (!stage) return this.reject(`topic ${value.id} names an unknown stage`);
		if (this.topicIds.has(value.id)) return this.reject(`duplicate topic ${value.id}`);
		const norm = normalizeTitle(value.title);
		if (stage.topics.some((t) => normalizeTitle(t.title) === norm)) return this.reject(`duplicate topic title ${value.title}`);
		if (stage.topics.length >= this.caps.maxTopicsPerStage) return this.reject("too many topics in a stage");
		const topic: Topic = {
			id: value.id,
			title: value.title,
			objective: value.objective,
			minutes: value.minutes,
			prereqs: [...new Set(value.prereqs.filter((p) => this.topicIds.has(p)))],
			state: "todo",
		};
		this.topicIds.add(topic.id);
		stage.topics.push(topic);
		return { type: "topic", id: topic.id };
	}
}

/** The first {...} object in a model answer (fences and chatter allowed). */
export function extractJsonObject(answer: string): Json | null {
	const start = answer.indexOf("{");
	const end = answer.lastIndexOf("}");
	if (start < 0 || end <= start) return null;
	try {
		const parsed: unknown = JSON.parse(answer.slice(start, end + 1));
		return isObject(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

/** A stage-fill answer ({"topics":[…],"canon":[…]}) → validated topics.
 *  Prerequisites may name topics of this stage by id or title, or any
 *  topic id already in the roadmap (`existingTopicIds`); everything else
 *  is dropped, and only earlier topics of this stage count, so no cycle
 *  can form. */
export interface StageFill {
	topics: Topic[];
	canon: CanonItem[];
}

export function parseStageFill(
	answer: string,
	stage: Pick<Stage, "id">,
	depth: DepthId,
	existingTopicIds: ReadonlySet<string>,
): StageFill | null {
	const json = extractJsonObject(answer);
	if (!json || !Array.isArray(json.topics)) return null;
	const caps = clampToDepth(depth);
	const topics: Topic[] = [];
	const byTitle = new Map<string, string>();
	const rawIds = new Map<string, string>();
	const taken = new Set(existingTopicIds);
	let n = 0;
	for (const raw of json.topics) {
		if (!isObject(raw)) continue;
		const parsed = parseTopic(raw, stage.id);
		if (!parsed) continue;
		const norm = normalizeTitle(parsed.title);
		if (byTitle.has(norm)) continue;
		let topicId = parsed.id;
		if (!topicId || taken.has(topicId)) {
			do topicId = `${stage.id}-t${++n}`;
			while (taken.has(topicId));
		}
		const prereqs = new Set<string>();
		for (const ref of parsed.prereqs) {
			const local = byTitle.get(normalizeTitle(ref)) ?? rawIds.get(ref);
			if (local) prereqs.add(local);
			else if (existingTopicIds.has(ref)) prereqs.add(ref);
		}
		taken.add(topicId);
		byTitle.set(norm, topicId);
		if (parsed.id && !rawIds.has(parsed.id)) rawIds.set(parsed.id, topicId);
		topics.push({
			id: topicId,
			title: parsed.title,
			objective: parsed.objective,
			minutes: parsed.minutes,
			prereqs: [...prereqs],
			state: "todo",
		});
		if (topics.length >= caps.maxTopicsPerStage) break;
	}
	if (topics.length === 0) return null;
	return { topics, canon: parseCanon(json.canon, caps.maxCanonPerStage) };
}

function roundHalf(minutes: number): number {
	return Math.max(0.5, Math.round((minutes / 60) * 2) / 2);
}

/** Fits the topics' minutes into the depth's hour budget (±25%) and sets
 *  each stage's hours from its topics. Stages without topics keep theirs. */
export function rescaleMinutes(stages: Stage[], depth: DepthId): Stage[] {
	const spec = depthSpec(depth);
	const total = stages.flatMap((s) => s.topics).reduce((sum, t) => sum + t.minutes, 0);
	const low = spec.hours.min * 60 * 0.75;
	const high = spec.hours.max * 60 * 1.25;
	const target = total > high ? spec.hours.max * 60 : total < low && total > 0 ? spec.hours.min * 60 : total;
	const factor = total > 0 ? target / total : 1;
	return stages.map((stage) => {
		if (stage.topics.length === 0) return stage;
		const topics = stage.topics.map((t) => ({ ...t, minutes: Math.max(5, Math.round(t.minutes * factor)) }));
		return { ...stage, topics, hours: roundHalf(topics.reduce((sum, t) => sum + t.minutes, 0)) };
	});
}
