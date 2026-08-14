import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ThreadEvent } from "@bb/domain";
import {
  createAgentRuntimeWithProviderDrivers,
  createFakeCanonicalProviderDriverSpec,
} from "./test/runtime-with-provider-drivers.js";
import { fullRuntimeOptions } from "./test/runtime-test-harness.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function rewindRequest(leaseId: string) {
  return {
    environmentId: "env-1",
    threadId: "thread-1",
    leaseId,
    projectId: "project-1",
    providerId: "fake",
    sourceProviderThreadId: "provider-source-1",
    retainThroughProviderCheckpoint: "turn-before-edit",
    options: fullRuntimeOptions,
    instructionMode: "append" as const,
  };
}

describe("prepareThreadRewind with a canonical driver", () => {
  it("stages one independently discardable fork per lease and suppresses staging events", async () => {
    const workspacePath = mkdtempSync(join(tmpdir(), "bb-runtime-rewind-"));
    temporaryDirectories.push(workspacePath);
    const events: ThreadEvent[] = [];
    const runtime = createAgentRuntimeWithProviderDrivers({
      workspacePath,
      onEvent: (event) => events.push(event),
      onToolCall: async () => ({ success: true, contentItems: [] }),
    });

    try {
      const request = rewindRequest("lease-1");
      const first = await runtime.prepareThreadRewind(request);
      const replay = await runtime.prepareThreadRewind(request);
      const second = await runtime.prepareThreadRewind(
        rewindRequest("lease-2"),
      );

      expect(replay).toEqual(first);
      expect(second.providerThreadId).not.toBe(first.providerThreadId);
      expect(events).toEqual([]);
      expect(runtime.hasThread("thread-1:rewind:lease-1")).toBe(true);
      expect(runtime.hasThread("thread-1:rewind:lease-2")).toBe(true);

      await runtime.discardThreadRewind({ leaseId: "lease-1" });
      expect(runtime.hasThread("thread-1:rewind:lease-1")).toBe(false);
      expect(runtime.hasThread("thread-1:rewind:lease-2")).toBe(true);

      await runtime.discardThreadRewind({ leaseId: "lease-2" });
      expect(runtime.hasThread("thread-1:rewind:lease-2")).toBe(false);
    } finally {
      await runtime.shutdown();
    }
  });

  it("retains a staged rewind when provider cleanup fails so cleanup can retry", async () => {
    const workspacePath = mkdtempSync(join(tmpdir(), "bb-runtime-rewind-"));
    temporaryDirectories.push(workspacePath);
    const stderr: string[] = [];
    const runtime = createAgentRuntimeWithProviderDrivers({
      workspacePath,
      onEvent: () => undefined,
      onStderr: (line) => stderr.push(line),
      onToolCall: async () => ({ success: true, contentItems: [] }),
      providerDriverFactory: (providerId) =>
        createFakeCanonicalProviderDriverSpec(providerId, {
          config: { failDiscardOnce: true },
        }),
    });
    const request = rewindRequest("lease-retry-cleanup");
    const stagingThreadId = "thread-1:rewind:lease-retry-cleanup";

    try {
      await runtime.prepareThreadRewind(request);
      await runtime.discardThreadRewind({ leaseId: request.leaseId });
      expect(runtime.hasThread(stagingThreadId)).toBe(true);
      expect(stderr).toEqual([
        expect.stringContaining("discard is temporarily unavailable"),
      ]);

      await runtime.discardThreadRewind({ leaseId: request.leaseId });
      expect(runtime.hasThread(stagingThreadId)).toBe(false);
    } finally {
      await runtime.shutdown();
    }
  });
});
