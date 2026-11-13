"use client";
/**
 * SETTINGS → LEARN (docs/learn.md "Spending", "Sources"): the daily
 * spending limit with today's spend, the model Learn uses (the cheap slot
 * unless one is picked here), the YouTube search meter, and one toggle per
 * source with a way to add the key a source needs.
 *
 * LearnSectionView is pure (render-tested); LearnSection fetches
 * GET /api/learn/settings and writes PUT /api/learn/settings.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { LearnSettingsView, ModelCatalogEntry, ModelRef, SourceId } from "@/src/core";
import { MenuShell } from "@/components/menu-shell";
import { useSettingsSaved } from "@/components/settings-signal";
import { formatUsd } from "@/components/learn/format.ts";
import { learnApi, notifyLearnSettingsSaved, type LearnSettingsPatch } from "@/components/learn/learn-api.ts";
import { parseCeiling } from "@/components/learn/spend-dialogs.tsx";
import { CommitInput, SettingsGroup, SettingsRow, Toggle } from "./controls.tsx";
import { ModelMenuList } from "./model-menu.tsx";

const KEY_HINT: Record<string, string> = {
	YOUTUBE_API_KEY: "Needs your YouTube key",
	BRAVE_API_KEY: "Needs your Brave key",
};

function resetTime(iso: string): string {
	const date = new Date(iso);
	return Number.isNaN(date.getTime()) ? "midnight Pacific time" : date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

const smallButton = "h-7 shrink-0 rounded-sm border border-border bg-background px-2 font-ui text-xs text-foreground transition-colors hover:border-muted-foreground/50";

export function LearnSectionView({
	view,
	catalog,
	error,
	onToggleSource,
	onOpenKey,
	onCeilingCommit,
	onPickModel,
	onClearModel,
	onOpenAgent,
}: {
	view: LearnSettingsView;
	/** GET /api/models' list; undefined while it loads. */
	catalog: ModelCatalogEntry[] | undefined;
	error?: string | null;
	onToggleSource: (id: SourceId, on: boolean) => void;
	/** Open Providers at this key's row. */
	onOpenKey: (keyId: string) => void;
	onCeilingCommit: (usd: number) => void;
	onPickModel: (model: ModelRef) => void;
	onClearModel: () => void;
	onOpenAgent: () => void;
}) {
	const [menuOpen, setMenuOpen] = useState(false);
	const anchorRef = useRef<HTMLSpanElement>(null);
	// The settings dropdown contract (agent-section's): an outside click
	// inside the dialog or an Esc closes the menu; Esc is claimed so the
	// dialog behind stays open.
	useEffect(() => {
		if (!menuOpen) return;
		const onPointerDown = (e: PointerEvent) => {
			const target = e.target as Node;
			if (anchorRef.current?.contains(target)) return;
			if (target instanceof Element && target.closest("[data-lh-menu]")) return;
			setMenuOpen(false);
		};
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			e.stopPropagation();
			setMenuOpen(false);
		};
		document.addEventListener("pointerdown", onPointerDown);
		document.addEventListener("keydown", onKeyDown, true);
		return () => {
			document.removeEventListener("pointerdown", onPointerDown);
			document.removeEventListener("keydown", onKeyDown, true);
		};
	}, [menuOpen]);

	const { settings, youtube, model } = view;
	const used = Math.min(youtube.used, youtube.limit);
	const modelLine = model ? `Learn uses ${model.name} (${model.fromSlot ? "your cheap model slot" : "picked here"})` : "No model yet";

	return (
		<div data-testid="learn-settings">
			{error && (
				<p role="alert" className="mb-3 rounded-sm border border-red-500/40 px-3 py-2 text-xs text-red-500">
					{error}
				</p>
			)}
			<SettingsGroup label="Spending" testid="learn-group-spending">
				<SettingsRow
					label="Daily spending limit"
					hint={`Spent today: ${formatUsd(view.spentTodayUsd)}. Calls under the limit run without asking; over it, you are asked first.`}
					testid="learn-ceiling-row"
				>
					<span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
						$
						<CommitInput
							type="number"
							value={settings.dailyCeilingUsd === null ? "" : settings.dailyCeilingUsd.toFixed(2)}
							placeholder="Not set"
							ariaLabel="Daily spending limit in US dollars"
							testid="learn-ceiling"
							onCommit={(text) => {
								const usd = parseCeiling(text);
								if (usd !== null) onCeilingCommit(usd);
							}}
						/>
					</span>
				</SettingsRow>
			</SettingsGroup>

			<SettingsGroup label="Model" testid="learn-group-model">
				<SettingsRow
					label={modelLine}
					hint={model ? "One fast, cheap model writes every roadmap." : "Learn uses your cheap model slot. Pick one in Agent settings, or pick a model here."}
					testid="learn-model-row"
				>
					<span ref={anchorRef} className="relative flex shrink-0 flex-wrap items-center justify-end gap-2">
						{!model && (
							<button type="button" className={smallButton} onClick={onOpenAgent}>
								Agent settings
							</button>
						)}
						{settings.model && (
							<button type="button" className={smallButton} onClick={onClearModel} data-testid="learn-model-clear">
								Use cheap slot
							</button>
						)}
						<button
							type="button"
							aria-label="Learn model"
							aria-expanded={menuOpen}
							data-testid="learn-model-trigger"
							onClick={() => setMenuOpen((open) => !open)}
							className="flex h-7 min-w-24 items-center gap-1 rounded-sm border border-border bg-background px-1.5 font-ui text-xs text-foreground transition-colors hover:border-muted-foreground/50"
						>
							<span className="min-w-0 flex-1 truncate text-left">{model?.name ?? "Pick a model"}</span>
							<span aria-hidden className="text-muted-foreground">
								▾
							</span>
						</button>
						{menuOpen && (
							<MenuShell
								preferredSide="down"
								anchorTestid="learn-model-trigger"
								testid="learn-model-menu"
								menuClass="flex w-[22rem] max-w-[90vw] flex-col rounded-xl border border-border bg-card p-2 text-xs shadow-xl"
							>
								<ModelMenuList
									models={catalog}
									effectiveId={model?.id}
									effectiveProvider={model?.provider}
									onPick={(entry) => {
										onPickModel({ provider: entry.provider, id: entry.id });
										setMenuOpen(false);
									}}
									footer={catalog && catalog.length === 0 ? "No models — add a provider key in Providers" : "Used for every Learn call"}
								/>
							</MenuShell>
						)}
					</span>
				</SettingsRow>
			</SettingsGroup>

			<SettingsGroup label="YouTube searches" testid="learn-group-youtube">
				<div className="flex flex-col gap-1.5 py-1">
					<div
						role="meter"
						aria-label="YouTube searches used today"
						aria-valuemin={0}
						aria-valuemax={youtube.limit}
						aria-valuenow={used}
						className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
					>
						<div className="h-full rounded-full bg-muted-foreground" style={{ width: `${youtube.limit > 0 ? (used / youtube.limit) * 100 : 0}%` }} />
					</div>
					<p className="text-xs text-muted-foreground">
						{youtube.used} of {youtube.limit} searches used today, resets at {resetTime(youtube.resetsAt)}. Each stage uses one search.
					</p>
				</div>
			</SettingsGroup>

			<SettingsGroup label="Sources" testid="learn-group-sources">
				{view.sources.map((source) => {
					const keyHint = !source.available && source.key ? (KEY_HINT[source.key] ?? source.reason) : null;
					return (
						<SettingsRow
							key={source.id}
							label={source.label}
							testid={`learn-source-${source.id}`}
							hint={
								<>
									{source.description}
									{keyHint && <span className="block text-foreground">{keyHint}</span>}
									{!source.available && !source.key && source.reason && <span className="block text-foreground">{source.reason}</span>}
								</>
							}
						>
							<span className="flex shrink-0 items-center gap-2">
								{keyHint && source.key && (
									<button type="button" className={smallButton} onClick={() => onOpenKey(source.key ?? "")}>
										Add key
									</button>
								)}
								<Toggle checked={source.enabled} label={`Use ${source.label}`} onChange={(on) => onToggleSource(source.id, on)} />
							</span>
						</SettingsRow>
					);
				})}
			</SettingsGroup>
		</div>
	);
}

/** `open` is the settings dialog's own section switch (passed in, so this
 *  module does not import the dialog that renders it). */
export function LearnSection({ open }: { open: (section: string, row?: string) => void }) {
	const [view, setView] = useState<LearnSettingsView | null | undefined>(undefined);
	const [catalog, setCatalog] = useState<ModelCatalogEntry[] | undefined>(undefined);
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(async () => {
		const result = await learnApi().settings();
		if (result.kind === "ok") setView(result.data);
		else setView((current) => current ?? null);
	}, []);
	const loadCatalog = useCallback(() => {
		fetch("/api/models", { cache: "no-store" })
			.then((r) => (r.ok ? (r.json() as Promise<{ models: ModelCatalogEntry[] }>) : Promise.reject(new Error(String(r.status)))))
			.then((body) => setCatalog(body.models))
			.catch(() => setCatalog([]));
	}, []);

	useEffect(() => {
		void load();
		loadCatalog();
	}, [load, loadCatalog]);
	// A key or slot saved elsewhere in Settings changes what Learn can use.
	useSettingsSaved((section) => {
		if (section === "keys" || section === "models") {
			void load();
			loadCatalog();
		}
	});

	const save = async (patch: LearnSettingsPatch) => {
		setError(null);
		const result = await learnApi().saveSettings(patch);
		if (result.kind === "ok") {
			setView(result.data);
			notifyLearnSettingsSaved();
		} else {
			setError(result.kind === "error" ? result.error : "That change could not be saved.");
		}
	};

	if (view === undefined) return <p className="text-xs text-muted-foreground/70">Loading Learn settings…</p>;
	if (view === null) {
		return (
			<p className="text-xs text-muted-foreground/70">
				Learn settings could not be loaded.{" "}
				<button type="button" className="underline underline-offset-2" onClick={() => void load()}>
					Try again
				</button>
			</p>
		);
	}
	return (
		<LearnSectionView
			view={view}
			catalog={catalog}
			error={error}
			onToggleSource={(id, on) => void save({ sources: { ...view.settings.sources, [id]: on } })}
			onOpenKey={(keyId) => open("keys", keyId)}
			onCeilingCommit={(usd) => void save({ dailyCeilingUsd: usd })}
			onPickModel={(model) => void save({ model })}
			onClearModel={() => void save({ model: null })}
			onOpenAgent={() => open("agent")}
		/>
	);
}
