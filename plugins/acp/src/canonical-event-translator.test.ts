import { providerDriverEventSchema } from "@bb/provider-driver-contract";
import type {
  ProviderDriverEventInput,
  ProviderDriverEventEmitter,
} from "@bb/provider-driver-sdk";
import { describe, expect, it } from "vitest";
import { AcpCanonicalEventTranslator } from "./canonical-event-translator.js";

function createTranslator() {
  const inputs: ProviderDriverEventInput[] = [];
  const events: ProviderDriverEventEmitter = {
    emit: (event) => inputs.push(event),
  };
  return {
    translator: new AcpCanonicalEventTranslator({
      attachmentId: "attachment-1",
      events,
    }),
    events: () =>
      inputs.map((event, index) =>
        providerDriverEventSchema.parse({ ...event, sequence: index + 1 }),
      ),
  };
}

describe("ACP canonical event translator", () => {
  it("streams assistant and reasoning text and settles the turn", () => {
    const fixture = createTranslator();
    fixture.translator.beginTurn("turn-1");
    fixture.translator.translateUpdate({
      sessionUpdate: "agent_thought_chunk",
      content: { type: "text", text: "thinking" },
    });
    fixture.translator.translateUpdate({
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "answer" },
    });
    fixture.translator.finishTurn("end_turn");

    expect(fixture.events()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "item.delta",
          channel: "reasoning_text",
          delta: "thinking",
        }),
        expect.objectContaining({
          type: "item.delta",
          channel: "assistant_text",
          delta: "answer",
        }),
        expect.objectContaining({
          type: "turn.settled",
          turnId: "turn-1",
          outcome: "completed",
        }),
      ]),
    );
  });

  it("translates tool progress, terminal tool state, usage, and cancellation", () => {
    const fixture = createTranslator();
    fixture.translator.beginTurn("turn-1");
    fixture.translator.translateUpdate({
      sessionUpdate: "tool_call",
      toolCallId: "tool-1",
      kind: "execute",
      title: "pwd",
      rawInput: { command: "pwd" },
      status: "in_progress",
    });
    fixture.translator.translateUpdate({
      sessionUpdate: "tool_call_update",
      toolCallId: "tool-1",
      status: "completed",
      content: [{ type: "content", content: { type: "text", text: "/tmp" } }],
    });
    fixture.translator.translateUpdate({
      sessionUpdate: "usage_update",
      used: 40,
      size: 100,
    });
    fixture.translator.finishTurn("cancelled");

    expect(fixture.events()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "item.started",
          item: expect.objectContaining({ type: "commandExecution" }),
        }),
        expect.objectContaining({
          type: "item.completed",
          item: expect.objectContaining({
            type: "commandExecution",
            aggregatedOutput: "/tmp",
          }),
        }),
        expect.objectContaining({
          type: "session.context_window_usage_changed",
          contextWindowUsage: {
            usedTokens: 40,
            modelContextWindow: 100,
            estimated: false,
          },
        }),
        expect.objectContaining({
          type: "turn.settled",
          outcome: "cancelled",
        }),
      ]),
    );
  });

  it("emits compaction and file-write lifecycle events", () => {
    const fixture = createTranslator();
    fixture.translator.beginCompaction("turn-compact");
    fixture.translator.translateFsWrite({
      path: "/workspace/file.txt",
      kind: "add",
      diff: "+hello",
    });
    fixture.translator.finishCompaction({ status: "completed" });

    expect(fixture.events()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "item.completed",
          item: expect.objectContaining({ type: "fileChange" }),
        }),
        expect.objectContaining({
          type: "turn.compacted",
          turnId: "turn-compact",
        }),
        expect.objectContaining({
          type: "turn.settled",
          outcome: "completed",
        }),
      ]),
    );
  });
});
