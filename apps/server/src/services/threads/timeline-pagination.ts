import type {
  TimelinePaginationCursor,
  TimelineRow,
} from "@bb/server-contract";
import { ApiError } from "../../errors.js";

export type ThreadTimelinePageKind = "latest" | "older";

/**
 * Marks a window that had to start at an event sequence rather than on a user
 * message because an event-count or byte budget cut the selected segment.
 *
 * A window is normally identified by the user message it begins at, and the
 * pagination cursor names that anchor. Inside a turn there is no anchor to
 * name, so the cursor names the event sequence the window was cut at instead —
 * and the row-derived cursor cannot be used, because the projection backfills a
 * turn's `turn/started` row from far below the cut and the first row's
 * `sourceSeqStart` would send the next page past everything in between.
 */
export interface TimelineSequenceWindowStart {
  /** Why this page starts inside a segment. */
  kind: "byte" | "event";
  /** First event sequence this window covers. */
  sequenceStart: number;
  threadId: string;
}

// Keep the old opaque cursor value for event-budget cuts. A distinct value lets
// older pages preserve byte-window projection and parent-read limits.
const SEQUENCE_CURSOR_ANCHOR_ID_SEPARATOR = ":in-turn:";
const BYTE_CURSOR_ANCHOR_ID_SEPARATOR = ":byte-window:";

function buildSequenceCursorAnchorId(
  args: TimelineSequenceWindowStart,
): string {
  const separator =
    args.kind === "byte"
      ? BYTE_CURSOR_ANCHOR_ID_SEPARATOR
      : SEQUENCE_CURSOR_ANCHOR_ID_SEPARATOR;
  return `${args.threadId}${separator}${args.sequenceStart}`;
}

/**
 * The sequence a sequence cursor points at, or null when the cursor names a
 * user-message anchor instead. Rejects a cursor whose id and sequence disagree,
 * which is the only self-consistency check available for a cursor that names no
 * stored row.
 */
export function readSequenceCursor(
  cursor: TimelinePaginationCursor,
  threadId: string,
): Pick<TimelineSequenceWindowStart, "kind" | "sequenceStart"> | null {
  const eventPrefix = `${threadId}${SEQUENCE_CURSOR_ANCHOR_ID_SEPARATOR}`;
  const bytePrefix = `${threadId}${BYTE_CURSOR_ANCHOR_ID_SEPARATOR}`;
  const kind = cursor.anchorId.startsWith(bytePrefix) ? "byte" : "event";
  const prefix = kind === "byte" ? bytePrefix : eventPrefix;
  if (!cursor.anchorId.startsWith(prefix)) {
    return null;
  }
  if (
    cursor.anchorId.slice(prefix.length) !== String(cursor.anchorSeq) ||
    !Number.isInteger(cursor.anchorSeq)
  ) {
    throw new ApiError(
      400,
      "invalid_request",
      "Timeline pagination cursor is no longer available",
    );
  }
  return { kind, sequenceStart: cursor.anchorSeq };
}

interface LatestThreadTimelinePageRequest {
  kind: "latest";
  segmentLimit: number;
}

interface OlderThreadTimelinePageRequest {
  beforeCursor: TimelinePaginationCursor;
  kind: "older";
  segmentLimit: number;
}

export type ThreadTimelinePageRequest =
  | LatestThreadTimelinePageRequest
  | OlderThreadTimelinePageRequest;

interface TimelineLogicalSegment {
  cursor: TimelinePaginationCursor;
  rows: TimelineRow[];
}

interface PaginatedTimelineRowsResult {
  hasOlderRows: boolean;
  olderCursor: TimelinePaginationCursor | null;
  returnedSegmentCount: number;
  rows: TimelineRow[];
}

function isTimelineSegmentAnchorRow(row: TimelineRow): boolean {
  return (
    row.kind === "conversation" &&
    row.role === "user" &&
    row.turnRequest.kind === "message"
  );
}

function buildTimelineLogicalSegment(
  rows: TimelineRow[],
  cursorRow: TimelineRow | null = null,
): TimelineLogicalSegment {
  const firstRow = rows[0];
  if (!firstRow) {
    throw new Error("Cannot build a timeline segment without rows");
  }
  const segmentCursorRow = cursorRow ?? firstRow;

  return {
    cursor: {
      anchorSeq: segmentCursorRow.sourceSeqStart,
      anchorId: segmentCursorRow.id,
    },
    // Projection order is semantic, not always source order: completed-turn
    // summaries precede their terminal assistant message even when the
    // summary's derived source bounds begin later. Sorting a segment by source
    // here moves that assistant to the wrong side of "Worked for...".
    rows,
  };
}

function buildTimelineLogicalSegments(
  rows: readonly TimelineRow[],
): TimelineLogicalSegment[] {
  const segments: TimelineLogicalSegment[] = [];
  let currentRows: TimelineRow[] = [];
  let currentCursorRow: TimelineRow | null = null;

  for (const row of rows) {
    if (
      isTimelineSegmentAnchorRow(row) &&
      currentRows.length > 0 &&
      (currentCursorRow?.sourceSeqStart ?? currentRows[0]?.sourceSeqStart) !==
        row.sourceSeqStart
    ) {
      // Projection groups thread-scoped messages separately from turn rows.
      // A thread event can therefore appear immediately before the accepted
      // user row that precedes it in source order. Do not leave that trailing
      // event in the older segment: a one-segment page would trim it away.
      // Move the anchor ahead of every source-newer trailing row so the
      // segment also has the user row as its cursor. A row that starts before
      // the anchor stays with that earlier segment even if its lifecycle ends
      // after the anchor; the server closes that row with targeted context.
      const trailingRowIndex = currentRows.findIndex(
        (currentRow) => currentRow.sourceSeqStart >= row.sourceSeqStart,
      );
      if (trailingRowIndex === -1) {
        segments.push(
          buildTimelineLogicalSegment(currentRows, currentCursorRow),
        );
        currentRows = [row];
      } else {
        const olderRows = currentRows.slice(0, trailingRowIndex);
        if (olderRows.length > 0) {
          segments.push(
            buildTimelineLogicalSegment(olderRows, currentCursorRow),
          );
        }
        currentRows = [...currentRows.slice(trailingRowIndex), row].sort(
          (left, right) => left.sourceSeqStart - right.sourceSeqStart,
        );
      }
      currentCursorRow = row;
      continue;
    }

    if (isTimelineSegmentAnchorRow(row) && currentCursorRow === null) {
      currentCursorRow = row;
    }
    currentRows.push(row);
  }

  if (currentRows.length > 0) {
    segments.push(buildTimelineLogicalSegment(currentRows, currentCursorRow));
  }

  return segments;
}

interface PaginateTimelineRowsArgs {
  /**
   * Non-null only for a sequence-budgeted window. Such a window is already
   * bounded by event sequence, so segment trimming would discard selected
   * rows. The older cursor must name the cut rather than the oldest row.
   */
  sequenceWindowStart: TimelineSequenceWindowStart | null;
  /**
   * `hasOlderRows` is normally inferred by over-reading one segment past the
   * page and noticing it was dropped. An event-budgeted window cannot afford
   * that sentinel segment — it is unbounded work purely to answer a boolean —
   * so the caller that already knows the answer from the anchor list passes it
   * here. `null` keeps the sentinel inference.
   */
  knownHasOlderSegments: boolean | null;
  page: ThreadTimelinePageRequest;
  rows: readonly TimelineRow[];
}

export function paginateTimelineRows(
  args: PaginateTimelineRowsArgs,
): PaginatedTimelineRowsResult {
  const { knownHasOlderSegments, page, rows, sequenceWindowStart } = args;
  const segments = buildTimelineLogicalSegments(rows);
  if (sequenceWindowStart !== null) {
    return {
      hasOlderRows: true,
      olderCursor: {
        anchorSeq: sequenceWindowStart.sequenceStart,
        anchorId: buildSequenceCursorAnchorId(sequenceWindowStart),
      },
      returnedSegmentCount: segments.length,
      rows: [...rows],
    };
  }
  // Every window ends strictly before its cursor, so no segment at or past the
  // cursor was read and none has to be trimmed off here.
  const selectedSegments = segments.slice(-page.segmentLimit);
  const hasOlderRows =
    knownHasOlderSegments === true || segments.length > selectedSegments.length;
  const oldestSelectedSegment = selectedSegments[0];

  return {
    hasOlderRows,
    olderCursor:
      hasOlderRows && oldestSelectedSegment
        ? oldestSelectedSegment.cursor
        : null,
    returnedSegmentCount: selectedSegments.length,
    rows: selectedSegments.flatMap((segment) => segment.rows),
  };
}
