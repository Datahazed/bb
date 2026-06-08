/**
 * Stop → finalize semantics of the Phase 2 thread runtime lifecycle.
 * Replaces the queue-era `thread-lifecycle.test.ts` cases "finalizes a
 * manually stopped active thread…", "finalizes a stopped active thread with
 * one interrupted turn…", and "stops a created thread without an
 * environment", plus the new in-process behaviors that have no queue-era
 * analogue:
 *
 * - a failed `thread.stop` engine command finalizes anyway (no re-drive
 *   sweep exists; a failed in-process stop means the runtime is gone), and
 * - a stop that lands while a `thread.start` dispatch is in flight is
 *   refused by finalization and re-driven when the start settles (the
 *   in-process replacement for the queue-era stop re-drive sweep).
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
import {
  listQueuedThreadCommands,
  reportQueuedCommandError,
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
} from "../helpers/commands.js";
import { readJson } from "../helpers/json.js";
import {
  seedEnvironment,
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
  settleLifecycleWork,
  yieldLifecycleTicks,
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

describe("thread runtime lifecycle stop and finalize", () => {
  it("keeps stopRequestedAt while thread.stop is in flight and finalizes on settlement", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedActiveThreadWithTurn(harness);

      harness.deps.threadLifecycle.requestStop({
        environmentId: fixture.environmentId,
        reason: "manual-stop",
        stopRequestedAt: null,
        threadId: fixture.threadId,
      });
      // Idempotent while the stop task is live: no second dispatch.
      harness.deps.threadLifecycle.requestStop({
        environmentId: fixture.environmentId,
        reason: "manual-stop",
        stopRequestedAt: requireThreadRow(harness, fixture.threadId)
          .stopRequestedAt,
        threadId: fixture.threadId,
      });

      const stopCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.stop" &&
          command.threadId === fixture.threadId,
      );
      // The frozen FE pending-stop marker stays populated while the stop is
      // in flight (plan §4.1).
      expect(requireThreadRow(harness, fixture.threadId)).toMatchObject({
        status: "active",
        stopRequestedAt: expect.any(Number),
      });
      expect(
        listQueuedThreadCommands(harness, "thread.stop", fixture.threadId),
      ).toHaveLength(1);

      await reportQueuedCommandSuccess(harness, stopCommand, {});
      await settleLifecycleWork(harness);

      expect(requireThreadRow(harness, fixture.threadId)).toMatchObject({
        status: "idle",
        stopRequestedAt: null,
      });
      const events = listEvents(harness.db, { threadId: fixture.threadId });
      expect(events.map((event) => event.type)).toEqual([
        "turn/started",
        "turn/completed",
        "system/thread/interrupted",
      ]);
      expect(getSingleEvent(events, "turn/completed").data).toBe(
        JSON.stringify({
          providerThreadId: fixture.providerThreadId,
          status: "interrupted",
        }),
      );
      expect(getSingleEvent(events, "system/thread/interrupted").data).toBe(
        JSON.stringify({ reason: "manual-stop" }),
      );
    });
  });

  it("finalizes anyway when the engine stop command fails", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedActiveThreadWithTurn(harness);

      harness.deps.threadLifecycle.requestStop({
        environmentId: fixture.environmentId,
        reason: "manual-stop",
        stopRequestedAt: null,
        threadId: fixture.threadId,
      });
      const stopCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.stop" &&
          command.threadId === fixture.threadId,
      );

      await reportQueuedCommandError(harness, stopCommand, {
        errorCode: "thread_stop_failed",
        errorMessage: "runtime is wedged",
      });
      await settleLifecycleWork(harness);

      expect(requireThreadRow(harness, fixture.threadId)).toMatchObject({
        status: "idle",
        stopRequestedAt: null,
      });
      expect(
        listEvents(harness.db, { threadId: fixture.threadId }).map(
          (event) => event.type,
        ),
      ).toEqual(["turn/started", "turn/completed", "system/thread/interrupted"]);
    });
  });

  it("cancels pending client turn requests when finalizing without an open turn", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "active",
      });
      const requestId = encodeClientTurnRequestIdNumber({ value: 10 });
      seedPendingClientTurnRequest(harness, {
        environmentId: environment.id,
        requestEventSequence: 10,
        requestId,
        threadId: thread.id,
      });

      harness.deps.threadLifecycle.requestStop({
        environmentId: environment.id,
        reason: "manual-stop",
        stopRequestedAt: null,
        threadId: thread.id,
      });
      const stopCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.stop" && command.threadId === thread.id,
      );
      await reportQueuedCommandSuccess(harness, stopCommand, {});
      await settleLifecycleWork(harness);

      expect(requireThreadRow(harness, thread.id)).toMatchObject({
        status: "idle",
        stopRequestedAt: null,
      });
      expect(getClientTurnRequest(harness.db, { requestId })).toMatchObject({
        message: "Thread stopped before provider accepted the request",
        reasonCode: "runtime_canceled",
        status: "canceled",
      });
      expect(
        listEvents(harness.db, { threadId: thread.id }).map(
          (event) => event.type,
        ),
      ).toEqual(["system/thread/interrupted"]);
    });
  });

  it("stops a created thread without an environment synchronously", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const thread = seedThread(harness.deps, {
        environmentId: null,
        projectId: project.id,
        status: "created",
      });

      harness.deps.threadLifecycle.requestStopForCurrentState(
        {
          environmentId: null,
          id: thread.id,
          status: thread.status,
          stopRequestedAt: thread.stopRequestedAt,
        },
        null,
      );

      expect(requireThreadRow(harness, thread.id)).toMatchObject({
        status: "idle",
        stopRequestedAt: null,
      });
      const events = listEvents(harness.db, { threadId: thread.id });
      expect(events.map((event) => event.type)).toEqual([
        "system/thread/interrupted",
      ]);
      expect(getSingleEvent(events, "system/thread/interrupted").data).toBe(
        JSON.stringify({ reason: "manual-stop" }),
      );
      // The whole stop ran in-process without engine work.
      expect(harness.engineRouting.dispatched).toHaveLength(0);
    });
  });

  it("re-drives a stop that landed while thread.start was in flight", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        path: "/tmp/thread-stop-redrive",
        projectId: project.id,
      });

      const createResponse = await harness.app.request("/api/v1/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          origin: "app",
          projectId: project.id,
          providerId: "codex",
          model: "gpt-5",
          title: "Stop During Start",
          input: [{ type: "text", text: "start then stop" }],
          environment: {
            type: "reuse",
            environmentId: environment.id,
          },
        }),
      });
      expect(createResponse.status).toBe(201);
      const created = await readJson(createResponse);
      if (
        typeof created !== "object" ||
        created === null ||
        !("id" in created) ||
        typeof created.id !== "string"
      ) {
        throw new Error("Expected a created thread response");
      }
      const threadId = created.id;
      const startCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.start" && command.threadId === threadId,
      );

      const stopResponse = await harness.app.request(
        `/api/v1/threads/${threadId}/stop`,
        { method: "POST" },
      );
      expect(stopResponse.status).toBe(200);
      const stopCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.stop" && command.threadId === threadId,
      );
      expect(requireThreadRow(harness, threadId)).toMatchObject({
        status: "provisioning",
        stopRequestedAt: expect.any(Number),
      });

      // The stop settles first; finalization is refused while the start task
      // owns the thread, so the stop intent stays recorded. (No drain here:
      // the start dispatch is deliberately still in flight.)
      await reportQueuedCommandSuccess(harness, stopCommand, {});
      await yieldLifecycleTicks();
      expect(requireThreadRow(harness, threadId)).toMatchObject({
        status: "provisioning",
        stopRequestedAt: expect.any(Number),
      });

      // The settled start re-drives the lost stop and finalizes it.
      await reportQueuedCommandSuccess(harness, startCommand, {
        providerThreadId: "provider-stop-redrive",
      });
      await settleLifecycleWork(harness);

      expect(requireThreadRow(harness, threadId)).toMatchObject({
        status: "idle",
        stopRequestedAt: null,
      });
      const events = listEvents(harness.db, { threadId });
      expect(
        events.filter((event) => event.type === "system/thread/interrupted"),
      ).toHaveLength(1);
      // Exactly one engine stop was ever dispatched: the re-drive finalizes
      // in-process instead of re-dispatching.
      expect(
        listQueuedThreadCommands(harness, "thread.stop", threadId),
      ).toHaveLength(1);
    });
  });
});
