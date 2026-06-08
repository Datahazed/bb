import {
  provisionHostMock,
  resumeHostMock,
} from "./public-thread-test-harness.js";

import {
  archiveThread,
  createEnvironment,
  createThread,
  events,
  getEnvironment,
  getEnvironmentOperation,
  getThread,
  listThreads,
} from "@bb/db";
import {
  systemErrorEventDataSchema,
  systemOperationEventDataSchema,
  threadSchema,
  turnScope,
  type Thread,
  type WorkspaceProvisionType,
} from "@bb/domain";
import type { HostDaemonCommand } from "@bb/host-daemon-contract";
import {
  environmentArchiveThreadsResponseSchema,
  managerArchiveThreadsResponseSchema,
} from "@bb/server-contract";
import {
  listQueuedEnvironmentCommands,
  listQueuedThreadCommands,
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
  waitForQueuedCommandAfter,
} from "../helpers/commands.js";
import { queueEnvironmentDestroyLifecycleCommand } from "../helpers/lifecycle-commands.js";
import { requestEnvironmentCleanup } from "../../src/services/environments/environment-cleanup-internal.js";
import { readJson } from "../helpers/json.js";
import {
  seedEnvironment,
  seedHost,
  seedHostSession,
  seedProjectWithSource,
  seedEvent,
  seedThread,
  seedThreadFixture,
  seedThreadRuntimeState,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";
import type { TestAppHarness } from "../helpers/test-app.js";
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

interface ManagerWithAssignedChildFixture {
  childThread: Thread;
  managerThread: Thread;
}

type ThreadArchiveCommand = Extract<
  HostDaemonCommand,
  { type: "thread.archive" }
>;
interface ExistingArchiveCommandEnvironment {
  id: string;
  path: string | null;
  workspaceProvisionType: WorkspaceProvisionType;
}

interface QueueExistingNativeArchiveCommandArgs {
  environment: ExistingArchiveCommandEnvironment;
  providerThreadId: string;
  thread: Thread;
}

interface ReportCleanCleanupPreflightForEnvironmentArgs {
  afterCursor?: number;
  environmentId: string;
}

function seedManagerWithAssignedChild(
  harness: TestAppHarness,
): ManagerWithAssignedChildFixture {
  const { host } = seedHostSession(harness.deps);
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: host.id,
  });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
  });
  const managerThread = seedThread(harness.deps, {
    projectId: project.id,
    environmentId: environment.id,
    type: "manager",
  });
  const childThread = seedThread(harness.deps, {
    projectId: project.id,
    parentThreadId: managerThread.id,
  });
  return { childThread, managerThread };
}

function queueExistingNativeArchiveCommand(
  harness: TestAppHarness,
  args: QueueExistingNativeArchiveCommandArgs,
): string {
  if (!args.environment.path) {
    throw new Error("Native archive command fixture requires a workspace path");
  }

  const command: ThreadArchiveCommand = {
    type: "thread.archive",
    environmentId: args.environment.id,
    threadId: args.thread.id,
    workspaceContext: {
      workspacePath: args.environment.path,
      workspaceProvisionType: args.environment.workspaceProvisionType,
    },
    providerId: args.thread.providerId,
    providerThreadId: args.providerThreadId,
  };
  // The dispatch stays in flight (TestEngineRouting holds it) until the test
  // settles it — the engine-seam stand-in for a pending native archive row.
  return harness.deps.engineDispatch.dispatch({ command }).commandId;
}

async function reportCleanCleanupPreflightForEnvironment(
  harness: TestAppHarness,
  args: ReportCleanCleanupPreflightForEnvironmentArgs,
) {
  const command =
    args.afterCursor === undefined
      ? await waitForQueuedCommand(
          harness,
          ({ command }) =>
            command.type === "environment.cleanup_preflight" &&
            command.environmentId === args.environmentId,
        )
      : await waitForQueuedCommandAfter(
          harness,
          args.afterCursor,
          ({ command }) =>
            command.type === "environment.cleanup_preflight" &&
            command.environmentId === args.environmentId,
        );
  await reportQueuedCommandSuccess(harness, command, {
    outcome: "safe_to_destroy",
  });
  return command;
}

describe("public thread archive delete cleanup routes", () => {
  beforeEach(() => {
    provisionHostMock.mockReset();
    resumeHostMock.mockReset();
  });

  it("archives managers by unassigning unarchived child threads", async () => {
    await withTestHarness(async (harness) => {
      const { childThread, managerThread } =
        seedManagerWithAssignedChild(harness);
      const archivedChildThread = seedThread(harness.deps, {
        projectId: managerThread.projectId,
        parentThreadId: managerThread.id,
      });
      archiveThread(harness.db, harness.hub, archivedChildThread.id);

      const response = await harness.app.request(
        `/api/v1/threads/${managerThread.id}/archive`,
        {
          method: "POST",
        },
      );

      expect(response.status).toBe(200);
      expect(getThread(harness.db, managerThread.id)?.archivedAt).toBeTypeOf(
        "number",
      );
      expect(getThread(harness.db, childThread.id)).toMatchObject({
        archivedAt: null,
        parentThreadId: null,
      });
      expect(getThread(harness.db, archivedChildThread.id)).toMatchObject({
        parentThreadId: managerThread.id,
      });

      const storedEvent = harness.db
        .select({ type: events.type, data: events.data })
        .from(events)
        .where(eq(events.threadId, childThread.id))
        .orderBy(events.sequence)
        .all()
        .at(-1);

      expect(storedEvent?.type).toBe("system/operation");
      const parsedData = systemOperationEventDataSchema.parse(
        storedEvent ? JSON.parse(storedEvent.data) : null,
      );
      expect(parsedData).toMatchObject({
        operation: "ownership_change",
        status: "completed",
        message: "Thread released from manager",
        metadata: {
          action: "release",
          previousParentThreadId: managerThread.id,
          nextParentThreadId: null,
        },
      });
    });
  });

  it("archives managers and assigned child threads as a group", async () => {
    await withTestHarness(async (harness) => {
      const host = seedHost(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const managerEnvironment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        managed: true,
        workspaceProvisionType: "managed-worktree",
        path: "/tmp/archive-manager-all",
      });
      const childEnvironment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        managed: true,
        workspaceProvisionType: "managed-worktree",
        path: "/tmp/archive-manager-all-child",
      });
      const managerThread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: managerEnvironment.id,
        type: "manager",
      });
      const childInManagerEnvironment = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: managerEnvironment.id,
        parentThreadId: managerThread.id,
      });
      const childInSharedEnvironment = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: childEnvironment.id,
        parentThreadId: managerThread.id,
      });
      const alreadyArchivedChild = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: childEnvironment.id,
        parentThreadId: managerThread.id,
      });
      archiveThread(harness.db, harness.hub, alreadyArchivedChild.id);
      seedThread(harness.deps, {
        projectId: project.id,
        environmentId: childEnvironment.id,
      });

      const response = await harness.app.request(
        `/api/v1/threads/${managerThread.id}/archive-all`,
        {
          method: "POST",
        },
      );

      expect(response.status).toBe(200);
      const body = managerArchiveThreadsResponseSchema.parse(
        await readJson(response),
      );
      expect(body.archivedThreadIds).toHaveLength(3);
      expect(body.archivedThreadIds).toEqual(
        expect.arrayContaining([
          childInManagerEnvironment.id,
          childInSharedEnvironment.id,
          managerThread.id,
        ]),
      );
      expect(body.archivedThreadIds.at(-1)).toBe(managerThread.id);
      expect(getThread(harness.db, managerThread.id)?.archivedAt).toBeTypeOf(
        "number",
      );
      expect(getThread(harness.db, childInManagerEnvironment.id)).toMatchObject(
        {
          archivedAt: expect.any(Number),
          parentThreadId: managerThread.id,
        },
      );
      expect(getThread(harness.db, childInSharedEnvironment.id)).toMatchObject({
        archivedAt: expect.any(Number),
        parentThreadId: managerThread.id,
      });
      expect(getThread(harness.db, alreadyArchivedChild.id)).toMatchObject({
        parentThreadId: managerThread.id,
      });
      expect(getEnvironment(harness.db, managerEnvironment.id)).toMatchObject({
        cleanupRequestedAt: expect.any(Number),
      });
      expect(
        getEnvironmentOperation(harness.db, {
          environmentId: managerEnvironment.id,
          kind: "destroy",
        }),
      ).toMatchObject({
        kind: "destroy",
      });
      expect(getEnvironment(harness.db, childEnvironment.id)).toMatchObject({
        cleanupRequestedAt: null,
      });
      expect(
        getEnvironmentOperation(harness.db, {
          environmentId: childEnvironment.id,
          kind: "destroy",
        }),
      ).toBeNull();
    });
  });

  it("rejects archive all for non-manager threads", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedThreadFixture(harness);

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/archive-all`,
        {
          method: "POST",
        },
      );

      expect(response.status).toBe(400);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "invalid_request",
      });
      expect(getThread(harness.db, thread.id)?.archivedAt).toBeNull();
    });
  });

  it("rejects deleting managers with assigned child threads unless confirmed", async () => {
    await withTestHarness(async (harness) => {
      const { managerThread } = seedManagerWithAssignedChild(harness);

      const response = await harness.app.request(
        `/api/v1/threads/${managerThread.id}`,
        {
          method: "DELETE",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            managerChildThreadsConfirmed: false,
          }),
        },
      );

      expect(response.status).toBe(409);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "manager_child_threads_confirmation_required",
      });
      expect(getThread(harness.db, managerThread.id)?.deletedAt).toBeNull();
    });
  });

  it("deletes managers with assigned child threads after explicit confirmation", async () => {
    await withTestHarness(async (harness) => {
      const { childThread, managerThread } =
        seedManagerWithAssignedChild(harness);

      const response = await harness.app.request(
        `/api/v1/threads/${managerThread.id}`,
        {
          method: "DELETE",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            managerChildThreadsConfirmed: true,
          }),
        },
      );

      expect(response.status).toBe(200);
      const visibleThreads = listThreads(harness.db, {
        projectId: childThread.projectId,
      });
      expect(
        visibleThreads.some((thread) => thread.id === managerThread.id),
      ).toBe(false);
      expect(getThread(harness.db, childThread.id)).toMatchObject({
        id: childThread.id,
        deletedAt: null,
      });
    });
  });

  it("queues Codex archive forwarding for idle threads", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedThreadFixture(harness, {
        thread: { status: "idle" },
      });
      seedThreadRuntimeState(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "provider-archive-forward",
      });

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/archive`,
        {
          method: "POST",
        },
      );

      expect(response.status).toBe(200);
      expect(
        listQueuedThreadCommands(harness, "thread.archive", thread.id),
      ).toEqual([
        {
          type: "thread.archive",
          environmentId: environment.id,
          threadId: thread.id,
          workspaceContext: {
            workspacePath: environment.path,
            workspaceProvisionType: environment.workspaceProvisionType,
          },
          providerId: "codex",
          providerThreadId: "provider-archive-forward",
        },
      ]);
    });
  });

  it("archives without Codex archive forwarding when the environment is already destroyed", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        managed: true,
        projectId: project.id,
        status: "destroyed",
        workspaceProvisionType: "managed-worktree",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "idle",
      });
      seedThreadRuntimeState(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "provider-destroyed-env-archive",
      });

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/archive`,
        {
          method: "POST",
        },
      );

      expect(response.status).toBe(200);
      expect(getThread(harness.db, thread.id)?.archivedAt).toBeTypeOf("number");
      expect(
        listQueuedThreadCommands(harness, "thread.archive", thread.id),
      ).toEqual([]);
    });
  });

  it("skips duplicate Codex archive forwarding while a native archive command is in flight", async () => {
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
        status: "idle",
      });
      seedThreadRuntimeState(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "provider-existing-native-archive",
      });
      queueExistingNativeArchiveCommand(harness, {
        environment,
        providerThreadId: "provider-existing-native-archive",
        thread,
      });

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/archive`,
        {
          method: "POST",
        },
      );

      expect(response.status).toBe(200);
      expect(
        listQueuedThreadCommands(harness, "thread.archive", thread.id),
      ).toHaveLength(1);
    });
  });

  it("re-forwards Codex archive after a previous native archive command settled", async () => {
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
        status: "idle",
      });
      seedThreadRuntimeState(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "provider-existing-native-archive",
      });
      queueExistingNativeArchiveCommand(harness, {
        environment,
        providerThreadId: "provider-existing-native-archive",
        thread,
      });
      const staged = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.archive" && command.threadId === thread.id,
      );
      await reportQueuedCommandSuccess(harness, staged, {});
      // Wait until the settled dispatch has fully left the in-flight
      // registry; the dedupe below must observe a settled command.
      await harness.deps.engineDispatch.drain();

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/archive`,
        {
          method: "POST",
        },
      );

      expect(response.status).toBe(200);
      // The durable queue also deduped against completed archive commands;
      // the engine's provider-side archive is idempotent, so repeat forwards
      // after settlement are accepted (dispatch-shim semantics).
      expect(
        listQueuedThreadCommands(harness, "thread.archive", thread.id),
      ).toHaveLength(2);
    });
  });

  it("queues Codex archive forwarding after active threads stop", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedThreadFixture(harness, {
        thread: { status: "active" },
      });
      seedThreadRuntimeState(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "provider-active-archive",
      });

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/archive`,
        {
          method: "POST",
        },
      );

      expect(response.status).toBe(200);
      expect(
        listQueuedThreadCommands(harness, "thread.archive", thread.id),
      ).toEqual([]);
      const stopCommand = await waitForQueuedCommand(harness, ({ command }) => {
        return command.type === "thread.stop" && command.threadId === thread.id;
      });

      const stopResponse = await reportQueuedCommandSuccess(
        harness,
        stopCommand,
        {},
      );
      expect(stopResponse.status).toBe(200);

      const archiveCommand = await waitForQueuedCommandAfter(
        harness,
        stopCommand.row.cursor,
        ({ command }) =>
          command.type === "thread.archive" && command.threadId === thread.id,
      );
      expect(archiveCommand.command).toMatchObject({
        type: "thread.archive",
        environmentId: environment.id,
        threadId: thread.id,
        providerId: "codex",
        providerThreadId: "provider-active-archive",
      });
      expect(
        listQueuedThreadCommands(harness, "thread.archive", thread.id),
      ).toHaveLength(1);
    });
  });

  it("queues Codex archive forwarding once when stop finalizes after archive", async () => {
    // Contract: if stop is already in flight when the archive request lands,
    // only stop finalization should forward the native archive command.
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        managed: true,
        path: "/tmp/archive-stop-race",
        projectId: project.id,
        workspaceProvisionType: "managed-worktree",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "active",
      });
      seedThreadRuntimeState(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "provider-archive-stop-race",
      });

      const stopResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/stop`,
        { method: "POST" },
      );
      expect(stopResponse.status).toBe(200);
      const archivePromise = harness.app.request(
        `/api/v1/threads/${thread.id}/archive`,
        {
          method: "POST",
        },
      );
      const archiveResponse = await archivePromise;
      expect(archiveResponse.status).toBe(200);
      expect(
        listQueuedThreadCommands(harness, "thread.archive", thread.id),
      ).toHaveLength(0);

      const stopCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.stop" && command.threadId === thread.id,
      );
      await reportQueuedCommandSuccess(harness, stopCommand, {});

      expect(getThread(harness.db, thread.id)?.archivedAt).toBeTypeOf("number");
      const archiveCommand = await waitForQueuedCommandAfter(
        harness,
        stopCommand.row.cursor,
        ({ command }) =>
          command.type === "thread.archive" && command.threadId === thread.id,
      );
      expect(archiveCommand.command).toMatchObject({
        environmentId: environment.id,
        threadId: thread.id,
      });
      expect(
        listQueuedThreadCommands(harness, "thread.archive", thread.id),
      ).toHaveLength(1);
    });
  });

  it("skips Codex thread archive forwarding when no provider thread id is stored", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedThreadFixture(harness, {
        thread: { status: "idle" },
      });

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/archive`,
        {
          method: "POST",
        },
      );

      expect(response.status).toBe(200);
      await expect(
        waitForQueuedCommand(
          harness,
          ({ command }) =>
            command.type === "thread.archive" && command.threadId === thread.id,
          100,
        ),
      ).rejects.toThrow("Timed out waiting for queued command");
    });
  });

  for (const providerId of ["claude-code", "pi"]) {
    it(`skips archive forwarding for ${providerId} threads`, async () => {
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
          providerId,
          status: "idle",
        });
        seedThreadRuntimeState(harness.deps, {
          threadId: thread.id,
          environmentId: environment.id,
          providerThreadId: `provider-${providerId}-archive-forward`,
        });

        const response = await harness.app.request(
          `/api/v1/threads/${thread.id}/archive`,
          {
            method: "POST",
          },
        );

        expect(response.status).toBe(200);
        await expect(
          waitForQueuedCommand(
            harness,
            ({ command }) =>
              command.type === "thread.archive" &&
              command.threadId === thread.id,
            100,
          ),
        ).rejects.toThrow("Timed out waiting for queued command");
      });
    });
  }

  it("skips Codex archive forwarding when stored events show spawnAgent children", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedThreadFixture(harness, {
        thread: { status: "idle" },
      });
      seedThreadRuntimeState(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "provider-spawn-cascade-risk",
      });
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "provider-spawn-cascade-risk",
        sequence: 3,
        type: "item/completed",
        scope: turnScope("turn-1"),
        data: {
          item: {
            type: "toolCall",
            id: "spawn-1",
            tool: "spawnAgent",
            status: "completed",
            arguments: {
              senderThreadId: "provider-spawn-cascade-risk",
              receiverThreadIds: ["provider-child-1"],
            },
          },
        },
      });

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/archive`,
        {
          method: "POST",
        },
      );

      expect(response.status).toBe(200);
      await expect(
        waitForQueuedCommand(
          harness,
          ({ command }) =>
            command.type === "thread.archive" && command.threadId === thread.id,
          100,
        ),
      ).rejects.toThrow("Timed out waiting for queued command");
    });
  });

  it("queues Codex archive forwarding after releasing live BB child threads", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const parentThread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "idle",
        type: "manager",
      });
      const childThread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        parentThreadId: parentThread.id,
        status: "idle",
      });
      seedThreadRuntimeState(harness.deps, {
        threadId: parentThread.id,
        environmentId: environment.id,
        providerThreadId: "provider-live-child-risk",
      });

      const response = await harness.app.request(
        `/api/v1/threads/${parentThread.id}/archive`,
        {
          method: "POST",
        },
      );

      expect(response.status).toBe(200);
      expect(getThread(harness.db, childThread.id)?.parentThreadId).toBeNull();
      const archiveCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.archive" &&
          command.threadId === parentThread.id,
      );
      expect(archiveCommand.command).toMatchObject({
        providerThreadId: "provider-live-child-risk",
        threadId: parentThread.id,
        type: "thread.archive",
      });
    });
  });

  it("queues Codex unarchive forwarding when the environment is still ready", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedThreadFixture(harness, {
        thread: { status: "idle" },
      });
      seedThreadRuntimeState(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "provider-unarchive-forward",
      });
      archiveThread(harness.db, harness.hub, thread.id);

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/unarchive`,
        { method: "POST" },
      );

      expect(response.status).toBe(200);
      expect(
        listQueuedThreadCommands(harness, "thread.unarchive", thread.id),
      ).toEqual([
        {
          type: "thread.unarchive",
          environmentId: environment.id,
          threadId: thread.id,
          providerId: "codex",
          providerThreadId: "provider-unarchive-forward",
        },
      ]);
    });
  });

  it("blocks follow-up sends while Codex native archive forwarding is pending", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedThreadFixture(harness, {
        thread: { status: "idle" },
      });
      seedThreadRuntimeState(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "provider-pending-native-archive",
      });

      const archiveResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/archive`,
        {
          method: "POST",
        },
      );
      expect(archiveResponse.status).toBe(200);
      expect(
        listQueuedThreadCommands(harness, "thread.archive", thread.id),
      ).toHaveLength(1);

      const unarchiveResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/unarchive`,
        { method: "POST" },
      );
      expect(unarchiveResponse.status).toBe(200);

      const sendResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/send`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            input: [{ type: "text", text: "follow up" }],
            mode: "start",
          }),
        },
      );

      expect(sendResponse.status).toBe(409);
      await expect(readJson(sendResponse)).resolves.toMatchObject({
        code: "thread_archive_in_progress",
      });
    });
  });

  it("skips provider-only Codex unarchive after managed environment cleanup", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        managed: true,
        path: "/tmp/destroyed-managed-worktree",
        status: "destroyed",
        workspaceProvisionType: "managed-worktree",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "idle",
      });
      seedThreadRuntimeState(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "provider-unarchive-cleaned",
      });
      archiveThread(harness.db, harness.hub, thread.id);

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/unarchive`,
        { method: "POST" },
      );

      expect(response.status).toBe(200);
      expect(
        listQueuedThreadCommands(harness, "thread.unarchive", thread.id),
      ).toEqual([]);
    });
  });

  it("cancels pending managed cleanup when a thread is unarchived", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        managed: true,
        path: "/tmp/unarchive-cancels-cleanup",
        workspaceProvisionType: "managed-worktree",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "idle",
      });
      archiveThread(harness.db, harness.hub, thread.id);
      requestEnvironmentCleanup(harness.deps, {
        environmentId: environment.id,
      });

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/unarchive`,
        { method: "POST" },
      );

      expect(response.status).toBe(200);
      expect(getThread(harness.db, thread.id)?.archivedAt).toBeNull();
      expect(getEnvironment(harness.db, environment.id)).toMatchObject({
        cleanupMode: null,
        cleanupRequestedAt: null,
      });
      expect(
        getEnvironmentOperation(harness.db, {
          environmentId: environment.id,
          kind: "destroy",
        }),
      ).toMatchObject({ state: "cancelled" });
    });
  });

  it("rejects unarchive while a managed destroy is in flight", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        managed: true,
        path: "/tmp/unarchive-rejects-fetched-destroy",
        workspaceProvisionType: "managed-worktree",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "idle",
      });

      const archiveResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/archive`,
        {
          method: "POST",
        },
      );
      expect(archiveResponse.status).toBe(200);
      const statusCommand = await reportCleanCleanupPreflightForEnvironment(
        harness,
        {
          environmentId: environment.id,
        },
      );
      const destroyCommand = await waitForQueuedCommandAfter(
        harness,
        statusCommand.row.cursor,
        ({ command }) =>
          command.type === "environment.destroy" &&
          command.environmentId === environment.id,
      );
      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/unarchive`,
        { method: "POST" },
      );

      expect(response.status).toBe(409);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "environment_cleanup_in_progress",
      });
      expect(getThread(harness.db, thread.id)?.archivedAt).toBeTypeOf("number");
      expect(getEnvironment(harness.db, environment.id)?.status).toBe(
        "destroying",
      );

      const destroyResultResponse = await reportQueuedCommandSuccess(
        harness,
        destroyCommand,
        {},
      );
      expect(destroyResultResponse.status).toBe(200);
      expect(getEnvironment(harness.db, environment.id)?.status).toBe(
        "destroyed",
      );
    });
  });

  it("settles destroy success safely when live threads reappear", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        managed: true,
        path: "/tmp/stale-destroy-live-thread",
        status: "destroying",
        workspaceProvisionType: "managed-worktree",
      });
      const liveThread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "idle",
      });
      const queuedRow = queueEnvironmentDestroyLifecycleCommand(harness, {
        environmentId: environment.id,
        command: {
          type: "environment.destroy",
          environmentId: environment.id,
          workspaceContext: {
            workspacePath: "/tmp/stale-destroy-live-thread",
            workspaceProvisionType: "managed-worktree",
          },
        },
      });
      const destroyCommand = await waitForQueuedCommand(
        harness,
        ({ row }) => row.id === queuedRow.id,
      );

      const response = await reportQueuedCommandSuccess(
        harness,
        destroyCommand,
        {},
      );

      expect(response.status).toBe(200);
      expect(getEnvironment(harness.db, environment.id)?.status).toBe(
        "destroyed",
      );
      expect(
        getEnvironmentOperation(harness.db, {
          environmentId: environment.id,
          kind: "destroy",
        }),
      ).toMatchObject({ state: "completed" });
      expect(getThread(harness.db, liveThread.id)).toMatchObject({
        status: "error",
      });
      const latestEvent = harness.db
        .select({ data: events.data, type: events.type })
        .from(events)
        .where(eq(events.threadId, liveThread.id))
        .orderBy(events.sequence)
        .all()
        .at(-1);
      expect(latestEvent?.type).toBe("system/error");
      const eventData = systemErrorEventDataSchema.parse(
        latestEvent ? JSON.parse(latestEvent.data) : null,
      );
      expect(eventData).toMatchObject({
        code: "environment_workspace_destroyed",
        message: expect.stringContaining("destroyed"),
      });
    });
  });

  it("archives dirty managed workspaces and leaves unsafe cleanup pending", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const isolatedManagedEnvironment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        managed: true,
        workspaceProvisionType: "managed-worktree",
        path: "/tmp/archive-managed-dirty",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "active",
      });
      const dirtyThread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: isolatedManagedEnvironment.id,
        status: "idle",
      });

      const stopPromise = harness.app.request(
        `/api/v1/threads/${thread.id}/stop`,
        {
          method: "POST",
        },
      );
      const stopCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.stop" && command.threadId === thread.id,
      );
      await reportQueuedCommandSuccess(harness, stopCommand, {});
      const stopResponse = await stopPromise;
      expect(stopResponse.status).toBe(200);

      const dirtyArchivePromise = harness.app.request(
        `/api/v1/threads/${dirtyThread.id}/archive`,
        {
          method: "POST",
        },
      );
      const dirtyStatusCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "environment.cleanup_preflight" &&
          command.environmentId === isolatedManagedEnvironment.id,
      );
      await reportQueuedCommandSuccess(harness, dirtyStatusCommand, {
        outcome: "blocked_by_changes",
        message: "Workspace has uncommitted or unmerged changes",
      });
      const dirtyArchiveResponse = await dirtyArchivePromise;
      expect(dirtyArchiveResponse.status).toBe(200);
      expect(getThread(harness.db, dirtyThread.id)?.archivedAt).toBeTypeOf(
        "number",
      );
      expect(
        getEnvironment(harness.db, isolatedManagedEnvironment.id),
      ).toMatchObject({
        cleanupMode: "safe",
        cleanupRequestedAt: expect.any(Number),
        status: "ready",
      });
      expect(
        listQueuedEnvironmentCommands(
          harness,
          "environment.destroy",
          isolatedManagedEnvironment.id,
        ),
      ).toEqual([]);

      const archiveResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/archive`,
        {
          method: "POST",
        },
      );
      expect(archiveResponse.status).toBe(200);
      expect(getThread(harness.db, thread.id)?.archivedAt).toBeTypeOf("number");
      await expect(
        waitForQueuedCommandAfter(
          harness,
          dirtyStatusCommand.row.cursor,
          ({ command }) =>
            command.type === "environment.cleanup_preflight" &&
            command.environmentId === environment.id,
          100,
        ),
      ).rejects.toThrow("Timed out waiting for queued command");

      const unarchiveResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/unarchive`,
        {
          method: "POST",
        },
      );
      expect(unarchiveResponse.status).toBe(200);
      expect(getThread(harness.db, thread.id)?.archivedAt).toBeNull();
    });
  });

  it("stops active threads and dispatches thread.stop", async () => {
    await withTestHarness(async (harness) => {
      const host = seedHost(harness.deps);
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

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/stop`,
        {
          method: "POST",
        },
      );

      expect(response.status).toBe(200);
      expect(getThread(harness.db, thread.id)?.stopRequestedAt).toBeTypeOf(
        "number",
      );

      await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.stop" && command.threadId === thread.id,
      );
    });
  });

  it("deletes active threads, queues stop, and hides the tombstone immediately", async () => {
    await withTestHarness(async (harness) => {
      const host = seedHost(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        managed: true,
        workspaceProvisionType: "managed-worktree",
        path: "/tmp/delete-active-offline",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "active",
      });

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}`,
        {
          method: "DELETE",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({ managerChildThreadsConfirmed: false }),
        },
      );

      expect(response.status).toBe(200);
      const deletedThread = getThread(harness.db, thread.id);
      expect(deletedThread?.deletedAt).toBeTypeOf("number");
      expect(deletedThread?.stopRequestedAt).toBeTypeOf("number");
      expect(listThreads(harness.db, { projectId: project.id })).toHaveLength(
        0,
      );

      await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.stop" && command.threadId === thread.id,
      );
    });
  });

  it("deletes idle threads immediately without queueing stop", async () => {
    await withTestHarness(async (harness) => {
      const host = seedHost(harness.deps);
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
        status: "idle",
      });

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}`,
        {
          method: "DELETE",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({ managerChildThreadsConfirmed: false }),
        },
      );

      expect(response.status).toBe(200);
      // Idle deletes finalize immediately in-process: the row is hard-deleted
      // and thread.deleted is forwarded to the engine (the daemon-era
      // offline tombstone deferral died with the transport).
      expect(getThread(harness.db, thread.id)).toBeNull();
      expect(listThreads(harness.db, { projectId: project.id })).toHaveLength(
        0,
      );
      await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.deleted" && command.threadId === thread.id,
      );
      expect(
        harness.engineRouting.dispatched.filter(
          (envelope) =>
            envelope.command.type === "thread.stop" &&
            envelope.command.threadId === thread.id,
        ),
      ).toHaveLength(0);
    });
  });

  it("tombstones created threads that already have thread.start queued", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-delete-created-started",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/delete-created-started",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/delete-created-started",
      });

      const createResponse = await harness.app.request("/api/v1/threads", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          origin: "app",
          projectId: project.id,
          providerId: "codex",
          model: "gpt-5",
          input: [{ type: "text", text: "Start then delete me" }],
          environment: {
            type: "reuse",
            environmentId: environment.id,
          },
        }),
      });

      expect(createResponse.status).toBe(201);
      const createdThread = threadSchema.parse(await readJson(createResponse));
      expect(createdThread.status).toBe("provisioning");

      const queuedStart = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.start" &&
          command.threadId === createdThread.id,
      );

      const deleteResponse = await harness.app.request(
        `/api/v1/threads/${createdThread.id}`,
        {
          method: "DELETE",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({ managerChildThreadsConfirmed: false }),
        },
      );

      expect(deleteResponse.status).toBe(200);
      expect(getThread(harness.db, createdThread.id)).toMatchObject({
        deletedAt: expect.any(Number),
        stopRequestedAt: expect.any(Number),
      });
      expect(listThreads(harness.db, { projectId: project.id })).toHaveLength(
        0,
      );

      const queuedStop = await waitForQueuedCommandAfter(
        harness,
        queuedStart.row.cursor,
        ({ command }) =>
          command.type === "thread.stop" &&
          command.threadId === createdThread.id,
      );
      expect(queuedStop.command).toMatchObject({
        environmentId: environment.id,
        threadId: createdThread.id,
      });
    });
  });

  it("queues thread.stop before cleanup when archiving a created thread with pending start", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-archive-created-start",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/archive-created-start",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        managed: true,
        path: "/tmp/archive-created-start",
        projectId: project.id,
        workspaceProvisionType: "managed-worktree",
      });

      const createResponse = await harness.app.request("/api/v1/threads", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          origin: "app",
          projectId: project.id,
          providerId: "codex",
          model: "gpt-5",
          input: [{ type: "text", text: "Start then archive me" }],
          environment: {
            type: "reuse",
            environmentId: environment.id,
          },
        }),
      });

      expect(createResponse.status).toBe(201);
      const createdThread = threadSchema.parse(await readJson(createResponse));
      expect(createdThread.status).toBe("provisioning");

      const queuedStart = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.start" &&
          command.threadId === createdThread.id,
      );

      const archiveResponse = await harness.app.request(
        `/api/v1/threads/${createdThread.id}/archive`,
        {
          method: "POST",
        },
      );

      expect(archiveResponse.status).toBe(200);
      expect(getThread(harness.db, createdThread.id)).toMatchObject({
        archivedAt: expect.any(Number),
        stopRequestedAt: expect.any(Number),
      });

      const queuedStop = await waitForQueuedCommandAfter(
        harness,
        queuedStart.row.cursor,
        ({ command }) =>
          command.type === "thread.stop" &&
          command.threadId === createdThread.id,
      );
      expect(queuedStop.command).toMatchObject({
        environmentId: environment.id,
        threadId: createdThread.id,
      });

      await expect(
        waitForQueuedCommandAfter(
          harness,
          queuedStop.row.cursor,
          ({ command }) =>
            command.type === "environment.destroy" &&
            command.environmentId === environment.id,
          100,
        ),
      ).rejects.toThrow("Timed out waiting for queued command");
    });
  });

  it("archives every live thread in a worktree environment", async () => {
    await withTestHarness(async (harness) => {
      const host = seedHost(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        managed: true,
        workspaceProvisionType: "managed-worktree",
        path: "/tmp/archive-worktree-row",
      });
      const firstThread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "idle",
      });
      const secondThread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "idle",
      });
      const alreadyArchivedThread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "idle",
      });
      archiveThread(harness.db, harness.hub, alreadyArchivedThread.id);
      const otherEnvironment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        managed: true,
        workspaceProvisionType: "managed-worktree",
        path: "/tmp/archive-worktree-row-other",
      });
      const otherEnvironmentThread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: otherEnvironment.id,
        status: "idle",
      });

      const response = await harness.app.request(
        `/api/v1/environments/${environment.id}/archive-threads`,
        {
          method: "POST",
        },
      );

      expect(response.status).toBe(200);
      const body = environmentArchiveThreadsResponseSchema.parse(
        await readJson(response),
      );
      expect(body.archivedThreadIds).toHaveLength(2);
      expect(body.archivedThreadIds).toEqual(
        expect.arrayContaining([firstThread.id, secondThread.id]),
      );
      expect(getThread(harness.db, firstThread.id)?.archivedAt).toBeTypeOf(
        "number",
      );
      expect(getThread(harness.db, secondThread.id)?.archivedAt).toBeTypeOf(
        "number",
      );
      expect(
        getThread(harness.db, alreadyArchivedThread.id)?.archivedAt,
      ).toBeTypeOf("number");
      expect(
        getThread(harness.db, otherEnvironmentThread.id)?.archivedAt,
      ).toBeNull();
      expect(getEnvironment(harness.db, environment.id)).toMatchObject({
        cleanupRequestedAt: expect.any(Number),
      });
      expect(
        getEnvironmentOperation(harness.db, {
          environmentId: environment.id,
          kind: "destroy",
        }),
      ).toMatchObject({
        kind: "destroy",
      });
    });
  });

  it("archives non-managed worktree threads without requesting cleanup", async () => {
    await withTestHarness(async (harness) => {
      const host = seedHost(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = createEnvironment(harness.db, harness.hub, {
        hostId: host.id,
        projectId: project.id,
        managed: false,
        isGitRepo: true,
        isWorktree: true,
        workspaceProvisionType: "unmanaged",
        path: "/tmp/archive-unmanaged-worktree-row",
        status: "ready",
        branchName: "bb/unmanaged-worktree",
        defaultBranch: "main",
      });
      const firstThread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "idle",
      });
      const secondThread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "idle",
      });

      const response = await harness.app.request(
        `/api/v1/environments/${environment.id}/archive-threads`,
        {
          method: "POST",
        },
      );

      expect(response.status).toBe(200);
      const body = environmentArchiveThreadsResponseSchema.parse(
        await readJson(response),
      );
      expect(body.archivedThreadIds).toHaveLength(2);
      expect(body.archivedThreadIds).toEqual(
        expect.arrayContaining([firstThread.id, secondThread.id]),
      );
      expect(getThread(harness.db, firstThread.id)?.archivedAt).toBeTypeOf(
        "number",
      );
      expect(getThread(harness.db, secondThread.id)?.archivedAt).toBeTypeOf(
        "number",
      );
      expect(getEnvironment(harness.db, environment.id)).toMatchObject({
        cleanupRequestedAt: null,
      });
      expect(
        getEnvironmentOperation(harness.db, {
          environmentId: environment.id,
          kind: "destroy",
        }),
      ).toBeNull();
      expect(
        listQueuedEnvironmentCommands(
          harness,
          "environment.destroy",
          environment.id,
        ),
      ).toHaveLength(0);
    });
  });

  it("rejects environment archive for non-worktree environments", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        workspaceProvisionType: "unmanaged",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "idle",
      });

      const response = await harness.app.request(
        `/api/v1/environments/${environment.id}/archive-threads`,
        {
          method: "POST",
        },
      );

      expect(response.status).toBe(409);
      expect(getThread(harness.db, thread.id)?.archivedAt).toBeNull();
    });
  });

  it("archives shared managed environments without prompting or queueing cleanup", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        managed: true,
        workspaceProvisionType: "managed-worktree",
        path: "/tmp/archive-managed-shared",
      });
      const archivedThread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "idle",
      });
      seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "idle",
      });

      const response = await harness.app.request(
        `/api/v1/threads/${archivedThread.id}/archive`,
        {
          method: "POST",
        },
      );

      expect(response.status).toBe(200);
      expect(getThread(harness.db, archivedThread.id)?.archivedAt).toBeTypeOf(
        "number",
      );
      await expect(
        waitForQueuedCommand(
          harness,
          ({ command }) =>
            command.type === "environment.cleanup_preflight" &&
            command.environmentId === environment.id,
          100,
        ),
      ).rejects.toThrow("Timed out waiting for queued command");
      await expect(
        waitForQueuedCommand(
          harness,
          ({ command }) =>
            command.type === "environment.destroy" &&
            command.environmentId === environment.id,
          100,
        ),
      ).rejects.toThrow("Timed out waiting for queued command");
    });
  });

  it("archives isolated managed environments while disconnected and records deferred safe cleanup", async () => {
    await withTestHarness(async (harness) => {
      const host = seedHost(harness.deps, {
        id: "host-archive-managed-offline",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        managed: true,
        workspaceProvisionType: "managed-worktree",
        path: "/tmp/archive-managed-offline",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "idle",
      });

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/archive`,
        {
          method: "POST",
        },
      );

      expect(response.status).toBe(200);
      expect(getThread(harness.db, thread.id)?.archivedAt).toBeTypeOf("number");
      expect(getEnvironment(harness.db, environment.id)).toMatchObject({
        cleanupMode: "safe",
        cleanupRequestedAt: expect.any(Number),
        status: "ready",
      });
      await expect(
        waitForQueuedCommand(
          harness,
          ({ command }) =>
            command.type === "environment.destroy" &&
            command.environmentId === environment.id,
          100,
        ),
      ).rejects.toThrow("Timed out waiting for queued command");
    });
  });

  it("archives active isolated managed environments without destroying them until stop finalization completes", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-archive-managed-active",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        managed: true,
        workspaceProvisionType: "managed-worktree",
        path: "/tmp/archive-managed-active",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "active",
      });

      const archiveResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/archive`,
        {
          method: "POST",
        },
      );
      expect(archiveResponse.status).toBe(200);

      // Snapshot 1: archive committed, stop in flight, destroy deferred.
      expect(getThread(harness.db, thread.id)?.archivedAt).toBeTypeOf("number");
      expect(getThread(harness.db, thread.id)?.stopRequestedAt).toBeTypeOf(
        "number",
      );
      expect(
        listQueuedEnvironmentCommands(
          harness,
          "environment.destroy",
          environment.id,
        ),
      ).toHaveLength(0);

      const stopCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.stop" && command.threadId === thread.id,
      );
      const stopResultResponse = await reportQueuedCommandSuccess(
        harness,
        stopCommand,
        {},
      );
      expect(stopResultResponse.status).toBe(200);

      await reportCleanCleanupPreflightForEnvironment(harness, {
        afterCursor: stopCommand.row.cursor,
        environmentId: environment.id,
      });
      const destroyCommand = await waitForQueuedCommandAfter(
        harness,
        stopCommand.row.cursor,
        ({ command }) =>
          command.type === "environment.destroy" &&
          command.environmentId === environment.id,
      );
      expect(destroyCommand.command).toMatchObject({
        environmentId: environment.id,
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

  it("preserves safe managed cleanup across active thread stop finalization", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-archive-managed-active-safe",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        managed: true,
        workspaceProvisionType: "managed-worktree",
        path: "/tmp/archive-managed-active-safe",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "active",
      });

      const archiveResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/archive`,
        {
          method: "POST",
        },
      );
      expect(archiveResponse.status).toBe(200);
      expect(getEnvironment(harness.db, environment.id)).toMatchObject({
        cleanupMode: "safe",
        cleanupRequestedAt: expect.any(Number),
        status: "ready",
      });

      const stopCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.stop" && command.threadId === thread.id,
      );

      const stopResultPromise = reportQueuedCommandSuccess(
        harness,
        stopCommand,
        {},
      );
      const stopResultResponse = await stopResultPromise;
      expect(stopResultResponse.status).toBe(200);

      const statusCommand = await reportCleanCleanupPreflightForEnvironment(
        harness,
        {
          afterCursor: stopCommand.row.cursor,
          environmentId: environment.id,
        },
      );
      const destroyCommand = await waitForQueuedCommandAfter(
        harness,
        statusCommand.row.cursor,
        ({ command }) =>
          command.type === "environment.destroy" &&
          command.environmentId === environment.id,
      );
      expect(destroyCommand.command).toMatchObject({
        environmentId: environment.id,
      });
      await expect(
        waitForQueuedCommandAfter(
          harness,
          statusCommand.row.cursor,
          ({ command }) =>
            command.type === "environment.cleanup_preflight" &&
            command.environmentId === environment.id,
          100,
        ),
      ).rejects.toThrow("Timed out waiting for queued command");
    });
  });

  it("queues environment.destroy when deleting the last thread on a managed environment", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        managed: true,
        workspaceProvisionType: "managed-worktree",
        path: "/tmp/delete-managed",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
      });

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}`,
        {
          method: "DELETE",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({ managerChildThreadsConfirmed: false }),
        },
      );
      expect(response.status).toBe(200);

      const statusCommand = await reportCleanCleanupPreflightForEnvironment(
        harness,
        { environmentId: environment.id },
      );
      const destroyCommand = await waitForQueuedCommandAfter(
        harness,
        statusCommand.row.cursor,
        ({ command }) =>
          command.type === "environment.destroy" &&
          command.environmentId === environment.id,
      );
      expect(destroyCommand.command).toMatchObject({
        environmentId: environment.id,
      });
    });
  });

  it("records provisioning managed cleanup intent without queueing an invalid destroy", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = createEnvironment(harness.db, harness.hub, {
        projectId: project.id,
        hostId: host.id,
        path: null,
        managed: true,
        status: "provisioning",
        workspaceProvisionType: "managed-worktree",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
      });

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}`,
        {
          method: "DELETE",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({ managerChildThreadsConfirmed: false }),
        },
      );
      expect(response.status).toBe(200);
      expect(getEnvironment(harness.db, environment.id)).toMatchObject({
        cleanupMode: "safe",
        cleanupRequestedAt: expect.any(Number),
        status: "provisioning",
      });

      const destroyCommands = harness.engineRouting.dispatched.filter(
        (envelope) => envelope.command.type === "environment.destroy",
      );
      expect(destroyCommands).toHaveLength(0);
    });
  });

  it("cleans up managed non-git workspaces without requiring workspace status", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = createEnvironment(harness.db, harness.hub, {
        projectId: project.id,
        hostId: host.id,
        workspaceProvisionType: "personal",
        path: "/tmp/non-git-managed-cleanup",
        managed: true,
        status: "ready",
        isGitRepo: false,
        isWorktree: false,
        branchName: null,
        defaultBranch: null,
      });
      const thread = createThread(harness.db, harness.hub, {
        projectId: project.id,
        environmentId: environment.id,
        providerId: "codex",
        status: "idle",
        title: "Managed non-git thread",
        titleFallback: "Managed non-git thread",
      });

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/archive`,
        {
          method: "POST",
        },
      );

      expect(response.status).toBe(200);
      const destroyCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "environment.destroy" &&
          command.environmentId === environment.id,
      );
      expect(destroyCommand.command).toMatchObject({
        type: "environment.destroy",
        environmentId: environment.id,
        workspaceContext: {
          workspacePath: environment.path,
          workspaceProvisionType: "personal",
        },
      });
      expect(
        listQueuedEnvironmentCommands(
          harness,
          "environment.cleanup_preflight",
          environment.id,
        ),
      ).toHaveLength(0);
    });
  });

  it("continues managed cleanup when cleanup preflight reports not inspectable", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        managed: true,
        workspaceProvisionType: "managed-worktree",
        path: "/tmp/managed-cleanup-not-git",
        isGitRepo: true,
        isWorktree: true,
        defaultBranch: "main",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "idle",
      });

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/archive`,
        {
          method: "POST",
        },
      );

      expect(response.status).toBe(200);
      const statusCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "environment.cleanup_preflight" &&
          command.environmentId === environment.id,
      );
      const statusResponse = await reportQueuedCommandSuccess(
        harness,
        statusCommand,
        {
          outcome: "not_inspectable",
          failure: {
            code: "not_git_repo",
            message:
              "Path is not a git repository: /tmp/managed-cleanup-not-git",
            workspacePath: "/tmp/managed-cleanup-not-git",
          },
        },
      );
      expect(statusResponse.status).toBe(200);

      const destroyCommand = await waitForQueuedCommandAfter(
        harness,
        statusCommand.row.cursor,
        ({ command }) =>
          command.type === "environment.destroy" &&
          command.environmentId === environment.id,
      );
      expect(destroyCommand.command).toMatchObject({
        type: "environment.destroy",
        environmentId: environment.id,
      });
    });
  });

  it("archives non-git threads without requiring workspace status", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = createEnvironment(harness.db, harness.hub, {
        projectId: project.id,
        hostId: host.id,
        workspaceProvisionType: "unmanaged",
        path: "/tmp/non-git-thread",
        status: "ready",
        isGitRepo: false,
        defaultBranch: null,
      });
      const thread = createThread(harness.db, harness.hub, {
        projectId: project.id,
        environmentId: environment.id,
        providerId: "codex",
        status: "idle",
        title: "Non-git thread",
        titleFallback: "Non-git thread",
      });
      const commandCountBefore = harness.engineRouting.dispatched.length;

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/archive`,
        {
          method: "POST",
        },
      );

      expect(response.status).toBe(200);
      expect(getThread(harness.db, thread.id)?.archivedAt).toBeTypeOf("number");
      const commandCountAfter = harness.engineRouting.dispatched.length;
      expect(commandCountAfter).toBe(commandCountBefore);
    });
  });
});
