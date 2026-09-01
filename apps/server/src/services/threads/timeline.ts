import {
  buildThreadTimelineFromEvents,
  THREAD_TIMELINE_EXCLUDED_EVENT_TYPES,
  buildThreadTimelineTurnDetailPageFromEvents,
  buildThreadTimelineTurnDetailsFromEvents,
  compactThreadTimelineSummaryEvents,
  type AcceptedClientRequestContext,
  type ThreadEventWithMeta,
} from "@bb/thread-view";
import type {
  ClientTurnRequestId,
  ProviderComposerCommand,
  Thread,
  ThreadEventItemType,
} from "@bb/domain";
import type {
  ThreadConversationOutlineItem,
  ThreadConversationOutlineResponse,
  TimelineConversationAttachments,
  ThreadConversationOutlineAttachmentSummary,
  TimelineTurnDetailsResponse,
  ThreadTimelineResponse,
  TimelineTurnSummaryDetailsResponse,
} from "@bb/server-contract";
import { threadConversationOutlineItemSchema } from "@bb/server-contract";
import {
  findStoredTimelineWindowByteBudgetFloor,
  readStoredTimelineWindowForwardPage,
  getStoredEventRowsByParentToolCallIdsDataBytes,
  getEnvironment,
  getLatestStoredEventTip,
  getThreadConversationOutlineRecord,
  listContextWindowUsageRows,
  listStoredThreadTimelineEventRows,
  listStoredConversationOutlineEventRows,
  listStoredClientTurnRequestIdsInRange,
  listStoredEventRowsByParentToolCallIds,
  listItemEventSpansByItems,
  listStoredBufferedTextDeltaRowsByItems,
  listStoredItemLifecycleRowsByItems,
  listLatestBackgroundTaskStateRowsByItemIds,
  listStoredTimelineWindowEventRows,
  listStoredDelegatingItemRowsByItemIds,
  listStoredTurnInputAcceptedRowsByClientRequestIds,
  listStoredTurnRejectedRowsByClientRequestIds,
  listStoredTurnCompletedRowsByTurnIds,
  listStoredTurnStartedRowsByTurnIdsUpToSequence,
  scopedItemRefKey,
  upsertThreadConversationOutlineRecord,
} from "@bb/db";
import type {
  DbConnection,
  InlineOutputCharLimit,
  ScopedItemRef,
  StoredEventRow,
} from "@bb/db";
import { z } from "zod";
import { ApiError } from "../../errors.js";
import { roundDurationMs } from "../lib/duration.js";
import { runEventLoopWorkSync } from "../system/event-loop-work.js";
import { parseStoredEvent } from "./thread-data.js";
import {
  paginateTimelineRows,
  type ThreadTimelinePageKind,
  type ThreadTimelinePageRequest,
} from "./timeline-pagination.js";
import {
  buildTimelineProjectionCacheKey,
  getCachedTimelineProjection,
  setCachedTimelineProjection,
} from "./timeline-projection-cache.js";
import { DEFAULT_MAX_INLINE_OUTPUT_CHARS } from "./timeline-output-truncation.js";

interface TimelineTurnSummarySelection {
  sourceSeqEnd: number;
  sourceSeqStart: number;
  turnId: string;
}

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
  turnId: string;
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
  includeProviderUnhandledOperations: boolean;
  includeNestedRows?: boolean;
  maxInlineOutputChars: InlineOutputCharLimit;
  maxSeq: number;
  page: ThreadTimelinePageRequest;
  summaryOnly?: boolean;
  providerDisplayName?: string;
  planCommand?: ProviderComposerCommand | null;
}

interface BuildTimelineTurnSummaryDetailsOptions extends TimelineTurnSummarySelection {
  includeProviderUnhandledOperations: boolean;
  providerDisplayName?: string;
}

interface BuildTimelineTurnDetailsPageOptions extends TimelineTurnSummarySelection {
  cursor?: string;
  includeProviderUnhandledOperations: boolean;
  providerDisplayName?: string;
}

interface BuildTimelineTurnSummaryDetailsRangeOptions extends BuildTimelineTurnSummaryDetailsOptions {
  preloadedEventRows?: readonly StoredEventRow[];
  resourceKind: "exact-range" | "page";
}

export const THREAD_TIMELINE_DEFAULT_SEGMENT_LIMIT = 20;

export const THREAD_TIMELINE_SEGMENT_LIMIT_MAX = 100;

export const THREAD_TIMELINE_EVENT_DATA_BYTE_LIMIT = 4 * 1024 * 1024;

type ThreadTimelineBuildProfileStage =
  | "event-query"
  | "accepted-client-request-context-query"
  | "event-json-decode"
  | "summary-compaction"
  | "context-window-query"
  | "context-window-json-decode"
  | "thread-view-projection"
  | "pagination-segmentation";

interface ThreadTimelineBuildProfileStageTiming {
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
  responseRowCount: number;
  returnedSegmentCount: number;
  segmentLimit: number;
  stageTimings: ThreadTimelineBuildProfileStageTiming[];
  totalDurationMs: number;
}

interface BuildThreadTimelineInternalResult {
  profile: ThreadTimelineBuildProfile | null;
  response: ThreadTimelineResponse;
}

interface ThreadTimelineBuildProfileAccumulator {
  compactedEventCount: number;
  contextWindowEventDataBytes: number;
  contextWindowEventRowCount: number;
  decodedEventCount: number;
  eventDataBytes: number;
  eventRowCount: number;
  projectedRowCount: number;
  responseRowCount: number;
  returnedSegmentCount: number;
  stageTimings: ThreadTimelineBuildProfileStageTiming[];
}

interface BuildThreadTimelineInternalOptions extends BuildThreadTimelineOptions {
  includeProfile: boolean;
}

interface TimelineWindowRowsArgs {
  rows: readonly StoredEventRow[];
  threadId: string;
}

interface TimelineWindowParentedRowsArgs extends TimelineWindowRowsArgs {
  maxInlineOutputChars: InlineOutputCharLimit;
  outOfBoundsChildDataByteLimit?: number;
  sequenceBounds: {
    beforeSequence: number | undefined;
    sequenceStart: number;
  } | null;
}

interface TimelineWindowParentedRowsResult {
  contextOnlyToolCallIds: Set<string>;
  rows: StoredEventRow[];
}

interface SelectClientRequestContextRowsArgs {
  rows: readonly StoredEventRow[];
  threadId: string;
}

interface SelectedClientRequestContextRows {
  acceptedRows: StoredEventRow[];
  rejectedRows: StoredEventRow[];
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

function parseRejectedClientRequestId(
  row: StoredEventRow,
): ClientTurnRequestId {
  const event = parseStoredEvent(row);
  if (event.type !== "client/turn/rejected") {
    throw new Error(`Expected client/turn/rejected row ${row.id}`);
  }
  return event.requestId;
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

function collectSteerClientRequestIdsNeedingContext(
  rows: readonly StoredEventRow[],
): ClientTurnRequestId[] {
  const terminalClientRequestIds = new Set<ClientTurnRequestId>();
  const clientRequestIds = new Set<ClientTurnRequestId>();
  for (const row of rows) {
    if (row.type === "turn/input/accepted") {
      const clientRequestId = parseAcceptedInputClientRequestId(row);
      terminalClientRequestIds.add(clientRequestId);
      clientRequestIds.delete(clientRequestId);
      continue;
    }
    if (row.type === "client/turn/rejected") {
      const clientRequestId = parseRejectedClientRequestId(row);
      terminalClientRequestIds.add(clientRequestId);
      clientRequestIds.delete(clientRequestId);
      continue;
    }
    const clientRequestId = tryReadSteerClientTurnRequestedRequestId(row);
    if (
      clientRequestId === null ||
      terminalClientRequestIds.has(clientRequestId)
    ) {
      continue;
    }
    clientRequestIds.add(clientRequestId);
  }
  return [...clientRequestIds];
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

function getStoredEventParentToolCallId(
  row: StoredEventRow,
): string | undefined {
  return row.parentToolCallId !== null && row.parentToolCallId.length > 0
    ? row.parentToolCallId
    : undefined;
}

function isStoredDelegatingItemRow(row: StoredEventRow): boolean {
  return (
    (row.itemKind === "toolCall" || row.itemKind === "delegation") &&
    row.itemId !== null
  );
}

function collectStoredDelegatingItemIds(
  rows: readonly StoredEventRow[],
): string[] {
  const itemIds = new Set<string>();
  for (const row of rows) {
    if (!isStoredDelegatingItemRow(row) || row.itemId === null) {
      continue;
    }
    itemIds.add(row.itemId);
  }
  return [...itemIds];
}

function collectStoredParentToolCallIds(
  rows: readonly StoredEventRow[],
): string[] {
  const parentToolCallIds = new Set<string>();
  for (const row of rows) {
    const parentToolCallId = getStoredEventParentToolCallId(row);
    if (parentToolCallId) {
      parentToolCallIds.add(parentToolCallId);
    }
  }
  return [...parentToolCallIds];
}

function ensureTimelineWindowParentedRows(
  db: DbConnection,
  args: TimelineWindowParentedRowsArgs,
): TimelineWindowParentedRowsResult {
  let rows = [...args.rows];
  const rowIds = new Set(rows.map((row) => row.id));
  const visibleToolCallIds = new Set(collectStoredDelegatingItemIds(rows));
  const fetchedChildToolCallIds = new Set<string>();
  let outOfBoundsChildDataBytesRemaining = args.outOfBoundsChildDataByteLimit;

  while (true) {
    const toolCallIdsToFetch = [...visibleToolCallIds].filter(
      (toolCallId) => !fetchedChildToolCallIds.has(toolCallId),
    );
    if (toolCallIdsToFetch.length === 0) {
      break;
    }
    for (const toolCallId of toolCallIdsToFetch) {
      fetchedChildToolCallIds.add(toolCallId);
    }

    let childSequenceBounds = args.sequenceBounds;
    if (outOfBoundsChildDataBytesRemaining !== undefined) {
      const unboundedChildDataBytes =
        getStoredEventRowsByParentToolCallIdsDataBytes(db, {
          excludedTypes: THREAD_TIMELINE_EXCLUDED_EVENT_TYPES,
          maxInlineOutputChars: args.maxInlineOutputChars,
          parentToolCallIds: toolCallIdsToFetch,
          threadId: args.threadId,
        });
      if (unboundedChildDataBytes <= outOfBoundsChildDataBytesRemaining) {
        childSequenceBounds = null;
        outOfBoundsChildDataBytesRemaining -= unboundedChildDataBytes;
      }
    }
    const childRows = listStoredEventRowsByParentToolCallIds(db, {
      beforeSequence: childSequenceBounds?.beforeSequence,
      excludedTypes: THREAD_TIMELINE_EXCLUDED_EVENT_TYPES,
      maxInlineOutputChars: args.maxInlineOutputChars,
      parentToolCallIds: toolCallIdsToFetch,
      sequenceStart: childSequenceBounds?.sequenceStart,
      threadId: args.threadId,
    });
    const newChildRows = childRows.filter((row) => !rowIds.has(row.id));
    if (newChildRows.length === 0) {
      continue;
    }
    for (const row of newChildRows) {
      rowIds.add(row.id);
      if (isStoredDelegatingItemRow(row) && row.itemId !== null) {
        visibleToolCallIds.add(row.itemId);
      }
    }
    rows = mergeStoredEventRowsById([...rows, ...newChildRows]);
  }

  const contextOnlyToolCallIds = new Set<string>();
  const missingParentToolCallIds = collectStoredParentToolCallIds(rows).filter(
    (parentToolCallId) => !visibleToolCallIds.has(parentToolCallId),
  );
  const parentRows = listStoredDelegatingItemRowsByItemIds(db, {
    itemIds: missingParentToolCallIds,
    maxInlineOutputChars: args.maxInlineOutputChars,
    threadId: args.threadId,
  });
  const newParentRows = parentRows.filter((row) => !rowIds.has(row.id));
  for (const row of parentRows) {
    if (row.itemId !== null && !visibleToolCallIds.has(row.itemId)) {
      contextOnlyToolCallIds.add(row.itemId);
    }
  }

  return {
    contextOnlyToolCallIds,
    rows:
      newParentRows.length > 0
        ? mergeStoredEventRowsById([...newParentRows, ...rows])
        : rows,
  };
}

function minSequenceOfClientRequests(
  rows: readonly StoredEventRow[],
  clientRequestIds: ReadonlySet<ClientTurnRequestId>,
): number {
  let minSequence = Number.POSITIVE_INFINITY;
  for (const row of rows) {
    if (row.type !== "client/turn/requested") {
      continue;
    }
    const requestId = tryReadClientTurnRequestedRequestId(row);
    if (requestId !== null && clientRequestIds.has(requestId)) {
      minSequence = Math.min(minSequence, row.sequence);
    }
  }
  return Number.isFinite(minSequence) ? minSequence : 0;
}

function selectClientRequestContextRows(
  db: DbConnection,
  args: SelectClientRequestContextRowsArgs,
): SelectedClientRequestContextRows {
  const clientRequestIds = collectSteerClientRequestIdsNeedingContext(
    args.rows,
  );
  if (clientRequestIds.length === 0) {
    return { acceptedRows: [], rejectedRows: [] };
  }
  const afterSequence = minSequenceOfClientRequests(
    args.rows,
    new Set(clientRequestIds),
  );
  return {
    acceptedRows: listStoredTurnInputAcceptedRowsByClientRequestIds(db, {
      afterSequence,
      clientRequestIds,
      threadId: args.threadId,
    }),
    rejectedRows: listStoredTurnRejectedRowsByClientRequestIds(db, {
      afterSequence,
      clientRequestIds,
      threadId: args.threadId,
    }),
  };
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
    const clientRequestId = parseAcceptedInputClientRequestId(row);
    if (row.turnId === args.turnId) {
      requestedTurnRows.push(row);
      continue;
    }
    acceptedClientRequestIdsForOtherTurns.add(clientRequestId);
  }

  return {
    acceptedClientRequestIdsForOtherTurns,
    requestedTurnRows,
  };
}

const CROSS_TURN_TOOL_ITEM_KINDS: ReadonlySet<ThreadEventItemType> = new Set([
  "commandExecution",
  "toolCall",
  "webSearch",
  "webFetch",
  "imageView",
  "fileRead",
  "search",
  "planSteps",
  "delegation",
  "extension",
]);

function filterExactEventRowsForRequestedTurn(
  args: FilterExactEventRowsForRequestedTurnArgs,
): FilterExactEventRowsForRequestedTurnResult {
  const rows: StoredEventRow[] = [];
  let removedRows = false;
  const openToolCallIds = new Set<string>();
  for (const row of args.exactEventRows) {
    if (row.scopeKind === "turn" && row.turnId !== args.turnId) {
      const continuesOpenToolCall =
        row.itemId !== null &&
        row.type.startsWith("item/") &&
        openToolCallIds.has(row.itemId);
      if (!continuesOpenToolCall) {
        removedRows = true;
        continue;
      }
    } else if (
      row.type === "item/started" &&
      row.itemId !== null &&
      row.itemKind !== null &&
      CROSS_TURN_TOOL_ITEM_KINDS.has(row.itemKind)
    ) {
      openToolCallIds.add(row.itemId);
    }
    if (row.type === "item/completed" && row.itemId !== null) {
      openToolCallIds.delete(row.itemId);
    }

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

/**
 * Reads every timeline-relevant event for the thread. The summary timeline
 * always projects the full thread and pages by slicing the projected rows,
 * so the read needs no window bounds and no context recovery: turn
 * lifecycle, background-task state, head state, and delegation subtrees are
 * all inherently present.
 */
function selectTimelineEventRows(
  db: DbConnection,
  thread: Thread,
  maxInlineOutputChars: InlineOutputCharLimit,
): StoredEventRow[] {
  return listStoredThreadTimelineEventRows(db, {
    threadId: thread.id,
    excludedTypes: THREAD_TIMELINE_EXCLUDED_EVENT_TYPES,
    maxInlineOutputChars,
  });
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

function storedEventRowItemRef(row: StoredEventRow): ScopedItemRef {
  return {
    itemId: row.itemId ?? "",
    scopeKind: row.scopeKind,
    turnId: row.turnId,
  };
}

interface SequenceWindowItemRowsArgs extends TimelineWindowRowsArgs {
  beforeSequence: number | undefined;
  maxInlineOutputChars: InlineOutputCharLimit;
  sequenceStart: number;
}

function rowIdentifiesBufferedTextItem(row: StoredEventRow): boolean {
  if (row.type === "item/started") {
    return (
      row.itemKind === "agentMessage" ||
      row.itemKind === "plan" ||
      row.itemKind === "reasoning"
    );
  }
  return (
    row.type === "item/agentMessage/delta" ||
    row.type === "item/plan/delta" ||
    row.type === "item/reasoning/summaryTextDelta" ||
    row.type === "item/reasoning/textDelta"
  );
}

function ensureSequenceWindowWholeItemRows(
  db: DbConnection,
  args: SequenceWindowItemRowsArgs,
): StoredEventRow[] {
  const windowItems = new Map<string, ScopedItemRef>();
  for (const row of args.rows) {
    if (
      row.itemId !== null &&
      row.itemKind !== "backgroundTask" &&
      row.sequence >= args.sequenceStart
    ) {
      const ref = storedEventRowItemRef(row);
      windowItems.set(scopedItemRefKey(ref), ref);
    }
  }
  if (windowItems.size === 0) {
    return [...args.rows];
  }

  const spans = listItemEventSpansByItems(db, {
    items: [...windowItems.values()],
    threadId: args.threadId,
  });
  const itemKeysOwnedByNewerWindow = new Set<string>();
  const itemsStartingBeforeWindow = new Map<string, ScopedItemRef>();
  for (const span of spans) {
    const key = scopedItemRefKey(span);
    if (
      args.beforeSequence !== undefined &&
      span.maxSequence >= args.beforeSequence
    ) {
      itemKeysOwnedByNewerWindow.add(key);
      continue;
    }
    if (span.minSequence < args.sequenceStart) {
      itemsStartingBeforeWindow.set(key, {
        itemId: span.itemId,
        scopeKind: span.scopeKind,
        turnId: span.turnId,
      });
    }
  }

  const rows = args.rows.filter(
    (row) =>
      row.itemId === null ||
      !itemKeysOwnedByNewerWindow.has(
        scopedItemRefKey(storedEventRowItemRef(row)),
      ),
  );
  if (itemsStartingBeforeWindow.size === 0) {
    return rows;
  }

  const backfillRows = listStoredItemLifecycleRowsByItems(db, {
    items: [...itemsStartingBeforeWindow.values()],
    maxInlineOutputChars: args.maxInlineOutputChars,
    threadId: args.threadId,
  }).filter((row) => row.sequence < args.sequenceStart);

  const completedItemKeys = new Set<string>();
  for (const row of [...rows, ...backfillRows]) {
    if (row.type === "item/completed" && row.itemId !== null) {
      completedItemKeys.add(scopedItemRefKey(storedEventRowItemRef(row)));
    }
  }
  const bufferedTextItems = new Map<string, ScopedItemRef>();
  for (const row of [...backfillRows, ...rows]) {
    if (row.itemId === null || !rowIdentifiesBufferedTextItem(row)) {
      continue;
    }
    const ref = storedEventRowItemRef(row);
    const key = scopedItemRefKey(ref);
    if (!completedItemKeys.has(key) && itemsStartingBeforeWindow.has(key)) {
      bufferedTextItems.set(key, ref);
    }
  }
  const bufferedTextRows = listStoredBufferedTextDeltaRowsByItems(db, {
    beforeSequence: args.sequenceStart,
    items: [...bufferedTextItems.values()],
    threadId: args.threadId,
  });
  const prefixRows = [...backfillRows, ...bufferedTextRows];
  return prefixRows.length === 0
    ? rows
    : mergeStoredEventRowsById([...prefixRows, ...rows]);
}

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

function byteLengthOfStoredEventRows(rows: readonly StoredEventRow[]): number {
  let byteLength = 0;
  for (const row of rows) {
    byteLength += Buffer.byteLength(row.data, "utf8");
  }
  return byteLength;
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
    responseRowCount: 0,
    returnedSegmentCount: 0,
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
  options: BuildThreadTimelineInternalOptions,
): ThreadTimelineBuildProfile {
  return {
    compactedEventCount: accumulator.compactedEventCount,
    contextWindowEventDataBytes: accumulator.contextWindowEventDataBytes,
    contextWindowEventRowCount: accumulator.contextWindowEventRowCount,
    decodedEventCount: accumulator.decodedEventCount,
    eventDataBytes: accumulator.eventDataBytes,
    eventRowCount: accumulator.eventRowCount,
    pageKind: options.page.kind,
    projectedRowCount: accumulator.projectedRowCount,
    responseRowCount: accumulator.responseRowCount,
    returnedSegmentCount: accumulator.returnedSegmentCount,
    segmentLimit: options.page.segmentLimit,
    stageTimings: accumulator.stageTimings,
    totalDurationMs: roundDurationMs(
      accumulator.stageTimings.reduce(
        (total, timing) => total + timing.durationMs,
        0,
      ),
    ),
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
  const includeProviderUnhandledOperations =
    options.includeProviderUnhandledOperations;
  const workspaceRoot = resolveThreadWorkspaceRoot(db, thread);
  const threadName = thread.title ?? thread.titleFallback ?? "";
  const tip = getLatestStoredEventTip(db, { threadId: thread.id });
  const cacheKey =
    tip === null
      ? null
      : buildTimelineProjectionCacheKey({
          includeNestedRows,
          includeProviderUnhandledOperations,
          maxInlineOutputChars: options.maxInlineOutputChars,
          planCommandKey: JSON.stringify(options.planCommand ?? null),
          providerDisplayName: options.providerDisplayName,
          threadId: thread.id,
          threadName,
          threadStatus: thread.status,
          tipEventCount: tip.eventCount,
          tipEventId: tip.id,
          workspaceRoot,
        });
  const cached =
    cacheKey === null ? undefined : getCachedTimelineProjection(cacheKey);
  let timeline;
  if (cached !== undefined) {
    timeline = cached.timeline;
    if (profile) {
      profile.eventDataBytes = cached.eventDataBytes;
      profile.eventRowCount = cached.eventRowCount;
      profile.decodedEventCount = cached.eventRowCount;
      profile.projectedRowCount = timeline.rows.length;
    }
  } else {
    const rawEventRows = measureThreadTimelineStage(
      profile,
      "event-query",
      () => selectTimelineEventRows(db, thread, options.maxInlineOutputChars),
    );
    const eventDataBytes = byteLengthOfStoredEventRows(rawEventRows);
    if (profile) {
      profile.eventDataBytes = eventDataBytes;
      profile.eventRowCount = rawEventRows.length;
    }
    const acceptedClientRequestContextRows = measureThreadTimelineStage(
      profile,
      "accepted-client-request-context-query",
      () =>
        selectClientRequestContextRows(db, {
          rows: rawEventRows,
          threadId: thread.id,
        }),
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
    const contextWindowEvents = measureThreadTimelineStage(
      profile,
      "context-window-json-decode",
      () => contextWindowUsageRows.map((row) => toThreadEventWithMeta(row)),
    );
    const acceptedClientRequestContext: AcceptedClientRequestContext = {
      acceptedClientRequestEvents:
        acceptedClientRequestContextRows.acceptedRows.map((row) =>
          toThreadEventWithMeta(row),
        ),
      rejectedClientRequestEvents:
        acceptedClientRequestContextRows.rejectedRows.map((row) =>
          toThreadEventWithMeta(row),
        ),
    };
    // Always project as the latest page: rows are isLatestPage-independent
    // (the recombination gate proves it) and head state is nulled per page
    // kind when the response is assembled, so one cached projection serves
    // every page of the thread.
    timeline = measureThreadTimelineStage(
      profile,
      "thread-view-projection",
      () =>
        buildThreadTimelineFromEvents({
          acceptedClientRequestContext,
          contextWindowEvents,
          events: decodedEvents,
          options: {
            includeProviderUnhandledOperations,
            isLatestPage: true,
            providerDisplayName: options.providerDisplayName,
            planCommand: options.planCommand,
            threadStatus: thread.status,
            threadName,
            workspaceRoot,
            includeNestedRows,
            providerId: thread.providerId,
            turnMessageDetail: includeNestedRows ? "full" : "summary",
          },
        }),
    );
    if (profile) {
      profile.projectedRowCount = timeline.rows.length;
    }
    if (cacheKey !== null) {
      setCachedTimelineProjection(cacheKey, {
        eventDataBytes,
        eventRowCount: rawEventRows.length,
        timeline,
      });
    }
  }
  const paginatedTimeline = measureThreadTimelineStage(
    profile,
    "pagination-segmentation",
    () =>
      paginateTimelineRows({
        page: options.page,
        rows: timeline.rows,
      }),
  );
  if (profile) {
    profile.responseRowCount = paginatedTimeline.rows.length;
    profile.returnedSegmentCount = paginatedTimeline.returnedSegmentCount;
  }

  const response: ThreadTimelineResponse = {
    maxSeq: options.maxSeq,
    rows: options.summaryOnly ? [] : paginatedTimeline.rows,
    activePromptMode:
      options.page.kind === "latest" ? timeline.activePromptMode : null,
    activeThinking:
      options.page.kind === "latest" ? timeline.activeThinking : null,
    activeWorkflows:
      options.page.kind === "latest" ? timeline.activeWorkflows : [],
    activeBackgroundCommands:
      options.page.kind === "latest" ? timeline.activeBackgroundCommands : [],
    pendingTodos: options.page.kind === "latest" ? timeline.pendingTodos : null,
    goal: options.page.kind === "latest" ? timeline.goal : null,
    modelFallback:
      options.page.kind === "latest" ? timeline.modelFallback : null,
    contextWindowUsage:
      options.page.kind === "latest"
        ? (timeline.contextWindowUsage ?? undefined)
        : undefined,
    timelinePage: {
      kind: options.page.kind,
      segmentLimit: options.page.segmentLimit,
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
        : completeThreadTimelineBuildProfile(profile, options),
  };
}

export function buildThreadTimeline(
  db: DbConnection,
  thread: Thread,
  options: BuildThreadTimelineOptions,
): ThreadTimelineResponse {
  return runEventLoopWorkSync(
    `timeline-build ${thread.id}`,
    () =>
      buildThreadTimelineInternal(db, thread, {
        ...options,
        includeProfile: false,
      }).response,
  );
}

export function buildThreadTimelineWithProfile(
  db: DbConnection,
  thread: Thread,
  options: BuildThreadTimelineOptions,
): { profile: ThreadTimelineBuildProfile; response: ThreadTimelineResponse } {
  return runEventLoopWorkSync(`timeline-build ${thread.id}`, () => {
    const result = buildThreadTimelineInternal(db, thread, {
      ...options,
      includeProfile: true,
    });
    if (result.profile === null) {
      throw new Error("Profiled timeline build returned no profile");
    }
    return { profile: result.profile, response: result.response };
  });
}

interface BuildThreadConversationOutlineOptions {
  maxSeq: number;
  providerDisplayName?: string;
}

interface LoadThreadConversationOutlineOptions extends BuildThreadConversationOutlineOptions {
  outlineSequence: number;
}

const CONVERSATION_OUTLINE_PREVIEW_MAX_LENGTH = 200;
const CONVERSATION_OUTLINE_PROJECTION_VERSION = 1;
const conversationOutlineItemsSchema =
  threadConversationOutlineItemSchema.array();

function toConversationOutlinePreview(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= CONVERSATION_OUTLINE_PREVIEW_MAX_LENGTH) {
    return normalized;
  }
  return normalized.slice(0, CONVERSATION_OUTLINE_PREVIEW_MAX_LENGTH).trimEnd();
}

function toConversationOutlineAttachmentSummary(
  attachments: TimelineConversationAttachments | null,
): ThreadConversationOutlineAttachmentSummary | null {
  if (!attachments) {
    return null;
  }
  const imageCount = attachments.webImages + attachments.localImages;
  const fileCount = attachments.localFiles;
  if (imageCount === 0 && fileCount === 0) {
    return null;
  }
  return { imageCount, fileCount };
}

export function buildThreadConversationOutline(
  db: DbConnection,
  thread: Thread,
  options: BuildThreadConversationOutlineOptions,
): ThreadConversationOutlineResponse {
  return runEventLoopWorkSync(`conversation-outline ${thread.id}`, () => {
    const rawEventRows = listStoredConversationOutlineEventRows(db, {
      threadId: thread.id,
    });
    const decodedRawEvents = rawEventRows.map((row) =>
      toThreadEventWithMeta(row),
    );
    const decodedEvents = compactThreadTimelineSummaryEvents(decodedRawEvents);
    const clientRequestContextRows = selectClientRequestContextRows(db, {
      rows: rawEventRows,
      threadId: thread.id,
    });
    const acceptedClientRequestContext: AcceptedClientRequestContext = {
      acceptedClientRequestEvents: clientRequestContextRows.acceptedRows.map(
        (row) => toThreadEventWithMeta(row),
      ),
      rejectedClientRequestEvents: clientRequestContextRows.rejectedRows.map(
        (row) => toThreadEventWithMeta(row),
      ),
    };
    const timeline = buildThreadTimelineFromEvents({
      acceptedClientRequestContext,
      contextWindowEvents: [],
      events: decodedEvents,
      options: {
        includeNestedRows: false,
        includeProviderUnhandledOperations: false,
        isLatestPage: true,
        providerDisplayName: options.providerDisplayName,
        providerId: thread.providerId,
        threadName: thread.title ?? thread.titleFallback ?? "",
        threadStatus: thread.status,
        turnMessageDetail: "summary",
        workspaceRoot: resolveThreadWorkspaceRoot(db, thread),
      },
    });
    const items: ThreadConversationOutlineItem[] = [];
    for (const row of timeline.rows) {
      if (row.kind !== "conversation") {
        continue;
      }
      items.push({
        id: row.id,
        role: row.role,
        preview: toConversationOutlinePreview(row.text),
        attachmentSummary: toConversationOutlineAttachmentSummary(
          row.attachments,
        ),
      });
    }
    return { items, maxSeq: options.maxSeq };
  });
}

export function buildThreadConversationOutlineProjectionKey(
  thread: Thread,
  outlineSequence: number,
  providerDisplayName: string | undefined,
): string {
  return JSON.stringify([
    CONVERSATION_OUTLINE_PROJECTION_VERSION,
    outlineSequence,
    thread.providerId,
    providerDisplayName ?? null,
    thread.status,
    thread.title,
    thread.titleFallback,
  ]);
}

function parseThreadConversationOutlineItems(
  itemsJson: string,
): ThreadConversationOutlineItem[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(itemsJson);
  } catch {
    return null;
  }
  const result = conversationOutlineItemsSchema.safeParse(parsed);
  return result.success ? result.data : null;
}

function shouldMaterializeThreadConversationOutline(thread: Thread): boolean {
  return thread.status === "idle" || thread.status === "error";
}

export function loadThreadConversationOutline(
  db: DbConnection,
  thread: Thread,
  options: LoadThreadConversationOutlineOptions,
): ThreadConversationOutlineResponse {
  const projectionKey = buildThreadConversationOutlineProjectionKey(
    thread,
    options.outlineSequence,
    options.providerDisplayName,
  );
  const stored = getThreadConversationOutlineRecord(db, thread.id);
  if (stored?.projectionKey === projectionKey) {
    const items = parseThreadConversationOutlineItems(stored.itemsJson);
    if (items !== null) {
      return { items, maxSeq: options.maxSeq };
    }
  }

  const response = buildThreadConversationOutline(db, thread, options);
  if (shouldMaterializeThreadConversationOutline(thread)) {
    upsertThreadConversationOutlineRecord(db, {
      itemsJson: JSON.stringify(response.items),
      projectionKey,
      threadId: thread.id,
    });
  }
  return response;
}

function buildTimelineTurnSummaryDetailsRange(
  db: DbConnection,
  thread: Thread,
  options: BuildTimelineTurnSummaryDetailsRangeOptions,
): TimelineTurnSummaryDetailsResponse {
  if (options.sourceSeqStart > options.sourceSeqEnd) {
    throw new ApiError(
      400,
      "invalid_request",
      "sourceSeqStart must be less than or equal to sourceSeqEnd",
    );
  }

  const includeProviderUnhandledOperations =
    options.includeProviderUnhandledOperations;
  const detailsWindow = {
    beforeSequence: options.sourceSeqEnd + 1,
    excludedTypes: THREAD_TIMELINE_EXCLUDED_EVENT_TYPES,
    sequenceStart: options.sourceSeqStart,
    threadId: thread.id,
  };
  let detailsInlineOutputLimit: InlineOutputCharLimit =
    options.preloadedEventRows === undefined
      ? null
      : DEFAULT_MAX_INLINE_OUTPUT_CHARS;
  let exactEventRows: readonly StoredEventRow[];
  if (options.preloadedEventRows !== undefined) {
    exactEventRows = options.preloadedEventRows;
  } else {
    const fullDetailsFloor = findStoredTimelineWindowByteBudgetFloor(db, {
      ...detailsWindow,
      maxDataBytes: THREAD_TIMELINE_EVENT_DATA_BYTE_LIMIT,
      maxInlineOutputChars: null,
    });
    if (fullDetailsFloor.kind !== "fits") {
      detailsInlineOutputLimit = DEFAULT_MAX_INLINE_OUTPUT_CHARS;
      const cappedDetailsFloor = findStoredTimelineWindowByteBudgetFloor(db, {
        ...detailsWindow,
        maxDataBytes: THREAD_TIMELINE_EVENT_DATA_BYTE_LIMIT,
        maxInlineOutputChars: detailsInlineOutputLimit,
      });
      if (cappedDetailsFloor.kind !== "fits") {
        throw new ApiError(
          413,
          "timeline_window_too_large",
          "Timeline turn details exceed the safe response limit",
        );
      }
    }
    exactEventRows = listStoredTimelineWindowEventRows(db, {
      ...detailsWindow,
      maxInlineOutputChars: detailsInlineOutputLimit,
    });
  }
  const clientRequestIds = listStoredClientTurnRequestIdsInRange(db, {
    threadId: thread.id,
    seqStart: options.sourceSeqStart,
    seqEnd: options.sourceSeqEnd,
  });
  const exactAcceptedInputRows = exactEventRows.filter(
    (row) => row.type === "turn/input/accepted",
  );
  const futureAcceptedInputRows =
    listStoredTurnInputAcceptedRowsByClientRequestIds(db, {
      threadId: thread.id,
      afterSequence: options.sourceSeqEnd,
      clientRequestIds,
    });
  const acceptedInputRowsByTurn = partitionAcceptedInputRowsByRequestedTurn({
    acceptedInputRows: [...exactAcceptedInputRows, ...futureAcceptedInputRows],
    turnId: options.turnId,
  });
  const exactEventRowsForRequestedTurn = filterExactEventRowsForRequestedTurn({
    acceptedClientRequestIdsForOtherTurns:
      acceptedInputRowsByTurn.acceptedClientRequestIdsForOtherTurns,
    exactEventRows,
    turnId: options.turnId,
  });
  const eventRows = mergeStoredEventRowsById([
    ...exactEventRowsForRequestedTurn.rows,
    ...acceptedInputRowsByTurn.requestedTurnRows,
  ]);

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
  const requestedTurnStartedRows = hasCurrentStartedRow
    ? []
    : listStoredTurnStartedRowsByTurnIdsUpToSequence(db, {
        threadId: thread.id,
        sequenceCutoff: contextSequenceCutoff,
        turnIds: [options.turnId],
      });
  if (!hasCurrentStartedRow && requestedTurnStartedRows.length === 0) {
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
  const wholeItemEventRows = ensureSequenceWindowWholeItemRows(db, {
    beforeSequence: detailsWindow.beforeSequence,
    maxInlineOutputChars: detailsInlineOutputLimit,
    rows: mergeStoredEventRowsById([...requestedTurnStartedRows, ...eventRows]),
    sequenceStart: detailsWindow.sequenceStart,
    threadId: thread.id,
  });
  const detailsEventDataBytes = byteLengthOfStoredEventRows(wholeItemEventRows);
  const eventRowsWithParentedChildren = ensureTimelineWindowParentedRows(db, {
    maxInlineOutputChars: detailsInlineOutputLimit,
    outOfBoundsChildDataByteLimit:
      THREAD_TIMELINE_EVENT_DATA_BYTE_LIMIT - detailsEventDataBytes,
    sequenceBounds: {
      beforeSequence: detailsWindow.beforeSequence,
      sequenceStart: detailsWindow.sequenceStart,
    },
    threadId: thread.id,
    rows: wholeItemEventRows,
  }).rows;
  const eventRowsWithTurnStarts = ensureTimelineWindowTurnStartedRows(db, {
    threadId: thread.id,
    rows: eventRowsWithParentedChildren,
  });
  const eventRowsWithBackgroundTaskState =
    ensureTimelineWindowBackgroundTaskStateRows(db, {
      threadId: thread.id,
      rows: eventRowsWithTurnStarts,
    });
  const projectionSourceSeqStart = eventRowsWithTurnStarts.reduce(
    (sourceSeqStart, row) =>
      row.type === "turn/started" && row.turnId === options.turnId
        ? Math.min(sourceSeqStart, row.sequence)
        : sourceSeqStart,
    sourceRange.sourceSeqStart,
  );
  const projectionArgs = {
    events: eventRowsWithBackgroundTaskState.map((row) =>
      toThreadEventWithMeta(row),
    ),
    options: {
      includeProviderUnhandledOperations,
      sourceSeqEnd: sourceRange.sourceSeqEnd,
      sourceSeqStart: projectionSourceSeqStart,
      providerDisplayName: options.providerDisplayName,
      threadStatus: thread.status,
      threadName: thread.title ?? thread.titleFallback ?? "",
      workspaceRoot: resolveThreadWorkspaceRoot(db, thread),
    },
  } satisfies Parameters<typeof buildThreadTimelineTurnDetailsFromEvents>[0];

  if (options.resourceKind === "page") {
    return {
      rows: buildThreadTimelineTurnDetailPageFromEvents(projectionArgs),
    };
  }

  const children = buildThreadTimelineTurnDetailsFromEvents(projectionArgs);

  if (children.kind !== "missing-match") {
    return {
      rows: children.rows,
    };
  }

  throw new Error(
    `Timeline turn summary details could not match range ${options.sourceSeqStart}-${options.sourceSeqEnd}`,
  );
}

export function buildTimelineTurnSummaryDetails(
  db: DbConnection,
  thread: Thread,
  options: BuildTimelineTurnSummaryDetailsOptions,
): TimelineTurnSummaryDetailsResponse {
  return buildTimelineTurnSummaryDetailsRange(db, thread, {
    ...options,
    resourceKind: "exact-range",
  });
}

interface TurnDetailsCursorPayload {
  sequenceStart: number;
  sourceSeqEnd: number;
  sourceSeqStart: number;
  threadId: string;
  turnId: string;
  version: 1;
}

const turnDetailsCursorPayloadSchema = z.object({
  sequenceStart: z.number().int().nonnegative(),
  sourceSeqEnd: z.number().int().nonnegative(),
  sourceSeqStart: z.number().int().nonnegative(),
  threadId: z.string().min(1),
  turnId: z.string().min(1),
  version: z.literal(1),
});

function encodeTurnDetailsCursor(payload: TurnDetailsCursorPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function parseTurnDetailsCursor(
  cursor: string,
  expected: Omit<TurnDetailsCursorPayload, "sequenceStart">,
): number {
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw new ApiError(400, "invalid_request", "Invalid turn details cursor");
  }
  const parsed = turnDetailsCursorPayloadSchema.safeParse(decoded);
  if (
    !parsed.success ||
    parsed.data.version !== expected.version ||
    parsed.data.threadId !== expected.threadId ||
    parsed.data.turnId !== expected.turnId ||
    parsed.data.sourceSeqStart !== expected.sourceSeqStart ||
    parsed.data.sourceSeqEnd !== expected.sourceSeqEnd
  ) {
    throw new ApiError(400, "invalid_request", "Invalid turn details cursor");
  }
  return parsed.data.sequenceStart;
}

function resolveCompletedTurnDetailBounds(
  db: DbConnection,
  threadId: string,
  selection: TimelineTurnSummarySelection,
): TimelineTurnSummarySelection {
  const started = listStoredTurnStartedRowsByTurnIdsUpToSequence(db, {
    sequenceCutoff: Number.MAX_SAFE_INTEGER,
    threadId,
    turnIds: [selection.turnId],
  })[0];
  const completed = listStoredTurnCompletedRowsByTurnIds(db, {
    threadId,
    turnIds: [selection.turnId],
  }).at(-1);
  if (!started || !completed || started.sequence > completed.sequence) {
    throw new ApiError(
      400,
      "invalid_request",
      `Cannot paginate details for incomplete turn ${selection.turnId}`,
    );
  }
  if (selection.sourceSeqStart > selection.sourceSeqEnd) {
    throw new ApiError(
      400,
      "invalid_request",
      `Invalid detail range for completed turn ${selection.turnId}`,
    );
  }
  return selection;
}

export function buildTimelineTurnDetailsPage(
  db: DbConnection,
  thread: Thread,
  options: BuildTimelineTurnDetailsPageOptions,
): TimelineTurnDetailsResponse {
  const bounds = resolveCompletedTurnDetailBounds(db, thread.id, options);
  const cursorIdentity = {
    sourceSeqEnd: bounds.sourceSeqEnd,
    sourceSeqStart: bounds.sourceSeqStart,
    threadId: thread.id,
    turnId: options.turnId,
    version: 1 as const,
  };
  const sourceSeqStart = options.cursor
    ? parseTurnDetailsCursor(options.cursor, cursorIdentity)
    : bounds.sourceSeqStart;
  if (
    sourceSeqStart < bounds.sourceSeqStart ||
    sourceSeqStart > bounds.sourceSeqEnd
  ) {
    throw new ApiError(400, "invalid_request", "Invalid turn details cursor");
  }

  if (options.cursor === undefined) {
    try {
      const details = buildTimelineTurnSummaryDetailsRange(db, thread, {
        includeProviderUnhandledOperations:
          options.includeProviderUnhandledOperations,
        providerDisplayName: options.providerDisplayName,
        resourceKind: "exact-range",
        ...bounds,
      });
      return { rows: details.rows, nextCursor: null };
    } catch (error) {
      if (
        !(error instanceof ApiError) ||
        error.body.code !== "timeline_window_too_large"
      ) {
        throw error;
      }
    }
  }

  const page = readStoredTimelineWindowForwardPage(db, {
    beforeSequence: bounds.sourceSeqEnd + 1,
    excludedTypes: THREAD_TIMELINE_EXCLUDED_EVENT_TYPES,
    maxDataBytes: THREAD_TIMELINE_EVENT_DATA_BYTE_LIMIT,
    maxInlineOutputChars: DEFAULT_MAX_INLINE_OUTPUT_CHARS,
    sequenceStart: sourceSeqStart,
    threadId: thread.id,
  });
  if (page.kind === "single-event-too-large") {
    throw new ApiError(
      413,
      "timeline_window_too_large",
      `Timeline turn detail event ${page.sequence} exceeds the safe response limit`,
    );
  }

  const sourceSeqEnd = page.nextSequenceStart
    ? page.nextSequenceStart - 1
    : bounds.sourceSeqEnd;
  const details = buildTimelineTurnSummaryDetailsRange(db, thread, {
    includeProviderUnhandledOperations:
      options.includeProviderUnhandledOperations,
    preloadedEventRows: page.rows,
    providerDisplayName: options.providerDisplayName,
    resourceKind: "page",
    sourceSeqEnd,
    sourceSeqStart,
    turnId: options.turnId,
  });
  return {
    rows: details.rows,
    nextCursor:
      page.nextSequenceStart === null
        ? null
        : encodeTurnDetailsCursor({
            ...cursorIdentity,
            sequenceStart: page.nextSequenceStart,
          }),
  };
}
