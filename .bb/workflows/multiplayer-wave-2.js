export const meta = {
  name: "multiplayer-wave-2",
  description:
    "Wave 2: attribution + agent-visible speakers (WS3) and hub-derived presence (WS4) in parallel",
  phases: [
    {
      title: "Implement",
      detail: "WS3 attribution and WS4 presence, disjoint ownership",
    },
  ],
};

const shared = `
You are one of two parallel workers implementing "multiplayer bb" wave 2 in a
SHARED working tree on branch bb/multiplayer. Waves 0-1 are committed
(26722ea2d, 9571629e3) and already in your workspace. Another worker is
editing a disjoint set of files concurrently — touch ONLY files under YOUR
OWNERSHIP and scope validation with turbo --filter.

Landed foundation you build on:
- @bb/domain claimed-identity: ClaimedIdentity { handle, displayName,
  imageUrl: string|null, clientId }; identity is claimed-only and the server
  never authorizes by it, only attributes.
- @bb/domain change-kinds: typingMessageSchema (inbound client ws message),
  presenceViewerSchema, threadPresenceMessageSchema,
  presenceSummaryMessageSchema (+ lenient counterparts).
- @bb/db: collaborators table + data module; nullable attribution columns
  events.actor_handle, threads.created_by_handle,
  queued_thread_messages.actor_handle, pending_interactions.resolved_by_handle
  (all plain text, NULL = not human-initiated / pre-multiplayer).
- apps/server: every /api/v1 request resolves an actor — use
  getRequestActor(context) from apps/server/src/services/actors.ts. Every
  client ws socket has an actor — getSocketActor(socket) from
  apps/server/src/ws/socket-actors.ts.

Rules: follow AGENTS.md at the repo root; no new dependencies; no git commits
or git add; pipe slow command output to /tmp files and read the file. Two
KNOWN-FLAKY server tests unrelated to this work: the install-machine-script
404-fallback test and the public-host-management revoke-machine timeout — if
one fails, rerun that file in isolation before treating it as your regression.
Your final message is a machine-consumed report: outcome, files changed,
key API surfaces/behavior, checks run with actual results, blockers.
`;

const ws3Prompt = `${shared}
YOUR OWNERSHIP: apps/server/src/routes/threads/**, apps/server/src/services/
threads/**, packages/db/src/data/** (events/threads/queued-thread-messages/
pending-interactions modules), packages/host-daemon-contract/**,
apps/host-daemon/**, and their tests. Do NOT modify: apps/server/src/server.ts,
apps/server/src/ws/**, packages/server-contract/** (the other worker owns
those this wave), packages/db/src/schema.ts, packages/db/src/migrate.ts,
packages/domain/**, apps/connect/**.

Objective: attribution end to end — every human-initiated action records its
actor, and the agent can see who is speaking in multi-human threads.

Tasks:
1. Message sends: POST /threads/:id/send (apps/server/src/routes/threads/
   actions.ts, the send handler) resolves the actor via getRequestActor and
   threads it through sendThreadMessage (apps/server/src/services/threads/
   thread-send.ts) so the client/turn/requested events row is written with
   actor_handle (insert path: appendAndQueueSendThreadMessageInTransaction ->
   packages/db/src/data/events.ts insertEvents). Queued sends carry
   actor_handle on queued_thread_messages and preserve it when the queue is
   drained into a real send. Messages sent by other threads or plugins (the
   trigger/senderThreadId paths) stay NULL — actor attribution applies to the
   human request path only. IMPORTANT CONTRACT RULE: the actor comes ONLY from
   getRequestActor, never from any request-body field.
2. Thread create: POST /threads (routes/threads/base.ts ->
   services/threads/thread-create.ts) writes threads.created_by_handle for
   human-origin creates; agent/plugin origins stay NULL.
3. Stop/interrupt: POST /threads/:id/stop records the acting handle on the
   stop it produces — attach it to the lifecycle/system event data the stop
   path already emits (inspect requestThreadStopForCurrentState and the run
   lifecycle events; add the actor to the event payload, do not invent a new
   event type).
4. Approvals: POST /threads/:id/interactions/:interactionId/resolve
   (routes/threads/interactions.ts -> pendingInteractions service) records
   pending_interactions.resolved_by_handle for the resolving request.
5. Agent-visible speakers: extend the turn command payload built in
   thread-send.ts (prepareReadyThreadTurnCommand /
   prepareTurnSubmitCommandPayload) with an OPTIONAL speaker
   { handle, displayName } field in packages/host-daemon-contract, populated
   ONLY when the thread has 2 or more distinct human actors recorded (count
   distinct non-null events.actor_handle for the thread — add a targeted query
   to the events data module, no full-table scans in JS). In apps/host-daemon,
   render the speaker as a short annotation prefixed to the user message text
   handed to the provider session (e.g. "[from @handle] " — inspect how the
   daemon builds provider input from the turn payload and match its idioms).
   Single-human threads must produce byte-identical provider input to today.
6. Because the turn payload crosses the server<->daemon wire, bump
   HOST_DAEMON_PROTOCOL_VERSION in packages/host-daemon-contract/src/
   commands.ts from 58 to 59 (repo rule: any wire-visible change bumps it).
7. Tests (in-memory sqlite via createConnection(":memory:") + migrate(db),
   never mock the db): send writes actor_handle; queued send preserves it
   through the drain; thread create records created_by_handle for human
   origin and NULL for plugin origin; resolve records resolved_by_handle;
   speaker present only at >=2 distinct human actors; daemon-side annotation
   rendering if the daemon has unit-testable prompt assembly.

Validation: pnpm exec turbo run typecheck --filter=@bb/server
--filter=@bb/db --filter=@bb/host-daemon-contract --filter=@bb/host-daemon,
then turbo test for the same filters, piped to /tmp files.
`;

const ws4Prompt = `${shared}
YOUR OWNERSHIP: apps/server/src/ws/** (including hub.ts and client-protocol.ts),
apps/server/src/server.ts (minimal wiring only), a new presence service module
under apps/server/src/services/, new presence route files under
apps/server/src/routes/, packages/server-contract/** (presence route contract),
and their tests. Do NOT modify: apps/server/src/routes/threads/**,
apps/server/src/services/threads/**, packages/db/**, packages/domain/**,
packages/host-daemon-contract/**, apps/host-daemon/**, apps/connect/**.

Objective: hub-derived presence — who is viewing which thread, with typing,
broadcast live and snapshot-queryable.

Design (decided): a client socket with a claimed actor that is subscribed to
thread-detail:<threadId> is "viewing" that thread. Presence is DERIVED from
the hub's existing subscription bookkeeping — no heartbeats, nothing
persisted. Viewers are deduped by handle across sockets/devices.

Tasks:
1. Presence tracking: build a presence service that observes subscribe/
   unsubscribe/socket-close for thread-detail targets (hook the hub's
   subscribe/unsubscribe/unregisterClient paths; get actors via
   getSocketActor). Maintain per-thread viewer sets keyed by handle with
   per-handle socket refcounts so closing one of two tabs does not drop
   presence.
2. Typing: implement the currently-no-op "typing" case in apps/server/src/ws/
   client-protocol.ts — mark the sending socket's actor as typing in that
   thread with a ~6 second TTL (timer-based expiry; expiry emits a presence
   update). Only meaningful when that actor is a current viewer.
3. Broadcasts: on any viewer-set or typing change for a thread, send
   threadPresenceMessageSchema-shaped messages ({ type: "thread-presence",
   threadId, viewers: [{handle, displayName, imageUrl, typing}] }) to that
   thread's thread-detail subscribers, and presenceSummaryMessageSchema-shaped
   ({ type: "presence-summary", threads: { [threadId]: handles[] } }) to
   thread-list subscribers (summary may carry only changed threads' entries —
   document the merge semantics you choose; an empty array removes a thread's
   entry). Validate outgoing messages with the strict schemas at the send
   boundary, matching how changed-messages are produced today. Suppress
   no-op rebroadcasts (unchanged viewer set and typing state).
4. Snapshot: GET /api/v1/presence returning current viewers per thread
   ({ threads: { [threadId]: viewers[] } }). Add the route to
   packages/server-contract following existing public-api conventions and
   implement it in apps/server/src/routes/ (register it wherever public routes
   are registered). Follow the repo rule: no accepted-but-ignored fields.
5. Self-visibility: include the requesting/viewing actor in viewer sets (the
   UI can filter itself out client-side later); do not special-case the local
   operator.
6. Tests via the existing server test harness: subscribe -> viewer appears;
   dedupe across two sockets with the same handle; unsubscribe/close ->
   removed only when the last socket goes; typing TTL expiry; broadcast
   payloads validate against the strict schemas; snapshot route returns the
   derived state; no-op suppression.

Validation: pnpm exec turbo run typecheck --filter=@bb/server
--filter=@bb/server-contract, then turbo test for @bb/server and
@bb/server-contract if it has tests, piped to /tmp files.
`;

phase("Implement");
const results = await parallel([
  () =>
    agent(ws3Prompt, {
      label: "WS3 attribution + speakers",
      provider: "codex",
      model: "gpt-5.6-sol",
      reasoningLevel: "high",
    }),
  () =>
    agent(ws4Prompt, {
      label: "WS4 hub presence + typing",
      provider: "codex",
      model: "gpt-5.6-sol",
      reasoningLevel: "high",
    }),
]);
return { ws3: results[0], ws4: results[1] };
