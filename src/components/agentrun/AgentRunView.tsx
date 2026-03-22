import { ItemView, WorkspaceLeaf } from "obsidian";
import * as React from "react";
import { createRoot, Root } from "react-dom/client";
import type AgentManagerPlugin from "../../plugin";
import type { ManagedAgent } from "../../domain/models/managed-agent";
import { AGENTS_CHANGED_EVENT } from "../agentpanel/AgentPanelView";
import { AgentSettings } from "./AgentSettings";
import { AgentRunChat } from "./AgentRunChat";

export const VIEW_TYPE_AGENT_RUN = "agent-manager-run";

interface AgentRunComponentProps {
	plugin: AgentManagerPlugin;
	agentId: string;
	viewId: string;
	view: AgentRunView;
}

function AgentRunComponent({
	plugin,
	agentId,
	viewId,
	view,
}: AgentRunComponentProps) {
	const [agent, setAgent] = React.useState<ManagedAgent | null>(null);

	// Load agent from plugin settings
	React.useEffect(() => {
		const found = plugin.settings.managedAgents.find(
			(a) => a.id === agentId,
		);
		setAgent(found ?? null);
	}, [agentId, plugin.settings.managedAgents]);

	const handleUpdate = React.useCallback(
		async (updates: Partial<ManagedAgent>) => {
			const idx = plugin.settings.managedAgents.findIndex(
				(a) => a.id === agentId,
			);
			if (idx === -1) return;
			const updated = {
				...plugin.settings.managedAgents[idx],
				...updates,
			};
			plugin.settings.managedAgents[idx] = updated;
			await plugin.saveSettings();
			setAgent(updated);
			// Notify the panel to refresh
			(plugin.app.workspace as unknown as { trigger: (name: string) => void })
				.trigger(AGENTS_CHANGED_EVENT);
		},
		[agentId, plugin],
	);

	if (!agent) {
		return <div className="agent-run-empty">Agent not found.</div>;
	}

	return (
		<div className="agent-run-container agent-run-container--stacked">
			<AgentSettings
				agent={agent}
				plugin={plugin}
				onUpdate={handleUpdate}
			/>
			<div className="agent-run-chat-pane">
				<AgentRunChat
					plugin={plugin}
					viewId={viewId}
					view={view}
					instructionsPath={agent.instructionsPath}
					agentName={agent.name}
				/>
			</div>
		</div>
	);
}

export class AgentRunView extends ItemView {
	private root: Root | null = null;
	private plugin: AgentManagerPlugin;
	private agentId = "";
	readonly viewId: string;

	constructor(leaf: WorkspaceLeaf, plugin: AgentManagerPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.viewId = (leaf as { id?: string }).id ?? crypto.randomUUID();
	}

	getViewType(): string {
		return VIEW_TYPE_AGENT_RUN;
	}

	getDisplayText(): string {
		const agent = this.plugin.settings.managedAgents.find(
			(a) => a.id === this.agentId,
		);
		return agent?.name ?? "Agent";
	}

	getIcon(): string {
		return "birdhouse";
	}

	getState(): Record<string, unknown> {
		return { agentId: this.agentId };
	}

	async setState(
		state: Record<string, unknown>,
		result: { history: boolean },
	): Promise<void> {
		if (typeof state?.agentId === "string") {
			this.agentId = state.agentId;
		}
		await super.setState(state, result);
		this.render();
	}

	async onOpen() {
		this.root = createRoot(this.containerEl.children[1]);
		this.render();
	}

	async onClose() {
		// Clean up ACP adapter for this view
		await this.plugin.removeAdapter(this.viewId);
		this.root?.unmount();
		this.root = null;
	}

	render() {
		if (!this.root) return;
		this.root.render(
			<AgentRunComponent
				plugin={this.plugin}
				agentId={this.agentId}
				viewId={this.viewId}
				view={this}
			/>,
		);
	}
}
