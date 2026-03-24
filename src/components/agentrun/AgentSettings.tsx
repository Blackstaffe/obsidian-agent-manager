import * as React from "react";
const { useState, useRef, useEffect, useCallback } = React;
import { setIcon, TFile, Notice } from "obsidian";
import type AgentManagerPlugin from "../../plugin";
import type { ManagedAgent } from "../../domain/models/managed-agent";
import { AGENT_CATEGORIES } from "../../domain/models/managed-agent";
import type { ProcessStateSnapshot } from "../../domain/models/agent-process";
import type {
	SessionConfigOption,
	SessionConfigSelectGroup,
} from "../../domain/models/session-update";
import { flattenConfigSelectOptions } from "../../shared/config-option-utils";

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
	const [collapsed, setCollapsed] = useState(true);

	// Subscribe to process manager for live session config (modes, models, configOptions)
	const [snapshot, setSnapshot] = useState<ProcessStateSnapshot | null>(
		() => plugin.agentProcessManager.getProcessState(agent.id),
	);

	useEffect(() => {
		const unsub = plugin.agentProcessManager.subscribe(agent.id, setSnapshot);
		return unsub;
	}, [agent.id, plugin.agentProcessManager]);

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
						<label className="acs-label">Category</label>
						<select
							className="acs-input dropdown"
							value={agent.category ?? ""}
							onChange={(e) => {
								const val = e.target.value || null;
								void onUpdate({ category: val as ManagedAgent["category"] });
							}}
						>
							<option value="">Uncategorized</option>
							{AGENT_CATEGORIES.map((cat) => (
								<option key={cat} value={cat}>
									{cat}
								</option>
							))}
						</select>
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
						<div className="acs-instructions-row">
							<FilePicker
								value={agent.instructionsPath}
								plugin={plugin}
								onChange={(path) =>
									void onUpdate({ instructionsPath: path })
								}
							/>
							<button
								className="clickable-icon acs-create-template-btn"
								aria-label="Create new process from template"
								onClick={async () => {
									const templatePath =
										plugin.settings.processTemplatePath;
									if (!templatePath) {
										new Notice(
											"Set a process template path in Agent Manager settings first.",
										);
										return;
									}
									const templateFile =
										plugin.app.vault.getAbstractFileByPath(
											templatePath,
										);
									if (
										!templateFile ||
										!(templateFile instanceof TFile)
									) {
										new Notice(
											`Template not found: ${templatePath}`,
										);
										return;
									}
									const templateContent =
										await plugin.app.vault.read(
											templateFile,
										);
									const folder =
										templateFile.parent?.path ?? "";
									const baseName = `${agent.name} Instructions`;
									let fileName = `${baseName}.md`;
									let counter = 1;
									while (
										plugin.app.vault.getAbstractFileByPath(
											folder
												? `${folder}/${fileName}`
												: fileName,
										)
									) {
										counter++;
										fileName = `${baseName} ${counter}.md`;
									}
									const newPath = folder
										? `${folder}/${fileName}`
										: fileName;
									await plugin.app.vault.create(
										newPath,
										templateContent,
									);
									await onUpdate({
										instructionsPath: newPath,
									});
									new Notice(`Created: ${newPath}`);
								}}
								ref={(el) => {
									if (el) setIcon(el, "plus");
								}}
							/>
						</div>
					</div>

					{/* Row 3: Session config (mode, model, configOptions) */}
					<SessionConfigDropdowns
						snapshot={snapshot}
						plugin={plugin}
						managedAgentId={agent.id}
					/>

					{/* Row 4: Toggles */}
					<div className="acs-row">
						<label className="acs-label">Hide tool calls</label>
						<div
							className={`checkbox-container${agent.hideToolCalls ? " is-enabled" : ""}`}
							onClick={() =>
								void onUpdate({
									hideToolCalls: !agent.hideToolCalls,
								})
							}
						/>
					</div>
					<div className="acs-row">
						<label className="acs-label">Hide thinking</label>
						<div
							className={`checkbox-container${agent.hideThoughts ? " is-enabled" : ""}`}
							onClick={() =>
								void onUpdate({
									hideThoughts: !agent.hideThoughts,
								})
							}
						/>
					</div>
				</div>
			)}
		</div>
	);
}

// ── Session config dropdowns ─────────────────────────────────────────────────

function SessionConfigDropdowns({
	snapshot,
	plugin,
	managedAgentId,
}: {
	snapshot: ProcessStateSnapshot | null;
	plugin: AgentManagerPlugin;
	managedAgentId: string;
}) {
	const info = snapshot?.sessionInfo;
	if (!info || info.state !== "ready") return null;

	const adapter = plugin.agentProcessManager.getAdapter(managedAgentId);
	const sessionId = info.sessionId;
	if (!adapter || !sessionId) return null;

	// Prefer configOptions (new API) over legacy modes/models
	if (info.configOptions && info.configOptions.length > 0) {
		return (
			<>
				{info.configOptions.map((option) => (
					<ConfigOptionRow
						key={option.id}
						option={option}
						onChange={(value) =>
							void adapter.setSessionConfigOption(
								sessionId,
								option.id,
								value,
							)
						}
					/>
				))}
			</>
		);
	}

	// Legacy mode/model selectors
	return (
		<>
			{info.modes && info.modes.availableModes.length > 1 && (
				<div className="acs-row">
					<label className="acs-label">Mode</label>
					<select
						className="acs-input dropdown"
						value={info.modes.currentModeId}
						onChange={(e) =>
							void adapter.setSessionMode(sessionId, e.target.value)
						}
					>
						{info.modes.availableModes.map((m) => (
							<option key={m.id} value={m.id}>
								{m.name}
							</option>
						))}
					</select>
				</div>
			)}
			{info.models && info.models.availableModels.length > 1 && (
				<div className="acs-row">
					<label className="acs-label">Model</label>
					<select
						className="acs-input dropdown"
						value={info.models.currentModelId}
						onChange={(e) =>
							void adapter.setSessionModel(sessionId, e.target.value)
						}
					>
						{info.models.availableModels.map((m) => (
							<option key={m.modelId} value={m.modelId}>
								{m.name}
							</option>
						))}
					</select>
				</div>
			)}
		</>
	);
}

// ── Single config option row ─────────────────────────────────────────────────

function ConfigOptionRow({
	option,
	onChange,
}: {
	option: SessionConfigOption;
	onChange: (value: string) => void;
}) {
	const flatOptions = flattenConfigSelectOptions(option.options);
	if (flatOptions.length <= 1) return null;

	const isGrouped =
		option.options.length > 0 && "group" in option.options[0];

	return (
		<div className="acs-row">
			<label className="acs-label">{option.name}</label>
			<select
				className="acs-input dropdown"
				value={option.currentValue}
				title={option.description ?? option.name}
				onChange={(e) => onChange(e.target.value)}
			>
				{isGrouped
					? (option.options as SessionConfigSelectGroup[]).map(
							(group) =>
								group.options.map((opt) => (
									<option
										key={opt.value}
										value={opt.value}
									>
										{group.name} / {opt.name}
									</option>
								)),
						)
					: flatOptions.map((opt) => (
							<option key={opt.value} value={opt.value}>
								{opt.name}
							</option>
						))}
			</select>
		</div>
	);
}
