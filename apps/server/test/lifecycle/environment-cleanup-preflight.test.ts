/**
 * Cleanup preflight taxonomy of the Phase 2 environment lifecycle (plan §6
 * Phase 2: `safe_to_destroy|already_missing|not_inspectable` destroy,
 * `blocked_by_changes|probe_failed` defer with the durable
 * `cleanupRequestedAt`/`cleanupMode` intent retained). Focused unit
 * coverage on `advanceCleanup`; the archive/unarchive route flows live in
 * `test/public/public-threads.archive-delete-cleanup.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { getEnvironment } from "@bb/db";
import { recordEnvironmentCleanupRequest } from "@bb/db/internal-environment-lifecycle";
import type { HostDaemonCommandResultByType } from "../../src/engine/contract/commands.js";
import {
  listQueuedEnvironmentCommands,
  reportQueuedCommandError,
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
} from "../helpers/commands.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";
import type { TestAppHarness } from "../helpers/test-app.js";
import { settleLifecycleWork } from "./helpers.js";

type CleanupPreflightResult =
  HostDaemonCommandResultByType["environment.cleanup_preflight"];

interface CleanupFixture {
  environmentId: string;
  projectId: string;
}

function seedCleanupRequestedEnvironment(
  harness: TestAppHarness,
  args: { isGitRepo?: boolean } = {},
): CleanupFixture {
  const { host } = seedHostSession(harness.deps);
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: host.id,
  });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
    managed: true,
    workspaceProvisionType: "managed-worktree",
    path: "/tmp/cleanup-preflight",
    isGitRepo: args.isGitRepo ?? true,
    mergeBaseBranch: "main",
  });
  recordEnvironmentCleanupRequest(harness.db, harness.hub, environment.id, {});
  return { environmentId: environment.id, projectId: project.id };
}

const missingWorkspaceFailure = {
  code: "path_not_found",
  message: "workspace is gone",
  workspacePath: "/tmp/cleanup-preflight",
} as const;

const destroyAllowedOutcomes: CleanupPreflightResult[] = [
  { outcome: "safe_to_destroy" },
  { outcome: "already_missing", failure: missingWorkspaceFailure },
  { outcome: "not_inspectable", failure: missingWorkspaceFailure },
];

const destroyBlockedOutcomes: CleanupPreflightResult[] = [
  { outcome: "blocked_by_changes", message: "uncommitted changes" },
  { outcome: "probe_failed", failure: missingWorkspaceFailure },
];

describe("environment cleanup preflight taxonomy", () => {
  for (const outcome of destroyAllowedOutcomes) {
    it(`destroys the workspace when preflight reports ${outcome.outcome}`, async () => {
      await withTestHarness(async (harness) => {
        const fixture = seedCleanupRequestedEnvironment(harness);

        const advance = harness.deps.environmentLifecycle.advanceCleanup({
          environmentId: fixture.environmentId,
        });
        const preflight = await waitForQueuedCommand(
          harness,
          ({ command }) =>
            command.type === "environment.cleanup_preflight" &&
            command.environmentId === fixture.environmentId,
        );
        await reportQueuedCommandSuccess(harness, preflight, outcome);
        const destroy = await waitForQueuedCommand(
          harness,
          ({ command }) =>
            command.type === "environment.destroy" &&
            command.environmentId === fixture.environmentId,
        );
        expect(
          getEnvironment(harness.db, fixture.environmentId)?.status,
        ).toBe("destroying");
        await reportQueuedCommandSuccess(harness, destroy, {});
        await advance;
        await settleLifecycleWork(harness);

        expect(
          getEnvironment(harness.db, fixture.environmentId),
        ).toMatchObject({
          cleanupMode: null,
          cleanupRequestedAt: null,
          status: "destroyed",
        });
      });
    });
  }

  for (const outcome of destroyBlockedOutcomes) {
    it(`defers cleanup and keeps durable intent when preflight reports ${outcome.outcome}`, async () => {
      await withTestHarness(async (harness) => {
        const fixture = seedCleanupRequestedEnvironment(harness);

        const advance = harness.deps.environmentLifecycle.advanceCleanup({
          environmentId: fixture.environmentId,
        });
        const preflight = await waitForQueuedCommand(
          harness,
          ({ command }) =>
            command.type === "environment.cleanup_preflight" &&
            command.environmentId === fixture.environmentId,
        );
        await reportQueuedCommandSuccess(harness, preflight, outcome);
        await advance;
        await settleLifecycleWork(harness);

        expect(
          listQueuedEnvironmentCommands(
            harness,
            "environment.destroy",
            fixture.environmentId,
          ),
        ).toHaveLength(0);
        // Durable product intent survives the deferral (plan §5.12): the
        // archive-cleanup sweep re-drives it once the workspace is clean.
        expect(
          getEnvironment(harness.db, fixture.environmentId),
        ).toMatchObject({
          cleanupMode: "safe",
          cleanupRequestedAt: expect.any(Number),
          status: "ready",
        });
      });
    });
  }

  it("skips cleanup entirely while the environment has live threads", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedCleanupRequestedEnvironment(harness);
      seedThread(harness.deps, {
        environmentId: fixture.environmentId,
        projectId: fixture.projectId,
        status: "idle",
      });

      await harness.deps.environmentLifecycle.advanceCleanup({
        environmentId: fixture.environmentId,
      });

      expect(harness.engineRouting.dispatched).toHaveLength(0);
      expect(
        getEnvironment(harness.db, fixture.environmentId),
      ).toMatchObject({
        cleanupMode: "safe",
        status: "ready",
      });
    });
  });

  it("destroys non-git workspaces without a preflight probe", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedCleanupRequestedEnvironment(harness, {
        isGitRepo: false,
      });

      const advance = harness.deps.environmentLifecycle.advanceCleanup({
        environmentId: fixture.environmentId,
      });
      const destroy = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "environment.destroy" &&
          command.environmentId === fixture.environmentId,
      );
      expect(
        listQueuedEnvironmentCommands(
          harness,
          "environment.cleanup_preflight",
          fixture.environmentId,
        ),
      ).toHaveLength(0);
      await reportQueuedCommandSuccess(harness, destroy, {});
      await advance;
      await settleLifecycleWork(harness);

      expect(
        getEnvironment(harness.db, fixture.environmentId)?.status,
      ).toBe("destroyed");
    });
  });

  it("restores the environment and keeps intent when the destroy fails", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedCleanupRequestedEnvironment(harness);

      const advance = harness.deps.environmentLifecycle.advanceCleanup({
        environmentId: fixture.environmentId,
      });
      const preflight = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "environment.cleanup_preflight" &&
          command.environmentId === fixture.environmentId,
      );
      await reportQueuedCommandSuccess(harness, preflight, {
        outcome: "safe_to_destroy",
      });
      const destroy = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "environment.destroy" &&
          command.environmentId === fixture.environmentId,
      );
      await reportQueuedCommandError(harness, destroy, {
        errorCode: "destroy_failed",
        errorMessage: "workspace is busy",
      });
      await advance;
      await settleLifecycleWork(harness);

      expect(
        getEnvironment(harness.db, fixture.environmentId),
      ).toMatchObject({
        cleanupMode: "safe",
        cleanupRequestedAt: expect.any(Number),
        status: "ready",
      });
    });
  });
});
