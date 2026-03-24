/**
 * useAgentProcess — React hook for managed agent background processes.
 *
 * Subscribes to AgentProcessManager for a given managedAgentId.
 * Returns the same shape as UseChatControllerReturn so AgentRunChat
 * can use it as a drop-in replacement for useChatController.
 *
 * Key difference from useChatController:
 * - On unmount: unsubscribes only. Process keeps running.
 * - Messages and session state come from the process manager buffer.
 */

import {
	useState,
	useEffect,
	useCallback,
	useMemo,
	useRef,
} from "react";
import { Notice, FileSystemAdapter, Platform } from "obsidian";

import type AgentManagerPlugin from "../plugin";
import type { ChatSession } from "../domain/models/chat-session";
import type { ChatMessage, MessageContent } from "../domain/models/chat-message";
import type { ProcessStateSnapshot } from "../domain/models/agent-process";
import type { AttachedFile } from "../domain/models/chat-input-state";
import type {
	ImagePromptContent,
	ResourceLinkPromptContent,
} from "../domain/models/prompt-content";
import type { ErrorInfo } from "../domain/models/agent-error";
import type { AgentUpdateNotification } from "../shared/agent-update-checker";

import { NoteMentionService } from "../adapters/obsidian/mention-service";
import { ObsidianVaultAdapter } from "../adapters/obsidian/vault.adapter";
import { SessionHistoryModal } from "../components/chat/SessionHistoryModal";
import { ConfirmDeleteModal } from "../components/chat/ConfirmDeleteModal";
import { ChatExporter } from "../shared/chat-exporter";
import { getLogger } from "../shared/logger";
import { preparePrompt } from "../shared/message-service";
import { buildFileUri } from "../shared/path-utils";
import { convertWindowsPathToWsl } from "../shared/wsl-utils";
import { checkAgentUpdate } from "../shared/agent-update-checker";

import { useSettings } from "./useSettings";
import { useMentions } from "./useMentions";
import { useSlashCommands } from "./useSlashCommands";
import { useAutoMention } from "./useAutoMention";
import { usePermission } from "./usePermission";
import { useAutoExport } from "./useAutoExport";
import { useSessionHistory } from "./useSessionHistory";
import type { UseChatControllerReturn } from "./useChatController";

// ============================================================================
// Helpers
// ============================================================================

/** Derive a ChatSession shape from the process manager's AgentSessionInfo. */
function deriveSession(snapshot: ProcessStateSnapshot | null): ChatSession {
	const info = snapshot?.sessionInfo;
	return {
		sessionId: info?.sessionId ?? null,
		state: (info?.state ?? "disconnected") as ChatSession["state"],
		agentId: info?.agentId ?? "",
		agentDisplayName: info?.agentDisplayName ?? "",
		authMethods: info?.authMethods ?? [],
		availableCommands: info?.availableCommands,
		modes: info?.modes,
		models: info?.models,
		configOptions: info?.configOptions,
		usage: info?.usage,
		promptCapabilities: info?.promptCapabilities,
		agentCapabilities: info?.agentCapabilities,
		createdAt: new Date(),
		lastActivityAt: new Date(),
		workingDirectory: info?.workingDirectory ?? "",
	};
}

// ============================================================================
// Hook
// ============================================================================

export function useAgentProcess(
	plugin: AgentManagerPlugin,
	managedAgentId: string,
	instructionsPath: string | null,
): UseChatControllerReturn {
	const manager = plugin.agentProcessManager;
	const logger = getLogger();

	// ── Process state from manager ──────────────────────────────────────────
	const [snapshot, setSnapshot] = useState<ProcessStateSnapshot | null>(
		() => manager.getProcessState(managedAgentId),
	);
	const [errorInfo, setErrorInfo] = useState<ErrorInfo | null>(null);

	useEffect(() => {
		const unsubscribe = manager.subscribe(managedAgentId, (s) => {
			setSnapshot(s);
		});

		// Start process if not already running
		if (!manager.isRunning(managedAgentId)) {
			manager.startProcess(managedAgentId).catch((err: unknown) => {
				setErrorInfo({
					title: "Failed to start agent",
					message: String(err instanceof Error ? err.message : err),
				});
			});
		}

		// Drain any buffered permissions and present to user
		const pending = manager.drainPendingPermissions(managedAgentId);
		if (pending.length > 0) {
			logger.log(
				`[useAgentProcess] Draining ${pending.length} pending permission(s)`,
			);
			// The active permission will surface via the messages buffer
			// (the tool_call with isActive=true is already in messages)
		}

		return unsubscribe; // DO NOT stop process on unmount
	}, [managedAgentId]); // eslint-disable-line react-hooks/exhaustive-deps

	// ── Derived state ────────────────────────────────────────────────────────
	const messages = snapshot?.messages ?? [];
	const isSending = snapshot?.isSending ?? false;
	const session = useMemo(() => deriveSession(snapshot), [snapshot]);
	const isSessionReady = session.state === "ready";

	// ── Services ─────────────────────────────────────────────────────────────
	const settings = useSettings(plugin);

	const vaultPath = useMemo(() => {
		const adapter = plugin.app.vault.adapter;
		if (adapter instanceof FileSystemAdapter) return adapter.getBasePath();
		return process.cwd();
	}, [plugin]);

	const noteMentionService = useMemo(
		() => new NoteMentionService(plugin),
		[plugin],
	);

	useEffect(() => {
		return () => {
			noteMentionService.destroy();
		};
	}, [noteMentionService]);

	const vaultAccessAdapter = useMemo(
		() => new ObsidianVaultAdapter(plugin, noteMentionService),
		[plugin, noteMentionService],
	);

	// The adapter is owned by the process manager; null if process not started yet
	const acpAdapter = useMemo(
		() => manager.getAdapter(managedAgentId),
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[managedAgentId, snapshot?.sessionInfo.state],
	);

	// ── Sub-hooks ─────────────────────────────────────────────────────────────
	// usePermission scans messages for active permissionRequest — no change needed
	const permission = usePermission(
		acpAdapter ?? { respondToPermission: async () => {} } as never,
		messages,
	);

	const mentions = useMentions(vaultAccessAdapter, plugin);
	const autoMention = useAutoMention(vaultAccessAdapter);
	const slashCommands = useSlashCommands(
		session.availableCommands ?? [],
		autoMention.toggle,
	);
	const autoExport = useAutoExport(plugin);

	// Session history (for restore/fork/delete)
	const [isLoadingSessionHistory, setIsLoadingSessionHistory] = useState(false);

	const handleSessionLoad = useCallback(
		(sessionId: string) => {
			logger.log(`[useAgentProcess] Session loaded: ${sessionId}`);
			// Update the session ID in the process manager snapshot
			// (the process manager's buffer was cleared/replaced by the load)
		},
		[logger],
	);

	const handleLoadStart = useCallback(() => {
		setIsLoadingSessionHistory(true);
		// Clear messages in process state — session/load will replay them
		const state = manager.getProcessState(managedAgentId);
		if (state) {
			// Direct mutation via internal method not exposed — instead
			// setSnapshot to show empty while loading
			setSnapshot((prev) => (prev ? { ...prev, messages: [] } : prev));
		}
	}, [manager, managedAgentId]);

	const handleLoadEnd = useCallback(() => {
		setIsLoadingSessionHistory(false);
	}, []);

	const handleMessagesRestore = useCallback(
		(localMessages: ChatMessage[]) => {
			// Restore messages from local storage into process manager buffer
			// via snapshot override — will sync on next manager notification
			setSnapshot((prev) =>
				prev ? { ...prev, messages: localMessages } : prev,
			);
		},
		[],
	);

	const sessionHistory = useSessionHistory({
		agentClient: acpAdapter ?? { respondToPermission: async () => {} } as never,
		session,
		settingsAccess: plugin.settingsStore,
		cwd: vaultPath,
		managedAgentId,
		onSessionLoad: handleSessionLoad,
		onMessagesRestore: handleMessagesRestore,
		onLoadStart: handleLoadStart,
		onLoadEnd: handleLoadEnd,
	});

	// ── Auto-restore last session on mount ──────────────────────────────────
	const autoRestoreAttempted = useRef(false);
	useEffect(() => {
		if (autoRestoreAttempted.current) return;
		if (!isSessionReady || messages.length > 0) return;

		autoRestoreAttempted.current = true;

		const sessions = (plugin.settings.savedSessions ?? [])
			.filter((s) => s.managedAgentId === managedAgentId)
			.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

		if (sessions.length > 0) {
			const last = sessions[0];
			void sessionHistory.restoreSession(last.sessionId, last.cwd);
		}
	}, [isSessionReady, messages.length, managedAgentId, plugin.settings.savedSessions, sessionHistory]);

	// ── Local state ────────────────────────────────────────────────────────
	const [isUpdateAvailable, setIsUpdateAvailable] = useState(false);
	const [agentUpdateNotification, setAgentUpdateNotification] =
		useState<AgentUpdateNotification | null>(null);
	const [restoredMessage, setRestoredMessage] = useState<string | null>(null);
	const [inputValue, setInputValue] = useState("");
	const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
	const historyModalRef = useRef<SessionHistoryModal | null>(null);

	// Track last user message for restore-after-cancel
	const lastUserMessageRef = useRef<string | null>(null);

	// ── Computed values ──────────────────────────────────────────────────────
	const activeAgentLabel = useMemo(() => {
		const activeId = session.agentId;
		if (activeId === plugin.settings.claude.id)
			return plugin.settings.claude.displayName || plugin.settings.claude.id;
		if (activeId === plugin.settings.codex.id)
			return plugin.settings.codex.displayName || plugin.settings.codex.id;
		if (activeId === plugin.settings.gemini.id)
			return plugin.settings.gemini.displayName || plugin.settings.gemini.id;
		const custom = plugin.settings.customAgents.find((a) => a.id === activeId);
		return custom?.displayName || custom?.id || activeId;
	}, [session.agentId, plugin.settings]);

	const availableAgents = useMemo(
		() => plugin.getAvailableAgents(),
		[plugin],
	);

	const shouldConvertToWsl = Platform.isWin && settings.windowsWslMode;

	// ── Core callbacks ────────────────────────────────────────────────────────
	const handleSendMessage = useCallback(
		async (content: string, attachments?: AttachedFile[]) => {
			if (!session.sessionId) {
				setErrorInfo({
					title: "Cannot Send Message",
					message: "No active session. Please wait for connection.",
				});
				return;
			}

			setErrorInfo(null);
			setAgentUpdateNotification(null);

			// Split attachments by kind
			const images: ImagePromptContent[] = [];
			const resourceLinks: ResourceLinkPromptContent[] = [];
			if (attachments) {
				for (const file of attachments) {
					if (file.kind === "image" && file.data) {
						images.push({
							type: "image",
							data: file.data,
							mimeType: file.mimeType,
						});
					} else if (file.kind === "file" && file.path) {
						let filePath = file.path;
						if (shouldConvertToWsl) {
							filePath = convertWindowsPathToWsl(filePath);
						}
						resourceLinks.push({
							type: "resource_link",
							uri: buildFileUri(filePath),
							name: file.name ?? file.path.split("/").pop() ?? "file",
							mimeType: file.mimeType || undefined,
							size: file.size,
						});
					}
				}
			}

			// Determine auto-mention note
			let activeNoteForMention: import("../domain/ports/vault-access.port").NoteMetadata | null =
				null;
			if (instructionsPath) {
				try {
					const file = plugin.app.vault.getFileByPath(instructionsPath);
					if (file) {
						activeNoteForMention = {
							path: file.path,
							name: file.basename,
							extension: file.extension,
							created: file.stat.ctime,
							modified: file.stat.mtime,
						};
					}
				} catch {
					// ignore
				}
			} else if (settings.autoMentionActiveNote) {
				activeNoteForMention = autoMention.activeNote;
			}

			// Prepare prompt content
			const prepared = await preparePrompt(
				{
					message: content,
					images: images.length > 0 ? images : undefined,
					resourceLinks: resourceLinks.length > 0 ? resourceLinks : undefined,
					activeNote: activeNoteForMention,
					vaultBasePath: vaultPath,
					isAutoMentionDisabled: autoMention.isDisabled,
					convertToWsl: shouldConvertToWsl,
					supportsEmbeddedContext:
						session.promptCapabilities?.embeddedContext ?? false,
					maxNoteLength: settings.displaySettings.maxNoteLength,
					maxSelectionLength: settings.displaySettings.maxSelectionLength,
				},
				vaultAccessAdapter,
				noteMentionService,
			);

			// Build user message for UI
			const userMessageContent: MessageContent[] = [];
			if (prepared.autoMentionContext) {
				userMessageContent.push({
					type: "text_with_context",
					text: content,
					autoMentionContext: prepared.autoMentionContext,
				});
			} else {
				userMessageContent.push({ type: "text", text: content });
			}
			for (const img of images) {
				userMessageContent.push({
					type: "image",
					data: img.data,
					mimeType: img.mimeType,
				});
			}
			for (const link of resourceLinks) {
				userMessageContent.push({
					type: "resource_link",
					uri: link.uri,
					name: link.name,
					mimeType: link.mimeType,
					size: link.size,
				});
			}
			const userMessage: ChatMessage = {
				id: crypto.randomUUID(),
				role: "user",
				content: userMessageContent,
				timestamp: new Date(),
			};

			lastUserMessageRef.current = content;

			const isFirstMessage = messages.length === 0;

			try {
				await manager.sendMessage(
					managedAgentId,
					session.sessionId,
					prepared.agentContent,
					userMessage,
				);

				lastUserMessageRef.current = null;

				// Save session metadata locally on first message
				if (isFirstMessage && session.sessionId) {
					await sessionHistory.saveSessionLocally(
						session.sessionId,
						content,
					);
				}
			} catch (err) {
				setErrorInfo({
					title: "Send Message Failed",
					message: String(err instanceof Error ? err.message : err),
				});
			}
		},
		[
			session.sessionId,
			session.promptCapabilities,
			messages.length,
			manager,
			managedAgentId,
			vaultPath,
			vaultAccessAdapter,
			noteMentionService,
			autoMention,
			shouldConvertToWsl,
			settings.autoMentionActiveNote,
			settings.displaySettings,
			instructionsPath,
			plugin.app.vault,
			sessionHistory,
		],
	);

	const handleStopGeneration = useCallback(async () => {
		const last = lastUserMessageRef.current;
		await manager.cancelOperation(managedAgentId);
		if (last) setRestoredMessage(last);
		lastUserMessageRef.current = null;
	}, [manager, managedAgentId]);

	const handleNewChat = useCallback(
		async (_requestedAgentId?: string) => {
			if (messages.length === 0) {
				new Notice("[Agent Manager] Already a new session");
				return;
			}
			if (isSending) {
				await manager.cancelOperation(managedAgentId);
			}
			if (messages.length > 0) {
				await autoExport.autoExportIfEnabled("newChat", messages, session);
			}
			autoMention.toggle(false);
			await manager.newSession(managedAgentId);
			sessionHistory.invalidateCache();
		},
		[
			messages,
			isSending,
			manager,
			managedAgentId,
			session,
			autoExport,
			autoMention,
			sessionHistory,
		],
	);

	const handleExportChat = useCallback(async () => {
		if (messages.length === 0) {
			new Notice("[Agent Manager] No messages to export");
			return;
		}
		try {
			const exporter = new ChatExporter(plugin);
			const openFile = plugin.settings.exportSettings.openFileAfterExport;
			const filePath = await exporter.exportToMarkdown(
				messages,
				session.agentDisplayName,
				session.agentId,
				session.sessionId || "unknown",
				session.createdAt,
				openFile,
			);
			new Notice(`[Agent Manager] Chat exported to ${filePath}`);
		} catch (err) {
			new Notice("[Agent Manager] Failed to export chat");
			logger.error("Export error:", err);
		}
	}, [messages, session, plugin, logger]);

	const handleSwitchAgent = useCallback(
		async (agentId: string) => {
			await handleNewChat(agentId);
		},
		[handleNewChat],
	);

	const handleRestartAgent = useCallback(async () => {
		if (messages.length > 0) {
			await autoExport.autoExportIfEnabled("newChat", messages, session);
		}
		try {
			await manager.stopProcess(managedAgentId);
			await manager.startProcess(managedAgentId);
			new Notice("[Agent Manager] Agent restarted");
		} catch (err) {
			new Notice("[Agent Manager] Failed to restart agent");
			logger.error("Restart error:", err);
		}
	}, [manager, managedAgentId, messages, session, autoExport, logger]);

	const handleClearError = useCallback(() => {
		setErrorInfo(null);
	}, []);

	const handleClearAgentUpdate = useCallback(() => {
		setAgentUpdateNotification(null);
	}, []);

	const handleRestoredMessageConsumed = useCallback(() => {
		setRestoredMessage(null);
	}, []);

	// Session history callbacks
	const handleRestoreSession = useCallback(
		async (sessionId: string, cwd: string) => {
			try {
				setSnapshot((prev) => (prev ? { ...prev, messages: [] } : prev));
				await sessionHistory.restoreSession(sessionId, cwd);
				new Notice("[Agent Manager] Session restored");
			} catch (err) {
				new Notice("[Agent Manager] Failed to restore session");
				logger.error("Session restore error:", err);
			}
		},
		[sessionHistory, logger],
	);

	const handleForkSession = useCallback(
		async (sessionId: string, cwd: string) => {
			try {
				setSnapshot((prev) => (prev ? { ...prev, messages: [] } : prev));
				await sessionHistory.forkSession(sessionId, cwd);
				new Notice("[Agent Manager] Session forked");
			} catch (err) {
				new Notice("[Agent Manager] Failed to fork session");
				logger.error("Session fork error:", err);
			}
		},
		[sessionHistory, logger],
	);

	const handleDeleteSession = useCallback(
		(sessionId: string) => {
			const target = sessionHistory.sessions.find(
				(s) => s.sessionId === sessionId,
			);
			const title = target?.title ?? "Untitled Session";
			const confirmModal = new ConfirmDeleteModal(plugin.app, title, async () => {
				try {
					await sessionHistory.deleteSession(sessionId);
					new Notice("[Agent Manager] Session deleted");
				} catch (err) {
					new Notice("[Agent Manager] Failed to delete session");
					logger.error("Session delete error:", err);
				}
			});
			confirmModal.open();
		},
		[plugin.app, sessionHistory, logger],
	);

	const handleLoadMore = useCallback(() => {
		void sessionHistory.loadMoreSessions();
	}, [sessionHistory]);

	const handleFetchSessions = useCallback(
		(cwd?: string) => {
			void sessionHistory.fetchSessions(cwd);
		},
		[sessionHistory],
	);

	const handleOpenHistory = useCallback(() => {
		if (!historyModalRef.current) {
			historyModalRef.current = new SessionHistoryModal(plugin.app, {
				sessions: sessionHistory.sessions,
				loading: sessionHistory.loading,
				error: sessionHistory.error,
				hasMore: sessionHistory.hasMore,
				currentCwd: vaultPath,
				canList: sessionHistory.canList,
				canRestore: sessionHistory.canRestore,
				canFork: sessionHistory.canFork,
				isUsingLocalSessions: sessionHistory.isUsingLocalSessions,
				localSessionIds: sessionHistory.localSessionIds,
				isAgentReady: isSessionReady,
				debugMode: settings.debugMode,
				simplified: true,
				onRestoreSession: handleRestoreSession,
				onForkSession: handleForkSession,
				onDeleteSession: handleDeleteSession,
				onLoadMore: handleLoadMore,
				onFetchSessions: handleFetchSessions,
			});
		}
		historyModalRef.current.open();
		void sessionHistory.fetchSessions(vaultPath);
	}, [
		plugin.app,
		sessionHistory,
		vaultPath,
		isSessionReady,
		settings.debugMode,
		handleRestoreSession,
		handleForkSession,
		handleDeleteSession,
		handleLoadMore,
		handleFetchSessions,
	]);

	// Update modal props when session history state changes
	useEffect(() => {
		if (historyModalRef.current) {
			historyModalRef.current.updateProps({
				sessions: sessionHistory.sessions,
				loading: sessionHistory.loading,
				error: sessionHistory.error,
				hasMore: sessionHistory.hasMore,
				currentCwd: vaultPath,
				canList: sessionHistory.canList,
				canRestore: sessionHistory.canRestore,
				canFork: sessionHistory.canFork,
				isUsingLocalSessions: sessionHistory.isUsingLocalSessions,
				localSessionIds: sessionHistory.localSessionIds,
				isAgentReady: isSessionReady,
				debugMode: settings.debugMode,
				simplified: true,
				onRestoreSession: handleRestoreSession,
				onForkSession: handleForkSession,
				onDeleteSession: handleDeleteSession,
				onLoadMore: handleLoadMore,
				onFetchSessions: handleFetchSessions,
			});
		}
	}, [
		sessionHistory.sessions,
		sessionHistory.loading,
		sessionHistory.error,
		sessionHistory.hasMore,
		sessionHistory.canList,
		sessionHistory.canRestore,
		sessionHistory.canFork,
		sessionHistory.isUsingLocalSessions,
		vaultPath,
		isSessionReady,
		settings.debugMode,
		handleRestoreSession,
		handleForkSession,
		handleDeleteSession,
		handleLoadMore,
		handleFetchSessions,
	]);

	const handleSetMode = useCallback(
		async (modeId: string) => {
			const adapter = manager.getAdapter(managedAgentId);
			if (!adapter || !session.sessionId) return;
			await adapter.setSessionMode(session.sessionId, modeId);
		},
		[manager, managedAgentId, session.sessionId],
	);

	const handleSetModel = useCallback(
		async (modelId: string) => {
			const adapter = manager.getAdapter(managedAgentId);
			if (!adapter || !session.sessionId) return;
			await adapter.setSessionModel(session.sessionId, modelId);
		},
		[manager, managedAgentId, session.sessionId],
	);

	const handleSetConfigOption = useCallback(
		async (configId: string, value: string) => {
			const adapter = manager.getAdapter(managedAgentId);
			if (!adapter || !session.sessionId) return;
			const updatedOptions = await adapter.setSessionConfigOption(
				session.sessionId,
				configId,
				value,
			);
			// Update snapshot with new config options
			setSnapshot((prev) =>
				prev
					? {
							...prev,
							sessionInfo: {
								...prev.sessionInfo,
								configOptions: updatedOptions,
							},
					  }
					: prev,
			);
		},
		[manager, managedAgentId, session.sessionId],
	);

	// ── Effects ──────────────────────────────────────────────────────────────

	// Active note tracking for auto-mention
	useEffect(() => {
		let isMounted = true;
		const refresh = async () => {
			if (!isMounted) return;
			await autoMention.updateActiveNote();
		};
		const unsubscribe = vaultAccessAdapter.subscribeSelectionChanges(() => {
			void refresh();
		});
		void refresh();
		return () => {
			isMounted = false;
			unsubscribe();
		};
	}, [autoMention.updateActiveNote, vaultAccessAdapter]);

	// Update message callback on adapter for permission UI
	useEffect(() => {
		if (!acpAdapter) return;
		// No-op: the process manager handles updateMessage for permissions
		// via its onSessionUpdate callback. If we need per-view updateMessage,
		// register here.
	}, [acpAdapter]);

	// Plugin update check
	useEffect(() => {
		plugin
			.checkForUpdates()
			.then(setIsUpdateAvailable)
			.catch((err: unknown) => logger.error("Update check failed:", err));
	}, [plugin, logger]);

	// Agent update check
	useEffect(() => {
		if (!isSessionReady || !session.agentInfo?.name) return;
		checkAgentUpdate(session.agentInfo as { name: string; version?: string })
			.then(setAgentUpdateNotification)
			.catch((err: unknown) => logger.error("Agent update check failed:", err));
	}, [isSessionReady, session.agentInfo, logger]);

	// Session messages are saved by AgentProcessManager on turn end (no UI dependency).
	// Session metadata (title, timestamps) is saved by handleSendMessage on first message.

	// ── Return ───────────────────────────────────────────────────────────────
	return {
		logger,
		vaultPath,
		acpAdapter: acpAdapter ?? ({ respondToPermission: async () => {} } as never),
		vaultAccessAdapter,
		noteMentionService,

		settings,
		session,
		isSessionReady,
		messages,
		isSending,
		isUpdateAvailable,
		isLoadingSessionHistory,

		permission,
		mentions,
		autoMention,
		slashCommands,
		sessionHistory,
		autoExport,

		activeAgentLabel,
		availableAgents,
		errorInfo,
		agentUpdateNotification,

		handleSendMessage,
		handleStopGeneration,
		handleNewChat,
		handleExportChat,
		handleSwitchAgent,
		handleRestartAgent,
		handleClearError,
		handleClearAgentUpdate,
		handleRestoreSession,
		handleForkSession,
		handleDeleteSession,
		handleOpenHistory,
		handleSetMode,
		handleSetModel,
		handleSetConfigOption,

		inputValue,
		setInputValue,
		attachedFiles,
		setAttachedFiles,
		restoredMessage,
		handleRestoredMessageConsumed,
		historyModalRef,
	};
}
