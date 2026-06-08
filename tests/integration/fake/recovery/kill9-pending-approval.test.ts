/**
 * Kill-9 matrix: SIGKILL with a pending user interaction (plan §8). Boot
 * reconciliation interrupts the orphaned active thread AND its pending
 * interaction — the restarted server can never deliver the answer to a
 * runtime that died with the old process.
 */
import { describe, expect, it } from "vitest";
import {
  isUserQuestionPendingInteractionPayload,
  pendingInteractionSchema,
} from "@bb/domain";
import { listThreadInteractions, sendTextMessage } from "../../helpers/api.js";
import { waitForEventType } from "../../helpers/assertions.js";
import {
  withCrashServerHarness,
  type CrashServerHarness,
} from "../../helpers/crash-server.js";
import {
  createCrashThread,
  expectServerRestartedInterruption,
  TURN_TIMEOUT_MS,
} from "./shared.js";

async function getInteractionById(
  harness: CrashServerHarness,
  threadId: string,
  interactionId: string,
) {
  const response = await harness.api.threads[":id"].interactions[
    ":interactionId"
  ].$get({
    param: { id: threadId, interactionId },
  });
  expect(response.status).toBe(200);
  return pendingInteractionSchema.parse(await response.json());
}

describe.sequential("kill-9 boot reconciliation: pending approval", () => {
  it("interrupts the pending interaction alongside the thread", () =>
    withCrashServerHarness({}, async (harness) => {
      const { thread } = await createCrashThread(
        harness,
        "Kill9 Pending Approval",
      );

      await sendTextMessage(harness.api, thread.id, { text: "ask_user" });
      await waitForEventType(
        harness.api,
        thread.id,
        "system/userQuestion/lifecycle",
        TURN_TIMEOUT_MS,
      );
      const interactions = await listThreadInteractions(
        harness.api,
        thread.id,
      );
      const pending = interactions.find((interaction) =>
        isUserQuestionPendingInteractionPayload(interaction.payload),
      );
      if (!pending) {
        throw new Error("Expected a pending user-question interaction");
      }
      expect(pending.status).toBe("pending");

      await harness.crash();
      await harness.restart();

      await expectServerRestartedInterruption(harness, thread.id, {
        expectInterruptedTurn: true,
      });
      // Nothing is awaiting the user anymore…
      expect(await listThreadInteractions(harness.api, thread.id)).toEqual([]);
      // …and the interaction record carries the restart interruption.
      expect(
        await getInteractionById(harness, thread.id, pending.id),
      ).toMatchObject({
        status: "interrupted",
        statusReason: "Server restarted while awaiting user interaction",
      });
    }));
});
