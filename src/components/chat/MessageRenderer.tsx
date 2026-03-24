import * as React from "react";
import type {
	ChatMessage,
	MessageContent,
} from "../../domain/models/chat-message";
import type { IAcpClient } from "../../adapters/acp/acp.adapter";
import type AgentManagerPlugin from "../../plugin";
import { MessageContentRenderer } from "./MessageContentRenderer";

interface MessageRendererProps {
	message: ChatMessage;
	plugin: AgentManagerPlugin;
	acpClient?: IAcpClient;
	/** Callback to approve a permission request */
	onApprovePermission?: (
		requestId: string,
		optionId: string,
	) => Promise<void>;
	/** Managed agent ID — enables per-agent hide settings */
	managedAgentId?: string;
}

/**
 * Group consecutive image/resource_link contents together for horizontal display.
 * Non-attachment contents are wrapped individually.
 */
function groupContent(
	contents: MessageContent[],
): Array<
	| { type: "attachments"; items: MessageContent[] }
	| { type: "single"; item: MessageContent }
> {
	const groups: Array<
		| { type: "attachments"; items: MessageContent[] }
		| { type: "single"; item: MessageContent }
	> = [];

	let currentAttachmentGroup: MessageContent[] = [];

	for (const content of contents) {
		if (content.type === "image" || content.type === "resource_link") {
			currentAttachmentGroup.push(content);
		} else {
			// Flush any pending attachment group
			if (currentAttachmentGroup.length > 0) {
				groups.push({
					type: "attachments",
					items: currentAttachmentGroup,
				});
				currentAttachmentGroup = [];
			}
			groups.push({ type: "single", item: content });
		}
	}

	// Flush remaining attachments
	if (currentAttachmentGroup.length > 0) {
		groups.push({ type: "attachments", items: currentAttachmentGroup });
	}

	return groups;
}

/** Content types suppressed by hideToolCalls */
const TOOL_CALL_TYPES = new Set(["tool_call", "terminal", "plan"]);
/** Content types suppressed by hideThoughts */
const THOUGHT_TYPES = new Set(["agent_thought"]);

export function MessageRenderer({
	message,
	plugin,
	acpClient,
	onApprovePermission,
	managedAgentId,
}: MessageRendererProps) {
	// Per-agent hide settings (managed agents only)
	const agent = managedAgentId
		? plugin.settings.managedAgents?.find((a) => a.id === managedAgentId)
		: undefined;
	const hideToolCalls = agent?.hideToolCalls ?? false;
	const hideThoughts = agent?.hideThoughts ?? false;

	// Filter out suppressed content types
	const visibleContent =
		hideToolCalls || hideThoughts
			? message.content.filter((c) => {
					if (hideToolCalls && TOOL_CALL_TYPES.has(c.type)) return false;
					if (hideThoughts && THOUGHT_TYPES.has(c.type)) return false;
					return true;
				})
			: message.content;

	// Don't render empty message bubbles
	if (visibleContent.length === 0) return null;

	const groups = groupContent(visibleContent);

	return (
		<div
			className={`agent-manager-message-renderer ${message.role === "user" ? "agent-manager-message-user" : "agent-manager-message-assistant"}`}
		>
			{groups.map((group, idx) => {
				if (group.type === "attachments") {
					// Render attachments (images + resource_links) in horizontal strip
					return (
						<div
							key={idx}
							className="agent-manager-message-images-strip"
						>
							{group.items.map((content, imgIdx) => (
								<MessageContentRenderer
									key={imgIdx}
									content={content}
									plugin={plugin}
									messageId={message.id}
									messageRole={message.role}
									acpClient={acpClient}
									onApprovePermission={onApprovePermission}
								/>
							))}
						</div>
					);
				} else {
					// Render single non-image content
					return (
						<div key={idx}>
							<MessageContentRenderer
								content={group.item}
								plugin={plugin}
								messageId={message.id}
								messageRole={message.role}
								acpClient={acpClient}
								onApprovePermission={onApprovePermission}
							/>
						</div>
					);
				}
			})}
		</div>
	);
}
