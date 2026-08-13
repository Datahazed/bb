import { providerDriverEventSchema } from "@bb/provider-driver-contract";
import { describe, expect, it } from "vitest";
import { projectProviderDriverEvent } from "./canonical-event-projector.js";

function project(event: ReturnType<typeof providerDriverEventSchema.parse>) {
  return projectProviderDriverEvent({
    bbThreadId: "thread-1",
    providerSessionId: "provider-session-1",
    event,
  });
}

describe("projectProviderDriverEvent", () => {
  it("projects rich item payloads and streaming channels", () => {
    expect(
      project(
        providerDriverEventSchema.parse({
          type: "item.started",
          attachmentId: "attachment-1",
          sequence: 1,
          turnId: "turn-1",
          item: {
            type: "commandExecution",
            id: "command-1",
            command: "pnpm test",
            cwd: "/workspace",
            status: "pending",
            approvalStatus: null,
          },
        }),
      ),
    ).toEqual([
      {
        type: "item/started",
        threadId: "thread-1",
        providerThreadId: "provider-session-1",
        scope: { kind: "turn", turnId: "turn-1" },
        item: {
          type: "commandExecution",
          id: "command-1",
          command: "pnpm test",
          cwd: "/workspace",
          status: "pending",
          approvalStatus: null,
        },
      },
    ]);

    expect(
      project(
        providerDriverEventSchema.parse({
          type: "item.delta",
          attachmentId: "attachment-1",
          sequence: 2,
          turnId: "turn-1",
          itemId: "command-1",
          channel: "command_output",
          delta: "passed\n",
          reset: true,
        }),
      ),
    ).toEqual([
      {
        type: "item/commandExecution/outputDelta",
        threadId: "thread-1",
        providerThreadId: "provider-session-1",
        scope: { kind: "turn", turnId: "turn-1" },
        itemId: "command-1",
        delta: "passed\n",
        reset: true,
      },
    ]);

    expect(
      project(
        providerDriverEventSchema.parse({
          type: "item.completed",
          attachmentId: "attachment-1",
          sequence: 3,
          turnId: "turn-1",
          item: {
            type: "commandExecution",
            id: "command-1",
            command: "pnpm test",
            cwd: "/workspace",
            status: "completed",
            approvalStatus: null,
            aggregatedOutput: "passed\n",
            exitCode: 0,
          },
          outcome: "completed",
          error: null,
        }),
      ),
    ).toMatchObject([
      {
        type: "item/completed",
        item: {
          id: "command-1",
          status: "completed",
          aggregatedOutput: "passed\n",
        },
      },
    ]);
  });

  it("projects one classified failed settlement and terminal turn fact", () => {
    expect(
      project(
        providerDriverEventSchema.parse({
          type: "turn.settled",
          attachmentId: "attachment-1",
          sequence: 1,
          turnId: "turn-1",
          outcome: "failed",
          error: {
            code: "pi-rate-limit",
            category: "rate_limit",
            message: "Usage limit reached",
            detail: "Try tomorrow",
            retry: {
              disposition: "after",
              retryAt: "2030-01-01T00:00:00.000Z",
            },
          },
          providerCheckpointId: "checkpoint-1",
        }),
      ),
    ).toEqual([
      {
        type: "provider/error",
        threadId: "thread-1",
        providerThreadId: "provider-session-1",
        scope: { kind: "turn", turnId: "turn-1" },
        message: "Usage limit reached",
        detail: "Try tomorrow",
        errorInfo: {
          category: "rate-limit",
          providerCode: "pi-rate-limit",
          httpStatusCode: null,
        },
      },
      {
        type: "turn/completed",
        threadId: "thread-1",
        providerThreadId: "provider-session-1",
        scope: { kind: "turn", turnId: "turn-1" },
        status: "failed",
        error: { message: "Usage limit reached" },
        providerCheckpointId: "checkpoint-1",
      },
    ]);
  });

  it("uses valid turn and thread scopes for usage and compaction", () => {
    const tokenUsage = {
      total: {
        totalTokens: 10,
        inputTokens: 6,
        cachedInputTokens: 1,
        outputTokens: 3,
        reasoningOutputTokens: 0,
      },
      last: {
        totalTokens: 10,
        inputTokens: 6,
        cachedInputTokens: 1,
        outputTokens: 3,
        reasoningOutputTokens: 0,
      },
      modelContextWindow: 100,
    };
    expect(
      project(
        providerDriverEventSchema.parse({
          type: "turn.token_usage_changed",
          attachmentId: "attachment-1",
          sequence: 1,
          turnId: "turn-1",
          tokenUsage,
        }),
      ),
    ).toMatchObject([
      {
        type: "thread/tokenUsage/updated",
        scope: { kind: "turn", turnId: "turn-1" },
        tokenUsage,
      },
    ]);
    expect(
      project(
        providerDriverEventSchema.parse({
          type: "session.context_window_usage_changed",
          attachmentId: "attachment-1",
          sequence: 2,
          contextWindowUsage: {
            usedTokens: 10,
            modelContextWindow: 100,
            estimated: false,
          },
        }),
      ),
    ).toMatchObject([
      {
        type: "thread/contextWindowUsage/updated",
        scope: { kind: "thread" },
      },
    ]);
    expect(
      project(
        providerDriverEventSchema.parse({
          type: "turn.compacted",
          attachmentId: "attachment-1",
          sequence: 3,
          turnId: "turn-1",
        }),
      ),
    ).toMatchObject([
      {
        type: "thread/compacted",
        scope: { kind: "turn", turnId: "turn-1" },
      },
    ]);
  });
});
