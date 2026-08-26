import { describe, expect, it } from "vitest";
import {
  encodeClientTurnRequestIdNumber,
  threadScope,
  turnScope,
} from "@bb/domain";
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
  buildThreadTimelineWithProfile,
  buildTimelineTurnDetailsPage,
} from "../../../src/services/threads/timeline.js";

const providerThreadId = "pi-thread-1";
const PROCESS_EVENT =
  '<process_event kind="success" process_id="proc_551c">Process completed successfully</process_event>';

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
    providerId: "pi",
  });
  return { db, thread };
}

type EventInput = Parameters<typeof insertEvents>[2][number];
type EventWithoutSequence = Omit<EventInput, "sequence" | "threadId">;
type RequestId = ReturnType<typeof encodeClientTurnRequestIdNumber>;
type RequestTarget =
  | { kind: "new-turn" }
  | { kind: "thread-start" }
  | { expectedTurnId: string; kind: "steer" };

const execution = {
  model: "gpt-5",
  serviceTier: "default",
  reasoningLevel: "medium",
  permissionMode: "full",
  source: "client/turn/requested",
} as const;

function clientRequest(
  requestId: RequestId,
  text: string,
  target: RequestTarget,
  source: "spawn" | "tell" = "tell",
): EventWithoutSequence {
  return {
    type: "client/turn/requested",
    scope: threadScope(),
    itemId: null,
    itemKind: null,
    parentToolCallId: null,
    data: JSON.stringify({
      direction: "outbound",
      source,
      initiator: "user",
      request: {
        method: target.kind === "thread-start" ? "thread/start" : "turn/start",
        params: {},
      },
      requestId,
      senderThreadId: null,
      input: [{ type: "text", text, mentions: [] }],
      target,
      execution,
    }),
  };
}

function turnEvent(
  turnId: string,
  type: EventInput["type"],
  data: Record<string, unknown>,
  item?: { itemId: string; itemKind: EventInput["itemKind"] },
): EventWithoutSequence {
  return {
    type,
    scope: turnScope(turnId),
    providerThreadId,
    itemId: item?.itemId ?? null,
    itemKind: item?.itemKind ?? null,
    parentToolCallId: null,
    data: JSON.stringify(data),
  };
}

function assistant(
  turnId: string,
  itemId: string,
  text: string,
): EventWithoutSequence {
  return turnEvent(
    turnId,
    "item/completed",
    { item: { type: "agentMessage", id: itemId, text } },
    { itemId, itemKind: "agentMessage" },
  );
}

function insertSeedEvents(
  db: DbConnection,
  thread: Thread,
  events: readonly EventWithoutSequence[],
): void {
  insertEvents(
    db,
    noopNotifier,
    events.map((event, index) => ({
      ...event,
      sequence: index + 1,
      threadId: thread.id,
    })),
  );
}

/**
 * A thread the user started once, followed by a turn a Pi extension opened on
 * its own: the only `client/turn/requested` is the first message, and the
 * second turn's input is the provider-recorded `userMessage` item.
 */
function seedExtensionTriggeredTurn(db: DbConnection, thread: Thread): void {
  const clientRequestId = encodeClientTurnRequestIdNumber({ value: 1 });
  insertSeedEvents(db, thread, [
    clientRequest(
      clientRequestId,
      "Reply only with ok.",
      { kind: "thread-start" },
      "spawn",
    ),
    turnEvent("turn-1", "turn/started", {}),
    turnEvent("turn-1", "turn/input/accepted", { clientRequestId }),
    assistant("turn-1", "assistant-1", "ok"),
    turnEvent("turn-1", "turn/completed", {
      status: "completed",
      providerThreadId,
    }),
    turnEvent("turn-2", "turn/started", {}),
    turnEvent(
      "turn-2",
      "item/completed",
      {
        item: {
          type: "userMessage",
          id: "provider-input-1",
          content: [{ type: "text", text: PROCESS_EVENT }],
        },
      },
      { itemId: "provider-input-1", itemKind: "userMessage" },
    ),
    assistant("turn-2", "assistant-2", "The process finished."),
    turnEvent("turn-2", "turn/completed", {
      status: "completed",
      providerThreadId,
    }),
  ]);
}

function seedGroupedClientRequests(db: DbConnection, thread: Thread): void {
  const requestId = encodeClientTurnRequestIdNumber({ value: 1 });
  const groupedRequestId = encodeClientTurnRequestIdNumber({ value: 2 });
  insertSeedEvents(db, thread, [
    clientRequest(requestId, "First grouped message", { kind: "new-turn" }),
    clientRequest(groupedRequestId, "Second grouped message", {
      kind: "new-turn",
    }),
    turnEvent("turn-1", "turn/started", {}),
    turnEvent("turn-1", "turn/input/accepted", {
      clientRequestId: requestId,
    }),
    turnEvent("turn-1", "turn/input/accepted", {
      clientRequestId: groupedRequestId,
    }),
    turnEvent("turn-1", "turn/completed", { status: "completed" }),
  ]);
}

function seedAssistantCrossingSteer(db: DbConnection, thread: Thread): void {
  const firstRequestId = encodeClientTurnRequestIdNumber({ value: 1 });
  const steerRequestId = encodeClientTurnRequestIdNumber({ value: 2 });
  const followingRequestId = encodeClientTurnRequestIdNumber({ value: 3 });
  insertSeedEvents(db, thread, [
    clientRequest(firstRequestId, "Initial message", { kind: "new-turn" }),
    turnEvent("turn-1", "turn/started", {}),
    turnEvent("turn-1", "turn/input/accepted", {
      clientRequestId: firstRequestId,
    }),
    turnEvent(
      "turn-1",
      "item/started",
      { item: { type: "agentMessage", id: "assistant-1", text: "" } },
      { itemId: "assistant-1", itemKind: "agentMessage" },
    ),
    turnEvent(
      "turn-1",
      "item/agentMessage/delta",
      { itemId: "assistant-1", delta: "Assistant before steer" },
      { itemId: "assistant-1", itemKind: null },
    ),
    clientRequest(steerRequestId, "Steer while assistant is finishing", {
      kind: "steer",
      expectedTurnId: "turn-1",
    }),
    assistant("turn-1", "assistant-1", "Assistant before steer"),
    turnEvent("turn-1", "turn/completed", { status: "completed" }),
    clientRequest(followingRequestId, "Following message", {
      kind: "new-turn",
    }),
    turnEvent("turn-2", "turn/started", {}),
    turnEvent("turn-2", "turn/input/accepted", {
      clientRequestId: steerRequestId,
    }),
    turnEvent("turn-2", "turn/completed", { status: "completed" }),
  ]);
}

function seedDelegationCrossingHumanBoundary(
  db: DbConnection,
  thread: Thread,
): void {
  const firstRequestId = encodeClientTurnRequestIdNumber({ value: 1 });
  const followingRequestId = encodeClientTurnRequestIdNumber({ value: 2 });
  insertSeedEvents(db, thread, [
    clientRequest(firstRequestId, "Initial message", { kind: "new-turn" }),
    turnEvent("turn-1", "turn/started", {}),
    turnEvent("turn-1", "turn/input/accepted", {
      clientRequestId: firstRequestId,
    }),
    assistant("turn-1", "assistant-1", "First response"),
    turnEvent(
      "turn-1",
      "item/started",
      {
        item: {
          type: "toolCall",
          id: "delegation-1",
          tool: "Agent",
          arguments: { prompt: "Do the long task." },
          status: "pending",
        },
      },
      { itemId: "delegation-1", itemKind: "toolCall" },
    ),
    assistant("turn-1", "assistant-2", "Final response"),
    turnEvent("turn-1", "turn/completed", { status: "completed" }),
    clientRequest(followingRequestId, "Following human message", {
      kind: "new-turn",
    }),
    turnEvent(
      "turn-1",
      "item/completed",
      {
        item: {
          type: "toolCall",
          id: "delegation-1",
          tool: "Agent",
          arguments: { prompt: "Do the long task." },
          result: "",
          status: "completed",
        },
      },
      { itemId: "delegation-1", itemKind: "toolCall" },
    ),
    turnEvent("turn-2", "turn/started", {}),
    turnEvent("turn-2", "turn/input/accepted", {
      clientRequestId: followingRequestId,
    }),
    turnEvent("turn-2", "turn/completed", { status: "completed" }),
  ]);
}

function conversationTexts(rows: readonly TimelineRow[]): string[] {
  return rows.flatMap((row) => {
    if (row.kind === "conversation") {
      return [`${row.role}:${row.text}`];
    }
    if (row.kind === "turn") {
      return conversationTexts(row.children ?? []);
    }
    return [];
  });
}

describe("timeline pages with provider-recorded input", () => {
  it("uses a human boundary crossed by an owned delegation as context", () => {
    const { db, thread } = setup();
    seedDelegationCrossingHumanBoundary(db, thread);

    const { response } = buildThreadTimelineWithProfile(db, thread, {
      eventBudget: 1_000_000,
      includeProviderUnhandledOperations: false,
      includeNestedRows: false,
      maxInlineOutputChars: 32_000,
      maxSeq: 0,
      page: {
        kind: "older",
        beforeCursor: {
          anchorId: `${thread.id}:user-seed:8`,
          anchorSeq: 8,
        },
        segmentLimit: 1,
      },
    });

    expect(conversationTexts(response.rows)).toEqual([
      "user:Initial message",
      "assistant:First response",
      "assistant:Final response",
    ]);
    const details = buildTimelineTurnDetailsPage(db, thread, {
      includeProviderUnhandledOperations: false,
      sourceSeqEnd: 9,
      sourceSeqStart: 5,
      turnId: "turn-1",
    });
    expect(details.nextCursor).toBeNull();
    expect(conversationTexts(details.rows)).toEqual([]);
    expect(details.rows).toEqual([
      expect.objectContaining({
        kind: "work",
        workKind: "delegation",
        callId: "delegation-1",
      }),
    ]);
  });

  it("keeps a straddling assistant in the segment where it started", () => {
    const { db, thread } = setup();
    seedAssistantCrossingSteer(db, thread);

    const { response } = buildThreadTimelineWithProfile(db, thread, {
      eventBudget: 1_000_000,
      includeProviderUnhandledOperations: false,
      includeNestedRows: false,
      maxInlineOutputChars: 32_000,
      maxSeq: 0,
      page: {
        kind: "older",
        beforeCursor: {
          anchorId: `${thread.id}:user-seed:9`,
          anchorSeq: 9,
        },
        segmentLimit: 1,
      },
    });

    expect(conversationTexts(response.rows)).toEqual([
      "user:Steer while assistant is finishing",
    ]);
    const olderCursor = response.timelinePage.olderCursor;
    expect(olderCursor).not.toBeNull();
    if (olderCursor === null) {
      throw new Error("Expected an older timeline cursor");
    }

    const { response: olderResponse } = buildThreadTimelineWithProfile(
      db,
      thread,
      {
        eventBudget: 1_000_000,
        includeProviderUnhandledOperations: false,
        includeNestedRows: false,
        maxInlineOutputChars: 32_000,
        maxSeq: 0,
        page: {
          kind: "older",
          beforeCursor: olderCursor,
          segmentLimit: 1,
        },
      },
    );

    expect(conversationTexts(olderResponse.rows)).toEqual([
      "user:Initial message",
      "assistant:Assistant before steer",
    ]);
  });

  it("keeps a grouped message accepted when its acceptance is beyond the page", () => {
    const { db, thread } = setup();
    seedGroupedClientRequests(db, thread);

    const { response } = buildThreadTimelineWithProfile(db, thread, {
      eventBudget: 1_000_000,
      includeProviderUnhandledOperations: false,
      includeNestedRows: false,
      maxInlineOutputChars: 32_000,
      maxSeq: 0,
      page: {
        kind: "older",
        beforeCursor: {
          anchorId: `${thread.id}:user-seed:2`,
          anchorSeq: 2,
        },
        segmentLimit: 1,
      },
    });

    expect(response.rows).toEqual([
      expect.objectContaining({
        kind: "conversation",
        role: "user",
        text: "First grouped message",
        turnId: "turn-1",
        turnRequest: expect.objectContaining({ status: "accepted" }),
      }),
    ]);
  });

  it("keeps the user's earlier turn on the latest page and nests the provider input in its turn", () => {
    const { db, thread } = setup();
    seedExtensionTriggeredTurn(db, thread);

    const { response } = buildThreadTimelineWithProfile(db, thread, {
      eventBudget: 1_000_000,
      includeProviderUnhandledOperations: false,
      includeNestedRows: true,
      maxInlineOutputChars: 32_000,
      maxSeq: 0,
      page: { kind: "latest", segmentLimit: 20 },
    });

    // The page is anchored on stored `client/turn/requested` rows, of which
    // there is one. A provider input row that counted as a second anchor would
    // make the page drop the first turn and report nothing older to load.
    expect(response.timelinePage).toEqual({
      kind: "latest",
      segmentLimit: 20,
      returnedSegmentCount: 1,
      hasOlderRows: false,
      olderCursor: null,
    });
    expect(conversationTexts(response.rows)).toEqual([
      "user:Reply only with ok.",
      "assistant:ok",
      `user:${PROCESS_EVENT}`,
      "assistant:The process finished.",
    ]);
    const turnRow = response.rows.find(
      (row) => row.kind === "turn" && row.turnId === "turn-2",
    );
    expect(turnRow?.kind === "turn" ? turnRow.children : undefined).toEqual([
      expect.objectContaining({
        kind: "conversation",
        role: "user",
        initiator: "system",
        turnRequest: { isGrouped: false, kind: "steer", status: "accepted" },
        text: PROCESS_EVENT,
      }),
    ]);
  });
});
