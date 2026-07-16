import { describe, expect, it } from "vitest";
import type {
  TimelineRow,
  TimelineUserConversationRow,
} from "@bb/server-contract";
import {
  createTimelineEventWindowCursor,
  getTimelineEventWindowCursorPayload,
  hashTimelineTurnDetailsContextItemIds,
  paginateTimelineRows,
} from "../../../src/services/threads/timeline-pagination.js";

function userRow(args: {
  id: string;
  seq: number;
  text: string;
}): TimelineUserConversationRow {
  return {
    id: args.id,
    kind: "conversation",
    role: "user",
    threadId: "thread-1",
    turnId: "turn-1",
    sourceSeqStart: args.seq,
    sourceSeqEnd: args.seq,
    startedAt: args.seq,
    createdAt: args.seq,
    text: args.text,
    mentions: [],
    attachments: null,
    initiator: "user",
    senderThreadId: null,
    systemMessageKind: "unlabeled",
    systemMessageSubject: null,
    turnRequest: { kind: "message", status: "accepted" },
  };
}

describe("paginateTimelineRows", () => {
  it("writes canonical context item hashes into v2 turn-detail cursors", () => {
    const contextItemIdsHash = hashTimelineTurnDetailsContextItemIds([
      "context-b",
      "context-a",
      "context-a",
    ]);
    expect(contextItemIdsHash).toHaveLength(43);
    expect(contextItemIdsHash).toBe(
      hashTimelineTurnDetailsContextItemIds(["context-a", "context-b"]),
    );

    const cursor = createTimelineEventWindowCursor({
      byteTarget: 1_024,
      eventId: "event-1",
      issuedBeforeSequence: 3,
      rowLimit: 10,
      scope: {
        kind: "turn-details",
        contextItemIdsHash,
        parentToolCallId: null,
        sourceSeqEnd: 2,
        sourceSeqStart: 1,
        threadId: "thread-1",
        turnId: "turn-1",
      },
      selectionStart: 1,
      sequence: 2,
    });

    expect(getTimelineEventWindowCursorPayload(cursor)).toMatchObject({
      scope: { contextItemIdsHash, kind: "turn-details" },
      version: 2,
    });
  });

  it("keeps grouped user rows from one request in the same segment", () => {
    const rows: TimelineRow[] = [
      userRow({
        id: "thread-1:user-seed:1",
        seq: 1,
        text: "older",
      }),
      userRow({
        id: "thread-1:user-seed:2",
        seq: 2,
        text: "group first",
      }),
      userRow({
        id: "thread-1:user-seed:2-1",
        seq: 2,
        text: "group second",
      }),
      userRow({
        id: "thread-1:user-seed:3",
        seq: 3,
        text: "newer",
      }),
    ];

    const page = paginateTimelineRows(
      rows,
      {
        kind: "latest",
        segmentLimit: 2,
      },
      { eventWindowOlderCursor: null },
    );

    expect(page.rows.map((row) => row.id)).toEqual([
      "thread-1:user-seed:2",
      "thread-1:user-seed:2-1",
      "thread-1:user-seed:3",
    ]);
    expect(page.olderCursor).toEqual({
      anchorId: "thread-1:user-seed:2",
      anchorSeq: 2,
    });
  });
});
