# Agent Manager TODO

## Minor

- [ ] Fix alignment of explorer to match file explorer
- [ ] Fix chevron sizes to match file explorer
- [ ] Make quickview text clickable to open agent

---

## Phase 1A: Heartbeat / Scheduler

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

## Phase 1B: Agent Memory

Persistent memory via vault markdown files, injected alongside instructions.

- [ ] Add `memoryPath` to ManagedAgent model
- [ ] Add `agentMemoryConfig` to plugin settings (defaultFolder, autoCreate, template)
- [ ] Create `memory-manager.ts` (ensureMemoryFile, getMemoryPath, createMemoryTemplate)
- [ ] Memory injection in useChatController as second auto-mentioned resource
- [ ] Support multiple auto-mention resources in message-service.ts
- [ ] UI: memory file picker in AgentSettings
- [ ] Auto-create memory file on first run

## Phase 2: Agent-to-Agent Communication

Internal dispatch API — agents trigger other agents and receive results.

- [ ] Design dispatch mechanism (custom ACP tool vs MCP server vs hybrid)
- [ ] Create `AgentRequest` model (fromAgent, toAgent, message, status, result)
- [ ] Create `agent-dispatch.ts` service with permission validation
- [ ] Permission config UI (allowed agent pairs, rate limiting)
- [ ] Request/result storage in plugin data directory

## Phase 3: Remote Triggering & Monitoring

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
