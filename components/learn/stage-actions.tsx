"use client";
/**
 * A STAGE'S HAND-OFFS TO RIKA (docs/learn.md "Bridge to rika"): "Send to
 * Flashcards" and "Schedule in Calendar". Each asks the server for the
 * payload (GET …/export), hands it to rika by postMessage, falls back to
 * the outbox rika polls, and outside rika also offers the JSON file.
 */
import { useId, useState } from "react";
import { CalendarPlusIcon, DownloadIcon, LayersIcon } from "lucide-react";
import type { BridgeMessage, Stage } from "@/src/core";
import { downloadFile, slugFilename } from "@/components/artifacts/download";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { localDateIso } from "./format.ts";
import { learnApi, type ExportRequest } from "./learn-api.ts";
import { sendToRika, type RikaBridge, type SendResult } from "./rika-bridge.ts";

export interface CalendarChoice {
	date: string;
	time: string;
	minutes: number;
}

export function CalendarForm({
	today,
	busy,
	onSubmit,
	onCancel,
}: {
	/** "Tomorrow" is counted from here. */
	today: Date;
	busy: boolean;
	onSubmit: (choice: CalendarChoice) => void;
	onCancel: () => void;
}) {
	const id = useId();
	const [date, setDate] = useState(localDateIso(today, 1));
	const [time, setTime] = useState("18:00");
	const [minutes, setMinutes] = useState("60");
	const minutesValue = Math.round(Number(minutes));
	const valid = /^\d{4}-\d{2}-\d{2}$/.test(date) && /^\d{2}:\d{2}$/.test(time) && minutesValue >= 10 && minutesValue <= 480;
	return (
		<form
			className="flex flex-col gap-3 rounded-md border border-border bg-background p-3"
			onSubmit={(e) => {
				e.preventDefault();
				if (valid && !busy) onSubmit({ date, time, minutes: minutesValue });
			}}
		>
			<p className="text-xs text-muted-foreground">The stage&apos;s hours are split into sessions of this length, one a day.</p>
			<div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-3">
				<label htmlFor={`${id}-date`} className="flex flex-col gap-1 text-xs text-muted-foreground">
					Start on
					<Input id={`${id}-date`} type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
				</label>
				<label htmlFor={`${id}-time`} className="flex flex-col gap-1 text-xs text-muted-foreground">
					At
					<Input id={`${id}-time`} type="time" value={time} onChange={(e) => setTime(e.target.value)} required />
				</label>
				<label htmlFor={`${id}-minutes`} className="flex flex-col gap-1 text-xs text-muted-foreground">
					Minutes per session
					<Input id={`${id}-minutes`} type="number" min={10} max={480} step={5} value={minutes} onChange={(e) => setMinutes(e.target.value)} required />
				</label>
			</div>
			<div className="flex flex-wrap gap-2">
				<Button type="submit" size="sm" disabled={!valid || busy}>
					{busy ? "Scheduling…" : "Add to calendar"}
				</Button>
				<Button type="button" size="sm" variant="ghost" onClick={onCancel}>
					Cancel
				</Button>
			</div>
		</form>
	);
}

const NOT_EMBEDDED = async () => ({ kind: "not-embedded" }) as const;

export function StageActions({ roadmapId, stage, bridge }: { roadmapId: string; stage: Stage; bridge: RikaBridge | null }) {
	const [calendarOpen, setCalendarOpen] = useState(false);
	const [busy, setBusy] = useState<ExportRequest["kind"] | null>(null);
	const [status, setStatus] = useState<SendResult | null>(null);
	const [lastMessage, setLastMessage] = useState<BridgeMessage | null>(null);
	const embedded = bridge?.embedded ?? false;

	const send = async (request: ExportRequest) => {
		const api = learnApi();
		setBusy(request.kind);
		setStatus(null);
		const exported = await api.exportStage(roadmapId, request);
		if (exported.kind !== "ok") {
			setBusy(null);
			setStatus({ kind: "failed", text: exported.kind === "error" ? exported.error : "This stage could not be exported." });
			return;
		}
		setLastMessage(exported.data);
		const result = await sendToRika(exported.data, {
			deliver: bridge?.deliver ?? NOT_EMBEDDED,
			saveToOutbox: async (message) => {
				const saved = await api.saveToOutbox(message);
				if (saved.kind !== "ok") throw new Error(saved.kind === "error" ? saved.error : "not saved");
			},
		});
		setBusy(null);
		setStatus(result);
		if (request.kind === "calendar" && result.kind !== "failed") setCalendarOpen(false);
	};

	const download = (message: BridgeMessage) =>
		downloadFile(`${slugFilename(`${message.payload.stage.title}-${message.type}`)}.json`, JSON.stringify(message, null, 2), "application/json");

	return (
		<div className="flex flex-col gap-2 border-t border-border/60 pt-3">
			<div className="flex flex-wrap gap-2">
				<Button size="sm" variant="outline" disabled={busy !== null || stage.topics.length === 0} onClick={() => void send({ kind: "flashcards", stage: stage.id })}>
					<LayersIcon />
					{busy === "flashcards" ? "Sending…" : "Send to Flashcards"}
				</Button>
				<Button size="sm" variant="outline" aria-expanded={calendarOpen} disabled={busy !== null} onClick={() => setCalendarOpen((open) => !open)}>
					<CalendarPlusIcon />
					Schedule in Calendar
				</Button>
			</div>
			{calendarOpen && (
				<CalendarForm
					today={new Date()}
					busy={busy === "calendar"}
					onCancel={() => setCalendarOpen(false)}
					onSubmit={(choice) => void send({ kind: "calendar", stage: stage.id, ...choice })}
				/>
			)}
			{status && (
				<p role="status" className={cn("flex flex-wrap items-center gap-2 text-xs", status.kind === "failed" ? "text-destructive" : "text-muted-foreground")}>
					<span>{status.text}</span>
					{!embedded && lastMessage && (
						<button type="button" onClick={() => download(lastMessage)} className="inline-flex items-center gap-1 text-foreground underline underline-offset-2">
							<DownloadIcon aria-hidden className="size-3" />
							Download JSON
						</button>
					)}
				</p>
			)}
		</div>
	);
}
