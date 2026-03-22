import * as React from "react";
const { useState, useRef, useEffect, useCallback } = React;
import { setIcon, TFile } from "obsidian";
import type AgentManagerPlugin from "../../plugin";
import type { ManagedAgent } from "../../domain/models/managed-agent";

interface AgentSettingsProps {
	agent: ManagedAgent;
	plugin: AgentManagerPlugin;
	onUpdate: (updates: Partial<ManagedAgent>) => Promise<void>;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function Icon({ name }: { name: string }) {
	const ref = useRef<HTMLSpanElement>(null);
	useEffect(() => {
		if (ref.current) setIcon(ref.current, name);
	}, [name]);
	return <span ref={ref} className="ac-icon" />;
}

// ── Inline file picker ───────────────────────────────────────────────────────

function FilePicker({
	value,
	plugin,
	onChange,
}: {
	value: string | null;
	plugin: AgentManagerPlugin;
	onChange: (path: string | null) => void;
}) {
	const [query, setQuery] = useState(value ?? "");
	const [suggestions, setSuggestions] = useState<TFile[]>([]);
	const [open, setOpen] = useState(false);
	const wrapRef = useRef<HTMLDivElement>(null);

	const search = useCallback(
		(q: string) => {
			if (!q.trim()) {
				setSuggestions([]);
				return;
			}
			const lower = q.toLowerCase();
			const files = plugin.app.vault
				.getMarkdownFiles()
				.filter((f) => f.path.toLowerCase().includes(lower))
				.slice(0, 8);
			setSuggestions(files);
		},
		[plugin],
	);

	useEffect(() => {
		const handler = (e: MouseEvent) => {
			if (wrapRef.current && !wrapRef.current.contains(e.target as Node))
				setOpen(false);
		};
		document.addEventListener("mousedown", handler);
		return () => document.removeEventListener("mousedown", handler);
	}, []);

	return (
		<div className="acs-file-picker" ref={wrapRef}>
			<input
				className="acs-input"
				type="text"
				placeholder="Search vault files…"
				value={query}
				onChange={(e) => {
					setQuery(e.target.value);
					search(e.target.value);
					setOpen(true);
				}}
				onFocus={() => {
					search(query);
					setOpen(true);
				}}
			/>
			{value && (
				<button
					className="acs-clear clickable-icon"
					aria-label="Clear"
					onClick={() => {
						setQuery("");
						setSuggestions([]);
						onChange(null);
					}}
				>
					×
				</button>
			)}
			{open && suggestions.length > 0 && (
				<div className="acs-suggestions">
					{suggestions.map((f) => (
						<div
							key={f.path}
							className="acs-suggestion"
							onMouseDown={(e) => {
								e.preventDefault();
								setQuery(f.path);
								setSuggestions([]);
								setOpen(false);
								onChange(f.path);
							}}
						>
							<span className="acs-suggestion-name">
								{f.basename}
							</span>
							<span className="acs-suggestion-path">
								{f.parent?.path ?? ""}
							</span>
						</div>
					))}
				</div>
			)}
		</div>
	);
}

// ── Tag list (inline) ────────────────────────────────────────────────────────

function TagList({
	items,
	placeholder,
	onAdd,
	onRemove,
}: {
	items: string[];
	placeholder: string;
	onAdd: (item: string) => void;
	onRemove: (item: string) => void;
}) {
	const [input, setInput] = useState("");

	const commit = () => {
		const trimmed = input.trim();
		if (trimmed && !items.includes(trimmed)) {
			onAdd(trimmed);
			setInput("");
		}
	};

	return (
		<div className="acs-tags">
			{items.map((item) => (
				<span key={item} className="acs-tag">
					{item}
					<button
						className="acs-tag-x"
						onClick={() => onRemove(item)}
						aria-label={`Remove ${item}`}
					>
						×
					</button>
				</span>
			))}
			<input
				className="acs-tag-input"
				type="text"
				placeholder={items.length === 0 ? placeholder : ""}
				value={input}
				onChange={(e) => setInput(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Enter") {
						e.preventDefault();
						commit();
					}
				}}
			/>
		</div>
	);
}

// ── Main component ───────────────────────────────────────────────────────────

export function AgentSettings({
	agent,
	plugin,
	onUpdate,
}: AgentSettingsProps) {
	const [name, setName] = useState(agent.name);
	const [schedule, setSchedule] = useState(agent.schedule ?? "");
	const [collapsed, setCollapsed] = useState(false);

	useEffect(() => {
		setName(agent.name);
		setSchedule(agent.schedule ?? "");
	}, [agent.id]);

	const commitName = () => {
		if (name.trim() && name.trim() !== agent.name) {
			void onUpdate({ name: name.trim() });
		}
	};

	const commitSchedule = () => {
		const val = schedule.trim() || null;
		if (val !== agent.schedule) {
			void onUpdate({
				schedule: val,
				status: val ? "scheduled" : "idle",
			});
		}
	};

	return (
		<div className="acs-panel">
			{/* Collapse toggle bar */}
			<div
				className="acs-toggle"
				onClick={() => setCollapsed((v) => !v)}
			>
				<span
					className={`acs-chevron${collapsed ? " is-collapsed" : ""}`}
				>
					<Icon name="chevron-down" />
				</span>
				<Icon name="settings" />
				<span className="acs-toggle-label">Configuration</span>
			</div>

			{!collapsed && (
				<div className="acs-grid">
					{/* Row 1: Name + Schedule */}
					<div className="acs-row">
						<label className="acs-label">Name</label>
						<input
							className="acs-input"
							type="text"
							value={name}
							onChange={(e) => setName(e.target.value)}
							onBlur={commitName}
							onKeyDown={(e) => {
								if (e.key === "Enter")
									(e.target as HTMLInputElement).blur();
							}}
						/>
					</div>
					<div className="acs-row">
						<label className="acs-label">Schedule</label>
						<input
							className="acs-input"
							type="text"
							placeholder="e.g. 09:00 daily"
							value={schedule}
							onChange={(e) => setSchedule(e.target.value)}
							onBlur={commitSchedule}
							onKeyDown={(e) => {
								if (e.key === "Enter")
									(e.target as HTMLInputElement).blur();
							}}
						/>
					</div>

					{/* Row 2: Instructions */}
					<div className="acs-row acs-row--wide">
						<label className="acs-label">Instructions</label>
						<FilePicker
							value={agent.instructionsPath}
							plugin={plugin}
							onChange={(path) =>
								void onUpdate({ instructionsPath: path })
							}
						/>
					</div>

					{/* Row 3: Tools + MCPs */}
					<div className="acs-row">
						<label className="acs-label">Tools</label>
						<TagList
							items={agent.tools}
							placeholder="Add tool…"
							onAdd={(t) =>
								void onUpdate({
									tools: [...agent.tools, t],
								})
							}
							onRemove={(t) =>
								void onUpdate({
									tools: agent.tools.filter(
										(x) => x !== t,
									),
								})
							}
						/>
					</div>
					<div className="acs-row">
						<label className="acs-label">MCPs</label>
						<TagList
							items={agent.mcps}
							placeholder="Add MCP…"
							onAdd={(m) =>
								void onUpdate({
									mcps: [...agent.mcps, m],
								})
							}
							onRemove={(m) =>
								void onUpdate({
									mcps: agent.mcps.filter(
										(x) => x !== m,
									),
								})
							}
						/>
					</div>
				</div>
			)}
		</div>
	);
}
