import type { ThreadTimelineFromEventsResult } from "@bb/thread-view";

/**
 * Memoizes the canonical timeline projection per thread.
 *
 * The summary timeline projects the whole thread and pages by slicing the
 * projected rows, so one build serves every page, the delta path, and
 * repeated polls of an idle thread. Entries are keyed by the newest stored
 * event's id: appends change the tip, and suffix replacement (edit-message /
 * fork truncation) can reuse sequence numbers but never event ids, so a
 * stale entry can never be served.
 */
const MAX_ENTRIES = 64;

export interface CachedTimelineProjection {
  eventDataBytes: number;
  eventRowCount: number;
  timeline: ThreadTimelineFromEventsResult;
}

export interface TimelineProjectionCacheKeyArgs {
  includeNestedRows: boolean;
  includeProviderUnhandledOperations: boolean;
  maxInlineOutputChars: number | null;
  planCommandKey: string;
  providerDisplayName: string | undefined;
  threadId: string;
  threadName: string;
  threadStatus: string;
  tipEventCount: number;
  tipEventId: string;
  workspaceRoot: string | null;
}

export function buildTimelineProjectionCacheKey(
  args: TimelineProjectionCacheKeyArgs,
): string {
  return JSON.stringify([
    args.threadId,
    args.tipEventId,
    args.tipEventCount,
    args.includeNestedRows,
    args.includeProviderUnhandledOperations,
    args.maxInlineOutputChars,
    args.planCommandKey,
    args.providerDisplayName ?? null,
    args.threadName,
    args.threadStatus,
    args.workspaceRoot,
  ]);
}

const entries = new Map<string, CachedTimelineProjection>();

export function getCachedTimelineProjection(
  key: string,
): CachedTimelineProjection | undefined {
  const entry = entries.get(key);
  if (entry === undefined) {
    return undefined;
  }
  entries.delete(key);
  entries.set(key, entry);
  return entry;
}

export function setCachedTimelineProjection(
  key: string,
  value: CachedTimelineProjection,
): void {
  entries.delete(key);
  entries.set(key, value);
  while (entries.size > MAX_ENTRIES) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    entries.delete(oldest);
  }
}

/**
 * Appends, suffix replacement, and pruning invalidate naturally through the
 * tip-id + event-count key. Sweeps that rewrite stored events in place
 * (completed-output truncation) must clear the affected threads instead.
 */
export function clearTimelineProjectionCacheForThreads(
  threadIds: readonly string[],
): void {
  if (threadIds.length === 0) {
    return;
  }
  const prefixes = threadIds.map((threadId) => JSON.stringify([threadId]).slice(0, -1) + ",");
  for (const key of [...entries.keys()]) {
    if (prefixes.some((prefix) => key.startsWith(prefix))) {
      entries.delete(key);
    }
  }
}
