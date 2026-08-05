import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import {
  environmentGitStatusSnapshots,
  environmentPullRequestStatusSnapshots,
} from "@bb/db";
import type { GitHostPullRequest, WorkspaceStatus } from "@bb/domain";
import {
  EnvironmentStatusSnapshotCoordinator,
  refreshDueEnvironmentStatusSnapshots,
} from "../../../src/services/environments/environment-status-snapshots.js";
import { registerHostRpcResponder } from "../../helpers/host-rpc.js";
import { seedThreadFixture } from "../../helpers/seed.js";
import { withTestHarness } from "../../helpers/test-app.js";

function workspaceStatusFixture(): WorkspaceStatus {
  return {
    workingTree: {
      insertions: 3,
      deletions: 1,
      files: [
        {
          path: "src/index.ts",
          status: "M",
          insertions: 3,
          deletions: 1,
        },
      ],
      hasUncommittedChanges: true,
      state: "dirty_and_committed_unmerged",
    },
    branch: {
      currentBranch: "feature/status-snapshots",
      defaultBranch: "main",
    },
    checkout: {
      kind: "branch",
      branchName: "feature/status-snapshots",
      headSha: "abc123",
    },
    mergeBase: {
      insertions: 5,
      deletions: 0,
      files: [
        {
          path: "README.md",
          status: "A",
          insertions: 5,
          deletions: 0,
        },
      ],
      mergeBaseBranch: "main",
      baseRef: "origin/main",
      aheadCount: 1,
      behindCount: 0,
      hasCommittedUnmergedChanges: true,
      commits: [
        {
          sha: "abc123def456",
          shortSha: "abc123d",
          subject: "Add status snapshots",
          authorName: "Test Author",
          authoredAt: 1_000,
        },
      ],
    },
  };
}

function rawPullRequestFixture(): GitHostPullRequest {
  return {
    number: 42,
    title: "Add status snapshots",
    state: "OPEN",
    url: "https://github.com/acme/bb/pull/42",
    isDraft: false,
    baseRefName: "main",
    headRefName: "feature/status-snapshots",
    updatedAt: "2026-06-16T12:30:00Z",
    checks: [
      {
        name: "test",
        status: "completed",
        conclusion: "success",
        url: null,
      },
    ],
    reviewDecision: "APPROVED",
    reviewRequestCount: 0,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
  };
}

function parseRequiredJson(value: string | null): unknown {
  if (value === null) {
    throw new Error("Expected JSON value");
  }
  return JSON.parse(value);
}

describe("environment status snapshots", () => {
  it("refreshes due git and pull request snapshots and notifies attached threads", async () => {
    await withTestHarness(async (harness) => {
      const { environment, host, project, session, thread } = seedThreadFixture(
        harness,
        {
          environment: {
            path: "/tmp/status-snapshots",
            workspaceProvisionType: "managed-worktree",
          },
        },
      );
      const notifyThread = vi.spyOn(harness.hub, "notifyThread");
      const responder = registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle(request) {
          if (request.command.type === "workspace.status") {
            return {
              ok: true,
              result: {
                outcome: "available",
                workspaceStatus: workspaceStatusFixture(),
              },
            };
          }
          if (request.command.type === "workspace.pull_request") {
            return {
              ok: true,
              result: {
                outcome: "available",
                pullRequest: rawPullRequestFixture(),
              },
            };
          }
          throw new Error(`Unexpected RPC command ${request.command.type}`);
        },
      });

      await refreshDueEnvironmentStatusSnapshots(harness.deps, 10_000);

      expect(responder.requests.map((request) => request.command.type)).toEqual(
        ["workspace.status", "workspace.pull_request"],
      );
      expect(notifyThread).toHaveBeenCalledTimes(2);
      expect(notifyThread).toHaveBeenCalledWith(
        thread.id,
        ["environment-status-summary-changed"],
        { projectId: project.id },
      );

      const gitRow = harness.db
        .select()
        .from(environmentGitStatusSnapshots)
        .where(eq(environmentGitStatusSnapshots.environmentId, environment.id))
        .get();
      expect(gitRow).toMatchObject({
        status: "available",
        errorCode: null,
        errorMessage: null,
      });
      expect(gitRow?.refreshedAt).toEqual(expect.any(Number));
      expect(gitRow?.nextRefreshAt).toBe(
        (gitRow?.refreshedAt ?? 0) + 5 * 60_000,
      );
      expect(parseRequiredJson(gitRow?.gitStatusJson ?? null)).toMatchObject({
        checkout: {
          kind: "branch",
          branchName: "feature/status-snapshots",
          headSha: "abc123",
        },
        currentBranch: "feature/status-snapshots",
        defaultBranch: "main",
        hasChanges: true,
        workingTree: {
          fileCount: 1,
          insertions: 3,
          deletions: 1,
          files: [{ path: "src/index.ts", status: "M" }],
          hasUncommittedChanges: true,
          state: "dirty_and_committed_unmerged",
        },
        mergeBase: {
          fileCount: 1,
          insertions: 5,
          deletions: 0,
          files: [{ path: "README.md", status: "A" }],
          aheadCount: 1,
          behindCount: 0,
          commitCount: 1,
          hasCommittedUnmergedChanges: true,
          mergeBaseBranch: "main",
        },
      });

      const pullRequestRow = harness.db
        .select()
        .from(environmentPullRequestStatusSnapshots)
        .where(
          eq(
            environmentPullRequestStatusSnapshots.environmentId,
            environment.id,
          ),
        )
        .get();
      expect(pullRequestRow).toMatchObject({
        status: "available",
        errorCode: null,
        errorMessage: null,
      });
      expect(pullRequestRow?.refreshedAt).toEqual(expect.any(Number));
      expect(pullRequestRow?.nextRefreshAt).toBe(
        (pullRequestRow?.refreshedAt ?? 0) + 30_000,
      );
      expect(
        parseRequiredJson(pullRequestRow?.pullRequestJson ?? null),
      ).toMatchObject({
        number: 42,
        title: "Add status snapshots",
        state: "open",
        checks: {
          state: "passing",
          totalCount: 1,
          passedCount: 1,
          failedCount: 0,
          pendingCount: 0,
        },
        review: { state: "approved", reviewRequestCount: 0 },
        mergeability: {
          state: "mergeable",
          mergeStateStatus: "CLEAN",
          mergeable: "MERGEABLE",
        },
        attention: "ready_to_merge",
      });
    });
  });

  it("splits due-marking between git and pull request snapshots by change kind", async () => {
    await withTestHarness(async (harness) => {
      const { environment } = seedThreadFixture(harness, {
        environment: {
          path: "/tmp/status-snapshots",
          workspaceProvisionType: "managed-worktree",
        },
      });
      const futureRefreshAt = Date.now() + 60_000;
      harness.db
        .insert(environmentGitStatusSnapshots)
        .values({
          environmentId: environment.id,
          status: "available",
          gitStatusJson: JSON.stringify({ stale: true }),
          errorCode: null,
          errorMessage: null,
          refreshedAt: 1,
          nextRefreshAt: futureRefreshAt,
          createdAt: 1,
          updatedAt: 1,
        })
        .run();
      harness.db
        .insert(environmentPullRequestStatusSnapshots)
        .values({
          environmentId: environment.id,
          status: "available",
          pullRequestJson: null,
          errorCode: null,
          errorMessage: null,
          refreshedAt: 1,
          nextRefreshAt: futureRefreshAt,
          createdAt: 1,
          updatedAt: 1,
        })
        .run();

      const coordinator = new EnvironmentStatusSnapshotCoordinator({
        db: harness.db,
        hub: harness.hub,
        logger: harness.deps.logger,
      });
      try {
        const readGitRow = () =>
          harness.db
            .select()
            .from(environmentGitStatusSnapshots)
            .where(
              eq(environmentGitStatusSnapshots.environmentId, environment.id),
            )
            .get();
        const readPullRequestRow = () =>
          harness.db
            .select()
            .from(environmentPullRequestStatusSnapshots)
            .where(
              eq(
                environmentPullRequestStatusSnapshots.environmentId,
                environment.id,
              ),
            )
            .get();

        // Local file edits refresh git status immediately but cannot change
        // the remote PR, so the PR schedule is untouched.
        const beforeWorkStatus = Date.now();
        harness.hub.notifyEnvironment(environment.id, ["work-status-changed"]);
        expect(readGitRow()?.nextRefreshAt).toBeGreaterThanOrEqual(
          beforeWorkStatus,
        );
        expect(readGitRow()?.nextRefreshAt).toBeLessThan(futureRefreshAt);
        expect(readPullRequestRow()?.nextRefreshAt).toBe(futureRefreshAt);

        // Ref changes (commits, pushes, branch moves) can change the PR.
        const beforeGitRefs = Date.now();
        harness.hub.notifyEnvironment(environment.id, ["git-refs-changed"]);
        expect(readPullRequestRow()?.nextRefreshAt).toBeGreaterThanOrEqual(
          beforeGitRefs,
        );
        expect(readPullRequestRow()?.nextRefreshAt).toBeLessThan(
          futureRefreshAt,
        );
      } finally {
        coordinator.dispose();
      }
    });
  });
});
