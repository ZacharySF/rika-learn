"use client";
/**
 * THE SPEND GATE: runs a spending Learn request (prime, build, stage fill)
 * and answers the server's asks in between. 409 "ceiling" → the learner
 * sets a daily limit, it is saved, the request repeats. 402 "review" →
 * "Go ahead this time" repeats it with `approved: true`, "Change limit"
 * saves a new limit and repeats it plainly. 503 "model" → a pointer to
 * Settings. Every round is a learner's click, so the loop cannot run away.
 *
 * Asks are queued: two stages opened at once get one dialog after the other.
 */
import { useCallback, useRef, useState, type ReactNode } from "react";
import type { SpendReview } from "@/src/core";
import { useSettingsDialog } from "@/components/settings/settings-dialog.tsx";
import { learnApi, notifyLearnSettingsSaved, type LearnResult } from "./learn-api.ts";
import { CeilingDialog, ModelNeededDialog, ReviewSheet } from "./spend-dialogs.tsx";

export type GateOutcome<T> = { kind: "ok"; data: T } | { kind: "cancelled" } | { kind: "error"; error: string };

type Ask =
	| { kind: "ceiling"; initialUsd: number | null; firstRun: boolean }
	| { kind: "review"; review: SpendReview }
	| { kind: "model"; message: string };

type Choice = "retry" | "approve" | "cancel";

export interface SpendGate {
	run<T>(call: (approved: boolean) => Promise<LearnResult<T>>): Promise<GateOutcome<T>>;
	/** Render this once; it is empty unless an ask is open. */
	dialog: ReactNode;
}

export function useSpendGate(): SpendGate {
	const { open: openSettings } = useSettingsDialog();
	const [ask, setAsk] = useState<{ id: number; ask: Ask } | null>(null);
	const [saving, setSaving] = useState(false);
	const [saveError, setSaveError] = useState<string | null>(null);
	const resolver = useRef<((choice: Choice) => void) | null>(null);
	const queue = useRef<Promise<unknown>>(Promise.resolve());
	const nextId = useRef(0);

	const choose = useCallback((choice: Choice) => {
		const resolve = resolver.current;
		resolver.current = null;
		setAsk(null);
		setSaving(false);
		resolve?.(choice);
	}, []);

	const prompt = useCallback((next: Ask) => {
		const answer = queue.current.then(
			() =>
				new Promise<Choice>((resolve) => {
					resolver.current = resolve;
					setSaveError(null);
					setAsk({ id: nextId.current++, ask: next });
				}),
		);
		queue.current = answer;
		return answer;
	}, []);

	const run = useCallback(
		async <T,>(call: (approved: boolean) => Promise<LearnResult<T>>): Promise<GateOutcome<T>> => {
			let approved = false;
			for (;;) {
				const result = await call(approved);
				if (result.kind === "ok") return { kind: "ok", data: result.data };
				if (result.kind === "error") return { kind: "error", error: result.error };
				const choice = await prompt(
					result.kind === "needs-ceiling"
						? { kind: "ceiling", initialUsd: null, firstRun: true }
						: result.kind === "review"
							? { kind: "review", review: result.review }
							: { kind: "model", message: result.error },
				);
				if (choice === "cancel") return { kind: "cancelled" };
				approved = choice === "approve";
			}
		},
		[prompt],
	);

	const saveCeiling = async (usd: number) => {
		setSaving(true);
		setSaveError(null);
		const saved = await learnApi().saveSettings({ dailyCeilingUsd: usd });
		if (saved.kind === "ok") {
			notifyLearnSettingsSaved();
			choose("retry");
			return;
		}
		setSaving(false);
		setSaveError(saved.kind === "error" ? saved.error : "The limit could not be saved. Try again.");
	};

	let dialog: ReactNode = null;
	if (ask?.ask.kind === "ceiling") {
		dialog = (
			<CeilingDialog
				key={ask.id}
				initialUsd={ask.ask.initialUsd}
				firstRun={ask.ask.firstRun}
				saving={saving}
				error={saveError}
				onSave={(usd) => void saveCeiling(usd)}
				onCancel={() => choose("cancel")}
			/>
		);
	} else if (ask?.ask.kind === "review") {
		const { review } = ask.ask;
		dialog = (
			<ReviewSheet
				review={review}
				onApprove={() => choose("approve")}
				onCancel={() => choose("cancel")}
				onChangeLimit={() => setAsk({ id: nextId.current++, ask: { kind: "ceiling", initialUsd: review.ceilingUsd, firstRun: false } })}
			/>
		);
	} else if (ask?.ask.kind === "model") {
		dialog = (
			<ModelNeededDialog
				message={ask.ask.message}
				onCancel={() => choose("cancel")}
				onOpenSettings={() => {
					choose("cancel");
					openSettings("agent");
				}}
			/>
		);
	}
	return { run, dialog };
}
