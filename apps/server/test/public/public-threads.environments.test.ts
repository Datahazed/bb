import {
  provisionHostMock,
  resumeHostMock,
} from "./public-thread-test-harness.js";

import {
  archiveThread,
  createPendingInteraction,
  events,
  getEnvironment,
  getThread,
  listThreads,
} from "@bb/db";
import { PERSONAL_PROJECT_ID, threadSchema } from "@bb/domain";
import { threadListResponseSchema } from "@bb/server-contract";
import {
  reportQueuedCommandSuccess,
  reportQueuedCommandError,
  waitForQueuedCommand,
  waitForQueuedCommandAfter,
} from "../helpers/commands.js";
import { readJson } from "../helpers/json.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedThreadRuntimeState,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { resolvePersonalTargetPath } from "../../src/services/threads/worktree-paths.js";

const CHECKOUT_BLOCKING_THREAD_STATUSES = [
  "active",
  "idle",
  "provisioning",
  "created",
] as const;

const CHECKOUT_PREFLIGHT_FAILURES = [
  {
    errorCode: "checkout_dirty",
    errorMessage:
      "Cannot checkout branch while the workspace has uncommitted changes",
    path: "/tmp/dirty-unmanaged-checkout",
  },
  {
    errorCode: "checkout_conflicts",
    errorMessage:
      "Cannot checkout branch while the workspace has unresolved conflicts",
    path: "/tmp/conflicted-unmanaged-checkout",
  },
] as const;

interface CreatePersonalThreadRequestArgs {
  text: string;
}

describe("public thread environment routes", () => {
  beforeEach(() => {
    provisionHostMock.mockReset();
    resumeHostMock.mockReset();
  });

  it("creates personal project threads with a personal environment", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);

      const response = await harness.app.request("/api/v1/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          origin: "app",
          projectId: PERSONAL_PROJECT_ID,
          input: [{ type: "text", text: "Start without a project" }],
          environment: {
            type: "host",
            workspace: { type: "personal" },
          },
        }),
      });

      expect(response.status).toBe(201);
      const thread = threadSchema.parse(await readJson(response));
      expect(thread.projectId).toBe(PERSONAL_PROJECT_ID);
      expect(thread.environmentId).not.toBeNull();
      const environmentId = thread.environmentId;
      if (environmentId === null) {
        throw new Error("Expected a personal environment");
      }
      // Personal workspaces live in the server's own data dir now (plan §3).
      const targetPath = resolvePersonalTargetPath({
        dataDir: harness.config.dataDir,
        environmentId,
      });
      expect(getEnvironment(harness.db, environmentId)).toMatchObject({
        hostId: host.id,
        managed: true,
        path: null,
        projectId: PERSONAL_PROJECT_ID,
        status: "provisioning",
        workspaceProvisionType: "personal",
      });

      const queuedProvision = await waitForQueuedCommand(
        harness,
        (candidate) =>
          candidate.command.type === "environment.provision" &&
          candidate.command.environmentId === environmentId,
      );
      expect(queuedProvision.command).toMatchObject({
        environmentId,
        targetPath,
        workspaceProvisionType: "personal",
      });

      const provisionResult = await reportQueuedCommandSuccess(
        harness,
        queuedProvision,
        {
          branchName: null,
          defaultBranch: null,
          isGitRepo: false,
          isWorktree: false,
          path: targetPath,
          transcript: [],
        },
      );
      expect(provisionResult.status).toBe(200);

      const queuedStart = await waitForQueuedCommandAfter(
        harness,
        queuedProvision.row.cursor,
        (candidate) =>
          candidate.command.type === "thread.start" &&
          candidate.command.threadId === thread.id,
      );
      if (queuedStart.command.type !== "thread.start") {
        throw new Error("Expected thread.start command");
      }
      expect(queuedStart.command.environmentId).toBe(environmentId);
      expect(queuedStart.command.workspaceContext).toEqual({
        workspacePath: targetPath,
        workspaceProvisionType: "personal",
      });
      expect(queuedStart.command.threadStoragePath).toBeUndefined();
    });
  });

  it("creates a fresh personal environment for each root personal thread", async () => {
    await withTestHarness(async (harness) => {
      seedHostSession(harness.deps, {
        id: "host-personal-root-fresh-env",
      });

      const createPersonalThread = async (
        args: CreatePersonalThreadRequestArgs,
      ) => {
        const response = await harness.app.request("/api/v1/threads", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            origin: "app",
            projectId: PERSONAL_PROJECT_ID,
            providerId: "codex",
            model: "gpt-5",
            input: [{ type: "text", text: args.text }],
            environment: {
              type: "host",
              workspace: { type: "personal" },
            },
          }),
        });
        expect(response.status).toBe(201);
        return threadSchema.parse(await readJson(response));
      };

      const firstThread = await createPersonalThread({
        text: "First personal root",
      });
      const secondThread = await createPersonalThread({
        text: "Second personal root",
      });

      expect(firstThread.parentThreadId).toBeNull();
      expect(secondThread.parentThreadId).toBeNull();
      expect(firstThread.environmentId).not.toBeNull();
      expect(secondThread.environmentId).not.toBeNull();
      expect(firstThread.environmentId).not.toBe(secondThread.environmentId);
    });
  });

  it("reuses a personal manager environment for personal child threads", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-personal-manager-child-reuse",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        isGitRepo: false,
        isWorktree: false,
        managed: true,
        path: "/tmp/personal-manager-child-reuse",
        projectId: PERSONAL_PROJECT_ID,
        workspaceProvisionType: "personal",
      });
      const managerThread = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: PERSONAL_PROJECT_ID,
        title: "Personal manager",
        type: "manager",
      });

      const response = await harness.app.request("/api/v1/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          origin: "app",
          projectId: PERSONAL_PROJECT_ID,
          parentThreadId: managerThread.id,
          providerId: "codex",
          model: "gpt-5",
          input: [{ type: "text", text: "Use the manager scratch space" }],
          environment: {
            type: "host",
            hostId: host.id,
            workspace: { type: "personal" },
          },
        }),
      });

      expect(response.status).toBe(201);
      const childThread = threadSchema.parse(await readJson(response));
      expect(childThread.parentThreadId).toBe(managerThread.id);
      expect(childThread.environmentId).toBe(environment.id);
    });
  });

  it("sends personal project follow-ups in their personal environment", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-personal-thread-send",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        isGitRepo: false,
        isWorktree: false,
        managed: true,
        path: "/tmp/personal-thread-send",
        projectId: PERSONAL_PROJECT_ID,
        workspaceProvisionType: "personal",
      });
      const thread = seedThread(harness.deps, {
        projectId: PERSONAL_PROJECT_ID,
        environmentId: environment.id,
        status: "idle",
      });
      seedThreadRuntimeState(harness.deps, {
        environmentId: environment.id,
        providerThreadId: "provider-personal-send",
        threadId: thread.id,
      });

      const detailResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}`,
      );
      expect(detailResponse.status).toBe(200);
      expect(
        threadSchema.parse(await readJson(detailResponse)).environmentId,
      ).toBe(environment.id);

      const sendResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/send`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            mode: "auto",
            input: [
              { type: "text", text: "Follow up in a personal workspace" },
            ],
          }),
        },
      );
      expect(sendResponse.status).toBe(200);

      const queued = await waitForQueuedCommand(
        harness,
        (candidate) =>
          candidate.command.type === "turn.submit" &&
          candidate.command.threadId === thread.id,
      );
      if (queued.command.type !== "turn.submit") {
        throw new Error("Expected turn.submit command");
      }
      expect(queued.command.environmentId).toBe(environment.id);
      expect(queued.command.resumeContext.workspaceContext).toEqual({
        workspacePath: environment.path,
        workspaceProvisionType: "personal",
      });

      const turnRequestEvents = harness.db
        .select()
        .from(events)
        .where(eq(events.threadId, thread.id))
        .all()
        .filter((event) => event.type === "client/turn/requested");
      expect(turnRequestEvents.at(-1)?.environmentId).toBe(environment.id);
    });
  });

  it("stops and archives personal project threads in their environment", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-personal-thread-stop-archive",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        isGitRepo: false,
        isWorktree: false,
        managed: true,
        path: "/tmp/personal-thread-stop-archive",
        projectId: PERSONAL_PROJECT_ID,
        workspaceProvisionType: "personal",
      });
      const stopThread = seedThread(harness.deps, {
        projectId: PERSONAL_PROJECT_ID,
        environmentId: environment.id,
        status: "active",
      });
      const archiveTarget = seedThread(harness.deps, {
        projectId: PERSONAL_PROJECT_ID,
        environmentId: environment.id,
        status: "active",
      });

      const stopResponse = await harness.app.request(
        `/api/v1/threads/${stopThread.id}/stop`,
        { method: "POST" },
      );
      expect(stopResponse.status).toBe(200);
      const stopCommand = await waitForQueuedCommand(
        harness,
        (candidate) =>
          candidate.command.type === "thread.stop" &&
          candidate.command.threadId === stopThread.id,
      );
      if (stopCommand.command.type !== "thread.stop") {
        throw new Error("Expected thread.stop command");
      }
      expect(stopCommand.command.environmentId).toBe(environment.id);

      const archiveResponse = await harness.app.request(
        `/api/v1/threads/${archiveTarget.id}/archive`,
        { method: "POST" },
      );
      expect(archiveResponse.status).toBe(200);
      expect(getThread(harness.db, archiveTarget.id)?.archivedAt).toBeTypeOf(
        "number",
      );
      const archiveStopCommand = await waitForQueuedCommand(
        harness,
        (candidate) =>
          candidate.command.type === "thread.stop" &&
          candidate.command.threadId === archiveTarget.id,
      );
      if (archiveStopCommand.command.type !== "thread.stop") {
        throw new Error("Expected thread.stop command");
      }
      expect(archiveStopCommand.command.environmentId).toBe(environment.id);
    });
  });

  it("rejects mismatched project and workspace combinations", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-personal-thread-mismatch",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });

      const standardWithPersonalWorkspace = await harness.app.request(
        "/api/v1/threads",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            origin: "app",
            projectId: project.id,
            input: [{ type: "text", text: "Invalid standard request" }],
            environment: {
              type: "host",
              hostId: host.id,
              workspace: { type: "personal" },
            },
          }),
        },
      );
      expect(standardWithPersonalWorkspace.status).toBe(400);

      const personalWithWorkspace = await harness.app.request(
        "/api/v1/threads",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            origin: "app",
            projectId: PERSONAL_PROJECT_ID,
            input: [{ type: "text", text: "Invalid personal request" }],
            environment: {
              type: "host",
              hostId: host.id,
              workspace: { type: "unmanaged", path: "/tmp/nope" },
            },
          }),
        },
      );
      expect(personalWithWorkspace.status).toBe(400);

      const personalStandardEnvironment = seedEnvironment(harness.deps, {
        hostId: host.id,
        path: "/tmp/personal-standard-reuse",
        projectId: PERSONAL_PROJECT_ID,
        workspaceProvisionType: "unmanaged",
      });
      const personalWithStandardReuse = await harness.app.request(
        "/api/v1/threads",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            origin: "app",
            projectId: PERSONAL_PROJECT_ID,
            input: [{ type: "text", text: "Invalid personal reuse" }],
            environment: {
              type: "reuse",
              environmentId: personalStandardEnvironment.id,
            },
          }),
        },
      );
      expect(personalWithStandardReuse.status).toBe(409);

      const standardPersonalEnvironment = seedEnvironment(harness.deps, {
        hostId: host.id,
        isGitRepo: false,
        isWorktree: false,
        managed: true,
        path: "/tmp/standard-personal-reuse",
        projectId: project.id,
        workspaceProvisionType: "personal",
      });
      const standardWithPersonalReuse = await harness.app.request(
        "/api/v1/threads",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            origin: "app",
            projectId: project.id,
            providerId: "codex",
            model: "gpt-5",
            input: [{ type: "text", text: "Invalid standard reuse" }],
            environment: {
              type: "reuse",
              environmentId: standardPersonalEnvironment.id,
            },
          }),
        },
      );
      expect(standardWithPersonalReuse.status).toBe(409);
      await expect(readJson(standardWithPersonalReuse)).resolves.toMatchObject({
        code: "invalid_request",
        message: "Standard project threads cannot reuse personal workspaces",
      });
    });
  });

  it("lists threads across projects when projectId is omitted", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-thread-list-all",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const standardThread = seedThread(harness.deps, {
        projectId: project.id,
      });
      const personalThread = seedThread(harness.deps, {
        projectId: PERSONAL_PROJECT_ID,
      });

      const allResponse = await harness.app.request("/api/v1/threads");
      expect(allResponse.status).toBe(200);
      const allThreads = threadListResponseSchema.parse(
        await readJson(allResponse),
      );
      expect(allThreads.map((thread) => thread.id)).toEqual(
        expect.arrayContaining([standardThread.id, personalThread.id]),
      );

      const projectResponse = await harness.app.request(
        `/api/v1/threads?projectId=${project.id}`,
      );
      expect(projectResponse.status).toBe(200);
      const projectThreads = threadListResponseSchema.parse(
        await readJson(projectResponse),
      );
      expect(projectThreads.map((thread) => thread.id)).toEqual([
        standardThread.id,
      ]);
    });
  });

  it("includes hasPendingInteraction in thread list responses", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/thread-list-pending",
      });
      const firstThread = seedThread(harness.deps, {
        projectId: project.id,
        providerId: "codex",
      });
      const secondThread = seedThread(harness.deps, {
        projectId: project.id,
        providerId: "codex",
      });

      createPendingInteraction(harness.db, {
        payload: "{}",
        providerId: "codex",
        providerRequestId: "request-1",
        providerThreadId: "provider-thread-1",
        sessionId: "session-1",
        threadId: firstThread.id,
        turnId: "turn_1",
      });

      const response = await harness.app.request(
        `/api/v1/threads?projectId=${project.id}&archived=false`,
      );

      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: secondThread.id,
            hasPendingInteraction: false,
          }),
          expect.objectContaining({
            id: firstThread.id,
            hasPendingInteraction: true,
          }),
        ]),
      );
    });
  });

  it("includes archived managed child threads in archived thread lists", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/thread-list-archived-managed",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        path: "/tmp/thread-list-archived-managed/environment",
        projectId: project.id,
      });
      const managerThread = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
        title: "Manager thread",
        type: "manager",
      });
      const managedThread = seedThread(harness.deps, {
        environmentId: environment.id,
        parentThreadId: managerThread.id,
        projectId: project.id,
        title: "Managed archived thread",
      });
      const rootThread = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
        title: "Root archived thread",
      });
      const liveManagedThread = seedThread(harness.deps, {
        environmentId: environment.id,
        parentThreadId: managerThread.id,
        projectId: project.id,
        title: "Live managed thread",
      });

      archiveThread(harness.db, harness.deps.hub, managedThread.id);
      archiveThread(harness.db, harness.deps.hub, rootThread.id);

      const response = await harness.app.request(
        `/api/v1/threads?projectId=${project.id}&archived=true`,
      );

      expect(response.status).toBe(200);
      const body = threadListResponseSchema.parse(await readJson(response));
      expect(body).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: managedThread.id,
            parentThreadId: managerThread.id,
          }),
          expect.objectContaining({
            id: rootThread.id,
            parentThreadId: null,
          }),
        ]),
      );
      expect(body.map((thread) => thread.id)).not.toContain(
        liveManagedThread.id,
      );
    });
  });

  it("includes environmentWorkspaceDisplayKind in thread list responses", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/thread-list-environment-kind",
      });
      const directEnvironment = seedEnvironment(harness.deps, {
        hostId: host.id,
        path: "/tmp/thread-list-environment-kind/direct",
        projectId: project.id,
        workspaceProvisionType: "unmanaged",
      });
      const worktreeEnvironment = seedEnvironment(harness.deps, {
        hostId: host.id,
        path: "/tmp/thread-list-environment-kind/worktree",
        projectId: project.id,
        workspaceProvisionType: "managed-worktree",
      });
      const directThread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: directEnvironment.id,
      });
      const worktreeThread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: worktreeEnvironment.id,
      });
      const response = await harness.app.request(
        `/api/v1/threads?projectId=${project.id}&archived=false`,
      );

      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: directThread.id,
            environmentHostId: host.id,
            environmentBranchName: "bb/test",
            environmentWorkspaceDisplayKind: "other",
          }),
          expect.objectContaining({
            id: worktreeThread.id,
            environmentHostId: host.id,
            environmentBranchName: "bb/test",
            environmentWorkspaceDisplayKind: "managed-worktree",
          }),
        ]),
      );
    });
  });

  it("includes runtime display state for active thread list entries", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-thread-list-runtime",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/thread-list-runtime",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        path: "/tmp/thread-list-runtime/environment",
        projectId: project.id,
      });
      const firstThread = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
        status: "active",
      });
      const secondThread = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
        status: "active",
      });

      const response = await harness.app.request(
        `/api/v1/threads?projectId=${project.id}&archived=false`,
      );

      expect(response.status).toBe(200);
      const body = threadListResponseSchema.parse(await readJson(response));
      expect(body).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: firstThread.id,
            runtime: {
              displayStatus: "active",
              hostReconnectGraceExpiresAt: null,
            },
          }),
          expect.objectContaining({
            id: secondThread.id,
            runtime: {
              displayStatus: "active",
              hostReconnectGraceExpiresAt: null,
            },
          }),
        ]),
      );
    });
  });

  it("reuses the ready unmanaged environment for the default source path", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project, source } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/shared-unmanaged-project",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: source.path,
        status: "ready",
      });

      const response = await harness.app.request("/api/v1/threads", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          origin: "app",
          projectId: project.id,
          providerId: "codex",
          model: "gpt-5",
          input: [
            { type: "text", text: "Reuse the existing direct workspace" },
          ],
          environment: {
            type: "host",
            hostId: host.id,
            workspace: {
              type: "unmanaged",
              path: null,
            },
          },
        }),
      });

      expect(response.status).toBe(201);
      const createdThread = threadSchema.parse(await readJson(response));
      expect(createdThread).toMatchObject({
        environmentId: environment.id,
        status: "provisioning",
      });

      const queuedStart = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.start" &&
          command.environmentId === environment.id &&
          command.threadId === createdThread.id,
      );
      expect(queuedStart.command).toMatchObject({
        workspaceContext: {
          workspacePath: source.path,
          workspaceProvisionType: "unmanaged",
        },
        options: {
          model: "gpt-5",
          serviceTier: "default",
          reasoningLevel: "medium",
          permissionMode: "full",
          permissionEscalation: null,
        },
      });
      expect(getThread(harness.db, createdThread.id)).toMatchObject({
        type: "standard",
        parentThreadId: null,
      });

      const provisionCommands = harness.engineRouting.dispatched.filter(
        (envelope) => envelope.command.type === "environment.provision",
      );
      expect(provisionCommands).toHaveLength(0);
    });
  });

  it("reconciles explicit branch checkout before starting a thread on an existing unmanaged environment", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project, source } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/reconcile-unmanaged-project",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: source.path,
        status: "ready",
      });

      const response = await harness.app.request("/api/v1/threads", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          origin: "app",
          projectId: project.id,
          providerId: "codex",
          model: "gpt-5",
          input: [{ type: "text", text: "Start after checkout" }],
          environment: {
            type: "host",
            hostId: host.id,
            workspace: {
              type: "unmanaged",
              path: null,
              branch: { kind: "existing", name: "feature/reconcile" },
            },
          },
        }),
      });

      expect(response.status).toBe(201);
      const createdThread = threadSchema.parse(await readJson(response));
      expect(createdThread).toMatchObject({
        environmentId: environment.id,
        status: "provisioning",
      });

      const queuedProvision = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "environment.provision" &&
          command.environmentId === environment.id,
      );
      expect(queuedProvision.command).toMatchObject({
        environmentId: environment.id,
        path: source.path,
        workspaceProvisionType: "unmanaged",
        checkout: { kind: "existing", name: "feature/reconcile" },
      });
      expect(getEnvironment(harness.db, environment.id)?.status).toBe(
        "provisioning",
      );
      expect(
        harness.engineRouting.dispatched.filter(
          (envelope) => envelope.command.type === "thread.start",
        ),
      ).toHaveLength(0);

      const result = await reportQueuedCommandSuccess(
        harness,
        queuedProvision,
        {
          branchName: "feature/reconcile",
          defaultBranch: "main",
          isGitRepo: true,
          isWorktree: false,
          path: source.path,
          transcript: [],
        },
      );
      expect(result.status).toBe(200);

      const queuedStart = await waitForQueuedCommandAfter(
        harness,
        queuedProvision.row.cursor,
        ({ command }) =>
          command.type === "thread.start" &&
          command.environmentId === environment.id &&
          command.threadId === createdThread.id,
      );
      expect(queuedStart.command).toMatchObject({
        workspaceContext: {
          workspacePath: source.path,
          workspaceProvisionType: "unmanaged",
        },
      });
      expect(getEnvironment(harness.db, environment.id)).toMatchObject({
        branchName: "feature/reconcile",
        status: "ready",
      });
    });
  });

  it.each(CHECKOUT_PREFLIGHT_FAILURES)(
    "fails unmanaged checkout provisioning without starting the thread when preflight fails with $errorCode",
    async ({ errorCode, errorMessage, path }) => {
      await withTestHarness(async (harness) => {
        const { host } = seedHostSession(harness.deps);
        const { project, source } = seedProjectWithSource(harness.deps, {
          hostId: host.id,
          path,
        });
        const environment = seedEnvironment(harness.deps, {
          hostId: host.id,
          projectId: project.id,
          path: source.path,
          status: "ready",
        });

        const response = await harness.app.request("/api/v1/threads", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            origin: "app",
            projectId: project.id,
            providerId: "codex",
            model: "gpt-5",
            input: [{ type: "text", text: "Preflight failure" }],
            environment: {
              type: "host",
              hostId: host.id,
              workspace: {
                type: "unmanaged",
                path: null,
                branch: { kind: "existing", name: "feature/preflight" },
              },
            },
          }),
        });
        expect(response.status).toBe(201);
        const createdThread = threadSchema.parse(await readJson(response));
        const queuedProvision = await waitForQueuedCommand(
          harness,
          ({ command }) =>
            command.type === "environment.provision" &&
            command.environmentId === environment.id,
        );

        const result = await reportQueuedCommandError(
          harness,
          queuedProvision,
          {
            errorCode,
            errorMessage,
          },
        );
        expect(result.status).toBe(200);
        expect(getThread(harness.db, createdThread.id)?.status).toBe("error");
        expect(
          harness.engineRouting.dispatched.filter(
            (envelope) => envelope.command.type === "thread.start",
          ),
        ).toHaveLength(0);
      });
    },
  );

  it.each(CHECKOUT_BLOCKING_THREAD_STATUSES)(
    "blocks explicit branch checkout when another thread is %s in the unmanaged environment",
    async (status) => {
      await withTestHarness(async (harness) => {
        const { host } = seedHostSession(harness.deps);
        const { project, source } = seedProjectWithSource(harness.deps, {
          hostId: host.id,
          path: "/tmp/active-unmanaged-project",
        });
        const environment = seedEnvironment(harness.deps, {
          hostId: host.id,
          projectId: project.id,
          path: source.path,
          status: "ready",
        });
        seedThread(harness.deps, {
          environmentId: environment.id,
          projectId: project.id,
          status,
        });

        const response = await harness.app.request("/api/v1/threads", {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            origin: "app",
            projectId: project.id,
            providerId: "codex",
            model: "gpt-5",
            input: [{ type: "text", text: "Try branch checkout" }],
            environment: {
              type: "host",
              hostId: host.id,
              workspace: {
                type: "unmanaged",
                path: null,
                branch: { kind: "existing", name: "feature/blocked" },
              },
            },
          }),
        });

        expect(response.status).toBe(409);
        await expect(readJson(response)).resolves.toMatchObject({
          code: "invalid_request",
          message:
            "Cannot checkout branch while another thread is using this workspace",
        });
        expect(listThreads(harness.db, { projectId: project.id })).toHaveLength(
          1,
        );
        expect(
          harness.engineRouting.dispatched.filter(
            (envelope) => envelope.command.type === "environment.provision",
          ),
        ).toHaveLength(0);
      });
    },
  );

  it("attaches new threads to an in-flight unmanaged environment without reprovisioning", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project, source } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/inflight-unmanaged-project",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: source.path,
        status: "provisioning",
      });

      const response = await harness.app.request("/api/v1/threads", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          origin: "app",
          projectId: project.id,
          providerId: "codex",
          model: "gpt-5",
          input: [
            { type: "text", text: "Wait for the existing provisioning flow" },
          ],
          environment: {
            type: "host",
            hostId: host.id,
            workspace: {
              type: "unmanaged",
              path: null,
            },
          },
        }),
      });

      expect(response.status).toBe(201);
      await expect(readJson(response)).resolves.toMatchObject({
        environmentId: environment.id,
        status: "provisioning",
      });

      expect(harness.engineRouting.dispatched).toHaveLength(0);
    });
  });

  it("reuses an existing environment when requested", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/reuse-project",
      });

      const response = await harness.app.request("/api/v1/threads", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          origin: "app",
          projectId: project.id,
          providerId: "codex",
          model: "gpt-5",
          input: [{ type: "text", text: "Reuse the environment" }],
          environment: {
            type: "reuse",
            environmentId: environment.id,
          },
        }),
      });

      expect(response.status).toBe(201);
      await expect(readJson(response)).resolves.toMatchObject({
        environmentId: environment.id,
        status: "provisioning",
      });
    });
  });

});
