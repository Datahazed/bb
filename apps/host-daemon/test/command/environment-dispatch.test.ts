import { afterEach, describe, expect, it } from "vitest";
import {
  getPersonalWorkspaceRoot,
  WorkspaceError,
  type HostWorkspace,
} from "@bb/host-workspace";
import { dispatchCommand } from "../../src/command-dispatch.js";
import type { EventSinkInput } from "../../src/event-sink.js";
import {
  cleanupTempDirs,
  createFakeRuntime,
  createFakeWorkspace,
  createHarness,
  makeDispatchOptions,
  makeTempDir,
} from "./dispatch-helpers.js";
import { RuntimeManager } from "../../src/runtime-manager.js";

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
    const emittedEvents: EventSinkInput[] = [];
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

  it("batches live provisioning entries before flushing", async () => {
    const { workspace } = createFakeWorkspace("/tmp/batched-progress");
    const { runtime } = createFakeRuntime();
    const emittedEvents: EventSinkInput[] = [];
    const eventCountsAtFlush: number[] = [];
    const manager = new RuntimeManager({
      provisionWorkspace: async (options) => {
        options.onProgress?.({
          type: "step",
          key: "setup-output-0",
          text: "install line 0",
          status: "completed",
          startedAt: Date.now(),
        });
        options.onProgress?.({
          type: "step",
          key: "setup-output-1",
          text: "install line 1",
          status: "completed",
          startedAt: Date.now(),
        });
        options.onProgress?.({
          type: "step",
          key: "setup-output-2",
          text: "install line 2",
          status: "completed",
          startedAt: Date.now(),
        });
        return workspace;
      },
      createRuntime: () => runtime,
    });

    const result = await dispatchCommand(
      {
        type: "environment.provision",
        environmentId: "env-batched-progress",
        initiator: {
          threadId: "thr-batched-progress",
          provisioningId: "tpv-batched-progress",
        },
        workspaceProvisionType: "unmanaged",
        path: "/tmp/batched-progress",
      },
      makeDispatchOptions({
        runtimeManager: manager,
        eventSink: {
          emit: (event) => {
            emittedEvents.push(event);
          },
          flush: async () => {
            eventCountsAtFlush.push(emittedEvents.length);
          },
        },
      }),
    );

    expect(emittedEvents).toHaveLength(1);
    expect(eventCountsAtFlush).toEqual([1]);
    const event = emittedEvents[0]?.event;
    if (!event || event.type !== "system/thread-provisioning") {
      throw new Error("Expected thread provisioning event");
    }
    const entryKeys = event.entries.map((entry) => entry.key);
    expect(entryKeys).toEqual([
      "setup-output-0",
      "setup-output-1",
      "setup-output-2",
      "workspace-path",
      "workspace-branch",
    ]);
    expect(result.transcript.map((entry) => entry.key)).toEqual(entryKeys);
  });

  it("flushes live events before surfacing provisioning failures", async () => {
    const emittedEvents: EventSinkInput[] = [];
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
          workspaceProvisionType: "unmanaged",
          path: "/tmp/failure",
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
});
