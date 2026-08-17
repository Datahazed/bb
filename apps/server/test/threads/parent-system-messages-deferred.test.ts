import { and, eq } from "drizzle-orm";
import {
  countDeferredParentSystemMessages,
  createDeferredParentSystemMessage,
  events,
} from "@bb/db";
import { turnRequestEventDataSchema } from "@bb/domain";
import { describe, expect, it } from "vitest";
import {
  queueParentSystemMessage,
  runDeferredParentSystemMessageSweep,
} from "../../src/services/threads/parent-system-messages.js";
import { createCommandApprovalPayload } from "../helpers/pending-interactions.js";
import { textInput } from "../helpers/prompt-input.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedThreadRuntimeState,
  seedTurnStarted,
} from "../helpers/seed.js";
import { createTestAppHarness, withTestHarness } from "../helpers/test-app.js";

type TestHarness = Awaited<ReturnType<typeof createTestAppHarness>>;

function listSystemTurnRequests(
  harness: TestHarness,
  parentThreadId: string,
): string[] {
  return harness.db
    .select()
    .from(events)
    .where(
      and(
        eq(events.threadId, parentThreadId),
        eq(events.type, "client/turn/requested"),
      ),
    )
    .orderBy(events.sequence)
    .all()
    .flatMap((row) => {
      const data = turnRequestEventDataSchema.parse(JSON.parse(row.data));
      return data.initiator === "system"
        ? [data.systemMessageKind ?? "unlabeled"]
        : [];
    });
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 4_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for condition");
}

// A parent/manager thread with a ready environment and runtime state, blocked
// on a pending command approval.
function seedBlockedParent(harness: TestHarness, hostId: string) {
  const { host } = seedHostSession(harness.deps, { id: hostId });
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: host.id,
  });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
    path: `/tmp/${hostId}`,
  });
  const parent = seedThread(harness.deps, {
    projectId: project.id,
    environmentId: environment.id,
    title: "Manager",
  });
  seedThreadRuntimeState(harness.deps, {
    threadId: parent.id,
    environmentId: environment.id,
    providerThreadId: `provider-${hostId}`,
    inputText: "Manage things",
    model: "fake-model",
  });
  seedTurnStarted(harness.deps, {
    threadId: parent.id,
    turnId: `turn-${hostId}`,
    providerThreadId: `provider-${hostId}`,
  });
  const registered =
    harness.deps.pendingInteractions.registerPendingInteraction({
      interaction: {
        threadId: parent.id,
        turnId: `turn-${hostId}`,
        providerId: "codex",
        providerThreadId: `provider-${hostId}`,
        providerRequestId: `request-${hostId}`,
        payload: createCommandApprovalPayload({
          itemId: `item-${hostId}`,
          reason: "Approve command",
          command: "git push",
          cwd: "/tmp/project",
        }),
      },
    });
  if (registered.outcome === "rejected") {
    throw new Error(
      `Expected interaction registration to succeed: ${registered.reason}`,
    );
  }
  return { parent, interactionId: registered.interaction.id };
}

// Regression for #1650: a parent blocked on a pending interaction used to drop
// child notifications silently. The message must wait and deliver once the
// interaction settles.
describe("parent system messages while the parent awaits user interaction", () => {
  it("defers the message and delivers it after the interaction settles", async () => {
    await withTestHarness(async (harness) => {
      const { parent, interactionId } = seedBlockedParent(
        harness,
        "host-deferred-parent-message",
      );

      const queued = await queueParentSystemMessage(harness.deps, {
        input: textInput("Child finished"),
        parentThreadId: parent.id,
        systemMessageKind: "child-completed",
        systemMessageSubject: null,
      });

      expect(queued).toBe(true);
      expect(countDeferredParentSystemMessages(harness.db, parent.id)).toBe(1);
      expect(listSystemTurnRequests(harness, parent.id)).toEqual([]);

      harness.deps.pendingInteractions.interruptPendingInteraction({
        interactionId,
        reason: "test-settled",
      });

      await waitFor(
        () => listSystemTurnRequests(harness, parent.id).length === 1,
      );
      expect(listSystemTurnRequests(harness, parent.id)).toEqual([
        "child-completed",
      ]);
      expect(countDeferredParentSystemMessages(harness.db, parent.id)).toBe(0);
    });
  });

  // A server restart loses in-memory state but not SQLite rows. A row that
  // exists when the sweep runs must still deliver once nothing blocks the parent.
  it("keeps deferred rows while blocked and delivers them once unblocked", async () => {
    await withTestHarness(async (harness) => {
      const { parent, interactionId } = seedBlockedParent(
        harness,
        "host-deferred-parent-sweep",
      );
      createDeferredParentSystemMessage(harness.db, {
        input: textInput("Child finished before restart"),
        parentThreadId: parent.id,
        systemMessageKind: "child-completed",
        systemMessageSubject: null,
      });

      // Still blocked: the sweep must leave the row alone.
      await runDeferredParentSystemMessageSweep(harness.deps);
      expect(countDeferredParentSystemMessages(harness.db, parent.id)).toBe(1);
      expect(listSystemTurnRequests(harness, parent.id)).toEqual([]);

      harness.deps.pendingInteractions.interruptPendingInteraction({
        interactionId,
        reason: "test-settled",
      });
      await waitFor(
        () => listSystemTurnRequests(harness, parent.id).length === 1,
      );
      expect(countDeferredParentSystemMessages(harness.db, parent.id)).toBe(0);
    });
  });

  it("delivers rows the sweep finds on an unblocked parent, as after a restart", async () => {
    await withTestHarness(async (harness) => {
      const { parent, interactionId } = seedBlockedParent(
        harness,
        "host-deferred-parent-restart",
      );
      harness.deps.pendingInteractions.interruptPendingInteraction({
        interactionId,
        reason: "server-restarted",
      });
      // The row outlived the process that deferred it; no settle event will
      // fire for it again.
      createDeferredParentSystemMessage(harness.db, {
        input: textInput("Child finished before restart"),
        parentThreadId: parent.id,
        systemMessageKind: "child-failed",
        systemMessageSubject: null,
      });

      await runDeferredParentSystemMessageSweep(harness.deps);

      expect(listSystemTurnRequests(harness, parent.id)).toEqual([
        "child-failed",
      ]);
      expect(countDeferredParentSystemMessages(harness.db, parent.id)).toBe(0);
    });
  });
});
