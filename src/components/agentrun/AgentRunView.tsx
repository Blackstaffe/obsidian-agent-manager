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
	view: AgentRunView;
}

function AgentRunComponent({
	plugin,
	agentId,
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
					view={view}
					instructionsPath={agent.instructionsPath}
					agentName={agent.name}
					managedAgentId={agentId}
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

	/** Notification dot element on the tab's birdhouse icon */
	private tabDotEl: HTMLElement | null = null;
	/** Timer for fade-out animation */
	private fadeTimer: ReturnType<typeof setTimeout> | null = null;

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
		// Update dot after agent ID is set
		this.updateTabDot();
	}

	async onOpen() {
		this.root = createRoot(this.containerEl.children[1]);
		this.render();

		// Add notification dot to this tab's birdhouse icon
		const tabIconEl = (
			this.leaf as unknown as {
				tabHeaderInnerIconEl?: HTMLElement;
			}
		).tabHeaderInnerIconEl;
		if (tabIconEl) {
			tabIconEl.addClass("agent-panel-tab-icon-container");
			this.tabDotEl = tabIconEl.createDiv({
				cls: "agent-notification-dot is-hidden",
			});
		}

		// When this leaf gains focus and status is "complete", start fade
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", (leaf) => {
				if (leaf?.view === this) {
					this.tryScheduleFade();
				}
			}),
		);

		// When agent statuses change (e.g. process completes), update dot
		this.registerEvent(
			(
				this.app.workspace as unknown as {
					on: (
						name: string,
						callback: () => void,
					) => ReturnType<typeof this.app.workspace.on>;
				}
			).on(AGENTS_CHANGED_EVENT, () => {
				this.updateTabDot();
				// If already focused and status just became "complete", auto-fade
				if (this.app.workspace.activeLeaf?.view === this) {
					this.tryScheduleFade();
				}
			}),
		);

		this.updateTabDot();
	}

	async onClose() {
		// Process keeps running — AgentProcessManager owns the lifecycle
		this.root?.unmount();
		this.root = null;
		this.tabDotEl?.remove();
		this.tabDotEl = null;
		if (this.fadeTimer) {
			clearTimeout(this.fadeTimer);
			this.fadeTimer = null;
		}
	}

	/**
	 * Called externally (e.g., from AgentPanelView.openAgentRunView)
	 * to acknowledge a "complete" dot when this view is revealed.
	 */
	acknowledgeComplete(): void {
		this.tryScheduleFade();
	}

	render() {
		if (!this.root) return;
		this.root.render(
			<AgentRunComponent
				plugin={this.plugin}
				agentId={this.agentId}
				view={this}
			/>,
		);
	}

	// ── Tab dot management ──────────────────────────────────────────

	private getAgentStatus(): string {
		const agent = this.plugin.settings.managedAgents.find(
			(a) => a.id === this.agentId,
		);
		return agent?.status ?? "idle";
	}

	private updateTabDot(): void {
		if (!this.tabDotEl) return;
		const status = this.getAgentStatus();

		if (status === "running") {
			this.tabDotEl.removeClass("is-hidden", "is-fading", "is-complete");
			this.tabDotEl.addClass("is-running");
		} else if (status === "complete") {
			this.tabDotEl.removeClass("is-hidden", "is-fading", "is-running");
			this.tabDotEl.addClass("is-complete");
		} else if (status === "fading") {
			this.tabDotEl.removeClass("is-hidden", "is-running", "is-complete");
			this.tabDotEl.addClass("is-fading");
		} else {
			this.tabDotEl.addClass("is-hidden");
			this.tabDotEl.removeClass("is-running", "is-complete", "is-fading");
		}
	}

	/**
	 * If the agent status is "complete", start fade → idle transition.
	 */
	private tryScheduleFade(): void {
		const status = this.getAgentStatus();
		if (status !== "complete") return;

		if (this.fadeTimer) clearTimeout(this.fadeTimer);

		// complete → fading (CSS animation) → idle
		this.setAgentStatus("fading");
		this.fadeTimer = setTimeout(() => {
			this.setAgentStatus("idle");
			this.fadeTimer = null;
		}, 1500);
	}

	private setAgentStatus(newStatus: string): void {
		const idx = this.plugin.settings.managedAgents.findIndex(
			(a) => a.id === this.agentId,
		);
		if (idx === -1) return;
		this.plugin.settings.managedAgents[idx] = {
			...this.plugin.settings.managedAgents[idx],
			status: newStatus as ManagedAgent["status"],
		};
		void this.plugin.saveSettings();
		(this.app.workspace as unknown as { trigger: (name: string) => void })
			.trigger(AGENTS_CHANGED_EVENT);
	}
}
