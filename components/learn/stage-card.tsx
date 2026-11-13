"use client";
/**
 * ONE STAGE ON THE TIMELINE (docs/learn.md Flow 4–6): title, why, hours,
 * the stage it builds on, then "Start here" (the picks: one video first,
 * then one or two readings or exercises, each with the plain reason it was
 * picked), "More (n)" for the ranked rest, the topics with a Done /
 * Learning / Skip control, and the stage's actions.
 *
 * Lazy stages arrive "pending": collapsed, "Not loaded yet", and opening
 * them asks the container to load them (onToggle). Pure view.
 */
import type { ReactNode } from "react";
import { ChevronDownIcon, ExternalLinkIcon, GraduationCapIcon, PlayIcon, RotateCwIcon } from "lucide-react";
import type { Resource, Stage, StageResources, Topic, TopicState, TopicStatus } from "@/src/core";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { KIND_LABEL, formatHours, sourceLabel } from "./format.ts";
import { WorkingState } from "./priming.tsx";
import type { RoadmapIndex } from "./roadmap-index.ts";

const PROGRESS: { state: Exclude<TopicState, "todo">; label: string }[] = [
	{ state: "done", label: "Done" },
	{ state: "learning", label: "Learning" },
	{ state: "skipped", label: "Skip" },
];

/** Done / Learning / Skip. Clicking the active one returns the topic to
 *  "not started". */
export function TopicProgress({ state, title, onChange, disabled }: { state: TopicState; title: string; onChange: (next: TopicState) => void; disabled?: boolean }) {
	return (
		<div role="group" aria-label={`Progress for ${title}`} className="inline-flex shrink-0 rounded-md border border-border bg-background p-0.5">
			{PROGRESS.map((option) => {
				const active = state === option.state;
				return (
					<button
						key={option.state}
						type="button"
						aria-pressed={active}
						disabled={disabled}
						onClick={() => onChange(active ? "todo" : option.state)}
						className={cn(
							"rounded-sm px-2 py-1 text-xs transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
							active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
						)}
					>
						{option.label}
					</button>
				);
			})}
		</div>
	);
}

const STATUS_TEXT: Record<TopicStatus, string> = {
	locked: "Learn what it needs first",
	ready: "Ready to start",
	learning: "Learning",
	done: "Done",
	skipped: "Skipped",
};

export function topicStatusText(status: TopicStatus): string {
	return STATUS_TEXT[status];
}

const LINK = { target: "_blank", rel: "noopener noreferrer" } as const;

function ResourceItem({ resource }: { resource: Resource }) {
	const meta = [resource.by, resource.kind === "video" ? null : sourceLabel(resource.source), resource.minutes ? `${resource.minutes} min` : null].filter(Boolean);
	if (resource.kind === "video") {
		return (
			<li className="flex gap-3">
				<a href={resource.url} {...LINK} className="relative block w-28 shrink-0 overflow-hidden rounded-md border border-border bg-background sm:w-36" tabIndex={-1} aria-hidden>
					{resource.thumbnail ? (
						// eslint-disable-next-line @next/next/no-img-element -- remote thumbnails from the source API; no optimiser in the module build.
						<img src={resource.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" className="aspect-video w-full object-cover" />
					) : (
						<span className="flex aspect-video w-full items-center justify-center text-muted-foreground">
							<PlayIcon className="size-5" />
						</span>
					)}
				</a>
				<div className="min-w-0">
					<span className="text-xs uppercase tracking-wider text-muted-foreground">{KIND_LABEL.video}</span>
					<a href={resource.url} {...LINK} className="block font-prose text-base leading-snug text-foreground underline-offset-2 hover:underline">
						{resource.title}
					</a>
					{meta.length > 0 && <p className="text-xs text-muted-foreground">{meta.join(" · ")}</p>}
					<p className="mt-0.5 text-xs text-muted-foreground/80">{resource.reason}</p>
				</div>
			</li>
		);
	}
	return (
		<li className="min-w-0">
			<span className="text-xs uppercase tracking-wider text-muted-foreground">{KIND_LABEL[resource.kind]}</span>
			<a href={resource.url} {...LINK} className="flex items-start gap-1 font-prose text-base leading-snug text-foreground underline-offset-2 hover:underline">
				<span className="min-w-0">{resource.title}</span>
				<ExternalLinkIcon aria-hidden className="mt-1 size-3 shrink-0 text-muted-foreground" />
			</a>
			{meta.length > 0 && <p className="text-xs text-muted-foreground">{meta.join(" · ")}</p>}
			<p className="mt-0.5 text-xs text-muted-foreground/80">{resource.reason}</p>
		</li>
	);
}

/** The picks (videos first), then "More (n)" behind a disclosure. */
export function ResourceList({ resources }: { resources: StageResources }) {
	const picks = [...resources.picks].sort((a, b) => Number(b.kind === "video") - Number(a.kind === "video"));
	if (picks.length === 0 && resources.more.length === 0) {
		return <p className="text-sm text-muted-foreground">No resources were found for this stage.</p>;
	}
	return (
		<div className="flex flex-col gap-3">
			<ul className="flex flex-col gap-3">
				{picks.map((r) => (
					<ResourceItem key={r.id} resource={r} />
				))}
			</ul>
			{resources.more.length > 0 && (
				<details className="group rounded-md border border-border/60 px-3 py-2">
					<summary className="cursor-pointer list-none text-sm text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
						<span className="inline-flex items-center gap-1">
							<ChevronDownIcon aria-hidden className="size-3.5 -rotate-90 transition-transform group-open:rotate-0" />
							More ({resources.more.length})
						</span>
					</summary>
					<ul className="mt-3 flex flex-col gap-3">
						{resources.more.map((r) => (
							<ResourceItem key={r.id} resource={r} />
						))}
					</ul>
				</details>
			)}
		</div>
	);
}

export function TopicRow({
	topic,
	index,
	onSetTopic,
	onTeach,
}: {
	topic: Topic;
	index: RoadmapIndex;
	onSetTopic: (topicId: string, state: TopicState) => void;
	onTeach?: (topic: Topic) => void;
}) {
	const needs = topic.prereqs.map((id) => index.topicTitle.get(id)).filter((t): t is string => t !== undefined);
	const status = index.status.get(topic.id) ?? "ready";
	return (
		<li id={`topic-${topic.id}`} className="flex scroll-mt-20 flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
			<div className="min-w-0">
				<p className={cn("font-prose text-base text-foreground", (status === "done" || status === "skipped") && "text-muted-foreground line-through decoration-muted-foreground/50")}>
					{topic.title}
				</p>
				<p className="text-sm text-muted-foreground">
					{topic.objective} <span className="whitespace-nowrap text-xs">· {topic.minutes} min</span>
				</p>
				{needs.length > 0 && (
					<p className={cn("text-xs", status === "locked" ? "text-foreground" : "text-muted-foreground")}>Needs: {needs.join(", ")}</p>
				)}
				{onTeach && (
					<button type="button" onClick={() => onTeach(topic)} className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
						<GraduationCapIcon aria-hidden className="size-3.5" />
						Teach me this
					</button>
				)}
			</div>
			<TopicProgress state={topic.state} title={topic.title} onChange={(next) => onSetTopic(topic.id, next)} />
		</li>
	);
}

export function StageCard({
	stage,
	number,
	index,
	expanded,
	onToggle,
	onRetry,
	onSetTopic,
	onTeach,
	actions,
}: {
	stage: Stage;
	/** 1-based position in the roadmap. */
	number: number;
	index: RoadmapIndex;
	/** Whether the body is open. Pending stages are closed until opened. */
	expanded: boolean;
	/** Open/close; on a pending stage this is what loads it. */
	onToggle: () => void;
	onRetry: () => void;
	onSetTopic: (topicId: string, state: TopicState) => void;
	onTeach?: (topic: Topic) => void;
	/** "Send to Flashcards" / "Schedule in Calendar" (filled stages only). */
	actions?: ReactNode;
}) {
	const needs = stage.prereqs.map((id) => index.stageNumber.get(id)).filter((n): n is number => n !== undefined);
	const done = stage.topics.filter((t) => t.state === "done" || t.state === "skipped").length;
	const bodyId = `stage-body-${stage.id}`;
	const open = expanded && stage.fill === "filled";
	return (
		<article id={`stage-${stage.id}`} className="relative scroll-mt-20 pl-11" data-testid={`stage-${stage.id}`} data-fill={stage.fill}>
			{/* The timeline's numbered node. */}
			<span
				aria-hidden
				className={cn(
					"absolute left-0 top-3 flex size-8 items-center justify-center rounded-full border text-sm",
					stage.topics.length > 0 && done === stage.topics.length ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground",
				)}
			>
				{number}
			</span>
			<div className="rounded-lg border border-border bg-card">
				<button
					type="button"
					onClick={onToggle}
					aria-expanded={open}
					aria-controls={bodyId}
					className="flex w-full items-start gap-3 rounded-lg px-4 py-3 text-left outline-none hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50"
				>
					<span className="min-w-0 flex-1">
						<span className="sr-only">Stage {number}: </span>
						<span className="block font-prose text-lg font-semibold leading-snug text-foreground">{stage.title}</span>
						<span className="block text-sm text-muted-foreground">{stage.why}</span>
						<span className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
							<span>{formatHours(stage.hours)}</span>
							{needs.length > 0 && <span>Learn first: {needs.map((n) => `Stage ${n}`).join(", ")}</span>}
							{stage.fill === "filled" && stage.topics.length > 0 && (
								<span>
									{done} of {stage.topics.length} topics done
								</span>
							)}
							{stage.fill === "pending" && <span className="text-foreground">Not loaded yet</span>}
						</span>
					</span>
					<ChevronDownIcon aria-hidden className={cn("mt-1 size-4 shrink-0 text-muted-foreground transition-transform", !open && "-rotate-90")} />
				</button>

				<div id={bodyId} className="px-4 pb-4 empty:hidden">
					{stage.fill === "pending" && (
						<p className="text-sm text-muted-foreground">
							Open this stage to load its topics and resources.{" "}
							<button type="button" onClick={onToggle} className="text-foreground underline underline-offset-2">
								Load it now
							</button>
						</p>
					)}
					{stage.fill === "filling" && <WorkingState label="Finding topics and resources…" />}
					{stage.fill === "error" && (
						<div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-destructive">
							<span className="min-w-0 flex-1">{stage.error ?? "This stage could not be loaded."}</span>
							<Button size="sm" variant="outline" onClick={onRetry}>
								<RotateCwIcon />
								Retry
							</Button>
						</div>
					)}
					{open && (
						<div className="flex flex-col gap-5">
							<section aria-label={`Resources for ${stage.title}`}>
								<h4 className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">Start here</h4>
								<ResourceList resources={stage.resources} />
							</section>
							{stage.topics.length > 0 && (
								<section aria-label={`Topics in ${stage.title}`}>
									<h4 className="text-xs uppercase tracking-widest text-muted-foreground">Topics</h4>
									<ul className="divide-y divide-border/60">
										{stage.topics.map((topic) => (
											<TopicRow key={topic.id} topic={topic} index={index} onSetTopic={onSetTopic} onTeach={onTeach} />
										))}
									</ul>
								</section>
							)}
							{actions}
						</div>
					)}
				</div>
			</div>
		</article>
	);
}
