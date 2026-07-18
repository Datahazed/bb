export const meta = {
  name: "multiplayer-wave-1",
  description:
    "Wave 1: connect gate membership (WS1) and local server claimed-identity plumbing (WS2) in parallel",
  phases: [
    {
      title: "Implement",
      detail: "WS1 connect cloud and WS2 server identity, disjoint ownership",
    },
  ],
};

const shared = `
You are one of two parallel workers implementing "multiplayer bb" wave 1 in a
SHARED working tree on branch bb/multiplayer (wave 0 is commit 26722ea2d,
already in your workspace). Another worker is editing a disjoint set of files
concurrently — touch ONLY the files listed under YOUR OWNERSHIP, and scope all
validation commands with turbo --filter so you never run the other package's
suite.

Design invariants (decided, do not relitigate):
- Identity is CLAIMED-ONLY. Clients self-assert identity via the
  x-bb-claimed-identity header (see @bb/domain claimed-identity module).
  Admission gateways never assert identity into product data.
- The bb server never AUTHORIZES by identity, only attributes. Admission is
  enforced entirely at the connect gate (or network boundary).
- Membership is admission-only and owner-managed. The connect audit log is the
  system's only verified access record.
- Follow AGENTS.md at the repo root (parse at boundaries, no accepted-but-
  ignored fields, no unnecessary optionality, no db mocking in tests).

Rules: no new dependencies; no git commits or git add (leave all changes in
the working tree); pipe slow command output to /tmp files and read the file.
Your final message is a machine-consumed report: outcome, files changed (paths),
key API surfaces, checks run with actual results, blockers/assumptions.
`;

const ws1Prompt = `${shared}
YOUR OWNERSHIP: apps/connect/** only. Do NOT modify packages/connect-db (its
server_member schema + migration 0006 already landed), apps/server,
packages/db, packages/domain.

Objective: make the connect gate admit invited members and give owners a
member-management API.

Wave 0 already provides in packages/connect-db/src/schema.ts: serverMember
(server_id, user_id, added_by_user_id, created_at; PK (server_id,user_id);
index server_member_user_id_idx) exported in the schema map, plus the existing
auditLog table.

Tasks:
1. Gate admission — apps/connect/src/worker.ts (the owner check around lines
   405-445 that returns 403 "not your server"): when the session user is not
   the server owner, admit them if a server_member row exists for (serverId,
   sessionUserId). The desktop-credential path stays owner-only. Inspect
   apps/connect/src/session.ts / cache.ts for how label->server resolution and
   caching work and keep the membership check consistent with those patterns
   (a per-request D1 query is acceptable if that matches existing style).
2. Admission audit — on member admission, append an audit_log row (action
   "member-admitted", userId = member, detail JSON with serverId and
   subdomain). Debounce so steady-state traffic does not write a row per
   request: an in-memory per-isolate map with a ~15-minute window is fine;
   at-least-once duplicates across isolate restarts are acceptable. This log
   is the system's ONLY verified access record, so make sure the write path
   actually lands.
3. Member management API — following the existing worker API conventions (see
   how apps/connect/src/servers.ts routes are registered in worker.ts), add
   owner-session-authenticated endpoints:
   - GET /api/servers/:serverId/members -> array of { userId, handle, name,
     image, addedByUserId, createdAt }
   - POST /api/servers/:serverId/members with { handle } -> resolve
     profile.handle to a user (match existing handle normalization), insert
     server_member with addedByUserId = owner; 404 unknown handle, 409 already
     a member, 400 if the handle is the owner's own.
   - DELETE /api/servers/:serverId/members/:userId -> remove; 404 if absent.
   All three return 403 unless the session user owns the server. Add/remove
   write audit rows ("member-added" / "member-removed").
4. Tests — colocated *.test.ts next to the code (follow worker.test.ts /
   servers.test.ts harness style): member session admitted through the gate,
   non-member still 403, owner-only member CRUD (each authz failure), unknown
   handle 404, duplicate 409, owner-handle 400, audit rows written.

Validation: pnpm exec turbo run typecheck --filter=@bb/connect and
pnpm exec turbo run test --filter=@bb/connect (pipe to /tmp, read results).
`;

const ws2Prompt = `${shared}
YOUR OWNERSHIP: apps/server/** (except apps/server/src/ws/hub.ts — see below)
plus a NEW file packages/db/src/data/collaborators.ts and its export wiring
and tests. Do NOT modify: packages/db/src/schema.ts, packages/db/src/migrate.ts,
packages/domain/**, apps/connect/**.

Objective: plumb claimed identity through the local server — every API request
and websocket connection resolves to an actor, collaborators are recorded, and
sockets expose their actor for the upcoming presence work.

Wave 0 already provides:
- @bb/domain claimed-identity module: CLAIMED_IDENTITY_HEADER
  ("x-bb-claimed-identity"), ClaimedIdentity { handle, displayName,
  imageUrl: string|null, clientId }, decodeClaimedIdentityHeader(value) ->
  identity-with-normalized-handle or null, normalizeHandle,
  encodeClaimedIdentityHeader.
- @bb/db collaborators table: handle (PK), display_name, image_url,
  first_seen_at, last_seen_at.
- The ws client protocol already tolerates a "typing" message as a no-op.

Tasks:
1. packages/db/src/data/collaborators.ts (new; follow the style of existing
   modules in packages/db/src/data/): upsertCollaborator(db, { handle,
   displayName, imageUrl }, now) inserting (firstSeenAt = lastSeenAt = now) or
   updating display fields + lastSeenAt; getCollaborator(db, handle);
   listCollaborators(db). Wire exports the same way sibling data modules are
   exported.
2. Request actor resolution in apps/server: a small typed module (place it
   where server services conventionally live) that resolves an actor from
   request headers via decodeClaimedIdentityHeader, falling back to a default
   local-operator identity built once at startup: handle =
   normalizeHandle(os.userInfo().username) (fallback "local"), displayName =
   the OS username or hostname, imageUrl null, clientId "local". Wire it into
   the /api/v1 request path following how apps/server/src/server.ts currently
   mounts public routes and passes deps/context into handlers — minimal,
   typed, no "as" casts. Attribution consumers land in a later wave; this wave
   only needs the actor resolvable per-request and the collaborator recorded.
3. Collaborator recording: upsert via the new data module whenever a request
   or ws connection resolves an actor, with an in-memory debounce keyed by
   handle (skip the write when displayName/imageUrl are unchanged and the last
   write was under 60 seconds ago).
4. Socket actors: resolve the actor from the upgrade request at the GET /ws
   accept site in apps/server/src/server.ts and record the socket->actor
   association in a new module apps/server/src/ws/socket-actors.ts (register
   on open, release on close — the close path runs through
   onClientSocketClose in apps/server/src/ws/client-protocol.ts; wire
   minimally). Expose getSocketActor(socket). Do NOT modify hub.ts — presence
   lands later and will consume getSocketActor.
5. Tests: packages/db test for upsert semantics using in-memory sqlite
   (createConnection(":memory:") + migrate(db); never mock the db). apps/server
   tests via the existing harness patterns: header -> actor (valid, malformed
   -> local default), normalization collision ("Sawyer " and "sawyer" are one
   collaborator), debounce skip, socket-actors register/release (unit-test the
   module directly if the harness lacks ws coverage).

Validation: pnpm exec turbo run typecheck --filter=@bb/server --filter=@bb/db
then pnpm exec turbo run test --filter=@bb/db and --filter=@bb/server, piped
to /tmp files (the server suite is slow — read the file, do not stream). Two
KNOWN-FLAKY server tests unrelated to you: the install-machine-script 404
fallback test and the public-host-management revoke-machine timeout — if they
fail, rerun that file in isolation before treating it as your regression.
`;

phase("Implement");
const results = await parallel([
  () =>
    agent(ws1Prompt, {
      label: "WS1 connect gate + members",
      provider: "codex",
      model: "gpt-5.6-sol",
      reasoningLevel: "high",
    }),
  () =>
    agent(ws2Prompt, {
      label: "WS2 server claimed identity",
      provider: "codex",
      model: "gpt-5.6-sol",
      reasoningLevel: "high",
    }),
]);
return { ws1: results[0], ws2: results[1] };
