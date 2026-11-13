/**
 * LEARN SETTINGS (Settings → Learn). Stored by src/store/learn.ts as
 * data/learn/settings.json; sanitized here on every read so a hand-edited
 * or older file can never put a bad value in front of the server.
 */
import type { LearnSettings, ModelRef, SourceId } from "./contracts.ts";
import { isSourceId } from "./contracts.ts";
import { defaultLearnSettings } from "./sources.ts";

/** A daily limit above this is almost certainly a typo. */
const MAX_CEILING_USD = 1000;

function modelRef(value: unknown): ModelRef | undefined {
	if (typeof value !== "object" || value === null || !("provider" in value) || !("id" in value)) return undefined;
	const { provider, id } = value;
	return typeof provider === "string" && provider && typeof id === "string" && id ? { provider, id } : undefined;
}

function ceiling(value: unknown): number | null | undefined {
	if (value === null) return null;
	return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= MAX_CEILING_USD ? value : undefined;
}

function language(value: unknown): string | undefined {
	return typeof value === "string" && /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(value) ? value : undefined;
}

/** Any stored value → valid settings (bad fields fall back to defaults). */
export function sanitizeLearnSettings(raw: unknown): LearnSettings {
	const out = defaultLearnSettings();
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return out;
	if ("sources" in raw && typeof raw.sources === "object" && raw.sources !== null) {
		for (const [key, value] of Object.entries(raw.sources)) {
			if (isSourceId(key) && typeof value === "boolean") out.sources[key] = value;
		}
	}
	if ("dailyCeilingUsd" in raw) out.dailyCeilingUsd = ceiling(raw.dailyCeilingUsd) ?? null;
	if ("language" in raw) out.language = language(raw.language) ?? out.language;
	const model = "model" in raw ? modelRef(raw.model) : undefined;
	if (model) out.model = model;
	return out;
}

export type LearnSettingsPatchResult = { ok: true; settings: LearnSettings } | { ok: false; error: string };

/** PUT /api/learn/settings: a partial update. `model: null` clears the pin. */
export function applyLearnSettingsPatch(current: LearnSettings, patch: unknown): LearnSettingsPatchResult {
	if (typeof patch !== "object" || patch === null || Array.isArray(patch)) return { ok: false, error: "Send a JSON object with the settings to change." };
	const next: LearnSettings = { ...current, sources: { ...current.sources } };
	if ("sources" in patch) {
		if (typeof patch.sources !== "object" || patch.sources === null) return { ok: false, error: "sources must be an object of on/off switches." };
		for (const [key, value] of Object.entries(patch.sources)) {
			if (!isSourceId(key)) return { ok: false, error: `There is no source called "${key}".` };
			if (typeof value !== "boolean") return { ok: false, error: `The ${key} switch must be true or false.` };
			next.sources[key as SourceId] = value;
		}
	}
	if ("dailyCeilingUsd" in patch) {
		const value = ceiling(patch.dailyCeilingUsd);
		if (value === undefined) return { ok: false, error: `The daily limit must be between $0 and $${MAX_CEILING_USD}.` };
		next.dailyCeilingUsd = value;
	}
	if ("language" in patch) {
		const value = language(patch.language);
		if (!value) return { ok: false, error: 'The language must be a code like "en" or "pt-BR".' };
		next.language = value;
	}
	if ("model" in patch) {
		if (patch.model === null) delete next.model;
		else {
			const value = modelRef(patch.model);
			if (!value) return { ok: false, error: "The model needs both a provider and an id." };
			next.model = value;
		}
	}
	return { ok: true, settings: next };
}

const PACIFIC = new Intl.DateTimeFormat("en-CA", {
	timeZone: "America/Los_Angeles",
	year: "numeric",
	month: "2-digit",
	day: "2-digit",
	hour: "2-digit",
	minute: "2-digit",
	second: "2-digit",
	hourCycle: "h23",
});

function pacificParts(now: number): Record<string, number> {
	const parts: Record<string, number> = {};
	for (const part of PACIFIC.formatToParts(new Date(now))) if (part.type !== "literal") parts[part.type] = Number(part.value);
	return parts;
}

/** YouTube's quota day: the calendar date in Pacific time. */
export function youtubeDay(now: number): string {
	const p = pacificParts(now);
	return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** When the quota next resets (the next Pacific midnight), as ISO. */
export function youtubeResetsAt(now: number): string {
	const p = pacificParts(now);
	const intoDay = ((p.hour ?? 0) * 3600 + (p.minute ?? 0) * 60 + (p.second ?? 0)) * 1000 + (now % 1000);
	return new Date(now - intoDay + 86_400_000).toISOString();
}
