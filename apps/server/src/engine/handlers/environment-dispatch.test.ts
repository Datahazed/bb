/**
 * Ported verbatim from `apps/host-daemon/test/command/environment-dispatch.test.ts` (P1c —
 * the daemon died in this change). These pin dispatch-handler behavior, not
 * transport semantics; only import paths and the event-sink input type
 * (`BufferedEventInput` → `EngineThreadEventInput`) changed in the port.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getPersonalWorkspaceRoot,
  WorkspaceError,
  type HostWorkspace,
} from "@bb/host-workspace";
import type { HostDaemonCommand } from "@bb/host-daemon-contract";
import { dispatchCommand } from "../core/command-dispatch.js";
import type { EngineThreadEventInput } from "../ports.js";
import {
  cleanupTempDirs,
  createFakeRuntime,
  createFakeWorkspace,
  createHarness,
  makeDispatchOptions,
  makeTempDir,
} from "./dispatch-helpers.js";
import { RuntimeManager } from "../core/runtime-manager.js";

afterEach(cleanupTempDirs);

describe("environment command dispatch", () => {
  it("covers environment.provision in unmanaged mode", async () => {
    const harness = createHarness({ workspacePath: "/tmp/unmanaged" });
    const sourcePath = await makeTempDir("bb-dispatch-unmanaged-");

    const result = await dispatchCommand(
      {
        type: "environment.provision",
        environmentId: "env-unmanaged",
        initiator: null,
        workspaceProvisionType: "unmanaged",
        path: sourcePath,
      },
      harness.dispatchOptions(),
    );

    expect(result).toMatchObject({
      path: sourcePath,
      isGitRepo: true,
      isWorktree: false,
      branchName: "main",
      defaultBranch: "main",
    });
    expect(result.transcript).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "workspace-path",
          text: `Using workspace: ${sourcePath}`,
        }),
        expect.objectContaining({
          key: "workspace-branch",
          text: expect.stringContaining("Using branch: main"),
        }),
      ]),
    );
    expect(harness.provisions).toEqual([
      {
        workspaceProvisionType: "unmanaged",
        path: sourcePath,
        onProgress: expect.any(Function),
        signal: expect.any(AbortSignal),
      },
    ]);
  });

  it("covers environment.provision in managed-worktree mode", async () => {
    const harness = createHarness({
      workspacePath: "/tmp/worktree",
      isWorktree: true,
    });
    const sourcePath = await makeTempDir("bb-dispatch-worktree-");

    const result = await dispatchCommand(
      {
        type: "environment.provision",
        environmentId: "env-worktree",
        initiator: null,
        workspaceProvisionType: "managed-worktree",
        sourcePath,
        targetPath: "/tmp/worktree",
        branchName: "bb/test",
        baseBranch: "main",
        setupTimeoutMs: 900000,
      },
      harness.dispatchOptions(),
    );

    expect(result).toMatchObject({
      path: "/tmp/worktree",
      isGitRepo: true,
      isWorktree: true,
      branchName: "main",
      defaultBranch: "main",
    });
    expect(result.transcript).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "workspace-path",
          text: "Using workspace: /tmp/worktree",
        }),
        expect.objectContaining({
          key: "workspace-branch",
          text: expect.stringContaining("Using branch: main"),
        }),
      ]),
    );
    expect(harness.provisions).toEqual([
      {
        workspaceProvisionType: "managed-worktree",
        sourcePath,
        targetPath: "/tmp/worktree",
        branchName: "bb/test",
        baseBranch: "main",
        timeoutMs: 900000,
        onProgress: expect.any(Function),
        signal: expect.any(AbortSignal),
      },
    ]);
  });

  it("covers environment.provision in personal mode", async () => {
    const dataDir = await makeTempDir("bb-dispatch-personal-data-");
    const environmentId = "env_personal";
    const personalWorkspaceRoot = getPersonalWorkspaceRoot(dataDir);
    const targetPath = `${personalWorkspaceRoot}/${environmentId}`;
    const harness = createHarness({
      workspacePath: targetPath,
    });
    harness.workspace.isGitRepo = false;
    harness.workspace.getCurrentBranch = async () => null;

    const result = await dispatchCommand(
      {
        type: "environment.provision",
        environmentId,
        initiator: null,
        workspaceProvisionType: "personal",
        targetPath,
      },
      harness.dispatchOptions({ dataDir }),
    );

    expect(result).toMatchObject({
      path: targetPath,
      isGitRepo: false,
      isWorktree: false,
      branchName: null,
      defaultBranch: null,
    });
    expect(harness.provisions).toEqual([
      {
        workspaceProvisionType: "personal",
        environmentId,
        personalWorkspaceRoot,
        targetPath,
        onProgress: expect.any(Function),
        signal: expect.any(AbortSignal),
      },
    ]);
  });

  it("returns success when cancelling a provision with no in-flight work", async () => {
    const harness = createHarness();

    await expect(
      dispatchCommand(
        {
          type: "environment.provision.cancel",
          environmentId: "env-missing",
        },
        harness.dispatchOptions(),
      ),
    ).resolves.toEqual({ aborted: false });
  });

  it("aborts in-flight environment provisioning", async () => {
    const { workspace } = createFakeWorkspace("/tmp/cancelled");
    const { runtime } = createFakeRuntime();
    let provisionSignal: AbortSignal | undefined;
    let resolveProvisionStarted: () => void = () => undefined;
    const provisionStarted = new Promise<void>((resolve) => {
      resolveProvisionStarted = resolve;
    });
    const manager = new RuntimeManager({
      createRuntime: () => runtime,
      provisionWorkspace: async (options) => {
        provisionSignal = options.signal;
        resolveProvisionStarted();
        await new Promise<void>((resolve, reject) => {
          options.signal?.addEventListener(
            "abort",
            () => {
              reject(options.signal?.reason);
            },
            { once: true },
          );
        });
        return workspace;
      },
    });
    const dispatchOptions = makeDispatchOptions({ runtimeManager: manager });
    const provision = dispatchCommand(
      {
        type: "environment.provision",
        environmentId: "env-cancel",
        initiator: null,
        workspaceProvisionType: "unmanaged",
        path: "/tmp/cancelled",
      },
      dispatchOptions,
    );
    await provisionStarted;

    await expect(
      dispatchCommand(
        {
          type: "environment.provision.cancel",
          environmentId: "env-cancel",
        },
        dispatchOptions,
      ),
    ).resolves.toEqual({ aborted: true });

    expect(provisionSignal?.aborted).toBe(true);
    await expect(provision).rejects.toMatchObject({
      code: "provision_cancelled",
    });
  });

  it("reports provision cancellation after delivering abort without waiting for work to settle", async () => {
    const { runtime } = createFakeRuntime();
    let abortObserved = false;
    let provisionSettled = false;
    let provisionSignal: AbortSignal | undefined;
    let resolveProvisionStarted: () => void = () => undefined;
    const provisionStarted = new Promise<void>((resolve) => {
      resolveProvisionStarted = resolve;
    });
    const manager = new RuntimeManager({
      createRuntime: () => runtime,
      provisionWorkspace: async (options) => {
        provisionSignal = options.signal;
        options.signal?.addEventListener(
          "abort",
          () => {
            abortObserved = true;
          },
          { once: true },
        );
        resolveProvisionStarted();
        return new Promise<HostWorkspace>(() => undefined);
      },
    });
    const dispatchOptions = makeDispatchOptions({ runtimeManager: manager });
    const provision = dispatchCommand(
      {
        type: "environment.provision",
        environmentId: "env-cancel-no-settle",
        initiator: null,
        workspaceProvisionType: "unmanaged",
        path: "/tmp/cancelled-no-settle",
      },
      dispatchOptions,
    ).finally(() => {
      provisionSettled = true;
    });
    await provisionStarted;

    const cancel = dispatchCommand(
      {
        type: "environment.provision.cancel",
        environmentId: "env-cancel-no-settle",
      },
      dispatchOptions,
    );

    await expect(cancel).resolves.toEqual({ aborted: true });
    expect(provisionSignal?.aborted).toBe(true);
    expect(abortObserved).toBe(true);
    expect(provisionSettled).toBe(false);
    void provision;
  });

  it("rejects personal provision targets outside the data dir personal workspace root", async () => {
    const dataDir = await makeTempDir("bb-dispatch-personal-data-");
    const environmentId = "env_personal";
    const harness = createHarness();

    await expect(() =>
      dispatchCommand(
        {
          type: "environment.provision",
          environmentId,
          initiator: null,
          workspaceProvisionType: "personal",
          targetPath: `${dataDir}/personal-workspaces-sibling/${environmentId}`,
        },
        harness.dispatchOptions({ dataDir }),
      ),
    ).rejects.toThrow("Personal workspace target path must match");
    expect(harness.provisions).toEqual([]);
  });

  it("rejects personal provision targets that traverse out of the environment directory", async () => {
    const dataDir = await makeTempDir("bb-dispatch-personal-data-");
    const environmentId = "env_personal";
    const harness = createHarness();

    await expect(() =>
      dispatchCommand(
        {
          type: "environment.provision",
          environmentId,
          initiator: null,
          workspaceProvisionType: "personal",
          targetPath: `${getPersonalWorkspaceRoot(dataDir)}/${environmentId}/../env_other`,
        },
        harness.dispatchOptions({ dataDir }),
      ),
    ).rejects.toThrow("Personal workspace target path must match");
    expect(harness.provisions).toEqual([]);
  });

  it("streams live events and flushes when initiator is provided", async () => {
    const harness = createHarness({ workspacePath: "/tmp/live-stream" });
    const sourcePath = await makeTempDir("bb-dispatch-stream-");
    const emittedEvents: EngineThreadEventInput[] = [];
    let flushCount = 0;

    const result = await dispatchCommand(
      {
        type: "environment.provision",
        environmentId: "env-stream",
        initiator: {
          threadId: "thr-initiator",
          provisioningId: "tpv-initiator",
        },
        workspaceProvisionType: "unmanaged",
        path: sourcePath,
      },
      makeDispatchOptions({
        runtimeManager: harness.manager,
        eventSink: {
          emit: (event) => {
            emittedEvents.push(event);
          },
          flush: async () => {
            flushCount += 1;
          },
        },
      }),
    );

    expect(flushCount).toBe(1);
    expect(emittedEvents.length).toBeGreaterThan(0);
    const firstEvent = emittedEvents[0];
    expect(firstEvent?.threadId).toBe("thr-initiator");
    expect(
      firstEvent && "environmentId" in firstEvent.event
        ? firstEvent.event.environmentId
        : undefined,
    ).toBe("env-stream");
    expect(result.transcript.length).toBeGreaterThan(0);
    expect(result.transcript).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "workspace-path" }),
        expect.objectContaining({ key: "workspace-branch" }),
      ]),
    );
  });

  it("flushes live events before surfacing provisioning failures", async () => {
    const emittedEvents: EngineThreadEventInput[] = [];
    let flushCount = 0;
    const manager = new RuntimeManager({
      provisionWorkspace: async (options) => {
        options.onProgress?.({
          type: "step",
          key: "git-worktree",
          text: "git worktree add -B bb/failure /tmp/failure",
          status: "started",
          startedAt: Date.now(),
        });
        throw new WorkspaceError(
          "git_command_failed",
          "git worktree add failed",
        );
      },
      createRuntime: () => createFakeRuntime().runtime,
    });

    await expect(() =>
      dispatchCommand(
        {
          type: "environment.provision",
          environmentId: "env-failure",
          initiator: {
            threadId: "thr-failure",
            provisioningId: "tpv-failure",
          },
          workspaceProvisionType: "managed-worktree",
          sourcePath: "/tmp/source",
          targetPath: "/tmp/failure",
          branchName: "bb/failure",
          baseBranch: "main",
          setupTimeoutMs: 900000,
        },
        makeDispatchOptions({
          runtimeManager: manager,
          eventSink: {
            emit: (event) => {
              emittedEvents.push(event);
            },
            flush: async () => {
              flushCount += 1;
            },
          },
        }),
      ),
    ).rejects.toThrow("git worktree add failed");

    expect(emittedEvents).toEqual([
      expect.objectContaining({
        event: expect.objectContaining({ environmentId: "env-failure" }),
        threadId: "thr-failure",
      }),
    ]);
    expect(flushCount).toBe(1);
  });

  it("returns empty transcript when environment already exists", async () => {
    const harness = createHarness({ workspacePath: "/tmp/idempotent" });
    const sourcePath = await makeTempDir("bb-dispatch-idempotent-");

    // First provision
    await dispatchCommand(
      {
        type: "environment.provision",
        environmentId: "env-idempotent",
        initiator: null,
        workspaceProvisionType: "unmanaged",
        path: sourcePath,
      },
      harness.dispatchOptions(),
    );

    // Second provision — same environment
    const result = await dispatchCommand(
      {
        type: "environment.provision",
        environmentId: "env-idempotent",
        initiator: {
          threadId: "thr-second",
          provisioningId: "tpv-second",
        },
        workspaceProvisionType: "unmanaged",
        path: sourcePath,
      },
      harness.dispatchOptions(),
    );

    expect(result.transcript).toEqual([]);
  });

  it("covers environment.destroy", async () => {
    const harness = createHarness();
    const closeEnvironmentTerminals = vi.fn();
    await harness.manager.ensureEnvironment({
      environmentId: "env-1",
      workspacePath: "/tmp/env-1",
    });

    const result = await dispatchCommand(
      {
        type: "environment.destroy",
        environmentId: "env-1",
        workspaceContext: {
          workspacePath: "/tmp/env-1",
          workspaceProvisionType: "managed-worktree",
        },
      },
      makeDispatchOptions({
        runtimeManager: harness.manager,
        terminalManager: { closeEnvironmentTerminals },
      }),
    );

    expect(result).toEqual({});
    expect(closeEnvironmentTerminals).toHaveBeenCalledWith(
      "env-1",
      "environment-destroyed",
    );
    expect(harness.runtimeState.shutdownCount).toBe(1);
    expect(harness.workspaceState.destroyed).toBe(true);
  });

  it("destroys a managed environment after daemon restart (not in memory)", async () => {
    const harness = createHarness();
    // Environment is NOT in memory — simulates daemon restart.
    // The destroy command must reconnect using workspaceContext before destroying.
    const result = await dispatchCommand(
      {
        type: "environment.destroy",
        environmentId: "env-restart",
        workspaceContext: {
          workspacePath: "/tmp/env-1",
          workspaceProvisionType: "managed-worktree",
        },
      },
      makeDispatchOptions({ runtimeManager: harness.manager }),
    );

    expect(result).toEqual({});
    // The workspace was reconnected (lazy provision) then destroyed
    expect(harness.workspaceState.destroyed).toBe(true);
    expect(harness.provisions).toEqual([
      {
        workspaceProvisionType: "reconnect-managed-worktree",
        path: "/tmp/env-1",
        signal: expect.any(AbortSignal),
      },
    ]);
  });

  it("treats a retry as success when the workspace was already removed", async () => {
    // Simulate: first destroy succeeds and removes the workspace,
    // then daemon crashes before reporting. On retry, the path is gone.
    let callCount = 0;
    const { workspace } = createFakeWorkspace("/tmp/env-retry");
    const { runtime } = createFakeRuntime();
    const manager = new RuntimeManager({
      provisionWorkspace: async () => {
        callCount++;
        if (callCount > 1) {
          throw new WorkspaceError(
            "path_not_found",
            "Managed workspace path does not exist: /tmp/env-retry",
          );
        }
        return workspace;
      },
      createRuntime: () => runtime,
    });

    // First destroy: succeeds (workspace exists in memory after reconnect)
    await dispatchCommand(
      {
        type: "environment.destroy",
        environmentId: "env-retry",
        workspaceContext: {
          workspacePath: "/tmp/env-retry",
          workspaceProvisionType: "managed-worktree",
        },
      },
      makeDispatchOptions({ runtimeManager: manager }),
    );

    // Second destroy (retry): workspace path is gone, should succeed (idempotent)
    const retryResult = await dispatchCommand(
      {
        type: "environment.destroy",
        environmentId: "env-retry",
        workspaceContext: {
          workspacePath: "/tmp/env-retry",
          workspaceProvisionType: "managed-worktree",
        },
      },
      makeDispatchOptions({ runtimeManager: manager }),
    );

    expect(retryResult).toEqual({});
  });

  it("reports cleanup preflight success for a clean managed worktree", async () => {
    const harness = createHarness({
      workspacePath: "/tmp/cleanup-clean",
      isWorktree: true,
    });

    const result = await dispatchCommand(
      {
        type: "environment.cleanup_preflight",
        environmentId: "env-cleanup-clean",
        workspaceContext: {
          workspacePath: "/tmp/cleanup-clean",
          workspaceProvisionType: "managed-worktree",
        },
        mergeBaseBranch: "main",
      },
      harness.dispatchOptions(),
    );

    expect(result).toEqual({ outcome: "safe_to_destroy" });
    expect(harness.workspaceState.statusReads).toBe(1);
  });

  it("blocks cleanup preflight when the workspace has risky changes", async () => {
    const harness = createHarness({
      workspacePath: "/tmp/cleanup-dirty",
      isWorktree: true,
    });
    harness.workspace.getStatus = async () => ({
      branch: { currentBranch: "bb/thread", defaultBranch: "main" },
      mergeBase: null,
      workingTree: {
        deletions: 0,
        files: [],
        hasUncommittedChanges: true,
        insertions: 0,
        state: "dirty_uncommitted",
      },
    });

    const result = await dispatchCommand(
      {
        type: "environment.cleanup_preflight",
        environmentId: "env-cleanup-dirty",
        workspaceContext: {
          workspacePath: "/tmp/cleanup-dirty",
          workspaceProvisionType: "managed-worktree",
        },
        mergeBaseBranch: "main",
      },
      harness.dispatchOptions(),
    );

    expect(result).toEqual({
      outcome: "blocked_by_changes",
      message: "Workspace has uncommitted or unmerged changes",
    });
  });

  it("allows cleanup preflight when the workspace path is already missing", async () => {
    const { runtime } = createFakeRuntime();
    const manager = new RuntimeManager({
      provisionWorkspace: async () => {
        throw new WorkspaceError(
          "path_not_found",
          "Managed workspace path does not exist: /tmp/cleanup-missing",
        );
      },
      createRuntime: () => runtime,
    });

    const result = await dispatchCommand(
      {
        type: "environment.cleanup_preflight",
        environmentId: "env-cleanup-missing",
        workspaceContext: {
          workspacePath: "/tmp/cleanup-missing",
          workspaceProvisionType: "managed-worktree",
        },
        mergeBaseBranch: "main",
      },
      makeDispatchOptions({ runtimeManager: manager }),
    );

    expect(result).toEqual({
      outcome: "already_missing",
      failure: {
        code: "path_not_found",
        message: "Managed workspace path does not exist: /tmp/cleanup-missing",
        workspacePath: "/tmp/cleanup-missing",
      },
    });
  });

  it("evicts stale runtime when cleanup preflight finds a loaded environment bound to another path", async () => {
    const harness = createHarness({ workspacePath: "/tmp/cleanup-loaded" });
    await harness.manager.ensureEnvironment({
      environmentId: "env-loaded-path",
      workspacePath: "/tmp/cleanup-loaded",
    });

    const command: Extract<
      HostDaemonCommand,
      { type: "environment.cleanup_preflight" }
    > = {
      type: "environment.cleanup_preflight",
      environmentId: "env-loaded-path",
      workspaceContext: {
        workspacePath: "/tmp/cleanup-other",
        workspaceProvisionType: "managed-worktree",
      },
      mergeBaseBranch: "main",
    };

    const result = await dispatchCommand(command, harness.dispatchOptions());

    expect(result).toEqual({
      outcome: "probe_failed",
      failure: {
        code: "workspace_type_mismatch",
        message:
          "Loaded environment env-loaded-path is bound to /tmp/cleanup-loaded, not /tmp/cleanup-other",
        workspacePath: "/tmp/cleanup-other",
      },
    });
    expect(harness.runtimeState.shutdownCount).toBe(1);
    expect(harness.workspaceState.destroyed).toBe(false);

    await expect(
      dispatchCommand(command, harness.dispatchOptions()),
    ).resolves.toMatchObject({
      outcome: "probe_failed",
      failure: {
        code: "not_worktree",
        workspacePath: "/tmp/cleanup-other",
      },
    });
  });
});
