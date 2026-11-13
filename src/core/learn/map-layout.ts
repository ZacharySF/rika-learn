/**
 * STAR-MAP LAYOUT: where every stage cluster and topic star sits on the
 * Learn map (docs/learn.md "Views"; the look follows rika-math's galaxy,
 * docs/03-star-roadmap-design.md q4/q1 there). Pure and deterministic: no
 * Math.random, no clock — the same roadmap in the same box always lands in
 * the same place, so stars never wander between refetches.
 *
 * The shape:
 * - Stages sit along an Archimedean spiral that starts at the centre of the
 *   box, so stage 1 is the bright core and each later stage is further out
 *   (the journey reads inside → out).
 * - Topics form a sunflower (Vogel) cluster around their stage centre,
 *   prerequisites first, so they sit nearer the core of the cluster than
 *   what depends on them. The sunflower keeps a minimum spacing for free.
 * - Everything is laid out in abstract units (1 unit = the closest two stars
 *   may get), then scaled uniformly into the box. Uniform scaling keeps the
 *   no-overlap guarantee.
 * - Tracks (Ultra, Ultraviolet) give their stages one hue family, so a track
 *   reads as one arm of the galaxy.
 */
import type { Roadmap, Stage, TopicStatus } from "./contracts.ts";
import { depthSpec } from "./depth.ts";

export interface StarMapBox {
	width: number;
	height: number;
}

export interface StageSpot {
	id: string;
	/** 1-based: the order to learn the stages in. */
	number: number;
	title: string;
	x: number;
	y: number;
	/** Cluster outline radius (every star of the stage sits inside it). */
	radius: number;
	/** Hue in degrees for the cluster's nebula and stars. */
	hue: number;
	/** Centre of the label's first line (the stage title). */
	labelX: number;
	labelY: number;
	/** Topics marked done or skipped (the roadmap list counts the same way). */
	done: number;
	total: number;
	hours: number;
	/** No topics loaded yet: drawn as an outline with a "load" action. */
	pending: boolean;
	fill: Stage["fill"];
	/** The stage-number badge, on the cluster's upper-left edge. */
	badgeX: number;
	badgeY: number;
	/** What a stage without topics shows at its centre: a load button, or
	 *  "Loading topics…" while it fills. null once it has topics. */
	action: StageAction | null;
}

export interface StageAction {
	text: string;
	/** false = plain status text ("Loading topics…"), not a button. */
	button: boolean;
	/** Centre of the button. */
	x: number;
	y: number;
	width: number;
	height: number;
}

/** Axis-aligned box in map pixels. */
export interface Rect {
	x0: number;
	y0: number;
	x1: number;
	y1: number;
}

/** Where a star's title sits. `x`, `y` are the text anchor and baseline. */
export interface StarLabel {
	text: string;
	x: number;
	y: number;
	anchor: "start" | "middle" | "end";
	/** No free spot: drawn only on hover, focus or selection. */
	hidden: boolean;
}

export interface StarSpot {
	topicId: string;
	stageId: string;
	x: number;
	y: number;
	/** Core radius; two stars are never closer than the sum of their sizes. */
	size: number;
	hue: number;
	label: StarLabel;
}

export interface EdgePath {
	/** The prerequisite topic id. */
	from: string;
	/** The topic that needs it. */
	to: string;
	/** A soft SVG curve from the prerequisite star to the dependant star. */
	path: string;
}

export interface RouteSegment {
	from: string;
	to: string;
	path: string;
	hue: number;
}

export interface DustMote {
	x: number;
	y: number;
	r: number;
	opacity: number;
	twinkle: boolean;
	/** Twinkle phase offset in seconds, so the dust does not pulse in unison. */
	delay: number;
}

export interface StarMapLayout {
	width: number;
	height: number;
	/** Pixels per layout unit (the closest two stars may get). */
	unit: number;
	/** The spiral's origin: the core of the galaxy, where stage 1 sits. */
	centre: { x: number; y: number };
	/** How much the spiral is widened along x to fill a wide box. "Further
	 *  out" means a larger hypot((x − centre.x) / stretch, y − centre.y). */
	stretch: number;
	stages: StageSpot[];
	stars: StarSpot[];
	edges: EdgePath[];
	/** "Your route": stage 1 → 2 → 3 …, one smooth segment per pair. */
	route: RouteSegment[];
	dust: DustMote[];
}

/** Plain-language status words, shared by the map, its legend and tooltips. */
export const STAR_STATUS_LABEL: Record<TopicStatus, string> = {
	done: "Done",
	learning: "Learning",
	ready: "Ready to start",
	locked: "Waiting on an earlier topic",
	skipped: "Skipped",
};

/** Stage titles longer than this are cut with an ellipsis on the map (the
 *  full title stays in the tooltip); the layout reserves room for it. */
export const STAGE_LABEL_MAX_CHARS = 28;

export function stageLabelText(title: string): string {
	return title.length <= STAGE_LABEL_MAX_CHARS ? title : `${title.slice(0, STAGE_LABEL_MAX_CHARS - 1).trimEnd()}…`;
}

/** Star titles longer than this are cut with an ellipsis on the map. */
export const STAR_LABEL_MAX_CHARS = 22;
/** Star titles are drawn at this size; boxes below are estimated from it. */
export const STAR_LABEL_FONT_PX = 11;
/** Glyph width estimate at 11px (the app's mono face runs 0.6em). */
const STAR_LABEL_CHAR_PX = 6.6;
/** Load-button glyph width estimate at its 12px. */
const ACTION_CHAR_PX = 6.6;

export function starLabelText(title: string): string {
	return title.length <= STAR_LABEL_MAX_CHARS ? title : `${title.slice(0, STAR_LABEL_MAX_CHARS - 1).trimEnd()}…`;
}

/** The box a star label covers (with a hair of breathing room). */
export function starLabelBox(label: Pick<StarLabel, "text" | "x" | "y" | "anchor">): Rect {
	const w = label.text.length * STAR_LABEL_CHAR_PX;
	const x0 = label.anchor === "start" ? label.x : label.anchor === "end" ? label.x - w : label.x - w / 2;
	return { x0: x0 - 2, y0: label.y - 10, x1: x0 + w + 2, y1: label.y + 4 };
}

/** The box a stage label covers: its title line and the progress line. */
export function stageLabelBox(stage: StageSpot): Rect {
	return labelRect(stage, stage.labelY);
}

function overlaps(a: Rect, b: Rect): boolean {
	return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

/** Hues far enough apart that neighbouring stages or tracks never blur
 *  together: rose (the core), teal, amber, violet, blue, green, orange, magenta. */
const PALETTE = [352, 174, 38, 268, 204, 132, 16, 312] as const;
/** Sunflower spacing constant: with it two sunflower spots are ≥ 1 unit apart. */
const SUNFLOWER = 0.66;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
/** Space between two clusters, in units (room for the label under each). */
const CLUSTER_GAP = 2.4;
/** Margin between the outermost star core and the cluster outline, in units. */
const CLUSTER_MARGIN = 0.55;
/** Pixels a stage label takes under its cluster (title + progress line). */
const LABEL_BLOCK_PX = 34;
/** First label baseline below the cluster outline. */
const LABEL_OFFSET_PX = 15;
/** Uppercase, letter-spaced label glyph width estimate at the map's 10.5px. */
const LABEL_CHAR_PX = 8.2;
const PAD_PX = 16;
/** Small roadmaps do not blow up to giant stars. */
const UNIT_MAX_PX = 58;
/** Star cores stop growing here; spikes and glow scale from the core. */
const STAR_MAX_PX = 6.5;
/** How much wider than tall the spiral may get in a wide box. */
const MAX_STRETCH = 1.6;
/** Spiral phases tried when fitting the box. */
const PHASES = 24;

/** FNV-1a: a stable 32-bit seed from a string. */
function hashString(text: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return h >>> 0;
}

/** mulberry32: a small seeded PRNG in [0, 1). */
function seededRandom(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** In-stage topological order: prerequisites before dependants, otherwise
 *  the order the roadmap lists them (cycles keep list order). */
function orderTopics(stage: Stage): string[] {
	const ids = stage.topics.map((t) => t.id);
	const inStage = new Set(ids);
	const placed = new Set<string>();
	const out: string[] = [];
	while (out.length < ids.length) {
		const next = stage.topics.find(
			(t) => !placed.has(t.id) && t.prereqs.every((p) => !inStage.has(p) || placed.has(p) || p === t.id),
		);
		// a cycle: take the first unplaced topic so the loop always ends
		const pick = next ?? stage.topics.find((t) => !placed.has(t.id));
		if (!pick) break;
		placed.add(pick.id);
		out.push(pick.id);
	}
	return out;
}

/** Core radius in units: longer topics are slightly bigger stars. */
function starUnits(minutes: number): number {
	return 0.2 + 0.08 * Math.min(Math.max(minutes / 60, 0), 1.5);
}

function clusterUnits(count: number): number {
	return SUNFLOWER * Math.sqrt(Math.max(count, 1) - 0.5) + CLUSTER_MARGIN + starUnits(90);
}

function stageHues(roadmap: Pick<Roadmap, "stages" | "tracks">): number[] {
	const trackIndex = new Map<string, number>();
	for (const track of roadmap.tracks) trackIndex.set(track.id, trackIndex.size);
	for (const stage of roadmap.stages) {
		if (stage.trackId !== undefined && !trackIndex.has(stage.trackId)) trackIndex.set(stage.trackId, trackIndex.size);
	}
	const grouped = roadmap.stages.some((s) => s.trackId !== undefined);
	if (!grouped) return roadmap.stages.map((_, i) => PALETTE[i % PALETTE.length]!);
	const members = new Map<number, number[]>();
	roadmap.stages.forEach((stage, i) => {
		const t = stage.trackId === undefined ? -1 : trackIndex.get(stage.trackId)!;
		members.set(t, [...(members.get(t) ?? []), i]);
	});
	const hues: number[] = new Array(roadmap.stages.length).fill(0);
	for (const [t, list] of members) {
		// untracked stages in a tracked roadmap share the last palette slot
		const base = PALETTE[(t < 0 ? PALETTE.length - 1 : t) % PALETTE.length]!;
		list.forEach((stageIndex, m) => {
			const offset = list.length > 1 ? (m / (list.length - 1) - 0.5) * 20 : 0;
			hues[stageIndex] = (base + offset + 360) % 360;
		});
	}
	return hues;
}

/** Greedy walk along an Archimedean spiral (r = b·θ, x widened by
 *  `stretch` so the galaxy fills wide boxes): each stage takes the first
 *  spot that clears every earlier cluster. The spiral radius only grows,
 *  so each stage sits further out than the one before; widening only
 *  pushes clusters apart, never together. */
function spiralCentres(radii: number[], stretch: number, phase: number): { x: number; y: number }[] {
	if (radii.length === 0) return [];
	const maxR = Math.max(...radii);
	const loose = radii.length <= 6 ? 1.5 : 1.1;
	const b = ((2 * maxR + CLUSTER_GAP) / (2 * Math.PI)) * loose;
	const out: { x: number; y: number }[] = [{ x: 0, y: 0 }];
	let theta = 0;
	for (let i = 1; i < radii.length; i++) {
		for (;;) {
			theta += 0.01;
			const r = b * theta;
			const x = stretch * r * Math.cos(theta + phase);
			const y = r * Math.sin(theta + phase);
			const clear = out.every((p, j) => Math.hypot(p.x - x, p.y - y) >= radii[i]! + radii[j]! + CLUSTER_GAP);
			if (clear) {
				out.push({ x, y });
				break;
			}
		}
	}
	return out;
}

/** A stage label's box: the title line and the progress line under it. */
function labelRect(st: StageSpot, labelY: number): Rect {
	const half = Math.max(Math.min(st.title.length, STAGE_LABEL_MAX_CHARS) * LABEL_CHAR_PX, 130) / 2;
	return { x0: st.labelX - half, y0: labelY - 11, x1: st.labelX + half, y1: labelY + LABEL_BLOCK_PX - 14 };
}

/** Labels go under their cluster, unless that collides with an earlier
 *  label or another cluster and the spot above is clearer. In stage order,
 *  so early stages (the ones you read first) keep the default spot. */
function placeLabels(stages: StageSpot[], height: number): void {
	const placed: Rect[] = [];
	for (const st of stages) {
		const under = st.labelY;
		const above = r2(st.y - st.radius - LABEL_BLOCK_PX + 6);
		const cost = (labelY: number) => {
			const r = labelRect(st, labelY);
			if (r.y0 < PAD_PX || r.y1 > height) return Number.POSITIVE_INFINITY;
			let c = 0;
			for (const p of placed) if (overlaps(r, p)) c += 2;
			for (const other of stages) {
				if (other === st) continue;
				// nearest point of the rect to the other cluster's centre
				const nx = Math.min(Math.max(other.x, r.x0), r.x1);
				const ny = Math.min(Math.max(other.y, r.y0), r.y1);
				if (Math.hypot(nx - other.x, ny - other.y) < other.radius) c += 1;
			}
			return c;
		};
		const costUnder = cost(under);
		if (costUnder > 0 && cost(above) < costUnder) st.labelY = above;
		placed.push(labelRect(st, st.labelY));
	}
}

/** Everything a star label must not cover: stage labels, badges (and the
 *  "Start here" note on stage 1), stage actions, and every star's ring. */
function labelObstacles(stages: StageSpot[], stars: StarSpot[]): Rect[] {
	const out: Rect[] = stages.map(stageLabelBox);
	for (const st of stages) {
		out.push({ x0: st.badgeX - 11, y0: st.badgeY - 11, x1: st.badgeX + 11, y1: st.badgeY + 11 });
		if (st.number === 1) {
			const half = ("Start here".length * STAR_LABEL_CHAR_PX) / 2;
			out.push({ x0: st.badgeX - half, y0: st.badgeY - 27, x1: st.badgeX + half, y1: st.badgeY - 12 });
		}
		const a = st.action;
		if (a) out.push({ x0: a.x - a.width / 2 - 3, y0: a.y - a.height / 2 - 3, x1: a.x + a.width / 2 + 3, y1: a.y + a.height / 2 + 3 });
	}
	for (const s of stars) {
		const r = Math.max(s.size * 2, 3);
		out.push({ x0: s.x - r, y0: s.y - r, x1: s.x + r, y1: s.y + r });
	}
	return out;
}

/** Star labels try below, above, right, then left of their star and take
 *  the first spot that is inside the box and clear of every obstacle and
 *  every label placed before. In roadmap order, so early topics win. No
 *  free spot: the label keeps the spot below and is marked hidden. */
function placeStarLabels(stars: StarSpot[], stages: StageSpot[], box: StarMapBox): void {
	const blocked = labelObstacles(stages, stars);
	for (const s of stars) {
		const text = s.label.text;
		const v = s.size * 3.4;
		const h = s.size * 2.6 + 5;
		const candidates: StarLabel[] = [
			{ text, x: s.x, y: r2(s.y + v + 11), anchor: "middle", hidden: false },
			{ text, x: s.x, y: r2(s.y - v - 5), anchor: "middle", hidden: false },
			{ text, x: r2(s.x + h), y: r2(s.y + 4), anchor: "start", hidden: false },
			{ text, x: r2(s.x - h), y: r2(s.y + 4), anchor: "end", hidden: false },
		];
		const free = candidates.find((c) => {
			const r = starLabelBox(c);
			if (r.x0 < 0 || r.y0 < 0 || r.x1 > box.width || r.y1 > box.height) return false;
			// the star's own ring sits in `blocked` too; the candidates are offset clear of it
			return blocked.every((b) => !overlaps(r, b));
		});
		s.label = free ?? { ...candidates[0]!, hidden: true };
		if (free) blocked.push(starLabelBox(free));
	}
}

/** Catmull-Rom through the stage centres, as one cubic per pair. */
function routeSegments(stages: StageSpot[]): RouteSegment[] {
	const out: RouteSegment[] = [];
	for (let i = 0; i + 1 < stages.length; i++) {
		const p0 = stages[i - 1] ?? stages[i]!;
		const p1 = stages[i]!;
		const p2 = stages[i + 1]!;
		const p3 = stages[i + 2] ?? p2;
		const c1x = p1.x + (p2.x - p0.x) / 6;
		const c1y = p1.y + (p2.y - p0.y) / 6;
		const c2x = p2.x - (p3.x - p1.x) / 6;
		const c2y = p2.y - (p3.y - p1.y) / 6;
		out.push({
			from: p1.id,
			to: p2.id,
			hue: p1.hue,
			path: `M${p1.x} ${p1.y} C${r2(c1x)} ${r2(c1y)} ${r2(c2x)} ${r2(c2y)} ${p2.x} ${p2.y}`,
		});
	}
	return out;
}

function makeDust(seedText: string, stages: StageSpot[], box: StarMapBox): DustMote[] {
	const rand = seededRandom(hashString(`dust:${seedText}`));
	const count = Math.round(Math.min(Math.max((box.width * box.height) / 2200, 80), 520));
	const out: DustMote[] = [];
	for (let i = 0; i < count; i++) {
		let x = rand() * box.width;
		let y = rand() * box.height;
		// most dust gathers around the clusters, so the arms read as a galaxy
		const anchor = stages.length > 0 && rand() < 0.6 ? stages[Math.floor(rand() * stages.length)] : undefined;
		if (anchor) {
			const angle = rand() * Math.PI * 2;
			const dist = anchor.radius * (0.4 + 1.8 * Math.sqrt(rand()));
			const ax = anchor.x + Math.cos(angle) * dist;
			const ay = anchor.y + Math.sin(angle) * dist;
			if (ax >= 0 && ax <= box.width && ay >= 0 && ay <= box.height) {
				x = ax;
				y = ay;
			}
		}
		const twinkle = rand() < 0.18;
		out.push({
			x: r2(x),
			y: r2(y),
			r: r2(0.4 + rand() * 0.9),
			opacity: r2(0.12 + rand() * 0.45),
			twinkle,
			delay: twinkle ? r2(rand() * 6) : 0,
		});
	}
	return out;
}

export function layoutStarMap(roadmap: Pick<Roadmap, "id" | "depth" | "stages" | "tracks">, box: StarMapBox): StarMapLayout {
	const { width, height } = box;
	const pendingCount = depthSpec(roadmap.depth).topicsPerStage.min;
	const radii = roadmap.stages.map((s) => clusterUnits(s.topics.length > 0 ? s.topics.length : pendingCount));
	const hues = stageHues(roadmap);
	const roomW = width - 2 * PAD_PX;
	const roomH = height - 2 * PAD_PX - LABEL_BLOCK_PX;
	const stretch = r2(Math.min(Math.max(roomW / Math.max(roomH, 1), 1), MAX_STRETCH));

	// Abstract star spots per stage (relative to the cluster centre); each
	// cluster gets its own seeded twist so the sunflowers do not all match.
	const local = roadmap.stages.map((stage) => {
		const twist = seededRandom(hashString(`${roadmap.id}:${stage.id}`))() * Math.PI * 2;
		const byId = new Map(stage.topics.map((t) => [t.id, t]));
		return orderTopics(stage).map((id, k) => {
			const r = SUNFLOWER * Math.sqrt(k + 0.5);
			const a = twist + k * GOLDEN_ANGLE;
			const topic = byId.get(id);
			return { id, title: topic?.title ?? id, dx: r * Math.cos(a), dy: r * Math.sin(a), size: starUnits(topic?.minutes ?? 30) };
		});
	});

	// Try a few spiral phases; keep the one whose bounding box grows largest
	// in this box, then centre that bounding box.
	let best = { scale: -1, centres: [] as { x: number; y: number }[], minX: 0, minY: 0, spanX: 0, spanY: 0 };
	for (let k = 0; k < PHASES; k++) {
		const centres = spiralCentres(radii, stretch, (k / PHASES) * Math.PI * 2);
		let minX = 0;
		let maxX = 0;
		let minY = 0;
		let maxY = 0;
		centres.forEach((p, i) => {
			const r = radii[i]!;
			minX = Math.min(minX, p.x - r);
			maxX = Math.max(maxX, p.x + r);
			minY = Math.min(minY, p.y - r);
			maxY = Math.max(maxY, p.y + r);
		});
		const spanX = maxX - minX;
		const spanY = maxY - minY;
		const scale = Math.min(UNIT_MAX_PX, spanX > 0 ? Math.max(roomW, 0) / spanX : UNIT_MAX_PX, spanY > 0 ? Math.max(roomH, 0) / spanY : UNIT_MAX_PX);
		if (scale > best.scale + 1e-9) best = { scale, centres, minX, minY, spanX, spanY };
	}
	const unit = Math.max(best.scale, 0.01);
	// where the spiral's origin (stage 1) lands in the box
	const ox = PAD_PX + (roomW - unit * best.spanX) / 2 - unit * best.minX;
	const oy = PAD_PX + (roomH - unit * best.spanY) / 2 - unit * best.minY;

	const stages: StageSpot[] = roadmap.stages.map((stage, i) => {
		const p = best.centres[i]!;
		const x = r2(ox + unit * p.x);
		const y = r2(oy + unit * p.y);
		const radius = r2(unit * radii[i]!);
		const halfLabel = (Math.min(stage.title.length, STAGE_LABEL_MAX_CHARS) * LABEL_CHAR_PX) / 2;
		const lo = PAD_PX + halfLabel;
		const hi = width - PAD_PX - halfLabel;
		const labelX = lo <= hi ? Math.min(Math.max(x, lo), hi) : width / 2;
		let done = 0;
		for (const t of stage.topics) if (t.state === "done" || t.state === "skipped") done++;
		const pending = stage.topics.length === 0;
		let action: StageAction | null = null;
		if (pending) {
			const button = stage.fill !== "filling";
			const text = !button ? "Loading topics…" : stage.fill === "error" ? "Try loading again" : "Load this stage";
			const w = text.length * ACTION_CHAR_PX + 24;
			action = { text, button, x: r2(Math.min(Math.max(x, w / 2 + 8), width - w / 2 - 8)), y, width: r2(w), height: 24 };
		}
		return {
			id: stage.id,
			number: i + 1,
			title: stage.title,
			x,
			y,
			radius,
			hue: r2(hues[i]!),
			labelX: r2(labelX),
			labelY: r2(Math.min(y + radius + LABEL_OFFSET_PX, height - PAD_PX)),
			done,
			total: stage.topics.length,
			hours: stage.hours,
			pending,
			fill: stage.fill,
			badgeX: r2(x - radius * 0.72),
			badgeY: r2(y - radius * 0.72),
			action,
		};
	});
	placeLabels(stages, height);

	const stars: StarSpot[] = [];
	stages.forEach((st, i) => {
		for (const spot of local[i]!) {
			stars.push({
				topicId: spot.id,
				stageId: st.id,
				x: r2(st.x + unit * spot.dx),
				y: r2(st.y + unit * spot.dy),
				size: r2(Math.min(unit * spot.size, STAR_MAX_PX)),
				hue: st.hue,
				label: { text: starLabelText(spot.title), x: 0, y: 0, anchor: "middle", hidden: true },
			});
		}
	});
	placeStarLabels(stars, stages, box);

	const at = new Map(stars.map((s) => [s.topicId, s]));
	const edges: EdgePath[] = [];
	for (const stage of roadmap.stages) {
		for (const topic of stage.topics) {
			const to = at.get(topic.id);
			if (!to) continue;
			for (const pre of topic.prereqs) {
				const from = at.get(pre);
				if (!from || pre === topic.id) continue;
				// bow the curve sideways by a fifth of its length, side seeded per edge
				const side = hashString(`${pre}>${topic.id}`) % 2 === 0 ? 1 : -1;
				const mx = (from.x + to.x) / 2;
				const my = (from.y + to.y) / 2;
				const qx = mx - (to.y - from.y) * 0.2 * side;
				const qy = my + (to.x - from.x) * 0.2 * side;
				edges.push({ from: pre, to: topic.id, path: `M${from.x} ${from.y} Q${r2(qx)} ${r2(qy)} ${to.x} ${to.y}` });
			}
		}
	}

	return {
		width,
		height,
		unit: r2(unit),
		centre: { x: r2(ox), y: r2(oy) },
		stretch,
		stages,
		stars,
		edges,
		route: routeSegments(stages),
		dust: makeDust(roadmap.id, stages, box),
	};
}
