import { useCallback, useEffect, useState } from "react";
import type {
  ThreadTimelineFeedResponse,
  TimelineFeedRow,
  TimelinePaginationCursor,
} from "@bb/server-contract";
import { useThreadTimelineFeed } from "@/hooks/queries/thread-queries";
import * as api from "@/lib/api";

interface UseThreadTimelinePagesArgs {
  threadId: string;
}

interface UseThreadTimelinePagesResult {
  activeThinking: ThreadTimelineFeedResponse["activeThinking"];
  contextWindowUsage: ThreadTimelineFeedResponse["contextWindowUsage"];
  hasOlderTimelineRows: boolean;
  isLoadingOlderTimelineRows: boolean;
  loadOlderTimelineRows: () => Promise<void>;
  pendingTodos: ThreadTimelineFeedResponse["pendingTodos"];
  timelineError: Error | null;
  timelineLoading: boolean;
  timelineRows: readonly TimelineFeedRow[];
}

type NullableTimelinePaginationCursor = TimelinePaginationCursor | null;

export interface LoadedTimelineState {
  olderCursor: NullableTimelinePaginationCursor;
  rows: readonly TimelineFeedRow[];
  surfaceKey: string;
}

interface BuildLoadedTimelineStateArgs {
  latestRows: readonly TimelineFeedRow[];
  olderCursor: NullableTimelinePaginationCursor;
  surfaceKey: string;
}

interface AreTimelinePaginationCursorsEqualArgs {
  left: NullableTimelinePaginationCursor;
  right: NullableTimelinePaginationCursor;
}

export interface MergeLatestTimelineRowsArgs {
  latestRows: readonly TimelineFeedRow[];
  loadedRows: readonly TimelineFeedRow[];
}

interface MergeLatestTimelineRowsResult {
  hasLatestOverlap: boolean;
  rows: readonly TimelineFeedRow[];
}

interface TimelineRowIdentityEntry {
  row: TimelineFeedRow;
  signature: string;
}

interface PreserveTimelineRowIdentityArgs {
  nextRows: readonly TimelineFeedRow[];
  previousRows: readonly TimelineFeedRow[];
}

interface AreTimelineRowReferencesEqualArgs {
  left: readonly TimelineFeedRow[];
  right: readonly TimelineFeedRow[];
}

export interface PrependOlderTimelineRowsArgs {
  loadedRows: readonly TimelineFeedRow[];
  olderRows: readonly TimelineFeedRow[];
}

export interface MergeLoadedTimelineWithLatestArgs {
  current: LoadedTimelineState;
  latestTimeline: ThreadTimelineFeedResponse;
  surfaceKey: string;
}

export interface RecoverLoadedTimelineAfterStaleCursorArgs {
  current: LoadedTimelineState;
  latestTimeline: ThreadTimelineFeedResponse;
  surfaceKey: string;
}

function buildSurfaceKey({ threadId }: UseThreadTimelinePagesArgs): string {
  return threadId;
}

function buildLoadedTimelineState({
  latestRows,
  olderCursor,
  surfaceKey,
}: BuildLoadedTimelineStateArgs): LoadedTimelineState {
  return {
    olderCursor,
    rows: [...latestRows],
    surfaceKey,
  };
}

function areTimelinePaginationCursorsEqual({
  left,
  right,
}: AreTimelinePaginationCursorsEqualArgs): boolean {
  if (left === null || right === null) {
    return left === right;
  }
  return left.anchorSeq === right.anchorSeq && left.anchorId === right.anchorId;
}

function appendTimelineRowsPreservingOrder(
  target: TimelineFeedRow[],
  rows: readonly TimelineFeedRow[],
): void {
  const seenIds = new Set(target.map((row) => row.key));
  for (const row of rows) {
    if (seenIds.has(row.key)) {
      continue;
    }
    seenIds.add(row.key);
    target.push(row);
  }
}

function timelineRowIdentitySignature(row: TimelineFeedRow): string {
  return JSON.stringify(row) ?? "";
}

function buildTimelineRowIdentityMap(
  rows: readonly TimelineFeedRow[],
): ReadonlyMap<string, TimelineRowIdentityEntry> {
  const rowsById = new Map<string, TimelineRowIdentityEntry>();
  for (const row of rows) {
    rowsById.set(row.key, {
      row,
      signature: timelineRowIdentitySignature(row),
    });
  }
  return rowsById;
}

function preserveTimelineRowIdentity({
  nextRows,
  previousRows,
}: PreserveTimelineRowIdentityArgs): TimelineFeedRow[] {
  const previousRowsById = buildTimelineRowIdentityMap(previousRows);
  return nextRows.map((row) => {
    const previous = previousRowsById.get(row.key);
    if (previous && previous.signature === timelineRowIdentitySignature(row)) {
      return previous.row;
    }
    return row;
  });
}

function areTimelineRowReferencesEqual({
  left,
  right,
}: AreTimelineRowReferencesEqualArgs): boolean {
  if (left.length !== right.length) return false;
  return left.every((row, index) => row === right[index]);
}

export function prependOlderTimelineRows({
  loadedRows,
  olderRows,
}: PrependOlderTimelineRowsArgs): TimelineFeedRow[] {
  const rows: TimelineFeedRow[] = [];
  appendTimelineRowsPreservingOrder(rows, olderRows);
  appendTimelineRowsPreservingOrder(rows, loadedRows);
  return rows;
}

export function mergeLatestTimelineRows({
  latestRows,
  loadedRows,
}: MergeLatestTimelineRowsArgs): MergeLatestTimelineRowsResult {
  const identityPreservedLatestRows = preserveTimelineRowIdentity({
    nextRows: latestRows,
    previousRows: loadedRows,
  });

  if (loadedRows.length === 0) {
    return {
      hasLatestOverlap: false,
      rows: identityPreservedLatestRows,
    };
  }

  const latestRowIds = new Set(latestRows.map((row) => row.key));
  const firstLatestOverlapIndex = loadedRows.findIndex((row) =>
    latestRowIds.has(row.key),
  );
  if (firstLatestOverlapIndex === -1) {
    const rows = [...loadedRows];
    appendTimelineRowsPreservingOrder(rows, identityPreservedLatestRows);
    if (areTimelineRowReferencesEqual({ left: loadedRows, right: rows })) {
      return {
        hasLatestOverlap: false,
        rows: loadedRows,
      };
    }
    return {
      hasLatestOverlap: false,
      rows,
    };
  }

  const rows = [
    ...loadedRows.slice(0, firstLatestOverlapIndex),
    ...identityPreservedLatestRows,
  ];
  if (areTimelineRowReferencesEqual({ left: loadedRows, right: rows })) {
    return {
      hasLatestOverlap: true,
      rows: loadedRows,
    };
  }

  return {
    hasLatestOverlap: true,
    rows,
  };
}

export function mergeLoadedTimelineWithLatest({
  current,
  latestTimeline,
  surfaceKey,
}: MergeLoadedTimelineWithLatestArgs): LoadedTimelineState {
  if (
    current.surfaceKey !== surfaceKey ||
    (current.rows.length === 0 && current.olderCursor === null)
  ) {
    return buildLoadedTimelineState({
      latestRows: latestTimeline.rows,
      olderCursor: latestTimeline.timelinePage.olderCursor,
      surfaceKey,
    });
  }

  const latestMerge = mergeLatestTimelineRows({
    latestRows: latestTimeline.rows,
    loadedRows: current.rows,
  });

  return {
    ...current,
    olderCursor: current.olderCursor,
    rows: latestMerge.rows,
  };
}

export function recoverLoadedTimelineAfterStaleCursor({
  current,
  latestTimeline,
  surfaceKey,
}: RecoverLoadedTimelineAfterStaleCursorArgs): LoadedTimelineState {
  if (current.surfaceKey !== surfaceKey) {
    return buildLoadedTimelineState({
      latestRows: latestTimeline.rows,
      olderCursor: latestTimeline.timelinePage.olderCursor,
      surfaceKey,
    });
  }

  const latestMerge = mergeLatestTimelineRows({
    latestRows: latestTimeline.rows,
    loadedRows: current.rows,
  });

  return {
    olderCursor: latestTimeline.timelinePage.olderCursor,
    rows: latestMerge.rows,
    surfaceKey,
  };
}

export function isStaleTimelinePaginationCursorError(error: Error): boolean {
  return (
    error instanceof api.HttpError &&
    error.status === 400 &&
    error.code === "invalid_request"
  );
}

export function useThreadTimelinePages({
  threadId,
}: UseThreadTimelinePagesArgs): UseThreadTimelinePagesResult {
  const latestTimelineQuery = useThreadTimelineFeed(threadId, {
    refetchOnMount: true,
    staleTime: Infinity,
  });
  const surfaceKey = buildSurfaceKey({ threadId });
  const [loadedTimeline, setLoadedTimeline] = useState<LoadedTimelineState>(
    () =>
      buildLoadedTimelineState({
        latestRows: [],
        olderCursor: null,
        surfaceKey,
      }),
  );
  const [isLoadingOlderTimelineRows, setIsLoadingOlderTimelineRows] =
    useState(false);
  const latestTimeline = latestTimelineQuery.data;

  useEffect(() => {
    if (!latestTimeline) {
      setLoadedTimeline((current) =>
        current.surfaceKey === surfaceKey
          ? current
          : buildLoadedTimelineState({
              latestRows: [],
              olderCursor: null,
              surfaceKey,
            }),
      );
      return;
    }

    setLoadedTimeline((current) =>
      mergeLoadedTimelineWithLatest({
        current,
        latestTimeline,
        surfaceKey,
      }),
    );
  }, [latestTimeline, surfaceKey]);
  const refetchLatestTimeline = latestTimelineQuery.refetch;

  const nextOlderCursor =
    loadedTimeline.surfaceKey === surfaceKey
      ? loadedTimeline.olderCursor
      : null;
  const hasOlderTimelineRows = nextOlderCursor !== null;
  const loadOlderTimelineRows = useCallback(async (): Promise<void> => {
    if (!nextOlderCursor || !threadId || isLoadingOlderTimelineRows) {
      return;
    }

    setIsLoadingOlderTimelineRows(true);
    try {
      const response = await api.getThreadTimelineFeed({
        beforeCursor: nextOlderCursor,
        id: threadId,
      });
      setLoadedTimeline((current) => {
        if (current.surfaceKey !== surfaceKey) {
          return current;
        }
        return {
          olderCursor: areTimelinePaginationCursorsEqual({
            left: current.olderCursor,
            right: nextOlderCursor,
          })
            ? response.timelinePage.olderCursor
            : current.olderCursor,
          rows: prependOlderTimelineRows({
            loadedRows: current.rows,
            olderRows: response.rows,
          }),
          surfaceKey,
        };
      });
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !isStaleTimelinePaginationCursorError(error)
      ) {
        throw error;
      }

      const latestTimelineResult = await refetchLatestTimeline();
      const recoveredLatestTimeline =
        latestTimelineResult.data ?? latestTimeline;
      setLoadedTimeline((current) => {
        if (current.surfaceKey !== surfaceKey) {
          return current;
        }
        if (!recoveredLatestTimeline) {
          return {
            ...current,
            olderCursor: null,
          };
        }
        return recoverLoadedTimelineAfterStaleCursor({
          current,
          latestTimeline: recoveredLatestTimeline,
          surfaceKey,
        });
      });
    } finally {
      setIsLoadingOlderTimelineRows(false);
    }
  }, [
    isLoadingOlderTimelineRows,
    latestTimeline,
    nextOlderCursor,
    refetchLatestTimeline,
    surfaceKey,
    threadId,
  ]);

  return {
    activeThinking: latestTimeline?.activeThinking ?? null,
    contextWindowUsage: latestTimeline?.contextWindowUsage,
    hasOlderTimelineRows,
    isLoadingOlderTimelineRows,
    loadOlderTimelineRows,
    pendingTodos: latestTimeline?.pendingTodos ?? null,
    timelineError: latestTimelineQuery.error,
    timelineLoading: latestTimelineQuery.isLoading,
    timelineRows:
      loadedTimeline.surfaceKey === surfaceKey && loadedTimeline.rows.length > 0
        ? loadedTimeline.rows
        : (latestTimeline?.rows ?? []),
  };
}
