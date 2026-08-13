import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  providerDriverEventSchema,
  type ProviderDriverEvent,
} from "@bb/provider-driver-contract";
import type {
  ProviderDriverEventEmitter,
  ProviderDriverEventInput,
} from "@bb/provider-driver-sdk";
import { describe, expect, it } from "vitest";
import { PiCanonicalEventTranslator } from "./canonical-event-translator.js";

const fixtureDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../__fixtures__/pi",
);

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(resolve(fixtureDirectory, name), "utf8"));
}

function fixtureRecord(name: string): Record<string, unknown> {
  const value = fixture(name);
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Expected object fixture ${name}`);
  }
  return Object.fromEntries(Object.entries(value));
}

function createTranslator() {
  const inputs: ProviderDriverEventInput[] = [];
  const emitter: ProviderDriverEventEmitter = {
    emit: (event) => inputs.push(event),
  };
  const translator = new PiCanonicalEventTranslator({
    attachmentId: "attachment-1",
    bbThreadId: "thread-1",
    events: emitter,
  });
  const events = (): ProviderDriverEvent[] =>
    inputs.map((event, index) =>
      providerDriverEventSchema.parse({ ...event, sequence: index + 1 }),
    );
  return { events, translator };
}

describe("PiCanonicalEventTranslator", () => {
  it("projects Pi assistant completion into rich canonical items and settlement", () => {
    const { events, translator } = createTranslator();
    translator.beginTurn("turn-1");
    translator.translateSdkEvent(fixture("agent-start.json"));
    translator.translateSdkEvent({
      ...fixtureRecord("agent-end-with-message.json"),
      providerCheckpointId: "checkpoint-1",
    });

    expect(events().map((event) => event.type)).toEqual([
      "item.started",
      "item.completed",
      "turn.token_usage_changed",
      "turn.settled",
    ]);
    expect(events()).toContainEqual(
      expect.objectContaining({
        type: "item.completed",
        item: expect.objectContaining({
          type: "agentMessage",
          text: expect.stringContaining("updated the configuration file"),
        }),
      }),
    );
    expect(events()).toContainEqual(
      expect.objectContaining({
        type: "turn.settled",
        outcome: "completed",
        providerCheckpointId: "checkpoint-1",
      }),
    );
  });

  it("keeps the canonical turn active across Pi automatic retries", () => {
    const { events, translator } = createTranslator();
    translator.beginTurn("turn-1");
    translator.translateSdkEvent(fixture("agent-start.json"));
    translator.translateSdkEvent({
      type: "agent_end",
      messages: [
        {
          role: "assistant",
          content: [],
          stopReason: "error",
          errorMessage: "temporary failure",
          usage: { input: 0, output: 0, totalTokens: 0 },
        },
      ],
      willRetry: true,
    });
    translator.translateSdkEvent(fixture("agent-end-with-message.json"));

    expect(events()).toContainEqual(
      expect.objectContaining({
        type: "turn.retrying",
        attempt: 1,
        message: "temporary failure",
      }),
    );
    expect(
      events().filter((event) => event.type === "turn.settled"),
    ).toHaveLength(1);
  });

  it("preserves command starts, output deltas, and completion payloads", () => {
    const { events, translator } = createTranslator();
    translator.beginTurn("turn-1");
    translator.translateSdkEvent(fixture("agent-start.json"));
    translator.translateSdkEvent({
      type: "tool_execution_start",
      toolCallId: "call-1",
      toolName: "bash",
      args: { command: "printf hello", cwd: "/repo" },
    });
    translator.translateSdkEvent({
      type: "tool_execution_update",
      toolCallId: "call-1",
      toolName: "bash",
      partialResult: { content: [{ type: "text", text: "hello" }] },
    });
    translator.translateSdkEvent({
      type: "tool_execution_end",
      toolCallId: "call-1",
      toolName: "bash",
      result: { content: [{ type: "text", text: "hello" }] },
      isError: false,
    });

    expect(events()).toEqual([
      expect.objectContaining({
        type: "item.started",
        item: expect.objectContaining({
          type: "commandExecution",
          id: "call-1",
          command: "printf hello",
        }),
      }),
      expect.objectContaining({
        type: "item.delta",
        itemId: "call-1",
        channel: "command_output",
        delta: "hello",
      }),
      expect.objectContaining({
        type: "item.completed",
        item: expect.objectContaining({
          type: "commandExecution",
          id: "call-1",
          status: "completed",
          aggregatedOutput: "hello",
        }),
      }),
    ]);
  });

  it("closes the compaction item before settling a manual compaction turn", () => {
    const { events, translator } = createTranslator();
    translator.beginTurn("turn-1");
    translator.translateSdkEvent({
      type: "compaction_start",
      reason: "manual",
    });
    translator.translateSdkEvent({
      type: "compaction_end",
      reason: "manual",
      aborted: false,
    });

    expect(events().map((event) => event.type)).toEqual([
      "item.started",
      "item.completed",
      "turn.compacted",
      "turn.settled",
    ]);
  });
});
