import {
  and,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  lt,
  lte,
  max,
  min,
  ne,
  notExists,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type {
  ClientTurnRequestId,
  PromptInput,
  ThreadEvent,
  StoredThreadEventDataForType,
  SystemThreadInterruptedReason,
  ThreadEventItemType,
  ThreadEventScope,
  ThreadEventScopeKind,
  ThreadEventType,
} from "@bb/domain";
import {
  LOCAL_AGENT_TASK_TYPE,
  LOCAL_BASH_TASK_TYPE,
  LOCAL_SUBAGENT_TASK_TYPE,
  LOCAL_WORKFLOW_TASK_TYPE,
  clientTurnRequestIdSchema,
  getThreadEventScopeTurnId,
  parseStoredThreadEvent,
  systemThreadInterruptedReasonSchema,
} from "@bb/domain";
import type {
  DbConnection,
  DbQueryConnection,
  DbTransaction,
} from "../connection.js";
import { alias } from "drizzle-orm/sqlite-core";
import type { DbNotifier } from "../notifier.js";
import { environments, events, threads } from "../schema.js";
import { createEventId } from "../ids.js";
import { deriveStoredEventItemFieldsFromSource } from "../stored-event-item-fields.js";
import {
  upsertThreadSearchSegments,
  type UpsertThreadSearchSegmentInput,
} from "./threads.js";

const STORED_EVENT_SEQUENCE_LOOKUP_CHUNK_SIZE = 250;

const isRootTurnStartedEventData = sql`COALESCE(json_extract(${events.data}, '$.parentToolCallId'), '') = ''`;
const isNotNestedTurnUsageEvent = sql`NOT EXISTS (
  SELECT 1
  FROM events AS nested_turn_started
  WHERE nested_turn_started.thread_id = ${events.threadId}
    AND nested_turn_started.turn_id = ${events.turnId}
    AND nested_turn_started.type = 'turn/started'
    AND COALESCE(json_extract(nested_turn_started.data, '$.parentToolCallId'), '') <> ''
)`;
const isEnvironmentDirectoryUpdateEventData = sql`json_extract(${events.data}, '$.operation') = 'environment_directory_update'`;

export interface InsertEventInput {
  threadId: string;
  environmentId?: string | null;
  scope: ThreadEventScope;
  providerThreadId?: string | null;
  sequence: number;
  type: ThreadEventType;
  itemId: string | null;
  itemKind: ThreadEventItemType | null;
  createdAt?: number;
  data: string;
}

export interface InsertEventsResult {
  insertedCount: number;
  insertedInputIndexes: number[];
}

export interface AppendDaemonEventInput {
  data: string;
  environmentId: string | null;
  itemId: string | null;
  itemKind: ThreadEventItemType | null;
  providerThreadId: string | null;
  scope: ThreadEventScope;
  threadId: string;
  type: ThreadEventType;
}

export interface AcceptedDaemonEvent {
  sequence: number;
  threadId: string;
}

export interface AppendDaemonEventsResult {
  acceptedEvents: AcceptedDaemonEvent[];
  insertedInputIndexes: number[];
  /**
   * Indexes of inputs dropped because they were orphan thread-state snapshots
   * (token/context usage scoped to a turn with no stored turn/started). Surfaced
   * so callers can log them; they are not inserted and trigger no effects.
   */
  skippedTurnUnstartedInputIndexes: number[];
}

export interface MissingStoredTurnStartedDetails {
  eventType: ThreadEventType;
  scopeKind: ThreadEventScopeKind;
  threadId: string;
  turnId: string;
}

export class MissingStoredTurnStartedError extends Error {
  readonly details: MissingStoredTurnStartedDetails;

  constructor(details: MissingStoredTurnStartedDetails) {
    super(
      `Cannot append ${details.eventType} for turn ${details.turnId} before turn/started is stored`,
    );
    this.name = "MissingStoredTurnStartedError";
    this.details = details;
  }
}

export type AppendStoredThreadEventArgs<
  TType extends ThreadEventType = ThreadEventType,
> = {
  [TEventType in TType]: {
    data: StoredThreadEventDataForType<TEventType>;
    environmentId?: string | null;
    providerThreadId?: string | null;
    scope: ThreadEventScope;
    threadId: string;
    type: TEventType;
  };
}[TType];

export interface StoredTurnRequestEventRow {
  data: string;
  sequence: number;
  threadId: string;
  type: ThreadEventType;
}

export interface CompletedStoredTurnRow {
  threadId: string;
  turnId: string;
}

export interface ListThreadIdsWithLatestHostDaemonRestartInterruptionArgs {
  threadIds: readonly string[];
}

export interface ListThreadTurnInterruptionEventStatesArgs {
  threadIds: readonly string[];
}

export interface ThreadTurnInterruptionEventState {
  activeTurnId: string | null;
  latestProviderThreadId: string | null;
  threadId: string;
}

/**
 * Insert events with dedup on (threadId, sequence).
 * Uses INSERT OR IGNORE to skip duplicates.
 * Returns the count and input indexes of actually inserted events.
 */
export function insertEvents(
  db: DbQueryConnection,
  notifier: DbNotifier,
  eventInputs: InsertEventInput[],
): InsertEventsResult {
  if (eventInputs.length === 0) {
    return {
      insertedCount: 0,
      insertedInputIndexes: [],
    };
  }

  let insertedCount = 0;
  const insertedInputIndexes: number[] = [];

  const eventTypesByThreadId = new Map<string, Set<ThreadEventType>>();

  for (const [index, input] of eventInputs.entries()) {
    const id = createEventId();
    const createdAt = input.createdAt ?? Date.now();
    const turnId = getThreadEventScopeTurnId(input.scope) ?? null;
    const result = db.run(
      sql`INSERT OR IGNORE INTO events (id, thread_id, environment_id, scope_kind, turn_id, provider_thread_id, sequence, type, item_id, item_kind, data, created_at)
          VALUES (${id}, ${input.threadId}, ${input.environmentId ?? null}, ${input.scope.kind}, ${turnId}, ${input.providerThreadId ?? null}, ${input.sequence}, ${input.type}, ${input.itemId}, ${input.itemKind}, ${input.data}, ${createdAt})`,
    );
    if (result.changes > 0) {
      insertedCount++;
      insertedInputIndexes.push(index);
      const eventTypes = eventTypesByThreadId.get(input.threadId);
      if (eventTypes) {
        eventTypes.add(input.type);
      } else {
        eventTypesByThreadId.set(input.threadId, new Set([input.type]));
      }
    }
  }

  for (const [threadId, eventTypes] of eventTypesByThreadId) {
    notifier.notifyThread(threadId, ["events-appended"], {
      eventTypes: Array.from(eventTypes),
    });
  }

  return {
    insertedCount,
    insertedInputIndexes,
  };
}

function buildThreadTurnKey(args: ThreadTurnKey): string {
  return `${args.threadId}\0${args.turnId}`;
}

function listUniqueThreadTurnKeys(
  keys: readonly ThreadTurnKey[],
): ThreadTurnKey[] {
  const uniqueKeys: ThreadTurnKey[] = [];
  const seenKeys = new Set<string>();

  for (const key of keys) {
    const lookupKey = buildThreadTurnKey(key);
    if (seenKeys.has(lookupKey)) {
      continue;
    }
    seenKeys.add(lookupKey);
    uniqueKeys.push(key);
  }

  return uniqueKeys;
}

function collectDaemonTurnStartLookupKeys(
  eventInputs: readonly AppendDaemonEventInput[],
): ThreadTurnKey[] {
  const keys: ThreadTurnKey[] = [];

  for (const input of eventInputs) {
    if (input.type === "turn/started") {
      continue;
    }
    const turnId = getThreadEventScopeTurnId(input.scope);
    if (turnId === undefined) {
      continue;
    }
    keys.push({ threadId: input.threadId, turnId });
  }

  return keys;
}

function listStoredTurnStartedKeySet(
  db: DbQueryConnection,
  keys: readonly ThreadTurnKey[],
): Set<string> {
  return new Set(
    listStoredTurnStartedKeys(db, { keys }).map((key) =>
      buildThreadTurnKey(key),
    ),
  );
}

// Thread-state snapshots (token + context-window usage) are idempotent and are
// re-emitted by providers when a session resumes. A native fork resumes the
// parent's session, which reports the parent's last-turn usage scoped to a turn
// the forked thread never started. Dropping such an orphan snapshot is correct
// and avoids wedging the whole event batch (which would otherwise roll back the
// fork's identity + turn events and retry forever). Turn-content events still
// require a stored turn/started, so genuine ordering bugs are still caught.
const ORPHAN_DROPPABLE_TURN_EVENT_TYPES: ReadonlySet<ThreadEventType> = new Set([
  "thread/tokenUsage/updated",
  "thread/contextWindowUsage/updated",
]);

type DaemonTurnStartDisposition = "append" | "skip-orphan-snapshot";

function resolveDaemonTurnStartDisposition(
  input: AppendDaemonEventInput,
  startedTurnKeys: ReadonlySet<string>,
): DaemonTurnStartDisposition {
  if (input.type === "turn/started") {
    return "append";
  }

  const turnId = getThreadEventScopeTurnId(input.scope);
  if (turnId === undefined) {
    return "append";
  }

  const key = buildThreadTurnKey({ threadId: input.threadId, turnId });
  if (startedTurnKeys.has(key)) {
    return "append";
  }

  if (ORPHAN_DROPPABLE_TURN_EVENT_TYPES.has(input.type)) {
    return "skip-orphan-snapshot";
  }

  throw new MissingStoredTurnStartedError({
    eventType: input.type,
    scopeKind: input.scope.kind,
    threadId: input.threadId,
    turnId,
  });
}

function isStoredEventPayload(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractVisiblePromptText(input: readonly PromptInput[]): string {
  return input
    .filter((part) => part.visibility !== "agent-only")
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n")
    .trim();
}

function buildThreadEventSearchSegment(args: {
  sequence: number;
  sourceKind: UpsertThreadSearchSegmentInput["sourceKind"];
  text: string;
  threadId: string;
}): UpsertThreadSearchSegmentInput[] {
  const text = args.text.trim();
  if (text.length === 0) {
    return [];
  }
  return [
    {
      threadId: args.threadId,
      sourceKind: args.sourceKind,
      sourceKey: `event:${args.sequence}`,
      sourceSeq: args.sequence,
      text,
    },
  ];
}

function listThreadSearchSegmentsForStoredEventArgs(args: {
  eventArgs: AppendStoredThreadEventArgs;
  sequence: number;
}): UpsertThreadSearchSegmentInput[] {
  switch (args.eventArgs.type) {
    case "client/turn/requested":
      return buildThreadEventSearchSegment({
        threadId: args.eventArgs.threadId,
        sequence: args.sequence,
        sourceKind: "user_message",
        text: extractVisiblePromptText(args.eventArgs.data.input),
      });
    case "item/completed":
      if (args.eventArgs.data.item.type !== "agentMessage") {
        return [];
      }
      return buildThreadEventSearchSegment({
        threadId: args.eventArgs.threadId,
        sequence: args.sequence,
        sourceKind: "assistant_message",
        text: args.eventArgs.data.item.text,
      });
    case "system/manager/user_message":
      return buildThreadEventSearchSegment({
        threadId: args.eventArgs.threadId,
        sequence: args.sequence,
        sourceKind: "system_message",
        text: args.eventArgs.data.text,
      });
    default:
      return [];
  }
}

function listThreadSearchSegmentsForThreadEvent(args: {
  event: ThreadEvent;
  sequence: number;
}): UpsertThreadSearchSegmentInput[] {
  switch (args.event.type) {
    case "client/turn/requested":
      return buildThreadEventSearchSegment({
        threadId: args.event.threadId,
        sequence: args.sequence,
        sourceKind: "user_message",
        text: extractVisiblePromptText(args.event.input),
      });
    case "item/completed":
      if (args.event.item.type !== "agentMessage") {
        return [];
      }
      return buildThreadEventSearchSegment({
        threadId: args.event.threadId,
        sequence: args.sequence,
        sourceKind: "assistant_message",
        text: args.event.item.text,
      });
    case "system/manager/user_message":
      return buildThreadEventSearchSegment({
        threadId: args.event.threadId,
        sequence: args.sequence,
        sourceKind: "system_message",
        text: args.event.text,
      });
    default:
      return [];
  }
}

function parseDaemonThreadEvent(input: AppendDaemonEventInput): ThreadEvent | null {
  let data: unknown;
  try {
    data = JSON.parse(input.data);
  } catch {
    return null;
  }
  if (!isStoredEventPayload(data)) {
    return null;
  }
  try {
    return parseStoredThreadEvent({
      data,
      providerThreadId: input.providerThreadId,
      scope: input.scope,
      threadId: input.threadId,
      type: input.type,
    });
  } catch {
    return null;
  }
}

export function appendDaemonEventsInTransaction(
  db: DbTransaction,
  eventInputs: readonly AppendDaemonEventInput[],
): AppendDaemonEventsResult {
  if (eventInputs.length === 0) {
    return {
      acceptedEvents: [],
      insertedInputIndexes: [],
      skippedTurnUnstartedInputIndexes: [],
    };
  }

  const threadIds = [...new Set(eventInputs.map((input) => input.threadId))];
  const highWaterMarks = getHighWaterMarks(db, threadIds);
  const nextSequencesByThreadId = new Map(
    threadIds.map((threadId) => [
      threadId,
      (highWaterMarks[threadId] ?? 0) + 1,
    ]),
  );
  const acceptedEvents: AcceptedDaemonEvent[] = [];
  const insertedInputIndexes: number[] = [];
  const skippedTurnUnstartedInputIndexes: number[] = [];

  const startedTurnKeys = listStoredTurnStartedKeySet(
    db,
    collectDaemonTurnStartLookupKeys(eventInputs),
  );
  const now = Date.now();
  for (const [index, input] of eventInputs.entries()) {
    if (
      resolveDaemonTurnStartDisposition(input, startedTurnKeys) ===
      "skip-orphan-snapshot"
    ) {
      skippedTurnUnstartedInputIndexes.push(index);
      continue;
    }

    const sequence = nextSequencesByThreadId.get(input.threadId);
    if (sequence === undefined) {
      throw new Error(`Missing event sequence for thread: ${input.threadId}`);
    }
    const turnId = getThreadEventScopeTurnId(input.scope) ?? null;
    db.run(
      sql`INSERT INTO events
        (id, thread_id, environment_id, scope_kind, turn_id, provider_thread_id, sequence, type, item_id, item_kind, data, created_at)
        VALUES (
          ${createEventId()},
          ${input.threadId},
          ${input.environmentId},
          ${input.scope.kind},
          ${turnId},
          ${input.providerThreadId},
          ${sequence},
          ${input.type},
          ${input.itemId},
          ${input.itemKind},
          ${input.data},
          ${now}
        )`,
    );
    const event = parseDaemonThreadEvent(input);
    if (event !== null) {
      upsertThreadSearchSegments(db, {
        updatedAt: now,
        segments: listThreadSearchSegmentsForThreadEvent({
          event,
          sequence,
        }),
      });
    }

    const acceptedEvent: AcceptedDaemonEvent = {
      sequence,
      threadId: input.threadId,
    };
    acceptedEvents.push(acceptedEvent);
    insertedInputIndexes.push(index);
    if (input.type === "turn/started") {
      const turnId = getThreadEventScopeTurnId(input.scope);
      if (turnId !== undefined) {
        startedTurnKeys.add(
          buildThreadTurnKey({ threadId: input.threadId, turnId }),
        );
      }
    }
    nextSequencesByThreadId.set(input.threadId, sequence + 1);
  }

  return {
    acceptedEvents,
    insertedInputIndexes,
    skippedTurnUnstartedInputIndexes,
  };
}

export function appendStoredThreadEventInTransaction<
  TType extends ThreadEventType,
>(db: DbTransaction, args: AppendStoredThreadEventArgs<TType>): number;
export function appendStoredThreadEventInTransaction(
  db: DbTransaction,
  args: AppendStoredThreadEventArgs,
): number {
  const [sequence] = appendStoredThreadEventsInTransaction(db, [args]);
  if (sequence === undefined) {
    throw new Error("Expected one appended thread event sequence");
  }
  return sequence;
}

export function appendStoredThreadEventsInTransaction(
  db: DbTransaction,
  eventArgs: readonly AppendStoredThreadEventArgs[],
): number[] {
  if (eventArgs.length === 0) {
    return [];
  }

  const now = Date.now();
  const threadIds = [...new Set(eventArgs.map((args) => args.threadId))];
  const highWaterMarks = getHighWaterMarks(db, threadIds);
  const nextSequencesByThreadId = new Map(
    threadIds.map((threadId) => [
      threadId,
      (highWaterMarks[threadId] ?? 0) + 1,
    ]),
  );

  const sequences: number[] = [];
  for (const args of eventArgs) {
    const sequence = nextSequencesByThreadId.get(args.threadId);
    if (sequence === undefined) {
      throw new Error(`Missing event sequence for thread: ${args.threadId}`);
    }

    const itemFields = deriveStoredEventItemFieldsFromSource({
      type: args.type,
      item: "item" in args.data ? args.data.item : undefined,
      itemId: "itemId" in args.data ? args.data.itemId : undefined,
    });
    const turnId = getThreadEventScopeTurnId(args.scope) ?? null;

    db.run(
      sql`INSERT INTO events
        (id, thread_id, environment_id, scope_kind, turn_id, provider_thread_id, sequence, type, item_id, item_kind, data, created_at)
        VALUES (
          ${createEventId()},
          ${args.threadId},
          ${args.environmentId ?? null},
          ${args.scope.kind},
          ${turnId},
          ${args.providerThreadId ?? null},
          ${sequence},
          ${args.type},
          ${itemFields.itemId},
          ${itemFields.itemKind},
          ${JSON.stringify(args.data)},
          ${now}
        )`,
    );
    upsertThreadSearchSegments(db, {
      updatedAt: now,
      segments: listThreadSearchSegmentsForStoredEventArgs({
        eventArgs: args,
        sequence,
      }),
    });

    sequences.push(sequence);
    nextSequencesByThreadId.set(args.threadId, sequence + 1);
  }

  return sequences;
}

export function appendStoredThreadEvent<TType extends ThreadEventType>(
  db: DbConnection,
  notifier: DbNotifier,
  args: AppendStoredThreadEventArgs<TType>,
): number;
export function appendStoredThreadEvent(
  db: DbConnection,
  notifier: DbNotifier,
  args: AppendStoredThreadEventArgs,
): number {
  const sequence = db.transaction(
    (tx) => appendStoredThreadEventInTransaction(tx, args),
    { behavior: "immediate" },
  );
  notifier.notifyThread(args.threadId, ["events-appended"], {
    eventTypes: [args.type],
  });
  return sequence;
}

/**
 * Get high-water marks (max sequence) per thread.
 * Returns Record<threadId, maxSequence>.
 */
export function getHighWaterMarks(
  db: DbQueryConnection,
  threadIds?: string[],
): Record<string, number> {
  const result: Record<string, number> = {};

  if (threadIds && threadIds.length > 0) {
    const rows = db
      .select({
        threadId: events.threadId,
        maxSeq: max(events.sequence),
      })
      .from(events)
      .where(inArray(events.threadId, threadIds))
      .groupBy(events.threadId)
      .all();
    for (const row of rows) {
      if (row.maxSeq != null) {
        result[row.threadId] = row.maxSeq;
      }
    }
  } else {
    const rows = db
      .select({
        threadId: events.threadId,
        maxSeq: max(events.sequence),
      })
      .from(events)
      .groupBy(events.threadId)
      .all();
    for (const row of rows) {
      if (row.maxSeq != null) {
        result[row.threadId] = row.maxSeq;
      }
    }
  }

  return result;
}

export interface ListEventsOptions {
  threadId: string;
  afterSequence?: number;
  limit?: number;
}

const storedEventRowFields = {
  createdAt: events.createdAt,
  data: events.data,
  id: events.id,
  itemId: events.itemId,
  itemKind: events.itemKind,
  providerThreadId: events.providerThreadId,
  scopeKind: events.scopeKind,
  sequence: events.sequence,
  threadId: events.threadId,
  turnId: events.turnId,
  type: events.type,
};

const timelineDeltaEventTypes = [
  "item/agentMessage/delta",
  "item/commandExecution/outputDelta",
  "item/fileChange/outputDelta",
  "item/reasoning/summaryTextDelta",
  "item/reasoning/textDelta",
  "item/plan/delta",
] satisfies readonly ThreadEventType[];

/**
 * Keep event-window queries from materializing an arbitrarily large JSON
 * payload in the server. Oversized deltas retain a bounded prefix and an
 * explicit marker. Oversized background-task snapshots retain the lifecycle
 * fields needed by live task cards while dropping the potentially large
 * workflow tree. Other oversized event kinds become a visible error row at
 * the same stored identity/sequence, so pagination advances without silently
 * skipping the event.
 */
function boundedStoredEventRowFields(maxDataBytes: number) {
  const oversized = sql`(
    length(CAST(${events.data} AS BLOB))
    + length(CAST(${events.id} AS BLOB))
    + length(CAST(COALESCE(${events.itemId}, '') AS BLOB))
    + length(CAST(COALESCE(${events.itemKind}, '') AS BLOB))
    + length(CAST(COALESCE(${events.providerThreadId}, '') AS BLOB))
    + length(CAST(${events.scopeKind} AS BLOB))
    + length(CAST(${events.threadId} AS BLOB))
    + length(CAST(COALESCE(${events.turnId}, '') AS BLOB))
    + length(CAST(${events.type} AS BLOB))
  ) > ${maxDataBytes}`;
  const compactDeltaChars = Math.max(
    1,
    Math.min(32_000, Math.floor(maxDataBytes / 12)),
  );
  const compactItemIdMaxBytes = Math.max(1, Math.floor(maxDataBytes / 24));
  const compactableDelta = and(
    inArray(events.type, timelineDeltaEventTypes),
    sql`json_type(${events.data}, '$.delta') = 'text'`,
    sql`length(CAST(COALESCE(${events.itemId}, json_extract(${events.data}, '$.itemId'), '') AS BLOB)) <= ${compactItemIdMaxBytes}`,
  );
  const compactableBackgroundTask = and(
    eq(events.itemKind, "backgroundTask"),
    sql`json_type(${events.data}, '$.item') = 'object'`,
  );
  const compactableToolCall = and(
    eq(events.itemKind, "toolCall"),
    inArray(events.type, ["item/started", "item/completed"]),
    sql`json_type(${events.data}, '$.item') = 'object'`,
    sql`length(CAST(COALESCE(${events.itemId}, json_extract(${events.data}, '$.item.id'), '') AS BLOB)) <= ${compactItemIdMaxBytes}`,
  );
  const compactableCommandExecution = and(
    eq(events.itemKind, "commandExecution"),
    inArray(events.type, ["item/started", "item/completed"]),
    sql`json_type(${events.data}, '$.item') = 'object'`,
    sql`length(CAST(COALESCE(${events.itemId}, json_extract(${events.data}, '$.item.id'), '') AS BLOB)) <= ${compactItemIdMaxBytes}`,
  );
  const compactableTurnStarted = and(
    eq(events.type, "turn/started"),
    sql`length(CAST(COALESCE(json_extract(${events.data}, '$.parentToolCallId'), '') AS BLOB)) <= 256`,
  );
  const compactableGoalUpdate = and(
    eq(events.type, "thread/goal/updated"),
    sql`json_type(${events.data}, '$.status') = 'text'`,
  );
  const compactableAcceptedInput = and(
    eq(events.type, "turn/input/accepted"),
    sql`json_type(${events.data}, '$.clientRequestId') = 'text'`,
    sql`length(CAST(json_extract(${events.data}, '$.clientRequestId') AS BLOB)) <= 64`,
  );
  const compactDeltaData = sql<string>`CASE
    WHEN ${events.type} = 'item/commandExecution/outputDelta'
      AND json_extract(${events.data}, '$.reset') = 1
    THEN json_object(
      'itemId', COALESCE(${events.itemId}, json_extract(${events.data}, '$.itemId'), 'oversized-item'),
      'delta', substr(json_extract(${events.data}, '$.delta'), 1, ${compactDeltaChars}) || '\n…[oversized event truncated for timeline rendering]\n',
      'reset', json('true')
    )
    ELSE json_object(
      'itemId', COALESCE(${events.itemId}, json_extract(${events.data}, '$.itemId'), 'oversized-item'),
      'delta', substr(json_extract(${events.data}, '$.delta'), 1, ${compactDeltaChars}) || '\n…[oversized event truncated for timeline rendering]\n'
    )
  END`;
  const compactBackgroundTaskData = sql<string>`json_patch(
    json_patch(
      json_object(
        'item', json_object(
          'type', 'backgroundTask',
          'id', substr(COALESCE(json_extract(${events.data}, '$.item.id'), ${events.itemId}, 'oversized-task'), 1, 256),
          'taskType', substr(COALESCE(json_extract(${events.data}, '$.item.taskType'), 'unknown'), 1, 256),
          'description', substr(COALESCE(json_extract(${events.data}, '$.item.description'), 'Background task'), 1, 256) || ' …[large task details omitted]',
          'status', COALESCE(json_extract(${events.data}, '$.item.status'), 'pending'),
          'taskStatus', COALESCE(json_extract(${events.data}, '$.item.taskStatus'), 'running'),
          'skipTranscript', CASE
            WHEN json_extract(${events.data}, '$.item.skipTranscript') = 1 THEN json('true')
            ELSE json('false')
          END
        )
      ),
      CASE
        WHEN json_type(${events.data}, '$.item.workflowName') = 'text'
        THEN json_object('item', json_object('workflowName', substr(json_extract(${events.data}, '$.item.workflowName'), 1, 256)))
        ELSE '{}'
      END
    ),
    CASE
      WHEN json_type(${events.data}, '$.item.parentToolCallId') = 'text'
      THEN json_object('item', json_object('parentToolCallId', substr(json_extract(${events.data}, '$.item.parentToolCallId'), 1, 256)))
      ELSE '{}'
    END
  )`;
  const compactToolCallData = sql<string>`json_patch(
    json_patch(
      json_object(
        'item', json_object(
          'type', 'toolCall',
          'id', COALESCE(${events.itemId}, json_extract(${events.data}, '$.item.id'), 'oversized-tool'),
          'tool', substr(COALESCE(json_extract(${events.data}, '$.item.tool'), 'unknown'), 1, 256),
          'status', COALESCE(json_extract(${events.data}, '$.item.status'), 'failed')
        )
      ),
      CASE
        WHEN json_type(${events.data}, '$.item.server') = 'text'
        THEN json_object('item', json_object('server', substr(json_extract(${events.data}, '$.item.server'), 1, 256)))
        ELSE '{}'
      END
    ),
    CASE
      WHEN json_type(${events.data}, '$.item.parentToolCallId') = 'text'
      THEN json_object('item', json_object('parentToolCallId', substr(json_extract(${events.data}, '$.item.parentToolCallId'), 1, 256)))
      ELSE '{}'
    END
  )`;
  const compactCommandExecutionData = sql<string>`json_patch(
    json_object(
      'item', json_object(
        'type', 'commandExecution',
        'id', COALESCE(${events.itemId}, json_extract(${events.data}, '$.item.id'), 'oversized-command'),
        'command', substr(COALESCE(json_extract(${events.data}, '$.item.command'), 'oversized command'), 1, 512) || ' …[large command details omitted]',
        'cwd', substr(COALESCE(json_extract(${events.data}, '$.item.cwd'), '.'), 1, 256),
        'status', COALESCE(json_extract(${events.data}, '$.item.status'), 'failed'),
        'approvalStatus', json_extract(${events.data}, '$.item.approvalStatus')
      )
    ),
    CASE
      WHEN json_type(${events.data}, '$.item.parentToolCallId') = 'text'
      THEN json_object('item', json_object('parentToolCallId', substr(json_extract(${events.data}, '$.item.parentToolCallId'), 1, 256)))
      ELSE '{}'
    END
  )`;
  const compactTurnStartedData = sql<string>`CASE
    WHEN json_type(${events.data}, '$.parentToolCallId') = 'text'
    THEN json_object('parentToolCallId', json_extract(${events.data}, '$.parentToolCallId'))
    ELSE '{}'
  END`;
  const compactGoalUpdateData = sql<string>`json_object(
    'objective', substr(COALESCE(json_extract(${events.data}, '$.objective'), ''), 1, 512) || ' …[large goal details omitted]',
    'status', json_extract(${events.data}, '$.status'),
    'tokenBudget', json_extract(${events.data}, '$.tokenBudget'),
    'tokensUsed', COALESCE(json_extract(${events.data}, '$.tokensUsed'), 0),
    'timeUsedSeconds', COALESCE(json_extract(${events.data}, '$.timeUsedSeconds'), 0)
  )`;
  const compactAcceptedInputData = sql<string>`json_object(
    'clientRequestId', json_extract(${events.data}, '$.clientRequestId')
  )`;
  const placeholderData = sql<string>`json_object(
    'code', 'timeline_event_payload_too_large',
    'message', 'A ' || ${events.type} || ' event (' || length(CAST(${events.data} AS BLOB)) || ' bytes) was too large to render inline. The stored event was retained.'
  )`;
  const canKeepType = or(
    compactableDelta,
    compactableBackgroundTask,
    compactableToolCall,
    compactableCommandExecution,
    compactableTurnStarted,
    compactableGoalUpdate,
    compactableAcceptedInput,
  );

  return {
    ...storedEventRowFields,
    data: sql<string>`CASE
      WHEN NOT ${oversized} THEN ${events.data}
      WHEN ${compactableDelta} THEN ${compactDeltaData}
      WHEN ${compactableBackgroundTask} THEN ${compactBackgroundTaskData}
      WHEN ${compactableToolCall} THEN ${compactToolCallData}
      WHEN ${compactableCommandExecution} THEN ${compactCommandExecutionData}
      WHEN ${compactableTurnStarted} THEN ${compactTurnStartedData}
      WHEN ${compactableGoalUpdate} THEN ${compactGoalUpdateData}
      WHEN ${compactableAcceptedInput} THEN ${compactAcceptedInputData}
      ELSE ${placeholderData}
    END`,
    itemId: sql<string | null>`CASE
      WHEN ${oversized} AND NOT ${canKeepType} THEN NULL
      ELSE ${events.itemId}
    END`,
    itemKind: sql<ThreadEventItemType | null>`CASE
      WHEN ${oversized} AND NOT ${canKeepType} THEN NULL
      ELSE ${events.itemKind}
    END`,
    type: sql<ThreadEventType>`CASE
      WHEN ${oversized} AND NOT ${canKeepType} THEN 'system/error'
      ELSE ${events.type}
    END`,
  };
}

export type StoredEventRow = Pick<
  typeof events.$inferSelect,
  keyof typeof storedEventRowFields
>;

/**
 * Payload rows selected under both a row ceiling and a cumulative UTF-8 byte
 * ceiling inside SQLite. `dataBytes` retains its historical name, but measures
 * every variable-width text column returned in `rows`, not only `data`.
 */
export interface BoundedStoredEventRowsResult {
  dataBytes: number;
  hasMore: boolean;
  rows: StoredEventRow[];
}

interface ListBoundedStoredEventRowsArgs {
  condition: SQL | undefined;
  excludedRowIds?: readonly string[];
  limit: number;
  maxBytes: number;
  maxDataBytes?: number;
}

interface RawBoundedStoredEventRow {
  createdAt: number | null;
  cumulativeBytes: number;
  data: string | null;
  dataBytes: number;
  hasMore: number;
  id: string | null;
  isMetadata: number;
  itemId: string | null;
  itemKind: ThreadEventItemType | null;
  providerThreadId: string | null;
  scopeKind: ThreadEventScopeKind | null;
  sequence: number | null;
  threadId: string | null;
  turnId: string | null;
  type: ThreadEventType | null;
}

/**
 * Select a contiguous newest-first prefix without allowing rejected payloads
 * to cross the SQLite boundary. The extra candidate used to distinguish row
 * cutoff from exhaustion remains inside the CTE; JavaScript receives only the
 * selected rows and one metadata sentinel.
 */
function listBoundedStoredEventRows(
  db: DbConnection,
  args: ListBoundedStoredEventRowsArgs,
): BoundedStoredEventRowsResult {
  const limit = Math.max(0, Math.floor(args.limit));
  const maxBytes = Math.max(0, Math.floor(args.maxBytes));
  if (limit === 0 || maxBytes === 0) {
    return { dataBytes: 0, hasMore: false, rows: [] };
  }

  const excludedRowIds = [...new Set(args.excludedRowIds ?? [])];
  const condition = and(
    args.condition,
    excludedRowIds.length > 0
      ? notInArray(events.id, excludedRowIds)
      : undefined,
  );
  const fields = boundedStoredEventRowFields(
    Math.min(maxBytes, args.maxDataBytes ?? maxBytes),
  );
  // If compacted data still cannot fit because auxiliary identity metadata is
  // oversized, replace the whole renderable projection instead of truncating
  // an ownership id into a plausible-but-wrong value. Cursor identity remains
  // the stored id/thread/sequence/createdAt tuple.
  const rawRows = db.all<RawBoundedStoredEventRow>(sql`
    WITH
      compacted_raw AS MATERIALIZED (
        SELECT
          ${fields.createdAt} AS createdAt,
          ${fields.data} AS data,
          ${fields.id} AS id,
          ${fields.itemId} AS itemId,
          ${fields.itemKind} AS itemKind,
          ${fields.providerThreadId} AS providerThreadId,
          ${fields.scopeKind} AS scopeKind,
          ${fields.sequence} AS sequence,
          ${fields.threadId} AS threadId,
          ${fields.turnId} AS turnId,
          ${fields.type} AS type
        FROM ${events}
        WHERE ${condition ?? sql`1`}
        ORDER BY ${events.sequence} DESC
        LIMIT ${limit + 1}
      ),
      compacted_measured AS MATERIALIZED (
        SELECT
          compacted_raw.*,
          (
            length(CAST(data AS BLOB))
            + length(CAST(id AS BLOB))
            + length(CAST(COALESCE(itemId, '') AS BLOB))
            + length(CAST(COALESCE(itemKind, '') AS BLOB))
            + length(CAST(COALESCE(providerThreadId, '') AS BLOB))
            + length(CAST(scopeKind AS BLOB))
            + length(CAST(threadId AS BLOB))
            + length(CAST(COALESCE(turnId, '') AS BLOB))
            + length(CAST(type AS BLOB))
          ) AS compactedRowBytes
        FROM compacted_raw
      ),
      compacted AS MATERIALIZED (
        SELECT
          createdAt,
          CASE
            WHEN compactedRowBytes > ${maxBytes}
            THEN json_object(
              'code', 'timeline_event_identity_too_large',
              'message', 'An event contained identity metadata too large to render inline. The stored event was retained.'
            )
            ELSE data
          END AS data,
          id,
          CASE WHEN compactedRowBytes > ${maxBytes} THEN NULL ELSE itemId END AS itemId,
          CASE WHEN compactedRowBytes > ${maxBytes} THEN NULL ELSE itemKind END AS itemKind,
          CASE WHEN compactedRowBytes > ${maxBytes} THEN NULL ELSE providerThreadId END AS providerThreadId,
          CASE WHEN compactedRowBytes > ${maxBytes} THEN 'thread' ELSE scopeKind END AS scopeKind,
          sequence,
          threadId,
          CASE WHEN compactedRowBytes > ${maxBytes} THEN NULL ELSE turnId END AS turnId,
          CASE WHEN compactedRowBytes > ${maxBytes} THEN 'system/error' ELSE type END AS type
        FROM compacted_measured
      ),
      measured AS MATERIALIZED (
        SELECT
          compacted.*,
          (
            length(CAST(data AS BLOB))
            + length(CAST(id AS BLOB))
            + length(CAST(COALESCE(itemId, '') AS BLOB))
            + length(CAST(COALESCE(itemKind, '') AS BLOB))
            + length(CAST(COALESCE(providerThreadId, '') AS BLOB))
            + length(CAST(scopeKind AS BLOB))
            + length(CAST(threadId AS BLOB))
            + length(CAST(COALESCE(turnId, '') AS BLOB))
            + length(CAST(type AS BLOB))
          ) AS rowBytes,
          SUM(
            length(CAST(data AS BLOB))
            + length(CAST(id AS BLOB))
            + length(CAST(COALESCE(itemId, '') AS BLOB))
            + length(CAST(COALESCE(itemKind, '') AS BLOB))
            + length(CAST(COALESCE(providerThreadId, '') AS BLOB))
            + length(CAST(scopeKind AS BLOB))
            + length(CAST(threadId AS BLOB))
            + length(CAST(COALESCE(turnId, '') AS BLOB))
            + length(CAST(type AS BLOB))
          ) OVER (
            ORDER BY sequence DESC
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
          ) AS cumulativeBytes,
          ROW_NUMBER() OVER (ORDER BY sequence DESC) AS selectionRank
        FROM compacted
      ),
      selected AS MATERIALIZED (
        SELECT *
        FROM measured
        WHERE selectionRank <= ${limit}
          AND cumulativeBytes <= ${maxBytes}
      ),
      metadata AS (
        SELECT
          COALESCE(SUM(rowBytes), 0) AS dataBytes,
          CASE
            WHEN (SELECT COUNT(*) FROM measured) > COUNT(*) THEN 1
            ELSE 0
          END AS hasMore
        FROM selected
      )
    SELECT
      createdAt,
      cumulativeBytes,
      data,
      0 AS dataBytes,
      0 AS hasMore,
      id,
      0 AS isMetadata,
      itemId,
      itemKind,
      providerThreadId,
      scopeKind,
      sequence,
      threadId,
      turnId,
      type
    FROM selected
    UNION ALL
    SELECT
      NULL AS createdAt,
      0 AS cumulativeBytes,
      NULL AS data,
      dataBytes,
      hasMore,
      NULL AS id,
      1 AS isMetadata,
      NULL AS itemId,
      NULL AS itemKind,
      NULL AS providerThreadId,
      NULL AS scopeKind,
      NULL AS sequence,
      NULL AS threadId,
      NULL AS turnId,
      NULL AS type
    FROM metadata
    ORDER BY isMetadata, sequence DESC
  `);

  const metadata = rawRows.at(-1);
  if (!metadata || metadata.isMetadata !== 1) {
    throw new Error("Bounded stored event query did not return metadata");
  }
  const rows = rawRows.slice(0, -1).map((row): StoredEventRow => {
    if (
      row.createdAt === null ||
      row.data === null ||
      row.id === null ||
      row.scopeKind === null ||
      row.sequence === null ||
      row.threadId === null ||
      row.type === null
    ) {
      throw new Error("Bounded stored event query returned an invalid row");
    }
    return {
      createdAt: row.createdAt,
      data: row.data,
      id: row.id,
      itemId: row.itemId,
      itemKind: row.itemKind,
      providerThreadId: row.providerThreadId,
      scopeKind: row.scopeKind,
      sequence: row.sequence,
      threadId: row.threadId,
      turnId: row.turnId,
      type: row.type,
    };
  });
  if (rows.length > limit || metadata.dataBytes > maxBytes) {
    throw new Error("Bounded stored event query exceeded its requested budget");
  }
  return {
    dataBytes: metadata.dataBytes,
    hasMore: metadata.hasMore === 1,
    rows,
  };
}

export interface ListStoredEventRowsArgs {
  afterSequence?: number;
  limit?: number;
  threadId: string;
}

export interface FindStoredEventRowArgs {
  afterSequence?: number;
  threadId: string;
  type: ThreadEventType;
}

export interface ListStoredEventRowsInRangeArgs {
  seqEnd: number;
  seqStart: number;
  threadId: string;
}

export interface GetStoredEventIdentityAtSequenceArgs {
  sequence: number;
  threadId: string;
}

export interface StoredEventIdentity {
  id: string;
  sequence: number;
}

export interface HasStoredTurnEventInRangeArgs {
  seqEnd: number;
  seqStart: number;
  threadId: string;
  turnId: string;
}

export interface ListStoredEventRowsByParentToolCallIdsArgs {
  excludedRowIds?: readonly string[];
  excludedTypes?: readonly ThreadEventType[];
  /** Return at most this many newest matching rows. */
  limit: number;
  maxBytes: number;
  parentToolCallIds: readonly string[];
  sequenceEnd?: number;
  sequenceStart?: number;
  threadId: string;
}

export interface ListStoredParentedTurnRangesArgs {
  excludedTypes?: readonly ThreadEventType[];
  parentToolCallIds: readonly string[];
  sequenceEnd?: number;
  sequenceStart?: number;
  threadId: string;
}

export interface ListStoredDelegationChildTurnRangesArgs {
  /** Return only child turns whose first direct event is before this sequence. */
  beforeSequence?: number;
  directTurnSourceSeqEnd: number;
  directTurnSourceSeqStart: number;
  excludedTypes?: readonly ThreadEventType[];
  limit: number;
  ownerTurnId: string;
  parentToolCallId: string;
  sequenceEnd: number;
  sequenceStart: number;
  threadId: string;
}

export interface ListStoredNonemptyDelegationChildTurnBucketIndexesArgs {
  buckets: readonly {
    directTurnSourceSeqEnd: number;
    directTurnSourceSeqStart: number;
  }[];
  excludedTypes?: readonly ThreadEventType[];
  ownerTurnId: string;
  parentToolCallId: string;
  sequenceEnd: number;
  sequenceStart: number;
  threadId: string;
}

export interface ListStoredDelegationDescendantRangesArgs {
  roots: readonly {
    ownerTurnId: string;
    parentToolCallId: string;
  }[];
  sequenceEnd: number;
  sequenceStart: number;
  threadId: string;
}

export interface ListStoredTurnDescendantRangesArgs {
  roots: readonly {
    sourceSeqEnd: number;
    sourceSeqStart: number;
    turnId: string;
  }[];
  sequenceEnd: number;
  threadId: string;
}

export interface ListStoredDelegatedTurnDescendantRangesArgs {
  roots: readonly {
    parentToolCallId: string;
    turnId: string;
  }[];
  sequenceEnd: number;
  sequenceStart: number;
  threadId: string;
}

export interface ListStoredParentedToolCallsArgs {
  parentToolCallIds: readonly string[];
  sequenceEnd?: number;
  sequenceStart?: number;
  threadId: string;
}

export interface StoredParentedToolCall {
  itemId: string;
  turnId: string;
}

export interface StoredParentedTurnRange {
  completedAt: number | null;
  createdAt: number;
  eventCount: number;
  parentToolCallId: string;
  sourceSeqEnd: number;
  sourceSeqStart: number;
  startedAt: number;
  turnId: string;
}

export interface StoredDelegationDescendantRange {
  eventCount: number;
  parentToolCallId: string;
  sourceSeqEnd: number;
  sourceSeqStart: number;
}

export interface StoredTurnDescendantRange {
  descendantSourceSeqEnd: number;
  sourceSeqEnd: number;
  sourceSeqStart: number;
  turnId: string;
}

export interface StoredDelegatedTurnDescendantRange
  extends StoredParentedTurnRange {}

export interface ListStoredEventRowsByThreadIdsAndTypesArgs {
  threadIds: readonly string[];
  types: readonly ThreadEventType[];
}

export interface ListLatestGoalEventRowsByThreadIdsArgs {
  threadIds: readonly string[];
}

export interface ListLatestGoalEventRowsForThreadArgs {
  excludedRowIds?: readonly string[];
  limit: number;
  maxBytes: number;
  threadId: string;
}

export interface ListOpenTurnInputAcceptedRowsByThreadIdsArgs {
  threadIds: readonly string[];
}

export interface ThreadClientTurnRequestKey {
  requestId: ClientTurnRequestId;
  threadId: string;
}

export interface ListStoredClientTurnRequestRowsByKeysArgs {
  keys: readonly ThreadClientTurnRequestKey[];
}

export interface ListStoredToolCallRowsByItemIdsArgs {
  excludedRowIds?: readonly string[];
  itemIds: readonly string[];
  limit: number;
  maxBytes: number;
  sequenceEnd?: number;
  threadId: string;
}

export interface ListStoredItemStartedRowsByItemIdsArgs {
  excludedRowIds?: readonly string[];
  itemIds: readonly string[];
  limit: number;
  maxBytes: number;
  sequenceCutoff?: number;
  threadId: string;
}

export interface ListStoredItemLifecycleOwnerSequencesArgs {
  itemIds: readonly string[];
  seqEnd: number;
  seqStart: number;
  threadId: string;
}

export interface StoredItemLifecycleOwnerSequence {
  itemId: string;
  sequence: number;
}

export interface ListStoredTurnInputAcceptedRowsByClientRequestIdsArgs {
  afterSequence: number;
  beforeOrAtSequence?: number;
  clientRequestIds: readonly ClientTurnRequestId[];
  excludedRowIds?: readonly string[];
  limit: number;
  maxBytes: number;
  threadId: string;
}

export interface ListStoredClientTurnRequestIdsInRangeArgs {
  seqEnd: number;
  seqStart: number;
  threadId: string;
}

export interface FindStoredClientTurnRequestSequenceByRequestIdArgs {
  requestId: ClientTurnRequestId;
  threadId: string;
}

export interface GetStoredTurnRequestEventForTurnArgs {
  threadId: string;
  turnId: string;
}

export interface ListStoredThreadProvisioningRowsByProvisioningIdArgs {
  provisioningId: string;
  threadId: string;
}

export interface GetLatestThreadInterruptedReasonArgs {
  threadId: string;
}

export interface ListStoredTurnStartedRowsByTurnIdsUpToSequenceArgs {
  excludedRowIds?: readonly string[];
  limit: number;
  maxBytes: number;
  sequenceCutoff: number;
  threadId: string;
  turnIds: readonly string[];
}

export interface HasStoredTurnStartedArgs {
  threadId: string;
  turnId: string;
}

export interface ThreadTurnKey {
  threadId: string;
  turnId: string;
}

export interface ListStoredTurnStartedKeysArgs {
  keys: readonly ThreadTurnKey[];
}

export interface ListRecentStoredEventRowsArgs {
  excludedTypes?: readonly ThreadEventType[];
  threadId: string;
}

export interface ListStoredConversationOutlineEventRowsArgs {
  threadId: string;
}

export interface ListStoredTimelineWindowEventRowsArgs {
  beforeSequence?: number;
  excludedTypes?: readonly ThreadEventType[];
  sequenceStart: number;
  threadId: string;
}

export interface ListStoredTimelineWindowEventRowsDescendingArgs
  extends ListStoredTimelineWindowEventRowsArgs {
  excludedRowIds?: readonly string[];
  limit: number;
  maxBytes: number;
}

export interface ListContextWindowUsageRowsArgs {
  excludedRowIds?: readonly string[];
  limit: number;
  maxBytes: number;
  threadId: string;
}

export interface GetLatestThreadOutputEventRowArgs {
  threadId: string;
}

export interface GetLatestThreadSystemErrorEventRowArgs {
  threadId: string;
}

export interface GetLatestThreadSequenceArgs {
  threadId: string;
}

export interface PruneThreadEventsBeforeSequenceArgs {
  sequenceCutoff: number;
  threadId: string;
  types: readonly ThreadEventType[];
}

export interface PruneContextWindowUsageEventsBeforeSequenceArgs {
  sequenceCutoff: number;
  threadId: string;
}

export interface PruneTokenUsageEventsBeforeSequenceArgs {
  sequenceCutoff: number;
  threadId: string;
}

export interface PruneResolvedItemDeltasArgs {
  threadId: string;
}

export interface PruneBackgroundTaskProgressEventsArgs {
  threadId: string;
}

export interface ListOpenBackgroundTaskItemRowsForHostArgs {
  hostId: string;
}

export interface OpenBackgroundTaskItemRow {
  /** Raw data JSON of the latest lifecycle row; carries the item payload. */
  data: string;
  environmentId: string | null;
  itemId: string;
  providerThreadId: string | null;
  threadId: string;
}

export function listEvents(db: DbConnection, options: ListEventsOptions) {
  const { threadId, afterSequence, limit } = options;

  if (afterSequence != null) {
    const q = db
      .select()
      .from(events)
      .where(
        sql`${events.threadId} = ${threadId} AND ${events.sequence} > ${afterSequence}`,
      )
      .orderBy(events.sequence);
    if (limit) return q.limit(limit).all();
    return q.all();
  }

  const q = db
    .select()
    .from(events)
    .where(eq(events.threadId, threadId))
    .orderBy(events.sequence);
  if (limit) return q.limit(limit).all();
  return q.all();
}

export function listStoredEventRows(
  db: DbConnection,
  args: ListStoredEventRowsArgs,
): StoredEventRow[] {
  return db
    .select(storedEventRowFields)
    .from(events)
    .where(
      args.afterSequence === undefined
        ? eq(events.threadId, args.threadId)
        : and(
            eq(events.threadId, args.threadId),
            gt(events.sequence, args.afterSequence),
          ),
    )
    .orderBy(events.sequence)
    .limit(args.limit ?? Number.MAX_SAFE_INTEGER)
    .all();
}

export function listStoredEventRowsByThreadIdsAndTypes(
  db: DbConnection,
  args: ListStoredEventRowsByThreadIdsAndTypesArgs,
): StoredEventRow[] {
  if (args.threadIds.length === 0 || args.types.length === 0) {
    return [];
  }

  return db
    .select(storedEventRowFields)
    .from(events)
    .where(
      and(
        inArray(events.threadId, [...args.threadIds]),
        inArray(events.type, [...args.types]),
      ),
    )
    .orderBy(events.threadId, events.sequence)
    .all();
}

export function listLatestGoalEventRowsByThreadIds(
  db: DbQueryConnection,
  args: ListLatestGoalEventRowsByThreadIdsArgs,
): StoredEventRow[] {
  if (args.threadIds.length === 0) {
    return [];
  }

  const goalTypes = [
    "thread/goal/updated",
    "thread/goal/cleared",
  ] satisfies ThreadEventType[];

  return db
    .select(storedEventRowFields)
    .from(events)
    .where(
      and(
        inArray(events.threadId, [...args.threadIds]),
        inArray(events.type, goalTypes),
        sql`${events.sequence} = (
          SELECT MAX(latest.sequence)
          FROM events latest
          WHERE latest.thread_id = ${events.threadId}
            AND latest.type IN (${goalTypes[0]}, ${goalTypes[1]})
        )`,
      ),
    )
    .orderBy(events.threadId, events.sequence)
    .all();
}

export function listLatestGoalEventRowsForThread(
  db: DbConnection,
  args: ListLatestGoalEventRowsForThreadArgs,
): BoundedStoredEventRowsResult {
  const goalTypes = [
    "thread/goal/updated",
    "thread/goal/cleared",
  ] satisfies ThreadEventType[];
  return listBoundedStoredEventRows(db, {
    condition: and(
      eq(events.threadId, args.threadId),
      inArray(events.type, goalTypes),
      sql`${events.sequence} = (
        SELECT MAX(latest.sequence)
        FROM events latest
        WHERE latest.thread_id = ${events.threadId}
          AND latest.type IN (${goalTypes[0]}, ${goalTypes[1]})
      )`,
    ),
    excludedRowIds: args.excludedRowIds,
    limit: args.limit,
    maxBytes: args.maxBytes,
  });
}

export function listOpenTurnInputAcceptedRowsByThreadIds(
  db: DbQueryConnection,
  args: ListOpenTurnInputAcceptedRowsByThreadIdsArgs,
): StoredEventRow[] {
  if (args.threadIds.length === 0) {
    return [];
  }

  const acceptedType = "turn/input/accepted" satisfies ThreadEventType;
  const completedType = "turn/completed" satisfies ThreadEventType;
  const interruptedType = "system/thread/interrupted" satisfies ThreadEventType;
  const completed = alias(events, "completed_turn_for_accepted_input");

  return db
    .select(storedEventRowFields)
    .from(events)
    .where(
      and(
        inArray(events.threadId, [...args.threadIds]),
        eq(events.type, acceptedType),
        isNotNull(events.turnId),
        sql`${events.sequence} > COALESCE((
          SELECT MAX(interrupted.sequence)
          FROM events interrupted
          WHERE interrupted.thread_id = ${events.threadId}
            AND interrupted.type = ${interruptedType}
        ), -1)`,
        notExists(
          db
            .select({ one: sql`1` })
            .from(completed)
            .where(
              and(
                eq(completed.threadId, events.threadId),
                eq(completed.turnId, events.turnId),
                eq(completed.type, completedType),
              ),
            ),
        ),
      ),
    )
    .orderBy(events.threadId, events.sequence)
    .all();
}

export function listStoredClientTurnRequestRowsByKeys(
  db: DbQueryConnection,
  args: ListStoredClientTurnRequestRowsByKeysArgs,
): StoredEventRow[] {
  const uniqueKeys = [
    ...new Map(
      args.keys.map((key) => [`${key.threadId}\0${key.requestId}`, key]),
    ).values(),
  ];
  if (uniqueKeys.length === 0) {
    return [];
  }

  const requestType = "client/turn/requested" satisfies ThreadEventType;
  const keyConditions = uniqueKeys.map((key) =>
    and(
      eq(events.threadId, key.threadId),
      sql`json_extract(${events.data}, '$.requestId') = ${key.requestId}`,
    ),
  );

  return db
    .select(storedEventRowFields)
    .from(events)
    .where(and(eq(events.type, requestType), or(...keyConditions)))
    .orderBy(events.threadId, events.sequence)
    .all();
}

export function findStoredEventRow(
  db: DbConnection,
  args: FindStoredEventRowArgs,
): StoredEventRow | null {
  return (
    db
      .select(storedEventRowFields)
      .from(events)
      .where(
        args.afterSequence !== undefined
          ? and(
              eq(events.threadId, args.threadId),
              eq(events.type, args.type),
              gt(events.sequence, args.afterSequence),
            )
          : and(eq(events.threadId, args.threadId), eq(events.type, args.type)),
      )
      .orderBy(events.sequence)
      .limit(1)
      .get() ?? null
  );
}

export function listStoredEventRowsInRange(
  db: DbConnection,
  args: ListStoredEventRowsInRangeArgs,
): StoredEventRow[] {
  return db
    .select(storedEventRowFields)
    .from(events)
    .where(
      and(
        eq(events.threadId, args.threadId),
        gte(events.sequence, args.seqStart),
        lte(events.sequence, args.seqEnd),
      ),
    )
    .orderBy(events.sequence)
    .all();
}

export function getStoredEventIdentityAtSequence(
  db: DbConnection,
  args: GetStoredEventIdentityAtSequenceArgs,
): StoredEventIdentity | null {
  return (
    db
      .select({ id: events.id, sequence: events.sequence })
      .from(events)
      .where(
        and(
          eq(events.threadId, args.threadId),
          eq(events.sequence, args.sequence),
        ),
      )
      .limit(1)
      .get() ?? null
  );
}

export function hasStoredTurnEventInRange(
  db: DbConnection,
  args: HasStoredTurnEventInRangeArgs,
): boolean {
  return (
    db
      .select({ id: events.id })
      .from(events)
      .where(
        and(
          eq(events.threadId, args.threadId),
          eq(events.turnId, args.turnId),
          gte(events.sequence, args.seqStart),
          lte(events.sequence, args.seqEnd),
        ),
      )
      .limit(1)
      .get() !== undefined
  );
}

export function listStoredEventRowsByParentToolCallIds(
  db: DbConnection,
  args: ListStoredEventRowsByParentToolCallIdsArgs,
): BoundedStoredEventRowsResult {
  const parentToolCallIds = [...new Set(args.parentToolCallIds)].filter(
    (parentToolCallId) => parentToolCallId.length > 0,
  );
  if (parentToolCallIds.length === 0) {
    return { dataBytes: 0, hasMore: false, rows: [] };
  }

  const eventParentToolCallId = sql<string>`json_extract(${events.data}, '$.parentToolCallId')`;
  const itemParentToolCallId = sql<string>`json_extract(${events.data}, '$.item.parentToolCallId')`;
  const conditions: SQL[] = [
    eq(events.threadId, args.threadId),
    or(
      inArray(eventParentToolCallId, parentToolCallIds),
      inArray(itemParentToolCallId, parentToolCallIds),
    )!,
  ];
  if (args.excludedTypes && args.excludedTypes.length > 0) {
    conditions.push(notInArray(events.type, [...args.excludedTypes]));
  }
  if (args.sequenceStart !== undefined) {
    conditions.push(gte(events.sequence, args.sequenceStart));
  }
  if (args.sequenceEnd !== undefined) {
    conditions.push(lte(events.sequence, args.sequenceEnd));
  }

  const result = listBoundedStoredEventRows(db, {
    condition: and(...conditions),
    excludedRowIds: args.excludedRowIds,
    limit: args.limit,
    maxBytes: args.maxBytes,
  });
  return { ...result, rows: result.rows.reverse() };
}

export function listStoredParentedTurnRanges(
  db: DbConnection,
  args: ListStoredParentedTurnRangesArgs,
): StoredParentedTurnRange[] {
  const parentToolCallIds = [...new Set(args.parentToolCallIds)].filter(
    (parentToolCallId) => parentToolCallId.length > 0,
  );
  if (parentToolCallIds.length === 0) {
    return [];
  }

  const parentToolCallId = sql<string>`COALESCE(
    json_extract(${events.data}, '$.item.parentToolCallId'),
    json_extract(${events.data}, '$.parentToolCallId')
  )`;
  const conditions: SQL[] = [
    eq(events.threadId, args.threadId),
    isNotNull(events.turnId),
    inArray(parentToolCallId, parentToolCallIds),
  ];
  if (args.excludedTypes && args.excludedTypes.length > 0) {
    conditions.push(notInArray(events.type, [...args.excludedTypes]));
  }
  if (args.sequenceStart !== undefined) {
    conditions.push(gte(events.sequence, args.sequenceStart));
  }
  if (args.sequenceEnd !== undefined) {
    conditions.push(lte(events.sequence, args.sequenceEnd));
  }

  return db
    .select({
      completedAt: sql<number | null>`MAX(CASE WHEN ${events.type} = 'turn/completed' THEN ${events.createdAt} END)`,
      createdAt: max(events.createdAt),
      eventCount: count(),
      parentToolCallId,
      sourceSeqEnd: max(events.sequence),
      sourceSeqStart: min(events.sequence),
      startedAt: min(events.createdAt),
      turnId: events.turnId,
    })
    .from(events)
    .where(and(...conditions))
    .groupBy(parentToolCallId, events.turnId)
    .all()
    .flatMap((row) =>
      row.turnId === null ||
      row.sourceSeqStart === null ||
      row.sourceSeqEnd === null ||
      row.startedAt === null ||
      row.createdAt === null
        ? []
        : [
            {
              ...row,
              turnId: row.turnId,
              sourceSeqStart: row.sourceSeqStart,
              sourceSeqEnd: row.sourceSeqEnd,
              startedAt: row.startedAt,
              createdAt: row.createdAt,
            },
          ],
    );
}

/**
 * Page direct child-turn identities for one delegation. The grouped result is
 * bounded before it leaves SQLite; descendant work is deliberately excluded
 * and becomes reachable through the child's own delegation boundaries.
 */
export function listStoredDelegationChildTurnRanges(
  db: DbConnection,
  args: ListStoredDelegationChildTurnRangesArgs,
): StoredParentedTurnRange[] {
  if (
    args.parentToolCallId.length === 0 ||
    args.limit <= 0 ||
    args.sequenceStart > args.sequenceEnd ||
    args.directTurnSourceSeqStart > args.directTurnSourceSeqEnd
  ) {
    return [];
  }

  const parentToolCallId = sql<string>`COALESCE(
    json_extract(${events.data}, '$.item.parentToolCallId'),
    json_extract(${events.data}, '$.parentToolCallId')
  )`;
  const conditions: SQL[] = [
    eq(events.threadId, args.threadId),
    isNotNull(events.turnId),
    ne(events.turnId, args.ownerTurnId),
    eq(parentToolCallId, args.parentToolCallId),
    gte(events.sequence, args.sequenceStart),
    lte(events.sequence, args.sequenceEnd),
  ];
  if (args.excludedTypes && args.excludedTypes.length > 0) {
    conditions.push(notInArray(events.type, [...args.excludedTypes]));
  }

  const completeSnapshotRanges = db
    .select({
      completedAt:
        sql<number | null>`MAX(CASE WHEN ${events.type} = 'turn/completed' THEN ${events.createdAt} END)`.as(
          "completed_at",
        ),
      createdAt: max(events.createdAt).as("created_at"),
      eventCount: count().as("event_count"),
      parentToolCallId: parentToolCallId.as("parent_tool_call_id"),
      sourceSeqEnd: max(events.sequence).as("source_seq_end"),
      sourceSeqStart: min(events.sequence).as("source_seq_start"),
      startedAt: min(events.createdAt).as("started_at"),
      turnId: events.turnId,
    })
    .from(events)
    .where(and(...conditions))
    .groupBy(parentToolCallId, events.turnId)
    .as("complete_delegation_child_turn_ranges");
  const intervalConditions: SQL[] = [
    gte(
      completeSnapshotRanges.sourceSeqStart,
      args.directTurnSourceSeqStart,
    ),
    lte(completeSnapshotRanges.sourceSeqStart, args.directTurnSourceSeqEnd),
  ];
  if (args.beforeSequence !== undefined) {
    intervalConditions.push(
      lt(completeSnapshotRanges.sourceSeqStart, args.beforeSequence),
    );
  }
  const rows = db
    .select()
    .from(completeSnapshotRanges)
    .where(and(...intervalConditions))
    .orderBy(
      desc(completeSnapshotRanges.sourceSeqStart),
      desc(completeSnapshotRanges.turnId),
    )
    .limit(args.limit)
    .all();

  return rows.flatMap((row) =>
    row.turnId === null ||
    row.sourceSeqStart === null ||
    row.sourceSeqEnd === null ||
    row.startedAt === null ||
    row.createdAt === null
      ? []
      : [
          {
            ...row,
            turnId: row.turnId,
            sourceSeqStart: row.sourceSeqStart,
            sourceSeqEnd: row.sourceSeqEnd,
            startedAt: row.startedAt,
            createdAt: row.createdAt,
          },
        ],
  );
}

/**
 * Return only candidate bucket indexes that contain a direct delegated turn.
 * Direct turns are grouped once across the complete immutable snapshot before
 * their MIN(sequence) anchors are joined to the supplied buckets. The result
 * is therefore bounded by bucket count and never exposes child identities.
 */
export function listStoredNonemptyDelegationChildTurnBucketIndexes(
  db: DbConnection,
  args: ListStoredNonemptyDelegationChildTurnBucketIndexesArgs,
): number[] {
  const buckets = args.buckets.flatMap((bucket, bucketIndex) =>
    bucket.directTurnSourceSeqStart <= bucket.directTurnSourceSeqEnd
      ? [{ ...bucket, bucketIndex }]
      : [],
  );
  if (
    buckets.length === 0 ||
    args.parentToolCallId.length === 0 ||
    args.sequenceStart > args.sequenceEnd
  ) {
    return [];
  }
  const excludedTypes = JSON.stringify(args.excludedTypes ?? []);
  const rows = db.all<{ bucketIndex: number }>(sql`
    WITH
      buckets(
        bucket_index,
        direct_turn_source_seq_start,
        direct_turn_source_seq_end
      ) AS (
        SELECT
          CAST(json_extract(value, '$.bucketIndex') AS INTEGER),
          CAST(json_extract(value, '$.directTurnSourceSeqStart') AS INTEGER),
          CAST(json_extract(value, '$.directTurnSourceSeqEnd') AS INTEGER)
        FROM json_each(${JSON.stringify(buckets)})
      ),
      complete_child_turns(source_seq_start) AS MATERIALIZED (
        SELECT MIN(child.sequence)
        FROM events AS child
        WHERE child.thread_id = ${args.threadId}
          AND child.turn_id IS NOT NULL
          AND child.turn_id <> ${args.ownerTurnId}
          AND child.sequence >= ${args.sequenceStart}
          AND child.sequence <= ${args.sequenceEnd}
          AND COALESCE(
            json_extract(child.data, '$.item.parentToolCallId'),
            json_extract(child.data, '$.parentToolCallId')
          ) = ${args.parentToolCallId}
          AND NOT EXISTS (
            SELECT 1
            FROM json_each(${excludedTypes}) AS excluded
            WHERE excluded.value = child.type
          )
        GROUP BY child.turn_id
      )
    SELECT bucket.bucket_index AS bucketIndex
    FROM buckets AS bucket
    JOIN complete_child_turns AS child
      ON child.source_seq_start >= bucket.direct_turn_source_seq_start
     AND child.source_seq_start <= bucket.direct_turn_source_seq_end
    GROUP BY bucket.bucket_index
    ORDER BY bucket.bucket_index
    LIMIT ${buckets.length}
  `);
  return rows.map((row) => row.bucketIndex);
}

/**
 * Resolve the complete descendant extent for bounded visible delegation
 * roots. SQLite performs the graph walk and returns one scalar row per input
 * root, so neither event payloads nor descendant identities enter JS memory.
 * UNION (rather than UNION ALL) makes malformed cycles terminate.
 */
export function listStoredDelegationDescendantRanges(
  db: DbConnection,
  args: ListStoredDelegationDescendantRangesArgs,
): StoredDelegationDescendantRange[] {
  const roots = [
    ...new Map(
      args.roots
        .filter(
          (root) =>
            root.ownerTurnId.length > 0 && root.parentToolCallId.length > 0,
        )
        .map((root) => [
          `${root.ownerTurnId}\0${root.parentToolCallId}`,
          root,
        ]),
    ).values(),
  ];
  if (roots.length === 0) {
    return [];
  }

  const rows = db.all<{
    eventCount: number;
    parentToolCallId: string;
    sourceSeqEnd: number;
    sourceSeqStart: number;
  }>(sql`
    WITH RECURSIVE
      roots(owner_turn_id, parent_tool_call_id) AS (
        SELECT
          CAST(json_extract(value, '$.ownerTurnId') AS TEXT),
          CAST(json_extract(value, '$.parentToolCallId') AS TEXT)
        FROM json_each(${JSON.stringify(roots)})
      ),
      reachable_parent_ids(
        root_parent_tool_call_id,
        owner_turn_id,
        parent_tool_call_id
      ) AS (
        SELECT parent_tool_call_id, owner_turn_id, parent_tool_call_id
        FROM roots
        UNION
        SELECT
          reachable.root_parent_tool_call_id,
          reachable.owner_turn_id,
          child.item_id
        FROM reachable_parent_ids AS reachable
        JOIN events AS child
         ON child.thread_id = ${args.threadId}
         AND child.item_kind = 'toolCall'
         AND child.item_id IS NOT NULL
         AND child.turn_id <> reachable.owner_turn_id
         AND child.sequence <= ${args.sequenceEnd}
         AND child.item_id <> reachable.root_parent_tool_call_id
         AND COALESCE(
           json_extract(child.data, '$.item.parentToolCallId'),
           json_extract(child.data, '$.parentToolCallId')
         ) = reachable.parent_tool_call_id
      ),
      reachable_turn_ids(root_parent_tool_call_id, turn_id) AS (
        SELECT DISTINCT
          reachable.root_parent_tool_call_id,
          child.turn_id
        FROM reachable_parent_ids AS reachable
        JOIN events AS child
          ON child.thread_id = ${args.threadId}
         AND child.sequence >= ${args.sequenceStart}
         AND child.sequence <= ${args.sequenceEnd}
         AND child.turn_id IS NOT NULL
         AND child.turn_id <> reachable.owner_turn_id
         AND COALESCE(
           json_extract(child.data, '$.item.parentToolCallId'),
           json_extract(child.data, '$.parentToolCallId')
         ) = reachable.parent_tool_call_id
      ),
      descendant_events(root_parent_tool_call_id, id, sequence) AS (
        SELECT
          reachable.root_parent_tool_call_id,
          child.id,
          child.sequence
        FROM reachable_parent_ids AS reachable
        JOIN events AS child
          ON child.thread_id = ${args.threadId}
         AND child.sequence >= ${args.sequenceStart}
         AND child.sequence <= ${args.sequenceEnd}
         AND child.turn_id <> reachable.owner_turn_id
         AND COALESCE(
           json_extract(child.data, '$.item.parentToolCallId'),
           json_extract(child.data, '$.parentToolCallId')
         ) = reachable.parent_tool_call_id
        UNION
        SELECT
          reachable_turn.root_parent_tool_call_id,
          lifecycle.id,
          lifecycle.sequence
        FROM reachable_turn_ids AS reachable_turn
        JOIN events AS lifecycle
          ON lifecycle.thread_id = ${args.threadId}
         AND lifecycle.turn_id = reachable_turn.turn_id
         AND lifecycle.type IN ('turn/started', 'turn/completed')
         AND lifecycle.sequence >= ${args.sequenceStart}
         AND lifecycle.sequence <= ${args.sequenceEnd}
      )
    SELECT
      descendant.root_parent_tool_call_id AS parentToolCallId,
      COUNT(descendant.id) AS eventCount,
      MAX(descendant.sequence) AS sourceSeqEnd,
      MIN(descendant.sequence) AS sourceSeqStart
    FROM descendant_events AS descendant
    GROUP BY descendant.root_parent_tool_call_id
  `);
  return rows;
}

/**
 * Resolve the maximum descendant extent of each visible turn range without
 * returning one row per delegation or child turn.
 */
export function listStoredTurnDescendantRanges(
  db: DbConnection,
  args: ListStoredTurnDescendantRangesArgs,
): StoredTurnDescendantRange[] {
  const roots = [
    ...new Map(
      args.roots
        .filter(
          (root) =>
            root.turnId.length > 0 && root.sourceSeqStart <= root.sourceSeqEnd,
        )
        .map((root) => [
          `${root.turnId}\0${root.sourceSeqStart}\0${root.sourceSeqEnd}`,
          root,
        ]),
    ).values(),
  ];
  if (roots.length === 0) {
    return [];
  }

  return db.all<StoredTurnDescendantRange>(sql`
    WITH RECURSIVE
      roots(turn_id, source_seq_start, source_seq_end) AS (
        SELECT
          CAST(json_extract(value, '$.turnId') AS TEXT),
          CAST(json_extract(value, '$.sourceSeqStart') AS INTEGER),
          CAST(json_extract(value, '$.sourceSeqEnd') AS INTEGER)
        FROM json_each(${JSON.stringify(roots)})
      ),
      reachable_parent_ids(
        root_turn_id,
        root_source_seq_start,
        root_source_seq_end,
        parent_tool_call_id
      ) AS (
        SELECT
          roots.turn_id,
          roots.source_seq_start,
          roots.source_seq_end,
          direct.item_id
        FROM roots
        JOIN events AS direct
          ON direct.thread_id = ${args.threadId}
         AND direct.turn_id = roots.turn_id
         AND direct.sequence >= roots.source_seq_start
         AND direct.sequence <= roots.source_seq_end
         AND direct.item_kind = 'toolCall'
         AND direct.item_id IS NOT NULL
        UNION
        SELECT
          reachable.root_turn_id,
          reachable.root_source_seq_start,
          reachable.root_source_seq_end,
          child.item_id
        FROM reachable_parent_ids AS reachable
        JOIN events AS child
          ON child.thread_id = ${args.threadId}
         AND child.sequence <= ${args.sequenceEnd}
         AND child.item_kind = 'toolCall'
         AND child.item_id IS NOT NULL
         AND COALESCE(
           json_extract(child.data, '$.item.parentToolCallId'),
           json_extract(child.data, '$.parentToolCallId')
         ) = reachable.parent_tool_call_id
      ),
      reachable_turn_ids(
        root_turn_id,
        root_source_seq_start,
        root_source_seq_end,
        turn_id
      ) AS (
        SELECT DISTINCT
          reachable.root_turn_id,
          reachable.root_source_seq_start,
          reachable.root_source_seq_end,
          child.turn_id
        FROM reachable_parent_ids AS reachable
        JOIN events AS child
          ON child.thread_id = ${args.threadId}
         AND child.sequence >= reachable.root_source_seq_start
         AND child.sequence <= ${args.sequenceEnd}
         AND child.turn_id IS NOT NULL
         AND COALESCE(
           json_extract(child.data, '$.item.parentToolCallId'),
           json_extract(child.data, '$.parentToolCallId')
         ) = reachable.parent_tool_call_id
      ),
      descendant_events(
        root_turn_id,
        root_source_seq_start,
        root_source_seq_end,
        id,
        sequence
      ) AS (
        SELECT
          reachable.root_turn_id,
          reachable.root_source_seq_start,
          reachable.root_source_seq_end,
          child.id,
          child.sequence
        FROM reachable_parent_ids AS reachable
        JOIN events AS child
          ON child.thread_id = ${args.threadId}
         AND child.sequence >= reachable.root_source_seq_start
         AND child.sequence <= ${args.sequenceEnd}
         AND COALESCE(
           json_extract(child.data, '$.item.parentToolCallId'),
           json_extract(child.data, '$.parentToolCallId')
         ) = reachable.parent_tool_call_id
        UNION
        SELECT
          reachable_turn.root_turn_id,
          reachable_turn.root_source_seq_start,
          reachable_turn.root_source_seq_end,
          lifecycle.id,
          lifecycle.sequence
        FROM reachable_turn_ids AS reachable_turn
        JOIN events AS lifecycle
          ON lifecycle.thread_id = ${args.threadId}
         AND lifecycle.turn_id = reachable_turn.turn_id
         AND lifecycle.type IN ('turn/started', 'turn/completed')
         AND lifecycle.sequence >= reachable_turn.root_source_seq_start
         AND lifecycle.sequence <= ${args.sequenceEnd}
      )
    SELECT
      descendant.root_turn_id AS turnId,
      descendant.root_source_seq_start AS sourceSeqStart,
      descendant.root_source_seq_end AS sourceSeqEnd,
      MAX(descendant.sequence) AS descendantSourceSeqEnd
    FROM descendant_events AS descendant
    GROUP BY
      descendant.root_turn_id,
      descendant.root_source_seq_start,
      descendant.root_source_seq_end
  `);
}

/**
 * Resolve direct child-turn metadata plus the maximum extent of each selected
 * turn's nested delegation graph. The number of returned rows is exactly
 * bounded by the supplied root batch.
 */
export function listStoredDelegatedTurnDescendantRanges(
  db: DbConnection,
  args: ListStoredDelegatedTurnDescendantRangesArgs,
): StoredDelegatedTurnDescendantRange[] {
  const roots = [
    ...new Map(
      args.roots
        .filter(
          (root) =>
            root.parentToolCallId.length > 0 && root.turnId.length > 0,
        )
        .map((root) => [
          `${root.parentToolCallId}\0${root.turnId}`,
          root,
        ]),
    ).values(),
  ];
  if (roots.length === 0) {
    return [];
  }

  const rows = db.all<{
    completedAt: number | null;
    createdAt: number;
    eventCount: number;
    parentToolCallId: string;
    sourceSeqEnd: number;
    sourceSeqStart: number;
    startedAt: number;
    turnId: string;
  }>(sql`
    WITH RECURSIVE
      roots(parent_tool_call_id, turn_id) AS (
        SELECT
          CAST(json_extract(value, '$.parentToolCallId') AS TEXT),
          CAST(json_extract(value, '$.turnId') AS TEXT)
        FROM json_each(${JSON.stringify(roots)})
      ),
      direct_events_for_ancestry AS (
        SELECT
          roots.parent_tool_call_id,
          roots.turn_id,
          child.id,
          child.item_id,
          child.item_kind,
          child.type,
          child.sequence,
          child.created_at
        FROM roots
        JOIN events AS child
         ON child.thread_id = ${args.threadId}
         AND child.turn_id = roots.turn_id
         AND child.sequence <= ${args.sequenceEnd}
         AND (
           child.type IN ('turn/started', 'turn/completed')
           OR COALESCE(
             json_extract(child.data, '$.item.parentToolCallId'),
             json_extract(child.data, '$.parentToolCallId')
           ) = roots.parent_tool_call_id
         )
      ),
      direct_events AS (
        SELECT *
        FROM direct_events_for_ancestry
        WHERE sequence >= ${args.sequenceStart}
      ),
      reachable_parent_ids(parent_tool_call_id, turn_id, nested_parent_tool_call_id) AS (
        SELECT parent_tool_call_id, turn_id, item_id
        FROM direct_events_for_ancestry
        WHERE item_kind = 'toolCall'
          AND item_id IS NOT NULL
          AND item_id <> parent_tool_call_id
        UNION
        SELECT
          reachable.parent_tool_call_id,
          reachable.turn_id,
          child.item_id
        FROM reachable_parent_ids AS reachable
        JOIN events AS child
         ON child.thread_id = ${args.threadId}
         AND child.item_kind = 'toolCall'
         AND child.item_id IS NOT NULL
         AND child.sequence <= ${args.sequenceEnd}
         AND child.item_id <> reachable.parent_tool_call_id
         AND COALESCE(
           json_extract(child.data, '$.item.parentToolCallId'),
           json_extract(child.data, '$.parentToolCallId')
         ) = reachable.nested_parent_tool_call_id
      ),
      descendant_extents AS (
        SELECT
          reachable.parent_tool_call_id,
          reachable.turn_id,
          COUNT(child.id) AS descendant_event_count,
          MAX(child.sequence) AS descendant_source_seq_end
        FROM reachable_parent_ids AS reachable
        JOIN events AS child
          ON child.thread_id = ${args.threadId}
         AND child.sequence >= ${args.sequenceStart}
         AND child.sequence <= ${args.sequenceEnd}
         AND COALESCE(
           json_extract(child.data, '$.item.parentToolCallId'),
           json_extract(child.data, '$.parentToolCallId')
         ) = reachable.nested_parent_tool_call_id
        GROUP BY reachable.parent_tool_call_id, reachable.turn_id
      )
    SELECT
      direct.parent_tool_call_id AS parentToolCallId,
      direct.turn_id AS turnId,
      MIN(direct.sequence) AS sourceSeqStart,
      MAX(
        MAX(direct.sequence),
        COALESCE(extent.descendant_source_seq_end, MAX(direct.sequence))
      ) AS sourceSeqEnd,
      COUNT(direct.id) + COALESCE(extent.descendant_event_count, 0) AS eventCount,
      MIN(direct.created_at) AS startedAt,
      MAX(direct.created_at) AS createdAt,
      MAX(CASE WHEN direct.type = 'turn/completed' THEN direct.created_at END) AS completedAt
    FROM direct_events AS direct
    LEFT JOIN descendant_extents AS extent
      ON extent.parent_tool_call_id = direct.parent_tool_call_id
     AND extent.turn_id = direct.turn_id
    GROUP BY direct.parent_tool_call_id, direct.turn_id
  `);
  return rows;
}

/**
 * Discover nested delegation identities without loading their event payloads.
 * Recursive timeline range discovery must not depend on whether a tool-call
 * row fits inside the separate projection enrichment budget.
 */
export function listStoredParentedToolCalls(
  db: DbConnection,
  args: ListStoredParentedToolCallsArgs,
): StoredParentedToolCall[] {
  const parentToolCallIds = [...new Set(args.parentToolCallIds)].filter(
    (parentToolCallId) => parentToolCallId.length > 0,
  );
  if (parentToolCallIds.length === 0) {
    return [];
  }

  const parentToolCallId = sql<string>`COALESCE(
    json_extract(${events.data}, '$.item.parentToolCallId'),
    json_extract(${events.data}, '$.parentToolCallId')
  )`;
  const conditions: SQL[] = [
    eq(events.threadId, args.threadId),
    eq(events.itemKind, "toolCall"),
    isNotNull(events.itemId),
    isNotNull(events.turnId),
    inArray(parentToolCallId, parentToolCallIds),
  ];
  if (args.sequenceStart !== undefined) {
    conditions.push(gte(events.sequence, args.sequenceStart));
  }
  if (args.sequenceEnd !== undefined) {
    conditions.push(lte(events.sequence, args.sequenceEnd));
  }

  return db
    .select({ itemId: events.itemId, turnId: events.turnId })
    .from(events)
    .where(and(...conditions))
    .groupBy(events.itemId, events.turnId)
    .all()
    .flatMap((row) =>
      row.itemId === null || row.turnId === null
        ? []
        : [{ itemId: row.itemId, turnId: row.turnId }],
    );
}

export function listStoredToolCallRowsByItemIds(
  db: DbConnection,
  args: ListStoredToolCallRowsByItemIdsArgs,
): BoundedStoredEventRowsResult {
  const itemIds = [...new Set(args.itemIds)].filter(
    (itemId) => itemId.length > 0,
  );
  if (itemIds.length === 0) {
    return { dataBytes: 0, hasMore: false, rows: [] };
  }

  const conditions: SQL[] = [
    eq(events.threadId, args.threadId),
    inArray(events.itemId, itemIds),
    eq(events.itemKind, "toolCall"),
    inArray(events.type, ["item/started", "item/completed"]),
  ];
  if (args.sequenceEnd !== undefined) {
    conditions.push(lte(events.sequence, args.sequenceEnd));
  }

  const result = listBoundedStoredEventRows(db, {
    condition: and(...conditions),
    excludedRowIds: args.excludedRowIds,
    limit: args.limit,
    maxBytes: args.maxBytes,
  });
  return { ...result, rows: result.rows.reverse() };
}

export function listStoredItemStartedRowsByItemIds(
  db: DbConnection,
  args: ListStoredItemStartedRowsByItemIdsArgs,
): BoundedStoredEventRowsResult {
  const itemIds = [...new Set(args.itemIds)].filter(
    (itemId) => itemId.length > 0,
  );
  if (itemIds.length === 0) {
    return { dataBytes: 0, hasMore: false, rows: [] };
  }
  const conditions: SQL[] = [
    eq(events.threadId, args.threadId),
    eq(events.type, "item/started"),
    inArray(events.itemId, itemIds),
  ];
  if (args.sequenceCutoff !== undefined) {
    conditions.push(lte(events.sequence, args.sequenceCutoff));
  }
  const result = listBoundedStoredEventRows(db, {
    condition: and(...conditions),
    excludedRowIds: args.excludedRowIds,
    limit: args.limit,
    maxBytes: args.maxBytes,
  });
  return { ...result, rows: result.rows.reverse() };
}

export function listStoredItemLifecycleOwnerSequences(
  db: DbConnection,
  args: ListStoredItemLifecycleOwnerSequencesArgs,
): StoredItemLifecycleOwnerSequence[] {
  const itemIds = [...new Set(args.itemIds)].filter(
    (itemId) => itemId.length > 0,
  );
  if (itemIds.length === 0 || args.seqStart > args.seqEnd) {
    return [];
  }
  return db
    .select({ itemId: events.itemId, sequence: max(events.sequence) })
    .from(events)
    .where(
      and(
        eq(events.threadId, args.threadId),
        isNotNull(events.itemId),
        inArray(events.itemId, itemIds),
        inArray(events.type, ["item/started", "item/completed"]),
        gte(events.sequence, args.seqStart),
        lte(events.sequence, args.seqEnd),
      ),
    )
    .groupBy(events.itemId)
    .all()
    .flatMap((row) =>
      row.itemId === null || row.sequence === null
        ? []
        : [{ itemId: row.itemId, sequence: row.sequence }],
    );
}

export function listStoredClientTurnRequestIdsInRange(
  db: DbConnection,
  args: ListStoredClientTurnRequestIdsInRangeArgs,
): ClientTurnRequestId[] {
  const rows = db
    .select({
      requestId: sql<string | null>`json_extract(${events.data}, '$.requestId')`,
    })
    .from(events)
    .where(
      and(
        eq(events.threadId, args.threadId),
        eq(events.type, "client/turn/requested"),
        gte(events.sequence, args.seqStart),
        lte(events.sequence, args.seqEnd),
      ),
    )
    .orderBy(events.sequence)
    .all();

  return rows.map((row) => clientTurnRequestIdSchema.parse(row.requestId));
}

export function findStoredClientTurnRequestSequenceByRequestId(
  db: DbQueryConnection,
  args: FindStoredClientTurnRequestSequenceByRequestIdArgs,
): number | null {
  const row =
    db
      .select({
        sequence: events.sequence,
      })
      .from(events)
      .where(
        and(
          eq(events.threadId, args.threadId),
          eq(events.type, "client/turn/requested"),
          sql`json_extract(${events.data}, '$.requestId') = ${args.requestId}`,
        ),
      )
      .limit(1)
      .get() ?? null;
  return row?.sequence ?? null;
}

export function getStoredTurnRequestEventForTurn(
  db: DbQueryConnection,
  args: GetStoredTurnRequestEventForTurnArgs,
): StoredTurnRequestEventRow | null {
  const acceptedInput =
    db
      .select({
        clientRequestId: sql<string | null>`json_extract(${events.data}, '$.clientRequestId')`,
      })
      .from(events)
      .where(
        and(
          eq(events.threadId, args.threadId),
          eq(events.turnId, args.turnId),
          eq(events.type, "turn/input/accepted"),
        ),
      )
      .orderBy(desc(events.sequence))
      .limit(1)
      .get() ?? null;
  const requestIdResult = clientTurnRequestIdSchema.safeParse(
    acceptedInput?.clientRequestId,
  );
  if (!requestIdResult.success) {
    return null;
  }

  return (
    db
      .select({
        data: events.data,
        sequence: events.sequence,
        threadId: events.threadId,
        type: events.type,
      })
      .from(events)
      .where(
        and(
          eq(events.threadId, args.threadId),
          eq(events.type, "client/turn/requested"),
          sql`json_extract(${events.data}, '$.requestId') = ${requestIdResult.data}`,
        ),
      )
      .limit(1)
      .get() ?? null
  );
}

export function listStoredTurnInputAcceptedRowsByClientRequestIds(
  db: DbConnection,
  args: ListStoredTurnInputAcceptedRowsByClientRequestIdsArgs,
): BoundedStoredEventRowsResult {
  if (args.clientRequestIds.length === 0) {
    return { dataBytes: 0, hasMore: false, rows: [] };
  }

  const clientRequestIdConditions = args.clientRequestIds.map(
    (clientRequestId) =>
      sql`json_extract(${events.data}, '$.clientRequestId') = ${clientRequestId}`,
  );

  const result = listBoundedStoredEventRows(db, {
    condition: and(
        eq(events.threadId, args.threadId),
        eq(events.type, "turn/input/accepted"),
        gt(events.sequence, args.afterSequence),
        ...(args.beforeOrAtSequence === undefined
          ? []
          : [lte(events.sequence, args.beforeOrAtSequence)]),
        or(...clientRequestIdConditions),
      ),
    excludedRowIds: args.excludedRowIds,
    limit: args.limit,
    maxBytes: args.maxBytes,
  });
  return { ...result, rows: result.rows.reverse() };
}

export function listStoredThreadProvisioningRowsByProvisioningId(
  db: DbQueryConnection,
  args: ListStoredThreadProvisioningRowsByProvisioningIdArgs,
): StoredEventRow[] {
  return db
    .select(storedEventRowFields)
    .from(events)
    .where(
      and(
        eq(events.threadId, args.threadId),
        eq(events.type, "system/thread-provisioning"),
        sql`json_extract(${events.data}, '$.provisioningId') = ${args.provisioningId}`,
      ),
    )
    .orderBy(events.sequence)
    .all();
}

export function getLatestThreadInterruptedReason(
  db: DbQueryConnection,
  args: GetLatestThreadInterruptedReasonArgs,
): SystemThreadInterruptedReason | null {
  const row = db
    .select({
      reason: sql<string>`json_extract(${events.data}, '$.reason')`,
    })
    .from(events)
    .where(
      and(
        eq(events.threadId, args.threadId),
        eq(events.type, "system/thread/interrupted"),
      ),
    )
    .orderBy(desc(events.sequence))
    .limit(1)
    .get();
  if (!row) {
    return null;
  }
  return systemThreadInterruptedReasonSchema.parse(row.reason);
}

export function listStoredTurnStartedRowsByTurnIdsUpToSequence(
  db: DbConnection,
  args: ListStoredTurnStartedRowsByTurnIdsUpToSequenceArgs,
): BoundedStoredEventRowsResult {
  if (args.turnIds.length === 0) {
    return { dataBytes: 0, hasMore: false, rows: [] };
  }

  const result = listBoundedStoredEventRows(db, {
    condition: and(
        eq(events.threadId, args.threadId),
        eq(events.type, "turn/started"),
        inArray(events.turnId, [...args.turnIds]),
        lte(events.sequence, args.sequenceCutoff),
      ),
    excludedRowIds: args.excludedRowIds,
    limit: args.limit,
    maxBytes: args.maxBytes,
  });
  return { ...result, rows: result.rows.reverse() };
}

export interface ListLatestBackgroundTaskStateRowsByItemIdsArgs {
  excludedRowIds?: readonly string[];
  itemIds: readonly string[];
  limit: number;
  maxBytes: number;
  maxDataBytes?: number;
  sequenceCutoff?: number;
  threadId: string;
}

export interface ListLatestOpenBackgroundTaskStateRowsForThreadArgs {
  excludedRowIds?: readonly string[];
  limit: number;
  maxBytes: number;
  maxDataBytes?: number;
  threadId: string;
}

export interface ListActiveBackgroundTaskCountsByThreadIdsArgs {
  threadIds: readonly string[];
}

export interface ActiveBackgroundTaskCountRow {
  activeBackgroundAgentCount: number;
  activeBackgroundCommandCount: number;
  activeWorkflowCount: number;
  threadId: string;
}

/**
 * Latest thread-scoped lifecycle row per backgroundTask item, optionally
 * bounded by a captured timeline range. Live windows omit the cutoff and see
 * current state; immutable completed-detail ranges supply it.
 */
export function listLatestBackgroundTaskStateRowsByItemIds(
  db: DbConnection,
  args: ListLatestBackgroundTaskStateRowsByItemIdsArgs,
): BoundedStoredEventRowsResult {
  if (args.itemIds.length === 0) {
    return { dataBytes: 0, hasMore: false, rows: [] };
  }

  const stateTypes = [
    "item/backgroundTask/progress",
    "item/backgroundTask/completed",
  ] satisfies ThreadEventType[];
  const latest = alias(events, "latest_background_task_state");

  // (threadId, sequence) is unique, so matching the per-item MAX(sequence)
  // set selects exactly one row per item in SQL instead of loading every
  // snapshot row and folding in JS.
  const result = listBoundedStoredEventRows(db, {
    condition: and(
        eq(events.threadId, args.threadId),
        inArray(
          events.sequence,
          db
            .select({ sequence: max(latest.sequence) })
            .from(latest)
            .where(
              and(
                eq(latest.threadId, args.threadId),
                inArray(latest.itemId, [...args.itemIds]),
                inArray(latest.type, stateTypes),
                ...(args.sequenceCutoff === undefined
                  ? []
                  : [lte(latest.sequence, args.sequenceCutoff)]),
              ),
            )
            .groupBy(latest.itemId),
        ),
      ),
    excludedRowIds: args.excludedRowIds,
    limit: args.limit,
    maxBytes: args.maxBytes,
    maxDataBytes: args.maxDataBytes,
  });
  return { ...result, rows: result.rows.reverse() };
}

/**
 * Latest non-terminal lifecycle row per open backgroundTask item in a thread.
 * Open tasks can outlive the latest timeline window; these rows let latest-page
 * projections surface active workflow/background-command state even when the
 * spawning turn and progress row are outside the selected event window.
 */
export function listLatestOpenBackgroundTaskStateRowsForThread(
  db: DbConnection,
  args: ListLatestOpenBackgroundTaskStateRowsForThreadArgs,
): BoundedStoredEventRowsResult {
  const startedType = "item/started" satisfies ThreadEventType;
  const progressType =
    "item/backgroundTask/progress" satisfies ThreadEventType;
  const completedType =
    "item/backgroundTask/completed" satisfies ThreadEventType;
  const completed = alias(events, "completed_background_task_state");

  const result = listBoundedStoredEventRows(db, {
    condition: and(
        eq(events.threadId, args.threadId),
        eq(events.itemKind, "backgroundTask"),
        inArray(events.type, [startedType, progressType]),
        isNotNull(events.itemId),
        sql`json_extract(${events.data}, '$.item.status') = 'pending'`,
        notExists(
          db
            .select({ one: sql`1` })
            .from(completed)
            .where(
              and(
                eq(completed.threadId, events.threadId),
                eq(completed.itemId, events.itemId),
                eq(completed.type, completedType),
              ),
            ),
        ),
        sql`${events.sequence} = (
          SELECT MAX(latest.sequence)
          FROM events latest
          WHERE latest.thread_id = ${events.threadId}
            AND latest.item_id = ${events.itemId}
            AND latest.type IN (${startedType}, ${progressType})
        )`,
      ),
    excludedRowIds: args.excludedRowIds,
    limit: args.limit,
    maxBytes: args.maxBytes,
    maxDataBytes: args.maxDataBytes,
  });
  return { ...result, rows: result.rows.reverse() };
}

/**
 * Counts open provider background tasks by thread, using each item's latest
 * start/progress row. A task can report a terminal status in a progress row
 * before the final completed event arrives, so active means the latest
 * lifecycle snapshot still has item.status = "pending".
 */
export function listActiveBackgroundTaskCountsByThreadIds(
  db: DbQueryConnection,
  args: ListActiveBackgroundTaskCountsByThreadIdsArgs,
): ActiveBackgroundTaskCountRow[] {
  if (args.threadIds.length === 0) {
    return [];
  }

  const startedType = "item/started" satisfies ThreadEventType;
  const progressType =
    "item/backgroundTask/progress" satisfies ThreadEventType;
  const completedType =
    "item/backgroundTask/completed" satisfies ThreadEventType;

  return db.all<ActiveBackgroundTaskCountRow>(sql`
    WITH latest_background_task_activity AS (
      SELECT
        ${events.threadId} AS thread_id,
        ${events.itemId} AS item_id,
        MAX(${events.sequence}) AS sequence
      FROM ${events}
      WHERE ${inArray(events.threadId, [...args.threadIds])}
        AND ${eq(events.itemKind, "backgroundTask")}
        AND ${inArray(events.type, [startedType, progressType])}
        AND ${isNotNull(events.itemId)}
      GROUP BY ${events.threadId}, ${events.itemId}
    ),
    completed_background_task_activity AS (
      SELECT DISTINCT
        ${events.threadId} AS thread_id,
        ${events.itemId} AS item_id
      FROM ${events}
      WHERE ${inArray(events.threadId, [...args.threadIds])}
        AND ${eq(events.itemKind, "backgroundTask")}
        AND ${eq(events.type, completedType)}
        AND ${isNotNull(events.itemId)}
    )
    SELECT
      active_event.thread_id AS threadId,
      SUM(
        CASE
          WHEN json_extract(active_event.data, '$.item.taskType') =
            ${LOCAL_WORKFLOW_TASK_TYPE}
          THEN 1
          ELSE 0
        END
      ) AS activeWorkflowCount,
      SUM(
        CASE
          WHEN json_extract(active_event.data, '$.item.taskType') IN (
            ${LOCAL_AGENT_TASK_TYPE},
            ${LOCAL_SUBAGENT_TASK_TYPE}
          )
          THEN 1
          ELSE 0
        END
      ) AS activeBackgroundAgentCount,
      SUM(
        CASE
          WHEN json_extract(active_event.data, '$.item.taskType') =
            ${LOCAL_BASH_TASK_TYPE}
          THEN 1
          ELSE 0
        END
      ) AS activeBackgroundCommandCount
    FROM latest_background_task_activity latest
    JOIN events active_event
      ON active_event.thread_id = latest.thread_id
      AND active_event.sequence = latest.sequence
    LEFT JOIN completed_background_task_activity completed
      ON completed.thread_id = latest.thread_id
      AND completed.item_id = latest.item_id
    WHERE completed.item_id IS NULL
      AND json_extract(active_event.data, '$.item.status') = 'pending'
      AND json_extract(active_event.data, '$.item.taskType') IN (
        ${LOCAL_WORKFLOW_TASK_TYPE},
        ${LOCAL_AGENT_TASK_TYPE},
        ${LOCAL_SUBAGENT_TASK_TYPE},
        ${LOCAL_BASH_TASK_TYPE}
      )
      AND COALESCE(
        json_extract(active_event.data, '$.item.skipTranscript'),
        0
      ) = 0
    GROUP BY active_event.thread_id
    ORDER BY active_event.thread_id
  `);
}

function listStoredTurnStartedKeysChunk(
  db: DbQueryConnection,
  keys: readonly ThreadTurnKey[],
): ThreadTurnKey[] {
  const turnConditions = keys.map((key) =>
    and(eq(events.threadId, key.threadId), eq(events.turnId, key.turnId)),
  );

  const rows = db
    .select({ threadId: events.threadId, turnId: events.turnId })
    .from(events)
    .where(and(eq(events.type, "turn/started"), or(...turnConditions)))
    .all();

  return rows.flatMap((row) =>
    row.turnId === null
      ? []
      : [{ threadId: row.threadId, turnId: row.turnId }],
  );
}

export function listStoredTurnStartedKeys(
  db: DbQueryConnection,
  args: ListStoredTurnStartedKeysArgs,
): ThreadTurnKey[] {
  if (args.keys.length === 0) {
    return [];
  }

  const uniqueKeys = listUniqueThreadTurnKeys(args.keys);
  const rows: ThreadTurnKey[] = [];
  for (
    let offset = 0;
    offset < uniqueKeys.length;
    offset += STORED_EVENT_SEQUENCE_LOOKUP_CHUNK_SIZE
  ) {
    rows.push(
      ...listStoredTurnStartedKeysChunk(
        db,
        uniqueKeys.slice(
          offset,
          offset + STORED_EVENT_SEQUENCE_LOOKUP_CHUNK_SIZE,
        ),
      ),
    );
  }
  return rows;
}

export function hasStoredTurnStarted(
  db: DbQueryConnection,
  args: HasStoredTurnStartedArgs,
): boolean {
  const row = db
    .select({ sequence: events.sequence })
    .from(events)
    .where(
      and(
        eq(events.threadId, args.threadId),
        eq(events.type, "turn/started"),
        eq(events.turnId, args.turnId),
      ),
    )
    .limit(1)
    .get();

  return row !== undefined;
}

export function hasRootStoredTurnStarted(
  db: DbQueryConnection,
  args: HasStoredTurnStartedArgs,
): boolean {
  const row = db
    .select({ sequence: events.sequence })
    .from(events)
    .where(
      and(
        eq(events.threadId, args.threadId),
        eq(events.type, "turn/started"),
        eq(events.turnId, args.turnId),
        isRootTurnStartedEventData,
      ),
    )
    .limit(1)
    .get();

  return row !== undefined;
}

export function listRecentStoredEventRows(
  db: DbConnection,
  args: ListRecentStoredEventRowsArgs,
): StoredEventRow[] {
  const condition =
    args.excludedTypes && args.excludedTypes.length > 0
      ? and(
          eq(events.threadId, args.threadId),
          notInArray(events.type, [...args.excludedTypes]),
        )
      : eq(events.threadId, args.threadId);

  return db
    .select(storedEventRowFields)
    .from(events)
    .where(condition)
    .orderBy(events.sequence)
    .all();
}

/**
 * The conversation outline renders only user/assistant messages. Selecting
 * command, tool, diff, goal, and usage events made its cost scale with all work
 * performed in a thread even though none of those rows can reach the result.
 */
export function listStoredConversationOutlineEventRows(
  db: DbConnection,
  args: ListStoredConversationOutlineEventRowsArgs,
): StoredEventRow[] {
  const directConversationTypes = [
    "client/turn/requested",
    "turn/input/accepted",
    "turn/started",
    "turn/completed",
    "item/agentMessage/delta",
    "system/manager/user_message",
  ] satisfies ThreadEventType[];
  const agentItemTypes = [
    "item/started",
    "item/completed",
  ] satisfies ThreadEventType[];

  return db
    .select(storedEventRowFields)
    .from(events)
    .where(
      and(
        eq(events.threadId, args.threadId),
        or(
          inArray(events.type, directConversationTypes),
          and(
            inArray(events.type, agentItemTypes),
            or(
              eq(events.itemKind, "agentMessage"),
              sql`json_extract(${events.data}, '$.item.type') = 'agentMessage'`,
            ),
          ),
        ),
      ),
    )
    .orderBy(events.sequence)
    .all();
}

export interface StandardTimelineSegmentAnchorRow {
  rowId: string;
  sequence: number;
}

function timelineSegmentAnchorSelection() {
  return {
    rowId: sql<string>`${events.threadId} || ':user-seed:' || ${events.sequence}`,
    sequence: events.sequence,
  };
}

function timelineSegmentAnchorConditions(threadId: string): SQL | undefined {
  return and(
    eq(events.threadId, threadId),
    eq(events.type, "client/turn/requested"),
    sql`(
      COALESCE(json_extract(${events.data}, '$.target.kind'), 'new-turn')
        IN ('thread-start', 'new-turn')
      OR (
        json_extract(${events.data}, '$.target.kind') = 'auto'
        AND json_extract(${events.data}, '$.target.expectedTurnId') IS NULL
      )
    )`,
    sql`EXISTS (
      SELECT 1
      FROM json_each(${events.data}, '$.input') AS input_part
      WHERE (
        json_extract(input_part.value, '$.type') = 'text'
        AND COALESCE(json_extract(input_part.value, '$.text'), '') <> ''
      )
      OR json_extract(input_part.value, '$.type')
        IN ('image', 'localImage', 'localFile')
    )`,
  );
}

export interface ListTimelineSegmentAnchorsDescendingArgs {
  threadId: string;
  /** Restrict to anchors strictly before this sequence (exclusive). */
  beforeSequence?: number;
  limit: number;
}

/**
 * Newest-first segment anchors, bounded by `limit` (and optionally by
 * `beforeSequence`). Lets the timeline resolve a page's window without
 * enumerating every anchor in the thread.
 */
export function listTimelineSegmentAnchorsDescending(
  db: DbConnection,
  args: ListTimelineSegmentAnchorsDescendingArgs,
): StandardTimelineSegmentAnchorRow[] {
  const conditions = timelineSegmentAnchorConditions(args.threadId);
  const where =
    args.beforeSequence === undefined
      ? conditions
      : and(conditions, lt(events.sequence, args.beforeSequence));
  return db
    .select(timelineSegmentAnchorSelection())
    .from(events)
    .where(where)
    .orderBy(desc(events.sequence))
    .limit(args.limit)
    .all();
}

export interface TimelineSegmentAnchorLookupArgs {
  threadId: string;
  sequence: number;
}

/** The first segment anchor strictly after `sequence`, if any. */
export function findTimelineSegmentAnchorSequenceAfter(
  db: DbConnection,
  args: TimelineSegmentAnchorLookupArgs,
): number | undefined {
  const row = db
    .select({ sequence: events.sequence })
    .from(events)
    .where(
      and(
        timelineSegmentAnchorConditions(args.threadId),
        gt(events.sequence, args.sequence),
      ),
    )
    .orderBy(events.sequence)
    .limit(1)
    .get();
  return row?.sequence;
}

/** The segment anchor at exactly `sequence`, if that turn qualifies as one. */
export function getTimelineSegmentAnchorAtSequence(
  db: DbConnection,
  args: TimelineSegmentAnchorLookupArgs,
): StandardTimelineSegmentAnchorRow | undefined {
  return db
    .select(timelineSegmentAnchorSelection())
    .from(events)
    .where(
      and(
        timelineSegmentAnchorConditions(args.threadId),
        eq(events.sequence, args.sequence),
      ),
    )
    .limit(1)
    .get();
}

export function listStoredTimelineWindowEventRows(
  db: DbConnection,
  args: ListStoredTimelineWindowEventRowsArgs,
): StoredEventRow[] {
  const conditions: SQL[] = [
    eq(events.threadId, args.threadId),
    gte(events.sequence, args.sequenceStart),
  ];
  if (args.beforeSequence !== undefined) {
    conditions.push(lt(events.sequence, args.beforeSequence));
  }
  if (args.excludedTypes && args.excludedTypes.length > 0) {
    conditions.push(notInArray(events.type, [...args.excludedTypes]));
  }

  return db
    .select(storedEventRowFields)
    .from(events)
    .where(and(...conditions))
    .orderBy(events.sequence)
    .all();
}

/**
 * Reads only the newest part of a timeline sequence range. Callers use the
 * descending order to enforce a byte budget before decoding event JSON.
 */
export function listStoredTimelineWindowEventRowsDescending(
  db: DbConnection,
  args: ListStoredTimelineWindowEventRowsDescendingArgs,
): BoundedStoredEventRowsResult {
  const conditions: SQL[] = [
    eq(events.threadId, args.threadId),
    gte(events.sequence, args.sequenceStart),
  ];
  if (args.beforeSequence !== undefined) {
    conditions.push(lt(events.sequence, args.beforeSequence));
  }
  if (args.excludedTypes && args.excludedTypes.length > 0) {
    conditions.push(notInArray(events.type, [...args.excludedTypes]));
  }

  return listBoundedStoredEventRows(db, {
    condition: and(...conditions),
    excludedRowIds: args.excludedRowIds,
    limit: args.limit,
    maxBytes: args.maxBytes,
  });
}

export function listContextWindowUsageRows(
  db: DbConnection,
  args: ListContextWindowUsageRowsArgs,
): BoundedStoredEventRowsResult {
  const eventType =
    "thread/contextWindowUsage/updated" satisfies ThreadEventType;
  const condition = and(
    eq(events.threadId, args.threadId),
    eq(events.type, eventType),
    isNotNestedTurnUsageEvent,
    or(
      sql`${events.sequence} = (
        SELECT MAX(latest.sequence)
        FROM events latest
        WHERE latest.thread_id = ${args.threadId}
          AND latest.type = ${eventType}
          AND NOT EXISTS (
            SELECT 1
            FROM events AS nested_turn_started
            WHERE nested_turn_started.thread_id = latest.thread_id
              AND nested_turn_started.turn_id = latest.turn_id
              AND nested_turn_started.type = 'turn/started'
              AND COALESCE(json_extract(nested_turn_started.data, '$.parentToolCallId'), '') <> ''
          )
      )`,
      sql`${events.sequence} = (
        SELECT MAX(latest.sequence)
        FROM events latest
        WHERE latest.thread_id = ${args.threadId}
          AND latest.type = ${eventType}
          AND json_extract(
            latest.data,
            '$.contextWindowUsage.modelContextWindow'
          ) IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM events AS nested_turn_started
            WHERE nested_turn_started.thread_id = latest.thread_id
              AND nested_turn_started.turn_id = latest.turn_id
              AND nested_turn_started.type = 'turn/started'
              AND COALESCE(json_extract(nested_turn_started.data, '$.parentToolCallId'), '') <> ''
          )
      )`,
    ),
  );
  const result = listBoundedStoredEventRows(db, {
    condition,
    excludedRowIds: args.excludedRowIds,
    limit: args.limit,
    maxBytes: args.maxBytes,
  });
  return { ...result, rows: result.rows.reverse() };
}

export function getLatestThreadOutputEventRow(
  db: DbConnection,
  args: GetLatestThreadOutputEventRowArgs,
): StoredEventRow | null {
  return (
    db
      .select(storedEventRowFields)
      .from(events)
      .where(
        sql`${events.threadId} = ${args.threadId} AND (
        (
          ${events.type} = 'system/manager/user_message'
          AND COALESCE(json_extract(${events.data}, '$.text'), '') <> ''
        )
        OR (
          ${events.type} = 'item/completed'
          AND ${events.itemKind} = 'agentMessage'
          AND COALESCE(json_extract(${events.data}, '$.item.text'), '') <> ''
        )
      )`,
      )
      .orderBy(desc(events.sequence))
      .limit(1)
      .get() ?? null
  );
}

export function getLatestThreadSystemErrorEventRow(
  db: DbConnection,
  args: GetLatestThreadSystemErrorEventRowArgs,
): StoredEventRow | null {
  return (
    db
      .select(storedEventRowFields)
      .from(events)
      .where(
        and(eq(events.threadId, args.threadId), eq(events.type, "system/error")),
      )
      .orderBy(desc(events.sequence))
      .limit(1)
      .get() ?? null
  );
}

export function getLatestThreadSequence(
  db: DbConnection,
  args: GetLatestThreadSequenceArgs,
): number {
  const row = db
    .select({
      maxSequence: max(events.sequence),
    })
    .from(events)
    .where(eq(events.threadId, args.threadId))
    .get();

  return row?.maxSequence ?? 0;
}

export function getActiveStoredTurnId(
  db: DbQueryConnection,
  threadId: string,
): string | null {
  const latestStarted = db
    .select({ turnId: events.turnId })
    .from(events)
    .where(
      and(
        eq(events.threadId, threadId),
        eq(events.type, "turn/started"),
        isNotNull(events.turnId),
        isRootTurnStartedEventData,
      ),
    )
    .orderBy(desc(events.sequence))
    .limit(1)
    .get();

  if (!latestStarted?.turnId) {
    return null;
  }

  const completed = db
    .select({ sequence: events.sequence })
    .from(events)
    .where(
      and(
        eq(events.threadId, threadId),
        eq(events.turnId, latestStarted.turnId),
        eq(events.type, "turn/completed"),
      ),
    )
    .limit(1)
    .get();

  return completed ? null : latestStarted.turnId;
}

export function getLastStoredProviderThreadId(
  db: DbQueryConnection,
  threadId: string,
): string | null {
  const latestProviderRow = db
    .select({ providerThreadId: events.providerThreadId })
    .from(events)
    .where(
      sql`${events.threadId} = ${threadId}
        AND ${events.providerThreadId} IS NOT NULL`,
    )
    .orderBy(sql`${events.sequence} DESC`)
    .limit(1)
    .get();
  if (!latestProviderRow?.providerThreadId) {
    return null;
  }

  const latestIdentityRow = db
    .select({ sequence: events.sequence })
    .from(events)
    .where(
      and(
        eq(events.threadId, threadId),
        eq(events.type, "thread/identity"),
        isNotNull(events.providerThreadId),
      ),
    )
    .orderBy(desc(events.sequence))
    .limit(1)
    .get();
  const latestEnvironmentDirectoryUpdateRow = db
    .select({ sequence: events.sequence })
    .from(events)
    .where(
      and(
        eq(events.threadId, threadId),
        eq(events.type, "system/operation"),
        isEnvironmentDirectoryUpdateEventData,
      ),
    )
    .orderBy(desc(events.sequence))
    .limit(1)
    .get();

  if (
    latestEnvironmentDirectoryUpdateRow &&
    (!latestIdentityRow ||
      latestIdentityRow.sequence < latestEnvironmentDirectoryUpdateRow.sequence)
  ) {
    return null;
  }

  return latestProviderRow.providerThreadId;
}

export function getStoredProviderThreadIdAtOrBeforeSequence(
  db: DbQueryConnection,
  args: {
    sequence: number;
    threadId: string;
  },
): string | null {
  const row = db
    .select({ providerThreadId: events.providerThreadId })
    .from(events)
    .where(
      sql`${events.threadId} = ${args.threadId}
        AND ${events.sequence} <= ${args.sequence}
        AND ${events.providerThreadId} IS NOT NULL`,
    )
    .orderBy(sql`${events.sequence} DESC`)
    .limit(1)
    .get();
  return row?.providerThreadId ?? null;
}

export function listThreadTurnInterruptionEventStates(
  db: DbQueryConnection,
  args: ListThreadTurnInterruptionEventStatesArgs,
): ThreadTurnInterruptionEventState[] {
  const threadIds = [...new Set(args.threadIds)];
  if (threadIds.length === 0) {
    return [];
  }

  const statesByThreadId = new Map<string, ThreadTurnInterruptionEventState>(
    threadIds.map((threadId) => [
      threadId,
      {
        activeTurnId: null,
        latestProviderThreadId: null,
        threadId,
      },
    ]),
  );

  const latestStartedTurnRows = db
    .select({
      threadId: events.threadId,
      turnId: events.turnId,
    })
    .from(events)
    .where(
      and(
        inArray(events.threadId, threadIds),
        eq(events.type, "turn/started"),
        isNotNull(events.turnId),
        isRootTurnStartedEventData,
        sql`${events.sequence} = (
          SELECT MAX(latest.sequence)
          FROM events AS latest
          WHERE latest.thread_id = ${events.threadId}
            AND latest.type = 'turn/started'
            AND latest.turn_id IS NOT NULL
            AND COALESCE(json_extract(latest.data, '$.parentToolCallId'), '') = ''
        )`,
        sql`NOT EXISTS (
          SELECT 1
          FROM events AS completed
          WHERE completed.thread_id = ${events.threadId}
            AND completed.turn_id = ${events.turnId}
            AND completed.type = 'turn/completed'
        )`,
      ),
    )
    .all();
  for (const row of latestStartedTurnRows) {
    if (row.turnId === null) {
      continue;
    }
    const state = statesByThreadId.get(row.threadId);
    if (state) {
      state.activeTurnId = row.turnId;
    }
  }

  const latestProviderRows = db
    .select({
      providerThreadId: events.providerThreadId,
      threadId: events.threadId,
    })
    .from(events)
    .where(
      and(
        inArray(events.threadId, threadIds),
        isNotNull(events.providerThreadId),
        sql`${events.sequence} = (
          SELECT MAX(latest.sequence)
          FROM events AS latest
          WHERE latest.thread_id = ${events.threadId}
            AND latest.provider_thread_id IS NOT NULL
        )`,
      ),
    )
    .all();
  for (const row of latestProviderRows) {
    if (row.providerThreadId === null) {
      continue;
    }
    const state = statesByThreadId.get(row.threadId);
    if (state) {
      state.latestProviderThreadId = row.providerThreadId;
    }
  }

  return threadIds.flatMap((threadId) => {
    const state = statesByThreadId.get(threadId);
    return state ? [state] : [];
  });
}

export function listThreadIdsWithLatestHostDaemonRestartInterruption(
  db: DbConnection,
  args: ListThreadIdsWithLatestHostDaemonRestartInterruptionArgs,
): string[] {
  if (args.threadIds.length === 0) {
    return [];
  }

  return db
    .select({ threadId: events.threadId })
    .from(events)
    .where(
      and(
        inArray(events.threadId, [...args.threadIds]),
        eq(events.type, "system/thread/interrupted"),
        sql`json_extract(${events.data}, '$.reason') = 'host-daemon-restarted'`,
        sql`${events.sequence} = (
          SELECT MAX(latest.sequence)
          FROM events AS latest
          WHERE latest.thread_id = ${events.threadId}
        )`,
      ),
    )
    .all()
    .map((row) => row.threadId);
}

export function getLastStoredTurnRequestEvent(
  db: DbQueryConnection,
  threadId: string,
): StoredTurnRequestEventRow | null {
  return (
    db
      .select({
        data: events.data,
        sequence: events.sequence,
        threadId: events.threadId,
        type: events.type,
      })
      .from(events)
      .where(
        sql`${events.threadId} = ${threadId}
        AND (
          ${events.type} = 'client/turn/requested'
          OR (
            ${events.type} IN ('client/thread/start', 'client/turn/start')
            AND json_type(${events.data}, '$.input') IS NOT NULL
          )
        )`,
      )
      .orderBy(sql`${events.sequence} DESC`)
      .limit(1)
      .get() ?? null
  );
}

export function listCompletedTurnsByThreadIds(
  db: DbQueryConnection,
  threadIds: readonly string[],
): CompletedStoredTurnRow[] {
  if (threadIds.length === 0) {
    return [];
  }

  return db
    .select({
      threadId: events.threadId,
      turnId: events.turnId,
    })
    .from(events)
    .where(
      and(
        inArray(events.threadId, [...threadIds]),
        eq(events.type, "turn/completed"),
        isNotNull(events.turnId),
      ),
    )
    .all()
    .flatMap((row) =>
      row.turnId === null
        ? []
        : [
            {
              threadId: row.threadId,
              turnId: row.turnId,
            },
          ],
    );
}

export function pruneThreadEventsBeforeSequence(
  db: DbConnection,
  args: PruneThreadEventsBeforeSequenceArgs,
): number {
  if (args.sequenceCutoff <= 0 || args.types.length === 0) {
    return 0;
  }

  const result = db
    .delete(events)
    .where(
      and(
        eq(events.threadId, args.threadId),
        lte(events.sequence, args.sequenceCutoff),
        inArray(events.type, [...args.types]),
      ),
    )
    .run();

  return result.changes;
}

function pruneLatestRowsForContextWindowUsageBeforeSequence(
  db: DbConnection,
  args: {
    contextWindowJsonPath: string;
    eventType:
      | "thread/contextWindowUsage/updated"
      | "thread/tokenUsage/updated";
    sequenceCutoff: number;
    threadId: string;
  },
): number {
  if (args.sequenceCutoff <= 0) {
    return 0;
  }

  // The timeline needs the latest root-turn totals row plus the latest older
  // root-turn row that still carries a non-null modelContextWindow. Usage from
  // nested turns belongs to subagents and must not replace either report.
  const result = db.run(
    sql`WITH root_usage AS (
          SELECT usage.id, usage.sequence, usage.data
          FROM events AS usage
          WHERE usage.thread_id = ${args.threadId}
            AND usage.type = ${args.eventType}
            AND NOT EXISTS (
              SELECT 1
              FROM events AS nested_turn_started
              WHERE nested_turn_started.thread_id = usage.thread_id
                AND nested_turn_started.turn_id = usage.turn_id
                AND nested_turn_started.type = 'turn/started'
                AND COALESCE(json_extract(nested_turn_started.data, '$.parentToolCallId'), '') <> ''
            )
        )
        DELETE FROM events
        WHERE ${events.threadId} = ${args.threadId}
          AND ${events.type} = ${args.eventType}
          AND ${events.sequence} <= ${args.sequenceCutoff}
          AND ${events.id} NOT IN (
            SELECT root_usage.id
            FROM root_usage
            ORDER BY root_usage.sequence DESC
            LIMIT 1
          )
          AND ${events.id} NOT IN (
            SELECT root_usage.id
            FROM root_usage
            WHERE json_extract(root_usage.data, ${args.contextWindowJsonPath}) IS NOT NULL
            ORDER BY root_usage.sequence DESC
            LIMIT 1
          )`,
  );

  return result.changes;
}

export function pruneContextWindowUsageEventsBeforeSequence(
  db: DbConnection,
  args: PruneContextWindowUsageEventsBeforeSequenceArgs,
): number {
  return pruneLatestRowsForContextWindowUsageBeforeSequence(db, {
    threadId: args.threadId,
    sequenceCutoff: args.sequenceCutoff,
    eventType: "thread/contextWindowUsage/updated",
    contextWindowJsonPath: "$.contextWindowUsage.modelContextWindow",
  });
}

export function pruneTokenUsageEventsBeforeSequence(
  db: DbConnection,
  args: PruneTokenUsageEventsBeforeSequenceArgs,
): number {
  return pruneLatestRowsForContextWindowUsageBeforeSequence(db, {
    threadId: args.threadId,
    sequenceCutoff: args.sequenceCutoff,
    eventType: "thread/tokenUsage/updated",
    contextWindowJsonPath: "$.tokenUsage.modelContextWindow",
  });
}

export function pruneResolvedItemDeltas(
  db: DbConnection,
  args: PruneResolvedItemDeltasArgs,
): number {
  type PrunableResolvedDeltaEventType = Extract<
    ThreadEventType,
    | "item/agentMessage/delta"
    | "item/commandExecution/outputDelta"
    | "item/reasoning/summaryTextDelta"
    | "item/reasoning/textDelta"
  >;
  type PrunableResolvedDeltaCompletionItemKind = Extract<
    ThreadEventItemType,
    "agentMessage" | "commandExecution" | "reasoning"
  >;

  // File-change output deltas and plan deltas are intentionally excluded here:
  // their completed events do not carry a replayable aggregate for the streamed
  // text. Once a completed command row has aggregatedOutput, all matching
  // command output deltas are redundant regardless of reset markers.
  const prunableDeltaMatches = {
    "item/agentMessage/delta": "agentMessage",
    "item/commandExecution/outputDelta": "commandExecution",
    "item/reasoning/summaryTextDelta": "reasoning",
    "item/reasoning/textDelta": "reasoning",
  } satisfies Record<
    PrunableResolvedDeltaEventType,
    PrunableResolvedDeltaCompletionItemKind
  >;
  const itemCompletedType = "item/completed" satisfies ThreadEventType;

  const result = db.run(
    sql`DELETE FROM events
        WHERE ${events.threadId} = ${args.threadId}
          AND ${events.type} IN (
            ${"item/agentMessage/delta" satisfies PrunableResolvedDeltaEventType},
            ${"item/commandExecution/outputDelta" satisfies PrunableResolvedDeltaEventType},
            ${"item/reasoning/summaryTextDelta" satisfies PrunableResolvedDeltaEventType},
            ${"item/reasoning/textDelta" satisfies PrunableResolvedDeltaEventType}
          )
          AND ${events.itemId} IS NOT NULL
          AND ${events.turnId} IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM events completed
            WHERE completed.thread_id = ${events.threadId}
              AND completed.turn_id = ${events.turnId}
              AND completed.type = ${itemCompletedType}
              AND completed.item_kind = CASE
                WHEN ${events.type} = ${"item/agentMessage/delta" satisfies PrunableResolvedDeltaEventType}
                  THEN ${prunableDeltaMatches["item/agentMessage/delta"]}
                WHEN ${events.type} = ${"item/commandExecution/outputDelta" satisfies PrunableResolvedDeltaEventType}
                  THEN ${prunableDeltaMatches["item/commandExecution/outputDelta"]}
                WHEN ${events.type} = ${"item/reasoning/summaryTextDelta" satisfies PrunableResolvedDeltaEventType}
                  THEN ${prunableDeltaMatches["item/reasoning/summaryTextDelta"]}
                WHEN ${events.type} = ${"item/reasoning/textDelta" satisfies PrunableResolvedDeltaEventType}
                  THEN ${prunableDeltaMatches["item/reasoning/textDelta"]}
              END
              AND completed.item_id = ${events.itemId}
              AND (
                ${events.type} <> ${"item/commandExecution/outputDelta" satisfies PrunableResolvedDeltaEventType}
                OR json_type(completed.data, '$.item.aggregatedOutput') IS NOT NULL
              )
              AND COALESCE(json_extract(completed.data, '$.item.parentToolCallId'), '') =
                COALESCE(json_extract(${events.data}, '$.parentToolCallId'), '')
          )
          AND EXISTS (
            SELECT 1
            FROM events earlier_delta
            WHERE earlier_delta.thread_id = ${events.threadId}
              AND earlier_delta.turn_id = ${events.turnId}
              AND earlier_delta.type = ${events.type}
              AND earlier_delta.item_id = ${events.itemId}
              AND COALESCE(json_extract(earlier_delta.data, '$.parentToolCallId'), '') =
                COALESCE(json_extract(${events.data}, '$.parentToolCallId'), '')
              AND earlier_delta.sequence < ${events.sequence}
          )`,
  );

  return result.changes;
}

/**
 * Latest lifecycle row per open backgroundTask item across all threads on a
 * host. "Open" = no item/backgroundTask/completed row exists for the item.
 * Used by the server's daemon-restart backstop: when the daemon's in-memory
 * task state is lost, these are the items nobody will ever settle.
 */
export function listOpenBackgroundTaskItemRowsForHost(
  db: DbQueryConnection,
  args: ListOpenBackgroundTaskItemRowsForHostArgs,
): OpenBackgroundTaskItemRow[] {
  const startedType = "item/started" satisfies ThreadEventType;
  const progressType =
    "item/backgroundTask/progress" satisfies ThreadEventType;
  const completedType =
    "item/backgroundTask/completed" satisfies ThreadEventType;
  const settled = alias(events, "settled_background_task");

  // The NOT EXISTS clause restricts this to open items; the correlated
  // MAX(sequence) predicate selects each item's latest lifecycle row in SQL
  // so only one row per open item is materialized.
  const rows = db
    .select({
      data: events.data,
      environmentId: threads.environmentId,
      itemId: events.itemId,
      providerThreadId: events.providerThreadId,
      threadId: events.threadId,
    })
    .from(events)
    .innerJoin(threads, eq(events.threadId, threads.id))
    .innerJoin(environments, eq(threads.environmentId, environments.id))
    .where(
      and(
        eq(environments.hostId, args.hostId),
        eq(events.itemKind, "backgroundTask"),
        inArray(events.type, [startedType, progressType]),
        isNotNull(events.itemId),
        notExists(
          db
            .select({ one: sql`1` })
            .from(settled)
            .where(
              and(
                eq(settled.threadId, events.threadId),
                eq(settled.itemId, events.itemId),
                eq(settled.type, completedType),
              ),
            ),
        ),
        sql`${events.sequence} = (
          SELECT MAX(latest.sequence)
          FROM events latest
          WHERE latest.thread_id = ${events.threadId}
            AND latest.item_id = ${events.itemId}
            AND latest.type IN (${startedType}, ${progressType})
        )`,
      ),
    )
    .orderBy(events.threadId, events.itemId)
    .all();

  return rows.flatMap((row) =>
    row.itemId === null ? [] : [{ ...row, itemId: row.itemId }],
  );
}

/**
 * Each item/backgroundTask/progress row carries the full superseding task
 * snapshot, and the turn-scoped item/started anchors the row's sequence range
 * — so while a task runs only the latest progress row per item is
 * load-bearing, and once the dedicated item/backgroundTask/completed row
 * exists (full final payload) none are. No sequence cutoff: deleting a
 * superseded snapshot is always safe.
 */
export function pruneBackgroundTaskProgressEvents(
  db: DbConnection,
  args: PruneBackgroundTaskProgressEventsArgs,
): number {
  const progressType =
    "item/backgroundTask/progress" satisfies ThreadEventType;
  const completedType =
    "item/backgroundTask/completed" satisfies ThreadEventType;

  const result = db.run(
    sql`DELETE FROM events
        WHERE ${events.threadId} = ${args.threadId}
          AND ${events.type} = ${progressType}
          AND ${events.itemId} IS NOT NULL
          AND (
            EXISTS (
              SELECT 1
              FROM events completed
              WHERE completed.thread_id = ${events.threadId}
                AND completed.type = ${completedType}
                AND completed.item_id = ${events.itemId}
            )
            OR ${events.id} NOT IN (
              SELECT latest.id
              FROM events latest
              WHERE latest.thread_id = ${events.threadId}
                AND latest.type = ${progressType}
                AND latest.item_id = ${events.itemId}
              ORDER BY latest.sequence DESC
              LIMIT 1
            )
          )`,
  );

  return result.changes;
}
