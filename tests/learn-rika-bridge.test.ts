/**
 * The rika bridge (docs/learn.md "Bridge to rika"): postMessage to the
 * parent only when embedded, the referrer origin as targetOrigin, acks
 * accepted only from the parent window (and its origin when known), the
 * 2.5 s wait replaced by a short one here, and the outbox fallback.
 * A fake window stands in for the browser; nothing touches the network.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createRikaBridge, parentOriginFrom, sendToRika, type BridgeWindow } from "../components/learn/rika-bridge.ts";
import type { BridgeMessage } from "../src/core/index.ts";

interface FakeEvent {
	data: unknown;
	source: unknown;
	origin: string;
}

function fakeWindow({ embedded = true, referrer = "http://rika.test:3999/learn" }: { embedded?: boolean; referrer?: string } = {}) {
	const listeners = new Set<(e: FakeEvent) => void>();
	const posts: { message: unknown; origin: string }[] = [];
	const parent = {
		postMessage(message: unknown, origin: string) {
			posts.push({ message, origin });
		},
	};
	const win = {
		document: { referrer },
		addEventListener(_type: "message", fn: (e: FakeEvent) => void) {
			listeners.add(fn);
		},
		removeEventListener(_type: "message", fn: (e: FakeEvent) => void) {
			listeners.delete(fn);
		},
	} as BridgeWindow & { parent: unknown };
	win.parent = embedded ? parent : win;
	const emit = (data: unknown, from: { source?: unknown; origin?: string } = {}) => {
		const event = { data, source: from.source ?? parent, origin: from.origin ?? "http://rika.test:3999" };
		for (const listener of [...listeners]) listener(event);
	};
	return { win, parent, posts, emit, listeners };
}

const message: BridgeMessage = {
	source: "rika-learn",
	version: 1,
	id: "msg-1",
	type: "flashcards",
	payload: {
		deck: "Learn::Synthetic::Stage one",
		tags: ["learn"],
		roadmap: { id: "rm_test", title: "Synthetic roadmap" },
		stage: { id: "s1", title: "Stage one" },
		cards: [{ guid: "learn-0001", front: "Front", back: "Back" }],
	},
};

describe("parentOriginFrom", () => {
	it("takes the origin of a referrer URL and null otherwise", () => {
		assert.equal(parentOriginFrom("http://rika.test:3999/some/page?x=1"), "http://rika.test:3999");
		assert.equal(parentOriginFrom(""), null);
		assert.equal(parentOriginFrom("not a url"), null);
	});
});

describe("createRikaBridge", () => {
	it("outside an iframe it never posts and reports not-embedded", async () => {
		const fake = fakeWindow({ embedded: false });
		const bridge = createRikaBridge(fake.win, { ackTimeoutMs: 10 });
		assert.equal(bridge.embedded, false);
		assert.deepEqual(await bridge.deliver(message), { kind: "not-embedded" });
		assert.equal(fake.posts.length, 0);
	});

	it("posts to the parent with the referrer origin and resolves on a matching ack", async () => {
		const fake = fakeWindow();
		const bridge = createRikaBridge(fake.win, { ackTimeoutMs: 500 });
		const pending = bridge.deliver(message);
		assert.equal(fake.posts.length, 1);
		assert.equal(fake.posts[0]?.origin, "http://rika.test:3999");
		assert.deepEqual(fake.posts[0]?.message, message);
		fake.emit({ source: "rika", version: 1, type: "ack", id: "msg-1", ok: true, message: "Added 1 card" });
		assert.deepEqual(await pending, { kind: "acked", message: "Added 1 card" });
		assert.equal(fake.listeners.size, 0, "the ack listener is removed");
	});

	it("ignores acks from another window, another origin or another id", async () => {
		const fake = fakeWindow();
		const bridge = createRikaBridge(fake.win, { ackTimeoutMs: 30 });
		const pending = bridge.deliver(message);
		const ack = { source: "rika", version: 1, type: "ack", id: "msg-1", ok: true };
		fake.emit(ack, { source: { other: true } });
		fake.emit(ack, { origin: "http://evil.test" });
		fake.emit({ ...ack, id: "msg-2" });
		fake.emit({ ...ack, source: "someone-else" });
		assert.deepEqual(await pending, { kind: "no-ack" });
		assert.equal(fake.listeners.size, 0);
	});

	it("without a referrer it targets * and accepts the parent's ack from any origin", async () => {
		const fake = fakeWindow({ referrer: "" });
		const bridge = createRikaBridge(fake.win, { ackTimeoutMs: 500 });
		const pending = bridge.deliver(message);
		assert.equal(fake.posts[0]?.origin, "*");
		fake.emit({ source: "rika", version: 1, type: "ack", id: "msg-1", ok: true }, { origin: "http://elsewhere.test" });
		assert.deepEqual(await pending, { kind: "acked" });
	});

	it("a refusing ack is reported as refused with rika's words", async () => {
		const fake = fakeWindow();
		const bridge = createRikaBridge(fake.win, { ackTimeoutMs: 500 });
		const pending = bridge.deliver(message);
		fake.emit({ source: "rika", version: 1, type: "ack", id: "msg-1", ok: false, message: "Deck is locked" });
		assert.deepEqual(await pending, { kind: "refused", message: "Deck is locked" });
	});

	it("hello posts a hello and reports the connection once rika answers", () => {
		const fake = fakeWindow();
		const bridge = createRikaBridge(fake.win);
		let connected = 0;
		const stop = bridge.hello(() => connected++);
		assert.deepEqual(fake.posts[0], { message: { source: "rika-learn", version: 1, type: "hello" }, origin: "http://rika.test:3999" });
		fake.emit({ source: "rika", version: 1, type: "hello" }, { source: { other: true } });
		assert.equal(connected, 0, "a hello from another window is ignored");
		fake.emit({ source: "rika", version: 1, type: "hello" });
		assert.equal(connected, 1);
		stop();
		assert.equal(fake.listeners.size, 0);
	});

	it("hello outside an iframe does nothing", () => {
		const fake = fakeWindow({ embedded: false });
		const stop = createRikaBridge(fake.win).hello(() => assert.fail("never connected"));
		assert.equal(fake.posts.length, 0);
		stop();
	});
});

describe("sendToRika", () => {
	it("an ack means sent, with rika's message when it gave one", async () => {
		const result = await sendToRika(message, {
			deliver: async () => ({ kind: "acked", message: "Added 1 card" }),
			saveToOutbox: async () => assert.fail("no outbox after an ack"),
		});
		assert.deepEqual(result, { kind: "sent", text: "Added 1 card" });
	});

	it("no ack or no iframe falls back to the outbox", async () => {
		for (const kind of ["no-ack", "not-embedded"] as const) {
			const saved: BridgeMessage[] = [];
			const result = await sendToRika(message, {
				deliver: async () => ({ kind }),
				saveToOutbox: async (m) => {
					saved.push(m);
				},
			});
			assert.deepEqual(result, { kind: "saved", text: "Saved for rika — it will be added the next time rika checks" });
			assert.deepEqual(saved, [message]);
		}
	});

	it("a failed outbox save is reported plainly", async () => {
		const result = await sendToRika(message, {
			deliver: async () => ({ kind: "no-ack" }),
			saveToOutbox: async () => {
				throw new Error("disk full");
			},
		});
		assert.equal(result.kind, "failed");
		assert.match(result.text, /Could not save it for rika/);
	});

	it("a refusal shows rika's reason and does not queue it", async () => {
		const result = await sendToRika(message, {
			deliver: async () => ({ kind: "refused", message: "Deck is locked" }),
			saveToOutbox: async () => assert.fail("refused messages are not queued"),
		});
		assert.deepEqual(result, { kind: "failed", text: "rika could not add it: Deck is locked" });
	});
});
