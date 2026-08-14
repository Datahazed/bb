import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { requireThreadEventScopeTurnId, type ThreadEvent } from "@bb/domain";
import { createAgentRuntimeWithProviderDrivers } from "./test/runtime-with-provider-drivers.js";
import {
  fullRuntimeOptions,
  waitForRuntimeThreadEvent,
  waitForThreadTurnCompleted,
} from "./test/runtime-test-harness.js";
import { promptTextInput } from "./test/prompt-input.js";

describe("createAgentRuntime canonical input acceptance", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "bb-runtime-accepted-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function createRuntime(events: ThreadEvent[]) {
    return createAgentRuntimeWithProviderDrivers({
      workspacePath: tmpDir,
      onEvent: (event) => events.push(event),
      onToolCall: async () => ({ success: true, contentItems: [] }),
    });
  }

  it("emits accepted input only after canonical start and steer acceptance", async () => {
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
        input: [promptTextInput({ text: "delay:1000 first" })],
        options: fullRuntimeOptions,
      });
      await waitForRuntimeThreadEvent({
        events,
        providerId: "fake",
        runtime,
        threadId: "t1",
        label: "canonical turn start",
        predicate: (event) => event.type === "turn/started",
      });
      const activeTurnId = runtime.getActiveTurnId("t1");
      expect(activeTurnId).toBeTruthy();

      await runtime.steerTurn({
        clientRequestId: "creq_222222222c",
        threadId: "t1",
        expectedTurnId: activeTurnId!,
        input: [promptTextInput({ text: "steered" })],
        options: fullRuntimeOptions,
      });
      await waitForThreadTurnCompleted({
        events,
        providerId: "fake",
        runtime,
        threadId: "t1",
      });

      const accepted = events.filter(
        (event) => event.type === "turn/input/accepted",
      );
      expect(accepted).toHaveLength(2);
      expect(accepted.map((event) => event.clientRequestId)).toEqual([
        "creq_222222222b",
        "creq_222222222c",
      ]);
      expect(
        accepted.map((event) =>
          requireThreadEventScopeTurnId({
            type: event.type,
            scope: event.scope,
          }),
        ),
      ).toEqual([activeTurnId, activeTurnId]);
    } finally {
      await runtime.shutdown();
    }
  });

  it("does not emit acceptance for a stale steer request", async () => {
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
        clientRequestId: "creq_222222222d",
        threadId: "t1",
        input: [promptTextInput({ text: "delay:1000" })],
        options: fullRuntimeOptions,
      });
      await waitForRuntimeThreadEvent({
        events,
        providerId: "fake",
        runtime,
        threadId: "t1",
        label: "canonical turn start",
        predicate: (event) => event.type === "turn/started",
      });

      await expect(
        runtime.steerTurn({
          clientRequestId: "creq_222222222e",
          threadId: "t1",
          expectedTurnId: "turn:stale",
          input: [promptTextInput({ text: "stale" })],
          options: fullRuntimeOptions,
        }),
      ).resolves.toEqual(expect.objectContaining({ status: "stale" }));
      expect(
        events.filter((event) => event.type === "turn/input/accepted"),
      ).toHaveLength(1);
    } finally {
      await runtime.shutdown();
    }
  });
});
