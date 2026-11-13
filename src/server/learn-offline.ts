/**
 * THE OFFLINE DEMO (LH_LEARN_OFFLINE_DEMO=1, docs/learn.md "Running it
 * offline"): pi-ai's scripted faux provider stands in for the model and
 * the synthetic fixture network (src/agent/learn/sources/offline-fixtures.ts)
 * for every source, so the whole Learn flow can be clicked through — and
 * screenshotted — with nothing leaving the machine. Synthetic data only.
 */
import { createFauxCore, fauxAssistantMessage } from "@earendil-works/pi-ai";
import type { DepthId } from "../core/learn/contracts.ts";
import { DEPTHS, depthSpec } from "../core/learn/depth.ts";
import type { PiEngine } from "../agent/models.ts";

export function offlineDemoEnabled(env: Record<string, string | undefined> = process.env): boolean {
	return env.LH_LEARN_OFFLINE_DEMO === "1";
}

const STAGE_NAMES = [
	"First steps",
	"Core ideas",
	"Working with it",
	"Common patterns",
	"Going deeper",
	"Tools of the trade",
	"Putting it together",
	"Real projects",
	"Edge cases",
	"Advanced topics",
	"Research frontier",
	"Mastery",
];
const TOPIC_NAMES = ["What it is", "Key words", "A first example", "Why it works", "Doing it by hand", "Common mistakes", "A small exercise", "Checking yourself", "Connecting ideas", "A bigger example", "Speed and care", "Teaching it back"];
const TRACK_NAMES = ["Foundations", "Core skills", "Applications", "Depth", "Specialisation", "Research", "Teaching others", "Capstone"];

function sentence(text: string): string {
	const t = text.trim();
	return t ? t[0]!.toUpperCase() + t.slice(1) : t;
}

function topicLines(topic: string, stageId: string, count: number, minutes: number, prev?: string): string[] {
	return Array.from({ length: count }, (_, i) => {
		const id = `${stageId}t${i + 1}`;
		const prereqs = i > 0 ? [`${stageId}t${i}`] : prev ? [prev] : [];
		const title = `${TOPIC_NAMES[i % TOPIC_NAMES.length]}: ${topic}`;
		return JSON.stringify({ topic: { id, stage: stageId, title, objective: `Explain ${title.toLowerCase()} in your own words.`, minutes, prereqs } });
	});
}

function skeleton(topic: string, depth: DepthId): string {
	const spec = depthSpec(depth);
	const lines = [
		JSON.stringify({
			roadmap: {
				title: `${sentence(topic)}: where to start`,
				level: { label: "Beginner", summary: `New to ${topic}; comfortable learning from videos and short readings.` },
				volatility: "evergreen",
				research: false,
				hours: spec.hours.min,
			},
		}),
	];
	const stagesPerTrack = spec.stagesPerTrack?.min ?? spec.stages.min;
	const tracks = spec.tracks ? Math.min(spec.tracks.min, 4) : 1;
	const stageHours = Math.max(0.5, Math.round((spec.hours.min / (tracks * stagesPerTrack)) * 2) / 2);
	let n = 0;
	let lastTopic: string | undefined;
	for (let k = 0; k < tracks; k++) {
		const trackId = `k${k + 1}`;
		if (spec.tracks) lines.push(JSON.stringify({ track: { id: trackId, title: `${TRACK_NAMES[k]} of ${topic}`, why: `Builds ${TRACK_NAMES[k]!.toLowerCase()} before moving on.` } }));
		for (let s = 0; s < stagesPerTrack; s++) {
			n++;
			const id = `s${n}`;
			const title = `${STAGE_NAMES[(n - 1) % STAGE_NAMES.length]} in ${topic}`;
			lines.push(
				JSON.stringify({
					stage: {
						id,
						track: spec.tracks ? trackId : undefined,
						title,
						why: `Gives you the ${STAGE_NAMES[(n - 1) % STAGE_NAMES.length]!.toLowerCase()} the next stage needs.`,
						hours: stageHours,
						query: `${topic} ${STAGE_NAMES[(n - 1) % STAGE_NAMES.length]!.toLowerCase()}`,
						prereqs: n > 1 ? [`s${n - 1}`] : [],
						// The fixture network echoes any query, so it would "confirm" an
						// invented title; dropping unconfirmed canon is unit-tested instead.
						canon: [{ kind: "video", title: `${topic} ${STAGE_NAMES[(n - 1) % STAGE_NAMES.length]!.toLowerCase()} explained`, by: "Offline Academy" }],
					},
				}),
			);
			if (spec.topicsInSkeleton) {
				const count = spec.topicsPerStage.min + (n % 2);
				lines.push(...topicLines(topic, id, count, Math.round((stageHours * 60) / count), lastTopic));
				lastTopic = `${id}t${count}`;
			}
		}
	}
	return lines.join("\n");
}

function fill(prompt: string, depth: DepthId): string {
	const stage = /Stage (s\d+): ([^—\\]+)/.exec(prompt);
	const topic = /The learner wants to learn: ([^"\\]+)/.exec(prompt)?.[1]?.trim() ?? "the topic";
	const stageId = stage?.[1] ?? "s1";
	const count = depthSpec(depth).topicsPerStage.min;
	const topics = Array.from({ length: count }, (_, i) => {
		const title = `${TOPIC_NAMES[i % TOPIC_NAMES.length]}: ${(stage?.[2] ?? topic).trim().toLowerCase()}`;
		return { id: `${stageId}t${i + 1}`, title, objective: `Explain ${title.toLowerCase()} with one example.`, minutes: 45, prereqs: i > 0 ? [`${stageId}t${i}`] : [] };
	});
	return JSON.stringify({ topics, canon: [{ kind: "book", title: `${sentence(topic)} for beginners` }] });
}

function priming(topic: string): string {
	return JSON.stringify({
		questions: [
			{ question: `How much have you used ${topic} before?`, options: ["Never", "A little, with help", "Regularly on my own"] },
			{ question: `Which of these could you already explain to a friend?`, options: [`What ${topic} is for`, `The main words people use in ${topic}`, `How to solve a typical ${topic} problem`] },
			{ question: "How do you like to learn?", options: ["Short videos", "Reading with examples", "Doing exercises"] },
		],
	});
}

/** A scripted engine that writes believable synthetic roadmaps, slowly
 *  enough (≈150 tokens/s) that streaming is visible on screen. */
export function offlineDemoEngine(): PiEngine {
	const faux = createFauxCore({
		tokensPerSecond: 150,
		models: [{ id: "offline-demo-flash", name: "Offline demo model (faux)", cost: { input: 0.15, output: 0.47, cacheRead: 0, cacheWrite: 0 } }],
	});
	const step = (context: { messages: unknown[] }) => {
		const prompt = JSON.stringify(context.messages);
		const topic = /learn: ([^"\\]+)/.exec(prompt)?.[1]?.trim() ?? "the topic";
		if (prompt.includes("You set a learner's starting level")) return fauxAssistantMessage(priming(topic));
		const label = /[Dd]epth:? (\w+)/.exec(prompt)?.[1] ?? "Normal";
		const depth = DEPTHS.find((d) => d.label === label)?.id ?? "normal";
		if (prompt.includes("You fill one stage")) return fauxAssistantMessage(fill(prompt, depth));
		return fauxAssistantMessage(skeleton(topic, depth));
	};
	// The faux provider consumes one scripted step per call; keep it topped up.
	const refill = () => faux.appendResponses(Array.from({ length: 200 }, () => step));
	refill();
	return {
		model: faux.getModel(),
		streamFn: (model, context, options) => {
			if (faux.state.callCount % 200 === 150) refill();
			return faux.streamSimple(model, context, options);
		},
	};
}
