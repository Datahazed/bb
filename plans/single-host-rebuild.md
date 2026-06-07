# Single-host rebuild — spec & execution plan

Branch: `sawyer/single-host`, cut from `sawyer-next` @ fd02f9b99 (the tree the research and compat surface were mapped against — not origin/main). Long-lived; phase commits; merges back when the daily-driver switch has stuck.
Status: adversarially verified against the codebase (61-finding pass applied); execution starting.

## 1. Goal

Remove the distributed architecture. One server process runs the coding agents directly; clients (web app, desktop shell, CLI) issue commands to it. The host-daemon process, the server↔daemon transport, multi-host data model, enrollment/machine-auth, and the durable command queue all disappear. The frontend (`apps/app`) and desktop (`apps/desktop`) stay as-is except for a small subtractive allowlist (§5.8).

**Non-goals:** backwards compatibility (fresh DB at switch-over), client auth beyond the network boundary, multi-host ever returning, frontend redesign of any kind. The bb2 post-mortem is the constraint: the rewrite died on frontend quality. The frontend is frozen; this project is backend-only.

## 2. Locked decisions (owner-confirmed)

| # | Decision | Choice |
|---|---|---|
| 1 | Crash durability | In-memory async work + boot reconciliation pass. `thread/environment/project_operations` tables deleted (Phase 2). A crash kills in-flight provisions/turns cleanly. |
| 2 | Turns on restart | Interrupt cleanly on boot with a `server-restarted` interruption reason. No auto-resume; user re-sends. Requires one allowlisted thread-view edit (§5.8.3) — the reason switch is exhaustive with `assertNever`, there is no generic fallthrough. |
| 3 | Event append | Direct transactional SQLite append through one module that owns per-thread sequence assignment and ordering invariants. Daemon spool, producerEventId, payload-hash dedupe, 409 retry, batching all deleted. |
| 4 | Host in the contract | Single synthetic host satisfying the full `hostSchema` (`packages/domain/src/host.ts:10-18`): `{id:'local', name: os.hostname(), type:'persistent', status:'connected', lastSeenAt: <now>, createdAt: <boot>, updatedAt: <boot>}`. Emitted and accepted everywhere the contract carries hostId. `hosts` table deleted; constant lives in code. The FE reads `host.lastSeenAt` (AppSettingsView) and spreads whole Host objects (effective-hosts.ts) — the 4-field shorthand is not enough. |
| 5 | :38887 local API | The server returns **its own port** as `hostDaemonPort` in `/api/v1/system/config` and serves the local-API endpoints itself at root paths with exact shapes (§4.3). Zero frontend/desktop changes. |
| 6 | CLI | Freely changeable. Delete `bb host` commands, `--host` flags, daemon probing; CLI/SDK target the server only. Update `bb guide` templates (full list in §6 Phase 3) in the same change. |
| 7 | Client auth | Tailnet-as-auth status quo. Machine-auth deleted wholesale (better-auth service, `user`/`apikey` tables, enrollment routes, join flows). TLS stays delegated to Tailscale Serve. **Accepted consequence:** the formerly loopback-only local API (open-in-target, pick-folder, provider-clis/install) becomes reachable on the tailnet-exposed main port. |
| 8 | Frontend edits | Small subtractive allowlist only (§5.8). Everything else byte-identical. |
| 9 | Strategy | In-place strangler: `apps/server` stays the living app; absorb the daemon engine, then rewrite lifecycles, then consolidate. Repo runnable and tests green at every phase boundary (dev mode; the packaged launcher path is explicitly allowed to be broken during Phases 1–2, restored in Phase 3). |
| 10 | Test seam | Port the harness first. `createApp(deps)`-style in-process construction with in-memory SQLite survives; the fake provider adapter (`@bb/agent-runtime/test`) becomes the single test seam. Recovery suite shrinks to boot-reconciliation tests. |
| 11 | Lifecycles | `thread-provisioning*` / `thread-lifecycle` / environment lifecycle rewritten from first principles as new modules (this is the "first principles" core of the project), not mechanically shrunk. |
| 12 | Tooling kept | Replay capture / `development.replay` (rehomed into the server), `tests/qa` (rewritten for single-pid). Idle environment eviction deleted (no caller). |
| 13 | Repo shape | Aggressive backend-only package consolidation as a **late phase** with the verified merge map (§7). Frontend packages and the frontend-reachable closure are constrained (§7 header). |
| 14 | project_sources | Table kept (one row per project), `hostId` pinned to `'local'` (FK to hosts dropped, column stays), contract unchanged. |
| 15 | Done bar | Switch early, harden in use: once the core loop passes the live gate + integration suite, point the real desktop/`~/.bb` at it and live on it. |
| 16 | Data at switch | Fresh `bb.db` (backup the old one), recreate projects by hand. Keep `~/.bb/apps` and app-data dirs (Tasks app data lives there). |

## 3. Target architecture

One Node process (`apps/server`) owning:

- **HTTP `/api/v1`** — unchanged public contract (`packages/server-contract`), except the four host-mutation routes are kept **typed but stubbed** (§4.1).
- **WS `/ws`** — unchanged client realtime protocol and terminal WS protocol.
- **Local-API routes** — the former daemon `:38887` surface, served from the same port at root paths, registered **before** the SPA `app.get("*")` catch-all (`apps/server/src/server.ts:356-380` — Hono dispatch is registration-order dependent; a forgotten route returns 200+HTML and the FE silently concludes "no daemon").
- **Engine** (new `apps/server/src/engine/`) — the daemon's living code relocated: runtime manager (one `AgentRuntime` + provider child per environment), the lane scheduler (per-env read/write lanes, per-provider session lanes, per-file write lanes, unarchive-before-submit barriers, provision-cancel bypass — ported deliberately, see Risk R3), workspace provisioning/git ops, confined file ops, terminals (node-pty + scrollback), filesystem watchers (work-status/git-refs/thread-storage/app-data), injected skills staging, codex ChatGPT proxy (inference + voice transcription), thread storage, attachment staging, shell-env injection + bridge bundles.
- **Lifecycle modules** (new, Phase 2) — in-memory async tasks with explicit ownership: thread provision→start→turn→stop, environment provision/cleanup, project deletion drain, boot reconciliation.
- **Event append module** (new) — the single writer: assigns per-thread monotonic sequence, enforces turn/started-before-turn-events and transcript-before-provision-result (the in-process replacement for the daemon ingress 503-retry ordering guard), applies `applyEventEffects` status transitions transactionally, notifies the hub.
- **Product sweep scheduler** — automations (cron claim), manager nudges/ASYNC.md sync, queued-message auto-send, retention/truncation, destroyed-env TTL, **managed-env archive-cleanup** (drives `cleanupRequestedAt` intent — see §5.12), **DB maintenance (incremental vacuum)** (`periodic-sweeps.ts:83-172`). Lifecycle re-drive sweeps are gone.

Provider CLI child processes remain the isolation boundary. The server runs as the user (needs `~/.claude`, `~/.codex/auth.json`, display access for pick-folder — same as the daemon today).

Server and daemon data dirs merge into one: `<dataDir>/{bb.db,logs,thread-storage,personal-workspaces,runtime/global-skills,apps,app-data,attachments}`. `BB_THREAD_STORAGE` override survives. The server takes a data-dir lock on boot (the `daemon.lock` pattern moves up).

### Boot reconciliation (replaces session-open handshake reconciliation)
On startup, in one pass: interrupt threads that were `active` (existing interruption machinery, reason `server-restarted`), settle dangling background tasks, interrupt pending interactions, mark all terminal sessions exited, fail any `provisioning` environments/threads with the standard error events, re-derive pending managed-env cleanup from `cleanupRequestedAt` (§5.12). Nothing resumes.

## 4. Frozen compatibility surface

The Phase 0 contract tests for these are the definition of "frontend unchanged".

### 4.1 REST `/api/v1`
`PublicApiSchema` preserved in full **as types**; runtime behavior changes only for host-mutation routes:
- `GET /hosts` → exactly one Host (full `hostSchema` shape, Decision 4); `GET /hosts/:id` for `'local'`.
- `POST /hosts/join`, `DELETE /hosts/:id/join`, `PATCH /hosts/:id` (rename), `DELETE /hosts/:id`: **kept in the contract types, stubbed at runtime** (clear 410/422 errors). The frozen FE has compile-time references to all four (`apps/app/src/lib/api.ts:1443-1471`, `AppSettingsView.tsx:323-424`, HostJoinDialog/HostRenameDialog/HostDeleteDialog) — deleting them from `PublicApiSchema` breaks the frozen build. They become unreachable once the Hosts settings section is hidden (§5.8.1). SDK wrapper methods (`packages/sdk/src/areas/hosts.ts:27-34`) are deleted in Phase 3 (no CLI callers).
- `'local'` emitted in: `Environment.hostId`, `ProjectSource.hostId`, `TerminalSession.hostId` (incl. terminal WS `attached` payload `session.hostId`), `ThreadListEntry.environmentHostId`, `?include=host` expansions (full hostSchema embedded).
- `'local'` accepted in: `CreateThreadRequest.environment.hostId`, **`CreateManagerThreadRequest.environment.hostId` (required — `api-types.ts:931-966`, sent by `RootComposeView.tsx:651`)**, `CreateProjectSourceRequest.hostId`, `GET /projects/:id/branches?hostId=`, `/system/execution-options` + `/system/providers` optional hostId, environment picker value format `host:${hostId}:${mode}`.
- The round-trip is **three-way**: REST host ids = local-API `/status` `hostId` = picker-submitted hostId. One constant everywhere (Risk R6).
- `GET /api/v1/system/config` keeps `hostDaemonPort: int` (the server's own port) and `voiceTranscriptionEnabled: boolean` — the desktop probe (`apps/desktop/src/server-probe.ts:9-14`) requires both.
- Error taxonomy: `host_unavailable` simply never fires. 504-on-long-op behavior preserved where routes have it today.
- `stopRequestedAt` (`threadSchema`, `packages/domain/src/thread.ts:157`) and `cleanupRequestedAt`/`cleanupMode` (`environmentSchema`) are **frozen wire fields the FE reads** (pending-stop prompt gating in `ThreadDetailPromptArea.tsx:260`, pending-stop timeline row, optimistic stop). They stay in the domain schemas AND stay populated: `stopRequestedAt` while a stop is in flight; cleanup fields as durable product intent (§5.12).

### 4.2 WS protocols
- `/ws` client protocol verbatim: `'host'` stays in `REALTIME_ENTITIES` (subscribe validation), all change-kind strings unchanged, `host-connected/disconnected` just never emitted. Keep strict-out/lenient-in schema discipline.
- Terminal WS at `/ws/threads/:threadId/terminals/:terminalId`, literal shapes (all `.strict()` both directions, `api-types.ts:2049-2124`): client `input{dataBase64} / resize{cols,rows} / close{reason:'user'} / ping` ↔ server `attached{session,nextSeq} / output{chunk:{seq,dataBase64}} / session-updated{session} / exited{session} / error{code,message} / pong`. `close` accepts only `reason:'user'`. Seq-based scrollback replay. Keep `disconnected`-flavored close reasons as dead enum values.
- `GET /threads/:id/events/wait` long-poll (200|204) and the client waiter registry survive the hub gutting.

### 4.3 Local API (former :38887)
Served by the server on its main port at root paths; `hostDaemonPort` answers with that port. Exact shapes per `host-daemon-contract/src/local.ts` (the schema module survives — see §7; it is the contract-test source):
- `GET /status` → `{hostId:'local', connected:true, protocolVersion, serverUrl:<the server's own origin>, supportsNativeFolderPicker, platform}`. **Field is `hostId`, and the FE derives local-host identity from the `connected===true` + `hostId` pair** (`system-config-atoms.ts:165-179`, `useHostDaemon.ts:36-50`) with **no zod parse** — a wrong field name or value fails silently (features vanish, no error). Phase 0 contract test pins the VALUES, not just the shape, and asserts content-type `application/json` (to trip the SPA-catch-all 200+HTML failure mode).
- `GET /workspace-open-targets`, `POST /open-in-target`, `POST /pick-folder` (osascript), `POST /paths/exist`, `GET /provider-clis/status`, `POST /provider-clis/install` (streamed ndjson, content-type `application/x-ndjson`, 400 invalid body / 409 concurrent install; FE zod-parses each line strictly).
- **Not preserved:** the local `GET /health` (plain text `"ok"`) — the server's JSON `/health {ok:true}` wins (desktop probe). Sole consumers were the launcher's daemon-spawn waits, which die in Phase 3. The rehomed local contract drops the `/health` entry.
- CORS must admit the app origin for these routes (`local-app-origins.ts` behavior preserved).
- **Remote-browser semantics:** remote browsers **cannot reach** the local API — the frozen FE hardcodes `http://127.0.0.1:<hostDaemonPort>` (`api-host-daemon.ts:111-120`). These features gracefully disable off-machine, exactly as today; they are NOT remotely actionable. Do not scope work to make them remote. **Accepted hazard:** two bb instances on the same port on two machines now collide on the universal `'local'` id (per-host ids used to disambiguate) — a remote tab whose own machine runs bb on the same port will false-positive `isLocalHost` and act on the wrong machine. Accepted limitation under tailnet-as-auth; noted, not solved.

### 4.4 Desktop
Zero changes required for function: `GET /health {ok:true}` + `/api/v1/system/config` satisfying the probe schema on `127.0.0.1:38886`; single bridge child (`bb-app-bridge.mjs` → `bb-app.js`) unchanged; `owned-runtime.json` reaping unchanged; logs in `<dataDir>/logs`. Allowlisted-only edits: "Server & Daemon Logs" copy in its four locations (§5.8.2). `LOG_VIEWER_COMPONENTS` needs no change (missing host-daemon.log is tolerated).

## 5. Defaults for deferred decisions

1. **Terminal scrollback** dies with the process (status-quo parity).
2. **`client_turn_requests`** table kept with its reduced honest status set; UI renders pending→accepted unchanged. Its `commandId` column is NOT NULL today (`schema.ts:679`): Phase 1 feeds it synthesized dispatch ids; Phase 2 drops `commandId`/`commandType`/`commandCompletedAt` and keys settlement off the in-process turn task.
3. **Workspace status delivery** stays notify-then-pull (`environment-change` hint → client refetch).
4. **Bins**: `bb-app` and `bb` survive; `bb-host-daemon` deleted; `bb-server` deleted if nothing spawns it (verify at Phase 3). Launcher flags `--host-daemon-port/--host-id/--host-type/--enroll-key/--join-code` hard-removed.
5. **Locking**: server takes the data-dir lock; desktop pid-reaping unchanged.
6. **`BB_APP_URL`** survives as CORS/links origin config only; the 422 `app_url_required` join flow dies.
7. **Dev topology**: turbo dev = app + server + dev-env; one fingerprint/restart target; `pnpm dev:host-daemon` deleted; the 4th dev port gone. Dev restarts kill in-flight turns — accepted.
8. **Frontend allowlist (the only frozen-surface edits)**:
   1. `apps/app`: hide the Settings "Hosts" section / "Add another host" button (the join/rename/delete plumbing stays compiled, unreachable).
   2. `apps/desktop`: "Server & Daemon Logs" copy — `menu.ts:3`, `main.ts:508`, `log-viewer.ts:204`, `log-viewer.ts:319`.
   3. `packages/thread-view/src/parse-operation-message.ts` `threadInterruptedTitle`: swap `case "host-daemon-restarted"` for `case "server-restarted": return "Server restarted"` (the switch is exhaustive over `SystemThreadInterruptedReason` with a throwing `assertNever`; the union change in `packages/domain/src/thread-events.ts:208-212` forces this edit — it must land **before** the server ever emits the new reason).
   If execution discovers another genuine dead-end, it stops and asks rather than growing the allowlist silently.
9. **Env-var disposition**: delete `BB_HOST_ENROLL_KEY`/`BB_HOST_ID`/`BB_HOST_NAME`/`BB_HOST_TYPE` (`config/src/env-vars.ts:231-256`), `BB_PROD_HOST_DAEMON_PORT` + `loadHostDaemonPortValue` (`runtime.ts:77`, `ports.ts:113-121`). Rehome `BB_BRIDGE_DIR`/`BB_CLI_DIR` consumption into the server engine (Phase 1) and repoint the launcher from daemonBundleDir to the server bundle (Phase 3). Runtime-shell injection (`runtime-shell-env.ts:99`) switches `BB_HOST_DAEMON_PORT` → the server port in Phase 1 (the injected `bb` CLI's local-API discovery must keep working).
10. **App-data watching**: the engine watches the merged dataDir's app-data dirs directly. `bb.data.onChange` for installed apps must keep firing (live-gate-tested, §8).
11. **Interruption reasons**: `host-daemon-restarted` retires from the union; `server-restarted` added; thread-view edit per §5.8.3. Keep the 15-min `provider-turn-idle` watchdog.
12. **Managed-env cleanup intent is durable product state, not transport state**: `cleanupRequestedAt`/`cleanupMode` columns **stay** ("destroy this env once its last thread archives" must survive restarts — `sweepManagedEnvironments`, nudge-runner reads). The archive-cleanup sweep joins the product sweep scheduler; boot reconciliation re-derives pending cleanup. `stopRequestedAt` also stays as the FE-visible in-flight-stop marker (§4.1); only its queue re-drive semantics die.

## 6. Execution phases

Every phase boundary: `pnpm exec turbo run typecheck`, full unit suites, integration suite green (piped to a file per repo testing rules), plus the phase's own exit criteria. The app must boot and run a real turn at every boundary (dev mode; packaged launcher exempt until Phase 3 per Decision 9).

### Phase 0 — Branch + contract tests
Cut `sawyer/single-host` from `sawyer-next`. Commit this plan. Write the **compatibility contract tests** against the *current* two-process code: `/api/v1/system/config` shape (`hostDaemonPort` + `voiceTranscriptionEnabled`), `GET /hosts` full-hostSchema shape, local-API `/status` (values pinned: `hostId`, `connected:true`; content-type asserted) + `/provider-clis/install` ndjson framing, terminal WS literal message schemas, change-kind string inventory.
**Exit:** contract tests pass on the unmerged codebase.

### Phase 1 — Absorb the engine (transport dies, op tables survive)
Server hosts the daemon engine in-process:
- Create `apps/server/src/engine/`; move (mostly verbatim) `runtime-manager`, the command-router lane scheduler, command handlers (thread/file/workspace/replay), `host-workspace` provisioning + git ops, `host-watcher` wiring, terminals, injected skills, codex proxy, thread-storage root, runtime shell env. Bridge bundles ship in server dist; engine reads `BB_BRIDGE_DIR`/`BB_CLI_DIR` (§5.9).
- **Dispatch shim** replacing the queue: synthesizes a unique commandId per dispatch, threads it through the existing op-row `'queued'` writes (`markLifecycleOperationQueued` requires a string id) and `client_turn_requests`, and maintains an **in-memory in-flight registry** with lookup by commandId, threadId+type, and environmentId+type. The `getCommand`-state guards are re-pointed at it — they are active correctness guards, not bookkeeping: `hasQueuedThreadOperationCommand`/`hasQueuedProvisionCommand` (10s sweeps would otherwise re-dispatch in-flight provisions/starts every tick), `getThreadOperationCommandState` + the provision-cancel pending/fetched branches (stop/cancel would otherwise finalize while engine work runs), and the cross-cutting product guards that outlive the op tables: `hasPendingHostCommandForThread` (manager system messages, nudge/queued-message double-submit gate), `hasExistingThreadArchiveCommand`, `getPendingEnvironmentCommand` (archive/destroy dedupe).
- **Settlement**: reuse the command-result owners registry and `settle*` functions (they only use `commandRow.id/.hostId`, never the table) inside a new settlement transaction that fabricates the commandRow argument; `handleCommandResult`'s row+attempt gating dies with the queue.
- **Daemon→server ingress flows become direct calls**: interactive-request register/interrupt (the 503 turn-ordering retry becomes an in-process ordering guarantee from the append module), `message_user` tool-call → `appendThreadEvent`, app-data change/resync → hub notify (§5.10), attachment staging reads `<dataDir>/attachments` directly (`GET /session/project-attachment-content` dies).
- New event append module; runtime callbacks write events directly (spool deleted).
- Synthetic host `'local'` + local-API routes (registered before the SPA catch-all) + `hostDaemonPort` answer + host-mutation route stubs (§4.1).
- **Schema migration in the same change** (SQLite FK removal = table rebuild; dev DBs are disposable pre-switch): detach `commandId` FKs on the three op tables (columns stay, plain text until Phase 2); drop `pending_interactions.resolvingCommandId` (+ index — write-only dedupe, its only read is a dying legacy sweep); drop `terminal_sessions.daemonSessionId` (+ index); detach `hosts.id` FKs on `environments.hostId` / `project_sources.hostId` / `terminal_sessions.hostId` (columns stay, pinned `'local'`).
- **Dev wiring in this phase** (or the boundary criterion fails): `turbo.json`/root `package.json` drop all `@bb/host-daemon` task references; dev-env drops the `host-daemon` service (`fingerprint.ts:8`, restart target enum); dev runs app+server only.
- **Delete:** `apps/host-daemon`, `/internal/*` routes, `ws/daemon-protocol`, session lease/heartbeat/instanceId machinery, machine-auth + enrollment (+ `user`/`apikey` tables), `host_daemon_sessions/commands/command_attempts` + `hosts` tables, queue/lease/expiry sweeps, `daemon-ingress-scheduler`, the hub's daemon halves, `host-reconnecting`/`waiting-for-host` runtime statuses (values stay in types, never emitted).
- **Harness port in the same phase:** `withHarness` boots the merged server in-process with in-memory SQLite + fake provider adapter; daemon-ws/host-rpc/commands test helpers deleted; the 9 recovery test files quarantined (rewritten in Phase 2); remaining integration files green. (The harness imports `createHostWatcher` from `@bb/host-watcher` — repoint with the move.)
**Exit:** single process serves app+API+local-API; live smoke on both providers (create project → thread → turn → approval → steer → stop → worktree env → status/diff/commit → terminal); contract tests green; integration (minus quarantined) green; transport-symbol grep clean: `rg -l 'enroll|daemon-protocol|host_daemon_sessions|hostDaemonCommandAttempt|src/internal/'` returns nothing in `apps/server` (the broad `host_daemon|hostDaemonCommand` sweep moves to Phase 2/4 exits — lifecycle modules and the contract package legitimately still reference command types until then).

### Phase 2 — Lifecycles from first principles
Rewrite as new modules; delete the old ladders:
- **Thread runtime lifecycle**: provision (env row → worktree/clone + setup script with streamed `system/thread-provisioning` transcript → atomic handoff to start) → start → turn (steer with stale-steer fallback, stop with `activeTurnId`) → idle, as in-memory tasks with AbortController cancellation ("Provisioning stopped by user request" transcript on cancel). `stopRequestedAt` stays populated while a stop task is in flight (§4.1).
- **Environment lifecycle**: provision/reprovision; cleanup with the `safe_to_destroy|already_missing|not_inspectable|blocked_by_changes|probe_failed` preflight taxonomy (host-connected gate dropped); zero-live-threads gate; `cleanupRequestedAt`/`cleanupMode` kept as durable intent + archive-cleanup product sweep (§5.12); destroyed-env TTL sweep.
- **Project deletion drain**; **boot reconciliation** (§3); **product sweep scheduler** split out (automations/nudges/queued messages/retention/DB maintenance/archive-cleanup keep working — the frontend renders all of them).
- **Delete:** `thread_operations`/`environment_operations`/`project_operations`, `lifecycleOperationStateValues` + the `queued` state, lifecycle re-drive sweeps, the dispatch shim's op-row threading, `client_turn_requests.commandId/commandType/commandCompletedAt` (§5.2), `requestThreadStartHandoff`'s queue plumbing. (`stopRequestedAt`/`cleanupRequestedAt`/`cleanupMode` are NOT deleted — frozen wire fields + durable product intent, §4.1/§5.12.)
- Interruption-reason union swap + the allowlisted thread-view edit (§5.8.3), landing before the server emits `server-restarted`.
- Rewrite the quarantined recovery suite as boot-reconciliation tests: `kill -9` mid-provision / mid-turn / with-pending-approval / with-open-terminal → boot marks everything interrupted, UI shows the standard interrupted states, no zombies.
**Exit:** old lifecycle modules deleted (`thread-provisioning*`, `thread-lifecycle`, `environment-provisioning*`, `environment-cleanup*` replaced); kill-9 matrix passes; `rg -l 'hostDaemonCommand|thread_operations'` clean in `apps/server/src`; live smoke + contract + integration green.

### Phase 3 — Clients, launcher, dev topology
- **CLI/SDK**: delete `bb host *`, `--host` flags and the CLI's hostId resolution/injection (`spawn.ts buildSpawnEnvironment`, `manager.ts:112`, `project.ts:83` — the `EnvironmentArgs` contract schema itself is frozen by §4.1 and must not change), `fetchLocalHostId` daemon probing, SDK `hosts.update/delete/createJoin/cancelJoin`.
- **bb guide / templates**: delete `bb-guide-hosts.md` + its registry entry (`packages/sdk/src/areas/guide.ts:26`), scrub `--host` docs from `bb-guide-managers/threads/projects.md`, fix the Host definition + chapter list in `bb-guide-overview.md`, rework `manager-agent-instructions.md` host sections incl. the `{{hostId}}` template variable, `bb-guide-app.md:146`.
- **Launcher**: single child; delete `bb-host-daemon` bin, join/enroll commands+flags+handshake, `daemon.lock` (server data-dir lock replaces it); repoint `BB_BRIDGE_DIR`/`BB_CLI_DIR` to the server bundle.
- **Dev**: port derivation drops the daemon port; `request-dev-restart` protocol-version escalation deleted; `local-app-origins.ts` simplified (CORS header behavior preserved).
- **Frontend allowlist edits** §5.8.1–.2 land here (the thread-view edit landed in Phase 2).
- **Docs**: delete `docs/additional-hosts.md`; rewrite `docs/multiple-devices.md` (join refs), `docs/platform-support.md` (process model, CLI env), `docs/configuration.md` (flags/ports), `README.md:136-167` (system overview), `apps/desktop/README.md`, `packages/bb-app/README.md:62-116`.
- **tests/qa** rewritten for single-pid spawn (no host-join, one process to orphan-clean).
**Exit:** desktop attach + owned modes verified against the branch build; `npx bb-app` boots one process; CLI smoke (`spawn/tell/wait/status/interactions`) green; qa suite green.

### Phase 4 — Package consolidation (merge map §7)
Execute the merge map in dependency order, one package per commit where practical. Re-verify the consumer graph at phase start (it will have shifted during Phases 1–3).
**Exit:** package count per merge map; full typecheck + test suite green; no `@bb/host-*` imports outside the frontend-reachable closure's `@bb/host-daemon-contract` (which stays, slimmed — §7).

### Phase 5 — Switch-over & hardening
- Full live gate (§8) on both providers + pi bridge if configured.
- Back up `~/.bb/bb.db`; fresh DB; keep `~/.bb/apps` + app-data; recreate projects.
- Point the daily desktop at the branch build; live on it. Punch list bugs fixed on the branch; merge to `main` when it has stuck (target: one week of real use without falling back).
**Exit:** owner daily-driving; no fallback for 7 days; branch merged.

## 7. Package consolidation map (backend-only, Phase 4)

**Frontend-reachable closure (constrained — changes here risk the frozen build):** `core-ui`, `thread-view`, `templates`, `fuzzy-match`, `domain`, `config`, `server-contract`, `host-daemon-contract`, `agent-providers`, and `replay-capture` (transitively via `server-contract/src/api-types.ts:2351` importing `@bb/replay-capture/schema`). Consolidation must not change any import path these packages or `apps/app` use.

Real workspace package count is 25 (5 of the 30 `packages/*` dirs have no package.json and are invisible to pnpm). Verified consumer graph (2026-06-07):

| Package | Fate |
|---|---|
| `workflow-runtime` | Delete day one — not a workspace package at all (no package.json/src/dist), zero importers |
| `agent-provider-auth`, `host-runtime-material`, `sandbox-host`, `sandbox-image` | Delete (dist-only vestiges, no workspace imports) |
| `host-daemon-contract` | **Slim & keep under the same name** (frozen FE imports it from ~16 runtime files incl. the local client factory, zod schemas, `WorkspaceResolutionFailure` — also imported by `server-contract/api-types.ts:46` — and `HOST_DAEMON_PROTOCOL_VERSION`). Keep `local.ts` (minus the `/health` entry), `workspaceResolutionFailure`, the protocol-version constant; delete the transport halves (`session.ts`, `local-state.ts`, durable command/result types except `workspaceResolutionFailure`). |
| `host-workspace` | Fold into `apps/server` engine (consumer: the absorbed daemon side) |
| `host-watcher` | Fold into `apps/server` engine (consumers: host-daemon + the integration harness — fold must land with/after the Phase 1 harness port) |
| `agent-providers` | **Stays** (frozen FE imports it directly — `provider-icon.ts:4`; `config` imports it and config is in the FE graph; merging into agent-runtime would pull the node runtime into the FE dependency chain) |
| `process-utils` | **Stays** (consumers: agent-runtime, scripts, server engine — all survivors; desktop has zero usage) |
| `replay-capture` | **Stays** (in the FE closure via server-contract; agent-fixtures + server engine also consume it) |
| `agent-fixtures` | Fold into `apps/server` test helpers (sole consumer: `test/helpers/timeline-benchmark.ts`) unless the capture/promote CLI toolchain is wanted standalone — decide at Phase 4. (The test seam is `@bb/agent-runtime/test`, not this.) |
| `secret-storage` | Audit after machine-auth dies → fold into `apps/server` or delete if orphaned |
| `hono-typed-routes` | Stays (server-contract foundation) |
| `domain`, `db`, `server-contract`, `sdk`, `config`, `logger`, `agent-runtime`, `test-helpers`, `dev-env`, `scripts`, `tsconfig`, `bb-app`, `templates`, `fuzzy-match`, `core-ui`, `thread-view` | Stay |

Target: 25 → ~18 workspace packages, every survivor having ≥2 real consumers or being a genuine contract/boundary package.

## 8. Validation playbook

- **Typecheck/build/test**: `pnpm exec turbo run typecheck --filter=@bb/<pkg>`; full integration: `pnpm exec turbo run test --filter=@bb/integration-tests --force > /tmp/test-out.txt 2>&1` then read the file.
- **Contract tripwire**: the Phase 0 contract tests, run in every phase.
- **Live gate** (dev instance, both providers): create project (unmanaged path + managed worktree) → spawn thread → real turn with tool use → approval flow → steer mid-turn → stop → re-send (provider session resume) → git status/diff/commit/squash-merge → terminal open/use/close → archive with dirty-worktree safe-cleanup prompt → attachment send → voice transcription (if codex auth present) → automation fires → manager hires worker → **file-mention picker lists files → branch dropdown lists branches → raw file preview renders → pick-folder/open-in-target actions from the UI → installed Tasks app sees a `bb.data.onChange` round-trip**.
- **Kill-9 matrix** (Phase 2+): SIGKILL during provision / active turn / pending approval / open terminal → reboot → assert interrupted states, no zombie provider processes (`pgrep`), boot reconciliation events present.
- **Desktop**: attach mode against dev instance; owned mode against a packaged build (signed — see syspolicyd memory).

## 9. Risks

- **R1 — :38887 stealth contract.** Folder picker / open-in-editor / CLI-install toasts break **silently** on any drift (the FE doesn't zod-parse `/status` and treats failures as "no daemon"). Mitigation: Phase 0 contract tests pin values + content-type; route registration before the SPA catch-all.
- **R2 — Desktop probe brittleness.** Wrong `/system/config` shape bricks attach-vs-own. Same mitigation.
- **R3 — Lane semantics loss.** The command-router's serialization prevents real races (archive-after-unarchive, concurrent provisions). The scheduler is ported as a unit with its tests; the dispatch shim preserves the guard semantics (Phase 1 bullets).
- **R4 — Restart UX regression.** Every dev restart now kills turns. Boot reconciliation must be loud and clean or this feels like data loss.
- **R5 — Event-ordering enforcement loses its home.** Sequence assignment, turn/started-first, transcript-before-result, and the ingress 503-retry ordering guard all move into the new append module; its unit tests port the daemon's spool-ordering assertions.
- **R6 — hostId round-trip mismatch.** One constant, three-way (REST = `/status` = picker), emitted = accepted, value-pinned contract tests.
- **R7 — Test-net collapse mid-rebuild.** Harness ports in Phase 1, not after.
- **R8 — Headless/launchd future.** Server inherits the daemon's interactive-user assumptions (`~/.codex/auth.json`, `~/.claude`, osascript). Documented constraint, not solved here.
- **R9 — Re-dispatch storms if guards are dropped.** The 10s sweeps live until Phase 2; without the in-flight registry they re-dispatch minute-long provisions every tick (verification finding). The registry is not optional Phase 1 scope.

## 10. P1a → P1b/P1c handoff notes (from the scaffold review)

P1b wiring requirements recorded by the porters:
1. Build `runtimeShellEnv` via `prepareRuntimeShellEnv({appsRootPath, bbExecutableDirectory, hostDaemonPort: <server port>, serverUrl})` — `serverPort` is now required; the injected env var keeps the `BB_HOST_DAEMON_PORT` name pointed at the server port (§5.9).
2. Register local-API routes **before** the SPA `app.get("*")` catch-all; verify any global `app.onError` passes HTTPException statuses through (FE depends on 400/409 from `/provider-clis/install`).
3. Bind `createThreadEventAppender` into the engine's ports at boot; the router's ordering barriers rely on append durability only (flush covers append transactions + event effects, not the detached follow-up batch — matches daemon ingress semantics).
4. `ports.interactiveRequests.interrupt` must be effectively infallible in-process; boot reconciliation owns interrupt recovery (the daemon's durable pending-interrupt queue + retry timer were deliberately not ported).
5. Live-check `runtime-shell-env`'s default CLI path resolution (`createRequire('@bb/cli/package.json')`) at the P1b boundary — only the override is unit-tested.
6. `Engine.shutdown` currently passes the frozen wire value `'daemon-disconnect'` as the terminal close reason — P1b/P2 may add an honest reason as a domain enum addition (dead-value rule per §4.2 still applies).

Tracked deferrals:
7. **P1c-blocking:** the four daemon dispatch-handler test suites (environment/thread/workspace/host-branches dispatch, ~3.5k lines) were not ported — port or consciously drop them before `apps/host-daemon` is deleted.
8. `evictIdleEnvironments` was restored against Decision 12 (only callers are ported tests) — delete deliberately in Phase 2 with the test rework, do not let it survive silently.
9. Preserved daemon quirks (deliberate): `/paths/exist` oversized batch → 500 not 400; `/status.connected` constant `true`; codex client User-Agent literal `bb-host-daemon` (rename free in P1c).

## 11. Open items to resolve during execution (tracked, non-blocking)

1. Whether the frontend validates host id shape anywhere (affects `'local'` literal) — Phase 1.
2. `bb-server` bin: confirm nothing spawns it → delete — Phase 3.
3. Injected-shell `bb` CLI local-API discovery after the port switch (§5.9) — Phase 1.
4. `secret-storage` + `agent-fixtures` final fates — Phase 4 start (other §7 audits are done; do not re-audit `agent-providers`/`process-utils`/`workflow-runtime`/`replay-capture`).
5. Synthetic host `name` source: `os.hostname()` chosen (Decision 4); confirm no FE surface renders it oddly — Phase 1.
6. Replay capture storage location in merged dataDir — Phase 1 (when the handler moves).
