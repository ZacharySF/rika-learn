#!/usr/bin/env node
/**
 * rika-bridge-stub.mjs — a stand-in for rika's side of the Learn bridge
 * (docs/learn.md "Bridge to rika"), so the bridge can be exercised without
 * the desktop app.
 *
 *   node scripts/rika-bridge-stub.mjs --app http://127.0.0.1:3000 --port 3999
 *
 * It serves a parent page that iframes Learn, answers `hello`, acks every
 * rika-learn message over postMessage, and lists what arrived. A button
 * picks up Learn's HTTP outbox through this server (the browser cannot read
 * Learn's API cross-origin) and acks those items too. Everything received
 * is also exposed at GET /received so browser tests can assert on it.
 */
import * as http from "node:http";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

/**
 * rika's reply to one message from Learn, or null when the message is not
 * from Learn. The page inlines this exact function (via toString), so it
 * must stay self-contained: no imports, no outer variables.
 * @param {unknown} message
 * @returns {Record<string, unknown> | null}
 */
export function ackFor(message) {
	if (!message || typeof message !== "object") return null;
	const m = /** @type {Record<string, any>} */ (message);
	if (m.source !== "rika-learn") return null;
	if (m.type === "hello") return { source: "rika", version: 1, type: "hello" };
	const ack = { source: "rika", version: 1, type: "ack", id: String(m.id ?? "") };
	const list = m.type === "flashcards" ? m.payload?.cards : m.type === "calendar" ? m.payload?.events : undefined;
	if (!Array.isArray(list)) return { ...ack, ok: false, message: `rika does not understand a "${String(m.type)}" message` };
	const noun = m.type === "flashcards" ? "card" : "event";
	return { ...ack, ok: true, message: `Received ${list.length} ${list.length === 1 ? noun : `${noun}s`}` };
}

/** Escape text for an HTML attribute or element body. */
const escapeHtml = (text) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** JSON that is safe inside an inline <script>. */
const scriptJson = (value) => JSON.stringify(value).replace(/</g, "\\u003c");

/** The parent page: Learn in a frame on the left, what rika received on the right. */
function page(appUrl) {
	const origin = new URL(appUrl).origin;
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>rika bridge stub</title>
<style>
	:root { color-scheme: dark; --bg: #0b0b0d; --card: #151518; --border: #2a2a30; --muted: #a1a1aa; --fg: #f4f4f5; --primary: #a78bfa; --ok: #4ade80; --bad: #f87171; }
	* { box-sizing: border-box; }
	body { margin: 0; background: var(--bg); color: var(--fg); font: 14px/1.5 system-ui, sans-serif; display: flex; flex-direction: column; min-height: 100vh; }
	header { padding: 12px 16px; border-bottom: 1px solid var(--border); }
	header h1 { margin: 0; font-size: 16px; }
	header p { margin: 2px 0 0; color: var(--muted); }
	main { flex: 1; display: grid; grid-template-columns: minmax(0, 1fr) minmax(320px, 420px); min-height: 0; }
	iframe { width: 100%; height: 100%; min-height: 70vh; border: 0; background: #000; }
	aside { border-left: 1px solid var(--border); padding: 16px; overflow: auto; display: flex; flex-direction: column; gap: 16px; }
	h2 { margin: 0 0 4px; font-size: 15px; }
	.help { margin: 0; color: var(--muted); font-size: 13px; }
	.status { display: inline-flex; align-items: center; gap: 6px; font-weight: 600; }
	.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--muted); }
	.connected .dot { background: var(--ok); }
	button { background: var(--primary); color: #0b0b0d; border: 0; border-radius: 8px; padding: 8px 14px; font: inherit; font-weight: 600; cursor: pointer; }
	button:disabled { opacity: .6; cursor: default; }
	.entry { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; }
	.entry h3 { margin: 0; font-size: 14px; }
	.meta { color: var(--muted); font-size: 12px; }
	.reply { margin: 6px 0; font-size: 13px; }
	.reply.ok { color: var(--ok); } .reply.bad { color: var(--bad); }
	details summary { cursor: pointer; color: var(--muted); font-size: 12px; }
	pre { margin: 6px 0 0; padding: 8px; background: var(--bg); border-radius: 6px; overflow: auto; font-size: 12px; max-height: 320px; }
	.empty { color: var(--muted); font-style: italic; }
	@media (max-width: 860px) {
		main { grid-template-columns: 1fr; }
		aside { border-left: 0; border-top: 1px solid var(--border); }
	}
</style>
</head>
<body>
<header>
	<h1>rika bridge stub</h1>
	<p>This page pretends to be rika. Learn runs in the frame; whatever Learn sends to rika shows up under "What rika received".</p>
</header>
<main>
	<iframe id="learn" title="Learn" src="${escapeHtml(appUrl)}"></iframe>
	<aside>
		<section>
			<h2>Connection</h2>
			<p id="status" class="status"><span class="dot"></span><span id="status-text">Waiting for Learn to say hello…</span></p>
			<p class="help">Learn says hello when it loads. rika answers, and Learn then shows "Connected to rika".</p>
		</section>
		<section>
			<h2>Learn's outbox</h2>
			<p class="help">When rika does not answer in time, Learn keeps the message in its outbox. This button collects those messages, lists them below and tells Learn they arrived.</p>
			<p><button id="check" type="button">Check Learn's outbox</button></p>
			<p id="outbox-result" class="help" aria-live="polite"></p>
		</section>
		<section>
			<h2>What rika received</h2>
			<p class="help">Newest first. Open "Show the message" to see exactly what Learn sent.</p>
			<div id="received" aria-live="polite"><p class="empty">Nothing yet. Send flashcards or a study plan from Learn.</p></div>
		</section>
	</aside>
</main>
<script>
const APP_ORIGIN = ${scriptJson(origin)};
${ackFor.toString()}
const frame = document.getElementById("learn");
const list = document.getElementById("received");

function describe(message) {
	if (message.type === "hello") return "Learn said hello";
	if (message.type === "flashcards") return "Flashcards for " + (message.payload?.deck ?? "a deck");
	if (message.type === "calendar") return "Study sessions for " + (message.payload?.stage?.title ?? "a stage");
	return "A " + String(message.type) + " message";
}

function render(entries) {
	list.replaceChildren();
	if (entries.length === 0) {
		list.innerHTML = '<p class="empty">Nothing yet. Send flashcards or a study plan from Learn.</p>';
		return;
	}
	for (const entry of [...entries].reverse()) {
		const box = document.createElement("article");
		box.className = "entry";
		const title = document.createElement("h3");
		title.textContent = describe(entry.message);
		const meta = document.createElement("div");
		meta.className = "meta";
		meta.textContent = new Date(entry.at).toLocaleTimeString() + " · " + (entry.via === "outbox" ? "picked up from the outbox" : "sent directly");
		box.append(title, meta);
		if (entry.reply && entry.reply.type === "ack") {
			const reply = document.createElement("p");
			reply.className = "reply " + (entry.reply.ok ? "ok" : "bad");
			reply.textContent = "rika replied: " + entry.reply.message;
			box.append(reply);
		}
		const details = document.createElement("details");
		const summary = document.createElement("summary");
		summary.textContent = "Show the message";
		const pre = document.createElement("pre");
		pre.textContent = JSON.stringify(entry.message, null, 2);
		details.append(summary, pre);
		box.append(details);
		list.append(box);
	}
}

async function refresh() {
	render(await (await fetch("/received")).json());
}

window.addEventListener("message", async (event) => {
	// Only the framed Learn app may talk to "rika".
	if (event.source !== frame.contentWindow || event.origin !== APP_ORIGIN) return;
	const reply = ackFor(event.data);
	if (!reply) return;
	frame.contentWindow.postMessage(reply, APP_ORIGIN);
	if (reply.type === "hello") {
		document.getElementById("status").classList.add("connected");
		document.getElementById("status-text").textContent = "Learn is connected";
	}
	await fetch("/received", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ via: "postMessage", message: event.data, reply }),
	});
	await refresh();
});

document.getElementById("check").addEventListener("click", async (event) => {
	const button = event.currentTarget;
	const result = document.getElementById("outbox-result");
	button.disabled = true;
	result.textContent = "Checking…";
	try {
		const response = await fetch("/outbox/check", { method: "POST" });
		const body = await response.json();
		if (!response.ok) result.textContent = body.error ?? "Could not check the outbox.";
		else if (body.imported === 0) result.textContent = "The outbox is empty.";
		else result.textContent = "Picked up " + body.imported + (body.imported === 1 ? " message" : " messages") + " and told Learn they arrived.";
		await refresh();
	} catch {
		result.textContent = "Could not reach this stub server.";
	} finally {
		button.disabled = false;
	}
});

refresh();
</script>
</body>
</html>
`;
}

/** Read a small JSON request body; rejects bodies over the cap. */
async function readJson(request, cap = 2 * 1024 * 1024) {
	let size = 0;
	const chunks = [];
	for await (const chunk of request) {
		size += chunk.length;
		if (size > cap) throw new Error("body too large");
		chunks.push(chunk);
	}
	return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/**
 * The stub server. `app` is Learn's base URL; `fetch` is injectable so the
 * outbox proxy can be pointed anywhere.
 * @param {{ app: string, fetch?: typeof globalThis.fetch }} options
 * @returns {http.Server}
 */
export function createStub({ app, fetch = globalThis.fetch }) {
	const appUrl = new URL(app).href;
	const outboxUrl = new URL("/api/learn/bridge/outbox", appUrl).href;
	/** @type {{ at: string, via: "postMessage" | "outbox", message: unknown, reply: unknown }[]} */
	const received = [];

	const send = (response, status, body) => {
		response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
		response.end(JSON.stringify(body));
	};

	const unreachable = (response, error) =>
		send(response, 502, { error: `Could not reach Learn at ${appUrl} (${error instanceof Error ? error.message : String(error)}).` });

	return http.createServer(async (request, response) => {
		const { pathname } = new URL(request.url ?? "/", "http://stub");
		try {
			if (request.method === "GET" && pathname === "/") {
				response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
				response.end(page(appUrl));
				return;
			}
			if (request.method === "GET" && pathname === "/received") return send(response, 200, received);
			if (request.method === "POST" && pathname === "/received") {
				const body = await readJson(request);
				received.push({ at: new Date().toISOString(), via: body.via === "outbox" ? "outbox" : "postMessage", message: body.message, reply: body.reply ?? ackFor(body.message) });
				response.writeHead(204).end();
				return;
			}
			if (request.method === "GET" && pathname === "/outbox") {
				let upstream;
				try {
					upstream = await fetch(outboxUrl);
				} catch (error) {
					return unreachable(response, error);
				}
				response.writeHead(upstream.status, { "content-type": upstream.headers.get("content-type") ?? "application/json" });
				response.end(await upstream.text());
				return;
			}
			if (request.method === "POST" && pathname === "/outbox/check") {
				let items;
				try {
					const upstream = await fetch(outboxUrl);
					if (!upstream.ok) return send(response, 502, { error: `Learn's outbox answered ${upstream.status}.` });
					items = /** @type {{ items?: { id: string, message: unknown }[] }} */ (await upstream.json()).items ?? [];
				} catch (error) {
					return unreachable(response, error);
				}
				const acks = [];
				for (const item of items) {
					const reply = ackFor(item.message);
					received.push({ at: new Date().toISOString(), via: "outbox", message: item.message, reply });
					acks.push({ id: item.id, message: reply && "message" in reply ? String(reply.message) : "Not a Learn message" });
				}
				if (items.length > 0) {
					try {
						const ack = await fetch(`${outboxUrl}/ack`, {
							method: "POST",
							headers: { "content-type": "application/json" },
							body: JSON.stringify({ ids: items.map((item) => item.id) }),
						});
						if (!ack.ok) return send(response, 502, { error: `Learn refused the outbox ack (${ack.status}).` });
					} catch (error) {
						return unreachable(response, error);
					}
				}
				return send(response, 200, { imported: items.length, acks });
			}
			send(response, 404, { error: "Not found" });
		} catch (error) {
			send(response, 400, { error: error instanceof Error ? error.message : String(error) });
		}
	});
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const { values } = parseArgs({
		options: {
			app: { type: "string", default: "http://127.0.0.1:3000" },
			port: { type: "string", default: "3999" },
		},
	});
	const port = Number(values.port);
	if (!Number.isInteger(port) || port < 0 || port > 65535) {
		console.error(`[rika-bridge-stub] --port must be a port number, got ${values.port}`);
		process.exit(1);
	}
	const server = createStub({ app: values.app });
	server.listen(port, "127.0.0.1", () => {
		const address = /** @type {import("node:net").AddressInfo} */ (server.address());
		console.log(`[rika-bridge-stub] open http://127.0.0.1:${address.port}/ (Learn at ${new URL(values.app).href})`);
	});
}
