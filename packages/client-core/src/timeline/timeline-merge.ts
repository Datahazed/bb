import type {
  ThreadTimelineResponse,
  TimelinePaginationCursor,
  TimelineRow,
} from "@bb/server-contract";
import { isOptimisticTimelineRowId } from "./optimistic-timeline-row.js";

type NullableTimelinePaginationCursor = TimelinePaginationCursor | null;

export interface LoadedTimelineState {
  latestWindowEndSequence: number | null;
  olderCursor: NullableTimelinePaginationCursor;
  rows: TimelineRow[];
  surfaceKey: string;
}

interface BuildLoadedTimelineStateArgs {
  latestWindowEndSequence: number | null;
  latestRows: TimelineRow[];
  olderCursor: NullableTimelinePaginationCursor;
  surfaceKey: string;
}

interface AreTimelinePaginationCursorsEqualArgs {
  left: NullableTimelinePaginationCursor;
  right: NullableTimelinePaginationCursor;
}

interface MergeLatestTimelineRowsArgs {
  latestRows: readonly TimelineRow[];
  latestWindowStartSequence: number;
  loadedRows: TimelineRow[];
}

interface MergeLatestTimelineRowsResult {
  canMerge: boolean;
  rows: TimelineRow[];
}

interface TimelineRowIdentityEntry {
  row: TimelineRow;
  signature: string;
}

interface PreserveTimelineRowIdentityArgs {
  nextRows: readonly TimelineRow[];
  previousRows: readonly TimelineRow[];
}

interface AreTimelineRowReferencesEqualArgs {
  left: readonly TimelineRow[];
  right: readonly TimelineRow[];
}

interface PrependOlderTimelineRowsArgs {
  loadedRows: readonly TimelineRow[];
  olderRows: readonly TimelineRow[];
}

interface MergeLoadedTimelineWithLatestArgs {
  current: LoadedTimelineState;
  latestTimeline: ThreadTimelineResponse;
  surfaceKey: string;
}

interface RecoverLoadedTimelineAfterStaleCursorArgs {
  current: LoadedTimelineState;
  latestTimeline: ThreadTimelineResponse;
  surfaceKey: string;
}

export function buildLoadedTimelineState({
  latestWindowEndSequence,
  latestRows,
  olderCursor,
  surfaceKey,
}: BuildLoadedTimelineStateArgs): LoadedTimelineState {
  return {
    latestWindowEndSequence,
    olderCursor,
    rows: latestRows,
    surfaceKey,
  };
}

export function areTimelinePaginationCursorsEqual({
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
  const indexById = new Map(target.map((row, index) => [row.id, index]));
  for (const row of rows) {
    const existingIndex = indexById.get(row.id);
    if (existingIndex !== undefined) {
      const existing = target[existingIndex];
      if (
        existing?.kind === "turn" &&
        row.kind === "turn" &&
        existing.completedAt !== null &&
        row.completedAt !== null &&
        (existing.sourceSeqEnd < row.sourceSeqStart ||
          row.sourceSeqEnd < existing.sourceSeqStart)
      ) {
        const ordered =
          existing.sourceSeqStart <= row.sourceSeqStart
            ? [existing, row]
            : [row, existing];
        const children = [
          ...new Map(
            ordered
              .flatMap((part) => part.children ?? [])
              .map((child) => [child.id, child]),
          ).values(),
        ];
        target[existingIndex] = {
          ...ordered[1],
          children:
            existing.children === null && row.children === null
              ? null
              : children,
          completedAt: Math.max(existing.completedAt, row.completedAt),
          createdAt: Math.min(existing.createdAt, row.createdAt),
          sourceSeqEnd: Math.max(existing.sourceSeqEnd, row.sourceSeqEnd),
          sourceSeqStart: Math.min(existing.sourceSeqStart, row.sourceSeqStart),
          startedAt: Math.min(existing.startedAt, row.startedAt),
          summaryCount: existing.summaryCount + row.summaryCount,
        };
      }
      continue;
    }
    indexById.set(row.id, target.length);
    target.push(row);
  }
}

function timelineRowIdentitySignature(row: TimelineRow): string {
  const turnRequest =
    row.kind === "conversation" && row.role === "user" ? row.turnRequest : null;
  return [
    row.kind,
    row.id,
    row.threadId,
    row.turnId ?? "<null>",
    row.sourceSeqStart,
    row.sourceSeqEnd,
    row.startedAt,
    row.createdAt,
    turnRequest?.isGrouped,
    turnRequest?.kind,
    turnRequest?.status,
  ].join("\u001f");
}

function buildTimelineRowIdentityMap(
  rows: readonly TimelineRow[],
): ReadonlyMap<string, TimelineRowIdentityEntry> {
  const rowsById = new Map<string, TimelineRowIdentityEntry>();
  for (const row of rows) {
    rowsById.set(row.id, {
      row,
      signature: timelineRowIdentitySignature(row),
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
}: PrependOlderTimelineRowsArgs): TimelineRow[] {
  const rows: TimelineRow[] = [];
  appendTimelineRowsPreservingOrder(rows, olderRows);
  appendTimelineRowsPreservingOrder(rows, loadedRows);
  return rows;
}

export function mergeTimelineTurnDetailPages(
  pages: readonly (readonly TimelineRow[])[],
): TimelineRow[] {
  const rows: TimelineRow[] = [];
  const indexById = new Map<string, number>();
  for (const page of pages) {
    for (const row of page) {
      const existingIndex = indexById.get(row.id);
      if (existingIndex === undefined) {
        indexById.set(row.id, rows.length);
        rows.push(row);
        continue;
      }
      const existing = rows[existingIndex];
      if (
        existing?.kind === "work" &&
        existing.workKind === "delegation" &&
        row.kind === "work" &&
        row.workKind === "delegation"
      ) {
        rows[existingIndex] = {
          ...row,
          childRows: mergeTimelineTurnDetailPages([
            existing.childRows,
            row.childRows,
          ]),
          completedAt:
            existing.completedAt === null
              ? row.completedAt
              : row.completedAt === null
                ? existing.completedAt
                : Math.max(existing.completedAt, row.completedAt),
          createdAt: Math.min(existing.createdAt, row.createdAt),
          sourceSeqEnd: Math.max(existing.sourceSeqEnd, row.sourceSeqEnd),
          sourceSeqStart: Math.min(existing.sourceSeqStart, row.sourceSeqStart),
          startedAt: Math.min(existing.startedAt, row.startedAt),
        };
        continue;
      }
      rows[existingIndex] = row;
    }
  }
  return rows;
}

export function mergeLatestTimelineRows({
  latestRows,
  latestWindowStartSequence,
  loadedRows: retainedRows,
}: MergeLatestTimelineRowsArgs): MergeLatestTimelineRowsResult {
  const loadedRows = retainedRows.some((row) =>
    isOptimisticTimelineRowId(row.id),
  )
    ? retainedRows.filter((row) => !isOptimisticTimelineRowId(row.id))
    : retainedRows;

  const identityPreservedLatestRows = preserveTimelineRowIdentity({
    nextRows: latestRows,
    previousRows: loadedRows,
  });

  if (loadedRows.length === 0) {
    return {
      canMerge: true,
      rows: identityPreservedLatestRows,
    };
  }

  const latestRowsById = new Map(
    identityPreservedLatestRows.map((row) => [row.id, row]),
  );
  const rowsToRetain = loadedRows.filter(
    (row) =>
      row.sourceSeqEnd < latestWindowStartSequence ||
      latestRowsById.has(row.id),
  );
  const retainedRowIds = new Set(rowsToRetain.map((row) => row.id));
  const loadedCommonIds = rowsToRetain.flatMap((row) =>
    latestRowsById.has(row.id) ? [row.id] : [],
  );
  const latestCommonIds = identityPreservedLatestRows.flatMap((row) =>
    retainedRowIds.has(row.id) ? [row.id] : [],
  );
  if (
    loadedCommonIds.length !== latestCommonIds.length ||
    loadedCommonIds.some((id, index) => id !== latestCommonIds[index])
  ) {
    return { canMerge: false, rows: identityPreservedLatestRows };
  }

  const rowsBeforeSharedId = new Map<string, TimelineRow[]>();
  let pendingRows: TimelineRow[] = [];
  for (const row of identityPreservedLatestRows) {
    if (!retainedRowIds.has(row.id)) {
      pendingRows.push(row);
      continue;
    }
    if (pendingRows.length > 0) {
      rowsBeforeSharedId.set(row.id, pendingRows);
      pendingRows = [];
    }
  }

  const rows: TimelineRow[] = [];
  for (const row of rowsToRetain) {
    const rowsBefore = rowsBeforeSharedId.get(row.id);
    if (rowsBefore) {
      rows.push(...rowsBefore);
    }
    rows.push(latestRowsById.get(row.id) ?? row);
  }
  rows.push(...pendingRows);
  if (areTimelineRowReferencesEqual({ left: loadedRows, right: rows })) {
    return {
      canMerge: true,
      rows: loadedRows,
    };
  }

  return {
    canMerge: true,
    rows,
  };
}

function timelineWindowStartSequence(timeline: ThreadTimelineResponse): number {
  return timeline.timelinePage.olderCursor?.anchorSeq ?? 0;
}

function timelineWindowsAreContiguous(
  current: LoadedTimelineState,
  latestTimeline: ThreadTimelineResponse,
): boolean {
  return (
    current.latestWindowEndSequence !== null &&
    latestTimeline.maxSeq >= current.latestWindowEndSequence &&
    timelineWindowStartSequence(latestTimeline) <=
      current.latestWindowEndSequence + 1
  );
}

function mergeLoadedTimelineOlderCursor(
  current: NullableTimelinePaginationCursor,
  latest: NullableTimelinePaginationCursor,
): NullableTimelinePaginationCursor {
  if (current === null || latest === null) {
    return null;
  }
  return latest.anchorSeq <= current.anchorSeq ? latest : current;
}

export function mergeLoadedTimelineWithLatest({
  current,
  latestTimeline,
  surfaceKey,
}: MergeLoadedTimelineWithLatestArgs): LoadedTimelineState {
  if (
    current.surfaceKey !== surfaceKey ||
    !timelineWindowsAreContiguous(current, latestTimeline)
  ) {
    return buildLoadedTimelineState({
      latestWindowEndSequence: latestTimeline.maxSeq,
      latestRows: latestTimeline.rows,
      olderCursor: latestTimeline.timelinePage.olderCursor,
      surfaceKey,
    });
  }

  const latestMerge = mergeLatestTimelineRows({
    latestRows: latestTimeline.rows,
    latestWindowStartSequence: timelineWindowStartSequence(latestTimeline),
    loadedRows: current.rows,
  });
  if (!latestMerge.canMerge) {
    return buildLoadedTimelineState({
      latestWindowEndSequence: latestTimeline.maxSeq,
      latestRows: latestTimeline.rows,
      olderCursor: latestTimeline.timelinePage.olderCursor,
      surfaceKey,
    });
  }

  return {
    ...current,
    latestWindowEndSequence: latestTimeline.maxSeq,
    olderCursor: mergeLoadedTimelineOlderCursor(
      current.olderCursor,
      latestTimeline.timelinePage.olderCursor,
    ),
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
      latestWindowEndSequence: latestTimeline.maxSeq,
      latestRows: latestTimeline.rows,
      olderCursor: latestTimeline.timelinePage.olderCursor,
      surfaceKey,
    });
  }

  const latestMerge = mergeLatestTimelineRows({
    latestRows: latestTimeline.rows,
    latestWindowStartSequence: timelineWindowStartSequence(latestTimeline),
    loadedRows: current.rows,
  });
  if (!latestMerge.canMerge) {
    return buildLoadedTimelineState({
      latestWindowEndSequence: latestTimeline.maxSeq,
      latestRows: latestTimeline.rows,
      olderCursor: latestTimeline.timelinePage.olderCursor,
      surfaceKey,
    });
  }

  return {
    latestWindowEndSequence: latestTimeline.maxSeq,
    olderCursor: latestTimeline.timelinePage.olderCursor,
    rows: latestMerge.rows,
    surfaceKey,
  };
}
