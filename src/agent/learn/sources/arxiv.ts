/**
 * ARXIV (research/07 §2.1): the export API's Atom feed. arXiv asks for no
 * more than one request every 3 seconds, enforced by the per-host
 * interval. The feed is small and regular, so a few regexes read it
 * without a DOM dependency.
 */
import type { Candidate, CanonItem } from "../../../core/learn/contracts.ts";
import {
	DAY_MS,
	ParseError,
	authorsLine,
	cached,
	candidate,
	clip,
	decodeEntities,
	getText,
	httpUrl,
	normalizeKey,
	plainText,
	safely,
	safelyResolve,
	titlesMatch,
	words,
} from "./http.ts";
import type { SourceAdapter, SourceContext, SourceQuery } from "./types.ts";

const TTL_MS = 7 * DAY_MS;
const PACE = { minIntervalMs: 3000 };
const MAX_QUERY_WORDS = 6;

function tag(xml: string, name: string): string | undefined {
	const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(xml);
	return match?.[1];
}

function textOf(raw: string | undefined): string | undefined {
	if (raw === undefined) return undefined;
	const text = plainText(raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1"));
	return text || undefined;
}

/** Abstract pages only: arXiv's error entries point at /api/errors. */
function absUrl(entry: string): string | undefined {
	for (const link of entry.match(/<link\b[^>]*>/g) ?? []) {
		if (!/\brel="alternate"/.test(link)) continue;
		const href = /\bhref="([^"]+)"/.exec(link)?.[1];
		if (href) return httpUrl(decodeEntities(href).replace(/^http:/, "https:"));
	}
	const id = textOf(tag(entry, "id"));
	return id ? httpUrl(id.replace(/^http:/, "https:")) : undefined;
}

/** The feed's entries as paper candidates. Throws ParseError when the
 *  reply is not an Atom feed at all. */
export function parseArxivFeed(xml: string): Candidate[] {
	if (!/<feed[\s>]/.test(xml)) throw new ParseError("not an Atom feed from arXiv");
	const entries = xml.match(/<entry[\s>][\s\S]*?<\/entry>/g) ?? [];
	return entries.flatMap((entry) => {
		const url = absUrl(entry);
		const title = textOf(tag(entry, "title"));
		if (!url || !title || !new URL(url).pathname.startsWith("/abs/")) return [];
		const authors = (entry.match(/<author[\s>][\s\S]*?<\/author>/g) ?? []).flatMap((a) => {
			const name = textOf(tag(a, "name"));
			return name ? [name] : [];
		});
		const publishedAt = textOf(tag(entry, "published"));
		const year = publishedAt ? Number(publishedAt.slice(0, 4)) : Number.NaN;
		return [
			candidate({
				source: "arxiv",
				kind: "paper",
				title,
				url,
				by: authorsLine(authors),
				description: clip(textOf(tag(entry, "summary"))),
				year: Number.isFinite(year) ? year : undefined,
				signals: { publishedAt },
			}),
		];
	});
}

async function query(ctx: SourceContext, searchQuery: string, limit: number): Promise<Candidate[]> {
	const params = new URLSearchParams({
		search_query: searchQuery,
		start: "0",
		max_results: String(limit),
		sortBy: "relevance",
	});
	const { text } = await getText(ctx, `https://export.arxiv.org/api/query?${params}`, PACE);
	return parseArxivFeed(text);
}

/** Letters and digits only: arXiv's query syntax gives meaning to
 *  quotes, parentheses and colons. */
function cleanWords(text: string): string[] {
	return words(text)
		.map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
		.filter(Boolean);
}

export const arxiv: SourceAdapter = {
	id: "arxiv",
	resolves: ["paper"],

	search(stage: SourceQuery, ctx: SourceContext, onError?: (reason: string) => void): Promise<Candidate[]> {
		const limit = Math.max(1, Math.min(20, stage.limit));
		const terms = cleanWords(stage.query).slice(0, MAX_QUERY_WORDS);
		if (terms.length === 0) return Promise.resolve([]);
		return safely("arxiv", onError, () =>
			cached(ctx, `arxiv:search:${limit}:${terms.join(" ")}`, TTL_MS, () =>
				query(ctx, terms.map((t) => `all:${t}`).join(" AND "), limit),
			),
		);
	},

	resolve(item: CanonItem, _stage: SourceQuery, ctx: SourceContext): Promise<Candidate | null> {
		const phrase = item.title.replace(/[^\p{L}\p{N}\s-]/gu, " ").replace(/\s+/g, " ").trim();
		if (!phrase) return Promise.resolve(null);
		return safelyResolve(() =>
			cached(ctx, `arxiv:resolve:${normalizeKey(item.title)}`, TTL_MS, async () => {
				const match = (await query(ctx, `ti:"${phrase}"`, 5)).find((p) => titlesMatch(item.title, p.title));
				return match ? { ...match, canon: true } : null;
			}),
		);
	},
};
