import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  providerDriverEventSchema,
  type ProviderDriverEvent,
} from "@bb/provider-driver-contract";
import type { ProviderDriverEventInput } from "@bb/provider-driver-sdk";
import { describe, expect, it } from "vitest";
import { ClaudeCanonicalEventTranslator } from "./canonical-event-translator.js";

const fixtures = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../__fixtures__/claude-code",
);

function fixture(name: string): SDKMessage {
  return JSON.parse(
    readFileSync(resolve(fixtures, name), "utf8"),
  ) as SDKMessage;
}

function createTranslator() {
  const inputs: ProviderDriverEventInput[] = [];
  const translator = new ClaudeCanonicalEventTranslator({
    attachmentId: "attachment-1",
    selectedModel: "claude-sonnet-4-6",
    events: { emit: (event) => inputs.push(event) },
  });
  const events = (): ProviderDriverEvent[] =>
    inputs.map((event, index) =>
      providerDriverEventSchema.parse({ ...event, sequence: index + 1 }),
    );
  return { translator, events };
}

describe("Claude canonical event translator", () => {
  it("translates assistant output and terminal usage", () => {
    const { translator, events } = createTranslator();
    translator.beginTurn("turn-1", "claude-sonnet-4-6");
    translator.translateSdkMessage(fixture("assistant-text.json"));
    translator.translateSdkMessage(fixture("result-success.json"));

    expect(events()).toContainEqual(
      expect.objectContaining({
        type: "item.completed",
        turnId: "turn-1",
        item: expect.objectContaining({ type: "agentMessage" }),
      }),
    );
    expect(events()).toContainEqual(
      expect.objectContaining({
        type: "turn.token_usage_changed",
        turnId: "turn-1",
      }),
    );
    expect(events()).toContainEqual(
      expect.objectContaining({
        type: "turn.settled",
        turnId: "turn-1",
        outcome: "completed",
      }),
    );
  });

  it("preserves tool lifecycle and command output", () => {
    const { translator, events } = createTranslator();
    translator.beginTurn("turn-1", "claude-sonnet-4-6");
    translator.translateSdkMessage(fixture("assistant-tool-use.json"));
    translator.translateSdkMessage(fixture("user-tool-result.json"));

    expect(events()).toContainEqual(
      expect.objectContaining({
        type: "item.started",
        item: expect.objectContaining({ type: "commandExecution" }),
      }),
    );
    expect(events()).toContainEqual(
      expect.objectContaining({
        type: "item.completed",
        item: expect.objectContaining({ type: "commandExecution" }),
      }),
    );
  });

  it("classifies failed results once", () => {
    const { translator, events } = createTranslator();
    translator.beginTurn("turn-1", "claude-sonnet-4-6");
    translator.translateSdkMessage({
      ...fixture("result-success.json"),
      subtype: "error_during_execution",
      is_error: true,
      result: "provider failed",
    } as SDKMessage);

    expect(events().filter((event) => event.type === "turn.settled")).toEqual([
      expect.objectContaining({
        outcome: "failed",
        error: expect.objectContaining({ category: "provider" }),
      }),
    ]);
  });

  it("emits a canonical retry without settling the turn", () => {
    const { translator, events } = createTranslator();
    translator.beginTurn("turn-1", "claude-sonnet-4-6");
    translator.translateSdkMessage({
      type: "system",
      subtype: "api_retry",
      attempt: 2,
      max_retries: 5,
      retry_delay_ms: 1500,
      error: "rate_limit",
      error_status: 429,
      uuid: "00000000-0000-4000-8000-000000000001",
      session_id: "session-1",
    } as SDKMessage);

    expect(events()).toContainEqual(
      expect.objectContaining({ type: "turn.retrying", attempt: 2 }),
    );
    expect(events().some((event) => event.type === "turn.settled")).toBe(false);
  });
});
