/**
 * MIT LEARN / OPENCOURSEWARE (research/07 §2.1): the learning-resources
 * search on api.learn.mit.edu. Free courses become course resources; OCW
 * lecture videos carry their YouTube id in `readable_id`, so they become
 * embeddable video picks without spending YouTube search quota. The API
 * is undocumented, so it is asked at most once a second.
 */
import type { Candidate, CanonItem } from "../../../core/learn/contracts.ts";
import {
	DAY_MS,
	ParseError,
	asArray,
	asNumber,
	asRecord,
	asString,
	cached,
	candidate,
	clip,
	getJson,
	httpUrl,
	isoDurationSeconds,
	minutesOf,
	normalizeKey,
	plainText,
	safely,
	safelyResolve,
	titlesMatch,
} from "./http.ts";
import type { SourceAdapter, SourceContext, SourceQuery } from "./types.ts";

const ENDPOINT = "https://api.learn.mit.edu/api/v1/learning_resources_search/";
const TTL_MS = 7 * DAY_MS;
const PACE = { minIntervalMs: 1000 };
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
/** MIT course numbers as written in titles and readable ids: "18.06", "6.0001", "18.06SC". */
const COURSE_NUMBER = /\b(\d{1,2}\.[0-9]{2,4}[A-Z]{0,3})\b/i;

interface Found {
	candidate: Candidate;
	readableId: string;
}

function toCandidate(entry: unknown): Found | null {
	const record = asRecord(entry);
	const type = asString(record?.resource_type);
	const title = asString(record?.title);
	const readableId = asString(record?.readable_id) ?? "";
	if (!record || !title) return null;
	const offeredBy = asRecord(record.offered_by);
	const provider = asString(offeredBy?.name);
	const thumbnail = httpUrl(asRecord(record.image)?.url);
	if (type === "video") {
		// Only OCW videos with a YouTube id can be embedded and deduped.
		if (asString(offeredBy?.code) !== "ocw" || !YOUTUBE_ID.test(readableId)) return null;
		return {
			readableId,
			candidate: candidate({
				source: "mitlearn",
				kind: "video",
				title,
				url: `https://www.youtube.com/watch?v=${readableId}`,
				by: provider,
				description: clip(plainText(asString(record.description) ?? "")),
				minutes: minutesOf(isoDurationSeconds(asRecord(record.video)?.duration)),
				thumbnail,
				videoId: readableId,
			}),
		};
	}
	if (type === "course") {
		const url = httpUrl(record.url);
		if (!url) return null;
		const run = asRecord(asArray(record.runs)[0]);
		const instructor = asString(asRecord(asArray(run?.instructors)[0])?.full_name);
		return {
			readableId,
			candidate: candidate({
				source: "mitlearn",
				kind: "course",
				title,
				url,
				by: [provider, instructor].filter(Boolean).join(" · ") || undefined,
				description: clip(plainText(asString(record.description) ?? "")),
				year: asNumber(run?.year),
				thumbnail,
			}),
		};
	}
	return null;
}

async function searchResources(ctx: SourceContext, text: string, types: readonly string[], limit: number): Promise<Found[]> {
	const params = new URLSearchParams({ q: text, limit: String(limit) });
	for (const type of types) params.append("resource_type", type);
	params.set("free", "true");
	const body = asRecord(await getJson(ctx, `${ENDPOINT}?${params}`, PACE));
	if (!body || !Array.isArray(body.results)) throw new ParseError("no results in MIT Learn reply");
	return asArray(body.results).flatMap((entry) => {
		const found = toCandidate(entry);
		return found ? [found] : [];
	});
}

/** How well a readable id carries the course number a title names:
 *  2 = that course ("18.06+spring_2010"), 1 = a variant ("18.06SC+…"),
 *  0 = another course (18.065 is not 18.06). */
function courseNumberFit(number: string, readableId: string): number {
	const id = readableId.toLowerCase();
	if (!id.startsWith(number)) return 0;
	const next = id[number.length] ?? "";
	if (next === "" || next === "+") return 2;
	return /[a-z]/.test(next) ? 1 : 0;
}

/** The search only finds titles: "MIT 18.06 Linear Algebra" → "Linear Algebra". */
function courseName(title: string): string {
	return title
		.replace(COURSE_NUMBER, " ")
		.replace(/\b(MIT|OCW|OpenCourseWare)\b/g, " ")
		.replace(/^[\s:·—–-]+|[\s:·—–-]+$/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

export const mitlearn: SourceAdapter = {
	id: "mitlearn",
	resolves: ["course", "video"],

	search(query: SourceQuery, ctx: SourceContext, onError?: (reason: string) => void): Promise<Candidate[]> {
		const limit = Math.max(1, Math.min(20, query.limit));
		return safely("mitlearn", onError, () =>
			cached(ctx, `mitlearn:search:${limit}:${normalizeKey(query.query)}`, TTL_MS, async () =>
				(await searchResources(ctx, query.query, ["course", "video"], limit)).map((f) => f.candidate),
			),
		);
	},

	resolve(item: CanonItem, _query: SourceQuery, ctx: SourceContext): Promise<Candidate | null> {
		if (item.kind !== "course" && item.kind !== "video") return Promise.resolve(null);
		const kind = item.kind;
		const number = kind === "course" ? COURSE_NUMBER.exec(item.title)?.[1]?.toLowerCase() : undefined;
		const name = courseName(item.title) || item.title;
		return safelyResolve(() =>
			cached(ctx, `mitlearn:resolve:${kind}:${normalizeKey(item.title)}`, TTL_MS, async () => {
				const found = await searchResources(ctx, name, [kind], 10);
				const byNumber = number
					? found
							.map((f) => ({ f, fit: courseNumberFit(number, f.readableId) }))
							.filter((x) => x.fit > 0)
							.sort((a, b) => b.fit - a.fit)[0]?.f
					: undefined;
				const match = byNumber ?? found.find((f) => titlesMatch(name, f.candidate.title));
				return match ? { ...match.candidate, canon: true } : null;
			}),
		);
	},
};
