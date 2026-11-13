/**
 * THE SOURCE ADAPTER SEAM (rika-learn): one adapter per source. Adapters
 * never import the store or the server; everything with an effect arrives
 * in the SourceContext, so tests pass a fake `fetch` and an in-memory
 * cache and nothing touches the network.
 */
import type { Candidate, CanonItem, DepthId, ResourceKind, SourceId } from "../../../core/learn/contracts.ts";

/** What a stage asks every source. */
export interface SourceQuery {
	/** What the learner typed ("linear algebra"). */
	topic: string;
	stageTitle: string;
	/** The stage's single search query, written by the model. */
	query: string;
	depth: DepthId;
	/** Language code, e.g. "en". */
	language: string;
	/** Most candidates to return. */
	limit: number;
	/** Target minutes per topic in this stage (for video length fit). */
	minutes?: number;
	/** "medium" (4–20 min) for Normal/High, "any" above. */
	videoDuration?: "medium" | "any";
}

/** Cached values expire by age; adapters choose the TTL per call. */
export interface SourceCache {
	get<T>(key: string, maxAgeMs: number): T | undefined;
	set<T>(key: string, value: T): void;
}

/** YouTube search.list budget (100 a day, midnight Pacific reset). */
export interface YoutubeQuota {
	/** Searches left today. */
	remaining(): number;
	/** Record one search. Returns false (and records nothing) when none are left. */
	spend(): boolean;
}

export interface SourceContext {
	fetch: typeof fetch;
	/** User keys. Absent = the keyed source is unavailable. */
	keys: { youtube?: string; brave?: string };
	cache: SourceCache;
	now: () => number;
	/** Sent on every request (Wikimedia and Open Library ask for contact info). */
	userAgent: string;
	youtubeQuota?: YoutubeQuota;
	signal?: AbortSignal;
}

export interface SourceAdapter {
	id: SourceId;
	/** Search once for a stage. Returns [] (never throws) on network,
	 *  HTTP, parse or quota failure; `onError` receives the reason. */
	search(query: SourceQuery, ctx: SourceContext, onError?: (reason: string) => void): Promise<Candidate[]>;
	/** Kinds `resolve` can confirm. */
	resolves: readonly ResourceKind[];
	/** Confirm one model-named resource exists. Returns the API's record
	 *  (with `canon: true`) or null. Never builds a URL the API did not
	 *  return. Optional: sources without a cheap exact lookup omit it. */
	resolve?(item: CanonItem, query: SourceQuery, ctx: SourceContext): Promise<Candidate | null>;
}
