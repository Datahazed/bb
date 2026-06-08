import { setTimeout as sleep } from "node:timers/promises";
import { eq } from "drizzle-orm";
import {
  environments,
  events,
  getThread,
  transitionThreadStatus,
} from "@bb/db";
import { threadSchema } from "@bb/domain";
import { describe, expect, it } from "vitest";
import {
  requireManagedWorktreeEnvironmentProvisionQueuedCommand,
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
  waitForQueuedCommandAfter,
} from "../helpers/commands.js";
import { readJson } from "../helpers/json.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { type TestAppHarness, withTestHarness } from "../helpers/test-app.js";

interface WaitForThreadStatusArgs {
  status: string;
  threadId: string;
  timeoutMs?: number;
}

async function waitForThreadStatus(
  harness: TestAppHarness,
  args: WaitForThreadStatusArgs,
): Promise<void> {
  const deadline = Date.now() + (args.timeoutMs ?? 1_000);
  while (Date.now() < deadline) {
    if (getThread(harness.db, args.threadId)?.status === args.status) {
      return;
    }
    await sleep(10);
  }
  throw new Error(
    `Timed out waiting for thread ${args.threadId} to be ${args.status}`,
  );
}

describe("public thread lifecycle regressions", () => {
  it("uses unique branch names for same-title managed worktree threads", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/branch-unique",
      });

      const firstResponse = await harness.app.request("/api/v1/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          origin: "app",
          projectId: project.id,
          providerId: "codex",
          model: "gpt-5",
          title: "Worker Thread",
          input: [{ type: "text", text: "Implement the worker task" }],
          environment: {
            type: "host",
            hostId: host.id,
            workspace: {
              type: "managed-worktree",
              baseBranch: { kind: "default" },
            },
          },
        }),
      });
      expect(firstResponse.status).toBe(201);
      const firstThread = await readJson(firstResponse);
      const firstProvision = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "environment.provision",
      );

      const secondResponse = await harness.app.request("/api/v1/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          origin: "app",
          projectId: project.id,
          providerId: "codex",
          model: "gpt-5",
          title: "Worker Thread",
          input: [{ type: "text", text: "Implement the worker task again" }],
          environment: {
            type: "host",
            hostId: host.id,
            workspace: {
              type: "managed-worktree",
              baseBranch: { kind: "default" },
            },
          },
        }),
      });
      expect(secondResponse.status).toBe(201);
      const secondThread = await readJson(secondResponse);
      const secondProvision = await waitForQueuedCommandAfter(
        harness,
        firstProvision.row.cursor,
        ({ command }) => command.type === "environment.provision",
      );

      expect(firstThread).toMatchObject({ id: expect.any(String) });
      expect(secondThread).toMatchObject({ id: expect.any(String) });
      if (
        typeof firstThread !== "object" ||
        !firstThread ||
        !("id" in firstThread) ||
        typeof firstThread.id !== "string" ||
        typeof secondThread !== "object" ||
        !secondThread ||
        !("id" in secondThread) ||
        typeof secondThread.id !== "string"
      ) {
        throw new Error("Thread creation response shape was invalid");
      }
      const firstManagedProvision =
        requireManagedWorktreeEnvironmentProvisionQueuedCommand(firstProvision);
      const secondManagedProvision =
        requireManagedWorktreeEnvironmentProvisionQueuedCommand(
          secondProvision,
        );

      expect(firstManagedProvision.command.branchName).toBe(
        `bb/worker-thread-${firstThread.id}`,
      );
      expect(secondManagedProvision.command.branchName).toBe(
        `bb/worker-thread-${secondThread.id}`,
      );
      expect(firstManagedProvision.command.branchName).not.toBe(
        secondManagedProvision.command.branchName,
      );
    });
  });

  it("queues a managed worktree follow-up without provisioning the primary checkout", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project, source } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/managed-send",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: `${source.path}/.bb-worktrees/thread`,
        managed: true,
        workspaceProvisionType: "managed-worktree",
        branchName: "bb/managed-send",
        defaultBranch: "main",
      });
      const thread = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
        status: "idle",
      });

      const responsePromise = harness.app.request(
        `/api/v1/threads/${thread.id}/send`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            mode: "auto",
            model: "gpt-5",
            input: [{ type: "text", text: "Continue" }],
          }),
        },
      );

      const startCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.start" && command.threadId === thread.id,
      );
      expect(startCommand.command).toMatchObject({
        environmentId: environment.id,
      });

      const queuedCommandTypes = harness.engineRouting.dispatched.map(
        (envelope) => envelope.command.type,
      );
      expect(queuedCommandTypes).not.toContain("environment.provision");
      expect(queuedCommandTypes).not.toContain("workspace.status");

      const response = await responsePromise;
      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toEqual({ ok: true });
    });
  });

  it("dedupes concurrent direct-host provisioning advances", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/direct-dedupe",
      });

      const response = await harness.app.request("/api/v1/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          origin: "app",
          projectId: project.id,
          providerId: "codex",
          model: "gpt-5",
          title: "Concurrent provisioning",
          input: [{ type: "text", text: "Create only one workspace" }],
          environment: {
            type: "host",
            hostId: host.id,
            workspace: {
              type: "managed-worktree",
              baseBranch: { kind: "default" },
            },
          },
        }),
      });

      expect(response.status).toBe(201);
      const createdThread = threadSchema.parse(await readJson(response));
      // The provision pipeline is an owned in-memory task: there is exactly
      // one per thread, so repeated advances cannot exist anymore — assert
      // the single dispatch the pipeline performs.
      await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "environment.provision",
      );

      const provisionCommands = harness.engineRouting.dispatched.filter(
        (envelope) => envelope.command.type === "environment.provision",
      );
      const createdEnvironments = harness.db
        .select()
        .from(environments)
        .where(eq(environments.projectId, project.id))
        .all();
      expect(provisionCommands).toHaveLength(1);
      expect(createdEnvironments).toHaveLength(1);
      expect(getThread(harness.db, createdThread.id)?.environmentId).toBe(
        createdEnvironments[0]?.id,
      );
    });
  });

  it("only queues environment.destroy after the last thread in a managed environment is deleted", async () => {
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
        path: "/tmp/thread-cleanup",
      });
      const firstThread = await harness.app.request("/api/v1/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          origin: "app",
          projectId: project.id,
          providerId: "codex",
          model: "gpt-5",
          input: [{ type: "text", text: "First reused thread" }],
          environment: {
            type: "reuse",
            environmentId: environment.id,
          },
        }),
      });
      const secondThread = await harness.app.request("/api/v1/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          origin: "app",
          projectId: project.id,
          providerId: "codex",
          model: "gpt-5",
          input: [{ type: "text", text: "Second reused thread" }],
          environment: {
            type: "reuse",
            environmentId: environment.id,
          },
        }),
      });

      expect(firstThread.status).toBe(201);
      expect(secondThread.status).toBe(201);
      const firstThreadBody = threadSchema.parse(await readJson(firstThread));
      const secondThreadBody = threadSchema.parse(await readJson(secondThread));

      const firstStart = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.start" &&
          command.threadId === firstThreadBody.id,
      );
      const secondStart = await waitForQueuedCommandAfter(
        harness,
        firstStart.row.cursor,
        ({ command }) =>
          command.type === "thread.start" &&
          command.threadId === secondThreadBody.id,
      );
      expect(secondStart.command).toMatchObject({
        threadId: secondThreadBody.id,
      });
      await reportQueuedCommandSuccess(harness, firstStart, {
        providerThreadId: "provider-first",
      });
      transitionThreadStatus(
        harness.db,
        harness.deps.hub,
        firstThreadBody.id,
        "idle",
      );
      await reportQueuedCommandSuccess(harness, secondStart, {
        providerThreadId: "provider-second",
      });
      transitionThreadStatus(
        harness.db,
        harness.deps.hub,
        secondThreadBody.id,
        "idle",
      );

      const firstDelete = await harness.app.request(
        `/api/v1/threads/${firstThreadBody.id}`,
        {
          method: "DELETE",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({ managerChildThreadsConfirmed: false }),
        },
      );
      expect(firstDelete.status).toBe(200);
      expect(
        harness.engineRouting.dispatched.filter(
          (envelope) => envelope.command.type === "environment.destroy",
        ),
      ).toHaveLength(0);

      const secondDelete = await harness.app.request(
        `/api/v1/threads/${secondThreadBody.id}`,
        {
          method: "DELETE",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({ managerChildThreadsConfirmed: false }),
        },
      );
      expect(secondDelete.status).toBe(200);

      const statusCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "environment.cleanup_preflight" &&
          command.environmentId === environment.id,
      );
      await reportQueuedCommandSuccess(harness, statusCommand, {
        outcome: "safe_to_destroy",
      });
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

  it("fails reused threads when a provisioning environment has no active lifecycle operation", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/reuse-provisioning",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/reuse-provisioning",
        status: "provisioning",
      });

      const response = await harness.app.request("/api/v1/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          origin: "app",
          projectId: project.id,
          providerId: "codex",
          model: "gpt-5",
          input: [{ type: "text", text: "Wait for provisioning" }],
          environment: {
            type: "reuse",
            environmentId: environment.id,
          },
        }),
      });

      expect(response.status).toBe(201);
      const createdThread = threadSchema.parse(await readJson(response));

      await waitForThreadStatus(harness, {
        threadId: createdThread.id,
        status: "error",
      });
      const errorEvent = harness.db
        .select()
        .from(events)
        .where(eq(events.threadId, createdThread.id))
        .all()
        .find((event) => event.type === "system/error");
      expect(errorEvent ? JSON.parse(errorEvent.data) : null).toMatchObject({
        code: "thread_provisioning_failed",
        detail:
          "Environment is provisioning without an active provision operation",
      });
    });
  });
});
