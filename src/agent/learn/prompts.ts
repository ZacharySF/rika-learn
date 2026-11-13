/**
 * LEARN PROMPTS (research/07 §4.2–4.3 "no fluff"). System prompts stay
 * byte-stable (provider prompt caching); the learner's topic goes last in
 * the user message. Kept in code rather than .md so the standalone server
 * trace can never drop them.
 */
import type { DepthId, Roadmap, Stage } from "../../core/learn/contracts.ts";
import { depthSpec } from "../../core/learn/depth.ts";
import { primingSummary } from "../../core/learn/priming.ts";

const RULES = `Rules:
- Output data only. No greeting, no introduction, no closing remark.
- Plain words a newcomer understands; explain no jargon in titles.
- A topic objective is one sentence that starts with a verb and has at most 20 words.
- A "why" has at most 15 words.
- "canon" lists only famous, specific resources you are sure exist (an exact course, book, video series, paper or documentation site). Never invent one; leave canon empty when unsure. Give a "url" only for official documentation you are sure of.
- Canon kinds: video, course, book, paper, docs, reading, exercise, repo.
- Never write any other URL.`;

/** Priming builds on the prober's floor-and-ceiling doctrine. */
export function primingSystemPrompt(proberDoctrine: string): string {
	return `You set a learner's starting level before a learning roadmap is built.

Below is the doctrine LearnHarness's prober uses to measure a learner. Apply its idea — find a floor (something they reliably know) and a ceiling (where it runs out) on the strands the topic depends on — with one big difference: you cannot ask follow-ups. You write at most THREE multiple-choice questions in one go, chosen so their answers bracket the learner's level on the most important strands. Ask about experience and recognition ("Which of these could you already do?"), not trick questions. Each question has 2–4 short options ordered from least to most experience. Do not add a "not sure" option; the app adds it. If the request already makes the level obvious, write fewer questions (even zero).

Answer with one JSON object and nothing else:
{"questions":[{"question":"…","options":["…","…","…"]}]}

--- prober doctrine ---
${proberDoctrine}`;
}

export function primingUserPrompt(topic: string, depth: DepthId): string {
	const spec = depthSpec(depth);
	return `Depth: ${spec.label} (${spec.span} of material).\nThe learner wants to learn: ${topic}`;
}

function range(r: { min: number; max: number }): string {
	return r.min === r.max ? String(r.min) : `${r.min}–${r.max}`;
}

export const SKELETON_SYSTEM = `You design learning roadmaps: where to start and what to learn in which order.

Write the roadmap as JSON Lines: exactly one JSON object per line, nothing else, no code fences. Line types, in this order:
{"roadmap":{"title":"…","level":{"label":"Beginner|Some experience|Intermediate|Advanced","summary":"one sentence on where this learner starts"},"volatility":"evergreen|fast","research":false,"hours":2}}
{"track":{"id":"k1","title":"…","why":"…"}}   (only when tracks are requested)
{"stage":{"id":"s1","track":"k1","title":"…","why":"…","hours":0.5,"query":"search words for one video search","prereqs":[],"canon":[{"kind":"video","title":"…","by":"…"}]}}
{"topic":{"id":"t1","stage":"s1","title":"…","objective":"…","minutes":20,"prereqs":[]}}   (only when topics are requested)

Write each stage line before that stage's topic lines, and stages in learning order. Stage 1, topic 1 must be startable in under 10 minutes: it is the answer to "where do I start?". "prereqs" name ids of EARLIER stages (for stages) or earlier topics (for topics). "query" is 3–8 words that would find one good explainer video for the whole stage. "volatility" is "fast" for tools, frameworks and anything that changes yearly. "research" is true when papers matter for this topic.

${RULES}`;

export function skeletonUserPrompt(roadmap: Pick<Roadmap, "topic" | "depth" | "priming">): string {
	const spec = depthSpec(roadmap.depth);
	const size = spec.tracks
		? `Write ${range(spec.tracks)} tracks with ${range(spec.stagesPerTrack ?? spec.stages)} stages each (${range(spec.stages)} stages in total). Do NOT write topic lines; stages are filled in later.`
		: spec.topicsInSkeleton
			? `Write ${range(spec.stages)} stages. After each stage line write its topic lines: ${range(spec.topicsPerStage)} topics per stage, ${range(spec.topics)} topics in total, minutes adding up to the hours.`
			: `Write ${range(spec.stages)} stages. Do NOT write topic lines; stages are filled in later.`;
	return [
		`Depth: ${spec.label} — ${spec.span} of learning, ${range(spec.hours)} hours in total.`,
		size,
		"",
		"What the learner told us about their level:",
		primingSummary(roadmap.priming),
		"",
		`The learner wants to learn: ${roadmap.topic}`,
	].join("\n");
}

export const FILL_SYSTEM = `You fill one stage of a learning roadmap with topics.

Answer with one JSON object and nothing else:
{"topics":[{"id":"…","title":"…","objective":"…","minutes":30,"prereqs":[]}],"canon":[{"kind":"video","title":"…","by":"…"}]}

Topics are in learning order. "prereqs" name ids of earlier topics in this answer, or ids listed as "already in the roadmap". Minutes add up to the stage's hours.

${RULES}`;

export function fillUserPrompt(roadmap: Roadmap, stage: Stage): string {
	const spec = depthSpec(roadmap.depth);
	const index = roadmap.stages.findIndex((s) => s.id === stage.id);
	const before = roadmap.stages.slice(Math.max(0, index - 2), index);
	const after = roadmap.stages.slice(index + 1, index + 3);
	const known = before.flatMap((s) => s.topics.map((t) => `${t.id}: ${t.title}`)).slice(-24);
	const track = roadmap.tracks.find((t) => t.id === stage.trackId);
	return [
		`Roadmap: ${roadmap.title || roadmap.topic} (depth ${spec.label}, ${spec.span}).`,
		roadmap.level ? `Learner level: ${roadmap.level.label} — ${roadmap.level.summary}` : "",
		track ? `Track: ${track.title}` : "",
		`Earlier stages: ${before.map((s) => s.title).join("; ") || "none"}`,
		`Later stages: ${after.map((s) => s.title).join("; ") || "none"}`,
		known.length > 0 ? `Topics already in the roadmap:\n${known.join("\n")}` : "",
		"",
		`Fill this stage with ${range(spec.topicsPerStage)} topics:`,
		`Stage ${stage.id}: ${stage.title} — ${stage.why} (${stage.hours || "a few"} hours)`,
		"",
		`The learner wants to learn: ${roadmap.topic}`,
	]
		.filter((line) => line !== "")
		.join("\n");
}
