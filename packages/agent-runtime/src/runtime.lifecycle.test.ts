import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ThreadEvent } from "@bb/domain";
import { createAgentRuntimeWithProviderDrivers } from "./test/runtime-with-provider-drivers.js";
import {
  fullRuntimeOptions,
  waitForRuntimeThreadEvent,
  waitForThreadAgentMessageText,
  waitForThreadTurnCompleted,
} from "./test/runtime-test-harness.js";
import { promptTextInput } from "./test/prompt-input.js";

describe("createAgentRuntime lifecycle", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "bb-runtime-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function createRuntime(events: ThreadEvent[]) {
    return createAgentRuntimeWithProviderDrivers({
      workspacePath: tmpDir,
      onEvent: (event) => events.push(event),
      onToolCall: async () => ({
        contentItems: [{ type: "inputText", text: "ok" }],
        success: true,
      }),
    });
  }

  it("starts a thread with an authoritative provider session id", async () => {
    const events: ThreadEvent[] = [];
    const runtime = createRuntime(events);
    try {
      const result = await runtime.startThread({
        environmentId: "env-1",
        threadId: "t1",
        projectId: "p1",
        providerId: "fake",
        options: fullRuntimeOptions,
      });

      expect(result.providerThreadId).toMatch(/^fake-session-/u);
      expect(runtime.hasThread("t1")).toBe(true);
      expect(runtime.getProviderSession("t1")?.providerThreadId).toBe(
        result.providerThreadId,
      );
    } finally {
      await runtime.shutdown();
    }
  });

  it("runs turns and projects canonical lifecycle events", async () => {
    const events: ThreadEvent[] = [];
    const runtime = createRuntime(events);
    try {
      await runtime.startThread({
        environmentId: "env-1",
        threadId: "t1",
        projectId: "p1",
        providerId: "fake",
        options: fullRuntimeOptions,
      });
      await runtime.runTurn({
        clientRequestId: "creq_222222222b",
        threadId: "t1",
        input: [promptTextInput({ text: "hello canonical driver" })],
        options: fullRuntimeOptions,
      });
      await waitForThreadTurnCompleted({
        events,
        providerId: "fake",
        runtime,
        threadId: "t1",
      });

      expect(events.some((event) => event.type === "turn/started")).toBe(true);
      expect(events.some((event) => event.type === "turn/input/accepted")).toBe(
        true,
      );
      expect(events.some((event) => event.type === "turn/completed")).toBe(
        true,
      );
    } finally {
      await runtime.shutdown();
    }
  });

  it("runs initial input supplied with thread creation", async () => {
    const events: ThreadEvent[] = [];
    const runtime = createRuntime(events);
    try {
      await runtime.startThread({
        environmentId: "env-1",
        threadId: "t1",
        projectId: "p1",
        providerId: "fake",
        options: fullRuntimeOptions,
        clientRequestId: "creq_222222222h",
        input: [promptTextInput({ text: "initial input" })],
      });
      await waitForThreadAgentMessageText({
        events,
        providerId: "fake",
        runtime,
        threadId: "t1",
        text: "initial input",
      });
      expect(
        events.filter((event) => event.type === "turn/started"),
      ).toHaveLength(1);
    } finally {
      await runtime.shutdown();
    }
  });

  it("does not create a turn until input is submitted", async () => {
    const events: ThreadEvent[] = [];
    const runtime = createRuntime(events);
    try {
      await runtime.startThread({
        environmentId: "env-1",
        threadId: "t1",
        projectId: "p1",
        providerId: "fake",
        options: fullRuntimeOptions,
      });
      expect(events.some((event) => event.type === "turn/started")).toBe(false);
      expect(runtime.getActiveTurnId("t1")).toBeNull();
    } finally {
      await runtime.shutdown();
    }
  });

  it("resumes a provider session across runtime instances", async () => {
    const firstEvents: ThreadEvent[] = [];
    const runtime1 = createRuntime(firstEvents);
    const { providerThreadId } = await runtime1.startThread({
      environmentId: "env-1",
      threadId: "t1",
      projectId: "p1",
      providerId: "fake",
      options: fullRuntimeOptions,
    });
    await runtime1.shutdown();

    const secondEvents: ThreadEvent[] = [];
    const runtime2 = createRuntime(secondEvents);
    try {
      await runtime2.resumeThread({
        environmentId: "env-1",
        threadId: "t1",
        projectId: "p1",
        providerThreadId,
        providerId: "fake",
        options: fullRuntimeOptions,
      });
      await runtime2.runTurn({
        clientRequestId: "creq_222222222c",
        threadId: "t1",
        input: [promptTextInput({ text: "after resume" })],
        options: fullRuntimeOptions,
      });
      await waitForThreadAgentMessageText({
        events: secondEvents,
        providerId: "fake",
        runtime: runtime2,
        threadId: "t1",
        text: "after resume",
      });
      expect(runtime2.getProviderSession("t1")?.providerThreadId).toBe(
        providerThreadId,
      );
    } finally {
      await runtime2.shutdown();
    }
  });

  it("resolves waitForActiveTurn from accepted canonical submission", async () => {
    const events: ThreadEvent[] = [];
    const runtime = createRuntime(events);
    try {
      await runtime.startThread({
        environmentId: "env-1",
        threadId: "t1",
        projectId: "p1",
        providerId: "fake",
        options: fullRuntimeOptions,
      });
      const pendingTurnId = runtime.waitForActiveTurn("t1", {
        timeoutMs: 5_000,
      });
      await runtime.runTurn({
        clientRequestId: "creq_222222222d",
        threadId: "t1",
        input: [promptTextInput({ text: "delay:500" })],
        options: fullRuntimeOptions,
      });

      const turnId = await pendingTurnId;
      expect(turnId).toBeTruthy();
      expect(runtime.getActiveTurnId("t1")).toBe(turnId);
      expect(runtime.getLiveThreadIds()).toEqual(["t1"]);
    } finally {
      await runtime.shutdown();
    }
  });

  it("stops an active turn and requires an explicit resume", async () => {
    const events: ThreadEvent[] = [];
    const runtime = createRuntime(events);
    try {
      const { providerThreadId } = await runtime.startThread({
        environmentId: "env-1",
        threadId: "t1",
        projectId: "p1",
        providerId: "fake",
        options: fullRuntimeOptions,
      });
      await runtime.runTurn({
        clientRequestId: "creq_222222222e",
        threadId: "t1",
        input: [promptTextInput({ text: "delay:1000" })],
        options: fullRuntimeOptions,
      });
      await waitForRuntimeThreadEvent({
        events,
        providerId: "fake",
        runtime,
        threadId: "t1",
        label: "turn started before stop",
        predicate: (event) => event.type === "turn/started",
      });

      await runtime.stopThread({ threadId: "t1" });
      expect(runtime.hasThread("t1")).toBe(false);
      expect(runtime.listRunningProviders()).toEqual(["fake"]);
      await expect(
        runtime.runTurn({
          clientRequestId: "creq_222222222f",
          threadId: "t1",
          input: [promptTextInput({ text: "not resumed" })],
          options: fullRuntimeOptions,
        }),
      ).rejects.toThrow(
        /not found|unknown|not running|no provider associated/iu,
      );

      await runtime.resumeThread({
        environmentId: "env-1",
        threadId: "t1",
        projectId: "p1",
        providerThreadId,
        providerId: "fake",
        options: fullRuntimeOptions,
      });
    } finally {
      await runtime.shutdown();
    }
  });

  it("lists models from driver inspection", async () => {
    const runtime = createRuntime([]);
    try {
      const result = await runtime.listModels({ providerId: "fake" });
      expect(result.models).toEqual([
        expect.objectContaining({ id: "fake-model", isDefault: true }),
      ]);
    } finally {
      await runtime.shutdown();
    }
  });

  it("rejects turns for unknown threads without harming the provider", async () => {
    const runtime = createRuntime([]);
    try {
      await expect(
        runtime.runTurn({
          clientRequestId: "creq_222222222g",
          threadId: "missing",
          input: [promptTextInput({ text: "missing" })],
          options: fullRuntimeOptions,
        }),
      ).rejects.toThrow();
    } finally {
      await runtime.shutdown();
    }
  });
});
