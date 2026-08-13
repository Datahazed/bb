import { describe, expect, it } from "vitest";
import {
  ProviderDriverLifecycle,
  ProviderDriverLifecycleError,
  type ProviderDriverLifecycleErrorCode,
  providerDriverEventSchema,
} from "../src/index.js";
import {
  makeAcceptedStartResult,
  makeInitializeParams,
  makeInitializeResult,
  makeSessionOpenParams,
  makeSessionOpenResult,
  makeStartTurnParams,
} from "./fixtures.js";

function initializedLifecycle(): ProviderDriverLifecycle {
  const lifecycle = new ProviderDriverLifecycle();
  lifecycle.recordInitialized(makeInitializeParams(), makeInitializeResult());
  return lifecycle;
}

function openedLifecycle(): ProviderDriverLifecycle {
  const lifecycle = initializedLifecycle();
  lifecycle.recordSessionOpened(
    makeSessionOpenParams(),
    makeSessionOpenResult(),
  );
  return lifecycle;
}

function activeLifecycle(): ProviderDriverLifecycle {
  const lifecycle = openedLifecycle();
  lifecycle.recordTurnSubmitted(
    makeStartTurnParams(),
    makeAcceptedStartResult(),
  );
  return lifecycle;
}

function expectLifecycleError(
  work: () => void,
  code: ProviderDriverLifecycleErrorCode,
): void {
  try {
    work();
    throw new Error(`Expected lifecycle error ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(ProviderDriverLifecycleError);
    expect((error as ProviderDriverLifecycleError).code).toBe(code);
  }
}

describe("ProviderDriverLifecycle", () => {
  it("rejects work before initialization", () => {
    const lifecycle = new ProviderDriverLifecycle();
    expectLifecycleError(
      () =>
        lifecycle.recordSessionOpened(
          makeSessionOpenParams(),
          makeSessionOpenResult(),
        ),
      "not_initialized",
    );
  });

  it("validates the initialized driver identity", () => {
    const lifecycle = new ProviderDriverLifecycle();
    expectLifecycleError(
      () =>
        lifecycle.recordInitialized(makeInitializeParams(), {
          ...makeInitializeResult(),
          identity: { pluginId: "other", driverId: "pi", providerId: "pi" },
        }),
      "initialize_identity_mismatch",
    );
  });

  it("treats an identical turn submission as an idempotent replay", () => {
    const lifecycle = openedLifecycle();
    const params = makeStartTurnParams();
    const result = makeAcceptedStartResult();

    expect(lifecycle.recordTurnSubmitted(params, result)).toBe("recorded");
    expect(lifecycle.recordTurnSubmitted(params, result)).toBe("replayed");
    expect(lifecycle.snapshot().attachments).toEqual([
      {
        activeTurnId: "turn-1",
        attachmentId: "attachment-1",
        providerSessionId: "provider-session-1",
      },
    ]);
  });

  it("rejects reuse of an operation id with different semantics", () => {
    const lifecycle = openedLifecycle();
    const params = makeStartTurnParams();
    lifecycle.recordTurnSubmitted(params, makeAcceptedStartResult());

    expectLifecycleError(
      () =>
        lifecycle.recordTurnSubmitted(
          makeStartTurnParams({
            inputGroups: [[{ type: "text", text: "Different", mentions: [] }]],
          }),
          makeAcceptedStartResult(),
        ),
      "operation_conflict",
    );
  });

  it("validates host request scope against the active canonical turn", () => {
    const lifecycle = activeLifecycle();
    expect(() =>
      lifecycle.validateActiveTurnScope({
        attachmentId: "attachment-1",
        turnId: "turn-1",
      }),
    ).not.toThrow();
    expectLifecycleError(
      () =>
        lifecycle.validateActiveTurnScope({
          attachmentId: "attachment-1",
          turnId: "turn-other",
        }),
      "stale_turn",
    );
  });

  it("removes an idly discarded attachment and accepts exact replay", () => {
    const lifecycle = openedLifecycle();
    const params = {
      operationId: "operation-discard-1",
      attachmentId: "attachment-1",
      providerSessionId: "provider-session-1",
    };

    expect(lifecycle.recordSessionDiscarded(params)).toBe("recorded");
    expect(lifecycle.recordSessionDiscarded(params)).toBe("replayed");
    expect(lifecycle.snapshot().attachments).toEqual([]);
  });

  it("rejects events before the turn acceptance result", () => {
    const lifecycle = openedLifecycle();
    const event = providerDriverEventSchema.parse({
      type: "turn.settled",
      attachmentId: "attachment-1",
      sequence: 1,
      turnId: "turn-1",
      outcome: "completed",
      error: null,
      providerCheckpointId: null,
    });

    expectLifecycleError(
      () => lifecycle.recordEvent(event),
      "turn_not_accepted",
    );
    expect(lifecycle.snapshot().lastEventSequence).toBe(0);
  });

  it("rejects duplicate settlement", () => {
    const lifecycle = activeLifecycle();
    lifecycle.recordEvent(
      providerDriverEventSchema.parse({
        type: "turn.settled",
        attachmentId: "attachment-1",
        sequence: 1,
        turnId: "turn-1",
        outcome: "completed",
        error: null,
        providerCheckpointId: null,
      }),
    );

    expectLifecycleError(
      () =>
        lifecycle.recordEvent(
          providerDriverEventSchema.parse({
            type: "turn.settled",
            attachmentId: "attachment-1",
            sequence: 2,
            turnId: "turn-1",
            outcome: "completed",
            error: null,
            providerCheckpointId: null,
          }),
        ),
      "turn_already_settled",
    );
    expect(lifecycle.snapshot().lastEventSequence).toBe(1);
  });

  it("rejects an event for another attachment without consuming its sequence", () => {
    const lifecycle = activeLifecycle();
    expectLifecycleError(
      () =>
        lifecycle.recordEvent(
          providerDriverEventSchema.parse({
            type: "provider.warning",
            attachmentId: "attachment-other",
            sequence: 1,
            code: "test",
            message: "Wrong attachment",
          }),
        ),
      "unknown_attachment",
    );
    expect(lifecycle.snapshot().lastEventSequence).toBe(0);
  });

  it("requires a contiguous event sequence", () => {
    const lifecycle = activeLifecycle();
    expectLifecycleError(
      () =>
        lifecycle.recordEvent(
          providerDriverEventSchema.parse({
            type: "provider.warning",
            attachmentId: "attachment-1",
            sequence: 2,
            code: "test",
            message: "Skipped sequence one",
          }),
        ),
      "event_sequence_out_of_order",
    );
  });

  it("validates item start, delta, and completion ordering", () => {
    const lifecycle = activeLifecycle();
    lifecycle.recordEvent(
      providerDriverEventSchema.parse({
        type: "item.started",
        attachmentId: "attachment-1",
        sequence: 1,
        turnId: "turn-1",
        item: { type: "agentMessage", id: "message-1", text: "" },
      }),
    );
    expectLifecycleError(
      () =>
        lifecycle.recordEvent(
          providerDriverEventSchema.parse({
            type: "item.delta",
            attachmentId: "attachment-1",
            sequence: 2,
            turnId: "turn-1",
            itemId: "message-1",
            channel: "command_output",
            delta: "wrong channel",
            reset: false,
          }),
        ),
      "item_delta_channel_mismatch",
    );
    lifecycle.recordEvent(
      providerDriverEventSchema.parse({
        type: "item.delta",
        attachmentId: "attachment-1",
        sequence: 2,
        turnId: "turn-1",
        itemId: "message-1",
        channel: "assistant_text",
        delta: "Hello",
        reset: false,
      }),
    );
    expectLifecycleError(
      () =>
        lifecycle.recordEvent(
          providerDriverEventSchema.parse({
            type: "item.completed",
            attachmentId: "attachment-1",
            sequence: 3,
            turnId: "turn-1",
            item: {
              type: "plan",
              id: "message-1",
              text: "Wrong type",
            },
            outcome: "completed",
            error: null,
          }),
        ),
      "item_type_mismatch",
    );
    lifecycle.recordEvent(
      providerDriverEventSchema.parse({
        type: "item.completed",
        attachmentId: "attachment-1",
        sequence: 3,
        turnId: "turn-1",
        item: { type: "agentMessage", id: "message-1", text: "Hello" },
        outcome: "completed",
        error: null,
      }),
    );

    expectLifecycleError(
      () =>
        lifecycle.recordEvent(
          providerDriverEventSchema.parse({
            type: "item.delta",
            attachmentId: "attachment-1",
            sequence: 4,
            turnId: "turn-1",
            itemId: "message-1",
            channel: "assistant_text",
            delta: " late",
            reset: false,
          }),
        ),
      "item_already_completed",
    );
  });

  it("tracks background task progress across turn settlement", () => {
    const lifecycle = activeLifecycle();
    const runningTask = {
      type: "backgroundTask" as const,
      id: "task:1",
      taskType: "local_agent",
      description: "Research",
      status: "pending" as const,
      taskStatus: "running" as const,
      skipTranscript: false,
    };
    lifecycle.recordEvent(
      providerDriverEventSchema.parse({
        type: "item.started",
        attachmentId: "attachment-1",
        sequence: 1,
        turnId: "turn-1",
        item: runningTask,
      }),
    );
    lifecycle.recordEvent(
      providerDriverEventSchema.parse({
        type: "turn.settled",
        attachmentId: "attachment-1",
        sequence: 2,
        turnId: "turn-1",
        outcome: "completed",
        error: null,
        providerCheckpointId: null,
      }),
    );
    lifecycle.recordEvent(
      providerDriverEventSchema.parse({
        type: "background_task.progress",
        attachmentId: "attachment-1",
        sequence: 3,
        item: { ...runningTask, description: "Still researching" },
        turnId: null,
      }),
    );
    lifecycle.recordEvent(
      providerDriverEventSchema.parse({
        type: "background_task.completed",
        attachmentId: "attachment-1",
        sequence: 4,
        item: {
          ...runningTask,
          status: "completed",
          taskStatus: "completed",
        },
        turnId: null,
      }),
    );
  });

  it("reports accepted unsettled turns when the process exits", () => {
    const lifecycle = activeLifecycle();

    expect(lifecycle.recordConnectionExited()).toEqual({
      activeAttachments: [
        {
          activeTurnId: "turn-1",
          attachmentId: "attachment-1",
          providerSessionId: "provider-session-1",
        },
      ],
    });
    expect(lifecycle.snapshot().closed).toBe(true);
    expectLifecycleError(
      () =>
        lifecycle.recordEvent(
          providerDriverEventSchema.parse({
            type: "provider.warning",
            attachmentId: "attachment-1",
            sequence: 1,
            code: "late",
            message: "Late event",
          }),
        ),
      "connection_closed",
    );
  });
});
