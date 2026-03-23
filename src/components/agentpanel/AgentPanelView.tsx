import { ItemView, WorkspaceLeaf, setIcon, Menu } from "obsidian";
import * as React from "react";
const { useState, useRef, useEffect, useCallback } = React;
import { createRoot, Root } from "react-dom/client";
import type AgentManagerPlugin from "../../plugin";
import type { ManagedAgent } from "../../domain/models/managed-agent";
import { createManagedAgent } from "../../domain/models/managed-agent";
import { VIEW_TYPE_AGENT_RUN } from "../agentrun/AgentRunView";

export const VIEW_TYPE_AGENT_PANEL = "agent-manager-panel";

/** Custom event name fired whenever the managed agents list changes */
export const AGENTS_CHANGED_EVENT = "agent-manager:agents-changed";

// ── Icon helper ──────────────────────────────────────────────────────────────

function IconEl({ name }: { name: string }) {
	const ref = useRef<HTMLSpanElement>(null);
	useEffect(() => {
		if (ref.current) setIcon(ref.current, name);
	}, [name]);
	return <span ref={ref} className="agent-panel-icon" />;
}

function NavButton({
	icon,
	label,
	onClick,
}: {
	icon: string;
	label: string;
	onClick: () => void;
}) {
	const ref = useRef<HTMLButtonElement>(null);
	useEffect(() => {
		if (ref.current) setIcon(ref.current, icon);
	}, [icon]);
	return (
		<button
			ref={ref}
			className="clickable-icon nav-action-button"
			aria-label={label}
			onClick={onClick}
		/>
	);
}

// ── Status indicator ─────────────────────────────────────────────────────────

function StatusDot({ status }: { status: ManagedAgent["status"] }) {
	if (status === "idle") return null;
	let modifier = "is-complete";
	if (status === "running") modifier = "is-running";
	else if (status === "fading") modifier = "is-fading";
	return <span className={`agent-panel-status-dot ${modifier}`} />;
}

// ── Time formatting ──────────────────────────────────────────────────────────

function formatTimeAgo(ts: number): string {
	const diff = Date.now() - ts;
	const seconds = Math.floor(diff / 1000);
	if (seconds < 60) return "just now";
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	return `${days}d ago`;
}

function formatDuration(ms: number): string {
	const seconds = Math.floor(ms / 1000);
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	const remainSec = seconds % 60;
	if (minutes < 60) return `${minutes}m ${remainSec}s`;
	const hours = Math.floor(minutes / 60);
	const remainMin = minutes % 60;
	return `${hours}h ${remainMin}m`;
}

// ── Agent row ────────────────────────────────────────────────────────────────

function AgentRow({
	agent,
	onOpen,
	onDelete,
}: {
	agent: ManagedAgent;
	onOpen: (agent: ManagedAgent) => void;
	onDelete: (agent: ManagedAgent) => void;
}) {
	const [expanded, setExpanded] = useState(false);

	const handleChevronClick = useCallback(
		(e: React.MouseEvent) => {
			e.stopPropagation();
			setExpanded((v) => !v);
		},
		[],
	);

	const handleContextMenu = (e: React.MouseEvent) => {
		e.preventDefault();
		const menu = new Menu();
		menu.addItem((item) => {
			item.setTitle("Open")
				.setIcon("pencil")
				.onClick(() => onOpen(agent));
		});
		menu.addSeparator();
		menu.addItem((item) => {
			item.setTitle("Delete")
				.setIcon("trash-2")
				.setWarning(true)
				.onClick(() => onDelete(agent));
		});
		menu.showAtMouseEvent(e.nativeEvent);
	};

	const hasQuickview = agent.lastMessagePreview || agent.lastActiveAt;

	return (
		<div className="tree-item agent-panel-item">
			<div
				className="agent-panel-item-title"
				onContextMenu={handleContextMenu}
			>
				<div
					className={`agent-panel-collapse-icon${expanded ? " is-expanded" : ""}`}
					onClick={handleChevronClick}
				>
					<IconEl
						name={expanded ? "chevron-down" : "chevron-right"}
					/>
				</div>
				<span
					className="agent-panel-item-name"
					onClick={() => onOpen(agent)}
				>
					{agent.name}
				</span>
				{agent.schedule && (
					<span className="agent-panel-schedule-icon" title={agent.schedule}>
						<IconEl name="clock" />
					</span>
				)}
				<StatusDot status={agent.status} />
			</div>
			{expanded && (
				<div className="agent-panel-item-detail">
					{hasQuickview ? (
						<div className="agent-panel-quickview">
							{agent.lastMessagePreview && (
								<div className="agent-panel-quickview-message">
									{agent.lastMessagePreview}
								</div>
							)}
							<div className="agent-panel-quickview-meta">
								{agent.lastActiveAt && (
									<span>{formatTimeAgo(agent.lastActiveAt)}</span>
								)}
								{agent.lastRunDuration != null && (
									<span>{formatDuration(agent.lastRunDuration)}</span>
								)}
							</div>
						</div>
					) : (
						<div className="agent-panel-quickview-empty">
							No recent activity
						</div>
					)}
				</div>
			)}
		</div>
	);
}

// ── Category group ────────────────────────────────────────────────────────────

function CategoryGroup({
	category,
	agents,
	onOpen,
	onDelete,
}: {
	category: string;
	agents: ManagedAgent[];
	onOpen: (agent: ManagedAgent) => void;
	onDelete: (agent: ManagedAgent) => void;
}) {
	return (
		<div className="agent-panel-category">
			<div className="agent-panel-category-header">
				{category}
			</div>
			{agents.map((agent) => (
				<AgentRow
					key={agent.id}
					agent={agent}
					onOpen={onOpen}
					onDelete={onDelete}
				/>
			))}
		</div>
	);
}

// ── Panel component ──────────────────────────────────────────────────────────

function AgentPanel({
	plugin,
	onOpenAgent,
	onNewAgent,
	onDeleteAgent,
}: {
	plugin: AgentManagerPlugin;
	onOpenAgent: (agent: ManagedAgent) => void;
	onNewAgent: () => void;
	onDeleteAgent: (agent: ManagedAgent) => void;
}) {
	const [agents, setAgents] = useState<ManagedAgent[]>(
		plugin.settings.managedAgents ?? [],
	);
	const [searchQuery, setSearchQuery] = useState("");
	const [showSearch, setShowSearch] = useState(false);

	// Subscribe to agents-changed events from any source
	useEffect(() => {
		const refresh = () => {
			setAgents([...(plugin.settings.managedAgents ?? [])]);
		};

		const workspace = plugin.app.workspace;
		const eventRef = (
			workspace as unknown as {
				on: (
					name: string,
					callback: () => void,
				) => ReturnType<typeof workspace.on>;
			}
		).on(AGENTS_CHANGED_EVENT, refresh);

		return () => {
			workspace.offref(eventRef);
		};
	}, [plugin]);

	const filtered = searchQuery
		? agents.filter((a) => {
				const q = searchQuery.toLowerCase();
				return (
					a.name.toLowerCase().includes(q) ||
					(a.category?.toLowerCase().includes(q) ?? false)
				);
			})
		: agents;

	// Group agents by category
	const grouped = React.useMemo(() => {
		const map = new Map<string, ManagedAgent[]>();
		for (const agent of filtered) {
			const key = agent.category ?? "Uncategorized";
			if (!map.has(key)) map.set(key, []);
			map.get(key)!.push(agent);
		}
		// Sort category groups: named categories alphabetically, Uncategorized last
		const sorted = [...map.entries()].sort(([a], [b]) => {
			if (a === "Uncategorized") return 1;
			if (b === "Uncategorized") return -1;
			return a.localeCompare(b);
		});
		return sorted;
	}, [filtered]);

	const toggleSearch = useCallback(() => {
		setShowSearch((v) => {
			if (v) setSearchQuery("");
			return !v;
		});
	}, []);

	return (
		<div className="agent-panel-container">
			<div className="nav-header">
				<div className="nav-buttons-container">
					<NavButton
						icon="search"
						label="Search agents"
						onClick={toggleSearch}
					/>
					<NavButton
						icon="plus"
						label="New agent"
						onClick={onNewAgent}
					/>
				</div>
			</div>
			{showSearch && (
				<div className="agent-panel-search">
					<input
						type="text"
						className="agent-panel-search-input"
						placeholder="Filter agents…"
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
						autoFocus
					/>
				</div>
			)}
			<div className="agent-panel-list">
				{grouped.length === 0 && (
					<div className="agent-panel-empty">
						{searchQuery
							? "No matching agents."
							: "No agents yet. Press + to create one."}
					</div>
				)}
				{grouped.map(([category, categoryAgents]) => (
					<CategoryGroup
						key={category}
						category={category}
						agents={categoryAgents}
						onOpen={onOpenAgent}
						onDelete={onDeleteAgent}
					/>
				))}
			</div>
		</div>
	);
}

// ── Obsidian view ────────────────────────────────────────────────────────────

export class AgentPanelView extends ItemView {
	private root: Root | null = null;
	private plugin: AgentManagerPlugin;
	private tabDotEl: HTMLElement | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: AgentManagerPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_AGENT_PANEL;
	}

	getDisplayText(): string {
		return "Agent Manager";
	}

	getIcon(): string {
		return "birdhouse";
	}

	/** Fire the workspace event so the panel refreshes */
	private notifyChanged() {
		(this.app.workspace as unknown as { trigger: (name: string) => void })
			.trigger(AGENTS_CHANGED_EVENT);
	}

	private async openAgentRunView(agent: ManagedAgent) {
		// Try to find an existing AgentRunView leaf showing this agent
		const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_AGENT_RUN)
			.find((l) => (l.view.getState() as { agentId?: string }).agentId === agent.id);
		if (existing) {
			this.app.workspace.revealLeaf(existing);
			return;
		}

		// Reuse the most recently focused leaf (matches Obsidian note-opening behavior)
		const leaf = this.app.workspace.getLeaf(false);
		await leaf.setViewState({
			type: VIEW_TYPE_AGENT_RUN,
			active: true,
			state: { agentId: agent.id },
		});
		this.app.workspace.revealLeaf(leaf);
	}

	private async createAndOpenAgent() {
		const agent = createManagedAgent();
		if (!this.plugin.settings.managedAgents) {
			this.plugin.settings.managedAgents = [];
		}
		this.plugin.settings.managedAgents.push(agent);
		await this.plugin.saveSettings();
		await this.openAgentRunView(agent);
		this.notifyChanged();
	}

	private async deleteAgent(agent: ManagedAgent) {
		this.plugin.settings.managedAgents =
			this.plugin.settings.managedAgents.filter((a) => a.id !== agent.id);
		await this.plugin.saveSettings();
		this.notifyChanged();
	}

	private mount() {
		if (!this.root) return;
		this.root.render(
			<AgentPanel
				plugin={this.plugin}
				onOpenAgent={(a) => void this.openAgentRunView(a)}
				onNewAgent={() => void this.createAndOpenAgent()}
				onDeleteAgent={(a) => void this.deleteAgent(a)}
			/>,
		);
	}

	async onOpen() {
		this.root = createRoot(this.containerEl.children[1]);
		this.mount();

		// Add notification dot to the sidebar tab icon
		const tabIconEl = (
			this.leaf as unknown as {
				tabHeaderInnerIconEl?: HTMLElement;
			}
		).tabHeaderInnerIconEl;
		if (tabIconEl) {
			tabIconEl.addClass("agent-panel-tab-icon-container");
			this.tabDotEl = tabIconEl.createDiv({
				cls: "agent-notification-dot",
			});
			this.updateTabDot();
		}

		// Listen for managed agent status changes to update tab dot
		this.registerEvent(
			(
				this.app.workspace as unknown as {
					on: (
						name: string,
						callback: () => void,
					) => ReturnType<typeof this.app.workspace.on>;
				}
			).on(AGENTS_CHANGED_EVENT, () => this.updateTabDot()),
		);
	}

	async onClose() {
		this.root?.unmount();
		this.root = null;
		this.tabDotEl?.remove();
		this.tabDotEl = null;
	}

	private updateTabDot(): void {
		if (!this.tabDotEl) return;
		const hasComplete = this.plugin.hasManagedAgentNotification;
		const hasFading = this.plugin.hasManagedAgentFading;

		if (hasComplete) {
			this.tabDotEl.removeClass("is-hidden", "is-fading");
		} else if (hasFading) {
			this.tabDotEl.addClass("is-fading");
			this.tabDotEl.removeClass("is-hidden");
		} else {
			this.tabDotEl.addClass("is-hidden");
			this.tabDotEl.removeClass("is-fading");
		}
	}
}
