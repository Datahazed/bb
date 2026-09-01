import { describe, expect, it } from "vitest";
import {
  encodeClientTurnRequestIdNumber,
  threadScope,
  turnScope,
} from "@bb/domain";
import type { ClientTurnRequestId, Thread } from "@bb/domain";
import {
  createConnection,
  createProject,
  createThread,
  getLatestThreadSequence,
  insertEvents,
  migrate,
  noopNotifier,
  upsertHost,
} from "@bb/db";
import { LOCAL_WORKFLOW_TASK_TYPE } from "@bb/domain";
import type { DbConnection } from "@bb/db";
import type {
  TimelinePaginationCursor,
  TimelineRow,
} from "@bb/server-contract";
import {
  buildThreadTimeline,
  buildTimelineTurnDetailsPage,
  buildTimelineTurnSummaryDetails,
  buildThreadTimelineWithProfile,
} from "../../../src/services/threads/timeline.js";

const providerThreadId = "provider-root";
const execution = {
  model: "gpt-5",
  serviceTier: "default",
  reasoningLevel: "medium",
  permissionMode: "full",
  source: "client/turn/requested",
} as const;

function requestId(value: number): ClientTurnRequestId {
  return encodeClientTurnRequestIdNumber({ value });
}

function setup(): { db: DbConnection; thread: Thread } {
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
    providerId: "claude-code",
  });
  return { db, thread };
}

type EventInput = Parameters<typeof insertEvents>[2][number];

const BACKGROUND_TASK_ITEM_ID = "task:wf-1";

function backgroundTaskData(status: "pending" | "completed"): string {
  return JSON.stringify({
    providerThreadId,
    item: {
      type: "backgroundTask",
      id: BACKGROUND_TASK_ITEM_ID,
      taskType: LOCAL_WORKFLOW_TASK_TYPE,
      description: "long workflow",
      status,
      taskStatus: status === "pending" ? "running" : "completed",
      skipTranscript: false,
      workflowName: "long-workflow",
    },
  });
}

interface SeedOptions {
  assistantBeforeItem?: number;
  backgroundTask?: "open" | "completed";
  delegateLastTurn?: boolean;
  completeLastTurn: boolean;
  commandChars?: number;
  longRunningItemIndexes?: readonly number[];
  outputChars?: number;
  streamLongRunningOutput?: boolean;
  itemsPerTurn: readonly number[];
}

function seedTurns(
  db: DbConnection,
  thread: Thread,
  options: SeedOptions,
): void {
  const events: EventInput[] = [];
  let sequence = 0;
  const push = (event: Omit<EventInput, "sequence" | "threadId">): void => {
    sequence += 1;
    events.push({ ...event, sequence, threadId: thread.id });
  };

  options.itemsPerTurn.forEach((items, index) => {
    const turn = index + 1;
    const isLastTurn = turn === options.itemsPerTurn.length;
    const turnId = `turn-${turn}`;
    const clientRequestId = requestId(turn);
    push({
      type: "client/turn/requested",
      scope: threadScope(),
      itemId: null,
      itemKind: null,
      parentToolCallId: null,
      data: JSON.stringify({
        direction: "outbound",
        source: "tell",
        initiator: "user",
        request: { method: "turn/start", params: {} },
        requestId: clientRequestId,
        senderThreadId: null,
        input: [{ type: "text", text: `User message ${turn}`, mentions: [] }],
        target: turn === 1 ? { kind: "thread-start" } : { kind: "new-turn" },
        execution,
      }),
    });
    push({
      type: "turn/started",
      scope: turnScope(turnId),
      providerThreadId,
      itemId: null,
      itemKind: null,
      parentToolCallId: null,
      data: JSON.stringify({}),
    });
    push({
      type: "turn/input/accepted",
      scope: turnScope(turnId),
      providerThreadId,
      itemId: null,
      itemKind: null,
      parentToolCallId: null,
      data: JSON.stringify({ clientRequestId }),
    });

    if (isLastTurn && options.backgroundTask !== undefined) {
      push({
        type: "item/started",
        scope: turnScope(turnId),
        providerThreadId,
        itemId: BACKGROUND_TASK_ITEM_ID,
        itemKind: "backgroundTask",
        parentToolCallId: null,
        data: backgroundTaskData("pending"),
      });
      if (options.backgroundTask === "completed") {
        push({
          type: "item/backgroundTask/completed",
          scope: threadScope(),
          providerThreadId,
          itemId: BACKGROUND_TASK_ITEM_ID,
          itemKind: "backgroundTask",
          parentToolCallId: null,
          data: backgroundTaskData("completed"),
        });
      }
    }

    const parentToolCallId =
      isLastTurn && options.delegateLastTurn ? `${turnId}-delegate` : null;
    if (parentToolCallId !== null) {
      push({
        type: "item/started",
        scope: turnScope(turnId),
        providerThreadId,
        itemId: parentToolCallId,
        itemKind: "toolCall",
        parentToolCallId: null,
        data: JSON.stringify({
          item: {
            type: "toolCall",
            id: parentToolCallId,
            tool: "Agent",
            arguments: { prompt: "Do the long task." },
            status: "pending",
          },
        }),
      });
    }

    const longRunning = new Set(
      isLastTurn ? (options.longRunningItemIndexes ?? []) : [],
    );
    const deferred: number[] = [];
    for (let item = 0; item < items; item += 1) {
      if (isLastTurn && options.assistantBeforeItem === item) {
        const assistantItemId = `${turnId}-assistant`;
        push({
          type: "item/completed",
          scope: turnScope(turnId),
          providerThreadId,
          itemId: assistantItemId,
          itemKind: "agentMessage",
          parentToolCallId: null,
          data: JSON.stringify({
            item: {
              type: "agentMessage",
              id: assistantItemId,
              text: "Intermediate update.",
            },
          }),
        });
      }
      const itemId = `${turnId}-item-${item}`;
      const command =
        options.commandChars === undefined
          ? `echo ${item}`
          : "x".repeat(options.commandChars);
      push({
        type: "item/started",
        scope: turnScope(turnId),
        providerThreadId,
        itemId,
        itemKind: "commandExecution",
        parentToolCallId,
        data: JSON.stringify({
          item: {
            type: "commandExecution",
            id: itemId,
            command,
            cwd: "/tmp/test",
            ...(parentToolCallId === null ? {} : { parentToolCallId }),
            status: "pending",
            approvalStatus: null,
          },
        }),
      });
      if (longRunning.has(item)) {
        deferred.push(item);
        continue;
      }
      for (const streaming of deferred) {
        if (!options.streamLongRunningOutput) {
          break;
        }
        push({
          type: "item/commandExecution/outputDelta",
          scope: turnScope(turnId),
          providerThreadId,
          itemId: `${turnId}-item-${streaming}`,
          itemKind: null,
          parentToolCallId: null,
          data: JSON.stringify({
            threadId: thread.id,
            providerThreadId,
            itemId: `${turnId}-item-${streaming}`,
            delta: `tick ${item}\n`,
          }),
        });
      }
      push({
        type: "item/completed",
        scope: turnScope(turnId),
        providerThreadId,
        itemId,
        itemKind: "commandExecution",
        parentToolCallId,
        data: JSON.stringify({
          item: {
            type: "commandExecution",
            id: itemId,
            command,
            cwd: "/tmp/test",
            ...(parentToolCallId === null ? {} : { parentToolCallId }),
            status: "completed",
            approvalStatus: null,
            exitCode: 0,
            aggregatedOutput:
              options.outputChars === undefined
                ? `output ${item}`
                : "o".repeat(options.outputChars),
          },
        }),
      });
    }
    for (const item of deferred) {
      const itemId = `${turnId}-item-${item}`;
      push({
        type: "item/completed",
        scope: turnScope(turnId),
        providerThreadId,
        itemId,
        itemKind: "commandExecution",
        parentToolCallId,
        data: JSON.stringify({
          item: {
            type: "commandExecution",
            id: itemId,
            command:
              options.commandChars === undefined
                ? `echo ${item}`
                : "x".repeat(options.commandChars),
            cwd: "/tmp/test",
            ...(parentToolCallId === null ? {} : { parentToolCallId }),
            status: "completed",
            approvalStatus: null,
            exitCode: 0,
            aggregatedOutput:
              options.outputChars === undefined
                ? `late output ${item}`
                : "o".repeat(options.outputChars),
          },
        }),
      });
    }

    if (parentToolCallId !== null) {
      push({
        type: "item/completed",
        scope: turnScope(turnId),
        providerThreadId,
        itemId: parentToolCallId,
        itemKind: "toolCall",
        parentToolCallId: null,
        data: JSON.stringify({
          item: {
            type: "toolCall",
            id: parentToolCallId,
            tool: "Agent",
            arguments: { prompt: "Do the long task." },
            result: "",
            status: "completed",
          },
        }),
      });
    }

    if (!isLastTurn || options.completeLastTurn) {
      push({
        type: "turn/completed",
        scope: turnScope(turnId),
        providerThreadId,
        itemId: null,
        itemKind: null,
        parentToolCallId: null,
        data: JSON.stringify({ status: "completed", providerThreadId }),
      });
    }
  });

  insertEvents(db, noopNotifier, events);
}

function appendCommandItems(
  db: DbConnection,
  thread: Thread,
  args: { commandChars: number; count: number; itemStart: number },
): void {
  let sequence = getLatestThreadSequence(db, { threadId: thread.id });
  const events: EventInput[] = [];
  const push = (event: Omit<EventInput, "sequence" | "threadId">): void => {
    sequence += 1;
    events.push({ ...event, sequence, threadId: thread.id });
  };
  for (let offset = 0; offset < args.count; offset += 1) {
    const item = args.itemStart + offset;
    const itemId = `turn-1-item-${item}`;
    const command = "x".repeat(args.commandChars);
    push({
      type: "item/started",
      scope: turnScope("turn-1"),
      providerThreadId,
      itemId,
      itemKind: "commandExecution",
      parentToolCallId: null,
      data: JSON.stringify({
        item: {
          type: "commandExecution",
          id: itemId,
          command,
          cwd: "/tmp/test",
          status: "pending",
          approvalStatus: null,
        },
      }),
    });
    push({
      type: "item/completed",
      scope: turnScope("turn-1"),
      providerThreadId,
      itemId,
      itemKind: "commandExecution",
      parentToolCallId: null,
      data: JSON.stringify({
        item: {
          type: "commandExecution",
          id: itemId,
          command,
          cwd: "/tmp/test",
          status: "completed",
          approvalStatus: null,
          exitCode: 0,
          aggregatedOutput: `output ${item}`,
        },
      }),
    });
  }
  insertEvents(db, noopNotifier, events);
}

function buildPage(
  db: DbConnection,
  thread: Thread,
  cursor: TimelinePaginationCursor | null,
  segmentLimit = 20,
) {
  return buildThreadTimelineWithProfile(db, thread, {
    includeProviderUnhandledOperations: false,
    includeNestedRows: false,
    maxInlineOutputChars: 32_000,
    maxSeq: 0,
    page: cursor
      ? { kind: "older", beforeCursor: cursor, segmentLimit }
      : { kind: "latest", segmentLimit },
  });
}

function buildNestedPage(
  db: DbConnection,
  thread: Thread,
  cursor: TimelinePaginationCursor | null,
) {
  return buildThreadTimelineWithProfile(db, thread, {
    includeProviderUnhandledOperations: false,
    includeNestedRows: true,
    maxInlineOutputChars: 32_000,
    maxSeq: 0,
    page: cursor
      ? { kind: "older", beforeCursor: cursor, segmentLimit: 20 }
      : { kind: "latest", segmentLimit: 20 },
  });
}

function collectCommandCallIds(
  rows: readonly TimelineRow[],
  target: Set<string>,
): number {
  let count = 0;
  for (const row of rows) {
    if (row.kind === "work" && row.workKind === "command") {
      target.add(row.callId);
      count += 1;
    }
    if (row.kind === "work" && row.workKind === "delegation") {
      count += collectCommandCallIds(row.childRows, target);
    }
    if (row.kind === "turn" && row.children !== null) {
      count += collectCommandCallIds(row.children, target);
    }
  }
  return count;
}

interface WalkResult {
  maxEventRowCount: number;
  pages: number;
  rows: string[];
}

function walkAllPages(
  db: DbConnection,
  thread: Thread,
  segmentLimit = 20,
): WalkResult {
  const rowsByPage: string[][] = [];
  const seenCursors = new Set<string>();
  let cursor: TimelinePaginationCursor | null = null;
  let maxEventRowCount = 0;
  let pages = 0;

  for (;;) {
    const { profile, response } = buildPage(db, thread, cursor, segmentLimit);
    pages += 1;
    maxEventRowCount = Math.max(maxEventRowCount, profile.eventRowCount);
    rowsByPage.push(response.rows.map((row) => JSON.stringify(row)));
    if (!response.timelinePage.hasOlderRows) {
      break;
    }
    const next = response.timelinePage.olderCursor;
    expect(
      next,
      `page ${pages} claimed older rows with no cursor`,
    ).not.toBeNull();
    const key = `${next!.anchorSeq}:${next!.anchorId}`;
    expect(seenCursors.has(key), `cursor loop at ${key}`).toBe(false);
    seenCursors.add(key);
    cursor = next;
    expect(pages).toBeLessThan(100);
  }

  return { maxEventRowCount, pages, rows: rowsByPage.reverse().flat() };
}

describe("in-turn timeline windows", () => {
  const expectSteerDetailsOwnership = (
    steerStatus: "accepted" | "rejected",
  ): void => {
    const { db, thread } = setup();
    const initialRequestId = requestId(1);
    const steerRequestId = requestId(2);
    const turnId = "turn-1";
    const commandId = "command-1";
    const steerTerminalEvent: EventInput =
      steerStatus === "accepted"
        ? {
            threadId: thread.id,
            sequence: 6,
            type: "turn/input/accepted",
            scope: turnScope(turnId),
            providerThreadId,
            itemId: null,
            itemKind: null,
            parentToolCallId: null,
            data: JSON.stringify({ clientRequestId: steerRequestId }),
          }
        : {
            threadId: thread.id,
            sequence: 6,
            type: "client/turn/rejected",
            scope: threadScope(),
            itemId: null,
            itemKind: null,
            parentToolCallId: null,
            data: JSON.stringify({
              requestId: steerRequestId,
              reason: "command_failed",
              message: "The steer was rejected",
            }),
          };

    insertEvents(db, noopNotifier, [
      {
        threadId: thread.id,
        sequence: 1,
        type: "client/turn/requested",
        scope: threadScope(),
        itemId: null,
        itemKind: null,
        parentToolCallId: null,
        data: JSON.stringify({
          direction: "outbound",
          source: "tell",
          initiator: "user",
          request: { method: "turn/start", params: {} },
          requestId: initialRequestId,
          senderThreadId: null,
          input: [{ type: "text", text: "Run the command", mentions: [] }],
          target: { kind: "thread-start" },
          execution,
        }),
      },
      {
        threadId: thread.id,
        sequence: 2,
        type: "turn/started",
        scope: turnScope(turnId),
        providerThreadId,
        itemId: null,
        itemKind: null,
        parentToolCallId: null,
        data: JSON.stringify({}),
      },
      {
        threadId: thread.id,
        sequence: 3,
        type: "turn/input/accepted",
        scope: turnScope(turnId),
        providerThreadId,
        itemId: null,
        itemKind: null,
        parentToolCallId: null,
        data: JSON.stringify({ clientRequestId: initialRequestId }),
      },
      {
        threadId: thread.id,
        sequence: 4,
        type: "item/started",
        scope: turnScope(turnId),
        providerThreadId,
        itemId: commandId,
        itemKind: "commandExecution",
        parentToolCallId: null,
        data: JSON.stringify({
          item: {
            type: "commandExecution",
            id: commandId,
            command: "sleep 20",
            cwd: "/tmp/test",
            status: "pending",
            approvalStatus: null,
          },
        }),
      },
      {
        threadId: thread.id,
        sequence: 5,
        type: "client/turn/requested",
        scope: threadScope(),
        itemId: null,
        itemKind: null,
        parentToolCallId: null,
        data: JSON.stringify({
          direction: "outbound",
          source: "tell",
          initiator: "user",
          request: { method: "turn/start", params: {} },
          requestId: steerRequestId,
          senderThreadId: null,
          input: [
            {
              type: "text",
              text: "Stop waiting and answer immediately.",
              mentions: [],
            },
          ],
          target: { kind: "steer", expectedTurnId: turnId },
          execution,
        }),
      },
      steerTerminalEvent,
      {
        threadId: thread.id,
        sequence: 7,
        type: "item/completed",
        scope: turnScope(turnId),
        providerThreadId,
        itemId: commandId,
        itemKind: "commandExecution",
        parentToolCallId: null,
        data: JSON.stringify({
          item: {
            type: "commandExecution",
            id: commandId,
            command: "sleep 20",
            cwd: "/tmp/test",
            status: "completed",
            approvalStatus: null,
            exitCode: 0,
            aggregatedOutput: "",
          },
        }),
      },
      {
        threadId: thread.id,
        sequence: 8,
        type: "turn/completed",
        scope: turnScope(turnId),
        providerThreadId,
        itemId: null,
        itemKind: null,
        parentToolCallId: null,
        data: JSON.stringify({ status: "completed", providerThreadId }),
      },
    ]);

    const timeline = buildPage(db, thread, null).response;
    const turnRow = timeline.rows.find(
      (row): row is Extract<TimelineRow, { kind: "turn" }> =>
        row.kind === "turn",
    );
    expect(turnRow).toBeDefined();
    if (!turnRow) {
      throw new Error("expected a turn row");
    }
    const rootSteers = timeline.rows.filter(
      (row) =>
        row.kind === "conversation" &&
        row.role === "user" &&
        row.turnRequest?.kind === "steer",
    );
    expect(rootSteers).toHaveLength(1);
    expect(rootSteers[0]).toMatchObject({
      turnRequest: { kind: "steer", status: steerStatus },
    });

    const details = buildTimelineTurnSummaryDetails(db, thread, {
      includeProviderUnhandledOperations: false,
      sourceSeqEnd: turnRow.sourceSeqEnd,
      sourceSeqStart: turnRow.sourceSeqStart,
      turnId: turnRow.turnId,
    });
    expect(
      details.rows.filter(
        (row) =>
          row.kind === "conversation" &&
          row.role === "user" &&
          row.turnRequest?.kind === "steer",
      ),
    ).toEqual([]);
    expect(
      details.rows.filter(
        (row) => row.kind === "work" && row.workKind === "command",
      ),
    ).toHaveLength(1);
  };

  it("keeps an accepted steer out of details for work that spans it", () => {
    expectSteerDetailsOwnership("accepted");
  });

  it("keeps a rejected steer out of details for work that spans it", () => {
    expectSteerDetailsOwnership("rejected");
  });

  it("keeps latest row identities stable while a turn grows", () => {
    const { db, thread } = setup();
    seedTurns(db, thread, {
      commandChars: 25_000,
      completeLastTurn: false,
      itemsPerTurn: [75],
    });

    const first = buildPage(db, thread, null).response;
    appendCommandItems(db, thread, {
      commandChars: 25_000,
      count: 20,
      itemStart: 75,
    });
    const second = buildPage(db, thread, null).response;
    appendCommandItems(db, thread, {
      commandChars: 25_000,
      count: 10,
      itemStart: 95,
    });
    const third = buildPage(db, thread, null).response;

    for (const [previous, next] of [
      [first, second],
      [second, third],
    ] as const) {
      const previousIdsByCall = new Map(
        previous.rows.flatMap((row) =>
          row.kind === "work" && row.workKind === "command"
            ? [[row.callId, row.id] as const]
            : [],
        ),
      );
      const sharedRows = next.rows.flatMap((row) =>
        row.kind === "work" &&
        row.workKind === "command" &&
        previousIdsByCall.has(row.callId)
          ? [[row.callId, row.id] as const]
          : [],
      );

      expect(sharedRows.length).toBeGreaterThan(0);
      for (const [callId, id] of sharedRows) {
        expect(id).toBe(previousIdsByCall.get(callId));
        expect(id).not.toContain(":sequence-page:");
      }
    }
  });

  it("caps stored outputs when a turn's details are expanded", () => {
    const { db, thread } = setup();
    seedTurns(db, thread, {
      completeLastTurn: true,
      itemsPerTurn: [110],
      outputChars: 50_000,
    });

    const latest = buildNestedPage(db, thread, null).response;
    const turnRow = latest.rows.find((row) => row.kind === "turn");
    expect(turnRow?.kind).toBe("turn");
    if (turnRow?.kind !== "turn") {
      throw new Error("expected a turn row");
    }
    const details = buildTimelineTurnSummaryDetails(db, thread, {
      includeProviderUnhandledOperations: false,
      sourceSeqEnd: turnRow.sourceSeqEnd,
      sourceSeqStart: turnRow.sourceSeqStart,
      turnId: turnRow.turnId,
    });
    const commandOutputs = details.rows.flatMap((row) =>
      row.kind === "work" && row.workKind === "command" ? [row.output] : [],
    );

    expect(commandOutputs.length).toBeGreaterThan(0);
    expect(commandOutputs.length).toBeLessThanOrEqual(110);
    expect(commandOutputs.every((output) => output.length < 33_000)).toBe(true);
    expect(
      commandOutputs.some((output) =>
        output.includes("more characters truncated"),
      ),
    ).toBe(true);
  });
});

describe("timeline segment anchors", () => {
  it("treats a steer sent with nothing running as a pageable anchor", () => {
    const { db, thread } = setup();
    seedTurns(db, thread, { completeLastTurn: true, itemsPerTurn: [40] });
    insertEvents(db, noopNotifier, [
      {
        threadId: thread.id,
        sequence: 1_000,
        type: "client/turn/requested",
        scope: threadScope(),
        itemId: null,
        itemKind: null,
        parentToolCallId: null,
        data: JSON.stringify({
          direction: "outbound",
          source: "tell",
          initiator: "user",
          request: { method: "turn/start", params: {} },
          requestId: requestId(99),
          senderThreadId: null,
          input: [{ type: "text", text: "Steered follow-up", mentions: [] }],
          target: { kind: "steer", expectedTurnId: null },
          execution,
        }),
      },
      {
        threadId: thread.id,
        sequence: 1_001,
        type: "turn/started",
        scope: turnScope("turn-steer"),
        providerThreadId,
        itemId: null,
        itemKind: null,
        parentToolCallId: null,
        data: JSON.stringify({}),
      },
    ]);

    const walked = walkAllPages(db, thread, 1);
    expect(walked.pages).toBeGreaterThan(1);
    expect(walked.rows).toEqual(walkAllPages(db, thread, 20).rows);
  });
});

describe("timeline window event exclusions", () => {
  it("never reads workspace diff events into a window", () => {
    const { db, thread } = setup();
    seedTurns(db, thread, { completeLastTurn: true, itemsPerTurn: [5] });
    const withoutDiffs = buildPage(db, thread, null);

    insertEvents(db, noopNotifier, [
      {
        threadId: thread.id,
        sequence: 500,
        type: "turn/diff/updated",
        scope: turnScope("turn-1"),
        providerThreadId,
        itemId: null,
        itemKind: null,
        parentToolCallId: null,
        data: JSON.stringify({ diff: "x".repeat(50_000) }),
      },
    ]);

    const withDiffs = buildPage(db, thread, null);
    expect(withDiffs.profile.eventRowCount).toBe(
      withoutDiffs.profile.eventRowCount,
    );
    expect(withDiffs.response.rows).toEqual(withoutDiffs.response.rows);
  });
});

describe("timeline inline output reads", () => {
  it("shortens an oversized command output during the read", () => {
    const { db, thread } = setup();
    seedTurns(db, thread, { completeLastTurn: false, itemsPerTurn: [1] });
    const output = "x".repeat(50_000);
    insertEvents(db, noopNotifier, [
      {
        threadId: thread.id,
        sequence: 500,
        type: "item/completed",
        scope: turnScope("turn-1"),
        providerThreadId,
        itemId: "big-item",
        itemKind: "commandExecution",
        parentToolCallId: null,
        data: JSON.stringify({
          item: {
            type: "commandExecution",
            id: "big-item",
            command: "cat big",
            cwd: "/tmp/test",
            status: "completed",
            approvalStatus: null,
            exitCode: 0,
            aggregatedOutput: output,
          },
        }),
      },
    ]);

    const capped = buildThreadTimeline(db, thread, {
      includeProviderUnhandledOperations: false,
      includeNestedRows: false,
      maxInlineOutputChars: 32_000,
      maxSeq: 0,
      page: { kind: "latest", segmentLimit: 20 },
    });
    const uncapped = buildThreadTimeline(db, thread, {
      includeProviderUnhandledOperations: false,
      includeNestedRows: false,
      maxInlineOutputChars: null,
      maxSeq: 0,
      page: { kind: "latest", segmentLimit: 20 },
    });

    const cappedRow = capped.rows.find(
      (row) => row.kind === "work" && row.id.endsWith("big-item"),
    );
    const uncappedRow = uncapped.rows.find(
      (row) => row.kind === "work" && row.id.endsWith("big-item"),
    );
    expect(cappedRow?.kind).toBe("work");
    expect(uncappedRow?.kind).toBe("work");
    if (cappedRow?.kind !== "work" || uncappedRow?.kind !== "work") {
      throw new Error("expected work rows");
    }
    if (
      cappedRow.workKind !== "command" ||
      uncappedRow.workKind !== "command"
    ) {
      throw new Error("expected command rows");
    }
    expect(uncappedRow.output).toBe(output);
    expect(cappedRow.output).toBe(
      `${"x".repeat(32_000)}\n…[18,000 more characters truncated]`,
    );
  });
});

describe("background tasks on the latest page", () => {
  it("keeps the running-workflow banner for an open task", () => {
    const { db, thread } = setup();
    seedTurns(db, thread, {
      backgroundTask: "open",
      completeLastTurn: false,
      itemsPerTurn: [300],
    });

    expect(buildPage(db, thread, null).response.activeWorkflows).toHaveLength(
      1,
    );
  });

  it("drops the banner once the task completes", () => {
    const { db, thread } = setup();
    seedTurns(db, thread, {
      backgroundTask: "completed",
      completeLastTurn: false,
      itemsPerTurn: [300],
    });

    expect(buildPage(db, thread, null).response.activeWorkflows).toEqual([]);
  });
});

describe("items that only stream", () => {
  it.each([
    { includeStartedEvent: false, providerShape: "without item/started" },
    { includeStartedEvent: true, providerShape: "with item/started" },
  ])(
    "accumulates streamed assistant text across refreshes $providerShape",
    ({ includeStartedEvent }) => {
      const { db, thread } = setup();
      const itemId = "assistant-1";
      const turnId = "turn-1";
      seedTurns(db, thread, {
        completeLastTurn: false,
        itemsPerTurn: [100],
      });
      const events: EventInput[] = includeStartedEvent
        ? [
            {
              threadId: thread.id,
              sequence: 204,
              type: "item/started",
              scope: turnScope(turnId),
              providerThreadId,
              itemId,
              itemKind: "agentMessage",
              parentToolCallId: null,
              data: JSON.stringify({
                item: { type: "agentMessage", id: itemId, text: "" },
                providerThreadId,
              }),
            },
          ]
        : [];
      const firstDeltaSequence = includeStartedEvent ? 205 : 204;
      const chunks = Array.from({ length: 200 }, (_, index) => `[${index}]\n`);
      chunks.forEach((delta, index) => {
        events.push({
          threadId: thread.id,
          sequence: index + firstDeltaSequence,
          type: "item/agentMessage/delta",
          scope: turnScope(turnId),
          providerThreadId,
          itemId,
          itemKind: null,
          parentToolCallId: null,
          data: JSON.stringify({
            delta,
            itemId,
            providerThreadId,
          }),
        });
      });
      insertEvents(db, noopNotifier, events);

      const initial = buildPage(db, thread, null);
      const assistant = initial.response.rows.find(
        (row) => row.kind === "conversation" && row.role === "assistant",
      );

      expect(assistant?.text).toBe(chunks.join(""));
      const laterChunks = Array.from(
        { length: 25 },
        (_, index) => `[later-${index}]\n`,
      );
      insertEvents(
        db,
        noopNotifier,
        laterChunks.map((delta, index) => ({
          threadId: thread.id,
          sequence: index + firstDeltaSequence + chunks.length,
          type: "item/agentMessage/delta",
          scope: turnScope(turnId),
          providerThreadId,
          itemId,
          itemKind: null,
          parentToolCallId: null,
          data: JSON.stringify({
            delta,
            itemId,
            providerThreadId,
          }),
        })),
      );

      const refreshed = buildPage(db, thread, null);
      const refreshedAssistant = refreshed.response.rows.find(
        (row) => row.kind === "conversation" && row.role === "assistant",
      );
      expect(refreshedAssistant?.text).toBe(
        [...chunks, ...laterChunks].join(""),
      );
    },
  );
});

function seedCrossTurnCompletion(
  db: DbConnection,
  thread: Thread,
  options: { reuseCallIdInLaterTurn: boolean },
): void {
  const events: EventInput[] = [];
  let sequence = 0;
  const push = (event: Omit<EventInput, "sequence" | "threadId">): void => {
    sequence += 1;
    events.push({ ...event, sequence, threadId: thread.id });
  };
  const command = (
    turnId: string,
    status: "pending" | "completed",
    output: string | null,
  ): Omit<EventInput, "sequence" | "threadId"> => ({
    type: status === "pending" ? "item/started" : "item/completed",
    scope: turnScope(turnId),
    providerThreadId,
    itemId: "call-1",
    itemKind: "commandExecution",
    parentToolCallId: null,
    data: JSON.stringify({
      item: {
        type: "commandExecution",
        id: "call-1",
        command: "npm run dev",
        cwd: "/tmp/test",
        status,
        approvalStatus: null,
        ...(output === null ? {} : { exitCode: 0, aggregatedOutput: output }),
      },
    }),
  });
  const agentMessage = (
    turnId: string,
    id: string,
    text: string,
  ): Omit<EventInput, "sequence" | "threadId"> => ({
    type: "item/completed",
    scope: turnScope(turnId),
    providerThreadId,
    itemId: id,
    itemKind: "agentMessage",
    parentToolCallId: null,
    data: JSON.stringify({ item: { type: "agentMessage", id, text } }),
  });
  const turnLifecycle = (
    turnId: string,
    type: "turn/started" | "turn/completed",
  ): Omit<EventInput, "sequence" | "threadId"> => ({
    type,
    scope: turnScope(turnId),
    providerThreadId,
    itemId: null,
    itemKind: null,
    parentToolCallId: null,
    data: JSON.stringify(
      type === "turn/started" ? {} : { status: "completed", providerThreadId },
    ),
  });

  push(turnLifecycle("turn-1", "turn/started"));
  push(command("turn-1", "pending", null));
  if (options.reuseCallIdInLaterTurn) {
    push(command("turn-1", "completed", "first run"));
  }
  push(agentMessage("turn-1", "msg-1", "Dev server is starting."));
  push(turnLifecycle("turn-1", "turn/completed"));
  push(turnLifecycle("turn-2", "turn/started"));
  if (options.reuseCallIdInLaterTurn) {
    push(command("turn-2", "pending", null));
    push(command("turn-2", "completed", "second run"));
  } else {
    push({
      type: "item/completed",
      scope: turnScope("turn-2"),
      providerThreadId,
      itemId: "call-1",
      itemKind: "toolCall",
      parentToolCallId: null,
      data: JSON.stringify({
        item: {
          type: "toolCall",
          id: "call-1",
          tool: "unknown",
          status: "completed",
          result: "dev server exited with code 0",
        },
      }),
    });
  }
  push(agentMessage("turn-2", "msg-2", "Second turn done."));
  push(turnLifecycle("turn-2", "turn/completed"));

  insertEvents(db, noopNotifier, events);
}

function collectTurnDetailsAndChildren(
  db: DbConnection,
  thread: Thread,
): Map<string, { children: TimelineRow[]; details: TimelineRow[] }> {
  const byTurnId = new Map<
    string,
    { children: TimelineRow[]; details: TimelineRow[] }
  >();
  for (const row of buildNestedPage(db, thread, null).response.rows) {
    if (row.kind !== "turn") {
      continue;
    }
    byTurnId.set(row.turnId, {
      children: row.children ?? [],
      details: buildTimelineTurnSummaryDetails(db, thread, {
        includeProviderUnhandledOperations: false,
        sourceSeqEnd: row.sourceSeqEnd,
        sourceSeqStart: row.sourceSeqStart,
        turnId: row.turnId,
      }).rows,
    });
  }
  return byTurnId;
}

describe("turn details for an item that finishes in a later turn", () => {
  it("shows the spawning turn's item completed with its late output", () => {
    const { db, thread } = setup();
    seedCrossTurnCompletion(db, thread, { reuseCallIdInLaterTurn: false });

    const turns = collectTurnDetailsAndChildren(db, thread);
    const turn1 = turns.get("turn-1");
    expect(turn1).toBeDefined();
    expect(turn1!.children).toEqual([
      expect.objectContaining({
        callId: "call-1",
        output: "dev server exited with code 0",
        sourceSeqEnd: 6,
        status: "completed",
      }),
    ]);
    expect(turn1!.details).toEqual(turn1!.children);
  });

  it("keeps a later turn's reuse of the call id out of the spawning turn", () => {
    const { db, thread } = setup();
    seedCrossTurnCompletion(db, thread, { reuseCallIdInLaterTurn: true });

    const turns = collectTurnDetailsAndChildren(db, thread);
    expect([...turns.keys()]).toEqual(["turn-1", "turn-2"]);
    for (const [turnId, { children, details }] of turns) {
      expect(children, turnId).toEqual([
        expect.objectContaining({
          callId: "call-1",
          output: turnId === "turn-1" ? "first run" : "second run",
          status: "completed",
        }),
      ]);
      expect(details, turnId).toEqual(children);
    }
  });
});

describe("paginated turn details", () => {
  const OVERSIZED_ITEM_COUNT = 250;

  it("returns full outputs when the completed turn fits the exact-range limit", () => {
    const { db, thread } = setup();
    seedTurns(db, thread, {
      completeLastTurn: true,
      itemsPerTurn: [1],
      outputChars: 50_000,
    });

    const detail = buildTimelineTurnDetailsPage(db, thread, {
      includeProviderUnhandledOperations: false,
      sourceSeqEnd: getLatestThreadSequence(db, { threadId: thread.id }),
      sourceSeqStart: 2,
      turnId: "turn-1",
    });
    const command = detail.rows.find(
      (row) => row.kind === "work" && row.workKind === "command",
    );

    expect(detail.nextCursor).toBeNull();
    expect(command?.kind).toBe("work");
    if (command?.kind !== "work" || command.workKind !== "command") {
      throw new Error("expected a command row");
    }
    expect(command.output).toHaveLength(50_000);
  });

  it("returns one preview page when only capped outputs fit", () => {
    const { db, thread } = setup();
    seedTurns(db, thread, {
      completeLastTurn: true,
      itemsPerTurn: [125],
      outputChars: 40_000,
    });

    const detail = buildTimelineTurnDetailsPage(db, thread, {
      includeProviderUnhandledOperations: false,
      sourceSeqEnd: getLatestThreadSequence(db, { threadId: thread.id }),
      sourceSeqStart: 2,
      turnId: "turn-1",
    });
    const commandOutputs = detail.rows.flatMap((row) =>
      row.kind === "work" && row.workKind === "command" ? [row.output] : [],
    );

    expect(detail.nextCursor).toBeNull();
    expect(commandOutputs).toHaveLength(125);
    expect(
      commandOutputs.every((output) =>
        output.includes("more characters truncated"),
      ),
    ).toBe(true);
  });

  it("keeps paginated detail requests scoped to the requested work range", () => {
    const { db, thread } = setup();
    seedTurns(db, thread, {
      completeLastTurn: true,
      itemsPerTurn: [3],
    });

    const expandedCommandGroups = [
      { sourceSeqStart: 4, sourceSeqEnd: 5 },
      { sourceSeqStart: 6, sourceSeqEnd: 9 },
    ].map((range) => {
      const detail = buildTimelineTurnDetailsPage(db, thread, {
        includeProviderUnhandledOperations: false,
        ...range,
        turnId: "turn-1",
      });
      expect(detail.nextCursor).toBeNull();
      const commandIds = new Set<string>();
      collectCommandCallIds(detail.rows, commandIds);
      return [...commandIds];
    });

    expect(expandedCommandGroups).toEqual([
      ["turn-1-item-0"],
      ["turn-1-item-1", "turn-1-item-2"],
    ]);
  });

  it("hydrates every command of an oversized turn across pages", () => {
    const { db, thread } = setup();
    seedTurns(db, thread, {
      assistantBeforeItem: 20,
      commandChars: 25_000,
      completeLastTurn: true,
      itemsPerTurn: [OVERSIZED_ITEM_COUNT],
    });
    const sourceSeqEnd = getLatestThreadSequence(db, { threadId: thread.id });

    expect(() =>
      buildTimelineTurnSummaryDetails(db, thread, {
        includeProviderUnhandledOperations: false,
        sourceSeqEnd,
        sourceSeqStart: 2,
        turnId: "turn-1",
      }),
    ).toThrow("Timeline turn details exceed the safe response limit");

    const expandedCommandCallIds = new Set<string>();
    let expandedCommandRowCount = 0;
    let detailCursor: string | undefined;
    let firstDetailCursor: string | undefined;
    let detailPages = 0;
    do {
      const detail = buildTimelineTurnDetailsPage(db, thread, {
        ...(detailCursor ? { cursor: detailCursor } : {}),
        includeProviderUnhandledOperations: false,
        sourceSeqEnd,
        sourceSeqStart: 2,
        turnId: "turn-1",
      });
      detailPages += 1;
      expandedCommandRowCount += collectCommandCallIds(
        detail.rows,
        expandedCommandCallIds,
      );
      detailCursor = detail.nextCursor ?? undefined;
      firstDetailCursor ??= detailCursor;
      expect(detailPages).toBeLessThan(10);
    } while (detailCursor);

    expect(detailPages).toBeGreaterThan(1);
    expect(expandedCommandRowCount).toBe(OVERSIZED_ITEM_COUNT);
    expect(expandedCommandCallIds.size).toBe(OVERSIZED_ITEM_COUNT);
    expect(firstDetailCursor).toBeDefined();
    if (!firstDetailCursor) throw new Error("expected a detail cursor");
    expect(() =>
      buildTimelineTurnDetailsPage(db, thread, {
        cursor: firstDetailCursor,
        includeProviderUnhandledOperations: false,
        sourceSeqEnd,
        sourceSeqStart: 3,
        turnId: "turn-1",
      }),
    ).toThrow("Invalid turn details cursor");
  }, 15_000);

  it("refuses to paginate an unfinished turn", () => {
    const { db, thread } = setup();
    seedTurns(db, thread, { completeLastTurn: false, itemsPerTurn: [3] });

    expect(() =>
      buildTimelineTurnDetailsPage(db, thread, {
        includeProviderUnhandledOperations: false,
        sourceSeqEnd: getLatestThreadSequence(db, { threadId: thread.id }),
        sourceSeqStart: 2,
        turnId: "turn-1",
      }),
    ).toThrow("Cannot paginate details for incomplete turn");
  });
});
