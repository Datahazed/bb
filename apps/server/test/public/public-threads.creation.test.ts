import {
  provisionHostMock,
  resumeHostMock,
} from "./public-thread-test-harness.js";

import { createProject, listEnvironments, listThreads } from "@bb/db";
import { threadSchema } from "@bb/domain";
import { waitForQueuedCommand } from "../helpers/commands.js";
import { readJson } from "../helpers/json.js";
import {
  seedHostSession,
  seedProjectWithSource,
} from "../helpers/seed.js";
import { createTestAppHarness, withTestHarness } from "../helpers/test-app.js";
import { waitForThreadEnvironment } from "./public-thread-assertions.js";
import { createTestGitRepo } from "./public-thread-git-fixtures.js";
import { beforeEach, describe, expect, it } from "vitest";

describe("public thread creation routes", () => {
  beforeEach(() => {
    provisionHostMock.mockReset();
    resumeHostMock.mockReset();
  });

  it("creates unmanaged host threads and queues environment provisioning", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project, source } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/unmanaged-project",
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
            { type: "text", text: "Inspect the default source workspace" },
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
      expect(createdThread.status).toBe("provisioning");

      const environment = await waitForThreadEnvironment(
        harness,
        createdThread.id,
      );
      expect(environment).toMatchObject({
        projectId: project.id,
        status: "provisioning",
        workspaceProvisionType: "unmanaged",
      });

      const queued = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "environment.provision",
      );
      expect(queued.command).toMatchObject({
        environmentId: environment?.id,
        path: source.path,
        workspaceProvisionType: "unmanaged",
      });
    });
  });

  it("queues unmanaged new branches with the requested base branch", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project, source } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/unmanaged-new-branch-project",
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
          input: [{ type: "text", text: "Start from release" }],
          environment: {
            type: "host",
            hostId: host.id,
            workspace: {
              type: "unmanaged",
              path: null,
              branch: {
                kind: "new",
                baseBranch: "release/1.2",
              },
            },
          },
        }),
      });

      expect(response.status).toBe(201);
      const createdThread = threadSchema.parse(await readJson(response));
      const environment = await waitForThreadEnvironment(
        harness,
        createdThread.id,
      );
      const queued = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "environment.provision",
      );

      expect(queued.command).toMatchObject({
        environmentId: environment?.id,
        path: source.path,
        workspaceProvisionType: "unmanaged",
        checkout: {
          kind: "new",
          baseBranch: "release/1.2",
        },
      });
    });
  });

  it("fails host thread creation for non-local host ids without inserting rows", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/unknown-host-thread-project",
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
            { type: "text", text: "Create this thread on an unknown host" },
          ],
          environment: {
            type: "host",
            hostId: "host-thread-unknown",
            workspace: {
              type: "unmanaged",
              path: "/tmp/unknown-host-thread-project",
            },
          },
        }),
      });

      expect(response.status).toBe(404);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "host_not_found",
      });
      expect(listThreads(harness.db, { projectId: project.id })).toHaveLength(
        0,
      );
      expect(listEnvironments(harness.db, project.id)).toHaveLength(0);
    });
  });

  it("creates managed-worktree threads and queues managed provisioning", async () => {
    const harness = await createTestAppHarness();
    const repo = await createTestGitRepo();
    try {
      const { host } = seedHostSession(harness.deps);
      const { project, source } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: repo.path,
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
          title: "Managed thread",
          input: [{ type: "text", text: "Build it" }],
          environment: {
            type: "host",
            hostId: host.id,
            workspace: {
              type: "managed-worktree",
              baseBranch: { kind: "named", name: "release/2026-05" },
            },
          },
        }),
      });

      expect(response.status).toBe(201);
      const createdThread = threadSchema.parse(await readJson(response));
      expect(createdThread.status).toBe("provisioning");
      const environment = await waitForThreadEnvironment(
        harness,
        createdThread.id,
      );
      expect(environment.baseBranch).toBe("release/2026-05");

      const queued = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "environment.provision",
      );
      expect(queued.command).toMatchObject({
        branchName: `bb/managed-thread-${createdThread.id}`,
        baseBranch: "release/2026-05",
        sourcePath: source.path,
        workspaceProvisionType: "managed-worktree",
        setupTimeoutMs: 900000,
      });
      expect(queued.command).toHaveProperty("targetPath");
      expect(queued.command).toHaveProperty("branchName");
    } finally {
      await repo.cleanup();
      await harness.cleanup();
    }
  });

  it("rejects malformed managed base branches before queueing host commands", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/malformed-base-branch-project",
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
          title: "Malformed base branch",
          input: [{ type: "text", text: "Build it" }],
          environment: {
            type: "host",
            hostId: host.id,
            workspace: {
              type: "managed-worktree",
              baseBranch: { kind: "named", name: "-release" },
            },
          },
        }),
      });

      expect(response.status).toBe(400);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "invalid_request",
      });
      expect(harness.engineRouting.dispatched).toHaveLength(0);
    });
  });

  it("returns 409 when the requested host has no configured project source", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = createProject(harness.db, harness.hub, {
        name: "Project Without Local Source",
        source: {
          type: "local_path",
          // A source pinned to a foreign id leaves the local host without a
          // configured project source — the single-host stand-in for the
          // multi-host "no source on this host" fixture.
          hostId: "host-source-missing",
          path: "/tmp/source-present",
        },
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
          input: [{ type: "text", text: "Try the missing source" }],
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

      expect(response.status).toBe(409);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "invalid_request",
        message: "No project source configured for this host",
      });
    });
  });

  it("creates unmanaged threads with an explicit path even when the host has no project source", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = createProject(harness.db, harness.hub, {
        name: "Project Without Local Unmanaged Source",
        source: {
          type: "local_path",
          // Foreign-pinned source: the local host has no configured project
          // source, but an explicit unmanaged path must still work.
          hostId: "host-unmanaged-missing",
          path: "/tmp/unmanaged-default-source",
        },
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
          input: [{ type: "text", text: "Use the explicit workspace path" }],
          environment: {
            type: "host",
            hostId: host.id,
            workspace: {
              type: "unmanaged",
              path: "/tmp/explicit-unmanaged-workspace",
            },
          },
        }),
      });

      expect(response.status).toBe(201);
      const createdThread = threadSchema.parse(await readJson(response));
      expect(createdThread.status).toBe("provisioning");
      const environment = await waitForThreadEnvironment(
        harness,
        createdThread.id,
      );

      const queued = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "environment.provision" &&
          command.environmentId === environment.id,
      );
      expect(queued.command).toMatchObject({
        path: "/tmp/explicit-unmanaged-workspace",
        workspaceProvisionType: "unmanaged",
      });
    });
  });
});
