import * as React from "react";
const { useRef, useCallback, useMemo } = React;
import { Menu } from "obsidian";

import type AgentManagerPlugin from "../../plugin";
import type { IChatViewHost } from "../chat/types";
import type { IAcpClient } from "../../adapters/acp/acp.adapter";
import type { AttachedFile } from "../../domain/models/chat-input-state";

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
}

export function AgentRunChat({
	plugin,
	viewId,
	view,
	instructionsPath,
	agentName,
}: AgentRunChatProps) {
	const controller = useChatController({
		plugin,
		viewId,
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

	/** Track whether instruction file has been sent in this session */
	const instructionsSentRef = useRef(false);
	/** Track whether agent run has been started (for resume logic) */
	const hasStartedRef = useRef(false);

	// Reset flags when the session restarts (messages cleared)
	React.useEffect(() => {
		if (messages.length === 0) {
			instructionsSentRef.current = false;
			hasStartedRef.current = false;
		}
	}, [messages.length]);

	// ── Wrap sendMessage to inject instructions as context prefix ─
	const handleSendWithInstructions = useCallback(
		async (content: string, attachments?: AttachedFile[]) => {
			let contextPrefix: string | undefined;

			if (
				!instructionsSentRef.current &&
				instructionsPath &&
				messages.length === 0
			) {
				instructionsSentRef.current = true;

				try {
					const fileContent =
						await plugin.app.vault.adapter.read(instructionsPath);
					if (fileContent) {
						contextPrefix =
							`<agent_instructions source="${instructionsPath}">\n` +
							fileContent +
							`\n</agent_instructions>`;
					}
				} catch (err) {
					console.warn(
						`[AgentRunChat] Failed to read instructions file: ${instructionsPath}`,
						err,
					);
				}
			}

			await handleSendMessage(content, attachments, contextPrefix);
		},
		[handleSendMessage, instructionsPath, messages.length, plugin.app.vault],
	);

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

		// Resume: agent was already started, just tell it to continue
		if (hasStartedRef.current) {
			await handleSendWithInstructions(
				"Continue executing the instructions from where you left off.",
			);
			return;
		}

		// First run: inject instructions as context prefix
		try {
			const fileContent =
				await plugin.app.vault.adapter.read(instructionsPath);
			if (!fileContent) return;

			const contextPrefix =
				`<agent_instructions source="${instructionsPath}">\n` +
				fileContent +
				`\n</agent_instructions>`;

			instructionsSentRef.current = true;
			hasStartedRef.current = true;
			await handleSendMessage(
				"Execute the instructions provided.",
				undefined,
				contextPrefix,
			);
		} catch (err) {
			console.warn(
				`[AgentRunChat] Failed to read instructions for run: ${instructionsPath}`,
				err,
			);
		}
	}, [isSending, instructionsPath, handleSendMessage, handleSendWithInstructions, plugin.app.vault]);

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
				autoMentionEnabled={settings.autoMentionActiveNote}
				restoredMessage={restoredMessage}
				mentions={mentions}
				slashCommands={slashCommands}
				autoMention={autoMention}
				plugin={plugin}
				view={view}
				onSendMessage={handleSendWithInstructions}
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
