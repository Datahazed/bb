import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { replaceEqualDeep } from "@tanstack/react-query";
import type {
  ThreadTimelineResponse,
  TimelinePaginationCursor,
  TimelineRow,
} from "@bb/server-contract";
import { useConnectionAwareQueryState } from "@/hooks/queries/connection-aware-query-state";
import { isTransientReadError } from "@/hooks/queries/query-helpers";
import { useThreadTimeline } from "@/hooks/queries/thread-queries";
import * as api from "@/lib/api";

export type ThreadTimelineRowFilter = (row: TimelineRow) => boolean;

export interface UseThreadTimelineControllerArgs {
  enabled?: boolean;
  rowFilter?: ThreadTimelineRowFilter;
  surfaceKey?: string;
  threadId: string;
}

export interface UseThreadTimelineControllerResult {
  activePromptMode: ThreadTimelineResponse["activePromptMode"];
  activeThinking: ThreadTimelineResponse["activeThinking"];
  activeWorkflow: ThreadTimelineResponse["activeWorkflow"];
  activeBackgroundCommands: ThreadTimelineResponse["activeBackgroundCommands"];
  contextWindowUsage: ThreadTimelineResponse["contextWindowUsage"];
  goal: ThreadTimelineResponse["goal"];
  modelFallback: ThreadTimelineResponse["modelFallback"];
  hasOlderTimelineRows: boolean;
  isLoadingOlderTimelineRows: boolean;
  loadOlderTimelineRows: () => Promise<boolean>;
  paginationSurfaceKey: string;
  pendingTodos: ThreadTimelineResponse["pendingTodos"];
  timelineError: Error | null;
  timelineLoading: boolean;
  timelineRows: TimelineRow[];
}

type NullableTimelinePaginationCursor = TimelinePaginationCursor | null;

export interface LoadedTimelineState {
  olderCursor: NullableTimelinePaginationCursor;
  rows: TimelineRow[];
  surfaceKey: string;
}

interface BuildLoadedTimelineStateArgs {
  latestRows: TimelineRow[];
  olderCursor: NullableTimelinePaginationCursor;
  surfaceKey: string;
}

interface AreTimelinePaginationCursorsEqualArgs {
  left: NullableTimelinePaginationCursor;
  right: NullableTimelinePaginationCursor;
}

export interface MergeLatestTimelineRowsArgs {
  latestRows: readonly TimelineRow[];
  loadedRows: TimelineRow[];
}

interface MergeLatestTimelineRowsResult {
  hasLatestOverlap: boolean;
  rows: TimelineRow[];
}

interface TimelineRowIdentityEntry {
  row: TimelineRow;
  fastChangeSignature: string;
}

interface PreserveTimelineRowIdentityArgs {
  nextRows: readonly TimelineRow[];
  previousRows: readonly TimelineRow[];
}

interface AreTimelineRowReferencesEqualArgs {
  left: readonly TimelineRow[];
  right: readonly TimelineRow[];
}

export interface PrependOlderTimelineRowsArgs {
  loadedRows: readonly TimelineRow[];
  olderRows: readonly TimelineRow[];
}

export interface MergeLoadedTimelineWithLatestArgs {
  current: LoadedTimelineState;
  latestTimeline: ThreadTimelineResponse;
  surfaceKey: string;
}

export interface RecoverLoadedTimelineAfterStaleCursorArgs {
  current: LoadedTimelineState;
  latestTimeline: ThreadTimelineResponse;
  surfaceKey: string;
}

interface BuildSurfaceKeyArgs {
  rowFilter: ThreadTimelineRowFilter | undefined;
  surfaceKey: string | undefined;
  threadId: string;
}

function buildSurfaceKey({
  rowFilter,
  surfaceKey,
  threadId,
}: BuildSurfaceKeyArgs): string {
  if (surfaceKey !== undefined) {
    return surfaceKey;
  }
  return rowFilter === undefined ? threadId : `${threadId}:filtered`;
}

function filterTimelineRows({
  rowFilter,
  rows,
}: {
  rowFilter: ThreadTimelineRowFilter | undefined;
  rows: readonly TimelineRow[];
}): TimelineRow[] {
  return rowFilter === undefined ? [...rows] : rows.filter(rowFilter);
}

function filterThreadTimelineResponse({
  response,
  rowFilter,
}: {
  response: ThreadTimelineResponse;
  rowFilter: ThreadTimelineRowFilter | undefined;
}): ThreadTimelineResponse {
  if (rowFilter === undefined) {
    return response;
  }
  return {
    ...response,
    rows: response.rows.filter(rowFilter),
  };
}

function buildLoadedTimelineState({
  latestRows,
  olderCursor,
  surfaceKey,
}: BuildLoadedTimelineStateArgs): LoadedTimelineState {
  return {
    olderCursor,
    rows: latestRows,
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
  target: TimelineRow[],
  rows: readonly TimelineRow[],
): void {
  const seenIds = new Set(target.map((row) => row.id));
  for (const row of rows) {
    if (seenIds.has(row.id)) {
      continue;
    }
    seenIds.add(row.id);
    target.push(row);
  }
}

function timelineRowFastChangeSignature(row: TimelineRow): string {
  return [
    row.kind,
    row.id,
    row.threadId,
    row.turnId ?? "<null>",
    row.sourceSeqStart,
    row.sourceSeqEnd,
    row.startedAt,
    row.createdAt,
  ].join("\u001f");
}

function areTimelineRowsRenderEquivalent(
  previousRow: TimelineRow,
  nextRow: TimelineRow,
): boolean {
  if (previousRow === nextRow) {
    return true;
  }
  // Timeline rows are parsed JSON-compatible contract values. Structural
  // equality checks every enumerable field recursively, including nested rows
  // and lazy child-page intervals, without allocating serialized output copies.
  // Different unsupported/non-plain values fail closed to the next row.
  return replaceEqualDeep(previousRow, nextRow) === previousRow;
}

function buildTimelineRowIdentityMap(
  rows: readonly TimelineRow[],
): ReadonlyMap<string, TimelineRowIdentityEntry> {
  const rowsById = new Map<string, TimelineRowIdentityEntry>();
  for (const row of rows) {
    rowsById.set(row.id, {
      row,
      fastChangeSignature: timelineRowFastChangeSignature(row),
    });
  }
  return rowsById;
}

function preserveTimelineRowIdentity({
  nextRows,
  previousRows,
}: PreserveTimelineRowIdentityArgs): TimelineRow[] {
  const previousRowsById = buildTimelineRowIdentityMap(previousRows);
  return nextRows.map((row) => {
    const previous = previousRowsById.get(row.id);
    if (
      previous &&
      previous.fastChangeSignature === timelineRowFastChangeSignature(row) &&
      areTimelineRowsRenderEquivalent(previous.row, row)
    ) {
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
}: PrependOlderTimelineRowsArgs): TimelineRow[] {
  const rows: TimelineRow[] = [];
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

  const latestRowIds = new Set(latestRows.map((row) => row.id));
  const firstLatestOverlapIndex = loadedRows.findIndex((row) =>
    latestRowIds.has(row.id),
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

export function useThreadTimelineController({
  enabled = true,
  rowFilter,
  surfaceKey: explicitSurfaceKey,
  threadId,
}: UseThreadTimelineControllerArgs): UseThreadTimelineControllerResult {
  // Inherit the query's normal staleTime so remount/refocus can refresh a
  // timeline that changed while this surface was unmounted.
  const latestTimelineQuery = useThreadTimeline(threadId, {
    enabled,
    refetchOnMount: true,
  });
  const surfaceKey = buildSurfaceKey({
    rowFilter,
    surfaceKey: explicitSurfaceKey,
    threadId,
  });
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
  const loadedTimelineRef = useRef(loadedTimeline);
  loadedTimelineRef.current = loadedTimeline;
  const nextOlderRequestIdRef = useRef(0);
  const paginationSurfaceLifecycleRef = useRef({
    generation: 0,
    surfaceKey,
  });
  const inFlightOlderPageRef = useRef<{
    generation: number;
    requestId: number;
    surfaceKey: string;
  } | null>(null);
  const latestTimeline = useMemo(() => {
    if (!latestTimelineQuery.data) {
      return undefined;
    }
    return filterThreadTimelineResponse({
      response: latestTimelineQuery.data,
      rowFilter,
    });
  }, [latestTimelineQuery.data, rowFilter]);

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
  useLayoutEffect(() => {
    const lifecycle = paginationSurfaceLifecycleRef.current;
    if (lifecycle.surfaceKey !== surfaceKey) {
      paginationSurfaceLifecycleRef.current = {
        generation: lifecycle.generation + 1,
        surfaceKey,
      };
      setIsLoadingOlderTimelineRows(false);
    }
  }, [surfaceKey]);
  const refetchLatestTimeline = latestTimelineQuery.refetch;

  const nextOlderCursor =
    loadedTimeline.surfaceKey === surfaceKey
      ? loadedTimeline.olderCursor
      : null;
  const hasOlderTimelineRows = nextOlderCursor !== null;
  const loadOlderTimelineRows = useCallback(async (): Promise<boolean> => {
    if (!enabled || !nextOlderCursor || !threadId) {
      return false;
    }
    const surfaceLifecycle = paginationSurfaceLifecycleRef.current;
    if (
      inFlightOlderPageRef.current?.generation === surfaceLifecycle.generation
    ) {
      return false;
    }

    const requestId = ++nextOlderRequestIdRef.current;
    inFlightOlderPageRef.current = {
      generation: surfaceLifecycle.generation,
      requestId,
      surfaceKey,
    };
    setIsLoadingOlderTimelineRows(true);
    try {
      const response = await api.getThreadTimeline({
        beforeCursor: nextOlderCursor,
        id: threadId,
      });
      const olderRows = filterTimelineRows({
        rowFilter,
        rows: response.rows,
      });
      const current = loadedTimelineRef.current;
      if (
        paginationSurfaceLifecycleRef.current.generation !==
          surfaceLifecycle.generation ||
        inFlightOlderPageRef.current?.requestId !== requestId ||
        current.surfaceKey !== surfaceKey ||
        !areTimelinePaginationCursorsEqual({
          left: current.olderCursor,
          right: nextOlderCursor,
        })
      ) {
        return false;
      }
      const loadedRowIds = new Set(current.rows.map((row) => row.id));
      const appendedRows = olderRows.some((row) => !loadedRowIds.has(row.id));
      const nextLoadedTimeline = {
        olderCursor: response.timelinePage.olderCursor,
        rows: prependOlderTimelineRows({
          loadedRows: current.rows,
          olderRows,
        }),
        surfaceKey,
      };
      loadedTimelineRef.current = nextLoadedTimeline;
      setLoadedTimeline(nextLoadedTimeline);
      return appendedRows;
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !isStaleTimelinePaginationCursorError(error)
      ) {
        throw error;
      }
      if (
        paginationSurfaceLifecycleRef.current.generation !==
          surfaceLifecycle.generation ||
        inFlightOlderPageRef.current?.requestId !== requestId
      ) {
        return false;
      }

      const latestTimelineResult = await refetchLatestTimeline();
      if (
        paginationSurfaceLifecycleRef.current.generation !==
          surfaceLifecycle.generation ||
        inFlightOlderPageRef.current?.requestId !== requestId
      ) {
        return false;
      }
      const recoveredLatestTimeline = latestTimelineResult.data
        ? filterThreadTimelineResponse({
            response: latestTimelineResult.data,
            rowFilter,
          })
        : latestTimeline;
      const current = loadedTimelineRef.current;
      if (current.surfaceKey !== surfaceKey) return false;
      const recoveredLoadedTimeline = recoveredLatestTimeline
        ? recoverLoadedTimelineAfterStaleCursor({
            current,
            latestTimeline: recoveredLatestTimeline,
            surfaceKey,
          })
        : { ...current, olderCursor: null };
      loadedTimelineRef.current = recoveredLoadedTimeline;
      setLoadedTimeline(recoveredLoadedTimeline);
      return false;
    } finally {
      if (inFlightOlderPageRef.current?.requestId === requestId) {
        inFlightOlderPageRef.current = null;
        setIsLoadingOlderTimelineRows(false);
      }
    }
  }, [
    enabled,
    latestTimeline,
    nextOlderCursor,
    refetchLatestTimeline,
    rowFilter,
    surfaceKey,
    threadId,
  ]);
  const timelineRows =
    loadedTimeline.surfaceKey === surfaceKey && loadedTimeline.rows.length > 0
      ? loadedTimeline.rows
      : (latestTimeline?.rows ?? []);
  const timelineQueryState = useConnectionAwareQueryState({
    hasResolvedData:
      latestTimelineQuery.data !== undefined || timelineRows.length > 0,
    isFetching: latestTimelineQuery.isFetching,
    isLoadingError: latestTimelineQuery.isLoadingError,
    isRecoverableLoadingError: isTransientReadError(latestTimelineQuery.error),
  });
  const timelineLoading =
    latestTimelineQuery.isLoading ||
    (timelineQueryState.status === "loading" && timelineRows.length === 0) ||
    (latestTimelineQuery.isFetching && timelineRows.length === 0);
  const timelineError =
    timelineLoading || timelineQueryState.status !== "unavailable"
      ? null
      : latestTimelineQuery.error;

  return {
    activePromptMode: latestTimeline?.activePromptMode ?? null,
    activeThinking: latestTimeline?.activeThinking ?? null,
    activeWorkflow: latestTimeline?.activeWorkflow ?? null,
    activeBackgroundCommands: latestTimeline?.activeBackgroundCommands ?? [],
    contextWindowUsage: latestTimeline?.contextWindowUsage,
    goal: latestTimeline?.goal ?? null,
    modelFallback: latestTimeline?.modelFallback ?? null,
    hasOlderTimelineRows,
    isLoadingOlderTimelineRows,
    loadOlderTimelineRows,
    paginationSurfaceKey: surfaceKey,
    pendingTodos: latestTimeline?.pendingTodos ?? null,
    timelineError,
    timelineLoading,
    timelineRows,
  };
}
