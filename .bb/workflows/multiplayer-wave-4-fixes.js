export const meta = {
  name: "multiplayer-wave-4-fixes",
  description:
    "Wave 4: fix the 7 gpt-5.6 review findings across connect, server/db, and app",
  phases: [
    {
      title: "Fix",
      detail: "Three parallel fixers with disjoint ownership",
    },
  ],
};

const shared = `
You are one of three parallel workers fixing review findings for "multiplayer
bb" in a SHARED working tree on branch bb/multiplayer (waves 0-3 committed
through 59cc824cb). Touch ONLY files under YOUR OWNERSHIP; scope validation
with turbo --filter. Follow AGENTS.md at the repo root. No new dependencies;
no git commits or git add; pipe slow output to /tmp files and read the file.
Known-flaky server tests (NOT yours): install-machine-script 404-fallback,
public-host-management revoke timeout — rerun in isolation before treating a
failure as your regression. Final message = machine-consumed report: outcome,
files changed, how each assigned finding was fixed, checks run with results,
blockers.

Design invariants (do not relitigate): identity is claimed-only and the local
server never authorizes by identity; member management is owner-only AND
owner-console-only; the connect worker audit log is the system's only
verified record; single-human threads must produce byte-identical provider
input.
`;

const connectPrompt = `${shared}
YOUR OWNERSHIP: apps/connect/** only.

FINDING 1 (High) — a pre-marker (v58) tunnel bypasses owner-console-only
member management: the local /api/v1/members route rejects requests carrying
x-bb-via-tunnel, but tunnels opened by an old tunnel-client never stamp the
marker, so remote members could reach the route. Fix it at the boundary WE
control regardless of installed tunnel-client version: in the connect worker
(apps/connect/src/worker.ts), BLOCK any forwarded visitor request whose path
targets the local member-management surface (/api/v1/members and subpaths)
with a 403 JSON error BEFORE it is sent through the TunnelDO — for every
visitor session, owner included (member management is owner-console-only by
design; the owner uses the CLI/desktop on the machine). Apply the same block
on the websocket-upgrade path only if that path can carry such URLs. Keep the
existing local marker check as defense in depth (do not touch it — it is
outside your ownership). Add worker tests: forwarded GET/POST/DELETE
/api/v1/members* as owner session and as member session both get 403 and are
never forwarded; unrelated /api/v1/* paths still forward.

FINDING 2 (High) — membership mutations can commit without their audit rows:
in apps/connect/src/members.ts, addServerMember inserts server_member then
appends the member-added audit row as a second statement, and
removeServerMember deletes then audits; a failed audit write leaves an
unaudited authorization change. Make each mutation atomic with its audit row
— drizzle's D1/SQLite batch API (db.batch([...])) executes statements in one
implicit transaction on D1; the in-memory sqlite test double must behave
equivalently (verify how the existing tests construct the db and keep both
paths atomic — if batch is unavailable on the test double, use the
transaction primitive that works on both and document it). Preserve existing
status-code semantics (409 duplicate via unique-constraint detection must
still work). Add tests that force the audit insert to fail (e.g. drop or
rename the audit_log table in the test db, or inject a failing db) and assert
membership is unchanged for both add and remove.

Validation: pnpm exec turbo run typecheck --filter=@bb/connect and
pnpm exec turbo run test --filter=@bb/connect, piped to /tmp.
`;

const serverPrompt = `${shared}
YOUR OWNERSHIP: apps/server/src/services/** , apps/server/src/routes/threads/
interactions.ts, apps/server/src/ws/**, packages/db/src/data/**, and their
tests. Do NOT touch apps/connect/**, apps/app/**, packages/tunnel-client/**,
apps/server/src/routes/members.ts.

FINDING 3 (High) — speaker gating counts non-message actors as authors:
countDistinctThreadEventActors (packages/db/src/data/events.ts, ~line 624)
counts every actor-bearing event, so a manual stop by Bob makes Alice's next
message get "[from @alice]" even though she is the only author — violating
the 2+ distinct MESSAGE authors gate and byte-identical single-human input.
Restrict the count to attributed human message events (type
'client/turn/requested' with actor_handle NOT NULL); keep it a targeted SQL
count. Verify the index situation for the new predicate (existing
events_thread_type_* indexes likely cover it; add an index ONLY if the query
plan requires it, per AGENTS.md). Update/extend tests: NULL-only history ->
no speaker; one message author + a manual stop by someone else -> no speaker;
two message authors -> speaker present.

FINDING 5 (Medium) — interaction attribution gaps: the /resolve route writes
resolved_by_handle as a second write after the state transition (
apps/server/src/routes/threads/interactions.ts ~line 59), and the plugin
/respond route (~line 76) never records attribution at all. Pass the
request-scoped actor into the pendingInteractions service so the state
transition and the first resolver's handle persist in the SAME write for BOTH
provider /resolve and plugin /respond paths (and /cancel if it resolves
state). First resolver wins under racing duplicates. Tests: provider resolve,
plugin respond, and a duplicate/racing second responder that must not
overwrite the first handle (in-memory sqlite, never mock the db).

FINDING 6 (Medium) — typing state is per-handle, not per-socket: in
apps/server/src/services/presence.ts, ViewerState holds one typing boolean +
one timeout for a handle, so one tab sending typing:false (or its TTL
expiring) clears typing for the same person's other active device. Track
typing TTL per socket and derive handle-level typing as "any socket active";
clear a socket's typing state when that socket unsubscribes/closes. Add a
two-socket same-handle test: socket A stops typing (explicit false AND
separately TTL expiry) while socket B is still typing -> handle stays typing;
both stop -> cleared.

Validation: pnpm exec turbo run typecheck --filter=@bb/server --filter=@bb/db
then turbo test for both, piped to /tmp.
`;

const appPrompt = `${shared}
YOUR OWNERSHIP: apps/app/** only.

FINDING 4 (Medium) — claimed-identity changes do not rebind the live
websocket: the socket's actor is fixed at upgrade time, and the app connects
before the first-load name prompt completes, so presence/typing stay
attributed to the default actor until some unrelated reconnect, while HTTP
requests immediately use the new identity. Fix: when the claimed identity is
saved, edited, or cleared (apps/app/src/lib/claimed-identity-store.ts /
ClaimIdentityDialog / IdentitySettingsSection), trigger a controlled
reconnect of the ws manager (apps/app/src/lib/ws.ts already re-evaluates the
URL provider and re-subscribes on reconnect — use its existing reconnect
machinery; do not build a second socket). Ensure resubscription and presence
reseeding still happen (they are wired to the reconnect path). Tests: saving
identity triggers exactly one reconnect with the new ?identity= URL;
edit and clear also rebind; jsdom-level is fine following the existing
ws/presence test patterns.

FINDING 7 (Medium) — the reconnect presence snapshot can overwrite newer
realtime state: apps/app/src/lib/presence-store.ts fires an async GET
/api/v1/presence on (re)connect and unconditionally replaces all state when
it resolves, so a thread-presence/presence-summary broadcast that arrived
while the request was in flight is clobbered by the older snapshot with
nothing to repair it. Guard with a generation/ordering scheme: bump a
generation on every applied realtime message; when the snapshot resolves,
apply it only for state not touched by a newer generation (or re-request /
merge — pick the simplest correct scheme and document it in a comment).
Tests: deferred snapshot response with an intervening realtime update AND an
intervening realtime removal — both must survive the snapshot's arrival.

Validation: pnpm exec turbo run typecheck --filter=@bb/app and
pnpm exec turbo run test --filter=@bb/app, piped to /tmp.
`;

phase("Fix");
const results = await parallel([
  () =>
    agent(connectPrompt, {
      label: "fix: connect gate + audit atomicity",
      provider: "codex",
      model: "gpt-5.6-sol",
      reasoningLevel: "high",
    }),
  () =>
    agent(serverPrompt, {
      label: "fix: speaker gate + interactions + typing",
      provider: "codex",
      model: "gpt-5.6-sol",
      reasoningLevel: "high",
    }),
  () =>
    agent(appPrompt, {
      label: "fix: ws rebind + snapshot race",
      provider: "claude-code",
      model: "claude-fable-5",
      reasoningLevel: "medium",
    }),
]);
return { connect: results[0], server: results[1], app: results[2] };
