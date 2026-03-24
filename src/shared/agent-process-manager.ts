/**
 * AgentProcessManager — plugin-level service that owns managed agent processes.
 *
 * Processes are keyed by `managedAgentId` (the UUID in plugin.settings.managedAgents)
 * and survive UI tab open/close cycles. React hooks subscribe to get state updates.
 */

import { FileSystemAdapter } from "obsidian";

import type AgentManagerPlugin from "../plugin";
import type {
	AgentProcessState,
	ProcessStateSnapshot,
	PendingPermission,
} from "../domain/models/agent-process";
import type { ManagedAgentStatus } from "../domain/models/managed-agent";
import type { ChatMessage } from "../domain/models/chat-message";
import type { SessionUpdate } from "../domain/models/session-update";
import { AcpAdapter } from "../adapters/acp/acp.adapter";
import { applySessionUpdate } from "./message-mutations";
import { findAgentSettings, buildAgentConfigWithApiKey } from "./settings-utils";
import { ChatExporter } from "./chat-exporter";
import { AGENTS_CHANGED_EVENT } from "../components/agentpanel/AgentPanelView";
import { getLogger } from "./logger";

// ============================================================================
// Types
// ============================================================================

type Listener = (state: ProcessStateSnapshot) => void;

// ============================================================================
// AgentProcessManager
// ============================================================================

export class AgentProcessManager {
	private processes = new Map<string, AgentProcessState>();
	private adapters = new Map<string, AcpAdapter>();
	private logger = getLogger();

	constructor(private plugin: AgentManagerPlugin) {}

	// ── Public API ─────────────────────────────────────────────────────────

	/**
	 * Start the agent process for a managed agent.
	 * No-op if the process is already initialized and running.
	 */
	async startProcess(managedAgentId: string): Promise<void> {
		// Guard: already running
		const existing = this.adapters.get(managedAgentId);
		if (existing?.isInitialized()) {
			this.logger.log(
				`[AgentProcessManager] Process already running for ${managedAgentId}`,
			);
			return;
		}

		const state = this.getOrCreateState(managedAgentId);
		state.sessionInfo.state = "initializing";
		this.notifyListeners(managedAgentId);

		const settings = this.plugin.settings;
		const agentId = settings.defaultAgentId || settings.claude.id;
		const agentDisplayName =
			[
				settings.claude,
				settings.codex,
				settings.gemini,
				...settings.customAgents,
			].find((a) => a.id === agentId)?.displayName ?? agentId;

		state.sessionInfo.agentId = agentId;
		state.sessionInfo.agentDisplayName = agentDisplayName;

		const agentSettings = findAgentSettings(settings, agentId);
		if (!agentSettings) {
			state.sessionInfo.state = "error";
			this.notifyListeners(managedAgentId);
			throw new Error(
				`Agent "${agentId}" not found in settings. Configure the agent command first.`,
			);
		}

		const workingDirectory = this.getVaultPath();
		state.sessionInfo.workingDirectory = workingDirectory;

		const agentConfig = buildAgentConfigWithApiKey(
			settings,
			agentSettings,
			agentId,
			workingDirectory,
		);

		// Create adapter and register update callback before initializing
		const adapter = new AcpAdapter(this.plugin);
		this.adapters.set(managedAgentId, adapter);

		adapter.onSessionUpdate((update: SessionUpdate) => {
			this.onSessionUpdate(managedAgentId, update);
		});

		try {
			const initResult = await adapter.initialize(agentConfig);
			state.sessionInfo.authMethods = initResult.authMethods;
			state.sessionInfo.promptCapabilities = initResult.promptCapabilities;
			state.sessionInfo.agentCapabilities = initResult.agentCapabilities;

			const sessionResult = await adapter.newSession(workingDirectory);
			state.sessionInfo.sessionId = sessionResult.sessionId;
			state.sessionInfo.modes = sessionResult.modes;
			state.sessionInfo.models = sessionResult.models;
			state.sessionInfo.configOptions = sessionResult.configOptions;
			state.sessionInfo.state = "ready";

			this.logger.log(
				`[AgentProcessManager] Process started for ${managedAgentId}, session ${sessionResult.sessionId}`,
			);
		} catch (err) {
			state.sessionInfo.state = "error";
			this.adapters.delete(managedAgentId);
			this.notifyListeners(managedAgentId);
			throw err;
		}

		this.notifyListeners(managedAgentId);
	}

	/**
	 * Stop the agent process for a managed agent.
	 * Disconnects the adapter, updates status to idle, and removes state.
	 */
	async stopProcess(managedAgentId: string): Promise<void> {
		const state = this.processes.get(managedAgentId);

		// Auto-export chat on process stop (if enabled and there are messages)
		if (state && state.messages.length > 0) {
			await this.autoExportIfEnabled(managedAgentId, state);
		}

		const adapter = this.adapters.get(managedAgentId);
		if (adapter) {
			try {
				await adapter.disconnect();
			} catch (err) {
				this.logger.warn(
					`[AgentProcessManager] Error disconnecting ${managedAgentId}:`,
					err,
				);
			}
			this.adapters.delete(managedAgentId);
		}

		if (state) {
			state.isSending = false;
			state.sessionInfo.state = "disconnected";
			state.sessionInfo.sessionId = null;
			this.notifyListeners(managedAgentId);
		}

		await this.updateManagedAgentStatus(managedAgentId, "idle");
	}

	/**
	 * Stop all running processes. Called on plugin unload / Obsidian quit.
	 */
	async stopAll(): Promise<void> {
		const ids = [...this.adapters.keys()];
		await Promise.allSettled(ids.map((id) => this.stopProcess(id)));
	}

	/**
	 * Whether a process is currently initialized for this agent.
	 */
	isRunning(managedAgentId: string): boolean {
		return this.adapters.get(managedAgentId)?.isInitialized() ?? false;
	}

	/**
	 * Get a snapshot of the current process state (without mutable listeners).
	 * Returns null if no state exists for this agent.
	 */
	getProcessState(managedAgentId: string): ProcessStateSnapshot | null {
		const state = this.processes.get(managedAgentId);
		if (!state) return null;
		const { listeners, ...snapshot } = state;
		return { ...snapshot, messages: [...state.messages] };
	}

	/**
	 * Get the AcpAdapter for a managed agent (needed by usePermission / ChatMessages).
	 */
	getAdapter(managedAgentId: string): AcpAdapter | null {
		return this.adapters.get(managedAgentId) ?? null;
	}

	/**
	 * Subscribe to process state changes.
	 * The listener is called immediately with the current snapshot if state exists.
	 * Returns an unsubscribe function — calling it does NOT stop the process.
	 */
	subscribe(managedAgentId: string, listener: Listener): () => void {
		const state = this.getOrCreateState(managedAgentId);
		state.listeners.add(listener);

		// Emit current snapshot immediately so subscriber can hydrate
		const snapshot = this.getProcessState(managedAgentId);
		if (snapshot) {
			listener(snapshot);
		}

		return () => {
			state.listeners.delete(listener);
		};
	}

	/**
	 * Send a message through the process's adapter.
	 * Manages isSending flag and status dot transitions.
	 * `userMessage` is added to the buffer immediately for UI display.
	 */
	async sendMessage(
		managedAgentId: string,
		sessionId: string,
		content: import("../domain/models/prompt-content").PromptContent[],
		userMessage: ChatMessage,
	): Promise<void> {
		const adapter = this.adapters.get(managedAgentId);
		const state = this.processes.get(managedAgentId);
		if (!adapter || !state) {
			throw new Error(`No running process for agent ${managedAgentId}`);
		}

		// Add user message to buffer immediately
		state.messages = [...state.messages, userMessage];
		state.isSending = true;
		state.runStartedAt = state.runStartedAt ?? Date.now();
		this.notifyListeners(managedAgentId);
		await this.updateManagedAgentStatus(managedAgentId, "running");

		try {
			await adapter.sendPrompt(sessionId, content);
		} finally {
			state.isSending = false;
			const duration = state.runStartedAt
				? Date.now() - state.runStartedAt
				: 0;
			state.runStartedAt = null;

			const preview = extractLastAssistantPreview(state.messages);
			await this.updateManagedAgentStatus(managedAgentId, "complete", {
				lastActiveAt: Date.now(),
				lastRunDuration: duration,
				lastMessagePreview: preview,
			});
			this.notifyListeners(managedAgentId);

			// Save session messages to disk (works even with no UI tab open)
			this.saveSessionMessages(managedAgentId, sessionId, state.messages);
		}
	}

	/**
	 * Clear messages and create a new session for a managed agent.
	 * Used by handleNewChat in useAgentProcess.
	 */
	async newSession(managedAgentId: string): Promise<void> {
		const adapter = this.adapters.get(managedAgentId);
		const state = this.processes.get(managedAgentId);
		if (!adapter || !state) return;

		state.messages = [];
		state.isSending = false;
		state.pendingPermissions = [];
		this.notifyListeners(managedAgentId);

		const sessionResult = await adapter.newSession(state.sessionInfo.workingDirectory);
		state.sessionInfo.sessionId = sessionResult.sessionId;
		state.sessionInfo.modes = sessionResult.modes;
		state.sessionInfo.models = sessionResult.models;
		state.sessionInfo.configOptions = sessionResult.configOptions;
		this.notifyListeners(managedAgentId);
	}

	/**
	 * Cancel the currently running operation for a managed agent.
	 */
	async cancelOperation(managedAgentId: string): Promise<void> {
		const adapter = this.adapters.get(managedAgentId);
		const state = this.processes.get(managedAgentId);
		if (!adapter || !state?.sessionInfo.sessionId) return;

		try {
			await adapter.cancel(state.sessionInfo.sessionId);
		} catch (err) {
			this.logger.warn(
				`[AgentProcessManager] Cancel error for ${managedAgentId}:`,
				err,
			);
		}

		state.isSending = false;
		this.notifyListeners(managedAgentId);
	}

	/**
	 * Respond to a permission request.
	 */
	async respondToPermission(
		managedAgentId: string,
		requestId: string,
		optionId: string,
	): Promise<void> {
		const adapter = this.adapters.get(managedAgentId);
		if (!adapter) return;
		await adapter.respondToPermission(requestId, optionId);
	}

	/**
	 * Drain and return all buffered pending permissions for a managed agent.
	 * Called by useAgentProcess on mount to present any queued permission requests.
	 */
	drainPendingPermissions(managedAgentId: string): PendingPermission[] {
		const state = this.processes.get(managedAgentId);
		if (!state) return [];
		const pending = [...state.pendingPermissions];
		state.pendingPermissions = [];
		return pending;
	}

	// ── Internal ────────────────────────────────────────────────────────────

	private onSessionUpdate(
		managedAgentId: string,
		update: SessionUpdate,
	): void {
		const state = this.processes.get(managedAgentId);
		if (!state) return;

		// Apply message-level update to buffer
		state.messages = applySessionUpdate(state.messages, update);

		// Route session-level updates to sessionInfo
		switch (update.type) {
			case "available_commands_update":
				state.sessionInfo.availableCommands = update.commands;
				break;
			case "current_mode_update":
				if (state.sessionInfo.modes) {
					state.sessionInfo.modes = {
						...state.sessionInfo.modes,
						currentModeId: update.currentModeId,
					};
				}
				break;
			case "usage_update":
				state.sessionInfo.usage = {
					used: update.used,
					size: update.size,
					cost: update.cost ?? undefined,
				};
				break;
		}

		// Permission request handling
		if (
			(update.type === "tool_call" || update.type === "tool_call_update") &&
			update.permissionRequest?.isActive === true
		) {
			const { requestId, options } = update.permissionRequest;
			// Check per-agent autoApprove first, then fall back to global setting
			const agentConfig = this.plugin.settings.managedAgents?.find(
				(a) => a.id === managedAgentId,
			);
			const shouldAutoApprove =
				agentConfig?.autoApprove ?? this.plugin.settings.autoAllowPermissions;
			if (shouldAutoApprove) {
				// Auto-approve with first allow_once option
				const allowOption = options.find((o) =>
					o.kind.startsWith("allow"),
				);
				if (allowOption) {
					void this.respondToPermission(
						managedAgentId,
						requestId,
						allowOption.optionId,
					);
				}
			} else if (state.listeners.size === 0) {
				// No UI attached — buffer for later
				state.pendingPermissions.push({
					requestId,
					toolCallId: update.toolCallId,
					options,
				});
			}
		}

		this.notifyListeners(managedAgentId);
	}

	private notifyListeners(managedAgentId: string): void {
		const state = this.processes.get(managedAgentId);
		if (!state) return;
		const snapshot = this.getProcessState(managedAgentId);
		if (!snapshot) return;
		for (const listener of state.listeners) {
			listener(snapshot);
		}
	}

	private async updateManagedAgentStatus(
		managedAgentId: string,
		status: ManagedAgentStatus,
		extras?: {
			lastActiveAt?: number;
			lastRunDuration?: number;
			lastMessagePreview?: string;
		},
	): Promise<void> {
		const state = this.processes.get(managedAgentId);
		if (state) state.status = status;

		const idx = this.plugin.settings.managedAgents.findIndex(
			(a) => a.id === managedAgentId,
		);
		if (idx === -1) return;

		this.plugin.settings.managedAgents[idx] = {
			...this.plugin.settings.managedAgents[idx],
			status,
			...extras,
		};
		await this.plugin.saveSettings();

		(
			this.plugin.app.workspace as unknown as {
				trigger: (name: string) => void;
			}
		).trigger(AGENTS_CHANGED_EVENT);
	}

	/**
	 * Save session messages to disk via the settings store.
	 * Fire-and-forget — does not block the caller.
	 */
	private saveSessionMessages(
		managedAgentId: string,
		sessionId: string,
		messages: ChatMessage[],
	): void {
		const state = this.processes.get(managedAgentId);
		const agentId = state?.sessionInfo.agentId ?? "";
		this.plugin.settingsStore
			.saveSessionMessages(sessionId, agentId, messages, managedAgentId)
			.catch((err) => {
				this.logger.warn(
					`[AgentProcessManager] Failed to save session messages for ${managedAgentId}:`,
					err,
				);
			});
	}

	/**
	 * Auto-export chat to markdown if the "auto-export on close" setting is enabled.
	 */
	private async autoExportIfEnabled(
		managedAgentId: string,
		state: AgentProcessState,
	): Promise<void> {
		if (!this.plugin.settings.exportSettings.autoExportOnCloseChat) return;
		if (!state.sessionInfo.sessionId) return;

		try {
			const exporter = new ChatExporter(this.plugin);
			await exporter.exportToMarkdown(
				state.messages,
				state.sessionInfo.agentDisplayName,
				state.sessionInfo.agentId,
				state.sessionInfo.sessionId,
				new Date(),
				false, // Don't open file — this is a background operation
			);
			this.logger.log(
				`[AgentProcessManager] Auto-exported chat for ${managedAgentId}`,
			);
		} catch (err) {
			this.logger.warn(
				`[AgentProcessManager] Auto-export failed for ${managedAgentId}:`,
				err,
			);
		}
	}

	private getOrCreateState(managedAgentId: string): AgentProcessState {
		let state = this.processes.get(managedAgentId);
		if (!state) {
			state = {
				managedAgentId,
				messages: [],
				isSending: false,
				status: "idle",
				sessionInfo: {
					sessionId: null,
					state: "disconnected",
					agentId: "",
					agentDisplayName: "",
					authMethods: [],
					workingDirectory: "",
				},
				runStartedAt: null,
				pendingPermissions: [],
				listeners: new Set(),
			};
			this.processes.set(managedAgentId, state);
		}
		return state;
	}

	private getVaultPath(): string {
		const adapter = this.plugin.app.vault.adapter;
		if (adapter instanceof FileSystemAdapter) {
			return adapter.getBasePath();
		}
		return process.cwd();
	}
}

// ============================================================================
// Utility
// ============================================================================

function extractLastAssistantPreview(messages: ChatMessage[]): string | undefined {
	const lastAssistant = [...messages]
		.reverse()
		.find((m) => m.role === "assistant");
	return lastAssistant?.content
		?.filter((c) => c.type === "text")
		.map((c) => (c as { text: string }).text)
		.join(" ")
		.substring(0, 120);
}
