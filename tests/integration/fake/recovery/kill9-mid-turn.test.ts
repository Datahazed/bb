/**
 * Kill-9 matrix: SIGKILL mid-turn (plan §8). Boot reconciliation must
 * interrupt the orphaned active thread with `server-restarted`, settle its
 * pending request, leave no zombie provider child processes behind, and the
 * thread must accept a fresh turn afterwards (provider session resume).
 */
import { describe, expect, it } from "vitest";
import { sendTextMessage } from "../../helpers/api.js";
import {
  waitForThreadOutputContaining,
  waitForThreadStatus,
} from "../../helpers/assertions.js";
import {
  isFakeProviderProcess,
  waitForProcessesGone,
  withCrashServerHarness,
} from "../../helpers/crash-server.js";
import {
  ACTIVE_TIMEOUT_MS,
  createCrashThread,
  expectServerRestartedInterruption,
  HOLD_TURN_TEXT,
  RECOVERY_TIMEOUT_MS,
} from "./shared.js";

describe.sequential("kill-9 boot reconciliation: mid-turn", () => {
  it("interrupts the active turn with server-restarted and recovers", () =>
    withCrashServerHarness({}, async (harness) => {
      const { thread } = await createCrashThread(harness, "Kill9 Mid Turn");

      await sendTextMessage(harness.api, thread.id, { text: HOLD_TURN_TEXT });
      await waitForThreadStatus(
        harness.api,
        thread.id,
        "active",
        ACTIVE_TIMEOUT_MS,
      );
      const providerPids = (await harness.listServerChildren())
        .filter(isFakeProviderProcess)
        .map((child) => child.pid);
      expect(providerPids.length).toBeGreaterThan(0);

      await harness.crash();
      await harness.restart();

      await expectServerRestartedInterruption(harness, thread.id, {
        expectInterruptedTurn: true,
      });
      // No zombie provider children: the killed server's providers die on
      // their own once their pipes collapse, and the restarted server must
      // not have adopted them.
      await waitForProcessesGone(providerPids, RECOVERY_TIMEOUT_MS);
      expect(
        (await harness.listServerChildren()).filter(isFakeProviderProcess),
      ).toEqual([]);

      // The thread still works: a fresh turn resumes the provider session.
      await sendTextMessage(harness.api, thread.id, {
        text: "recovered after the crash",
      });
      await waitForThreadOutputContaining(
        harness.api,
        thread.id,
        "recovered after the crash",
        RECOVERY_TIMEOUT_MS,
      );
      await waitForThreadStatus(
        harness.api,
        thread.id,
        "idle",
        RECOVERY_TIMEOUT_MS,
      );
    }));
});
