/**
 * Kill-9 matrix: pending managed cleanup re-derivation (plan §5.12, §8). A
 * dirty worktree blocks the archive-cleanup preflight, leaving the durable
 * `cleanupRequestedAt`/`cleanupMode` intent recorded. The intent must
 * survive a SIGKILL, and the restarted server's boot kick + product sweep
 * must re-drive the destroy once the worktree is clean again.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import type { Environment } from "@bb/domain";
import { archiveThread, getEnvironment } from "../../helpers/api.js";
import {
  waitForEnvironmentStatus,
  waitForPathRemoval,
} from "../../helpers/assertions.js";
import {
  withCrashServerHarness,
  type CrashServerHarness,
} from "../../helpers/crash-server.js";
import { runGit } from "../../helpers/seed.js";
import { scaleTimeoutMs } from "../../helpers/time.js";
import { createCrashThread, RECOVERY_TIMEOUT_MS } from "./shared.js";

const INTENT_TIMEOUT_MS = scaleTimeoutMs(10_000);

async function waitForCleanupIntent(
  harness: CrashServerHarness,
  environmentId: string,
): Promise<Environment> {
  const deadline = Date.now() + INTENT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const environment = await getEnvironment(harness.api, environmentId);
    if (environment.cleanupRequestedAt !== null) {
      return environment;
    }
    await sleep(100);
  }
  throw new Error("Timed out waiting for recorded cleanup intent");
}

describe.sequential("kill-9 boot reconciliation: pending cleanup", () => {
  it("re-derives blocked managed cleanup from durable intent after restart", () =>
    withCrashServerHarness({}, async (harness) => {
      const { environment, thread } = await createCrashThread(
        harness,
        "Kill9 Pending Cleanup",
        "managed-worktree",
      );
      const workspacePath = environment.path;
      if (!workspacePath) {
        throw new Error("Expected a managed worktree path");
      }

      // Dirty the worktree so the cleanup preflight reports
      // blocked_by_changes and the destroy stays pending.
      await fs.writeFile(
        path.join(workspacePath, "alpha.txt"),
        "uncommitted change\n",
        "utf8",
      );
      await archiveThread(harness.api, thread.id);
      const blocked = await waitForCleanupIntent(harness, environment.id);
      expect(blocked.cleanupMode).toBe("safe");

      // Give the fast product sweep a few rounds: the blocked preflight must
      // not destroy a dirty workspace.
      await sleep(scaleTimeoutMs(2_000));
      expect(
        (await getEnvironment(harness.api, environment.id)).status,
      ).toBe("ready");

      await harness.crash();
      await harness.restart();

      // Durable intent survived the crash.
      const restarted = await waitForCleanupIntent(harness, environment.id);
      expect(restarted.cleanupMode).toBe("safe");
      expect(restarted.status).toBe("ready");

      // Clean the worktree; the sweep re-drives the destroy to completion.
      await runGit({
        cwd: workspacePath,
        args: ["checkout", "--", "alpha.txt"],
      });
      await waitForEnvironmentStatus(
        harness.api,
        environment.id,
        "destroyed",
        RECOVERY_TIMEOUT_MS,
      );
      await waitForPathRemoval(workspacePath, RECOVERY_TIMEOUT_MS);
    }));
});
