"use client";
/**
 * THE SPENDING DIALOGS (docs/learn.md "Spending"): the first-run "set a
 * daily limit" ask (409 ceiling), the review sheet when a call would go
 * over it (402 review), and the "pick a model first" notice (503 model).
 * Pure views: the spend gate (spend-gate.tsx) owns the requests.
 */
import { useEffect, useId, useState, type ReactNode } from "react";
import type { SpendPhase, SpendReview } from "@/src/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatUsd } from "./format.ts";

export const DEFAULT_CEILING_USD = 0.5;

const PHASE_LABEL: Record<SpendPhase, string> = {
	prime: "Writing the questions",
	build: "Building the roadmap",
	fill: "Loading this stage",
};

/** A small modal: bottom sheet on narrow frames, centred card on wide ones.
 *  Esc cancels. */
function LearnDialog({ title, onCancel, children, footer, testid }: { title: string; onCancel: () => void; children: ReactNode; footer: ReactNode; testid: string }) {
	const titleId = useId();
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			e.preventDefault();
			e.stopPropagation();
			onCancel();
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [onCancel]);
	return (
		<div className="fixed inset-0 z-50 flex items-end justify-center bg-background/80 sm:items-center" data-testid={`${testid}-backdrop`}>
			<div
				role="dialog"
				aria-modal="true"
				aria-labelledby={titleId}
				data-testid={testid}
				className="w-full max-w-md rounded-t-xl border border-border bg-card p-5 shadow-xl sm:rounded-xl"
			>
				<h2 id={titleId} className="font-prose text-lg font-semibold text-foreground">
					{title}
				</h2>
				<div className="mt-2 flex flex-col gap-3 font-prose text-sm text-muted-foreground">{children}</div>
				<div className="mt-5 flex flex-wrap justify-end gap-2">{footer}</div>
			</div>
		</div>
	);
}

/** Parse what the learner typed into a limit: a positive dollar amount. */
export function parseCeiling(text: string): number | null {
	const value = Number(text.trim().replace(/^\$/, ""));
	return Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : null;
}

export function CeilingDialog({
	initialUsd,
	onSave,
	onCancel,
	saving = false,
	error = null,
	firstRun = true,
}: {
	/** The current limit (null = not set yet → $0.50). */
	initialUsd: number | null;
	onSave: (usd: number) => void;
	onCancel: () => void;
	saving?: boolean;
	error?: string | null;
	/** false when opened from the review sheet's "Change limit". */
	firstRun?: boolean;
}) {
	const inputId = useId();
	const [text, setText] = useState((initialUsd ?? DEFAULT_CEILING_USD).toFixed(2));
	const value = parseCeiling(text);
	return (
		<LearnDialog
			title={firstRun ? "Set a daily spending limit" : "Change your daily limit"}
			onCancel={onCancel}
			testid="learn-ceiling-dialog"
			footer={
				<>
					<Button variant="ghost" onClick={onCancel}>
						Cancel
					</Button>
					<Button disabled={value === null || saving} onClick={() => value !== null && onSave(value)}>
						{saving ? "Saving…" : "Save"}
					</Button>
				</>
			}
		>
			<p>Learn pays for its model calls with your own provider key, so you decide how much it may spend in a day.</p>
			<p>Calls that stay under the limit run without asking. If one would go over it, you are asked first.</p>
			<label htmlFor={inputId} className="mt-1 text-foreground">
				Daily limit in US dollars
			</label>
			<div className="flex items-center gap-2">
				<span aria-hidden className="text-foreground">
					$
				</span>
				<Input
					id={inputId}
					type="number"
					inputMode="decimal"
					min="0.01"
					step="0.05"
					value={text}
					aria-invalid={value === null}
					onChange={(e) => setText(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter" && value !== null && !saving) onSave(value);
					}}
					className="w-28"
				/>
				<span className="text-xs">per day</span>
			</div>
			{value === null && <p className="text-xs text-destructive">Enter an amount above $0.</p>}
			{error && (
				<p role="alert" className="text-xs text-destructive">
					{error}
				</p>
			)}
			<p className="text-xs">You can change it any time in Settings → Learn.</p>
		</LearnDialog>
	);
}

export function ReviewSheet({
	review,
	onApprove,
	onChangeLimit,
	onCancel,
}: {
	review: SpendReview;
	onApprove: () => void;
	onChangeLimit: () => void;
	onCancel: () => void;
}) {
	const rows: [string, string][] = [
		[`${PHASE_LABEL[review.phase]} will cost about`, formatUsd(review.estimateUsd)],
		["Spent today", formatUsd(review.spentTodayUsd)],
		["Your daily limit", formatUsd(review.ceilingUsd)],
		["Model", review.model],
	];
	return (
		<LearnDialog
			title="This would go over today's limit"
			onCancel={onCancel}
			testid="learn-review-sheet"
			footer={
				<>
					<Button variant="ghost" onClick={onCancel}>
						Cancel
					</Button>
					<Button variant="outline" onClick={onChangeLimit}>
						Change limit
					</Button>
					<Button onClick={onApprove}>Go ahead this time</Button>
				</>
			}
		>
			<dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 rounded-md border border-border bg-background px-3 py-2.5">
				{rows.map(([label, value]) => (
					<div key={label} className="contents">
						<dt>{label}</dt>
						<dd className="text-right font-ui text-foreground">{value}</dd>
					</div>
				))}
			</dl>
			<p>&ldquo;Go ahead this time&rdquo; runs it once without changing your limit.</p>
		</LearnDialog>
	);
}

export function ModelNeededDialog({ message, onOpenSettings, onCancel }: { message: string; onOpenSettings: () => void; onCancel: () => void }) {
	return (
		<LearnDialog
			title="Pick a model first"
			onCancel={onCancel}
			testid="learn-model-needed"
			footer={
				<>
					<Button variant="ghost" onClick={onCancel}>
						Cancel
					</Button>
					<Button onClick={onOpenSettings}>Open Settings</Button>
				</>
			}
		>
			<p>{message}</p>
			<p>Learn uses your cheap model slot. Pick one under Settings → Agent, or add a provider key under Settings → Providers first.</p>
		</LearnDialog>
	);
}
