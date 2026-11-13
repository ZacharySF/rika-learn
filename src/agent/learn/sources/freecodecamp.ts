/**
 * FREECODECAMP (research/07 §2.1): there is no article search API, so the
 * /news sitemap (robots.txt allows it) is read once a week and the query
 * is matched against article slugs. The title comes from the slug; no
 * article page is fetched.
 */
import type { Candidate } from "../../../core/learn/contracts.ts";
import { DAY_MS, cached, candidate, decodeEntities, failureReason, getText, words } from "./http.ts";
import { robotsAllows } from "./robots.ts";
import type { SourceAdapter, SourceContext, SourceQuery } from "./types.ts";

const HOST = "www.freecodecamp.org";
const INDEX_URL = `https://${HOST}/news/sitemap.xml`;
const SITEMAP_TTL_MS = 7 * DAY_MS;
/** Sitemaps are a few MB; give them longer than an API call. */
const FETCH = { timeoutMs: 45_000, minIntervalMs: 2000 };

/** One article as the sitemap lists it. */
interface Post {
	url: string;
	/** lastmod, for recency ties. */
	at: string;
}

/** Query words that say nothing about the subject. */
const FILLER: Record<string, true> = Object.fromEntries(
	"a an and the to of for in on with how what why is are your you learn learning tutorial guide introduction intro beginners beginner basics"
		.split(" ")
		.map((w) => [w, true]),
);

/** Slug words that mean "do this", not "read this". */
const PRACTICE: Record<string, true> = Object.fromEntries(
	"build building project projects exercise exercises practice challenge challenges".split(" ").map((w) => [w, true]),
);

class RobotsRefused extends Error {}

export function titleFromSlug(slug: string): string {
	const text = decodeURIComponent(slug).replace(/[-_]+/g, " ").trim();
	return text.charAt(0).toUpperCase() + text.slice(1);
}

function locs(xml: string, block: "sitemap" | "url"): { loc: string; lastmod: string }[] {
	const pattern = new RegExp(`<${block}>([\\s\\S]*?)</${block}>`, "g");
	return [...xml.matchAll(pattern)].flatMap((match) => {
		const body = match[1] ?? "";
		const loc = /<loc>\s*([^<]+?)\s*<\/loc>/.exec(body)?.[1];
		const lastmod = /<lastmod>\s*([^<]+?)\s*<\/lastmod>/.exec(body)?.[1] ?? "";
		return loc ? [{ loc: decodeEntities(loc), lastmod }] : [];
	});
}

/** Only freeCodeCamp's own /news/ pages: a sitemap could list anything. */
function isOwnNewsUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return url.protocol === "https:" && url.host === HOST && url.pathname.startsWith("/news/");
	} catch {
		return false;
	}
}

async function fetchAllowed(ctx: SourceContext, url: string): Promise<string> {
	if (!(await robotsAllows(url, ctx))) throw new RobotsRefused();
	return (await getText(ctx, url, FETCH)).text;
}

async function loadPosts(ctx: SourceContext): Promise<Post[]> {
	const index = await fetchAllowed(ctx, INDEX_URL);
	const sitemaps = locs(index, "sitemap")
		.map((s) => s.loc)
		.filter((loc) => isOwnNewsUrl(loc) && /\/sitemap-posts[^/]*\.xml$/.test(loc));
	const posts: Post[] = [];
	for (const sitemap of sitemaps) {
		for (const entry of locs(await fetchAllowed(ctx, sitemap), "url")) {
			if (isOwnNewsUrl(entry.loc)) posts.push({ url: entry.loc, at: entry.lastmod });
		}
	}
	return posts;
}

function slugOf(url: string): string {
	return new URL(url).pathname.replace(/^\/news\//, "").replace(/\/$/, "");
}

function match(posts: readonly Post[], query: SourceQuery): Candidate[] {
	const wanted = [...new Set(words(query.query).filter((w) => !FILLER[w]))];
	if (wanted.length === 0) return [];
	const needed = Math.min(2, wanted.length);
	const scored = posts.flatMap((post) => {
		const slug = slugOf(post.url);
		if (!slug || slug.includes("/")) return [];
		const slugWords = new Set(words(slug.replace(/-/g, " ")));
		const score = wanted.filter((w) => slugWords.has(w)).length;
		return score >= needed ? [{ post, slug, score, practice: [...slugWords].some((w) => PRACTICE[w]) }] : [];
	});
	scored.sort((a, b) => b.score - a.score || b.post.at.localeCompare(a.post.at));
	return scored.slice(0, Math.max(1, query.limit)).map((s) =>
		candidate({
			source: "freecodecamp",
			kind: s.practice ? "exercise" : "reading",
			title: titleFromSlug(s.slug),
			url: s.post.url,
			by: "freeCodeCamp",
		}),
	);
}

export const freecodecamp: SourceAdapter = {
	id: "freecodecamp",
	resolves: [],

	async search(query: SourceQuery, ctx: SourceContext, onError?: (reason: string) => void): Promise<Candidate[]> {
		let posts: Post[];
		try {
			posts = await cached(ctx, "freecodecamp:posts", SITEMAP_TTL_MS, () => loadPosts(ctx));
		} catch (error) {
			onError?.(
				error instanceof RobotsRefused
					? "freeCodeCamp's robots.txt does not allow reading its article list."
					: failureReason("freecodecamp", error),
			);
			return [];
		}
		return match(posts, query);
	},
};
