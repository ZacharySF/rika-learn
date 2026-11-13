/**
 * THE RIKA BRIDGE, Learn's half (docs/learn.md "Bridge to rika"). rika shows
 * Learn in an iframe; study material goes to it by postMessage, and an
 * unanswered message falls back to the HTTP outbox rika polls.
 *
 * Trust: messages go to the parent only (never broadcast to other frames),
 * addressed to the referrer's origin when the browser gave one. Replies are
 * accepted only when `event.source` IS the parent window and, when the
 * origin is known, `event.origin` matches it — another frame or tab cannot
 * fake an ack or a hello.
 *
 * The window is injected (a fake in tests); nothing here reads globals.
 */
import type { BridgeMessage } from "@/src/core";

/** The slice of `window` the bridge uses. */
export interface BridgeWindow {
	readonly parent: unknown;
	readonly document?: { readonly referrer?: string };
	addEventListener(type: "message", listener: (event: BridgeEvent) => void): void;
	removeEventListener(type: "message", listener: (event: BridgeEvent) => void): void;
}

/** The fields of a MessageEvent the bridge reads. */
export interface BridgeEvent {
	readonly data: unknown;
	readonly source: unknown;
	readonly origin: string;
}

interface PostTarget {
	postMessage(message: unknown, targetOrigin: string): void;
}

export type DeliverResult =
	| { kind: "acked"; message?: string }
	| { kind: "refused"; message?: string }
	| { kind: "no-ack" }
	| { kind: "not-embedded" };

export interface RikaBridge {
	/** True when Learn runs inside another window (rika's iframe). */
	readonly embedded: boolean;
	/** Say hello; `onConnected` runs when rika answers. Returns the unsubscribe. */
	hello(onConnected: () => void): () => void;
	/** Post one message and wait for rika's ack. */
	deliver(message: BridgeMessage): Promise<DeliverResult>;
}

/** rika answers within this long or the message goes to the outbox. */
export const ACK_TIMEOUT_MS = 2500;

/** The parent's origin from `document.referrer`, or null when there is none. */
export function parentOriginFrom(referrer: string | undefined): string | null {
	if (!referrer) return null;
	try {
		const origin = new URL(referrer).origin;
		return origin === "null" ? null : origin;
	} catch {
		return null;
	}
}

interface RikaReply {
	source: "rika";
	version: 1;
	type: string;
	id?: unknown;
	ok?: unknown;
	message?: unknown;
}

function isRikaReply(data: unknown): data is RikaReply {
	if (typeof data !== "object" || data === null) return false;
	const d = data as Record<string, unknown>;
	return d.source === "rika" && d.version === 1 && typeof d.type === "string";
}

export function createRikaBridge(win: BridgeWindow, options: { ackTimeoutMs?: number } = {}): RikaBridge {
	const ackTimeoutMs = options.ackTimeoutMs ?? ACK_TIMEOUT_MS;
	const embedded = win.parent !== win && typeof (win.parent as Partial<PostTarget> | null)?.postMessage === "function";
	const origin = parentOriginFrom(win.document?.referrer);
	const parent = win.parent as PostTarget;

	/** A reply we may trust: from the parent window, from its known origin. */
	const fromRika = (event: BridgeEvent): RikaReply | null => {
		if (event.source !== win.parent) return null;
		if (origin !== null && event.origin !== origin) return null;
		return isRikaReply(event.data) ? event.data : null;
	};

	return {
		embedded,
		hello(onConnected) {
			if (!embedded) return () => {};
			const listener = (event: BridgeEvent) => {
				if (fromRika(event)?.type === "hello") onConnected();
			};
			win.addEventListener("message", listener);
			parent.postMessage({ source: "rika-learn", version: 1, type: "hello" }, origin ?? "*");
			return () => win.removeEventListener("message", listener);
		},
		deliver(message) {
			if (!embedded) return Promise.resolve({ kind: "not-embedded" });
			return new Promise<DeliverResult>((resolve) => {
				const finish = (result: DeliverResult) => {
					clearTimeout(timer);
					win.removeEventListener("message", listener);
					resolve(result);
				};
				const listener = (event: BridgeEvent) => {
					const reply = fromRika(event);
					if (!reply || reply.type !== "ack" || reply.id !== message.id) return;
					const text = typeof reply.message === "string" && reply.message ? { message: reply.message } : {};
					finish(reply.ok === false ? { kind: "refused", ...text } : { kind: "acked", ...text });
				};
				const timer = setTimeout(() => finish({ kind: "no-ack" }), ackTimeoutMs);
				win.addEventListener("message", listener);
				parent.postMessage(message, origin ?? "*");
			});
		},
	};
}

export type SendResult = { kind: "sent" | "saved" | "failed"; text: string };

export const SAVED_FOR_RIKA = "Saved for rika — it will be added the next time rika checks";

/** Hand a message to rika: postMessage first, the outbox when rika does not
 *  answer (or Learn is not inside rika). A refusal is shown, not queued —
 *  rika already looked at it and said no. */
export async function sendToRika(
	message: BridgeMessage,
	io: { deliver: (message: BridgeMessage) => Promise<DeliverResult>; saveToOutbox: (message: BridgeMessage) => Promise<void> },
): Promise<SendResult> {
	const result = await io.deliver(message);
	if (result.kind === "acked") return { kind: "sent", text: result.message ?? "Sent to rika" };
	if (result.kind === "refused") return { kind: "failed", text: `rika could not add it: ${result.message ?? "no reason given"}` };
	try {
		await io.saveToOutbox(message);
		return { kind: "saved", text: SAVED_FOR_RIKA };
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		return { kind: "failed", text: `Could not save it for rika (${reason}). Try again, or download the file.` };
	}
}
