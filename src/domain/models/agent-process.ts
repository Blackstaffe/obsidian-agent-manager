/**
 * Domain models for managed agent background processes.
 *
 * These types describe the in-memory state owned by AgentProcessManager
 * for each running managed agent. Zero external dependencies.
 */

import type { ChatMessage } from "./chat-message";
import type { PermissionOption } from "./chat-message";
import type { ManagedAgentStatus } from "./managed-agent";
import type {
	AuthenticationMethod,
	SlashCommand,
	SessionModeState,
	SessionModelState,
	SessionUsage,
} from "./chat-session";
import type { SessionConfigOption } from "./session-update";
import type { AgentCapabilities } from "../ports/agent-manager.port";

// ============================================================================
// Pending Permission
// ============================================================================

/**
 * A permission request buffered while no UI is attached to the process.
 * Drained and presented to the user when the AgentRunView reopens.
 */
export interface PendingPermission {
	requestId: string;
	toolCallId: string;
	options: PermissionOption[];
}

// ============================================================================
// Agent Session Info
// ============================================================================

/**
 * Session-level state mirrored from the ACP session, owned by the process manager.
 * Mirrors the shape of ChatSession but kept separate to avoid importing ChatSession
 * (which has Date fields and other UI-specific concerns).
 */
export interface AgentSessionInfo {
	sessionId: string | null;
	state: "disconnected" | "initializing" | "ready" | "error";
	agentId: string;
	agentDisplayName: string;
	authMethods: AuthenticationMethod[];
	availableCommands?: SlashCommand[];
	/** @deprecated Use configOptions */
	modes?: SessionModeState;
	/** @deprecated Use configOptions */
	models?: SessionModelState;
	configOptions?: SessionConfigOption[];
	usage?: SessionUsage;
	promptCapabilities?: {
		image?: boolean;
		audio?: boolean;
		embeddedContext?: boolean;
	};
	agentCapabilities?: AgentCapabilities;
	workingDirectory: string;
}

// ============================================================================
// Agent Process State
// ============================================================================

/**
 * Full in-memory state for a running (or previously run) managed agent process.
 * Owned exclusively by AgentProcessManager.
 *
 * NOTE: `listeners` is a mutable Set — callers should never hold a reference
 * to this directly. Use AgentProcessManager.subscribe() instead.
 */
export interface AgentProcessState {
	managedAgentId: string;
	/** Buffered message history — grows as session updates arrive */
	messages: ChatMessage[];
	/** Whether the agent is currently processing a prompt */
	isSending: boolean;
	/** Status mirrored to ManagedAgent.status in plugin settings */
	status: ManagedAgentStatus;
	/** Session-level information */
	sessionInfo: AgentSessionInfo;
	/** Timestamp when the current send started (for run duration tracking) */
	runStartedAt: number | null;
	/** Permission requests buffered while no UI subscriber is attached */
	pendingPermissions: PendingPermission[];
	/** Registered UI subscriber callbacks — mutated directly by process manager */
	listeners: Set<(state: ProcessStateSnapshot) => void>;
}

/**
 * Snapshot of AgentProcessState without the mutable listeners Set.
 * This is what subscribers receive and what useAgentProcess reads.
 */
export type ProcessStateSnapshot = Omit<AgentProcessState, "listeners">;
