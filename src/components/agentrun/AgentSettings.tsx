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

function SectionIcon({ name }: { name: string }) {
	const ref = useRef<HTMLSpanElement>(null);
	useEffect(() => {
		if (ref.current) setIcon(ref.current, name);
	}, [name]);
	return <span ref={ref} className="agent-settings-section-icon" />;
}

function FilePicker({
	label,
	value,
	plugin,
	onChange,
}: {
	label: string;
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

	// Close on outside click
	useEffect(() => {
		const handler = (e: MouseEvent) => {
			if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
				setOpen(false);
			}
		};
		document.addEventListener("mousedown", handler);
		return () => document.removeEventListener("mousedown", handler);
	}, []);

	return (
		<div className="agent-settings-field" ref={wrapRef}>
			<label className="agent-settings-label">{label}</label>
			<div className="agent-settings-file-picker">
				<input
					className="agent-settings-input"
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
						className="agent-settings-clear clickable-icon"
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
			</div>
			{open && suggestions.length > 0 && (
				<div className="agent-settings-suggestions">
					{suggestions.map((f) => (
						<div
							key={f.path}
							className="agent-settings-suggestion-item"
							onMouseDown={(e) => {
								e.preventDefault();
								setQuery(f.path);
								setSuggestions([]);
								setOpen(false);
								onChange(f.path);
							}}
						>
							{f.basename}
							<span className="agent-settings-suggestion-path">
								{f.parent?.path ?? ""}
							</span>
						</div>
					))}
				</div>
			)}
		</div>
	);
}

function TagList({
	label,
	items,
	placeholder,
	onAdd,
	onRemove,
}: {
	label: string;
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
		<div className="agent-settings-field">
			<label className="agent-settings-label">{label}</label>
			<div className="agent-settings-tag-list">
				{items.map((item) => (
					<span key={item} className="agent-settings-tag">
						{item}
						<button
							className="agent-settings-tag-remove"
							onClick={() => onRemove(item)}
							aria-label={`Remove ${item}`}
						>
							×
						</button>
					</span>
				))}
			</div>
			<div className="agent-settings-tag-input-row">
				<input
					className="agent-settings-input"
					type="text"
					placeholder={placeholder}
					value={input}
					onChange={(e) => setInput(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter") {
							e.preventDefault();
							commit();
						}
					}}
				/>
				<button
					className="agent-settings-add-btn mod-cta"
					onClick={commit}
				>
					Add
				</button>
			</div>
		</div>
	);
}

export function AgentSettings({
	agent,
	plugin,
	onUpdate,
}: AgentSettingsProps) {
	const [name, setName] = useState(agent.name);
	const [schedule, setSchedule] = useState(agent.schedule ?? "");

	// Sync if agent changes externally
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
		<div className="agent-settings-container">
			<div className="agent-settings-header">
				<SectionIcon name="settings" />
				<span>Configuration</span>
			</div>

			{/* Name */}
			<div className="agent-settings-field">
				<label className="agent-settings-label">Name</label>
				<input
					className="agent-settings-input"
					type="text"
					value={name}
					onChange={(e) => setName(e.target.value)}
					onBlur={commitName}
					onKeyDown={(e) => {
						if (e.key === "Enter") {
							(e.target as HTMLInputElement).blur();
						}
					}}
				/>
			</div>

			{/* Instructions */}
			<FilePicker
				label="Instructions"
				value={agent.instructionsPath}
				plugin={plugin}
				onChange={(path) => void onUpdate({ instructionsPath: path })}
			/>

			{/* Tools */}
			<TagList
				label="Tools"
				items={agent.tools}
				placeholder="Tool name…"
				onAdd={(t) => void onUpdate({ tools: [...agent.tools, t] })}
				onRemove={(t) =>
					void onUpdate({ tools: agent.tools.filter((x) => x !== t) })
				}
			/>

			{/* MCPs */}
			<TagList
				label="MCP Servers"
				items={agent.mcps}
				placeholder="MCP server name…"
				onAdd={(m) => void onUpdate({ mcps: [...agent.mcps, m] })}
				onRemove={(m) =>
					void onUpdate({ mcps: agent.mcps.filter((x) => x !== m) })
				}
			/>

			{/* Schedule */}
			<div className="agent-settings-field">
				<label className="agent-settings-label">Schedule</label>
				<input
					className="agent-settings-input"
					type="text"
					placeholder="e.g. 09:00 daily, Monday 08:00"
					value={schedule}
					onChange={(e) => setSchedule(e.target.value)}
					onBlur={commitSchedule}
					onKeyDown={(e) => {
						if (e.key === "Enter") {
							(e.target as HTMLInputElement).blur();
						}
					}}
				/>
				<div className="agent-settings-hint">
					Leave blank to run on demand
				</div>
			</div>
		</div>
	);
}
