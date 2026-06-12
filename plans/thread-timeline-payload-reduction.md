# Thread Timeline Payload Reduction

## Problem

`GET /api/v1/threads/:id/timeline` can send very large responses because the
timeline response is currently a render-ready detail payload. The route paginates
by conversation segments, but a single active turn can contain many command/tool
rows, and those rows include full output bodies.

Observed on `thr_dqwsrxy3bz`:

- `buildThreadTimeline` response: about 571 KB JSON.
- returned timeline page: 78 rows, 1 segment, no older cursor.
- command output in completed command events: about 522 KB.
- largest single command row: about 91 KB.
- the thread has only one qualifying segment anchor, so the latest page covers
  the whole active turn.

Relevant code:

- Route: `apps/server/src/routes/threads/data.ts`
- Timeline service/windowing: `apps/server/src/services/threads/timeline.ts`
- Timeline row contract: `packages/server-contract/src/thread-timeline.ts`
- Projection: `packages/thread-view/src/build-thread-timeline.ts`
- Pending-turn detail behavior:
  `packages/thread-view/src/apply-turn-message-detail.ts`
- App timeline query/invalidation:
  `apps/app/src/hooks/queries/thread-queries.ts`
  `apps/app/src/hooks/cache-owners/realtime-cache-registry.ts`

## Goals

- Keep the first timeline response small even for a long active turn.
- Preserve current UI behavior: users can still inspect full command output,
  tool output, diffs, assistant text, and delegation details.
- Avoid refetching the same large historical payload on every appended event.
- Keep timeline pagination and lazy turn-summary detail behavior coherent.
- Make payload size observable and regression-testable.

## Non-Goals

- Do not change event storage as the primary fix. Retention truncation is useful
  after 7 days, but the route must be bounded for current active threads.
- Do not remove details from the product. Move large details behind explicit
  lazy detail routes instead.
- Do not solve general websocket/event-delta synchronization in this pass unless
  the scoped timeline invalidation changes are insufficient.

## Design Principles

- The app's default timeline route is a feed route. It returns stable row
  shells, pagination, and small previews only. It must not return full detail
  bodies by default.
- Detail projections are separate. Command output, tool output, system detail,
  file diffs/stdout/stderr, delegation child rows, workflow snapshots, and long
  conversation text all load through typed detail routes.
- Feed rows must have a bounded size per row. A row can carry a preview, but a
  preview is explicitly modeled as a preview and has a fixed cap.
- Keep row identity stable but compact. Do not repeat `threadId` in every row,
  and do not use long renderer-derived IDs as the only row identity in the feed.
- Use source sequence bounds as detail-version data. A detail fetch must fail or
  miss cache when the row's source range changes.
- The renderer contract and the API contract are different contracts. The server
  may still build rich `TimelineRow` objects internally, but the app feed API
  should serialize a smaller `TimelineFeedRow` shape.
- Avoid optional fields that are accepted but ignored. If a row advertises a
  detail reference, every relevant renderer must use it.

## Current Shape Assessment

The current payload is the wrong shape for the app's default timeline fetch. It
uses one `TimelineRow` contract for three different jobs:

1. Feed identity and pagination.
2. Collapsed-row rendering.
3. Expanded-row detail rendering.

That conflation is why visually small timelines can still exceed 10 KB. The
route repeats `threadId`, long row ids, source bounds, timestamps, status fields,
and kind-specific metadata per row. That overhead is bounded but not free: on the
measured active thread, a 20-row page with all display text/detail removed is
still about 8-9 KB. The real bug is not that the shell costs several KB; the bug
is that the shell route can also include unbounded bodies:

- command/tool output
- system operation detail/provisioning transcripts
- file diffs plus stdout/stderr
- delegation `childRows`
- workflow progress snapshots
- long assistant/user text

The prototype only moved command/tool output behind lazy loading. That proves the
approach, but the proper design is a feed/detail split across all heavy row
kinds.

## Prototype Status

Implemented in this worktree:

- Added typed feed/detail API contracts:
  - `GET /api/v1/threads/:id/timeline/feed`
  - `GET /api/v1/threads/:id/timeline/rows/:rowKey/detail`
  - existing `GET /api/v1/threads/:id/timeline/work-output` remains the
    specialized full-output route for command/tool bodies.
- Removed the legacy full-detail `GET /api/v1/threads/:id/timeline` route and
  its public contract/query helpers. SDK, CLI, app queries, cache invalidation,
  and status/pending-TODO reads now use the feed route.
- Server feed rows now serialize compact row keys, source ranges, bounded text
  previews, precomputed bundle/step summary titles, and detail refs.
- Summary rows are serialized in the feed as summary rows, not as raw work-row
  bursts. This is the key shape fix for active turns with many completed work
  rows.
- Detail route reconstructs full detail from the source range for summary
  children, conversation text, system detail, file diff/stdout/stderr,
  delegation children/output, and workflow snapshots.
- App thread detail now loads `/timeline/feed` for latest and older timeline
  pages.
- App renderer adapts feed rows into the existing timeline renderer and lazy
  hydrates details when needed:
  - long conversation text loads by row detail.
  - summary/delegation/system bodies load by row detail on expansion.
  - file diffs and workflow snapshots load by row detail on expansion.
  - command/tool output continues to load through the work-output detail route.
- Timeline feed/detail query keys are separate from legacy timeline keys, so
  existing optimistic legacy row cache updates cannot corrupt feed responses.
- Thread-detail bootstrap prefetch now warms the feed query.
- The shared feed-to-view adapter lives in `@bb/thread-view`, so the app and CLI
  use the same feed interpretation for timeline rendering.

Current measured payload confidence:

- Original live investigation thread `thr_dqwsrxy3bz`: legacy timeline was about
  571 KB JSON, with about 522 KB of command output.
- Later live measurement on the same growing thread: legacy full response was
  about 342.9 KiB and feed response about 86.8 KiB, a 74.7% reduction.
- Synthetic stress fixture with 30 completed commands in one active turn and
  20 KB output per command: legacy timeline exceeds 500 KB; feed route stays
  under 20 KB and summary detail returns the 30 children.

Verification now passing:

- `pnpm exec turbo run typecheck --filter=@bb/server-contract --filter=@bb/thread-view --filter=@bb/sdk --filter=@bb/cli --filter=@bb/server --filter=@bb/app`
- `pnpm exec turbo run test --filter=@bb/app --filter=@bb/cli --filter=@bb/server --filter=@bb/server-contract --filter=@bb/thread-view --filter=@bb/sdk --force`

Remaining work is mainly Phase 5 and Phase 6: reduce refetch amplification and
perform end-to-end QA/measurement against the running app.

## Proposed Feed Contract

Use the app-facing feed route rather than growing query flags on the removed
legacy full-detail route:

- `GET /api/v1/threads/:id/timeline/feed`
- `GET /api/v1/threads/:id/timeline/rows/:rowKey/detail`

The full-detail `/timeline` route has been removed. CLI log output uses the
feed route plus the shared feed-to-view adapter; full heavy row bodies remain
available only through typed detail routes.

Feed response shape:

```ts
interface TimelineFeedResponse {
  threadId: string;
  rows: TimelineFeedRow[];
  activeThinking: ActiveThinking | null;
  pendingTodos: ThreadTimelinePendingTodos | null;
  contextWindowUsage?: ThreadContextWindowUsage;
  page: TimelinePageMetadata;
}
```

Feed row base:

```ts
interface TimelineFeedRowBase {
  key: string;
  kind:
    | "conversation"
    | "system"
    | "turn"
    | "work"
    | "bundle-summary"
    | "step-summary";
  source: {
    start: number;
    end: number;
  };
  createdAt: number;
  startedAt: number;
  turnKey: string | null;
  status?: TimelineRowStatus;
  detail?: TimelineRowDetailRef;
}
```

Notes:

- `key` is a compact, stable row key local to the thread. It should be derived
  from source range plus kind/call id/index, not from the current long
  renderer-facing `id` string.
- `threadId` moves to the response envelope and is not repeated per row.
- `turnKey` should be nullable and compact. The app can map it back to the
  thread from the response envelope.
- `source.end` is the row version for cache invalidation and React row
  signatures. Detail queries include the source range so stale detail fetches
  naturally miss or 404.

Shared preview/detail types:

```ts
interface TimelineTextPreview {
  text: string;
  fullLength: number;
  complete: boolean;
}

interface TimelineRowDetailRef {
  rowKey: string;
  source: {
    start: number;
    end: number;
  };
  parts: TimelineRowDetailPart[];
}

type TimelineRowDetailPart =
  | "text"
  | "output"
  | "system-detail"
  | "file-diff"
  | "stdout"
  | "stderr"
  | "children"
  | "workflow";
```

Kind-specific feed row rules:

- Conversation rows carry `role`, `turnRequest`, attachment counts/paths, mention
  metadata, and `textPreview`. Long text is lazy detail; short text can have
  `complete: true`.
- System rows carry `systemKind`, `operationKind`, title, status, parent-change
  summary fields, and `detailPreview`. Full detail is lazy.
- Command rows carry command/cwd/source, exit code, approval status, activity
  intents, and `outputPreview`. Full output is lazy.
- Tool rows carry tool name, compact args summary or capped args preview,
  approval status, activity intents, and `outputPreview`. Full args/output are
  lazy if large.
- File-change rows carry path/kind/movePath/diff stats and capped diff preview.
  Full diff/stdout/stderr are lazy.
- Delegation rows carry child count, active/terminal status, subagent metadata,
  and an optional children detail ref. Do not inline `childRows` for closed
  delegations by default. Pending delegations can include a bounded active
  frontier if needed to preserve live UX.
- Turn rows carry counts/status and a children detail ref. Completed turn
  children remain lazy. Active turn children use feed-shell rows, not full
  detail rows.
- Bundle/step summary rows carry a precomputed title, child count, source
  bounds, and a `children` detail ref. This is required because the current app
  already visually collapses many raw work rows; the feed must serialize that
  collapsed view shape instead of the raw work-row stream.
- Workflow rows carry small progress summary fields. Full workflow snapshots are
  lazy once they exceed a cap.

Detail route shape:

```ts
interface TimelineRowDetailQuery {
  sourceSeqStart: string;
  sourceSeqEnd: string;
  parts: string;
}

interface TimelineRowDetailResponse {
  rowKey: string;
  source: {
    start: number;
    end: number;
  };
  parts: {
    text?: string;
    output?: string;
    systemDetail?: string;
    fileDiff?: string;
    stdout?: string | null;
    stderr?: string | null;
    children?: TimelineFeedRow[];
    workflow?: WorkflowProgressSnapshot | null;
  };
}
```

Prefer one row-detail route with a constrained `parts` enum over many narrowly
named routes once the lookup key is standardized. If a row kind needs genuinely
different identity, add a kind-specific detail route and document why.

Relationship to `plans/background-command-support.md`: that plan already
requires lazy command output for background commands. This plan should reuse the
same output reconstruction service and route where possible, but broaden it to
normal foreground command rows.

## Size Targets

Targets should focus on boundedness, not a universal sub-10-KB guarantee:

- Empty feed envelope: under 1 KB.
- Typical 20-row feed page with short messages and no expanded detail: under
  10-15 KB uncompressed JSON.
- 20-row page with active command/tool output, system transcript, file diff, or
  delegation children: still under 25 KB uncompressed JSON because all heavy
  bodies are previews/detail refs.
- Large active-turn stress fixture with many completed command outputs: under
  50 KB uncompressed JSON.
- Full detail fetches may be large, but only when the user expands/copies the
  row and only for that row/source range.

HTTP compression can reduce repeated JSON keys substantially, but it is
supplemental. The contract must be bounded before compression.

## Phases

### Phase 1: Instrument And Lock The Baseline

1. Add a dev-only or test-only helper that reports timeline response bytes,
   selected event bytes, row count, and largest row contributors. Prefer an
   existing internal profile path if one is already intended for this; otherwise
   expose it only in tests.
2. Add server tests that create a thread with one active turn and multiple large
   completed command outputs, then assert the current baseline exceeds a known
   threshold. This test can be changed to the new expected cap in Phase 3.
3. Add a focused projection/unit test proving pending turns currently include
   completed command detail, so the behavior change is deliberate.

Exit criteria:

- There is a repeatable test fixture for the large-active-turn case.
- The test can identify response byte size and largest row class.
- No production API exposes profiling data unless explicitly intended.

Validation:

- `pnpm exec turbo run test --filter=@bb/server --force > /tmp/thread-timeline-payload-server.txt 2>&1`
- Read `/tmp/thread-timeline-payload-server.txt`.

### Phase 2: Add Feed And Detail Contracts

Status: implemented in prototype.

1. Define `TimelineFeedResponse`, `TimelineFeedRow`, `TimelineTextPreview`, and
   `TimelineRowDetailRef` in `packages/server-contract`.
2. Add route contracts for `/threads/:id/timeline/feed` and
   `/threads/:id/timeline/rows/:rowKey/detail`.
3. Keep the existing `/threads/:id/timeline` `TimelineRow` contract as the
   legacy full-detail route for CLI/raw compatibility during migration.
4. Update SDK/app API helpers for the feed and detail routes.
5. Add contract tests for compact row identity, preview completeness, detail
   refs, and route URLs.

Exit criteria:

- The app has a typed feed contract, and the removed full-detail route is no
  longer part of the public API.
- Feed rows clearly distinguish preview fields from full detail fields.
- No feed row carries a large body unless it is below the preview cap and marked
  `complete: true`.
- Contract tests cover route URLs, schema parsing, and detail part enums.

Validation:

- `pnpm exec turbo run typecheck --filter=@bb/server-contract`
- `pnpm exec turbo run test --filter=@bb/server-contract`

### Phase 3: Server Builds Bounded Feed Rows

Status: implemented in prototype for the app-facing feed route. Additional
stress fixtures can be added if new heavy row kinds regress.

1. Add shared preview-building utilities with explicit caps. Initial candidate:
   retain about 2 KB head and 2 KB tail for text/output, with a marker.
2. Add a server-side mapper from projected `TimelineRow` to `TimelineFeedRow`.
   It should strip full bodies, compact row identity, move `threadId` to the
   response envelope, and emit detail refs for heavy parts.
3. Add detail services that reconstruct full detail from selected event rows:
   - command/tool output from `item/started`, output deltas, and
     `item/completed`.
   - system operation detail/provisioning transcripts from operation rows.
   - file-change detail from the relevant projected row source range.
   - delegation child feed rows from the child projection source.
   - workflow snapshots from workflow progress rows.
   - long conversation text from message rows.
4. Ensure pending turns can still show active streaming output. Active rows use
   bounded previews that update live; historical completed rows in the same
   pending turn must not resend full bodies.
5. Keep CLI/status tail metadata reads on the feed route so those consumers do
   not need a separate full-detail compatibility surface.

Exit criteria:

- The large-active-turn feed fixture response is below the agreed cap. Initial
  target: under 50 KB for the measured `thr_dqwsrxy3bz`-style fixture.
- Full command/tool/system/file/delegation/workflow/conversation detail is still
  available from lazy routes.
- Older-page and latest-page pagination still work with previews.
- The app feed route no longer depends on 7-day event-output truncation to stay
  small.

Validation:

- `pnpm exec turbo run test --filter=@bb/server --force > /tmp/thread-timeline-payload-server.txt 2>&1`
- Read `/tmp/thread-timeline-payload-server.txt`.
- `pnpm exec turbo run typecheck --filter=@bb/server`

### Phase 4: App Uses Feed Rows And Loads Detail On Demand

Status: implemented in prototype for thread detail. Existing story/audit
surfaces can still pass legacy `timelineRows`.

1. Move app timeline queries from `/timeline` to `/timeline/feed`.
2. Update timeline row components or add an adapter so existing renderers consume
   feed rows without needing legacy full-detail rows.
3. Load full details only when the row detail is expanded or when a copy/open
   action needs the full body.
4. Cache lazy detail queries by thread id, row key, requested parts, and source
   bounds.
5. Preserve current interactions: expansion, auto-expansion, copy, terminal
   output linkification, local file links, unread divider behavior, and
   turn-summary lazy loading.

Exit criteria:

- Expanding a row loads full detail exactly once per cache key.
- Collapsed rows never require full detail fetches.
- Existing timeline visual behavior remains intact.
- Large output, diffs, system detail, delegation children, and long text can
  still be copied or inspected.

Validation:

- `pnpm exec turbo run typecheck --filter=@bb/app`
- Focused app tests for preview rendering and detail loading.
- Manual QA on a thread with large command output:
  - initial timeline load is small.
  - row expansion fetches full detail.
  - navigating away/back uses cached preview/detail correctly.

### Phase 5: Reduce Refetch Amplification

1. Audit `events-appended` invalidation for timeline queries.
2. Avoid invalidating older loaded pages when only latest-page state changed.
3. Consider patching the active latest timeline cache from event notifications
   for simple appended-output updates, or rate-limit latest timeline refetches
   while a turn is active.
4. Keep turn-summary detail queries invalidated only when their source range
   could have changed.

Exit criteria:

- Appended events no longer cause repeated full-page payload fetches for stable
  historical rows.
- Latest live state still updates promptly.
- Older pages and loaded detail queries do not churn during active streaming.

Validation:

- Existing realtime cache tests continue to pass.
- Add tests for timeline invalidation scope:
  - appended event dirties latest timeline state.
  - older timeline detail caches are not unnecessarily refetched.
  - turn-summary detail invalidation remains correct.

Suggested command:

- `pnpm exec turbo run test --filter=@bb/app --force > /tmp/thread-timeline-payload-app.txt 2>&1`
- Read `/tmp/thread-timeline-payload-app.txt`.

### Phase 6: End-To-End QA

1. Start the dev app with `scripts/bb-dev-app current`.
2. Create or use a thread that runs several commands with large stdout.
3. Measure `/api/v1/threads/:id/timeline/feed` response size from the server.
4. Open the app and verify:
   - timeline loads quickly.
   - rows initially show previews.
   - expanding rows loads full details.
   - active streaming still updates.
   - loading older messages remains correct.

Exit criteria:

- Initial feed response for the large-output test thread stays under the
  agreed cap.
- No repeated multi-hundred-KB timeline fetches while command output streams.
- Full detail remains accessible and accurate.
- Server, contract, thread-view, and app typechecks/tests pass.

Validation:

- `pnpm exec turbo run typecheck --filter=@bb/server`
- `pnpm exec turbo run typecheck --filter=@bb/app`
- `pnpm exec turbo run test --filter=@bb/server --force > /tmp/thread-timeline-payload-server.txt 2>&1`
- `pnpm exec turbo run test --filter=@bb/app --force > /tmp/thread-timeline-payload-app.txt 2>&1`
- Read both `/tmp` files.

## Open Questions

- What exact preview cap should we use for command/tool output? Start with an
  8 KB total preview unless product needs more.
- Should the feed preview cap vary by row kind? The prototype uses a shared text
  preview model, but assistant text and diffs may deserve different caps.
- Should workflow feed rows carry enough compact progress data to render the
  timeline title's `(settled/total agents)` label without a full workflow
  snapshot? The prompt banner now preserves this via `workflowSummary`, but the
  row title still uses the full snapshot path.
- Do CLI consumers need full output by default, or should CLI use the same lazy
  detail path for verbose modes?

## Risks

- Contract churn is broad: server-contract, thread-view, app renderers, SDK, CLI
  formatting, fixtures, and stories may all need coordinated updates.
- Lazy routes must reconstruct output correctly after event pruning/truncation.
- Streaming output previews must not flicker or make expansion state stale.
- If invalidation is changed too aggressively, the UI can miss live timeline
  updates.

## Final Exit Criteria

- Default app feed route is bounded for active turns with large command output.
- Full row details are available through typed lazy routes.
- Realtime updates no longer resend large stable bodies repeatedly.
- Tests cover large active turns, lazy detail reconstruction, app rendering, and
  cache invalidation behavior.
- Manual QA confirms the timeline remains usable with large command output.
