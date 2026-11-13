"use client";
/**
 * THE ROADMAP PAGE (/learn/[id], docs/learn.md Flow 3–6): header, the
 * Timeline | Map toggle (Timeline by default, Map remembered as ?view=map),
 * stages streaming in while the build runs, lazy stages loaded when
 * opened, progress marks, and the hand-offs to rika.
 *
 * Truth comes from GET /api/learn/roadmaps/:id; the server's
 * "learn-changed" event (and every channel reconnect) triggers a refetch.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeftIcon, RotateCwIcon } from "lucide-react";
import type { Roadmap, Stage, Topic, TopicState } from "@/src/core";
import { StarMap } from "@/components/learn/star-map";
import { startDraftSession } from "@/components/new-session";
import { useServerEvent, useServerResync } from "@/components/server-events";
import { TopBar } from "@/components/top-bar";
import { Button } from "@/components/ui/button";
import { learnApi } from "./learn-api.ts";
import { WorkingState } from "./priming.tsx";
import { createRikaBridge, type RikaBridge } from "./rika-bridge.ts";
import { indexRoadmap, type RoadmapIndex } from "./roadmap-index.ts";
import { RoadmapHeader, TopicDetails, ViewToggle, type RoadmapViewMode } from "./roadmap-parts.tsx";
import { useSpendGate } from "./spend-gate.tsx";
import { StageActions } from "./stage-actions.tsx";
import { StageCard } from "./stage-card.tsx";

function withTopicState(roadmap: Roadmap, topicId: string, state: TopicState): Roadmap {
	return {
		...roadmap,
		stages: roadmap.stages.map((stage) =>
			stage.topics.some((t) => t.id === topicId) ? { ...stage, topics: stage.topics.map((t) => (t.id === topicId ? { ...t, state } : t)) } : stage,
		),
	};
}

/** The stages under their track headings (Ultra, Ultraviolet), or one
 *  untitled group for depths without tracks. */
function groupStages(roadmap: Roadmap): { id: string; title?: string; why?: string; stages: Stage[] }[] {
	if (roadmap.tracks.length === 0) return [{ id: "all", stages: roadmap.stages }];
	const groups = roadmap.tracks.map((track) => ({ id: track.id, title: track.title, why: track.why, stages: roadmap.stages.filter((s) => s.trackId === track.id) }));
	const known = new Set(roadmap.tracks.map((t) => t.id));
	const loose = roadmap.stages.filter((s) => !s.trackId || !known.has(s.trackId));
	return loose.length > 0 ? [...groups, { id: "other", title: "More stages", stages: loose }] : groups;
}

function Timeline({
	roadmap,
	index,
	isExpanded,
	onToggle,
	onRetry,
	onSetTopic,
	onTeach,
	bridge,
}: {
	roadmap: Roadmap;
	index: RoadmapIndex;
	isExpanded: (stage: Stage) => boolean;
	onToggle: (stage: Stage) => void;
	onRetry: (stage: Stage) => void;
	onSetTopic: (topicId: string, state: TopicState) => void;
	onTeach: (topic: Topic) => void;
	bridge: RikaBridge | null;
}) {
	if (roadmap.stages.length === 0) {
		return roadmap.status === "building" ? (
			<WorkingState label="The first stage is on its way…" />
		) : (
			<p className="text-sm text-muted-foreground">This roadmap has no stages.</p>
		);
	}
	return (
		<div className="flex flex-col gap-8">
			{groupStages(roadmap).map((group) => (
				<section key={group.id} aria-label={group.title ?? "Stages"} className="flex flex-col gap-3">
					{group.title && (
						<div>
							<h2 className="text-sm uppercase tracking-widest text-foreground">{group.title}</h2>
							{group.why && <p className="text-sm text-muted-foreground">{group.why}</p>}
						</div>
					)}
					{group.stages.length === 0 ? (
						<p className="text-sm text-muted-foreground">Its stages are still being written.</p>
					) : (
						<ol className="relative flex flex-col gap-4 before:absolute before:top-4 before:bottom-4 before:left-4 before:w-px before:bg-border">
							{group.stages.map((stage) => (
								<li key={stage.id}>
									<StageCard
										stage={stage}
										number={index.stageNumber.get(stage.id) ?? 0}
										index={index}
										expanded={isExpanded(stage)}
										onToggle={() => onToggle(stage)}
										onRetry={() => onRetry(stage)}
										onSetTopic={onSetTopic}
										onTeach={onTeach}
										actions={stage.fill === "filled" ? <StageActions roadmapId={roadmap.id} stage={stage} bridge={bridge} /> : undefined}
									/>
								</li>
							))}
						</ol>
					)}
				</section>
			))}
		</div>
	);
}

export function RoadmapView({ id, initialView }: { id: string; initialView: RoadmapViewMode }) {
	const router = useRouter();
	const gate = useSpendGate();
	const api = useMemo(() => learnApi(), []);
	const [roadmap, setRoadmap] = useState<Roadmap | null>(null);
	const [loadError, setLoadError] = useState<{ status: number; error: string } | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);
	const [view, setView] = useState<RoadmapViewMode>(initialView);
	const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
	const [selected, setSelected] = useState<string | null>(null);
	const [scrollTo, setScrollTo] = useState<string | null>(null);
	const [bridge, setBridge] = useState<RikaBridge | null>(null);
	const [connected, setConnected] = useState(false);
	const inFlight = useRef(false);
	const again = useRef(false);
	const filling = useRef(new Set<string>());

	/** Coalesced refetch: an event burst during a fetch costs one more fetch. */
	const load = useCallback(async () => {
		if (inFlight.current) {
			again.current = true;
			return;
		}
		inFlight.current = true;
		try {
			do {
				again.current = false;
				const result = await api.roadmap(id);
				if (result.kind === "ok") {
					setRoadmap(result.data.roadmap);
					setLoadError(null);
				} else if (result.kind === "error") {
					setLoadError({ status: result.status, error: result.error });
				}
			} while (again.current);
		} finally {
			inFlight.current = false;
		}
	}, [api, id]);

	useEffect(() => {
		void load();
	}, [load]);
	useServerEvent("learn-changed", ({ roadmapId }) => {
		if (roadmapId === id) void load();
	});
	useServerResync(() => void load());

	useEffect(() => {
		const created = createRikaBridge(window);
		setBridge(created);
		return created.hello(() => setConnected(true));
	}, []);

	useEffect(() => {
		if (!scrollTo || view !== "timeline") return;
		const frame = requestAnimationFrame(() => {
			document.getElementById(`topic-${scrollTo}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
			setScrollTo(null);
		});
		return () => cancelAnimationFrame(frame);
	}, [scrollTo, view]);

	const index = useMemo(() => (roadmap ? indexRoadmap(roadmap) : null), [roadmap]);

	const changeView = (next: RoadmapViewMode) => {
		setView(next);
		const url = new URL(window.location.href);
		if (next === "map") url.searchParams.set("view", "map");
		else url.searchParams.delete("view");
		window.history.replaceState(null, "", url);
	};

	const fill = async (stageId: string) => {
		if (filling.current.has(stageId)) return;
		filling.current.add(stageId);
		setActionError(null);
		try {
			const outcome = await gate.run((approved) => api.fillStage(id, stageId, approved));
			if (outcome.kind === "ok") {
				setRoadmap((current) =>
					current ? { ...current, stages: current.stages.map((s) => (s.id === stageId ? { ...s, fill: "filling", error: undefined } : s)) } : current,
				);
			} else if (outcome.kind === "error") {
				setActionError(outcome.error);
			}
			await load();
		} finally {
			filling.current.delete(stageId);
		}
	};

	const openStage = (stage: Stage) => {
		if (stage.fill === "pending" || stage.fill === "error") {
			void fill(stage.id);
			return;
		}
		if (stage.fill !== "filled") return;
		setCollapsed((current) => {
			const next = new Set(current);
			if (next.has(stage.id)) next.delete(stage.id);
			else next.add(stage.id);
			return next;
		});
	};

	const setTopic = async (topicId: string, state: TopicState) => {
		setActionError(null);
		setRoadmap((current) => (current ? withTopicState(current, topicId, state) : current));
		const result = await api.setTopic(id, topicId, state);
		if (result.kind === "ok") {
			setRoadmap(result.data.roadmap);
			return;
		}
		setActionError(result.kind === "error" ? result.error : "That change could not be saved.");
		await load();
	};

	const teach = async (topic: Topic) => {
		setActionError(null);
		try {
			// The first message also becomes the session title, so it stays short.
			const href = await startDraftSession(`Teach me ${topic.title}: ${topic.objective}`, fetch);
			if (href) router.push(href);
		} catch {
			setActionError("Could not start a teaching session. Try again.");
		}
	};

	const showInTimeline = (topicId: string) => {
		const stageId = index?.topicStage.get(topicId);
		if (stageId) {
			setCollapsed((current) => {
				const next = new Set(current);
				next.delete(stageId);
				return next;
			});
		}
		changeView("timeline");
		setScrollTo(topicId);
	};

	/** A build that stopped with an error is rebuilt in place (same gates). */
	const retryBuild = async () => {
		setActionError(null);
		const outcome = await gate.run((approved) => api.retryRoadmap(id, approved));
		if (outcome.kind === "ok") setRoadmap((current) => (current ? { ...current, status: "building", error: undefined } : current));
		else if (outcome.kind === "error") setActionError(outcome.error);
		await load();
	};

	let body: ReactNode;
	if (!roadmap || !index) {
		body = loadError ? (
			<div role="alert" className="flex flex-col items-start gap-3">
				<p className="text-sm text-destructive">{loadError.status === 404 ? "This roadmap was not found. It may have been deleted." : loadError.error}</p>
				<div className="flex gap-2">
					{loadError.status !== 404 && (
						<Button size="sm" variant="outline" onClick={() => void load()}>
							<RotateCwIcon />
							Retry
						</Button>
					)}
					<Button size="sm" variant="ghost" asChild>
						<Link href="/learn">Back to Learn</Link>
					</Button>
				</div>
			</div>
		) : (
			<WorkingState label="Loading your roadmap…" />
		);
	} else {
		body = (
			<>
				<RoadmapHeader roadmap={roadmap} index={index} connected={connected} onRetryBuild={() => void retryBuild()} />
				<div className="flex flex-wrap items-center gap-3">
					<ViewToggle view={view} onChange={changeView} />
					<span className="text-xs text-muted-foreground">
						{view === "timeline" ? "Stages in order. Open one to see its topics and resources." : "Each star is a topic; lines mean “learn this first”."}
					</span>
				</div>
				{(actionError || (loadError && loadError.status !== 404)) && (
					<div role="alert" className="flex flex-wrap items-center gap-3 rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive">
						<span className="min-w-0 flex-1">{actionError ?? loadError?.error}</span>
						<Button
							size="sm"
							variant="outline"
							onClick={() => {
								setActionError(null);
								void load();
							}}
						>
							<RotateCwIcon />
							Retry
						</Button>
					</div>
				)}
				{view === "timeline" ? (
					<Timeline
						roadmap={roadmap}
						index={index}
						isExpanded={(stage) => stage.fill === "filled" && !collapsed.has(stage.id)}
						onToggle={openStage}
						onRetry={(stage) => void fill(stage.id)}
						onSetTopic={(topicId, state) => void setTopic(topicId, state)}
						onTeach={(topic) => void teach(topic)}
						bridge={bridge}
					/>
				) : (
					<div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
						<div className="min-w-0">
							<StarMap
								roadmap={roadmap}
								selectedTopicId={selected}
								onSelectTopic={setSelected}
								onOpenStage={(stageId) => {
									const stage = roadmap.stages.find((s) => s.id === stageId);
									if (stage && (stage.fill === "pending" || stage.fill === "error")) void fill(stageId);
								}}
							/>
						</div>
						<TopicDetails
							roadmap={roadmap}
							index={index}
							topicId={selected}
							onSetTopic={(topicId, state) => void setTopic(topicId, state)}
							onShowInTimeline={showInTimeline}
							onTeach={(topic) => void teach(topic)}
						/>
					</div>
				)}
			</>
		);
	}

	return (
		<div className="flex min-h-dvh flex-col">
			<TopBar>
				<Link href="/learn" className="inline-flex items-center gap-1.5 rounded-sm text-sm text-muted-foreground hover:text-foreground">
					<ArrowLeftIcon aria-hidden className="size-4" />
					All roadmaps
				</Link>
			</TopBar>
			<div className={`mx-auto flex w-full flex-col gap-6 px-4 py-6 sm:py-8 ${view === "map" ? "max-w-6xl" : "max-w-3xl"}`}>{body}</div>
			{gate.dialog}
		</div>
	);
}
