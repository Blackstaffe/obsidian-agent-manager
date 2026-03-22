import { useState, useCallback, useMemo } from "react";
import type { IAgentManager } from "../domain/ports/agent-manager.port";
import type { ISettingsAccess } from "../domain/ports/settings-access.port";
import type { SessionInfo } from "../domain/models/session-info";
import type {
	ChatSession,
	SessionModeState,
	SessionModelState,
} from "../domain/models/chat-session";
import type { SessionConfigOption } from "../domain/models/session-update";
import type { ChatMessage } from "../domain/models/chat-message";
import {
	getSessionCapabilityFlags,
	type SessionCapabilityFlags,
} from "../shared/session-capability-utils";

// ============================================================================
// Types
// ============================================================================

/**
 * Callback invoked when a session is successfully loaded/resumed/forked.
 * Provides the loaded session metadata to integrate with chat state.
 *
 * Note: Conversation history for load is received via session/update notifications,
 * not via this callback.
 */
export interface SessionLoadCallback {
	/**
	 * @param sessionId - ID of the session (new session ID for fork)
	 * @param modes - Available modes from the session
	 * @param models - Available models from the session
	 * @param configOptions - Config options from the session
	 */
	(
		sessionId: string,
		modes?: SessionModeState,
		models?: SessionModelState,
		configOptions?: SessionConfigOption[],
	): void;
}

/**
 * Callback invoked when messages should be restored from local storage.
 * Used for resume/fork operations where the agent doesn't return history.
 */
export interface MessagesRestoreCallback {
	/**
	 * @param messages - Messages to restore
	 */
	(messages: ChatMessage[]): void;
}

/**
 * Options for useSessionHistory hook.
 */
export interface UseSessionHistoryOptions {
	/** Agent client for session operations */
	agentClient: IAgentManager;
	/** Current session (used to access agentCapabilities and agentId) */
	session: ChatSession;
	/** Settings access for local session storage */
	settingsAccess: ISettingsAccess;
	/** Working directory (vault path) for session operations */
	cwd: string;
	/** Managed agent UUID — scopes sessions to a specific process */
	managedAgentId?: string;
	/** Callback invoked when a session is loaded/resumed/forked */
	onSessionLoad: SessionLoadCallback;
	/** Callback invoked when messages should be restored from local storage */
	onMessagesRestore?: MessagesRestoreCallback;
	/** Callback invoked when session/load starts (to start ignoring history replay) */
	onLoadStart?: () => void;
	/** Callback invoked when session/load ends (to stop ignoring history replay) */
	onLoadEnd?: () => void;
}

/**
 * Return type for useSessionHistory hook.
 */
export interface UseSessionHistoryReturn {
	/** List of sessions */
	sessions: SessionInfo[];
	/** Whether sessions are being fetched */
	loading: boolean;
	/** Error message if fetch fails */
	error: string | null;
	/** Whether there are more sessions to load */
	hasMore: boolean;

	// Capability flags (from session.agentCapabilities)
	/** Whether session history UI should be shown */
	canShowSessionHistory: boolean;
	/** Whether session can be restored (load or resume supported) */
	canRestore: boolean;
	/** Whether session/fork is supported (unstable) */
	canFork: boolean;
	/** Whether session/list is supported (unstable) */
	canList: boolean;
	/** Whether sessions are from local storage (agent doesn't support list) */
	isUsingLocalSessions: boolean;

	/** Set of session IDs that have local data (for UI filtering) */
	localSessionIds: Set<string>;

	/**
	 * Fetch sessions list from agent.
	 * Replaces existing sessions in state.
	 * @param cwd - Optional working directory filter
	 */
	fetchSessions: (cwd?: string) => Promise<void>;

	/**
	 * Load more sessions (pagination).
	 * Appends to existing sessions list.
	 */
	loadMoreSessions: () => Promise<void>;

	/**
	 * Restore a specific session by ID.
	 * Uses load if available (with history replay), otherwise resume (without history replay).
	 * Only available if canRestore is true.
	 * @param sessionId - Session to restore
	 * @param cwd - Working directory for the session
	 */
	restoreSession: (sessionId: string, cwd: string) => Promise<void>;

	/**
	 * Fork a specific session to create a new branch.
	 * Only available if canFork is true.
	 * @param sessionId - Session to fork
	 * @param cwd - Working directory for the session
	 */
	forkSession: (sessionId: string, cwd: string) => Promise<void>;

	/**
	 * Delete a session (local metadata + message file).
	 * @param sessionId - Session to delete
	 */
	deleteSession: (sessionId: string) => Promise<void>;

	/**
	 * Save session metadata locally.
	 * Called when the first message is sent in a new session.
	 * @param sessionId - Session ID to save
	 * @param messageContent - First message content (used to generate title)
	 */
	saveSessionLocally: (
		sessionId: string,
		messageContent: string,
	) => Promise<void>;

	/**
	 * Save session messages locally.
	 * Called when a turn ends (agent response complete).
	 * @param sessionId - Session ID
	 * @param messages - Messages to save
	 */
	saveSessionMessages: (
		sessionId: string,
		messages: import("../domain/models/chat-message").ChatMessage[],
	) => void;

	/**
	 * Invalidate the session cache.
	 * Call this when creating a new session to refresh the list.
	 */
	invalidateCache: () => void;
}

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * Hook for managing session history.
 *
 * Handles listing, loading, resuming, forking, and caching of previous chat sessions.
 * Integrates with the agent client to fetch session metadata and
 * load previous conversations.
 *
 * Capability detection is based on session.agentCapabilities, which is set
 * during initialization and persists for the session lifetime.
 *
 * @param options - Hook options including agentClient, session, and onSessionLoad
 */
export function useSessionHistory(
	options: UseSessionHistoryOptions,
): UseSessionHistoryReturn {
	const {
		agentClient,
		session,
		settingsAccess,
		cwd,
		managedAgentId,
		onSessionLoad,
		onMessagesRestore,
		onLoadStart,
		onLoadEnd,
	} = options;

	// For filtering: managed agent sessions use their ID, regular chat excludes managed sessions
	const sessionFilter = managedAgentId ?? null;

	// Derive capability flags from session.agentCapabilities
	const capabilities: SessionCapabilityFlags = useMemo(
		() => getSessionCapabilityFlags(session.agentCapabilities),
		[session.agentCapabilities],
	);

	// State
	const [sessions, setSessions] = useState<SessionInfo[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [localSessionIds, setLocalSessionIds] = useState<Set<string>>(
		new Set(),
	);

	/** No-op — cache is no longer used since we always read from local storage */
	const invalidateCache = useCallback(() => {}, []);

	/**
	 * Fetch sessions from local storage.
	 * Always uses plugin-side session storage (never agent's session/list).
	 * Replaces existing sessions in state.
	 */
	const fetchSessions = useCallback(
		async (cwd?: string) => {
			// Always use locally-stored sessions — never call agent's session/list.
			// This ensures sessions are properly scoped (managed agent vs regular chat)
			// and the plugin is the single source of truth.
			const localSessions = settingsAccess.getSavedSessions(
				session.agentId,
				cwd,
				sessionFilter,
			);

			// Convert SavedSessionInfo to SessionInfo format
			const sessionInfos: SessionInfo[] = localSessions.map((s) => ({
				sessionId: s.sessionId,
				cwd: s.cwd,
				title: s.title,
				updatedAt: s.updatedAt,
			}));

			setSessions(sessionInfos);
			setLocalSessionIds(
				new Set(localSessions.map((s) => s.sessionId)),
			);
			setError(null);
		},
		[settingsAccess, session.agentId, sessionFilter],
	);

	/**
	 * Load more sessions (pagination).
	 * No-op for local sessions (all loaded at once).
	 */
	const loadMoreSessions = useCallback(async () => {
		// Local sessions are always loaded in full — no pagination needed
	}, []);

	/**
	 * Restore a specific session by ID.
	 * Uses load if available (with history replay), otherwise resume (without history replay).
	 */
	const restoreSession = useCallback(
		async (sessionId: string, cwd: string) => {
			setLoading(true);
			setError(null);

			try {
				// IMPORTANT: Update session.sessionId BEFORE calling restore
				// so that session/update notifications are not ignored
				onSessionLoad(sessionId, undefined, undefined, undefined);

				if (capabilities.canLoad) {
					// Check local messages first to decide whether to use them or agent replay
					const localMessages =
						await settingsAccess.loadSessionMessages(sessionId, managedAgentId);

					if (localMessages && onMessagesRestore) {
						// Local messages available: ignore agent replay, restore from local
						onLoadStart?.();
						try {
							const result = await agentClient.loadSession(
								sessionId,
								cwd,
							);
							onSessionLoad(
								result.sessionId,
								result.modes,
								result.models,
								result.configOptions,
							);
							onMessagesRestore(localMessages);
						} finally {
							onLoadEnd?.();
						}
					} else {
						// No local messages: let agent replay flow through to UI
						const result = await agentClient.loadSession(
							sessionId,
							cwd,
						);
						onSessionLoad(
							result.sessionId,
							result.modes,
							result.models,
							result.configOptions,
						);
					}
				} else if (capabilities.canResume) {
					// Use resume (without history replay, restore from local storage)
					const result = await agentClient.resumeSession(
						sessionId,
						cwd,
					);
					onSessionLoad(
						result.sessionId,
						result.modes,
						result.models,
						result.configOptions,
					);

					// Resume doesn't return history, so restore from local storage
					const localMessages =
						await settingsAccess.loadSessionMessages(sessionId, managedAgentId);
					if (localMessages && onMessagesRestore) {
						onMessagesRestore(localMessages);
					}
				} else {
					throw new Error("Session restoration is not supported");
				}
			} catch (err) {
				const errorMessage =
					err instanceof Error ? err.message : String(err);
				setError(`Failed to restore session: ${errorMessage}`);
				throw err; // Re-throw to allow caller to handle
			} finally {
				setLoading(false);
			}
		},
		[
			agentClient,
			capabilities.canLoad,
			capabilities.canResume,
			onSessionLoad,
			settingsAccess,
			onMessagesRestore,
			onLoadStart,
			onLoadEnd,
		],
	);

	/**
	 * Fork a specific session to create a new branch.
	 * Note: For fork, we update sessionId AFTER the call since a new session ID is created.
	 * Restores messages from the original session's local storage since agent doesn't return history.
	 */
	const forkSession = useCallback(
		async (sessionId: string, cwd: string) => {
			setLoading(true);
			setError(null);

			try {
				const result = await agentClient.forkSession(sessionId, cwd);

				// Update with new session ID and modes/models from result
				// For fork, the new session ID is returned in result
				onSessionLoad(
					result.sessionId,
					result.modes,
					result.models,
					result.configOptions,
				);

				// Fork doesn't return history, so restore from original session's local storage
				const localMessages =
					await settingsAccess.loadSessionMessages(sessionId, managedAgentId);
				if (localMessages && onMessagesRestore) {
					onMessagesRestore(localMessages);
				}

				// Save forked session to history
				if (session.agentId) {
					const originalSession = sessions.find(
						(s) => s.sessionId === sessionId,
					);
					const originalTitle = originalSession?.title ?? "Session";

					// Truncate title to 50 characters
					const maxTitleLength = 50;
					const prefix = "Fork: ";
					const maxBaseLength = maxTitleLength - prefix.length;
					const truncatedTitle =
						originalTitle.length > maxBaseLength
							? originalTitle.substring(0, maxBaseLength) + "..."
							: originalTitle;
					const newTitle = `${prefix}${truncatedTitle}`;

					const now = new Date().toISOString();

					await settingsAccess.saveSession({
						sessionId: result.sessionId,
						agentId: session.agentId,
						cwd,
						title: newTitle,
						createdAt: now,
						updatedAt: now,
						managedAgentId,
					});

					// Save messages under new session ID for restore after restart
					if (localMessages) {
						void settingsAccess.saveSessionMessages(
							result.sessionId,
							session.agentId,
							localMessages,
							managedAgentId,
						);
					}
				}

				// Invalidate cache since a new session was created
				invalidateCache();
			} catch (err) {
				const errorMessage =
					err instanceof Error ? err.message : String(err);
				setError(`Failed to fork session: ${errorMessage}`);
				throw err; // Re-throw to allow caller to handle
			} finally {
				setLoading(false);
			}
		},
		[
			agentClient,
			onSessionLoad,
			settingsAccess,
			onMessagesRestore,
			invalidateCache,
			session.agentId,
			sessions,
		],
	);

	/**
	 * Delete a session (local metadata + message file).
	 * Removes from both local state and persistent storage.
	 */
	const deleteSession = useCallback(
		async (sessionId: string) => {
			try {
				// Delete from persistent storage (metadata + message file)
				await settingsAccess.deleteSession(sessionId);

				// Remove from local state
				setSessions((prev) =>
					prev.filter((s) => s.sessionId !== sessionId),
				);

				// Invalidate cache to ensure consistency
				invalidateCache();
			} catch (err) {
				const errorMessage =
					err instanceof Error ? err.message : String(err);
				setError(`Failed to delete session: ${errorMessage}`);
				throw err; // Re-throw to allow caller to handle
			}
		},
		[settingsAccess, invalidateCache],
	);

	/**
	 * Save session metadata locally.
	 * Called when the first message is sent in a new session.
	 */
	const saveSessionLocally = useCallback(
		async (sessionId: string, messageContent: string) => {
			if (!session.agentId) return;

			const title =
				messageContent.length > 50
					? messageContent.substring(0, 50) + "..."
					: messageContent;

			await settingsAccess.saveSession({
				sessionId,
				agentId: session.agentId,
				cwd,
				title,
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				managedAgentId,
			});
		},
		[session.agentId, cwd, managedAgentId, settingsAccess],
	);

	/**
	 * Save session messages locally.
	 * Called when a turn ends (agent response complete).
	 * Fire-and-forget (does not block UI).
	 */
	const saveSessionMessages = useCallback(
		(
			sessionId: string,
			messages: import("../domain/models/chat-message").ChatMessage[],
		) => {
			if (!session.agentId || messages.length === 0) return;

			// Fire-and-forget
			void settingsAccess.saveSessionMessages(
				sessionId,
				session.agentId,
				messages,
				managedAgentId,
			);
		},
		[session.agentId, managedAgentId, settingsAccess],
	);

	return {
		sessions,
		loading,
		error,
		hasMore: false, // Local sessions are always loaded in full

		// Capability flags
		// Always show session history (local sessions are always available)
		canShowSessionHistory: true,
		canRestore: capabilities.canLoad || capabilities.canResume,
		canFork: capabilities.canFork,
		canList: true, // Always true — we always have local listing
		isUsingLocalSessions: true, // Always use local sessions
		localSessionIds,

		// Methods
		fetchSessions,
		loadMoreSessions,
		restoreSession,
		forkSession,
		deleteSession,
		saveSessionLocally,
		saveSessionMessages,
		invalidateCache,
	};
}
