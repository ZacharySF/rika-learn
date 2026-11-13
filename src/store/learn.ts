/**
 * THE LEARN STORE (rika-learn): the only writer of data/learn/.
 *
 *   roadmaps/<id>.json   one Roadmap per file (whole-file read-modify-write)
 *   settings.json        LearnSettings (sanitized on read)
 *   spend.jsonl          one line per model call: {at, usd, phase, model, roadmapId?}
 *   youtube-quota.json   {day (Pacific), used} — search.list calls today
 *   cache/<sha>.json     source responses, {storedAt, value}; callers pass the max age
 *   outbox.json          bridge messages waiting for rika to pick them up
 *
 * Writes are synchronous and go through a temp file + rename, so a crash
 * never leaves half a roadmap behind (single process: atomicity rides the
 * event loop, as with the other LearnHarness stores).
 */
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PATHS } from "../../config.ts";
import type { BridgeMessage, LearnSettings, OutboxItem, Roadmap, SpendPhase } from "../core/learn/contracts.ts";
import type { SpendEntry } from "../core/learn/cost.ts";
import { sanitizeLearnSettings, youtubeDay } from "../core/learn/settings.ts";
import { YOUTUBE_DAILY_SEARCHES } from "../core/learn/sources.ts";
import type { SourceCache } from "../agent/learn/sources/types.ts";

export interface SpendRecord extends SpendEntry {
	phase: SpendPhase;
	model: string;
	roadmapId?: string;
}

export interface LearnStore {
	listRoadmaps(): Roadmap[];
	getRoadmap(id: string): Roadmap | null;
	saveRoadmap(roadmap: Roadmap): void;
	/** Read, mutate, stamp updatedAt, write. null when the roadmap is gone. */
	updateRoadmap(id: string, mutate: (roadmap: Roadmap) => void): Roadmap | null;
	deleteRoadmap(id: string): boolean;
	readSettings(): LearnSettings;
	writeSettings(settings: LearnSettings): LearnSettings;
	appendSpend(entry: SpendRecord): void;
	readSpend(): SpendRecord[];
	youtubeUsed(now: number): number;
	/** Record one search; false (nothing recorded) when today's are used up. */
	youtubeSpend(now: number): boolean;
	cache: SourceCache;
	outboxList(): OutboxItem[];
	outboxAdd(message: BridgeMessage): OutboxItem;
	outboxAck(ids: readonly string[]): number;
}

const ROADMAP_ID = /^rm_[A-Za-z0-9_-]{1,64}$/;

function writeAtomic(file: string, text: string): void {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
	fs.writeFileSync(tmp, text, "utf-8");
	fs.renameSync(tmp, file);
}

function readJson(file: string): unknown {
	try {
		return JSON.parse(fs.readFileSync(file, "utf-8"));
	} catch {
		return undefined;
	}
}

/** A Roadmap read back from disk: the fields every reader relies on. */
function isRoadmap(value: unknown): value is Roadmap {
	return (
		typeof value === "object" &&
		value !== null &&
		"version" in value &&
		value.version === 1 &&
		"id" in value &&
		typeof value.id === "string" &&
		"stages" in value &&
		Array.isArray(value.stages)
	);
}

export function createLearnStore(dir: string, now: () => number = Date.now): LearnStore {
	const roadmapsDir = path.join(dir, "roadmaps");
	const roadmapFile = (id: string) => path.join(roadmapsDir, `${id}.json`);
	const settingsFile = path.join(dir, "settings.json");
	const spendFile = path.join(dir, "spend.jsonl");
	const quotaFile = path.join(dir, "youtube-quota.json");
	const cacheDir = path.join(dir, "cache");
	const outboxFile = path.join(dir, "outbox.json");

	function getRoadmap(id: string): Roadmap | null {
		if (!ROADMAP_ID.test(id)) return null;
		const value = readJson(roadmapFile(id));
		return isRoadmap(value) && value.id === id ? value : null;
	}

	function saveRoadmap(roadmap: Roadmap): void {
		if (!ROADMAP_ID.test(roadmap.id)) throw new Error(`invalid roadmap id ${roadmap.id}`);
		writeAtomic(roadmapFile(roadmap.id), JSON.stringify(roadmap, null, "\t"));
	}

	function readQuota(at: number): { day: string; used: number } {
		const day = youtubeDay(at);
		const value = readJson(quotaFile);
		if (typeof value === "object" && value !== null && "day" in value && value.day === day && "used" in value && typeof value.used === "number") {
			return { day, used: value.used };
		}
		return { day, used: 0 };
	}

	function readOutbox(): OutboxItem[] {
		const value = readJson(outboxFile);
		return Array.isArray(value) ? (value as OutboxItem[]) : [];
	}

	const cacheFile = (key: string) => path.join(cacheDir, `${createHash("sha256").update(key).digest("hex")}.json`);

	return {
		listRoadmaps() {
			let files: string[];
			try {
				files = fs.readdirSync(roadmapsDir).filter((f) => f.endsWith(".json"));
			} catch {
				return [];
			}
			const out: Roadmap[] = [];
			for (const file of files) {
				const roadmap = getRoadmap(file.slice(0, -".json".length));
				if (roadmap) out.push(roadmap);
			}
			return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
		},
		getRoadmap,
		saveRoadmap,
		updateRoadmap(id, mutate) {
			const roadmap = getRoadmap(id);
			if (!roadmap) return null;
			mutate(roadmap);
			let stamp = new Date(now()).toISOString();
			if (stamp <= roadmap.updatedAt) stamp = new Date(Date.parse(roadmap.updatedAt) + 1).toISOString();
			roadmap.updatedAt = stamp;
			saveRoadmap(roadmap);
			return roadmap;
		},
		deleteRoadmap(id) {
			if (!ROADMAP_ID.test(id)) return false;
			try {
				fs.unlinkSync(roadmapFile(id));
				return true;
			} catch {
				return false;
			}
		},
		readSettings() {
			return sanitizeLearnSettings(readJson(settingsFile));
		},
		writeSettings(settings) {
			const clean = sanitizeLearnSettings(settings);
			writeAtomic(settingsFile, JSON.stringify(clean, null, "\t"));
			return clean;
		},
		appendSpend(entry) {
			fs.mkdirSync(dir, { recursive: true });
			fs.appendFileSync(spendFile, `${JSON.stringify(entry)}\n`, "utf-8");
		},
		readSpend() {
			let text: string;
			try {
				text = fs.readFileSync(spendFile, "utf-8");
			} catch {
				return [];
			}
			const out: SpendRecord[] = [];
			for (const line of text.split("\n")) {
				if (!line.trim()) continue;
				try {
					const entry: unknown = JSON.parse(line);
					if (typeof entry === "object" && entry !== null && "at" in entry && "usd" in entry && typeof entry.usd === "number") {
						out.push(entry as SpendRecord);
					}
				} catch {
					// A torn or hand-mangled line is skipped, never guessed at.
				}
			}
			return out;
		},
		youtubeUsed(at) {
			return readQuota(at).used;
		},
		youtubeSpend(at) {
			const quota = readQuota(at);
			if (quota.used >= YOUTUBE_DAILY_SEARCHES) return false;
			writeAtomic(quotaFile, JSON.stringify({ day: quota.day, used: quota.used + 1 }));
			return true;
		},
		cache: {
			get<T>(key: string, maxAgeMs: number): T | undefined {
				const value = readJson(cacheFile(key));
				if (typeof value !== "object" || value === null || !("storedAt" in value) || typeof value.storedAt !== "number" || !("value" in value)) return undefined;
				return now() - value.storedAt <= maxAgeMs ? (value.value as T) : undefined;
			},
			set<T>(key: string, value: T) {
				writeAtomic(cacheFile(key), JSON.stringify({ storedAt: now(), value }));
			},
		},
		outboxList: readOutbox,
		outboxAdd(message) {
			const item: OutboxItem = { id: randomUUID(), createdAt: new Date(now()).toISOString(), message };
			writeAtomic(outboxFile, JSON.stringify([...readOutbox(), item], null, "\t"));
			return item;
		},
		outboxAck(ids) {
			const drop = new Set(ids);
			const items = readOutbox();
			const keep = items.filter((item) => !drop.has(item.id));
			if (keep.length !== items.length) writeAtomic(outboxFile, JSON.stringify(keep, null, "\t"));
			return items.length - keep.length;
		},
	};
}

export const learnStore: LearnStore = createLearnStore(PATHS.learn);
