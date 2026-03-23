import * as React from "react";
const { useRef, useCallback, useMemo, useEffect } = React;
import { Menu } from "obsidian";

import type AgentManagerPlugin from "../../plugin";
import type { IChatViewHost } from "../chat/types";
import type { IAcpClient } from "../../adapters/acp/acp.adapter";
import type { ManagedAgent } from "../../domain/models/managed-agent";

import { useChatController } from "../../hooks/useChatController";
import { ChatHeader } from "../chat/ChatHeader";
import { ChatMessages } from "../chat/ChatMessages";
import { ChatInput } from "../chat/ChatInput";
import { HeaderButton } from "../chat/HeaderButton";

interface AgentRunChatProps {
	plugin: AgentManagerPlugin;
	viewId: string;
	view: IChatViewHost;
	/** Vault-relative path to the instruction markdown file */
	instructionsPath: string | null;
	/** Display name of the managed agent */
	agentName: string;
	/** Managed agent UUID — scopes session storage */
	managedAgentId: string;
	/** Callback to persist quickview data to the managed agent model */
	onUpdate?: (updates: Partial<ManagedAgent>) => Promise<void>;
}

export function AgentRunChat({
	plugin,
	viewId,
	view,
	instructionsPath,
	agentName,
	managedAgentId,
	onUpdate,
}: AgentRunChatProps) {
	const controller = useChatController({
		plugin,
		viewId,
		managedAgentId,
		instructionsPath,
	});

	const {
		acpAdapter,
		settings,
		session,
		isSessionReady,
		isUpdateAvailable,
		messages,
		isSending,
		permission,
		mentions,
		slashCommands,
		autoMention,
		sessionHistory,
		activeAgentLabel,
		availableAgents,
		errorInfo,
		agentUpdateNotification,
		handleSendMessage,
		handleStopGeneration,
		handleNewChat,
		handleExportChat,
		handleRestartAgent,
		handleOpenHistory,
		handleClearError,
		handleClearAgentUpdate,
		handleRestoreSession,
		handleSetMode,
		handleSetModel,
		handleSetConfigOption,
		inputValue,
		setInputValue,
		attachedFiles,
		setAttachedFiles,
		restoredMessage,
		handleRestoredMessageConsumed,
	} = controller;

	const acpClientRef = useRef<IAcpClient>(acpAdapter);

	// ── Track run timing + quickview updates ──────────────────────
	const runStartRef = useRef<number | null>(null);

	useEffect(() => {
		if (!onUpdate) return;
		if (isSending) {
			runStartRef.current = Date.now();
			void onUpdate({ status: "running" });
		} else if (runStartRef.current) {
			const duration = Date.now() - runStartRef.current;
			// Extract last assistant message preview
			const lastAssistant = [...messages]
				.reverse()
				.find((m) => m.role === "assistant");
			const preview = lastAssistant?.content
				?.filter((c) => c.type === "text")
				.map((c) => (c as { text: string }).text)
				.join(" ")
				.substring(0, 120);
			void onUpdate({
				status: "complete",
				lastActiveAt: Date.now(),
				lastRunDuration: duration,
				lastMessagePreview: preview || undefined,
			});
			runStartRef.current = null;
		}
	}, [isSending]); // eslint-disable-line react-hooks/exhaustive-deps

	/** Track whether agent run has been started (for resume logic) */
	const hasStartedRef = useRef(false);

	// Reset flag when the session restarts (messages cleared)
	React.useEffect(() => {
		if (messages.length === 0) {
			hasStartedRef.current = false;
		}
	}, [messages.length]);

	// Auto-restore last session for this managed agent on first load
	const autoRestoreAttempted = useRef(false);
	useEffect(() => {
		if (autoRestoreAttempted.current) return;
		if (!isSessionReady || messages.length > 0) return;

		autoRestoreAttempted.current = true;

		// Find most recent session for this managed agent
		const sessions = (plugin.settings.savedSessions ?? [])
			.filter((s) => s.managedAgentId === managedAgentId)
			.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

		if (sessions.length > 0) {
			const last = sessions[0];
			void handleRestoreSession(last.sessionId, last.cwd);
		}
	}, [isSessionReady, messages.length, managedAgentId, plugin.settings.savedSessions, handleRestoreSession]);

	// ── Header menu with agent switching ─────────────────────────
	const handleShowMenu = useCallback(
		(e: React.MouseEvent<HTMLButtonElement>) => {
			const menu = new Menu();

			// Switch agent section
			menu.addItem((item) => {
				item.setTitle("Switch agent").setIsLabel(true);
			});

			for (const agent of availableAgents) {
				menu.addItem((item) => {
					item.setTitle(agent.displayName)
						.setChecked(agent.id === (session.agentId || ""))
						.onClick(() => {
							void handleNewChat(agent.id);
						});
				});
			}

			menu.addSeparator();

			menu.addItem((item) => {
				item.setTitle("Restart agent")
					.setIcon("refresh-cw")
					.onClick(() => {
						void handleRestartAgent();
					});
			});

			menu.showAtMouseEvent(e.nativeEvent);
		},
		[
			availableAgents,
			session.agentId,
			handleNewChat,
			handleRestartAgent,
		],
	);

	// ── Run button (send-only, greys out while agent is working) ─
	const handleRun = useCallback(async () => {
		if (!instructionsPath || isSending) return;

		if (hasStartedRef.current) {
			await handleSendMessage(
				"Continue executing the instructions from where you left off.",
			);
			return;
		}

		hasStartedRef.current = true;
		await handleSendMessage("Run process.");
	}, [isSending, instructionsPath, handleSendMessage]);

	const runButton = useMemo(
		() =>
			instructionsPath ? (
				<HeaderButton
					iconName="play"
					tooltip={isSending ? "Running…" : "Run instructions"}
					onClick={handleRun}
					disabled={isSending}
				/>
			) : null,
		[isSending, instructionsPath, handleRun],
	);

	const chatFontSizeStyle =
		settings.displaySettings.fontSize !== null
			? ({
					"--ac-chat-font-size": `${settings.displaySettings.fontSize}px`,
				} as React.CSSProperties)
			: undefined;

	return (
		<div
			className="agent-manager-chat-view-container"
			style={chatFontSizeStyle}
		>
			<ChatHeader
				agentLabel={agentName}
				isUpdateAvailable={isUpdateAvailable}
				hasHistoryCapability={sessionHistory.canShowSessionHistory}
				onNewChat={() => void handleNewChat()}
				onExportChat={() => void handleExportChat()}
				onShowMenu={handleShowMenu}
				onOpenHistory={handleOpenHistory}
				extraButtons={runButton}
			/>

			<ChatMessages
				messages={messages}
				isSending={isSending}
				isSessionReady={isSessionReady}
				isRestoringSession={sessionHistory.loading}
				agentLabel={activeAgentLabel}
				plugin={plugin}
				view={view}
				acpClient={acpClientRef.current}
				onApprovePermission={permission.approvePermission}
				hasActivePermission={permission.activePermission != null}
			/>

			<ChatInput
				isSending={isSending}
				isSessionReady={isSessionReady}
				isRestoringSession={sessionHistory.loading}
				agentLabel={activeAgentLabel}
				availableCommands={session.availableCommands || []}
				autoMentionEnabled={false}
				restoredMessage={restoredMessage}
				mentions={mentions}
				slashCommands={slashCommands}
				autoMention={autoMention}
				plugin={plugin}
				view={view}
				onSendMessage={handleSendMessage}
				onStopGeneration={handleStopGeneration}
				onRestoredMessageConsumed={handleRestoredMessageConsumed}
				modes={session.modes}
				onModeChange={(modeId) => void handleSetMode(modeId)}
				models={session.models}
				onModelChange={(modelId) => void handleSetModel(modelId)}
				configOptions={session.configOptions}
				onConfigOptionChange={(configId, value) =>
					void handleSetConfigOption(configId, value)
				}
				usage={session.usage}
				supportsImages={session.promptCapabilities?.image ?? false}
				agentId={session.agentId}
				inputValue={inputValue}
				onInputChange={setInputValue}
				attachedFiles={attachedFiles}
				onAttachedFilesChange={setAttachedFiles}
				errorInfo={errorInfo}
				onClearError={handleClearError}
				agentUpdateNotification={agentUpdateNotification}
				onClearAgentUpdate={handleClearAgentUpdate}
				messages={messages}
			/>
		</div>
	);
}
