/**
 * Shared fakes for the source adapter tests: a routed fake `fetch` that
 * records every request, an in-memory cache that ages entries by a
 * movable clock, and a stage query. Synthetic data only; no network.
 */
import type { SourceCache, SourceContext, SourceQuery } from "../src/agent/learn/sources/types.ts";

export interface FakeCall {
	url: URL;
	headers: Record<string, string>;
}

export type Route = (url: URL, call: FakeCall) => Response | Promise<Response>;

export interface Fake {
	ctx: SourceContext;
	calls: FakeCall[];
	/** Milliseconds since the epoch the fake clock shows; move it to age cache entries. */
	clock: { now: number };
	errors: string[];
	onError: (reason: string) => void;
}

export function memoryCache(now: () => number): SourceCache {
	const entries = new Map<string, { at: number; value: unknown }>();
	return {
		get<T>(key: string, maxAgeMs: number): T | undefined {
			const entry = entries.get(key);
			if (!entry || now() - entry.at > maxAgeMs) return undefined;
			return entry.value as T;
		},
		set<T>(key: string, value: T): void {
			entries.set(key, { at: now(), value });
		},
	};
}

export function fakeSources(route: Route, overrides: Partial<SourceContext> = {}): Fake {
	const calls: FakeCall[] = [];
	const clock = { now: Date.UTC(2026, 10, 13, 12) };
	const errors: string[] = [];
	const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
		const headers: Record<string, string> = {};
		new Headers(init?.headers).forEach((value, key) => {
			headers[key] = value;
		});
		const call = { url, headers };
		calls.push(call);
		return route(url, call);
	}) as typeof fetch;
	const ctx: SourceContext = {
		fetch: fetchImpl,
		keys: {},
		cache: memoryCache(() => clock.now),
		now: () => clock.now,
		userAgent: "rika-learn-test/1.0 (test@example.invalid)",
		...overrides,
	};
	return { ctx, calls, clock, errors, onError: (reason) => errors.push(reason) };
}

export function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export function text(body: string, status = 200, contentType = "text/plain"): Response {
	return new Response(body, { status, headers: { "content-type": contentType } });
}

/** A response whose `url` says it came from somewhere else (a followed redirect). */
export function redirected(body: string, finalUrl: string, contentType = "text/html"): Response {
	const response = text(body, 200, contentType);
	Object.defineProperty(response, "url", { value: finalUrl });
	return response;
}

export const notFound = (): Response => text("not found", 404);

export function stageQuery(overrides: Partial<SourceQuery> = {}): SourceQuery {
	return {
		topic: "linear algebra",
		stageTitle: "Vectors and spaces",
		query: "vector spaces introduction",
		depth: "normal",
		language: "en",
		limit: 5,
		minutes: 15,
		videoDuration: "medium",
		...overrides,
	};
}

export const DAY = 24 * 60 * 60 * 1000;
