import { getEnvironment } from "@bb/db";
import { describe, expect, it } from "vitest";
import {
  MANAGED_REPROVISION_IN_PROGRESS,
  MANAGED_REPROVISION_QUEUED,
  queueManagedEnvironmentReprovision,
} from "../../src/services/environments/environment-provisioning-internal.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import {
  requireManagedWorktreeEnvironmentProvisionQueuedCommand,
  waitForQueuedCommand,
} from "../helpers/commands.js";
import { withTestHarness } from "../helpers/test-app.js";

describe("environment reprovisioning", () => {
  it("queues managed reprovision at most once per environment", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-reprovision-once",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/reprovision-project",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/reprovision-target",
        status: "error",
        managed: true,
        workspaceProvisionType: "managed-worktree",
        branchName: null,
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
      });

      const firstAttempt = await queueManagedEnvironmentReprovision(
        harness.deps,
        {
          environment,
          projectId: thread.projectId,
          provisionEventSequence: 1,
          provisioningId: "tpv-reprovision-once-first",
          threadId: thread.id,
        },
      );
      const secondAttempt = await queueManagedEnvironmentReprovision(
        harness.deps,
        {
          environment,
          projectId: thread.projectId,
          provisionEventSequence: 2,
          provisioningId: "tpv-reprovision-once-second",
          threadId: thread.id,
        },
      );

      expect(firstAttempt).toMatchObject({
        status: MANAGED_REPROVISION_QUEUED,
        provisionEventSequence: expect.any(Number),
      });
      expect(secondAttempt).toBe(MANAGED_REPROVISION_IN_PROGRESS);
      expect(getEnvironment(harness.db, environment.id)?.status).toBe(
        "provisioning",
      );
      const queued = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "environment.provision",
      );
      const managedCommand =
        requireManagedWorktreeEnvironmentProvisionQueuedCommand(queued);
      expect(managedCommand.command.branchName).toBe(`bb/${thread.id}`);
      expect(
        harness.engineRouting.dispatched.filter(
          (envelope) => envelope.command.type === "environment.provision",
        ),
      ).toHaveLength(1);
    });
  });

  it("preserves the stored branch name during managed reprovision", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-reprovision-branch",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/reprovision-branch-project",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/reprovision-branch-target",
        status: "error",
        managed: true,
        workspaceProvisionType: "managed-worktree",
        branchName: "bb/existing-readable-branch",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
      });

      await queueManagedEnvironmentReprovision(harness.deps, {
        environment,
        projectId: thread.projectId,
        provisionEventSequence: 1,
        provisioningId: "tpv-reprovision-branch",
        threadId: thread.id,
      });

      const queued = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "environment.provision",
      );
      const managedCommand =
        requireManagedWorktreeEnvironmentProvisionQueuedCommand(queued);
      expect(managedCommand.command.branchName).toBe(
        "bb/existing-readable-branch",
      );
    });
  });

  it("uses the persisted base branch during managed reprovision", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-reprovision-base-branch",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/reprovision-base-branch-project",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/reprovision-base-branch-target",
        status: "error",
        managed: true,
        workspaceProvisionType: "managed-worktree",
        branchName: "bb/base-branch-thread",
        baseBranch: "release/2026-05",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
      });

      await queueManagedEnvironmentReprovision(harness.deps, {
        environment,
        projectId: thread.projectId,
        provisionEventSequence: 1,
        provisioningId: "tpv-reprovision-base-branch",
        threadId: thread.id,
      });

      const queued = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "environment.provision",
      );
      const managedCommand =
        requireManagedWorktreeEnvironmentProvisionQueuedCommand(queued);
      expect(managedCommand.command.baseBranch).toBe("release/2026-05");
    });
  });

  it("uses the source default base branch during managed reprovision", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-reprovision-default-base-branch",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/reprovision-default-base-branch-project",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/reprovision-default-base-branch-target",
        status: "error",
        managed: true,
        workspaceProvisionType: "managed-worktree",
        branchName: "bb/default-base-branch-thread",
        baseBranch: null,
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
      });

      await queueManagedEnvironmentReprovision(harness.deps, {
        environment,
        projectId: thread.projectId,
        provisionEventSequence: 1,
        provisioningId: "tpv-reprovision-default-base-branch",
        threadId: thread.id,
      });

      const queued = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "environment.provision",
      );
      const managedCommand =
        requireManagedWorktreeEnvironmentProvisionQueuedCommand(queued);
      expect(managedCommand.command.baseBranch).toBeNull();
    });
  });

});
