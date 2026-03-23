/**
 * Pure message mutation functions.
 *
 * These functions operate on ChatMessage[] without React state.
 * Used by both useChat (via setMessages functional updaters) and
 * AgentProcessManager (for buffering messages while UI is detached).
 */

import type { ChatMessage, MessageContent } from "../domain/models/chat-message";
import type { SessionUpdate } from "../domain/models/session-update";

/** Tool call content type extracted for type safety */
type ToolCallMessageContent = Extract<MessageContent, { type: "tool_call" }>;

// ============================================================================
// Internal helpers
// ============================================================================

/**
 * Merge new tool call content into existing tool call.
 * Preserves existing values when new values are undefined.
 */
export function mergeToolCallContent(
	existing: ToolCallMessageContent,
	update: ToolCallMessageContent,
): ToolCallMessageContent {
	let mergedContent = existing.content || [];
	if (update.content !== undefined) {
		const newContent = update.content || [];
		const hasDiff = newContent.some((item) => item.type === "diff");
		if (hasDiff) {
			mergedContent = mergedContent.filter((item) => item.type !== "diff");
		}
		mergedContent = [...mergedContent, ...newContent];
	}

	return {
		...existing,
		toolCallId: update.toolCallId,
		title: update.title !== undefined ? update.title : existing.title,
		kind: update.kind !== undefined ? update.kind : existing.kind,
		status: update.status !== undefined ? update.status : existing.status,
		content: mergedContent,
		locations:
			update.locations !== undefined ? update.locations : existing.locations,
		rawInput:
			update.rawInput !== undefined && Object.keys(update.rawInput).length > 0
				? update.rawInput
				: existing.rawInput,
		permissionRequest:
			update.permissionRequest !== undefined
				? update.permissionRequest
				: existing.permissionRequest,
	};
}

// ============================================================================
// Pure mutation functions
// ============================================================================

/**
 * Append a content chunk to the last message of the given role.
 * Creates a new message if the last message has a different role.
 */
export function appendToLastMessage(
	messages: ChatMessage[],
	role: "user" | "assistant",
	content: MessageContent,
): ChatMessage[] {
	if (messages.length === 0 || messages[messages.length - 1].role !== role) {
		return [
			...messages,
			{
				id: crypto.randomUUID(),
				role,
				content: [content],
				timestamp: new Date(),
			},
		];
	}

	const lastMessage = messages[messages.length - 1];
	const updatedContent = [...lastMessage.content];

	if (content.type === "text" || content.type === "agent_thought") {
		const idx = updatedContent.findIndex((c) => c.type === content.type);
		if (idx >= 0) {
			const existing = updatedContent[idx];
			if (existing.type === "text" || existing.type === "agent_thought") {
				updatedContent[idx] = {
					type: content.type,
					text: existing.text + content.text,
				};
			}
		} else {
			updatedContent.push(content);
		}
	} else {
		const idx = updatedContent.findIndex((c) => c.type === content.type);
		if (idx >= 0) {
			updatedContent[idx] = content;
		} else {
			updatedContent.push(content);
		}
	}

	return [
		...messages.slice(0, -1),
		{ ...lastMessage, content: updatedContent },
	];
}

/**
 * Upsert a tool call into the messages array.
 * If a message already contains a tool call with the given ID, merges it.
 * Otherwise appends a new assistant message.
 */
export function upsertToolCallInMessages(
	messages: ChatMessage[],
	toolCallId: string,
	content: ToolCallMessageContent,
): ChatMessage[] {
	let found = false;
	const updated = messages.map((message) => ({
		...message,
		content: message.content.map((c) => {
			if (c.type === "tool_call" && c.toolCallId === toolCallId) {
				found = true;
				return mergeToolCallContent(c, content);
			}
			return c;
		}),
	}));

	if (found) return updated;

	return [
		...messages,
		{
			id: crypto.randomUUID(),
			role: "assistant" as const,
			content: [content],
			timestamp: new Date(),
		},
	];
}

// ============================================================================
// Main exported function
// ============================================================================

/**
 * Apply a session update to a messages array.
 * Returns a new array — does not mutate the input.
 *
 * Session-level update types (available_commands_update, current_mode_update,
 * session_info_update, usage_update) return messages unchanged — the caller
 * (AgentProcessManager or useAgentSession) handles those separately.
 */
export function applySessionUpdate(
	messages: ChatMessage[],
	update: SessionUpdate,
): ChatMessage[] {
	switch (update.type) {
		case "agent_message_chunk":
			return appendToLastMessage(messages, "assistant", {
				type: "text",
				text: update.text,
			});

		case "agent_thought_chunk":
			return appendToLastMessage(messages, "assistant", {
				type: "agent_thought",
				text: update.text,
			});

		case "user_message_chunk":
			return appendToLastMessage(messages, "user", {
				type: "text",
				text: update.text,
			});

		case "tool_call":
		case "tool_call_update":
			return upsertToolCallInMessages(messages, update.toolCallId, {
				type: "tool_call",
				toolCallId: update.toolCallId,
				title: update.title,
				status: update.status || "pending",
				kind: update.kind,
				content: update.content,
				locations: update.locations,
				rawInput: update.rawInput,
				permissionRequest: update.permissionRequest,
			});

		case "plan":
			return appendToLastMessage(messages, "assistant", {
				type: "plan",
				entries: update.entries,
			});

		// Session-level updates — not message mutations
		case "available_commands_update":
		case "current_mode_update":
		case "session_info_update":
		case "usage_update":
			return messages;

		default:
			return messages;
	}
}
