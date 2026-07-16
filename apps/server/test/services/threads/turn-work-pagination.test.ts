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
import type { DbConnection } from "@bb/db";
import type { TimelineRow, TimelineTurnRow } from "@bb/server-contract";
import {
  buildThreadConversationOutline,
  buildThreadTimeline,
  buildTimelineTurnWorkPage,
} from "../../../src/services/threads/timeline.js";

const TURN_ID = "turn-1";
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
  return { db, thread };
}

function requestId(value: number): ClientTurnRequestId {
  return encodeClientTurnRequestIdNumber({ value });
}

interface TurnScaffoldArgs {
  db: DbConnection;
  thread: Thread;
  requestValue: number;
  startSeq: number;
  turnId?: string;
  promptText?: string;
}

/** Inserts user request + turn/started + input accepted; returns next seq. */
function insertTurnScaffold({
  db,
  thread,
  requestValue,
  startSeq,
  turnId = TURN_ID,
  promptText = "Do the work.",
}: TurnScaffoldArgs): number {
  const clientRequestId = requestId(requestValue);
  insertEvents(db, noopNotifier, [
    {
      threadId: thread.id,
      sequence: startSeq,
      type: "client/turn/requested",
      scope: threadScope(),
      itemId: null,
      itemKind: null,
      data: JSON.stringify({
        direction: "outbound",
        source: "tell",
        initiator: "user",
        request: { method: "turn/start", params: {} },
        requestId: clientRequestId,
        senderThreadId: null,
        input: [{ type: "text", text: promptText, mentions: [] }],
        target: { kind: "new-turn" },
        execution,
      }),
    },
    {
      threadId: thread.id,
      sequence: startSeq + 1,
      type: "turn/started",
      scope: turnScope(turnId),
      providerThreadId,
      itemId: null,
      itemKind: null,
      data: JSON.stringify({}),
    },
    {
      threadId: thread.id,
      sequence: startSeq + 2,
      type: "turn/input/accepted",
      scope: turnScope(turnId),
      providerThreadId,
      itemId: null,
      itemKind: null,
      data: JSON.stringify({ clientRequestId }),
    },
  ]);
  return startSeq + 3;
}

interface InsertCommandPairArgs {
  db: DbConnection;
  thread: Thread;
  seq: number;
  turnId?: string;
}

/** Inserts one started/completed command pair at (seq, seq + 1). */
function insertCommandPair({
  db,
  thread,
  seq,
  turnId = TURN_ID,
}: InsertCommandPairArgs): void {
  const itemId = `cmd-${seq}`;
  const item = {
    type: "commandExecution",
    id: itemId,
    command: `echo ${seq}`,
    cwd: "/repo",
    aggregatedOutput: `out ${seq}`,
    exitCode: 0,
    status: "completed",
    approvalStatus: null,
  };
  insertEvents(db, noopNotifier, [
    {
      threadId: thread.id,
      sequence: seq,
      type: "item/started",
      scope: turnScope(turnId),
      providerThreadId,
      itemId,
      itemKind: "commandExecution",
      data: JSON.stringify({ item: { ...item, status: "pending" } }),
    },
    {
      threadId: thread.id,
      sequence: seq + 1,
      type: "item/completed",
      scope: turnScope(turnId),
      providerThreadId,
      itemId,
      itemKind: "commandExecution",
      data: JSON.stringify({ item }),
    },
  ]);
}

interface InsertAssistantMessageArgs {
  db: DbConnection;
  thread: Thread;
  seq: number;
  text: string;
  turnId?: string;
}

function insertAssistantMessage({
  db,
  thread,
  seq,
  text,
  turnId = TURN_ID,
}: InsertAssistantMessageArgs): void {
  insertEvents(db, noopNotifier, [
    {
      threadId: thread.id,
      sequence: seq,
      type: "item/completed",
      scope: turnScope(turnId),
      providerThreadId,
      itemId: `assistant-${seq}`,
      itemKind: "agentMessage",
      data: JSON.stringify({
        item: { type: "agentMessage", id: `assistant-${seq}`, text },
      }),
    },
  ]);
}

interface InsertTurnCompletedArgs {
  db: DbConnection;
  thread: Thread;
  seq: number;
  turnId?: string;
}

function insertTurnCompleted({
  db,
  thread,
  seq,
  turnId = TURN_ID,
}: InsertTurnCompletedArgs): void {
  insertEvents(db, noopNotifier, [
    {
      threadId: thread.id,
      sequence: seq,
      type: "turn/completed",
      scope: turnScope(turnId),
      providerThreadId,
      itemId: null,
      itemKind: null,
      data: JSON.stringify({ status: "completed" }),
    },
  ]);
}

function latestTimelineRows(db: DbConnection, thread: Thread): TimelineRow[] {
  return buildThreadTimeline(db, thread, {
    includeProviderUnhandledOperations: false,
    // The collapse frontier is bounded by maxSeq for cache determinism, so
    // the build must see the real revision like the route does.
    maxSeq: getLatestThreadSequence(db, { threadId: thread.id }),
    page: { kind: "latest", segmentLimit: 20 },
  }).rows;
}

function turnRows(rows: TimelineRow[]): TimelineTurnRow[] {
  return rows.filter((row): row is TimelineTurnRow => row.kind === "turn");
}

function visibleCommandCount(rows: TimelineRow[]): number {
  return rows.filter(
    (row) => row.kind === "work" && row.workKind === "command",
  ).length;
}

/** Command pairs at sequences 10/11, 12/13, … (count pairs). */
function insertCommandPairs(
  db: DbConnection,
  thread: Thread,
  count: number,
): number {
  let seq = 10;
  for (let index = 0; index < count; index += 1) {
    insertCommandPair({ db, thread, seq });
    seq += 2;
  }
  return seq;
}

describe("active-turn collapse frontier", () => {
  it("keeps small active turns fully flat", () => {
    const { db, thread } = setup();
    insertTurnScaffold({ db, thread, requestValue: 1, startSeq: 1 });
    insertCommandPairs(db, thread, 40);

    const rows = latestTimelineRows(db, thread);
    expect(turnRows(rows)).toEqual([]);
    expect(visibleCommandCount(rows)).toBe(40);
  });

  it("collapses in chunk-aligned steps once the turn grows", () => {
    const { db, thread } = setup();
    insertTurnScaffold({ db, thread, requestValue: 1, startSeq: 1 });
    insertCommandPairs(db, thread, 60);

    const rows = latestTimelineRows(db, thread);
    const [partialRow] = turnRows(rows);
    expect(partialRow).toBeDefined();
    expect(partialRow.partial).toBe(true);
    expect(partialRow.turnId).toBe(TURN_ID);
    // 60 completions → floor((60-24)/24)*24 = 24 collapsed, 36 visible.
    expect(partialRow.summaryCount).toBe(24);
    expect(visibleCommandCount(rows)).toBe(36);

    // 11 more completions stay within the chunk: frontier unchanged.
    let seq = 10 + 60 * 2;
    for (let index = 0; index < 11; index += 1) {
      insertCommandPair({ db, thread, seq });
      seq += 2;
    }
    const withinChunkRows = latestTimelineRows(db, thread);
    expect(turnRows(withinChunkRows)[0]?.summaryCount).toBe(24);
    expect(visibleCommandCount(withinChunkRows)).toBe(47);

    // The next completion crosses the chunk boundary: one 24-item step.
    insertCommandPair({ db, thread, seq });
    const nextChunkRows = latestTimelineRows(db, thread);
    expect(turnRows(nextChunkRows)[0]?.summaryCount).toBe(48);
    expect(visibleCommandCount(nextChunkRows)).toBe(24);
  });

  it("derives the frontier only from events at or below maxSeq", () => {
    const { db, thread } = setup();
    insertTurnScaffold({ db, thread, requestValue: 1, startSeq: 1 });
    insertCommandPairs(db, thread, 72);

    // Build at an older revision (60 completions): the 12 newer pairs must
    // not advance the frontier baked into that revision's cached response.
    const olderMaxSeq = 10 + 60 * 2 - 1;
    const rows = buildThreadTimeline(db, thread, {
      includeProviderUnhandledOperations: false,
      maxSeq: olderMaxSeq,
      page: { kind: "latest", segmentLimit: 20 },
    }).rows;
    expect(turnRows(rows)[0]?.summaryCount).toBe(24);

    const latestRows = latestTimelineRows(db, thread);
    expect(turnRows(latestRows)[0]?.summaryCount).toBe(48);
  });

  it("does not collapse completed turns via the frontier path", () => {
    const { db, thread } = setup();
    insertTurnScaffold({ db, thread, requestValue: 1, startSeq: 1 });
    const seq = insertCommandPairs(db, thread, 60);
    insertAssistantMessage({ db, thread, seq, text: "All done." });
    insertTurnCompleted({ db, thread, seq: seq + 1 });

    const rows = latestTimelineRows(db, thread);
    const [turnRow] = turnRows(rows);
    expect(turnRow).toBeDefined();
    expect(turnRow.partial).toBe(false);
    expect(turnRow.status).toBe("completed");
    expect(turnRow.summaryCount).toBe(60);
    expect(visibleCommandCount(rows)).toBe(0);
  });
});

describe("buildTimelineTurnWorkPage", () => {
  const pageBaseOptions = {
    includeProviderUnhandledOperations: false,
    turnId: TURN_ID,
  };

  function setupCompletedTurn(commandCount: number): {
    db: DbConnection;
    thread: Thread;
    turnRow: TimelineTurnRow;
  } {
    const { db, thread } = setup();
    insertTurnScaffold({ db, thread, requestValue: 1, startSeq: 1 });
    const seq = insertCommandPairs(db, thread, commandCount);
    insertAssistantMessage({ db, thread, seq, text: "All done." });
    insertTurnCompleted({ db, thread, seq: seq + 1 });
    const [turnRow] = turnRows(latestTimelineRows(db, thread));
    expect(turnRow).toBeDefined();
    return { db, thread, turnRow };
  }

  function pageCommands(rows: TimelineRow[]): string[] {
    return rows.flatMap((row) =>
      row.kind === "work" && row.workKind === "command" ? [row.command] : [],
    );
  }

  it("pages newest-first through a completed turn's work", () => {
    const { db, thread, turnRow } = setupCompletedTurn(10);

    const firstPage = buildTimelineTurnWorkPage(db, thread, {
      ...pageBaseOptions,
      sourceSeqStart: turnRow.sourceSeqStart,
      sourceSeqEnd: turnRow.sourceSeqEnd,
      mode: { kind: "page", workItemLimit: 4 },
    });
    // Commands sit at 10/11 … 28/29; the summary row's range ends at the
    // last work completion (the terminal message renders in the main
    // timeline), so the newest 4-item page is exactly the last four commands.
    expect(pageCommands(firstPage.rows)).toEqual([
      "echo 22",
      "echo 24",
      "echo 26",
      "echo 28",
    ]);
    expect(firstPage.rows.some((row) => row.kind === "conversation")).toBe(
      false,
    );
    const firstCursor = firstPage.workPage?.earlierCursor;
    expect(firstCursor).toEqual({ beforeSeq: 22 });

    const secondPage = buildTimelineTurnWorkPage(db, thread, {
      ...pageBaseOptions,
      sourceSeqStart: turnRow.sourceSeqStart,
      sourceSeqEnd: (firstCursor?.beforeSeq ?? 0) - 1,
      mode: { kind: "page", workItemLimit: 4 },
    });
    expect(pageCommands(secondPage.rows)).toEqual([
      "echo 14",
      "echo 16",
      "echo 18",
      "echo 20",
    ]);

    const thirdPage = buildTimelineTurnWorkPage(db, thread, {
      ...pageBaseOptions,
      sourceSeqStart: turnRow.sourceSeqStart,
      sourceSeqEnd: (secondPage.workPage?.earlierCursor?.beforeSeq ?? 0) - 1,
      mode: { kind: "page", workItemLimit: 4 },
    });
    expect(pageCommands(thirdPage.rows)).toEqual(["echo 10", "echo 12"]);
    expect(thirdPage.workPage).toEqual({ earlierCursor: null });
  });

  it("serves an exact catch-up range", () => {
    const { db, thread, turnRow } = setupCompletedTurn(10);

    const range = buildTimelineTurnWorkPage(db, thread, {
      ...pageBaseOptions,
      sourceSeqStart: turnRow.sourceSeqStart,
      sourceSeqEnd: 17,
      mode: { kind: "range", afterSeq: 13 },
    });
    expect(pageCommands(range.rows)).toEqual(["echo 14", "echo 16"]);
    expect(range.workPage).toBeNull();

    const emptyRange = buildTimelineTurnWorkPage(db, thread, {
      ...pageBaseOptions,
      sourceSeqStart: turnRow.sourceSeqStart,
      sourceSeqEnd: 13,
      mode: { kind: "range", afterSeq: 13 },
    });
    expect(emptyRange.rows).toEqual([]);
  });

  it("degrades to an empty page when the window has no rows for the turn", () => {
    const { db, thread, turnRow } = setupCompletedTurn(2);

    const page = buildTimelineTurnWorkPage(db, thread, {
      ...pageBaseOptions,
      turnId: "turn-missing",
      sourceSeqStart: turnRow.sourceSeqStart,
      sourceSeqEnd: turnRow.sourceSeqEnd,
      mode: { kind: "page", workItemLimit: 4 },
    });
    expect(page.rows).toEqual([]);
    expect(page.workPage).toEqual({ earlierCursor: null });
  });
});

describe("conversation outline targeted selection", () => {
  it("matches the timeline's top-level conversation rows", () => {
    const { db, thread } = setup();
    let seq = insertTurnScaffold({
      db,
      thread,
      requestValue: 1,
      startSeq: 1,
      promptText: "First prompt.",
    });
    insertCommandPair({ db, thread, seq });
    seq += 2;
    // Interim assistant message: folded into the completed turn's summary, so
    // it must NOT surface as an outline item.
    insertAssistantMessage({ db, thread, seq, text: "Interim thoughts." });
    seq += 1;
    insertCommandPair({ db, thread, seq });
    seq += 2;
    insertAssistantMessage({ db, thread, seq, text: "First final answer." });
    insertTurnCompleted({ db, thread, seq: seq + 1 });
    seq += 2;

    seq = insertTurnScaffold({
      db,
      thread,
      requestValue: 2,
      startSeq: seq,
      turnId: "turn-2",
      promptText: "Second prompt.",
    });
    insertCommandPair({ db, thread, seq, turnId: "turn-2" });
    seq += 2;
    insertAssistantMessage({
      db,
      thread,
      seq,
      text: "Second final answer.",
      turnId: "turn-2",
    });
    insertTurnCompleted({ db, thread, seq: seq + 1, turnId: "turn-2" });

    const outline = buildThreadConversationOutline(db, thread, {
      maxSeq: getLatestThreadSequence(db, { threadId: thread.id }),
    });
    const timelineConversationRows = latestTimelineRows(db, thread).filter(
      (row) => row.kind === "conversation",
    );

    expect(outline.items.map((item) => item.id)).toEqual(
      timelineConversationRows.map((row) => row.id),
    );
    expect(outline.items.map((item) => item.preview)).toEqual([
      "First prompt.",
      "First final answer.",
      "Second prompt.",
      "Second final answer.",
    ]);
  });
});
