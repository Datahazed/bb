import { describe, expect, it, vi } from "vitest";
import {
  LOCAL_AGENT_TASK_TYPE,
  LOCAL_BASH_TASK_TYPE,
  LOCAL_SUBAGENT_TASK_TYPE,
  LOCAL_WORKFLOW_TASK_TYPE,
  threadScope,
  turnScope,
  type PromptInput,
} from "@bb/domain";
import { createConnection } from "../../src/connection.js";
import { migrate } from "../../src/migrate.js";
import { noopNotifier } from "../../src/notifier.js";
import type { DbNotifier } from "../../src/notifier.js";
import {
  appendDaemonEventsInTransaction,
  appendStoredThreadEvent,
  appendStoredThreadEventInTransaction,
  appendStoredThreadEventsInTransaction,
  findStoredEventRow,
  getActiveStoredTurnId,
  getHighWaterMarks,
  getLastStoredProviderThreadId,
  getLastStoredTurnRequestEvent,
  getLatestThreadOutputEventRow,
  getLatestThreadSequence,
  insertEvents,
  listContextWindowUsageRows,
  listCompletedTurnsByThreadIds,
  listEvents,
  listLatestGoalEventRowsByThreadIds,
  listLatestGoalEventRowsForThread,
  listRecentStoredEventRows,
  listTimelineSegmentAnchorsDescending,
  findTimelineSegmentAnchorSequenceAfter,
  getTimelineSegmentAnchorAtSequence,
  listOpenTurnInputAcceptedRowsByThreadIds,
  listStoredClientTurnRequestIdsInRange,
  listStoredClientTurnRequestRowsByKeys,
  listStoredEventRows,
  listStoredEventRowsByParentToolCallIds,
  listStoredEventRowsInRange,
  listStoredDelegatedTurnDescendantRanges,
  listStoredDelegationChildTurnRanges,
  listStoredDelegationDescendantRanges,
  listStoredNonemptyDelegationChildTurnBucketIndexes,
  listStoredTurnDescendantRanges,
  listStoredItemStartedRowsByItemIds,
  listStoredToolCallRowsByItemIds,
  listStoredConversationOutlineEventRows,
  listStoredThreadProvisioningRowsByProvisioningId,
  listStoredTimelineWindowEventRows,
  listStoredTimelineWindowEventRowsDescending,
  listStoredTurnInputAcceptedRowsByClientRequestIds,
  listStoredTurnStartedRowsByTurnIdsUpToSequence,
  MissingStoredTurnStartedError,
  listActiveBackgroundTaskCountsByThreadIds,
  listLatestBackgroundTaskStateRowsByItemIds,
  listOpenBackgroundTaskItemRowsForHost,
  listThreadTurnInterruptionEventStates,
  pruneBackgroundTaskProgressEvents,
  pruneContextWindowUsageEventsBeforeSequence,
  pruneTokenUsageEventsBeforeSequence,
  pruneResolvedItemDeltas,
  pruneThreadEventsBeforeSequence,
  listLatestOpenBackgroundTaskStateRowsForThread,
  type StoredEventRow,
} from "../../src/data/events.js";
import { createEnvironment } from "../../src/data/environments.js";
import { createProject } from "../../src/data/projects.js";
import { createThread } from "../../src/data/threads.js";
import { upsertHost } from "../../src/data/hosts.js";

function setup() {
  const db = createConnection(":memory:");
  migrate(db);
  const host = upsertHost(db, noopNotifier, {
    name: "test-host",
    type: "persistent",
  });
  const { project } = createProject(db, noopNotifier, {
    name: "test-project",
    source: { type: "local_path", hostId: host.id, path: "/tmp/test" },
  });
  const thread = createThread(db, noopNotifier, {
    projectId: project.id,
    providerId: "codex",
  });
  return { db, project, thread };
}

const emptyItemFields = {
  itemId: null,
  itemKind: null,
} as const;

const threadEventFields = {
  ...emptyItemFields,
  scope: threadScope(),
};

const daemonThreadEventFields = {
  ...threadEventFields,
  environmentId: null,
  providerThreadId: null,
};

interface CreateTurnEventFieldsArgs {
  turnId: string;
}

function createTurnEventFields(args: CreateTurnEventFieldsArgs) {
  return {
    ...emptyItemFields,
    scope: turnScope(args.turnId),
  };
}

function textInput(text: string): PromptInput[] {
  return [{ type: "text", text, mentions: [] }];
}

function storedEventRowTextBytes(row: {
  data: string;
  id: string;
  itemId: string | null;
  itemKind: string | null;
  providerThreadId: string | null;
  scopeKind: string;
  threadId: string;
  turnId: string | null;
  type: string;
}): number {
  return [
    row.data,
    row.id,
    row.itemId ?? "",
    row.itemKind ?? "",
    row.providerThreadId ?? "",
    row.scopeKind,
    row.threadId,
    row.turnId ?? "",
    row.type,
  ].reduce((bytes, value) => bytes + Buffer.byteLength(value, "utf8"), 0);
}

function clientTurnRequestData(requestId: string, text: string): string {
  return JSON.stringify({
    direction: "outbound",
    requestId,
    source: "tell",
    initiator: "user",
    input: textInput(text),
    target: { kind: "new-turn" },
    request: { method: "turn/start", params: {} },
    execution: {
      model: "gpt-5",
      reasoningLevel: "medium",
      permissionMode: "workspace-write",
      source: "client/turn/requested",
      serviceTier: "auto",
    },
  });
}

interface CreateTokenUsageDataArgs {
  modelContextWindow: number | null;
  totalTokens: number;
}

interface CreateContextWindowUsageDataArgs {
  estimated?: boolean;
  modelContextWindow: number | null;
  usedTokens: number | null;
}

function createTokenUsageData(args: CreateTokenUsageDataArgs): string {
  return JSON.stringify({
    tokenUsage: {
      total: {
        totalTokens: args.totalTokens,
        inputTokens: args.totalTokens,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
      },
      last: {
        totalTokens: args.totalTokens,
        inputTokens: args.totalTokens,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
      },
      modelContextWindow: args.modelContextWindow,
    },
  });
}

function createContextWindowUsageData(
  args: CreateContextWindowUsageDataArgs,
): string {
  return JSON.stringify({
    contextWindowUsage: {
      usedTokens: args.usedTokens,
      modelContextWindow: args.modelContextWindow,
      estimated: args.estimated ?? false,
    },
  });
}

describe("events", () => {
  it("caps restored lifecycle context at a captured sequence", () => {
    const { db, thread } = setup();
    insertEvents(db, noopNotifier, [
      {
        threadId: thread.id,
        sequence: 1,
        type: "item/started",
        scope: turnScope("turn-1"),
        providerThreadId: "provider-thread",
        itemId: "parent-tool",
        itemKind: "toolCall",
        data: JSON.stringify({
          item: {
            type: "toolCall",
            id: "parent-tool",
            tool: "Agent",
            arguments: { prompt: "work", subagent_type: "general-purpose" },
            status: "pending",
          },
        }),
      },
      {
        threadId: thread.id,
        sequence: 2,
        type: "item/completed",
        scope: turnScope("turn-1"),
        providerThreadId: "provider-thread",
        itemId: "parent-tool",
        itemKind: "toolCall",
        data: JSON.stringify({
          item: {
            type: "toolCall",
            id: "parent-tool",
            tool: "Agent",
            arguments: { prompt: "work", subagent_type: "general-purpose" },
            result: "done",
            status: "completed",
          },
        }),
      },
      {
        threadId: thread.id,
        sequence: 3,
        type: "item/started",
        scope: turnScope("turn-1"),
        providerThreadId: "provider-thread",
        itemId: "reused-command",
        itemKind: "commandExecution",
        data: JSON.stringify({
          item: {
            type: "commandExecution",
            id: "reused-command",
            command: "first",
            cwd: "/repo",
            status: "pending",
            approvalStatus: null,
          },
        }),
      },
      {
        threadId: thread.id,
        sequence: 4,
        type: "item/started",
        scope: turnScope("turn-1"),
        providerThreadId: "provider-thread",
        itemId: "reused-command",
        itemKind: "commandExecution",
        data: JSON.stringify({
          item: {
            type: "commandExecution",
            id: "reused-command",
            command: "future",
            cwd: "/repo",
            status: "pending",
            approvalStatus: null,
          },
        }),
      },
    ]);

    expect(
      listStoredToolCallRowsByItemIds(db, {
        itemIds: ["parent-tool"],
        limit: 10,
        maxBytes: 1_000_000,
        sequenceEnd: 1,
        threadId: thread.id,
      }).rows.map((row) => row.sequence),
    ).toEqual([1]);
    expect(
      listStoredToolCallRowsByItemIds(db, {
        itemIds: ["parent-tool"],
        limit: 10,
        maxBytes: 1_000_000,
        threadId: thread.id,
      }).rows.map((row) => row.sequence),
    ).toEqual([1, 2]);
    expect(
      listStoredItemStartedRowsByItemIds(db, {
        itemIds: ["reused-command"],
        limit: 10,
        maxBytes: 1_000_000,
        sequenceCutoff: 3,
        threadId: thread.id,
      }).rows.map((row) => row.sequence),
    ).toEqual([3]);
    expect(
      listStoredItemStartedRowsByItemIds(db, {
        itemIds: ["reused-command"],
        limit: 10,
        maxBytes: 1_000_000,
        threadId: thread.id,
      }).rows.map((row) => row.sequence),
    ).toEqual([3, 4]);
  });

  it("inserts events and returns count", () => {
    const { db, thread } = setup();

    const result = insertEvents(db, noopNotifier, [
      {
        threadId: thread.id,
        sequence: 1,
        type: "system/error",
        ...threadEventFields,
        data: JSON.stringify({ message: "test" }),
      },
      {
        threadId: thread.id,
        sequence: 2,
        type: "system/error",
        ...threadEventFields,
        data: JSON.stringify({ message: "test2" }),
      },
    ]);

    expect(result).toEqual({
      insertedCount: 2,
      insertedInputIndexes: [0, 1],
    });
    const all = listEvents(db, { threadId: thread.id });
    expect(all).toHaveLength(2);
  });

  it("stores derived item columns when provided", () => {
    const { db, thread } = setup();

    insertEvents(db, noopNotifier, [
      {
        threadId: thread.id,
        sequence: 1,
        type: "item/completed",
        scope: turnScope("turn-1"),
        itemId: "msg-1",
        itemKind: "agentMessage",
        data: JSON.stringify({
          item: {
            id: "msg-1",
            type: "agentMessage",
            text: "hello",
          },
        }),
      },
    ]);

    const all = listEvents(db, { threadId: thread.id });
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({
      itemId: "msg-1",
      itemKind: "agentMessage",
    });
  });

  it("rejects turn scope rows without a stored turn id", () => {
    const { db, thread } = setup();

    expect(() =>
      db.$client
        .prepare(
          `INSERT INTO events (
            id,
            thread_id,
            scope_kind,
            turn_id,
            sequence,
            type,
            item_id,
            item_kind,
            data,
            created_at
          )
          VALUES (
            'evt_bad_scope_shape',
            ?,
            'turn',
            NULL,
            1,
            'system/error',
            NULL,
            NULL,
            '{}',
            1
          )`,
        )
        .run(thread.id),
    ).toThrow(/events_scope_shape_check|CHECK constraint failed/);
  });

  it("deduplicates on (threadId, sequence)", () => {
    const { db, thread } = setup();

    const result1 = insertEvents(db, noopNotifier, [
      {
        threadId: thread.id,
        sequence: 1,
        type: "system/error",
        ...threadEventFields,
        data: JSON.stringify({ message: "first" }),
      },
    ]);
    expect(result1).toEqual({
      insertedCount: 1,
      insertedInputIndexes: [0],
    });

    // Same threadId + sequence should be ignored
    const result2 = insertEvents(db, noopNotifier, [
      {
        threadId: thread.id,
        sequence: 1,
        type: "system/error",
        ...threadEventFields,
        data: JSON.stringify({ message: "duplicate" }),
      },
      {
        threadId: thread.id,
        sequence: 2,
        type: "system/error",
        ...threadEventFields,
        data: JSON.stringify({ message: "new" }),
      },
    ]);
    expect(result2).toEqual({
      insertedCount: 1,
      insertedInputIndexes: [1],
    }); // only sequence 2 inserted

    const all = listEvents(db, { threadId: thread.id });
    expect(all).toHaveLength(2);
    // Original data preserved for sequence 1
    expect(JSON.parse(all[0]!.data)).toMatchObject({ message: "first" });
  });

  it("appends daemon events with server-owned sequences", () => {
    const { db, thread } = setup();

    insertEvents(db, noopNotifier, [
      {
        threadId: thread.id,
        sequence: 5,
        type: "system/error",
        ...threadEventFields,
        data: JSON.stringify({ message: "existing" }),
      },
    ]);

    const result = db.transaction(
      (tx) =>
        appendDaemonEventsInTransaction(tx, [
          {
            threadId: thread.id,
            type: "system/error",
            ...daemonThreadEventFields,
            data: JSON.stringify({ message: "first daemon" }),
          },
          {
            threadId: thread.id,
            type: "system/error",
            ...daemonThreadEventFields,
            data: JSON.stringify({ message: "second daemon" }),
          },
        ]),
      { behavior: "immediate" },
    );

    expect(result).toEqual({
      acceptedEvents: [
        {
          threadId: thread.id,
          sequence: 6,
        },
        {
          threadId: thread.id,
          sequence: 7,
        },
      ],
      insertedInputIndexes: [0, 1],
      skippedTurnUnstartedInputIndexes: [],
    });
    expect(listEvents(db, { threadId: thread.id })).toMatchObject([
      { sequence: 5 },
      {
        sequence: 6,
      },
      {
        sequence: 7,
      },
    ]);
  });

  it("rejects daemon turn-scoped events before turn/started is stored", () => {
    const { db, thread } = setup();

    expect(() =>
      db.transaction(
        (tx) =>
          appendDaemonEventsInTransaction(tx, [
            {
              threadId: thread.id,
              type: "turn/completed",
              ...createTurnEventFields({ turnId: "turn_missing" }),
              environmentId: null,
              providerThreadId: "provider_thr_missing",
              data: JSON.stringify({
                providerThreadId: "provider_thr_missing",
                status: "completed",
                turnId: "turn_missing",
              }),
            },
          ]),
        { behavior: "immediate" },
      ),
    ).toThrow(MissingStoredTurnStartedError);
    expect(listEvents(db, { threadId: thread.id })).toHaveLength(0);
  });

  it("rejects daemon turn-scoped events before turn/started in the same batch", () => {
    const { db, thread } = setup();

    expect(() =>
      db.transaction(
        (tx) =>
          appendDaemonEventsInTransaction(tx, [
            {
              threadId: thread.id,
              type: "turn/completed",
              ...createTurnEventFields({ turnId: "turn_late_start" }),
              environmentId: null,
              providerThreadId: "provider_thr_late",
              data: JSON.stringify({
                providerThreadId: "provider_thr_late",
                status: "completed",
                turnId: "turn_late_start",
              }),
            },
            {
              threadId: thread.id,
              type: "turn/started",
              ...createTurnEventFields({ turnId: "turn_late_start" }),
              environmentId: null,
              providerThreadId: "provider_thr_late",
              data: JSON.stringify({
                providerThreadId: "provider_thr_late",
                turnId: "turn_late_start",
              }),
            },
          ]),
        { behavior: "immediate" },
      ),
    ).toThrow(MissingStoredTurnStartedError);
    expect(listEvents(db, { threadId: thread.id })).toHaveLength(0);
  });

  it("drops orphan token-usage snapshots with no stored turn/started instead of failing the batch", () => {
    const { db, thread } = setup();

    // A native fork resumes the parent's session, which re-emits the parent's
    // last-turn token usage scoped to a turn the forked thread never started.
    // The snapshot must be dropped, not throw — otherwise the whole batch (here
    // including the fork's real turn/started) rolls back and the daemon retries
    // forever, wedging the thread.
    const result = db.transaction(
      (tx) =>
        appendDaemonEventsInTransaction(tx, [
          {
            threadId: thread.id,
            type: "thread/tokenUsage/updated",
            ...createTurnEventFields({ turnId: "turn_carried_over" }),
            environmentId: null,
            providerThreadId: "provider_thr_resumed",
            data: createTokenUsageData({
              totalTokens: 42,
              modelContextWindow: 200_000,
            }),
          },
          {
            threadId: thread.id,
            type: "turn/started",
            ...createTurnEventFields({ turnId: "turn_new" }),
            environmentId: null,
            providerThreadId: "provider_thr_resumed",
            data: JSON.stringify({
              providerThreadId: "provider_thr_resumed",
              turnId: "turn_new",
            }),
          },
        ]),
      { behavior: "immediate" },
    );

    expect(result.skippedTurnUnstartedInputIndexes).toEqual([0]);
    expect(result.insertedInputIndexes).toEqual([1]);
    expect(
      listEvents(db, { threadId: thread.id }).map((event) => event.type),
    ).toEqual(["turn/started"]);
  });

  it("accepts daemon turn-scoped events after earlier turn/started in the same batch", () => {
    const { db, thread } = setup();

    const result = db.transaction(
      (tx) =>
        appendDaemonEventsInTransaction(tx, [
          {
            threadId: thread.id,
            type: "turn/started",
            ...createTurnEventFields({ turnId: "turn_ordered" }),
            environmentId: null,
            providerThreadId: "provider_thr_ordered",
            data: JSON.stringify({
              providerThreadId: "provider_thr_ordered",
              turnId: "turn_ordered",
            }),
          },
          {
            threadId: thread.id,
            type: "turn/completed",
            ...createTurnEventFields({ turnId: "turn_ordered" }),
            environmentId: null,
            providerThreadId: "provider_thr_ordered",
            data: JSON.stringify({
              providerThreadId: "provider_thr_ordered",
              status: "completed",
              turnId: "turn_ordered",
            }),
          },
        ]),
      { behavior: "immediate" },
    );

    expect(result).toMatchObject({
      acceptedEvents: [
        { threadId: thread.id, sequence: 1 },
        { threadId: thread.id, sequence: 2 },
      ],
      insertedInputIndexes: [0, 1],
    });
    expect(listEvents(db, { threadId: thread.id })).toHaveLength(2);
  });

  it("accepts daemon turn-scoped events after turn/started is stored", () => {
    const { db, thread } = setup();

    db.transaction(
      (tx) =>
        appendDaemonEventsInTransaction(tx, [
          {
            threadId: thread.id,
            type: "turn/started",
            ...createTurnEventFields({ turnId: "turn_prior" }),
            environmentId: null,
            providerThreadId: "provider_thr_prior",
            data: JSON.stringify({
              providerThreadId: "provider_thr_prior",
              turnId: "turn_prior",
            }),
          },
        ]),
      { behavior: "immediate" },
    );

    const result = db.transaction(
      (tx) =>
        appendDaemonEventsInTransaction(tx, [
          {
            threadId: thread.id,
            type: "turn/completed",
            ...createTurnEventFields({ turnId: "turn_prior" }),
            environmentId: null,
            providerThreadId: "provider_thr_prior",
            data: JSON.stringify({
              providerThreadId: "provider_thr_prior",
              status: "completed",
              turnId: "turn_prior",
            }),
          },
        ]),
      { behavior: "immediate" },
    );

    expect(result).toMatchObject({
      acceptedEvents: [{ threadId: thread.id, sequence: 2 }],
      insertedInputIndexes: [0],
    });
    expect(listEvents(db, { threadId: thread.id })).toHaveLength(2);
  });

  it("persists neighboring daemon events when accepted input data is malformed", () => {
    const { db, thread } = setup();

    db.transaction(
      (tx) =>
        appendDaemonEventsInTransaction(tx, [
          {
            threadId: thread.id,
            type: "turn/started",
            ...daemonThreadEventFields,
            scope: turnScope("turn-1"),
            providerThreadId: "provider-thread-1",
            data: JSON.stringify({ providerThreadId: "provider-thread-1" }),
          },
          {
            threadId: thread.id,
            type: "turn/input/accepted",
            ...daemonThreadEventFields,
            scope: turnScope("turn-1"),
            providerThreadId: "provider-thread-1",
            data: "{malformed-json",
          },
          {
            threadId: thread.id,
            type: "system/error",
            ...daemonThreadEventFields,
            data: JSON.stringify({ message: "neighbor persisted" }),
          },
        ]),
      { behavior: "immediate" },
    );

    expect(listEvents(db, { threadId: thread.id }).map((event) => event.type))
      .toEqual(["turn/started", "turn/input/accepted", "system/error"]);
  });

  it("stores the provided createdAt timestamp", () => {
    const { db, thread } = setup();
    const createdAt = 1_700_000_000_000;

    insertEvents(db, noopNotifier, [
      {
        threadId: thread.id,
        sequence: 1,
        type: "system/error",
        ...threadEventFields,
        createdAt,
        data: JSON.stringify({ message: "timestamped" }),
      },
    ]);

    const [event] = listEvents(db, { threadId: thread.id });
    expect(event?.createdAt).toBe(createdAt);
  });

  it("lists and finds stored event rows with shared DB helpers", () => {
    const { db, thread } = setup();

    insertEvents(db, noopNotifier, [
      {
        threadId: thread.id,
        sequence: 1,
        type: "system/error",
        ...threadEventFields,
        data: JSON.stringify({ message: "first" }),
      },
      {
        threadId: thread.id,
        sequence: 2,
        type: "system/error",
        ...threadEventFields,
        data: JSON.stringify({ message: "second" }),
      },
      {
        threadId: thread.id,
        sequence: 3,
        type: "turn/started",
        ...createTurnEventFields({ turnId: "turn_1" }),
        data: JSON.stringify({ turnId: "turn_1" }),
      },
    ]);

    expect(
      listStoredEventRows(db, {
        afterSequence: 1,
        limit: 1,
        threadId: thread.id,
      }),
    ).toMatchObject([
      {
        sequence: 2,
        type: "system/error",
      },
    ]);

    expect(
      findStoredEventRow(db, {
        afterSequence: 1,
        threadId: thread.id,
        type: "system/error",
      }),
    ).toMatchObject({
      sequence: 2,
      type: "system/error",
    });
  });

  it("finds the latest output event row without scanning unrelated event types", () => {
    const { db, thread } = setup();

    insertEvents(db, noopNotifier, [
      {
        threadId: thread.id,
        sequence: 1,
        type: "system/manager/user_message",
        ...threadEventFields,
        data: JSON.stringify({ text: "manager output" }),
      },
      {
        threadId: thread.id,
        sequence: 2,
        type: "item/completed",
        scope: turnScope("turn-1"),
        itemId: "msg_1",
        itemKind: "agentMessage",
        data: JSON.stringify({
          item: { id: "msg_1", type: "agentMessage", text: "assistant output" },
        }),
      },
      {
        threadId: thread.id,
        sequence: 3,
        type: "item/completed",
        scope: turnScope("turn-1"),
        itemId: "call_1",
        itemKind: "toolCall",
        data: JSON.stringify({ item: { id: "call_1", type: "toolCall" } }),
      },
      {
        threadId: thread.id,
        sequence: 4,
        type: "system/error",
        ...threadEventFields,
        data: JSON.stringify({ message: "ignored" }),
      },
    ]);

    expect(
      getLatestThreadOutputEventRow(db, { threadId: thread.id }),
    ).toMatchObject({
      sequence: 2,
      itemKind: "agentMessage",
      type: "item/completed",
    });
  });

  it("skips empty assistant output when a manager user message is the latest visible output", () => {
    const { db, thread } = setup();

    insertEvents(db, noopNotifier, [
      {
        threadId: thread.id,
        sequence: 1,
        type: "system/manager/user_message",
        ...threadEventFields,
        data: JSON.stringify({ text: "manager output" }),
      },
      {
        threadId: thread.id,
        sequence: 2,
        type: "item/completed",
        scope: turnScope("turn-1"),
        itemId: "msg_1",
        itemKind: "agentMessage",
        data: JSON.stringify({
          item: { id: "msg_1", type: "agentMessage", text: "" },
        }),
      },
    ]);

    expect(
      getLatestThreadOutputEventRow(db, { threadId: thread.id }),
    ).toMatchObject({
      sequence: 1,
      type: "system/manager/user_message",
    });
  });

  it("lists stored event rows by range and exclusion filters", () => {
    const { db, thread } = setup();

    insertEvents(db, noopNotifier, [
      {
        threadId: thread.id,
        sequence: 1,
        type: "system/error",
        ...threadEventFields,
        data: JSON.stringify({ message: "first" }),
      },
      {
        threadId: thread.id,
        sequence: 2,
        type: "thread/contextWindowUsage/updated",
        ...createTurnEventFields({ turnId: "turn-1" }),
        data: createContextWindowUsageData({
          modelContextWindow: 16_000,
          usedTokens: 100,
        }),
      },
      {
        threadId: thread.id,
        sequence: 3,
        type: "thread/contextWindowUsage/updated",
        ...createTurnEventFields({ turnId: "turn-1" }),
        data: createContextWindowUsageData({
          modelContextWindow: null,
          usedTokens: 200,
        }),
      },
    ]);

    expect(
      listStoredEventRowsInRange(db, {
        seqEnd: 2,
        seqStart: 1,
        threadId: thread.id,
      }),
    ).toHaveLength(2);

    expect(
      listRecentStoredEventRows(db, {
        excludedTypes: ["system/error"],
        threadId: thread.id,
      }).map((row) => row.sequence),
    ).toEqual([2, 3]);

    expect(
      listContextWindowUsageRows(db, {
        limit: 2,
        maxBytes: 32_000,
        threadId: thread.id,
      }).rows.map((row) => row.sequence),
    ).toEqual([2, 3]);
  });

  it("keeps nested-turn context usage from replacing the root turn report", () => {
    const { db, thread } = setup();

    insertEvents(db, noopNotifier, [
      {
        threadId: thread.id,
        sequence: 1,
        type: "turn/started",
        ...createTurnEventFields({ turnId: "turn-root" }),
        data: "{}",
      },
      {
        threadId: thread.id,
        sequence: 2,
        type: "thread/contextWindowUsage/updated",
        ...createTurnEventFields({ turnId: "turn-root" }),
        data: createContextWindowUsageData({
          modelContextWindow: 200_000,
          usedTokens: 80_000,
        }),
      },
      {
        threadId: thread.id,
        sequence: 3,
        type: "turn/started",
        ...createTurnEventFields({ turnId: "turn-subagent" }),
        data: JSON.stringify({ parentToolCallId: "call-subagent" }),
      },
      {
        threadId: thread.id,
        sequence: 4,
        type: "thread/contextWindowUsage/updated",
        ...createTurnEventFields({ turnId: "turn-subagent" }),
        data: createContextWindowUsageData({
          modelContextWindow: 200_000,
          usedTokens: 15_000,
        }),
      },
      {
        threadId: thread.id,
        sequence: 5,
        type: "thread/contextWindowUsage/updated",
        ...createTurnEventFields({ turnId: "turn-root" }),
        data: createContextWindowUsageData({
          modelContextWindow: null,
          usedTokens: 90_000,
        }),
      },
    ]);

    expect(
      listContextWindowUsageRows(db, {
        limit: 2,
        maxBytes: 32_000,
        threadId: thread.id,
      }).rows.map((row) => row.sequence),
    ).toEqual([2, 5]);
  });

  it("lists bounded timeline segment anchors with request shape rules", () => {
    const { db, thread } = setup();

    insertEvents(db, noopNotifier, [
      {
        threadId: thread.id,
        sequence: 1,
        type: "client/turn/requested",
        ...threadEventFields,
        data: JSON.stringify({
          initiator: "user",
          input: textInput("user message"),
          target: { kind: "new-turn" },
        }),
      },
      {
        threadId: thread.id,
        sequence: 2,
        type: "client/turn/requested",
        ...threadEventFields,
        data: JSON.stringify({
          initiator: "system",
          input: textInput("system message"),
          target: { kind: "new-turn" },
        }),
      },
      {
        threadId: thread.id,
        sequence: 3,
        type: "client/turn/requested",
        ...threadEventFields,
        data: JSON.stringify({
          initiator: "user",
          input: textInput("accepted steer"),
          target: { kind: "auto", expectedTurnId: "turn-1" },
        }),
      },
      {
        threadId: thread.id,
        sequence: 4,
        type: "client/turn/requested",
        ...threadEventFields,
        data: JSON.stringify({
          initiator: "user",
          input: textInput("auto new turn"),
          target: { kind: "auto", expectedTurnId: null },
        }),
      },
      {
        threadId: thread.id,
        sequence: 5,
        type: "client/turn/requested",
        ...threadEventFields,
        data: JSON.stringify({
          initiator: "user",
          input: textInput("explicit steer"),
          target: { kind: "steer", expectedTurnId: "turn-1" },
        }),
      },
      {
        threadId: thread.id,
        sequence: 6,
        type: "client/turn/requested",
        ...threadEventFields,
        data: JSON.stringify({
          initiator: "user",
          input: textInput(""),
          target: { kind: "new-turn" },
        }),
      },
      {
        threadId: thread.id,
        sequence: 7,
        type: "client/turn/requested",
        ...threadEventFields,
        data: JSON.stringify({
          initiator: "user",
          input: [{ type: "localImage", path: "/tmp/image.png" }],
          target: { kind: "thread-start" },
        }),
      },
      {
        threadId: thread.id,
        sequence: 8,
        type: "client/turn/requested",
        ...threadEventFields,
        data: JSON.stringify({
          initiator: "user",
          input: textInput("legacy target"),
        }),
      },
      {
        threadId: thread.id,
        sequence: 9,
        type: "client/turn/requested",
        ...threadEventFields,
        data: JSON.stringify({
          initiator: "user",
          input: [{ type: "image", url: "https://example.com/image.png" }],
          target: { kind: "new-turn" },
        }),
      },
      {
        threadId: thread.id,
        sequence: 10,
        type: "client/turn/requested",
        ...threadEventFields,
        data: JSON.stringify({
          initiator: "user",
          input: [{ type: "localFile", path: "/tmp/input.txt" }],
          target: { kind: "new-turn" },
        }),
      },
      {
        threadId: thread.id,
        sequence: 11,
        type: "client/turn/requested",
        ...threadEventFields,
        data: JSON.stringify({
          initiator: "agent",
          input: textInput("agent message"),
          target: { kind: "new-turn" },
        }),
      },
    ]);

    expect(
      listTimelineSegmentAnchorsDescending(db, {
        limit: 8,
        threadId: thread.id,
      }),
    ).toEqual([
      { rowId: `${thread.id}:user-seed:11`, sequence: 11 },
      { rowId: `${thread.id}:user-seed:10`, sequence: 10 },
      { rowId: `${thread.id}:user-seed:9`, sequence: 9 },
      { rowId: `${thread.id}:user-seed:8`, sequence: 8 },
      { rowId: `${thread.id}:user-seed:7`, sequence: 7 },
      { rowId: `${thread.id}:user-seed:4`, sequence: 4 },
      { rowId: `${thread.id}:user-seed:2`, sequence: 2 },
      { rowId: `${thread.id}:user-seed:1`, sequence: 1 },
    ]);

    // The timeline pagination helpers select only the requested page of
    // anchors, so latest/older page resolution never enumerates a whole thread.
    expect(
      listTimelineSegmentAnchorsDescending(db, {
        limit: 3,
        threadId: thread.id,
      }).map((row) => row.sequence),
    ).toEqual([11, 10, 9]);
    expect(
      listTimelineSegmentAnchorsDescending(db, {
        beforeSequence: 8,
        limit: 3,
        threadId: thread.id,
      }),
    ).toEqual([
      { rowId: `${thread.id}:user-seed:7`, sequence: 7 },
      { rowId: `${thread.id}:user-seed:4`, sequence: 4 },
      { rowId: `${thread.id}:user-seed:2`, sequence: 2 },
    ]);
    expect(
      getTimelineSegmentAnchorAtSequence(db, {
        sequence: 7,
        threadId: thread.id,
      }),
    ).toEqual({ rowId: `${thread.id}:user-seed:7`, sequence: 7 });
    expect(
      getTimelineSegmentAnchorAtSequence(db, {
        sequence: 2,
        threadId: thread.id,
      }),
    ).toEqual({ rowId: `${thread.id}:user-seed:2`, sequence: 2 });
    expect(
      findTimelineSegmentAnchorSequenceAfter(db, {
        sequence: 7,
        threadId: thread.id,
      }),
    ).toBe(8);
    expect(
      findTimelineSegmentAnchorSequenceAfter(db, {
        sequence: 10,
        threadId: thread.id,
      }),
    ).toBe(11);
    expect(
      findTimelineSegmentAnchorSequenceAfter(db, {
        sequence: 11,
        threadId: thread.id,
      }),
    ).toBeUndefined();
  });

  it("loads timeline event windows with sequence bounds and exclusions", () => {
    const { db, thread } = setup();

    insertEvents(db, noopNotifier, [
      {
        threadId: thread.id,
        sequence: 1,
        type: "system/error",
        ...threadEventFields,
        data: JSON.stringify({ message: "before" }),
      },
      {
        threadId: thread.id,
        sequence: 2,
        type: "thread/contextWindowUsage/updated",
        ...createTurnEventFields({ turnId: "turn-1" }),
        data: createContextWindowUsageData({
          modelContextWindow: 16_000,
          usedTokens: 100,
        }),
      },
      {
        threadId: thread.id,
        sequence: 3,
        type: "system/error",
        ...threadEventFields,
        data: JSON.stringify({ message: "inside" }),
      },
      {
        threadId: thread.id,
        sequence: 4,
        type: "system/error",
        ...threadEventFields,
        data: JSON.stringify({ message: "after" }),
      },
    ]);

    expect(
      listStoredTimelineWindowEventRows(db, {
        beforeSequence: 4,
        excludedTypes: ["thread/contextWindowUsage/updated"],
        sequenceStart: 2,
        threadId: thread.id,
      }).map((row) => row.sequence),
    ).toEqual([3]);

    expect(
      listStoredTimelineWindowEventRows(db, {
        excludedTypes: [],
        sequenceStart: 2,
        threadId: thread.id,
      }).map((row) => row.sequence),
    ).toEqual([2, 3, 4]);

    expect(
      listStoredTimelineWindowEventRows(db, {
        beforeSequence: 4,
        sequenceStart: 2,
        threadId: thread.id,
      }).map((row) => row.sequence),
    ).toEqual([2, 3]);

    expect(
      listStoredTimelineWindowEventRowsDescending(db, {
        excludedTypes: [],
        limit: 2,
        maxBytes: 750_000,
        sequenceStart: 2,
        threadId: thread.id,
      }).rows.map((row) => row.sequence),
    ).toEqual([4, 3]);
  });

  it("returns a bounded representation for an oversized timeline event", () => {
    const { db, thread } = setup();
    const oversizedItemId = "item".repeat(1_000);
    insertEvents(db, noopNotifier, [
      {
        threadId: thread.id,
        sequence: 1,
        type: "item/commandExecution/outputDelta",
        ...createTurnEventFields({ turnId: "turn-1" }),
        itemId: "command-1",
        itemKind: "commandExecution",
        data: JSON.stringify({
          itemId: "command-1",
          delta: '💥\u0000\\"'.repeat(50_000),
          reset: true,
        }),
      },
      {
        threadId: thread.id,
        sequence: 2,
        type: "item/commandExecution/outputDelta",
        ...createTurnEventFields({ turnId: "turn-1" }),
        itemId: oversizedItemId,
        itemKind: "commandExecution",
        data: JSON.stringify({
          itemId: oversizedItemId,
          delta: "x".repeat(50_000),
        }),
      },
    ]);

    const [oversizedIdentityRow, row] =
      listStoredTimelineWindowEventRowsDescending(db, {
      excludedTypes: [],
      limit: 2,
      maxBytes: 1_000,
      sequenceStart: 1,
      threadId: thread.id,
      }).rows;

    expect(row?.type).toBe("item/commandExecution/outputDelta");
    expect(Buffer.byteLength(row?.data ?? "", "utf8")).toBeLessThanOrEqual(
      1_000,
    );
    expect(JSON.parse(row?.data ?? "{}")).toMatchObject({
      itemId: "command-1",
      reset: true,
      delta: expect.stringContaining(
        "oversized event truncated for timeline rendering",
      ),
    });
    expect(oversizedIdentityRow).toMatchObject({
      itemId: null,
      itemKind: null,
      type: "system/error",
    });
    expect(
      Buffer.byteLength(oversizedIdentityRow?.data ?? "", "utf8"),
    ).toBeLessThanOrEqual(1_000);
  });

  it("pages past oversized provider and turn identities without losing events", () => {
    const { db, thread } = setup();
    const oversizedProviderThreadId = `provider-${"界".repeat(2_000)}`;
    const oversizedTurnId = `turn-${"🧭".repeat(2_000)}`;
    insertEvents(db, noopNotifier, [
      ...Array.from({ length: 4 }, (_, index) => ({
        threadId: thread.id,
        sequence: index + 1,
        type: "system/error" as const,
        ...threadEventFields,
        data: JSON.stringify({ message: `bounded-${index}-${"x".repeat(280)}` }),
      })),
      {
        threadId: thread.id,
        sequence: 5,
        type: "system/error",
        ...threadEventFields,
        providerThreadId: oversizedProviderThreadId,
        data: JSON.stringify({ message: "oversized provider identity" }),
      },
      {
        threadId: thread.id,
        sequence: 6,
        type: "system/error",
        ...createTurnEventFields({ turnId: oversizedTurnId }),
        data: JSON.stringify({ message: "oversized turn identity" }),
      },
    ]);

    const storedRowsBySequence = new Map(
      listStoredEventRows(db, { threadId: thread.id }).map((row) => [
        row.sequence,
        row,
      ]),
    );
    const sequences: number[] = [];
    const projectedRows = new Map<number, StoredEventRow>();
    let beforeSequence: number | undefined;
    while (true) {
      const page = listStoredTimelineWindowEventRowsDescending(db, {
        ...(beforeSequence === undefined ? {} : { beforeSequence }),
        excludedTypes: [],
        limit: 10,
        maxBytes: 700,
        sequenceStart: 1,
        threadId: thread.id,
      });

      expect(page.rows.length).toBeGreaterThan(0);
      expect(page.dataBytes).toBeLessThanOrEqual(700);
      for (const row of page.rows) {
        sequences.push(row.sequence);
        projectedRows.set(row.sequence, row);
      }
      if (!page.hasMore) break;
      beforeSequence = page.rows.at(-1)?.sequence;
      expect(beforeSequence).toBeDefined();
    }

    expect(sequences).toEqual([6, 5, 4, 3, 2, 1]);
    expect(new Set(sequences).size).toBe(sequences.length);
    for (const sequence of [5, 6]) {
      const projected = projectedRows.get(sequence);
      const stored = storedRowsBySequence.get(sequence);
      expect(projected).toMatchObject({
        id: stored?.id,
        providerThreadId: null,
        scopeKind: "thread",
        sequence,
        threadId: thread.id,
        turnId: null,
        type: "system/error",
      });
      expect(JSON.parse(projected?.data ?? "{}")).toMatchObject({
        code: "timeline_event_identity_too_large",
      });
    }
  });

  it("enforces cumulative UTF-8 bytes across all returned text columns", () => {
    const { db, thread } = setup();
    insertEvents(
      db,
      noopNotifier,
      Array.from({ length: 4 }, (_, index) => ({
        threadId: thread.id,
        sequence: index + 1,
        type: "system/error" as const,
        ...threadEventFields,
        providerThreadId: `provider-🧭-${index}`,
        data: JSON.stringify({ message: `界`.repeat(90 + index) }),
      })),
    );

    const newestRows = listStoredEventRows(db, {
      threadId: thread.id,
    }).reverse();
    const maxBytes = newestRows
      .slice(0, 2)
      .reduce((bytes, row) => bytes + storedEventRowTextBytes(row), 0);
    const result = listStoredTimelineWindowEventRowsDescending(db, {
      excludedTypes: [],
      limit: 4,
      maxBytes,
      sequenceStart: 1,
      threadId: thread.id,
    });

    expect(result.rows.map((row) => row.sequence)).toEqual([4, 3]);
    expect(result.dataBytes).toBe(maxBytes);
    expect(result.hasMore).toBe(true);
    expect(
      result.rows.reduce(
        (bytes, row) => bytes + storedEventRowTextBytes(row),
        0,
      ),
    ).toBe(result.dataBytes);
  });

  it("keyset-pages a row-limit sentinel without gaps or duplicates", () => {
    const { db, thread } = setup();
    insertEvents(
      db,
      noopNotifier,
      Array.from({ length: 7 }, (_, index) => ({
        threadId: thread.id,
        sequence: index + 1,
        type: "system/error" as const,
        ...threadEventFields,
        data: JSON.stringify({ message: `event-${index + 1}` }),
      })),
    );

    const sequences: number[] = [];
    let beforeSequence: number | undefined;
    while (true) {
      const page = listStoredTimelineWindowEventRowsDescending(db, {
        ...(beforeSequence === undefined ? {} : { beforeSequence }),
        excludedTypes: [],
        limit: 2,
        maxBytes: 100_000,
        sequenceStart: 1,
        threadId: thread.id,
      });
      sequences.push(...page.rows.map((row) => row.sequence));
      if (!page.hasMore) break;
      beforeSequence = page.rows.at(-1)?.sequence;
      expect(beforeSequence).toBeDefined();
    }

    expect(sequences).toEqual([7, 6, 5, 4, 3, 2, 1]);
    expect(new Set(sequences).size).toBe(sequences.length);
  });

  it("returns an oversized newest placeholder and advances past it", () => {
    const { db, thread } = setup();
    insertEvents(db, noopNotifier, [
      {
        threadId: thread.id,
        sequence: 1,
        type: "system/error",
        ...threadEventFields,
        data: JSON.stringify({ message: "older" }),
      },
      {
        threadId: thread.id,
        sequence: 2,
        type: "system/error",
        ...threadEventFields,
        data: JSON.stringify({ message: "x".repeat(100_000) }),
      },
    ]);

    const newest = listStoredTimelineWindowEventRowsDescending(db, {
      excludedTypes: [],
      limit: 1,
      maxBytes: 1_000,
      sequenceStart: 1,
      threadId: thread.id,
    });
    expect(newest.rows).toHaveLength(1);
    expect(newest.rows[0]).toMatchObject({
      sequence: 2,
      type: "system/error",
    });
    expect(JSON.parse(newest.rows[0]?.data ?? "{}")).toMatchObject({
      code: "timeline_event_payload_too_large",
    });
    expect(newest.dataBytes).toBeLessThanOrEqual(1_000);
    expect(newest.hasMore).toBe(true);

    const older = listStoredTimelineWindowEventRowsDescending(db, {
      beforeSequence: 2,
      excludedTypes: [],
      limit: 1,
      maxBytes: 1_000,
      sequenceStart: 1,
      threadId: thread.id,
    });
    expect(older.rows.map((row) => row.sequence)).toEqual([1]);
    expect(older.hasMore).toBe(false);
  });

  it("excludes existing enrichment ids before applying its SQL budget", () => {
    const { db, thread } = setup();
    insertEvents(
      db,
      noopNotifier,
      Array.from({ length: 3 }, (_, index) => ({
        threadId: thread.id,
        sequence: index + 1,
        type: "system/error" as const,
        ...threadEventFields,
        data: JSON.stringify({
          parentToolCallId: "parent-tool",
          message: `child-${index + 1}-${"界".repeat(40)}`,
        }),
      })),
    );

    const first = listStoredEventRowsByParentToolCallIds(db, {
      limit: 1,
      maxBytes: 10_000,
      parentToolCallIds: ["parent-tool"],
      threadId: thread.id,
    });
    const second = listStoredEventRowsByParentToolCallIds(db, {
      excludedRowIds: first.rows.map((row) => row.id),
      limit: 1,
      maxBytes: first.dataBytes,
      parentToolCallIds: ["parent-tool"],
      threadId: thread.id,
    });

    expect(first.rows.map((row) => row.sequence)).toEqual([3]);
    expect(second.rows.map((row) => row.sequence)).toEqual([2]);
    expect(second.dataBytes).toBeLessThanOrEqual(first.dataBytes);
    expect(second.rows).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: first.rows[0]?.id })]),
    );
  });

  it("keeps lifecycle enrichment type-aware within each requested budget", () => {
    const { db, thread } = setup();
    insertEvents(db, noopNotifier, [
      {
        threadId: thread.id,
        sequence: 1,
        type: "turn/started",
        ...createTurnEventFields({ turnId: "turn-1" }),
        data: JSON.stringify({ filler: "界".repeat(10_000) }),
      },
      {
        threadId: thread.id,
        sequence: 2,
        type: "item/started",
        ...createTurnEventFields({ turnId: "turn-1" }),
        itemId: "parent-tool",
        itemKind: "toolCall",
        data: JSON.stringify({
          item: {
            type: "toolCall",
            id: "parent-tool",
            tool: "delegate",
            status: "pending",
            arguments: { prompt: "x".repeat(50_000) },
          },
        }),
      },
      {
        threadId: thread.id,
        sequence: 3,
        type: "item/started",
        ...createTurnEventFields({ turnId: "turn-1" }),
        itemId: "child-command",
        itemKind: "commandExecution",
        data: JSON.stringify({
          item: {
            type: "commandExecution",
            id: "child-command",
            command: "x".repeat(50_000),
            cwd: "/repo",
            status: "pending",
            approvalStatus: null,
            parentToolCallId: "parent-tool",
          },
        }),
      },
    ]);

    const maxBytes = 2_000;
    const parent = listStoredToolCallRowsByItemIds(db, {
      itemIds: ["parent-tool"],
      limit: 2,
      maxBytes,
      threadId: thread.id,
    });
    const itemStart = listStoredItemStartedRowsByItemIds(db, {
      itemIds: ["child-command"],
      limit: 1,
      maxBytes,
      threadId: thread.id,
    });
    const turnStart = listStoredTurnStartedRowsByTurnIdsUpToSequence(db, {
      limit: 1,
      maxBytes,
      sequenceCutoff: 3,
      threadId: thread.id,
      turnIds: ["turn-1"],
    });

    expect(parent.rows[0]).toMatchObject({
      itemId: "parent-tool",
      itemKind: "toolCall",
      type: "item/started",
    });
    expect(itemStart.rows[0]).toMatchObject({
      itemId: "child-command",
      itemKind: "commandExecution",
      type: "item/started",
    });
    expect(turnStart.rows[0]).toMatchObject({
      turnId: "turn-1",
      type: "turn/started",
    });
    for (const result of [parent, itemStart, turnStart]) {
      expect(result.rows).toHaveLength(1);
      expect(result.dataBytes).toBeLessThanOrEqual(maxBytes);
      expect(
        result.rows.reduce(
          (bytes, row) => bytes + storedEventRowTextBytes(row),
          0,
        ),
      ).toBe(result.dataBytes);
    }
  });

  it("loads only message-producing events for conversation outlines", () => {
    const { db, thread } = setup();
    insertEvents(db, noopNotifier, [
      {
        threadId: thread.id,
        sequence: 1,
        type: "client/turn/requested",
        ...threadEventFields,
        data: JSON.stringify({ input: textInput("question") }),
      },
      {
        threadId: thread.id,
        sequence: 2,
        type: "turn/started",
        ...threadEventFields,
        data: JSON.stringify({}),
      },
      {
        threadId: thread.id,
        sequence: 3,
        type: "item/completed",
        ...threadEventFields,
        itemId: "command-1",
        itemKind: "commandExecution",
        data: JSON.stringify({
          item: { type: "commandExecution", id: "command-1" },
        }),
      },
      {
        threadId: thread.id,
        sequence: 4,
        type: "item/completed",
        ...threadEventFields,
        itemId: "message-1",
        itemKind: "agentMessage",
        data: JSON.stringify({
          item: { type: "agentMessage", id: "message-1", text: "answer" },
        }),
      },
      {
        threadId: thread.id,
        sequence: 5,
        type: "turn/completed",
        ...threadEventFields,
        data: JSON.stringify({ status: "completed" }),
      },
    ]);

    expect(
      listStoredConversationOutlineEventRows(db, {
        threadId: thread.id,
      }).map((row) => row.sequence),
    ).toEqual([1, 2, 4, 5]);
  });

  it("lists accepted input rows for requested client turn sequences", () => {
    const { db, thread } = setup();

    insertEvents(db, noopNotifier, [
      {
        threadId: thread.id,
        sequence: 1,
        type: "client/turn/requested",
        ...threadEventFields,
        data: JSON.stringify({
          direction: "outbound",
          requestId: "creq_23456789ab",
          source: "tell",
          initiator: "user",
          input: textInput("first"),
          target: { kind: "new-turn" },
          request: { method: "turn/start", params: {} },
          execution: {
            model: "gpt-5",
            reasoningLevel: "medium",
            permissionMode: "workspace-write",
            source: "client/turn/requested",
            serviceTier: "auto",
          },
        }),
      },
      {
        threadId: thread.id,
        sequence: 2,
        type: "client/turn/requested",
        ...threadEventFields,
        data: JSON.stringify({
          direction: "outbound",
          requestId: "creq_23456789ac",
          source: "tell",
          initiator: "user",
          input: textInput("second"),
          target: { kind: "new-turn" },
          request: { method: "turn/start", params: {} },
          execution: {
            model: "gpt-5",
            reasoningLevel: "medium",
            permissionMode: "workspace-write",
            source: "client/turn/requested",
            serviceTier: "auto",
          },
        }),
      },
      {
        threadId: thread.id,
        sequence: 3,
        type: "turn/input/accepted",
        ...createTurnEventFields({ turnId: "turn-1" }),
        data: JSON.stringify({
          clientRequestId: "creq_23456789ab",
          ignoredLargeField: "x".repeat(50_000),
        }),
      },
      {
        threadId: thread.id,
        sequence: 4,
        type: "turn/input/accepted",
        ...createTurnEventFields({ turnId: "turn-2" }),
        data: JSON.stringify({
          clientRequestId: "creq_23456789ad",
        }),
      },
      {
        threadId: thread.id,
        sequence: 5,
        type: "turn/input/accepted",
        ...createTurnEventFields({ turnId: "turn-3" }),
        data: JSON.stringify({
          clientRequestId: "creq_23456789ac",
        }),
      },
    ]);

    expect(
      listStoredTurnInputAcceptedRowsByClientRequestIds(db, {
        threadId: thread.id,
        afterSequence: 2,
        clientRequestIds: ["creq_23456789ab", "creq_23456789ac"],
        limit: 10,
        maxBytes: 10_000,
      }).rows.map((row) => row.sequence),
    ).toEqual([3, 5]);
    expect(
      listStoredTurnInputAcceptedRowsByClientRequestIds(db, {
        afterSequence: 2,
        beforeOrAtSequence: 4,
        clientRequestIds: ["creq_23456789ab", "creq_23456789ac"],
        limit: 10,
        maxBytes: 10_000,
        threadId: thread.id,
      }).rows.map((row) => row.sequence),
    ).toEqual([3]);
    const [boundedAccepted] =
      listStoredTurnInputAcceptedRowsByClientRequestIds(db, {
        afterSequence: 2,
        clientRequestIds: ["creq_23456789ab"],
        limit: 10,
        maxBytes: 1_000,
        threadId: thread.id,
      }).rows;
    expect(Buffer.byteLength(boundedAccepted?.data ?? "", "utf8")).toBeLessThanOrEqual(
      1_000,
    );
    expect(JSON.parse(boundedAccepted?.data ?? "{}")).toEqual({
      clientRequestId: "creq_23456789ab",
    });
  });

  it("lists only the latest goal event row per thread", () => {
    const { db, project, thread } = setup();
    const otherThread = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
    });

    insertEvents(db, noopNotifier, [
      {
        threadId: thread.id,
        sequence: 1,
        type: "thread/goal/updated",
        ...threadEventFields,
        providerThreadId: "provider-thread-1",
        data: JSON.stringify({
          objective: "Old goal",
          status: "active",
          tokenBudget: null,
          tokensUsed: 1,
          timeUsedSeconds: 1,
        }),
      },
      {
        threadId: thread.id,
        sequence: 2,
        type: "thread/goal/cleared",
        ...threadEventFields,
        providerThreadId: "provider-thread-1",
        data: JSON.stringify({}),
      },
      {
        threadId: otherThread.id,
        sequence: 1,
        type: "thread/goal/updated",
        ...threadEventFields,
        providerThreadId: "provider-thread-2",
        data: JSON.stringify({
          objective: `Active goal ${"界".repeat(10_000)}`,
          status: "active",
          tokenBudget: null,
          tokensUsed: 2,
          timeUsedSeconds: 2,
        }),
      },
    ]);

    const rowsByThreadId = new Map(
      listLatestGoalEventRowsByThreadIds(db, {
        threadIds: [thread.id, otherThread.id],
      }).map((row) => [row.threadId, row]),
    );

    expect(rowsByThreadId.get(thread.id)?.type).toBe("thread/goal/cleared");
    expect(rowsByThreadId.get(thread.id)?.sequence).toBe(2);
    expect(rowsByThreadId.get(otherThread.id)?.type).toBe(
      "thread/goal/updated",
    );
    expect(rowsByThreadId.get(otherThread.id)?.sequence).toBe(1);

    const boundedGoal = listLatestGoalEventRowsForThread(db, {
      limit: 1,
      maxBytes: 2_000,
      threadId: otherThread.id,
    });
    expect(boundedGoal.dataBytes).toBeLessThanOrEqual(2_000);
    expect(boundedGoal.rows[0]?.type).toBe("thread/goal/updated");
    expect(JSON.parse(boundedGoal.rows[0]?.data ?? "{}")).toMatchObject({
      objective: expect.stringContaining("large goal details omitted"),
      status: "active",
      tokensUsed: 2,
    });
  });

  it("lists only open accepted turn inputs after the latest interruption", () => {
    const { db, project, thread } = setup();
    const otherThread = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
    });

    insertEvents(db, noopNotifier, [
      {
        threadId: thread.id,
        sequence: 1,
        type: "turn/input/accepted",
        ...createTurnEventFields({ turnId: "turn-completed" }),
        data: JSON.stringify({ clientRequestId: "creq_23456789aa" }),
      },
      {
        threadId: thread.id,
        sequence: 2,
        type: "turn/completed",
        ...createTurnEventFields({ turnId: "turn-completed" }),
        data: JSON.stringify({ status: "completed" }),
      },
      {
        threadId: thread.id,
        sequence: 3,
        type: "turn/input/accepted",
        ...createTurnEventFields({ turnId: "turn-interrupted" }),
        data: JSON.stringify({ clientRequestId: "creq_23456789ab" }),
      },
      {
        threadId: thread.id,
        sequence: 4,
        type: "system/thread/interrupted",
        ...threadEventFields,
        data: JSON.stringify({ reason: "user" }),
      },
      {
        threadId: thread.id,
        sequence: 5,
        type: "turn/input/accepted",
        ...createTurnEventFields({ turnId: "turn-open" }),
        data: JSON.stringify({ clientRequestId: "creq_23456789ac" }),
      },
      {
        threadId: otherThread.id,
        sequence: 1,
        type: "turn/input/accepted",
        ...createTurnEventFields({ turnId: "turn-other-open" }),
        data: JSON.stringify({ clientRequestId: "creq_23456789ad" }),
      },
    ]);

    const rowsByThreadId = new Map(
      listOpenTurnInputAcceptedRowsByThreadIds(db, {
        threadIds: [thread.id, otherThread.id],
      }).map((row) => [row.threadId, row]),
    );

    expect(rowsByThreadId.get(thread.id)?.sequence).toBe(5);
    expect(rowsByThreadId.get(otherThread.id)?.sequence).toBe(1);
  });

  it("lists client turn request rows by thread/request keys", () => {
    const { db, project, thread } = setup();
    const otherThread = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
    });

    insertEvents(db, noopNotifier, [
      {
        threadId: thread.id,
        sequence: 1,
        type: "client/turn/requested",
        ...threadEventFields,
        data: clientTurnRequestData("creq_23456789aa", "first"),
      },
      {
        threadId: thread.id,
        sequence: 2,
        type: "client/turn/requested",
        ...threadEventFields,
        data: clientTurnRequestData("creq_23456789ab", "ignored"),
      },
      {
        threadId: otherThread.id,
        sequence: 1,
        type: "client/turn/requested",
        ...threadEventFields,
        data: clientTurnRequestData("creq_23456789aa", "same id elsewhere"),
      },
    ]);

    const rowsByThreadId = new Map(
      listStoredClientTurnRequestRowsByKeys(db, {
        keys: [
          { threadId: thread.id, requestId: "creq_23456789aa" },
          { threadId: otherThread.id, requestId: "creq_23456789aa" },
        ],
      }).map((row) => [row.threadId, row]),
    );

    expect(rowsByThreadId.get(thread.id)?.sequence).toBe(1);
    expect(rowsByThreadId.get(otherThread.id)?.sequence).toBe(1);
    expect(rowsByThreadId.size).toBe(2);
  });

  it("lists client turn request ids in range with a storage predicate", () => {
    const { db, project, thread } = setup();
    const otherThread = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
    });

    insertEvents(db, noopNotifier, [
      {
        threadId: thread.id,
        sequence: 1,
        type: "client/turn/requested",
        ...threadEventFields,
        data: JSON.stringify({
          direction: "outbound",
          requestId: "creq_23456789ab",
          source: "tell",
          initiator: "user",
          input: textInput("first"),
          target: { kind: "new-turn" },
          request: { method: "turn/start", params: {} },
          execution: {
            model: "gpt-5",
            reasoningLevel: "medium",
            permissionMode: "workspace-write",
            source: "client/turn/requested",
            serviceTier: "auto",
          },
        }),
      },
      {
        threadId: thread.id,
        sequence: 2,
        type: "system/error",
        ...threadEventFields,
        data: JSON.stringify({ code: "debug", message: "ignored" }),
      },
      {
        threadId: thread.id,
        sequence: 3,
        type: "client/turn/requested",
        ...threadEventFields,
        data: JSON.stringify({
          direction: "outbound",
          requestId: "creq_23456789ac",
          source: "tell",
          initiator: "user",
          input: textInput("second"),
          target: { kind: "new-turn" },
          request: { method: "turn/start", params: {} },
          execution: {
            model: "gpt-5",
            reasoningLevel: "medium",
            permissionMode: "workspace-write",
            source: "client/turn/requested",
            serviceTier: "auto",
          },
        }),
      },
      {
        threadId: otherThread.id,
        sequence: 1,
        type: "client/turn/requested",
        ...threadEventFields,
        data: JSON.stringify({
          direction: "outbound",
          requestId: "creq_23456789ad",
          source: "tell",
          initiator: "user",
          input: textInput("other thread"),
          target: { kind: "new-turn" },
          request: { method: "turn/start", params: {} },
          execution: {
            model: "gpt-5",
            reasoningLevel: "medium",
            permissionMode: "workspace-write",
            source: "client/turn/requested",
            serviceTier: "auto",
          },
        }),
      },
    ]);

    expect(
      listStoredClientTurnRequestIdsInRange(db, {
        threadId: thread.id,
        seqStart: 1,
        seqEnd: 3,
      }),
    ).toEqual(["creq_23456789ab", "creq_23456789ac"]);
    expect(
      listStoredClientTurnRequestIdsInRange(db, {
        threadId: thread.id,
        seqStart: 2,
        seqEnd: 3,
      }),
    ).toEqual(["creq_23456789ac"]);
  });

  it("lists thread provisioning rows by provisioning id with a storage predicate", () => {
    const { db, thread } = setup();

    insertEvents(db, noopNotifier, [
      {
        threadId: thread.id,
        sequence: 1,
        type: "system/thread-provisioning",
        ...threadEventFields,
        data: JSON.stringify({
          provisioningId: "tpv-target",
          status: "active",
          environmentId: "env-1",
          entries: [],
        }),
      },
      {
        threadId: thread.id,
        sequence: 2,
        type: "system/thread-provisioning",
        ...threadEventFields,
        data: JSON.stringify({
          provisioningId: "tpv-other",
          status: "active",
          environmentId: "env-1",
          entries: [],
        }),
      },
      {
        threadId: thread.id,
        sequence: 3,
        type: "system/thread-provisioning",
        ...threadEventFields,
        data: JSON.stringify({
          provisioningId: "tpv-target",
          status: "completed",
          environmentId: "env-1",
          entries: [],
        }),
      },
    ]);

    expect(
      listStoredThreadProvisioningRowsByProvisioningId(db, {
        threadId: thread.id,
        provisioningId: "tpv-target",
      }).map((row) => row.sequence),
    ).toEqual([1, 3]);
  });

  it("appends stored thread events and exposes the latest thread runtime markers", () => {
    const { db, thread } = setup();

    const firstSequence = appendStoredThreadEvent(db, noopNotifier, {
      threadId: thread.id,
      scope: threadScope(),
      type: "client/turn/requested",
      data: {
        direction: "outbound",
        source: "spawn",
        initiator: "user",
        senderThreadId: null,
        requestId: "creq_runtime",
        input: textInput("start"),
        target: { kind: "thread-start" },
        request: { method: "thread/start", params: {} },
        execution: {
          model: "gpt-5",
          reasoningLevel: "medium",
          permissionMode: "workspace-write",
          source: "client/turn/requested",
          serviceTier: "default",
        },
      },
    });

    const secondSequence = db.transaction(
      (tx) =>
        appendStoredThreadEventInTransaction(tx, {
          threadId: thread.id,
          scope: turnScope("turn_1"),
          providerThreadId: "provider_thr_1",
          type: "turn/started",
          data: {
            providerThreadId: "provider_thr_1",
          },
        }),
      { behavior: "immediate" },
    );

    expect(firstSequence).toBe(1);
    expect(secondSequence).toBe(2);
    expect(getActiveStoredTurnId(db, thread.id)).toBe("turn_1");
    expect(getLastStoredProviderThreadId(db, thread.id)).toBe("provider_thr_1");
    expect(getLastStoredTurnRequestEvent(db, thread.id)).toMatchObject({
      threadId: thread.id,
      sequence: 1,
      type: "client/turn/requested",
    });

    appendStoredThreadEvent(db, noopNotifier, {
      threadId: thread.id,
      scope: turnScope("turn_1"),
      providerThreadId: "provider_thr_1",
      type: "turn/completed",
      data: {
        providerThreadId: "provider_thr_1",
        status: "completed",
      },
    });
    expect(getActiveStoredTurnId(db, thread.id)).toBeNull();
    appendStoredThreadEvent(db, noopNotifier, {
      threadId: thread.id,
      scope: turnScope("turn_1"),
      providerThreadId: "provider_thr_1",
      type: "turn/started",
      data: {
        providerThreadId: "provider_thr_1",
      },
    });
    expect(getActiveStoredTurnId(db, thread.id)).toBeNull();
  });

  it("resets the latest provider thread id after an environment directory update", () => {
    const { db, thread } = setup();

    appendStoredThreadEvent(db, noopNotifier, {
      threadId: thread.id,
      scope: threadScope(),
      providerThreadId: "provider_old",
      type: "thread/identity",
      data: {
        providerThreadId: "provider_old",
      },
    });
    expect(getLastStoredProviderThreadId(db, thread.id)).toBe("provider_old");

    appendStoredThreadEvent(db, noopNotifier, {
      threadId: thread.id,
      scope: threadScope(),
      type: "system/operation",
      data: {
        operation: "environment_directory_update",
        operationId: "evt_environment_switch",
        status: "completed",
        message: "Updated environment directory",
        metadata: {
          nextEnvironmentId: "env_next",
          nextPath: "/tmp/next",
          previousEnvironmentId: "env_previous",
          previousPath: "/tmp/previous",
        },
      },
    });
    appendStoredThreadEvent(db, noopNotifier, {
      threadId: thread.id,
      scope: turnScope("turn_1"),
      providerThreadId: "provider_old",
      type: "turn/completed",
      data: {
        providerThreadId: "provider_old",
        status: "completed",
      },
    });
    expect(getLastStoredProviderThreadId(db, thread.id)).toBeNull();

    appendStoredThreadEvent(db, noopNotifier, {
      threadId: thread.id,
      scope: threadScope(),
      providerThreadId: "provider_new",
      type: "thread/identity",
      data: {
        providerThreadId: "provider_new",
      },
    });
    expect(getLastStoredProviderThreadId(db, thread.id)).toBe("provider_new");
  });

  it("ignores delegated child turn starts when reconstructing the active stored turn", () => {
    const { db, thread } = setup();

    appendStoredThreadEvent(db, noopNotifier, {
      threadId: thread.id,
      scope: turnScope("root_turn"),
      providerThreadId: "provider_thr_1",
      type: "turn/started",
      data: {
        providerThreadId: "provider_thr_1",
      },
    });
    appendStoredThreadEvent(db, noopNotifier, {
      threadId: thread.id,
      scope: turnScope("child_turn"),
      providerThreadId: "provider_thr_1",
      type: "turn/started",
      data: {
        providerThreadId: "provider_thr_1",
        parentToolCallId: "delegation-1",
      },
    });

    expect(getActiveStoredTurnId(db, thread.id)).toBe("root_turn");

    appendStoredThreadEvent(db, noopNotifier, {
      threadId: thread.id,
      scope: turnScope("root_turn"),
      providerThreadId: "provider_thr_1",
      type: "turn/completed",
      data: {
        providerThreadId: "provider_thr_1",
        status: "completed",
      },
    });

    expect(getActiveStoredTurnId(db, thread.id)).toBeNull();
  });

  it("appends stored thread events in one transaction with per-thread sequences", () => {
    const { db, project, thread } = setup();
    const otherThread = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
    });

    const sequences = db.transaction(
      (tx) =>
        appendStoredThreadEventsInTransaction(tx, [
          {
            threadId: thread.id,
            scope: turnScope("turn_1"),
            providerThreadId: "provider_thr_1",
            type: "turn/started",
            data: {
              providerThreadId: "provider_thr_1",
            },
          },
          {
            threadId: thread.id,
            scope: turnScope("turn_1"),
            providerThreadId: "provider_thr_1",
            type: "turn/completed",
            data: {
              providerThreadId: "provider_thr_1",
              status: "interrupted",
            },
          },
          {
            threadId: otherThread.id,
            scope: threadScope(),
            type: "system/thread/interrupted",
            data: {
              reason: "host-daemon-restarted",
            },
          },
        ]),
      { behavior: "immediate" },
    );

    expect(sequences).toEqual([1, 2, 1]);
    expect(
      listEvents(db, { threadId: thread.id }).map((event) => event.sequence),
    ).toEqual([1, 2]);
    expect(
      listEvents(db, { threadId: otherThread.id }).map(
        (event) => event.sequence,
      ),
    ).toEqual([1]);
  });

  it("lists completed turns for a specific thread set", () => {
    const { db, project, thread } = setup();
    const otherThread = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
    });

    insertEvents(db, noopNotifier, [
      {
        threadId: thread.id,
        sequence: 1,
        scope: turnScope("turn_a"),
        type: "turn/completed",
        itemId: null,
        itemKind: null,
        data: JSON.stringify({
          providerThreadId: "provider_a",
          turnId: "turn_a",
          status: "completed",
        }),
      },
      {
        threadId: otherThread.id,
        sequence: 1,
        scope: turnScope("turn_b"),
        type: "turn/completed",
        itemId: null,
        itemKind: null,
        data: JSON.stringify({
          providerThreadId: "provider_b",
          turnId: "turn_b",
          status: "completed",
        }),
      },
    ]);

    expect(listCompletedTurnsByThreadIds(db, [thread.id])).toEqual([
      {
        threadId: thread.id,
        turnId: "turn_a",
      },
    ]);
  });

  it("lists active turn and latest provider state for thread interruption", () => {
    const { db, project, thread } = setup();
    const completedThread = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
    });
    const noProviderThread = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
    });
    const noEventThread = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
    });

    insertEvents(db, noopNotifier, [
      {
        threadId: thread.id,
        sequence: 1,
        scope: turnScope("turn_active"),
        providerThreadId: "provider_active",
        type: "turn/started",
        itemId: null,
        itemKind: null,
        data: JSON.stringify({
          providerThreadId: "provider_active",
          turnId: "turn_active",
        }),
      },
      {
        threadId: completedThread.id,
        sequence: 1,
        scope: turnScope("turn_done"),
        providerThreadId: "provider_done",
        type: "turn/started",
        itemId: null,
        itemKind: null,
        data: JSON.stringify({
          providerThreadId: "provider_done",
          turnId: "turn_done",
        }),
      },
      {
        threadId: completedThread.id,
        sequence: 2,
        scope: turnScope("turn_done"),
        providerThreadId: "provider_done",
        type: "turn/completed",
        itemId: null,
        itemKind: null,
        data: JSON.stringify({
          providerThreadId: "provider_done",
          turnId: "turn_done",
          status: "completed",
        }),
      },
      {
        threadId: noProviderThread.id,
        sequence: 1,
        scope: turnScope("turn_no_provider"),
        providerThreadId: null,
        type: "turn/started",
        itemId: null,
        itemKind: null,
        data: JSON.stringify({
          providerThreadId: null,
          turnId: "turn_no_provider",
        }),
      },
    ]);

    expect(
      listThreadTurnInterruptionEventStates(db, {
        threadIds: [
          thread.id,
          completedThread.id,
          noProviderThread.id,
          noEventThread.id,
        ],
      }),
    ).toEqual([
      {
        activeTurnId: "turn_active",
        latestProviderThreadId: "provider_active",
        threadId: thread.id,
      },
      {
        activeTurnId: null,
        latestProviderThreadId: "provider_done",
        threadId: completedThread.id,
      },
      {
        activeTurnId: "turn_no_provider",
        latestProviderThreadId: null,
        threadId: noProviderThread.id,
      },
      {
        activeTurnId: null,
        latestProviderThreadId: null,
        threadId: noEventThread.id,
      },
    ]);
  });

  it("ignores delegated child turn starts for thread interruption active-turn lookup", () => {
    const { db, thread } = setup();

    insertEvents(db, noopNotifier, [
      {
        threadId: thread.id,
        sequence: 1,
        scope: turnScope("root_turn"),
        providerThreadId: "provider_thr_1",
        type: "turn/started",
        itemId: null,
        itemKind: null,
        data: JSON.stringify({
          providerThreadId: "provider_thr_1",
          turnId: "root_turn",
        }),
      },
      {
        threadId: thread.id,
        sequence: 2,
        scope: turnScope("child_turn"),
        providerThreadId: "provider_thr_1",
        type: "turn/started",
        itemId: null,
        itemKind: null,
        data: JSON.stringify({
          providerThreadId: "provider_thr_1",
          turnId: "child_turn",
          parentToolCallId: "delegation-1",
        }),
      },
    ]);

    expect(
      listThreadTurnInterruptionEventStates(db, {
        threadIds: [thread.id],
      }),
    ).toEqual([
      {
        activeTurnId: "root_turn",
        latestProviderThreadId: "provider_thr_1",
        threadId: thread.id,
      },
    ]);
  });

  it("returns high-water marks per thread", () => {
    const { db, project, thread } = setup();
    const thread2 = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
    });

    insertEvents(db, noopNotifier, [
      {
        threadId: thread.id,
        sequence: 1,
        type: "system/error",
        ...threadEventFields,
        data: "{}",
      },
      {
        threadId: thread.id,
        sequence: 5,
        type: "system/error",
        ...threadEventFields,
        data: "{}",
      },
      {
        threadId: thread2.id,
        sequence: 3,
        type: "system/error",
        ...threadEventFields,
        data: "{}",
      },
    ]);

    const hwm = getHighWaterMarks(db);
    expect(hwm[thread.id]).toBe(5);
    expect(hwm[thread2.id]).toBe(3);
  });

  it("returns high-water marks for specific threads", () => {
    const { db, project, thread } = setup();
    const thread2 = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
    });

    insertEvents(db, noopNotifier, [
      {
        threadId: thread.id,
        sequence: 10,
        type: "system/error",
        ...threadEventFields,
        data: "{}",
      },
      {
        threadId: thread2.id,
        sequence: 3,
        type: "system/error",
        ...threadEventFields,
        data: "{}",
      },
    ]);

    const hwm = getHighWaterMarks(db, [thread.id]);
    expect(hwm[thread.id]).toBe(10);
    expect(hwm[thread2.id]).toBeUndefined();
  });

  it("lists events after a given sequence", () => {
    const { db, thread } = setup();

    insertEvents(db, noopNotifier, [
      {
        threadId: thread.id,
        sequence: 1,
        type: "system/error",
        ...threadEventFields,
        data: "{}",
      },
      {
        threadId: thread.id,
        sequence: 2,
        type: "system/error",
        ...threadEventFields,
        data: "{}",
      },
      {
        threadId: thread.id,
        sequence: 3,
        type: "system/error",
        ...threadEventFields,
        data: "{}",
      },
    ]);

    const after1 = listEvents(db, { threadId: thread.id, afterSequence: 1 });
    expect(after1).toHaveLength(2);
    expect(after1[0]!.sequence).toBe(2);
  });

  it("returns the latest sequence for a thread", () => {
    const { db, thread } = setup();

    insertEvents(db, noopNotifier, [
      {
        threadId: thread.id,
        sequence: 2,
        type: "system/error",
        ...threadEventFields,
        data: "{}",
      },
      {
        threadId: thread.id,
        sequence: 5,
        type: "system/error",
        ...threadEventFields,
        data: "{}",
      },
    ]);

    expect(getLatestThreadSequence(db, { threadId: thread.id })).toBe(5);
  });

  it("prunes event types before a sequence cutoff and keeps recent rows", () => {
    const { db, thread } = setup();

    insertEvents(db, noopNotifier, [
      {
        threadId: thread.id,
        sequence: 1,
        type: "thread/tokenUsage/updated",
        ...createTurnEventFields({ turnId: "turn-1" }),
        data: "{}",
      },
      {
        threadId: thread.id,
        sequence: 2,
        type: "thread/tokenUsage/updated",
        ...createTurnEventFields({ turnId: "turn-1" }),
        data: "{}",
      },
      {
        threadId: thread.id,
        sequence: 3,
        type: "thread/tokenUsage/updated",
        ...createTurnEventFields({ turnId: "turn-1" }),
        data: "{}",
      },
      {
        threadId: thread.id,
        sequence: 4,
        type: "thread/tokenUsage/updated",
        ...createTurnEventFields({ turnId: "turn-1" }),
        data: "{}",
      },
      {
        threadId: thread.id,
        sequence: 5,
        type: "thread/tokenUsage/updated",
        ...createTurnEventFields({ turnId: "turn-1" }),
        data: "{}",
      },
    ]);

    const latestSequence = getLatestThreadSequence(db, { threadId: thread.id });
    const removed = pruneThreadEventsBeforeSequence(db, {
      threadId: thread.id,
      sequenceCutoff: latestSequence - 2,
      types: ["thread/tokenUsage/updated"],
    });

    expect(removed).toBe(3);
    expect(
      listEvents(db, { threadId: thread.id }).map((event) => event.sequence),
    ).toEqual([4, 5]);
  });

  it("prunes token-usage rows before a sequence cutoff but keeps the latest totals row and latest context row", () => {
    const { db, thread } = setup();

    insertEvents(db, noopNotifier, [
      {
        threadId: thread.id,
        sequence: 1,
        type: "thread/tokenUsage/updated",
        ...createTurnEventFields({ turnId: "turn-1" }),
        data: createTokenUsageData({
          totalTokens: 10,
          modelContextWindow: 200_000,
        }),
      },
      {
        threadId: thread.id,
        sequence: 2,
        type: "thread/tokenUsage/updated",
        ...createTurnEventFields({ turnId: "turn-1" }),
        data: createTokenUsageData({
          totalTokens: 20,
          modelContextWindow: null,
        }),
      },
      {
        threadId: thread.id,
        sequence: 3,
        type: "thread/tokenUsage/updated",
        ...createTurnEventFields({ turnId: "turn-1" }),
        data: createTokenUsageData({
          totalTokens: 30,
          modelContextWindow: null,
        }),
      },
      {
        threadId: thread.id,
        sequence: 4,
        type: "thread/tokenUsage/updated",
        ...createTurnEventFields({ turnId: "turn-1" }),
        data: createTokenUsageData({
          totalTokens: 40,
          modelContextWindow: null,
        }),
      },
    ]);

    const removed = pruneTokenUsageEventsBeforeSequence(db, {
      threadId: thread.id,
      sequenceCutoff: 4,
    });

    expect(removed).toBe(2);
    expect(
      listEvents(db, { threadId: thread.id }).map((event) => event.sequence),
    ).toEqual([1, 4]);
  });

  it("preserves root token usage instead of a newer nested-turn report while pruning", () => {
    const { db, thread } = setup();

    insertEvents(db, noopNotifier, [
      {
        threadId: thread.id,
        sequence: 1,
        type: "thread/tokenUsage/updated",
        ...createTurnEventFields({ turnId: "turn-root" }),
        data: createTokenUsageData({
          totalTokens: 80_000,
          modelContextWindow: 200_000,
        }),
      },
      {
        threadId: thread.id,
        sequence: 2,
        type: "thread/tokenUsage/updated",
        ...createTurnEventFields({ turnId: "turn-root" }),
        data: createTokenUsageData({
          totalTokens: 90_000,
          modelContextWindow: null,
        }),
      },
      {
        threadId: thread.id,
        sequence: 3,
        type: "turn/started",
        ...createTurnEventFields({ turnId: "turn-subagent" }),
        data: JSON.stringify({ parentToolCallId: "call-subagent" }),
      },
      {
        threadId: thread.id,
        sequence: 4,
        type: "thread/tokenUsage/updated",
        ...createTurnEventFields({ turnId: "turn-subagent" }),
        data: createTokenUsageData({
          totalTokens: 15_000,
          modelContextWindow: 200_000,
        }),
      },
    ]);

    const removed = pruneTokenUsageEventsBeforeSequence(db, {
      threadId: thread.id,
      sequenceCutoff: 4,
    });

    expect(removed).toBe(1);
    expect(
      listEvents(db, { threadId: thread.id }).map((event) => event.sequence),
    ).toEqual([1, 2, 3]);
  });

  it("prunes context-window rows before a sequence cutoff but keeps the latest usage row and latest context row", () => {
    const { db, thread } = setup();

    insertEvents(db, noopNotifier, [
      {
        threadId: thread.id,
        sequence: 1,
        type: "thread/contextWindowUsage/updated",
        ...createTurnEventFields({ turnId: "turn-1" }),
        data: createContextWindowUsageData({
          usedTokens: 10,
          modelContextWindow: 200_000,
        }),
      },
      {
        threadId: thread.id,
        sequence: 2,
        type: "thread/contextWindowUsage/updated",
        ...createTurnEventFields({ turnId: "turn-1" }),
        data: createContextWindowUsageData({
          usedTokens: 20,
          modelContextWindow: null,
        }),
      },
      {
        threadId: thread.id,
        sequence: 3,
        type: "thread/contextWindowUsage/updated",
        ...createTurnEventFields({ turnId: "turn-1" }),
        data: createContextWindowUsageData({
          usedTokens: 30,
          modelContextWindow: null,
        }),
      },
      {
        threadId: thread.id,
        sequence: 4,
        type: "thread/contextWindowUsage/updated",
        ...createTurnEventFields({ turnId: "turn-1" }),
        data: createContextWindowUsageData({
          usedTokens: 40,
          modelContextWindow: null,
        }),
      },
    ]);

    const removed = pruneContextWindowUsageEventsBeforeSequence(db, {
      threadId: thread.id,
      sequenceCutoff: 4,
    });

    expect(removed).toBe(2);
    expect(
      listEvents(db, { threadId: thread.id }).map((event) => event.sequence),
    ).toEqual([1, 4]);
  });

  it("prunes resolved assistant deltas but preserves the first delta row", () => {
    const { db, thread } = setup();

    insertEvents(db, noopNotifier, [
      {
        threadId: thread.id,
        sequence: 1,
        scope: turnScope("turn-1"),
        type: "item/agentMessage/delta",
        itemId: "msg-1",
        itemKind: null,
        data: JSON.stringify({ itemId: "msg-1", delta: "Hel" }),
      },
      {
        threadId: thread.id,
        sequence: 2,
        scope: turnScope("turn-1"),
        type: "item/agentMessage/delta",
        itemId: "msg-1",
        itemKind: null,
        data: JSON.stringify({ itemId: "msg-1", delta: "lo" }),
      },
      {
        threadId: thread.id,
        sequence: 3,
        scope: turnScope("turn-1"),
        type: "item/agentMessage/delta",
        itemId: "msg-1",
        itemKind: null,
        data: JSON.stringify({ itemId: "msg-1", delta: "!" }),
      },
      {
        threadId: thread.id,
        sequence: 4,
        scope: turnScope("turn-1"),
        type: "item/completed",
        itemId: "msg-1",
        itemKind: "agentMessage",
        data: JSON.stringify({
          item: {
            id: "msg-1",
            type: "agentMessage",
            text: "Hello!",
          },
        }),
      },
    ]);

    const removed = pruneResolvedItemDeltas(db, {
      threadId: thread.id,
    });

    expect(removed).toBe(2);
    expect(
      listEvents(db, { threadId: thread.id }).map((event) => event.sequence),
    ).toEqual([1, 4]);
  });

  it("keeps unresolved assistant deltas", () => {
    const { db, thread } = setup();

    insertEvents(db, noopNotifier, [
      {
        threadId: thread.id,
        sequence: 1,
        scope: turnScope("turn-1"),
        type: "item/agentMessage/delta",
        itemId: "msg-1",
        itemKind: null,
        data: JSON.stringify({ itemId: "msg-1", delta: "Hel" }),
      },
      {
        threadId: thread.id,
        sequence: 2,
        scope: turnScope("turn-1"),
        type: "item/agentMessage/delta",
        itemId: "msg-1",
        itemKind: null,
        data: JSON.stringify({ itemId: "msg-1", delta: "lo" }),
      },
    ]);

    const removed = pruneResolvedItemDeltas(db, {
      threadId: thread.id,
    });

    expect(removed).toBe(0);
    expect(
      listEvents(db, { threadId: thread.id }).map((event) => event.sequence),
    ).toEqual([1, 2]);
  });

  it("does not prune later-turn assistant deltas when the same item id is reused", () => {
    const { db, thread } = setup();

    insertEvents(db, noopNotifier, [
      {
        threadId: thread.id,
        sequence: 1,
        scope: turnScope("turn-1"),
        type: "item/agentMessage/delta",
        itemId: "msg-1",
        itemKind: null,
        data: JSON.stringify({ itemId: "msg-1", delta: "Hel" }),
      },
      {
        threadId: thread.id,
        sequence: 2,
        scope: turnScope("turn-1"),
        type: "item/agentMessage/delta",
        itemId: "msg-1",
        itemKind: null,
        data: JSON.stringify({ itemId: "msg-1", delta: "lo" }),
      },
      {
        threadId: thread.id,
        sequence: 3,
        scope: turnScope("turn-1"),
        type: "item/completed",
        itemId: "msg-1",
        itemKind: "agentMessage",
        data: JSON.stringify({
          item: {
            id: "msg-1",
            type: "agentMessage",
            text: "Hello",
          },
        }),
      },
      {
        threadId: thread.id,
        sequence: 4,
        scope: turnScope("turn-2"),
        type: "item/agentMessage/delta",
        itemId: "msg-1",
        itemKind: null,
        data: JSON.stringify({ itemId: "msg-1", delta: "New " }),
      },
      {
        threadId: thread.id,
        sequence: 5,
        scope: turnScope("turn-2"),
        type: "item/agentMessage/delta",
        itemId: "msg-1",
        itemKind: null,
        data: JSON.stringify({ itemId: "msg-1", delta: "answer" }),
      },
    ]);

    const removed = pruneResolvedItemDeltas(db, {
      threadId: thread.id,
    });

    expect(removed).toBe(1);
    expect(
      listEvents(db, { threadId: thread.id }).map((event) => event.sequence),
    ).toEqual([1, 3, 4, 5]);
  });

  it("does not prune same-turn assistant deltas for a different parent tool call", () => {
    const { db, thread } = setup();

    insertEvents(db, noopNotifier, [
      {
        threadId: thread.id,
        sequence: 1,
        scope: turnScope("turn-1"),
        type: "item/agentMessage/delta",
        itemId: "msg-1",
        itemKind: null,
        data: JSON.stringify({
          itemId: "msg-1",
          parentToolCallId: "tool-1",
          delta: "Hel",
        }),
      },
      {
        threadId: thread.id,
        sequence: 2,
        scope: turnScope("turn-1"),
        type: "item/agentMessage/delta",
        itemId: "msg-1",
        itemKind: null,
        data: JSON.stringify({
          itemId: "msg-1",
          parentToolCallId: "tool-1",
          delta: "lo",
        }),
      },
      {
        threadId: thread.id,
        sequence: 3,
        scope: turnScope("turn-1"),
        type: "item/completed",
        itemId: "msg-1",
        itemKind: "agentMessage",
        data: JSON.stringify({
          item: {
            id: "msg-1",
            type: "agentMessage",
            text: "Hello",
            parentToolCallId: "tool-1",
          },
        }),
      },
      {
        threadId: thread.id,
        sequence: 4,
        scope: turnScope("turn-1"),
        type: "item/agentMessage/delta",
        itemId: "msg-1",
        itemKind: null,
        data: JSON.stringify({
          itemId: "msg-1",
          parentToolCallId: "tool-2",
          delta: "New ",
        }),
      },
      {
        threadId: thread.id,
        sequence: 5,
        scope: turnScope("turn-1"),
        type: "item/agentMessage/delta",
        itemId: "msg-1",
        itemKind: null,
        data: JSON.stringify({
          itemId: "msg-1",
          parentToolCallId: "tool-2",
          delta: "answer",
        }),
      },
    ]);

    const removed = pruneResolvedItemDeltas(db, {
      threadId: thread.id,
    });

    expect(removed).toBe(1);
    expect(
      listEvents(db, { threadId: thread.id }).map((event) => event.sequence),
    ).toEqual([1, 3, 4, 5]);
  });

  it("prunes resolved command output deltas but preserves the first delta row", () => {
    const { db, thread } = setup();

    insertEvents(db, noopNotifier, [
      {
        threadId: thread.id,
        sequence: 1,
        scope: turnScope("turn-1"),
        type: "item/commandExecution/outputDelta",
        itemId: "cmd-1",
        itemKind: null,
        data: JSON.stringify({ itemId: "cmd-1", delta: "Hel" }),
      },
      {
        threadId: thread.id,
        sequence: 2,
        scope: turnScope("turn-1"),
        type: "item/commandExecution/outputDelta",
        itemId: "cmd-1",
        itemKind: null,
        data: JSON.stringify({ itemId: "cmd-1", delta: "lo" }),
      },
      {
        threadId: thread.id,
        sequence: 3,
        scope: turnScope("turn-1"),
        type: "item/completed",
        itemId: "cmd-1",
        itemKind: "commandExecution",
        data: JSON.stringify({
          item: {
            id: "cmd-1",
            type: "commandExecution",
            command: "printf hello",
            cwd: "/workspace",
            status: "completed",
            approvalStatus: null,
            aggregatedOutput: "Hello",
            exitCode: 0,
          },
        }),
      },
    ]);

    const removed = pruneResolvedItemDeltas(db, {
      threadId: thread.id,
    });

    expect(removed).toBe(1);
    expect(
      listEvents(db, { threadId: thread.id }).map((event) => event.sequence),
    ).toEqual([1, 3]);
  });

  it("keeps command output deltas when completion has no aggregated output", () => {
    const { db, thread } = setup();

    insertEvents(db, noopNotifier, [
      {
        threadId: thread.id,
        sequence: 1,
        scope: turnScope("turn-1"),
        type: "item/commandExecution/outputDelta",
        itemId: "cmd-1",
        itemKind: null,
        data: JSON.stringify({ itemId: "cmd-1", delta: "Hel" }),
      },
      {
        threadId: thread.id,
        sequence: 2,
        scope: turnScope("turn-1"),
        type: "item/commandExecution/outputDelta",
        itemId: "cmd-1",
        itemKind: null,
        data: JSON.stringify({ itemId: "cmd-1", delta: "lo" }),
      },
      {
        threadId: thread.id,
        sequence: 3,
        scope: turnScope("turn-1"),
        type: "item/completed",
        itemId: "cmd-1",
        itemKind: "commandExecution",
        data: JSON.stringify({
          item: {
            id: "cmd-1",
            type: "commandExecution",
            command: "printf hello",
            cwd: "/workspace",
            status: "completed",
            approvalStatus: null,
            exitCode: 0,
          },
        }),
      },
    ]);

    const removed = pruneResolvedItemDeltas(db, {
      threadId: thread.id,
    });

    expect(removed).toBe(0);
    expect(
      listEvents(db, { threadId: thread.id }).map((event) => event.sequence),
    ).toEqual([1, 2, 3]);
  });

  it("does not prune later-turn command deltas when the same item id is reused", () => {
    const { db, thread } = setup();

    insertEvents(db, noopNotifier, [
      {
        threadId: thread.id,
        sequence: 1,
        scope: turnScope("turn-1"),
        type: "item/commandExecution/outputDelta",
        itemId: "cmd-1",
        itemKind: null,
        data: JSON.stringify({ itemId: "cmd-1", delta: "Hel" }),
      },
      {
        threadId: thread.id,
        sequence: 2,
        scope: turnScope("turn-1"),
        type: "item/commandExecution/outputDelta",
        itemId: "cmd-1",
        itemKind: null,
        data: JSON.stringify({ itemId: "cmd-1", delta: "lo" }),
      },
      {
        threadId: thread.id,
        sequence: 3,
        scope: turnScope("turn-1"),
        type: "item/completed",
        itemId: "cmd-1",
        itemKind: "commandExecution",
        data: JSON.stringify({
          item: {
            id: "cmd-1",
            type: "commandExecution",
            command: "printf hello",
            cwd: "/workspace",
            status: "completed",
            approvalStatus: null,
            aggregatedOutput: "Hello",
            exitCode: 0,
          },
        }),
      },
      {
        threadId: thread.id,
        sequence: 4,
        scope: turnScope("turn-2"),
        type: "item/commandExecution/outputDelta",
        itemId: "cmd-1",
        itemKind: null,
        data: JSON.stringify({ itemId: "cmd-1", delta: "New " }),
      },
      {
        threadId: thread.id,
        sequence: 5,
        scope: turnScope("turn-2"),
        type: "item/commandExecution/outputDelta",
        itemId: "cmd-1",
        itemKind: null,
        data: JSON.stringify({ itemId: "cmd-1", delta: "output" }),
      },
    ]);

    const removed = pruneResolvedItemDeltas(db, {
      threadId: thread.id,
    });

    expect(removed).toBe(1);
    expect(
      listEvents(db, { threadId: thread.id }).map((event) => event.sequence),
    ).toEqual([1, 3, 4, 5]);
  });

  it("does not prune same-turn command deltas for a different parent tool call", () => {
    const { db, thread } = setup();

    insertEvents(db, noopNotifier, [
      {
        threadId: thread.id,
        sequence: 1,
        scope: turnScope("turn-1"),
        type: "item/commandExecution/outputDelta",
        itemId: "cmd-1",
        itemKind: null,
        data: JSON.stringify({
          itemId: "cmd-1",
          parentToolCallId: "tool-1",
          delta: "Hel",
        }),
      },
      {
        threadId: thread.id,
        sequence: 2,
        scope: turnScope("turn-1"),
        type: "item/commandExecution/outputDelta",
        itemId: "cmd-1",
        itemKind: null,
        data: JSON.stringify({
          itemId: "cmd-1",
          parentToolCallId: "tool-1",
          delta: "lo",
        }),
      },
      {
        threadId: thread.id,
        sequence: 3,
        scope: turnScope("turn-1"),
        type: "item/completed",
        itemId: "cmd-1",
        itemKind: "commandExecution",
        data: JSON.stringify({
          item: {
            id: "cmd-1",
            type: "commandExecution",
            command: "printf hello",
            cwd: "/workspace",
            status: "completed",
            approvalStatus: null,
            aggregatedOutput: "Hello",
            exitCode: 0,
            parentToolCallId: "tool-1",
          },
        }),
      },
      {
        threadId: thread.id,
        sequence: 4,
        scope: turnScope("turn-1"),
        type: "item/commandExecution/outputDelta",
        itemId: "cmd-1",
        itemKind: null,
        data: JSON.stringify({
          itemId: "cmd-1",
          parentToolCallId: "tool-2",
          delta: "New ",
        }),
      },
      {
        threadId: thread.id,
        sequence: 5,
        scope: turnScope("turn-1"),
        type: "item/commandExecution/outputDelta",
        itemId: "cmd-1",
        itemKind: null,
        data: JSON.stringify({
          itemId: "cmd-1",
          parentToolCallId: "tool-2",
          delta: "output",
        }),
      },
    ]);

    const removed = pruneResolvedItemDeltas(db, {
      threadId: thread.id,
    });

    expect(removed).toBe(1);
    expect(
      listEvents(db, { threadId: thread.id }).map((event) => event.sequence),
    ).toEqual([1, 3, 4, 5]);
  });

  it("prunes resolved reasoning deltas but preserves the first delta row per stream type", () => {
    const { db, thread } = setup();

    insertEvents(db, noopNotifier, [
      {
        threadId: thread.id,
        sequence: 1,
        scope: turnScope("turn-1"),
        type: "item/reasoning/textDelta",
        itemId: "reasoning-1",
        itemKind: null,
        data: JSON.stringify({ itemId: "reasoning-1", delta: "raw " }),
      },
      {
        threadId: thread.id,
        sequence: 2,
        scope: turnScope("turn-1"),
        type: "item/reasoning/textDelta",
        itemId: "reasoning-1",
        itemKind: null,
        data: JSON.stringify({ itemId: "reasoning-1", delta: "content" }),
      },
      {
        threadId: thread.id,
        sequence: 3,
        scope: turnScope("turn-1"),
        type: "item/reasoning/summaryTextDelta",
        itemId: "reasoning-1",
        itemKind: null,
        data: JSON.stringify({ itemId: "reasoning-1", delta: "summary " }),
      },
      {
        threadId: thread.id,
        sequence: 4,
        scope: turnScope("turn-1"),
        type: "item/reasoning/summaryTextDelta",
        itemId: "reasoning-1",
        itemKind: null,
        data: JSON.stringify({ itemId: "reasoning-1", delta: "content" }),
      },
      {
        threadId: thread.id,
        sequence: 5,
        scope: turnScope("turn-1"),
        type: "item/completed",
        itemId: "reasoning-1",
        itemKind: "reasoning",
        data: JSON.stringify({
          item: {
            id: "reasoning-1",
            type: "reasoning",
            content: ["raw content"],
            summary: ["summary content"],
          },
        }),
      },
    ]);

    const removed = pruneResolvedItemDeltas(db, {
      threadId: thread.id,
    });

    expect(removed).toBe(2);
    expect(
      listEvents(db, { threadId: thread.id }).map((event) => event.sequence),
    ).toEqual([1, 3, 5]);
  });

  it("keeps unresolved reasoning deltas", () => {
    const { db, thread } = setup();

    insertEvents(db, noopNotifier, [
      {
        threadId: thread.id,
        sequence: 1,
        scope: turnScope("turn-1"),
        type: "item/reasoning/textDelta",
        itemId: "reasoning-1",
        itemKind: null,
        data: JSON.stringify({ itemId: "reasoning-1", delta: "raw " }),
      },
      {
        threadId: thread.id,
        sequence: 2,
        scope: turnScope("turn-1"),
        type: "item/reasoning/textDelta",
        itemId: "reasoning-1",
        itemKind: null,
        data: JSON.stringify({ itemId: "reasoning-1", delta: "content" }),
      },
    ]);

    const removed = pruneResolvedItemDeltas(db, {
      threadId: thread.id,
    });

    expect(removed).toBe(0);
    expect(
      listEvents(db, { threadId: thread.id }).map((event) => event.sequence),
    ).toEqual([1, 2]);
  });

  it("keeps only the latest backgroundTask progress row while the task runs", () => {
    const { db, thread } = setup();

    const progressData = (taskStatus: string) =>
      JSON.stringify({
        item: {
          id: "task:wf-1",
          type: "backgroundTask",
          taskType: "local_workflow",
          description: "fixture workflow",
          status: "pending",
          taskStatus,
          skipTranscript: false,
        },
      });

    insertEvents(db, noopNotifier, [
      {
        threadId: thread.id,
        sequence: 1,
        scope: turnScope("turn-1"),
        type: "item/started",
        itemId: "task:wf-1",
        itemKind: "backgroundTask",
        data: progressData("running"),
      },
      {
        threadId: thread.id,
        sequence: 2,
        scope: threadScope(),
        type: "item/backgroundTask/progress",
        itemId: "task:wf-1",
        itemKind: "backgroundTask",
        data: progressData("running"),
      },
      {
        threadId: thread.id,
        sequence: 3,
        scope: threadScope(),
        type: "item/backgroundTask/progress",
        itemId: "task:wf-1",
        itemKind: "backgroundTask",
        data: progressData("running"),
      },
      {
        threadId: thread.id,
        sequence: 4,
        scope: threadScope(),
        type: "item/backgroundTask/progress",
        itemId: "task:wf-1",
        itemKind: "backgroundTask",
        data: progressData("running"),
      },
    ]);

    const removed = pruneBackgroundTaskProgressEvents(db, {
      threadId: thread.id,
    });

    expect(removed).toBe(2);
    expect(
      listEvents(db, { threadId: thread.id }).map((event) => event.sequence),
    ).toEqual([1, 4]);
  });

  it("removes all backgroundTask progress rows once the completed event exists", () => {
    const { db, thread } = setup();

    const itemData = (taskStatus: string) =>
      JSON.stringify({
        item: {
          id: "task:wf-1",
          type: "backgroundTask",
          taskType: "local_workflow",
          description: "fixture workflow",
          status: taskStatus === "completed" ? "completed" : "pending",
          taskStatus,
          skipTranscript: false,
        },
      });

    insertEvents(db, noopNotifier, [
      {
        threadId: thread.id,
        sequence: 1,
        scope: turnScope("turn-1"),
        type: "item/started",
        itemId: "task:wf-1",
        itemKind: "backgroundTask",
        data: itemData("running"),
      },
      {
        threadId: thread.id,
        sequence: 2,
        scope: threadScope(),
        type: "item/backgroundTask/progress",
        itemId: "task:wf-1",
        itemKind: "backgroundTask",
        data: itemData("running"),
      },
      {
        threadId: thread.id,
        sequence: 3,
        scope: threadScope(),
        type: "item/backgroundTask/progress",
        itemId: "task:wf-1",
        itemKind: "backgroundTask",
        data: itemData("running"),
      },
      {
        threadId: thread.id,
        sequence: 4,
        scope: threadScope(),
        type: "item/backgroundTask/completed",
        itemId: "task:wf-1",
        itemKind: "backgroundTask",
        data: itemData("completed"),
      },
    ]);

    const removed = pruneBackgroundTaskProgressEvents(db, {
      threadId: thread.id,
    });

    expect(removed).toBe(2);
    expect(
      listEvents(db, { threadId: thread.id }).map((event) => event.sequence),
    ).toEqual([1, 4]);
  });

  it("prunes settled tasks without touching another in-flight task's rows", () => {
    const { db, thread } = setup();

    const taskData = (taskId: string) =>
      JSON.stringify({
        item: {
          id: taskId,
          type: "backgroundTask",
          taskType: "local_workflow",
          description: "fixture workflow",
          status: "pending",
          taskStatus: "running",
          skipTranscript: false,
        },
      });

    insertEvents(db, noopNotifier, [
      {
        threadId: thread.id,
        sequence: 1,
        scope: threadScope(),
        type: "item/backgroundTask/progress",
        itemId: "task:wf-1",
        itemKind: "backgroundTask",
        data: taskData("task:wf-1"),
      },
      {
        threadId: thread.id,
        sequence: 2,
        scope: threadScope(),
        type: "item/backgroundTask/progress",
        itemId: "task:wf-2",
        itemKind: "backgroundTask",
        data: taskData("task:wf-2"),
      },
      {
        threadId: thread.id,
        sequence: 3,
        scope: threadScope(),
        type: "item/backgroundTask/completed",
        itemId: "task:wf-1",
        itemKind: "backgroundTask",
        data: taskData("task:wf-1"),
      },
    ]);

    const removed = pruneBackgroundTaskProgressEvents(db, {
      threadId: thread.id,
    });

    expect(removed).toBe(1);
    expect(
      listEvents(db, { threadId: thread.id }).map((event) => event.sequence),
    ).toEqual([2, 3]);
  });

  it("returns only the highest-sequence backgroundTask state row per item", () => {
    const { db, thread } = setup();

    const taskData = (itemId: string, taskStatus: string) =>
      JSON.stringify({
        item: {
          id: itemId,
          type: "backgroundTask",
          taskType: "local_workflow",
          description: "fixture workflow",
          status: taskStatus === "completed" ? "completed" : "pending",
          taskStatus,
          skipTranscript: false,
        },
      });

    insertEvents(db, noopNotifier, [
      {
        threadId: thread.id,
        sequence: 1,
        scope: turnScope("turn-1"),
        type: "item/started",
        itemId: "task:wf-1",
        itemKind: "backgroundTask",
        data: taskData("task:wf-1", "running"),
      },
      {
        threadId: thread.id,
        sequence: 2,
        scope: threadScope(),
        type: "item/backgroundTask/progress",
        itemId: "task:wf-1",
        itemKind: "backgroundTask",
        data: taskData("task:wf-1", "running"),
      },
      {
        threadId: thread.id,
        sequence: 3,
        scope: threadScope(),
        type: "item/backgroundTask/progress",
        itemId: "task:wf-2",
        itemKind: "backgroundTask",
        data: taskData("task:wf-2", "running"),
      },
      {
        threadId: thread.id,
        sequence: 4,
        scope: threadScope(),
        type: "item/backgroundTask/completed",
        itemId: "task:wf-1",
        itemKind: "backgroundTask",
        data: taskData("task:wf-1", "completed"),
      },
      // Unrelated item id: must not appear in the result.
      {
        threadId: thread.id,
        sequence: 5,
        scope: threadScope(),
        type: "item/backgroundTask/progress",
        itemId: "task:wf-other",
        itemKind: "backgroundTask",
        data: taskData("task:wf-other", "running"),
      },
    ]);

    const rows = listLatestBackgroundTaskStateRowsByItemIds(db, {
      threadId: thread.id,
      itemIds: ["task:wf-1", "task:wf-2"],
      limit: 10,
      maxBytes: 100_000,
    }).rows;

    expect(
      rows.map((row) => ({
        itemId: row.itemId,
        sequence: row.sequence,
        type: row.type,
      })),
    ).toEqual([
      {
        itemId: "task:wf-2",
        sequence: 3,
        type: "item/backgroundTask/progress",
      },
      {
        itemId: "task:wf-1",
        sequence: 4,
        type: "item/backgroundTask/completed",
      },
    ]);

    expect(
      listLatestBackgroundTaskStateRowsByItemIds(db, {
        threadId: thread.id,
        itemIds: [],
        limit: 10,
        maxBytes: 100_000,
      }),
    ).toEqual({ dataBytes: 0, hasMore: false, rows: [] });
  });

  it("returns latest non-terminal open backgroundTask state rows for a thread", () => {
    const { db, project, thread } = setup();
    const otherThread = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
    });

    const taskData = (args: {
      itemId: string;
      itemStatus: "pending" | "completed";
      taskStatus: "running" | "completed";
      taskType: string;
    }) =>
      JSON.stringify({
        item: {
          id: args.itemId,
          type: "backgroundTask",
          taskType: args.taskType,
          description: "fixture background task",
          status: args.itemStatus,
          taskStatus: args.taskStatus,
          skipTranscript: false,
        },
      });

    insertEvents(db, noopNotifier, [
      {
        threadId: thread.id,
        sequence: 1,
        scope: turnScope("turn-1"),
        type: "item/started",
        itemId: "task:wf-start-only",
        itemKind: "backgroundTask",
        data: taskData({
          itemId: "task:wf-start-only",
          itemStatus: "pending",
          taskStatus: "running",
          taskType: LOCAL_WORKFLOW_TASK_TYPE,
        }),
      },
      {
        threadId: thread.id,
        sequence: 2,
        scope: turnScope("turn-1"),
        type: "item/started",
        itemId: "task:wf-progress",
        itemKind: "backgroundTask",
        data: taskData({
          itemId: "task:wf-progress",
          itemStatus: "pending",
          taskStatus: "running",
          taskType: LOCAL_WORKFLOW_TASK_TYPE,
        }),
      },
      {
        threadId: thread.id,
        sequence: 3,
        scope: threadScope(),
        type: "item/backgroundTask/progress",
        itemId: "task:wf-progress",
        itemKind: "backgroundTask",
        data: taskData({
          itemId: "task:wf-progress",
          itemStatus: "pending",
          taskStatus: "running",
          taskType: LOCAL_WORKFLOW_TASK_TYPE,
        }),
      },
      {
        threadId: thread.id,
        sequence: 4,
        scope: turnScope("turn-1"),
        type: "item/started",
        itemId: "task:wf-terminal-progress",
        itemKind: "backgroundTask",
        data: taskData({
          itemId: "task:wf-terminal-progress",
          itemStatus: "pending",
          taskStatus: "running",
          taskType: LOCAL_WORKFLOW_TASK_TYPE,
        }),
      },
      {
        threadId: thread.id,
        sequence: 5,
        scope: threadScope(),
        type: "item/backgroundTask/progress",
        itemId: "task:wf-terminal-progress",
        itemKind: "backgroundTask",
        data: taskData({
          itemId: "task:wf-terminal-progress",
          itemStatus: "completed",
          taskStatus: "completed",
          taskType: LOCAL_WORKFLOW_TASK_TYPE,
        }),
      },
      {
        threadId: thread.id,
        sequence: 6,
        scope: turnScope("turn-1"),
        type: "item/started",
        itemId: "task:wf-completed",
        itemKind: "backgroundTask",
        data: taskData({
          itemId: "task:wf-completed",
          itemStatus: "pending",
          taskStatus: "running",
          taskType: LOCAL_WORKFLOW_TASK_TYPE,
        }),
      },
      {
        threadId: thread.id,
        sequence: 7,
        scope: threadScope(),
        type: "item/backgroundTask/completed",
        itemId: "task:wf-completed",
        itemKind: "backgroundTask",
        data: taskData({
          itemId: "task:wf-completed",
          itemStatus: "completed",
          taskStatus: "completed",
          taskType: LOCAL_WORKFLOW_TASK_TYPE,
        }),
      },
      {
        threadId: thread.id,
        sequence: 8,
        scope: turnScope("turn-1"),
        type: "item/started",
        itemId: "task:cmd-open",
        itemKind: "backgroundTask",
        data: taskData({
          itemId: "task:cmd-open",
          itemStatus: "pending",
          taskStatus: "running",
          taskType: "local_bash",
        }),
      },
      {
        threadId: thread.id,
        sequence: 9,
        scope: threadScope(),
        type: "item/backgroundTask/progress",
        itemId: "task:cmd-open",
        itemKind: "backgroundTask",
        data: taskData({
          itemId: "task:cmd-open",
          itemStatus: "pending",
          taskStatus: "running",
          taskType: "local_bash",
        }),
      },
      {
        threadId: otherThread.id,
        sequence: 1,
        scope: threadScope(),
        type: "item/backgroundTask/progress",
        itemId: "task:other-thread",
        itemKind: "backgroundTask",
        data: taskData({
          itemId: "task:other-thread",
          itemStatus: "pending",
          taskStatus: "running",
          taskType: LOCAL_WORKFLOW_TASK_TYPE,
        }),
      },
    ]);

    const rows = listLatestOpenBackgroundTaskStateRowsForThread(db, {
      limit: 16,
      maxBytes: 256_000,
      maxDataBytes: 16_000,
      threadId: thread.id,
    }).rows;

    expect(
      rows.map((row) => ({
        itemId: row.itemId,
        sequence: row.sequence,
        type: row.type,
      })),
    ).toEqual([
      {
        itemId: "task:wf-start-only",
        sequence: 1,
        type: "item/started",
      },
      {
        itemId: "task:wf-progress",
        sequence: 3,
        type: "item/backgroundTask/progress",
      },
      {
        itemId: "task:cmd-open",
        sequence: 9,
        type: "item/backgroundTask/progress",
      },
    ]);
  });

  it("bounds and compacts newest open background-task state rows", () => {
    const { db, thread } = setup();
    insertEvents(
      db,
      noopNotifier,
      Array.from({ length: 20 }, (_, index) => ({
        threadId: thread.id,
        sequence: index + 1,
        scope: turnScope("turn-1"),
        type: "item/started" as const,
        itemId: `task:${index}`,
        itemKind: "backgroundTask" as const,
        data: JSON.stringify({
          item: {
            type: "backgroundTask",
            id: `task:${index}`,
            taskType: "local_workflow",
            description: `Workflow ${index}`,
            status: "pending",
            taskStatus: "running",
            skipTranscript: false,
            summary: "x".repeat(20_000),
          },
        }),
      })),
    );

    const rows = listLatestOpenBackgroundTaskStateRowsForThread(db, {
      limit: 16,
      maxBytes: 256_000,
      maxDataBytes: 16_000,
      threadId: thread.id,
    }).rows;

    expect(rows.map((row) => row.sequence)).toEqual(
      Array.from({ length: 16 }, (_, index) => index + 5),
    );
    expect(
      rows.every((row) => Buffer.byteLength(row.data, "utf8") <= 16_000),
    ).toBe(true);
    expect(JSON.parse(rows[0]?.data ?? "{}")).toMatchObject({
      item: {
        id: "task:4",
        description: expect.stringContaining("large task details omitted"),
        status: "pending",
      },
    });

    const historicalItemIds: string[] = [];
    let beforeSequence: number | undefined;
    do {
      const page = listStoredTimelineWindowEventRowsDescending(db, {
        ...(beforeSequence === undefined ? {} : { beforeSequence }),
        excludedTypes: [],
        limit: 7,
        maxBytes: 16_000,
        sequenceStart: 1,
        threadId: thread.id,
      });
      historicalItemIds.push(
        ...page.rows.flatMap((row) =>
          row.itemId === null ? [] : [row.itemId],
        ),
      );
      beforeSequence = page.rows.at(-1)?.sequence;
      if (!page.hasMore) break;
    } while (beforeSequence !== undefined);
    expect(new Set(historicalItemIds).size).toBe(20);
  });

  it("counts active workflow, agent, subagent, and command snapshots by thread", () => {
    const { db, thread } = setup();

    const taskData = (args: {
      itemId: string;
      itemStatus: string;
      taskStatus: string;
      taskType: string;
      skipTranscript?: boolean;
    }) =>
      JSON.stringify({
        item: {
          id: args.itemId,
          type: "backgroundTask",
          taskType: args.taskType,
          description: "fixture background task",
          status: args.itemStatus,
          taskStatus: args.taskStatus,
          skipTranscript: args.skipTranscript ?? false,
        },
      });

    insertEvents(db, noopNotifier, [
      {
        threadId: thread.id,
        sequence: 1,
        scope: turnScope("turn-1"),
        type: "item/started",
        itemId: "task:wf-active",
        itemKind: "backgroundTask",
        data: taskData({
          itemId: "task:wf-active",
          itemStatus: "pending",
          taskStatus: "running",
          taskType: LOCAL_WORKFLOW_TASK_TYPE,
        }),
      },
      {
        threadId: thread.id,
        sequence: 2,
        scope: threadScope(),
        type: "item/backgroundTask/progress",
        itemId: "task:wf-active",
        itemKind: "backgroundTask",
        data: taskData({
          itemId: "task:wf-active",
          itemStatus: "pending",
          taskStatus: "running",
          taskType: LOCAL_WORKFLOW_TASK_TYPE,
        }),
      },
      {
        threadId: thread.id,
        sequence: 3,
        scope: turnScope("turn-1"),
        type: "item/started",
        itemId: "task:wf-terminal-progress",
        itemKind: "backgroundTask",
        data: taskData({
          itemId: "task:wf-terminal-progress",
          itemStatus: "pending",
          taskStatus: "running",
          taskType: LOCAL_WORKFLOW_TASK_TYPE,
        }),
      },
      {
        threadId: thread.id,
        sequence: 4,
        scope: threadScope(),
        type: "item/backgroundTask/progress",
        itemId: "task:wf-terminal-progress",
        itemKind: "backgroundTask",
        data: taskData({
          itemId: "task:wf-terminal-progress",
          itemStatus: "completed",
          taskStatus: "completed",
          taskType: LOCAL_WORKFLOW_TASK_TYPE,
        }),
      },
      {
        threadId: thread.id,
        sequence: 5,
        scope: turnScope("turn-1"),
        type: "item/started",
        itemId: "task:wf-completed",
        itemKind: "backgroundTask",
        data: taskData({
          itemId: "task:wf-completed",
          itemStatus: "pending",
          taskStatus: "running",
          taskType: LOCAL_WORKFLOW_TASK_TYPE,
        }),
      },
      {
        threadId: thread.id,
        sequence: 6,
        scope: threadScope(),
        type: "item/backgroundTask/completed",
        itemId: "task:wf-completed",
        itemKind: "backgroundTask",
        data: taskData({
          itemId: "task:wf-completed",
          itemStatus: "completed",
          taskStatus: "completed",
          taskType: LOCAL_WORKFLOW_TASK_TYPE,
        }),
      },
      {
        threadId: thread.id,
        sequence: 7,
        scope: turnScope("turn-1"),
        type: "item/started",
        itemId: "task:wf-skip-transcript",
        itemKind: "backgroundTask",
        data: taskData({
          itemId: "task:wf-skip-transcript",
          itemStatus: "pending",
          taskStatus: "running",
          taskType: LOCAL_WORKFLOW_TASK_TYPE,
          skipTranscript: true,
        }),
      },
      {
        threadId: thread.id,
        sequence: 8,
        scope: turnScope("turn-1"),
        type: "item/started",
        itemId: "task:cmd-active",
        itemKind: "backgroundTask",
        data: taskData({
          itemId: "task:cmd-active",
          itemStatus: "pending",
          taskStatus: "running",
          taskType: LOCAL_BASH_TASK_TYPE,
        }),
      },
      {
        threadId: thread.id,
        sequence: 9,
        scope: turnScope("turn-1"),
        type: "item/started",
        itemId: "task:agent-active",
        itemKind: "backgroundTask",
        data: taskData({
          itemId: "task:agent-active",
          itemStatus: "pending",
          taskStatus: "running",
          taskType: LOCAL_AGENT_TASK_TYPE,
        }),
      },
      {
        threadId: thread.id,
        sequence: 10,
        scope: turnScope("turn-1"),
        type: "item/started",
        itemId: "task:subagent-active",
        itemKind: "backgroundTask",
        data: taskData({
          itemId: "task:subagent-active",
          itemStatus: "pending",
          taskStatus: "running",
          taskType: LOCAL_SUBAGENT_TASK_TYPE,
        }),
      },
    ]);

    const countsByThreadId = new Map(
      listActiveBackgroundTaskCountsByThreadIds(db, {
        threadIds: [thread.id],
      }).map((row) => [row.threadId, row]),
    );

    expect(countsByThreadId.get(thread.id)).toEqual({
      threadId: thread.id,
      activeWorkflowCount: 1,
      activeBackgroundAgentCount: 2,
      activeBackgroundCommandCount: 1,
    });
  });

  it("lists the latest lifecycle row per open backgroundTask item on a host", () => {
    const db = createConnection(":memory:");
    migrate(db);
    const host = upsertHost(db, noopNotifier, {
      name: "task-host",
      type: "persistent",
    });
    const { project } = createProject(db, noopNotifier, {
      name: "task-project",
      source: { type: "local_path", hostId: host.id, path: "/tmp/test" },
    });
    const environment = createEnvironment(db, noopNotifier, {
      projectId: project.id,
      hostId: host.id,
      workspaceProvisionType: "unmanaged",
    });
    const thread = createThread(db, noopNotifier, {
      projectId: project.id,
      environmentId: environment.id,
      providerId: "claude-code",
    });

    const taskData = (itemId: string, taskStatus: string) =>
      JSON.stringify({
        item: {
          id: itemId,
          type: "backgroundTask",
          taskType: "local_workflow",
          description: "fixture workflow",
          status: taskStatus === "completed" ? "completed" : "pending",
          taskStatus,
          skipTranscript: false,
        },
      });

    insertEvents(db, noopNotifier, [
      {
        threadId: thread.id,
        environmentId: environment.id,
        sequence: 1,
        scope: turnScope("turn-1"),
        type: "item/started",
        itemId: "task:wf-open",
        itemKind: "backgroundTask",
        data: taskData("task:wf-open", "running"),
      },
      {
        threadId: thread.id,
        environmentId: environment.id,
        sequence: 2,
        scope: threadScope(),
        type: "item/backgroundTask/progress",
        itemId: "task:wf-open",
        itemKind: "backgroundTask",
        data: taskData("task:wf-open", "running"),
      },
      {
        threadId: thread.id,
        environmentId: environment.id,
        sequence: 3,
        scope: threadScope(),
        type: "item/backgroundTask/progress",
        itemId: "task:wf-open",
        itemKind: "backgroundTask",
        data: taskData("task:wf-open", "paused"),
      },
      // Settled item: excluded entirely.
      {
        threadId: thread.id,
        environmentId: environment.id,
        sequence: 4,
        scope: turnScope("turn-1"),
        type: "item/started",
        itemId: "task:wf-done",
        itemKind: "backgroundTask",
        data: taskData("task:wf-done", "running"),
      },
      {
        threadId: thread.id,
        environmentId: environment.id,
        sequence: 5,
        scope: threadScope(),
        type: "item/backgroundTask/completed",
        itemId: "task:wf-done",
        itemKind: "backgroundTask",
        data: taskData("task:wf-done", "completed"),
      },
    ]);

    const rows = listOpenBackgroundTaskItemRowsForHost(db, {
      hostId: host.id,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      itemId: "task:wf-open",
      threadId: thread.id,
      environmentId: environment.id,
    });
    // The latest snapshot wins: sequence 3 carries the paused status.
    expect(JSON.parse(rows[0]!.data)).toMatchObject({
      item: { taskStatus: "paused" },
    });

    const otherHost = upsertHost(db, noopNotifier, {
      name: "other-host",
      type: "persistent",
    });
    expect(
      listOpenBackgroundTaskItemRowsForHost(db, { hostId: otherHost.id }),
    ).toEqual([]);
  });

  it("pruning is scoped to the target thread", () => {
    const { db, project, thread } = setup();
    const thread2 = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
    });

    insertEvents(db, noopNotifier, [
      {
        threadId: thread.id,
        sequence: 1,
        type: "thread/tokenUsage/updated",
        ...createTurnEventFields({ turnId: "turn-1" }),
        data: "{}",
      },
      {
        threadId: thread.id,
        sequence: 2,
        type: "thread/tokenUsage/updated",
        ...createTurnEventFields({ turnId: "turn-1" }),
        data: "{}",
      },
      {
        threadId: thread2.id,
        sequence: 1,
        type: "thread/tokenUsage/updated",
        ...createTurnEventFields({ turnId: "turn-1" }),
        data: "{}",
      },
      {
        threadId: thread2.id,
        sequence: 2,
        type: "thread/tokenUsage/updated",
        ...createTurnEventFields({ turnId: "turn-1" }),
        data: "{}",
      },
    ]);

    const removed = pruneThreadEventsBeforeSequence(db, {
      threadId: thread.id,
      sequenceCutoff: 1,
      types: ["thread/tokenUsage/updated"],
    });

    expect(removed).toBe(1);
    expect(
      listEvents(db, { threadId: thread.id }).map((event) => event.sequence),
    ).toEqual([2]);
    expect(
      listEvents(db, { threadId: thread2.id }).map((event) => event.sequence),
    ).toEqual([1, 2]);
  });

  it("notifies on events-appended per thread", () => {
    const { db, project, thread } = setup();
    const thread2 = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
    });

    const spy: DbNotifier = {
      notifyThread: vi.fn(),
      notifyEnvironment: vi.fn(),
      notifyHost: vi.fn(),
      notifyProject: vi.fn(),
      notifySystem: vi.fn(),
    };

    insertEvents(db, spy, [
      {
        threadId: thread.id,
        sequence: 1,
        type: "system/error",
        ...threadEventFields,
        data: "{}",
      },
      {
        threadId: thread.id,
        sequence: 2,
        type: "client/turn/requested",
        ...threadEventFields,
        data: "{}",
      },
      {
        threadId: thread2.id,
        sequence: 1,
        type: "system/error",
        ...threadEventFields,
        data: "{}",
      },
    ]);

    expect(spy.notifyThread).toHaveBeenCalledWith(
      thread.id,
      ["events-appended"],
      {
        eventTypes: ["system/error", "client/turn/requested"],
      },
    );
    expect(spy.notifyThread).toHaveBeenCalledWith(
      thread2.id,
      ["events-appended"],
      {
        eventTypes: ["system/error"],
      },
    );
    expect(spy.notifyThread).toHaveBeenCalledTimes(2);
  });

  it("keyset-pages direct delegation child turns with a hard result bound", () => {
    const { db, thread } = setup();
    const events = Array.from({ length: 120 }, (_, index) => {
      const turnId = `child-${String(index).padStart(3, "0")}`;
      const sequence = index * 2 + 1;
      return [
        {
          threadId: thread.id,
          sequence,
          type: "turn/started" as const,
          ...createTurnEventFields({ turnId }),
          data: JSON.stringify({ parentToolCallId: "delegation-root" }),
        },
        {
          threadId: thread.id,
          sequence: sequence + 1,
          type: "turn/completed" as const,
          ...createTurnEventFields({ turnId }),
          data: JSON.stringify({ parentToolCallId: "delegation-root" }),
        },
      ];
    }).flat();
    insertEvents(db, noopNotifier, [
      ...events,
      {
        threadId: thread.id,
        sequence: 241,
        type: "system/error",
        ...createTurnEventFields({ turnId: "parent-turn" }),
        data: JSON.stringify({ parentToolCallId: "delegation-root" }),
      },
    ]);

    const seenTurnIds: string[] = [];
    let beforeSequence: number | undefined;
    do {
      const page = listStoredDelegationChildTurnRanges(db, {
        beforeSequence,
        directTurnSourceSeqEnd: 1_000,
        directTurnSourceSeqStart: 0,
        limit: 17,
        ownerTurnId: "parent-turn",
        parentToolCallId: "delegation-root",
        sequenceEnd: 1_000,
        sequenceStart: 0,
        threadId: thread.id,
      });
      expect(page.length).toBeLessThanOrEqual(17);
      seenTurnIds.push(...page.map((row) => row.turnId));
      beforeSequence = page.at(-1)?.sourceSeqStart;
      if (page.length < 17) break;
    } while (beforeSequence !== undefined);

    expect(new Set(seenTurnIds).size).toBe(120);
    expect(seenTurnIds).toHaveLength(120);
    expect(seenTurnIds).not.toContain("parent-turn");
    expect(seenTurnIds[0]).toBe("child-119");
    expect(seenTurnIds.at(-1)).toBe("child-000");
  });

  it("filters direct delegation children after grouping the complete snapshot", () => {
    const { db, thread } = setup();
    insertEvents(db, noopNotifier, [
      {
        threadId: thread.id,
        sequence: 1,
        type: "turn/started",
        ...createTurnEventFields({ turnId: "early-child" }),
        data: JSON.stringify({ parentToolCallId: "delegation-root" }),
      },
      {
        threadId: thread.id,
        sequence: 40,
        type: "turn/started",
        ...createTurnEventFields({ turnId: "interval-child" }),
        data: JSON.stringify({ parentToolCallId: "delegation-root" }),
      },
      {
        threadId: thread.id,
        sequence: 50,
        type: "turn/completed",
        ...createTurnEventFields({ turnId: "early-child" }),
        data: JSON.stringify({ parentToolCallId: "delegation-root" }),
      },
    ]);

    expect(
      listStoredDelegationChildTurnRanges(db, {
        directTurnSourceSeqEnd: 50,
        directTurnSourceSeqStart: 40,
        limit: 10,
        ownerTurnId: "parent-turn",
        parentToolCallId: "delegation-root",
        sequenceEnd: 50,
        sequenceStart: 1,
        threadId: thread.id,
      }).map((range) => range.turnId),
    ).toEqual(["interval-child"]);
  });

  it("maps many candidate gaps through one bounded grouped delegation scan", () => {
    const { db, thread } = setup();
    const buckets = Array.from({ length: 60 }, (_, bucketIndex) => ({
      directTurnSourceSeqEnd: bucketIndex * 100 + 100,
      directTurnSourceSeqStart: bucketIndex * 100 + 1,
    }));
    const expectedBucketIndexes = buckets.flatMap((_, bucketIndex) =>
      bucketIndex % 2 === 0 ? [bucketIndex] : [],
    );
    const childEvents = expectedBucketIndexes.flatMap((bucketIndex) => {
      const bucketStart = bucketIndex * 100 + 1;
      const starts = Array.from({ length: 30 }, (_, childIndex) => ({
        threadId: thread.id,
        sequence: bucketStart + childIndex,
        type: "turn/started" as const,
        ...createTurnEventFields({
          turnId: `bucket-${bucketIndex}-child-${childIndex}`,
        }),
        data: JSON.stringify({ parentToolCallId: "delegation-root" }),
      }));
      return [
        ...starts,
        {
          threadId: thread.id,
          sequence: bucketStart + 150,
          type: "turn/completed" as const,
          ...createTurnEventFields({
            turnId: `bucket-${bucketIndex}-child-0`,
          }),
          data: JSON.stringify({ parentToolCallId: "delegation-root" }),
        },
      ];
    });
    insertEvents(
      db,
      noopNotifier,
      childEvents.sort((left, right) => left.sequence - right.sequence),
    );

    const allSpy = vi.spyOn(db, "all");
    const nonemptyBucketIndexes =
      listStoredNonemptyDelegationChildTurnBucketIndexes(db, {
        buckets,
        ownerTurnId: "parent-turn",
        parentToolCallId: "delegation-root",
        sequenceEnd: 6_000,
        sequenceStart: 1,
        threadId: thread.id,
      });
    expect(allSpy).toHaveBeenCalledTimes(1);
    allSpy.mockRestore();
    expect(nonemptyBucketIndexes).toEqual(expectedBucketIndexes);
    expect(nonemptyBucketIndexes.length).toBeLessThanOrEqual(buckets.length);
  });

  it("returns scalar recursive extents for only requested delegation roots", () => {
    const { db, thread } = setup();
    insertEvents(db, noopNotifier, [
      {
        threadId: thread.id,
        sequence: 1,
        type: "item/started",
        scope: turnScope("child-a"),
        itemId: "nested-a",
        itemKind: "toolCall",
        data: JSON.stringify({ parentToolCallId: "root-a" }),
      },
      {
        threadId: thread.id,
        sequence: 2,
        type: "item/started",
        scope: turnScope("child-a"),
        itemId: "root-a",
        itemKind: "toolCall",
        data: JSON.stringify({ parentToolCallId: "root-a" }),
      },
      {
        threadId: thread.id,
        sequence: 3,
        type: "system/error",
        ...createTurnEventFields({ turnId: "grandchild-a" }),
        data: JSON.stringify({ parentToolCallId: "nested-a" }),
      },
      {
        threadId: thread.id,
        sequence: 4,
        type: "item/started",
        scope: turnScope("grandchild-a"),
        itemId: "nested-b",
        itemKind: "toolCall",
        data: JSON.stringify({ parentToolCallId: "nested-a" }),
      },
      {
        threadId: thread.id,
        sequence: 5,
        type: "system/error",
        ...createTurnEventFields({ turnId: "great-grandchild-a" }),
        data: JSON.stringify({ parentToolCallId: "nested-b" }),
      },
      {
        threadId: thread.id,
        sequence: 6,
        type: "item/started",
        scope: turnScope("great-grandchild-a"),
        itemId: "root-a",
        itemKind: "toolCall",
        data: JSON.stringify({ parentToolCallId: "nested-b" }),
      },
      {
        threadId: thread.id,
        sequence: 7,
        type: "turn/started",
        ...createTurnEventFields({ turnId: "child-b" }),
        data: JSON.stringify({ parentToolCallId: "root-b" }),
      },
      {
        threadId: thread.id,
        sequence: 8,
        type: "turn/completed",
        ...createTurnEventFields({ turnId: "child-b" }),
        data: JSON.stringify({ parentToolCallId: "root-b" }),
      },
    ]);

    expect(
      listStoredDelegationDescendantRanges(db, {
        roots: [
          { ownerTurnId: "parent-a", parentToolCallId: "root-a" },
          { ownerTurnId: "parent-b", parentToolCallId: "root-b" },
        ],
        sequenceEnd: 8,
        sequenceStart: 0,
        threadId: thread.id,
      }),
    ).toEqual([
      {
        eventCount: 6,
        parentToolCallId: "root-a",
        sourceSeqEnd: 6,
        sourceSeqStart: 1,
      },
      {
        eventCount: 2,
        parentToolCallId: "root-b",
        sourceSeqEnd: 8,
        sourceSeqStart: 7,
      },
    ]);

    expect(
      listStoredDelegationDescendantRanges(db, {
        roots: [{ ownerTurnId: "child-a", parentToolCallId: "root-a" }],
        sequenceEnd: 8,
        sequenceStart: 0,
        threadId: thread.id,
      }),
    ).toEqual([]);

    expect(
      listStoredDelegationDescendantRanges(db, {
        roots: [{ ownerTurnId: "parent-a", parentToolCallId: "root-a" }],
        sequenceEnd: 8,
        sequenceStart: 2,
        threadId: thread.id,
      }),
    ).toEqual([
      {
        eventCount: 5,
        parentToolCallId: "root-a",
        sourceSeqEnd: 6,
        sourceSeqStart: 2,
      },
    ]);

    expect(
      listStoredDelegatedTurnDescendantRanges(db, {
        roots: [{ parentToolCallId: "root-a", turnId: "child-a" }],
        sequenceEnd: 8,
        sequenceStart: 0,
        threadId: thread.id,
      }),
    ).toEqual([
      {
        completedAt: null,
        createdAt: expect.any(Number),
        eventCount: 6,
        parentToolCallId: "root-a",
        sourceSeqEnd: 6,
        sourceSeqStart: 1,
        startedAt: expect.any(Number),
        turnId: "child-a",
      },
    ]);

    expect(
      listStoredDelegatedTurnDescendantRanges(db, {
        roots: [{ parentToolCallId: "root-a", turnId: "child-a" }],
        sequenceEnd: 8,
        sequenceStart: 2,
        threadId: thread.id,
      }),
    ).toEqual([
      {
        completedAt: null,
        createdAt: expect.any(Number),
        eventCount: 5,
        parentToolCallId: "root-a",
        sourceSeqEnd: 6,
        sourceSeqStart: 2,
        startedAt: expect.any(Number),
        turnId: "child-a",
      },
    ]);
  });

  it("extends a visible turn through unparented child lifecycle rows", () => {
    const { db, thread } = setup();
    insertEvents(db, noopNotifier, [
      {
        threadId: thread.id,
        sequence: 1,
        type: "turn/started",
        ...createTurnEventFields({ turnId: "parent-turn" }),
        data: "{}",
      },
      {
        threadId: thread.id,
        sequence: 2,
        type: "item/started",
        scope: turnScope("parent-turn"),
        itemId: "delegation-root",
        itemKind: "toolCall",
        data: "{}",
      },
      {
        threadId: thread.id,
        sequence: 3,
        type: "turn/completed",
        ...createTurnEventFields({ turnId: "parent-turn" }),
        data: "{}",
      },
      {
        threadId: thread.id,
        sequence: 4,
        type: "turn/started",
        ...createTurnEventFields({ turnId: "child-turn" }),
        data: "{}",
      },
      {
        threadId: thread.id,
        sequence: 5,
        type: "system/error",
        ...createTurnEventFields({ turnId: "child-turn" }),
        data: JSON.stringify({ parentToolCallId: "delegation-root" }),
      },
      {
        threadId: thread.id,
        sequence: 6,
        type: "turn/completed",
        ...createTurnEventFields({ turnId: "child-turn" }),
        data: "{}",
      },
    ]);

    expect(
      listStoredTurnDescendantRanges(db, {
        roots: [
          {
            sourceSeqEnd: 3,
            sourceSeqStart: 1,
            turnId: "parent-turn",
          },
        ],
        sequenceEnd: 6,
        threadId: thread.id,
      }),
    ).toEqual([
      {
        descendantSourceSeqEnd: 6,
        sourceSeqEnd: 3,
        sourceSeqStart: 1,
        turnId: "parent-turn",
      },
    ]);
  });
});
