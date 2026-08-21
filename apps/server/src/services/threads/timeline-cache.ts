import type { ThreadTimelineResponse } from "@bb/server-contract";
import type { ThreadStatus } from "@bb/domain";
import type { ThreadTimelinePageRequest } from "./timeline-pagination.js";

/**
 * Idle/warm-repeat cache for built timeline responses.
 *
 * `buildThreadTimeline` is a pure, deterministic projection of a thread's
 * events. The build (event JSON-decode + projection) is the dominant cost of a
 * timeline request (~130-260ms on large threads) and is recomputed from scratch
 * on every request — there is no other caching. The same window is rebuilt
 * verbatim whenever a thread is refetched without new events: double-mounts
 * (detail view + side-chat tabs), debounced realtime invalidations that fire
 * after the tail already settled, and re-opening a thread.
 *
 * Entries are keyed by request shape (`paramsKey`) and store the thread
 * high-water `maxSeq` they were built at. A request with a different `maxSeq`
 * is a miss that *replaces* the slot: `maxSeq` never decreases, so the old
 * revision could never be looked up again and keeping it until global LRU
 * eviction only pins a dead response per appended event (#2066). The request
 * shape MUST include every other input the projection depends on:
 * `thread.status` (interrupt flips earlier rows), `environmentId` (workspace
 * root relativizes file paths), provider display name (labels dynamic-provider
 * diagnostic rows), and the row-shape request flags. Event pruning
 * (`pruneResolvedItemDeltas`, background-task progress) is output-preserving
 * and never lowers `maxSeq`, so it cannot stale a cached entry.
 *
 * Entries with many rows are not cached: an expanded active turn (the streaming
 * case) produces hundreds of rows that are rebuilt on every event, so storing
 * them pins a large object for no reuse. The per-shape slot bounds the *count*
 * of retained revisions; the row cap bounds their *size*.
 */

const DEFAULT_MAX_ENTRIES = 128;
const DEFAULT_MAX_CACHEABLE_ROWS = 200;

interface ThreadTimelineCacheOptions {
  maxEntries?: number;
  /** Responses with more rows than this are returned but not stored. */
  maxCacheableRows?: number;
}

interface ThreadTimelineCache {
  getOrBuild(
    key: { paramsKey: string; maxSeq: number },
    build: () => ThreadTimelineResponse,
  ): ThreadTimelineResponse;
  /** Number of currently cached entries (for tests/metrics). */
  readonly size: number;
}

export function createThreadTimelineCache(
  options: ThreadTimelineCacheOptions = {},
): ThreadTimelineCache {
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const maxCacheableRows =
    options.maxCacheableRows ?? DEFAULT_MAX_CACHEABLE_ROWS;
  const entries = new Map<
    string,
    { maxSeq: number; value: ThreadTimelineResponse }
  >();

  return {
    getOrBuild({ paramsKey, maxSeq }, build) {
      const cached = entries.get(paramsKey);
      if (cached?.maxSeq === maxSeq) {
        // Re-insert to mark most-recently-used.
        entries.delete(paramsKey);
        entries.set(paramsKey, cached);
        return cached.value;
      }

      const value = build();
      // A newer revision supersedes the stored one even when the new value is
      // too large to cache: the old one can never hit again.
      entries.delete(paramsKey);
      if (value.rows.length <= maxCacheableRows) {
        entries.set(paramsKey, { maxSeq, value });
        while (entries.size > maxEntries) {
          const oldest = entries.keys().next().value;
          if (oldest === undefined) {
            break;
          }
          entries.delete(oldest);
        }
      }
      return value;
    },
    get size() {
      return entries.size;
    },
  };
}

export interface ThreadTimelineCacheKeyArgs {
  threadId: string;
  status: ThreadStatus;
  environmentId: string | null;
  providerDisplayName?: string;
  page: ThreadTimelinePageRequest;
  includeNestedRows: boolean;
  summaryOnly: boolean;
  includeProviderUnhandledOperations: boolean;
}

function pageKeyPart(page: ThreadTimelinePageRequest): string {
  return page.kind === "older"
    ? `older:${page.segmentLimit}:${page.beforeCursor.anchorSeq}:${page.beforeCursor.anchorId}`
    : `latest:${page.segmentLimit}`;
}

/**
 * The request shape: everything that selects which window is being requested,
 * but not which revision (`maxSeq`) of it. Shared by the response cache and the
 * latest-rows delta cache.
 */
export function buildThreadTimelineParamsKey(
  args: ThreadTimelineCacheKeyArgs,
): string {
  return [
    args.threadId,
    args.status,
    args.environmentId ?? "-",
    args.providerDisplayName ?? "-",
    pageKeyPart(args.page),
    args.includeNestedRows ? "1" : "0",
    args.summaryOnly ? "1" : "0",
    args.includeProviderUnhandledOperations ? "1" : "0",
  ].join("|");
}
