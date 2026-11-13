/**
 * THE LEARN SERVICE (rika-learn): composition for the "learn anything"
 * feature, the one place where the provider layer, the source adapters and
 * the Learn store are plugged together. Route handlers in app/api/learn/
 * are transport only; they call these functions and send back
 * `{ status, body }`.
 *
 * - Model: the learner's Learn pin, else the cheap model slot, built with
 *   the provider layer's piEngineForSpec (BYOK keys, background purpose).
 * - Spending: every call is gated (core/learn/cost.ts decideSpend) and its
 *   real cost appended to the ledger.
 * - Builds and fills run in the background; every roadmap write emits
 *   "learn-changed" so open windows refetch.
 */
import { randomUUID } from "node:crypto";
import { emit } from "../core/events.ts";
import type {
	CostEstimate,
	DepthId,
	LearnSettingsView,
	PrimingAnswer,
	Roadmap,
	SourceId,
	SpendDecision,
	SpendPhase,
} from "../core/learn/contracts.ts";
import { isDepthId, isTopicState, summarizeRoadmap } from "../core/learn/contracts.ts";
import { decideSpend, estimateLearnCost, spentOnDay } from "../core/learn/cost.ts";
import { calendarPayload, flashcardsPayload, isBridgeMessage, makeBridgeMessage, validSchedule } from "../core/learn/bridge.ts";
import { applyLearnSettingsPatch, youtubeResetsAt } from "../core/learn/settings.ts";
import { SOURCE_INFO, YOUTUBE_DAILY_SEARCHES } from "../core/learn/sources.ts";
import type { LearnSettings } from "../core/learn/contracts.ts";
import { piEngineForSpec, type PiEngine } from "../agent/models.ts";
import { effectivePromptSegments } from "../agent/prompt-segments.ts";
import { buildRoadmap, fillStage, writePrimingQuestions, type LearnDeps } from "../agent/learn/build.ts";
import { SOURCE_ADAPTERS } from "../agent/learn/sources/index.ts";
import { offlineFetch } from "../agent/learn/sources/offline-fixtures.ts";
import type { SourceAdapter, SourceContext } from "../agent/learn/sources/types.ts";
import { keyValue, providerKeyPresent } from "./keys.ts";
import { effectiveSettings, stores } from "./stores.ts";
import { offlineDemoEnabled, offlineDemoEngine } from "./learn-offline.ts";

export interface LearnResult {
	status: number;
	body: unknown;
}

const ok = (body: unknown, status = 200): LearnResult => ({ status, body });
const fail = (status: number, error: string, extra: Record<string, unknown> = {}): LearnResult => ({ status, body: { error, ...extra } });

const USER_AGENT = `rika-learn/${process.env.LH_VERSION ?? "dev"} (+https://github.com/ZacharySF/rika-learn)`;
const TOPIC_MAX = 200;
const PROBER_DOCTRINE = "prober/10-probe-doctrine.md";

// ─── Model ────────────────────────────────────────────────────────────────

interface LearnModel {
	engine: PiEngine;
	provider: string;
	id: string;
	name: string;
	fromSlot: boolean;
	price: { input: number; output: number };
}

let offlineEngine: PiEngine | undefined;

/** The model Learn uses, or why there is none (a plain sentence). */
function learnModel(settings: LearnSettings): LearnModel | { error: string } {
	if (offlineDemoEnabled()) {
		offlineEngine ??= offlineDemoEngine();
		const m = offlineEngine.model;
		return { engine: offlineEngine, provider: m.provider, id: m.id, name: m.name, fromSlot: true, price: { input: m.cost.input, output: m.cost.output } };
	}
	const cheap = effectiveSettings().models.cheap;
	const spec = settings.model ?? (cheap ? { provider: cheap.provider, id: cheap.id, thinkingLevel: cheap.thinkingLevel } : undefined);
	if (!spec) return { error: "Learn needs a model. Pick your cheap model in Settings → Agent, or choose one in Settings → Learn." };
	if (!providerKeyPresent(spec.provider)) return { error: `Learn's model runs on ${spec.provider}, which has no key yet. Add it in Settings → Providers.` };
	let engine: PiEngine;
	try {
		engine = piEngineForSpec(spec, true);
	} catch {
		return { error: `The model ${spec.provider}/${spec.id} is not in the catalogue any more. Pick another in Settings → Learn.` };
	}
	return {
		engine,
		provider: spec.provider,
		id: spec.id,
		name: engine.model.name || spec.id,
		fromSlot: !settings.model,
		price: { input: engine.model.cost.input, output: engine.model.cost.output },
	};
}

// ─── Sources ──────────────────────────────────────────────────────────────

const sourceFetch: typeof fetch = (...args) => (offlineDemoEnabled() ? offlineFetch(...args) : fetch(...args));

type SourceKeys = SourceContext["keys"];

function sourceKeys(): SourceKeys {
	if (offlineDemoEnabled()) return { youtube: "AIza-offline-demo-key-000000000000000", brave: "offline-demo-brave-key" };
	const keys: { youtube?: string; brave?: string } = {};
	const youtube = keyValue("YOUTUBE_API_KEY");
	const brave = keyValue("BRAVE_API_KEY");
	if (youtube) keys.youtube = youtube;
	if (brave) keys.brave = brave;
	return keys;
}

function keyFor(id: SourceId): "youtube" | "brave" | undefined {
	return id === "youtube" || id === "brave" ? id : undefined;
}

function enabledAdapters(settings: LearnSettings, keys: SourceKeys): SourceAdapter[] {
	return SOURCE_INFO.filter((info) => {
		if (!settings.sources[info.id]) return false;
		const key = keyFor(info.id);
		return key ? Boolean(keys[key]) : true;
	}).map((info) => SOURCE_ADAPTERS[info.id]);
}

function sourceContext(keys: SourceKeys): SourceContext {
	const store = stores.learnStore;
	return {
		fetch: sourceFetch,
		keys,
		cache: store.cache,
		now: Date.now,
		userAgent: USER_AGENT,
		youtubeQuota: {
			remaining: () => YOUTUBE_DAILY_SEARCHES - store.youtubeUsed(Date.now()),
			spend: () => store.youtubeSpend(Date.now()),
		},
	};
}

// ─── Settings view ────────────────────────────────────────────────────────

export function learnSettingsView(): LearnSettingsView {
	const store = stores.learnStore;
	const settings = store.readSettings();
	const keys = sourceKeys();
	const model = learnModel(settings);
	const now = Date.now();
	return {
		settings,
		sources: SOURCE_INFO.map((info) => {
			const key = keyFor(info.id);
			const available = key ? Boolean(keys[key]) : true;
			const view: LearnSettingsView["sources"][number] = {
				id: info.id,
				label: info.label,
				description: info.description,
				enabled: settings.sources[info.id],
				available,
			};
			if (info.key) view.key = info.key;
			if (!available) view.reason = key === "youtube" ? "Needs your YouTube key" : "Needs your Brave key";
			return view;
		}),
		model: "error" in model ? null : { provider: model.provider, id: model.id, name: model.name, fromSlot: model.fromSlot },
		youtube: { used: store.youtubeUsed(now), limit: YOUTUBE_DAILY_SEARCHES, resetsAt: youtubeResetsAt(now) },
		spentTodayUsd: spentOnDay(store.readSpend(), new Date(now)),
		keys: { youtube: Boolean(keys.youtube), brave: Boolean(keys.brave) },
	};
}

export function updateLearnSettings(patch: unknown): LearnResult {
	const store = stores.learnStore;
	const result = applyLearnSettingsPatch(store.readSettings(), patch);
	if (!result.ok) return fail(400, result.error);
	store.writeSettings(result.settings);
	return ok(learnSettingsView());
}

// ─── Spending gate ────────────────────────────────────────────────────────

interface Gate {
	model: LearnModel;
	estimate: CostEstimate;
	decision: SpendDecision;
	settings: LearnSettings;
}

function gate(phase: SpendPhase, depth: DepthId, approved: boolean): Gate | LearnResult {
	const store = stores.learnStore;
	const settings = store.readSettings();
	const model = learnModel(settings);
	if ("error" in model) return fail(503, model.error, { needs: "model" });
	const keys = sourceKeys();
	const youtube = settings.sources.youtube && Boolean(keys.youtube);
	const estimate = estimateLearnCost(depth, phase, model.price, { youtube });
	const decision = decideSpend({
		ceilingUsd: settings.dailyCeilingUsd,
		spentTodayUsd: spentOnDay(store.readSpend(), new Date()),
		estimateUsd: estimate.usd,
		approved,
		phase,
		model: model.name,
	});
	return { model, estimate, decision, settings };
}

function blocked(g: Gate): LearnResult | null {
	if (g.decision.kind === "needs-ceiling") return fail(409, "Set a daily spending limit first.", { needs: "ceiling", estimate: g.estimate });
	if (g.decision.kind === "review") return fail(402, "This would go over today's spending limit.", { needs: "review", review: g.decision.review, estimate: g.estimate });
	return null;
}

export function learnEstimate(depthRaw: string | null, phaseRaw: string | null): LearnResult {
	const depth = isDepthId(depthRaw) ? depthRaw : "normal";
	const phase: SpendPhase = phaseRaw === "prime" || phaseRaw === "fill" ? phaseRaw : "build";
	const g = gate(phase, depth, false);
	if ("status" in g) return g;
	return ok({ estimate: g.estimate, decision: g.decision });
}

// ─── Background work ──────────────────────────────────────────────────────

interface LearnRuns {
	__rikaLearnRuns?: Set<string>;
}

/** Live builds/fills (process-wide, survives Next's module reloads in dev). */
function runs(): Set<string> {
	const g = globalThis as typeof globalThis & LearnRuns;
	return (g.__rikaLearnRuns ??= new Set());
}

function updater(id: string): LearnDeps["update"] {
	return (mutate) => {
		const next = stores.learnStore.updateRoadmap(id, mutate);
		if (next) emit("learn-changed", { roadmapId: id });
		return next;
	};
}

function depsFor(id: string, g: Gate): LearnDeps {
	const keys = sourceKeys();
	return {
		engine: g.model.engine,
		adapters: enabledAdapters(g.settings, keys),
		sourceContext: sourceContext(keys),
		language: g.settings.language,
		update: updater(id),
		recordSpend: (usd, phase) => stores.learnStore.appendSpend({ at: new Date().toISOString(), usd, phase, model: `${g.model.provider}/${g.model.id}`, roadmapId: id }),
		now: Date.now,
	};
}

function runInBackground(key: string, work: () => Promise<void>, onCrash: (message: string) => void): void {
	runs().add(key);
	void work()
		.catch((err: unknown) => onCrash(err instanceof Error ? err.message : String(err)))
		.finally(() => runs().delete(key));
}

/** A roadmap left "building" (or a stage left "filling") by a stopped
 *  server is marked as interrupted, so the learner gets a Retry. */
function settleInterrupted(roadmap: Roadmap): Roadmap {
	const live = runs();
	const stuckBuild = roadmap.status === "building" && !live.has(roadmap.id);
	const stuckStages = roadmap.stages.filter((s) => s.fill === "filling" && !live.has(roadmap.id) && !live.has(`${roadmap.id}:${s.id}`));
	if (!stuckBuild && stuckStages.length === 0) return roadmap;
	return (
		updater(roadmap.id)((r) => {
			if (stuckBuild) {
				r.status = "error";
				r.error = "The build was interrupted. Try again.";
			}
			for (const s of r.stages) {
				if (stuckStages.some((x) => x.id === s.id)) {
					s.fill = "error";
					s.error = "Loading this stage was interrupted. Try again.";
				}
			}
		}) ?? roadmap
	);
}

// ─── Requests ─────────────────────────────────────────────────────────────

function readBody(body: unknown): Record<string, unknown> {
	return typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}

function cleanTopic(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const topic = value.replace(/\s+/g, " ").trim();
	return topic.length > 0 && topic.length <= TOPIC_MAX ? topic : null;
}

function proberDoctrine(): string {
	const segments = effectivePromptSegments("prober", effectiveSettings().agent.prompts);
	const doctrine = segments.find((s) => s.path === PROBER_DOCTRINE);
	if (!doctrine) return "";
	return doctrine.enabled && doctrine.overrideText !== null ? doctrine.overrideText : doctrine.sourceText;
}

export async function primeRequest(raw: unknown): Promise<LearnResult> {
	const body = readBody(raw);
	const topic = cleanTopic(body.topic);
	if (!topic) return fail(400, `Type what you want to learn (up to ${TOPIC_MAX} characters).`);
	const depth = isDepthId(body.depth) ? body.depth : "normal";
	const g = gate("prime", depth, body.approved === true);
	if ("status" in g) return g;
	const stop = blocked(g);
	if (stop) return stop;
	try {
		const result = await writePrimingQuestions({ engine: g.model.engine, topic, depth, doctrine: proberDoctrine() });
		stores.learnStore.appendSpend({ at: new Date().toISOString(), usd: result.usd, phase: "prime", model: `${g.model.provider}/${g.model.id}` });
		return ok({ questions: result.questions });
	} catch (err) {
		return fail(502, `The model could not write the questions: ${err instanceof Error ? err.message : String(err)}`);
	}
}

function parseAnswers(value: unknown): PrimingAnswer[] {
	if (!Array.isArray(value)) return [];
	const out: PrimingAnswer[] = [];
	for (const raw of value.slice(0, 3)) {
		const a = readBody(raw);
		if (typeof a.question === "string" && typeof a.answer === "string") {
			out.push({ questionId: typeof a.questionId === "string" ? a.questionId : `q${out.length + 1}`, question: a.question.slice(0, 200), answer: a.answer.slice(0, 120) });
		}
	}
	return out;
}

function startBuild(id: string, g: Gate): void {
	runInBackground(id, () => buildRoadmap(depsFor(id, g)), (message) => {
		updater(id)((r) => {
			r.status = "error";
			r.error = `The build stopped: ${message}`;
		});
	});
}

export function createRoadmapRequest(raw: unknown): LearnResult {
	const body = readBody(raw);
	const topic = cleanTopic(body.topic);
	if (!topic) return fail(400, `Type what you want to learn (up to ${TOPIC_MAX} characters).`);
	const depth = isDepthId(body.depth) ? body.depth : "normal";
	const g = gate("build", depth, body.approved === true);
	if ("status" in g) return g;
	const stop = blocked(g);
	if (stop) return stop;
	const now = new Date().toISOString();
	const id = `rm_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
	const roadmap: Roadmap = {
		version: 1,
		id,
		topic,
		depth,
		createdAt: now,
		updatedAt: now,
		status: "building",
		title: topic,
		volatility: "evergreen",
		research: false,
		hours: 0,
		priming: parseAnswers(body.answers),
		tracks: [],
		stages: [],
		model: { provider: g.model.provider, id: g.model.id },
		spend: { usd: 0, calls: 0 },
		youtubeSearches: 0,
	};
	stores.learnStore.saveRoadmap(roadmap);
	emit("learn-changed", { roadmapId: id });
	startBuild(id, g);
	return ok({ id }, 201);
}

export function retryRoadmapRequest(id: string, raw: unknown): LearnResult {
	const found = stores.learnStore.getRoadmap(id);
	if (!found) return fail(404, "That roadmap does not exist.");
	const roadmap = settleInterrupted(found);
	if (roadmap.status !== "error") return fail(409, "This roadmap is not in an error state.", { needs: "nothing" });
	const g = gate("build", roadmap.depth, readBody(raw).approved === true);
	if ("status" in g) return g;
	const stop = blocked(g);
	if (stop) return stop;
	updater(id)((r) => {
		r.status = "building";
		delete r.error;
		r.title = r.topic;
		r.tracks = [];
		r.stages = [];
		r.model = { provider: g.model.provider, id: g.model.id };
	});
	startBuild(id, g);
	return ok({ ok: true }, 202);
}

export function listRoadmaps(): LearnResult {
	return ok({ roadmaps: stores.learnStore.listRoadmaps().map((r) => summarizeRoadmap(settleInterrupted(r))) });
}

export function getRoadmap(id: string): LearnResult {
	const roadmap = stores.learnStore.getRoadmap(id);
	return roadmap ? ok({ roadmap: settleInterrupted(roadmap) }) : fail(404, "That roadmap does not exist.");
}

export function deleteRoadmap(id: string): LearnResult {
	if (runs().has(id)) return fail(409, "This roadmap is still being built. Wait for it to finish, then delete it.");
	return stores.learnStore.deleteRoadmap(id) ? ok({ ok: true }) : fail(404, "That roadmap does not exist.");
}

export function fillStageRequest(id: string, stageId: string, raw: unknown): LearnResult {
	const found = stores.learnStore.getRoadmap(id);
	if (!found) return fail(404, "That roadmap does not exist.");
	const roadmap = settleInterrupted(found);
	const stage = roadmap.stages.find((s) => s.id === stageId);
	if (!stage) return fail(404, "That stage does not exist.");
	const key = `${id}:${stageId}`;
	if (stage.fill === "filled" || stage.fill === "filling" || runs().has(key)) return ok({ ok: true }, 202);
	const g = gate("fill", roadmap.depth, readBody(raw).approved === true);
	if ("status" in g) return g;
	const stop = blocked(g);
	if (stop) return stop;
	updater(id)((r) => {
		const s = r.stages.find((x) => x.id === stageId);
		if (s) {
			s.fill = "filling";
			delete s.error;
		}
	});
	runInBackground(key, () => fillStage(stageId, depsFor(id, g)), (message) => {
		updater(id)((r) => {
			const s = r.stages.find((x) => x.id === stageId);
			if (s) {
				s.fill = "error";
				s.error = `Loading this stage stopped: ${message}`;
			}
		});
	});
	return ok({ ok: true }, 202);
}

export function setTopicStateRequest(id: string, topicId: string, raw: unknown): LearnResult {
	const state = readBody(raw).state;
	if (!isTopicState(state)) return fail(400, 'state must be "todo", "learning", "done" or "skipped".');
	let found = false;
	const roadmap = updater(id)((r) => {
		for (const s of r.stages) {
			const t = s.topics.find((x) => x.id === topicId);
			if (t) {
				t.state = state;
				found = true;
			}
		}
	});
	if (!roadmap) return fail(404, "That roadmap does not exist.");
	if (!found) return fail(404, "That topic does not exist.");
	return ok({ roadmap });
}

export function exportRequest(id: string, params: URLSearchParams): LearnResult {
	const roadmap = stores.learnStore.getRoadmap(id);
	if (!roadmap) return fail(404, "That roadmap does not exist.");
	const stageId = params.get("stage") ?? "";
	if (!roadmap.stages.some((s) => s.id === stageId)) return fail(404, "That stage does not exist.");
	try {
		if (params.get("kind") === "flashcards") return ok(makeBridgeMessage("flashcards", flashcardsPayload(roadmap, stageId), randomUUID()));
		if (params.get("kind") === "calendar") {
			const schedule = { date: params.get("date") ?? "", time: params.get("time") ?? "18:00", minutes: Number(params.get("minutes") ?? "60") };
			const invalid = validSchedule(schedule);
			if (invalid) return fail(400, invalid);
			return ok(makeBridgeMessage("calendar", calendarPayload(roadmap, stageId, schedule), randomUUID()));
		}
	} catch (err) {
		return fail(400, err instanceof Error ? err.message : String(err));
	}
	return fail(400, 'kind must be "flashcards" or "calendar".');
}

export function outboxList(): LearnResult {
	return ok({ items: stores.learnStore.outboxList() });
}

export function outboxAdd(raw: unknown): LearnResult {
	if (!isBridgeMessage(raw)) return fail(400, "That is not a rika-learn bridge message (see docs/learn.md).");
	return ok({ id: stores.learnStore.outboxAdd(raw).id }, 201);
}

export function outboxAck(raw: unknown): LearnResult {
	const ids = readBody(raw).ids;
	if (!Array.isArray(ids) || !ids.every((x) => typeof x === "string")) return fail(400, "Send {ids: string[]}.");
	return ok({ removed: stores.learnStore.outboxAck(ids) });
}

// ─── Transport helpers for app/api/learn ──────────────────────────────────

export function learnResponse(result: LearnResult): Response {
	return Response.json(result.body, { status: result.status, headers: { "Cache-Control": "no-store" } });
}

/** The JSON body, {} for an empty body, or null when it is not JSON. */
export async function learnBody(req: Request): Promise<unknown> {
	const text = await req.text();
	if (!text.trim()) return {};
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

export const LEARN_BAD_JSON: LearnResult = fail(400, "The request body must be JSON.");
