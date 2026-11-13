"use client";

/**
 * The star glyph and the legend that explains it. The glyph lives here (not
 * in star-map.tsx) so the map and the legend draw the very same star — the
 * legend is only honest if its specimens are the real thing — without the
 * two files importing each other.
 *
 * Star looks (rika-math docs/screens/stage3/q1-B.png, the sparkle star):
 * - Waiting on an earlier topic: small dim dot, dotted ring, no glow.
 * - Ready to start: brighter dot, dashed ring, no glow.
 * - Learning: four short spikes, a partly drawn ring, a faint glow.
 * - Done: bright core, four long and four short spikes, solid ring, full glow.
 * - Skipped: a hollow, faded circle struck through — set aside, not done.
 */
import { useId, useState } from "react";
import { STAR_STATUS_LABEL, type TopicStatus } from "@/src/core";

/** A concave four-point sparkle: thin spikes that taper to a point. */
function sparkle(length: number, waist: number): string {
	const L = length;
	const w = waist;
	return `M0 ${-L} Q${w} ${-w} ${L} 0 Q${w} ${w} 0 ${L} Q${-w} ${w} ${-L} 0 Q${-w} ${-w} 0 ${-L}Z`;
}

/** Blur used for star glows; sized per element so small and large stars
 *  get the same softness. Each SVG renders its own copy. */
export function StarGlowFilter({ id }: { id: string }) {
	return (
		<filter id={id} x="-50%" y="-50%" width="200%" height="200%" primitiveUnits="objectBoundingBox">
			<feGaussianBlur stdDeviation="0.14" />
		</filter>
	);
}

export interface StarGlyphProps {
	status: TopicStatus;
	/** Core radius in SVG units. */
	size: number;
	hue: number;
	/** Id of a StarGlowFilter in the same SVG. */
	glowId: string;
}

/** One star, centred on (0, 0). */
export function StarGlyph({ status, size: s, hue, glowId }: StarGlyphProps) {
	const ringWidth = Math.max(0.7, s * 0.16);
	if (status === "skipped") {
		const k = s * 1.5;
		return (
			<g opacity={0.7}>
				<circle r={s * 1.05} fill="none" stroke={`hsl(${hue} 8% 62%)`} strokeWidth={ringWidth} />
				<line x1={-k} y1={k} x2={k} y2={-k} stroke={`hsl(${hue} 8% 62%)`} strokeWidth={ringWidth} strokeLinecap="round" />
			</g>
		);
	}
	if (status === "locked") {
		const r = s * 1.7;
		return (
			<g>
				<circle r={s * 0.55} fill={`hsl(${hue} 10% 66%)`} opacity={0.8} />
				<circle
					r={r}
					fill="none"
					stroke={`hsl(${hue} 10% 70%)`}
					strokeOpacity={0.7}
					strokeWidth={ringWidth}
					strokeLinecap="round"
					strokeDasharray={`0.01 ${((2 * Math.PI * r) / 12).toFixed(2)}`}
				/>
			</g>
		);
	}
	if (status === "ready") {
		const r = s * 1.9;
		const dash = (2 * Math.PI * r) / 10;
		return (
			<g>
				<circle r={s * 0.62} fill={`hsl(${hue} 40% 88%)`} />
				<circle
					r={r}
					fill="none"
					stroke={`hsl(${hue} 60% 78%)`}
					strokeOpacity={0.9}
					strokeWidth={ringWidth}
					strokeDasharray={`${(dash * 0.55).toFixed(2)} ${(dash * 0.45).toFixed(2)}`}
				/>
			</g>
		);
	}
	const ringR = s * 2;
	if (status === "learning") {
		const circ = 2 * Math.PI * ringR;
		return (
			<g>
				<circle r={s * 2.6} fill={`hsl(${hue} 80% 62%)`} opacity={0.4} filter={`url(#${glowId})`} />
				<circle r={ringR} fill="none" stroke={`hsl(${hue} 60% 78%)`} strokeOpacity={0.22} strokeWidth={ringWidth} />
				<circle
					r={ringR}
					fill="none"
					stroke={`hsl(${hue} 75% 78%)`}
					strokeWidth={ringWidth * 1.2}
					strokeLinecap="round"
					strokeDasharray={`${(circ * 0.4).toFixed(2)} ${circ.toFixed(2)}`}
					transform="rotate(-90)"
				/>
				<path d={sparkle(s * 2.7, s * 0.16)} fill={`hsl(${hue} 70% 92%)`} opacity={0.9} />
				<circle r={s * 0.62} fill="#fff" />
			</g>
		);
	}
	return (
		<g>
			<circle r={s * 3.1} fill={`hsl(${hue} 85% 62%)`} opacity={0.55} filter={`url(#${glowId})`} />
			<circle r={ringR} fill="none" stroke={`hsl(${hue} 75% 80%)`} strokeOpacity={0.9} strokeWidth={ringWidth} />
			<path d={sparkle(s * 2.3, s * 0.14)} fill={`hsl(${hue} 70% 90%)`} opacity={0.75} transform="rotate(45)" />
			<path d={sparkle(s * 4.3, s * 0.18)} fill={`hsl(${hue} 60% 95%)`} />
			<circle r={s * 0.82} fill="#fff" />
		</g>
	);
}

/** Legend order: best first, so "Done" reads as the goal. */
const LEGEND_ORDER: readonly TopicStatus[] = ["done", "learning", "ready", "locked", "skipped"];
/** The legend's specimen hue: the core (stage 1) rose. */
const LEGEND_HUE = 352;

function LegendStar({ status }: { status: TopicStatus }) {
	const glowId = `lm-legend-glow-${useId().replace(/:/g, "")}`;
	return (
		<svg width={36} height={36} viewBox="-18 -18 36 36" aria-hidden="true" className="shrink-0">
			<defs>
				<StarGlowFilter id={glowId} />
			</defs>
			<StarGlyph status={status} size={3.6} hue={LEGEND_HUE} glowId={glowId} />
		</svg>
	);
}

export function MapLegend({ defaultOpen = true }: { defaultOpen?: boolean }) {
	const [open, setOpen] = useState(defaultOpen);
	const bodyId = `lm-legend-${useId().replace(/:/g, "")}`;
	return (
		<section
			aria-label="Map legend"
			className="w-full rounded-lg border border-border/70 bg-background/80 px-3 py-2.5 text-foreground backdrop-blur-sm"
		>
			<div className="flex items-center justify-between gap-3">
				<h3 className="text-base font-semibold">How to read the map</h3>
				<button
					type="button"
					aria-expanded={open}
					aria-controls={bodyId}
					onClick={() => setOpen((o) => !o)}
					className="rounded-md border border-border px-2 py-0.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
				>
					{open ? "Hide legend" : "Show legend"}
				</button>
			</div>
			{open && (
				<div id={bodyId} className="mt-1.5">
					<ul className="grid grid-cols-2 gap-x-4 gap-y-0.5 md:flex md:flex-wrap md:gap-x-6">
						{LEGEND_ORDER.map((status) => (
							<li key={status} className="flex items-center gap-2 text-base">
								<LegendStar status={status} />
								<span>{STAR_STATUS_LABEL[status]}</span>
							</li>
						))}
						<li className="flex items-center gap-2 text-base">
							<svg width={32} height={32} viewBox="0 0 32 32" aria-hidden="true" className="shrink-0">
								<path d="M3 24 C 12 22, 18 10, 29 8" fill="none" stroke={`hsl(${LEGEND_HUE} 80% 65%)`} strokeOpacity={0.35} strokeWidth={5} strokeLinecap="round" />
								<path d="M3 24 C 12 22, 18 10, 29 8" fill="none" stroke={`hsl(${LEGEND_HUE} 85% 78%)`} strokeWidth={1.6} strokeLinecap="round" />
							</svg>
							<span>Your route, stage by stage</span>
						</li>
					</ul>
					<p className="mt-1.5 text-sm leading-snug text-muted-foreground">
						Each star is a topic. Each cluster is a stage, numbered in the order to learn them. Lines show what to learn first.
						Click a star to see it and mark your progress.
					</p>
				</div>
			)}
		</section>
	);
}
