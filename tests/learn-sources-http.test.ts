/**
 * The polite fetch the adapters share: User-Agent on every request,
 * timeouts, per-host pacing, cache-by-key (successes only), and the
 * title matching resolve() relies on.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	HttpError,
	authorMatches,
	cached,
	clip,
	failureReason,
	getJson,
	getText,
	plainText,
	safely,
	titlesMatch,
} from "../src/agent/learn/sources/http.ts";
import { DAY, fakeSources, json, text } from "./learn-sources-fakes.ts";

describe("getJson / getText", () => {
	it("sends the User-Agent and parses JSON", async () => {
		const fake = fakeSources(() => json({ ok: 1 }));
		assert.deepEqual(await getJson(fake.ctx, "https://api.example.test/x"), { ok: 1 });
		assert.equal(fake.calls[0]?.headers["user-agent"], fake.ctx.userAgent);
		assert.equal(fake.calls[0]?.headers.accept, "application/json");
	});

	it("throws HttpError on non-2xx and a parse error on bad JSON", async () => {
		const fake = fakeSources((url) => (url.pathname === "/bad" ? text("<html>") : text("x", 503)));
		await assert.rejects(getText(fake.ctx, "https://api.example.test/down"), (e) => e instanceof HttpError && e.status === 503);
		await assert.rejects(getJson(fake.ctx, "https://api.example.test/bad"), /not JSON/);
	});

	it("times out a request that never answers", async () => {
		// A fetch that only ever ends by its abort signal firing.
		const hung = fakeSources(() => new Response("late"));
		hung.ctx.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
			const { promise, reject } = Promise.withResolvers<Response>();
			init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
			return promise;
		}) as typeof fetch;
		await assert.rejects(getText(hung.ctx, "https://slow.example.test/", { timeoutMs: 20 }), (e: Error) => e.name === "TimeoutError");
	});

	it("keeps the minimum interval between requests to one host", async () => {
		const fake = fakeSources(() => text("ok"));
		const started = Date.now();
		await Promise.all([
			getText(fake.ctx, "https://paced.example.test/1", { minIntervalMs: 60 }),
			getText(fake.ctx, "https://paced.example.test/2", { minIntervalMs: 60 }),
			getText(fake.ctx, "https://other.example.test/1", { minIntervalMs: 60 }),
		]);
		const elapsed = Date.now() - started;
		assert.ok(elapsed >= 55, `second request to the same host waited (${elapsed} ms)`);
		assert.ok(elapsed < 115, `other hosts and the first request did not wait (${elapsed} ms)`);
	});
});

describe("cached", () => {
	it("returns a fresh value without producing, refetches when old, never stores failures", async () => {
		const fake = fakeSources(() => text(""));
		let produced = 0;
		const produce = async () => ++produced;
		assert.equal(await cached(fake.ctx, "k", DAY, produce), 1);
		assert.equal(await cached(fake.ctx, "k", DAY, produce), 1);
		fake.clock.now += DAY + 1;
		assert.equal(await cached(fake.ctx, "k", DAY, produce), 2);
		await assert.rejects(cached(fake.ctx, "f", DAY, async () => Promise.reject(new Error("x"))));
		assert.equal(fake.ctx.cache.get("f", DAY), undefined);
	});
});

describe("safely / failureReason", () => {
	it("turns any failure into [] and one plain reason", async () => {
		const reasons: string[] = [];
		const result = await safely("openlibrary", (r) => reasons.push(r), async () => {
			throw new HttpError(429, "https://openlibrary.org/search.json");
		});
		assert.deepEqual(result, []);
		assert.deepEqual(reasons, ["Open Library is limiting requests right now; try again later."]);
		assert.equal(failureReason("arxiv", new TypeError("fetch failed")), "arXiv could not be reached.");
	});
});

describe("text helpers", () => {
	it("matches titles exact-ish", () => {
		assert.ok(titlesMatch("The Rust Programming Language", "Rust programming language"));
		assert.ok(titlesMatch("Introduction to Linear Algebra", "Introduction to Linear Algebra, Fifth Edition"));
		assert.ok(!titlesMatch("Linear Algebra", "Linear Algebra and Its Applications"));
		assert.ok(!titlesMatch("Linear Algebra Done Right", "Calculus Made Easy"));
	});

	it("matches authors by a shared surname", () => {
		assert.ok(authorMatches("Gilbert Strang", ["Strang, Gilbert"]));
		assert.ok(!authorMatches("Sheldon Axler", ["Gilbert Strang"]));
		assert.ok(authorMatches(undefined, []));
	});

	it("strips tags and clips to ~300 characters", () => {
		assert.equal(plainText("<b>Vectors</b> &amp; <i>spaces</i>&#33;"), "Vectors & spaces!");
		const long = clip("word ".repeat(200));
		assert.ok(long && long.length <= 300 && long.endsWith("…"));
	});
});
