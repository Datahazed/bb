import { providerDriverEventSchema } from "@bb/provider-driver-contract";
import type {
  ProviderDriverEventEmitter,
  ProviderDriverEventInput,
} from "@bb/provider-driver-sdk";
import { describe, expect, it } from "vitest";
import { CodexCanonicalEventTranslator } from "./canonical-event-translator.js";

function createTranslator(
  options: { onAccountRestartRequired?: () => void } = {},
) {
  const inputs: ProviderDriverEventInput[] = [];
  const events: ProviderDriverEventEmitter = {
    emit: (event) => inputs.push(event),
  };
  return {
    translator: new CodexCanonicalEventTranslator({
      attachmentId: "attachment-1",
      events,
      ...options,
    }),
    events: () =>
      inputs.map((event, index) =>
        providerDriverEventSchema.parse({ ...event, sequence: index + 1 }),
      ),
  };
}

describe("Codex canonical event translator", () => {
  it("maps native turn and item lifecycle onto the canonical turn id", () => {
    const fixture = createTranslator();
    fixture.translator.beginTurn("canonical-turn-1");
    fixture.translator.translate("turn/started", {
      threadId: "codex-thread-1",
      turn: {
        id: "native-turn-1",
        items: [],
        status: "inProgress",
        error: null,
      },
    });
    fixture.translator.translate("item/started", {
      threadId: "codex-thread-1",
      turnId: "native-turn-1",
      item: { type: "agentMessage", id: "message-1", text: "" },
    });
    fixture.translator.translate("item/agentMessage/delta", {
      threadId: "codex-thread-1",
      turnId: "native-turn-1",
      itemId: "message-1",
      delta: "hello",
    });
    fixture.translator.translate("item/completed", {
      threadId: "codex-thread-1",
      turnId: "native-turn-1",
      item: { type: "agentMessage", id: "message-1", text: "hello" },
    });
    fixture.translator.translate("turn/completed", {
      threadId: "codex-thread-1",
      turn: {
        id: "native-turn-1",
        items: [],
        status: "completed",
        error: null,
      },
    });

    expect(fixture.events()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "item.delta",
          turnId: "canonical-turn-1",
          channel: "assistant_text",
          delta: "hello",
        }),
        expect.objectContaining({
          type: "turn.settled",
          turnId: "canonical-turn-1",
          outcome: "completed",
          providerCheckpointId: "native-turn-1",
        }),
      ]),
    );
  });

  it("repairs normalized command output from raw response items", () => {
    const fixture = createTranslator();
    fixture.translator.beginTurn("canonical-turn-1");
    fixture.translator.translate("rawResponseItem/completed", {
      threadId: "codex-thread-1",
      turnId: "native-turn-1",
      item: {
        type: "function_call",
        name: "exec_command",
        arguments: "{}",
        call_id: "command-1",
      },
    });
    fixture.translator.translate("item/completed", {
      threadId: "codex-thread-1",
      turnId: "native-turn-1",
      item: {
        type: "commandExecution",
        id: "command-1",
        command: "printf stdout",
        cwd: "/workspace",
        processId: null,
        source: "agent",
        status: "completed",
        commandActions: [],
        aggregatedOutput: "provider wrapper output",
        exitCode: 0,
        durationMs: 1,
      },
    });
    fixture.translator.translate("rawResponseItem/completed", {
      threadId: "codex-thread-1",
      turnId: "native-turn-1",
      item: {
        type: "function_call_output",
        call_id: "command-1",
        output:
          "Chunk ID: abc\nWall time: 0.01 seconds\nProcess exited with code 0\nOutput:\nstdout\n",
      },
    });

    expect(fixture.events()).toContainEqual(
      expect.objectContaining({
        type: "item.completed",
        item: expect.objectContaining({
          type: "commandExecution",
          aggregatedOutput: "stdout\n",
        }),
      }),
    );
  });

  it("preserves streamed command output omitted from the completed item", () => {
    const fixture = createTranslator();
    fixture.translator.beginTurn("canonical-turn-1");
    fixture.translator.translate("item/started", {
      threadId: "codex-thread-1",
      turnId: "native-turn-1",
      item: {
        type: "commandExecution",
        id: "command-1",
        command: "printf output",
        cwd: "/workspace",
        processId: null,
        source: "agent",
        status: "inProgress",
        commandActions: [],
        aggregatedOutput: "",
        exitCode: null,
        durationMs: null,
      },
    });
    fixture.translator.translate("item/commandExecution/outputDelta", {
      threadId: "codex-thread-1",
      turnId: "native-turn-1",
      itemId: "command-1",
      delta: "FIRST\n",
    });
    fixture.translator.translate("item/completed", {
      threadId: "codex-thread-1",
      turnId: "native-turn-1",
      item: {
        type: "commandExecution",
        id: "command-1",
        command: "printf output",
        cwd: "/workspace",
        processId: null,
        source: "agent",
        status: "completed",
        commandActions: [],
        aggregatedOutput: "SECOND\nTHIRD\n",
        exitCode: 0,
        durationMs: 1,
      },
    });

    expect(fixture.events()).toContainEqual(
      expect.objectContaining({
        type: "item.completed",
        item: expect.objectContaining({
          type: "commandExecution",
          aggregatedOutput: "FIRST\nSECOND\nTHIRD\n",
        }),
      }),
    );
  });

  it("settles terminal account errors and requests an app-server restart", () => {
    let restartRequests = 0;
    const fixture = createTranslator({
      onAccountRestartRequired: () => {
        restartRequests += 1;
      },
    });
    fixture.translator.beginTurn("canonical-turn-1");
    fixture.translator.translate("error", {
      threadId: "codex-thread-1",
      turnId: "native-turn-1",
      error: {
        message: "401 Unauthorized",
        codexErrorInfo: null,
        additionalDetails: "Missing authentication",
      },
      willRetry: false,
    });

    expect(restartRequests).toBe(1);
    expect(fixture.translator.activeTurn).toBeNull();
    expect(fixture.events()).toContainEqual(
      expect.objectContaining({
        type: "turn.settled",
        turnId: "canonical-turn-1",
        outcome: "failed",
        error: expect.objectContaining({
          code: "codex_account_error",
          category: "authentication",
        }),
      }),
    );
  });

  it("keeps synthetic subagent lifecycle nested under the canonical parent turn", () => {
    const fixture = createTranslator();
    fixture.translator.beginTurn("canonical-turn-1");
    fixture.translator.setProviderTurnId("native-parent-turn");
    fixture.translator.translate("turn/started", {
      threadId: "codex-thread-1",
      turn: {
        id: "native-parent-turn",
        items: [],
        status: "inProgress",
        error: null,
      },
    });
    fixture.translator.translate("item/completed", {
      threadId: "codex-thread-1",
      turnId: "native-parent-turn",
      item: {
        type: "subAgentActivity",
        id: "subagent-call-1",
        kind: "started",
        agentThreadId: "agent-thread-1",
        agentPath: "/agents/reviewer",
      },
    });
    fixture.translator.translate("turn/started", {
      threadId: "codex-thread-1",
      turn: {
        id: "native-child-turn",
        items: [],
        status: "inProgress",
        error: null,
      },
    });
    fixture.translator.translate("item/completed", {
      threadId: "codex-thread-1",
      turnId: "native-child-turn",
      item: {
        type: "agentMessage",
        id: "child-message-1",
        text: "reviewed",
      },
    });
    fixture.translator.translate("turn/completed", {
      threadId: "codex-thread-1",
      turn: {
        id: "native-child-turn",
        items: [],
        status: "completed",
        error: null,
      },
    });

    expect(fixture.events()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "item.started",
          turnId: "canonical-turn-1",
          item: expect.objectContaining({
            id: "subagent-call-1",
            tool: "spawnAgent",
            status: "pending",
          }),
        }),
        expect.objectContaining({
          type: "item.completed",
          turnId: "canonical-turn-1",
          item: expect.objectContaining({
            id: "child-message-1",
            parentToolCallId: "subagent-call-1",
          }),
        }),
        expect.objectContaining({
          type: "item.completed",
          turnId: "canonical-turn-1",
          item: expect.objectContaining({
            id: "subagent-call-1",
            status: "completed",
          }),
        }),
      ]),
    );
  });

  it("settles a failed active turn exactly once when the app-server exits", () => {
    const fixture = createTranslator();
    fixture.translator.beginTurn("canonical-turn-1");
    fixture.translator.failActiveTurn("app-server crashed");
    fixture.translator.failActiveTurn("duplicate exit");

    expect(
      fixture.events().filter((event) => event.type === "turn.settled"),
    ).toEqual([
      expect.objectContaining({
        type: "turn.settled",
        turnId: "canonical-turn-1",
        outcome: "failed",
        error: expect.objectContaining({ message: "app-server crashed" }),
      }),
    ]);
  });
});
