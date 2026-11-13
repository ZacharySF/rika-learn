/**
 * Plain-language formatting shared by the Learn screens: money, time,
 * resource kinds and source names, local dates. Pure.
 */
import { SOURCE_INFO, type ResourceKind, type SourceId } from "@/src/core";

/** "$0.50"; amounts under a cent read "less than $0.01" (never "$0.00"). */
export function formatUsd(usd: number): string {
	if (usd > 0 && usd < 0.01) return "less than $0.01";
	return `$${usd.toFixed(2)}`;
}

/** "45 min", "2 h", "1.5 h". */
export function formatHours(hours: number): string {
	if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`;
	return `${Number.isInteger(hours) ? hours : hours.toFixed(1).replace(/\.0$/, "")} h`;
}

export const KIND_LABEL: Record<ResourceKind, string> = {
	video: "Video",
	reading: "Reading",
	exercise: "Exercise",
	course: "Course",
	book: "Book",
	paper: "Paper",
	docs: "Docs",
	repo: "Repo",
	discussion: "Discussion",
};

export function sourceLabel(id: SourceId): string {
	return SOURCE_INFO.find((s) => s.id === id)?.label ?? id;
}

/** YYYY-MM-DD in the learner's local calendar, `days` after `from`. */
export function localDateIso(from: Date, days = 0): string {
	const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + days);
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "1 search", "3 searches". */
export function plural(n: number, one: string, many: string): string {
	return `${n} ${n === 1 ? one : many}`;
}
