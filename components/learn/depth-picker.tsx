"use client";
/**
 * THE DEPTH PICKER (docs/01-learn-design.md q2): five named steps, each
 * showing its time span, Normal preselected. Native radio inputs under the
 * cards, so arrow keys, Tab and screen readers behave as a real radio
 * group without any custom keyboard code.
 */
import { DEPTHS, depthSpec, type DepthId } from "@/src/core";
import { cn } from "@/lib/utils";

function rangeText(range: { min: number; max: number }): string {
	return range.min === range.max ? String(range.min) : `${range.min}–${range.max}`;
}

/** "3–5 stages, about 1.5–3 hours in total." — what a depth means. */
export function depthSummary(id: DepthId): string {
	const spec = depthSpec(id);
	const tracks = spec.tracks ? ` in ${rangeText(spec.tracks)} tracks` : "";
	return `${rangeText(spec.stages)} stages${tracks}, about ${rangeText(spec.hours)} hours in total.`;
}

export function DepthPicker({ value, onChange, disabled }: { value: DepthId; onChange: (depth: DepthId) => void; disabled?: boolean }) {
	return (
		<fieldset className="min-w-0" disabled={disabled}>
			<legend className="mb-2 text-sm text-foreground">How deep should it go?</legend>
			<div role="radiogroup" aria-label="How deep should it go?" className="grid grid-cols-1 gap-2 min-[480px]:grid-cols-5" data-testid="depth-picker">
				{DEPTHS.map((depth, i) => (
					<label
						key={depth.id}
						className={cn(
							"flex cursor-pointer items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5 transition-colors hover:bg-accent min-[480px]:flex-col min-[480px]:items-start min-[480px]:gap-1.5",
							"has-[:checked]:border-primary has-[:checked]:bg-accent has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50",
						)}
					>
						<input
							type="radio"
							name="learn-depth"
							value={depth.id}
							checked={value === depth.id}
							onChange={() => onChange(depth.id)}
							className="sr-only"
						/>
						{/* Growing bars: a glanceable "how much" next to the words. */}
						<span aria-hidden className="flex h-4 items-end gap-0.5">
							{DEPTHS.map((_, bar) => (
								<span key={bar} className={cn("w-1 rounded-sm", bar <= i ? "bg-foreground" : "bg-border")} style={{ height: `${6 + bar * 2.5}px` }} />
							))}
						</span>
						<span className="min-w-0">
							<span className="block font-prose text-base font-semibold text-foreground">{depth.label}</span>
							<span className="block text-xs text-muted-foreground">{depth.span}</span>
						</span>
					</label>
				))}
			</div>
			<p className="mt-2 text-xs text-muted-foreground" aria-live="polite">
				{depthSpec(value).label}: {depthSummary(value)}
			</p>
		</fieldset>
	);
}
