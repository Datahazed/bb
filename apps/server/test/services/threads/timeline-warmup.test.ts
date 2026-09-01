import { describe, expect, it } from "vitest";
import {
  encodeClientTurnRequestIdNumber,
  threadScope,
  turnScope,
} from "@bb/domain";
import type { Thread } from "@bb/domain";
import { getThreadTimelineCheckpointRecord, insertEvents } from "@bb/db";
import type { DbConnection, DbNotifier } from "@bb/db";
import { withTestHarness } from "../../helpers/test-app.js";
import { seedThreadFixture } from "../../helpers/seed.js";
import { warmLargeThreadTimelines } from "../../../src/services/threads/timeline-warmup.js";

const providerThreadId = "provider-root";
const execution = {
  model: "gpt-5",
  serviceTier: "default",
  reasoningLevel: "medium",
  permissionMode: "full",
  source: "client/turn/requested",
} as const;

function seedTurns(
  db: DbConnection,
  hub: DbNotifier,
  thread: Thread,
  turnCount: number,
  itemsPerTurn: number,
): void {
  const events: Parameters<typeof insertEvents>[2] = [];
  let sequence = 0;
  for (let turn = 1; turn <= turnCount; turn += 1) {
    const turnId = `turn-${turn}`;
    const clientRequestId = encodeClientTurnRequestIdNumber({ value: turn });
    events.push({
      threadId: thread.id,
      sequence: (sequence += 1),
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
        input: [{ type: "text", text: `User ${turn}`, mentions: [] }],
        target: turn === 1 ? { kind: "thread-start" } : { kind: "new-turn" },
        execution,
      }),
    });
    events.push({
      threadId: thread.id,
      sequence: (sequence += 1),
      type: "turn/started",
      scope: turnScope(turnId),
      providerThreadId,
      itemId: null,
      itemKind: null,
      parentToolCallId: null,
      data: JSON.stringify({}),
    });
    events.push({
      threadId: thread.id,
      sequence: (sequence += 1),
      type: "turn/input/accepted",
      scope: turnScope(turnId),
      providerThreadId,
      itemId: null,
      itemKind: null,
      parentToolCallId: null,
      data: JSON.stringify({ clientRequestId }),
    });
    for (let item = 0; item < itemsPerTurn; item += 1) {
      events.push({
        threadId: thread.id,
        sequence: (sequence += 1),
        type: "item/completed",
        scope: turnScope(turnId),
        providerThreadId,
        itemId: `${turnId}-item-${item}`,
        itemKind: "agentMessage",
        parentToolCallId: null,
        data: JSON.stringify({
          item: {
            type: "agentMessage",
            id: `${turnId}-item-${item}`,
            text: `Turn ${turn} item ${item}`,
          },
        }),
      });
    }
    events.push({
      threadId: thread.id,
      sequence: (sequence += 1),
      type: "turn/completed",
      scope: turnScope(turnId),
      providerThreadId,
      itemId: null,
      itemKind: null,
      parentToolCallId: null,
      data: JSON.stringify({ status: "completed", providerThreadId }),
    });
  }
  insertEvents(db, hub, events);
}

describe("timeline warmup", () => {
  it("projects and persists large settled threads ahead of any request", async () => {
    await withTestHarness(async (harness) => {
      const large = seedThreadFixture(harness, { thread: { status: "idle" } });
      const small = seedThreadFixture(harness, { thread: { status: "idle" } });
      seedTurns(harness.deps.db, harness.deps.hub, large.thread, 10, 120);
      seedTurns(harness.deps.db, harness.deps.hub, small.thread, 2, 5);

      await warmLargeThreadTimelines(harness.deps);

      const persisted = getThreadTimelineCheckpointRecord(
        harness.deps.db,
        large.thread.id,
      );
      expect(persisted).not.toBeNull();
      expect(persisted?.eventCount).toBe(10 * 124);
      expect(
        getThreadTimelineCheckpointRecord(harness.deps.db, small.thread.id),
      ).toBeNull();
    });
  }, 30_000);
});
