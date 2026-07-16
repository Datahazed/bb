import { describe, expect, it } from "vitest";
import type { TimelineRow } from "@bb/server-contract";
import { paginateTimelineTurnDetails } from "../../../src/services/threads/timeline-turn-details-pagination.js";

function assistantRow(index: number): TimelineRow {
  return {
    id: `assistant-${index}`,
    threadId: "thread-1",
    turnId: "turn-1",
    sourceSeqStart: index,
    sourceSeqEnd: index,
    startedAt: index,
    createdAt: index,
    kind: "conversation",
    role: "assistant",
    text: `message ${index}`,
    attachments: null,
    turnRequest: null,
  };
}

describe("paginateTimelineTurnDetails", () => {
  it("uses only the exact raw-event continuation boundary", () => {
    const rows = Array.from({ length: 125 }, (_, index) =>
      assistantRow(index + 1),
    );
    const eventWindowOlderCursor = {
      anchorId: "timeline-event-window:event-10",
      anchorSeq: 10,
    };

    expect(
      paginateTimelineTurnDetails(rows, { eventWindowOlderCursor }),
    ).toEqual({
      hasOlderRows: true,
      olderCursor: eventWindowOlderCursor,
      rows,
    });
  });

  it("keeps the raw event cursor when context filtering empties a page", () => {
    const eventWindowOlderCursor = {
      anchorId: "timeline-event-window:event-10",
      anchorSeq: 10,
    };
    expect(paginateTimelineTurnDetails([], { eventWindowOlderCursor })).toEqual(
      {
        hasOlderRows: true,
        olderCursor: eventWindowOlderCursor,
        rows: [],
      },
    );
  });
});
