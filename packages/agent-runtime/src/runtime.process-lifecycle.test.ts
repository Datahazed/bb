import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ThreadEvent } from "@bb/domain";
import type { AgentRuntimeProcessExitInfo } from "./types.js";
import {
  createAgentRuntimeWithProviderDrivers,
  createFakeCanonicalProviderDriverSpec,
} from "./test/runtime-with-provider-drivers.js";
import { builtinProviderDriverLaunchSpec } from "./test/builtin-provider-driver-factory.js";
import {
  fullRuntimeOptions,
  waitForRuntimeThreadEvent,
  waitForThreadAgentMessageText,
  waitForThreadTurnCompleted,
} from "./test/runtime-test-harness.js";
import { promptTextInput } from "./test/prompt-input.js";

vi.setConfig({ testTimeout: 20_000 });

function agentMessageText(events: ThreadEvent[], threadId: string): string {
  return events
    .filter(
      (event) =>
        event.type === "item/completed" &&
        event.threadId === threadId &&
        event.item.type === "agentMessage",
    )
    .map((event) =>
      event.type === "item/completed" && event.item.type === "agentMessage"
        ? event.item.text
        : "",
    )
    .join("\n");
}

describe("createAgentRuntime canonical process lifecycle", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "bb-runtime-process-"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reports an unexpected driver crash with active thread state", async () => {
    const events: ThreadEvent[] = [];
    let resolveExit: ((value: AgentRuntimeProcessExitInfo) => void) | undefined;
    const exit = new Promise<AgentRuntimeProcessExitInfo>((resolve) => {
      resolveExit = resolve;
    });
    const runtime = createAgentRuntimeWithProviderDrivers({
      workspacePath: tmpDir,
      onEvent: (event) => events.push(event),
      onToolCall: async () => ({ success: true, contentItems: [] }),
      onProcessExit: (processExit) => resolveExit?.(processExit),
    });

    try {
      await runtime.startThread({
        environmentId: "env-1",
        threadId: "t1",
        projectId: "p1",
        providerId: "fake",
        options: fullRuntimeOptions,
      });
      const submission = runtime
        .runTurn({
          clientRequestId: "creq_222222222b",
          threadId: "t1",
          input: [promptTextInput({ text: "crash_process" })],
          options: fullRuntimeOptions,
        })
        .catch((error: unknown) => error);

      const [, exitInfo] = await Promise.all([submission, exit]);
      expect(exitInfo).toEqual(
        expect.objectContaining({
          providerId: "fake",
          code: null,
          signal: "SIGKILL",
          expected: false,
          threads: [
            expect.objectContaining({
              threadId: "t1",
              activeTurnId: expect.any(String),
            }),
          ],
        }),
      );
      expect(runtime.hasThread("t1")).toBe(false);
    } finally {
      await runtime.shutdown();
    }
  });

  it("bounds diagnostic context when a driver fails during initialization", async () => {
    const runtime = createAgentRuntimeWithProviderDrivers({
      workspacePath: tmpDir,
      onEvent: () => {},
      onToolCall: async () => ({ success: true, contentItems: [] }),
      providerDriverFactory: (providerId) =>
        createFakeCanonicalProviderDriverSpec(providerId, {
          config: {
            crashDuringInitialize: true,
            stderrText: "x".repeat(32_000),
          },
        }),
    });

    try {
      const error = await runtime
        .ensureProvider({ providerId: "fake" })
        .then(() => null)
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(Error);
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toContain("stderr:");
      expect(message.length).toBeLessThan(6_000);
      expect(message.endsWith("x".repeat(100))).toBe(true);
    } finally {
      await runtime.shutdown();
    }
  });

  it("removes a failed startup so a later ensure can retry", async () => {
    let launches = 0;
    const runtime = createAgentRuntimeWithProviderDrivers({
      workspacePath: tmpDir,
      onEvent: () => {},
      onToolCall: async () => ({ success: true, contentItems: [] }),
      providerDriverFactory: (providerId) => {
        launches += 1;
        return createFakeCanonicalProviderDriverSpec(providerId, {
          config: { crashDuringInitialize: launches === 1 },
        });
      },
    });

    try {
      await expect(
        runtime.ensureProvider({ providerId: "fake" }),
      ).rejects.toThrow();
      await expect(
        runtime.ensureProvider({ providerId: "fake" }),
      ).resolves.toBeUndefined();
      expect(launches).toBe(2);
    } finally {
      await runtime.shutdown();
    }
  });

  it("deduplicates concurrent provider startup", async () => {
    let launches = 0;
    const runtime = createAgentRuntimeWithProviderDrivers({
      workspacePath: tmpDir,
      onEvent: () => {},
      onToolCall: async () => ({ success: true, contentItems: [] }),
      providerDriverFactory: (providerId) => {
        launches += 1;
        return createFakeCanonicalProviderDriverSpec(providerId);
      },
    });

    try {
      await Promise.all([
        runtime.ensureProvider({ providerId: "fake" }),
        runtime.ensureProvider({ providerId: "fake" }),
        runtime.ensureProvider({ providerId: "fake" }),
      ]);
      expect(launches).toBe(1);
    } finally {
      await runtime.shutdown();
    }
  });

  it("shares one multiplexed driver process across provider threads", async () => {
    const events: ThreadEvent[] = [];
    const runtime = createAgentRuntimeWithProviderDrivers({
      workspacePath: tmpDir,
      onEvent: (event) => events.push(event),
      onToolCall: async () => ({ success: true, contentItems: [] }),
      providerProcessScope: (providerId) =>
        providerId === "codex" ? "thread" : "environment",
    });

    try {
      for (const threadId of ["t1", "t2"]) {
        await runtime.startThread({
          environmentId: "env-1",
          threadId,
          projectId: "p1",
          providerId: "fake",
          options: fullRuntimeOptions,
        });
        await runtime.runTurn({
          clientRequestId:
            threadId === "t1" ? "creq_222222222c" : "creq_222222222d",
          threadId,
          input: [promptTextInput({ text: "report_pid" })],
          options: fullRuntimeOptions,
        });
        await waitForThreadTurnCompleted({
          events,
          providerId: "fake",
          runtime,
          threadId,
        });
      }

      expect(agentMessageText(events, "t1")).toMatch(/^pid:\d+$/u);
      expect(agentMessageText(events, "t2")).toBe(
        agentMessageText(events, "t1"),
      );
    } finally {
      await runtime.shutdown();
    }
  });

  it("uses a separate canonical driver process for each Codex thread", async () => {
    const events: ThreadEvent[] = [];
    const runtime = createAgentRuntimeWithProviderDrivers({
      workspacePath: tmpDir,
      onEvent: (event) => events.push(event),
      onToolCall: async () => ({ success: true, contentItems: [] }),
      providerProcessScope: (providerId) =>
        providerId === "codex" ? "thread" : "environment",
    });

    try {
      for (const threadId of ["t1", "t2"]) {
        await runtime.startThread({
          environmentId: "env-1",
          threadId,
          projectId: "p1",
          providerId: "codex",
          options: fullRuntimeOptions,
        });
        await runtime.runTurn({
          clientRequestId:
            threadId === "t1" ? "creq_222222222e" : "creq_222222222f",
          threadId,
          input: [promptTextInput({ text: "report_pid" })],
          options: fullRuntimeOptions,
        });
        await waitForThreadTurnCompleted({
          events,
          providerId: "codex",
          runtime,
          threadId,
        });
      }

      expect(agentMessageText(events, "t1")).toMatch(/^pid:\d+$/u);
      expect(agentMessageText(events, "t2")).not.toBe(
        agentMessageText(events, "t1"),
      );
    } finally {
      await runtime.shutdown();
    }
  });

  it("reaps a registered thread-scoped driver process and resumes it later", async () => {
    const events: ThreadEvent[] = [];
    const providerDriver = builtinProviderDriverLaunchSpec("codex");
    const runtime = createAgentRuntimeWithProviderDrivers({
      workspacePath: tmpDir,
      onEvent: (event) => events.push(event),
      onToolCall: async () => ({ success: true, contentItems: [] }),
    });

    try {
      const { providerThreadId } = await runtime.startThread({
        environmentId: "env-1",
        threadId: "t1",
        projectId: "p1",
        providerId: "codex",
        providerDriver,
        options: fullRuntimeOptions,
      });
      await runtime.runTurn({
        clientRequestId: "creq_222222222g",
        threadId: "t1",
        input: [promptTextInput({ text: "before reap" })],
        options: fullRuntimeOptions,
      });
      await waitForThreadAgentMessageText({
        events,
        providerId: "codex",
        runtime,
        threadId: "t1",
        text: "before reap",
      });

      const result = await runtime.reapIdleProviderSessions({
        idleForMs: 0,
        nowMs: Date.now() + 1,
      });
      expect(result.reapedSessions).toEqual([
        expect.objectContaining({ threadId: "t1", providerId: "codex" }),
      ]);
      expect(runtime.hasThread("t1")).toBe(false);

      await runtime.resumeThread({
        environmentId: "env-1",
        threadId: "t1",
        projectId: "p1",
        providerThreadId,
        providerId: "codex",
        providerDriver,
        options: fullRuntimeOptions,
      });
      expect(runtime.hasThread("t1")).toBe(true);
    } finally {
      await runtime.shutdown();
    }
  });

  it("does not reap a thread-scoped process while its turn is active", async () => {
    const events: ThreadEvent[] = [];
    const runtime = createAgentRuntimeWithProviderDrivers({
      workspacePath: tmpDir,
      onEvent: (event) => events.push(event),
      onToolCall: async () => ({ success: true, contentItems: [] }),
      providerProcessScope: (providerId) =>
        providerId === "codex" ? "thread" : "environment",
    });

    try {
      await runtime.startThread({
        environmentId: "env-1",
        threadId: "t1",
        projectId: "p1",
        providerId: "codex",
        options: fullRuntimeOptions,
      });
      await runtime.runTurn({
        clientRequestId: "creq_222222222h",
        threadId: "t1",
        input: [promptTextInput({ text: "delay:1000" })],
        options: fullRuntimeOptions,
      });
      await waitForRuntimeThreadEvent({
        events,
        providerId: "codex",
        runtime,
        threadId: "t1",
        label: "active codex fake turn",
        predicate: (event) => event.type === "turn/started",
      });

      const result = await runtime.reapIdleProviderSessions({
        idleForMs: 0,
        nowMs: Date.now() + 60_000,
      });
      expect(result.reapedSessions).toEqual([]);
      expect(runtime.hasThread("t1")).toBe(true);
    } finally {
      await runtime.shutdown();
    }
  });
});
