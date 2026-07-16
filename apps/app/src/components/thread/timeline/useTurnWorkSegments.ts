import { useCallback, useEffect, useMemo, useRef } from "react";
import { useQueries } from "@tanstack/react-query";
import { atom, useAtom } from "jotai";
import { atomFamily } from "jotai-family";
import type { TimelineRow } from "@bb/server-contract";
import * as api from "@/lib/api";
import { threadTurnWorkSegmentQueryKey } from "@/hooks/queries/query-keys";

/** Work items per "Show earlier work" page. */
export const TURN_WORK_SEGMENT_ITEM_LIMIT = 40;

/**
 * One immutable window of a turn's work. `page` covers the newest
 * `TURN_WORK_SEGMENT_ITEM_LIMIT` work items strictly below `beforeSeq`
 * (the server reports where the page actually started via its
 * `earlierCursor`). `range` covers `(afterSeq, endSeq]` exactly — used to pick
 * up work that collapsed into a partial "Worked so far" summary after the
 * previous fetch. Both are stable descriptions of history, so their query
 * results never need refetching.
 */
type TurnWorkSegmentParam =
  | { kind: "page"; beforeSeq: number }
  | { kind: "range"; afterSeq: number; endSeq: number };

interface TurnWorkSegmentsState {
  /** Ordered oldest → newest by covered window. */
  segments: TurnWorkSegmentParam[];
  /** Highest sequence any fetched segment covers; appends start above it. */
  coveredEndSeq: number;
}

/**
 * Keyed by the summary row id (stable across the partial → completed
 * transition), so work the user has progressively revealed stays revealed
 * across collapse/expand cycles, live-turn growth, and turn completion.
 * In-memory only — a reload starts back at the newest page.
 */
const turnWorkSegmentsAtomFamily = atomFamily((_rowKey: string) =>
  atom<TurnWorkSegmentsState | null>(null),
);

function segmentDescriptor(segment: TurnWorkSegmentParam): string {
  return segment.kind === "page"
    ? `page:${segment.beforeSeq}:${TURN_WORK_SEGMENT_ITEM_LIMIT}`
    : `range:${segment.afterSeq}:${segment.endSeq}`;
}

/**
 * Segment windows can share an item when its events straddle their boundary
 * (started in the older window, completed in the newer). Both windows project
 * the same row id; the newer window's version has the completed payload, and
 * the older window's position preserves chronological start order.
 */
function mergeSegmentRows(orderedSegmentRows: TimelineRow[][]): TimelineRow[] {
  const rowsById = new Map<string, TimelineRow>();
  const orderedIds: string[] = [];
  for (const segmentRows of orderedSegmentRows) {
    for (const row of segmentRows) {
      if (!rowsById.has(row.id)) {
        orderedIds.push(row.id);
      }
      rowsById.set(row.id, row);
    }
  }
  return orderedIds.flatMap((id) => {
    const row = rowsById.get(id);
    return row === undefined ? [] : [row];
  });
}

export interface UseTurnWorkSegmentsArgs {
  enabled: boolean;
  /** Stable identity of the summary row this expansion belongs to. */
  rowId: string;
  sourceSeqEnd: number;
  sourceSeqStart: number;
  threadId: string;
  turnId: string;
}

export interface UseTurnWorkSegmentsResult {
  /** Null until the first segment resolves. */
  rows: TimelineRow[] | null;
  hasEarlierWork: boolean;
  isLoadingEarlier: boolean;
  isError: boolean;
  loadEarlierWork: () => void;
  retry: () => void;
}

export function useTurnWorkSegments({
  enabled,
  rowId,
  sourceSeqEnd,
  sourceSeqStart,
  threadId,
  turnId,
}: UseTurnWorkSegmentsArgs): UseTurnWorkSegmentsResult {
  const atomKey = `${threadId}:${rowId}`;
  const [state, setState] = useAtom(turnWorkSegmentsAtomFamily(atomKey));

  // The row's range floor participates in requests but must not re-key
  // segment queries: it can shift when a partial row converges to the
  // completed summary, and the already-fetched windows stay valid.
  const sourceSeqStartRef = useRef(sourceSeqStart);
  sourceSeqStartRef.current = sourceSeqStart;

  useEffect(() => {
    if (!enabled) {
      return;
    }
    setState((current) => {
      if (current === null) {
        return {
          segments: [{ kind: "page", beforeSeq: sourceSeqEnd + 1 }],
          coveredEndSeq: sourceSeqEnd,
        };
      }
      if (sourceSeqEnd > current.coveredEndSeq) {
        // The partial summary absorbed more finished work (or the turn
        // completed): append exactly the newly covered range, leaving every
        // already-fetched window untouched.
        return {
          segments: [
            ...current.segments,
            {
              kind: "range",
              afterSeq: current.coveredEndSeq,
              endSeq: sourceSeqEnd,
            },
          ],
          coveredEndSeq: sourceSeqEnd,
        };
      }
      return current;
    });
  }, [enabled, setState, sourceSeqEnd]);

  const segments = useMemo(
    () => state?.segments ?? [],
    [state],
  );
  const orderedSegments = useMemo(() => {
    const upperBound = (segment: TurnWorkSegmentParam): number =>
      segment.kind === "page" ? segment.beforeSeq - 1 : segment.endSeq;
    return [...segments].sort((left, right) => upperBound(left) - upperBound(right));
  }, [segments]);

  const queries = useQueries({
    queries: orderedSegments.map((segment) => ({
      queryKey: threadTurnWorkSegmentQueryKey(
        threadId,
        turnId,
        segmentDescriptor(segment),
      ),
      queryFn: ({ signal }: { signal?: AbortSignal }) =>
        segment.kind === "page"
          ? api.getThreadTimelineTurnSummaryDetails({
              id: threadId,
              signal,
              turnId,
              sourceSeqStart: sourceSeqStartRef.current,
              sourceSeqEnd: segment.beforeSeq - 1,
              workItemLimit: TURN_WORK_SEGMENT_ITEM_LIMIT,
            })
          : api.getThreadTimelineTurnSummaryDetails({
              id: threadId,
              signal,
              turnId,
              sourceSeqStart: sourceSeqStartRef.current,
              sourceSeqEnd: segment.endSeq,
              afterSeq: segment.afterSeq,
            }),
      enabled,
      staleTime: Infinity,
      meta: {
        errorMessage: "Failed to load turn work.",
        showErrorToast: false,
      },
    })),
  });

  // useQueries returns a fresh array every render; recompute the merged rows
  // only when a segment's data reference actually changes so the merged
  // array's identity stays stable for the WeakMap-keyed view-row cache.
  const mergedRowsRef = useRef<{
    segmentData: (TimelineRow[] | undefined)[];
    rows: TimelineRow[] | null;
  }>({ segmentData: [], rows: null });
  const segmentData = queries.map((query) => query.data?.rows);
  const previous = mergedRowsRef.current;
  if (
    segmentData.length !== previous.segmentData.length ||
    segmentData.some((data, index) => data !== previous.segmentData[index])
  ) {
    const resolved = segmentData.flatMap((data) =>
      data === undefined ? [] : [data],
    );
    mergedRowsRef.current = {
      segmentData,
      rows: resolved.length === 0 ? null : mergeSegmentRows(resolved),
    };
  }
  const rows = mergedRowsRef.current.rows;

  // Earlier-work paging state lives on the oldest page segment: its response
  // carries the cursor for the next-older window.
  const oldestPageIndex = orderedSegments.findIndex(
    (segment) => segment.kind === "page",
  );
  const oldestPageQuery =
    oldestPageIndex === -1 ? undefined : queries[oldestPageIndex];
  const earlierCursor =
    oldestPageQuery?.data?.workPage?.earlierCursor ?? null;

  const loadEarlierWork = useCallback(() => {
    if (earlierCursor === null) {
      return;
    }
    setState((current) => {
      if (current === null) {
        return current;
      }
      const alreadyLoaded = current.segments.some(
        (segment) =>
          segment.kind === "page" &&
          segment.beforeSeq === earlierCursor.beforeSeq,
      );
      if (alreadyLoaded) {
        return current;
      }
      return {
        ...current,
        segments: [
          { kind: "page", beforeSeq: earlierCursor.beforeSeq },
          ...current.segments,
        ],
      };
    });
  }, [earlierCursor, setState]);

  const retry = useCallback(() => {
    for (const query of queries) {
      if (query.isError) {
        void query.refetch();
      }
    }
  }, [queries]);

  return {
    rows,
    hasEarlierWork: earlierCursor !== null,
    isLoadingEarlier:
      oldestPageQuery !== undefined && oldestPageQuery.isPending,
    isError: queries.some((query) => query.isError),
    loadEarlierWork,
    retry,
  };
}
