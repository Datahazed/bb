import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ThreadEvent } from "@bb/domain";
import {
  createAgentRuntimeWithProviderDrivers,
  createFakeCanonicalProviderDriverSpec,
} from "./test/runtime-with-provider-drivers.js";
import {
  fullRuntimeOptions,
  waitForThreadTurnCompleted,
} from "./test/runtime-test-harness.js";
import { promptTextInput } from "./test/prompt-input.js";

describe("createAgentRuntime canonical command contracts", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "bb-runtime-contract-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function createRuntime() {
    return createAgentRuntimeWithProviderDrivers({
      workspacePath: tmpDir,
      onEvent: () => {},
      onToolCall: async () => ({
        contentItems: [{ type: "inputText", text: "ok" }],
        success: true,
      }),
    });
  }

  it("passes session configuration through the canonical open contract", async () => {
    const sessionLogPath = join(tmpDir, "session-open.jsonl");
    const extraWriteRoot = join(tmpDir, "extra-write-root");
    const runtime = createAgentRuntimeWithProviderDrivers({
      workspacePath: tmpDir,
      additionalWorkspaceWriteRoots: [extraWriteRoot],
      shellEnv: { BB_TEST_SHELL: "shell-value" },
      onEvent: () => {},
      onToolCall: async () => ({ success: true, contentItems: [] }),
      providerDriverFactory: (providerId) =>
        createFakeCanonicalProviderDriverSpec(providerId, {
          config: { sessionOpenLogPath: sessionLogPath },
        }),
    });

    try {
      await runtime.startThread({
        environmentId: "env-1",
        threadId: "t1",
        projectId: "p1",
        providerId: "fake",
        options: fullRuntimeOptions,
        instructions: "Canonical session instructions",
        dynamicTools: [
          {
            name: "bb_test_tool",
            description: "Test tool",
            inputSchema: { type: "object", properties: {} },
          },
        ],
      });
      const open = JSON.parse(readFileSync(sessionLogPath, "utf8")) as {
        bbThreadId: string;
        dynamicTools: { name: string }[];
        execution: { permission: { permissionMode: string } };
        instructions: { text: string };
        shellEnvironment: Record<string, string>;
        workspace: { additionalWriteRoots: string[]; cwd: string };
      };
      expect(open).toMatchObject({
        bbThreadId: "t1",
        dynamicTools: [{ name: "bb_test_tool" }],
        execution: { permission: { permissionMode: "full" } },
        instructions: { text: "Canonical session instructions" },
        shellEnvironment: { BB_TEST_SHELL: "shell-value" },
        workspace: {
          additionalWriteRoots: [extraWriteRoot],
          cwd: tmpDir,
        },
      });
    } finally {
      await runtime.shutdown();
    }
  });

  it("reopens the session before a turn when session settings change", async () => {
    const events: ThreadEvent[] = [];
    const sessionLogPath = join(tmpDir, "session-reconfigure.jsonl");
    const runtime = createAgentRuntimeWithProviderDrivers({
      workspacePath: tmpDir,
      onEvent: (event) => events.push(event),
      onToolCall: async () => ({ success: true, contentItems: [] }),
      providerDriverFactory: (providerId) =>
        createFakeCanonicalProviderDriverSpec(providerId, {
          config: { sessionOpenLogPath: sessionLogPath },
        }),
    });
    const nextOptions = {
      ...fullRuntimeOptions,
      permissionMode: "accept-edits" as const,
      permissionScope: "workspace" as const,
      approvalReviewer: "user" as const,
      permissionEscalation: "ask" as const,
    };

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
        input: [promptTextInput({ text: "after reconfigure" })],
        options: nextOptions,
      });
      await waitForThreadTurnCompleted({
        events,
        providerId: "fake",
        runtime,
        threadId: "t1",
      });

      const opens = readFileSync(sessionLogPath, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as { mode: { kind: string } });
      expect(opens.map((open) => open.mode.kind)).toEqual(["start", "resume"]);
    } finally {
      await runtime.shutdown();
    }
  });

  it("rejects unsupported execution options before driver submission", async () => {
    const runtime = createRuntime();
    try {
      await expect(
        runtime.startThread({
          environmentId: "env-1",
          threadId: "t1",
          projectId: "p1",
          providerId: "fake",
          options: {
            ...fullRuntimeOptions,
            serviceTier: "fast",
          },
        }),
      ).rejects.toThrow(/does not support service tiers/iu);
    } finally {
      await runtime.shutdown();
    }
  });

  it("renames a live provider session", async () => {
    const runtime = createRuntime();
    try {
      await runtime.startThread({
        environmentId: "env-1",
        threadId: "t1",
        projectId: "p1",
        providerId: "fake",
        options: fullRuntimeOptions,
      });
      await expect(
        runtime.renameThread({ threadId: "t1", title: "New Title" }),
      ).resolves.toBeUndefined();
    } finally {
      await runtime.shutdown();
    }
  });

  it("archives and unarchives a canonical provider session", async () => {
    const runtime = createRuntime();
    try {
      const { providerThreadId } = await runtime.startThread({
        environmentId: "env-1",
        threadId: "t1",
        projectId: "p1",
        providerId: "fake",
        options: fullRuntimeOptions,
      });
      await expect(
        runtime.archiveThread({
          threadId: "t1",
          providerId: "fake",
          providerThreadId,
        }),
      ).resolves.toBeUndefined();
      await expect(
        runtime.unarchiveThread({
          threadId: "t1",
          providerId: "fake",
          providerThreadId,
        }),
      ).resolves.toBeUndefined();
    } finally {
      await runtime.shutdown();
    }
  });

  it("clears the goal on a live provider session", async () => {
    const runtime = createRuntime();
    try {
      await runtime.startThread({
        environmentId: "env-1",
        threadId: "t1",
        projectId: "p1",
        providerId: "fake",
        options: fullRuntimeOptions,
      });
      await expect(
        runtime.clearThreadGoal({ threadId: "t1" }),
      ).resolves.toEqual({ cleared: true });
    } finally {
      await runtime.shutdown();
    }
  });
});
