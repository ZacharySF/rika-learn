/**
 * The rika bridge payloads (docs/learn.md "Bridge to rika"): Flashcards and
 * Calendar exports for one stage, as plain JSON.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calendarPayload, flashcardsPayload, isBridgeMessage, makeBridgeMessage, stableHash } from "../src/core/learn/bridge.ts";
import type { Roadmap } from "../src/core/learn/contracts.ts";

function roadmap(): Roadmap {
	return {
		version: 1,
		id: "rm_test",
		topic: "rust",
		depth: "normal",
		createdAt: "2026-11-13T10:00:00.000Z",
		updatedAt: "2026-11-13T10:00:00.000Z",
		status: "ready",
		title: "Rust from zero",
		volatility: "fast",
		research: false,
		hours: 2,
		priming: [],
		tracks: [],
		model: { provider: "faux", id: "m" },
		spend: { usd: 0, calls: 0 },
		youtubeSearches: 0,
		stages: [
			{
				id: "s2",
				title: "Ownership::and borrowing",
				why: "",
				hours: 2.5,
				query: "rust ownership",
				prereqs: [],
				canon: [],
				fill: "filled",
				topics: [
					{ id: "t1", title: "Ownership rules", objective: "Explain the three ownership rules.", minutes: 20, prereqs: [], state: "todo" },
					{ id: "t2", title: "Borrowing", objective: "Borrow values with references.", minutes: 25, prereqs: ["t1"], state: "done" },
				],
				resources: {
					picks: [
						{ id: "https://doc.rust-lang.org/book/ch04", source: "docs", kind: "docs", title: "The Book: Ownership", url: "https://doc.rust-lang.org/book/ch04", reason: "", score: 1 },
					],
					more: [{ id: "https://x.test/a", source: "wikipedia", kind: "reading", title: "More one", url: "https://x.test/a", reason: "", score: 0 }],
				},
			},
		],
	};
}

describe("stableHash", () => {
	it("is deterministic and 16 hex characters", () => {
		assert.equal(stableHash("abc"), stableHash("abc"));
		assert.notEqual(stableHash("abc"), stableHash("abd"));
		assert.match(stableHash("abc"), /^[0-9a-f]{16}$/);
	});
});

describe("flashcardsPayload", () => {
	it("makes one card per topic in a Learn deck with stable guids", () => {
		const p = flashcardsPayload(roadmap(), "s2");
		assert.equal(p.deck, "Learn::Rust from zero::Ownership and borrowing", "'::' inside names would create sub-decks");
		assert.deepEqual(p.tags, ["learn", "learn:rm_test"]);
		assert.equal(p.cards.length, 2);
		assert.match(p.cards[0]!.front, /Ownership rules/);
		assert.match(p.cards[0]!.back, /Explain the three ownership rules\./);
		assert.equal(p.cards[0]!.url, "https://doc.rust-lang.org/book/ch04");
		assert.equal(p.cards[0]!.guid, flashcardsPayload(roadmap(), "s2").cards[0]!.guid);
		assert.notEqual(p.cards[0]!.guid, p.cards[1]!.guid);
		assert.deepEqual(p.stage, { id: "s2", title: "Ownership::and borrowing" });
	});

	it("throws for an unknown or empty stage", () => {
		assert.throws(() => flashcardsPayload(roadmap(), "nope"));
		const r = roadmap();
		r.stages[0]!.topics = [];
		assert.throws(() => flashcardsPayload(r, "s2"), /no topics/);
	});
});

describe("calendarPayload", () => {
	it("splits the stage's hours into sessions on consecutive days", () => {
		const p = calendarPayload(roadmap(), "s2", { date: "2026-11-30", time: "18:00", minutes: 60 });
		assert.equal(p.events.length, 3, "2.5 h at 60 min → 3 sessions");
		assert.deepEqual(p.events.map((e) => e.date), ["2026-11-30", "2026-12-01", "2026-12-02"]);
		assert.deepEqual(p.events.map((e) => e.minutes), [60, 60, 30]);
		assert.equal(p.events[0]!.source_key, "learn:rm_test:s2:1");
		assert.equal(p.events[0]!.title, "Learn: Ownership::and borrowing (1 of 3)");
		assert.match(p.events[0]!.notes, /Ownership rules, Borrowing/);
		assert.deepEqual(p.events[0]!.attachments, [{ title: "The Book: Ownership", url: "https://doc.rust-lang.org/book/ch04" }]);
		assert.equal(p.events[0]!.start, "18:00");
	});

	it("rejects bad dates, times and lengths", () => {
		assert.throws(() => calendarPayload(roadmap(), "s2", { date: "30/11/2026", time: "18:00", minutes: 60 }));
		assert.throws(() => calendarPayload(roadmap(), "s2", { date: "2026-11-30", time: "25:00", minutes: 60 }));
		assert.throws(() => calendarPayload(roadmap(), "s2", { date: "2026-11-30", time: "18:00", minutes: 5 }));
	});
});

describe("bridge messages", () => {
	it("wraps payloads and validates the envelope", () => {
		const message = makeBridgeMessage("flashcards", flashcardsPayload(roadmap(), "s2"), "id-1");
		assert.equal(message.source, "rika-learn");
		assert.equal(message.version, 1);
		assert.ok(isBridgeMessage(message));
		assert.ok(isBridgeMessage(JSON.parse(JSON.stringify(message))));
		assert.ok(!isBridgeMessage({ ...message, type: "nope" }));
		assert.ok(!isBridgeMessage({ ...message, source: "rika" }));
		assert.ok(!isBridgeMessage({ ...message, payload: { deck: "x" } }));
		assert.ok(!isBridgeMessage(null));
	});
});
