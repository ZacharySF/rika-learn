/**
 * THE RIKA BRIDGE PAYLOADS (docs/learn.md "Bridge to rika"). Pure builders
 * for the two exports a stage offers — Flashcards and Calendar — plus the
 * envelope check the outbox route uses. Shapes follow rika's importers:
 * decks as "Parent::Child", cards with a stable guid (rika does not upsert),
 * calendar events idempotent on `source_key`.
 */
import { Type } from "typebox";
import { Value } from "typebox/value";
import type { BridgeMessage, CalendarPayload, FlashcardsPayload, Roadmap, Stage } from "./contracts.ts";

/** FNV-1a 64-bit as 16 hex chars: stable across runs and machines. */
export function stableHash(input: string): string {
	let hash = 0xcbf29ce484222325n;
	const prime = 0x100000001b3n;
	for (const byte of new TextEncoder().encode(input)) {
		hash ^= BigInt(byte);
		hash = (hash * prime) & 0xffffffffffffffffn;
	}
	return hash.toString(16).padStart(16, "0");
}

function stageOf(roadmap: Roadmap, stageId: string): Stage {
	const stage = roadmap.stages.find((s) => s.id === stageId);
	if (!stage) throw new Error(`unknown stage ${stageId}`);
	return stage;
}

/** "::" separates sub-decks in rika, so it may not appear inside a name. */
function deckPart(name: string): string {
	return name.replace(/::+/g, " ").replace(/\s+/g, " ").trim() || "Untitled";
}

export function flashcardsPayload(roadmap: Roadmap, stageId: string): FlashcardsPayload {
	const stage = stageOf(roadmap, stageId);
	if (stage.topics.length === 0) throw new Error("This stage has no topics yet; open it to load them first.");
	const firstLink = stage.resources.picks.find((r) => r.kind !== "video") ?? stage.resources.picks[0];
	return {
		deck: `Learn::${deckPart(roadmap.title || roadmap.topic)}::${deckPart(stage.title)}`,
		tags: ["learn", `learn:${roadmap.id}`],
		roadmap: { id: roadmap.id, title: roadmap.title },
		stage: { id: stage.id, title: stage.title },
		cards: stage.topics.map((topic) => {
			const card: FlashcardsPayload["cards"][number] = {
				guid: `learn-${stableHash(`${roadmap.id}\u0000${topic.id}\u0000card`)}`,
				front: `${topic.title}: what should you be able to do?`,
				back: `${topic.objective || topic.title}\n\nStage: ${stage.title}`,
			};
			if (firstLink) card.url = firstLink.url;
			return card;
		}),
	};
}

export interface ScheduleOptions {
	/** First session, YYYY-MM-DD (local). */
	date: string;
	/** HH:MM, 24-hour. */
	time: string;
	/** Minutes per session, 15–240. */
	minutes: number;
}

function addDays(date: string, days: number): string {
	const [y, m, d] = date.split("-").map(Number) as [number, number, number];
	const next = new Date(Date.UTC(y, m - 1, d + days));
	return next.toISOString().slice(0, 10);
}

export function validSchedule(opts: ScheduleOptions): string | null {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(opts.date) || Number.isNaN(Date.parse(`${opts.date}T00:00:00Z`))) return "The date must look like 2026-11-30.";
	const time = /^(\d{2}):(\d{2})$/.exec(opts.time);
	if (!time || Number(time[1]) > 23 || Number(time[2]) > 59) return "The time must look like 18:00.";
	if (!Number.isInteger(opts.minutes) || opts.minutes < 15 || opts.minutes > 240) return "Sessions must be 15 to 240 minutes long.";
	return null;
}

/** The stage's hours split into sessions on consecutive days. */
export function calendarPayload(roadmap: Roadmap, stageId: string, opts: ScheduleOptions): CalendarPayload {
	const invalid = validSchedule(opts);
	if (invalid) throw new Error(invalid);
	const stage = stageOf(roadmap, stageId);
	const topicMinutes = stage.topics.reduce((sum, t) => sum + t.minutes, 0);
	const total = Math.max(opts.minutes / 2, Math.round(stage.hours * 60) || topicMinutes || opts.minutes);
	const count = Math.max(1, Math.ceil(total / opts.minutes));
	const notes = stage.topics.length > 0 ? `Topics: ${stage.topics.map((t) => t.title).join(", ")}` : stage.why;
	const attachments = stage.resources.picks.slice(0, 25).map((r) => ({ title: r.title, url: r.url }));
	const events = Array.from({ length: count }, (_, i) => ({
		source_key: `learn:${roadmap.id}:${stage.id}:${i + 1}`,
		title: `Learn: ${stage.title} (${i + 1} of ${count})`,
		date: addDays(opts.date, i),
		start: opts.time,
		minutes: i === count - 1 ? Math.round(total - opts.minutes * (count - 1)) : opts.minutes,
		notes,
		attachments,
	}));
	return { roadmap: { id: roadmap.id, title: roadmap.title }, stage: { id: stage.id, title: stage.title }, events };
}

export function makeBridgeMessage(type: "flashcards", payload: FlashcardsPayload, id: string): BridgeMessage;
export function makeBridgeMessage(type: "calendar", payload: CalendarPayload, id: string): BridgeMessage;
export function makeBridgeMessage(type: "flashcards" | "calendar", payload: FlashcardsPayload | CalendarPayload, id: string): BridgeMessage {
	return { source: "rika-learn", version: 1, id, type, payload } as BridgeMessage;
}

const Ref = Type.Object({ id: Type.String(), title: Type.String() });

const FlashcardsSchema = Type.Object({
	deck: Type.String({ minLength: 1 }),
	tags: Type.Array(Type.String()),
	roadmap: Ref,
	stage: Ref,
	cards: Type.Array(
		Type.Object({ guid: Type.String({ minLength: 1 }), front: Type.String(), back: Type.String(), url: Type.Optional(Type.String()) }),
	),
});

const CalendarSchema = Type.Object({
	roadmap: Ref,
	stage: Ref,
	events: Type.Array(
		Type.Object({
			source_key: Type.String({ minLength: 1 }),
			title: Type.String(),
			date: Type.String(),
			start: Type.String(),
			minutes: Type.Number(),
			notes: Type.String(),
			attachments: Type.Array(Type.Object({ title: Type.String(), url: Type.String() })),
		}),
	),
});

const envelope = { source: Type.Literal("rika-learn"), version: Type.Literal(1), id: Type.String({ minLength: 1 }) };

/** The outbox accepts only messages of this exact shape. */
export const bridgeMessageSchema = Type.Union([
	Type.Object({ ...envelope, type: Type.Literal("flashcards"), payload: FlashcardsSchema }),
	Type.Object({ ...envelope, type: Type.Literal("calendar"), payload: CalendarSchema }),
]);

export function isBridgeMessage(value: unknown): value is BridgeMessage {
	return Value.Check(bridgeMessageSchema, value);
}
