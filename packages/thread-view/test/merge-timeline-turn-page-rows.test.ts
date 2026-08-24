import type {
  TimelineCommandWorkRow,
  TimelineTurnRow,
} from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import {
  coalesceTimelineTurnPageRows,
  mergeTimelineTurnPageRows,
} from "../src/merge-timeline-turn-page-rows.js";

function command(id: string, sequence: number): TimelineCommandWorkRow {
  return {
    id,
    threadId: "thread-1",
    turnId: "turn-1",
    sourceSeqStart: sequence,
    sourceSeqEnd: sequence,
    startedAt: sequence,
    createdAt: sequence,
    kind: "work",
    workKind: "command",
    status: "completed",
    callId: id,
    command: id,
    cwd: null,
    source: null,
    output: "",
    exitCode: 0,
    completedAt: sequence,
    approvalStatus: null,
    activityIntents: [],
  };
}

function fragment(args: {
  children?: TimelineCommandWorkRow[];
  end: number;
  start: number;
  summaryCount: number;
}): TimelineTurnRow {
  return {
    id: "thread-1:turn-1:turn",
    threadId: "thread-1",
    turnId: "turn-1",
    sourceSeqStart: args.start,
    sourceSeqEnd: args.end,
    startedAt: 1_000,
    createdAt: 9_000,
    kind: "turn",
    status: "completed",
    summaryCount: args.summaryCount,
    completedAt: 9_000,
    children: args.children ?? null,
    detailSegments: [
      {
        sourceSeqStart: args.start,
        sourceSeqEnd: args.end,
        summaryCount: args.summaryCount,
      },
    ],
  };
}

describe("timeline turn page row merging", () => {
  it("coalesces bounded byte slices into one logical completed turn", () => {
    const older = fragment({
      children: [command("older-command", 2)],
      start: 1,
      end: 4,
      summaryCount: 2,
    });
    const newer = fragment({
      children: [command("newer-command", 7)],
      start: 5,
      end: 9,
      summaryCount: 3,
    });

    const rows = coalesceTimelineTurnPageRows([older, newer]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "thread-1:turn-1:turn",
      sourceSeqStart: 1,
      sourceSeqEnd: 9,
      startedAt: 1_000,
      completedAt: 9_000,
      summaryCount: 5,
      detailSegments: [
        { sourceSeqStart: 1, sourceSeqEnd: 4, summaryCount: 2 },
        { sourceSeqStart: 5, sourceSeqEnd: 9, summaryCount: 3 },
      ],
      children: [
        expect.objectContaining({ id: "older-command" }),
        expect.objectContaining({ id: "newer-command" }),
      ],
    });
  });

  it("replaces stale newest slices when a live byte window moves", () => {
    const loaded = mergeTimelineTurnPageRows(
      fragment({ start: 1, end: 4, summaryCount: 2 }),
      fragment({ start: 5, end: 8, summaryCount: 3 }),
    );
    const refreshedLatest = fragment({
      start: 5,
      end: 10,
      summaryCount: 5,
    });

    const merged = mergeTimelineTurnPageRows(loaded, refreshedLatest, {
      newerWindowStartSequence: 5,
    });

    expect(merged.detailSegments).toEqual([
      { sourceSeqStart: 1, sourceSeqEnd: 4, summaryCount: 2 },
      { sourceSeqStart: 5, sourceSeqEnd: 10, summaryCount: 5 },
    ]);
    expect(merged.summaryCount).toBe(7);
  });
});
