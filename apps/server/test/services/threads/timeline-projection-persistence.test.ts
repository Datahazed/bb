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
  getThreadTimelineProjectionRecord,
  insertEvents,
  migrate,
  noopNotifier,
  upsertHost,
  upsertThreadTimelineProjectionRecord,
} from "@bb/db";
import type { DbConnection } from "@bb/db";
import { buildThreadTimeline } from "../../../src/services/threads/timeline.js";
import { clearTimelineProjectionCacheForThreads } from "../../../src/services/threads/timeline-projection-cache.js";

const providerThreadId = "provider-root";
const execution = {
  model: "gpt-5",
  serviceTier: "default",
  reasoningLevel: "medium",
  permissionMode: "full",
  source: "client/turn/requested",
} as const;

function requestId(value: number): ClientTurnRequestId {
  return encodeClientTurnRequestIdNumber({ value });
}

function setup(): { db: DbConnection; thread: Thread } {
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
    status: "idle",
  });
  return { db, thread };
}

/** Seeds enough events to cross PERSISTED_PROJECTION_MIN_EVENT_ROWS. */
function seedLargeThread(db: DbConnection, thread: Thread): void {
  const events: Parameters<typeof insertEvents>[2] = [];
  let sequence = 0;
  for (let turn = 1; turn <= 20; turn += 1) {
    const turnId = `turn-${turn}`;
    const clientRequestId = requestId(turn);
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
    for (let item = 0; item < 160; item += 1) {
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
  insertEvents(db, noopNotifier, events);
}

const buildOptions = {
  includeProviderUnhandledOperations: false,
  includeNestedRows: false,
  maxInlineOutputChars: 32_000,
  maxSeq: 0,
  page: { kind: "latest", segmentLimit: 20 } as const,
};

describe("persisted timeline projections", () => {

  it("persists an expensive idle build and serves it after a restart", () => {
    const { db, thread } = setup();
    seedLargeThread(db, thread);

    const built = buildThreadTimeline(db, thread, {
      ...buildOptions,
      appVersion: "1.2.3",
    });
    const record = getThreadTimelineProjectionRecord(db, thread.id);
    expect(record).not.toBeNull();
    expect(record?.projectionKey.startsWith("1.2.3|")).toBe(true);

    // Prove the read path: tamper with the persisted payload, clear the
    // in-memory cache (a restart), and observe the tampered rows served.
    const payload = JSON.parse(record!.payloadJson) as {
      timeline: { rows: unknown[] };
    };
    const marker = { ...(payload.timeline.rows.at(-1) as object) } as Record<
      string,
      unknown
    >;
    marker.id = "persisted-marker-row";
    payload.timeline.rows = [...payload.timeline.rows, marker];
    upsertThreadTimelineProjectionRecord(db, {
      payloadJson: JSON.stringify(payload),
      projectionKey: record!.projectionKey,
      threadId: thread.id,
    });
    clearTimelineProjectionCacheForThreads([thread.id]);

    const reserved = buildThreadTimeline(db, thread, {
      ...buildOptions,
      appVersion: "1.2.3",
    });
    expect(reserved.rows.some((row) => row.id === "persisted-marker-row")).toBe(
      true,
    );

    // A different release ignores the stale record and rebuilds fresh.
    clearTimelineProjectionCacheForThreads([thread.id]);
    const rebuilt = buildThreadTimeline(db, thread, {
      ...buildOptions,
      appVersion: "1.2.4",
    });
    expect(rebuilt.rows.some((row) => row.id === "persisted-marker-row")).toBe(
      false,
    );
    expect(rebuilt.rows).toEqual(built.rows);
  });

  it("does not persist without an app version", () => {
    const { db, thread } = setup();
    seedLargeThread(db, thread);

    buildThreadTimeline(db, thread, buildOptions);
    expect(getThreadTimelineProjectionRecord(db, thread.id)).toBeNull();
  });
});
