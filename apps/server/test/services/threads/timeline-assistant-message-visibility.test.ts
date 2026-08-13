import { describe, expect, it } from "vitest";
import { turnScope } from "@bb/domain";
import type { Thread } from "@bb/domain";
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
import type { TimelineRow } from "@bb/server-contract";
import {
  THREAD_TIMELINE_DEFAULT_SEGMENT_LIMIT,
  buildThreadConversationOutline,
  buildThreadTimeline,
  buildTimelineTurnSummaryDetails,
} from "../../../src/services/threads/timeline.js";

const providerThreadId = "provider-thread-1";
const turnId = "turn-1";

interface SetupResult {
  db: DbConnection;
  maxSeq: number;
  thread: Thread;
}

/**
 * One finished turn shaped assistant text -> command -> assistant text. It is
 * the shape a Stop hook produces, and the shape every consumer must describe
 * the same way.
 */
function setup(): SetupResult {
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
  insertEvents(db, noopNotifier, [
    {
      threadId: thread.id,
      sequence: 1,
      type: "turn/started",
      scope: turnScope(turnId),
      providerThreadId,
      itemId: null,
      itemKind: null,
      data: JSON.stringify({}),
    },
    {
      threadId: thread.id,
      sequence: 2,
      type: "item/completed",
      scope: turnScope(turnId),
      providerThreadId,
      itemId: "message-answer",
      itemKind: "agentMessage",
      data: JSON.stringify({
        item: {
          id: "message-answer",
          type: "agentMessage",
          text: "The long answer the user must read.",
        },
      }),
    },
    {
      threadId: thread.id,
      sequence: 3,
      type: "item/completed",
      scope: turnScope(turnId),
      providerThreadId,
      itemId: "command-1",
      itemKind: "commandExecution",
      data: JSON.stringify({
        item: {
          id: "command-1",
          type: "commandExecution",
          command: "printf check",
          cwd: "/tmp/test",
          status: "completed",
          approvalStatus: null,
          aggregatedOutput: "",
          exitCode: 0,
        },
      }),
    },
    {
      threadId: thread.id,
      sequence: 4,
      type: "item/completed",
      scope: turnScope(turnId),
      providerThreadId,
      itemId: "message-acknowledgement",
      itemKind: "agentMessage",
      data: JSON.stringify({
        item: {
          id: "message-acknowledgement",
          type: "agentMessage",
          text: "The verify gate is still open.",
        },
      }),
    },
    {
      threadId: thread.id,
      sequence: 5,
      type: "turn/completed",
      scope: turnScope(turnId),
      providerThreadId,
      itemId: null,
      itemKind: null,
      data: JSON.stringify({ status: "completed" }),
    },
  ]);
  return { db, maxSeq: 5, thread };
}

function buildTimeline(
  setupResult: SetupResult,
  showAllAssistantMessages: boolean,
): TimelineRow[] {
  return buildThreadTimeline(setupResult.db, setupResult.thread, {
    eventBudget: 10_000,
    includeProviderUnhandledOperations: false,
    maxInlineOutputChars: null,
    maxSeq: setupResult.maxSeq,
    page: {
      kind: "latest",
      segmentLimit: THREAD_TIMELINE_DEFAULT_SEGMENT_LIMIT,
    },
    showAllAssistantMessages,
  }).rows;
}

function assistantTexts(rows: readonly TimelineRow[]): string[] {
  return rows.flatMap((row) =>
    row.kind === "conversation" && row.role === "assistant" ? [row.text] : [],
  );
}

function requireOnlyTurnRow(
  rows: readonly TimelineRow[],
): Extract<TimelineRow, { kind: "turn" }> {
  const turnRows = rows.filter(
    (row): row is Extract<TimelineRow, { kind: "turn" }> => row.kind === "turn",
  );
  expect(turnRows).toHaveLength(1);
  const row = turnRows[0];
  if (!row) {
    throw new Error("Expected one turn summary row");
  }
  return row;
}

describe("assistant message visibility", () => {
  it("shows both assistant messages when the preference is on", () => {
    const setupResult = setup();
    const rows = buildTimeline(setupResult, true);

    expect(assistantTexts(rows)).toEqual([
      "The long answer the user must read.",
      "The verify gate is still open.",
    ]);
    setupResult.db.$client.close();
  });

  it("keeps only the last assistant message when the preference is off", () => {
    const setupResult = setup();
    const rows = buildTimeline(setupResult, false);

    expect(assistantTexts(rows)).toEqual(["The verify gate is still open."]);
    setupResult.db.$client.close();
  });

  it("resolves work summary details for the rows the same preference built", () => {
    const setupResult = setup();
    for (const showAllAssistantMessages of [true, false]) {
      const rows = buildTimeline(setupResult, showAllAssistantMessages);
      const turnRow = requireOnlyTurnRow(rows);
      const details = buildTimelineTurnSummaryDetails(
        setupResult.db,
        setupResult.thread,
        {
          includeProviderUnhandledOperations: false,
          showAllAssistantMessages,
          sourceSeqEnd: turnRow.sourceSeqEnd,
          sourceSeqStart: turnRow.sourceSeqStart,
          turnId,
        },
      );
      expect(
        details.rows.some(
          (row) => row.kind === "work" && row.workKind === "command",
        ),
      ).toBe(true);
    }
    setupResult.db.$client.close();
  });

  it("still resolves a work summary row built under the other preference", () => {
    // A client can hold a row from before a preference change: the row range of
    // a finished turn depends on the preference. The details request must keep
    // working until the client renders the new rows.
    const setupResult = setup();
    for (const rowPreference of [true, false]) {
      const turnRow = requireOnlyTurnRow(
        buildTimeline(setupResult, rowPreference),
      );
      const details = buildTimelineTurnSummaryDetails(
        setupResult.db,
        setupResult.thread,
        {
          includeProviderUnhandledOperations: false,
          showAllAssistantMessages: !rowPreference,
          sourceSeqEnd: turnRow.sourceSeqEnd,
          sourceSeqStart: turnRow.sourceSeqStart,
          turnId,
        },
      );
      expect(
        details.rows.some(
          (row) => row.kind === "work" && row.workKind === "command",
        ),
      ).toBe(true);
    }
    setupResult.db.$client.close();
  });

  it("lists only the visible assistant messages in the conversation outline", () => {
    const setupResult = setup();

    expect(
      buildThreadConversationOutline(setupResult.db, setupResult.thread, {
        maxSeq: setupResult.maxSeq,
        showAllAssistantMessages: true,
      }).items.map((item) => item.preview),
    ).toEqual([
      "The long answer the user must read.",
      "The verify gate is still open.",
    ]);
    expect(
      buildThreadConversationOutline(setupResult.db, setupResult.thread, {
        maxSeq: setupResult.maxSeq,
        showAllAssistantMessages: false,
      }).items.map((item) => item.preview),
    ).toEqual(["The verify gate is still open."]);
    setupResult.db.$client.close();
  });
});
