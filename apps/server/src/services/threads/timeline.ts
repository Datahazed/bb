import { createHash } from "node:crypto";
import {
  buildThreadTimelineFromEvents,
  THREAD_TIMELINE_EXCLUDED_EVENT_TYPES,
  buildThreadTimelineTurnDetailsFromEvents,
  buildTimelineViewRows,
  buildTimelineWorkSummaryLabel,
  compactThreadTimelineSummaryEvents,
  type AcceptedClientRequestContext,
  type ThreadTimelineViewRow,
  type ThreadEventWithMeta,
} from "@bb/thread-view";
import {
  isSettledWorkflowAgentState,
  LOCAL_WORKFLOW_TASK_TYPE,
  type ClientTurnRequestId,
  type Thread,
} from "@bb/domain";
import type {
  TimelineFeedDetailPart,
  TimelineFeedRow,
  TimelinePaginationCursor,
  TimelineCommandWorkRow,
  TimelineRow,
  TimelineToolWorkRow,
  ThreadTimelineFeedResponse,
  TimelineRowDetailResponse,
  TimelineTurnSummaryDetailsResponse,
  TimelineWorkOutputDetailResponse,
} from "@bb/server-contract";
import {
  findTimelineSegmentAnchorSequenceAfter,
  getEnvironment,
  getTimelineSegmentAnchorAtSequence,
  listContextWindowUsageRows,
  listRecentStoredEventRows,
  listStoredClientTurnRequestIdsInRange,
  listStoredEventRowsInRange,
  listLatestBackgroundTaskStateRowsByItemIds,
  listStoredTimelineWindowEventRows,
  listStoredTurnInputAcceptedRowsByClientRequestIds,
  listStoredTurnStartedRowsByTurnIdsUpToSequence,
  listTimelineSegmentAnchorsDescending,
} from "@bb/db";
import type { DbConnection, StoredEventRow } from "@bb/db";
import { ApiError } from "../../errors.js";
import { parseStoredEvent } from "./thread-data.js";
import {
  paginateTimelineRows,
  type ThreadTimelinePageKind,
  type ThreadTimelinePageRequest,
} from "./timeline-pagination.js";

export type {
  LatestThreadTimelinePageRequest,
  OlderThreadTimelinePageRequest,
  ThreadTimelinePageKind,
  ThreadTimelinePageRequest,
} from "./timeline-pagination.js";

interface TimelineTurnSummarySelection {
  sourceSeqEnd: number;
  sourceSeqStart: number;
  turnId: string;
}

/**
 * The absolute path of the thread's workspace root, or null when the thread has
 * no environment. The projection uses it to relativize the absolute file paths
 * persisted by provider file-edit tool calls into workspace-relative paths.
 */
function resolveThreadWorkspaceRoot(
  db: DbConnection,
  thread: Thread,
): string | null {
  if (thread.environmentId === null) {
    return null;
  }
  return getEnvironment(db, thread.environmentId)?.path ?? null;
}

interface PartitionAcceptedInputRowsByRequestedTurnArgs {
  acceptedInputRows: readonly StoredEventRow[];
  turnId: string;
}

interface PartitionAcceptedInputRowsByRequestedTurnResult {
  acceptedClientRequestIdsForOtherTurns: ReadonlySet<ClientTurnRequestId>;
  requestedTurnRows: StoredEventRow[];
}

interface FilterExactEventRowsForRequestedTurnArgs {
  acceptedClientRequestIdsForOtherTurns: ReadonlySet<ClientTurnRequestId>;
  exactEventRows: readonly StoredEventRow[];
}

interface FilterExactEventRowsForRequestedTurnResult {
  removedRows: boolean;
  rows: readonly StoredEventRow[];
}

interface ResolveTurnSummaryDetailsSourceRangeArgs {
  exactEventRows: readonly StoredEventRow[];
  fallbackRange: TimelineTurnSummarySelection;
  useExactEventRowBounds: boolean;
}

interface BuildThreadTimelineOptions {
  isDevelopment: boolean;
  includeNestedRows?: boolean;
  page: ThreadTimelinePageRequest;
}

interface BuildThreadTimelineFeedOptions {
  isDevelopment: boolean;
  page: ThreadTimelinePageRequest;
}

interface BuildTimelineTurnSummaryDetailsOptions extends TimelineTurnSummarySelection {
  isDevelopment: boolean;
}

interface BuildTimelineRowDetailOptions {
  isDevelopment: boolean;
  parts: readonly TimelineFeedDetailPart[];
  rowKey: string;
  sourceSeqEnd: number;
  sourceSeqStart: number;
}

interface BuildTimelineWorkOutputDetailOptions {
  callId: string;
  isDevelopment: boolean;
  sourceSeqEnd: number;
  sourceSeqStart: number;
  workKind: "command" | "tool";
}

interface TimelineFeedTextPreview {
  complete: boolean;
  fullLength: number;
  text: string;
}

export const THREAD_TIMELINE_DEFAULT_SEGMENT_LIMIT = 20;
export const THREAD_TIMELINE_SEGMENT_LIMIT_MAX = 100;
const TIMELINE_FEED_TEXT_PREVIEW_HEAD_CHARS = 1024;
const TIMELINE_FEED_TEXT_PREVIEW_TAIL_CHARS = 1024;
const TIMELINE_FEED_TEXT_PREVIEW_THRESHOLD_CHARS =
  TIMELINE_FEED_TEXT_PREVIEW_HEAD_CHARS + TIMELINE_FEED_TEXT_PREVIEW_TAIL_CHARS;
const TIMELINE_FEED_TEXT_PREVIEW_MARKER =
  "\n\n[... detail omitted from timeline feed; expand row to load full detail ...]\n\n";

export type ThreadTimelineBuildProfileStage =
  | "event-query"
  | "accepted-client-request-context-query"
  | "event-json-decode"
  | "summary-compaction"
  | "context-window-query"
  | "context-window-json-decode"
  | "thread-view-projection"
  | "pagination-segmentation"
  | "response-serialization";

export type ThreadTimelineEventSelectionStrategy = "full" | "standard-window";

export interface ThreadTimelineBuildProfileStageTiming {
  durationMs: number;
  stage: ThreadTimelineBuildProfileStage;
}

export interface ThreadTimelineBuildProfile {
  compactedEventCount: number;
  contextWindowEventDataBytes: number;
  contextWindowEventRowCount: number;
  decodedEventCount: number;
  eventDataBytes: number;
  eventRowCount: number;
  pageKind: ThreadTimelinePageKind;
  projectedRowCount: number;
  responseJsonBytes: number;
  responseRowCount: number;
  returnedSegmentCount: number;
  segmentLimit: number;
  selectionStrategy: ThreadTimelineEventSelectionStrategy;
  stageTimings: ThreadTimelineBuildProfileStageTiming[];
}

type ThreadTimelineProjectionResponse = Omit<
  ThreadTimelineFeedResponse,
  "threadId" | "rows"
> & {
  rows: TimelineRow[];
};

interface BuildThreadTimelineInternalResult {
  profile: ThreadTimelineBuildProfile | null;
  response: ThreadTimelineProjectionResponse;
}

interface ThreadTimelineBuildProfileAccumulator {
  compactedEventCount: number;
  contextWindowEventDataBytes: number;
  contextWindowEventRowCount: number;
  decodedEventCount: number;
  eventDataBytes: number;
  eventRowCount: number;
  projectedRowCount: number;
  responseJsonBytes: number;
  responseRowCount: number;
  returnedSegmentCount: number;
  selectionStrategy: ThreadTimelineEventSelectionStrategy;
  stageTimings: ThreadTimelineBuildProfileStageTiming[];
}

interface BuildThreadTimelineInternalOptions extends BuildThreadTimelineOptions {
  includeProfile: boolean;
}

interface TimelineEventRowSelection {
  acceptedClientRequestContextRows: StoredEventRow[];
  paginationPage: ThreadTimelinePageRequest;
  responsePageKind: ThreadTimelinePageKind;
  rows: StoredEventRow[];
  strategy: ThreadTimelineEventSelectionStrategy;
}

interface TimelineWindowRowsArgs {
  rows: readonly StoredEventRow[];
  threadId: string;
}

interface SelectAcceptedClientRequestContextRowsArgs {
  rows: readonly StoredEventRow[];
  threadId: string;
}

interface CollectSteerClientRequestIdsBeforeCursorArgs {
  beforeCursor: TimelinePaginationCursor;
  rows: readonly StoredEventRow[];
}

interface SplitFutureSteerAcceptedContextRowsArgs {
  beforeCursor: TimelinePaginationCursor;
  rows: readonly StoredEventRow[];
}

interface SplitFutureSteerAcceptedContextRowsResult {
  contextRows: StoredEventRow[];
  rows: StoredEventRow[];
}

export function toThreadEventWithMeta(
  row: StoredEventRow,
): ThreadEventWithMeta {
  return {
    event: parseStoredEvent(row),
    meta: {
      id: row.id,
      seq: row.sequence,
      createdAt: row.createdAt,
    },
  };
}

function parseAcceptedInputClientRequestId(
  row: StoredEventRow,
): ClientTurnRequestId {
  const event = parseStoredEvent(row);
  switch (event.type) {
    case "turn/input/accepted":
      return event.clientRequestId;
    default:
      throw new Error(`Expected turn/input/accepted row ${row.id}`);
  }
}

function tryReadClientTurnRequestedRequestId(
  row: StoredEventRow,
): ClientTurnRequestId | null {
  const event = parseStoredEvent(row);
  if (event.type !== "client/turn/requested") {
    return null;
  }
  return event.requestId;
}

function tryReadSteerClientTurnRequestedRequestId(
  row: StoredEventRow,
): ClientTurnRequestId | null {
  if (row.type !== "client/turn/requested") {
    return null;
  }
  const event = parseStoredEvent(row);
  if (event.type !== "client/turn/requested") {
    return null;
  }

  switch (event.target.kind) {
    case "auto":
    case "steer":
      return event.target.expectedTurnId === null ? null : event.requestId;
    case "new-turn":
    case "thread-start":
      return null;
  }
}

function collectSteerClientRequestIdsNeedingAcceptedContext(
  rows: readonly StoredEventRow[],
): ClientTurnRequestId[] {
  const acceptedClientRequestIds = new Set<ClientTurnRequestId>();
  const clientRequestIds = new Set<ClientTurnRequestId>();
  for (const row of rows) {
    if (row.type === "turn/input/accepted") {
      const clientRequestId = parseAcceptedInputClientRequestId(row);
      acceptedClientRequestIds.add(clientRequestId);
      clientRequestIds.delete(clientRequestId);
      continue;
    }
    const clientRequestId = tryReadSteerClientTurnRequestedRequestId(row);
    if (
      clientRequestId === null ||
      acceptedClientRequestIds.has(clientRequestId)
    ) {
      continue;
    }
    clientRequestIds.add(clientRequestId);
  }
  return [...clientRequestIds];
}

function collectSteerClientRequestIdsBeforeCursor(
  args: CollectSteerClientRequestIdsBeforeCursorArgs,
): ReadonlySet<ClientTurnRequestId> {
  const clientRequestIds = new Set<ClientTurnRequestId>();
  for (const row of args.rows) {
    if (row.sequence >= args.beforeCursor.anchorSeq) {
      continue;
    }
    const clientRequestId = tryReadSteerClientTurnRequestedRequestId(row);
    if (clientRequestId !== null) {
      clientRequestIds.add(clientRequestId);
    }
  }
  return clientRequestIds;
}

function splitFutureSteerAcceptedContextRows(
  args: SplitFutureSteerAcceptedContextRowsArgs,
): SplitFutureSteerAcceptedContextRowsResult {
  const steerClientRequestIds = collectSteerClientRequestIdsBeforeCursor(args);
  if (steerClientRequestIds.size === 0) {
    return {
      contextRows: [],
      rows: [...args.rows],
    };
  }

  const contextRows: StoredEventRow[] = [];
  const rows: StoredEventRow[] = [];
  for (const row of args.rows) {
    if (
      row.type !== "turn/input/accepted" ||
      row.sequence <= args.beforeCursor.anchorSeq
    ) {
      rows.push(row);
      continue;
    }

    const clientRequestId = parseAcceptedInputClientRequestId(row);
    if (steerClientRequestIds.has(clientRequestId)) {
      contextRows.push(row);
      continue;
    }
    rows.push(row);
  }

  return {
    contextRows,
    rows,
  };
}

function mergeStoredEventRowsById(
  rows: readonly StoredEventRow[],
): StoredEventRow[] {
  const rowsById = new Map<string, StoredEventRow>();
  for (const row of rows) {
    rowsById.set(row.id, row);
  }
  return [...rowsById.values()].sort(
    (left, right) => left.sequence - right.sequence,
  );
}

function selectAcceptedClientRequestContextRows(
  db: DbConnection,
  args: SelectAcceptedClientRequestContextRowsArgs,
): StoredEventRow[] {
  const clientRequestIds = collectSteerClientRequestIdsNeedingAcceptedContext(
    args.rows,
  );
  if (clientRequestIds.length === 0) {
    return [];
  }

  return listStoredTurnInputAcceptedRowsByClientRequestIds(db, {
    afterSequence: maxStoredEventSequence(args.rows),
    clientRequestIds,
    threadId: args.threadId,
  });
}

function partitionAcceptedInputRowsByRequestedTurn(
  args: PartitionAcceptedInputRowsByRequestedTurnArgs,
): PartitionAcceptedInputRowsByRequestedTurnResult {
  const acceptedClientRequestIdsForOtherTurns = new Set<ClientTurnRequestId>();
  const requestedTurnRows: StoredEventRow[] = [];
  for (const row of args.acceptedInputRows) {
    if (row.scopeKind !== "turn" || row.turnId === null) {
      throw new Error(`Expected turn-scoped turn/input/accepted row ${row.id}`);
    }
    if (row.turnId === args.turnId) {
      requestedTurnRows.push(row);
      continue;
    }
    acceptedClientRequestIdsForOtherTurns.add(
      parseAcceptedInputClientRequestId(row),
    );
  }

  return {
    acceptedClientRequestIdsForOtherTurns,
    requestedTurnRows,
  };
}

function filterExactEventRowsForRequestedTurn(
  args: FilterExactEventRowsForRequestedTurnArgs,
): FilterExactEventRowsForRequestedTurnResult {
  if (args.acceptedClientRequestIdsForOtherTurns.size === 0) {
    return {
      removedRows: false,
      rows: args.exactEventRows,
    };
  }

  const rows: StoredEventRow[] = [];
  let removedRows = false;
  for (const row of args.exactEventRows) {
    const requestId = tryReadClientTurnRequestedRequestId(row);
    if (
      requestId !== null &&
      args.acceptedClientRequestIdsForOtherTurns.has(requestId)
    ) {
      removedRows = true;
      continue;
    }
    rows.push(row);
  }

  return {
    removedRows,
    rows,
  };
}

function resolveTurnSummaryDetailsSourceRange(
  args: ResolveTurnSummaryDetailsSourceRangeArgs,
): TimelineTurnSummarySelection {
  const fallbackRange = args.fallbackRange;
  if (!args.useExactEventRowBounds) {
    return fallbackRange;
  }

  const firstRow = args.exactEventRows[0];
  const lastRow = args.exactEventRows.at(-1);
  if (!firstRow || !lastRow) {
    return fallbackRange;
  }

  return {
    sourceSeqEnd: lastRow.sequence,
    sourceSeqStart: firstRow.sequence,
    turnId: fallbackRange.turnId,
  };
}

function selectFullTimelineEventRows(
  db: DbConnection,
  thread: Thread,
  page: ThreadTimelinePageRequest,
): TimelineEventRowSelection {
  return {
    acceptedClientRequestContextRows: [],
    paginationPage: page,
    responsePageKind: page.kind,
    rows: listRecentStoredEventRows(db, {
      threadId: thread.id,
      excludedTypes: THREAD_TIMELINE_EXCLUDED_EVENT_TYPES,
    }),
    strategy: "full",
  };
}

function collectTurnIdsMissingStartedRows(
  rows: readonly StoredEventRow[],
): string[] {
  const startedTurnIds = new Set<string>();
  const turnScopedIds = new Set<string>();

  for (const row of rows) {
    if (row.scopeKind !== "turn" || row.turnId === null) {
      continue;
    }

    if (row.type === "turn/started") {
      startedTurnIds.add(row.turnId);
      continue;
    }

    turnScopedIds.add(row.turnId);
  }

  return [...turnScopedIds].filter((turnId) => !startedTurnIds.has(turnId));
}

function maxStoredEventSequence(rows: readonly StoredEventRow[]): number {
  return rows.reduce(
    (maxSequence, row) => Math.max(maxSequence, row.sequence),
    0,
  );
}

function ensureTimelineWindowTurnStartedRows(
  db: DbConnection,
  args: TimelineWindowRowsArgs,
): StoredEventRow[] {
  // Standard windows are selected by message anchors, while projection groups
  // by turn roots. Add only the real lifecycle rows needed by selected events.
  const missingTurnIds = collectTurnIdsMissingStartedRows(args.rows);
  if (missingTurnIds.length === 0) {
    return [...args.rows];
  }

  const turnStartedRows = listStoredTurnStartedRowsByTurnIdsUpToSequence(db, {
    threadId: args.threadId,
    sequenceCutoff: maxStoredEventSequence(args.rows),
    turnIds: missingTurnIds,
  });
  if (turnStartedRows.length === 0) {
    return [...args.rows];
  }

  return mergeStoredEventRowsById([...turnStartedRows, ...args.rows]);
}

/**
 * Background tasks outlive their spawning turn: a window containing an
 * in-flight task's item/started may end long before the task's thread-scoped
 * progress/completed rows. Backfill the latest state row per in-window item so
 * the page renders the task's current (possibly terminal) state instead of
 * pinning it "running" forever.
 */
function ensureTimelineWindowBackgroundTaskStateRows(
  db: DbConnection,
  args: TimelineWindowRowsArgs,
): StoredEventRow[] {
  const itemIds = new Set<string>();
  for (const row of args.rows) {
    if (row.itemKind === "backgroundTask" && row.itemId !== null) {
      itemIds.add(row.itemId);
    }
  }
  if (itemIds.size === 0) {
    return [...args.rows];
  }

  const stateRows = listLatestBackgroundTaskStateRowsByItemIds(db, {
    threadId: args.threadId,
    itemIds: [...itemIds],
  });
  if (stateRows.length === 0) {
    return [...args.rows];
  }

  return mergeStoredEventRowsById([...args.rows, ...stateRows]);
}

interface ResolveTimelineSegmentWindowArgs {
  page: ThreadTimelinePageRequest;
  threadId: string;
}

interface ResolvedTimelineSegmentWindow {
  beforeSequence: number | undefined;
  hasAnchors: boolean;
  sequenceStart: number;
}

/**
 * Resolves the event-sequence window for a timeline page from segment anchors,
 * touching only the ~`segmentLimit` anchors around the page rather than every
 * anchor in the thread. `hasAnchors` is false only when the thread has no
 * qualifying anchors at all; a stale cursor (anchors exist but the cursor's
 * anchor is gone) throws, matching the previous behavior.
 */
function resolveTimelineSegmentWindow(
  db: DbConnection,
  args: ResolveTimelineSegmentWindowArgs,
): ResolvedTimelineSegmentWindow {
  const { page, threadId } = args;
  const noAnchors: ResolvedTimelineSegmentWindow = {
    beforeSequence: undefined,
    hasAnchors: false,
    sequenceStart: 0,
  };

  if (page.kind === "older") {
    const cursor = page.beforeCursor;
    const cursorAnchor = getTimelineSegmentAnchorAtSequence(db, {
      sequence: cursor.anchorSeq,
      threadId,
    });
    if (!cursorAnchor || cursorAnchor.rowId !== cursor.anchorId) {
      const anyAnchor = listTimelineSegmentAnchorsDescending(db, {
        limit: 1,
        threadId,
      });
      if (anyAnchor.length === 0) {
        return noAnchors;
      }
      throw new ApiError(
        400,
        "invalid_request",
        "Timeline pagination cursor is no longer available",
      );
    }
    const precedingAnchors = listTimelineSegmentAnchorsDescending(db, {
      beforeSequence: cursor.anchorSeq,
      limit: page.segmentLimit + 1,
      threadId,
    });
    return {
      beforeSequence: findTimelineSegmentAnchorSequenceAfter(db, {
        sequence: cursor.anchorSeq,
        threadId,
      }),
      hasAnchors: true,
      // The (segmentLimit + 1)-th anchor before the cursor is the window's
      // lower bound; fewer than that means the window reaches the thread start.
      sequenceStart: precedingAnchors[page.segmentLimit]?.sequence ?? 0,
    };
  }

  const newestAnchors = listTimelineSegmentAnchorsDescending(db, {
    limit: page.segmentLimit + 1,
    threadId,
  });
  if (newestAnchors.length === 0) {
    return noAnchors;
  }
  return {
    beforeSequence: undefined,
    hasAnchors: true,
    sequenceStart: newestAnchors[page.segmentLimit]?.sequence ?? 0,
  };
}

function selectStandardTimelineEventRows(
  db: DbConnection,
  thread: Thread,
  page: ThreadTimelinePageRequest,
): TimelineEventRowSelection {
  const window = resolveTimelineSegmentWindow(db, {
    page,
    threadId: thread.id,
  });
  if (!window.hasAnchors) {
    return selectFullTimelineEventRows(db, thread, page);
  }

  const beforeSequence = window.beforeSequence;
  const sequenceStart = window.sequenceStart;

  const selectedRows = ensureTimelineWindowBackgroundTaskStateRows(db, {
    threadId: thread.id,
    rows: ensureTimelineWindowTurnStartedRows(db, {
      threadId: thread.id,
      rows: listStoredTimelineWindowEventRows(db, {
        beforeSequence,
        excludedTypes: THREAD_TIMELINE_EXCLUDED_EVENT_TYPES,
        sequenceStart,
        threadId: thread.id,
      }),
    }),
  });
  const selectedRowsWithContext =
    page.kind === "older"
      ? splitFutureSteerAcceptedContextRows({
          beforeCursor: page.beforeCursor,
          rows: selectedRows,
        })
      : {
          contextRows: [],
          rows: selectedRows,
        };

  return {
    acceptedClientRequestContextRows: selectedRowsWithContext.contextRows,
    paginationPage:
      page.kind === "older"
        ? page
        : {
            kind: "latest",
            segmentLimit: page.segmentLimit,
          },
    responsePageKind: page.kind,
    rows: selectedRowsWithContext.rows,
    strategy:
      sequenceStart === 0 && beforeSequence === undefined
        ? "full"
        : "standard-window",
  };
}

function selectTimelineEventRows(
  db: DbConnection,
  thread: Thread,
  options: BuildThreadTimelineOptions,
): TimelineEventRowSelection {
  return selectStandardTimelineEventRows(db, thread, options.page);
}

function byteLengthOfStoredEventRows(rows: readonly StoredEventRow[]): number {
  let byteLength = 0;
  for (const row of rows) {
    byteLength += Buffer.byteLength(row.data, "utf8");
  }
  return byteLength;
}

function timelineFeedRowKindPrefix(row: ThreadTimelineViewRow): string {
  switch (row.kind) {
    case "bundle-summary":
      return "b";
    case "conversation":
      return "c";
    case "step-summary":
      return "p";
    case "system":
      return "s";
    case "turn":
      return "t";
    case "work":
      return `w${row.workKind.slice(0, 1)}`;
  }
}

function timelineFeedRowKey(row: ThreadTimelineViewRow): string {
  const digest = createHash("sha256")
    .update(row.id)
    .digest("base64url")
    .slice(0, 10);
  return `${timelineFeedRowKindPrefix(row)}_${row.sourceSeqStart}_${digest}`;
}

function buildTimelineFeedTextPreview(text: string): TimelineFeedTextPreview {
  if (text.length <= TIMELINE_FEED_TEXT_PREVIEW_THRESHOLD_CHARS) {
    return {
      complete: true,
      fullLength: text.length,
      text,
    };
  }

  return {
    complete: false,
    fullLength: text.length,
    text: [
      text.slice(0, TIMELINE_FEED_TEXT_PREVIEW_HEAD_CHARS),
      TIMELINE_FEED_TEXT_PREVIEW_MARKER,
      text.slice(-TIMELINE_FEED_TEXT_PREVIEW_TAIL_CHARS),
    ].join(""),
  };
}

function nullableTimelineFeedTextPreview(
  text: string | null,
): TimelineFeedTextPreview | null {
  return text === null ? null : buildTimelineFeedTextPreview(text);
}

function buildOmittedTimelineFeedTextPreview(
  text: string,
): TimelineFeedTextPreview {
  return {
    complete: text.length === 0,
    fullLength: text.length,
    text: "",
  };
}

function buildExpandableBodyFeedPreview(
  text: string,
  status: "pending" | "completed" | "error" | "interrupted" | null,
): TimelineFeedTextPreview {
  return status === "pending"
    ? buildTimelineFeedTextPreview(text)
    : buildOmittedTimelineFeedTextPreview(text);
}

function nullableExpandableBodyFeedPreview(
  text: string | null,
  status: "pending" | "completed" | "error" | "interrupted" | null,
): TimelineFeedTextPreview | null {
  return text === null ? null : buildExpandableBodyFeedPreview(text, status);
}

function timelineFeedDetailRef(
  row: ThreadTimelineViewRow,
  key: string,
  parts: readonly TimelineFeedDetailPart[],
): NonNullable<TimelineFeedRow["detail"]> | null {
  return parts.length === 0
    ? null
    : {
        rowKey: key,
        source: {
          start: row.sourceSeqStart,
          end: row.sourceSeqEnd,
        },
        parts: [...parts],
      };
}

function timelineFeedBase(
  row: ThreadTimelineViewRow,
  key: string,
  parts: readonly TimelineFeedDetailPart[],
): Pick<
  TimelineFeedRow,
  "key" | "turnId" | "source" | "startedAt" | "createdAt" | "detail"
> {
  return {
    key,
    turnId: row.turnId,
    source: {
      start: row.sourceSeqStart,
      end: row.sourceSeqEnd,
    },
    startedAt: row.startedAt,
    createdAt: row.createdAt,
    detail: timelineFeedDetailRef(row, key, parts),
  };
}

function timelineFeedDetailPartsForText(
  part: TimelineFeedDetailPart,
  preview: TimelineFeedTextPreview | null,
): TimelineFeedDetailPart[] {
  return preview !== null && !preview.complete ? [part] : [];
}

function timelineFeedDetailPartsForNullableText(
  part: TimelineFeedDetailPart,
  preview: TimelineFeedTextPreview | null,
): TimelineFeedDetailPart[] {
  return timelineFeedDetailPartsForText(part, preview);
}

function mapTimelineViewRowToFeedRow(
  row: ThreadTimelineViewRow,
): TimelineFeedRow {
  const key = timelineFeedRowKey(row);
  switch (row.kind) {
    case "bundle-summary":
    case "step-summary":
      return {
        ...timelineFeedBase(row, key, ["children"]),
        kind: row.kind,
        status: row.status,
        title: buildTimelineWorkSummaryLabel(row, {
          active: row.status === "pending",
        }),
        childCount: row.children.length,
      };
    case "conversation": {
      const textPreview = buildTimelineFeedTextPreview(row.text);
      const parts = timelineFeedDetailPartsForText("text", textPreview);
      if (row.role === "user") {
        return {
          ...timelineFeedBase(row, key, parts),
          kind: "conversation",
          role: "user",
          textPreview,
          attachments: row.attachments,
          initiator: row.initiator,
          senderThreadId: row.senderThreadId,
          turnRequest: row.turnRequest,
          mentions: row.mentions,
        };
      }
      return {
        ...timelineFeedBase(row, key, parts),
        kind: "conversation",
        role: "assistant",
        textPreview,
        attachments: row.attachments,
        turnRequest: null,
      };
    }
    case "system": {
      const detailPreview = nullableExpandableBodyFeedPreview(
        row.detail,
        row.status,
      );
      const parts = timelineFeedDetailPartsForNullableText(
        "system-detail",
        detailPreview,
      );
      if (row.systemKind === "operation") {
        if (row.operationKind === "parent-change") {
          return {
            ...timelineFeedBase(row, key, parts),
            kind: "system",
            systemKind: "operation",
            operationKind: "parent-change",
            title: row.title,
            detailPreview,
            status: row.status,
            parentChange: row.parentChange,
            completedAt: row.completedAt,
          };
        }
        return {
          ...timelineFeedBase(row, key, parts),
          kind: "system",
          systemKind: "operation",
          operationKind: row.operationKind,
          title: row.title,
          detailPreview,
          status: row.status,
          completedAt: row.completedAt,
        };
      }
      return {
        ...timelineFeedBase(row, key, parts),
        kind: "system",
        systemKind: row.systemKind,
        title: row.title,
        detailPreview,
        status: row.status,
      };
    }
    case "turn": {
      return {
        ...timelineFeedBase(row, key, []),
        kind: "turn",
        turnId: row.turnId,
        status: row.status,
        summaryCount: row.summaryCount,
        completedAt: row.completedAt,
        children:
          row.children === null
            ? null
            : mapTimelineViewRowsToFeedRows(row.children),
      };
    }
    case "work":
      switch (row.workKind) {
        case "command": {
          const outputPreview = buildExpandableBodyFeedPreview(
            row.output,
            row.status,
          );
          const parts = timelineFeedDetailPartsForText("output", outputPreview);
          return {
            ...timelineFeedBase(row, key, parts),
            kind: "work",
            workKind: "command",
            status: row.status,
            callId: row.callId,
            command: row.command,
            cwd: row.cwd,
            sourceLabel: row.source,
            outputPreview,
            exitCode: row.exitCode,
            completedAt: row.completedAt,
            approvalStatus: row.approvalStatus,
            activityIntents: row.activityIntents,
          };
        }
        case "tool": {
          const outputPreview = buildExpandableBodyFeedPreview(
            row.output,
            row.status,
          );
          const parts = timelineFeedDetailPartsForText("output", outputPreview);
          return {
            ...timelineFeedBase(row, key, parts),
            kind: "work",
            workKind: "tool",
            status: row.status,
            callId: row.callId,
            toolName: row.toolName,
            toolArgs: row.toolArgs,
            outputPreview,
            completedAt: row.completedAt,
            approvalStatus: row.approvalStatus,
            activityIntents: row.activityIntents,
          };
        }
        case "file-change": {
          const diffPreview = nullableExpandableBodyFeedPreview(
            row.change.diff,
            row.status,
          );
          const stdoutPreview = nullableExpandableBodyFeedPreview(
            row.stdout,
            row.status,
          );
          const stderrPreview = nullableExpandableBodyFeedPreview(
            row.stderr,
            row.status,
          );
          const parts = [
            ...timelineFeedDetailPartsForNullableText("file-diff", diffPreview),
            ...timelineFeedDetailPartsForNullableText("stdout", stdoutPreview),
            ...timelineFeedDetailPartsForNullableText("stderr", stderrPreview),
          ];
          return {
            ...timelineFeedBase(row, key, parts),
            kind: "work",
            workKind: "file-change",
            status: row.status,
            callId: row.callId,
            change: {
              path: row.change.path,
              kind: row.change.kind,
              movePath: row.change.movePath,
              diffPreview,
              diffStats: row.change.diffStats,
            },
            stdoutPreview,
            stderrPreview,
            approvalStatus: row.approvalStatus,
          };
        }
        case "web-search":
          return {
            ...timelineFeedBase(row, key, []),
            kind: "work",
            workKind: "web-search",
            status: row.status,
            callId: row.callId,
            queries: row.queries,
            completedAt: row.completedAt,
          };
        case "web-fetch":
          return {
            ...timelineFeedBase(row, key, []),
            kind: "work",
            workKind: "web-fetch",
            status: row.status,
            callId: row.callId,
            url: row.url,
            prompt: row.prompt,
            pattern: row.pattern,
            completedAt: row.completedAt,
          };
        case "image-view":
          return {
            ...timelineFeedBase(row, key, []),
            kind: "work",
            workKind: "image-view",
            status: row.status,
            callId: row.callId,
            path: row.path,
            completedAt: row.completedAt,
          };
        case "approval":
          if (row.approvalKind === "file-edit") {
            return {
              ...timelineFeedBase(row, key, []),
              kind: "work",
              workKind: "approval",
              status: row.status,
              interactionId: row.interactionId,
              target: row.target,
              approvalKind: "file-edit",
              lifecycle: row.lifecycle,
            };
          }
          return {
            ...timelineFeedBase(row, key, []),
            kind: "work",
            workKind: "approval",
            status: row.status,
            interactionId: row.interactionId,
            target: row.target,
            approvalKind: "permission-grant",
            lifecycle: row.lifecycle,
            grantScope: row.grantScope,
            statusReason: row.statusReason,
          };
        case "question":
          return {
            ...timelineFeedBase(row, key, []),
            kind: "work",
            workKind: "question",
            status: row.status,
            interactionId: row.interactionId,
            lifecycle: row.lifecycle,
            questions: row.questions,
            answers: row.answers,
            statusReason: row.statusReason,
          };
        case "delegation": {
          const outputPreview = buildExpandableBodyFeedPreview(
            row.output,
            row.status,
          );
          const includeChildRows = row.status === "pending";
          const childRows = includeChildRows
            ? mapTimelineViewRowsToFeedRows(row.childRows)
            : [];
          const parts = [
            ...timelineFeedDetailPartsForText("output", outputPreview),
            ...(childRows.length < row.childRows.length
              ? (["children"] satisfies TimelineFeedDetailPart[])
              : []),
          ];
          return {
            ...timelineFeedBase(row, key, parts),
            kind: "work",
            workKind: "delegation",
            status: row.status,
            callId: row.callId,
            toolName: row.toolName,
            subagentType: row.subagentType,
            description: row.description,
            outputPreview,
            completedAt: row.completedAt,
            childCount: row.childRows.length,
            childRows,
          };
        }
        case "workflow": {
          const summaryPreview = nullableTimelineFeedTextPreview(row.summary);
          const errorPreview = nullableTimelineFeedTextPreview(row.error);
          const parts = [
            ...(row.workflow === null
              ? []
              : (["workflow"] satisfies TimelineFeedDetailPart[])),
            ...timelineFeedDetailPartsForNullableText(
              "workflow",
              summaryPreview,
            ),
            ...timelineFeedDetailPartsForNullableText("workflow", errorPreview),
          ];
          return {
            ...timelineFeedBase(row, key, [...new Set(parts)]),
            kind: "work",
            workKind: "workflow",
            status: row.status,
            itemId: row.itemId,
            taskType: LOCAL_WORKFLOW_TASK_TYPE,
            workflowName: row.workflowName,
            description: row.description,
            taskStatus: row.taskStatus,
            workflowSummary:
              row.workflow === null
                ? null
                : {
                    agentCount: row.workflow.agents.length,
                    phaseCount: row.workflow.phases.length,
                    settledAgentCount: row.workflow.agents.filter((agent) =>
                      isSettledWorkflowAgentState(agent.state),
                    ).length,
                  },
            usage: row.usage,
            summaryPreview,
            errorPreview,
            completedAt: row.completedAt,
          };
        }
      }
  }
}

function mapTimelineViewRowsToFeedRows(
  rows: readonly ThreadTimelineViewRow[],
): TimelineFeedRow[] {
  return rows.map(mapTimelineViewRowToFeedRow);
}

function createThreadTimelineBuildProfileAccumulator(): ThreadTimelineBuildProfileAccumulator {
  return {
    compactedEventCount: 0,
    contextWindowEventDataBytes: 0,
    contextWindowEventRowCount: 0,
    decodedEventCount: 0,
    eventDataBytes: 0,
    eventRowCount: 0,
    projectedRowCount: 0,
    responseJsonBytes: 0,
    responseRowCount: 0,
    returnedSegmentCount: 0,
    selectionStrategy: "full",
    stageTimings: [],
  };
}

function measureThreadTimelineStage<TResult>(
  profile: ThreadTimelineBuildProfileAccumulator | null,
  stage: ThreadTimelineBuildProfileStage,
  fn: () => TResult,
): TResult {
  if (!profile) {
    return fn();
  }

  const startTime = performance.now();
  const result = fn();
  profile.stageTimings.push({
    durationMs: performance.now() - startTime,
    stage,
  });
  return result;
}

function completeThreadTimelineBuildProfile(
  accumulator: ThreadTimelineBuildProfileAccumulator,
  options: BuildThreadTimelineOptions,
  response: ThreadTimelineProjectionResponse,
): ThreadTimelineBuildProfile {
  accumulator.responseJsonBytes = measureThreadTimelineStage(
    accumulator,
    "response-serialization",
    () => Buffer.byteLength(JSON.stringify(response), "utf8"),
  );
  return {
    compactedEventCount: accumulator.compactedEventCount,
    contextWindowEventDataBytes: accumulator.contextWindowEventDataBytes,
    contextWindowEventRowCount: accumulator.contextWindowEventRowCount,
    decodedEventCount: accumulator.decodedEventCount,
    eventDataBytes: accumulator.eventDataBytes,
    eventRowCount: accumulator.eventRowCount,
    pageKind: options.page.kind,
    projectedRowCount: accumulator.projectedRowCount,
    responseJsonBytes: accumulator.responseJsonBytes,
    responseRowCount: accumulator.responseRowCount,
    returnedSegmentCount: accumulator.returnedSegmentCount,
    segmentLimit: options.page.segmentLimit,
    selectionStrategy: accumulator.selectionStrategy,
    stageTimings: accumulator.stageTimings,
  };
}

function buildThreadTimelineInternal(
  db: DbConnection,
  thread: Thread,
  options: BuildThreadTimelineInternalOptions,
): BuildThreadTimelineInternalResult {
  const profile = options.includeProfile
    ? createThreadTimelineBuildProfileAccumulator()
    : null;
  const includeNestedRows = options.includeNestedRows ?? false;
  const includeProviderUnhandledOperations = options.isDevelopment;
  const eventSelection = measureThreadTimelineStage(
    profile,
    "event-query",
    () => selectTimelineEventRows(db, thread, options),
  );
  const rawEventRows = eventSelection.rows;
  if (profile) {
    profile.eventDataBytes = byteLengthOfStoredEventRows(rawEventRows);
    profile.eventRowCount = rawEventRows.length;
    profile.selectionStrategy = eventSelection.strategy;
  }
  const acceptedClientRequestContextRows = measureThreadTimelineStage(
    profile,
    "accepted-client-request-context-query",
    () =>
      mergeStoredEventRowsById([
        ...eventSelection.acceptedClientRequestContextRows,
        ...selectAcceptedClientRequestContextRows(db, {
          rows: rawEventRows,
          threadId: thread.id,
        }),
      ]),
  );
  const decodedRawEvents = measureThreadTimelineStage(
    profile,
    "event-json-decode",
    () => rawEventRows.map((row) => toThreadEventWithMeta(row)),
  );
  if (profile) {
    profile.decodedEventCount = decodedRawEvents.length;
  }
  const decodedEvents = measureThreadTimelineStage(
    profile,
    "summary-compaction",
    () => compactThreadTimelineSummaryEvents(decodedRawEvents),
  );
  if (profile) {
    profile.compactedEventCount = decodedEvents.length;
  }
  const contextWindowUsageRows = measureThreadTimelineStage(
    profile,
    "context-window-query",
    () =>
      listContextWindowUsageRows(db, {
        threadId: thread.id,
      }),
  );
  if (profile) {
    profile.contextWindowEventDataBytes = byteLengthOfStoredEventRows(
      contextWindowUsageRows,
    );
    profile.contextWindowEventRowCount = contextWindowUsageRows.length;
  }
  const commonProjectionOptions = {
    includeDebugRawEvents: false,
    includeProviderUnhandledOperations,
    isLatestPage: options.page.kind === "latest",
    threadStatus: thread.status,
    workspaceRoot: resolveThreadWorkspaceRoot(db, thread),
  };
  const contextWindowEvents = measureThreadTimelineStage(
    profile,
    "context-window-json-decode",
    () => contextWindowUsageRows.map((row) => toThreadEventWithMeta(row)),
  );
  const acceptedClientRequestContext: AcceptedClientRequestContext = {
    acceptedClientRequestEvents: acceptedClientRequestContextRows.map((row) =>
      toThreadEventWithMeta(row),
    ),
  };
  const timeline = measureThreadTimelineStage(
    profile,
    "thread-view-projection",
    () =>
      buildThreadTimelineFromEvents({
        acceptedClientRequestContext,
        contextWindowEvents,
        events: decodedEvents,
        options: {
          ...commonProjectionOptions,
          includeNestedRows,
          turnMessageDetail: includeNestedRows ? "full" : "summary",
        },
      }),
  );
  if (profile) {
    profile.projectedRowCount = timeline.rows.length;
  }
  const paginatedTimeline = measureThreadTimelineStage(
    profile,
    "pagination-segmentation",
    () => paginateTimelineRows(timeline.rows, eventSelection.paginationPage),
  );
  if (profile) {
    profile.responseRowCount = paginatedTimeline.rows.length;
    profile.returnedSegmentCount = paginatedTimeline.returnedSegmentCount;
  }

  const response: ThreadTimelineProjectionResponse = {
    rows: paginatedTimeline.rows,
    activeThinking:
      options.page.kind === "latest" ? timeline.activeThinking : null,
    // pendingTodos is gated inside the projection via `isLatestPage` so the
    // extraction work is skipped on older-page requests entirely; no
    // post-hoc null-out needed here.
    pendingTodos: timeline.pendingTodos,
    contextWindowUsage:
      options.page.kind === "latest"
        ? (timeline.contextWindowUsage ?? undefined)
        : undefined,
    timelinePage: {
      kind: eventSelection.responsePageKind,
      segmentLimit: paginatedTimeline.segmentLimit,
      returnedSegmentCount: paginatedTimeline.returnedSegmentCount,
      hasOlderRows: paginatedTimeline.hasOlderRows,
      olderCursor: paginatedTimeline.olderCursor,
    },
  };
  return {
    response,
    profile:
      profile === null
        ? null
        : completeThreadTimelineBuildProfile(profile, options, response),
  };
}

export function buildThreadTimelineFeed(
  db: DbConnection,
  thread: Thread,
  options: BuildThreadTimelineFeedOptions,
): ThreadTimelineFeedResponse {
  const response = buildThreadTimelineInternal(db, thread, {
    isDevelopment: options.isDevelopment,
    includeNestedRows: false,
    includeProfile: false,
    page: options.page,
  }).response;
  return {
    threadId: thread.id,
    rows: mapTimelineViewRowsToFeedRows(buildTimelineViewRows(response.rows)),
    activeThinking: response.activeThinking,
    pendingTodos: response.pendingTodos,
    contextWindowUsage: response.contextWindowUsage,
    timelinePage: response.timelinePage,
  };
}

function buildTimelineRowsForDetail(
  db: DbConnection,
  thread: Thread,
  options: {
    isDevelopment: boolean;
    sourceSeqEnd: number;
    sourceSeqStart: number;
  },
): TimelineRow[] {
  if (options.sourceSeqStart > options.sourceSeqEnd) {
    throw new ApiError(
      400,
      "invalid_request",
      "sourceSeqStart must be less than or equal to sourceSeqEnd",
    );
  }

  const exactEventRows = listStoredEventRowsInRange(db, {
    threadId: thread.id,
    seqStart: options.sourceSeqStart,
    seqEnd: options.sourceSeqEnd,
  });
  if (exactEventRows.length === 0) {
    throw new ApiError(404, "invalid_request", "Timeline row not found");
  }

  const missingTurnIds = collectTurnIdsMissingStartedRows(exactEventRows);
  const turnStartedRows =
    missingTurnIds.length === 0
      ? []
      : listStoredTurnStartedRowsByTurnIdsUpToSequence(db, {
          threadId: thread.id,
          sequenceCutoff: maxStoredEventSequence(exactEventRows),
          turnIds: missingTurnIds,
        });
  return buildThreadTimelineFromEvents({
    acceptedClientRequestContext: {
      acceptedClientRequestEvents: [],
    },
    contextWindowEvents: [],
    events: [...turnStartedRows, ...exactEventRows].map((row) =>
      toThreadEventWithMeta(row),
    ),
    options: {
      includeDebugRawEvents: false,
      includeNestedRows: true,
      includeProviderUnhandledOperations: options.isDevelopment,
      isLatestPage: false,
      threadStatus: thread.status,
      turnMessageDetail: "full",
      workspaceRoot: resolveThreadWorkspaceRoot(db, thread),
    },
  }).rows;
}

function collectTimelineViewRows(
  rows: readonly ThreadTimelineViewRow[],
): ThreadTimelineViewRow[] {
  const collectedRows: ThreadTimelineViewRow[] = [];
  for (const row of rows) {
    collectedRows.push(row);
    switch (row.kind) {
      case "bundle-summary":
      case "step-summary":
        collectedRows.push(...collectTimelineViewRows(row.children));
        continue;
      case "conversation":
      case "system":
        continue;
      case "turn":
        if (row.children !== null) {
          collectedRows.push(...collectTimelineViewRows(row.children));
        }
        continue;
      case "work":
        if (row.workKind === "delegation") {
          collectedRows.push(...collectTimelineViewRows(row.childRows));
        }
        continue;
    }
  }
  return collectedRows;
}

function timelineDetailRowSourceMatches(
  row: ThreadTimelineViewRow,
  options: BuildTimelineRowDetailOptions,
): boolean {
  return (
    row.sourceSeqStart === options.sourceSeqStart &&
    row.sourceSeqEnd === options.sourceSeqEnd
  );
}

function timelineDetailRowCanUseSourceFallback(
  row: ThreadTimelineViewRow,
): boolean {
  return row.kind === "bundle-summary" || row.kind === "step-summary";
}

function timelineDetailRowMatchesRequest(
  row: ThreadTimelineViewRow,
  options: BuildTimelineRowDetailOptions,
): boolean {
  if (!timelineDetailRowSourceMatches(row, options)) {
    return false;
  }
  if (timelineFeedRowKey(row) === options.rowKey) {
    return true;
  }
  return (
    timelineDetailRowCanUseSourceFallback(row) &&
    options.rowKey.startsWith(
      `${timelineFeedRowKindPrefix(row)}_${options.sourceSeqStart}_`,
    )
  );
}

function findTimelineDetailRow(
  rows: readonly ThreadTimelineViewRow[],
  options: BuildTimelineRowDetailOptions,
): ThreadTimelineViewRow | null {
  return (
    collectTimelineViewRows(rows).find((row) =>
      timelineDetailRowMatchesRequest(row, options),
    ) ?? null
  );
}

export function buildTimelineRowDetail(
  db: DbConnection,
  thread: Thread,
  options: BuildTimelineRowDetailOptions,
): TimelineRowDetailResponse {
  const rows = buildTimelineRowsForDetail(db, thread, {
    isDevelopment: options.isDevelopment,
    sourceSeqEnd: options.sourceSeqEnd,
    sourceSeqStart: options.sourceSeqStart,
  });
  const viewRows = buildTimelineViewRows(rows);
  const matchingRow =
    findTimelineDetailRow(viewRows, options) ??
    findTimelineDetailRow(
      buildTimelineViewRows(rows, { closedScope: true }),
      options,
    );
  if (!matchingRow) {
    throw new ApiError(404, "invalid_request", "Timeline row not found");
  }

  const parts: TimelineRowDetailResponse["parts"] = {
    text: null,
    output: null,
    systemDetail: null,
    fileDiff: null,
    stdout: null,
    stderr: null,
    children: null,
    workflow: null,
  };
  const requestedParts = new Set(options.parts);

  switch (matchingRow.kind) {
    case "bundle-summary":
    case "step-summary":
      if (requestedParts.has("children")) {
        parts.children = mapTimelineViewRowsToFeedRows(matchingRow.children);
      }
      break;
    case "conversation":
      if (requestedParts.has("text")) {
        parts.text = matchingRow.text;
      }
      break;
    case "system":
      if (requestedParts.has("system-detail")) {
        parts.systemDetail = matchingRow.detail;
      }
      break;
    case "turn":
      if (requestedParts.has("children")) {
        parts.children =
          matchingRow.children === null
            ? []
            : mapTimelineViewRowsToFeedRows(matchingRow.children);
      }
      break;
    case "work":
      switch (matchingRow.workKind) {
        case "command":
        case "tool":
          if (requestedParts.has("output")) {
            parts.output = matchingRow.output;
          }
          break;
        case "file-change":
          if (requestedParts.has("file-diff")) {
            parts.fileDiff = matchingRow.change.diff;
          }
          if (requestedParts.has("stdout")) {
            parts.stdout = matchingRow.stdout;
          }
          if (requestedParts.has("stderr")) {
            parts.stderr = matchingRow.stderr;
          }
          break;
        case "delegation":
          if (requestedParts.has("output")) {
            parts.output = matchingRow.output;
          }
          if (requestedParts.has("children")) {
            parts.children = mapTimelineViewRowsToFeedRows(
              matchingRow.childRows,
            );
          }
          break;
        case "workflow":
          if (requestedParts.has("workflow")) {
            parts.workflow = matchingRow.workflow;
          }
          break;
        case "web-search":
        case "web-fetch":
        case "image-view":
        case "approval":
        case "question":
          break;
      }
      break;
  }

  return {
    rowKey: options.rowKey,
    source: {
      start: matchingRow.sourceSeqStart,
      end: matchingRow.sourceSeqEnd,
    },
    parts,
  };
}

function collectTimelineWorkOutputRows(
  rows: readonly TimelineRow[],
): Array<TimelineCommandWorkRow | TimelineToolWorkRow> {
  const outputRows: Array<TimelineCommandWorkRow | TimelineToolWorkRow> = [];
  for (const row of rows) {
    switch (row.kind) {
      case "conversation":
      case "system":
        continue;
      case "turn":
        if (row.children !== null) {
          outputRows.push(...collectTimelineWorkOutputRows(row.children));
        }
        continue;
      case "work":
        switch (row.workKind) {
          case "command":
          case "tool":
            outputRows.push(row);
            continue;
          case "delegation":
            outputRows.push(...collectTimelineWorkOutputRows(row.childRows));
            continue;
          case "file-change":
          case "web-search":
          case "web-fetch":
          case "image-view":
          case "approval":
          case "question":
          case "workflow":
            continue;
        }
    }
  }
  return outputRows;
}

export function buildTimelineWorkOutputDetail(
  db: DbConnection,
  thread: Thread,
  options: BuildTimelineWorkOutputDetailOptions,
): TimelineWorkOutputDetailResponse {
  const rows = buildTimelineRowsForDetail(db, thread, {
    isDevelopment: options.isDevelopment,
    sourceSeqEnd: options.sourceSeqEnd,
    sourceSeqStart: options.sourceSeqStart,
  });
  const matchingRow = collectTimelineWorkOutputRows(rows).find(
    (row) => row.callId === options.callId && row.workKind === options.workKind,
  );
  if (!matchingRow) {
    throw new ApiError(404, "invalid_request", "Timeline row not found");
  }

  return {
    output: matchingRow.output,
  };
}

export function buildTimelineTurnSummaryDetails(
  db: DbConnection,
  thread: Thread,
  options: BuildTimelineTurnSummaryDetailsOptions,
): TimelineTurnSummaryDetailsResponse {
  if (options.sourceSeqStart > options.sourceSeqEnd) {
    throw new ApiError(
      400,
      "invalid_request",
      "sourceSeqStart must be less than or equal to sourceSeqEnd",
    );
  }

  const includeProviderUnhandledOperations = options.isDevelopment;
  const exactEventRows = listStoredEventRowsInRange(db, {
    threadId: thread.id,
    seqStart: options.sourceSeqStart,
    seqEnd: options.sourceSeqEnd,
  });
  const clientRequestIds = listStoredClientTurnRequestIdsInRange(db, {
    threadId: thread.id,
    seqStart: options.sourceSeqStart,
    seqEnd: options.sourceSeqEnd,
  });
  const acceptedInputRows = listStoredTurnInputAcceptedRowsByClientRequestIds(
    db,
    {
      threadId: thread.id,
      afterSequence: options.sourceSeqEnd,
      clientRequestIds,
    },
  );
  const acceptedInputRowsByTurn = partitionAcceptedInputRowsByRequestedTurn({
    acceptedInputRows,
    turnId: options.turnId,
  });
  const exactEventRowsForRequestedTurn = filterExactEventRowsForRequestedTurn({
    acceptedClientRequestIdsForOtherTurns:
      acceptedInputRowsByTurn.acceptedClientRequestIdsForOtherTurns,
    exactEventRows,
  });
  const eventRows = [
    ...exactEventRowsForRequestedTurn.rows,
    ...acceptedInputRowsByTurn.requestedTurnRows,
  ];
  const mismatchedTurnRow = eventRows.find(
    (row) => row.scopeKind === "turn" && row.turnId !== options.turnId,
  );
  if (mismatchedTurnRow) {
    throw new ApiError(
      400,
      "invalid_request",
      `Timeline turn summary details range ${options.sourceSeqStart}-${options.sourceSeqEnd} includes turn ${mismatchedTurnRow.turnId ?? "unknown"} instead of ${options.turnId}`,
    );
  }

  const hasTurnScopedRowsForRequestedTurn = eventRows.some(
    (row) => row.scopeKind === "turn" && row.turnId === options.turnId,
  );
  if (!hasTurnScopedRowsForRequestedTurn) {
    throw new ApiError(
      400,
      "invalid_request",
      `Timeline turn summary details range ${options.sourceSeqStart}-${options.sourceSeqEnd} does not include turn ${options.turnId}`,
    );
  }

  const hasCurrentStartedRow = eventRows.some(
    (row) => row.type === "turn/started" && row.turnId === options.turnId,
  );
  const contextSequenceCutoff = eventRows.reduce(
    (maxSequence, row) => Math.max(maxSequence, row.sequence),
    options.sourceSeqEnd,
  );
  // Summary rows can cover a segment inside a turn. Once the selected rows are
  // validated against the requested turn, that turn's start must be at or
  // before the latest selected turn row. Accepted input rows may sit after
  // sourceSeqEnd, so the lifecycle lookup uses the widened context cutoff.
  const turnStartedRows = hasCurrentStartedRow
    ? []
    : listStoredTurnStartedRowsByTurnIdsUpToSequence(db, {
        threadId: thread.id,
        sequenceCutoff: contextSequenceCutoff,
        turnIds: [options.turnId],
      });
  if (!hasCurrentStartedRow && turnStartedRows.length === 0) {
    throw new ApiError(
      400,
      "invalid_request",
      `Timeline turn summary details range ${options.sourceSeqStart}-${options.sourceSeqEnd} cannot resolve turn/started for ${options.turnId}`,
    );
  }
  const sourceRange = resolveTurnSummaryDetailsSourceRange({
    exactEventRows: exactEventRowsForRequestedTurn.rows,
    fallbackRange: {
      sourceSeqEnd: options.sourceSeqEnd,
      sourceSeqStart: options.sourceSeqStart,
      turnId: options.turnId,
    },
    useExactEventRowBounds: exactEventRowsForRequestedTurn.removedRows,
  });
  const children = buildThreadTimelineTurnDetailsFromEvents({
    events: [...turnStartedRows, ...eventRows].map((row) =>
      toThreadEventWithMeta(row),
    ),
    options: {
      includeProviderUnhandledOperations,
      sourceSeqEnd: sourceRange.sourceSeqEnd,
      sourceSeqStart: sourceRange.sourceSeqStart,
      threadStatus: thread.status,
      workspaceRoot: resolveThreadWorkspaceRoot(db, thread),
    },
  });

  if (children.kind !== "missing-match") {
    return {
      rows: children.rows,
    };
  }

  throw new Error(
    `Timeline turn summary details could not match range ${options.sourceSeqStart}-${options.sourceSeqEnd}`,
  );
}
