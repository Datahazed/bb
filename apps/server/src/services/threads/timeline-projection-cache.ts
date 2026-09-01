import type { ThreadTimelineFromEventsResult } from "@bb/thread-view";

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

export function clearTimelineProjectionCacheForThreads(
  threadIds: readonly string[],
): void {
  if (threadIds.length === 0) {
    return;
  }
  const prefixes = threadIds.map(
    (threadId) => JSON.stringify([threadId]).slice(0, -1) + ",",
  );
  for (const key of [...entries.keys()]) {
    if (prefixes.some((prefix) => key.startsWith(prefix))) {
      entries.delete(key);
    }
  }
}
