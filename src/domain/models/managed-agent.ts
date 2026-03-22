export type ManagedAgentStatus = "idle" | "running" | "scheduled";

export interface ManagedAgent {
	id: string;
	name: string;
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
}

export function createManagedAgent(name = "New Agent"): ManagedAgent {
	return {
		id: crypto.randomUUID(),
		name,
		instructionsPath: null,
		tools: [],
		mcps: [],
		schedule: null,
		status: "idle",
		createdAt: Date.now(),
	};
}
