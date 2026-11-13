/**
 * THE LEARN BUILD PIPELINE (research/07 §4.2): skeleton → per-stage search
 * → rank → assemble, streamed.
 *
 * - One streamed model call writes the skeleton as JSON Lines. Each line is
 *   validated on its own and written to the roadmap at once, so stages
 *   appear while the model is still writing.
 * - A stage's source searches start the moment its line parses (Normal,
 *   High) or as soon as it is filled (Super; the first track of Ultra and
 *   Ultraviolet). Other stages wait as "pending" until opened (fillStage).
 * - Resources the model named are looked up in the search results, then
 *   through the sources' exact lookups; whatever no source confirms is
 *   dropped. Ranking is deterministic (core/learn/rank.ts).
 *
 * Every effect arrives through LearnDeps (the server wires the store, the
 * provider layer's engine and the source adapters); tests pass fakes.
 */
import type { Candidate, CanonItem, DepthId, PrimingQuestion, Roadmap, SpendPhase, Stage } from "../../core/learn/contracts.ts";
import { depthSources, depthSpec } from "../../core/learn/depth.ts";
import { parsePrimingQuestions } from "../../core/learn/priming.ts";
import { assignAcrossStages, matchCanon, rankStage } from "../../core/learn/rank.ts";
import { NdjsonLineReader, RoadmapAssembler, parseSkeletonLine, parseStageFill, rescaleMinutes, type StageFill } from "../../core/learn/roadmap.ts";
import type { PiEngine } from "../models.ts";
import { runSubagent } from "../subagents/pi-run.ts";
import { FILL_SYSTEM, SKELETON_SYSTEM, fillUserPrompt, primingSystemPrompt, primingUserPrompt, skeletonUserPrompt } from "./prompts.ts";
import type { SourceAdapter, SourceContext, SourceQuery } from "./sources/types.ts";

export interface LearnDeps {
	engine: PiEngine;
	/** The sources the learner switched on (and has keys for). */
	adapters: readonly SourceAdapter[];
	sourceContext: SourceContext;
	language: string;
	/** Read-modify-write of THE roadmap this run works on (store-backed in
	 *  production; every call also tells open windows to refetch). */
	update(mutate: (roadmap: Roadmap) => void): Roadmap | null;
	/** The real cost of one finished model call. */
	recordSpend(usd: number, phase: SpendPhase): void;
	now(): number;
	signal?: AbortSignal;
}

/** Fills run at most this many at a time (research/07 §4.2: ≤ 4 concurrent). */
const FILL_CONCURRENCY = 4;
/** A slow source is dropped for this stage rather than holding it up. */
const SOURCE_TIMEOUT_MS = 12_000;
const CANDIDATES_PER_SOURCE = 8;

async function modelCall(
	engine: PiEngine,
	systemPrompt: string,
	prompt: string,
	opts: { onTextDelta?: (delta: string) => void; signal?: AbortSignal; onUsd: (usd: number) => void },
): Promise<string> {
	let usd = 0;
	try {
		const result = await runSubagent([], {
			role: "researcher",
			engine,
			systemPrompt,
			prompt,
			maxTurns: 1,
			abortSignal: opts.signal,
			onUsage: (usage) => {
				usd += usage.cost.total;
			},
			onTextDelta: opts.onTextDelta,
		});
		return result.text;
	} finally {
		opts.onUsd(usd);
	}
}

export interface PrimingResult {
	questions: PrimingQuestion[];
	usd: number;
}

/** Up to three questions that settle the learner's starting level. */
export async function writePrimingQuestions(args: {
	engine: PiEngine;
	topic: string;
	depth: DepthId;
	doctrine: string;
	signal?: AbortSignal;
}): Promise<PrimingResult> {
	let usd = 0;
	const text = await modelCall(args.engine, primingSystemPrompt(args.doctrine), primingUserPrompt(args.topic, args.depth), {
		signal: args.signal,
		onUsd: (spent) => {
			usd = spent;
		},
	});
	return { questions: parsePrimingQuestions(text), usd };
}

function limiter(max: number): <T>(task: () => Promise<T>) => Promise<T> {
	let active = 0;
	const waiting: (() => void)[] = [];
	return async (task) => {
		if (active >= max) await new Promise<void>((resolve) => waiting.push(resolve));
		active++;
		try {
			return await task();
		} finally {
			active--;
			waiting.shift()?.();
		}
	};
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<T>((resolve) => {
		timer = setTimeout(() => resolve(fallback), ms);
	});
	return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Runs one model call and books its cost on the ledger and the roadmap. */
function spender(deps: LearnDeps, phase: SpendPhase): (usd: number) => void {
	return (usd) => {
		deps.recordSpend(usd, phase);
		deps.update((r) => {
			r.spend.usd += usd;
			r.spend.calls += 1;
		});
	};
}

function stageQuery(roadmap: Roadmap, stage: Stage, language: string): SourceQuery {
	const spec = depthSpec(roadmap.depth);
	const topicMinutes = stage.topics.length > 0 ? stage.topics.reduce((n, t) => n + t.minutes, 0) / stage.topics.length : undefined;
	return {
		topic: roadmap.topic,
		stageTitle: stage.title,
		query: stage.query,
		depth: roadmap.depth,
		language,
		limit: CANDIDATES_PER_SOURCE,
		minutes: topicMinutes,
		videoDuration: spec.videoDuration,
	};
}

/** Every switched-on source the depth uses, once each; Brave only fills gaps. */
async function searchStage(roadmap: Roadmap, stage: Stage, deps: LearnDeps): Promise<{ pool: Candidate[]; youtube: number }> {
	const allowed = new Set(depthSources(roadmap.depth, roadmap.research));
	const query = stageQuery(roadmap, stage, deps.language);
	let youtube = 0;
	const quota = deps.sourceContext.youtubeQuota;
	const ctx: SourceContext = quota
		? {
				...deps.sourceContext,
				youtubeQuota: {
					remaining: () => quota.remaining(),
					spend: () => {
						const ok = quota.spend();
						if (ok) youtube++;
						return ok;
					},
				},
			}
		: deps.sourceContext;
	const run = (adapter: SourceAdapter) => withTimeout(adapter.search(query, ctx).catch(() => []), SOURCE_TIMEOUT_MS, [] as Candidate[]);
	const main = deps.adapters.filter((a) => a.id !== "brave" && allowed.has(a.id));
	const pool = (await Promise.all(main.map(run))).flat();
	const brave = deps.adapters.find((a) => a.id === "brave");
	const readings = pool.filter((c) => c.kind !== "video" && c.kind !== "discussion").length;
	if (brave && readings < depthSpec(roadmap.depth).readings + 1) pool.push(...(await run(brave)));
	return { pool, youtube };
}

/** Confirm each named resource: first against this stage's results (no
 *  extra searches, so YouTube stays at one search per stage), then through
 *  any switched-on source with an exact lookup for that kind. */
async function resolveCanon(items: readonly CanonItem[], pool: Candidate[], roadmap: Roadmap, stage: Stage, deps: LearnDeps): Promise<Candidate[]> {
	const query = stageQuery(roadmap, stage, deps.language);
	const resolved: Candidate[] = [];
	for (const item of items) {
		const hit = matchCanon(item, pool);
		if (hit) {
			resolved.push(hit);
			continue;
		}
		for (const adapter of deps.adapters) {
			if (!adapter.resolve || !adapter.resolves.includes(item.kind)) continue;
			const found = await withTimeout(adapter.resolve(item, query, deps.sourceContext).catch(() => null), SOURCE_TIMEOUT_MS, null);
			if (found) {
				resolved.push({ ...found, canon: true });
				break;
			}
		}
	}
	return [...resolved, ...pool];
}

function current(deps: LearnDeps): Roadmap {
	const roadmap = deps.update(() => {});
	if (!roadmap) throw new Error("The roadmap was deleted.");
	return roadmap;
}

/** Search, resolve and rank one stage whose topics are known, then store. */
async function attachResources(stageId: string, deps: LearnDeps, extraCanon: readonly CanonItem[] = [], searched?: Promise<{ pool: Candidate[]; youtube: number }>): Promise<void> {
	const roadmap = current(deps);
	const stage = roadmap.stages.find((s) => s.id === stageId);
	if (!stage) return;
	const { pool, youtube } = await (searched ?? searchStage(roadmap, stage, deps));
	const fresh = current(deps);
	const latest = fresh.stages.find((s) => s.id === stageId) ?? stage;
	const candidates = await resolveCanon([...latest.canon, ...extraCanon], pool, fresh, latest, deps);
	const resources = rankStage(candidates, {
		stage: { title: latest.title, query: latest.query, topics: latest.topics },
		depth: fresh.depth,
		volatility: fresh.volatility,
		now: deps.now(),
	});
	deps.update((r) => {
		const s = r.stages.find((x) => x.id === stageId);
		if (!s) return;
		s.resources = resources;
		s.fill = "filled";
		delete s.error;
		r.youtubeSearches += youtube;
	});
}

const FILL_FAILED = "The model's answer for this stage could not be used. Try again, or pick another model in Settings → Learn.";

/** Topics (one strict-JSON call, one retry) plus resources for one stage. */
async function fillOne(stageId: string, deps: LearnDeps): Promise<void> {
	const before = current(deps);
	const stage = before.stages.find((s) => s.id === stageId);
	if (!stage) return;
	deps.update((r) => {
		const s = r.stages.find((x) => x.id === stageId);
		if (s) {
			s.fill = "filling";
			delete s.error;
		}
	});
	// The searches only need the stage's query, so they run during the model call.
	const searched = searchStage(before, stage, deps);
	const known = new Set(before.stages.flatMap((s) => (s.id === stageId ? [] : s.topics.map((t) => t.id))));
	let parsed: StageFill | null = null;
	try {
		for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
			const text = await modelCall(deps.engine, FILL_SYSTEM, fillUserPrompt(current(deps), stage), {
				signal: deps.signal,
				onUsd: spender(deps, "fill"),
			});
			parsed = parseStageFill(text, stage, before.depth, known);
		}
	} catch (err) {
		await searched.catch(() => undefined);
		const message = err instanceof Error ? err.message : String(err);
		deps.update((r) => {
			const s = r.stages.find((x) => x.id === stageId);
			if (s) {
				s.fill = "error";
				s.error = `The model call failed: ${message}`;
			}
		});
		return;
	}
	if (!parsed) {
		await searched.catch(() => undefined);
		deps.update((r) => {
			const s = r.stages.find((x) => x.id === stageId);
			if (s) {
				s.fill = "error";
				s.error = FILL_FAILED;
			}
		});
		return;
	}
	const fill = parsed;
	deps.update((r) => {
		const s = r.stages.find((x) => x.id === stageId);
		if (!s) return;
		s.topics = fill.topics;
		if (s.hours <= 0) s.hours = Math.max(0.5, Math.round((fill.topics.reduce((n, t) => n + t.minutes, 0) / 60) * 2) / 2);
	});
	await attachResources(stageId, deps, fill.canon, searched);
}

function spreadPicks(deps: LearnDeps): void {
	deps.update((r) => {
		const resources = assignAcrossStages(r.stages.map((s) => s.resources), r.depth);
		r.stages.forEach((s, i) => {
			s.resources = resources[i] ?? s.resources;
		});
	});
}

/** Copy what the assembler accepted into the stored roadmap, keeping what
 *  the stored copy already has (fill state, resources, filled topics,
 *  progress the learner marked mid-build). */
function syncFromAssembler(r: Roadmap, a: RoadmapAssembler): void {
	if (a.header) {
		r.title = a.header.title;
		if (a.header.level) r.level = a.header.level;
		r.volatility = a.header.volatility;
		r.research = a.header.research;
		r.hours = a.header.hours;
	}
	r.tracks = structuredClone(a.tracks);
	r.stages = a.stages.map((fresh) => {
		const old = r.stages.find((s) => s.id === fresh.id);
		const copy = structuredClone(fresh);
		if (!old) return copy;
		const topics = copy.topics.length > 0 ? copy.topics.map((t) => ({ ...t, state: old.topics.find((o) => o.id === t.id)?.state ?? t.state })) : old.topics;
		const merged: Stage = { ...copy, topics, fill: old.fill, resources: old.resources };
		if (old.error) merged.error = old.error;
		return merged;
	});
}

/** Build the roadmap the store already holds (status "building"). */
export async function buildRoadmap(deps: LearnDeps): Promise<void> {
	const start = current(deps);
	const spec = depthSpec(start.depth);
	const assembler = new RoadmapAssembler(start.depth);
	const reader = new NdjsonLineReader();
	const work: Promise<void>[] = [];
	const limit = limiter(FILL_CONCURRENCY);
	const searches = new Map<string, Promise<{ pool: Candidate[]; youtube: number }>>();
	let open: string | undefined;

	/** Normal/High: a stage's topics are complete once the next stage starts. */
	const finish = (stageId: string) => {
		const stage = current(deps).stages.find((s) => s.id === stageId);
		if (stage && stage.topics.length === 0) work.push(limit(() => fillOne(stageId, deps)));
		else work.push(attachResources(stageId, deps, [], searches.get(stageId)));
	};

	const onLine = (line: string) => {
		const event = assembler.apply(parseSkeletonLine(line));
		if (!event) return;
		deps.update((r) => syncFromAssembler(r, assembler));
		if (event.type !== "stage") return;
		const stage = assembler.stages.find((s) => s.id === event.id);
		if (!stage) return;
		if (spec.topicsInSkeleton) {
			if (open) finish(open);
			open = stage.id;
			searches.set(stage.id, searchStage(current(deps), stage, deps));
			return;
		}
		const eager = !spec.lazy || stage.trackId === assembler.tracks[0]?.id;
		if (eager) work.push(limit(() => fillOne(stage.id, deps)));
	};

	try {
		await modelCall(deps.engine, SKELETON_SYSTEM, skeletonUserPrompt(start), {
			signal: deps.signal,
			onUsd: spender(deps, "build"),
			onTextDelta: (delta) => {
				for (const line of reader.push(delta)) onLine(line);
			},
		});
		for (const line of reader.flush()) onLine(line);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		await Promise.allSettled([...work, ...searches.values()]);
		deps.update((r) => {
			r.status = "error";
			r.error = `The model call failed: ${message}`;
		});
		return;
	}
	if (open) finish(open);
	await Promise.allSettled(work);

	if (assembler.stages.length === 0) {
		deps.update((r) => {
			r.status = "error";
			r.error = "The model did not write a usable roadmap. Try again, or pick another model in Settings → Learn.";
		});
		return;
	}
	spreadPicks(deps);
	deps.update((r) => {
		if (!spec.lazy) r.stages = rescaleMinutes(r.stages, r.depth);
		if (r.hours <= 0) r.hours = Math.round(r.stages.reduce((n, s) => n + s.hours, 0) * 2) / 2;
		r.status = "ready";
		delete r.error;
	});
}

/** Lazy expansion: fill one pending (or failed) stage when it is opened. */
export async function fillStage(stageId: string, deps: LearnDeps): Promise<void> {
	await fillOne(stageId, deps);
	spreadPicks(deps);
}
