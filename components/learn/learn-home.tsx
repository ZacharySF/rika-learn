"use client";
/**
 * THE LEARN ENTRY (/learn, docs/learn.md Flow 1–3): "What do you want to
 * learn?", the depth picker, a one-line cost hint, "Build my roadmap",
 * then the priming questions one at a time, then the build starts and the
 * roadmap page opens. Below: the saved roadmaps.
 *
 * CostHint and RoadmapList are pure (render-tested); LearnHome is the thin
 * container that fetches and runs the spend gate.
 */
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRightIcon, NetworkIcon, SlidersHorizontalIcon, Trash2Icon } from "lucide-react";
import {
	DEFAULT_DEPTH,
	depthSpec,
	type CostEstimate,
	type DepthId,
	type LearnSettingsView,
	type PrimingAnswer,
	type PrimingQuestion,
	type RoadmapStatus,
	type RoadmapSummary,
	type SpendDecision,
} from "@/src/core";
import { useServerEvent, useServerResync } from "@/components/server-events";
import { useSettingsDialog } from "@/components/settings/settings-dialog.tsx";
import { TopBar } from "@/components/top-bar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { DepthPicker } from "./depth-picker.tsx";
import { formatUsd, plural } from "./format.ts";
import { learnApi, onLearnSettingsSaved } from "./learn-api.ts";
import { PrimingQuestions, WorkingState } from "./priming.tsx";
import { useSpendGate } from "./spend-gate.tsx";

// ─── pure parts ─────────────────────────────────────────────────────────────

export function costHintText({ modelName, usd, youtubeLeft }: { modelName: string; usd: number | null; youtubeLeft: number | null }): string {
	const parts = [`Uses ${modelName}`];
	if (usd !== null) parts.push(usd < 0.01 ? "less than $0.01" : `about ${formatUsd(usd)}`);
	if (youtubeLeft !== null) parts.push(`${plural(youtubeLeft, "YouTube search", "YouTube searches")} left today`);
	return parts.join(" · ");
}

export function CostHint({
	modelName,
	usd,
	youtubeLeft,
	decision,
	onOpenSettings,
}: {
	/** null = no model configured. */
	modelName: string | null;
	usd: number | null;
	youtubeLeft: number | null;
	decision?: SpendDecision["kind"];
	onOpenSettings: () => void;
}) {
	if (modelName === null) {
		return (
			<p className="text-xs text-muted-foreground" data-testid="learn-cost-hint">
				No model picked yet.{" "}
				<button type="button" className="text-foreground underline underline-offset-2" onClick={onOpenSettings}>
					Pick one in Settings
				</button>
			</p>
		);
	}
	return (
		<p className="text-xs text-muted-foreground" data-testid="learn-cost-hint">
			{costHintText({ modelName, usd, youtubeLeft })}
			{decision === "review" && <span className="block text-foreground">This is over today&apos;s limit, so you will be asked first.</span>}
			{decision === "needs-ceiling" && <span className="block">You will set a daily spending limit first.</span>}
		</p>
	);
}

const STATUS_LABEL: Record<RoadmapStatus, string> = { building: "Building", ready: "Ready", error: "Stopped with an error" };

export function RoadmapList({ roadmaps, onDelete }: { roadmaps: RoadmapSummary[]; onDelete: (id: string) => void }) {
	const [confirming, setConfirming] = useState<string | null>(null);
	if (roadmaps.length === 0) {
		return <p className="text-sm text-muted-foreground">No roadmaps yet. Type a topic above to build your first one.</p>;
	}
	return (
		<ul className="flex flex-col gap-2" data-testid="learn-roadmap-list">
			{roadmaps.map((r) => (
				<li key={r.id} className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5">
					<Link href={`/learn/${r.id}`} className="min-w-0 flex-1 rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
						<span className="block truncate font-prose text-base text-foreground">{r.title || r.topic}</span>
						<span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
							<span>{depthSpec(r.depth).label}</span>
							<span aria-hidden>·</span>
							<span>
								{r.done} of {r.topics} topics done
							</span>
							<span aria-hidden>·</span>
							<span className={cn(r.status === "error" && "text-destructive", r.status === "building" && "text-foreground")}>{STATUS_LABEL[r.status]}</span>
						</span>
					</Link>
					{confirming === r.id ? (
						<span className="flex shrink-0 items-center gap-1" role="group" aria-label={`Delete ${r.title || r.topic}?`}>
							<span className="hidden text-xs text-muted-foreground sm:inline">Delete it?</span>
							<Button size="xs" variant="destructive" onClick={() => onDelete(r.id)}>
								Yes, delete
							</Button>
							<Button size="xs" variant="ghost" onClick={() => setConfirming(null)}>
								Keep
							</Button>
						</span>
					) : (
						<Button size="sm" variant="ghost" aria-label={`Delete ${r.title || r.topic}`} className="shrink-0 text-muted-foreground" onClick={() => setConfirming(r.id)}>
							<Trash2Icon />
							<span className="hidden sm:inline">Delete</span>
						</Button>
					)}
				</li>
			))}
		</ul>
	);
}

// ─── the container ──────────────────────────────────────────────────────────

type Step =
	| { kind: "pick" }
	| { kind: "priming" }
	| { kind: "questions"; questions: PrimingQuestion[]; index: number; answers: PrimingAnswer[] }
	| { kind: "starting" };

export function LearnHome() {
	const router = useRouter();
	const { open: openSettings } = useSettingsDialog();
	const gate = useSpendGate();
	const api = useMemo(() => learnApi(), []);
	const [topic, setTopic] = useState("");
	const [depth, setDepth] = useState<DepthId>(DEFAULT_DEPTH);
	const [settings, setSettings] = useState<LearnSettingsView | null>(null);
	const [estimate, setEstimate] = useState<{ estimate: CostEstimate; decision: SpendDecision } | null>(null);
	const [roadmaps, setRoadmaps] = useState<RoadmapSummary[] | null>(null);
	const [listError, setListError] = useState<string | null>(null);
	const [step, setStep] = useState<Step>({ kind: "pick" });
	const [error, setError] = useState<string | null>(null);

	const loadSettings = useCallback(async () => {
		const result = await api.settings();
		if (result.kind === "ok") setSettings(result.data);
	}, [api]);
	const loadEstimate = useCallback(async () => {
		const result = await api.estimate(depth, "build");
		setEstimate(result.kind === "ok" ? result.data : null);
	}, [api, depth]);
	const loadRoadmaps = useCallback(async () => {
		const result = await api.roadmaps();
		if (result.kind === "ok") {
			setRoadmaps(result.data.roadmaps);
			setListError(null);
		} else if (result.kind === "error") setListError(result.error);
	}, [api]);

	useEffect(() => {
		void loadSettings();
		void loadRoadmaps();
	}, [loadSettings, loadRoadmaps]);
	useEffect(() => {
		void loadEstimate();
	}, [loadEstimate]);
	useEffect(
		() =>
			onLearnSettingsSaved(() => {
				void loadSettings();
				void loadEstimate();
			}),
		[loadSettings, loadEstimate],
	);
	useServerEvent("learn-changed", () => void loadRoadmaps());
	useServerResync(() => {
		void loadRoadmaps();
		void loadSettings();
	});

	const build = async (answers: PrimingAnswer[]) => {
		setStep({ kind: "starting" });
		const outcome = await gate.run((approved) => api.createRoadmap(topic.trim(), depth, answers, approved));
		if (outcome.kind === "ok") {
			router.push(`/learn/${encodeURIComponent(outcome.data.id)}`);
			return;
		}
		setStep({ kind: "pick" });
		if (outcome.kind === "error") setError(outcome.error);
	};

	const start = async (e?: FormEvent) => {
		e?.preventDefault();
		if (!topic.trim() || step.kind !== "pick") return;
		setError(null);
		setStep({ kind: "priming" });
		const outcome = await gate.run((approved) => api.prime(topic.trim(), depth, approved));
		if (outcome.kind === "ok") {
			const questions = outcome.data.questions;
			if (questions.length === 0) await build([]);
			else setStep({ kind: "questions", questions, index: 0, answers: [] });
			return;
		}
		setStep({ kind: "pick" });
		if (outcome.kind === "error") setError(outcome.error);
	};

	const answer = (text: string) => {
		if (step.kind !== "questions") return;
		const question = step.questions[step.index];
		if (!question) return;
		const answers = [...step.answers, { questionId: question.id, question: question.question, answer: text }];
		if (step.index + 1 < step.questions.length) setStep({ ...step, index: step.index + 1, answers });
		else void build(answers);
	};

	const remove = async (id: string) => {
		const result = await api.deleteRoadmap(id);
		if (result.kind === "error" && result.status !== 404) setListError(result.error);
		await loadRoadmaps();
	};

	const youtube = settings?.sources.find((s) => s.id === "youtube");
	const youtubeLeft = settings && youtube?.enabled && youtube.available ? Math.max(0, settings.youtube.limit - settings.youtube.used) : null;
	const question = step.kind === "questions" ? step.questions[step.index] : undefined;

	return (
		<div className="flex min-h-dvh flex-col">
			<TopBar />
			<div className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-4 py-8 sm:py-12">
				<section className="flex flex-col gap-6">
					{step.kind === "pick" ? (
						<form onSubmit={(e) => void start(e)} className="flex flex-col gap-6">
							<label className="flex flex-col gap-3">
								<span className="font-title text-3xl tracking-tight text-foreground sm:text-4xl">What do you want to learn?</span>
								<Input
									autoFocus
									value={topic}
									onChange={(e) => setTopic(e.target.value)}
									placeholder="e.g. linear algebra, Rust, music theory"
									className="h-12 rounded-lg px-4 text-lg md:text-lg"
									maxLength={200}
									data-testid="learn-topic"
								/>
							</label>
							<DepthPicker value={depth} onChange={setDepth} />
							<div className="flex flex-col gap-3">
								<CostHint
									modelName={settings ? (settings.model?.name ?? null) : "your cheap model"}
									usd={estimate?.estimate.usd ?? null}
									youtubeLeft={youtubeLeft}
									decision={estimate?.decision.kind}
									onOpenSettings={() => openSettings("agent")}
								/>
								<div>
									<Button type="submit" size="lg" disabled={!topic.trim()} data-testid="learn-build">
										Build my roadmap
										<ArrowRightIcon />
									</Button>
								</div>
							</div>
						</form>
					) : (
						<div className="flex flex-col gap-5">
							<p className="text-xs text-muted-foreground">
								Learning <span className="text-foreground">{topic.trim()}</span> · {depthSpec(depth).label} ({depthSpec(depth).span})
							</p>
							{step.kind === "priming" && <WorkingState label="Writing your questions…" />}
							{step.kind === "starting" && <WorkingState label="Starting your roadmap…" />}
							{step.kind === "questions" && question && (
								<PrimingQuestions
									question={question}
									index={step.index}
									total={step.questions.length}
									onAnswer={answer}
									onSkip={() => void build(step.answers)}
								/>
							)}
						</div>
					)}
					{error && (
						<div role="alert" className="flex flex-wrap items-center gap-3 rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive">
							<span className="min-w-0 flex-1">{error}</span>
							{step.kind === "pick" && topic.trim() && (
								<Button size="sm" variant="outline" onClick={() => void start()}>
									Try again
								</Button>
							)}
						</div>
					)}
				</section>

				<section aria-labelledby="learn-roadmaps-title" className="flex flex-col gap-3">
					<div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
						<h2 id="learn-roadmaps-title" className="text-sm uppercase tracking-widest text-foreground">
							Your roadmaps
						</h2>
						<nav aria-label="More places" className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
							<Link href="/?view=graph" className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground">
								<NetworkIcon className="size-3.5" aria-hidden />
								Your knowledge graph
							</Link>
							<button type="button" onClick={() => openSettings("learn")} className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground">
								<SlidersHorizontalIcon className="size-3.5" aria-hidden />
								Sources &amp; spending
							</button>
						</nav>
					</div>
					{listError && (
						<p role="alert" className="text-sm text-destructive">
							{listError}{" "}
							<button type="button" className="underline underline-offset-2" onClick={() => void loadRoadmaps()}>
								Retry
							</button>
						</p>
					)}
					{roadmaps === null ? (
						!listError && <WorkingState label="Loading your roadmaps…" />
					) : (
						<RoadmapList roadmaps={roadmaps} onDelete={(id) => void remove(id)} />
					)}
				</section>
			</div>
			{gate.dialog}
		</div>
	);
}
