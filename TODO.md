# Agent Manager TODO

## Minor

- [ ] Fix alignment of explorer to match file explorer
- [ ] Fix chevron sizes to match file explorer
- [ ] Make quickview text clickable to open agent
- [ ] Investigate option to suppress tool use and thinking output from chat view (user-facing toggle)

---

## Phase 0: Background Agent Processes ⚠️ ARCHITECTURE BLOCKER

Decouple agent processes from UI tabs so agents can run headlessly. **This is the foundation for all later phases** — heartbeat/scheduler, agent-to-agent, and remote triggering all require spawning and managing agents without a UI tab.

**Blocks**: Phase 1A (Scheduler), Phase 2 (Agent-to-Agent), Phase 3 (Remote Triggering)

### Architecture
Currently: `AgentRunView.onClose()` → kills AcpAdapter → kills child process. The fix is to move process ownership from the UI tab to a plugin-level **AgentProcessManager** service.

```
Plugin
  └── agentProcessManager: AgentProcessManager
        └── Map<managedAgentId, AgentProcess>
              ├── adapter: AcpAdapter (owns the child process)
              ├── messages: ChatMessage[] (buffered while UI detached)
              ├── sessionState: { sessionId, modes, models, ... }
              ├── isSending: boolean
              ├── listeners: Set<callback> (UI subscribers)
              └── status: ManagedAgentStatus
```

- UI tab mounts → subscribes to process, hydrates from buffered messages
- UI tab closes → unsubscribes, process keeps running
- Explorer panel reads status directly from process manager (dots work without UI)

### Implementation Steps

- [ ] Create `src/shared/message-mutations.ts` — extract message mutation logic from useChat into pure functions (`applySessionUpdate(messages, update) → messages`)
- [ ] Create `src/domain/models/agent-process.ts` — `AgentProcessState` interface (adapter, messages, session, isSending, status, listeners)
- [ ] Create `src/shared/agent-process-manager.ts` — core service: `startProcess()`, `stopProcess()`, `getProcess()`, `subscribe()`, `sendMessage()`, `cancelOperation()`, `stopAll()`
- [ ] Wire into `plugin.ts` — instantiate in `onload()`, call `stopAll()` in `onunload()`/quit, expose as public property
- [ ] Create `src/hooks/useAgentProcess.ts` — React hook that subscribes to AgentProcessManager, returns same shape as `UseChatControllerReturn`
- [ ] Update `AgentRunView.tsx` — remove process kill from `onClose()`, just unmount React root
- [ ] Update `AgentRunChat.tsx` — use `useAgentProcess` instead of `useChatController`
- [ ] Move session-save logic to process manager (save on turn end regardless of UI state)
- [ ] Handle permissions while UI detached — queue pending requests, drain on reconnect
- [ ] Move status dot updates to process manager (update `managedAgents` settings directly)

### Considerations
- **Permission queue**: If agent requests permission while tab is closed, buffer it and show when tab reopens (or auto-approve per settings)
- **Auto-export**: Should trigger on process stop, not tab close
- **Multiple tabs**: Multiple tabs can subscribe to same process; only one handles permissions
- **Memory**: Consider message limit for very long-running agents

---

## Phase 1A: Heartbeat / Scheduler (depends on Phase 0)

Agents wake up on a schedule, run headlessly, show status in explorer. Click to load session.

- [ ] Add `lastRunAt`, `lastRunResult`, `heartbeatEnabled`, `runDuration` to ManagedAgent model
- [ ] Add `heartbeatConfig` to plugin settings (globalEnabled, interval, catchUpOnStartup, maxConcurrentRuns)
- [ ] Add `croner` dependency for cron expression parsing
- [ ] Create `schedule-utils.ts` (parseSchedule, getNextRun, isOverdue, toHumanReadable)
- [ ] Create `heartbeat-scheduler.ts` (60s tick, checks which agents are due)
- [ ] Create `heartbeat-runner.ts` (headless agent execution, saves session per-process)
- [ ] Startup catch-up (run overdue agents on Obsidian open)
- [ ] UI: heartbeat toggle + schedule validation in AgentSettings
- [ ] UI: last/next run time in AgentPanelView
- [ ] UI: global heartbeat settings in plugin settings tab

## Phase 1B: Agent Memory ⚠️ DESIGN TBD

Persistent memory for agents across sessions. **Approach not finalized — may change.**

### Current thinking: Plugin-managed (model-agnostic)
Plugin reads `memory.md` and injects it via auto-mention alongside instructions. At session end, plugin extracts updates and writes back. Any ACP agent gets the same memory because the plugin controls injection.

### Alternative considered: CLAUDE.md + per-process working directory
Set each agent's `cwd` to a process folder containing a `CLAUDE.md` that tells Claude to read/write `memory.md`. Simpler but Claude Code-specific — Gemini CLI and custom agents wouldn't pick up the CLAUDE.md.

### Tasks (pending design decision)
- [ ] Decide: plugin-managed injection vs agent-native CLAUDE.md vs hybrid
- [ ] Add `memoryPath` to ManagedAgent model
- [ ] Add `agentMemoryConfig` to plugin settings (defaultFolder, autoCreate, template)
- [ ] Create `memory-manager.ts` (ensureMemoryFile, getMemoryPath, createMemoryTemplate)
- [ ] Memory injection in useChatController as second auto-mentioned resource
- [ ] Support multiple auto-mention resources in message-service.ts
- [ ] UI: memory file picker in AgentSettings
- [ ] Auto-create memory file on first run
- [ ] Optional: per-agent `workingDirectory` setting (enables CLAUDE.md discovery for Claude Code agents)

## Phase 2: Agent-to-Agent Communication (depends on Phase 0)

Internal dispatch API — agents trigger other agents and receive results.

- [ ] Design dispatch mechanism (custom ACP tool vs MCP server vs hybrid)
- [ ] Create `AgentRequest` model (fromAgent, toAgent, message, status, result)
- [ ] Create `agent-dispatch.ts` service with permission validation
- [ ] Permission config UI (allowed agent pairs, rate limiting)
- [ ] Request/result storage in plugin data directory

## Phase 3: Remote Triggering & Monitoring (depends on Phase 0)

Android app for triggering agents and viewing status.

### 3.1 Local HTTP Server
- [ ] Node.js HTTP server on configurable port with API key auth
- [ ] REST endpoints: GET /api/agents, POST /api/agents/{id}/run, GET /api/agents/{id}/status
- [ ] Settings UI for server config (enable, port, API key)

### 3.2 WebSocket Live Updates
- [ ] WebSocket support for real-time status push to connected clients

### 3.3 Android App (separate project)
- [ ] React Native or Kotlin app connecting to plugin HTTP server
- [ ] Agent list, status detail, trigger button, run history views

### 3.4 Cloud Relay (separate project)
- [ ] Lightweight relay server for true remote access without VPN
- [ ] Plugin connects outbound, mobile app connects to same relay

## Security & Permissions

Per-process sandboxing — each agent gets restricted file access.

- [ ] Design per-agent workspace folders (each process gets its own directory)
- [ ] Implement file access restrictions (agents can only access their own folder by default)
- [ ] Explicit file/folder permission grants (whitelist paths an agent can read/write)
- [ ] Permission config UI per agent
- [ ] Enforce restrictions in ACP adapter or instruction injection

---

*Full architecture details: see plan at `.claude/plans/witty-riding-lagoon.md`*
