/**
 * The Learn client's response reading (docs/learn.md "HTTP API"): success
 * bodies pass through; 409 ceiling, 402 review and 503 model become the
 * three spending/setup asks; every other failure becomes one plain
 * sentence. A fake fetch stands in for the server.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { learnApi, learnRequest } from "../components/learn/learn-api.ts";
import type { SpendReview } from "../src/core/index.ts";

function reply(status: number, body: unknown): typeof fetch {
	return (async () =>
		new Response(typeof body === "string" ? body : JSON.stringify(body), {
			status,
			headers: { "content-type": "application/json" },
		})) as typeof fetch;
}

const review: SpendReview = { phase: "build", estimateUsd: 0.12, spentTodayUsd: 0.45, ceilingUsd: 0.5, model: "Cheap Model" };

describe("learnRequest", () => {
	it("passes success bodies through with their status", async () => {
		assert.deepEqual(await learnRequest("/x", {}, reply(201, { id: "rm_1" })), { kind: "ok", status: 201, data: { id: "rm_1" } });
	});

	it("maps the three asks", async () => {
		assert.deepEqual(await learnRequest("/x", {}, reply(409, { error: "Set a limit", needs: "ceiling" })), { kind: "needs-ceiling" });
		assert.deepEqual(await learnRequest("/x", {}, reply(402, { error: "Over", needs: "review", review })), { kind: "review", review });
		assert.deepEqual(await learnRequest("/x", {}, reply(503, { error: "No model is set up", needs: "model" })), {
			kind: "needs-model",
			error: "No model is set up",
		});
	});

	it("turns other failures into a plain sentence", async () => {
		assert.deepEqual(await learnRequest("/x", {}, reply(404, { error: "That roadmap does not exist." })), {
			kind: "error",
			status: 404,
			error: "That roadmap does not exist.",
		});
		const broken = await learnRequest("/x", {}, reply(500, "<html>oops"));
		assert.equal(broken.kind, "error");
		assert.match(broken.kind === "error" ? broken.error : "", /went wrong/);
		const offline = await learnRequest("/x", {}, (async () => {
			throw new TypeError("fetch failed");
		}) as typeof fetch);
		assert.equal(offline.kind, "error");
		assert.equal(offline.kind === "error" ? offline.status : -1, 0);
	});

	it("sends JSON bodies with the method", async () => {
		const seen: { url: string; init: RequestInit | undefined }[] = [];
		const fake = (async (url: string, init?: RequestInit) => {
			seen.push({ url, init });
			return new Response(JSON.stringify({ questions: [] }), { status: 200 });
		}) as typeof fetch;
		await learnApi(fake).prime("linear algebra", "high", true);
		assert.equal(seen[0]?.url, "/api/learn/prime");
		assert.equal(seen[0]?.init?.method, "POST");
		assert.deepEqual(JSON.parse(String(seen[0]?.init?.body)), { topic: "linear algebra", depth: "high", approved: true });
	});

	it("retries a failed roadmap in place", async () => {
		const seen: { url: string; init: RequestInit | undefined }[] = [];
		const fake = (async (url: string, init?: RequestInit) => {
			seen.push({ url, init });
			return new Response(JSON.stringify({ ok: true }), { status: 202 });
		}) as typeof fetch;
		const api = learnApi(fake);
		await api.retryRoadmap("rm_1", false);
		await api.retryRoadmap("rm_1", true);
		assert.equal(seen[0]?.url, "/api/learn/roadmaps/rm_1/retry");
		assert.equal(seen[0]?.init?.method, "POST");
		assert.deepEqual(JSON.parse(String(seen[0]?.init?.body)), {});
		assert.deepEqual(JSON.parse(String(seen[1]?.init?.body)), { approved: true });
	});

	it("builds the export query for calendar sessions", async () => {
		const urls: string[] = [];
		const fake = (async (url: string) => {
			urls.push(url);
			return new Response("{}", { status: 200 });
		}) as typeof fetch;
		const api = learnApi(fake);
		await api.exportStage("rm 1", { kind: "calendar", stage: "s2", date: "2026-11-14", time: "18:00", minutes: 60 });
		await api.exportStage("rm_1", { kind: "flashcards", stage: "s2" });
		assert.equal(urls[0], "/api/learn/roadmaps/rm%201/export?kind=calendar&stage=s2&date=2026-11-14&time=18%3A00&minutes=60");
		assert.equal(urls[1], "/api/learn/roadmaps/rm_1/export?kind=flashcards&stage=s2");
	});
});
