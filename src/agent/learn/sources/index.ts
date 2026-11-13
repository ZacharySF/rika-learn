/**
 * Every source adapter by id (docs/learn.md "Sources"). The build runner
 * asks the enabled ones per stage; settings decide which are enabled.
 */
import type { SourceId } from "../../../core/learn/contracts.ts";
import { arxiv } from "./arxiv.ts";
import { awesome } from "./awesome.ts";
import { brave } from "./brave.ts";
import { docs } from "./docs.ts";
import { freecodecamp } from "./freecodecamp.ts";
import { hackernews } from "./hackernews.ts";
import { mitlearn } from "./mitlearn.ts";
import { openlibrary } from "./openlibrary.ts";
import { semanticscholar } from "./semanticscholar.ts";
import type { SourceAdapter } from "./types.ts";
import { wikipedia } from "./wikipedia.ts";
import { youtube } from "./youtube.ts";

export const SOURCE_ADAPTERS: Readonly<Record<SourceId, SourceAdapter>> = {
	wikipedia,
	mitlearn,
	freecodecamp,
	openlibrary,
	docs,
	youtube,
	arxiv,
	semanticscholar,
	hackernews,
	awesome,
	brave,
};

export function adapterFor(id: SourceId): SourceAdapter {
	return SOURCE_ADAPTERS[id];
}

export type { SourceAdapter, SourceCache, SourceContext, SourceQuery, YoutubeQuota } from "./types.ts";
export { QUOTA_REASON, YOUTUBE_CACHE_MAX_AGE_MS } from "./youtube.ts";
