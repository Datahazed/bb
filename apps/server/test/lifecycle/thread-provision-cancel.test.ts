/**
 * Provisioning cancellation semantics of the Phase 2 lifecycle modules,
 * driven end to end through the public API (the thread provision pipeline
 * and the environment provision task are real in-memory tasks). Replaces the
 * queue-era `thread-lifecycle.test.ts` cases:
 *
 * - "cancels pending provisioning and finalizes the thread" /
 *   "keeps fetched provisioning stop-requested until host cancellation
 *   settles" → the awaiting-cancel window tests (in-process there is no
 *   pending/fetched split: every provision is in the engine's hands, so a
 *   stop always waits for the engine cancel to settle),
 * - "does not queue a stale start after provisioning stop finalizes" →
 *   late-provision-result-after-cancel,
 * - "stops one shared provisioning thread without cancelling environment
 *   provisioning" → shared-environment stop,
 * - "rejects new co-tenants while provisioning cancellation is active",
 * - "keeps stopped provisioning out of error when failure arrives before
 *   cancel result",
 * - "logs and retries when fetched provisioning cancellation fails" → the
 *   failed engine cancel re-drives the stop, which dispatches a fresh
 *   cancel (the in-process replacement for the queue-era retry sweep).
 *
 * Transport-era cases with no in-process meaning (queue-row state ladders,
 * "recovers stop-requested provisioning through the lifecycle sweep" — boot
 * reconciliation owns that now, see boot-reconciliation.test.ts) died with
 * the queue.
 */
import { describe, expect, it } from "vitest";
import { getClientTurnRequest, getEnvironment, listEvents } from "@bb/db";
import { systemThreadProvisioningEventDataSchema } from "@bb/domain";
import {
  listQueuedEnvironmentCommands,
  listQueuedThreadCommands,
  reportQueuedCommandError,
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
  type QueuedCommand,
} from "../helpers/commands.js";
import { readJson } from "../helpers/json.js";
import { seedHostSession, seedProjectWithSource } from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";
import type { TestAppHarness } from "../helpers/test-app.js";
import {
  getSingleEvent,
  requireThreadRow,
  settleLifecycleWork,
  yieldLifecycleTicks,
  type ListedEvent,
} from "./helpers.js";

interface ProvisioningThreadFixture {
  environmentId: string;
  projectId: string;
  provisionCommand: QueuedCommand;
  threadId: string;
}

const AWAITING_CANCEL_EVENT_TYPES = [
  "client/turn/requested",
  "client/thread/start",
  "system/thread-provisioning",
  "system/thread/interrupted",
  "system/thread-provisioning",
];

function buildProvisionSuccessResult(path: string) {
  return {
    branchName: "bb/cancelled-late",
    defaultBranch: "main",
    isGitRepo: true,
    isWorktree: false,
    path,
    transcript: [],
  };
}

async function createProvisioningThread(
  harness: TestAppHarness,
  args: { path: string },
): Promise<ProvisioningThreadFixture> {
  const { host } = seedHostSession(harness.deps);
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: host.id,
    path: args.path,
  });
  const response = await harness.app.request("/api/v1/threads", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      origin: "app",
      projectId: project.id,
      providerId: "codex",
      model: "gpt-5",
      title: "Provision Cancel",
      input: [{ type: "text", text: "provision then cancel" }],
      environment: {
        type: "host",
        hostId: host.id,
        workspace: { type: "unmanaged", path: args.path },
      },
    }),
  });
  expect(response.status).toBe(201);
  const created = await readJson(response);
  if (
    typeof created !== "object" ||
    created === null ||
    !("id" in created) ||
    typeof created.id !== "string"
  ) {
    throw new Error("Expected a created thread response");
  }
  const threadId = created.id;
  const provisionCommand = await waitForQueuedCommand(
    harness,
    ({ command }) =>
      command.type === "environment.provision" &&
      command.initiator?.threadId === threadId,
  );
  if (provisionCommand.command.type !== "environment.provision") {
    throw new Error("Expected an environment.provision command");
  }
  return {
    environmentId: provisionCommand.command.environmentId,
    projectId: project.id,
    provisionCommand,
    threadId,
  };
}

async function stopThread(
  harness: TestAppHarness,
  threadId: string,
): Promise<void> {
  const response = await harness.app.request(
    `/api/v1/threads/${threadId}/stop`,
    { method: "POST" },
  );
  expect(response.status).toBe(200);
}

function parseProvisioningEvent(event: ListedEvent) {
  return systemThreadProvisioningEventDataSchema.parse(
    JSON.parse(event.data),
  );
}

function readSpawnRequestId(harness: TestAppHarness, threadId: string): string {
  const events = listEvents(harness.db, { threadId });
  const requested = getSingleEvent(events, "client/turn/requested");
  const data: unknown = JSON.parse(requested.data);
  if (
    typeof data !== "object" ||
    data === null ||
    !("requestId" in data) ||
    typeof data.requestId !== "string"
  ) {
    throw new Error("Expected a requestId on the spawn request event");
  }
  return data.requestId;
}

async function waitForCancelCommand(
  harness: TestAppHarness,
  environmentId: string,
  afterCursor = 0,
): Promise<QueuedCommand> {
  return waitForQueuedCommand(
    harness,
    ({ command, row }) =>
      row.cursor > afterCursor &&
      command.type === "environment.provision.cancel" &&
      command.environmentId === environmentId &&
      row.state === "pending",
  );
}

describe("thread provisioning cancellation", () => {
  it("holds the stopping thread in the awaiting-cancel window until the engine cancel settles", async () => {
    await withTestHarness(async (harness) => {
      const fixture = await createProvisioningThread(harness, {
        path: "/tmp/provision-cancel-window",
      });

      await stopThread(harness, fixture.threadId);

      // The awaiting-cancel window: the thread stays `provisioning` with the
      // frozen `stopRequestedAt` wire field populated (plan §4.1) while the
      // engine cancel is in flight.
      expect(requireThreadRow(harness, fixture.threadId)).toMatchObject({
        status: "provisioning",
        stopRequestedAt: expect.any(Number),
      });
      const cancelCommand = await waitForCancelCommand(
        harness,
        fixture.environmentId,
      );

      const events = listEvents(harness.db, { threadId: fixture.threadId });
      expect(events.map((event) => event.type)).toEqual(
        AWAITING_CANCEL_EVENT_TYPES,
      );
      const provisioningEvents = events.filter(
        (event) => event.type === "system/thread-provisioning",
      );
      const started = parseProvisioningEvent(provisioningEvents[0]!);
      const cancelled = parseProvisioningEvent(provisioningEvents[1]!);
      expect(cancelled).toMatchObject({
        environmentId: fixture.environmentId,
        provisioningId: started.provisioningId,
        status: "cancelled",
        entries: [
          {
            type: "step",
            key: "provisioning-stopped",
            text: "Provisioning stopped by user request",
            status: "completed",
          },
        ],
      });
      expect(cancelled.entries[0]?.startedAt).toEqual(expect.any(Number));

      await reportQueuedCommandSuccess(harness, cancelCommand, {
        aborted: true,
      });
      await yieldLifecycleTicks();

      expect(requireThreadRow(harness, fixture.threadId)).toMatchObject({
        status: "idle",
        stopRequestedAt: null,
      });
      // The spawn request's pending row is created at the provision→start
      // handoff; a cancellation that wins before handoff leaves no dangling
      // pending request behind.
      expect(
        getClientTurnRequest(harness.db, {
          requestId: readSpawnRequestId(harness, fixture.threadId),
        }),
      ).toBeNull();

      // The late provision result is ignored: the cancellation outcome wins
      // and no stale start may follow (plan §6 Phase 2).
      await reportQueuedCommandSuccess(
        harness,
        fixture.provisionCommand,
        buildProvisionSuccessResult("/tmp/provision-cancel-window"),
      );
      await settleLifecycleWork(harness);

      expect(requireThreadRow(harness, fixture.threadId)).toMatchObject({
        status: "idle",
        stopRequestedAt: null,
      });
      expect(
        listQueuedThreadCommands(harness, "thread.start", fixture.threadId),
      ).toHaveLength(0);
      // The cancel settlement resolved the environment before the late
      // result arrived; without a provisioned workspace path that is the
      // error state, and the late success must not flip it back to ready.
      expect(
        getEnvironment(harness.db, fixture.environmentId)?.status,
      ).toBe("error");
      expect(
        listEvents(harness.db, { threadId: fixture.threadId }).map(
          (event) => event.type,
        ),
      ).toEqual(AWAITING_CANCEL_EVENT_TYPES);
    });
  });

  it("keeps stopped provisioning out of error when the provision failure lands before the cancel result", async () => {
    await withTestHarness(async (harness) => {
      const fixture = await createProvisioningThread(harness, {
        path: "/tmp/provision-cancel-failure-first",
      });

      await stopThread(harness, fixture.threadId);
      const cancelCommand = await waitForCancelCommand(
        harness,
        fixture.environmentId,
      );

      await reportQueuedCommandError(harness, fixture.provisionCommand, {
        errorCode: "workspace_setup_failed",
        errorMessage: "setup failed",
      });
      await yieldLifecycleTicks();

      // The stop owns the outcome: no error status and no error events for
      // the stop-requested thread, which stays in the awaiting-cancel window.
      expect(requireThreadRow(harness, fixture.threadId)).toMatchObject({
        status: "provisioning",
        stopRequestedAt: expect.any(Number),
      });
      expect(
        listEvents(harness.db, { threadId: fixture.threadId }).map(
          (event) => event.type,
        ),
      ).toEqual(AWAITING_CANCEL_EVENT_TYPES);

      await reportQueuedCommandSuccess(harness, cancelCommand, {
        aborted: true,
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
      ).toEqual(AWAITING_CANCEL_EVENT_TYPES);
    });
  });

  it("stops one shared provisioning thread without cancelling the environment provision", async () => {
    await withTestHarness(async (harness) => {
      const workspacePath = "/tmp/provision-cancel-shared";
      const fixture = await createProvisioningThread(harness, {
        path: workspacePath,
      });
      const dependentResponse = await harness.app.request("/api/v1/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          origin: "app",
          projectId: fixture.projectId,
          providerId: "codex",
          model: "gpt-5",
          title: "Shared Dependent",
          input: [{ type: "text", text: "join the shared provision" }],
          environment: {
            type: "reuse",
            environmentId: fixture.environmentId,
          },
        }),
      });
      expect(dependentResponse.status).toBe(201);
      const dependent = await readJson(dependentResponse);
      if (
        typeof dependent !== "object" ||
        dependent === null ||
        !("id" in dependent) ||
        typeof dependent.id !== "string"
      ) {
        throw new Error("Expected a created dependent thread response");
      }

      await stopThread(harness, dependent.id);
      await yieldLifecycleTicks();

      // The dependent finalizes immediately: another live thread still needs
      // the environment provision, so no engine cancel is dispatched.
      expect(requireThreadRow(harness, dependent.id)).toMatchObject({
        status: "idle",
        stopRequestedAt: null,
      });
      expect(requireThreadRow(harness, fixture.threadId)).toMatchObject({
        status: "provisioning",
        stopRequestedAt: null,
      });
      expect(
        listQueuedEnvironmentCommands(
          harness,
          "environment.provision.cancel",
          fixture.environmentId,
        ),
      ).toHaveLength(0);

      await reportQueuedCommandSuccess(
        harness,
        fixture.provisionCommand,
        buildProvisionSuccessResult(workspacePath),
      );
      const startCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.start" &&
          command.threadId === fixture.threadId,
      );
      await reportQueuedCommandSuccess(harness, startCommand, {
        providerThreadId: "provider-shared-initiator",
      });
      await settleLifecycleWork(harness);

      // Only the surviving initiator started; the stopped co-tenant got no
      // stale start.
      expect(
        listQueuedThreadCommands(harness, "thread.start", dependent.id),
      ).toHaveLength(0);
      expect(
        getEnvironment(harness.db, fixture.environmentId)?.status,
      ).toBe("ready");
    });
  });

  it("rejects new co-tenants while provisioning cancellation is active", async () => {
    await withTestHarness(async (harness) => {
      const fixture = await createProvisioningThread(harness, {
        path: "/tmp/provision-cancel-co-tenant",
      });

      await stopThread(harness, fixture.threadId);
      const cancelCommand = await waitForCancelCommand(
        harness,
        fixture.environmentId,
      );

      const attachResponse = await harness.app.request("/api/v1/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          origin: "app",
          projectId: fixture.projectId,
          providerId: "codex",
          model: "gpt-5",
          input: [{ type: "text", text: "try to join cancelling provision" }],
          environment: {
            type: "reuse",
            environmentId: fixture.environmentId,
          },
        }),
      });
      expect(attachResponse.status).toBe(409);
      await expect(readJson(attachResponse)).resolves.toMatchObject({
        code: "environment_not_ready",
      });

      await reportQueuedCommandSuccess(harness, cancelCommand, {
        aborted: true,
      });
      await reportQueuedCommandError(harness, fixture.provisionCommand, {
        errorCode: "provision_cancelled",
        errorMessage: "provision cancelled",
      });
      await settleLifecycleWork(harness);
      expect(requireThreadRow(harness, fixture.threadId)).toMatchObject({
        status: "idle",
        stopRequestedAt: null,
      });
    });
  });

  it("re-drives the stop with a fresh cancel when the engine cancel fails", async () => {
    await withTestHarness(async (harness) => {
      const fixture = await createProvisioningThread(harness, {
        path: "/tmp/provision-cancel-retry",
      });

      await stopThread(harness, fixture.threadId);
      const firstCancel = await waitForCancelCommand(
        harness,
        fixture.environmentId,
      );

      await reportQueuedCommandError(harness, firstCancel, {
        errorCode: "environment_cancel_failed",
        errorMessage: "cancel failed",
      });

      // The failed cancel re-drives the stop, which dispatches a fresh
      // engine cancel; the stop intent never drops in between.
      const retryCancel = await waitForCancelCommand(
        harness,
        fixture.environmentId,
        firstCancel.row.cursor,
      );
      expect(retryCancel.row.id).not.toBe(firstCancel.row.id);
      expect(requireThreadRow(harness, fixture.threadId)).toMatchObject({
        status: "provisioning",
        stopRequestedAt: expect.any(Number),
      });

      await reportQueuedCommandSuccess(harness, retryCancel, {
        aborted: true,
      });
      await yieldLifecycleTicks();
      expect(requireThreadRow(harness, fixture.threadId)).toMatchObject({
        status: "idle",
        stopRequestedAt: null,
      });

      await reportQueuedCommandError(harness, fixture.provisionCommand, {
        errorCode: "provision_cancelled",
        errorMessage: "provision cancelled",
      });
      await settleLifecycleWork(harness);
      expect(requireThreadRow(harness, fixture.threadId)).toMatchObject({
        status: "idle",
        stopRequestedAt: null,
      });
    });
  });
});
