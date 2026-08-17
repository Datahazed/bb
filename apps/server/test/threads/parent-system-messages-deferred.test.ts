import { and, eq } from "drizzle-orm";
import { events } from "@bb/db";
import { turnRequestEventDataSchema } from "@bb/domain";
import { describe, expect, it } from "vitest";
import {
  countDeferredParentSystemMessages,
  queueParentSystemMessage,
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

// Regression for #1650: a parent blocked on a pending interaction used to drop
// child notifications silently. The message must wait and deliver once the
// interaction settles.
describe("parent system messages while the parent awaits user interaction", () => {
  it("defers the message and delivers it after the interaction settles", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-deferred-parent-message",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/deferred-parent-message",
      });
      const parent = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        title: "Manager",
      });
      seedThreadRuntimeState(harness.deps, {
        threadId: parent.id,
        environmentId: environment.id,
        providerThreadId: "provider-deferred-parent",
        inputText: "Manage things",
        model: "fake-model",
      });
      seedTurnStarted(harness.deps, {
        threadId: parent.id,
        turnId: "turn-deferred-parent",
        providerThreadId: "provider-deferred-parent",
      });
      const registered =
        harness.deps.pendingInteractions.registerPendingInteraction({
          interaction: {
            threadId: parent.id,
            turnId: "turn-deferred-parent",
            providerId: "codex",
            providerThreadId: "provider-deferred-parent",
            providerRequestId: "request-deferred-parent",
            payload: createCommandApprovalPayload({
              itemId: "item-deferred-parent",
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

      const queued = await queueParentSystemMessage(harness.deps, {
        input: textInput("Child finished"),
        parentThreadId: parent.id,
        systemMessageKind: "child-completed",
        systemMessageSubject: null,
      });

      expect(queued).toBe(true);
      expect(countDeferredParentSystemMessages(parent.id)).toBe(1);
      expect(listSystemTurnRequests(harness, parent.id)).toEqual([]);

      harness.deps.pendingInteractions.interruptPendingInteraction({
        interactionId: registered.interaction.id,
        reason: "test-settled",
      });

      await waitFor(
        () => listSystemTurnRequests(harness, parent.id).length === 1,
      );
      expect(listSystemTurnRequests(harness, parent.id)).toEqual([
        "child-completed",
      ]);
      expect(countDeferredParentSystemMessages(parent.id)).toBe(0);
    });
  });
});
