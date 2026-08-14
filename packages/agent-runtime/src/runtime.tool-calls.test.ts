import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ThreadEvent, ToolCallRequest } from "@bb/domain";
import { createAgentRuntimeWithProviderDrivers } from "./test/runtime-with-provider-drivers.js";
import {
  fullRuntimeOptions,
  waitForRuntimeThreadEvent,
  waitForThreadTurnCompleted,
} from "./test/runtime-test-harness.js";
import { promptTextInput } from "./test/prompt-input.js";

const dynamicTool = {
  name: "bb_test_ping",
  description: "A test tool",
  inputSchema: { type: "object", properties: {} },
} as const;

describe("createAgentRuntime canonical tool calls", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "bb-runtime-tools-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("routes provider tool calls through onToolCall", async () => {
    const events: ThreadEvent[] = [];
    const requests: ToolCallRequest[] = [];
    const runtime = createAgentRuntimeWithProviderDrivers({
      workspacePath: tmpDir,
      onEvent: (event) => events.push(event),
      onToolCall: async (request) => {
        requests.push(request);
        return {
          success: true,
          contentItems: [{ type: "inputText", text: "PONG_FROM_TOOL" }],
        };
      },
    });

    try {
      await runtime.startThread({
        environmentId: "env-1",
        threadId: "t1",
        projectId: "p1",
        providerId: "fake",
        options: fullRuntimeOptions,
        dynamicTools: [dynamicTool],
      });
      await runtime.runTurn({
        clientRequestId: "creq_222222222b",
        threadId: "t1",
        input: [promptTextInput({ text: "call_tool:bb_test_ping" })],
        options: fullRuntimeOptions,
      });
      await waitForThreadTurnCompleted({
        events,
        providerId: "fake",
        runtime,
        threadId: "t1",
      });

      expect(requests).toHaveLength(1);
      expect(requests[0]).toEqual(
        expect.objectContaining({
          threadId: "t1",
          tool: dynamicTool.name,
        }),
      );
      expect(requests[0]?.turnId).toBeTruthy();
      expect(
        events.some(
          (event) =>
            event.type === "item/completed" &&
            event.item.type === "agentMessage" &&
            event.item.text === "PONG_FROM_TOOL",
        ),
      ).toBe(true);
    } finally {
      await runtime.shutdown();
    }
  });

  it("settles the turn as failed when the host tool handler rejects", async () => {
    const events: ThreadEvent[] = [];
    const runtime = createAgentRuntimeWithProviderDrivers({
      workspacePath: tmpDir,
      onEvent: (event) => events.push(event),
      onToolCall: async () => {
        throw new Error("tool handler failed");
      },
    });

    try {
      await runtime.startThread({
        environmentId: "env-1",
        threadId: "t1",
        projectId: "p1",
        providerId: "fake",
        options: fullRuntimeOptions,
        dynamicTools: [dynamicTool],
      });
      await runtime.runTurn({
        clientRequestId: "creq_222222222c",
        threadId: "t1",
        input: [promptTextInput({ text: "call_tool:bb_test_ping" })],
        options: fullRuntimeOptions,
      });
      await waitForRuntimeThreadEvent({
        events,
        providerId: "fake",
        runtime,
        threadId: "t1",
        timeoutMs: 5_000,
        label: "failed canonical tool turn",
        predicate: (event) =>
          event.type === "turn/completed" && event.status === "failed",
      });

      expect(
        events.some(
          (event) =>
            event.type === "provider/error" &&
            event.message.includes("tool handler failed"),
        ),
      ).toBe(true);
    } finally {
      await runtime.shutdown();
    }
  });
});
