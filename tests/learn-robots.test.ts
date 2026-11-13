/**
 * robots.txt (RFC 9309): the groups for our product token (else `*`),
 * longest-match Allow/Disallow with `*` and `$`, a missing file allows
 * everything, a 5xx or network failure allows nothing, one fetch per
 * origin per day.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { agentToken, isAllowed, parseRobots, robotsAllows } from "../src/agent/learn/sources/robots.ts";
import { DAY, fakeSources, text } from "./learn-sources-fakes.ts";

const ROBOTS = `
# synthetic example
User-agent: otherbot
Disallow: /

User-agent: *
Disallow: /private/
Allow: /private/open-
Disallow: /*.pdf$
Disallow: /search?
Disallow:

User-agent: rika-learn
User-agent: anotherbot
Disallow: /drafts
Allow: /drafts/public
Sitemap: https://example.test/sitemap.xml

User-agent: rika-learn
Disallow: /tmp
`;

describe("agentToken", () => {
	it("takes the product token of the User-Agent", () => {
		assert.equal(agentToken("rika-learn/0.1 (+https://example.test; a@example.test)"), "rika-learn");
		assert.equal(agentToken("  RikaLearn  "), "rikalearn");
	});
});

describe("parseRobots + isAllowed", () => {
	it("uses the * group when no group names our token", () => {
		const rules = parseRobots(ROBOTS, "somebot");
		assert.equal(isAllowed(rules, "/"), true);
		assert.equal(isAllowed(rules, "/private/x"), false);
		assert.equal(isAllowed(rules, "/drafts"), true);
	});

	it("prefers the longest matching rule; Allow wins ties", () => {
		const rules = parseRobots(ROBOTS, "somebot");
		assert.equal(isAllowed(rules, "/private/open-door"), true);
		const tie = parseRobots("User-agent: *\nDisallow: /a\nAllow: /a\n", "x");
		assert.equal(isAllowed(tie, "/a/b"), true);
	});

	it("supports * wildcards and the $ end anchor", () => {
		const rules = parseRobots(ROBOTS, "somebot");
		assert.equal(isAllowed(rules, "/docs/book.pdf"), false);
		assert.equal(isAllowed(rules, "/docs/book.pdf?download=1"), true);
		assert.equal(isAllowed(rules, "/search?q=rust"), false);
		assert.equal(isAllowed(rules, "/search"), true);
	});

	it("uses only our own group when one names us (case-insensitive), merged across groups", () => {
		const rules = parseRobots(ROBOTS, "Rika-Learn");
		assert.equal(isAllowed(rules, "/private/x"), true, "the * group no longer applies");
		assert.equal(isAllowed(rules, "/drafts/2026"), false);
		assert.equal(isAllowed(rules, "/drafts/public/a"), true);
		assert.equal(isAllowed(rules, "/tmp/x"), false, "a second group for us adds its rules");
	});

	it("blocks everything for a Disallow: / group and allows everything for an empty file", () => {
		assert.equal(isAllowed(parseRobots(ROBOTS, "otherbot"), "/anything"), false);
		assert.equal(isAllowed(parseRobots("", "x"), "/anything"), true);
	});

	it("never blocks /robots.txt itself", () => {
		assert.equal(isAllowed(parseRobots("User-agent: *\nDisallow: /\n", "x"), "/robots.txt"), true);
	});
});

describe("robotsAllows", () => {
	it("fetches /robots.txt once per origin and caches it for a day", async () => {
		const fake = fakeSources((url) => {
			assert.equal(url.pathname, "/robots.txt");
			return text("User-agent: *\nDisallow: /secret\n");
		});
		assert.equal(await robotsAllows("https://docs.example.test/book/", fake.ctx), true);
		assert.equal(await robotsAllows("https://docs.example.test/secret/page", fake.ctx), false);
		assert.equal(fake.calls.length, 1);
		assert.equal(fake.calls[0]?.url.href, "https://docs.example.test/robots.txt");
		assert.equal(fake.calls[0]?.headers["user-agent"], fake.ctx.userAgent);
		fake.clock.now += DAY + 1;
		await robotsAllows("https://docs.example.test/book/", fake.ctx);
		assert.equal(fake.calls.length, 2, "refetched after a day");
	});

	it("matches our product token from ctx.userAgent", async () => {
		const fake = fakeSources(() => text("User-agent: rika-learn-test\nDisallow: /\n"));
		assert.equal(await robotsAllows("https://a.example.test/x", fake.ctx), false);
	});

	it("treats a missing robots.txt (4xx) as allowed", async () => {
		const fake = fakeSources(() => text("nope", 404));
		assert.equal(await robotsAllows("https://b.example.test/x", fake.ctx), true);
	});

	it("treats a 5xx or a network error as disallowed", async () => {
		const down = fakeSources(() => text("oops", 503));
		assert.equal(await robotsAllows("https://c.example.test/x", down.ctx), false);
		const offline = fakeSources(() => {
			throw new TypeError("fetch failed");
		});
		assert.equal(await robotsAllows("https://d.example.test/x", offline.ctx), false);
	});

	it("refuses non-http(s) URLs without fetching", async () => {
		const fake = fakeSources(() => text(""));
		assert.equal(await robotsAllows("file:///etc/passwd", fake.ctx), false);
		assert.equal(await robotsAllows("not a url", fake.ctx), false);
		assert.equal(fake.calls.length, 0);
	});
});
