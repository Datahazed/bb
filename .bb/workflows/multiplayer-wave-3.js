export const meta = {
  name: "multiplayer-wave-3",
  description:
    "Wave 3: multiplayer UI (WS5, Fable) and CLI/SDK/membership surfaces (WS6, Sol) in parallel",
  phases: [
    {
      title: "Implement",
      detail: "WS5 app UI and WS6 CLI/SDK/tunnel surfaces, disjoint ownership",
    },
  ],
};

const shared = `
You are one of two parallel workers implementing "multiplayer bb" wave 3 in a
SHARED working tree on branch bb/multiplayer (waves 0-2.5 committed through
5cfbcb190, already in your workspace). Another worker is editing a disjoint
set of files concurrently — touch ONLY files under YOUR OWNERSHIP and scope
validation with turbo --filter.

Landed foundation:
- Identity is CLAIMED-ONLY: clients self-assert via the x-bb-claimed-identity
  header (@bb/domain claimed-identity module: ClaimedIdentity { handle,
  displayName, imageUrl: string|null, clientId }, encodeClaimedIdentityHeader,
  decodeClaimedIdentityHeader, normalizeHandle, CLAIMED_IDENTITY_HEADER).
  /ws also accepts the same encoded value via the "identity" query parameter.
  Absent identity = local-operator default server-side. The server NEVER
  authorizes by identity, only attributes.
- Presence: server broadcasts strict-schema "thread-presence" ({ threadId,
  viewers: [{handle, displayName, imageUrl, typing}] }) to thread-detail
  subscribers and partial "presence-summary" ({ threads: { [threadId]:
  handles[] }, empty array removes an entry }) to thread-list subscribers;
  lenient parse schemas exported from @bb/domain change-kinds. Snapshot at
  GET /api/v1/presence (contract in packages/server-contract/src/api/
  presence.ts). Typing: ws client message { type: "typing", threadId,
  typing } with a 6s server TTL.
- Attribution read model: TimelineUserConversationRow.actorHandle
  (string|null) is populated end to end; events.actor_handle etc. recorded
  server-side for sends/creates/stops/approvals.
- Connect cloud: server_member table + owner-session member management API on
  the worker (GET/POST /api/servers/:serverId/members, DELETE .../members/
  :userId), gate admits members, admission audit rows.

Rules: follow AGENTS.md at the repo root; no new dependencies; no git commits
or git add; pipe slow command output to /tmp files and read the file. Two
KNOWN-FLAKY server tests: install-machine-script 404-fallback and
public-host-management revoke-machine timeout — rerun in isolation before
treating either as your regression. Your final message is a machine-consumed
report: outcome, files changed, key surfaces/behavior, checks run with actual
results, blockers.
`;

const ws5Prompt = `${shared}
YOUR OWNERSHIP: apps/app/** only. Do NOT touch apps/server, apps/cli,
apps/connect, packages/** (all read-model plumbing you need already exists).

Objective: the visible multiplayer layer — claimed-identity picker, presence
avatars, typing, follow-mode, and message authorship in the bb app.

Tasks:
1. Identity store: a small module in apps/app owning the claimed identity —
   localStorage-persisted { handle, displayName, imageUrl: null, clientId }
   (clientId: generated once and persisted). The DESKTOP/localhost context
   sends NO identity (the server's local-operator default covers it); when the
   app runs remotely (not the desktop shell, not a localhost origin), prompt
   for a display name on first load with a lightweight dialog (name -> handle
   via normalizeHandle) and provide a settings surface to edit it later.
   Follow existing app conventions for settings sections and dialogs.
2. Wire identity outbound: attach x-bb-claimed-identity (via
   encodeClaimedIdentityHeader) to the app's API request layer when an
   identity exists, and append ?identity=<same encoded value> to the /ws URL
   (including reconnects). Find the single fetch/ws construction points and
   wire there — no scattered per-call headers.
3. Presence state: parse inbound "thread-presence" and "presence-summary" ws
   messages with the LENIENT schemas from @bb/domain in the app's existing ws
   message dispatch, keep per-thread viewer rosters and the sidebar summary in
   the app's state layer (follow existing patterns for ws-fed state), and seed
   from GET /api/v1/presence when the socket (re)connects.
4. Render presence:
   - Thread header (apps/app/src/views/thread-detail/ThreadDetailHeader.tsx):
     avatar row of current viewers excluding yourself (own handle), imageUrl
     or initials, display name in tooltip.
   - Typing indicator near the composer (ThreadDetailPromptArea /
     FollowUpPromptBox area): "@alice is typing" for other viewers' typing.
   - Sidebar (apps/app/src/components/sidebar/ThreadRow.tsx): compact viewer
     avatars/dots on threads from the summary; clicking one navigates to that
     thread (follow/jump).
5. Typing emit: send { type: "typing", threadId, typing: true } over the ws
   while the composer is focused with non-empty draft (throttled well under
   the 6s TTL), and typing: false on blur/empty/send.
6. Message authorship: GeneratedConversationMessage (and the timeline row
   path) renders an author chip/avatar for user rows using
   TimelineUserConversationRow.actorHandle — shown only when the loaded
   timeline contains 2+ distinct non-null actorHandles, so single-author
   threads stay exactly as today. Also set the optimistic user row's
   actorHandle to your own claimed handle (currently hardcoded null in
   apps/app/src/hooks/cache-owners/thread-runtime-cache-owner.ts
   buildOptimisticUserMessageRow) when an identity exists.
7. Theme discipline: all new colors derived from --canvas/--ink via
   color-mix per apps/app/src/components/ui/theme.css conventions (no
   oklch/achromatic literals — theme.test.ts guards this); sanctioned
   typography tokens only. Add Storybook stories for the presence avatar
   row and typing indicator following neighboring story patterns.
8. Validation: pnpm exec turbo run typecheck --filter=@bb/app and
   pnpm exec turbo run test --filter=@bb/app piped to /tmp files.
`;

const ws6Prompt = `${shared}
YOUR OWNERSHIP: apps/cli/**, packages/sdk/**, packages/tunnel-client/**,
apps/connect/**, apps/server/src/routes/** (NEW members proxy files + their
registration only), packages/server-contract/** (members contract), docs/**,
and tests for all of those. Do NOT touch apps/app/** (the other worker owns
it), apps/server/src/services/** except where a members proxy service
naturally must live, packages/db/**, packages/domain/**.

Objective: membership management surfaces (CLI/SDK) end to end, plus the
transport marker that keeps member management owner-console-only.

Design invariants (decided): membership is owner-only. Remote members reach
the local server exclusively through the connect tunnel, so a tunnel-origin
marker is the transport check that keeps the local members surface away from
them. The connect worker is the authority on the member list.

Tasks:
1. Tunnel origin marker: in packages/tunnel-client (see src/headers.ts
   headersForLoopbackRequest and src/session.ts where loopback HTTP requests
   and ws upgrades are re-issued), STRIP any inbound "x-bb-via-tunnel" header
   from forwarded traffic and SET "x-bb-via-tunnel: 1" on every re-issued
   request/upgrade. Remote clients therefore can never reach the local server
   without the marker; local processes never carry it.
2. Connect worker credential auth: extend ONLY the member-management endpoints
   in apps/connect (src/members.ts) to also accept the server's own tunnel
   credential as owner-equivalent: Authorization: Bearer <credential> verified
   against server.credential_hash for the SAME :serverId (inspect how the
   tunnel path verifies that credential today and reuse that verification).
   Session-cookie auth keeps working unchanged.
3. Local members proxy: add GET/POST/DELETE /api/v1/members to the local
   server (contract in packages/server-contract following existing public-api
   conventions; implementation as a new route file registered like siblings).
   It proxies to the connect worker's member API using the server's stored
   connect credential and connect base URL — INSPECT how the server-side
   connect integration stores the tunnel credential and worker origin (likely
   the connect plugin / tunnel client setup) and place the proxy where that
   credential legitimately lives; if it can only live inside the connect
   plugin, implement it there and report the placement. Behavior: reject any
   request carrying x-bb-via-tunnel with 403 (member management is
   owner-console-only); 404-style clear error when the server is not enrolled
   in connect; pass through the worker's 403/404/409 semantics.
4. SDK (packages/sdk): a members area (list/add/remove) against
   /api/v1/members, a presence getter for GET /api/v1/presence, and a client
   option to set the claimed-identity header (via @bb/domain
   encodeClaimedIdentityHeader) so agents/CLI can attribute themselves.
5. CLI (apps/cli): bb members list / bb members add <handle> / bb members
   remove <handle> using the SDK, with clear errors for not-enrolled, unknown
   handle, duplicate member, and tunnel-origin rejection. Follow existing
   command structure/output conventions.
6. Docs: per docs/cli-guide-and-skill.md, update every discoverable surface
   for the new command + the claimed-identity/presence concepts (bb guide
   chapter, CLI help, skill surfaces as that doc directs). Do NOT implement
   any open-mode/LAN bind flag in this wave; do not document it as existing.
7. Tests: tunnel-client header marker (strip + set); connect worker
   credential-auth on member endpoints (valid credential, wrong credential,
   wrong server); local proxy authz (tunnel-marked request rejected,
   not-enrolled error) with the existing server test harness patterns; SDK
   area unit tests per sibling areas; CLI output tests per existing command
   tests.
8. Validation: pnpm exec turbo run typecheck and test with --filter for each
   touched package (@bb/cli, @bb/sdk, @bb/tunnel-client, @bb/connect,
   @bb/server, @bb/server-contract), piped to /tmp files.
`;

phase("Implement");
const results = await parallel([
  () =>
    agent(ws5Prompt, {
      label: "WS5 multiplayer UI",
      provider: "claude-code",
      model: "claude-fable-5",
      reasoningLevel: "medium",
    }),
  () =>
    agent(ws6Prompt, {
      label: "WS6 members CLI/SDK/tunnel",
      provider: "codex",
      model: "gpt-5.6-sol",
      reasoningLevel: "high",
    }),
]);
return { ws5: results[0], ws6: results[1] };
