# Control-plane performance harvest

Decision record for submitting these cuts to [get-bb/bb](https://github.com/get-bb/bb). Code has no narrative comments; this file is the why, the how, and the product benefit.

Work lives on [Datahazed/bb](https://github.com/Datahazed/bb) first. Submit to get-bb only when the PR body here is enough for an upstream reviewer who has not read this fork.

## Goal

Two rules, taken from T3 Code after comparing a live isolated bb desktop instance to T3:

1. Do less work before the thread view can paint.
2. Never block the Node serving loop on a synchronous SQLite read.

bb’s `AppLayout` (sidebar, command palette, chrome) already persists across routes. The sluggish part is the **center pane**: a URL change from new-thread to a thread unmounts `RootComposeView` and mounts `ThreadDetailView`, which then waits on network before it will paint. Electron hosts the same `apps/app` tree; web has the same remount. Window prefs and SQLite only show up in desktop, but they are still core bb (`apps/desktop`, `packages/db`, `apps/server`).

## How we arrived here

- Reproduced in the isolated bb-me Electron app (`projects-bb-me-1f069013c9e9`), not from a log line.
- Compared the same flows in T3: one `ChatView` with `routeKind: "draft" | "server"`, composer FLIP, drafts isolated from the sidebar, row `content-visibility`. bb keeps URLs and a compose/thread split; we did not copy T3’s router.
- Traced send → navigate → first paint in `RootComposeView.handleSubmit`, `applyCreateThreadResult`, `WorkspacePaneContent`, `ThreadDetailViewInternal`, `useThreadDetailBootstrap`.
- Rejected a ChatView merge and a “keep both views mounted” shell: two `SecondaryPanelLayout`s / native browser views (related get-bb #2298). Rejected `GET /threads/:id/open` as the first cut: new wire, new daemon compatibility.
- Each change is a separate PR so get-bb can take one without the others. Phase-order tests (`apps/app/src/test/perf-phase.ts`) fail if a first-paint cut is reverted to the slow order.

## Cuts

| Datahazed | get-bb | Independent | Ready to submit |
|---|---|---|---|
| [#1](https://github.com/Datahazed/bb/pull/1) hex Keychain | [#2931](https://github.com/get-bb/bb/pull/2931) Fixes [#2928](https://github.com/get-bb/bb/issues/2928) | yes | already opened |
| [#2](https://github.com/Datahazed/bb/pull/2) Electron prefs | [#2934](https://github.com/get-bb/bb/pull/2934) | yes | already opened |
| [#3](https://github.com/Datahazed/bb/pull/3) bootstrap sidecars | [#2935](https://github.com/get-bb/bb/pull/2935) | yes | already opened |
| [#4](https://github.com/Datahazed/bb/pull/4) SQLite worker | [#2936](https://github.com/get-bb/bb/pull/2936) | yes | already opened |
| [#5](https://github.com/Datahazed/bb/pull/5) timeline budget 400 | none yet; issue [#1749](https://github.com/get-bb/bb/issues/1749) | yes | yes |
| [#6](https://github.com/Datahazed/bb/pull/6) paint from cache | none yet; related [#1303](https://github.com/get-bb/bb/issues/1303) | yes | yes |
| [#7](https://github.com/Datahazed/bb/pull/7) bootstrap on create | none yet; related #1303 | yes; pairs with #6 | yes |
| [#8](https://github.com/Datahazed/bb/pull/8) pointerdown prefetch | none yet; related #1303 | stacked on #7 | submit after #7 |
| [#10](https://github.com/Datahazed/bb/pull/10) layout title from cache | none yet; related #1303 | stacked on #6 | submit after #6 |
| [#11](https://github.com/Datahazed/bb/pull/11) environment chrome from cache | none yet; related #1303 | stacked on #10 | submit after #10 |

## 1. Hex-encoded Claude Keychain

**Why.** Settings → Usage limits showed Claude as `unauthenticated` with empty windows while the CLI was logged in. 2.1.x stores `Claude Code-credentials` as hex JSON (`7b…` is `{`). bb parsed UTF-8 JSON, treated a non-empty Keychain read as success, and never opened `~/.claude/.credentials.json`.

**How.** `decodeCredentialBlob` hex-decodes then JSON-parses; file fallback if Keychain still yields nothing. Wire unchanged. No protocol bump. UA / percent / Fable mapping stays out so a credentials bug is not mixed with a parser change.

**Benefit to bb.** Every Mac install on Claude Code 2.1.x. Usage limits and any client of `provider.usage` see the same session/weekly/Fable windows the CLI shows. This is `plugins/provider-claude-code`, not the community Usage plugin.

**Test.** Hex blob and file fallback in `provider-maintenance.test.ts`.

## 2. Electron spellcheck and background throttling

**Why.** Spellcheck walks the DOM on every input; bb is a control plane. `backgroundThrottling` pauses timers in an occluded window, so streams, reconnect, and refetch stall. get-bb [#2693](https://github.com/get-bb/bb/issues/2693).

**How.** `spellcheck: false`, `session.setSpellCheckerEnabled(false)`, `backgroundThrottling: false` on window create and context-menu register. Remote-first startup already skipped `initializeRuntime`; not touched.

**Benefit to bb.** Packaged desktop only. Less main-thread work per keystroke; a covered window still paints tokens. Web unchanged.

**Test.** Window factory and context-menu tests expect the three prefs.

## 3. Timeline, queue, and approvals with bootstrap

**Why.** Thread open waited for `GET /threads/:id?include=environment,host`, then started timeline, queued messages, and pending interactions. First paint paid a waterfall. get-bb [#1303](https://github.com/get-bb/bb/issues/1303) (~19 requests).

**How.** `useThreadDetailBootstrap` still returns that GET. In the same turn it `prefetchQuery`s the three reads that do not need environment. Removed the AppLayout-only `timelinePrefetch` flag. Git work-status and PR reads still wait for environment.

**Benefit to bb.** Web and desktop. Opening any thread starts timeline/queue/approvals immediately instead of after the include GET. Not a new `/open` payload; enrolled daemons stay compatible.

**Decision.** One subscribe payload is the later cut. Bundling git/PR into bootstrap would over-fetch or invent that API.

**Test.** `sidecar-reads-started` before `bootstrap-settled` (`perf-phase.ts`). Reverting to a waterfall fails it.

## 4. SQLite off the serving loop

**Why.** `better-sqlite3` is sync. Thread-list and sidebar reads ran on the serving loop. A cold query on a 1.7GB `bb.db` froze every client for 11s, including WebSocket streams. get-bb [#1131](https://github.com/get-bb/bb/issues/1131).

**How.** File-backed `runServer` starts one readonly WAL worker. Thread list and sidebar project+thread reads go through it. `:memory:` and a worker that fails to start keep the sync path. Bundled servers emit `dist/sqlite-read-worker.js`. Search and timeline stay on the serving connection.

**Benefit to bb.** Local/desktop servers with a large db. Streaming and reconnect keep running while a sidebar query is in flight. Web talking to a hosted server benefits if that server uses this worker.

**Decision.** Not async sqlite, not a schema rewrite, not moving search/timeline yet. Worker is read-only so it cannot fight the writer.

**Test.** In-memory stays on the calling connection; file-backed worker returns the same thread list.

## 5. Timeline window event budget 400

**Why.** Default 1500 assumed ~0.06 ms/event (~100 ms cold build). Measured p50 is 0.479 ms/event (~720 ms) and blocks the serving loop. Cap bound on 2 of 76 threads. get-bb [#1749](https://github.com/get-bb/bb/issues/1749).

**How.** Default `timelineWindowEventBudget` is 400. `BB_FF_TIMELINE_WINDOW_EVENT_BUDGET` restores the old window. Config doc and bb-guide template match. Pagination still walks full history.

**Benefit to bb.** Every server, every thread open that rebuilds a window. Cold builds ~190 ms on a 4-core host in the issue’s numbers; cap binds for 19 threads instead of 2.

**Decision.** #1749 listed calibrate-at-startup, byte budget, or lower the constant. 400 is the measured workaround. No startup benchmark, cache key still `maxSeq`.

**Test.** Config default 400; env override still honored.

## 6. Paint thread chrome from cache

**Why.** Send on new-thread calls `createThread`, which already `setQueryData(threadQueryKey)`. Navigate then remounts `ThreadDetailView`, which **disabled** `useThread` until bootstrap settled, so `thread` was undefined, `threadQueryState` was `loading`, and the user saw `RouteLoadingSkeleton`. Same wait on any later open that already had the thread in cache. There is no get-bb issue for this remount; [#1303](https://github.com/get-bb/bb/issues/1303) is the closest (first paint waits on the fan-out).

**How.** `resolveThreadDetailQueryMount` enables `useThread` when `threadQueryKey` is already populated. Cold open with an empty cache still waits, so we do not add a duplicate `GET /threads/:id` next to the include fetch. Fresh bootstrap still suppresses that duplicate; stale bootstrap still refetches. Environment and hosts stay gated on bootstrap (not in the create payload).

**Benefit to bb.** Web and desktop, default “navigate to thread after create”. First paint after send is thread chrome from memory instead of a skeleton. Revisiting a cached thread is the same. No URL change, no plugin API change.

**Decision.** Keeping compose and thread mounted would leave two secondary panels / native browser views. Unifying `RootComposeView` and `ThreadDetailView` is a later identity change. This PR only reads cache we already write.

**Test.** `thread-chrome-ready` before `bootstrap-settled`. Waiting on the include GET to paint fails it. Empty cache still does not start a second thread GET.

## 7. Bootstrap as soon as create succeeds

**Why.** #6 paints chrome from `threadQueryKey`. Environment, host, and (with #3) timeline still started only after `ThreadDetailView` mounted. Create is the last moment we know the id before that remount.

**How.** `loadThreadDetailBootstrap` / `prefetchThreadDetailBootstrap` are the same queryFn the view uses. `useCreateThread` onSuccess prefetches it (one call site: compose, plugin composers, showcase hero). Navigate joins in-flight work. Cold sidebar opens unchanged.

**Benefit to bb.** Same send path as #6. Git-diff eligibility, hosts, and timeline can be ready on first paint instead of a round trip later. No protocol bump.

**Decision.** Pointerdown for sidebar clicks is #8, stacked here so the queryFn is shared. Do not prefetch with a different queryFn: a cache hit would skip the view’s sidecars.

**Test.** `bootstrap-get` before `create-returned`. Starting bootstrap only after the view mounts fails it.

## 8. Bootstrap on sidebar row pointerdown

**Why.** #7 covers create. A sidebar click still started bootstrap after mount. Pointerdown is ~one frame / ~100 ms before click.

**How.** Primary-button `pointerdown` on the row calls `prefetchThreadDetailBootstrap`. Right-click does not. Split-drag still gets the bubbled event. Stacked on #7.

**Benefit to bb.** Every thread open from the list, web and desktop. Hover prefetch would fire while scrolling; we did not do that.

**Decision.** Submit after #7 so get-bb does not review the helper twice. Keyboard Enter still starts bootstrap on mount; that path was not the measured stall.

**Test.** `bootstrap-prefetch` before `pointerdown-complete` before `click-complete`.

## 10. AppLayout title from cache

**Why.** #6 painted the thread pane from `threadQueryKey`. `AppLayout` still waited on bootstrap for `useThread`, so `document.title` and the favicon attention dot lagged the pane.

**How.** `useThread({ bootstrap })` applies `resolveThreadDetailQueryMount` inside the hook (it already owns the QueryClient). AppLayout passes the snapshot on thread routes. No extra provider in layout tests.

**Benefit to bb.** Web and desktop. Window title and favicon match the cached thread as soon as create/list have written it.

**Decision.** Not `useQueryClient` in AppLayout (breaks tests with no provider). Not starting `useEnvironment` before bootstrap (duplicate include GET).

**Test.** Same `thread-chrome-ready` before `bootstrap-settled`, now through `useThread({ bootstrap })`.

## 11. Environment and host chrome from cache

**Why.** After #6/#10 the thread pane and window title paint from `threadQueryKey`. Git-diff tab and host label still waited on this thread’s include GET, even when the environment (shared across threads in a project) was already in React Query from a previous ingest.

**How.** `resolveEnvironmentQueryMount` / `resolveHostsQueryMount` enable from cache while bootstrap is pending and set `refetchOnMount: false` so we do not add `GET /environments/:id` or `GET /hosts` next to the include fetch. Cold open with an empty cache still waits. Ingest still fills the cache.

**Benefit to bb.** Web and desktop. Switching threads in the same workspace shows git-diff eligibility and host label immediately.

**Decision.** Not enabling whenever `environmentId` is set (duplicate GET). Not starting git work-status or PR reads early.

**Test.** Cached env + pending bootstrap → enabled, no refetch, git-diff `eligible`. Empty cache waits.

## Out of this harvest

- Merging compose and thread into one ChatView, or hiding both mounted.
- `GET /threads/:id/open` one-payload subscribe.
- Remaining sync SQLite (search, timeline) on the worker.
- Startup calibrator / byte budget from #1749.
- Sidebar density / inbox layout (not a theme; `sidebarRowClasses.ts` and `BuiltInSidebarNavigation`).
- Right-hand panel (parked).
- Hover prefetch of every row.

## Submit order to get-bb

Already open: #2931, #2934, #2935, #2936.

Next independent: Datahazed #5 (budget), #6 (cache paint). Then #10 (layout title, stacked on #6), then #11 (environment chrome, stacked on #10). Then #7 (create prefetch), then #8 (pointerdown, stacked on #7). Copy the Datahazed PR body; it is written to stand alone.
