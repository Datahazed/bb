# Long-thread timeline: diagnosis and pagination plan

Status: implemented (Phases A–C). Remaining follow-up: bounded event *selection*
for giant turns (§4 Phase B "server reads only what it serves") — the projection
now collapses giant active turns and pages their detail, but a cache-miss build
still reads/parses every event in the window (~600 ms on the 27 MB sample turn,
once per appended event batch). Measured results are in PR notes.

## 1. Problem, quantified

Sample threads (live `bb.db`, read-only):

| Thread | Events | `data` bytes | Notes |
|---|---|---|---|
| `thr_n8ptu7bf8f` | 13,473 | 39.0 MB | one 335-min turn = 7,025 events / 27.0 MB |
| `thr_y7dr6tikex` | 9,245 | 11.8 MB | UX discussion thread |
| `thr_c9ra5h9buj` | 4,094 | 7.2 MB | 162-min turn ≈ 2,242 events / 3.6 MB |

Inside the 7,025-event turn:

- `item/completed` + `commandExecution` = 1,263 events, **21.3 MB of the 27 MB** — completed command items carry full output; the largest single events are **~1.1 MB each**.
- Every work item is stored 2–3×: `item/started` (2.7 MB) + `outputDelta` events (2.3 MB) + `item/completed`.
- The turn is **one timeline segment**: a single user prompt followed by ~5.5 hours of work.

Skeleton math for the whole 39 MB thread: user prompts + turn metadata + final agent
messages ≈ **240 KB** (~160× smaller). Everything else is intermediate work that the
decided UX says should live behind "Worked for…" / "Show earlier work".

## 2. What already exists (do not rebuild)

The current main branch already has most of the machinery, and one failed attempt to
learn from:

- **Logical-segment pagination** — timeline pages are anchored on user-message rows
  (`client/turn/requested` anchors), so a page never starts mid-response.
  Server: `apps/server/src/services/threads/timeline-pagination.ts`,
  `resolveTimelineSegmentWindow` in `apps/server/src/services/threads/timeline.ts`
  (default 20 segments, max 100). Client: `useThreadTimelineController.ts`
  (`loadOlderTimelineRows`, prepend with scroll-anchor restore via
  `BottomAnchoredScrollBody.captureScrollAnchor`).
- **Completed-turn collapse** — `buildTurnRows`
  (`packages/thread-view/src/build-thread-timeline.ts:1044`) collapses a completed turn
  into a `kind:"turn"` row ("Worked for…", `timeline-row-title.ts:1263`) with
  `children: null`; the final response renders outside the collapse
  (`completed-turn-grouping.ts`). Expansion lazily fetches detail via
  `GET routes.timelineTurnSummaryDetails` (`apps/server/src/routes/threads/data.ts:459`)
  keyed by `(turnId, sourceSeqStart, sourceSeqEnd)` → `LazyTurnRowBody`
  (`ThreadTimelineRows.tsx:1275`).
- **Delta live updates** — WS is invalidation-only; refetch passes
  `afterSequence = previous.maxSeq` and the server returns a row delta
  (`computeTimelineRowDelta`); client merges via `applyTimelineDelta`.
- **Inline output truncation** — `timeline-output-truncation.ts` caps tool/command
  output at 32 KB in the timeline response (NOT applied to the turn-summary-details
  route, which is the "see full output" path).
- **Storage-side hygiene** — retention sweep truncates old completed-item outputs
  (`completed-event-output-truncation`), and `event-pruning.ts` deletes resolved item
  deltas / progress events beyond per-thread thresholds.
- **The reverted attempt** — PR #711 bounded raw-event and rendered-row windows by
  row/byte budgets (7.9 MB → 405 KB initial response) but was **server-only**: the cut
  fell at arbitrary row boundaries inside a turn, so users saw agent work without its
  initiating prompt behind a generic "Load older" control. Reverted in #722 "while the
  pagination UX is reconsidered". Lesson: **the budget cut must land inside the turn's
  collapsed body, never at the top-level page boundary.**

## 3. Gap analysis — why long turns still freeze

1. **Active turns never collapse.** `buildTurnRows` emits *every* message as raw rows
   while `turn.status === "pending"`. A 7k-event running turn means:
   - server re-reads and re-projects the whole turn window on every delta tick
     (the segment window includes the entire in-flight turn);
   - the client reprojects the whole loaded window per tick
     (`buildTimelineViewRows` WeakMap cache misses on every new array);
   - the DOM grows unbounded — `TimelineRowsList` has **no virtualization**.
   This is the browser-freeze case.
2. **Expanding a completed giant turn is one unbounded fetch.**
   `timelineTurnSummaryDetails` returns the *entire* turn window, un-truncated.
   For the sample turn that is ~7k events / 27 MB parsed, projected, and mounted as
   nested rows in one shot.
3. **Conversation outline reads the whole thread** on every `maxSeq` bump
   (`buildThreadConversationOutline` / `listRecentStoredEventRows` with no limit),
   softened only by an LRU cache. #711's targeted outline query was reverted with the
   rest.
4. **No list virtualization** — secondary once 1–2 are fixed, since collapse bounds
   visible rows.

## 4. Design

Top-level segment pagination stays exactly as is (it already satisfies "always show the
initiating user message" and "Load older messages only for genuinely older
conversations"). All new bounding happens **inside a turn's work section**.

### Phase A — paged turn detail ("Show earlier work")

Extend the turn-summary-details contract with a work-item cursor:

- Request: `(turnId, sourceSeqStart, sourceSeqEnd)` + optional
  `beforeSeq` (cursor) + `workItemLimit` (default ~50 items, plus a byte budget).
- Response: newest `workItemLimit` work items' rows within the range, plus
  `{ hasEarlierWork, earlierCursor }`. Omitting the cursor params preserves today's
  full-detail behavior for small turns (and for the CLI/SDK, which keep the raw
  `routes.events` surface regardless).
- **Page in item space, not event space.** Select the last N distinct `item_id`s (by
  `item/completed` sequence) in the range, then load all events for those items —
  `events_thread_turn_type_item_sequence_idx` supports this. This keeps
  started/completed pairs together so `buildThreadTimelineFromEvents` sees whole items.
- **Snap page boundaries to grouping boundaries** (assistant-message step boundaries,
  `externalUserBoundarySeqs`) so `bundle-summary`/`step-summary` grouping doesn't
  produce half-bundles at a seam. Cursor = sequence of the boundary event.
- **Apply the 32 KB inline truncation to paged detail.** Today's un-truncated detail
  response is only tenable because turns were assumed small; a 50-item page with
  1.1 MB command outputs is still tens of MB. Add a per-item "show full output" fetch
  (small route: full data for one `(turnId, itemId)`) to preserve the full-output
  affordance.

Client (`LazyTurnRowBody`): keep an ordered list of loaded pages per turn row id;
render chronologically with a nested "Show earlier work" control at the top that
fetches `earlierCursor` and prepends (reusing the existing scroll-anchor capture).
Expansion shows the newest page first, per the decided UX.

### Phase B — active-turn frontier collapse ("Worked for … so far")

Change `buildTurnRows` for in-flight turns:

- Partition the turn's messages into:
  - **live tail**: the most recent K finished work items (K ≈ 20–30), plus *all*
    pending/running items, questions, approvals, plan updates, and streaming text —
    these render as raw rows exactly like today;
  - **collapsed prefix**: older finished work → a single partial turn-summary row
    ("Worked for 2h 10m so far", stable row id derived from `turnId`, `children: null`),
    expandable via the same Phase A paged-detail route (range = turn start →
    collapse frontier).
- **Hysteresis to avoid per-tick churn**: collapse only when the finished tail exceeds
  2K items, and move a chunk (K items) at once. The summary row's
  `sourceSeqEnd` then changes at most once per chunk, keeping row identity stable and
  delta diffs small between migrations.
- **Server reads only what it serves.** The event selection for the latest page should
  fetch the collapsed prefix's *aggregates* (item counts by kind via indexed
  `COUNT`, min/max `created_at`) instead of its events. This is the structural win:
  per-tick projection cost becomes O(tail), independent of turn length — the 27 MB
  turn costs the same to stream as a 30-second one.
- **Completion convergence**: when the turn completes, the standard completed-turn
  path produces the normal "Worked for…" row between prompt and final response. Client
  keeps already-loaded detail pages keyed by `turnId` (not by row id), so work the user
  revealed during the run stays revealed; the partial-row → completed-row transition is
  a row replacement at a stable position, and `BottomAnchoredScrollBody` already
  restores scroll across content-height changes.

### Phase C — remaining unbounded reads (independent, lower risk)

- Re-land the **targeted conversation-outline query** (select only message-producing
  event types with a `WHERE type IN (...)` on the existing thread+type+sequence index),
  as #711 did, this time as its own change.
- Optional: **virtualize `TimelineRowsList`** for very large loaded windows. After
  Phases A/B the visible row count is bounded (segments × a few rows each), so treat
  this as a follow-up only if profiling still shows DOM cost.

### Sizing check against the sample turn

- Initial latest page containing the giant *completed* turn: turn row + final response
  ≈ a few KB (vs 27 MB projected today when expanded, and vs thousands of raw rows if
  it were active).
- Expanding it: newest ~50 items, truncated ≈ low hundreds of KB.
- Active-turn tick: projection over ≤ ~60 items regardless of turn age.

## 5. Contract and surface changes

- `packages/server-contract/src/api/threads.ts`: extend the turn-summary-details query
  schema (`beforeSeq`, `workItemLimit`) and response (`hasEarlierWork`,
  `earlierCursor`); new per-item full-output query. Fill defaults at the route boundary
  per repo convention (no optional-with-hidden-default fields internally).
- `packages/thread-view`: partial-turn summary row variant (or a `phase: "in-progress"`
  field on the existing `kind:"turn"` row — prefer extending the existing row so the
  client render path is shared).
- No change to `routes.events` / CLI / SDK raw-event surfaces; agents keep full
  fidelity. Document the timeline route behavior change (bounded active-turn
  projection) in the route docs since it is non-obvious to consumers that relied on
  every event appearing in the projection — that was #711's flagged compatibility risk.

## 6. Edge cases to handle

- **Mid-turn user steering** (`turn/input/accepted`, 76 in the sample turn): completed
  grouping already splits summaries on external user boundaries and keeps those user
  messages visible. Paged detail cursors must stay within one summary range; the
  active-turn collapse frontier must not swallow a user boundary silently — split the
  partial summary the same way.
- **Interrupted/failed turns**: `isCompletedTurn` requires `completedAt !== null`;
  verify interrupted turns (`system/thread/interrupted`) still converge to the
  completed-collapse path rather than staying in the flat active rendering forever.
- **Pruned events under a cursor**: retention sweeps delete old deltas/outputs; a
  stale `earlierCursor` should degrade to "earlier work unavailable", not a 400.
  (Top-level stale cursors already recover this way in the controller.)
- **Row identity across the collapse frontier**: rows migrating from live tail into the
  collapsed prefix disappear from the top-level list; chunked migration + stable
  summary row id keeps `preserveTimelineRowIdentity` and React.memo effective.
- **Delta correctness**: `computeTimelineRowDelta` must treat the partial summary row's
  chunk-step changes as row updates, not full-response invalidations.

## 7. Verification plan

- Unit: extend `timeline-pagination.test.ts` patterns for paged detail (item-space
  cursors, boundary snapping, steering-message splits); in-memory SQLite via
  `createConnection(":memory:")` + `migrate(db)` per repo rules.
- Real-data QA (read-only): copy `bb.db` into a scratch data dir and attach a dev app
  (`BB_SERVER_PORT` attach mode / `scripts/bb-dev-app`); load `thr_n8ptu7bf8f` and
  measure: initial timeline response size, expand-page size, and per-tick main-thread
  time with the 7k-event turn simulated as active.
- Targets: initial latest page < 500 KB on the 39 MB thread; expand page < 300 KB;
  active-turn delta tick independent of turn length; no scroll jump on collapse
  migration, expansion, or "Show earlier work" prepend.

## 8. Open questions

1. Tail size K and page size: fixed counts vs byte-budgeted (probably both: item count
   cap + byte cap, whichever hits first).
2. Should the partial summary row show live aggregate counts ("412 commands so far")
   or just duration? Counts are cheap (indexed COUNT) and useful.
3. Does anything besides the app consume the timeline projection (public thread pages,
   plugins)? Audit before changing active-turn projection shape.
4. Whether Phase C virtualization is needed at all post-A/B — decide from profiling,
   not up front.

## Suggested sequencing

Phase A (paged completed-turn detail) ships alone and immediately fixes the
"expand a giant turn" freeze with zero change to live behavior. Phase B builds on A's
route. Phase C is independent. Each phase is separately revertible — the #711 lesson
applied to rollout, not just design.
