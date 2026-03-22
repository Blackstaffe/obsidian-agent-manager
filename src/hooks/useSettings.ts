import { useSyncExternalStore } from "react";
import type AgentManagerPlugin from "../plugin";

/**
 * Hook for subscribing to plugin settings changes.
 *
 * Uses useSyncExternalStore to safely subscribe to the external settings store,
 * ensuring React re-renders when settings change.
 *
 * @param plugin - Plugin instance containing the settings store
 * @returns Current settings snapshot (AgentManagerPluginSettings)
 */
export function useSettings(plugin: AgentManagerPlugin) {
	return useSyncExternalStore(
		plugin.settingsStore.subscribe,
		plugin.settingsStore.getSnapshot,
		plugin.settingsStore.getSnapshot,
	);
}
