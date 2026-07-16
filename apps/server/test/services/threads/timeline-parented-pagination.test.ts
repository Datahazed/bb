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
  insertEvents,
  migrate,
  noopNotifier,
  upsertHost,
} from "@bb/db";
import type { DbConnection } from "@bb/db";
import type {
  TimelinePaginationCursor,
  TimelineRow,
} from "@bb/server-contract";
import {
  buildThreadTimeline,
  buildThreadTimelineWithProfile,
  buildTimelineDelegationChildrenDetails,
  buildTimelineTurnSummaryDetails,
  THREAD_TIMELINE_EVENT_WINDOW_BYTE_TARGET,
  THREAD_TIMELINE_EVENT_WINDOW_ROW_LIMIT,
  THREAD_TIMELINE_PARENTED_ENRICHMENT_BYTE_TARGET,
  THREAD_TIMELINE_PARENTED_ENRICHMENT_ROW_LIMIT,
} from "../../../src/services/threads/timeline.js";
import { THREAD_TIMELINE_PAGE_ROW_LIMIT } from "../../../src/services/threads/timeline-pagination.js";

const providerThreadId = "provider-root";

const execution = {
  model: "gpt-5",
  serviceTier: "default",
  reasoningLevel: "medium",
  permissionMode: "full",
  source: "client/turn/requested",
} as const;

interface SetupResult {
  db: DbConnection;
  thread: Thread;
}

function setup(status: Thread["status"] = "starting"): SetupResult {
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
    status,
  });
  return { db, thread };
}

function requestId(value: number): ClientTurnRequestId {
  return encodeClientTurnRequestIdNumber({ value });
}

function insertCrossWindowSubagentEvents(
  db: DbConnection,
  thread: Thread,
): void {
  const firstRequestId = requestId(1);
  const secondRequestId = requestId(2);
  const thirdRequestId = requestId(3);
  insertEvents(db, noopNotifier, [
    {
      threadId: thread.id,
      sequence: 1,
      type: "client/turn/requested",
      scope: threadScope(),
      itemId: null,
      itemKind: null,
      data: JSON.stringify({
        direction: "outbound",
        source: "spawn",
        initiator: "user",
        request: { method: "thread/start", params: {} },
        requestId: firstRequestId,
        senderThreadId: null,
        input: [{ type: "text", text: "Start parent turn.", mentions: [] }],
        target: { kind: "thread-start" },
        execution,
      }),
    },
    {
      threadId: thread.id,
      sequence: 2,
      type: "turn/started",
      scope: turnScope("parent-turn"),
      providerThreadId,
      itemId: null,
      itemKind: null,
      data: JSON.stringify({}),
    },
    {
      threadId: thread.id,
      sequence: 3,
      type: "turn/input/accepted",
      scope: turnScope("parent-turn"),
      providerThreadId,
      itemId: null,
      itemKind: null,
      data: JSON.stringify({ clientRequestId: firstRequestId }),
    },
    {
      threadId: thread.id,
      sequence: 4,
      type: "item/started",
      scope: turnScope("parent-turn"),
      providerThreadId,
      itemId: "toolu_agent_1",
      itemKind: "toolCall",
      data: JSON.stringify({
        item: {
          type: "toolCall",
          id: "toolu_agent_1",
          tool: "Agent",
          arguments: {
            prompt: "Run the child.",
            subagent_type: "general-purpose",
          },
          status: "pending",
        },
      }),
    },
    {
      threadId: thread.id,
      sequence: 5,
      type: "item/completed",
      scope: turnScope("parent-turn"),
      providerThreadId,
      itemId: "toolu_agent_1",
      itemKind: "toolCall",
      data: JSON.stringify({
        item: {
          type: "toolCall",
          id: "toolu_agent_1",
          tool: "Agent",
          arguments: {
            prompt: "Run the child.",
            subagent_type: "general-purpose",
          },
          result: "FIRST_SUBAGENT_OUTPUT",
          status: "completed",
        },
      }),
    },
    {
      threadId: thread.id,
      sequence: 20,
      type: "client/turn/requested",
      scope: threadScope(),
      itemId: null,
      itemKind: null,
      data: JSON.stringify({
        direction: "outbound",
        source: "tell",
        initiator: "user",
        request: { method: "turn/start", params: {} },
        requestId: secondRequestId,
        senderThreadId: null,
        input: [{ type: "text", text: "Middle turn.", mentions: [] }],
        target: { kind: "new-turn" },
        execution,
      }),
    },
    {
      threadId: thread.id,
      sequence: 21,
      type: "turn/started",
      scope: turnScope("middle-turn"),
      providerThreadId,
      itemId: null,
      itemKind: null,
      data: JSON.stringify({}),
    },
    {
      threadId: thread.id,
      sequence: 22,
      type: "turn/input/accepted",
      scope: turnScope("middle-turn"),
      providerThreadId,
      itemId: null,
      itemKind: null,
      data: JSON.stringify({ clientRequestId: secondRequestId }),
    },
    {
      threadId: thread.id,
      sequence: 23,
      type: "item/completed",
      scope: turnScope("middle-turn"),
      providerThreadId,
      itemId: "middle-message",
      itemKind: "agentMessage",
      data: JSON.stringify({
        item: {
          type: "agentMessage",
          id: "middle-message",
          text: "Middle response.",
        },
      }),
    },
    {
      threadId: thread.id,
      sequence: 40,
      type: "client/turn/requested",
      scope: threadScope(),
      itemId: null,
      itemKind: null,
      data: JSON.stringify({
        direction: "outbound",
        source: "tell",
        initiator: "user",
        request: { method: "turn/start", params: {} },
        requestId: thirdRequestId,
        senderThreadId: null,
        input: [{ type: "text", text: "Newest turn.", mentions: [] }],
        target: { kind: "new-turn" },
        execution,
      }),
    },
    {
      threadId: thread.id,
      sequence: 41,
      type: "turn/started",
      scope: turnScope("newest-turn"),
      providerThreadId,
      itemId: null,
      itemKind: null,
      data: JSON.stringify({}),
    },
    {
      threadId: thread.id,
      sequence: 42,
      type: "turn/input/accepted",
      scope: turnScope("newest-turn"),
      providerThreadId,
      itemId: null,
      itemKind: null,
      data: JSON.stringify({ clientRequestId: thirdRequestId }),
    },
    {
      threadId: thread.id,
      sequence: 43,
      type: "item/completed",
      scope: turnScope("newest-turn"),
      providerThreadId,
      itemId: "newest-message",
      itemKind: "agentMessage",
      data: JSON.stringify({
        item: {
          type: "agentMessage",
          id: "newest-message",
          text: "Newest response.",
        },
      }),
    },
    {
      threadId: thread.id,
      sequence: 50,
      type: "turn/started",
      scope: turnScope("child-turn"),
      providerThreadId,
      itemId: null,
      itemKind: null,
      data: JSON.stringify({ parentToolCallId: "toolu_agent_1" }),
    },
    {
      threadId: thread.id,
      sequence: 51,
      type: "item/completed",
      scope: turnScope("child-turn"),
      providerThreadId,
      itemId: "child-message",
      itemKind: "agentMessage",
      data: JSON.stringify({
        item: {
          type: "agentMessage",
          id: "child-message",
          text: "SECOND_SUBAGENT_OUTPUT",
          parentToolCallId: "toolu_agent_1",
        },
      }),
    },
  ]);
}

function nestedRows(row: TimelineRow): readonly TimelineRow[] {
  if (row.kind === "turn") {
    return row.children ?? [];
  }
  if (row.kind === "work" && row.workKind === "delegation") {
    return row.childRows;
  }
  return [];
}

function flattenRows(rows: readonly TimelineRow[]): TimelineRow[] {
  const flattened: TimelineRow[] = [];
  const visit = (currentRows: readonly TimelineRow[]): void => {
    for (const row of currentRows) {
      flattened.push(row);
      visit(nestedRows(row));
    }
  };
  visit(rows);
  return flattened;
}

function rowTexts(rows: readonly TimelineRow[]): string[] {
  return flattenRows(rows).flatMap((row) =>
    row.kind === "conversation" ? [row.text] : [],
  );
}

type DelegationRow = Extract<
  TimelineRow,
  { kind: "work"; workKind: "delegation" }
>;
type TurnRow = Extract<TimelineRow, { kind: "turn" }>;

function loadDelegationChildSummaries(
  db: DbConnection,
  thread: Thread,
  delegation: DelegationRow,
): TurnRow[] {
  const childPage = delegation.childPage;
  if (!childPage) return [];
  const rows: TurnRow[] = [];
  for (const interval of childPage.intervals) {
    const intervalRows: TurnRow[] = [];
    let beforeCursor: TimelinePaginationCursor | null = null;
    do {
      const details = buildTimelineDelegationChildrenDetails(db, thread, {
        beforeCursor,
        directTurnSourceSeqEnd: interval.directTurnSourceSeqEnd,
        directTurnSourceSeqStart: interval.directTurnSourceSeqStart,
        parentToolCallId: childPage.parentToolCallId,
        sourceSeqEnd: childPage.sourceSeqEnd,
        sourceSeqStart: childPage.sourceSeqStart,
        turnId: childPage.ownerTurnId,
      });
      intervalRows.unshift(
        ...details.rows.filter((row): row is TurnRow => row.kind === "turn"),
      );
      beforeCursor = details.timelinePage.olderCursor;
    } while (beforeCursor !== null);
    rows.push(...intervalRows);
  }
  return rows;
}

function loadTurnDetailRows(
  db: DbConnection,
  thread: Thread,
  summary: TurnRow,
): TimelineRow[] {
  const rows: TimelineRow[] = [];
  let beforeCursor: TimelinePaginationCursor | null = null;
  do {
    const details = buildTimelineTurnSummaryDetails(db, thread, {
      beforeCursor,
      contextItemIds: summary.detailContextItemIds,
      includeProviderUnhandledOperations: false,
      parentToolCallId: summary.detailParentToolCallId,
      sourceSeqEnd: summary.sourceSeqEnd,
      sourceSeqStart: summary.sourceSeqStart,
      turnId: summary.turnId,
    });
    rows.unshift(...details.rows);
    beforeCursor = details.timelinePage.olderCursor;
  } while (beforeCursor !== null);
  return rows;
}

function loadDelegationTreeRows(
  db: DbConnection,
  thread: Thread,
  delegation: DelegationRow,
  visited = new Set<string>(),
): TimelineRow[] {
  if (visited.has(delegation.callId)) return [];
  visited.add(delegation.callId);
  const rows: TimelineRow[] = [];
  for (const summary of loadDelegationChildSummaries(db, thread, delegation)) {
    rows.push(summary);
    const detailRows = loadTurnDetailRows(db, thread, summary);
    rows.push(...detailRows);
    for (const nested of flattenRows(detailRows).filter(
      (row): row is DelegationRow =>
        row.kind === "work" && row.workKind === "delegation",
    )) {
      rows.push(...loadDelegationTreeRows(db, thread, nested, visited));
    }
  }
  return rows;
}

describe("thread timeline parented pagination", () => {
  it("keeps child-only subagent output off the latest page", () => {
    const { db, thread } = setup();
    insertCrossWindowSubagentEvents(db, thread);

    const timeline = buildThreadTimeline(db, thread, {
      includeProviderUnhandledOperations: false,
      includeNestedRows: true,
      maxSeq: 51,
      page: { kind: "latest", segmentLimit: 1 },
    });

    expect(rowTexts(timeline.rows)).toContain("Newest response.");
    expect(rowTexts(timeline.rows)).not.toContain("SECOND_SUBAGENT_OUTPUT");
  });

  it("loads cross-window subagent output through the original Agent boundary", () => {
    const { db, thread } = setup();
    insertCrossWindowSubagentEvents(db, thread);

    const timeline = buildThreadTimeline(db, thread, {
      includeProviderUnhandledOperations: false,
      includeNestedRows: true,
      maxSeq: 51,
      page: {
        kind: "older",
        beforeCursor: {
          anchorId: `${thread.id}:user-seed:20`,
          anchorSeq: 20,
        },
        segmentLimit: 1,
      },
    });
    const delegation = flattenRows(timeline.rows).find(
      (
        row,
      ): row is Extract<
        TimelineRow,
        { kind: "work"; workKind: "delegation" }
      > => row.kind === "work" && row.workKind === "delegation",
    );

    expect(delegation).toBeDefined();
    expect(delegation?.callId).toBe("toolu_agent_1");
    expect(delegation?.childRows).toEqual([]);
    expect(delegation?.childPage).toMatchObject({
      intervals: [
        {
          beforeChildRowId: null,
          directTurnSourceSeqStart: 50,
          directTurnSourceSeqEnd: 51,
        },
      ],
      parentToolCallId: "toolu_agent_1",
      sourceSeqStart: 50,
      sourceSeqEnd: 51,
    });
    if (!delegation) throw new Error("Expected delegation boundary");
    const childSummary = loadDelegationChildSummaries(
      db,
      thread,
      delegation,
    )[0];
    expect(childSummary).toMatchObject({
      detailParentToolCallId: "toolu_agent_1",
      turnId: "child-turn",
    });
    if (!childSummary) throw new Error("Expected child summary");
    expect(rowTexts(loadTurnDetailRows(db, thread, childSummary))).toContain(
      "SECOND_SUBAGENT_OUTPUT",
    );
  });

  it("plans only nonempty delegated-turn gaps around alternating retained work", () => {
    const { db, thread } = setup();
    insertCrossWindowSubagentEvents(db, thread);
    insertEvents(db, noopNotifier, [
      {
        threadId: thread.id,
        sequence: 6,
        type: "item/completed",
        scope: turnScope("parent-turn"),
        providerThreadId,
        itemId: "retained-one",
        itemKind: "agentMessage",
        data: JSON.stringify({
          item: {
            type: "agentMessage",
            id: "retained-one",
            text: "Retained one",
            parentToolCallId: "toolu_agent_1",
          },
        }),
      },
      {
        threadId: thread.id,
        sequence: 7,
        type: "turn/started",
        scope: turnScope("alternating-child-one"),
        providerThreadId,
        itemId: null,
        itemKind: null,
        data: JSON.stringify({ parentToolCallId: "toolu_agent_1" }),
      },
      {
        threadId: thread.id,
        sequence: 8,
        type: "item/completed",
        scope: turnScope("parent-turn"),
        providerThreadId,
        itemId: "retained-two",
        itemKind: "agentMessage",
        data: JSON.stringify({
          item: {
            type: "agentMessage",
            id: "retained-two",
            text: "Retained two",
            parentToolCallId: "toolu_agent_1",
          },
        }),
      },
      {
        threadId: thread.id,
        sequence: 9,
        type: "turn/started",
        scope: turnScope("alternating-child-two"),
        providerThreadId,
        itemId: null,
        itemKind: null,
        data: JSON.stringify({ parentToolCallId: "toolu_agent_1" }),
      },
      {
        threadId: thread.id,
        sequence: 10,
        type: "item/completed",
        scope: turnScope("parent-turn"),
        providerThreadId,
        itemId: "retained-three",
        itemKind: "agentMessage",
        data: JSON.stringify({
          item: {
            type: "agentMessage",
            id: "retained-three",
            text: "Retained three",
            parentToolCallId: "toolu_agent_1",
          },
        }),
      },
    ]);

    const timeline = buildThreadTimeline(db, thread, {
      includeProviderUnhandledOperations: false,
      includeNestedRows: true,
      maxSeq: 10,
      page: { kind: "latest", segmentLimit: 20 },
    });
    const delegation = flattenRows(timeline.rows).find(
      (row): row is DelegationRow =>
        row.kind === "work" && row.workKind === "delegation",
    );
    if (!delegation?.childPage) {
      throw new Error("Expected alternating delegation child plan");
    }
    expect(delegation.childRows.map((row) => row.sourceSeqStart)).toEqual([
      6, 8, 10,
    ]);
    expect(delegation.childPage).toMatchObject({
      sourceSeqEnd: 9,
      sourceSeqStart: 7,
    });
    expect(delegation.childPage.intervals).toEqual([
      {
        beforeChildRowId: delegation.childRows[1]?.id,
        directTurnSourceSeqEnd: 7,
        directTurnSourceSeqStart: 7,
      },
      {
        beforeChildRowId: delegation.childRows[2]?.id,
        directTurnSourceSeqEnd: 9,
        directTurnSourceSeqStart: 9,
      },
    ]);
    expect(delegation.childPage.intervals.length).toBeLessThanOrEqual(
      new Set(delegation.childRows.map((row) => row.sourceSeqStart)).size + 1,
    );

    const orderedSourceSeqs: number[] = [];
    for (const childRow of delegation.childRows) {
      const interval = delegation.childPage.intervals.find(
        (candidate) => candidate.beforeChildRowId === childRow.id,
      );
      if (interval) {
        orderedSourceSeqs.push(
          ...buildTimelineDelegationChildrenDetails(db, thread, {
            beforeCursor: null,
            directTurnSourceSeqEnd: interval.directTurnSourceSeqEnd,
            directTurnSourceSeqStart: interval.directTurnSourceSeqStart,
            parentToolCallId: delegation.childPage.parentToolCallId,
            sourceSeqEnd: delegation.childPage.sourceSeqEnd,
            sourceSeqStart: delegation.childPage.sourceSeqStart,
            turnId: delegation.childPage.ownerTurnId,
          }).rows.map((row) => row.sourceSeqStart),
        );
      }
      orderedSourceSeqs.push(childRow.sourceSeqStart);
    }
    expect(orderedSourceSeqs).toEqual([6, 7, 8, 9, 10]);
    expect(new Set(orderedSourceSeqs).size).toBe(orderedSourceSeqs.length);
  });

  it("pages one thousand direct child turns exactly once", () => {
    const { db, thread } = setup();
    insertCrossWindowSubagentEvents(db, thread);
    const childTurnCount = 1_000;
    insertEvents(
      db,
      noopNotifier,
      Array.from({ length: childTurnCount }, (_, index) => ({
        threadId: thread.id,
        sequence: index + 52,
        type: "turn/started" as const,
        scope: turnScope(`wide-child-${index}`),
        providerThreadId,
        itemId: null,
        itemKind: null,
        data: JSON.stringify({ parentToolCallId: "toolu_agent_1" }),
      })),
    );
    const timeline = buildThreadTimeline(db, thread, {
      includeProviderUnhandledOperations: false,
      includeNestedRows: true,
      maxSeq: childTurnCount + 51,
      page: {
        kind: "older",
        beforeCursor: {
          anchorId: `${thread.id}:user-seed:20`,
          anchorSeq: 20,
        },
        segmentLimit: 1,
      },
    });
    const delegation = flattenRows(timeline.rows).find(
      (row): row is DelegationRow =>
        row.kind === "work" && row.workKind === "delegation",
    );
    if (!delegation?.childPage) {
      throw new Error("Expected delegation child page");
    }
    const childPage = delegation.childPage;

    const seenTurnIds: string[] = [];
    const interval = childPage.intervals[0];
    if (!interval) throw new Error("Expected delegation child interval");
    let beforeCursor: TimelinePaginationCursor | null = null;
    let previousCursorSequence = Number.POSITIVE_INFINITY;
    do {
      const page = buildTimelineDelegationChildrenDetails(db, thread, {
        beforeCursor,
        directTurnSourceSeqEnd: interval.directTurnSourceSeqEnd,
        directTurnSourceSeqStart: interval.directTurnSourceSeqStart,
        parentToolCallId: childPage.parentToolCallId,
        sourceSeqEnd: childPage.sourceSeqEnd,
        sourceSeqStart: childPage.sourceSeqStart,
        turnId: childPage.ownerTurnId,
      });
      expect(page.rows.length).toBeLessThanOrEqual(50);
      for (const row of page.rows) {
        expect(row).toMatchObject({
          kind: "turn",
          detailParentToolCallId: "toolu_agent_1",
        });
        if (row.kind === "turn") seenTurnIds.push(row.turnId);
      }
      beforeCursor = page.timelinePage.olderCursor;
      if (beforeCursor) {
        expect(beforeCursor.anchorSeq).toBeLessThan(previousCursorSequence);
        previousCursorSequence = beforeCursor.anchorSeq;
      }
    } while (beforeCursor !== null);

    expect(seenTurnIds).toHaveLength(childTurnCount + 1);
    expect(new Set(seenTurnIds).size).toBe(childTurnCount + 1);
    expect(seenTurnIds).toContain("child-turn");
    expect(seenTurnIds).toContain("wide-child-0");
    expect(seenTurnIds).toContain(`wide-child-${childTurnCount - 1}`);
    expect(childPage.intervals).toHaveLength(1);

    const firstIntervalPage = buildTimelineDelegationChildrenDetails(
      db,
      thread,
      {
        beforeCursor: null,
        directTurnSourceSeqEnd: 600,
        directTurnSourceSeqStart: childPage.sourceSeqStart,
        parentToolCallId: childPage.parentToolCallId,
        sourceSeqEnd: childPage.sourceSeqEnd,
        sourceSeqStart: childPage.sourceSeqStart,
        turnId: childPage.ownerTurnId,
      },
    );
    const intervalCursor = firstIntervalPage.timelinePage.olderCursor;
    if (!intervalCursor) throw new Error("Expected interval-scoped cursor");
    expect(() =>
      buildTimelineDelegationChildrenDetails(db, thread, {
        beforeCursor: intervalCursor,
        directTurnSourceSeqEnd: childPage.sourceSeqEnd,
        directTurnSourceSeqStart: 601,
        parentToolCallId: childPage.parentToolCallId,
        sourceSeqEnd: childPage.sourceSeqEnd,
        sourceSeqStart: childPage.sourceSeqStart,
        turnId: childPage.ownerTurnId,
      }),
    ).toThrow("cursor is no longer available");
  });

  it("bounds cross-window descendant enrichment before projection", () => {
    const { db, thread } = setup();
    insertCrossWindowSubagentEvents(db, thread);
    const descendantCount = THREAD_TIMELINE_EVENT_WINDOW_ROW_LIMIT + 50;
    insertEvents(
      db,
      noopNotifier,
      Array.from({ length: descendantCount }, (_, index) => ({
        threadId: thread.id,
        sequence: index + 52,
        type: "item/completed" as const,
        scope: turnScope("child-turn"),
        providerThreadId,
        itemId: `extra-child-message-${index}`,
        itemKind: "agentMessage" as const,
        data: JSON.stringify({
          item: {
            type: "agentMessage",
            id: `extra-child-message-${index}`,
            text: `Extra child output ${index}`,
            parentToolCallId: "toolu_agent_1",
          },
        }),
      })),
    );

    const { profile, response } = buildThreadTimelineWithProfile(db, thread, {
      includeProviderUnhandledOperations: false,
      includeNestedRows: true,
      maxSeq: descendantCount + 51,
      page: {
        kind: "older",
        beforeCursor: {
          anchorId: `${thread.id}:user-seed:20`,
          anchorSeq: 20,
        },
        segmentLimit: 1,
      },
    });

    expect(profile.eventRowCount).toBeLessThanOrEqual(
      THREAD_TIMELINE_EVENT_WINDOW_ROW_LIMIT +
        THREAD_TIMELINE_PARENTED_ENRICHMENT_ROW_LIMIT +
        10,
    );
    const delegation = flattenRows(response.rows).find(
      (
        row,
      ): row is Extract<
        TimelineRow,
        { kind: "work"; workKind: "delegation" }
      > => row.kind === "work" && row.workKind === "delegation",
    );
    expect(delegation).toBeDefined();
    if (!delegation) throw new Error("Expected delegation boundary");
    expect(delegation.childRows).toEqual([]);
    const omittedChildTurn = loadDelegationChildSummaries(
      db,
      thread,
      delegation,
    )[0];
    expect(omittedChildTurn).toMatchObject({
      sourceSeqStart: 50,
      sourceSeqEnd: descendantCount + 51,
      summaryCount: descendantCount + 2,
      detailParentToolCallId: "toolu_agent_1",
    });
    if (!omittedChildTurn) {
      throw new Error("Expected omitted child work summary");
    }

    const recoveredChildMessages = new Set<string>();
    for (const text of rowTexts(
      loadTurnDetailRows(db, thread, omittedChildTurn),
    )) {
      recoveredChildMessages.add(text);
    }

    expect(recoveredChildMessages.size).toBe(descendantCount + 1);
    expect(recoveredChildMessages).toContain("SECOND_SUBAGENT_OUTPUT");
    expect(recoveredChildMessages).toContain("Extra child output 0");
    expect(recoveredChildMessages).toContain(
      `Extra child output ${descendantCount - 1}`,
    );
  });

  it("propagates late recursive descendants through budget-omitted delegations", () => {
    const { db, thread } = setup();
    insertCrossWindowSubagentEvents(db, thread);
    const interveningMessageCount = THREAD_TIMELINE_EVENT_WINDOW_ROW_LIMIT + 50;
    const grandchildStartSequence = 55 + interveningMessageCount;
    const grandchildInterveningMessageCount =
      THREAD_TIMELINE_EVENT_WINDOW_ROW_LIMIT + 50;
    const greatGrandchildStartSequence =
      grandchildStartSequence + 4 + grandchildInterveningMessageCount;
    insertEvents(db, noopNotifier, [
      {
        threadId: thread.id,
        sequence: 52,
        type: "item/started",
        scope: turnScope("child-turn"),
        providerThreadId,
        itemId: "nested-agent",
        itemKind: "toolCall",
        data: JSON.stringify({
          item: {
            type: "toolCall",
            id: "nested-agent",
            tool: "Agent",
            arguments: {
              prompt: "Run the grandchild.",
              subagent_type: "general-purpose",
            },
            parentToolCallId: "toolu_agent_1",
            status: "pending",
          },
        }),
      },
      {
        threadId: thread.id,
        sequence: 53,
        type: "item/completed",
        scope: turnScope("child-turn"),
        providerThreadId,
        itemId: "nested-agent",
        itemKind: "toolCall",
        data: JSON.stringify({
          item: {
            type: "toolCall",
            id: "nested-agent",
            tool: "Agent",
            arguments: {
              prompt: "Run the grandchild.",
              subagent_type: "general-purpose",
            },
            parentToolCallId: "toolu_agent_1",
            result: "nested launched",
            status: "completed",
          },
        }),
      },
      ...Array.from({ length: interveningMessageCount }, (_, index) => ({
        threadId: thread.id,
        sequence: 54 + index,
        type: "item/completed" as const,
        scope: turnScope("child-turn"),
        providerThreadId,
        itemId: `intervening-child-message-${index}`,
        itemKind: "agentMessage" as const,
        data: JSON.stringify({
          item: {
            type: "agentMessage",
            id: `intervening-child-message-${index}`,
            text: `Intervening child output ${index}`,
            parentToolCallId: "toolu_agent_1",
          },
        }),
      })),
      {
        threadId: thread.id,
        sequence: grandchildStartSequence - 1,
        type: "turn/completed",
        scope: turnScope("child-turn"),
        providerThreadId,
        itemId: null,
        itemKind: null,
        data: JSON.stringify({
          parentToolCallId: "toolu_agent_1",
          status: "completed",
        }),
      },
      {
        threadId: thread.id,
        sequence: grandchildStartSequence,
        type: "turn/started",
        scope: turnScope("grandchild-turn"),
        providerThreadId,
        itemId: null,
        itemKind: null,
        data: JSON.stringify({ parentToolCallId: "nested-agent" }),
      },
      {
        threadId: thread.id,
        sequence: grandchildStartSequence + 1,
        type: "item/started",
        scope: turnScope("grandchild-turn"),
        providerThreadId,
        itemId: "great-grandchild-agent",
        itemKind: "toolCall",
        data: JSON.stringify({
          item: {
            type: "toolCall",
            id: "great-grandchild-agent",
            tool: "Agent",
            arguments: {
              prompt: "Run the great grandchild.",
              subagent_type: "general-purpose",
            },
            parentToolCallId: "nested-agent",
            status: "pending",
          },
        }),
      },
      {
        threadId: thread.id,
        sequence: grandchildStartSequence + 2,
        type: "item/completed",
        scope: turnScope("grandchild-turn"),
        providerThreadId,
        itemId: "great-grandchild-agent",
        itemKind: "toolCall",
        data: JSON.stringify({
          item: {
            type: "toolCall",
            id: "great-grandchild-agent",
            tool: "Agent",
            arguments: {
              prompt: "Run the great grandchild.",
              subagent_type: "general-purpose",
            },
            parentToolCallId: "nested-agent",
            result: "great grandchild launched",
            status: "completed",
          },
        }),
      },
      ...Array.from(
        { length: grandchildInterveningMessageCount },
        (_, index) => ({
          threadId: thread.id,
          sequence: grandchildStartSequence + 3 + index,
          type: "item/completed" as const,
          scope: turnScope("grandchild-turn"),
          providerThreadId,
          itemId: `intervening-grandchild-message-${index}`,
          itemKind: "agentMessage" as const,
          data: JSON.stringify({
            item: {
              type: "agentMessage",
              id: `intervening-grandchild-message-${index}`,
              text: `Intervening grandchild output ${index}`,
              parentToolCallId: "nested-agent",
            },
          }),
        }),
      ),
      {
        threadId: thread.id,
        sequence: greatGrandchildStartSequence - 1,
        type: "turn/completed",
        scope: turnScope("grandchild-turn"),
        providerThreadId,
        itemId: null,
        itemKind: null,
        data: JSON.stringify({
          parentToolCallId: "nested-agent",
          status: "completed",
        }),
      },
      {
        threadId: thread.id,
        sequence: greatGrandchildStartSequence,
        type: "turn/started",
        scope: turnScope("great-grandchild-turn"),
        providerThreadId,
        itemId: null,
        itemKind: null,
        data: JSON.stringify({
          parentToolCallId: "great-grandchild-agent",
        }),
      },
      {
        threadId: thread.id,
        sequence: greatGrandchildStartSequence + 1,
        type: "item/completed",
        scope: turnScope("great-grandchild-turn"),
        providerThreadId,
        itemId: "great-grandchild-message",
        itemKind: "agentMessage",
        data: JSON.stringify({
          item: {
            type: "agentMessage",
            id: "great-grandchild-message",
            text: "GREAT_GRANDCHILD_LATE_OUTPUT",
            parentToolCallId: "great-grandchild-agent",
          },
        }),
      },
    ]);

    const { profile, response: timeline } = buildThreadTimelineWithProfile(
      db,
      thread,
      {
        includeProviderUnhandledOperations: false,
        includeNestedRows: true,
        maxSeq: greatGrandchildStartSequence + 1,
        page: {
          kind: "older",
          beforeCursor: {
            anchorId: `${thread.id}:user-seed:20`,
            anchorSeq: 20,
          },
          segmentLimit: 1,
        },
      },
    );
    expect(profile.eventRowCount).toBeLessThanOrEqual(
      THREAD_TIMELINE_EVENT_WINDOW_ROW_LIMIT +
        THREAD_TIMELINE_PARENTED_ENRICHMENT_ROW_LIMIT +
        10,
    );
    const rootDelegation = flattenRows(timeline.rows).find(
      (row): row is DelegationRow =>
        row.kind === "work" && row.workKind === "delegation",
    );
    expect(rootDelegation?.childPage?.sourceSeqEnd).toBe(
      greatGrandchildStartSequence + 1,
    );
    if (!rootDelegation) throw new Error("Expected root delegation boundary");

    const childSummary = loadDelegationChildSummaries(
      db,
      thread,
      rootDelegation,
    ).find((row) => row.turnId === "child-turn");
    expect(childSummary).toMatchObject({
      detailParentToolCallId: "toolu_agent_1",
      sourceSeqEnd: greatGrandchildStartSequence + 1,
    });
    if (!childSummary) throw new Error("Expected child work summary");

    const delegatedTreeRows = loadDelegationTreeRows(
      db,
      thread,
      rootDelegation,
    );
    expect(rowTexts(delegatedTreeRows)).toContain(
      "GREAT_GRANDCHILD_LATE_OUTPUT",
    );
    const nestedBoundaries = flattenRows(delegatedTreeRows).filter(
      (row): row is DelegationRow =>
        row.kind === "work" && row.workKind === "delegation",
    );
    expect(nestedBoundaries.map((row) => row.callId)).toEqual(
      expect.arrayContaining(["nested-agent", "great-grandchild-agent"]),
    );
  });

  it("restores a running child command lifecycle inside bounded enrichment", () => {
    const { db, thread } = setup("active");
    insertCrossWindowSubagentEvents(db, thread);
    const finalizedMessageCount =
      THREAD_TIMELINE_PARENTED_ENRICHMENT_ROW_LIMIT + 20;
    const deltaCount = THREAD_TIMELINE_PARENTED_ENRICHMENT_ROW_LIMIT + 40;
    const commandStartSequence = 52 + finalizedMessageCount;
    const largeDeltaPadding = "x".repeat(4_000);
    insertEvents(db, noopNotifier, [
      ...Array.from({ length: finalizedMessageCount }, (_, index) => ({
        threadId: thread.id,
        sequence: index + 52,
        type: "item/completed" as const,
        scope: turnScope("child-turn"),
        providerThreadId,
        itemId: `finalized-child-message-${index}`,
        itemKind: "agentMessage" as const,
        data: JSON.stringify({
          item: {
            type: "agentMessage",
            id: `finalized-child-message-${index}`,
            text: `Finalized child message ${index}`,
            parentToolCallId: "toolu_agent_1",
          },
        }),
      })),
      {
        threadId: thread.id,
        sequence: commandStartSequence,
        type: "item/started",
        scope: turnScope("child-turn"),
        providerThreadId,
        itemId: "nested-command",
        itemKind: "commandExecution",
        data: JSON.stringify({
          item: {
            type: "commandExecution",
            id: "nested-command",
            command: "nested-long-command",
            cwd: "/repo",
            status: "pending",
            approvalStatus: null,
            parentToolCallId: "toolu_agent_1",
          },
        }),
      },
      ...Array.from({ length: deltaCount }, (_, index) => ({
        threadId: thread.id,
        sequence: index + commandStartSequence + 1,
        type: "item/commandExecution/outputDelta" as const,
        scope: turnScope("child-turn"),
        providerThreadId,
        itemId: "nested-command",
        itemKind: "commandExecution" as const,
        data: JSON.stringify({
          itemId: "nested-command",
          delta: `nested chunk ${index} ${largeDeltaPadding}\n`,
          parentToolCallId: "toolu_agent_1",
        }),
      })),
      {
        threadId: thread.id,
        sequence: commandStartSequence + deltaCount + 1,
        type: "item/completed",
        scope: turnScope("child-turn"),
        providerThreadId,
        itemId: "late-finalized-child-message",
        itemKind: "agentMessage",
        data: JSON.stringify({
          item: {
            type: "agentMessage",
            id: "late-finalized-child-message",
            text: "Finalized after pending command",
            parentToolCallId: "toolu_agent_1",
          },
        }),
      },
      {
        threadId: thread.id,
        sequence: commandStartSequence + deltaCount + 2,
        type: "thread/contextWindowUsage/updated",
        scope: turnScope("parent-turn"),
        providerThreadId,
        itemId: null,
        itemKind: null,
        data: JSON.stringify({
          accountingPadding: "x".repeat(1_000),
          contextWindowUsage: {
            estimated: false,
            modelContextWindow: 200_000,
            usedTokens: 120_000,
          },
        }),
      },
    ]);

    const { profile, response: timeline } = buildThreadTimelineWithProfile(
      db,
      thread,
      {
        includeProviderUnhandledOperations: false,
        includeNestedRows: true,
        maxSeq: commandStartSequence + deltaCount + 2,
        page: {
          kind: "older",
          beforeCursor: {
            anchorId: `${thread.id}:user-seed:20`,
            anchorSeq: 20,
          },
          segmentLimit: 1,
        },
      },
    );
    expect(profile.enrichmentEventBytes).toBeGreaterThan(
      THREAD_TIMELINE_PARENTED_ENRICHMENT_BYTE_TARGET - 32_000,
    );
    expect(profile.enrichmentEventBytes).toBeLessThanOrEqual(
      THREAD_TIMELINE_PARENTED_ENRICHMENT_BYTE_TARGET,
    );
    expect(profile.enrichmentEventRowCount).toBeLessThanOrEqual(
      THREAD_TIMELINE_PARENTED_ENRICHMENT_ROW_LIMIT,
    );
    expect(profile.contextWindowEventRowCount).toBe(1);
    expect(profile.contextWindowEventDataBytes).toBeGreaterThan(0);
    const delegation = flattenRows(timeline.rows).find(
      (row): row is DelegationRow =>
        row.kind === "work" && row.workKind === "delegation",
    );
    expect(delegation?.childRows).toEqual([]);
    if (!delegation) throw new Error("Expected delegation boundary");

    const delegatedRows = loadDelegationTreeRows(db, thread, delegation);
    const nestedCommands = flattenRows(delegatedRows).filter(
      (
        row,
      ): row is Extract<TimelineRow, { kind: "work"; workKind: "command" }> =>
        row.kind === "work" &&
        row.workKind === "command" &&
        row.callId === "nested-command",
    );
    expect(nestedCommands).toHaveLength(1);
    expect(nestedCommands[0]).toMatchObject({
      command: "nested-long-command",
      status: "pending",
    });
    expect(nestedCommands[0]?.output).toContain(
      `nested chunk ${deltaCount - 1}`,
    );

    const recoveredFinalizedMessages = new Set(rowTexts(delegatedRows));
    expect(recoveredFinalizedMessages.size).toBe(finalizedMessageCount + 2);
    expect(recoveredFinalizedMessages).toContain("SECOND_SUBAGENT_OUTPUT");
    expect(recoveredFinalizedMessages).toContain(
      `Finalized child message ${finalizedMessageCount - 1}`,
    );
    expect(recoveredFinalizedMessages).toContain(
      "Finalized after pending command",
    );
  });
});

describe("thread timeline active-turn pagination", () => {
  it("does not restore a reused item start from after the captured detail range", () => {
    const { db, thread } = setup("active");
    const outputCount = THREAD_TIMELINE_EVENT_WINDOW_ROW_LIMIT + 46;
    const completedSequence = outputCount + 3;
    insertEvents(db, noopNotifier, [
      {
        threadId: thread.id,
        sequence: 1,
        type: "turn/started",
        scope: turnScope("reused-item-turn"),
        providerThreadId,
        itemId: null,
        itemKind: null,
        data: JSON.stringify({}),
      },
      {
        threadId: thread.id,
        sequence: 2,
        type: "item/started",
        scope: turnScope("reused-item-turn"),
        providerThreadId,
        itemId: "reused-command",
        itemKind: "commandExecution",
        data: JSON.stringify({
          item: {
            type: "commandExecution",
            id: "reused-command",
            command: "captured-command",
            cwd: "/repo",
            status: "pending",
            approvalStatus: null,
          },
        }),
      },
      ...Array.from({ length: outputCount }, (_, index) => ({
        threadId: thread.id,
        sequence: index + 3,
        type: "item/commandExecution/outputDelta" as const,
        scope: turnScope("reused-item-turn"),
        providerThreadId,
        itemId: "reused-command",
        itemKind: "commandExecution" as const,
        data: JSON.stringify({
          itemId: "reused-command",
          delta: `captured ${index}\n`,
        }),
      })),
      {
        threadId: thread.id,
        sequence: completedSequence,
        type: "item/completed",
        scope: turnScope("reused-item-turn"),
        providerThreadId,
        itemId: "reused-command",
        itemKind: "commandExecution",
        data: JSON.stringify({
          item: {
            type: "commandExecution",
            id: "reused-command",
            command: "captured-command",
            cwd: "/repo",
            status: "completed",
            approvalStatus: null,
            aggregatedOutput: "captured done",
            exitCode: 0,
          },
        }),
      },
      {
        threadId: thread.id,
        sequence: completedSequence + 1,
        type: "item/started",
        scope: turnScope("reused-item-turn"),
        providerThreadId,
        itemId: "reused-command",
        itemKind: "commandExecution",
        data: JSON.stringify({
          item: {
            type: "commandExecution",
            id: "reused-command",
            command: "future-command",
            cwd: "/repo",
            status: "pending",
            approvalStatus: null,
          },
        }),
      },
    ]);

    const details = buildTimelineTurnSummaryDetails(db, thread, {
      beforeCursor: null,
      contextItemIds: [],
      includeProviderUnhandledOperations: false,
      sourceSeqEnd: completedSequence,
      sourceSeqStart: 1,
      turnId: "reused-item-turn",
    });
    const commands = flattenRows(details.rows).filter(
      (
        row,
      ): row is Extract<TimelineRow, { kind: "work"; workKind: "command" }> =>
        row.kind === "work" && row.workKind === "command",
    );
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({
      command: "captured-command",
      sourceSeqEnd: completedSequence,
      status: "completed",
    });
    expect(JSON.stringify(details.rows)).not.toContain("future-command");
  });

  it("owns a completed long command once across top-level pages and details", () => {
    const { db, thread } = setup("idle");
    const clientRequestId = requestId(1);
    const outputCount = THREAD_TIMELINE_EVENT_WINDOW_ROW_LIMIT * 2 + 40;
    const completedSequence = outputCount + 5;
    insertEvents(db, noopNotifier, [
      {
        threadId: thread.id,
        sequence: 1,
        type: "client/turn/requested",
        scope: threadScope(),
        itemId: null,
        itemKind: null,
        data: JSON.stringify({
          direction: "outbound",
          source: "spawn",
          initiator: "user",
          request: { method: "thread/start", params: {} },
          requestId: clientRequestId,
          senderThreadId: null,
          input: [{ type: "text", text: "Run then finish.", mentions: [] }],
          target: { kind: "thread-start" },
          execution,
        }),
      },
      {
        threadId: thread.id,
        sequence: 2,
        type: "turn/started",
        scope: turnScope("completed-command-turn"),
        providerThreadId,
        itemId: null,
        itemKind: null,
        data: JSON.stringify({}),
      },
      {
        threadId: thread.id,
        sequence: 3,
        type: "turn/input/accepted",
        scope: turnScope("completed-command-turn"),
        providerThreadId,
        itemId: null,
        itemKind: null,
        data: JSON.stringify({ clientRequestId }),
      },
      {
        threadId: thread.id,
        sequence: 4,
        type: "item/started",
        scope: turnScope("completed-command-turn"),
        providerThreadId,
        itemId: "completed-long-command",
        itemKind: "commandExecution",
        data: JSON.stringify({
          item: {
            type: "commandExecution",
            id: "completed-long-command",
            command: "long-command",
            cwd: "/repo",
            status: "pending",
            approvalStatus: null,
          },
        }),
      },
      ...Array.from({ length: outputCount }, (_, index) => ({
        threadId: thread.id,
        sequence: index + 5,
        type: "item/commandExecution/outputDelta" as const,
        scope: turnScope("completed-command-turn"),
        providerThreadId,
        itemId: "completed-long-command",
        itemKind: "commandExecution" as const,
        data: JSON.stringify({
          itemId: "completed-long-command",
          delta: `chunk ${index}\n`,
        }),
      })),
      {
        threadId: thread.id,
        sequence: completedSequence,
        type: "item/completed",
        scope: turnScope("completed-command-turn"),
        providerThreadId,
        itemId: "completed-long-command",
        itemKind: "commandExecution",
        data: JSON.stringify({
          item: {
            type: "commandExecution",
            id: "completed-long-command",
            command: "long-command",
            cwd: "/repo",
            status: "completed",
            approvalStatus: null,
            aggregatedOutput: "finished",
            exitCode: 0,
          },
        }),
      },
      {
        threadId: thread.id,
        sequence: completedSequence + 1,
        type: "turn/completed",
        scope: turnScope("completed-command-turn"),
        providerThreadId,
        itemId: null,
        itemKind: null,
        data: JSON.stringify({ status: "completed" }),
      },
    ]);

    const topLevelCommands: Extract<
      TimelineRow,
      { kind: "work"; workKind: "command" }
    >[] = [];
    let page = buildThreadTimeline(db, thread, {
      includeNestedRows: false,
      includeProviderUnhandledOperations: false,
      maxSeq: completedSequence + 1,
      page: { kind: "latest", segmentLimit: 20 },
    });
    const completedSummary = page.rows.find(
      (row): row is Extract<TimelineRow, { kind: "turn" }> =>
        row.kind === "turn" && row.turnId === "completed-command-turn",
    );
    const firstTopLevelCursor = page.timelinePage.olderCursor;
    if (!firstTopLevelCursor) {
      throw new Error("Expected a raw-event top-level cursor");
    }
    expect(() =>
      buildThreadTimeline(db, thread, {
        includeNestedRows: false,
        includeProviderUnhandledOperations: false,
        maxSeq: completedSequence + 1,
        page: {
          beforeCursor: firstTopLevelCursor,
          kind: "older",
          segmentLimit: 19,
        },
      }),
    ).toThrow("cursor is no longer available");
    while (true) {
      topLevelCommands.push(
        ...flattenRows(page.rows).filter(
          (
            row,
          ): row is Extract<
            TimelineRow,
            { kind: "work"; workKind: "command" }
          > => row.kind === "work" && row.workKind === "command",
        ),
      );
      const cursor = page.timelinePage.olderCursor;
      if (!cursor) break;
      page = buildThreadTimeline(db, thread, {
        includeNestedRows: false,
        includeProviderUnhandledOperations: false,
        maxSeq: completedSequence + 1,
        page: { beforeCursor: cursor, kind: "older", segmentLimit: 20 },
      });
    }
    expect(topLevelCommands).toHaveLength(0);
    if (!completedSummary) {
      throw new Error("Expected completed command summary");
    }

    const detailCommands: Extract<
      TimelineRow,
      { kind: "work"; workKind: "command" }
    >[] = [];
    let beforeCursor: TimelinePaginationCursor | null = null;
    do {
      const details = buildTimelineTurnSummaryDetails(db, thread, {
        beforeCursor,
        contextItemIds: [],
        includeProviderUnhandledOperations: false,
        sourceSeqEnd: completedSummary.sourceSeqEnd,
        sourceSeqStart: completedSummary.sourceSeqStart,
        turnId: completedSummary.turnId,
      });
      detailCommands.push(
        ...flattenRows(details.rows).filter(
          (
            row,
          ): row is Extract<
            TimelineRow,
            { kind: "work"; workKind: "command" }
          > => row.kind === "work" && row.workKind === "command",
        ),
      );
      beforeCursor = details.timelinePage.olderCursor;
    } while (beforeCursor !== null);
    expect(detailCommands).toHaveLength(1);
    expect(detailCommands[0]).toMatchObject({
      callId: "completed-long-command",
      status: "completed",
    });
  });

  it("restores a pending command start before a long output-delta window", () => {
    const { db, thread } = setup("active");
    const clientRequestId = requestId(1);
    const outputCount = THREAD_TIMELINE_EVENT_WINDOW_ROW_LIMIT * 2 + 40;
    insertEvents(db, noopNotifier, [
      {
        threadId: thread.id,
        sequence: 1,
        type: "client/turn/requested",
        scope: threadScope(),
        itemId: null,
        itemKind: null,
        data: JSON.stringify({
          direction: "outbound",
          source: "spawn",
          initiator: "user",
          request: { method: "thread/start", params: {} },
          requestId: clientRequestId,
          senderThreadId: null,
          input: [{ type: "text", text: "Run a long command.", mentions: [] }],
          target: { kind: "thread-start" },
          execution,
        }),
      },
      {
        threadId: thread.id,
        sequence: 2,
        type: "turn/started",
        scope: turnScope("command-turn"),
        providerThreadId,
        itemId: null,
        itemKind: null,
        data: JSON.stringify({}),
      },
      {
        threadId: thread.id,
        sequence: 3,
        type: "turn/input/accepted",
        scope: turnScope("command-turn"),
        providerThreadId,
        itemId: null,
        itemKind: null,
        data: JSON.stringify({
          clientRequestId,
          ignoredLargeField: "x".repeat(
            THREAD_TIMELINE_EVENT_WINDOW_BYTE_TARGET + 50_000,
          ),
        }),
      },
      {
        threadId: thread.id,
        sequence: 4,
        type: "item/started",
        scope: turnScope("command-turn"),
        providerThreadId,
        itemId: "command-1",
        itemKind: "commandExecution",
        data: JSON.stringify({
          item: {
            type: "commandExecution",
            id: "command-1",
            command: "long-running-command",
            cwd: "/repo",
            aggregatedOutput: "",
            status: "pending",
            approvalStatus: null,
          },
        }),
      },
      ...Array.from({ length: outputCount }, (_, index) => ({
        threadId: thread.id,
        sequence: index + 5,
        type: "item/commandExecution/outputDelta" as const,
        scope: turnScope("command-turn"),
        providerThreadId,
        itemId: "command-1",
        itemKind: "commandExecution" as const,
        data: JSON.stringify({
          itemId: "command-1",
          delta: `chunk ${index}\n`,
        }),
      })),
    ]);

    const { profile, response: latest } = buildThreadTimelineWithProfile(
      db,
      thread,
      {
        includeProviderUnhandledOperations: false,
        maxSeq: outputCount + 4,
        page: { kind: "latest", segmentLimit: 20 },
      },
    );
    expect(profile.eventRowCount).toBeLessThanOrEqual(
      THREAD_TIMELINE_EVENT_WINDOW_ROW_LIMIT + 10,
    );
    const pendingCommands = latest.rows.filter(
      (
        row,
      ): row is Extract<TimelineRow, { kind: "work"; workKind: "command" }> =>
        row.kind === "work" &&
        row.workKind === "command" &&
        row.status === "pending",
    );
    expect(pendingCommands).toHaveLength(1);
    expect(pendingCommands[0]?.command).toBe("long-running-command");
    expect(pendingCommands[0]?.output).toContain(`chunk ${outputCount - 1}`);

    const summary = latest.rows.find(
      (row): row is Extract<TimelineRow, { kind: "turn" }> =>
        row.kind === "turn",
    );
    if (!summary) {
      throw new Error("Expected command history summary");
    }
    const details = buildTimelineTurnSummaryDetails(db, thread, {
      beforeCursor: null,
      contextItemIds: [],
      includeProviderUnhandledOperations: false,
      sourceSeqEnd: summary.sourceSeqEnd,
      sourceSeqStart: summary.sourceSeqStart,
      turnId: summary.turnId,
    });
    expect(
      details.rows.filter(
        (row) => row.kind === "work" && row.workKind === "command",
      ),
    ).toHaveLength(0);

    const commandIdsAcrossPages: string[] = [];
    let beforeCursor: TimelinePaginationCursor | null = null;
    let detailPageCount = 0;
    do {
      const page = buildTimelineTurnSummaryDetails(db, thread, {
        beforeCursor,
        contextItemIds: [],
        includeProviderUnhandledOperations: false,
        sourceSeqEnd: outputCount + 4,
        sourceSeqStart: 2,
        turnId: "command-turn",
      });
      commandIdsAcrossPages.push(
        ...flattenRows(page.rows).flatMap((row) =>
          row.kind === "work" && row.workKind === "command" ? [row.callId] : [],
        ),
      );
      beforeCursor = page.timelinePage.olderCursor;
      detailPageCount++;
      if (detailPageCount > 10) {
        throw new Error("Detail pagination did not terminate");
      }
    } while (beforeCursor !== null);

    expect(detailPageCount).toBeGreaterThan(2);
    expect(
      commandIdsAcrossPages.filter((callId) => callId === "command-1"),
    ).toHaveLength(1);
  });

  it("bounds a single oversized output event before projection", () => {
    const { db, thread } = setup("active");
    const clientRequestId = requestId(1);
    insertEvents(db, noopNotifier, [
      {
        threadId: thread.id,
        sequence: 1,
        type: "client/turn/requested",
        scope: threadScope(),
        itemId: null,
        itemKind: null,
        data: JSON.stringify({
          direction: "outbound",
          source: "spawn",
          initiator: "user",
          request: { method: "thread/start", params: {} },
          requestId: clientRequestId,
          senderThreadId: null,
          input: [{ type: "text", text: "Run a huge command.", mentions: [] }],
          target: { kind: "thread-start" },
          execution,
        }),
      },
      {
        threadId: thread.id,
        sequence: 2,
        type: "turn/started",
        scope: turnScope("command-turn"),
        providerThreadId,
        itemId: null,
        itemKind: null,
        data: JSON.stringify({}),
      },
      {
        threadId: thread.id,
        sequence: 3,
        type: "turn/input/accepted",
        scope: turnScope("command-turn"),
        providerThreadId,
        itemId: null,
        itemKind: null,
        data: JSON.stringify({ clientRequestId }),
      },
      {
        threadId: thread.id,
        sequence: 4,
        type: "item/started",
        scope: turnScope("command-turn"),
        providerThreadId,
        itemId: "huge-command",
        itemKind: "commandExecution",
        data: JSON.stringify({
          item: {
            type: "commandExecution",
            id: "huge-command",
            command: "huge-output-command",
            cwd: "/repo",
            aggregatedOutput: "",
            status: "pending",
            approvalStatus: null,
          },
        }),
      },
      {
        threadId: thread.id,
        sequence: 5,
        type: "item/commandExecution/outputDelta",
        scope: turnScope("command-turn"),
        providerThreadId,
        itemId: "huge-command",
        itemKind: "commandExecution",
        data: JSON.stringify({
          itemId: "huge-command",
          delta: "x".repeat(THREAD_TIMELINE_EVENT_WINDOW_BYTE_TARGET + 50_000),
        }),
      },
    ]);

    const { profile, response } = buildThreadTimelineWithProfile(db, thread, {
      includeProviderUnhandledOperations: false,
      maxSeq: 5,
      page: { kind: "latest", segmentLimit: 20 },
    });

    expect(profile.eventDataBytes).toBeLessThanOrEqual(
      THREAD_TIMELINE_EVENT_WINDOW_BYTE_TARGET,
    );
    const command = flattenRows(response.rows).find(
      (
        row,
      ): row is Extract<TimelineRow, { kind: "work"; workKind: "command" }> =>
        row.kind === "work" &&
        row.workKind === "command" &&
        row.callId === "huge-command",
    );
    expect(command?.output).toContain(
      "oversized event truncated for timeline rendering",
    );
    expect(command?.output.length).toBeLessThan(40_000);
  });

  it("paginates an aggregate byte cutoff without materializing the next row", () => {
    const { db, thread } = setup("idle");
    const clientRequestId = requestId(1);
    insertEvents(db, noopNotifier, [
      {
        threadId: thread.id,
        sequence: 1,
        type: "client/turn/requested",
        scope: threadScope(),
        itemId: null,
        itemKind: null,
        data: JSON.stringify({
          direction: "outbound",
          source: "spawn",
          initiator: "user",
          request: { method: "thread/start", params: {} },
          requestId: clientRequestId,
          senderThreadId: null,
          input: [{ type: "text", text: "Run bounded output.", mentions: [] }],
          target: { kind: "thread-start" },
          execution,
        }),
      },
      {
        threadId: thread.id,
        sequence: 2,
        type: "turn/started",
        scope: turnScope("aggregate-turn"),
        providerThreadId,
        itemId: null,
        itemKind: null,
        data: "{}",
      },
      {
        threadId: thread.id,
        sequence: 3,
        type: "turn/input/accepted",
        scope: turnScope("aggregate-turn"),
        providerThreadId,
        itemId: null,
        itemKind: null,
        data: JSON.stringify({ clientRequestId }),
      },
      {
        threadId: thread.id,
        sequence: 4,
        type: "item/started",
        scope: turnScope("aggregate-turn"),
        providerThreadId,
        itemId: "aggregate-command",
        itemKind: "commandExecution",
        data: JSON.stringify({
          item: {
            type: "commandExecution",
            id: "aggregate-command",
            command: "aggregate-command",
            cwd: "/repo",
            status: "pending",
            approvalStatus: null,
          },
        }),
      },
      ...Array.from({ length: 4 }, (_, index) => ({
        threadId: thread.id,
        sequence: index + 5,
        type: "item/commandExecution/outputDelta" as const,
        scope: turnScope("aggregate-turn"),
        providerThreadId,
        itemId: "aggregate-command",
        itemKind: "commandExecution" as const,
        data: JSON.stringify({
          itemId: "aggregate-command",
          delta: `${index}:${"x".repeat(299_000)}`,
        }),
      })),
      {
        threadId: thread.id,
        sequence: 9,
        type: "turn/completed",
        scope: turnScope("aggregate-turn"),
        providerThreadId,
        itemId: null,
        itemKind: null,
        data: JSON.stringify({ status: "completed" }),
      },
    ]);

    const latest = buildThreadTimeline(db, thread, {
      includeProviderUnhandledOperations: false,
      maxSeq: 9,
      page: { kind: "latest", segmentLimit: 20 },
    });
    const cursor = latest.timelinePage.olderCursor;
    expect(cursor?.anchorSeq).toBe(7);
    expect(latest.timelinePage.hasOlderRows).toBe(true);
    if (!cursor) throw new Error("Expected aggregate byte cursor");

    const older = buildThreadTimeline(db, thread, {
      includeProviderUnhandledOperations: false,
      maxSeq: 9,
      page: { beforeCursor: cursor, kind: "older", segmentLimit: 20 },
    });
    expect(older.timelinePage.olderCursor).toBeNull();
    expect(older.timelinePage.hasOlderRows).toBe(false);
  });

  it("traverses repeated byte cutoffs and oversized identities exactly once", () => {
    const { db, thread } = setup("idle");
    const clientRequestId = requestId(1);
    const oversizedProviderThreadId = `provider-${"界".repeat(300_000)}`;
    const oversizedTurnId = `turn-${"🧭".repeat(250_000)}`;
    insertEvents(db, noopNotifier, [
      {
        threadId: thread.id,
        sequence: 1,
        type: "client/turn/requested",
        scope: threadScope(),
        itemId: null,
        itemKind: null,
        data: JSON.stringify({
          direction: "outbound",
          source: "spawn",
          initiator: "user",
          request: { method: "thread/start", params: {} },
          requestId: clientRequestId,
          senderThreadId: null,
          input: [
            { type: "text", text: "Walk every bounded page.", mentions: [] },
          ],
          target: { kind: "thread-start" },
          execution,
        }),
      },
      {
        threadId: thread.id,
        sequence: 2,
        type: "system/error",
        scope: threadScope(),
        itemId: null,
        itemKind: null,
        data: JSON.stringify({ message: `error-2-${"a".repeat(300_000)}` }),
      },
      {
        threadId: thread.id,
        sequence: 3,
        type: "system/error",
        scope: threadScope(),
        itemId: null,
        itemKind: null,
        data: JSON.stringify({ message: `error-3-${"b".repeat(300_000)}` }),
      },
      {
        threadId: thread.id,
        sequence: 4,
        type: "system/error",
        scope: threadScope(),
        providerThreadId: oversizedProviderThreadId,
        itemId: null,
        itemKind: null,
        data: JSON.stringify({ message: "oversized provider identity" }),
      },
      {
        threadId: thread.id,
        sequence: 5,
        type: "system/error",
        scope: turnScope(oversizedTurnId),
        itemId: null,
        itemKind: null,
        data: JSON.stringify({ message: "oversized turn identity" }),
      },
      {
        threadId: thread.id,
        sequence: 6,
        type: "system/error",
        scope: threadScope(),
        itemId: null,
        itemKind: null,
        data: JSON.stringify({ message: `error-6-${"c".repeat(300_000)}` }),
      },
      {
        threadId: thread.id,
        sequence: 7,
        type: "system/error",
        scope: threadScope(),
        itemId: null,
        itemKind: null,
        data: JSON.stringify({ message: `error-7-${"d".repeat(300_000)}` }),
      },
    ]);

    const errorSequences: number[] = [];
    const oversizedIdentitySequences: number[] = [];
    let exhausted = false;
    let followedOlderCursor = false;
    let page:
      | { kind: "latest"; segmentLimit: number }
      | {
          beforeCursor: TimelinePaginationCursor;
          kind: "older";
          segmentLimit: number;
        } = { kind: "latest", segmentLimit: 20 };
    for (let pageNumber = 0; pageNumber < 10; pageNumber += 1) {
      const { profile, response } = buildThreadTimelineWithProfile(db, thread, {
        includeProviderUnhandledOperations: false,
        maxSeq: 7,
        page,
      });
      expect(profile.eventDataBytes).toBeLessThanOrEqual(
        THREAD_TIMELINE_EVENT_WINDOW_BYTE_TARGET,
      );
      for (const row of flattenRows(response.rows)) {
        if (
          row.kind !== "system" ||
          row.systemKind !== "error" ||
          row.sourceSeqStart < 2 ||
          row.sourceSeqStart > 7
        ) {
          continue;
        }
        errorSequences.push(row.sourceSeqStart);
        if (
          `${row.title}\n${row.detail ?? ""}`.includes(
            "identity metadata too large to render inline",
          )
        ) {
          oversizedIdentitySequences.push(row.sourceSeqStart);
        }
      }

      const cursor = response.timelinePage.olderCursor;
      if (cursor === null) {
        exhausted = true;
        break;
      }
      expect(response.timelinePage.hasOlderRows).toBe(true);
      followedOlderCursor = true;
      page = { beforeCursor: cursor, kind: "older", segmentLimit: 20 };
    }

    expect(exhausted).toBe(true);
    expect(followedOlderCursor).toBe(true);
    expect([...errorSequences].sort((left, right) => left - right)).toEqual([
      2, 3, 4, 5, 6, 7,
    ]);
    expect(new Set(errorSequences).size).toBe(errorSequences.length);
    expect(
      [...oversizedIdentitySequences].sort((left, right) => left - right),
    ).toEqual([4, 5]);
  });

  it("keeps oversized background-task enrichment bounded and schema-valid", () => {
    const { db, thread } = setup("active");
    const clientRequestId = requestId(1);
    const taskItem = {
      type: "backgroundTask" as const,
      id: "large-workflow",
      taskType: "local_workflow",
      description: "Large workflow",
      status: "pending" as const,
      taskStatus: "running" as const,
      skipTranscript: false,
    };
    insertEvents(db, noopNotifier, [
      {
        threadId: thread.id,
        sequence: 1,
        type: "client/turn/requested",
        scope: threadScope(),
        itemId: null,
        itemKind: null,
        data: JSON.stringify({
          direction: "outbound",
          source: "spawn",
          initiator: "user",
          request: { method: "thread/start", params: {} },
          requestId: clientRequestId,
          senderThreadId: null,
          input: [{ type: "text", text: "Start a workflow.", mentions: [] }],
          target: { kind: "thread-start" },
          execution,
        }),
      },
      {
        threadId: thread.id,
        sequence: 2,
        type: "turn/started",
        scope: turnScope("workflow-turn"),
        providerThreadId,
        itemId: null,
        itemKind: null,
        data: JSON.stringify({}),
      },
      {
        threadId: thread.id,
        sequence: 3,
        type: "turn/input/accepted",
        scope: turnScope("workflow-turn"),
        providerThreadId,
        itemId: null,
        itemKind: null,
        data: JSON.stringify({ clientRequestId }),
      },
      {
        threadId: thread.id,
        sequence: 4,
        type: "item/started",
        scope: turnScope("workflow-turn"),
        providerThreadId,
        itemId: taskItem.id,
        itemKind: "backgroundTask",
        data: JSON.stringify({ item: taskItem }),
      },
      {
        threadId: thread.id,
        sequence: 5,
        type: "item/backgroundTask/progress",
        scope: threadScope(),
        providerThreadId,
        itemId: taskItem.id,
        itemKind: "backgroundTask",
        data: JSON.stringify({
          item: {
            ...taskItem,
            summary: "x".repeat(
              THREAD_TIMELINE_EVENT_WINDOW_BYTE_TARGET + 50_000,
            ),
          },
        }),
      },
    ]);

    const { profile, response } = buildThreadTimelineWithProfile(db, thread, {
      includeProviderUnhandledOperations: false,
      maxSeq: 5,
      page: { kind: "latest", segmentLimit: 20 },
    });

    expect(profile.eventDataBytes).toBeLessThanOrEqual(
      THREAD_TIMELINE_EVENT_WINDOW_BYTE_TARGET,
    );
    expect(response.activeWorkflow).toMatchObject({
      itemId: taskItem.id,
      status: "pending",
      description: expect.stringContaining("large task details omitted"),
    });
  });

  it("does not repeat a pinned running command inside interleaved summaries", () => {
    const { db, thread } = setup("active");
    const clientRequestId = requestId(1);
    const interleavedWorkCount = 120;
    insertEvents(db, noopNotifier, [
      {
        threadId: thread.id,
        sequence: 1,
        type: "client/turn/requested",
        scope: threadScope(),
        itemId: null,
        itemKind: null,
        data: JSON.stringify({
          direction: "outbound",
          source: "spawn",
          initiator: "user",
          request: { method: "thread/start", params: {} },
          requestId: clientRequestId,
          senderThreadId: null,
          input: [
            { type: "text", text: "Run interleaved work.", mentions: [] },
          ],
          target: { kind: "thread-start" },
          execution,
        }),
      },
      {
        threadId: thread.id,
        sequence: 2,
        type: "turn/started",
        scope: turnScope("interleaved-turn"),
        providerThreadId,
        itemId: null,
        itemKind: null,
        data: JSON.stringify({}),
      },
      {
        threadId: thread.id,
        sequence: 3,
        type: "turn/input/accepted",
        scope: turnScope("interleaved-turn"),
        providerThreadId,
        itemId: null,
        itemKind: null,
        data: JSON.stringify({ clientRequestId }),
      },
      {
        threadId: thread.id,
        sequence: 4,
        type: "item/started",
        scope: turnScope("interleaved-turn"),
        providerThreadId,
        itemId: "pinned-command",
        itemKind: "commandExecution",
        data: JSON.stringify({
          item: {
            type: "commandExecution",
            id: "pinned-command",
            command: "long-running-command",
            cwd: "/repo",
            status: "pending",
            approvalStatus: null,
          },
        }),
      },
      ...Array.from({ length: interleavedWorkCount }, (_, index) => [
        {
          threadId: thread.id,
          sequence: 5 + index * 2,
          type: "item/commandExecution/outputDelta" as const,
          scope: turnScope("interleaved-turn"),
          providerThreadId,
          itemId: "pinned-command",
          itemKind: "commandExecution" as const,
          data: JSON.stringify({
            itemId: "pinned-command",
            delta: `live ${index}\n`,
          }),
        },
        {
          threadId: thread.id,
          sequence: 6 + index * 2,
          type: "item/completed" as const,
          scope: turnScope("interleaved-turn"),
          providerThreadId,
          itemId: `completed-command-${index}`,
          itemKind: "commandExecution" as const,
          data: JSON.stringify({
            item: {
              type: "commandExecution",
              id: `completed-command-${index}`,
              command: `completed command ${index}`,
              cwd: "/repo",
              status: "completed",
              approvalStatus: null,
              aggregatedOutput: `done ${index}`,
              exitCode: 0,
            },
          }),
        },
      ]).flat(),
    ]);

    const latest = buildThreadTimeline(db, thread, {
      includeProviderUnhandledOperations: false,
      maxSeq: 4 + interleavedWorkCount * 2,
      page: { kind: "latest", segmentLimit: 20 },
    });
    expect(
      latest.rows.filter(
        (row) =>
          row.kind === "work" &&
          row.workKind === "command" &&
          row.callId === "pinned-command",
      ),
    ).toHaveLength(1);
    const summary = latest.rows.find(
      (row): row is Extract<TimelineRow, { kind: "turn" }> =>
        row.kind === "turn",
    );
    if (!summary) {
      throw new Error("Expected an interleaved work summary");
    }

    const details = buildTimelineTurnSummaryDetails(db, thread, {
      beforeCursor: null,
      contextItemIds: [],
      includeProviderUnhandledOperations: false,
      sourceSeqEnd: summary.sourceSeqEnd,
      sourceSeqStart: summary.sourceSeqStart,
      turnId: summary.turnId,
    });
    expect(
      flattenRows(details.rows).some(
        (row) =>
          row.kind === "work" &&
          row.workKind === "command" &&
          row.callId === "pinned-command",
      ),
    ).toBe(false);
    expect(flattenRows(details.rows).length).toBeGreaterThan(0);
  });

  it("emits every lifecycle exactly once when a newer page exceeds backfill capacity", () => {
    const { db, thread } = setup("active");
    const clientRequestId = requestId(1);
    const commandCount = THREAD_TIMELINE_PARENTED_ENRICHMENT_ROW_LIMIT + 20;
    const fillerCount = THREAD_TIMELINE_EVENT_WINDOW_ROW_LIMIT - commandCount;
    const firstFillerSequence = 4 + commandCount;
    const firstDeltaSequence = firstFillerSequence + fillerCount;
    const sourceSeqEnd = firstDeltaSequence + commandCount - 1;
    insertEvents(db, noopNotifier, [
      {
        threadId: thread.id,
        sequence: 1,
        type: "client/turn/requested",
        scope: threadScope(),
        itemId: null,
        itemKind: null,
        data: JSON.stringify({
          direction: "outbound",
          source: "spawn",
          initiator: "user",
          request: { method: "thread/start", params: {} },
          requestId: clientRequestId,
          senderThreadId: null,
          input: [{ type: "text", text: "Run many commands.", mentions: [] }],
          target: { kind: "thread-start" },
          execution,
        }),
      },
      {
        threadId: thread.id,
        sequence: 2,
        type: "turn/started",
        scope: turnScope("many-command-turn"),
        providerThreadId,
        itemId: null,
        itemKind: null,
        data: JSON.stringify({}),
      },
      {
        threadId: thread.id,
        sequence: 3,
        type: "turn/input/accepted",
        scope: turnScope("many-command-turn"),
        providerThreadId,
        itemId: null,
        itemKind: null,
        data: JSON.stringify({ clientRequestId }),
      },
      ...Array.from({ length: commandCount }, (_, index) => ({
        threadId: thread.id,
        sequence: index + 4,
        type: "item/started" as const,
        scope: turnScope("many-command-turn"),
        providerThreadId,
        itemId: `many-command-${index}`,
        itemKind: "commandExecution" as const,
        data: JSON.stringify({
          item: {
            type: "commandExecution",
            id: `many-command-${index}`,
            command: `command ${index}`,
            cwd: "/repo",
            status: "pending",
            approvalStatus: null,
          },
        }),
      })),
      ...Array.from({ length: fillerCount }, (_, index) => ({
        threadId: thread.id,
        sequence: firstFillerSequence + index,
        type: "item/completed" as const,
        scope: turnScope("many-command-turn"),
        providerThreadId,
        itemId: `filler-${index}`,
        itemKind: "agentMessage" as const,
        data: JSON.stringify({
          item: {
            type: "agentMessage",
            id: `filler-${index}`,
            text: `Filler ${index}`,
          },
        }),
      })),
      ...Array.from({ length: commandCount }, (_, index) => ({
        threadId: thread.id,
        sequence: firstDeltaSequence + index,
        type: "item/commandExecution/outputDelta" as const,
        scope: turnScope("many-command-turn"),
        providerThreadId,
        itemId: `many-command-${index}`,
        itemKind: "commandExecution" as const,
        data: JSON.stringify({
          itemId: `many-command-${index}`,
          delta: `output ${index}`,
        }),
      })),
    ]);

    const commandIdsAcrossPages: string[] = [];
    let beforeCursor: TimelinePaginationCursor | null = null;
    do {
      const page = buildTimelineTurnSummaryDetails(db, thread, {
        beforeCursor,
        contextItemIds: [],
        includeProviderUnhandledOperations: false,
        sourceSeqEnd,
        sourceSeqStart: 2,
        turnId: "many-command-turn",
      });
      commandIdsAcrossPages.push(
        ...flattenRows(page.rows).flatMap((row) =>
          row.kind === "work" && row.workKind === "command" ? [row.callId] : [],
        ),
      );
      beforeCursor = page.timelinePage.olderCursor;
    } while (beforeCursor !== null);

    expect(commandIdsAcrossPages).toHaveLength(commandCount);
    expect(new Set(commandIdsAcrossPages).size).toBe(commandCount);
  });

  it("emits nested lifecycles once when a newer page exceeds the child reserve", () => {
    const { db, thread } = setup("active");
    const clientRequestId = requestId(1);
    const nestedCommandCount = 20;
    const fillerCount = THREAD_TIMELINE_EVENT_WINDOW_ROW_LIMIT;
    const firstFillerSequence = 5 + nestedCommandCount;
    const firstDeltaSequence = firstFillerSequence + fillerCount;
    const sourceSeqEnd = firstDeltaSequence + nestedCommandCount - 1;
    insertEvents(db, noopNotifier, [
      {
        threadId: thread.id,
        sequence: 1,
        type: "client/turn/requested",
        scope: threadScope(),
        itemId: null,
        itemKind: null,
        data: JSON.stringify({
          direction: "outbound",
          source: "spawn",
          initiator: "user",
          request: { method: "thread/start", params: {} },
          requestId: clientRequestId,
          senderThreadId: null,
          input: [{ type: "text", text: "Run nested commands.", mentions: [] }],
          target: { kind: "thread-start" },
          execution,
        }),
      },
      {
        threadId: thread.id,
        sequence: 2,
        type: "turn/started",
        scope: turnScope("nested-many-turn"),
        providerThreadId,
        itemId: null,
        itemKind: null,
        data: JSON.stringify({}),
      },
      {
        threadId: thread.id,
        sequence: 3,
        type: "turn/input/accepted",
        scope: turnScope("nested-many-turn"),
        providerThreadId,
        itemId: null,
        itemKind: null,
        data: JSON.stringify({ clientRequestId }),
      },
      {
        threadId: thread.id,
        sequence: 4,
        type: "item/started",
        scope: turnScope("nested-many-turn"),
        providerThreadId,
        itemId: "nested-parent",
        itemKind: "toolCall",
        data: JSON.stringify({
          item: {
            type: "toolCall",
            id: "nested-parent",
            tool: "Agent",
            arguments: {
              prompt: "Run children",
              subagent_type: "general-purpose",
            },
            status: "pending",
          },
        }),
      },
      ...Array.from({ length: nestedCommandCount }, (_, index) => ({
        threadId: thread.id,
        sequence: index + 5,
        type: "item/started" as const,
        scope: turnScope("nested-many-turn"),
        providerThreadId,
        itemId: `nested-many-command-${index}`,
        itemKind: "commandExecution" as const,
        data: JSON.stringify({
          item: {
            type: "commandExecution",
            id: `nested-many-command-${index}`,
            command: `nested command ${index}`,
            cwd: "/repo",
            status: "pending",
            approvalStatus: null,
            parentToolCallId: "nested-parent",
          },
        }),
      })),
      ...Array.from({ length: fillerCount }, (_, index) => ({
        threadId: thread.id,
        sequence: firstFillerSequence + index,
        type: "item/completed" as const,
        scope: turnScope("nested-many-turn"),
        providerThreadId,
        itemId: `nested-filler-${index}`,
        itemKind: "agentMessage" as const,
        data: JSON.stringify({
          item: {
            type: "agentMessage",
            id: `nested-filler-${index}`,
            text: `Nested filler ${index}`,
          },
        }),
      })),
      ...Array.from({ length: nestedCommandCount }, (_, index) => ({
        threadId: thread.id,
        sequence: firstDeltaSequence + index,
        type: "item/commandExecution/outputDelta" as const,
        scope: turnScope("nested-many-turn"),
        providerThreadId,
        itemId: `nested-many-command-${index}`,
        itemKind: "commandExecution" as const,
        data: JSON.stringify({
          itemId: `nested-many-command-${index}`,
          delta: `nested output ${index}`,
          parentToolCallId: "nested-parent",
        }),
      })),
    ]);

    const delegationRowsAcrossPages: DelegationRow[] = [];
    const commandIdsAcrossPages: string[] = [];
    let beforeCursor: TimelinePaginationCursor | null = null;
    do {
      const page = buildTimelineTurnSummaryDetails(db, thread, {
        beforeCursor,
        contextItemIds: [],
        includeProviderUnhandledOperations: false,
        sourceSeqEnd,
        sourceSeqStart: 2,
        turnId: "nested-many-turn",
      });
      delegationRowsAcrossPages.push(
        ...flattenRows(page.rows).filter(
          (row): row is DelegationRow =>
            row.kind === "work" && row.workKind === "delegation",
        ),
      );
      commandIdsAcrossPages.push(
        ...flattenRows(page.rows).flatMap((row) =>
          row.kind === "work" && row.workKind === "command" ? [row.callId] : [],
        ),
      );
      beforeCursor = page.timelinePage.olderCursor;
    } while (beforeCursor !== null);

    expect(delegationRowsAcrossPages).toHaveLength(1);
    const delegation = delegationRowsAcrossPages[0];
    if (!delegation) throw new Error("Expected nested delegation boundary");
    expect(delegation.childPage).toBeNull();
    expect(commandIdsAcrossPages).toHaveLength(nestedCommandCount);
    expect(new Set(commandIdsAcrossPages).size).toBe(nestedCommandCount);
  });

  it("keeps the prompt and pages older work through the pending turn summary", () => {
    const { db, thread } = setup("active");
    const olderRequestId = requestId(1);
    const firstRequestId = requestId(2);
    const assistantMessageCount = THREAD_TIMELINE_EVENT_WINDOW_ROW_LIMIT + 40;
    insertEvents(db, noopNotifier, [
      {
        threadId: thread.id,
        sequence: 1,
        type: "client/turn/requested",
        scope: threadScope(),
        itemId: null,
        itemKind: null,
        data: JSON.stringify({
          direction: "outbound",
          source: "spawn",
          initiator: "user",
          request: { method: "thread/start", params: {} },
          requestId: olderRequestId,
          senderThreadId: null,
          input: [{ type: "text", text: "Earlier question.", mentions: [] }],
          target: { kind: "thread-start" },
          execution,
        }),
      },
      {
        threadId: thread.id,
        sequence: 2,
        type: "turn/started",
        scope: turnScope("older-turn"),
        providerThreadId,
        itemId: null,
        itemKind: null,
        data: JSON.stringify({}),
      },
      {
        threadId: thread.id,
        sequence: 3,
        type: "turn/input/accepted",
        scope: turnScope("older-turn"),
        providerThreadId,
        itemId: null,
        itemKind: null,
        data: JSON.stringify({ clientRequestId: olderRequestId }),
      },
      {
        threadId: thread.id,
        sequence: 4,
        type: "item/completed",
        scope: turnScope("older-turn"),
        providerThreadId,
        itemId: "older-message",
        itemKind: "agentMessage",
        data: JSON.stringify({
          item: {
            type: "agentMessage",
            id: "older-message",
            text: "Earlier answer.",
          },
        }),
      },
      {
        threadId: thread.id,
        sequence: 5,
        type: "turn/completed",
        scope: turnScope("older-turn"),
        providerThreadId,
        itemId: null,
        itemKind: null,
        data: JSON.stringify({ status: "completed" }),
      },
      {
        threadId: thread.id,
        sequence: 10,
        type: "client/turn/requested",
        scope: threadScope(),
        itemId: null,
        itemKind: null,
        data: JSON.stringify({
          direction: "outbound",
          source: "tell",
          initiator: "user",
          request: { method: "turn/start", params: {} },
          requestId: firstRequestId,
          senderThreadId: null,
          input: [{ type: "text", text: "Do all the work.", mentions: [] }],
          target: { kind: "new-turn" },
          execution,
        }),
      },
      {
        threadId: thread.id,
        sequence: 11,
        type: "turn/started",
        scope: turnScope("giant-turn"),
        providerThreadId,
        itemId: null,
        itemKind: null,
        data: JSON.stringify({}),
      },
      {
        threadId: thread.id,
        sequence: 12,
        type: "turn/input/accepted",
        scope: turnScope("giant-turn"),
        providerThreadId,
        itemId: null,
        itemKind: null,
        data: JSON.stringify({ clientRequestId: firstRequestId }),
      },
      ...Array.from({ length: assistantMessageCount }, (_, index) => ({
        threadId: thread.id,
        sequence: index + 13,
        type: "item/completed" as const,
        scope: turnScope("giant-turn"),
        providerThreadId,
        itemId: `message-${index + 1}`,
        itemKind: "agentMessage" as const,
        data: JSON.stringify({
          item: {
            type: "agentMessage",
            id: `message-${index + 1}`,
            text: `Assistant message ${index + 1}`,
          },
        }),
      })),
    ]);
    const maxSeq = assistantMessageCount + 12;

    const latest = buildThreadTimeline(db, thread, {
      includeProviderUnhandledOperations: false,
      maxSeq,
      page: { kind: "latest", segmentLimit: 20 },
    });
    expect(latest.rows.length).toBeLessThanOrEqual(
      THREAD_TIMELINE_PAGE_ROW_LIMIT,
    );
    expect(latest.rows[0]).toMatchObject({
      kind: "conversation",
      role: "user",
      text: "Do all the work.",
    });
    const summary = latest.rows.find(
      (row): row is Extract<TimelineRow, { kind: "turn" }> =>
        row.kind === "turn",
    );
    expect(summary).toMatchObject({
      sourceSeqStart: 11,
      status: "pending",
      turnId: "giant-turn",
    });
    expect(latest.timelinePage).toMatchObject({
      hasOlderRows: true,
    });

    const topLevelCursor = latest.timelinePage.olderCursor;
    if (!topLevelCursor) {
      throw new Error("Expected an earlier-conversation cursor");
    }
    const olderTimeline = buildThreadTimeline(db, thread, {
      includeProviderUnhandledOperations: false,
      maxSeq,
      page: {
        beforeCursor: topLevelCursor,
        kind: "older",
        segmentLimit: 20,
      },
    });
    expect(rowTexts(olderTimeline.rows)).toContain("Earlier question.");
    expect(rowTexts(olderTimeline.rows)).toContain("Earlier answer.");
    expect(rowTexts(olderTimeline.rows)).not.toContain("Do all the work.");
    expect(() =>
      buildThreadTimeline(db, thread, {
        includeProviderUnhandledOperations: false,
        maxSeq,
        page: {
          beforeCursor: {
            ...topLevelCursor,
            anchorId: `${topLevelCursor.anchorId}-stale`,
          },
          kind: "older",
          segmentLimit: 20,
        },
      }),
    ).toThrow("cursor is no longer available");

    if (!summary) {
      throw new Error("Expected active work summary");
    }
    const scopedFirstPage = buildTimelineTurnSummaryDetails(db, thread, {
      beforeCursor: null,
      contextItemIds: ["context-b", "context-a", "context-a"],
      includeProviderUnhandledOperations: false,
      sourceSeqEnd: maxSeq,
      sourceSeqStart: summary.sourceSeqStart,
      turnId: summary.turnId,
    });
    const scopedCursor = scopedFirstPage.timelinePage.olderCursor;
    if (!scopedCursor) {
      throw new Error("Expected a scoped turn-detail cursor");
    }
    expect(
      buildTimelineTurnSummaryDetails(db, thread, {
        beforeCursor: scopedCursor,
        contextItemIds: ["context-a", "context-b"],
        includeProviderUnhandledOperations: false,
        sourceSeqEnd: maxSeq,
        sourceSeqStart: summary.sourceSeqStart,
        turnId: summary.turnId,
      }).rows.length,
    ).toBeGreaterThan(0);
    expect(() =>
      buildTimelineTurnSummaryDetails(db, thread, {
        beforeCursor: scopedCursor,
        contextItemIds: ["context-a", "context-c"],
        includeProviderUnhandledOperations: false,
        sourceSeqEnd: maxSeq,
        sourceSeqStart: summary.sourceSeqStart,
        turnId: summary.turnId,
      }),
    ).toThrow("cursor is no longer available");

    const detailRows: TimelineRow[] = [];
    let beforeCursor: TimelinePaginationCursor | null = null;
    let firstOlderCursor: TimelinePaginationCursor | null = null;
    do {
      const details = buildTimelineTurnSummaryDetails(db, thread, {
        beforeCursor,
        contextItemIds: summary.detailContextItemIds,
        includeProviderUnhandledOperations: false,
        sourceSeqEnd: summary.sourceSeqEnd,
        sourceSeqStart: summary.sourceSeqStart,
        turnId: summary.turnId,
      });
      detailRows.unshift(...details.rows);
      beforeCursor = details.timelinePage.olderCursor;
      firstOlderCursor ??= beforeCursor;
    } while (beforeCursor !== null);

    if (firstOlderCursor) {
      expect(() =>
        buildTimelineTurnSummaryDetails(db, thread, {
          beforeCursor: firstOlderCursor,
          contextItemIds: summary.detailContextItemIds,
          includeProviderUnhandledOperations: false,
          sourceSeqEnd: summary.sourceSeqEnd - 1,
          sourceSeqStart: summary.sourceSeqStart,
          turnId: summary.turnId,
        }),
      ).toThrow("cursor is no longer available");
      expect(() =>
        buildTimelineTurnSummaryDetails(db, thread, {
          beforeCursor: {
            ...firstOlderCursor,
            anchorId: `${firstOlderCursor.anchorId}-stale`,
          },
          contextItemIds: summary.detailContextItemIds,
          includeProviderUnhandledOperations: false,
          sourceSeqEnd: summary.sourceSeqEnd,
          sourceSeqStart: summary.sourceSeqStart,
          turnId: summary.turnId,
        }),
      ).toThrow("cursor is no longer available");
    }

    const assistantTexts = [...detailRows, ...latest.rows].flatMap((row) =>
      row.kind === "conversation" && row.role === "assistant" ? [row.text] : [],
    );
    expect(assistantTexts).toEqual(
      Array.from(
        { length: assistantMessageCount },
        (_, index) => `Assistant message ${index + 1}`,
      ),
    );
  });
});
