"use client";
/**
 * The roadmap page's pure pieces: the header (what, how deep, where you
 * stand), the Timeline | Map toggle, and the map's topic details panel.
 */
import { CheckIcon, Loader2Icon, RotateCwIcon } from "lucide-react";
import { depthSpec, type Roadmap, type Topic, type TopicState } from "@/src/core";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatHours } from "./format.ts";
import type { RoadmapIndex } from "./roadmap-index.ts";
import { ResourceList, TopicProgress, topicStatusText } from "./stage-card.tsx";

export type RoadmapViewMode = "timeline" | "map";

export function RoadmapHeader({
	roadmap,
	index,
	connected,
	onRetryBuild,
}: {
	roadmap: Roadmap;
	index: RoadmapIndex;
	/** rika answered our hello. */
	connected: boolean;
	/** Shown with a build error: start the same roadmap again. */
	onRetryBuild?: () => void;
}) {
	const depth = depthSpec(roadmap.depth);
	const percent = index.total === 0 ? 0 : Math.round((index.done / index.total) * 100);
	return (
		<header className="flex flex-col gap-3">
			<div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
				<span className="truncate">{roadmap.topic}</span>
				{connected && (
					<span className="ml-auto inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-foreground" data-testid="rika-connected">
						<CheckIcon aria-hidden className="size-3" />
						Connected to rika
					</span>
				)}
			</div>
			<h1 className="font-title text-3xl leading-tight tracking-tight text-foreground sm:text-4xl">{roadmap.title || roadmap.topic}</h1>
			<div className="flex flex-wrap items-center gap-2 text-xs">
				<span className="rounded-full border border-border bg-card px-2.5 py-1 text-foreground" title="How deep this roadmap goes">
					{depth.label} · {depth.span}
				</span>
				{roadmap.hours > 0 && <span className="rounded-full border border-border bg-card px-2.5 py-1 text-muted-foreground">About {formatHours(roadmap.hours)} in total</span>}
			</div>
			{roadmap.level && (
				<p className="text-sm text-muted-foreground">
					<span className="text-foreground">Starting level: {roadmap.level.label}.</span> {roadmap.level.summary}
				</p>
			)}
			<div className="flex items-center gap-3">
				<div
					className="h-1.5 flex-1 overflow-hidden rounded-full bg-accent"
					role="progressbar"
					aria-label="Topics done"
					aria-valuemin={0}
					aria-valuemax={index.total}
					aria-valuenow={index.done}
				>
					<div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${percent}%` }} />
				</div>
				<span className="shrink-0 text-xs text-muted-foreground">
					{index.done} of {index.total} topics done
				</span>
			</div>
			{roadmap.status === "building" && (
				<p role="status" className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm text-muted-foreground">
					<Loader2Icon aria-hidden className="size-4 animate-spin" />
					Building… stages appear as they are written
				</p>
			)}
			{roadmap.status === "error" && (
				<div role="alert" className="flex flex-wrap items-center gap-3 rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive">
					<span className="min-w-0 flex-1">{roadmap.error ?? "The roadmap stopped before it was finished."}</span>
					{onRetryBuild && (
						<Button size="sm" variant="outline" onClick={onRetryBuild}>
							<RotateCwIcon />
							Try building again
						</Button>
					)}
				</div>
			)}
		</header>
	);
}

const MODES: { mode: RoadmapViewMode; label: string }[] = [
	{ mode: "timeline", label: "Timeline" },
	{ mode: "map", label: "Map" },
];

export function ViewToggle({ view, onChange }: { view: RoadmapViewMode; onChange: (view: RoadmapViewMode) => void }) {
	return (
		<div role="group" aria-label="Show the roadmap as" className="inline-flex rounded-md border border-border bg-background p-0.5">
			{MODES.map(({ mode, label }) => (
				<button
					key={mode}
					type="button"
					aria-pressed={view === mode}
					onClick={() => onChange(mode)}
					className={cn(
						"rounded-sm px-3 py-1 text-sm transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
						view === mode ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
					)}
				>
					{label}
				</button>
			))}
		</div>
	);
}

export function TopicDetails({
	roadmap,
	index,
	topicId,
	onSetTopic,
	onShowInTimeline,
	onTeach,
}: {
	roadmap: Roadmap;
	index: RoadmapIndex;
	topicId: string | null;
	onSetTopic: (topicId: string, state: TopicState) => void;
	onShowInTimeline: (topicId: string) => void;
	onTeach?: (topic: Topic) => void;
}) {
	const stageId = topicId ? index.topicStage.get(topicId) : undefined;
	const stage = stageId ? roadmap.stages.find((s) => s.id === stageId) : undefined;
	const topic = stage?.topics.find((t) => t.id === topicId);
	if (!stage || !topic) {
		return (
			<aside className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground" aria-live="polite">
				Pick a star on the map to see that topic here.
			</aside>
		);
	}
	const needs = topic.prereqs.map((id) => index.topicTitle.get(id)).filter((t): t is string => t !== undefined);
	return (
		<aside className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4" aria-live="polite" data-testid="topic-details">
			<p className="text-xs text-muted-foreground">
				Stage {index.stageNumber.get(stage.id)} · {stage.title}
			</p>
			<h2 className="font-prose text-lg font-semibold leading-snug text-foreground">{topic.title}</h2>
			<p className="text-sm text-muted-foreground">
				{topic.objective} <span className="whitespace-nowrap text-xs">· {topic.minutes} min</span>
			</p>
			{needs.length > 0 && <p className="text-xs text-muted-foreground">Needs: {needs.join(", ")}</p>}
			<p className="text-xs text-foreground">{topicStatusText(index.status.get(topic.id) ?? "ready")}</p>
			<TopicProgress state={topic.state} title={topic.title} onChange={(next) => onSetTopic(topic.id, next)} />
			{stage.resources.picks.length > 0 && (
				<section aria-label="Start here">
					<h3 className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">Start here</h3>
					<ResourceList resources={{ picks: stage.resources.picks, more: [] }} />
				</section>
			)}
			<div className="flex flex-wrap gap-2">
				<Button size="sm" variant="outline" onClick={() => onShowInTimeline(topic.id)}>
					Show in timeline
				</Button>
				{onTeach && (
					<Button size="sm" variant="ghost" onClick={() => onTeach(topic)}>
						Teach me this
					</Button>
				)}
			</div>
		</aside>
	);
}
