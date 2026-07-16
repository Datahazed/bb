import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import type {
  TimelinePaginationCursor,
  TimelineRow,
} from "@bb/server-contract";
import { z } from "zod";

export type ThreadTimelinePageKind = "latest" | "older";

export interface LatestThreadTimelinePageRequest {
  kind: "latest";
  segmentLimit: number;
}

export interface OlderThreadTimelinePageRequest {
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

const TIMELINE_EVENT_WINDOW_CURSOR_PREFIX = "timeline-event-window:";
const TIMELINE_EVENT_WINDOW_CURSOR_VERSION = 2;
const timelineEventWindowCursorSigningKey = randomBytes(32);

const timelineEventWindowCursorScopeSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("timeline"),
      segmentLimit: z.number().int().positive(),
      threadId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("turn-details"),
      contextItemIdsHash: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
      parentToolCallId: z.string().min(1).nullable(),
      sourceSeqEnd: z.number().int().nonnegative(),
      sourceSeqStart: z.number().int().nonnegative(),
      threadId: z.string().min(1),
      turnId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("delegation-children"),
      directTurnSourceSeqEnd: z.number().int().nonnegative(),
      directTurnSourceSeqStart: z.number().int().nonnegative(),
      ownerTurnId: z.string().min(1),
      parentToolCallId: z.string().min(1),
      sourceSeqEnd: z.number().int().nonnegative(),
      sourceSeqStart: z.number().int().nonnegative(),
      threadId: z.string().min(1),
    })
    .strict(),
]);

export type TimelineEventWindowCursorScope = z.infer<
  typeof timelineEventWindowCursorScopeSchema
>;

const timelineEventWindowCursorPayloadSchema = z
  .object({
    byteTarget: z.number().int().positive(),
    eventId: z.string().min(1),
    issuedBeforeSequence: z.number().int().positive().nullable(),
    rowLimit: z.number().int().positive(),
    scope: timelineEventWindowCursorScopeSchema,
    selectionStart: z.number().int().nonnegative(),
    version: z.literal(TIMELINE_EVENT_WINDOW_CURSOR_VERSION),
  })
  .strict();

export type TimelineEventWindowCursorPayload = z.infer<
  typeof timelineEventWindowCursorPayloadSchema
>;

export function hashTimelineTurnDetailsContextItemIds(
  contextItemIds: readonly string[],
): string {
  const canonicalContextItemIds = [...new Set(contextItemIds)].sort();
  return createHash("sha256")
    .update(JSON.stringify(canonicalContextItemIds), "utf8")
    .digest("base64url");
}

/** Latest active delivery remains below this target after active-work collapse. */
export const THREAD_TIMELINE_PAGE_ROW_LIMIT = 160;

export interface PaginatedTimelineRowsResult {
  hasOlderRows: boolean;
  kind: ThreadTimelinePageKind;
  olderCursor: TimelinePaginationCursor | null;
  returnedSegmentCount: number;
  rows: TimelineRow[];
  segmentLimit: number;
}

export interface PaginateTimelineRowsOptions {
  /** Older raw events exist before the projected event window. */
  eventWindowOlderCursor: TimelinePaginationCursor | null;
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
): TimelineLogicalSegment {
  const anchorRow = rows[0];
  if (!anchorRow) {
    throw new Error("Cannot build a timeline segment without rows");
  }

  return {
    cursor: {
      anchorSeq: anchorRow.sourceSeqStart,
      anchorId: anchorRow.id,
    },
    rows,
  };
}

function buildTimelineLogicalSegments(
  rows: readonly TimelineRow[],
): TimelineLogicalSegment[] {
  const segments: TimelineLogicalSegment[] = [];
  let currentRows: TimelineRow[] = [];

  for (const row of rows) {
    if (
      isTimelineSegmentAnchorRow(row) &&
      currentRows.length > 0 &&
      currentRows[0]?.sourceSeqStart !== row.sourceSeqStart
    ) {
      segments.push(buildTimelineLogicalSegment(currentRows));
      currentRows = [row];
      continue;
    }

    currentRows.push(row);
  }

  if (currentRows.length > 0) {
    segments.push(buildTimelineLogicalSegment(currentRows));
  }

  return segments;
}

function signTimelineEventWindowCursorPayload(encodedPayload: string): string {
  return createHmac("sha256", timelineEventWindowCursorSigningKey)
    .update(encodedPayload)
    .digest("base64url");
}

export function getTimelineEventWindowCursorPayload(
  cursor: TimelinePaginationCursor,
): TimelineEventWindowCursorPayload | null {
  if (!cursor.anchorId.startsWith(TIMELINE_EVENT_WINDOW_CURSOR_PREFIX)) {
    return null;
  }
  const encodedCursor = cursor.anchorId.slice(
    TIMELINE_EVENT_WINDOW_CURSOR_PREFIX.length,
  );
  const separatorIndex = encodedCursor.lastIndexOf(".");
  if (separatorIndex <= 0 || separatorIndex === encodedCursor.length - 1) {
    return null;
  }
  const encodedPayload = encodedCursor.slice(0, separatorIndex);
  const presentedSignature = encodedCursor.slice(separatorIndex + 1);
  const expectedSignature =
    signTimelineEventWindowCursorPayload(encodedPayload);
  const presentedBytes = Buffer.from(presentedSignature, "utf8");
  const expectedBytes = Buffer.from(expectedSignature, "utf8");
  if (
    presentedBytes.length !== expectedBytes.length ||
    !timingSafeEqual(presentedBytes, expectedBytes)
  ) {
    return null;
  }
  try {
    const parsedJson = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    );
    const parsedPayload =
      timelineEventWindowCursorPayloadSchema.safeParse(parsedJson);
    if (!parsedPayload.success) return null;
    return parsedPayload.data;
  } catch {
    return null;
  }
}

export function createTimelineEventWindowCursor(args: {
  byteTarget: number;
  eventId: string;
  issuedBeforeSequence: number | null;
  rowLimit: number;
  scope: TimelineEventWindowCursorScope;
  selectionStart: number;
  sequence: number;
}): TimelinePaginationCursor {
  const payload: TimelineEventWindowCursorPayload = {
    byteTarget: args.byteTarget,
    eventId: args.eventId,
    issuedBeforeSequence: args.issuedBeforeSequence,
    rowLimit: args.rowLimit,
    scope: args.scope,
    selectionStart: args.selectionStart,
    version: TIMELINE_EVENT_WINDOW_CURSOR_VERSION,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  const signature = signTimelineEventWindowCursorPayload(encodedPayload);
  return {
    anchorSeq: args.sequence,
    anchorId: `${TIMELINE_EVENT_WINDOW_CURSOR_PREFIX}${encodedPayload}.${signature}`,
  };
}

export function paginateTimelineRows(
  rows: readonly TimelineRow[],
  page: ThreadTimelinePageRequest,
  options: PaginateTimelineRowsOptions,
): PaginatedTimelineRowsResult {
  const segments = buildTimelineLogicalSegments(rows);
  // SQL selection has already applied both raw-event and conversation-segment
  // cursors. Never apply the cursor again to enriched/projected rows.
  const candidateSegments = segments;
  const selectedSegments = candidateSegments.slice(-page.segmentLimit);
  const selectedRows = selectedSegments.flatMap((segment) => segment.rows);
  const hasOlderSegments = candidateSegments.length > selectedSegments.length;
  const hasOlderRows =
    hasOlderSegments || options.eventWindowOlderCursor !== null;
  const oldestSelectedSegment = selectedSegments[0];

  return {
    hasOlderRows,
    kind: page.kind,
    olderCursor: !hasOlderRows
      ? null
      : selectedRows.length === 0
        ? options.eventWindowOlderCursor
        : hasOlderSegments
          ? (oldestSelectedSegment?.cursor ?? null)
          : options.eventWindowOlderCursor,
    returnedSegmentCount: selectedSegments.length,
    rows: selectedRows,
    segmentLimit: page.segmentLimit,
  };
}
