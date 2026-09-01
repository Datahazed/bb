import { describe, expect, it } from "vitest";
import type {
  TimelineRow,
  TimelineSystemRow,
  TimelineUserConversationRow,
} from "@bb/server-contract";
import { paginateTimelineRows } from "../../../src/services/threads/timeline-pagination.js";

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
    turnRequest: { isGrouped: false, kind: "message", status: "accepted" },
  };
}

function systemRow(args: { id: string; seq: number }): TimelineSystemRow {
  return {
    id: args.id,
    threadId: "thread-1",
    turnId: null,
    sourceSeqStart: args.seq,
    sourceSeqEnd: args.seq,
    startedAt: args.seq,
    createdAt: args.seq,
    kind: "system",
    systemKind: "debug",
    title: "system",
    detail: null,
    status: null,
  };
}

describe("paginateTimelineRows", () => {
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

    const page = paginateTimelineRows({
      page: { kind: "latest", segmentLimit: 2 },
      rows,
    });

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

  it("walks every page and recombines to the full row list", () => {
    const rows: TimelineRow[] = [
      systemRow({ id: "thread-1:op:prelude", seq: 1 }),
      userRow({ id: "thread-1:user-seed:2", seq: 2, text: "one" }),
      systemRow({ id: "thread-1:op:mid", seq: 3 }),
      userRow({ id: "thread-1:user-seed:4", seq: 4, text: "two" }),
      userRow({ id: "thread-1:user-seed:5", seq: 5, text: "three" }),
      userRow({ id: "thread-1:user-seed:6", seq: 6, text: "four" }),
    ];

    const collected: TimelineRow[][] = [];
    let page = paginateTimelineRows({
      page: { kind: "latest", segmentLimit: 2 },
      rows,
    });
    collected.push(page.rows);
    while (page.hasOlderRows && page.olderCursor !== null) {
      page = paginateTimelineRows({
        page: {
          kind: "older",
          segmentLimit: 2,
          beforeCursor: page.olderCursor,
        },
        rows,
      });
      collected.push(page.rows);
    }

    expect(collected.length).toBe(3);
    expect(collected.reverse().flat()).toEqual(rows);
  });

  it("rejects a cursor that names no current segment", () => {
    const rows: TimelineRow[] = [
      userRow({ id: "thread-1:user-seed:1", seq: 1, text: "one" }),
      userRow({ id: "thread-1:user-seed:2", seq: 2, text: "two" }),
    ];

    expect(() =>
      paginateTimelineRows({
        page: {
          kind: "older",
          segmentLimit: 2,
          beforeCursor: { anchorId: "thread-1:user-seed:9", anchorSeq: 9 },
        },
        rows,
      }),
    ).toThrowError("Timeline pagination cursor is no longer available");
  });

  it("returns an empty page for a cursor at the oldest segment", () => {
    const rows: TimelineRow[] = [
      userRow({ id: "thread-1:user-seed:1", seq: 1, text: "one" }),
      userRow({ id: "thread-1:user-seed:2", seq: 2, text: "two" }),
    ];

    const page = paginateTimelineRows({
      page: {
        kind: "older",
        segmentLimit: 2,
        beforeCursor: { anchorId: "thread-1:user-seed:1", anchorSeq: 1 },
      },
      rows,
    });

    expect(page.rows).toEqual([]);
    expect(page.hasOlderRows).toBe(false);
    expect(page.olderCursor).toBeNull();
  });
});
