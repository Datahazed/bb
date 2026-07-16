import { describe, expect, it } from "vitest";
import type { TimelineRow } from "@bb/server-contract";
import {
  ACTIVE_TIMELINE_TAIL_ROW_TARGET,
  collapseActiveTimelineWork,
} from "../../../src/services/threads/timeline-active-work-window.js";

function userRow(): TimelineRow {
  return {
    id: "user-1",
    threadId: "thread-1",
    turnId: "turn-1",
    sourceSeqStart: 1,
    sourceSeqEnd: 1,
    startedAt: 1,
    createdAt: 1,
    kind: "conversation",
    role: "user",
    text: "Do the long task",
    attachments: null,
    mentions: [],
    initiator: "user",
    senderThreadId: null,
    systemMessageKind: "unlabeled",
    systemMessageSubject: null,
    turnRequest: { kind: "message", status: "accepted" },
  };
}

function workRow(
  index: number,
  status: "completed" | "pending" = "completed",
): TimelineRow {
  return {
    id: `work-${index}`,
    threadId: "thread-1",
    turnId: "turn-1",
    sourceSeqStart: index + 1,
    sourceSeqEnd: index + 1,
    startedAt: index + 1,
    createdAt: index + 1,
    kind: "work",
    workKind: "command",
    status,
    callId: `call-${index}`,
    command: `command ${index}`,
    cwd: null,
    source: "agent",
    output: "",
    exitCode: status === "pending" ? null : 0,
    completedAt: status === "pending" ? null : index + 1,
    approvalStatus: null,
    activityIntents: [],
  };
}

describe("collapseActiveTimelineWork", () => {
  it("keeps the prompt and bounded live tail around a lazy pending turn row", () => {
    const work = Array.from(
      { length: ACTIVE_TIMELINE_TAIL_ROW_TARGET + 20 },
      (_, index) => workRow(index + 1),
    );
    const result = collapseActiveTimelineWork({
      rows: [userRow(), ...work],
      threadStatus: "active",
    });

    expect(result[0]?.id).toBe("user-1");
    expect(result[1]).toMatchObject({
      id: "thread-1:turn-1:active-turn:2",
      kind: "turn",
      status: "pending",
      summaryCount: 20,
    });
    expect(result.slice(2).map((row) => row.id)).toEqual(
      work.slice(-ACTIVE_TIMELINE_TAIL_ROW_TARGET).map((row) => row.id),
    );
  });

  it("keeps an old pending row without retaining its unbounded suffix", () => {
    const work = Array.from({ length: 2_000 }, (_, index) =>
      workRow(index + 1, index === 9 ? "pending" : "completed"),
    );
    const result = collapseActiveTimelineWork({
      rows: [userRow(), ...work],
      threadStatus: "active",
    });
    expect(result.some((row) => row.id === "work-10")).toBe(true);
    expect(result.length).toBeLessThanOrEqual(
      ACTIVE_TIMELINE_TAIL_ROW_TARGET + 4,
    );
    expect(result[1]).toMatchObject({ kind: "turn", summaryCount: 9 });
    expect(result[3]).toMatchObject({
      kind: "turn",
      summaryCount: 2_000 - ACTIVE_TIMELINE_TAIL_ROW_TARGET - 10,
    });
    expect(result.slice(-ACTIVE_TIMELINE_TAIL_ROW_TARGET)).toEqual(
      work.slice(-ACTIVE_TIMELINE_TAIL_ROW_TARGET),
    );
  });

  it("keeps a pinned-first row outside the leading historical gap", () => {
    const firstPending = workRow(9, "pending");
    const laterWork = Array.from(
      { length: ACTIVE_TIMELINE_TAIL_ROW_TARGET + 20 },
      (_, index) => workRow(index + 10),
    );
    const result = collapseActiveTimelineWork({
      olderEventSequence: firstPending.sourceSeqStart + 5,
      rows: [userRow(), firstPending, ...laterWork],
      threadStatus: "active",
    });
    const summaries = result.filter(
      (row): row is Extract<TimelineRow, { kind: "turn" }> =>
        row.kind === "turn",
    );

    expect(result[1]).toMatchObject({
      kind: "turn",
      sourceSeqEnd: firstPending.sourceSeqStart - 1,
      sourceSeqStart: 2,
    });
    expect(result[2]?.id).toBe(firstPending.id);
    expect(summaries[1]?.sourceSeqStart).toBeGreaterThanOrEqual(
      firstPending.sourceSeqEnd + 1,
    );
    for (let index = 1; index < result.length; index++) {
      expect(result[index]?.sourceSeqStart).toBeGreaterThan(
        result[index - 1]?.sourceSeqEnd ?? -1,
      );
    }
  });

  it("does not alter an idle timeline", () => {
    const rows = [userRow(), workRow(1)];
    expect(collapseActiveTimelineWork({ rows, threadStatus: "idle" })).toEqual(
      rows,
    );
  });
});
