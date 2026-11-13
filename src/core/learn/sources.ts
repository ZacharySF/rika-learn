/**
 * THE SOURCE CATALOGUE (docs/01-learn-design.md q9/q10): every place
 * resources can come from, as the Settings → Learn toggles show them.
 * Pure: the adapters live in src/agent/learn/sources/.
 */
import type { LearnSettings, SourceId } from "./contracts.ts";
import { SOURCE_IDS } from "./contracts.ts";

export interface SourceInfo {
	id: SourceId;
	label: string;
	/** One plain sentence: what it adds. */
	description: string;
	defaultOn: boolean;
	/** The key it needs (an auth.json / env var name), if any. */
	key?: "YOUTUBE_API_KEY" | "BRAVE_API_KEY";
}

export const SOURCE_INFO: readonly SourceInfo[] = [
	{ id: "wikipedia", label: "Wikipedia", description: "Short reference articles that explain each stage.", defaultOn: true },
	{ id: "mitlearn", label: "MIT Learn / OpenCourseWare", description: "University courses and lecture videos.", defaultOn: true },
	{ id: "freecodecamp", label: "freeCodeCamp", description: "Free programming tutorials.", defaultOn: true },
	{ id: "openlibrary", label: "Open Library", description: "Textbooks, for Super depth and deeper.", defaultOn: true },
	{ id: "docs", label: "Official docs", description: "Documentation sites. Only pages robots.txt allows are checked.", defaultOn: true },
	{
		id: "youtube",
		label: "YouTube",
		description: "Videos, with your own YouTube Data API key. One search per stage.",
		defaultOn: true,
		key: "YOUTUBE_API_KEY",
	},
	{ id: "arxiv", label: "arXiv", description: "Research papers, for Ultra depth or research topics.", defaultOn: true },
	{ id: "semanticscholar", label: "Semantic Scholar", description: "Well-cited papers and surveys.", defaultOn: true },
	{ id: "hackernews", label: "Hacker News", description: "Community threads about learning the topic.", defaultOn: true },
	{ id: "awesome", label: "GitHub awesome-lists", description: "Curated link lists and practice repositories.", defaultOn: true },
	{
		id: "brave",
		label: "Brave Search",
		description: "Web search to fill gaps, with your own Brave key. Each search is paid.",
		defaultOn: false,
		key: "BRAVE_API_KEY",
	},
];

export function sourceInfo(id: SourceId): SourceInfo {
	const info = SOURCE_INFO.find((s) => s.id === id);
	if (!info) throw new Error(`unknown source ${id}`);
	return info;
}

/** YouTube's search.list bucket: 100 calls per day per project (since
 *  2026-06-01), resetting at midnight Pacific time. */
export const YOUTUBE_DAILY_SEARCHES = 100;

/** The factory settings: every source at its default, no spending limit
 *  yet (the first model call asks for one), English. */
export function defaultLearnSettings(): LearnSettings {
	const sources = {} as Record<SourceId, boolean>;
	for (const id of SOURCE_IDS) sources[id] = sourceInfo(id).defaultOn;
	return { sources, dailyCeilingUsd: null, language: "en" };
}
