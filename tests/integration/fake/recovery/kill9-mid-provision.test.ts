/**
 * Kill-9 matrix: SIGKILL mid-provision (plan §8). A `.bb-env-setup.sh` that
 * sleeps holds the managed-worktree provision inside the setup script; the
 * restart must fail the provisioning thread and environment with the
 * standard `thread_provisioning_failed` events and close the streamed
 * provisioning transcript with a failed entry (plan §3 step 3).
 */
import { setTimeout as sleep } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import type { ThreadEventRow } from "@bb/domain";
import {
  createHostThread,
  getEnvironment,
  getThreadEvents,
} from "../../helpers/api.js";
import { waitForThreadStatus } from "../../helpers/assertions.js";
import { createProjectFixture } from "../../helpers/fixtures.js";
import {
  withCrashServerHarness,
  type CrashServerHarness,
} from "../../helpers/crash-server.js";
import {
  DEFAULT_TIMEOUT_MS,
  RECOVERY_TIMEOUT_MS,
} from "./shared.js";

function provisioningEntryKeys(event: ThreadEventRow): string[] {
  if (event.type !== "system/thread-provisioning") {
    return [];
  }
  return event.data.entries.map((entry) => entry.key);
}

async function waitForSetupScriptStarted(
  harness: CrashServerHarness,
  threadId: string,
): Promise<void> {
  const deadline = Date.now() + DEFAULT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const events = await getThreadEvents(harness.api, threadId);
    if (
      events.some((event) =>
        provisioningEntryKeys(event).includes("setup-started"),
      )
    ) {
      return;
    }
    await sleep(100);
  }
  throw new Error("Timed out waiting for the setup script to start");
}

describe.sequential("kill-9 boot reconciliation: mid-provision", () => {
  it("fails the provisioning thread and environment with the standard events", () =>
    withCrashServerHarness(
      {
        repoFiles: [
          { relativePath: "alpha.txt", content: "alpha\n" },
          {
            relativePath: ".bb-env-setup.sh",
            // Long enough to guarantee the kill lands mid-setup; short
            // enough that the orphaned shell reaps itself if the explicit
            // cleanup below ever misses it.
            content: "#!/bin/bash\nsleep 60\n",
          },
        ],
      },
      async (harness) => {
        const project = await createProjectFixture(harness, {
          name: "Kill9 Mid Provision",
        });
        const thread = await createHostThread(harness.api, {
          hostId: harness.hostId,
          projectId: project.id,
          workspace: { type: "managed-worktree" },
        });
        expect(thread.status).toBe("provisioning");
        await waitForSetupScriptStarted(harness, thread.id);
        const orphanPids = (await harness.listServerChildren()).map(
          (child) => child.pid,
        );

        await harness.crash();
        await harness.restart();

        const failed = await waitForThreadStatus(
          harness.api,
          thread.id,
          "error",
          RECOVERY_TIMEOUT_MS,
        );
        const environmentId = failed.environmentId;
        if (!environmentId) {
          throw new Error("Expected the failed thread to keep its environment");
        }

        const events = await getThreadEvents(harness.api, thread.id);
        const errorEvent = events.find(
          (event) => event.type === "system/error",
        );
        if (!errorEvent || errorEvent.type !== "system/error") {
          throw new Error("Expected a system/error event");
        }
        expect(errorEvent.data).toMatchObject({
          code: "thread_provisioning_failed",
          message: "Provisioning thread failed",
          detail: "Server restarted while the workspace was provisioning",
        });
        // The failure entry closes the open streamed transcript.
        const failedProvisioning = events.find(
          (event) =>
            event.type === "system/thread-provisioning" &&
            event.data.status === "failed",
        );
        if (
          !failedProvisioning ||
          failedProvisioning.type !== "system/thread-provisioning"
        ) {
          throw new Error("Expected a failed provisioning event");
        }
        expect(
          failedProvisioning.data.entries.map((entry) => entry.key),
        ).toContain("workspace-failed");

        const environment = await getEnvironment(harness.api, environmentId);
        expect(environment.status).toBe("error");

        // Reap the killed server's orphaned setup shell: nothing owns it
        // anymore, and leaving it sleeping would outlive the harness tmp dir.
        for (const pid of orphanPids) {
          try {
            process.kill(pid, "SIGKILL");
          } catch {
            // Already gone.
          }
        }
      },
    ));
});
