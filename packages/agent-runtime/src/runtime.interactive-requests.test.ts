import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  PendingInteractionCreate,
  PendingInteractionResolution,
  ThreadEvent,
} from "@bb/domain";
import { createAgentRuntimeWithProviderDrivers } from "./test/runtime-with-provider-drivers.js";
import {
  fullRuntimeOptions,
  waitForRuntimeThreadEvent,
  waitForThreadTurnCompleted,
} from "./test/runtime-test-harness.js";
import { promptTextInput } from "./test/prompt-input.js";

const answer: PendingInteractionResolution = {
  kind: "user_answer",
  answers: {
    "fake-question": { selected: ["staging"] },
  },
};

describe("createAgentRuntime canonical interactive requests", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "bb-runtime-interaction-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("routes user questions through onInteractiveRequest", async () => {
    const events: ThreadEvent[] = [];
    const requests: PendingInteractionCreate[] = [];
    const onInteractiveRequest = vi.fn(
      async (request: PendingInteractionCreate) => {
        requests.push(request);
        return answer;
      },
    );
    const runtime = createAgentRuntimeWithProviderDrivers({
      workspacePath: tmpDir,
      onEvent: (event) => events.push(event),
      onToolCall: async () => ({ success: true, contentItems: [] }),
      onInteractiveRequest,
    });

    try {
      await runtime.startThread({
        environmentId: "env-1",
        threadId: "t1",
        projectId: "p1",
        providerId: "fake",
        options: {
          ...fullRuntimeOptions,
          permissionMode: "auto",
          permissionScope: "workspace",
          approvalReviewer: "automatic",
          permissionEscalation: "deny",
        },
      });
      await runtime.runTurn({
        clientRequestId: "creq_222222222b",
        threadId: "t1",
        input: [promptTextInput({ text: "ask_user" })],
        options: {
          ...fullRuntimeOptions,
          permissionMode: "auto",
          permissionScope: "workspace",
          approvalReviewer: "automatic",
          permissionEscalation: "deny",
        },
      });
      await waitForThreadTurnCompleted({
        events,
        providerId: "fake",
        runtime,
        threadId: "t1",
      });

      expect(onInteractiveRequest).toHaveBeenCalledTimes(1);
      expect(requests[0]).toEqual(
        expect.objectContaining({
          providerThreadId: expect.stringMatching(/^fake-session-/u),
          threadId: "t1",
          payload: expect.objectContaining({ kind: "user_question" }),
        }),
      );
    } finally {
      await runtime.shutdown();
    }
  });

  it("fails the turn when no user-question handler is installed", async () => {
    const events: ThreadEvent[] = [];
    const runtime = createAgentRuntimeWithProviderDrivers({
      workspacePath: tmpDir,
      onEvent: (event) => events.push(event),
      onToolCall: async () => ({ success: true, contentItems: [] }),
    });

    try {
      await runtime.startThread({
        environmentId: "env-1",
        threadId: "t1",
        projectId: "p1",
        providerId: "fake",
        options: fullRuntimeOptions,
      });
      await runtime.runTurn({
        clientRequestId: "creq_222222222c",
        threadId: "t1",
        input: [promptTextInput({ text: "ask_user" })],
        options: fullRuntimeOptions,
      });
      await waitForRuntimeThreadEvent({
        events,
        providerId: "fake",
        runtime,
        threadId: "t1",
        timeoutMs: 5_000,
        label: "failed user-question turn",
        predicate: (event) =>
          event.type === "turn/completed" && event.status === "failed",
      });

      expect(
        events.some(
          (event) =>
            event.type === "provider/error" &&
            /interactive|handler/iu.test(event.message),
        ),
      ).toBe(true);
    } finally {
      await runtime.shutdown();
    }
  });
});
