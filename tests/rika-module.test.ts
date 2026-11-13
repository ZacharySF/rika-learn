/**
 * rika module packaging: the manifest rika's module loader (api v1) reads,
 * the packaging script, the tag-release workflow, and the bridge stub that
 * stands in for rika's side of the iframe bridge (docs/learn.md).
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { createRequire } from "node:module";
import { after, before, describe, it } from "node:test";
import * as stub from "../scripts/rika-bridge-stub.mjs";

const root = new URL("../", import.meta.url);
const readText = (relative: string) => fs.readFileSync(new URL(relative, root), "utf8");
const readJson = (relative: string): unknown => JSON.parse(readText(relative));

const ID = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/;
const GROUPS = ["plan", "study", "jobs", "settings"];

interface Manifest {
	id: string;
	name: string;
	version: string;
	api: number;
	description: string;
	license: string;
	kind: string;
	process: {
		command: string[];
		cwd: string;
		env: Record<string, string>;
		health: string;
		ready_timeout_s: number;
	};
	view: { id: string; label: string; icon: string; group: string; first: boolean; ui: string };
}

describe("rika-module.json", () => {
	const manifest = readJson("rika-module.json") as Manifest;
	const pkg = readJson("package.json") as { version: string };

	it("identifies the module and matches package.json", () => {
		assert.equal(manifest.id, "rika-learn");
		assert.match(manifest.id, ID);
		assert.equal(manifest.name, "Learn");
		assert.equal(manifest.api, 1);
		assert.match(manifest.version, SEMVER);
		assert.equal(manifest.version, pkg.version, "manifest version must equal package.json version");
		assert.equal(manifest.license, "AGPL-3.0-only");
	});

	it("has a plain one-sentence description", () => {
		assert.equal(typeof manifest.description, "string");
		assert.match(manifest.description, /^[A-Z][^\n]{10,200}\.$/);
	});

	it("runs as a node process bound to 127.0.0.1 on rika's port", () => {
		assert.equal(manifest.kind, "process");
		assert.deepEqual(manifest.process.command, ["node", "server.js"]);
		assert.equal(manifest.process.cwd, ".");
		assert.equal(manifest.process.health, "/");
		assert.ok(Number.isInteger(manifest.process.ready_timeout_s));
		assert.ok(manifest.process.ready_timeout_s >= 1 && manifest.process.ready_timeout_s <= 300);
		assert.equal(manifest.process.ready_timeout_s, 30);
		assert.deepEqual(manifest.process.env, {
			LH_DATA_DIR: "{data}",
			LH_AUTH_FILE: "{data}/auth.json",
			PORT: "{port}",
			HOSTNAME: "127.0.0.1",
			NODE_ENV: "production",
			NEXT_TELEMETRY_DISABLED: "1",
			LH_START_VIEW: "learn",
		});
	});

	it("uses only the placeholders the loader substitutes", () => {
		for (const value of [...Object.values(manifest.process.env), ...manifest.process.command, manifest.process.cwd]) {
			for (const [placeholder] of value.matchAll(/\{[^}]*\}/g)) {
				assert.ok(["{data}", "{port}", "{module}"].includes(placeholder), `unknown placeholder ${placeholder}`);
			}
		}
	});

	it("declares the Learn view as a first-in-group iframe in Study", () => {
		assert.match(manifest.view.id, ID);
		assert.deepEqual(manifest.view, {
			id: "learn",
			label: "Learn",
			icon: "graduation-cap",
			group: "study",
			first: true,
			ui: "iframe",
		});
		assert.ok(GROUPS.includes(manifest.view.group));
		// kind process ⇒ the view is an iframe onto the module's server.
		assert.equal(manifest.view.ui, "iframe");
	});
});

describe("scripts/package-module", () => {
	const url = new URL("scripts/package-module", root);

	it("exists and is executable", () => {
		const stat = fs.statSync(url);
		assert.ok(stat.isFile());
		assert.ok((stat.mode & 0o111) !== 0, "package-module must be executable");
	});

	it("is strict bash, reuses build-server.mjs and supports --skip-build", () => {
		const script = readText("scripts/package-module");
		assert.match(script, /^#!\/usr\/bin\/env bash\n/);
		assert.match(script, /set -euo pipefail/);
		assert.match(script, /node scripts\/build-server\.mjs/);
		assert.match(script, /--skip-build/);
		assert.match(script, /dist\/module/);
		assert.match(script, /\.sha256/);
	});
});

describe(".github/workflows/module-release.yml", () => {
	const text = readText(".github/workflows/module-release.yml");
	const yaml = createRequire(import.meta.url)("js-yaml") as { load: (source: string) => unknown };
	const workflow = yaml.load(text) as {
		on: { push?: { tags?: string[] }; workflow_dispatch?: unknown };
		permissions?: Record<string, string>;
		jobs: Record<string, { "runs-on": string; permissions?: Record<string, string>; steps: { run?: string; uses?: string; with?: Record<string, unknown> }[] }>;
	};
	const steps = Object.values(workflow.jobs).flatMap((job) => job.steps);
	const runs = steps.map((step) => step.run ?? "").join("\n");

	it("triggers on v* tags and manual dispatch", () => {
		assert.deepEqual(workflow.on.push?.tags, ["v*"]);
		assert.ok("workflow_dispatch" in workflow.on);
	});

	it("gates, packages and runs on ubuntu with node 26", () => {
		for (const job of Object.values(workflow.jobs)) assert.equal(job["runs-on"], "ubuntu-24.04");
		assert.ok(steps.some((step) => step.uses?.startsWith("actions/setup-node") && step.with?.["node-version"] === "26"));
		for (const command of ["npm ci", "npm run typecheck", "npm test", "npm run lint", "scripts/package-module"]) {
			assert.ok(runs.includes(command), `missing step: ${command}`);
		}
		assert.match(runs, /GITHUB_REF_NAME/);
	});

	it("uploads the tarball and its .sha256 as an artifact and to the release", () => {
		const artifact = steps.find((step) => step.uses?.startsWith("actions/upload-artifact"));
		assert.ok(artifact, "workflow artifact upload missing");
		const artifactPaths = String(artifact.with?.path ?? "");
		assert.match(artifactPaths, /\.tar\.gz\b/);
		assert.match(artifactPaths, /\.tar\.gz\.sha256/);
		assert.match(runs, /gh release (create|upload)/);
		assert.match(runs, /\.tar\.gz\.sha256/);
		const releaseJob = Object.values(workflow.jobs).find((job) => job.steps.some((step) => step.run?.includes("gh release")));
		assert.equal(releaseJob?.permissions?.contents ?? workflow.permissions?.contents, "write");
	});
});

describe("scripts/rika-bridge-stub.mjs", () => {
	let app: http.Server;
	let server: http.Server;
	let appUrl = "";
	let stubUrl = "";
	const acked: string[][] = [];
	const outbox = [
		{
			id: "ob_1",
			createdAt: "2026-11-13T10:00:00.000Z",
			message: {
				source: "rika-learn",
				version: 1,
				id: "msg_1",
				type: "calendar",
				payload: {
					roadmap: { id: "rm_test", title: "Synthetic roadmap" },
					stage: { id: "s1", title: "Stage one" },
					events: [
						{ source_key: "learn:rm_test:s1:1", title: "Learn: Stage one (1 of 2)", date: "2026-11-14", start: "18:00", minutes: 60, notes: "", attachments: [] },
						{ source_key: "learn:rm_test:s1:2", title: "Learn: Stage one (2 of 2)", date: "2026-11-15", start: "18:00", minutes: 60, notes: "", attachments: [] },
					],
				},
			},
		},
	];

	const listen = (target: http.Server) => {
		const { promise, resolve } = Promise.withResolvers<string>();
		target.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(target.address() as AddressInfo).port}`));
		return promise;
	};

	before(async () => {
		// A fake Learn server: only the two outbox endpoints the stub proxies.
		app = http.createServer((request, response) => {
			if (request.method === "GET" && request.url === "/api/learn/bridge/outbox") {
				response.writeHead(200, { "content-type": "application/json" });
				response.end(JSON.stringify({ items: outbox }));
				return;
			}
			if (request.method === "POST" && request.url === "/api/learn/bridge/outbox/ack") {
				let body = "";
				request.on("data", (chunk: Buffer) => (body += chunk.toString()));
				request.on("end", () => {
					const { ids } = JSON.parse(body) as { ids: string[] };
					acked.push(ids);
					response.writeHead(200, { "content-type": "application/json" });
					response.end(JSON.stringify({ removed: ids.length }));
				});
				return;
			}
			response.writeHead(404).end();
		});
		appUrl = await listen(app);
		server = stub.createStub({ app: appUrl });
		stubUrl = await listen(server);
	});

	after(() => {
		server.close();
		app.close();
	});

	it("answers hello and acks cards and events in plain words", () => {
		assert.deepEqual(stub.ackFor({ source: "rika-learn", version: 1, type: "hello" }), { source: "rika", version: 1, type: "hello" });
		const cards = { guid: "learn-0", front: "Q", back: "A" };
		assert.deepEqual(
			stub.ackFor({ source: "rika-learn", version: 1, id: "m1", type: "flashcards", payload: { cards: [cards, cards, cards] } }),
			{ source: "rika", version: 1, type: "ack", id: "m1", ok: true, message: "Received 3 cards" },
		);
		assert.deepEqual(
			stub.ackFor({ source: "rika-learn", version: 1, id: "m2", type: "calendar", payload: { events: [{}, {}] } }),
			{ source: "rika", version: 1, type: "ack", id: "m2", ok: true, message: "Received 2 events" },
		);
		assert.equal(stub.ackFor({ source: "somebody-else", type: "hello" }), null);
	});

	it("serves a page that iframes the app with a clear received panel", async () => {
		const response = await fetch(`${stubUrl}/`);
		assert.equal(response.status, 200);
		const page = await response.text();
		assert.ok(page.includes(`<iframe`));
		assert.ok(page.includes(JSON.stringify(appUrl)) || page.includes(`src="${appUrl}/"`));
		assert.ok(page.includes("What rika received"));
		assert.ok(page.includes("Check Learn's outbox") || page.includes("Check Learn&#39;s outbox"));
	});

	it("records page-reported messages at /received", async () => {
		const before = (await (await fetch(`${stubUrl}/received`)).json()) as unknown[];
		assert.deepEqual(before, []);
		const message = { source: "rika-learn", version: 1, id: "m1", type: "flashcards", payload: { cards: [] } };
		const post = await fetch(`${stubUrl}/received`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ via: "postMessage", message }) });
		assert.equal(post.status, 204);
		const received = (await (await fetch(`${stubUrl}/received`)).json()) as { via: string; message: unknown }[];
		assert.equal(received.length, 1);
		assert.equal(received[0]?.via, "postMessage");
		assert.deepEqual(received[0]?.message, message);
	});

	it("checks Learn's outbox through the stub, records and acks the items", async () => {
		const response = await fetch(`${stubUrl}/outbox/check`, { method: "POST" });
		assert.equal(response.status, 200);
		const result = (await response.json()) as { imported: number; acks: { id: string; message: string }[] };
		assert.equal(result.imported, 1);
		assert.equal(result.acks[0]?.message, "Received 2 events");
		assert.deepEqual(acked, [["ob_1"]]);
		const received = (await (await fetch(`${stubUrl}/received`)).json()) as { via: string; message: { id: string } }[];
		assert.equal(received.at(-1)?.via, "outbox");
		assert.equal(received.at(-1)?.message.id, "msg_1");
	});

	it("proxies the raw outbox at GET /outbox", async () => {
		const response = await fetch(`${stubUrl}/outbox`);
		assert.equal(response.status, 200);
		assert.deepEqual(await response.json(), { items: outbox });
	});
});
