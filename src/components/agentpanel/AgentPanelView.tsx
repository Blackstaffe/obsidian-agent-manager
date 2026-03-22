import { ItemView, WorkspaceLeaf, setIcon, Menu } from "obsidian";
import * as React from "react";
const { useState, useRef, useEffect } = React;
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

// ── Agent row ────────────────────────────────────────────────────────────────

const STATUS_COLOURS: Record<ManagedAgent["status"], string> = {
	idle: "var(--text-muted)",
	running: "var(--color-green)",
	scheduled: "var(--color-blue)",
};

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

	return (
		<div className="agent-panel-item">
			<div
				className="agent-panel-item-title"
				onClick={() => setExpanded((v) => !v)}
				onDoubleClick={() => onOpen(agent)}
				onContextMenu={handleContextMenu}
			>
				<span className="agent-panel-collapse-icon">
					<IconEl
						name={expanded ? "chevron-down" : "chevron-right"}
					/>
				</span>
				<span className="agent-panel-item-name">{agent.name}</span>
				<span
					className="agent-panel-item-status"
					style={{ color: STATUS_COLOURS[agent.status] }}
				>
					{agent.status}
				</span>
			</div>
			{expanded && (
				<div className="agent-panel-item-detail">
					{agent.instructionsPath
						? `Instructions: ${agent.instructionsPath}`
						: "No instructions set"}
					{agent.schedule && (
						<span className="agent-panel-item-schedule">
							{" · "}
							{agent.schedule}
						</span>
					)}
				</div>
			)}
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

	const onDemand = agents.filter((a) => !a.schedule);
	const scheduled = agents.filter((a) => a.schedule);

	return (
		<div className="agent-panel-container">
			<div className="nav-header">
				<div className="nav-buttons-container">
					<NavButton
						icon="plus"
						label="New agent"
						onClick={onNewAgent}
					/>
				</div>
			</div>
			<div className="agent-panel-list">
				{onDemand.length === 0 && scheduled.length === 0 && (
					<div className="agent-panel-empty">
						No agents yet. Press + to create one.
					</div>
				)}
				{onDemand.map((agent) => (
					<AgentRow
						key={agent.id}
						agent={agent}
						onOpen={onOpenAgent}
						onDelete={onDeleteAgent}
					/>
				))}
				{scheduled.length > 0 && (
					<>
						<div className="agent-panel-section-header">
							Scheduled
						</div>
						{scheduled.map((agent) => (
							<AgentRow
								key={agent.id}
								agent={agent}
								onOpen={onOpenAgent}
								onDelete={onDeleteAgent}
							/>
						))}
					</>
				)}
			</div>
		</div>
	);
}

// ── Obsidian view ────────────────────────────────────────────────────────────

export class AgentPanelView extends ItemView {
	private root: Root | null = null;
	private plugin: AgentManagerPlugin;

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
		const leaf = this.app.workspace.getLeaf("tab");
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
	}

	async onClose() {
		this.root?.unmount();
		this.root = null;
	}
}
