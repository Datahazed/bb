import {
  buildThreadTimelineFromEvents,
  THREAD_TIMELINE_EXCLUDED_EVENT_TYPES,
  buildThreadTimelineTurnDetailsFromEvents,
  compactThreadTimelineSummaryEvents,
  type AcceptedClientRequestContext,
  type ThreadEventWithMeta,
} from "@bb/thread-view";
import type { ClientTurnRequestId, Thread, ThreadEventType } from "@bb/domain";
import type {
  ThreadConversationOutlineItem,
  ThreadConversationOutlineResponse,
  TimelineConversationAttachments,
  TimelineDelegationChildInterval,
  TimelinePaginationCursor,
  TimelineRow,
  ThreadConversationOutlineAttachmentSummary,
  ThreadTimelineResponse,
  TimelineTurnSummaryDetailsResponse,
} from "@bb/server-contract";
import {
  getEnvironment,
  getStoredEventIdentityAtSequence,
  getTimelineSegmentAnchorAtSequence,
  hasStoredTurnEventInRange,
  listContextWindowUsageRows,
  listLatestGoalEventRowsForThread,
  listStoredClientTurnRequestIdsInRange,
  listStoredEventRowsByParentToolCallIds,
  listStoredDelegatedTurnDescendantRanges,
  listStoredDelegationChildTurnRanges,
  listStoredDelegationDescendantRanges,
  listStoredNonemptyDelegationChildTurnBucketIndexes,
  listStoredTurnDescendantRanges,
  listStoredItemLifecycleOwnerSequences,
  listStoredItemStartedRowsByItemIds,
  listStoredConversationOutlineEventRows,
  listLatestBackgroundTaskStateRowsByItemIds,
  listLatestOpenBackgroundTaskStateRowsForThread,
  listStoredTimelineWindowEventRowsDescending,
  listStoredToolCallRowsByItemIds,
  listStoredTurnInputAcceptedRowsByClientRequestIds,
  listStoredTurnStartedRowsByTurnIdsUpToSequence,
  listTimelineSegmentAnchorsDescending,
} from "@bb/db";
import type {
  BoundedStoredEventRowsResult,
  DbConnection,
  StoredEventIdentity,
  StoredEventRow,
} from "@bb/db";
import { ApiError } from "../../errors.js";
import { parseStoredEvent } from "./thread-data.js";
import {
  createTimelineEventWindowCursor,
  getTimelineEventWindowCursorPayload,
  hashTimelineTurnDetailsContextItemIds,
  paginateTimelineRows,
  type TimelineEventWindowCursorScope,
  type ThreadTimelinePageKind,
  type ThreadTimelinePageRequest,
} from "./timeline-pagination.js";
import { paginateTimelineTurnDetails } from "./timeline-turn-details-pagination.js";
import { collapseActiveTimelineWork } from "./timeline-active-work-window.js";

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
  /** Thread high-water event sequence this window reflects (echoed to clients). */
  maxSeq: number;
  page: ThreadTimelinePageRequest;
  /**
   * When true, the response is built without rows (rows: []). The tail-only
   * fields (`activeThinking`, `activeWorkflow`, `pendingTodos`,
   * `contextWindowUsage`) are still populated. Saves the row-generation work +
   * serialization bytes for
   * consumers that only need tail state (e.g. `bb status` / `bb thread show`).
   */
  summaryOnly?: boolean;
  providerDisplayName?: string;
}

interface BuildTimelineTurnSummaryDetailsOptions extends TimelineTurnSummarySelection {
  beforeCursor: TimelinePaginationCursor | null;
  contextItemIds: readonly string[];
  includeProviderUnhandledOperations: boolean;
  parentToolCallId?: string | null;
  providerDisplayName?: string;
}

interface BuildTimelineDelegationChildrenDetailsOptions extends TimelineTurnSummarySelection {
  beforeCursor: TimelinePaginationCursor | null;
  directTurnSourceSeqEnd: number;
  directTurnSourceSeqStart: number;
  parentToolCallId: string;
}

export const THREAD_TIMELINE_DEFAULT_SEGMENT_LIMIT = 20;
export const THREAD_TIMELINE_SEGMENT_LIMIT_MAX = 100;
export const THREAD_TIMELINE_DELEGATION_CHILD_PAGE_LIMIT = 50;

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
  enrichmentEventBytes: number;
  enrichmentEventRowCount: number;
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

interface BuildThreadTimelineInternalResult {
  profile: ThreadTimelineBuildProfile | null;
  response: ThreadTimelineResponse;
}

interface ThreadTimelineBuildProfileAccumulator {
  compactedEventCount: number;
  contextWindowEventDataBytes: number;
  contextWindowEventRowCount: number;
  decodedEventCount: number;
  enrichmentEventBytes: number;
  enrichmentEventRowCount: number;
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
  contextOnlyToolCallIds: Set<string>;
  exactEventSequenceEnd: number;
  exactEventSequenceStart: number;
  paginationPage: ThreadTimelinePageRequest;
  eventWindowOlderCursor: TimelinePaginationCursor | null;
  enrichmentBudget: TimelineParentedEnrichmentBudget;
  lifecycleOwnerSequenceEnd: number;
  lifecycleOwnerSequenceStart: number;
  responsePageKind: ThreadTimelinePageKind;
  rows: StoredEventRow[];
  strategy: ThreadTimelineEventSelectionStrategy;
}

interface TimelineWindowRowsArgs {
  budget?: TimelineParentedEnrichmentBudget;
  includeParentContext?: boolean;
  /** Restrict descendant expansion to lifecycle roots owned by this page. */
  parentedRootToolCallIds?: ReadonlySet<string>;
  rows: readonly StoredEventRow[];
  sequenceEnd?: number;
  sequenceStart?: number;
  threadId: string;
}

interface TimelineWindowParentedRowsResult {
  contextOnlyToolCallIds: Set<string>;
  rows: StoredEventRow[];
}

interface SelectAcceptedClientRequestContextRowsArgs {
  budget: TimelineParentedEnrichmentBudget;
  excludedRowIds?: readonly string[];
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function parseStoredEventData(row: StoredEventRow): Record<string, unknown> {
  return asRecord(JSON.parse(row.data)) ?? {};
}

function getStoredEventParentToolCallId(
  row: StoredEventRow,
): string | undefined {
  const data = parseStoredEventData(row);
  const item = asRecord(data.item);
  const itemParentToolCallId = item?.parentToolCallId;
  if (
    typeof itemParentToolCallId === "string" &&
    itemParentToolCallId.length > 0
  ) {
    return itemParentToolCallId;
  }

  const eventParentToolCallId = data.parentToolCallId;
  return typeof eventParentToolCallId === "string" &&
    eventParentToolCallId.length > 0
    ? eventParentToolCallId
    : undefined;
}

function collectStoredToolCallItemIds(
  rows: readonly StoredEventRow[],
): string[] {
  const itemIds = new Set<string>();
  for (const row of rows) {
    if (row.itemKind !== "toolCall" || row.itemId === null) {
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

export const THREAD_TIMELINE_PARENTED_ENRICHMENT_ROW_LIMIT = 100;
export const THREAD_TIMELINE_PARENTED_ENRICHMENT_BYTE_TARGET = 256_000;
const THREAD_TIMELINE_PARENTED_LIFECYCLE_ROW_RESERVE = 16;
const THREAD_TIMELINE_PARENTED_LIFECYCLE_BYTE_RESERVE = 32_000;

interface TimelineParentedEnrichmentBudget {
  remainingBytes: number;
  remainingRows: number;
}

function consumeTimelineEnrichmentResult(
  result: BoundedStoredEventRowsResult,
  budget: TimelineParentedEnrichmentBudget,
): StoredEventRow[] {
  if (
    result.rows.length > budget.remainingRows ||
    result.dataBytes > budget.remainingBytes
  ) {
    throw new Error("Bounded stored event query exceeded its requested budget");
  }
  budget.remainingRows -= result.rows.length;
  budget.remainingBytes -= result.dataBytes;
  return result.rows;
}

function ensureTimelineWindowParentedRows(
  db: DbConnection,
  args: TimelineWindowRowsArgs,
): TimelineWindowParentedRowsResult {
  let rows = [...args.rows];
  const rowIds = new Set(rows.map((row) => row.id));
  const enrichmentBudget =
    args.budget ??
    ({
      remainingBytes: THREAD_TIMELINE_PARENTED_ENRICHMENT_BYTE_TARGET,
      remainingRows: THREAD_TIMELINE_PARENTED_ENRICHMENT_ROW_LIMIT,
    } satisfies TimelineParentedEnrichmentBudget);
  const childBudget: TimelineParentedEnrichmentBudget = {
    remainingBytes: Math.max(
      0,
      enrichmentBudget.remainingBytes -
        THREAD_TIMELINE_PARENTED_LIFECYCLE_BYTE_RESERVE,
    ),
    remainingRows: Math.max(
      0,
      enrichmentBudget.remainingRows -
        THREAD_TIMELINE_PARENTED_LIFECYCLE_ROW_RESERVE,
    ),
  };
  const initialChildRows = childBudget.remainingRows;
  const initialChildBytes = childBudget.remainingBytes;
  const visibleToolCallIds = new Set(
    collectStoredToolCallItemIds(rows).filter(
      (itemId) =>
        args.parentedRootToolCallIds === undefined ||
        args.parentedRootToolCallIds.has(itemId),
    ),
  );

  const fetchedChildToolCallIds = new Set<string>();

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

    if (childBudget.remainingRows === 0 || childBudget.remainingBytes === 0) {
      continue;
    }

    const childResult = listStoredEventRowsByParentToolCallIds(db, {
      excludedRowIds: [...rowIds],
      excludedTypes: THREAD_TIMELINE_EXCLUDED_EVENT_TYPES,
      limit: childBudget.remainingRows,
      maxBytes: childBudget.remainingBytes,
      parentToolCallIds: toolCallIdsToFetch,
      sequenceEnd: args.sequenceEnd,
      sequenceStart: args.sequenceStart,
      threadId: args.threadId,
    });
    const newChildRows = consumeTimelineEnrichmentResult(
      childResult,
      childBudget,
    );
    if (newChildRows.length === 0) {
      continue;
    }
    for (const row of newChildRows) {
      rowIds.add(row.id);
      if (row.itemKind === "toolCall" && row.itemId !== null) {
        visibleToolCallIds.add(row.itemId);
      }
    }
    rows = mergeStoredEventRowsById([...rows, ...newChildRows]);
  }

  enrichmentBudget.remainingRows -=
    initialChildRows - childBudget.remainingRows;
  enrichmentBudget.remainingBytes -=
    initialChildBytes - childBudget.remainingBytes;

  // A newest-first descendant window can contain only output deltas for a
  // still-running child. Spend the reserved part of this same enrichment
  // budget on the child's lifecycle root so projection does not buffer those
  // deltas forever and drop the command from the timeline.
  rows = ensureTimelineWindowItemStartedRows(db, {
    budget: enrichmentBudget,
    rows,
    sequenceEnd: args.sequenceEnd,
    threadId: args.threadId,
  });

  if (args.includeParentContext === false) {
    return {
      contextOnlyToolCallIds: new Set(),
      rows,
    };
  }

  const contextOnlyToolCallIds = new Set<string>();
  const fetchedParentToolCallIds = new Set<string>();
  while (
    enrichmentBudget.remainingRows > 0 &&
    enrichmentBudget.remainingBytes > 0
  ) {
    const missingParentToolCallIds = collectStoredParentToolCallIds(
      rows,
    ).filter(
      (parentToolCallId) =>
        !visibleToolCallIds.has(parentToolCallId) &&
        !fetchedParentToolCallIds.has(parentToolCallId),
    );
    if (missingParentToolCallIds.length === 0) break;
    for (const parentToolCallId of missingParentToolCallIds) {
      fetchedParentToolCallIds.add(parentToolCallId);
    }
    const parentResult = listStoredToolCallRowsByItemIds(db, {
      excludedRowIds: [...rowIds],
      itemIds: missingParentToolCallIds,
      limit: enrichmentBudget.remainingRows,
      maxBytes: enrichmentBudget.remainingBytes,
      sequenceEnd: args.sequenceEnd,
      threadId: args.threadId,
    });
    const newParentRows = consumeTimelineEnrichmentResult(
      parentResult,
      enrichmentBudget,
    );
    if (newParentRows.length === 0) break;
    for (const row of newParentRows) {
      rowIds.add(row.id);
      if (row.itemId !== null && !visibleToolCallIds.has(row.itemId)) {
        contextOnlyToolCallIds.add(row.itemId);
      }
    }
    rows = mergeStoredEventRowsById([...newParentRows, ...rows]);
  }

  return {
    contextOnlyToolCallIds,
    rows,
  };
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

  if (args.budget.remainingRows === 0 || args.budget.remainingBytes === 0) {
    return [];
  }
  const result = listStoredTurnInputAcceptedRowsByClientRequestIds(db, {
    afterSequence: maxStoredEventSequence(args.rows),
    clientRequestIds,
    excludedRowIds: [
      ...args.rows.map((row) => row.id),
      ...(args.excludedRowIds ?? []),
    ],
    limit: args.budget.remainingRows,
    maxBytes: args.budget.remainingBytes,
    threadId: args.threadId,
  });
  return consumeTimelineEnrichmentResult(result, args.budget);
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

function filterExactEventRowsForRequestedTurn(
  args: FilterExactEventRowsForRequestedTurnArgs,
): FilterExactEventRowsForRequestedTurnResult {
  const rows: StoredEventRow[] = [];
  let removedRows = false;
  for (const row of args.exactEventRows) {
    if (row.scopeKind === "turn" && row.turnId !== args.turnId) {
      removedRows = true;
      continue;
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

  const budget =
    args.budget ??
    ({
      remainingBytes: THREAD_TIMELINE_PARENTED_ENRICHMENT_BYTE_TARGET,
      remainingRows: THREAD_TIMELINE_PARENTED_ENRICHMENT_ROW_LIMIT,
    } satisfies TimelineParentedEnrichmentBudget);
  if (budget.remainingRows === 0 || budget.remainingBytes === 0) {
    return [...args.rows];
  }
  const turnStartedResult = listStoredTurnStartedRowsByTurnIdsUpToSequence(db, {
    excludedRowIds: args.rows.map((row) => row.id),
    limit: budget.remainingRows,
    maxBytes: budget.remainingBytes,
    threadId: args.threadId,
    sequenceCutoff: maxStoredEventSequence(args.rows),
    turnIds: missingTurnIds,
  });
  const turnStartedRows = consumeTimelineEnrichmentResult(
    turnStartedResult,
    budget,
  );
  if (turnStartedRows.length === 0) {
    return [...args.rows];
  }

  return mergeStoredEventRowsById([...turnStartedRows, ...args.rows]);
}

function ensureTimelineWindowItemStartedRows(
  db: DbConnection,
  args: TimelineWindowRowsArgs,
): StoredEventRow[] {
  const startedItemIds = new Set<string>();
  const referencedItemIds = new Set<string>();
  for (const row of args.rows) {
    if (row.itemId === null) {
      continue;
    }
    if (row.type === "item/started") {
      startedItemIds.add(row.itemId);
      continue;
    }
    if (row.type !== "item/completed") {
      referencedItemIds.add(row.itemId);
    }
  }
  const missingItemIds = [...referencedItemIds].filter(
    (itemId) => !startedItemIds.has(itemId),
  );
  if (missingItemIds.length === 0) {
    return [...args.rows];
  }
  const budget =
    args.budget ??
    ({
      remainingBytes: THREAD_TIMELINE_PARENTED_ENRICHMENT_BYTE_TARGET,
      remainingRows: THREAD_TIMELINE_PARENTED_ENRICHMENT_ROW_LIMIT,
    } satisfies TimelineParentedEnrichmentBudget);
  if (budget.remainingRows === 0 || budget.remainingBytes === 0) {
    return [...args.rows];
  }
  const startedResult = listStoredItemStartedRowsByItemIds(db, {
    excludedRowIds: args.rows.map((row) => row.id),
    itemIds: missingItemIds,
    limit: budget.remainingRows,
    maxBytes: budget.remainingBytes,
    sequenceCutoff: args.sequenceEnd,
    threadId: args.threadId,
  });
  const selectedStartedRows = consumeTimelineEnrichmentResult(
    startedResult,
    budget,
  );
  return mergeStoredEventRowsById([...selectedStartedRows, ...args.rows]);
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

  const budget =
    args.budget ??
    ({
      remainingBytes: THREAD_TIMELINE_PARENTED_ENRICHMENT_BYTE_TARGET,
      remainingRows: THREAD_TIMELINE_PARENTED_ENRICHMENT_ROW_LIMIT,
    } satisfies TimelineParentedEnrichmentBudget);
  if (budget.remainingRows === 0 || budget.remainingBytes === 0) {
    return [...args.rows];
  }
  const stateResult = listLatestBackgroundTaskStateRowsByItemIds(db, {
    excludedRowIds: args.rows.map((row) => row.id),
    itemIds: [...itemIds],
    limit: Math.min(itemIds.size, budget.remainingRows),
    maxBytes: budget.remainingBytes,
    maxDataBytes:
      THREAD_TIMELINE_OPEN_BACKGROUND_TASK_STATE_MAX_DATA_BYTES_PER_ROW,
    sequenceCutoff: args.sequenceEnd,
    threadId: args.threadId,
  });
  const stateRows = consumeTimelineEnrichmentResult(stateResult, budget);
  if (stateRows.length === 0) {
    return [...args.rows];
  }

  return mergeStoredEventRowsById([...args.rows, ...stateRows]);
}

function ensureLatestTimelineOpenBackgroundTaskStateRows(
  db: DbConnection,
  args: TimelineWindowRowsArgs,
): StoredEventRow[] {
  const budget =
    args.budget ??
    ({
      remainingBytes: THREAD_TIMELINE_PARENTED_ENRICHMENT_BYTE_TARGET,
      remainingRows: THREAD_TIMELINE_PARENTED_ENRICHMENT_ROW_LIMIT,
    } satisfies TimelineParentedEnrichmentBudget);
  if (budget.remainingRows === 0 || budget.remainingBytes === 0) {
    return [...args.rows];
  }
  const stateResult = listLatestOpenBackgroundTaskStateRowsForThread(db, {
    excludedRowIds: args.rows.map((row) => row.id),
    limit: Math.min(
      THREAD_TIMELINE_OPEN_BACKGROUND_TASK_STATE_ROW_LIMIT,
      budget.remainingRows,
    ),
    maxBytes: budget.remainingBytes,
    maxDataBytes:
      THREAD_TIMELINE_OPEN_BACKGROUND_TASK_STATE_MAX_DATA_BYTES_PER_ROW,
    threadId: args.threadId,
  });
  const stateRows = consumeTimelineEnrichmentResult(stateResult, budget);
  if (stateRows.length === 0) {
    return [...args.rows];
  }

  return mergeStoredEventRowsById([...args.rows, ...stateRows]);
}

function ensureLatestTimelineGoalStateRow(
  db: DbConnection,
  args: TimelineWindowRowsArgs,
): StoredEventRow[] {
  const budget =
    args.budget ??
    ({
      remainingBytes: THREAD_TIMELINE_PARENTED_ENRICHMENT_BYTE_TARGET,
      remainingRows: THREAD_TIMELINE_PARENTED_ENRICHMENT_ROW_LIMIT,
    } satisfies TimelineParentedEnrichmentBudget);
  if (budget.remainingRows === 0 || budget.remainingBytes === 0) {
    return [...args.rows];
  }
  const goalResult = listLatestGoalEventRowsForThread(db, {
    excludedRowIds: args.rows.map((row) => row.id),
    limit: 1,
    maxBytes: budget.remainingBytes,
    threadId: args.threadId,
  });
  const goalRows = consumeTimelineEnrichmentResult(goalResult, budget);
  return mergeStoredEventRowsById([...args.rows, ...goalRows]);
}

/**
 * A bounded event suffix can begin in the middle of a turn. Restore the
 * nearest message anchor and its accepted-input link so projection can still
 * associate the visible work with the initiating user request. This is a
 * targeted lookup: it adds one anchor and at most the matching acceptance
 * rows, never the discarded event prefix.
 */
function ensureTimelineWindowSegmentAnchorContextRows(
  db: DbConnection,
  args: TimelineWindowRowsArgs,
): StoredEventRow[] {
  const firstRow = args.rows[0];
  if (!firstRow) {
    return [];
  }
  const anchor = listTimelineSegmentAnchorsDescending(db, {
    beforeSequence: firstRow.sequence + 1,
    limit: 1,
    threadId: args.threadId,
  })[0];
  if (!anchor || args.rows.some((row) => row.sequence === anchor.sequence)) {
    return [...args.rows];
  }

  const budget =
    args.budget ??
    ({
      remainingBytes: THREAD_TIMELINE_PARENTED_ENRICHMENT_BYTE_TARGET,
      remainingRows: THREAD_TIMELINE_PARENTED_ENRICHMENT_ROW_LIMIT,
    } satisfies TimelineParentedEnrichmentBudget);
  if (budget.remainingRows === 0 || budget.remainingBytes === 0) {
    return [...args.rows];
  }
  const anchorResult = listStoredTimelineWindowEventRowsDescending(db, {
    beforeSequence: anchor.sequence + 1,
    excludedRowIds: args.rows.map((row) => row.id),
    excludedTypes: [],
    limit: 1,
    maxBytes: budget.remainingBytes,
    sequenceStart: anchor.sequence,
    threadId: args.threadId,
  });
  const anchorRows = consumeTimelineEnrichmentResult(anchorResult, budget);
  const clientRequestIds = anchorRows.flatMap((row) => {
    const requestId = tryReadClientTurnRequestedRequestId(row);
    return requestId === null ? [] : [requestId];
  });
  if (
    clientRequestIds.length === 0 ||
    budget.remainingRows === 0 ||
    budget.remainingBytes === 0
  ) {
    return mergeStoredEventRowsById([...anchorRows, ...args.rows]);
  }
  const acceptedResult = listStoredTurnInputAcceptedRowsByClientRequestIds(db, {
    afterSequence: anchor.sequence,
    clientRequestIds,
    excludedRowIds: [...args.rows, ...anchorRows].map((row) => row.id),
    limit: budget.remainingRows,
    maxBytes: budget.remainingBytes,
    threadId: args.threadId,
  });
  const acceptedRows = consumeTimelineEnrichmentResult(acceptedResult, budget);
  return mergeStoredEventRowsById([
    ...anchorRows,
    ...acceptedRows,
    ...args.rows,
  ]);
}

export const THREAD_TIMELINE_EVENT_WINDOW_ROW_LIMIT = 400;
export const THREAD_TIMELINE_EVENT_WINDOW_BYTE_TARGET = 750_000;
export const THREAD_TIMELINE_OPEN_BACKGROUND_TASK_STATE_ROW_LIMIT = 16;
export const THREAD_TIMELINE_OPEN_BACKGROUND_TASK_STATE_MAX_DATA_BYTES_PER_ROW = 16_000;
const THREAD_TIMELINE_EVENT_WINDOW_EXCLUDED_EVENT_TYPES = [
  ...THREAD_TIMELINE_EXCLUDED_EVENT_TYPES,
  // Goal state has its own targeted latest-row query below and never produces
  // timeline rows. Repeated goal updates must not evict visible work from a
  // bounded event window.
  "thread/goal/updated",
  "thread/goal/cleared",
] satisfies readonly ThreadEventType[];

interface BoundedTimelineEventRows {
  olderCursor: TimelinePaginationCursor | null;
  rows: StoredEventRow[];
}

function replaceOversizedTimelineEventWithPlaceholder(
  row: StoredEventRow,
): StoredEventRow {
  const data = JSON.stringify({
    code: "timeline_event_payload_too_large",
    message: `A ${row.type} event (${Buffer.byteLength(row.data, "utf8")} bytes) was too large to render inline. The stored event was retained.`,
  });
  return {
    ...row,
    data,
    itemId: null,
    itemKind: null,
    type: "system/error",
  };
}

function boundTimelineEventRowsForProjection(
  rows: readonly StoredEventRow[],
): StoredEventRow[] {
  return rows.map((row) =>
    Buffer.byteLength(row.data, "utf8") <=
    THREAD_TIMELINE_EVENT_WINDOW_BYTE_TARGET
      ? row
      : replaceOversizedTimelineEventWithPlaceholder(row),
  );
}

function selectBoundedTimelineEventRows(
  db: DbConnection,
  args: {
    beforeSequence: number | undefined;
    cursorScope: TimelineEventWindowCursorScope;
    sequenceStart: number;
    threadId: string;
  },
): BoundedTimelineEventRows {
  const result = listStoredTimelineWindowEventRowsDescending(db, {
    beforeSequence: args.beforeSequence,
    excludedTypes: THREAD_TIMELINE_EVENT_WINDOW_EXCLUDED_EVENT_TYPES,
    limit: THREAD_TIMELINE_EVENT_WINDOW_ROW_LIMIT,
    maxBytes: THREAD_TIMELINE_EVENT_WINDOW_BYTE_TARGET,
    sequenceStart: args.sequenceStart,
    threadId: args.threadId,
  });
  if (
    result.rows.length > THREAD_TIMELINE_EVENT_WINDOW_ROW_LIMIT ||
    result.dataBytes > THREAD_TIMELINE_EVENT_WINDOW_BYTE_TARGET
  ) {
    throw new Error("Timeline event query exceeded its requested budget");
  }
  const selectedDescending = result.rows;
  const earliestSelected = selectedDescending.at(-1);
  return {
    olderCursor:
      result.hasMore && earliestSelected
        ? createTimelineEventWindowCursor({
            byteTarget: THREAD_TIMELINE_EVENT_WINDOW_BYTE_TARGET,
            eventId: earliestSelected.id,
            issuedBeforeSequence: args.beforeSequence ?? null,
            rowLimit: THREAD_TIMELINE_EVENT_WINDOW_ROW_LIMIT,
            scope: args.cursorScope,
            selectionStart: args.sequenceStart,
            sequence: earliestSelected.sequence,
          })
        : null,
    rows: selectedDescending.reverse(),
  };
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

function requireStoredTimelineEventWindowCursor(
  db: DbConnection,
  args: {
    cursor: TimelinePaginationCursor;
    byteTarget?: number;
    errorMessage: string;
    expectedScope: TimelineEventWindowCursorScope;
    rowLimit?: number;
    threadId: string;
  },
): StoredEventIdentity {
  const payload = getTimelineEventWindowCursorPayload(args.cursor);
  if (
    payload === null ||
    payload.byteTarget !==
      (args.byteTarget ?? THREAD_TIMELINE_EVENT_WINDOW_BYTE_TARGET) ||
    payload.rowLimit !==
      (args.rowLimit ?? THREAD_TIMELINE_EVENT_WINDOW_ROW_LIMIT) ||
    !areTimelineEventWindowCursorScopesEqual(
      payload.scope,
      args.expectedScope,
    ) ||
    args.cursor.anchorSeq < payload.selectionStart ||
    (payload.issuedBeforeSequence !== null &&
      args.cursor.anchorSeq >= payload.issuedBeforeSequence)
  ) {
    throw new ApiError(400, "invalid_request", args.errorMessage);
  }
  const cursorEvent = getStoredEventIdentityAtSequence(db, {
    sequence: args.cursor.anchorSeq,
    threadId: args.threadId,
  });
  if (!cursorEvent || cursorEvent.id !== payload.eventId) {
    throw new ApiError(400, "invalid_request", args.errorMessage);
  }
  return cursorEvent;
}

function areTimelineEventWindowCursorScopesEqual(
  left: TimelineEventWindowCursorScope,
  right: TimelineEventWindowCursorScope,
): boolean {
  if (left.kind !== right.kind) return false;
  if (left.threadId !== right.threadId) return false;
  if (left.kind === "timeline" && right.kind === "timeline") {
    return left.segmentLimit === right.segmentLimit;
  }
  if (left.kind === "turn-details" && right.kind === "turn-details") {
    return (
      left.turnId === right.turnId &&
      left.contextItemIdsHash === right.contextItemIdsHash &&
      left.parentToolCallId === right.parentToolCallId &&
      left.sourceSeqStart === right.sourceSeqStart &&
      left.sourceSeqEnd === right.sourceSeqEnd
    );
  }
  if (
    left.kind === "delegation-children" &&
    right.kind === "delegation-children"
  ) {
    return (
      left.ownerTurnId === right.ownerTurnId &&
      left.parentToolCallId === right.parentToolCallId &&
      left.sourceSeqStart === right.sourceSeqStart &&
      left.sourceSeqEnd === right.sourceSeqEnd &&
      left.directTurnSourceSeqStart === right.directTurnSourceSeqStart &&
      left.directTurnSourceSeqEnd === right.directTurnSourceSeqEnd
    );
  }
  return false;
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
    const eventWindowPayload = getTimelineEventWindowCursorPayload(cursor);
    if (eventWindowPayload !== null) {
      requireStoredTimelineEventWindowCursor(db, {
        cursor,
        errorMessage: "Timeline pagination cursor is no longer available",
        expectedScope: {
          kind: "timeline",
          segmentLimit: page.segmentLimit,
          threadId,
        },
        threadId,
      });
      const precedingAnchors = listTimelineSegmentAnchorsDescending(db, {
        beforeSequence: cursor.anchorSeq,
        limit: page.segmentLimit + 1,
        threadId,
      });
      return {
        beforeSequence: cursor.anchorSeq,
        // A row-window cursor is itself proof that the thread has timeline
        // content, including legacy threads with no message anchor.
        hasAnchors: true,
        sequenceStart: precedingAnchors[page.segmentLimit]?.sequence ?? 0,
      };
    }
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
      beforeSequence: cursor.anchorSeq,
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
  maxSeq: number,
): TimelineEventRowSelection {
  const window = resolveTimelineSegmentWindow(db, {
    page,
    threadId: thread.id,
  });
  const beforeSequence = window.beforeSequence;
  const sequenceStart = window.sequenceStart;

  const boundedEventRows = selectBoundedTimelineEventRows(db, {
    beforeSequence,
    cursorScope: {
      kind: "timeline",
      segmentLimit: page.segmentLimit,
      threadId: thread.id,
    },
    sequenceStart,
    threadId: thread.id,
  });
  const firstExactEventRow = boundedEventRows.rows[0];
  const lastExactEventRow = boundedEventRows.rows.at(-1);
  const enrichmentBudget: TimelineParentedEnrichmentBudget = {
    remainingBytes: THREAD_TIMELINE_PARENTED_ENRICHMENT_BYTE_TARGET,
    remainingRows: THREAD_TIMELINE_PARENTED_ENRICHMENT_ROW_LIMIT,
  };

  const selectedRowsWithInWindowTaskState =
    ensureTimelineWindowBackgroundTaskStateRows(db, {
      budget: enrichmentBudget,
      threadId: thread.id,
      rows: ensureTimelineWindowTurnStartedRows(db, {
        budget: enrichmentBudget,
        threadId: thread.id,
        rows: ensureTimelineWindowItemStartedRows(db, {
          budget: enrichmentBudget,
          threadId: thread.id,
          rows: ensureTimelineWindowSegmentAnchorContextRows(db, {
            budget: enrichmentBudget,
            threadId: thread.id,
            rows: boundedEventRows.rows,
          }),
        }),
      }),
    });
  const selectedRows =
    page.kind === "latest"
      ? ensureLatestTimelineGoalStateRow(db, {
          budget: enrichmentBudget,
          threadId: thread.id,
          rows: ensureLatestTimelineOpenBackgroundTaskStateRows(db, {
            budget: enrichmentBudget,
            threadId: thread.id,
            rows: selectedRowsWithInWindowTaskState,
          }),
        })
      : selectedRowsWithInWindowTaskState;
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
  const boundedSelectedRowsWithContext = {
    contextRows: boundTimelineEventRowsForProjection(
      selectedRowsWithContext.contextRows,
    ),
    rows: boundTimelineEventRowsForProjection(selectedRowsWithContext.rows),
  };
  const selectedRowsWithParentedContext = ensureTimelineWindowParentedRows(db, {
    budget: enrichmentBudget,
    threadId: thread.id,
    rows: boundedSelectedRowsWithContext.rows,
  });
  const selectedRowsWithParentedTurnStarts =
    ensureTimelineWindowTurnStartedRows(db, {
      budget: enrichmentBudget,
      threadId: thread.id,
      rows: selectedRowsWithParentedContext.rows,
    });

  return {
    acceptedClientRequestContextRows: boundTimelineEventRowsForProjection(
      boundedSelectedRowsWithContext.contextRows,
    ),
    contextOnlyToolCallIds:
      selectedRowsWithParentedContext.contextOnlyToolCallIds,
    exactEventSequenceEnd: lastExactEventRow?.sequence ?? 0,
    exactEventSequenceStart: firstExactEventRow?.sequence ?? 0,
    paginationPage:
      page.kind === "older"
        ? page
        : {
            kind: "latest",
            segmentLimit: page.segmentLimit,
          },
    eventWindowOlderCursor: boundedEventRows.olderCursor,
    enrichmentBudget,
    lifecycleOwnerSequenceEnd: maxSeq,
    lifecycleOwnerSequenceStart: 0,
    responsePageKind: page.kind,
    rows: boundTimelineEventRowsForProjection(
      selectedRowsWithParentedTurnStarts,
    ),
    strategy:
      boundedEventRows.olderCursor === null &&
      sequenceStart === 0 &&
      beforeSequence === undefined
        ? "full"
        : "standard-window",
  };
}

function selectTimelineEventRows(
  db: DbConnection,
  thread: Thread,
  options: BuildThreadTimelineOptions,
): TimelineEventRowSelection {
  return selectStandardTimelineEventRows(
    db,
    thread,
    options.page,
    options.maxSeq,
  );
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
    enrichmentEventBytes: 0,
    enrichmentEventRowCount: 0,
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

function isTimelineMessageAnchor(
  row: TimelineRow,
): row is Extract<TimelineRow, { kind: "conversation"; role: "user" }> {
  return (
    row.kind === "conversation" &&
    row.role === "user" &&
    row.turnRequest.kind === "message"
  );
}

function isActivelyRunningThread(thread: Thread): boolean {
  return (
    thread.status === "starting" ||
    thread.status === "active" ||
    thread.status === "stopping"
  );
}

function prepareLatestTimelineDelivery(args: {
  db: DbConnection;
  eventWindowOlderCursor: TimelinePaginationCursor | null;
  rows: readonly TimelineRow[];
  thread: Thread;
}): {
  eventWindowOlderCursor: TimelinePaginationCursor | null;
  rows: TimelineRow[];
} {
  const { db, eventWindowOlderCursor, rows, thread } = args;
  let activeAnchor:
    | Extract<TimelineRow, { kind: "conversation"; role: "user" }>
    | undefined;
  for (let index = rows.length - 1; index >= 0; index--) {
    const row = rows[index];
    if (row && isTimelineMessageAnchor(row)) {
      activeAnchor = row;
      break;
    }
  }
  const cursorFallsInsideActiveTurn =
    isActivelyRunningThread(thread) &&
    activeAnchor !== undefined &&
    eventWindowOlderCursor !== null &&
    eventWindowOlderCursor.anchorSeq > activeAnchor.sourceSeqEnd;
  const collapsedRows = collapseActiveTimelineWork({
    ...(cursorFallsInsideActiveTurn
      ? { olderEventSequence: eventWindowOlderCursor.anchorSeq }
      : {}),
    rows,
    threadStatus: thread.status,
  });
  if (!cursorFallsInsideActiveTurn || !activeAnchor) {
    return { eventWindowOlderCursor, rows: collapsedRows };
  }

  // Work before the live tail is now reachable through the active turn's lazy
  // summary. Keep top-level pagination only when an older conversation exists,
  // and place that cursor immediately before the active prompt.
  const hasEarlierConversation =
    listTimelineSegmentAnchorsDescending(db, {
      beforeSequence: activeAnchor.sourceSeqStart,
      limit: 1,
      threadId: thread.id,
    }).length > 0;
  const storedActiveAnchor = hasEarlierConversation
    ? getTimelineSegmentAnchorAtSequence(db, {
        sequence: activeAnchor.sourceSeqStart,
        threadId: thread.id,
      })
    : null;
  if (hasEarlierConversation && !storedActiveAnchor) {
    throw new Error(
      `Active timeline anchor ${activeAnchor.id} has no stored segment anchor`,
    );
  }
  const olderConversationCursor: TimelinePaginationCursor | null =
    storedActiveAnchor
      ? {
          anchorId: storedActiveAnchor.rowId,
          anchorSeq: storedActiveAnchor.sequence,
        }
      : null;
  return {
    eventWindowOlderCursor: olderConversationCursor,
    rows: collapsedRows,
  };
}

function completeThreadTimelineBuildProfile(
  accumulator: ThreadTimelineBuildProfileAccumulator,
  options: BuildThreadTimelineOptions,
  response: ThreadTimelineResponse,
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
    enrichmentEventBytes: accumulator.enrichmentEventBytes,
    enrichmentEventRowCount: accumulator.enrichmentEventRowCount,
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
  const includeProviderUnhandledOperations =
    options.includeProviderUnhandledOperations;
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
      boundTimelineEventRowsForProjection(
        mergeStoredEventRowsById([
          ...eventSelection.acceptedClientRequestContextRows,
          ...selectAcceptedClientRequestContextRows(db, {
            budget: eventSelection.enrichmentBudget,
            excludedRowIds: eventSelection.acceptedClientRequestContextRows.map(
              (row) => row.id,
            ),
            rows: rawEventRows,
            threadId: thread.id,
          }),
        ]),
      ),
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
    () => {
      const budget = eventSelection.enrichmentBudget;
      if (budget.remainingRows === 0 || budget.remainingBytes === 0) {
        return [];
      }
      const result = listContextWindowUsageRows(db, {
        excludedRowIds: [
          ...rawEventRows,
          ...acceptedClientRequestContextRows,
        ].map((row) => row.id),
        limit: Math.min(2, budget.remainingRows),
        maxBytes: budget.remainingBytes,
        threadId: thread.id,
      });
      return consumeTimelineEnrichmentResult(result, budget);
    },
  );
  if (profile) {
    profile.contextWindowEventDataBytes = byteLengthOfStoredEventRows(
      contextWindowUsageRows,
    );
    profile.contextWindowEventRowCount = contextWindowUsageRows.length;
    profile.enrichmentEventBytes =
      THREAD_TIMELINE_PARENTED_ENRICHMENT_BYTE_TARGET -
      eventSelection.enrichmentBudget.remainingBytes;
    profile.enrichmentEventRowCount =
      THREAD_TIMELINE_PARENTED_ENRICHMENT_ROW_LIMIT -
      eventSelection.enrichmentBudget.remainingRows;
  }
  const commonProjectionOptions = {
    includeDebugRawEvents: false,
    includeProviderUnhandledOperations,
    isLatestPage: options.page.kind === "latest",
    providerDisplayName: options.providerDisplayName,
    threadStatus: thread.status,
    threadName: thread.title ?? thread.titleFallback ?? "",
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
          contextOnlyToolCallIds: eventSelection.contextOnlyToolCallIds,
          includeNestedRows,
          providerId: thread.providerId,
          turnMessageDetail: includeNestedRows ? "full" : "summary",
        },
      }),
  );
  const shouldApplyTopLevelLifecycleOwnership =
    !isActivelyRunningThread(thread);
  const rowsWithDelegationPages = attachDelegationChildPages(db, {
    rows: timeline.rows,
    sequenceEnd: eventSelection.lifecycleOwnerSequenceEnd,
    sequenceStart: eventSelection.lifecycleOwnerSequenceStart,
    threadId: thread.id,
  });
  const topLevelRows = shouldApplyTopLevelLifecycleOwnership
    ? (() => {
        const candidateItemIds = [
          ...new Set(
            rawEventRows.flatMap((row) =>
              row.itemId === null ? [] : [row.itemId],
            ),
          ),
        ];
        const ownerSequenceByItemId = new Map(
          listStoredItemLifecycleOwnerSequences(db, {
            itemIds: candidateItemIds,
            seqEnd: eventSelection.lifecycleOwnerSequenceEnd,
            seqStart: eventSelection.lifecycleOwnerSequenceStart,
            threadId: thread.id,
          }).map((owner) => [owner.itemId, owner.sequence]),
        );
        const contextOnlyItemIds = new Set(
          candidateItemIds.filter((itemId) => {
            const ownerSequence = ownerSequenceByItemId.get(itemId);
            return (
              ownerSequence === undefined ||
              ownerSequence < eventSelection.exactEventSequenceStart ||
              ownerSequence > eventSelection.exactEventSequenceEnd
            );
          }),
        );
        return excludeTimelineDetailContextItems(
          rowsWithDelegationPages,
          contextOnlyItemIds,
        );
      })()
    : rowsWithDelegationPages;
  if (profile) {
    profile.projectedRowCount = topLevelRows.length;
  }
  const delivery =
    options.page.kind === "latest"
      ? prepareLatestTimelineDelivery({
          db,
          eventWindowOlderCursor: eventSelection.eventWindowOlderCursor,
          rows: topLevelRows,
          thread,
        })
      : {
          eventWindowOlderCursor: eventSelection.eventWindowOlderCursor,
          rows: topLevelRows,
        };
  const paginatedTimeline = measureThreadTimelineStage(
    profile,
    "pagination-segmentation",
    () =>
      paginateTimelineRows(delivery.rows, eventSelection.paginationPage, {
        eventWindowOlderCursor: delivery.eventWindowOlderCursor,
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
    activeWorkflow:
      options.page.kind === "latest" ? timeline.activeWorkflow : null,
    activeBackgroundCommands:
      options.page.kind === "latest" ? timeline.activeBackgroundCommands : [],
    // pendingTodos is gated inside the projection via `isLatestPage` so the
    // extraction work is skipped on older-page requests entirely; no
    // post-hoc null-out needed here.
    pendingTodos: timeline.pendingTodos,
    goal: timeline.goal,
    modelFallback:
      options.page.kind === "latest" ? timeline.modelFallback : null,
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

export function buildThreadTimeline(
  db: DbConnection,
  thread: Thread,
  options: BuildThreadTimelineOptions,
): ThreadTimelineResponse {
  return buildThreadTimelineInternal(db, thread, {
    ...options,
    includeProfile: false,
  }).response;
}

export function buildThreadTimelineWithProfile(
  db: DbConnection,
  thread: Thread,
  options: BuildThreadTimelineOptions,
): { profile: ThreadTimelineBuildProfile; response: ThreadTimelineResponse } {
  const result = buildThreadTimelineInternal(db, thread, {
    ...options,
    includeProfile: true,
  });
  if (!result.profile) {
    throw new Error("Expected timeline build profile");
  }
  return { profile: result.profile, response: result.response };
}

export interface BuildThreadConversationOutlineOptions {
  /** Thread high-water event sequence this outline reflects (echoed to clients). */
  maxSeq: number;
  providerDisplayName?: string;
}

const CONVERSATION_OUTLINE_PREVIEW_MAX_LENGTH = 200;

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

/**
 * Projects the entire thread into a lightweight conversation outline for the
 * table-of-contents minimap. Unlike {@link buildThreadTimeline}, this is not
 * paginated: it reads every event and reuses the same
 * {@link buildThreadTimelineFromEvents} projection so each outline item's `id`
 * is identical to the timeline row it represents. That identity is what lets
 * the minimap scroll-spy the loaded window and jump to a message once it is
 * paginated in. Only conversation rows survive, and each is reduced to the few
 * fields the minimap renders.
 */
export function buildThreadConversationOutline(
  db: DbConnection,
  thread: Thread,
  options: BuildThreadConversationOutlineOptions,
): ThreadConversationOutlineResponse {
  const rawEventRows = listStoredConversationOutlineEventRows(db, {
    threadId: thread.id,
  });
  const decodedRawEvents = rawEventRows.map((row) =>
    toThreadEventWithMeta(row),
  );
  const decodedEvents = compactThreadTimelineSummaryEvents(decodedRawEvents);
  const acceptedClientRequestContext: AcceptedClientRequestContext = {
    acceptedClientRequestEvents: selectAcceptedClientRequestContextRows(db, {
      budget: {
        remainingBytes: THREAD_TIMELINE_PARENTED_ENRICHMENT_BYTE_TARGET,
        remainingRows: THREAD_TIMELINE_PARENTED_ENRICHMENT_ROW_LIMIT,
      },
      rows: rawEventRows,
      threadId: thread.id,
    }).map((row) => toThreadEventWithMeta(row)),
  };
  const timeline = buildThreadTimelineFromEvents({
    acceptedClientRequestContext,
    contextWindowEvents: [],
    events: decodedEvents,
    options: {
      includeDebugRawEvents: false,
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
}

function timelineWorkRowItemId(
  row: Extract<TimelineRow, { kind: "work" }>,
): string {
  switch (row.workKind) {
    case "approval":
      return row.target.itemId;
    case "question":
      return row.interactionId;
    case "workflow":
      return row.itemId;
    case "command":
    case "delegation":
    case "file-change":
    case "image-view":
    case "tool":
    case "web-fetch":
    case "web-search":
      return row.callId;
  }
}

function attachDelegationChildPages(
  db: DbConnection,
  args: {
    rows: readonly TimelineRow[];
    sequenceEnd: number;
    sequenceStart: number;
    threadId: string;
  },
): TimelineRow[] {
  const delegationRoots = new Map<
    string,
    { ownerTurnId: string; parentToolCallId: string }
  >();
  const collect = (rows: readonly TimelineRow[]): void => {
    for (const row of rows) {
      if (row.kind === "turn" && row.children) {
        collect(row.children);
      } else if (row.kind === "work" && row.workKind === "delegation") {
        if (row.turnId !== null) {
          delegationRoots.set(row.callId, {
            ownerTurnId: row.turnId,
            parentToolCallId: row.callId,
          });
        }
        collect(row.childRows);
      }
    }
  };
  collect(args.rows);
  const turnRanges = new Map(
    listStoredTurnDescendantRanges(db, {
      roots: args.rows.flatMap((row) =>
        row.kind === "turn"
          ? [
              {
                sourceSeqEnd: row.sourceSeqEnd,
                sourceSeqStart: row.sourceSeqStart,
                turnId: row.turnId,
              },
            ]
          : [],
      ),
      sequenceEnd: args.sequenceEnd,
      threadId: args.threadId,
    }).map((range) => [
      `${range.turnId}\0${range.sourceSeqStart}\0${range.sourceSeqEnd}`,
      range,
    ]),
  );
  const rangeByParentToolCallId = new Map(
    listStoredDelegationDescendantRanges(db, {
      roots: [...delegationRoots.values()],
      sequenceEnd: args.sequenceEnd,
      sequenceStart: args.sequenceStart,
      threadId: args.threadId,
    }).map((range) => [range.parentToolCallId, range]),
  );

  const attach = (rows: readonly TimelineRow[]): TimelineRow[] =>
    rows.map((row): TimelineRow => {
      if (row.kind === "turn") {
        const children = row.children === null ? null : attach(row.children);
        const descendantRange = turnRanges.get(
          `${row.turnId}\0${row.sourceSeqStart}\0${row.sourceSeqEnd}`,
        );
        return {
          ...row,
          children,
          sourceSeqEnd: Math.max(
            row.sourceSeqEnd,
            descendantRange?.descendantSourceSeqEnd ?? row.sourceSeqEnd,
            ...(children ?? []).map((child) => child.sourceSeqEnd),
          ),
        };
      }
      if (row.kind !== "work" || row.workKind !== "delegation") {
        return row;
      }
      const range = rangeByParentToolCallId.get(row.callId);
      if (!range || row.turnId === null) {
        return { ...row, childRows: attach(row.childRows) };
      }
      const ownerTurnId = row.turnId;
      const childRows = attach(row.childRows).filter(
        (child) => child.turnId === null || child.turnId === ownerTurnId,
      );
      const retainedAnchorRows = new Map<number, TimelineRow>();
      for (const childRow of childRows) {
        if (!retainedAnchorRows.has(childRow.sourceSeqStart)) {
          retainedAnchorRows.set(childRow.sourceSeqStart, childRow);
        }
      }
      const anchors = [...retainedAnchorRows.entries()].sort(
        ([left], [right]) => left - right,
      );
      const candidateIntervals: TimelineDelegationChildInterval[] = [];
      let directTurnSourceSeqStart = range.sourceSeqStart;
      for (const [anchor, anchorRow] of anchors) {
        const directTurnSourceSeqEnd = Math.min(range.sourceSeqEnd, anchor - 1);
        if (directTurnSourceSeqStart <= directTurnSourceSeqEnd) {
          candidateIntervals.push({
            beforeChildRowId: anchorRow.id,
            directTurnSourceSeqEnd,
            directTurnSourceSeqStart,
          });
        }
        directTurnSourceSeqStart = Math.max(
          directTurnSourceSeqStart,
          anchor + 1,
        );
      }
      if (directTurnSourceSeqStart <= range.sourceSeqEnd) {
        candidateIntervals.push({
          beforeChildRowId: null,
          directTurnSourceSeqEnd: range.sourceSeqEnd,
          directTurnSourceSeqStart,
        });
      }
      const nonemptyBucketIndexes = new Set(
        listStoredNonemptyDelegationChildTurnBucketIndexes(db, {
          buckets: candidateIntervals,
          excludedTypes: THREAD_TIMELINE_EXCLUDED_EVENT_TYPES,
          ownerTurnId,
          parentToolCallId: row.callId,
          sequenceEnd: range.sourceSeqEnd,
          sequenceStart: range.sourceSeqStart,
          threadId: args.threadId,
        }),
      );
      const intervals = candidateIntervals.filter((_, index) =>
        nonemptyBucketIndexes.has(index),
      );
      return {
        ...row,
        childPage:
          intervals.length === 0
            ? null
            : {
                intervals,
                ownerTurnId,
                parentToolCallId: row.callId,
                sourceSeqEnd: range.sourceSeqEnd,
                sourceSeqStart: range.sourceSeqStart,
              },
        childRows,
        sourceSeqEnd: Math.max(row.sourceSeqEnd, range.sourceSeqEnd),
      };
    });
  return attach(args.rows);
}

/**
 * Lifecycle starts older than a synthetic summary are projection context, not
 * members of that summary. Their later deltas can overlap omitted work in
 * source-sequence space, so emitting them here would duplicate a pending row
 * that remains visible beside the summary. Nested children are lifted when
 * only their context parent is suppressed so in-range child work stays
 * reachable.
 */
function excludeTimelineDetailContextItems(
  rows: readonly TimelineRow[],
  contextOnlyItemIds: ReadonlySet<string>,
): TimelineRow[] {
  return rows.flatMap((row): TimelineRow[] => {
    if (row.kind === "turn") {
      const children = row.children
        ? excludeTimelineDetailContextItems(row.children, contextOnlyItemIds)
        : null;
      return [{ ...row, children }];
    }
    if (row.kind !== "work") {
      return [row];
    }

    const itemId = timelineWorkRowItemId(row);
    if (contextOnlyItemIds.has(itemId)) {
      return row.workKind === "delegation"
        ? excludeTimelineDetailContextItems(row.childRows, contextOnlyItemIds)
        : [];
    }
    if (row.workKind !== "delegation") {
      return [row];
    }
    return [
      {
        ...row,
        childRows: excludeTimelineDetailContextItems(
          row.childRows,
          contextOnlyItemIds,
        ),
      },
    ];
  });
}

export function buildTimelineDelegationChildrenDetails(
  db: DbConnection,
  thread: Thread,
  options: BuildTimelineDelegationChildrenDetailsOptions,
): TimelineTurnSummaryDetailsResponse {
  if (options.sourceSeqStart > options.sourceSeqEnd) {
    throw new ApiError(
      400,
      "invalid_request",
      "sourceSeqStart must be less than or equal to sourceSeqEnd",
    );
  }
  if (
    options.directTurnSourceSeqStart > options.directTurnSourceSeqEnd ||
    options.directTurnSourceSeqStart < options.sourceSeqStart ||
    options.directTurnSourceSeqEnd > options.sourceSeqEnd
  ) {
    throw new ApiError(
      400,
      "invalid_request",
      "Delegation child interval must be ordered within the delegation snapshot",
    );
  }
  const ownerRow = listStoredToolCallRowsByItemIds(db, {
    itemIds: [options.parentToolCallId],
    limit: 2,
    maxBytes: THREAD_TIMELINE_PARENTED_LIFECYCLE_BYTE_RESERVE,
    sequenceEnd: options.sourceSeqEnd,
    threadId: thread.id,
  }).rows.find(
    (row) =>
      row.itemId === options.parentToolCallId && row.turnId === options.turnId,
  );
  if (!ownerRow) {
    throw new ApiError(
      400,
      "invalid_request",
      `Delegation ${options.parentToolCallId} is not owned by turn ${options.turnId}`,
    );
  }

  const cursorScope: TimelineEventWindowCursorScope = {
    kind: "delegation-children",
    directTurnSourceSeqEnd: options.directTurnSourceSeqEnd,
    directTurnSourceSeqStart: options.directTurnSourceSeqStart,
    ownerTurnId: options.turnId,
    parentToolCallId: options.parentToolCallId,
    sourceSeqEnd: options.sourceSeqEnd,
    sourceSeqStart: options.sourceSeqStart,
    threadId: thread.id,
  };
  let beforeSequence: number | undefined;
  if (options.beforeCursor !== null) {
    beforeSequence = requireStoredTimelineEventWindowCursor(db, {
      cursor: options.beforeCursor,
      errorMessage: "Timeline delegation child cursor is no longer available",
      expectedScope: cursorScope,
      rowLimit: THREAD_TIMELINE_DELEGATION_CHILD_PAGE_LIMIT,
      threadId: thread.id,
    }).sequence;
  }
  const candidates = listStoredDelegationChildTurnRanges(db, {
    beforeSequence,
    directTurnSourceSeqEnd: options.directTurnSourceSeqEnd,
    directTurnSourceSeqStart: options.directTurnSourceSeqStart,
    excludedTypes: THREAD_TIMELINE_EXCLUDED_EVENT_TYPES,
    limit: THREAD_TIMELINE_DELEGATION_CHILD_PAGE_LIMIT + 1,
    ownerTurnId: options.turnId,
    parentToolCallId: options.parentToolCallId,
    sequenceEnd: options.sourceSeqEnd,
    sequenceStart: options.sourceSeqStart,
    threadId: thread.id,
  });
  const selectedDescending = candidates.slice(
    0,
    THREAD_TIMELINE_DELEGATION_CHILD_PAGE_LIMIT,
  );
  const descendantRangeByTurnId = new Map(
    listStoredDelegatedTurnDescendantRanges(db, {
      roots: selectedDescending.map((range) => ({
        parentToolCallId: range.parentToolCallId,
        turnId: range.turnId,
      })),
      sequenceEnd: options.sourceSeqEnd,
      sequenceStart: options.sourceSeqStart,
      threadId: thread.id,
    }).map((range) => [range.turnId, range]),
  );
  const rows: TimelineRow[] = selectedDescending
    .map((directRange) => {
      const range = descendantRangeByTurnId.get(directRange.turnId);
      if (!range) {
        throw new Error(
          `Missing descendant range for delegated turn ${directRange.turnId}`,
        );
      }
      return {
        id: `${thread.id}:${range.turnId}:delegated-turn:${options.parentToolCallId}`,
        threadId: thread.id,
        turnId: range.turnId,
        detailContextItemIds: [],
        detailParentToolCallId: options.parentToolCallId,
        sourceSeqStart: range.sourceSeqStart,
        sourceSeqEnd: range.sourceSeqEnd,
        startedAt: range.startedAt,
        createdAt: range.createdAt,
        kind: "turn" as const,
        status:
          range.completedAt === null
            ? ("pending" as const)
            : ("completed" as const),
        summaryCount: range.eventCount,
        completedAt: range.completedAt,
        children: null,
      };
    })
    .reverse();
  const hasOlderRows =
    candidates.length > THREAD_TIMELINE_DELEGATION_CHILD_PAGE_LIMIT;
  const oldestSelected = selectedDescending.at(-1);
  let olderCursor: TimelinePaginationCursor | null = null;
  if (hasOlderRows && oldestSelected) {
    const cursorEvent = getStoredEventIdentityAtSequence(db, {
      sequence: oldestSelected.sourceSeqStart,
      threadId: thread.id,
    });
    if (!cursorEvent) {
      throw new Error(
        `Missing delegation child cursor event ${oldestSelected.sourceSeqStart}`,
      );
    }
    olderCursor = createTimelineEventWindowCursor({
      byteTarget: THREAD_TIMELINE_EVENT_WINDOW_BYTE_TARGET,
      eventId: cursorEvent.id,
      issuedBeforeSequence:
        beforeSequence ?? options.directTurnSourceSeqEnd + 1,
      rowLimit: THREAD_TIMELINE_DELEGATION_CHILD_PAGE_LIMIT,
      scope: cursorScope,
      selectionStart: options.directTurnSourceSeqStart,
      sequence: cursorEvent.sequence,
    });
  }
  return {
    rows,
    timelinePage: { hasOlderRows, olderCursor },
  };
}

export function buildTimelineTurnSummaryDetails(
  db: DbConnection,
  thread: Thread,
  options: BuildTimelineTurnSummaryDetailsOptions,
): TimelineTurnSummaryDetailsResponse {
  const parentToolCallId = options.parentToolCallId ?? null;
  if (options.sourceSeqStart > options.sourceSeqEnd) {
    throw new ApiError(
      400,
      "invalid_request",
      "sourceSeqStart must be less than or equal to sourceSeqEnd",
    );
  }
  if (
    parentToolCallId !== null &&
    listStoredDelegatedTurnDescendantRanges(db, {
      roots: [
        {
          parentToolCallId,
          turnId: options.turnId,
        },
      ],
      sequenceEnd: options.sourceSeqEnd,
      sequenceStart: options.sourceSeqStart,
      threadId: thread.id,
    }).length === 0
  ) {
    throw new ApiError(
      400,
      "invalid_request",
      `Timeline delegated turn ${options.turnId} is not owned by ${parentToolCallId}`,
    );
  }
  if (
    !hasStoredTurnEventInRange(db, {
      seqEnd: options.sourceSeqEnd,
      seqStart: options.sourceSeqStart,
      threadId: thread.id,
      turnId: options.turnId,
    })
  ) {
    throw new ApiError(
      400,
      "invalid_request",
      `Timeline turn summary details range ${options.sourceSeqStart}-${options.sourceSeqEnd} does not include turn ${options.turnId}`,
    );
  }

  const includeProviderUnhandledOperations =
    options.includeProviderUnhandledOperations;
  const cursorScope: TimelineEventWindowCursorScope = {
    kind: "turn-details",
    contextItemIdsHash: hashTimelineTurnDetailsContextItemIds(
      options.contextItemIds,
    ),
    parentToolCallId,
    sourceSeqEnd: options.sourceSeqEnd,
    sourceSeqStart: options.sourceSeqStart,
    threadId: thread.id,
    turnId: options.turnId,
  };
  let beforeSequence = options.sourceSeqEnd + 1;
  if (options.beforeCursor !== null) {
    const cursorEvent = requireStoredTimelineEventWindowCursor(db, {
      cursor: options.beforeCursor,
      errorMessage:
        "Timeline turn detail pagination cursor is no longer available",
      expectedScope: cursorScope,
      threadId: thread.id,
    });
    if (
      cursorEvent.sequence <= options.sourceSeqStart ||
      cursorEvent.sequence > options.sourceSeqEnd
    ) {
      throw new ApiError(
        400,
        "invalid_request",
        "Timeline turn detail pagination cursor is outside the requested range",
      );
    }
    beforeSequence = cursorEvent.sequence;
  }
  const boundedEventRows = selectBoundedTimelineEventRows(db, {
    beforeSequence,
    cursorScope,
    sequenceStart: options.sourceSeqStart,
    threadId: thread.id,
  });
  const exactEventRows = boundedEventRows.rows;
  const firstExactEventRow = exactEventRows[0];
  const lastExactEventRow = exactEventRows.at(-1);
  if (!firstExactEventRow || !lastExactEventRow) {
    throw new ApiError(
      400,
      "invalid_request",
      "Timeline turn detail pagination cursor has no older rows",
    );
  }
  const clientRequestIds = listStoredClientTurnRequestIdsInRange(db, {
    threadId: thread.id,
    seqStart: firstExactEventRow.sequence,
    seqEnd: lastExactEventRow.sequence,
  });
  const exactAcceptedInputRows = exactEventRows.filter(
    (row) => row.type === "turn/input/accepted",
  );
  const enrichmentBudget: TimelineParentedEnrichmentBudget = {
    remainingBytes: THREAD_TIMELINE_PARENTED_ENRICHMENT_BYTE_TARGET,
    remainingRows: THREAD_TIMELINE_PARENTED_ENRICHMENT_ROW_LIMIT,
  };
  const futureAcceptedInputResult =
    listStoredTurnInputAcceptedRowsByClientRequestIds(db, {
      beforeOrAtSequence: options.sourceSeqEnd,
      threadId: thread.id,
      afterSequence: lastExactEventRow.sequence,
      clientRequestIds,
      excludedRowIds: exactEventRows.map((row) => row.id),
      limit: Math.max(
        0,
        enrichmentBudget.remainingRows -
          THREAD_TIMELINE_PARENTED_LIFECYCLE_ROW_RESERVE,
      ),
      maxBytes: Math.max(
        0,
        enrichmentBudget.remainingBytes -
          THREAD_TIMELINE_PARENTED_LIFECYCLE_BYTE_RESERVE,
      ),
    });
  const futureAcceptedInputRows = consumeTimelineEnrichmentResult(
    futureAcceptedInputResult,
    enrichmentBudget,
  );
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
  const requestedTurnStartedResult = hasCurrentStartedRow
    ? null
    : listStoredTurnStartedRowsByTurnIdsUpToSequence(db, {
        excludedRowIds: eventRows.map((row) => row.id),
        limit: enrichmentBudget.remainingRows,
        maxBytes: enrichmentBudget.remainingBytes,
        threadId: thread.id,
        sequenceCutoff: contextSequenceCutoff,
        turnIds: [options.turnId],
      });
  const requestedTurnStartedRows = requestedTurnStartedResult
    ? consumeTimelineEnrichmentResult(
        requestedTurnStartedResult,
        enrichmentBudget,
      )
    : [];
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
      sourceSeqEnd: lastExactEventRow.sequence,
      sourceSeqStart: firstExactEventRow.sequence,
      turnId: options.turnId,
    },
    useExactEventRowBounds: exactEventRowsForRequestedTurn.removedRows,
  });
  const preParentedRows = boundTimelineEventRowsForProjection(
    ensureTimelineWindowItemStartedRows(db, {
      budget: enrichmentBudget,
      sequenceEnd: options.sourceSeqEnd,
      threadId: thread.id,
      rows: mergeStoredEventRowsById([
        ...requestedTurnStartedRows,
        ...eventRows,
      ]),
    }),
  );
  const parentedRootOwnerSequenceByItemId = new Map(
    listStoredItemLifecycleOwnerSequences(db, {
      itemIds: collectStoredToolCallItemIds(preParentedRows),
      seqEnd: options.sourceSeqEnd,
      seqStart: options.sourceSeqStart,
      threadId: thread.id,
    }).map((owner) => [owner.itemId, owner.sequence]),
  );
  const pageOwnedParentedRootToolCallIds = new Set(
    collectStoredToolCallItemIds(preParentedRows).filter((itemId) => {
      const ownerSequence = parentedRootOwnerSequenceByItemId.get(itemId);
      return (
        ownerSequence !== undefined &&
        ownerSequence >= firstExactEventRow.sequence &&
        ownerSequence <= lastExactEventRow.sequence
      );
    }),
  );
  const parentedEventSelection = ensureTimelineWindowParentedRows(db, {
    budget: enrichmentBudget,
    parentedRootToolCallIds: pageOwnedParentedRootToolCallIds,
    sequenceEnd: options.sourceSeqEnd,
    sequenceStart: firstExactEventRow.sequence,
    threadId: thread.id,
    rows: preParentedRows,
  });
  const eventRowsWithParentedChildren = parentedEventSelection.rows;
  const eventRowsWithTurnStarts = ensureTimelineWindowTurnStartedRows(db, {
    budget: enrichmentBudget,
    threadId: thread.id,
    rows: eventRowsWithParentedChildren,
  });
  const eventRowsWithBackgroundTaskState = boundTimelineEventRowsForProjection(
    ensureTimelineWindowBackgroundTaskStateRows(db, {
      budget: enrichmentBudget,
      sequenceEnd: options.sourceSeqEnd,
      threadId: thread.id,
      rows: eventRowsWithTurnStarts,
    }),
  );
  const projectionSourceSeqEnd = Math.max(
    sourceRange.sourceSeqEnd,
    maxStoredEventSequence(eventRowsWithBackgroundTaskState),
  );
  const children = buildThreadTimelineTurnDetailsFromEvents({
    events: eventRowsWithBackgroundTaskState.map((row) =>
      toThreadEventWithMeta(row),
    ),
    options: {
      includeProviderUnhandledOperations,
      sourceSeqEnd: projectionSourceSeqEnd,
      sourceSeqStart: sourceRange.sourceSeqStart,
      providerDisplayName: options.providerDisplayName,
      threadStatus: thread.status,
      threadName: thread.title ?? thread.titleFallback ?? "",
      turnId: options.turnId,
      workspaceRoot: resolveThreadWorkspaceRoot(db, thread),
    },
  });

  if (children.kind !== "missing-match") {
    // Give each item one deterministic detail page: the page containing its
    // newest lifecycle root inside the summary (item/completed when present,
    // otherwise item/started). Backfilled starts and delta-only pages are
    // projection context. This ownership does not depend on whether a newer
    // page happened to fit the lifecycle into its enrichment budget.
    const candidateItemIds = [
      ...new Set(
        eventRowsWithBackgroundTaskState.flatMap((row) =>
          row.itemId === null ? [] : [row.itemId],
        ),
      ),
    ];
    const lifecycleOwnerSequenceByItemId = new Map(
      listStoredItemLifecycleOwnerSequences(db, {
        itemIds: candidateItemIds,
        seqEnd: options.sourceSeqEnd,
        seqStart: options.sourceSeqStart,
        threadId: thread.id,
      }).map((owner) => [owner.itemId, owner.sequence]),
    );
    const contextOnlyItemIds = new Set(
      candidateItemIds.filter((itemId) => {
        const ownerSequence = lifecycleOwnerSequenceByItemId.get(itemId);
        return (
          ownerSequence === undefined ||
          ownerSequence < firstExactEventRow.sequence ||
          ownerSequence > lastExactEventRow.sequence
        );
      }),
    );
    for (const contextItemId of options.contextItemIds) {
      contextOnlyItemIds.add(contextItemId);
    }
    const detailRows = attachDelegationChildPages(db, {
      rows: excludeTimelineDetailContextItems(
        children.rows,
        contextOnlyItemIds,
      ),
      sequenceEnd: options.sourceSeqEnd,
      sequenceStart: options.sourceSeqStart,
      threadId: thread.id,
    });
    const page = paginateTimelineTurnDetails(detailRows, {
      eventWindowOlderCursor: boundedEventRows.olderCursor,
    });
    return {
      rows: page.rows,
      timelinePage: {
        hasOlderRows: page.hasOlderRows,
        olderCursor: page.olderCursor,
      },
    };
  }

  throw new Error(
    `Timeline turn summary details could not match range ${options.sourceSeqStart}-${options.sourceSeqEnd}`,
  );
}
