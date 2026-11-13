/**
 * ROBOTS.TXT (RFC 9309) for every page Learn fetches that is not a
 * documented API: the docs adapter's model-named URLs and the
 * freeCodeCamp sitemap. A missing file (4xx) allows everything; a 5xx or
 * network failure allows nothing, because "could not check" must not
 * become "may crawl".
 */
import { DAY_MS, getResponse, readTextCapped } from "./http.ts";
import type { SourceContext } from "./types.ts";

export interface RobotsRule {
	allow: boolean;
	/** The path pattern as written (its length decides precedence). */
	pattern: string;
	regex: RegExp;
}

/** Cached robots state per origin: the file's text ("" = no file). */
interface RobotsEntry {
	text: string;
}

const ROBOTS_MAX_BYTES = 512 * 1024;
/** A failed check is retried after this long, not a whole day. */
const FAILURE_RETRY_MS = 15 * 60 * 1000;

/** The product token robots groups name: "rika-learn/0.1 (…)" → "rika-learn". */
export function agentToken(userAgent: string): string {
	return (userAgent.trim().split(/[\s/]/)[0] ?? "").toLowerCase();
}

function patternRegex(pattern: string): RegExp {
	const anchored = pattern.endsWith("$");
	const body = (anchored ? pattern.slice(0, -1) : pattern)
		.split("*")
		.map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
		.join(".*");
	return new RegExp(`^${body}${anchored ? "$" : ""}`);
}

/** The rules that apply to `token`: every group naming it, merged; if
 *  none does, every `*` group, merged. */
export function parseRobots(text: string, token: string): RobotsRule[] {
	const want = token.toLowerCase();
	const groups: { agents: string[]; rules: RobotsRule[] }[] = [];
	let current: { agents: string[]; rules: RobotsRule[] } | undefined;
	let lastWasAgent = false;
	for (const raw of text.split(/\r?\n/)) {
		const line = raw.replace(/#.*/, "").trim();
		const colon = line.indexOf(":");
		if (colon < 0) continue;
		const field = line.slice(0, colon).trim().toLowerCase();
		const value = line.slice(colon + 1).trim();
		if (field === "user-agent") {
			if (!current || !lastWasAgent) {
				current = { agents: [], rules: [] };
				groups.push(current);
			}
			current.agents.push(value.toLowerCase());
			lastWasAgent = true;
			continue;
		}
		if (field === "allow" || field === "disallow") {
			lastWasAgent = false;
			// An empty Disallow means "nothing disallowed": no rule.
			if (!current || !value) continue;
			current.rules.push({ allow: field === "allow", pattern: value, regex: patternRegex(value) });
			continue;
		}
		// Sitemap, Crawl-delay and unknown lines neither end nor join a group.
	}
	const ours = groups.filter((g) => g.agents.includes(want));
	const chosen = ours.length > 0 ? ours : groups.filter((g) => g.agents.includes("*"));
	return chosen.flatMap((g) => g.rules);
}

/** Longest matching pattern wins; on a tie Allow wins; no match allows.
 *  `path` is the URL path plus query. */
export function isAllowed(rules: readonly RobotsRule[], path: string): boolean {
	if (path === "/robots.txt") return true;
	let best: RobotsRule | undefined;
	for (const rule of rules) {
		if (!rule.regex.test(path)) continue;
		if (
			!best ||
			rule.pattern.length > best.pattern.length ||
			(rule.pattern.length === best.pattern.length && rule.allow)
		) {
			best = rule;
		}
	}
	return best ? best.allow : true;
}

/** Whether robots.txt lets us fetch `url`. One fetch per origin per day. */
export async function robotsAllows(url: string, ctx: SourceContext): Promise<boolean> {
	let target: URL;
	try {
		target = new URL(url);
	} catch {
		return false;
	}
	if (target.protocol !== "https:" && target.protocol !== "http:") return false;
	const key = `robots:${target.origin}`;
	const failKey = `robots-failed:${target.origin}`;
	let entry = ctx.cache.get<RobotsEntry>(key, DAY_MS);
	if (!entry) {
		if (ctx.cache.get<true>(failKey, FAILURE_RETRY_MS)) return false;
		try {
			const response = await getResponse(ctx, `${target.origin}/robots.txt`, { timeoutMs: 10_000 });
			if (response.status >= 500) throw new Error(`robots.txt answered ${response.status}`);
			if (response.ok) entry = { text: await readTextCapped(response, ROBOTS_MAX_BYTES) };
			else {
				await response.body?.cancel().catch(() => undefined);
				entry = { text: "" };
			}
		} catch {
			ctx.cache.set(failKey, true);
			return false;
		}
		ctx.cache.set(key, entry);
	}
	return isAllowed(parseRobots(entry.text, agentToken(ctx.userAgent)), target.pathname + target.search);
}
