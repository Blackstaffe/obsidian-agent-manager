export type ManagedAgentStatus = "idle" | "running" | "complete" | "fading" | "scheduled";

export const AGENT_CATEGORIES = [
	"Administration",
	"Business Development",
	"Finance",
	"Legal",
	"Marketing",
	"Research",
	"Sales",
] as const;

export type AgentCategory = (typeof AGENT_CATEGORIES)[number] | null;

export interface ManagedAgent {
	id: string;
	name: string;
	/** Category for grouping in the explorer */
	category: AgentCategory;
	/** Vault-relative path to a markdown file used as system instructions */
	instructionsPath: string | null;
	/** Tool names enabled for this agent */
	tools: string[];
	/** MCP server names enabled for this agent */
	mcps: string[];
	/** Cron-style or human-readable schedule string, null = on-demand */
	schedule: string | null;
	status: ManagedAgentStatus;
	createdAt: number;
	/** Truncated preview of the last assistant message */
	lastMessagePreview?: string;
	/** Timestamp (ms) of the last activity */
	lastActiveAt?: number;
	/** Duration (ms) of the last run */
	lastRunDuration?: number;
	/** Hide tool call output in chat view */
	hideToolCalls?: boolean;
	/** Hide thinking/reasoning output in chat view */
	hideThoughts?: boolean;
	/** Auto-approve permission requests for this agent */
	autoApprove?: boolean;
}

export function createManagedAgent(name = "New Agent", category: AgentCategory = null): ManagedAgent {
	return {
		id: crypto.randomUUID(),
		name,
		category,
		instructionsPath: null,
		tools: [],
		mcps: [],
		schedule: null,
		status: "idle",
		createdAt: Date.now(),
	};
}
