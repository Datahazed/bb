/**
 * Interruption semantics of the Phase 2 thread runtime lifecycle
 * (`interruptActiveThreads` — the path boot reconciliation and the
 * provider-turn watchdog drive). Replaces the queue-era
 * `thread-lifecycle.test.ts` cases "interrupts an active turn with provider
 * state and idles the thread" / "does not mutate an active thread when no
 * active turn exists".
 *
 * Semantic change from the queue era (deliberate, plan §3): every supplied
 * thread now gets a `system/thread/interrupted` event — the old
 * `interruptActiveTurnForThread` no-op'd threads without an open turn, which
 * left restart interruptions invisible in the timeline.
 */
import { describe, expect, it } from "vitest";
import {
  createPendingClientTurnRequestInTransaction,
  getClientTurnRequest,
  listEvents,
} from "@bb/db";
import {
  encodeClientTurnRequestIdNumber,
  type ClientTurnRequestId,
} from "@bb/domain";
import { LOCAL_ENGINE_SESSION_ID } from "../../src/services/hosts/local-host.js";
import { createCommandApprovalPayload } from "../helpers/pending-interactions.js";
import {
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";
import type { TestAppHarness } from "../helpers/test-app.js";
import {
  getSingleEvent,
  requireThreadRow,
  seedActiveThreadWithTurn,
} from "./helpers.js";

function seedPendingClientTurnRequest(
  harness: TestAppHarness,
  args: {
    environmentId: string | null;
    requestEventSequence: number;
    requestId: ClientTurnRequestId;
    threadId: string;
  },
): void {
  harness.db.transaction((tx) => {
    createPendingClientTurnRequestInTransaction(tx, {
      environmentId: args.environmentId,
      requestEventSequence: args.requestEventSequence,
      requestId: args.requestId,
      threadId: args.threadId,
    });
  });
}

describe("thread runtime lifecycle interruption", () => {
  it("interrupts an active turn with provider state and idles the thread", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedActiveThreadWithTurn(harness);

      const result = harness.deps.threadLifecycle.interruptActiveThreads({
        reason: "manual-stop",
        threads: [
          {
            environmentId: fixture.environmentId,
            threadId: fixture.threadId,
          },
        ],
      });

      expect(result.threads).toEqual([
        {
          interruptedTurnId: fixture.turnId,
          threadId: fixture.threadId,
        },
      ]);
      expect(requireThreadRow(harness, fixture.threadId).status).toBe("idle");

      const events = listEvents(harness.db, { threadId: fixture.threadId });
      expect(events.map((event) => event.type)).toEqual([
        "turn/started",
        "turn/completed",
        "system/thread/interrupted",
      ]);

      const turnCompleted = getSingleEvent(events, "turn/completed");
      expect(turnCompleted).toMatchObject({
        environmentId: fixture.environmentId,
        providerThreadId: fixture.providerThreadId,
        scopeKind: "turn",
        turnId: fixture.turnId,
      });
      expect(turnCompleted.data).toBe(
        JSON.stringify({
          providerThreadId: fixture.providerThreadId,
          status: "interrupted",
        }),
      );

      const interrupted = getSingleEvent(events, "system/thread/interrupted");
      expect(interrupted).toMatchObject({
        providerThreadId: null,
        scopeKind: "thread",
        turnId: null,
      });
      expect(interrupted.data).toBe(JSON.stringify({ reason: "manual-stop" }));
    });
  });

  it("appends only the thread interruption when no turn is open", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        status: "active",
      });

      const result = harness.deps.threadLifecycle.interruptActiveThreads({
        reason: "server-restarted",
        threads: [{ environmentId: null, threadId: thread.id }],
      });

      expect(result.threads).toEqual([
        { interruptedTurnId: null, threadId: thread.id },
      ]);
      expect(requireThreadRow(harness, thread.id).status).toBe("idle");
      const events = listEvents(harness.db, { threadId: thread.id });
      expect(events.map((event) => event.type)).toEqual([
        "system/thread/interrupted",
      ]);
      expect(getSingleEvent(events, "system/thread/interrupted").data).toBe(
        JSON.stringify({ reason: "server-restarted" }),
      );
    });
  });

  it("settles pending requests and interactions for server-restarted interruptions", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedActiveThreadWithTurn(harness);
      const requestId = encodeClientTurnRequestIdNumber({ value: 11 });
      seedPendingClientTurnRequest(harness, {
        environmentId: fixture.environmentId,
        requestEventSequence: 11,
        requestId,
        threadId: fixture.threadId,
      });
      const registered =
        harness.deps.pendingInteractions.registerPendingInteraction({
          interaction: {
            threadId: fixture.threadId,
            turnId: fixture.turnId,
            providerId: "codex",
            providerThreadId: fixture.providerThreadId,
            providerRequestId: "request-interrupt-pending",
            payload: createCommandApprovalPayload(),
          },
          sessionId: LOCAL_ENGINE_SESSION_ID,
        });
      if (registered.outcome === "rejected") {
        throw new Error(`Interaction rejected: ${registered.reason}`);
      }

      harness.deps.threadLifecycle.interruptActiveThreads({
        reason: "server-restarted",
        threads: [
          {
            environmentId: fixture.environmentId,
            threadId: fixture.threadId,
          },
        ],
      });

      expect(requireThreadRow(harness, fixture.threadId).status).toBe("idle");
      expect(getClientTurnRequest(harness.db, { requestId })).toMatchObject({
        message: "Server restarted before provider accepted the request",
        reasonCode: "provider_restarted",
        status: "canceled",
      });
      expect(
        harness.deps.pendingInteractions.getThreadInteraction({
          interactionId: registered.interaction.id,
          threadId: fixture.threadId,
        }),
      ).toMatchObject({
        status: "interrupted",
        statusReason: "Server restarted while awaiting user interaction",
      });
    });
  });

  it("routes provider-turn-idle interruptions to error with provider_detached settlements", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedActiveThreadWithTurn(harness);
      const requestId = encodeClientTurnRequestIdNumber({ value: 12 });
      seedPendingClientTurnRequest(harness, {
        environmentId: fixture.environmentId,
        requestEventSequence: 12,
        requestId,
        threadId: fixture.threadId,
      });

      harness.deps.threadLifecycle.interruptActiveThreads({
        reason: "provider-turn-idle",
        threads: [
          {
            environmentId: fixture.environmentId,
            threadId: fixture.threadId,
          },
        ],
      });

      expect(requireThreadRow(harness, fixture.threadId).status).toBe("error");
      expect(getClientTurnRequest(harness.db, { requestId })).toMatchObject({
        reasonCode: "provider_detached",
        status: "failed",
      });
      const events = listEvents(harness.db, { threadId: fixture.threadId });
      expect(getSingleEvent(events, "system/thread/interrupted").data).toBe(
        JSON.stringify({ reason: "provider-turn-idle" }),
      );
    });
  });
});
