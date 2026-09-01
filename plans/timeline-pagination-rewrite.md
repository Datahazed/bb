# Timeline pagination rewrite: one PR, correct and fast regardless of limits

Plan for replacing the thread-timeline windowing/pagination model with a
single landable PR. Context: PR #2419 (closed), PR #2464 (turn-details
pagination, closed in favor of this plan), PR #2504 (logical-boundary summary
paging, closed in favor of this plan), and the prod-copy audits from thread
`thr_e625skpecw`.

## The two invariants

**1. Correctness.** Walking every page of a thread and concatenating the
results must exactly equal the unpaginated projection — for any value of
every limit (segment limit, output-preview caps, turn-details byte budget).
Limits may only change *how many* requests it takes, never *what* the
combined result is.

Today this is false: pages are raw event ranges (1,500-event / 4 MiB budgets)
chosen before the projection runs, but the projection is a full-history state
machine — `project(A) + project(B) ≠ project(A + B)`. Rows vanish at seams
(the recurring prod bug: assistant message at source events `3365-3375`
emitted by no page). The ~350 lines of `ensure*` context recovery, four
"loaded but don't render" channels, `sourceEndExtensions`, page-suffixed row
ids, and the 510-line client merge with its contiguity heuristics are all
compensation for projecting arbitrary event ranges — and each one is a place
for the next seam bug to hide.

**2. Performance.** The windowing exists for perf; a rewrite that slows the
hot paths down would mean windowing was never worth having. So the rewrite
must be at-or-better than `main` on every tracked path, and its cost model
must be *marginal, not historical*: after the first build, serving a page
costs O(the slice returned), and a streaming poll costs O(the active turn's
tail), never O(thread history). Concretely, the design has to beat windowing
at its own game: today every latest poll re-projects up to 1,500 events and
every older page re-projects its own window from scratch; the rewrite builds
once and slices.

Perf budgets, from the prod-copy measurements (784 threads), enforced as
landing gates:

| Path | `main` today | Budget |
|---|---|---|
| Latest page, median / p95 | 10.7 ms / 25.5 ms | ≤ main |
| Latest page, idle warm (cache hit) | ~0 | ~0 (rows-cache slice) |
| Streaming poll rebuild (delta path) | full window re-projection | ≤ main (checkpoint fold of active-turn tail only) |
| Older-page walk / full history | 238 ms on the worst thread | < main (one build amortized across all pages; #2504 already measured 192 ms) |
| Cold first build, worst dense thread | n/a (windowed) | ≤ ~250 ms, paid once per (thread, maxSeq), then cached |
| Dense-thread outliers (the 5 threads that regressed >100 ms under #2504) | — | named benchmark cases; each ≤ its main latency after warm-up, cold within the 250 ms bound |
| Stress cases from `thr_pdnbzyfnxd` (the `thr_9bchdk89cn` 6.02 s incident thread, the 32,384-event overlapping-turn thread, the 42,033-event stress thread) | 6.02 s synchronous build in the worst incident | named benchmark cases; must beat main's current numbers on each |

The one place the rewrite pays more than main is the *first* build of a huge
thread after a server restart (main's window never reads old events at all).
That is a deliberate trade: one bounded cold build per thread per process,
in exchange for every subsequent page, poll, and history walk being cheaper.
Two calibration notes from the `thr_pdnbzyfnxd` incident work: main's
windowing does *not* actually bound cost today (the 6.02 s stall was the
windowed path — 2.586 s window query + 1.546 s event fetch, i.e. the anchor/
budget/closure query stack this PR deletes), and the 784-thread prod copy
underestimates the true tail, so the stress threads above are mandatory
benchmark fixtures. If the benchmarks show any steady-state path where
windows beat the memoized build, that is a gate failure and the PR does not
land; the durable-projection follow-up (below) slots in behind the same seam
without changing the pagination model.

## Outcome (measured 2026-08-31/09-01, 1,132-thread production copy)

Correctness: recombination gate 1,132/1,132 across segment limits
{1, 2, 3, 8, 20} (main: 21 failing, 54 unreferenceable). Row diff vs main:
995 threads byte-identical, every change on the other 137 classified into
named fix classes; full corpus gate green (2,319 tests).

Performance (live servers, same machine/DB copy, Connect stripped; branch
measured after a restart with persisted projections and startup warmup):

| path | main | branch (persisted projections + startup warmup) |
|---|---:|---:|
| first request per thread (cold) p50 | 15.4 ms | 8.1 ms |
| first request per thread (cold) p95 | 47.1 ms | 23.4 ms |
| first request per thread (cold) p99 | 100.7 ms | 34.4 ms |
| first request per thread (cold) max | 349.1 ms | 120.6 ms |
| repeat request (warm) p50 | 2.7 ms | 2.2 ms |
| repeat request (warm) p95 | 8.0 ms | 7.1 ms |
| repeat request (warm) p99 | 33.4 ms | 12.4 ms |
| repeat request (warm) max | 718.0 ms | 19.7 ms |
| full older-page walk p50 | 15.9 ms | 8.3 ms |
| full older-page walk p95 | 103.8 ms | 24.1 ms |
| full older-page walk p99 | 349.1 ms | 39.7 ms |
| full older-page walk max | 4605.2 ms | 293.6 ms |

| stress thread | events | main cold | branch (persisted + warmup) |
|---|---:|---:|---:|
| `thr_cdfq9maj8q` | 63,853 | 41 ms | 14 ms |
| `thr_gcuc46ug4j` | 42,033 | 144 ms | 6 ms |
| `thr_m9gz6riv9t` | 32,384 | 9 ms | 6 ms |
| `thr_59j74ttj6b` | 31,716 | 52 ms | 6 ms |

Every path beats main, including the worst thread. Mechanisms:
canonical-projection cache (tip id + event count), persisted projections for
settled threads with ≥1,000 stored events (app-version + options key,
tip identity as columns), startup warmup after provider registrations
settle, re-projection when a thread settles, background rebuild after
in-place sweeps, and a cost-proportional refresh throttle for streaming
rebuilds. The in-memory fold checkpoint from the original plan was not
built: the projection is non-causal, so true incrementality is the
durable-reducer follow-up, and the throttle bounds the event loop until then.

## Cold-build revision (after the "unacceptable" review)

Measured on the 64k-event thread: SQL read 3.4 s of 83 MB when the OS cache
is cold, decode 0.3 s, projection 0.6 s of which the phase‑1 fold is 85–95%.
A deep read of the projection showed it is pervasively non-local (later
events rewrite earlier messages by callId, thread-scoped lifecycle merges,
delegations absorb later turns via a never-cleared provider-thread link,
compaction flips at 1,000 deltas), so freezing a prefix is unsound; true
incrementality is the reducer rewrite, still the follow-up.

What ships instead: the fold body is a per-event function with a
cooperative driver (`buildThreadTimelineFromEventsCooperatively`), verified
byte-identical to the synchronous build on real threads and by the corpus
gate; the route builds cooperatively (250-row read/decode chunks, yields
every 500 events, in-flight dedupe, tip re-verification against suffix
replacement), so no build blocks the loop beyond one slice; threads with
≥1,000 events are projected at startup (largest first) and re-projected
when they settle, so their first open is served from the persisted
projection. The projection table became `thread_timeline_checkpoints`.

Three defects found only by the live checks, all fixed:

- Startup warmup ran before provider plugins registered, so it keyed every
  projection on a null provider name; the route (registry populated) missed
  all of them and rebuilt on the request path, then warmup rebuilt again on
  the next start. Warmup now starts after `markRegistrationsSettled()`, and
  the route awaits `whenRegistrationsSettled()` so a request during the
  first seconds after a restart cannot build or persist under an unsettled
  key. The persisted lookup is what caught it: the debug trace showed the
  warmup-written key `[..., "null", null, ...]` against the route's
  `[..., "{plan…}", "Claude Code", ...]`.
- Candidate discovery was one `GROUP BY thread_id` over the whole events
  table: 1.56 s synchronous at startup. It is now a per-thread indexed probe
  (`max(sequence) ≥ 1,000`, then exact count only for those), yielding every
  10 threads.
- The completed-output truncation sweep invalidated every large thread it
  touched, so the next open paid a full build. Retention truncation only
  changes output previews, so the sweep now keeps serving the existing
  projection and rebuilds it in the background (`rebuildThreadTimelines`,
  forced past the freshness check); nothing pays on the request path.

Residual: a request for a large thread that lands during the startup
warmup window, before warmup reaches it, starts (or joins) the cooperative
build itself — measured 4.2 s wall for the 64k-event thread while the loop
stayed responsive (ping p99 58 ms). On the production copy the whole warmup
takes ~30 s on a cold start and ~1 s on later restarts (all 253 projections
fresh).

## Design principle

**Never cut the event stream. Project the semantic unit in full, then
paginate the projected rows.**

A page is a slice of one canonical row list, so the invariant holds by
construction: slicing a list cannot lose, duplicate, or reorder rows. Limits
stop being correctness inputs entirely — they only pick slice sizes.
Performance is recovered by memoizing the projection, not by shrinking its
input.

Two semantic units, two resources, one rule each:

1. **Thread summary** (`GET /threads/:id/timeline`): project the whole thread
   once → canonical rows + head state + segment boundaries. A page is a slice
   of consecutive logical segments split at user-anchor rows. Cursor stays
   wire-identical to today's `{anchorSeq, anchorId}` (anchor row id + seq).
2. **Turn details** (`GET .../timeline/turn-details`, contract from #2464):
   project the whole turn once with outputs truncated to zero (metadata-only,
   cheap) → authoritative child-row list. A page is a slice of those rows;
   hydrate the slice's outputs with one bounded seq-range read. Cursor stays
   opaque; payload becomes v2 (a stale v1 cursor gets 400 and the client's
   existing stale-cursor recovery restarts from page one).

No event budgets, no byte-budget floors, no `:in-turn:`/`:byte-window:`
cursors, no overlap segments, no trim, no closure.

## Why row-slicing is correct where event-slicing wasn't

Everything that made event ranges unprojectable is a non-problem for row
slices of a full projection:

- Items bisected by a steer, `turn/completed` after a cut, `turn/started`
  before it, delayed `turn/input/accepted` — all inside one projection pass.
- Delegation subtrees are children of one parent row; a top-level slice
  cannot split them.
- Background tasks and head state (goal/todos) are folded over all events, so
  old rows show current state without `ensure*` backfills.
- Late thread-scoped system rows: keep #2504's
  `restoreLateSystemRowSourceOrder` fix; with slicing, a row can no longer
  fall between two pages — every row is in exactly one segment.

## Target architecture

New module `apps/server/src/services/threads/timeline/` (replacing the
current `timeline.ts`):

```
buildCanonicalTimeline(db, threadId, opts)
  → { rows, headState, maxSeq, segments }
  // one SQL scan of all timeline-relevant events (SQL-side output
  // truncation as today), one decode pass, one projection fold, finalize.
  // Pure function of (events, projection options).

readSummaryPage(threadId, { cursor?, segmentLimit, ... })
  // slice segments from the canonical result; latest page attaches head
  // state and the existing delta path, older pages null it (unchanged).

readTurnDetailsPage(threadId, turnId, range, cursor?)
  // project turn metadata-only → child rows; slice; hydrate outputs.
```

Supporting decisions:

- **Anchors move into the projection.** The projector already computes
  `resolveTurnRequestKind`; it marks anchor rows and segmentation is a split
  of the row list. Delete the duplicated SQL anchor predicate
  (`events.ts:2982-3011`) and the anchor-predicate drift tolerance
  (`timeline.ts:1599-1619`) — cursor validation becomes "does this anchor row
  exist in the canonical list".
- **One contract for every consumer.** Web, mobile, and CLI
  (`includeNestedRows`) are served from the same canonical build; the oldest
  page owns the pre-first-anchor prelude (keep #2504's rule). No
  nested-only transport windows.
- **Caching replaces windowing.** Cache the *canonical build* per thread,
  keyed by `(maxSeq, projection options)` — not per-response. An idle thread
  builds once and serves every page, poll, and delta from slices (today's
  response cache refuses >200-row responses; the rows cache has no such
  limit). Invalidate on new events and on suffix replacement (edit-message /
  fork truncation), hooked into the existing write/realtime path.
- **Streaming cost is bounded by a memoized fold, not a window.** The
  projection is a fold `state = f(state, event)`. Checkpoint the fold state
  at the active turn's `turn/started`; each poll clones the checkpoint, folds
  only the active turn's tail events (≈ what the 1,500-event window costs
  today, minus ~20 closure queries), rebuilds rows from state (O(rows), no
  parsing), finalizes on a copy. This is **core scope, not an optimization**
  — the perf invariant fails without it on dense streaming threads. In-memory
  only — no persisted index, no versioning, no shadow reads. A restart
  mid-stream costs one cold build (worst ~250 ms measured on the prod copy).
  Shaping the projection as an explicit checkpointable event-at-a-time fold
  is also deliberate groundwork: it is exactly the reducer that the
  durable-projection follow-up requires (see "Related work" below), so
  persisting projections later is additive behind `buildCanonicalTimeline`,
  not a rewrite of this PR.
- **Cold builds read metadata, not bytes.** The measured dominant cold cost
  is payload bytes + JSON parse, not event count. The canonical build reads
  outputs SQL-truncated to zero for idle pages (from #2504) and to preview
  caps otherwise, so a "full thread" scan is a metadata scan; full outputs are
  only ever read by turn-details hydration for the slice being returned. This
  is what keeps the worst prod-copy cold build at ~250 ms instead of seconds.
- **Response-size defenses that stay:** SQL-side `maxInlineOutputChars`
  truncation, idle-page zero-output reads (from #2504), route-level previews,
  the oversized-event placeholder (applied once, at decode), and the wire
  delta for polls. The 4 MiB budget survives only inside turn-details output
  hydration, where by the invariant it may only affect page count.

### Deleted (the payoff)

- Window selection: event-budget floor, byte-budget floor and iterator,
  `resolveTimelineWindowBounds`' special-case ladder,
  `findUnfinishedTurnCoveringSequence`, `hasParentedEventCrossingSequence`,
  both sequence-cursor formats.
- All nine `ensure*` context-recovery functions and the
  `selectStandardTimelineEventRows` 13-intermediate pipeline.
- All four context-only channels (`contextOnlyToolCallIds`,
  `contextOnlyMessageSeqs`, `contextOnlyCompletedTurnIds`,
  `messageBoundsOnlyTurnIds`) and their plumbing through `thread-view`.
- `sourceEndExtensions`, page-unique row-id suffixing
  (`:sequence-page:<n>`), `buildSequencePageTimelineRows`' clamping/dropping.
- Turn details: the forward byte-walk cursor and the ownership
  double-projection that #2464 would have added; the exact-range 413 path
  (first page of the paged resource covers it).
- Client (`timeline-merge.ts`, 510 → ~150 lines): seam coalescing, the
  `canMerge` order-agreement bailout, sequence-contiguity heuristics, the
  straddling-row retention rule, delegation-shell re-merging. What remains:
  concat by id in cursor order, `preserveTimelineRowIdentity`, the
  optimistic-row filter, stale-cursor recovery.
- `timeline.ts`: 2,140 lines on main → target well under 1,000 across the
  new module. The PR should be strongly net-negative outside tests.

### Kept

Provider event parsing and the event domain model;
`buildThreadTimelineFromEvents` and completed-turn grouping (minus the
context-only parameters); the delta path and its rows cache; `summaryOnly`;
the #2464 route contract, SDK surface, and client UX ("Load more work");
the provider-corpus harness, row snapshots, and allowlists.

### Harvested from the closed PRs

- #2504: seam regression tests (`timeline-in-turn-window.test.ts` — the
  `3365-3375`-class case, prelude ownership, recombination equality),
  `restoreLateSystemRowSourceOrder`, the grouping revert to
  `applySingleSummaryTurnBounds`, idle zero-output reads, prelude rule.
- #2464: route/contract/SDK/client stack for turn details (largely verbatim),
  `readStoredTimelineWindowForwardPage`'s test ideas, cursor-binding tests.
- #2419 branch: reference for seam edge cases; nothing merged from it.

No `HOST_DAEMON_PROTOCOL_VERSION` bump (no daemon traffic changes). The PR
re-adds the public turn-details SDK surface, so it needs its own
`scripts/bump-plugin-sdk.mjs --patch`.

## Decisions (Michael, 2026-08-31)

- **Durable reducer scope**: decide after benchmarks. Build the planned PR;
  if the stress-thread cold builds breach budget, grow this PR to include
  persisted projections before landing rather than shipping a known miss.
- **Prod data**: fresh read-only copy of `~/.bb` into `~/.bb-dev/` for the
  audits, stress fixtures, and before/after latency runs.
- **Rollout**: straight replacement, no kill-switch flag. The old machinery
  is deleted in this PR; confidence comes from the recombination matrix and
  the prod-copy audit.

## The single PR

Branch fresh from `main` (this worktree's branch is the conflicted #2419
branch — don't build on it). One PR, commits ordered so each is reviewable
and the narrative is red-before/green-after:

1. **Oracle first.** Port the ad-hoc prod-copy audits into
   `apps/server/test/provider-corpus` (the harness's
   `buildAllRouteTimelinePages` already walks cursors):
   - *Recombination matrix*: for every corpus thread × `segmentLimit ∈
     {1, 2, 3, 8, 20}` × turn-details byte budget ∈ {tiny, default}, walk all
     pages, recombine, compare exactly (ids, order, source ranges, system
     rows) to the unpaginated projection. This encodes the invariant and
     **fails on main** for the seam cases — the red-before evidence.
   - Turn-details walk: every completed turn hydrates completely via pages;
     disjoint ranges stay disjoint.
2. **Independent projection fixes** from #2504 — resolved during
   implementation: neither is needed on main. The grouping revert only undid
   #2464's unmerged policy (main already has `applySingleSummaryTurnBounds`),
   and `restoreLateSystemRowSourceOrder` addressed segment *assignment* under
   the old segmentation — the unwindowed projection's row order is already
   correct on the failing prod threads (verified against `thr_7vjjsfxsns`),
   and row-slice pagination is lossless regardless of where late system rows
   sit. The recombination gate will surface any ordering issue if this
   conclusion is wrong.

   First red run of the oracle (main code, 2026-08-31 corpus): **21/1,132
   threads fail recombination** (2 at production limits; up to 20 per cell at
   reduced limits), 54 threads cannot produce an unpaginated reference at
   all. Failure classes: whole oldest segments unreachable (late `error`/`op`
   rows dragging the segment out of every page, e.g. `thr_7vjjsfxsns` losing
   its seq-1 user message), `provider-unhandled` op rows vanishing wholesale,
   duplicated user rows at seams. Full matrix runtime: ~3 minutes.
3. **Canonical build + row-slice summary pagination** behind the existing
   route; anchor marking in the projection; delete the window machinery,
   `ensure*` family, context-only channels, and the SQL anchor predicate.
4. **Turn details**: port the #2464 contract/client stack; server internals
   are project-then-slice; plugin SDK bump.
5. **Client merge simplification** — resolved during implementation: main's
   client merge (356-line `timeline-merge.ts`) contains no seam-repair code;
   the branch-era coalescing was never merged. Everything in it is
   latest-refetch splicing that remains valid, and the CLI's naive older-page
   concat becomes *correct* under disjoint pages. No client changes needed.
6. **Caching + checkpoint**: canonical-build cache and the streaming fold
   checkpoint, benchmarked as they land. Perf is measured continuously from
   commit 3 onward — extend `timeline-perf.test.ts` with the budget table's
   paths (including the five dense-outlier threads as named cases) so a
   regression shows up in the commit that causes it, not at the end.

### Landing gates (all recorded in the PR body)

- **Correctness**: recombination matrix green across the corpus, including
  under the reduced limits that force maximum page counts.
- **Performance**: every row of the perf-budget table met on the prod copy —
  latest-page p50/p95 ≤ main, streaming poll rebuild ≤ main's windowed
  rebuild, history walks faster than main, cold worst case ≤ ~250 ms and
  paid only once per (thread, maxSeq), the five dense outliers within budget.
  Any steady-state path where main's windowing wins is a blocker.
- Row-snapshot diffs vs `main` all classified through the existing allowlist
  flow — every diff is one of the intended seam fixes, nothing else.
- Fresh prod-copy audit (like the 784/784 runs) with the latency comparison
  table pasted in the PR body.
- `pnpm exec turbo run test/typecheck/lint` on every touched package;
  net-negative non-test diff.

## Related work: thr_pdnbzyfnxd (server-stall / three-level prototype)

The "Investigate sluggish bb server" thread prototyped the perf end-state and
independently converged on this plan's architecture. What it contributes:

- **Validation of the three-level contract.** Its model — `timeline()` →
  summary rows, `timelineDetails(ref)` → compact child rows *without*
  payloads, `timelineRowPayload(ref)` → one output — is exactly this PR's
  summary pages / turn-details slices / bounded output hydration. Measured on
  the stalled prod thread: the three-request path went 30.28/32.51 ms
  p50/p95 → 1.03/1.42 ms read from projections (53.76/81.92 → 1.14/2.56 ms
  under 16-worker CPU load), and Level-2 bytes 485 KB → 37 KB.
- **A negative result this plan must respect.** Epoch-ownership / static
  event-column heuristics were tried and failed: a 42,033-event stress
  thread still differed in 3/173 detail segments because unparented provider
  events depend on the reducer's active nested-work state. Same lesson as
  the `ensure*` saga: no shortcuts around full semantic projection.
- **The write-side is proven cheap.** All-main-thread incremental projection
  (Michael's constraint: no workers) measured 19.4 µs/event amortized,
  9.18 ms max transaction, ordinary transaction latency unchanged
  (0.018 → 0.019 ms p50). Naïve whole-window materialization (128.5–131.7 ms
  on the main thread) is explicitly unacceptable.
- **The end-state is named**: make `thread-view` an event-at-a-time
  incremental reducer emitting durable row mutations, updated in the same
  transaction as event ingestion, with revision-scoped opaque refs so an
  edit/rewind can't mix stale summaries with new details. That is the
  follow-up PR behind `buildCanonicalTimeline`; this PR's checkpointable
  fold is its prerequisite refactor.
- **Assets to harvest**: the benchmark harnesses and interactive state-model
  demo on throwaway branches `bb/prototype-fast-timeline-thr_pdnbzyfnxd`
  (commits `05771219c`, `21f86f352`, `6d8135451`, worktree
  `env_9zxgnigsdd` — the `/private/tmp` copies are ephemeral), raw results
  in `~/.bb/thread-storage/thr_pdnbzyfnxd/`, and the three stress fixtures
  now in the perf-budget table.

## Prod-copy safety (2026-08-31 incident)

Servers started against copied production databases (this thread's latency
audits, and the previous thread's `pr2419-*` copies) carried the Connect
plugin's `plugin_kv` credential and dialed `wss://ymichael.getbb.app` as the
production bb, hijacking the tunnel - the "Connect credentials being reused"
incident. Remediation done: every such server killed by PID (not `pkill -f`,
which only matches the pnpm wrapper), the Connect credential stripped and the
plugin disabled in all 13 affected `~/.bb-dev` copies (final scan: zero
credentialed dev dirs), the procedure documented in docs/debugging-and-qa.md,
and all subsequent audits run on neutralized copies with the log checked for
zero `tunnel connecting` lines. Follow-up worth its own change: make the
Connect plugin refuse a credential whose paired data dir/host identity does
not match the running instance, so a copied database can never impersonate
its origin.

## Open questions (not blockers)

- **Giant active turns** still return all their work rows inline on the
  latest page (worst observed +333 KiB). If it ever matters, the uniform fix
  is letting turn-details pagination serve active turns and capping inline
  rows — deferred until evidence demands it.
- **Blocking builds**: cold builds still run synchronously
  (`runEventLoopWorkSync`), as today. The caches reduce frequency; moving
  projection off the event loop is out of scope.
