import { describe, expect, it } from "vitest";
import type { ThreadEventRow } from "@bb/domain";
import type { TimelineRow, TimelineTurnRow } from "@bb/server-contract";
import {
  buildThreadTimelineFromEvents,
  buildThreadTimelineTurnWorkPageFromEvents,
} from "../src/index.js";
import { EMPTY_ACCEPTED_CLIENT_REQUEST_CONTEXT } from "../src/accepted-client-request-context.js";
import {
  createTimelineEventFactory,
  fromRows,
} from "./timeline-test-harness.js";

const BASE_OPTIONS = {
  includeDebugRawEvents: false,
  includeNestedRows: false,
  includeProviderUnhandledOperations: false,
  isLatestPage: true,
  threadStatus: "active" as const,
  threadName: "",
  turnMessageDetail: "summary" as const,
  workspaceRoot: null,
};

interface CommandPairArgs {
  seq: number;
}

function buildTimelineRowsFromEvents(
  rows: ThreadEventRow[],
  overrides: Partial<Parameters<typeof buildThreadTimelineFromEvents>[0]["options"]> = {},
): TimelineRow[] {
  return buildThreadTimelineFromEvents({
    acceptedClientRequestContext: EMPTY_ACCEPTED_CLIENT_REQUEST_CONTEXT,
    contextWindowEvents: [],
    events: fromRows(rows),
    options: { ...BASE_OPTIONS, ...overrides },
  }).rows;
}

function turnRows(rows: TimelineRow[]): TimelineTurnRow[] {
  return rows.filter((row): row is TimelineTurnRow => row.kind === "turn");
}

function commandRowCommands(rows: TimelineRow[]): string[] {
  return rows.flatMap((row) =>
    row.kind === "work" && row.workKind === "command" ? [row.command] : [],
  );
}

describe("active-turn partial collapse", () => {
  const event = () => createTimelineEventFactory({ threadId: "thread-1" });

  function commandPair(
    factory: ReturnType<typeof createTimelineEventFactory>,
    { seq }: CommandPairArgs,
  ): ThreadEventRow[] {
    return [
      factory.commandStarted({
        seq,
        itemId: `cmd-${seq}`,
        command: `echo ${seq}`,
      }),
      factory.commandCompleted({
        seq: seq + 1,
        itemId: `cmd-${seq}`,
        command: `echo ${seq}`,
        aggregatedOutput: `out ${seq}`,
        exitCode: 0,
      }),
    ];
  }

  function activeTurnEvents(factory: ReturnType<typeof createTimelineEventFactory>): ThreadEventRow[] {
    return [
      factory.clientTurnRequested({
        seq: 1,
        requestId: "creq_23456789ab",
        text: "do the work",
      }),
      factory.turnStarted({ seq: 2 }),
      factory.inputAccepted({ seq: 3, clientRequestId: "creq_23456789ab" }),
      // A long-running command that never completes: settled-ness, not
      // sequence position, must decide visibility.
      factory.commandStarted({
        seq: 8,
        itemId: "cmd-pending",
        command: "sleep infinity",
      }),
      ...commandPair(factory, { seq: 10 }),
      ...commandPair(factory, { seq: 12 }),
      ...commandPair(factory, { seq: 14 }),
      ...commandPair(factory, { seq: 16 }),
      ...commandPair(factory, { seq: 18 }),
    ];
  }

  it("collapses settled work at or before the frontier into a partial turn row", () => {
    const factory = event();
    const rows = buildTimelineRowsFromEvents(activeTurnEvents(factory), {
      activeTurnCollapseFrontiers: new Map([["turn-1", 15]]),
    });

    const [partialRow] = turnRows(rows);
    expect(partialRow).toBeDefined();
    expect(partialRow.partial).toBe(true);
    expect(partialRow.status).toBe("pending");
    expect(partialRow.summaryCount).toBe(3);
    expect(partialRow.sourceSeqStart).toBe(10);
    expect(partialRow.sourceSeqEnd).toBe(15);
    expect(partialRow.completedAt).toBe(15);
    expect(partialRow.children).toBeNull();

    // Collapsed commands are gone from the flat rows; newer work and the
    // still-running command stay visible.
    const visibleCommands = commandRowCommands(rows);
    expect(visibleCommands).toEqual([
      "sleep infinity",
      "echo 16",
      "echo 18",
    ]);
  });

  it("keeps the summary row id stable across the completion transition", () => {
    const partialFactory = event();
    const partialRows = buildTimelineRowsFromEvents(
      activeTurnEvents(partialFactory),
      {
        activeTurnCollapseFrontiers: new Map([["turn-1", 15]]),
      },
    );
    const [partialRow] = turnRows(partialRows);

    const completedFactory = event();
    const completedRows = buildTimelineRowsFromEvents([
      ...activeTurnEvents(completedFactory),
      completedFactory.assistantCompleted({
        seq: 40,
        itemId: "assistant-final",
        text: "All done.",
      }),
      completedFactory.turnCompleted({ seq: 41 }),
    ]);
    const [completedRow] = turnRows(completedRows);

    expect(completedRow).toBeDefined();
    expect(completedRow.id).toBe(partialRow.id);
    expect(completedRow.partial).toBe(false);
    expect(completedRow.status).toBe("completed");
    // The completed summary now covers the whole turn's work.
    expect(completedRow.summaryCount).toBeGreaterThan(
      partialRow.summaryCount,
    );
  });

  it("emits no partial row when nothing settled sits below the frontier", () => {
    const factory = event();
    const rows = buildTimelineRowsFromEvents(activeTurnEvents(factory), {
      // Frontier below every message's end: the settled prefix is empty, so
      // no "Worked so far" row may appear (a bogus one would double-count the
      // flat rows below it).
      activeTurnCollapseFrontiers: new Map([["turn-1", 9]]),
    });
    expect(turnRows(rows)).toEqual([]);
    expect(commandRowCommands(rows)).toHaveLength(6);
  });

  it("renders flat rows when no frontier is provided", () => {
    const rows = buildTimelineRowsFromEvents(activeTurnEvents(event()));
    expect(turnRows(rows)).toEqual([]);
    expect(commandRowCommands(rows)).toHaveLength(6);
  });

  it("ignores frontiers for other turns", () => {
    const rows = buildTimelineRowsFromEvents(activeTurnEvents(event()), {
      activeTurnCollapseFrontiers: new Map([["turn-other", 15]]),
    });
    expect(turnRows(rows)).toEqual([]);
  });
});

describe("buildThreadTimelineTurnWorkPageFromEvents", () => {
  const pageOptions = {
    includeProviderUnhandledOperations: false,
    threadStatus: "active" as const,
    threadName: "",
    turnId: "turn-1",
    workspaceRoot: null,
  };

  it("returns summary children for a window that includes the turn completion", () => {
    const factory = createTimelineEventFactory({ threadId: "thread-1" });
    const rows = buildThreadTimelineTurnWorkPageFromEvents({
      events: fromRows([
        factory.clientTurnRequested({
          seq: 1,
          requestId: "creq_23456789ab",
          text: "do the work",
        }),
        factory.turnStarted({ seq: 2 }),
        factory.inputAccepted({ seq: 3, clientRequestId: "creq_23456789ab" }),
        factory.commandStarted({
          seq: 10,
          itemId: "cmd-10",
          command: "echo 10",
        }),
        factory.commandCompleted({
          seq: 11,
          itemId: "cmd-10",
          command: "echo 10",
          aggregatedOutput: "out",
          exitCode: 0,
        }),
        factory.assistantCompleted({
          seq: 20,
          itemId: "assistant-final",
          text: "All done.",
        }),
        factory.turnCompleted({ seq: 21 }),
      ]),
      options: { ...pageOptions, turnFinished: true },
    });

    expect(commandRowCommands(rows)).toEqual(["echo 10"]);
    // The terminal response and the user prompt render in the main timeline,
    // never inside the work expansion.
    expect(rows.some((row) => row.kind === "conversation")).toBe(false);
  });

  it("projects a completed item fully from a window missing its start event", () => {
    const factory = createTimelineEventFactory({ threadId: "thread-1" });
    const rows = buildThreadTimelineTurnWorkPageFromEvents({
      events: fromRows([
        factory.turnStarted({ seq: 2 }),
        factory.commandCompleted({
          seq: 11,
          itemId: "cmd-10",
          command: "echo 10",
          aggregatedOutput: "straddled output",
          exitCode: 0,
        }),
      ]),
      options: { ...pageOptions, turnFinished: true },
    });

    const commandRow = rows.find(
      (row): row is Extract<TimelineRow, { kind: "work"; workKind: "command" }> =>
        row.kind === "work" && row.workKind === "command",
    );
    expect(commandRow).toBeDefined();
    expect(commandRow?.command).toBe("echo 10");
    expect(commandRow?.output).toBe("straddled output");
    expect(commandRow?.status).toBe("completed");
  });

  it("drops pending work from a running turn's window and finalizes it for a finished turn", () => {
    const factory = createTimelineEventFactory({ threadId: "thread-1" });
    const windowEvents = [
      factory.turnStarted({ seq: 2 }),
      factory.commandStarted({
        seq: 8,
        itemId: "cmd-pending",
        command: "sleep infinity",
      }),
      factory.commandStarted({
        seq: 10,
        itemId: "cmd-10",
        command: "echo 10",
      }),
      factory.commandCompleted({
        seq: 11,
        itemId: "cmd-10",
        command: "echo 10",
        aggregatedOutput: "out",
        exitCode: 0,
      }),
    ];

    const runningRows = buildThreadTimelineTurnWorkPageFromEvents({
      events: fromRows(windowEvents),
      options: { ...pageOptions, turnFinished: false },
    });
    expect(commandRowCommands(runningRows)).toEqual(["echo 10"]);

    const finishedFactory = createTimelineEventFactory({
      threadId: "thread-1",
    });
    const finishedRows = buildThreadTimelineTurnWorkPageFromEvents({
      events: fromRows([
        finishedFactory.turnStarted({ seq: 2 }),
        finishedFactory.commandStarted({
          seq: 8,
          itemId: "cmd-pending",
          command: "sleep infinity",
        }),
        finishedFactory.commandStarted({
          seq: 10,
          itemId: "cmd-10",
          command: "echo 10",
        }),
        finishedFactory.commandCompleted({
          seq: 11,
          itemId: "cmd-10",
          command: "echo 10",
          aggregatedOutput: "out",
          exitCode: 0,
        }),
      ]),
      options: { ...pageOptions, turnFinished: true },
    });
    const pendingRow = finishedRows.find(
      (row) =>
        row.kind === "work" &&
        row.workKind === "command" &&
        row.command === "sleep infinity",
    );
    expect(pendingRow).toBeDefined();
    expect(pendingRow?.kind === "work" && pendingRow.status).toBe(
      "interrupted",
    );
  });
});
