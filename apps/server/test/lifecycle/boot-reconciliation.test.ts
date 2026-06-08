/**
 * Boot reconciliation matrix (plan §3, Decisions 1/2): the in-memory
 * lifecycle world's whole crash-durability story, asserted at the database
 * level against seeded pre-crash state. The process-level kill-9 matrix
 * (real SIGKILL + restart of a real server) lives in
 * `tests/integration/fake/recovery/`.
 *
 * Replaces the queue-era `thread-lifecycle.test.ts` case "recovers
 * stop-requested provisioning through the lifecycle sweep": the re-drive
 * sweeps are gone, and boot reconciliation is the single recovery pass.
 */
import { describe, expect, it } from "vitest";
import {
  createPendingClientTurnRequestInTransaction,
  environments,
  getClientTurnRequest,
  getEnvironment,
  getThread,
  listEvents,
  markThreadDeleted,
  markThreadStopRequested,
  terminalSessions,
} from "@bb/db";
import {
  recordEnvironmentCleanupRequest,
  setEnvironmentStatus,
} from "@bb/db/internal-environment-lifecycle";
import {
  encodeClientTurnRequestIdNumber,
  systemThreadProvisioningEventDataSchema,
  threadScope,
  type ClientTurnRequestId,
} from "@bb/domain";
import { eq } from "drizzle-orm";
import { runBootReconciliation } from "../../src/services/lifecycle/boot-reconciliation.js";
import { LOCAL_ENGINE_SESSION_ID } from "../../src/services/hosts/local-host.js";
import {
  listQueuedEnvironmentCommands,
  listQueuedThreadCommands,
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
} from "../helpers/commands.js";
import { createCommandApprovalPayload } from "../helpers/pending-interactions.js";
import {
  seedEnvironment,
  seedEvent,
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
} from "./helpers.js";

function runBoot(harness: TestAppHarness): void {
  runBootReconciliation({
    deps: harness.deps,
    environmentLifecycle: harness.deps.environmentLifecycle,
    projectLifecycle: harness.deps.projectLifecycle,
    threadLifecycle: harness.deps.threadLifecycle,
  });
}

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

function seedTerminalSession(
  harness: TestAppHarness,
  args: {
    environmentId: string;
    id: string;
    status: "starting" | "running" | "disconnected" | "exited";
    threadId: string;
  },
): void {
  const now = Date.now();
  harness.db
    .insert(terminalSessions)
    .values({
      cols: 80,
      createdAt: now,
      currentCwd: null,
      environmentId: args.environmentId,
      hostId: "local",
      id: args.id,
      initialCwd: "/tmp",
      rows: 24,
      status: args.status,
      threadId: args.threadId,
      title: "Terminal",
      updatedAt: now,
      ...(args.status === "exited" ? { exitedAt: now } : {}),
    })
    .run();
}

describe("boot reconciliation", () => {
  it("marks open terminal sessions exited", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedActiveThreadWithTurn(harness);
      for (const [index, status] of (
        ["starting", "running", "disconnected", "exited"] as const
      ).entries()) {
        seedTerminalSession(harness, {
          environmentId: fixture.environmentId,
          id: `term-${index}-${status}`,
          status,
          threadId: fixture.threadId,
        });
      }

      runBoot(harness);

      const sessions = harness.db.select().from(terminalSessions).all();
      expect(sessions).toHaveLength(4);
      for (const session of sessions) {
        expect(session.status).toBe("exited");
        expect(session.exitedAt).toEqual(expect.any(Number));
      }
      // The frozen wire value the FE zod schema already accepts (plan §4.2
      // dead-value rule) — an honest 'server-restarted' close reason would
      // be a frontend schema change.
      expect(
        sessions
          .filter((session) => session.id !== "term-3-exited")
          .map((session) => session.closeReason),
      ).toEqual([
        "daemon-disconnect",
        "daemon-disconnect",
        "daemon-disconnect",
      ]);
    });
  });

  it("interrupts active threads with server-restarted and settles their pending work", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedActiveThreadWithTurn(harness);
      const requestId = encodeClientTurnRequestIdNumber({ value: 21 });
      seedPendingClientTurnRequest(harness, {
        environmentId: fixture.environmentId,
        requestEventSequence: 21,
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
            providerRequestId: "request-boot-interrupt",
            payload: createCommandApprovalPayload(),
          },
          sessionId: LOCAL_ENGINE_SESSION_ID,
        });
      if (registered.outcome === "rejected") {
        throw new Error(`Interaction rejected: ${registered.reason}`);
      }

      runBoot(harness);

      expect(requireThreadRow(harness, fixture.threadId)).toMatchObject({
        status: "idle",
        stopRequestedAt: null,
      });
      const events = listEvents(harness.db, { threadId: fixture.threadId });
      // The interaction registration appended its own item events; assert
      // the interruption sequence among them.
      expect(
        events
          .map((event) => event.type)
          .filter((type) =>
            ["turn/started", "turn/completed", "system/thread/interrupted"].includes(
              type,
            ),
          ),
      ).toEqual(["turn/started", "turn/completed", "system/thread/interrupted"]);
      expect(getSingleEvent(events, "turn/completed").data).toBe(
        JSON.stringify({
          providerThreadId: fixture.providerThreadId,
          status: "interrupted",
        }),
      );
      expect(getSingleEvent(events, "system/thread/interrupted").data).toBe(
        JSON.stringify({ reason: "server-restarted" }),
      );
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

  it("fails provisioning environments and threads with the standard error events", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        status: "provisioning",
      });
      const thread = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
        status: "provisioning",
      });
      const provisioningId = "tpv-boot-fail";
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        sequence: 1,
        type: "system/thread-provisioning",
        scope: threadScope(),
        data: {
          provisioningId,
          status: "active",
          environmentId: environment.id,
          entries: [],
        },
      });

      runBoot(harness);

      expect(getEnvironment(harness.db, environment.id)?.status).toBe("error");
      expect(requireThreadRow(harness, thread.id).status).toBe("error");

      const events = listEvents(harness.db, { threadId: thread.id });
      expect(events.map((event) => event.type)).toEqual([
        "system/thread-provisioning",
        "system/thread-provisioning",
        "system/error",
      ]);
      // The failure entry closes the crashed pipeline's open transcript: the
      // provisioningId is recovered from the latest provisioning event.
      const failed = systemThreadProvisioningEventDataSchema.parse(
        JSON.parse(events[1]!.data),
      );
      expect(failed).toMatchObject({
        provisioningId,
        status: "failed",
        entries: [
          {
            type: "step",
            key: "workspace-failed",
            text: "Workspace setup failed",
            status: "failed",
          },
        ],
      });
      const error = getSingleEvent(events, "system/error");
      expect(JSON.parse(error.data)).toMatchObject({
        code: "thread_provisioning_failed",
        message: "Provisioning thread failed",
        detail: "Server restarted while the workspace was provisioning",
      });
    });
  });

  it("finalizes stop-requested provisioning threads instead of failing them", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        status: "provisioning",
      });
      const thread = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
        status: "provisioning",
      });
      markThreadStopRequested(harness.db, harness.hub, {
        requestedAt: 123,
        threadId: thread.id,
      });

      runBoot(harness);

      // The user's stop completes through the boot pass: idle, intent
      // cleared, interruption event appended — never the error path.
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
    });
  });

  it("restores destroying environments and preserves durable cleanup intent", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const withPath = seedEnvironment(harness.deps, {
        hostId: host.id,
        managed: true,
        path: "/tmp/boot-destroying",
        projectId: project.id,
        workspaceProvisionType: "managed-worktree",
        mergeBaseBranch: "main",
      });
      recordEnvironmentCleanupRequest(harness.db, harness.hub, withPath.id, {
        requestedAt: 456,
      });
      setEnvironmentStatus(harness.db, harness.hub, withPath.id, {
        status: "destroying",
      });
      const withoutPath = seedEnvironment(harness.deps, {
        hostId: host.id,
        managed: true,
        projectId: project.id,
        workspaceProvisionType: "managed-worktree",
      });
      harness.db
        .update(environments)
        .set({ path: null })
        .where(eq(environments.id, withoutPath.id))
        .run();
      setEnvironmentStatus(harness.db, harness.hub, withoutPath.id, {
        status: "destroying",
      });

      runBoot(harness);

      // The cleanup intent survives so the kicked advance (and the product
      // sweep) re-drive the destroy: preflight → destroy → destroyed.
      expect(getEnvironment(harness.db, withPath.id)).toMatchObject({
        cleanupMode: "safe",
        cleanupRequestedAt: 456,
        status: "ready",
      });
      expect(getEnvironment(harness.db, withoutPath.id)?.status).toBe("error");

      const preflight = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "environment.cleanup_preflight" &&
          command.environmentId === withPath.id,
      );
      await reportQueuedCommandSuccess(harness, preflight, {
        outcome: "safe_to_destroy",
      });
      const destroy = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "environment.destroy" &&
          command.environmentId === withPath.id,
      );
      await reportQueuedCommandSuccess(harness, destroy, {});
      await settleLifecycleWork(harness);

      expect(getEnvironment(harness.db, withPath.id)?.status).toBe(
        "destroyed",
      );
    });
  });

  it("drains tombstoned threads with the engine notification and cleanup request", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        managed: true,
        path: "/tmp/boot-tombstone",
        projectId: project.id,
        workspaceProvisionType: "managed-worktree",
        mergeBaseBranch: "main",
      });
      const thread = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
        status: "idle",
      });
      markThreadDeleted(harness.db, harness.hub, { threadId: thread.id });

      runBoot(harness);

      expect(getThread(harness.db, thread.id)).toBeNull();
      const deletedCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.deleted" && command.threadId === thread.id,
      );
      await reportQueuedCommandSuccess(harness, deletedCommand, {});
      expect(
        listQueuedThreadCommands(harness, "thread.deleted", thread.id),
      ).toHaveLength(1);
      expect(getEnvironment(harness.db, environment.id)).toMatchObject({
        cleanupMode: "safe",
        cleanupRequestedAt: expect.any(Number),
      });
      // The detached cleanup advance kicked by the drain runs the preflight.
      const preflight = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "environment.cleanup_preflight" &&
          command.environmentId === environment.id,
      );
      await reportQueuedCommandSuccess(harness, preflight, {
        outcome: "safe_to_destroy",
      });
      const destroy = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "environment.destroy" &&
          command.environmentId === environment.id,
      );
      await reportQueuedCommandSuccess(harness, destroy, {});
      await settleLifecycleWork(harness);
      expect(getEnvironment(harness.db, environment.id)?.status).toBe(
        "destroyed",
      );
    });
  });

  it("settles dangling pending client turn requests on threads that never went active", async () => {
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
        environmentId: environment.id,
        projectId: project.id,
        status: "idle",
      });
      const requestId = encodeClientTurnRequestIdNumber({ value: 31 });
      seedPendingClientTurnRequest(harness, {
        environmentId: environment.id,
        requestEventSequence: 31,
        requestId,
        threadId: thread.id,
      });

      runBoot(harness);

      expect(getClientTurnRequest(harness.db, { requestId })).toMatchObject({
        message: "Server restarted before provider accepted the request",
        reasonCode: "provider_restarted",
        status: "canceled",
      });
      // The idle thread itself is untouched.
      expect(requireThreadRow(harness, thread.id).status).toBe("idle");
      expect(
        listEvents(harness.db, { threadId: thread.id }),
      ).toEqual([]);
    });
  });

  it("re-derives pending managed cleanup for settled environments at boot", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        managed: true,
        path: "/tmp/boot-cleanup-rederive",
        projectId: project.id,
        workspaceProvisionType: "managed-worktree",
        mergeBaseBranch: "main",
      });
      recordEnvironmentCleanupRequest(
        harness.db,
        harness.hub,
        environment.id,
        {},
      );

      runBoot(harness);

      const preflight = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "environment.cleanup_preflight" &&
          command.environmentId === environment.id,
      );
      await reportQueuedCommandSuccess(harness, preflight, {
        outcome: "safe_to_destroy",
      });
      const destroy = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "environment.destroy" &&
          command.environmentId === environment.id,
      );
      await reportQueuedCommandSuccess(harness, destroy, {});
      await settleLifecycleWork(harness);

      expect(getEnvironment(harness.db, environment.id)).toMatchObject({
        cleanupMode: null,
        cleanupRequestedAt: null,
        status: "destroyed",
      });
      expect(
        listQueuedEnvironmentCommands(
          harness,
          "environment.destroy",
          environment.id,
        ),
      ).toHaveLength(1);
    });
  });
});
