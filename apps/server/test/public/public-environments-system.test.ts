import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createEnvironment } from "@bb/db";
import type { ProviderCapabilities, ProviderInfo } from "@bb/domain";
import type { WorkspaceResolutionFailure } from "@bb/host-daemon-contract";
import type { SystemExecutionOptionsModelLoadErrorCode } from "@bb/server-contract";
import {
  makeWorkspaceMergeBase,
  makeWorkspaceStatus,
  makeWorkspaceWorkingTree,
} from "@bb/test-helpers";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  WORKSPACE_DIFF_MAX_DIFF_BYTES,
  WORKSPACE_DIFF_MAX_FILE_LIST_BYTES,
} from "../../src/constants.js";
import {
  reportQueuedCommandError,
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
} from "../helpers/commands.js";
import { registerProviderHostRpcResponder } from "../helpers/host-rpc.js";
import { readJson } from "../helpers/json.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
} from "../helpers/seed.js";
import { createTestAppHarness, withTestHarness } from "../helpers/test-app.js";

interface MakeSystemProviderArgs {
  id: string;
  displayName: string;
  capabilities?: Partial<ProviderCapabilities>;
}

interface ProviderModelLookupFailureCase {
  providerId: string;
  errorCode: string;
  errorMessage: string;
  expectedCode: SystemExecutionOptionsModelLoadErrorCode;
  name: string;
}

type TestAppHarness = Awaited<ReturnType<typeof createTestAppHarness>>;

const DEFAULT_PROVIDER_CAPABILITIES: ProviderCapabilities = {
  supportsArchive: false,
  supportsRename: false,
  supportsServiceTier: false,
  supportsUserQuestion: false,
  supportedPermissionModes: ["full", "workspace-write", "readonly"],
};

const PROVIDER_MODEL_LOOKUP_FAILURE_CASES: ProviderModelLookupFailureCase[] = [
  {
    providerId: "codex",
    errorCode: "missing_executable",
    errorMessage:
      'Provider "codex" exited unexpectedly\nstderr: Error: spawn /usr/local/lib/node_modules/@openai/codex/vendor/aarch64-apple-darwin/codex/codex ENOENT',
    expectedCode: "missing_executable",
    name: "Codex missing executable",
  },
  {
    providerId: "claude-code",
    errorCode: "missing_executable",
    errorMessage:
      'Provider "claude-code" exited unexpectedly\nstderr: Error: spawn /usr/local/bin/claude ENOENT',
    expectedCode: "missing_executable",
    name: "Claude Code missing executable",
  },
  {
    providerId: "pi",
    errorCode: "missing_executable",
    errorMessage:
      'Provider "pi" exited unexpectedly\nstderr: Error: spawn /Applications/bb.app/Contents/Resources/bb-pi-bridge.mjs ENOENT',
    expectedCode: "missing_executable",
    name: "Pi missing executable",
  },
  {
    providerId: "codex",
    errorCode: "command_timeout",
    errorMessage: "Timed out waiting for command result",
    expectedCode: "timeout",
    name: "command timeout",
  },
  {
    providerId: "codex",
    errorCode: "provider_rpc_error",
    errorMessage: "Provider failed",
    expectedCode: "failed",
    name: "generic provider failure",
  },
  {
    providerId: "codex",
    errorCode: "provider_rpc_error",
    errorMessage:
      'Provider "codex" exited unexpectedly\nstderr: Error: spawn /usr/local/bin/codex ENOENT',
    expectedCode: "failed",
    name: "ENOENT-looking message with generic error code",
  },
];

function makeSystemProvider(args: MakeSystemProviderArgs): ProviderInfo {
  return {
    id: args.id,
    displayName: args.displayName,
    capabilities: {
      ...DEFAULT_PROVIDER_CAPABILITIES,
      ...(args.capabilities ?? {}),
    },
    available: true,
  };
}

async function reportLocalSquashMergeTarget(
  harness: TestAppHarness,
  targetBranch: string,
): Promise<void> {
  const targetCommand = await waitForQueuedCommand(
    harness,
    ({ command }) =>
      command.type === "host.list_branches" &&
      command.selectedBranch === targetBranch,
  );
  expect(targetCommand.command).toMatchObject({
    selectedBranch: targetBranch,
    limit: 1,
  });
  await reportQueuedCommandSuccess(harness, targetCommand, {
    branches: [targetBranch],
    branchesTruncated: false,
    checkout: {
      kind: "branch",
      branchName: "bb/feature",
      headSha: "abc123",
    },
    defaultBranch: "main",
    hasUncommittedChanges: false,
    operation: { kind: "none" },
    remoteBranches: [],
    remoteBranchesTruncated: false,
    selectedBranch: { name: targetBranch, kind: "local" },
  });
}

describe("public environment and system routes", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("allows status without a merge-base branch and rejects branch-relative diff without one", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/environment-merge-base-required",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/environment-merge-base-required/worktree",
        managed: true,
        workspaceProvisionType: "managed-worktree",
        branchName: "bb/merge-base",
      });

      const statusPromise = harness.app.request(
        `/api/v1/environments/${environment.id}/status`,
      );
      const statusCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "workspace.status" &&
          command.environmentId === environment.id,
      );
      expect(statusCommand.command).not.toHaveProperty("mergeBaseBranch");
      await reportQueuedCommandSuccess(harness, statusCommand, {
        outcome: "available",
        workspaceStatus: {
          workingTree: {
            hasUncommittedChanges: false,
            state: "clean",
            insertions: 0,
            deletions: 0,
            files: [],
          },
          branch: {
            currentBranch: "bb/merge-base",
            defaultBranch: "main",
          },
          mergeBase: null,
        },
      });
      const statusResponse = await statusPromise;
      expect(statusResponse.status).toBe(200);
      await expect(readJson(statusResponse)).resolves.toMatchObject({
        outcome: "available",
        workspace: {
          mergeBase: null,
        },
      });

      const diffResponse = await harness.app.request(
        `/api/v1/environments/${environment.id}/diff?target=all`,
      );
      expect(diffResponse.status).toBe(400);
      await expect(readJson(diffResponse)).resolves.toMatchObject({
        code: "invalid_request",
        message: "A merge base branch is required",
      });
    });
  });

  it("returns null status for non-git environments without queuing a git probe", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/environment-non-git",
      });
      const environment = createEnvironment(harness.db, harness.hub, {
        projectId: project.id,
        hostId: host.id,
        path: "/tmp/environment-non-git/workspace",
        status: "ready",
        managed: false,
        isGitRepo: false,
        isWorktree: false,
        workspaceProvisionType: "unmanaged",
        branchName: null,
        defaultBranch: null,
        mergeBaseBranch: null,
      });
      const commandCountBefore = harness.engineRouting.dispatched.length;

      const response = await harness.app.request(
        `/api/v1/environments/${environment.id}/status`,
      );

      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toEqual({
        outcome: "not_applicable",
        reason: "non_git_environment",
        message: "Workspace status is not available for non-git environments",
      });

      const commandCountAfter = harness.engineRouting.dispatched.length;
      expect(commandCountAfter).toBe(commandCountBefore);
    });
  });

  it("surfaces unavailable workspace status and diff results", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/environment-drift",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/environment-drift/worktree",
        managed: true,
        workspaceProvisionType: "managed-worktree",
        branchName: "bb/drift",
      });

      const statusPromise = harness.app.request(
        `/api/v1/environments/${environment.id}/status?mergeBaseBranch=main`,
      );
      const statusCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "workspace.status" &&
          command.environmentId === environment.id,
      );
      await reportQueuedCommandSuccess(harness, statusCommand, {
        outcome: "unavailable",
        failure: {
          code: "path_not_found",
          workspacePath: "/tmp/environment-drift/worktree",
          message:
            "Managed workspace path does not exist: /tmp/environment-drift/worktree",
        },
      });

      const statusResponse = await statusPromise;
      expect(statusResponse.status).toBe(200);
      await expect(readJson(statusResponse)).resolves.toEqual({
        outcome: "unavailable",
        failure: {
          code: "path_not_found",
          workspacePath: "/tmp/environment-drift/worktree",
          message:
            "Managed workspace path does not exist: /tmp/environment-drift/worktree",
        },
      });

      const diffPromise = harness.app.request(
        `/api/v1/environments/${environment.id}/diff?target=all&mergeBaseBranch=main`,
      );
      const diffCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "workspace.diff" &&
          command.environmentId === environment.id,
      );
      await reportQueuedCommandSuccess(harness, diffCommand, {
        outcome: "unavailable",
        failure: {
          code: "not_worktree",
          workspacePath: "/tmp/environment-drift/worktree",
          message: "Path is not a git worktree: /tmp/environment-drift/worktree",
        },
      });

      const diffResponse = await diffPromise;
      expect(diffResponse.status).toBe(200);
      await expect(readJson(diffResponse)).resolves.toEqual({
        outcome: "unavailable",
        failure: {
          code: "not_worktree",
          workspacePath: "/tmp/environment-drift/worktree",
          message: "Path is not a git worktree: /tmp/environment-drift/worktree",
        },
      });
    });
  });

  it("returns environment details and queues status, diff, and branch queries", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/environment-details",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/environment-details/worktree",
        managed: true,
        workspaceProvisionType: "managed-worktree",
        branchName: "bb/details",
      });

      const getResponse = await harness.app.request(
        `/api/v1/environments/${environment.id}`,
      );
      expect(getResponse.status).toBe(200);
      await expect(readJson(getResponse)).resolves.toMatchObject({
        id: environment.id,
        projectId: project.id,
        branchName: "bb/details",
      });

      const statusPromise = harness.app.request(
        `/api/v1/environments/${environment.id}/status?mergeBaseBranch=main`,
      );
      const statusCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "workspace.status" &&
          command.environmentId === environment.id,
      );
      expect(statusCommand.command).toMatchObject({
        workspaceContext: {
          workspacePath: "/tmp/environment-details/worktree",
          workspaceProvisionType: "managed-worktree",
        },
        mergeBaseBranch: "main",
      });
      await reportQueuedCommandSuccess(harness, statusCommand, {
        outcome: "available",
        workspaceStatus: makeWorkspaceStatus({
          workingTree: makeWorkspaceWorkingTree({
            hasUncommittedChanges: true,
            state: "dirty_uncommitted",
            insertions: 5,
            deletions: 1,
          }),
          branch: { currentBranch: "bb/details", defaultBranch: "main" },
          mergeBase: makeWorkspaceMergeBase({
            baseRef: "origin/main",
            aheadCount: 1,
            hasCommittedUnmergedChanges: true,
          }),
        }),
      });
      const statusResponse = await statusPromise;
      expect(statusResponse.status).toBe(200);
      await expect(readJson(statusResponse)).resolves.toEqual({
        outcome: "available",
        workspace: expect.objectContaining({
          workingTree: expect.objectContaining({
            state: "dirty_uncommitted",
          }),
          branch: expect.objectContaining({
            currentBranch: "bb/details",
          }),
        }),
      });

      const diffPromise = harness.app.request(
        `/api/v1/environments/${environment.id}/diff?target=all&mergeBaseBranch=main`,
      );
      const diffCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "workspace.diff" &&
          command.environmentId === environment.id,
      );
      expect(diffCommand.command).toMatchObject({
        maxDiffBytes: WORKSPACE_DIFF_MAX_DIFF_BYTES,
        maxFileListBytes: WORKSPACE_DIFF_MAX_FILE_LIST_BYTES,
        workspaceContext: {
          workspacePath: "/tmp/environment-details/worktree",
          workspaceProvisionType: "managed-worktree",
        },
        target: { type: "all", mergeBaseBranch: "main" },
      });
      await reportQueuedCommandSuccess(harness, diffCommand, {
        outcome: "available",
        diff: {
          diff: "diff --git a/file.ts b/file.ts",
          truncated: false,
          shortstat: " 1 file changed, 1 insertion(+)\n",
          files: "M\tfile.ts\n",
          mergeBaseRef: "abc1234",
        },
      });
      const diffResponse = await diffPromise;
      expect(diffResponse.status).toBe(200);
      await expect(readJson(diffResponse)).resolves.toEqual({
        outcome: "available",
        diff: {
          diff: "diff --git a/file.ts b/file.ts",
          truncated: false,
          shortstat: " 1 file changed, 1 insertion(+)\n",
          files: "M\tfile.ts\n",
          mergeBaseRef: "abc1234",
        },
      });

      const branchesPromise = harness.app.request(
        `/api/v1/environments/${environment.id}/diff/branches?selectedBranch=origin%2Fmain`,
      );
      const branchesCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "host.list_branches" &&
          command.path === "/tmp/environment-details/worktree",
      );
      expect(branchesCommand.command).toMatchObject({
        path: "/tmp/environment-details/worktree",
        selectedBranch: "origin/main",
        limit: 50,
      });
      await reportQueuedCommandSuccess(harness, branchesCommand, {
        branches: ["main", "bb/details"],
        branchesTruncated: false,
        remoteBranches: ["origin/main"],
        remoteBranchesTruncated: false,
        checkout: {
          kind: "branch",
          branchName: "bb/details",
          headSha: "abc123",
        },
        defaultBranch: "main",
        hasUncommittedChanges: false,
        operation: { kind: "none" },
        selectedBranch: { name: "origin/main", kind: "remote" },
      });
      const branchesResponse = await branchesPromise;
      expect(branchesResponse.status).toBe(200);
      await expect(readJson(branchesResponse)).resolves.toEqual({
        branches: ["main", "bb/details"],
        branchesTruncated: false,
        remoteBranches: ["origin/main"],
        remoteBranchesTruncated: false,
        selectedBranch: { name: "origin/main", kind: "remote" },
      });
    });
  });

  it("updates an environment merge base branch", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/environment-update",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/environment-update/worktree",
      });

      const response = await harness.app.request(
        `/api/v1/environments/${environment.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mergeBaseBranch: "release" }),
        },
      );

      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toMatchObject({
        id: environment.id,
        mergeBaseBranch: "release",
      });
    });
  });

  it("queues workspace.commit after checking status and diff, then returns the reported commit info", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });

      const responsePromise = harness.app.request(
        `/api/v1/environments/${environment.id}/actions`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            action: "commit",
          }),
        },
      );

      // Step 1: Server queries workspace status
      const statusCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "workspace.status" &&
          command.environmentId === environment.id,
      );
      await reportQueuedCommandSuccess(harness, statusCommand, {
        outcome: "available",
        workspaceStatus: {
          workingTree: {
            hasUncommittedChanges: true,
            state: "dirty_uncommitted",
            insertions: 1,
            deletions: 0,
            files: [],
          },
          branch: {
            currentBranch: "feature",
            defaultBranch: "main",
          },
          mergeBase: null,
        },
      });

      // Step 2: Server queries diff for AI commit message generation
      const diffCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "workspace.diff" &&
          command.environmentId === environment.id,
      );
      expect(diffCommand.command).toMatchObject({
        maxDiffBytes: 32_000,
        maxFileListBytes: 4_000,
        target: { type: "uncommitted" },
      });
      await reportQueuedCommandSuccess(harness, diffCommand, {
        outcome: "available",
        diff: {
          diff: "diff --git a/file.ts b/file.ts",
          truncated: false,
          shortstat: " 1 file changed, 1 insertion(+)\n",
          files: "M\tfile.ts\n",
          mergeBaseRef: null,
        },
      });

      // Step 3: Server queues commit (AI message generation may fall back)
      const commitCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "workspace.commit" &&
          command.environmentId === environment.id,
      );
      expect(commitCommand.command).toMatchObject({
        workspaceContext: {
          workspacePath: "/tmp/test-environment",
          workspaceProvisionType: "unmanaged",
        },
        message: "bb: automated commit",
      });
      await reportQueuedCommandSuccess(harness, commitCommand, {
        commitSha: "abc123",
        commitSubject: "bb: automated commit",
      });

      const response = await responsePromise;
      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toMatchObject({
        ok: true,
        action: "commit",
        commitSha: "abc123",
        commitSubject: "bb: automated commit",
      });
    });
  });

  it("queues workspace.squash_merge after checking status and diff, then returns the merge result", async () => {
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
      });

      const responsePromise = harness.app.request(
        `/api/v1/environments/${environment.id}/actions`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            action: "squash_merge",
            options: {
              mergeBaseBranch: "main",
            },
          }),
        },
      );

      // Step 1: Server queries workspace status
      const statusCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "workspace.status" &&
          command.environmentId === environment.id,
      );
      await reportQueuedCommandSuccess(harness, statusCommand, {
        outcome: "available",
        workspaceStatus: {
          workingTree: {
            hasUncommittedChanges: false,
            state: "clean",
            insertions: 0,
            deletions: 0,
            files: [],
          },
          branch: {
            currentBranch: "bb/feature",
            defaultBranch: "main",
          },
          mergeBase: null,
        },
      });
      await reportLocalSquashMergeTarget(harness, "main");

      // Step 2: Server queries branch_committed diff
      const diffCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "workspace.diff" &&
          command.environmentId === environment.id,
      );
      expect(diffCommand.command).toMatchObject({
        target: { type: "branch_committed", mergeBaseBranch: "main" },
      });
      await reportQueuedCommandSuccess(harness, diffCommand, {
        outcome: "available",
        diff: {
          diff: "diff --git a/file.ts b/file.ts",
          truncated: false,
          shortstat: " 1 file changed, 1 insertion(+)\n",
          files: "M\tfile.ts\n",
          mergeBaseRef: "abc1234",
        },
      });

      // Step 3: Server queues squash_merge with generated message
      const mergeCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "workspace.squash_merge" &&
          command.environmentId === environment.id,
      );
      expect(mergeCommand.command).toMatchObject({
        workspaceContext: {
          workspacePath: "/tmp/test-environment",
          workspaceProvisionType: "managed-worktree",
        },
        targetBranch: "main",
        commitMessage: "bb: squash merge",
      });
      await reportQueuedCommandSuccess(harness, mergeCommand, {
        merged: true,
        commitSha: "merge123",
        commitSubject: "bb: squash merge",
      });

      const response = await responsePromise;
      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toMatchObject({
        ok: true,
        action: "squash_merge",
        merged: true,
        commitSha: "merge123",
        commitSubject: "bb: squash merge",
      });
    });
  });

  it("returns typed workspace unavailable details when commit action cannot resolve workspace status", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });

      const responsePromise = harness.app.request(
        `/api/v1/environments/${environment.id}/actions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "commit" }),
        },
      );

      const statusCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "workspace.status" &&
          command.environmentId === environment.id,
      );
      const diffCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "workspace.diff" &&
          command.environmentId === environment.id,
      );
      const failure: WorkspaceResolutionFailure = {
        code: "path_not_found",
        workspacePath: "/tmp/test-environment",
        message: "Managed workspace path does not exist: /tmp/test-environment",
      };
      await Promise.all([
        reportQueuedCommandSuccess(harness, statusCommand, {
          outcome: "unavailable",
          failure,
        }),
        reportQueuedCommandSuccess(harness, diffCommand, {
          outcome: "available",
          diff: {
            diff: "",
            truncated: false,
            shortstat: "",
            files: "",
            mergeBaseRef: null,
          },
        }),
      ]);

      const response = await responsePromise;
      expect(response.status).toBe(409);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "workspace_unavailable",
        message: failure.message,
        details: {
          kind: "workspace_unavailable",
          failure,
        },
      });
    });
  });

  it("returns typed workspace unavailable details when squash merge cannot resolve workspace status", async () => {
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
      });

      const responsePromise = harness.app.request(
        `/api/v1/environments/${environment.id}/actions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "squash_merge",
            options: { mergeBaseBranch: "main" },
          }),
        },
      );

      const statusCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "workspace.status" &&
          command.environmentId === environment.id,
      );
      const failure: WorkspaceResolutionFailure = {
        code: "workspace_type_mismatch",
        workspacePath: "/tmp/test-environment",
        message:
          "Loaded environment env_test is bound to /tmp/old, not /tmp/test-environment",
      };
      await reportQueuedCommandSuccess(harness, statusCommand, {
        outcome: "unavailable",
        failure,
      });

      const response = await responsePromise;
      expect(response.status).toBe(409);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "workspace_unavailable",
        message: failure.message,
        details: {
          kind: "workspace_unavailable",
          failure,
        },
      });
    });
  });

  it("uses fallback squash commit message when Codex inference fails", async () => {
    await withTestHarness({
      inferenceModel: "codex/gpt-5.4-mini",
    }, async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        managed: true,
        workspaceProvisionType: "managed-worktree",
      });

      const responsePromise = harness.app.request(
        `/api/v1/environments/${environment.id}/actions`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            action: "squash_merge",
            options: {
              mergeBaseBranch: "main",
            },
          }),
        },
      );

      const statusCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "workspace.status" &&
          command.environmentId === environment.id,
      );
      await reportQueuedCommandSuccess(harness, statusCommand, {
        outcome: "available",
        workspaceStatus: {
          workingTree: {
            hasUncommittedChanges: false,
            state: "clean",
            insertions: 0,
            deletions: 0,
            files: [],
          },
          branch: {
            currentBranch: "bb/feature",
            defaultBranch: "main",
          },
          mergeBase: null,
        },
      });
      await reportLocalSquashMergeTarget(harness, "main");

      const diffCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "workspace.diff" &&
          command.environmentId === environment.id,
      );
      await reportQueuedCommandSuccess(harness, diffCommand, {
        outcome: "available",
        diff: {
          diff: "diff --git a/file.ts b/file.ts",
          truncated: false,
          shortstat: " 1 file changed, 1 insertion(+)\n",
          files: "M\tfile.ts\n",
          mergeBaseRef: "abc1234",
        },
      });

      const inferenceCommand = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "codex.inference.complete",
      );
      await reportQueuedCommandError(harness, inferenceCommand, {
        errorCode: "codex_auth_missing",
        errorMessage: "Codex auth file not found",
      });

      const mergeCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "workspace.squash_merge" &&
          command.environmentId === environment.id,
      );
      expect(mergeCommand.command).toMatchObject({
        targetBranch: "main",
        commitMessage: "bb: squash merge",
      });
      await reportQueuedCommandSuccess(harness, mergeCommand, {
        merged: true,
        commitSha: "merge123",
        commitSubject: "bb: squash merge",
      });

      const response = await responsePromise;
      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toMatchObject({
        ok: true,
        action: "squash_merge",
        merged: true,
        commitSha: "merge123",
        commitSubject: "bb: squash merge",
      });
    });
  });

  it("rejects squash merge with 409 when workspace is in detached HEAD state", async () => {
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
      });

      const responsePromise = harness.app.request(
        `/api/v1/environments/${environment.id}/actions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "squash_merge",
            options: { mergeBaseBranch: "main" },
          }),
        },
      );

      const statusCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "workspace.status" &&
          command.environmentId === environment.id,
      );
      await reportQueuedCommandSuccess(harness, statusCommand, {
        outcome: "available",
        workspaceStatus: {
          workingTree: {
            hasUncommittedChanges: false,
            state: "clean",
            insertions: 0,
            deletions: 0,
            files: [],
          },
          branch: {
            currentBranch: null,
            defaultBranch: "main",
          },
          mergeBase: null,
        },
      });

      const response = await responsePromise;
      expect(response.status).toBe(409);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "invalid_request",
      });
    });
  });

  it("rejects squash merge into a remote-only target before commit or diff", async () => {
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
      });

      const responsePromise = harness.app.request(
        `/api/v1/environments/${environment.id}/actions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "squash_merge",
            options: { mergeBaseBranch: "origin/main" },
          }),
        },
      );

      const statusCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "workspace.status" &&
          command.environmentId === environment.id,
      );
      await reportQueuedCommandSuccess(harness, statusCommand, {
        outcome: "available",
        workspaceStatus: {
          workingTree: {
            hasUncommittedChanges: true,
            state: "dirty_uncommitted",
            insertions: 1,
            deletions: 0,
            files: [],
          },
          branch: {
            currentBranch: "bb/feature",
            defaultBranch: "main",
          },
          mergeBase: null,
        },
      });

      const targetCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "host.list_branches" &&
          command.selectedBranch === "origin/main",
      );
      await reportQueuedCommandSuccess(harness, targetCommand, {
        branches: ["main"],
        branchesTruncated: false,
        checkout: {
          kind: "branch",
          branchName: "bb/feature",
          headSha: "abc123",
        },
        defaultBranch: "main",
        hasUncommittedChanges: true,
        operation: { kind: "none" },
        remoteBranches: ["origin/main"],
        remoteBranchesTruncated: false,
        selectedBranch: { name: "origin/main", kind: "remote" },
      });

      const response = await responsePromise;
      expect(response.status).toBe(409);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "invalid_request",
      });
    });
  });

  it("rejects commit with 409 when workspace has no uncommitted changes", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });

      const responsePromise = harness.app.request(
        `/api/v1/environments/${environment.id}/actions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "commit",
          }),
        },
      );

      // Status and diff are fired in parallel; respond to both
      const statusCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "workspace.status" &&
          command.environmentId === environment.id,
      );
      const diffCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "workspace.diff" &&
          command.environmentId === environment.id,
      );
      await Promise.all([
        reportQueuedCommandSuccess(harness, statusCommand, {
          outcome: "available",
          workspaceStatus: {
            workingTree: {
              hasUncommittedChanges: false,
              state: "clean",
              insertions: 0,
              deletions: 0,
              files: [],
            },
            branch: {
              currentBranch: "feature",
              defaultBranch: "main",
            },
            mergeBase: null,
          },
        }),
        reportQueuedCommandSuccess(harness, diffCommand, {
          outcome: "available",
          diff: {
            diff: "",
            truncated: false,
            shortstat: "",
            files: "",
            mergeBaseRef: null,
          },
        }),
      ]);

      const response = await responsePromise;
      expect(response.status).toBe(409);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "no_changes",
      });
    });
  });

  it("auto-commits dirty workspace before squash merge", async () => {
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
      });

      const responsePromise = harness.app.request(
        `/api/v1/environments/${environment.id}/actions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "squash_merge",
            options: { mergeBaseBranch: "main" },
          }),
        },
      );

      // Step 1: Status reports dirty workspace
      const statusCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "workspace.status" &&
          command.environmentId === environment.id,
      );
      await reportQueuedCommandSuccess(harness, statusCommand, {
        outcome: "available",
        workspaceStatus: {
          workingTree: {
            hasUncommittedChanges: true,
            state: "dirty_uncommitted",
            insertions: 5,
            deletions: 1,
            files: [],
          },
          branch: {
            currentBranch: "bb/dirty-merge",
            defaultBranch: "main",
          },
          mergeBase: null,
        },
      });
      await reportLocalSquashMergeTarget(harness, "main");

      // Step 2: Server issues pre-merge commit
      const preCommitCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "workspace.commit" &&
          command.environmentId === environment.id,
      );
      expect(preCommitCommand.command).toMatchObject({
        message: "bb: pre-merge commit",
      });
      await reportQueuedCommandSuccess(harness, preCommitCommand, {
        commitSha: "pre-merge-sha",
        commitSubject: "bb: pre-merge commit",
      });

      // Step 3: Diff for AI message
      const diffCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "workspace.diff" &&
          command.environmentId === environment.id,
      );
      expect(diffCommand.command).toMatchObject({
        target: { type: "branch_committed", mergeBaseBranch: "main" },
      });
      await reportQueuedCommandSuccess(harness, diffCommand, {
        outcome: "available",
        diff: {
          diff: "diff --git a/file.ts b/file.ts",
          truncated: false,
          shortstat: " 1 file changed, 5 insertions(+), 1 deletion(-)\n",
          files: "M\tfile.ts\n",
          mergeBaseRef: "abc1234",
        },
      });

      // Step 4: Final squash merge
      const mergeCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "workspace.squash_merge" &&
          command.environmentId === environment.id,
      );
      expect(mergeCommand.command).toMatchObject({
        targetBranch: "main",
        commitMessage: "bb: squash merge",
      });
      await reportQueuedCommandSuccess(harness, mergeCommand, {
        merged: true,
        commitSha: "squash-sha",
        commitSubject: "bb: squash merge",
      });

      const response = await responsePromise;
      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toMatchObject({
        ok: true,
        action: "squash_merge",
        merged: true,
        commitSha: "squash-sha",
        commitSubject: "bb: squash merge",
      });
    });
  });

  it("returns runtime config from GET /system/config", async () => {
    await withTestHarness({
      openAiApiKey: "",
      transcriptionModel: "openai/gpt-4o-transcribe",
    }, async (harness) => {
      const response = await harness.app.request("/api/v1/system/config");
      expect(response.status).toBe(200);
      // Decision 5: the advertised local-API port is the server's own port.
      await expect(readJson(response)).resolves.toEqual({
        featureFlags: { placeholder: false },
        hostDaemonPort: harness.deps.config.serverPort,
        voiceTranscriptionEnabled: false,
      });
    });
  });

  it("reports Codex voice transcription enabled when a persistent host is connected", async () => {
    await withTestHarness({
      openAiApiKey: "",
      transcriptionModel: "codex/gpt-4o-mini-transcribe",
    }, async (harness) => {
      seedHostSession(harness.deps, {
        id: "host-voice-availability",
      });
      const response = await harness.app.request("/api/v1/system/config");
      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toMatchObject({
        voiceTranscriptionEnabled: true,
      });
    });
  });

  it("reloads bb-app managed config from POST /system/config/reload", async () => {
    await withTestHarness({
      openAiApiKey: "ambient-openai-key",
    }, async (harness) => {
      await writeFile(
        join(harness.config.dataDir, "env.json"),
        `${JSON.stringify({ env: { OPENAI_API_KEY: "stored-openai-key" } })}\n`,
        "utf8",
      );

      const response = await harness.app.request(
        "/api/v1/system/config/reload",
        {
          method: "POST",
        },
      );

      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toEqual({ ok: true });
      expect(harness.config.openAiApiKey).toBe("stored-openai-key");
    });
  });

  it("rejects invalid bb-app managed config reloads without changing runtime config", async () => {
    await withTestHarness({
      inferenceModel: "openai/gpt-4o-mini",
    }, async (harness) => {
      await writeFile(
        join(harness.config.dataDir, "config.json"),
        `${JSON.stringify({ config: { BB_INFERENCE: "gpt-4o-mini" } })}\n`,
        "utf8",
      );

      const response = await harness.app.request(
        "/api/v1/system/config/reload",
        {
          method: "POST",
        },
      );

      expect(response.status).toBe(422);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "invalid_config",
      });
      expect(harness.config.inferenceModel).toBe("openai/gpt-4o-mini");
    });
  });

  it("returns ok from GET /health", async () => {
    await withTestHarness(async (harness) => {
      const response = await harness.app.request("/health");
      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toEqual({ ok: true });
    });
  });

  it("uses host RPC, not durable commands, for system provider reads", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-system-routes",
      });
      const providers = [
        makeSystemProvider({
          id: "codex",
          displayName: "Codex",
          capabilities: {
            supportsArchive: true,
            supportsRename: true,
            supportsServiceTier: true,
          },
        }),
        makeSystemProvider({
          id: "claude-code",
          displayName: "Claude Code",
          capabilities: {
            supportsArchive: true,
            supportsRename: true,
            supportsUserQuestion: true,
            supportedPermissionModes: ["full"],
          },
        }),
      ];
      const responder = registerProviderHostRpcResponder(harness, {
        providers,
        modelsByProviderId: {
          codex: {
            models: [
              {
                id: "codex-mini",
                model: "gpt-4o-mini",
                displayName: "Codex Mini",
                description: "Fast codex model",
                supportedReasoningEfforts: [
                  {
                    reasoningEffort: "medium",
                    description: "Balanced",
                  },
                ],
                defaultReasoningEffort: "medium",
                isDefault: true,
              },
            ],
            selectedOnlyModels: [
              {
                id: "gpt-4o-mini-legacy",
                model: "gpt-4o-mini-legacy",
                displayName: "Legacy Mini",
                description:
                  "Retired mini model retained for existing selections",
                supportedReasoningEfforts: [
                  {
                    reasoningEffort: "medium",
                    description: "Balanced",
                  },
                ],
                defaultReasoningEffort: "medium",
                isDefault: false,
              },
            ],
          },
        },
      });

      const providersResponse = await harness.app.request(
        `/api/v1/system/providers?hostId=${host.id}`,
      );
      expect(providersResponse.status).toBe(200);
      await expect(readJson(providersResponse)).resolves.toEqual([
        expect.objectContaining({
          id: "codex",
          capabilities: expect.objectContaining({
            supportsUserQuestion: false,
          }),
        }),
        expect.objectContaining({
          id: "claude-code",
          capabilities: expect.objectContaining({
            supportsUserQuestion: true,
          }),
        }),
      ]);

      const executionOptionsResponse = await harness.app.request(
        `/api/v1/system/execution-options?hostId=${host.id}&providerId=codex`,
      );
      expect(executionOptionsResponse.status).toBe(200);
      await expect(readJson(executionOptionsResponse)).resolves.toEqual({
        providers: [
          expect.objectContaining({
            id: "codex",
          }),
          expect.objectContaining({
            id: "claude-code",
            capabilities: expect.objectContaining({
              supportsUserQuestion: true,
            }),
          }),
        ],
        models: [
          expect.objectContaining({
            id: "codex-mini",
          }),
        ],
        selectedOnlyModels: [
          expect.objectContaining({
            id: "gpt-4o-mini-legacy",
          }),
        ],
        modelLoadError: null,
      });

      // A stale providerId falls back to the first provider in the list and
      // fetches that provider's models — the response still contains the full
      // providers list so the client can recover.
      const missingProviderOptionsResponse = await harness.app.request(
        `/api/v1/system/execution-options?hostId=${host.id}&providerId=missing-provider`,
      );
      expect(missingProviderOptionsResponse.status).toBe(200);
      await expect(readJson(missingProviderOptionsResponse)).resolves.toEqual({
        providers: [
          expect.objectContaining({
            id: "codex",
          }),
          expect.objectContaining({
            id: "claude-code",
          }),
        ],
        models: [
          expect.objectContaining({
            id: "codex-mini",
          }),
        ],
        selectedOnlyModels: [
          expect.objectContaining({
            id: "gpt-4o-mini-legacy",
          }),
        ],
        modelLoadError: null,
      });
      expect(responder.requests.map((request) => request.command)).toEqual([
        { type: "provider.list" },
        { type: "provider.list" },
        { type: "provider.list_models", providerId: "codex" },
        { type: "provider.list" },
        { type: "provider.list_models", providerId: "codex" },
      ]);
      expect(harness.engineRouting.dispatched).toEqual([]);
    });
  });

  it.each(PROVIDER_MODEL_LOOKUP_FAILURE_CASES)(
    "returns provider choices with a provider-specific error when model lookup fails: $name",
    async ({ errorCode, providerId, errorMessage, expectedCode }) => {
      await withTestHarness(async (harness) => {
        const { host } = seedHostSession(harness.deps, {
          id: `host-system-${providerId}-models-fail`,
        });
        registerProviderHostRpcResponder(harness, {
          providers: [
            makeSystemProvider({
              id: "codex",
              displayName: "Codex",
              capabilities: {
                supportsArchive: true,
                supportsRename: true,
                supportsServiceTier: true,
              },
            }),
            makeSystemProvider({
              id: "claude-code",
              displayName: "Claude Code",
              capabilities: {
                supportsUserQuestion: true,
              },
            }),
            makeSystemProvider({
              id: "pi",
              displayName: "Pi",
              capabilities: {
                supportedPermissionModes: ["full"],
              },
            }),
          ],
          modelErrorsByProviderId: {
            [providerId]: {
              errorCode,
              errorMessage,
            },
          },
        });

        const response = await harness.app.request(
          `/api/v1/system/execution-options?hostId=${host.id}&providerId=${providerId}`,
        );

        expect(response.status).toBe(200);
        await expect(readJson(response)).resolves.toEqual({
          providers: [
            expect.objectContaining({
              id: "codex",
            }),
            expect.objectContaining({
              id: "claude-code",
            }),
            expect.objectContaining({
              id: "pi",
            }),
          ],
          models: [],
          selectedOnlyModels: [],
          modelLoadError: {
            providerId,
            code: expectedCode,
          },
        });
        expect(harness.engineRouting.dispatched).toEqual([]);
      });
    },
  );

  it("uses a persistent host for default system provider lookups", async () => {
    await withTestHarness(async (harness) => {
      seedHostSession(harness.deps, {
        id: "host-system-default-persistent",
      });
      registerProviderHostRpcResponder(harness, {
        providers: [
          {
            id: "codex",
            displayName: "Codex",
            capabilities: {
              supportsArchive: true,
              supportsRename: true,
              supportsServiceTier: true,
              supportsUserQuestion: false,
              supportedPermissionModes: [
                "full",
                "workspace-write",
                "readonly",
              ],
            },
            available: true,
          },
        ],
      });

      const providersResponse = await harness.app.request(
        "/api/v1/system/providers",
      );

      expect(providersResponse.status).toBe(200);
      // Provider reads stay RPC-only: nothing goes through dispatch.
      expect(harness.engineRouting.dispatched).toEqual([]);
    });
  });

  it("rejects invalid system query params with a 400", async () => {
    await withTestHarness(async (harness) => {
      const response = await harness.app.request(
        "/api/v1/system/execution-options?providerId=",
      );
      expect(response.status).toBe(400);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "invalid_request",
      });
    });
  });

  it("uses the configured OpenAI voice transcription model when selected", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ text: "transcribed text" }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      }),
    );
    await withTestHarness({
      openAiApiKey: "provider-key",
      transcriptionModel: "openai/gpt-4o-transcribe",
    }, async (harness) => {
      const formData = new FormData();
      formData.set(
        "file",
        new File([new Uint8Array([1, 2, 3])], "audio.wav", {
          type: "audio/wav",
        }),
        "audio.wav",
      );
      formData.set("prompt", "  Use repo vocabulary.  ");

      const response = await harness.app.request(
        "/api/v1/system/voice-transcription",
        {
          method: "POST",
          body: formData,
        },
      );

      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toEqual({
        text: "transcribed text",
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const fetchCall = fetchMock.mock.calls[0];
      if (!fetchCall) {
        throw new Error("Expected fetch call");
      }
      expect(fetchCall[0]).toBe(
        "https://api.openai.com/v1/audio/transcriptions",
      );
      const init = fetchCall[1];
      expect(init?.headers).toEqual({
        authorization: "Bearer provider-key",
      });
      const body = init?.body;
      if (!(body instanceof FormData)) {
        throw new Error("Expected transcription request body to be FormData");
      }
      expect(body.get("model")).toBe("gpt-4o-transcribe");
      expect(body.get("prompt")).toBe("Use repo vocabulary.");
      const file = body.get("file");
      if (!(file instanceof File)) {
        throw new Error("Expected transcription request file");
      }
      expect(file.name).toBe("audio.wav");
    });
  });

  it("queues Codex voice transcription through the persistent host", async () => {
    await withTestHarness({
      openAiApiKey: "",
      transcriptionModel: "codex/gpt-4o-mini-transcribe",
    }, async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const formData = new FormData();
      formData.set(
        "file",
        new File([new Uint8Array([1, 2, 3])], "audio.wav", {
          type: "audio/wav",
        }),
        "audio.wav",
      );
      formData.set("prompt", "  Use repo vocabulary.  ");

      const responsePromise = harness.app.request(
        "/api/v1/system/voice-transcription",
        {
          method: "POST",
          body: formData,
        },
      );
      const command = await waitForQueuedCommand(
        harness,
        (queued) =>
          queued.command.type === "codex.voice.transcribe" &&
          queued.row.hostId === host.id,
      );
      expect(command.command).toEqual({
        type: "codex.voice.transcribe",
        model: "gpt-4o-mini-transcribe",
        audioBase64: Buffer.from([1, 2, 3]).toString("base64"),
        mimeType: "audio/wav",
        filename: "audio.wav",
        prompt: "Use repo vocabulary.",
        timeoutMs: 60_000,
      });
      await reportQueuedCommandSuccess(
        harness,
        command,
        {
          model: "gpt-4o-mini-transcribe",
          text: "transcribed through codex",
        },
      );

      const response = await responsePromise;
      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toEqual({
        text: "transcribed through codex",
      });
    });
  });

  it("maps Codex voice transcription timeouts to a retryable API error", async () => {
    await withTestHarness({
      openAiApiKey: "",
      transcriptionModel: "codex/gpt-4o-mini-transcribe",
    }, async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const formData = new FormData();
      formData.set(
        "file",
        new File([new Uint8Array([1, 2, 3])], "audio.wav", {
          type: "audio/wav",
        }),
        "audio.wav",
      );

      const responsePromise = harness.app.request(
        "/api/v1/system/voice-transcription",
        {
          method: "POST",
          body: formData,
        },
      );
      const command = await waitForQueuedCommand(
        harness,
        (queued) =>
          queued.command.type === "codex.voice.transcribe" &&
          queued.row.hostId === host.id,
      );
      await reportQueuedCommandError(
        harness,
        command,
        {
          errorCode: "codex_request_timeout",
          errorMessage: "Codex request timed out",
        },
      );

      const response = await responsePromise;
      expect(response.status).toBe(504);
      await expect(readJson(response)).resolves.toEqual({
        code: "transcription_timeout",
        message: "Voice transcription timed out",
        retryable: true,
      });
    });
  });

  it("surfaces Codex voice transcription auth failures", async () => {
    await withTestHarness({
      openAiApiKey: "",
      transcriptionModel: "codex/gpt-4o-mini-transcribe",
    }, async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const formData = new FormData();
      formData.set(
        "file",
        new File([new Uint8Array([1, 2, 3])], "audio.wav", {
          type: "audio/wav",
        }),
        "audio.wav",
      );

      const responsePromise = harness.app.request(
        "/api/v1/system/voice-transcription",
        {
          method: "POST",
          body: formData,
        },
      );
      const command = await waitForQueuedCommand(
        harness,
        (queued) =>
          queued.command.type === "codex.voice.transcribe" &&
          queued.row.hostId === host.id,
      );
      await reportQueuedCommandError(
        harness,
        command,
        {
          errorCode: "codex_auth_missing",
          errorMessage: "Codex auth file not found",
        },
      );

      const response = await responsePromise;
      expect(response.status).toBe(502);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "codex_auth_missing",
      });
    });
  });

  it("rejects OpenAI voice transcription requests when the API key is not configured", async () => {
    await withTestHarness({
      openAiApiKey: "",
      transcriptionModel: "openai/gpt-4o-transcribe",
    }, async (harness) => {
      const formData = new FormData();
      formData.set(
        "file",
        new File([new Uint8Array([1, 2, 3])], "audio.wav", {
          type: "audio/wav",
        }),
        "audio.wav",
      );

      const response = await harness.app.request(
        "/api/v1/system/voice-transcription",
        {
          method: "POST",
          body: formData,
        },
      );

      expect(response.status).toBe(501);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "not_configured",
        message:
          "Voice transcription requires OPENAI_API_KEY for openai/* transcription",
      });
    });
  });
});
