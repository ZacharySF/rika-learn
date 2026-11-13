"use client";

/**
 * The Learn map: the roadmap drawn as a small galaxy (docs/learn.md
 * "Views"; look from rika-math's stage-3 galaxy and sparkle star). Stage 1
 * is the bright core, later stages spiral outward, each stage is a cluster
 * with its own nebula hue, each topic a star whose look says its status.
 *
 * Geometry is pure (src/core/learn/map-layout.ts); this file only paints it
 * and wires the interaction:
 * - every star is a focusable button (Enter/Space selects, native tooltip);
 * - hovering or selecting a star lights the lines to what it needs and
 *   what it unlocks;
 * - a stage with no topics yet shows a "Load this stage" button;
 * - zoom buttons plus drag-to-pan when zoomed in (big roadmaps get dense);
 * - only background dust twinkles, and not under prefers-reduced-motion.
 */
import { type KeyboardEvent, type PointerEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import {
	layoutStarMap,
	type Roadmap,
	roadmapTopicStatuses,
	STAR_STATUS_LABEL,
	type StageSpot,
	type StarSpot,
	stageLabelText,
	type TopicStatus,
} from "@/src/core";
import { MapLegend, StarGlowFilter, StarGlyph } from "@/components/learn/map-legend";

export interface StarMapProps {
	roadmap: Roadmap;
	selectedTopicId?: string | null;
	onSelectTopic: (topicId: string) => void;
	onOpenStage: (stageId: string) => void;
}

/** Width used before the container is measured (and for SSR). */
const DEFAULT_WIDTH = 960;
const MIN_HEIGHT = 420;
const MAX_HEIGHT = 760;
const ZOOM_STEP = 1.5;
const ZOOM_MAX = 6;
/** Star titles show once two stars sit at least this many pixels apart. */
const STAR_LABEL_UNIT_PX = 40;
const STAR_LABEL_MAX_CHARS = 22;

/** Box height: taller for big roadmaps (their spiral is round, not wide)
 *  and for phone-width iframes (so the spiral has room). */
function boxHeight(width: number, stages: number): number {
	const aspect = width < 560 ? 1.2 : stages > 16 ? 0.85 : 0.66;
	return Math.round(Math.min(Math.max(width * aspect, MIN_HEIGHT), MAX_HEIGHT));
}

/** Star titles point away from their cluster's centre (right-hand stars
 *  label to the right, and so on), so neighbouring labels rarely collide. */
function starLabelSpot(
	star: StarSpot,
	stage: StageSpot | undefined,
	unit: number,
): { x: number; y: number; anchor: "start" | "middle" | "end" } {
	const below = { x: 0, y: star.size * 3.4 + 12, anchor: "middle" as const };
	if (!stage) return below;
	const dx = star.x - stage.x;
	const dy = star.y - stage.y;
	const d = Math.hypot(dx, dy);
	if (d < unit * 0.5) return below;
	const ux = dx / d;
	const uy = dy / d;
	const gap = star.size * 2.6 + 6;
	if (ux > 0.4) return { x: gap, y: uy * gap * 0.6 + 4, anchor: "start" };
	if (ux < -0.4) return { x: -gap, y: uy * gap * 0.6 + 4, anchor: "end" };
	return uy < 0 ? { x: 0, y: -(star.size * 3.4 + 6), anchor: "middle" } : below;
}

function formatHours(hours: number): string {
	return `${Number.isInteger(hours) ? hours : hours.toFixed(1).replace(/\.0$/, "")} h`;
}

const DUST_CSS = `
.lm-twinkle{animation:lm-twinkle 5.5s ease-in-out infinite}
@keyframes lm-twinkle{0%,100%{opacity:1}50%{opacity:.25}}
@media (prefers-reduced-motion: reduce){.lm-twinkle{animation:none}}
`;

interface View {
	zoom: number;
	/** Centre of the visible window, in layout coordinates. */
	cx: number;
	cy: number;
}

function clampView(view: View, width: number, height: number): View {
	const halfW = width / (2 * view.zoom);
	const halfH = height / (2 * view.zoom);
	return {
		zoom: view.zoom,
		cx: Math.min(Math.max(view.cx, halfW), width - halfW),
		cy: Math.min(Math.max(view.cy, halfH), height - halfH),
	};
}

export function StarMap({ roadmap, selectedTopicId, onSelectTopic, onOpenStage }: StarMapProps) {
	const uid = useId().replace(/:/g, "");
	const wrapRef = useRef<HTMLDivElement>(null);
	const svgRef = useRef<SVGSVGElement>(null);
	const [width, setWidth] = useState(DEFAULT_WIDTH);
	const height = boxHeight(width, roadmap.stages.length);
	const [view, setView] = useState<View | null>(null);
	const [hovered, setHovered] = useState<string | null>(null);
	const drag = useRef<{ x: number; y: number; view: View } | null>(null);

	useEffect(() => {
		const el = wrapRef.current;
		if (!el) return;
		const measure = () => {
			const w = Math.round(el.clientWidth);
			if (w > 0) setWidth(w);
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(el);
		return () => observer.disconnect();
	}, []);

	// A new box size resets the view: old coordinates no longer line up.
	useEffect(() => setView(null), [width, height]);

	const layout = useMemo(() => layoutStarMap(roadmap, { width, height }), [roadmap, width, height]);
	const statuses = useMemo(() => roadmapTopicStatuses(roadmap), [roadmap]);
	const titles = useMemo(() => {
		const out = new Map<string, string>();
		for (const stage of roadmap.stages) for (const topic of stage.topics) out.set(topic.id, topic.title);
		return out;
	}, [roadmap]);

	const current = view ?? { zoom: 1, cx: width / 2, cy: height / 2 };
	const vw = width / current.zoom;
	const vh = height / current.zoom;
	const viewBox = `${current.cx - vw / 2} ${current.cy - vh / 2} ${vw} ${vh}`;
	const zoomBy = (factor: number) => {
		const zoom = Math.min(Math.max(current.zoom * factor, 1), ZOOM_MAX);
		setView(zoom === 1 ? null : clampView({ ...current, zoom }, width, height));
	};

	const focusId = hovered ?? selectedTopicId ?? null;
	const showStarLabels = layout.unit * current.zoom >= STAR_LABEL_UNIT_PX;
	const glowId = `lm-glow-${uid}`;
	const blurId = `lm-blur-${uid}`;
	const dense = layout.edges.length > 200;
	const hueOf = useMemo(() => new Map(layout.stars.map((s) => [s.topicId, s.hue])), [layout]);
	const stageById = useMemo(() => new Map(layout.stages.map((st) => [st.id, st])), [layout]);

	const onStarKey = (event: KeyboardEvent, topicId: string) => {
		if (event.key === "Enter" || event.key === " ") {
			event.preventDefault();
			onSelectTopic(topicId);
		}
	};
	const onStageKey = (event: KeyboardEvent, stageId: string) => {
		if (event.key === "Enter" || event.key === " ") {
			event.preventDefault();
			onOpenStage(stageId);
		}
	};

	const onPointerDown = (event: PointerEvent<SVGSVGElement>) => {
		if (current.zoom === 1 || (event.target as Element).closest("[role=button]")) return;
		drag.current = { x: event.clientX, y: event.clientY, view: current };
		event.currentTarget.setPointerCapture(event.pointerId);
	};
	const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
		const start = drag.current;
		const svg = svgRef.current;
		if (!start || !svg) return;
		// screen pixels → layout units at the current zoom
		const k = vw / svg.clientWidth;
		setView(
			clampView(
				{ zoom: start.view.zoom, cx: start.view.cx - (event.clientX - start.x) * k, cy: start.view.cy - (event.clientY - start.y) * k },
				width,
				height,
			),
		);
	};
	const endDrag = () => {
		drag.current = null;
	};

	return (
		<div
			ref={wrapRef}
			className="w-full overflow-hidden rounded-xl border border-border/70"
			style={{ background: "radial-gradient(ellipse at 50% 50%, #1a1824 0%, #111017 45%, #0b0b0f 100%)" }}
			data-testid="learn-star-map"
		>
			<div className="flex items-center justify-between gap-3 px-3 pt-2.5">
				<p className="text-sm text-muted-foreground">
					{current.zoom > 1
						? "Drag the map to move around."
						: "Start at stage 1 in the bright centre and follow the route outward."}
				</p>
				<div className="flex shrink-0 items-center gap-1">
					<button
						type="button"
						aria-label="Zoom in"
						title="Zoom in"
						disabled={current.zoom >= ZOOM_MAX}
						onClick={() => zoomBy(ZOOM_STEP)}
						className="h-8 min-w-8 rounded-md border border-border bg-background/85 px-2 text-lg leading-none text-foreground hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
					>
						+
					</button>
					<button
						type="button"
						aria-label="Zoom out"
						title="Zoom out"
						disabled={current.zoom <= 1}
						onClick={() => zoomBy(1 / ZOOM_STEP)}
						className="h-8 min-w-8 rounded-md border border-border bg-background/85 px-2 text-lg leading-none text-foreground hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
					>
						−
					</button>
					<button
						type="button"
						disabled={current.zoom === 1}
						onClick={() => setView(null)}
						className="h-8 rounded-md border border-border bg-background/85 px-2.5 text-sm text-foreground hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
					>
						Reset view
					</button>
				</div>
			</div>

			<svg
				ref={svgRef}
				role="group"
				aria-label={`Map of ${roadmap.title}: ${roadmap.stages.length} stages`}
				width="100%"
				height={height}
				viewBox={viewBox}
				className={current.zoom > 1 ? "block cursor-grab touch-none select-none active:cursor-grabbing" : "block select-none"}
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={endDrag}
				onPointerCancel={endDrag}
			>
				<defs>
					<style>{DUST_CSS}</style>
					<StarGlowFilter id={glowId} />
					<filter id={blurId} filterUnits="userSpaceOnUse" x={0} y={0} width={width} height={height}>
						<feGaussianBlur stdDeviation={Math.max(layout.unit * 0.5, 6)} />
					</filter>
					{layout.stages.map((st) => (
						<radialGradient key={st.id} id={`lm-neb-${uid}-${st.number}`}>
							<stop offset="0%" stopColor={`hsl(${st.hue} 75% ${st.number === 1 ? 60 : 52}%)`} stopOpacity={st.pending ? 0.12 : st.number === 1 ? 0.42 : 0.3} />
							<stop offset="55%" stopColor={`hsl(${st.hue} 70% 45%)`} stopOpacity={st.pending ? 0.04 : 0.1} />
							<stop offset="100%" stopColor={`hsl(${st.hue} 70% 40%)`} stopOpacity={0} />
						</radialGradient>
					))}
				</defs>

				<g aria-hidden="true">
					{layout.dust.map((d, i) =>
						d.twinkle ? (
							<g key={i} className="lm-twinkle" style={{ animationDelay: `${d.delay}s` }}>
								<circle cx={d.x} cy={d.y} r={d.r} fill="#e8e6f0" fillOpacity={d.opacity} />
							</g>
						) : (
							<circle key={i} cx={d.x} cy={d.y} r={d.r} fill="#e8e6f0" fillOpacity={d.opacity} />
						),
					)}
					{layout.stages.map((st) => (
						<circle key={st.id} cx={st.x} cy={st.y} r={st.radius * (st.number === 1 ? 2.6 : 2.1)} fill={`url(#lm-neb-${uid}-${st.number})`} />
					))}
					{/* the arm haze under the route, then the route itself */}
					{layout.route.map((seg) => (
						<path
							key={`haze-${seg.from}`}
							d={seg.path}
							fill="none"
							stroke={`hsl(${seg.hue} 70% 55%)`}
							strokeOpacity={0.14}
							strokeWidth={Math.max(layout.unit * 1.6, 14)}
							strokeLinecap="round"
							filter={`url(#${blurId})`}
						/>
					))}
					{layout.route.map((seg) => (
						<g key={`route-${seg.from}`}>
							<path d={seg.path} fill="none" stroke={`hsl(${seg.hue} 80% 65%)`} strokeOpacity={0.3} strokeWidth={5} strokeLinecap="round" />
							<path d={seg.path} fill="none" stroke={`hsl(${seg.hue} 85% 78%)`} strokeOpacity={0.75} strokeWidth={1.4} strokeLinecap="round" />
						</g>
					))}
				</g>

				<g aria-hidden="true">
					{layout.edges.map((edge) => {
						const lit = focusId !== null && (edge.from === focusId || edge.to === focusId);
						const hue = hueOf.get(edge.to) ?? 0;
						return (
							<path
								key={`${edge.from}>${edge.to}`}
								d={edge.path}
								fill="none"
								stroke={lit ? `hsl(${hue} 85% 80%)` : "#ffffff"}
								strokeOpacity={lit ? 0.95 : dense ? 0.08 : 0.2}
								strokeWidth={lit ? 1.6 : 1}
								strokeLinecap="round"
							/>
						);
					})}
				</g>

				{layout.stages.map((st) => (
					<StageMarks key={st.id} stage={st} boxWidth={width} onOpenStage={onOpenStage} onKey={onStageKey} />
				))}

				{layout.stars.map((star) => {
					const status: TopicStatus = statuses.get(star.topicId) ?? "ready";
					const title = titles.get(star.topicId) ?? star.topicId;
					const label = `${title} — ${STAR_STATUS_LABEL[status]}`;
					const selected = selectedTopicId === star.topicId;
					const s = star.size;
					const showLabel = showStarLabels || selected || hovered === star.topicId;
					const labelAt = starLabelSpot(star, stageById.get(star.stageId), layout.unit);
					return (
						<g
							key={star.topicId}
							role="button"
							tabIndex={0}
							aria-label={label}
							aria-pressed={selected}
							data-topic-id={star.topicId}
							data-status={status}
							data-selected={selected ? "true" : undefined}
							transform={`translate(${star.x} ${star.y})`}
							className="group cursor-pointer"
							onClick={() => onSelectTopic(star.topicId)}
							onKeyDown={(e) => onStarKey(e, star.topicId)}
							onPointerEnter={() => setHovered(star.topicId)}
							onPointerLeave={() => setHovered((h) => (h === star.topicId ? null : h))}
							onFocus={() => setHovered(star.topicId)}
							onBlur={() => setHovered((h) => (h === star.topicId ? null : h))}
						>
							<title>{label}</title>
							<circle r={Math.max(s * 2.6, 10)} fill="transparent" />
							{selected && (
								<>
									<circle r={s * 3.4} fill="none" stroke="#ffffff" strokeOpacity={0.25} strokeWidth={4} />
									<circle r={s * 3.4} fill="none" stroke="#ffffff" strokeWidth={1.6} />
								</>
							)}
							<circle
								r={s * 3.4 + 3}
								fill="none"
								stroke="var(--ring)"
								strokeWidth={1.5}
								strokeDasharray="3 3"
								className="opacity-0 transition-opacity group-hover:opacity-60 group-focus-visible:opacity-100"
							/>
							<StarGlyph status={status} size={s} hue={star.hue} glowId={glowId} />
							{showLabel && (
								<text
									x={labelAt.x}
									y={labelAt.y}
									textAnchor={labelAt.anchor}
									fontSize={11}
									fill={status === "locked" || status === "skipped" ? "#9a98a6" : "#e4e2ec"}
									stroke="#0b0b0f"
									strokeWidth={3}
									strokeOpacity={0.85}
									paintOrder="stroke"
									className="pointer-events-none"
								>
									{title.length > STAR_LABEL_MAX_CHARS ? `${title.slice(0, STAR_LABEL_MAX_CHARS - 1).trimEnd()}…` : title}
								</text>
							)}
						</g>
					);
				})}
			</svg>

			<div className="px-2 pb-2">
				<MapLegend />
			</div>
		</div>
	);
}

interface StageMarksProps {
	stage: StageSpot;
	/** The load button is kept inside the box even for edge clusters. */
	boxWidth: number;
	onOpenStage: (stageId: string) => void;
	onKey: (event: KeyboardEvent, stageId: string) => void;
}

/** A cluster's number badge, its label, and — while it has no topics — its
 *  outline and load action. */
function StageMarks({ stage: st, boxWidth, onOpenStage, onKey }: StageMarksProps) {
	const badgeX = st.x - st.radius * 0.72;
	const badgeY = st.y - st.radius * 0.72;
	const progress = st.pending ? `${formatHours(st.hours)} · not loaded yet` : `${st.done} of ${st.total} done · ${formatHours(st.hours)}`;
	const canLoad = st.pending && st.fill !== "filling";
	const buttonText = st.fill === "error" ? "Try loading again" : "Load this stage";
	const buttonW = buttonText.length * 6.6 + 24;
	const buttonX = Math.min(Math.max(st.x, buttonW / 2 + 8), boxWidth - buttonW / 2 - 8);
	return (
		<g>
			{st.pending && (
				<circle
					cx={st.x}
					cy={st.y}
					r={st.radius}
					fill="none"
					stroke={`hsl(${st.hue} 30% 70%)`}
					strokeOpacity={0.35}
					strokeWidth={1.2}
					strokeDasharray="4 6"
					aria-hidden="true"
				/>
			)}
			<g aria-hidden="true" data-stage-number={st.number}>
				<circle cx={badgeX} cy={badgeY} r={10} fill="#111016" stroke={`hsl(${st.hue} 70% 68%)`} strokeWidth={1.3} />
				<text x={badgeX} y={badgeY + 4} textAnchor="middle" fontSize={11} fontWeight={600} fill={`hsl(${st.hue} 60% 88%)`}>
					{st.number}
				</text>
				{st.number === 1 && (
					<text
						x={badgeX}
						y={badgeY - 16}
						textAnchor="middle"
						fontSize={11}
						fontWeight={600}
						fill={`hsl(${st.hue} 85% 82%)`}
						stroke="#0b0b0f"
						strokeWidth={3}
						paintOrder="stroke"
					>
						Start here
					</text>
				)}
			</g>
			<text
				x={st.labelX}
				y={st.labelY}
				textAnchor="middle"
				fontSize={10.5}
				fontWeight={600}
				letterSpacing="0.16em"
				fill={`hsl(${st.hue} 45% ${st.pending ? 66 : 84}%)`}
				stroke="#0b0b0f"
				strokeWidth={3}
				strokeOpacity={0.8}
				paintOrder="stroke"
				style={{ textTransform: "uppercase" }}
			>
				<title>{`Stage ${st.number}: ${st.title}`}</title>
				{stageLabelText(st.title)}
			</text>
			<text
				x={st.labelX}
				y={st.labelY + 14}
				textAnchor="middle"
				fontSize={10.5}
				fill="#a3a1ae"
				stroke="#0b0b0f"
				strokeWidth={3}
				strokeOpacity={0.8}
				paintOrder="stroke"
			>
				{progress}
			</text>
			{st.pending && st.fill === "filling" && (
				<text x={st.x} y={st.y + 4} textAnchor="middle" fontSize={12} fill="#c9c7d4">
					Loading topics…
				</text>
			)}
			{canLoad && (
				<g
					role="button"
					tabIndex={0}
					aria-label={`${buttonText}: stage ${st.number}, ${st.title}`}
					data-load-stage={st.id}
					className="group cursor-pointer"
					onClick={() => onOpenStage(st.id)}
					onKeyDown={(e) => onKey(e, st.id)}
				>
					<title>{`Find the topics and resources for stage ${st.number}`}</title>
					<rect
						x={buttonX - buttonW / 2}
						y={st.y - 12}
						width={buttonW}
						height={24}
						rx={12}
						fill={`hsl(${st.hue} 25% 12%)`}
						fillOpacity={0.92}
						stroke={`hsl(${st.hue} 55% 62%)`}
						strokeOpacity={0.8}
						strokeWidth={1.2}
						className="transition-colors group-hover:fill-[#2a2a2a]"
					/>
					<rect
						x={buttonX - buttonW / 2 - 3}
						y={st.y - 15}
						width={buttonW + 6}
						height={30}
						rx={15}
						fill="none"
						stroke="var(--ring)"
						strokeWidth={1.5}
						className="opacity-0 group-focus-visible:opacity-100"
					/>
					<text x={buttonX} y={st.y + 4} textAnchor="middle" fontSize={12} fontWeight={600} fill={`hsl(${st.hue} 45% 88%)`}>
						{buttonText}
					</text>
				</g>
			)}
		</g>
	);
}
