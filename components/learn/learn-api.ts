/**
 * THE LEARN CLIENT (docs/learn.md "HTTP API"): one reader turns every
 * /api/learn answer into a tagged result, so every screen handles the
 * three asks the same way — 409 "set a limit first", 402 "this goes over
 * the limit, go ahead?", 503 "no model picked" — and shows any other
 * failure as the server's own plain sentence.
 *
 * `fetch` is injected (a fake in tests).
 */
import type {
	BridgeMessage,
	CostEstimate,
	DepthId,
	LearnSettings,
	LearnSettingsView,
	ModelRef,
	PrimingAnswer,
	PrimingQuestion,
	Roadmap,
	RoadmapSummary,
	SpendDecision,
	SpendPhase,
	SpendReview,
	TopicState,
} from "@/src/core";

export type LearnResult<T> =
	| { kind: "ok"; status: number; data: T }
	| { kind: "needs-ceiling" }
	| { kind: "review"; review: SpendReview }
	| { kind: "needs-model"; error: string }
	| { kind: "error"; status: number; error: string };

const OFFLINE = "Could not reach Learn. Check that the app is still running, then try again.";

export async function learnRequest<T>(
	path: string,
	init: { method?: string; body?: unknown },
	fetchLike: typeof fetch = fetch,
): Promise<LearnResult<T>> {
	let res: Response;
	try {
		res = await fetchLike(path, {
			method: init.method ?? "GET",
			cache: "no-store",
			...(init.body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(init.body) }),
		});
	} catch {
		return { kind: "error", status: 0, error: OFFLINE };
	}
	const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
	if (res.ok) return { kind: "ok", status: res.status, data: body as T };
	const error = typeof body?.error === "string" && body.error ? body.error : `Something went wrong (error ${res.status}). Try again.`;
	if (res.status === 409 && body?.needs === "ceiling") return { kind: "needs-ceiling" };
	if (res.status === 402 && body?.needs === "review" && body.review) return { kind: "review", review: body.review as SpendReview };
	if (res.status === 503 && body?.needs === "model") return { kind: "needs-model", error };
	return { kind: "error", status: res.status, error };
}

/** PUT /settings accepts `model: null` to drop a pinned model (back to the
 *  cheap slot) — JSON cannot carry `undefined`. */
export type LearnSettingsPatch = Partial<Omit<LearnSettings, "model">> & { model?: ModelRef | null };

export type ExportRequest =
	| { kind: "flashcards"; stage: string }
	| { kind: "calendar"; stage: string; date: string; time: string; minutes: number };

/** Window-local "Learn settings changed" signal (the core settings signal's
 *  section roster does not include Learn): the entry screen refreshes its
 *  cost hint when the limit, model or sources change elsewhere. */
const LEARN_SETTINGS_SAVED = "lh:learn-settings-saved";

export function notifyLearnSettingsSaved(): void {
	window.dispatchEvent(new Event(LEARN_SETTINGS_SAVED));
}

export function onLearnSettingsSaved(handler: () => void): () => void {
	window.addEventListener(LEARN_SETTINGS_SAVED, handler);
	return () => window.removeEventListener(LEARN_SETTINGS_SAVED, handler);
}

export function learnApi(fetchLike: typeof fetch = fetch) {
	const call = <T>(path: string, init: { method?: string; body?: unknown } = {}) => learnRequest<T>(`/api/learn${path}`, init, fetchLike);
	const roadmap = (id: string) => `/roadmaps/${encodeURIComponent(id)}`;
	const withApproval = (approved: boolean) => (approved ? { approved: true } : {});
	return {
		settings: () => call<LearnSettingsView>("/settings"),
		saveSettings: (patch: LearnSettingsPatch) => call<LearnSettingsView>("/settings", { method: "PUT", body: patch }),
		estimate: (depth: DepthId, phase: SpendPhase) =>
			call<{ estimate: CostEstimate; decision: SpendDecision }>(`/estimate?${new URLSearchParams({ depth, phase })}`),
		prime: (topic: string, depth: DepthId, approved: boolean) =>
			call<{ questions: PrimingQuestion[] }>("/prime", { method: "POST", body: { topic, depth, ...withApproval(approved) } }),
		roadmaps: () => call<{ roadmaps: RoadmapSummary[] }>("/roadmaps"),
		createRoadmap: (topic: string, depth: DepthId, answers: PrimingAnswer[], approved: boolean) =>
			call<{ id: string }>("/roadmaps", { method: "POST", body: { topic, depth, answers, ...withApproval(approved) } }),
		roadmap: (id: string) => call<{ roadmap: Roadmap }>(roadmap(id)),
		deleteRoadmap: (id: string) => call<{ ok: true }>(roadmap(id), { method: "DELETE" }),
		/** Rebuild a roadmap whose build stopped with an error, in place. */
		retryRoadmap: (id: string, approved: boolean) => call<{ ok: true }>(`${roadmap(id)}/retry`, { method: "POST", body: withApproval(approved) }),
		fillStage: (id: string, stageId: string, approved: boolean) =>
			call<{ ok: true }>(`${roadmap(id)}/stages/${encodeURIComponent(stageId)}/fill`, { method: "POST", body: withApproval(approved) }),
		setTopic: (id: string, topicId: string, state: TopicState) =>
			call<{ roadmap: Roadmap }>(`${roadmap(id)}/topics/${encodeURIComponent(topicId)}`, { method: "PUT", body: { state } }),
		exportStage: (id: string, request: ExportRequest) => {
			const query: Record<string, string> =
				request.kind === "calendar"
					? { kind: request.kind, stage: request.stage, date: request.date, time: request.time, minutes: String(request.minutes) }
					: { kind: request.kind, stage: request.stage };
			return call<BridgeMessage>(`${roadmap(id)}/export?${new URLSearchParams(query)}`);
		},
		saveToOutbox: (message: BridgeMessage) => call<{ id: string }>("/bridge/outbox", { method: "POST", body: message }),
	};
}
