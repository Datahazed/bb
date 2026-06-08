/**
 * Ported from `apps/host-daemon/test/command/command-router.test.ts` (P1a
 * engine scaffold; the daemon copy dies with the daemon in P1c) and adapted
 * to the engine surface: the durable-queue envelope `{id, attemptId, cursor}`
 * became `EngineCommandEnvelope {commandId}`, the WS host-RPC
 * request/response wrapper (`handleOnlineRpcRequest`) became
 * `executeOnlineRpcCommand` (results return parsed, errors throw), the
 * daemon's `reportResult` callback is the `DeliverCommandResult` port, and
 * the daemon router's test-only `now` option became a `Date.now` spy.
 *
 * These are the plan-R3 lane-semantics tests: per-environment read/write
 * lanes, per-provider process/session lanes, per-file write lanes,
 * unarchive-before-submit barriers, provision-cancel bypass,
 * flush-before-result ordering, and completion-order reporting.
 *
 * The four daemon dispatch-handler suites (`environment-dispatch` /
 * `thread-dispatch` / `workspace-dispatch` / `host-branches-dispatch`) were
 * ported wholesale into `../handlers/` in P1c when the daemon was deleted —
 * they pin handler behavior, not the R3 scheduler semantics this file exists
 * for.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AgentRuntime } from "@bb/agent-runtime";
import {
  encodeClientTurnRequestIdNumber,
  type ClientTurnRequestId,
} from "@bb/domain";
import type { HostDaemonCommand } from "../contract/commands.js";
import { WorkspaceError } from "../workspace/git.js";
import type {
  HostWorkspace,
  ProvisionWorkspaceArgs,
} from "../workspace/provision.js";
import type {
  CommitOptions,
  CommitResult,
  SquashMergeOptions,
  SquashMergeResult,
} from "../workspace/workspace.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  EngineCommandResultReport,
  FetchProjectAttachment,
  ThreadEventSink,
} from "../ports.js";
import { getErrorCode, noopEventSink } from "./command-dispatch-support.js";
import { CommandRouter, type CommandRouterOptions } from "./command-router.js";
import { RuntimeManager } from "./runtime-manager.js";

const tempDirs: string[] = [];
let nextClientRequestIdValue = 1;

type StartThreadArgs = Parameters<AgentRuntime["startThread"]>[0];
type StartThreadResult = Awaited<ReturnType<AgentRuntime["startThread"]>>;
type TurnSubmitCommand = Extract<HostDaemonCommand, { type: "turn.submit" }>;
type ThreadStopCommand = Extract<HostDaemonCommand, { type: "thread.stop" }>;
type ResumeThreadArgs = Parameters<AgentRuntime["resumeThread"]>[0];
type ResumeThreadResult = Awaited<ReturnType<AgentRuntime["resumeThread"]>>;
type RunTurnArgs = Parameters<AgentRuntime["runTurn"]>[0];
type SteerTurnArgs = Parameters<AgentRuntime["steerTurn"]>[0];
type SteerTurnResult = Awaited<ReturnType<AgentRuntime["steerTurn"]>>;
type StopThreadArgs = Parameters<AgentRuntime["stopThread"]>[0];
type RenameThreadArgs = Parameters<AgentRuntime["renameThread"]>[0];
type ArchiveThreadArgs = Parameters<AgentRuntime["archiveThread"]>[0];
type UnarchiveThreadArgs = Parameters<AgentRuntime["unarchiveThread"]>[0];
type EnsureProviderArgs = Parameters<AgentRuntime["ensureProvider"]>[0];
type ListModelsArgs = Parameters<AgentRuntime["listModels"]>[0];
type ListModelsResult = Awaited<ReturnType<AgentRuntime["listModels"]>>;
type GetDiffResult = Awaited<ReturnType<HostWorkspace["getDiff"]>>;

const unexpectedProjectAttachmentFetch: FetchProjectAttachment = async () => {
  throw new Error("Unexpected project attachment fetch");
};

async function makeTempDir(prefix: string): Promise<string> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(tempDir);
  return tempDir;
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

function nextClientRequestId(): ClientTurnRequestId {
  const requestId = encodeClientTurnRequestIdNumber({
    value: nextClientRequestIdValue,
  });
  nextClientRequestIdValue += 1;
  return requestId;
}

// HostWorkspace exposes its scalar fields as readonly. The fake workspace lets
// tests reassign them where useful, so use the mutable equivalents and type
// each method as a vitest mock with the production signature.
interface FakeWorkspace {
  path: HostWorkspace["path"];
  managed: HostWorkspace["managed"];
  isGitRepo: HostWorkspace["isGitRepo"];
  isWorktree: HostWorkspace["isWorktree"];
  getCurrentBranch: ReturnType<typeof vi.fn<HostWorkspace["getCurrentBranch"]>>;
  getHeadSha: ReturnType<typeof vi.fn<HostWorkspace["getHeadSha"]>>;
  getLocalStateFingerprint: ReturnType<
    typeof vi.fn<HostWorkspace["getLocalStateFingerprint"]>
  >;
  getSharedGitRefsFingerprint: ReturnType<
    typeof vi.fn<HostWorkspace["getSharedGitRefsFingerprint"]>
  >;
  getAdditionalWorkspaceWriteRoots: ReturnType<
    typeof vi.fn<HostWorkspace["getAdditionalWorkspaceWriteRoots"]>
  >;
  getStatus: ReturnType<typeof vi.fn<HostWorkspace["getStatus"]>>;
  getDiff: ReturnType<typeof vi.fn<HostWorkspace["getDiff"]>>;
  listBranches: ReturnType<typeof vi.fn<HostWorkspace["listBranches"]>>;
  listFiles: ReturnType<typeof vi.fn<HostWorkspace["listFiles"]>>;
  commit: ReturnType<
    typeof vi.fn<(options: CommitOptions) => Promise<CommitResult>>
  >;
  reset: ReturnType<typeof vi.fn<HostWorkspace["reset"]>>;
  fetch: ReturnType<typeof vi.fn<HostWorkspace["fetch"]>>;
  squashMerge: ReturnType<
    typeof vi.fn<(options: SquashMergeOptions) => Promise<SquashMergeResult>>
  >;
  destroy: ReturnType<typeof vi.fn<HostWorkspace["destroy"]>>;
}

function createFakeWorkspace(path: string): FakeWorkspace {
  return {
    path,
    managed: false,
    isGitRepo: true,
    isWorktree: false,
    getCurrentBranch: vi.fn<HostWorkspace["getCurrentBranch"]>(
      async () => "main",
    ),
    getHeadSha: vi.fn<HostWorkspace["getHeadSha"]>(async () => "commit-1"),
    getLocalStateFingerprint: vi.fn<HostWorkspace["getLocalStateFingerprint"]>(
      async () =>
        JSON.stringify({ currentBranch: "main", headSha: "commit-1" }),
    ),
    getSharedGitRefsFingerprint: vi.fn<
      HostWorkspace["getSharedGitRefsFingerprint"]
    >(async () =>
      JSON.stringify({
        refs: [["refs/heads/main", "commit-1"]],
        remoteHead: null,
      }),
    ),
    getAdditionalWorkspaceWriteRoots: vi.fn<
      HostWorkspace["getAdditionalWorkspaceWriteRoots"]
    >(async () => []),
    getStatus: vi.fn<HostWorkspace["getStatus"]>(async () => ({
      workingTree: {
        hasUncommittedChanges: false,
        state: "clean",
        insertions: 0,
        deletions: 0,
        files: [],
      },
      branch: {
        currentBranch: "main",
        defaultBranch: "main",
      },
      mergeBase: null,
    })),
    getDiff: vi.fn<HostWorkspace["getDiff"]>(async () => ({
      diff: "",
      truncated: false,
      shortstat: "",
      files: "",
      mergeBaseRef: null,
    })),
    listBranches: vi.fn<HostWorkspace["listBranches"]>(async () => ["main"]),
    listFiles: vi.fn<HostWorkspace["listFiles"]>(async () => []),
    commit: vi.fn<(options: CommitOptions) => Promise<CommitResult>>(
      async () => ({
        commitSha: "commit-1",
        commitSubject: "subject",
      }),
    ),
    reset: vi.fn<HostWorkspace["reset"]>(async () => undefined),
    fetch: vi.fn<HostWorkspace["fetch"]>(async () => undefined),
    squashMerge: vi.fn<
      (options: SquashMergeOptions) => Promise<SquashMergeResult>
    >(async () => ({
      merged: true,
      commitSha: "commit-3",
      commitSubject: "squash subject",
      targetBranch: "main",
    })),
    destroy: vi.fn<HostWorkspace["destroy"]>(async () => undefined),
  };
}

interface FakeRuntime {
  ensureProvider: ReturnType<
    typeof vi.fn<(args: EnsureProviderArgs) => Promise<void>>
  >;
  startThread: ReturnType<
    typeof vi.fn<(args: StartThreadArgs) => Promise<StartThreadResult>>
  >;
  resumeThread: ReturnType<
    typeof vi.fn<(args: ResumeThreadArgs) => Promise<ResumeThreadResult>>
  >;
  runTurn: ReturnType<typeof vi.fn<(args: RunTurnArgs) => Promise<void>>>;
  steerTurn: ReturnType<
    typeof vi.fn<(args: SteerTurnArgs) => Promise<SteerTurnResult>>
  >;
  stopThread: ReturnType<typeof vi.fn<(args: StopThreadArgs) => Promise<void>>>;
  renameThread: ReturnType<
    typeof vi.fn<(args: RenameThreadArgs) => Promise<void>>
  >;
  archiveThread: ReturnType<
    typeof vi.fn<(args: ArchiveThreadArgs) => Promise<void>>
  >;
  unarchiveThread: ReturnType<
    typeof vi.fn<(args: UnarchiveThreadArgs) => Promise<void>>
  >;
  listModels: ReturnType<
    typeof vi.fn<(args: ListModelsArgs) => Promise<ListModelsResult>>
  >;
  listRunningProviders: ReturnType<typeof vi.fn<() => string[]>>;
  shutdown: ReturnType<typeof vi.fn<() => Promise<void>>>;
}

function createFakeRuntime(): FakeRuntime {
  return {
    ensureProvider: vi.fn<(args: EnsureProviderArgs) => Promise<void>>(
      async () => undefined,
    ),
    startThread: vi.fn<(args: StartThreadArgs) => Promise<StartThreadResult>>(
      async ({ threadId }) => ({
        providerThreadId: `provider-${threadId}`,
      }),
    ),
    resumeThread: vi.fn<
      (args: ResumeThreadArgs) => Promise<ResumeThreadResult>
    >(async ({ providerThreadId }) => ({
      providerThreadId: providerThreadId ?? "provider-resumed",
    })),
    runTurn: vi.fn<(args: RunTurnArgs) => Promise<void>>(async () => undefined),
    steerTurn: vi.fn<(args: SteerTurnArgs) => Promise<SteerTurnResult>>(
      async () => ({ status: "steered" }),
    ),
    stopThread: vi.fn<(args: StopThreadArgs) => Promise<void>>(
      async () => undefined,
    ),
    renameThread: vi.fn<(args: RenameThreadArgs) => Promise<void>>(
      async () => undefined,
    ),
    archiveThread: vi.fn<(args: ArchiveThreadArgs) => Promise<void>>(
      async () => undefined,
    ),
    unarchiveThread: vi.fn<(args: UnarchiveThreadArgs) => Promise<void>>(
      async () => undefined,
    ),
    listModels: vi.fn<(args: ListModelsArgs) => Promise<ListModelsResult>>(
      async () => ({ models: [], selectedOnlyModels: [] }),
    ),
    listRunningProviders: vi.fn<() => string[]>(() => []),
    shutdown: vi.fn<() => Promise<void>>(async () => undefined),
  };
}

function createLogger() {
  return {
    debug: vi.fn(),
    warn: vi.fn(),
  };
}

/**
 * Builds a router with throwing/no-op fakes for every required option the
 * test does not exercise; the daemon's router left these optional, the
 * engine's does not.
 */
interface CreateRouterArgs {
  runtimeManager: RuntimeManager;
  dataDir?: string;
  eventSink?: ThreadEventSink;
  listModels?: CommandRouterOptions["listModels"];
  logger?: ReturnType<typeof createLogger>;
  reportResult?: CommandRouterOptions["reportResult"];
}

function createRouter(args: CreateRouterArgs): CommandRouter {
  return new CommandRouter({
    dataDir: args.dataDir ?? "/tmp/bb-test-data",
    eventSink: args.eventSink ?? noopEventSink,
    fetchProjectAttachment: unexpectedProjectAttachmentFetch,
    listModels:
      args.listModels ??
      (async () => {
        throw new Error("Unexpected listModels call");
      }),
    logger: args.logger ?? createLogger(),
    recordReplayCaptureThreadMetadata: () => undefined,
    recordReplayCaptureTurnRequest: () => undefined,
    replayTasks: new Map(),
    reportResult: args.reportResult ?? (async () => undefined),
    resolveInteractiveRequest: async () => {
      throw new Error("Unexpected interactive request resolution");
    },
    runtimeManager: args.runtimeManager,
    terminalManager: { closeEnvironmentTerminals: () => undefined },
    threadStorageRootPath: "/tmp/bb-test-thread-storage",
  });
}

/**
 * The engine's `executeOnlineRpcCommand` throws instead of returning the
 * daemon's `{ok: false, errorCode, errorMessage}` response envelope.
 */
async function captureRpcError(work: Promise<unknown>): Promise<unknown> {
  try {
    await work;
  } catch (error) {
    return error;
  }
  throw new Error("Expected online RPC command to fail");
}

function createStandardRuntimeCommandContext(args: {
  providerThreadId?: string;
  workspacePath: string;
}) {
  return {
    workspaceContext: {
      workspacePath: args.workspacePath,
      workspaceProvisionType: "unmanaged" as const,
    },
    projectId: "project-1",
    providerId: "fake",
    ...(args.providerThreadId
      ? { providerThreadId: args.providerThreadId }
      : {}),
    options: {
      model: "gpt-5",
      serviceTier: "default" as const,
      reasoningLevel: "medium" as const,
      workflowsEnabled: false,
      permissionMode: "full" as const,
      permissionEscalation: null,
    },
    instructions: "Be a helpful coding agent.",
    dynamicTools: [],
    injectedSkillSources: [],
    instructionMode: "append" as const,
  };
}

function createTurnSubmitCommand(args: {
  environmentId: string;
  providerThreadId: string;
  text: string;
  threadId: string;
}): TurnSubmitCommand {
  return {
    type: "turn.submit",
    environmentId: args.environmentId,
    threadId: args.threadId,
    requestId: nextClientRequestId(),
    input: [{ type: "text", text: args.text }],
    options: {
      model: "gpt-5",
      serviceTier: "default",
      reasoningLevel: "medium",
      workflowsEnabled: false,
      permissionMode: "full",
      permissionEscalation: null,
    },
    resumeContext: {
      workspaceContext: {
        workspacePath: `/tmp/${args.environmentId}`,
        workspaceProvisionType: "unmanaged",
      },
      projectId: "project-1",
      providerId: "fake",
      providerThreadId: args.providerThreadId,
      instructions: "Be a helpful coding agent.",
      dynamicTools: [],
      injectedSkillSources: [],
      instructionMode: "append",
    },
    target: { mode: "start" },
  };
}

function createThreadStopCommand(args: {
  environmentId: string;
  threadId: string;
}): ThreadStopCommand {
  return {
    type: "thread.stop",
    environmentId: args.environmentId,
    threadId: args.threadId,
  };
}

describe("CommandRouter", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(
      tempDirs
        .splice(0)
        .map((tempDir) => fs.rm(tempDir, { force: true, recursive: true })),
    );
  });

  it("does not flush unrelated buffered events before returning read-only workspace RPC results", async () => {
    const calls: string[] = [];
    const flushDeferred = createDeferred<void>();
    const eventSink = {
      emit: vi.fn(),
      flush: vi.fn(async () => {
        calls.push("flush");
        await flushDeferred.promise;
      }),
    };
    const reportResult = vi.fn(async () => {
      calls.push("report");
    });
    const manager = new RuntimeManager({
      provisionWorkspace: async () => createFakeWorkspace("/tmp/env-1"),
    });
    await manager.ensureEnvironment({
      environmentId: "env-1",
      workspacePath: "/tmp/env-1",
      workspaceProvisionType: "unmanaged",
    });
    const router = createRouter({
      eventSink,
      reportResult,
      runtimeManager: manager,
    });

    const response = await router.executeOnlineRpcCommand({
      type: "workspace.status",
      environmentId: "env-1",
      workspaceContext: {
        workspacePath: "/tmp/env-1",
        workspaceProvisionType: "unmanaged",
      },
    });

    expect(response).toEqual(
      expect.objectContaining({
        outcome: "available",
      }),
    );
    expect(calls).toEqual([]);
    expect(eventSink.flush).not.toHaveBeenCalled();
    flushDeferred.resolve(undefined);
  });

  it("returns missing host file read errors", async () => {
    const rootPath = await makeTempDir("bb-command-router-read-file-");
    const missingPath = path.join(rootPath, "notes.md");
    const router = createRouter({
      runtimeManager: new RuntimeManager({
        provisionWorkspace: async () => createFakeWorkspace("/tmp/env-1"),
      }),
    });

    const thrown = await captureRpcError(
      router.executeOnlineRpcCommand({
        type: "host.read_file",
        path: missingPath,
        rootPath,
      }),
    );

    expect(thrown).toMatchObject({
      code: "ENOENT",
      message: `Path does not exist: ${missingPath}`,
    });
  });

  it("reports missing host file roots without warning", async () => {
    const parentPath = await makeTempDir("bb-command-router-read-file-root-");
    const rootPath = path.join(parentPath, "missing-root");
    const missingPath = path.join(rootPath, "notes.md");
    const reportResult = vi.fn(async () => undefined);
    const logger = createLogger();
    const router = createRouter({
      logger,
      reportResult,
      runtimeManager: new RuntimeManager({
        provisionWorkspace: async () => createFakeWorkspace("/tmp/env-1"),
      }),
    });

    const thrown = await captureRpcError(
      router.executeOnlineRpcCommand({
        type: "host.read_file",
        path: missingPath,
        rootPath,
      }),
    );

    expect(thrown).toMatchObject({
      code: "ENOENT",
      message: `Path does not exist: ${missingPath}`,
    });
    expect(reportResult).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("reports missing host relative file reads without warning", async () => {
    const parentPath = await makeTempDir("bb-command-router-relative-file-");
    const rootPath = path.join(parentPath, "assets");
    const reportResult = vi.fn(async () => undefined);
    const logger = createLogger();
    const router = createRouter({
      logger,
      reportResult,
      runtimeManager: new RuntimeManager({
        provisionWorkspace: async () => createFakeWorkspace("/tmp/env-1"),
      }),
    });

    const thrown = await captureRpcError(
      router.executeOnlineRpcCommand({
        type: "host.read_file_relative",
        rootPath,
        path: "index.html",
        dotfiles: "deny",
      }),
    );

    expect(thrown).toMatchObject({
      code: "ENOENT",
      message: "Path does not exist: index.html",
    });
    expect(reportResult).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("reports missing workspace status paths without warning", async () => {
    const parentPath = await makeTempDir("bb-command-router-workspace-");
    const missingPath = path.join(parentPath, "missing-worktree");
    const reportResult = vi.fn(async () => undefined);
    const logger = createLogger();
    const router = createRouter({
      logger,
      reportResult,
      runtimeManager: new RuntimeManager({
        provisionWorkspace: async () => {
          throw new WorkspaceError(
            "path_not_found",
            `Managed workspace path does not exist: ${missingPath}`,
          );
        },
      }),
    });

    const response = await router.executeOnlineRpcCommand({
      type: "workspace.status",
      environmentId: "env-missing",
      workspaceContext: {
        workspacePath: missingPath,
        workspaceProvisionType: "managed-worktree",
      },
      mergeBaseBranch: "main",
    });

    expect(response).toEqual({
      outcome: "unavailable",
      failure: {
        code: "path_not_found",
        workspacePath: missingPath,
        message: `Managed workspace path does not exist: ${missingPath}`,
      },
    });
    expect(reportResult).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("reports missing workspace diff paths without warning", async () => {
    const parentPath = await makeTempDir("bb-command-router-workspace-diff-");
    const missingPath = path.join(parentPath, "missing-worktree");
    const reportResult = vi.fn(async () => undefined);
    const logger = createLogger();
    const router = createRouter({
      logger,
      reportResult,
      runtimeManager: new RuntimeManager({
        provisionWorkspace: async () => {
          throw new WorkspaceError(
            "path_not_found",
            `Managed workspace path does not exist: ${missingPath}`,
          );
        },
      }),
    });

    const response = await router.executeOnlineRpcCommand({
      type: "workspace.diff",
      environmentId: "env-missing",
      workspaceContext: {
        workspacePath: missingPath,
        workspaceProvisionType: "managed-worktree",
      },
      target: { type: "all", mergeBaseBranch: "main" },
      maxDiffBytes: 2 * 1024 * 1024,
      maxFileListBytes: 256 * 1024,
    });

    expect(response).toEqual({
      outcome: "unavailable",
      failure: {
        code: "path_not_found",
        workspacePath: missingPath,
        message: `Managed workspace path does not exist: ${missingPath}`,
      },
    });
    expect(reportResult).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("reports missing provision paths without warning", async () => {
    const parentPath = await makeTempDir("bb-command-router-provision-");
    const missingPath = path.join(parentPath, "missing-workspace");
    const reportResult = vi.fn(async () => undefined);
    const logger = createLogger();
    const router = createRouter({
      logger,
      reportResult,
      runtimeManager: new RuntimeManager({
        provisionWorkspace: async () => {
          throw new WorkspaceError(
            "path_not_found",
            `Unmanaged workspace path does not exist: ${missingPath}`,
          );
        },
      }),
    });

    await router.handleCommands([
      {
        commandId: "provision-missing-workspace",
        command: {
          type: "environment.provision",
          environmentId: "env-missing-provision",
          initiator: null,
          workspaceProvisionType: "unmanaged",
          path: missingPath,
        },
      },
    ]);

    expect(reportResult).toHaveBeenCalledWith(
      expect.objectContaining({
        commandId: "provision-missing-workspace",
        errorCode: "path_not_found",
        errorMessage: `Unmanaged workspace path does not exist: ${missingPath}`,
        ok: false,
        type: "environment.provision",
      }),
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("reports missing provider executables with a specific error code", async () => {
    const errorMessage =
      'Provider "codex" exited unexpectedly\nstderr: Error: spawn /missing/codex ENOENT';
    const reportResult = vi.fn(async () => undefined);
    const logger = createLogger();
    const router = createRouter({
      listModels: vi.fn(async () => {
        throw new Error(errorMessage);
      }),
      logger,
      reportResult,
      runtimeManager: new RuntimeManager({
        provisionWorkspace: async () => createFakeWorkspace("/tmp/env-1"),
      }),
    });

    const thrown = await captureRpcError(
      router.executeOnlineRpcCommand({
        type: "provider.list_models",
        providerId: "codex",
      }),
    );

    expect(thrown).toMatchObject({ message: errorMessage });
    expect(getErrorCode(thrown)).toBe("missing_executable");
    expect(reportResult).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        err: expect.any(Error),
        type: "provider.list_models",
      }),
      "online host RPC failed",
    );
  });

  it("preserves structured provider error codes over missing executable message fallback", async () => {
    class StructuredProviderError extends Error {
      readonly code = "permission_denied";
    }

    const errorMessage =
      'Provider "codex" exited unexpectedly\nstderr: Error: spawn /missing/codex ENOENT';
    const reportResult = vi.fn(async () => undefined);
    const router = createRouter({
      listModels: vi.fn(async () => {
        throw new StructuredProviderError(errorMessage);
      }),
      reportResult,
      runtimeManager: new RuntimeManager({
        provisionWorkspace: async () => createFakeWorkspace("/tmp/env-1"),
      }),
    });

    const thrown = await captureRpcError(
      router.executeOnlineRpcCommand({
        type: "provider.list_models",
        providerId: "codex",
      }),
    );

    expect(thrown).toMatchObject({ message: errorMessage });
    expect(getErrorCode(thrown)).toBe("permission_denied");
    expect(reportResult).not.toHaveBeenCalled();
  });

  it("handles provider model online RPC without durable result reporting", async () => {
    const reportResult = vi.fn(async () => undefined);
    const listModels = vi.fn<
      (args: ListModelsArgs) => Promise<ListModelsResult>
    >(async () => ({
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
      selectedOnlyModels: [],
    }));
    const router = createRouter({
      listModels,
      reportResult,
      runtimeManager: new RuntimeManager({
        provisionWorkspace: async () => createFakeWorkspace("/tmp/env-1"),
      }),
    });

    const response = await router.executeOnlineRpcCommand({
      type: "provider.list_models",
      providerId: "codex",
    });

    expect(response).toEqual({
      models: [
        expect.objectContaining({
          id: "codex-mini",
        }),
      ],
      selectedOnlyModels: [],
    });
    expect(listModels).toHaveBeenCalledWith({ providerId: "codex" });
    expect(reportResult).not.toHaveBeenCalled();
  });

  it("serializes relative host file writes with last-write-wins behavior", async () => {
    const rootPath = await makeTempDir("bb-command-router-app-data-");
    const initialContent = '["seed"]\n';
    await fs.writeFile(path.join(rootPath, "todos.json"), initialContent);
    const reports: EngineCommandResultReport[] = [];
    const router = createRouter({
      reportResult: async (result) => {
        reports.push(result);
      },
      runtimeManager: new RuntimeManager({
        provisionWorkspace: async () => createFakeWorkspace("/tmp/env-1"),
      }),
    });

    await router.handleCommands([
      {
        commandId: "write-a",
        command: {
          type: "host.write_file_relative",
          rootPath,
          path: "todos.json",
          dotfiles: "deny",
          content: '["a"]\n',
          contentEncoding: "utf8",
        },
      },
      {
        commandId: "write-b",
        command: {
          type: "host.write_file_relative",
          rootPath,
          path: "todos.json",
          dotfiles: "deny",
          content: '["b"]\n',
          contentEncoding: "utf8",
        },
      },
    ]);

    expect(reports).toHaveLength(2);
    expect(reports.filter((report) => report.ok)).toHaveLength(2);
    const finalContent = await fs.readFile(path.join(rootPath, "todos.json"), {
      encoding: "utf8",
    });
    expect(finalContent).toBe('["b"]\n');
  });

  it("flushes buffered provider events before reporting thread command results", async () => {
    const calls: string[] = [];
    const eventSink = {
      emit: vi.fn(),
      flush: vi.fn(async () => {
        calls.push("flush");
      }),
    };
    const reportResult = vi.fn(async () => {
      calls.push("report");
    });
    const router = createRouter({
      eventSink,
      reportResult,
      runtimeManager: new RuntimeManager({
        provisionWorkspace: async () => createFakeWorkspace("/tmp/env-1"),
        createRuntime: () => createFakeRuntime(),
      }),
    });

    await router.handleCommands([
      {
        commandId: "thread-start",
        command: {
          type: "thread.start",
          environmentId: "env-1",
          threadId: "thread-1",
          ...createStandardRuntimeCommandContext({
            workspacePath: "/tmp/env-1",
          }),
          requestId: nextClientRequestId(),
          input: [{ type: "text", text: "start thread" }],
        },
      },
    ]);

    expect(calls).toEqual(["flush", "report"]);
    expect(eventSink.flush).toHaveBeenCalledTimes(1);
  });

  it("does not queue environment provision cancellation behind the environment write lane", async () => {
    const workspace = createFakeWorkspace("/tmp/env-cancel-lane");
    const reportResult = vi.fn(async () => undefined);
    const provisionStarted = createDeferred<void>();
    const manager = new RuntimeManager({
      createRuntime: () => createFakeRuntime(),
      provisionWorkspace: async (options) => {
        provisionStarted.resolve(undefined);
        await new Promise<void>((_, reject) => {
          options.signal?.addEventListener(
            "abort",
            () => reject(options.signal?.reason),
            { once: true },
          );
        });
        return workspace;
      },
    });
    const router = createRouter({
      reportResult,
      runtimeManager: manager,
    });

    const provisionHandling = router.handleCommands([
      {
        commandId: "provision",
        command: {
          type: "environment.provision",
          environmentId: "env-cancel-lane",
          initiator: null,
          workspaceProvisionType: "unmanaged",
          path: "/tmp/env-cancel-lane",
        },
      },
    ]);

    await provisionStarted.promise;
    await Promise.race([
      router.handleCommands([
        {
          commandId: "cancel",
          command: {
            type: "environment.provision.cancel",
            environmentId: "env-cancel-lane",
          },
        },
      ]),
      new Promise<void>((_, reject) => {
        setTimeout(
          () =>
            reject(
              new Error(
                "environment.provision.cancel did not bypass the write lane",
              ),
            ),
          500,
        );
      }),
    ]);
    await provisionHandling;

    expect(reportResult).toHaveBeenCalledWith(
      expect.objectContaining({
        commandId: "cancel",
        ok: true,
        result: { aborted: true },
        type: "environment.provision.cancel",
      }),
    );
    expect(reportResult).toHaveBeenCalledWith(
      expect.objectContaining({
        commandId: "provision",
        errorCode: "provision_cancelled",
        ok: false,
        type: "environment.provision",
      }),
    );
  });

  it("waits for an in-flight write before starting a read for the same environment", async () => {
    const workspace = createFakeWorkspace("/tmp/env-1");
    const commitDeferred = createDeferred<{
      commitSha: string;
      commitSubject: string;
    }>();
    workspace.commit.mockReturnValueOnce(commitDeferred.promise);

    const manager = new RuntimeManager({
      provisionWorkspace: async () => workspace,
      createRuntime: () => createFakeRuntime(),
    });
    await manager.ensureEnvironment({
      environmentId: "env-1",
      workspacePath: "/tmp/env-1",
    });

    const router = createRouter({ runtimeManager: manager });
    const handling = router.handleCommands([
      {
        commandId: "commit",
        command: {
          type: "workspace.commit",
          environmentId: "env-1",
          workspaceContext: {
            workspacePath: "/tmp/env-1",
            workspaceProvisionType: "unmanaged",
          },
          message: "Commit",
        },
      },
    ]);

    await vi.waitFor(() => {
      expect(workspace.commit).toHaveBeenCalledTimes(1);
    });

    const statusHandling = router.executeOnlineRpcCommand({
      type: "workspace.status",
      environmentId: "env-1",
      workspaceContext: {
        workspacePath: "/tmp/env-1",
        workspaceProvisionType: "unmanaged",
      },
      mergeBaseBranch: "main",
    });
    expect(workspace.getStatus).not.toHaveBeenCalled();

    commitDeferred.resolve({
      commitSha: "commit-1",
      commitSubject: "subject",
    });
    const response = await statusHandling;
    await handling;

    expect(response).toEqual(
      expect.objectContaining({
        outcome: "available",
      }),
    );
    expect(workspace.getStatus).toHaveBeenCalledTimes(1);
  });

  it("runs read-only workspace commands concurrently for the same environment", async () => {
    const workspace = createFakeWorkspace("/tmp/env-1");
    const diffDeferred = createDeferred<GetDiffResult>();
    workspace.getDiff.mockReturnValueOnce(diffDeferred.promise);

    const manager = new RuntimeManager({
      provisionWorkspace: async () => workspace,
      createRuntime: () => createFakeRuntime(),
    });
    await manager.ensureEnvironment({
      environmentId: "env-1",
      workspacePath: "/tmp/env-1",
    });

    const router = createRouter({ runtimeManager: manager });
    const diffHandling = router.executeOnlineRpcCommand({
      type: "workspace.diff",
      environmentId: "env-1",
      workspaceContext: {
        workspacePath: "/tmp/env-1",
        workspaceProvisionType: "unmanaged",
      },
      target: { type: "uncommitted" },
      maxDiffBytes: 100_000,
      maxFileListBytes: 100_000,
    });
    const statusHandling = router.executeOnlineRpcCommand({
      type: "workspace.status",
      environmentId: "env-1",
      workspaceContext: {
        workspacePath: "/tmp/env-1",
        workspaceProvisionType: "unmanaged",
      },
      mergeBaseBranch: "main",
    });

    await vi.waitFor(() => {
      expect(workspace.getDiff).toHaveBeenCalledTimes(1);
      expect(workspace.getStatus).toHaveBeenCalledTimes(1);
    });

    diffDeferred.resolve({
      diff: "",
      truncated: false,
      shortstat: "",
      files: "",
      mergeBaseRef: null,
    });
    const [diffResponse, statusResponse] = await Promise.all([
      diffHandling,
      statusHandling,
    ]);
    expect(diffResponse).toEqual(
      expect.objectContaining({
        outcome: "available",
      }),
    );
    expect(statusResponse).toEqual(
      expect.objectContaining({
        outcome: "available",
      }),
    );
  });

  it("waits for an in-flight read before starting a write for the same environment", async () => {
    const calls: string[] = [];
    const workspace = createFakeWorkspace("/tmp/env-1");
    const diffDeferred = createDeferred<void>();
    workspace.getDiff.mockImplementationOnce(async () => {
      calls.push("read:start");
      await diffDeferred.promise;
      calls.push("read:done");
      return {
        diff: "",
        truncated: false,
        shortstat: "",
        files: "",
        mergeBaseRef: null,
      };
    });
    workspace.commit.mockImplementationOnce(async () => {
      calls.push("write");
      return {
        commitSha: "commit-1",
        commitSubject: "subject",
      };
    });

    const manager = new RuntimeManager({
      provisionWorkspace: async () => workspace,
      createRuntime: () => createFakeRuntime(),
    });
    await manager.ensureEnvironment({
      environmentId: "env-1",
      workspacePath: "/tmp/env-1",
    });

    const router = createRouter({ runtimeManager: manager });
    const diffHandling = router.executeOnlineRpcCommand({
      type: "workspace.diff",
      environmentId: "env-1",
      workspaceContext: {
        workspacePath: "/tmp/env-1",
        workspaceProvisionType: "unmanaged",
      },
      target: { type: "uncommitted" },
      maxDiffBytes: 100_000,
      maxFileListBytes: 100_000,
    });

    await vi.waitFor(() => {
      expect(workspace.getDiff).toHaveBeenCalledTimes(1);
    });

    const handling = router.handleCommands([
      {
        commandId: "commit",
        command: {
          type: "workspace.commit",
          environmentId: "env-1",
          workspaceContext: {
            workspacePath: "/tmp/env-1",
            workspaceProvisionType: "unmanaged",
          },
          message: "Commit",
        },
      },
    ]);

    expect(workspace.commit).not.toHaveBeenCalled();

    diffDeferred.resolve(undefined);
    await vi.waitFor(() => {
      expect(workspace.commit).toHaveBeenCalledTimes(1);
    });

    await Promise.all([diffHandling, handling]);
    expect(calls).toEqual(["read:start", "read:done", "write"]);
  });

  it("preserves read-write-read ordering when a write is queued behind a read", async () => {
    const calls: string[] = [];
    const workspace = createFakeWorkspace("/tmp/env-1");
    const diffDeferred = createDeferred<void>();
    const commitDeferred = createDeferred<CommitResult>();
    workspace.getDiff.mockImplementationOnce(async () => {
      calls.push("read-1:start");
      await diffDeferred.promise;
      calls.push("read-1:done");
      return {
        diff: "",
        truncated: false,
        shortstat: "",
        files: "",
        mergeBaseRef: null,
      };
    });
    workspace.commit.mockImplementationOnce(async () => {
      calls.push("write:start");
      await commitDeferred.promise;
      calls.push("write:done");
      return {
        commitSha: "commit-1",
        commitSubject: "subject",
      };
    });
    workspace.getStatus.mockImplementationOnce(async () => {
      calls.push("read-2");
      return {
        workingTree: {
          hasUncommittedChanges: false,
          state: "clean",
          insertions: 0,
          deletions: 0,
          files: [],
        },
        branch: {
          currentBranch: "main",
          defaultBranch: "main",
        },
        mergeBase: null,
      };
    });

    const manager = new RuntimeManager({
      provisionWorkspace: async () => workspace,
      createRuntime: () => createFakeRuntime(),
    });
    await manager.ensureEnvironment({
      environmentId: "env-1",
      workspacePath: "/tmp/env-1",
    });

    const router = createRouter({ runtimeManager: manager });
    const diffHandling = router.executeOnlineRpcCommand({
      type: "workspace.diff",
      environmentId: "env-1",
      workspaceContext: {
        workspacePath: "/tmp/env-1",
        workspaceProvisionType: "unmanaged",
      },
      target: { type: "uncommitted" },
      maxDiffBytes: 100_000,
      maxFileListBytes: 100_000,
    });

    await vi.waitFor(() => {
      expect(workspace.getDiff).toHaveBeenCalledTimes(1);
    });

    const handling = router.handleCommands([
      {
        commandId: "commit",
        command: {
          type: "workspace.commit",
          environmentId: "env-1",
          workspaceContext: {
            workspacePath: "/tmp/env-1",
            workspaceProvisionType: "unmanaged",
          },
          message: "Commit",
        },
      },
    ]);
    const statusHandling = router.executeOnlineRpcCommand({
      type: "workspace.status",
      environmentId: "env-1",
      workspaceContext: {
        workspacePath: "/tmp/env-1",
        workspaceProvisionType: "unmanaged",
      },
      mergeBaseBranch: "main",
    });

    expect(workspace.commit).not.toHaveBeenCalled();
    expect(workspace.getStatus).not.toHaveBeenCalled();

    diffDeferred.resolve(undefined);
    await vi.waitFor(() => {
      expect(workspace.commit).toHaveBeenCalledTimes(1);
    });
    expect(workspace.getStatus).not.toHaveBeenCalled();

    commitDeferred.resolve({
      commitSha: "commit-1",
      commitSubject: "subject",
    });
    await Promise.all([diffHandling, handling, statusHandling]);

    expect(workspace.getStatus).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([
      "read-1:start",
      "read-1:done",
      "write:start",
      "write:done",
      "read-2",
    ]);
  });

  it("serializes thread.archive before environment.destroy for the same environment", async () => {
    const calls: string[] = [];
    const workspace = createFakeWorkspace("/tmp/env-1");
    workspace.destroy.mockImplementation(async () => {
      calls.push("destroy:workspace");
    });

    const runtime = createFakeRuntime();
    const archiveStarted = createDeferred<void>();
    const archiveDeferred = createDeferred<void>();
    runtime.archiveThread.mockImplementation(
      async (_args: ArchiveThreadArgs) => {
        calls.push("archive:start");
        archiveStarted.resolve(undefined);
        await archiveDeferred.promise;
        calls.push("archive:done");
      },
    );
    runtime.shutdown.mockImplementation(async () => {
      calls.push("destroy:runtime");
    });

    const manager = new RuntimeManager({
      provisionWorkspace: async () => workspace,
      createRuntime: () => runtime,
    });
    await manager.ensureEnvironment({
      environmentId: "env-1",
      workspacePath: "/tmp/env-1",
    });

    const router = createRouter({ runtimeManager: manager });

    const workspaceContext = {
      workspacePath: "/tmp/env-1",
      workspaceProvisionType: "managed-worktree" as const,
    };
    const handling = router.handleCommands([
      {
        commandId: "archive",
        command: {
          type: "thread.archive",
          environmentId: "env-1",
          threadId: "thread-1",
          workspaceContext,
          providerId: "fake",
          providerThreadId: "provider-thread-1",
        },
      },
      {
        commandId: "destroy",
        command: {
          type: "environment.destroy",
          environmentId: "env-1",
          workspaceContext,
        },
      },
    ]);

    await archiveStarted.promise;

    expect(runtime.archiveThread).toHaveBeenCalledWith({
      providerId: "fake",
      providerThreadId: "provider-thread-1",
      threadId: "thread-1",
    });
    expect(runtime.shutdown).not.toHaveBeenCalled();
    expect(workspace.destroy).not.toHaveBeenCalled();

    archiveDeferred.resolve(undefined);
    await handling;

    expect(calls).toEqual([
      "archive:start",
      "archive:done",
      "destroy:runtime",
      "destroy:workspace",
    ]);
  });

  it("waits for an in-flight thread.unarchive before running a turn for the same thread", async () => {
    const dataDir = await makeTempDir("bb-command-router-unarchive-");
    const calls: string[] = [];
    const runtime = createFakeRuntime();
    const unarchiveStarted = createDeferred<void>();
    const unarchiveDeferred = createDeferred<void>();
    runtime.unarchiveThread.mockImplementation(
      async (_args: UnarchiveThreadArgs) => {
        calls.push("unarchive:start");
        unarchiveStarted.resolve(undefined);
        await unarchiveDeferred.promise;
        calls.push("unarchive:done");
      },
    );
    runtime.resumeThread.mockImplementation(
      async ({ providerThreadId }: ResumeThreadArgs) => {
        calls.push("resume");
        return { providerThreadId: providerThreadId ?? "provider-resumed" };
      },
    );
    runtime.runTurn.mockImplementation(async () => {
      calls.push("runTurn");
    });

    const manager = new RuntimeManager({
      provisionWorkspace: async () => createFakeWorkspace("/tmp/env-1"),
      createRuntime: () => runtime,
    });
    await manager.ensureEnvironment({
      environmentId: "env-1",
      workspacePath: "/tmp/env-1",
    });

    const router = createRouter({
      dataDir,
      runtimeManager: manager,
    });

    const handling = router.handleCommands([
      {
        commandId: "unarchive",
        command: {
          type: "thread.unarchive",
          environmentId: "env-1",
          threadId: "thread-1",
          providerId: "fake",
          providerThreadId: "provider-1",
        },
      },
      {
        commandId: "submit",
        command: {
          type: "turn.submit",
          environmentId: "env-1",
          threadId: "thread-1",
          requestId: nextClientRequestId(),
          input: [{ type: "text", text: "after unarchive" }],
          options: {
            model: "gpt-5",
            serviceTier: "default" as const,
            reasoningLevel: "medium" as const,
            workflowsEnabled: false,
            permissionMode: "full" as const,
            permissionEscalation: null,
          },
          resumeContext: {
            workspaceContext: {
              workspacePath: "/tmp/env-1",
              workspaceProvisionType: "unmanaged" as const,
            },
            projectId: "project-1",
            providerId: "fake",
            providerThreadId: "provider-1",
            instructions: "Be a helpful coding agent.",
            dynamicTools: [],
            injectedSkillSources: [],
            instructionMode: "append" as const,
          },
          target: { mode: "start" },
        },
      },
    ]);

    await unarchiveStarted.promise;
    // The turn must not reach the provider while the unarchive is in flight, or
    // the provider rejects it as still archived.
    expect(runtime.resumeThread).not.toHaveBeenCalled();
    expect(runtime.runTurn).not.toHaveBeenCalled();

    unarchiveDeferred.resolve(undefined);
    await handling;

    expect(calls).toEqual([
      "unarchive:start",
      "unarchive:done",
      "resume",
      "runTurn",
    ]);
    expect(runtime.resumeThread).toHaveBeenCalledWith(
      expect.objectContaining({
        providerThreadId: "provider-1",
        threadId: "thread-1",
      }),
    );
  });

  it("serializes thread.archive before a later thread.unarchive for the same environment", async () => {
    const calls: string[] = [];
    const runtime = createFakeRuntime();
    const archiveStarted = createDeferred<void>();
    const archiveDeferred = createDeferred<void>();
    runtime.archiveThread.mockImplementation(async () => {
      calls.push("archive:start");
      archiveStarted.resolve(undefined);
      await archiveDeferred.promise;
      calls.push("archive:done");
    });
    runtime.unarchiveThread.mockImplementation(async () => {
      calls.push("unarchive");
    });

    const manager = new RuntimeManager({
      provisionWorkspace: async () => createFakeWorkspace("/tmp/env-1"),
      createRuntime: () => runtime,
    });
    await manager.ensureEnvironment({
      environmentId: "env-1",
      workspacePath: "/tmp/env-1",
    });

    const router = createRouter({ runtimeManager: manager });

    const handling = router.handleCommands([
      {
        commandId: "archive",
        command: {
          type: "thread.archive",
          environmentId: "env-1",
          threadId: "thread-1",
          workspaceContext: {
            workspacePath: "/tmp/env-1",
            workspaceProvisionType: "unmanaged",
          },
          providerId: "fake",
          providerThreadId: "provider-1",
        },
      },
      {
        commandId: "unarchive",
        command: {
          type: "thread.unarchive",
          environmentId: "env-1",
          threadId: "thread-1",
          providerId: "fake",
          providerThreadId: "provider-1",
        },
      },
    ]);

    await archiveStarted.promise;
    // The later unarchive must not run until the earlier archive completes, or
    // the slower archive could land last and leave the session archived.
    expect(runtime.unarchiveThread).not.toHaveBeenCalled();

    archiveDeferred.resolve(undefined);
    await handling;

    expect(calls).toEqual(["archive:start", "archive:done", "unarchive"]);
  });

  it("runs provider commands for different threads concurrently", async () => {
    const runtime = createFakeRuntime();
    const threadA = createDeferred<undefined>();
    const threadB = createDeferred<undefined>();
    runtime.runTurn.mockImplementation(({ threadId }: { threadId: string }) => {
      return threadId === "thread-a" ? threadA.promise : threadB.promise;
    });

    const manager = new RuntimeManager({
      provisionWorkspace: async () => createFakeWorkspace("/tmp/env-1"),
      createRuntime: () => runtime,
    });
    await manager.ensureEnvironment({
      environmentId: "env-1",
      workspacePath: "/tmp/env-1",
    });
    manager.markThreadActive("env-1", "thread-a", "provider-a", null);
    manager.markThreadActive("env-1", "thread-b", "provider-b", null);

    const router = createRouter({ runtimeManager: manager });
    const handling = router.handleCommands([
      {
        commandId: "run-a",
        command: createTurnSubmitCommand({
          environmentId: "env-1",
          providerThreadId: "provider-a",
          text: "A",
          threadId: "thread-a",
        }),
      },
      {
        commandId: "run-b",
        command: createTurnSubmitCommand({
          environmentId: "env-1",
          providerThreadId: "provider-b",
          text: "B",
          threadId: "thread-b",
        }),
      },
    ]);

    await vi.waitFor(() => {
      expect(runtime.runTurn).toHaveBeenCalledTimes(2);
    });

    threadA.resolve(undefined);
    threadB.resolve(undefined);
    await handling;
  });

  it("serializes provider commands for the same provider session", async () => {
    const runtime = createFakeRuntime();
    const firstTurn = createDeferred<undefined>();
    const secondTurn = createDeferred<undefined>();
    runtime.runTurn.mockImplementation(({ input }: RunTurnArgs) => {
      const firstInput = input[0];
      if (!firstInput || firstInput.type !== "text") {
        return secondTurn.promise;
      }
      return firstInput.text === "first"
        ? firstTurn.promise
        : secondTurn.promise;
    });

    const manager = new RuntimeManager({
      provisionWorkspace: async () => createFakeWorkspace("/tmp/env-1"),
      createRuntime: () => runtime,
    });
    await manager.ensureEnvironment({
      environmentId: "env-1",
      workspacePath: "/tmp/env-1",
    });
    manager.markThreadActive("env-1", "thread-a", "provider-a", "fake");

    const router = createRouter({ runtimeManager: manager });
    const handling = router.handleCommands([
      {
        commandId: "run-a-1",
        command: createTurnSubmitCommand({
          environmentId: "env-1",
          providerThreadId: "provider-a",
          text: "first",
          threadId: "thread-a",
        }),
      },
      {
        commandId: "run-a-2",
        command: createTurnSubmitCommand({
          environmentId: "env-1",
          providerThreadId: "provider-a",
          text: "second",
          threadId: "thread-a",
        }),
      },
    ]);

    await vi.waitFor(() => {
      expect(runtime.runTurn).toHaveBeenCalledTimes(1);
    });
    firstTurn.resolve(undefined);
    await vi.waitFor(() => {
      expect(runtime.runTurn).toHaveBeenCalledTimes(2);
    });
    secondTurn.resolve(undefined);
    await handling;
  });

  it("blocks turn.submit while stopping the same provider process", async () => {
    const runtime = createFakeRuntime();
    const submittedTurn = createDeferred<undefined>();
    const stop = createDeferred<undefined>();
    runtime.runTurn.mockReturnValue(submittedTurn.promise);
    runtime.stopThread.mockReturnValue(stop.promise);

    const manager = new RuntimeManager({
      provisionWorkspace: async () => createFakeWorkspace("/tmp/env-1"),
      createRuntime: () => runtime,
    });
    await manager.ensureEnvironment({
      environmentId: "env-1",
      workspacePath: "/tmp/env-1",
    });
    manager.markThreadActive("env-1", "thread-a", "provider-a", "fake");

    const router = createRouter({ runtimeManager: manager });
    const handling = router.handleCommands([
      {
        commandId: "stop-a",
        command: createThreadStopCommand({
          environmentId: "env-1",
          threadId: "thread-a",
        }),
      },
      {
        commandId: "run-a",
        command: createTurnSubmitCommand({
          environmentId: "env-1",
          providerThreadId: "provider-a",
          text: "run",
          threadId: "thread-a",
        }),
      },
    ]);

    await vi.waitFor(() => {
      expect(runtime.stopThread).toHaveBeenCalledTimes(1);
    });
    expect(runtime.runTurn).not.toHaveBeenCalled();
    expect(runtime.resumeThread).not.toHaveBeenCalled();
    stop.resolve(undefined);
    await vi.waitFor(() => {
      expect(runtime.runTurn).toHaveBeenCalledTimes(1);
    });
    expect(runtime.resumeThread).toHaveBeenCalledWith(
      expect.objectContaining({
        providerThreadId: "provider-a",
        threadId: "thread-a",
      }),
    );
    submittedTurn.resolve(undefined);
    await handling;
  });

  it("blocks thread.stop while a forgotten turn.submit resumes the provider thread", async () => {
    const calls: string[] = [];
    const runtime = createFakeRuntime();
    const resumedThread = createDeferred<ResumeThreadResult>();
    const submittedTurn = createDeferred<undefined>();
    const stop = createDeferred<undefined>();
    runtime.resumeThread.mockImplementation(async () => {
      calls.push("resume:start");
      await resumedThread.promise;
      calls.push("resume:done");
      return { providerThreadId: "provider-a" };
    });
    runtime.runTurn.mockImplementation(async () => {
      calls.push("runTurn:start");
      await submittedTurn.promise;
      calls.push("runTurn:done");
    });
    runtime.stopThread.mockImplementation(async () => {
      calls.push("stopThread");
      await stop.promise;
    });

    const manager = new RuntimeManager({
      provisionWorkspace: async () => createFakeWorkspace("/tmp/env-1"),
      createRuntime: () => runtime,
    });
    await manager.ensureEnvironment({
      environmentId: "env-1",
      workspacePath: "/tmp/env-1",
    });

    const router = createRouter({ runtimeManager: manager });
    const turnHandling = router.handleCommands([
      {
        commandId: "run-a",
        command: createTurnSubmitCommand({
          environmentId: "env-1",
          providerThreadId: "provider-a",
          text: "run",
          threadId: "thread-a",
        }),
      },
    ]);

    await vi.waitFor(() => {
      expect(runtime.resumeThread).toHaveBeenCalledTimes(1);
    });
    const stopHandling = router.handleCommands([
      {
        commandId: "stop-a",
        command: createThreadStopCommand({
          environmentId: "env-1",
          threadId: "thread-a",
        }),
      },
    ]);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(runtime.stopThread).not.toHaveBeenCalled();
    expect(runtime.runTurn).not.toHaveBeenCalled();

    resumedThread.resolve({ providerThreadId: "provider-a" });
    await vi.waitFor(() => {
      expect(runtime.runTurn).toHaveBeenCalledTimes(1);
    });
    expect(runtime.stopThread).not.toHaveBeenCalled();

    submittedTurn.resolve(undefined);
    await vi.waitFor(() => {
      expect(runtime.stopThread).toHaveBeenCalledTimes(1);
    });
    stop.resolve(undefined);
    await Promise.all([turnHandling, stopHandling]);
    expect(calls).toEqual([
      "resume:start",
      "resume:done",
      "runTurn:start",
      "runTurn:done",
      "stopThread",
    ]);
  });

  it("keeps unrelated environments concurrent during provider stop", async () => {
    const runtime = createFakeRuntime();
    const stop = createDeferred<undefined>();
    const otherTurn = createDeferred<undefined>();
    runtime.stopThread.mockReturnValue(stop.promise);
    runtime.runTurn.mockReturnValue(otherTurn.promise);

    const manager = new RuntimeManager({
      provisionWorkspace: async (options) =>
        createFakeWorkspace(
          options.workspaceProvisionType === "unmanaged"
            ? options.path
            : "/tmp/managed",
        ),
      createRuntime: () => runtime,
    });
    await manager.ensureEnvironment({
      environmentId: "env-1",
      workspacePath: "/tmp/env-1",
    });
    await manager.ensureEnvironment({
      environmentId: "env-2",
      workspacePath: "/tmp/env-2",
    });
    manager.markThreadActive("env-1", "thread-a", "provider-a", "fake");
    manager.markThreadActive("env-2", "thread-b", "provider-b", "fake");

    const router = createRouter({ runtimeManager: manager });
    const handling = router.handleCommands([
      {
        commandId: "stop-a",
        command: createThreadStopCommand({
          environmentId: "env-1",
          threadId: "thread-a",
        }),
      },
      {
        commandId: "run-b",
        command: createTurnSubmitCommand({
          environmentId: "env-2",
          providerThreadId: "provider-b",
          text: "run other",
          threadId: "thread-b",
        }),
      },
    ]);

    await vi.waitFor(() => {
      expect(runtime.stopThread).toHaveBeenCalledTimes(1);
      expect(runtime.runTurn).toHaveBeenCalledTimes(1);
    });
    stop.resolve(undefined);
    otherTurn.resolve(undefined);
    await handling;
  });

  it("blocks thread.stop while starting the same provider process", async () => {
    const runtime = createFakeRuntime();
    const startedThread = createDeferred<StartThreadResult>();
    const stop = createDeferred<undefined>();
    runtime.startThread.mockReturnValue(startedThread.promise);
    runtime.stopThread.mockReturnValue(stop.promise);

    const manager = new RuntimeManager({
      provisionWorkspace: async () => createFakeWorkspace("/tmp/env-1"),
      createRuntime: () => runtime,
    });
    await manager.ensureEnvironment({
      environmentId: "env-1",
      workspacePath: "/tmp/env-1",
    });

    const router = createRouter({ runtimeManager: manager });
    const handling = router.handleCommands([
      {
        commandId: "start-a",
        command: {
          type: "thread.start",
          environmentId: "env-1",
          threadId: "thread-a",
          ...createStandardRuntimeCommandContext({
            workspacePath: "/tmp/env-1",
          }),
          requestId: nextClientRequestId(),
          input: [{ type: "text", text: "start" }],
        },
      },
      {
        commandId: "stop-a",
        command: createThreadStopCommand({
          environmentId: "env-1",
          threadId: "thread-a",
        }),
      },
    ]);

    await vi.waitFor(() => {
      expect(runtime.startThread).toHaveBeenCalledTimes(1);
    });
    expect(runtime.stopThread).not.toHaveBeenCalled();
    startedThread.resolve({ providerThreadId: "provider-a" });
    await vi.waitFor(() => {
      expect(runtime.stopThread).toHaveBeenCalledTimes(1);
    });
    stop.resolve(undefined);
    await handling;
  });

  it("uses the provider process lane after thread identity records a null provider id", async () => {
    const runtime = createFakeRuntime();
    const submittedTurn = createDeferred<undefined>();
    const stop = createDeferred<undefined>();
    runtime.runTurn.mockReturnValue(submittedTurn.promise);
    runtime.stopThread.mockReturnValue(stop.promise);

    const manager = new RuntimeManager({
      provisionWorkspace: async () => createFakeWorkspace("/tmp/env-1"),
      createRuntime: () => runtime,
    });
    await manager.ensureEnvironment({
      environmentId: "env-1",
      workspacePath: "/tmp/env-1",
    });
    manager.recordThreadProviderStart({
      environmentId: "env-1",
      providerId: "fake",
      threadId: "thread-a",
    });
    manager.markThreadActive("env-1", "thread-a", "provider-a", null);

    const router = createRouter({ runtimeManager: manager });
    const handling = router.handleCommands([
      {
        commandId: "run-a",
        command: createTurnSubmitCommand({
          environmentId: "env-1",
          providerThreadId: "provider-a",
          text: "run",
          threadId: "thread-a",
        }),
      },
      {
        commandId: "stop-a",
        command: createThreadStopCommand({
          environmentId: "env-1",
          threadId: "thread-a",
        }),
      },
    ]);

    await vi.waitFor(() => {
      expect(runtime.runTurn).toHaveBeenCalledTimes(1);
    });
    expect(runtime.stopThread).not.toHaveBeenCalled();
    submittedTurn.resolve(undefined);
    await vi.waitFor(() => {
      expect(runtime.stopThread).toHaveBeenCalledTimes(1);
    });
    stop.resolve(undefined);
    await handling;
  });

  it("reports completed commands in completion order", async () => {
    const runtime = createFakeRuntime();
    const threadOne = createDeferred<{ providerThreadId: string }>();
    const threadTwo = createDeferred<{ providerThreadId: string }>();
    const threadThree = createDeferred<{ providerThreadId: string }>();
    runtime.startThread
      .mockReturnValueOnce(threadOne.promise)
      .mockReturnValueOnce(threadTwo.promise)
      .mockReturnValueOnce(threadThree.promise);

    const manager = new RuntimeManager({
      provisionWorkspace: async () => createFakeWorkspace("/tmp/env-1"),
      createRuntime: () => runtime,
    });
    const reported: string[] = [];
    const router = createRouter({
      reportResult: async (result) => {
        reported.push(result.commandId);
      },
      runtimeManager: manager,
    });

    const handling = router.handleCommands([
      {
        commandId: "cmd-5",
        command: {
          type: "thread.start",
          environmentId: "env-1",
          threadId: "thread-1",
          ...createStandardRuntimeCommandContext({
            workspacePath: "/tmp/env-1",
          }),
          requestId: nextClientRequestId(),
          input: [{ type: "text", text: "start thread 1" }],
        },
      },
      {
        commandId: "cmd-6",
        command: {
          type: "thread.start",
          environmentId: "env-1",
          threadId: "thread-2",
          ...createStandardRuntimeCommandContext({
            workspacePath: "/tmp/env-1",
          }),
          requestId: nextClientRequestId(),
          input: [{ type: "text", text: "start thread 2" }],
        },
      },
      {
        commandId: "cmd-7",
        command: {
          type: "thread.start",
          environmentId: "env-1",
          threadId: "thread-3",
          ...createStandardRuntimeCommandContext({
            workspacePath: "/tmp/env-1",
          }),
          requestId: nextClientRequestId(),
          input: [{ type: "text", text: "start thread 3" }],
        },
      },
    ]);

    threadThree.resolve({ providerThreadId: "provider-3" });
    await vi.waitFor(() => {
      expect(reported).toEqual(["cmd-7"]);
    });

    threadOne.resolve({ providerThreadId: "provider-1" });
    await vi.waitFor(() => {
      expect(reported).toEqual(["cmd-7", "cmd-5"]);
    });

    threadTwo.resolve({ providerThreadId: "provider-2" });
    await handling;
    expect(reported).toEqual(["cmd-7", "cmd-5", "cmd-6"]);
  });

  it("captures completedAt after execution in success and error paths", async () => {
    const runtime = createFakeRuntime();
    const success = createDeferred<{ providerThreadId: string }>();
    const failure = createDeferred<{ providerThreadId: string }>();
    runtime.startThread
      .mockReturnValueOnce(success.promise)
      .mockImplementationOnce(async () => {
        await failure.promise;
        throw new Error("boom");
      });

    const manager = new RuntimeManager({
      provisionWorkspace: async () => createFakeWorkspace("/tmp/env-1"),
      createRuntime: () => runtime,
    });
    // The daemon router took a `now` option for this test; the engine reads
    // `Date.now` directly, so pin the clock (timers are a sanctioned mock
    // boundary).
    let nowValue = 100;
    vi.spyOn(Date, "now").mockImplementation(() => nowValue);
    const results: Array<{
      commandId: string;
      completedAt: number;
      ok: boolean;
    }> = [];
    const router = createRouter({
      reportResult: async (result) => {
        results.push({
          commandId: result.commandId,
          completedAt: result.completedAt,
          ok: result.ok,
        });
      },
      runtimeManager: manager,
    });

    const handling = router.handleCommands([
      {
        commandId: "success",
        command: {
          type: "thread.start",
          environmentId: "env-1",
          threadId: "thread-1",
          ...createStandardRuntimeCommandContext({
            workspacePath: "/tmp/env-1",
          }),
          requestId: nextClientRequestId(),
          input: [{ type: "text", text: "start thread 1" }],
        },
      },
      {
        commandId: "failure",
        command: {
          type: "thread.start",
          environmentId: "env-1",
          threadId: "thread-2",
          ...createStandardRuntimeCommandContext({
            workspacePath: "/tmp/env-1",
          }),
          requestId: nextClientRequestId(),
          input: [{ type: "text", text: "start thread 2" }],
        },
      },
    ]);

    nowValue = 200;
    success.resolve({ providerThreadId: "provider-1" });
    await vi.waitFor(() => {
      expect(results.some((result) => result.commandId === "success")).toBe(
        true,
      );
    });

    nowValue = 300;
    failure.resolve({ providerThreadId: "provider-2" });
    await handling;

    expect(results).toEqual([
      { commandId: "success", completedAt: 200, ok: true },
      { commandId: "failure", completedAt: 300, ok: false },
    ]);
  });

  it("allows subsequent commands after environment.destroy", async () => {
    const destroyedWorkspace = createFakeWorkspace("/tmp/env-1");
    const recreatedWorkspace = createFakeWorkspace("/tmp/env-1");
    const runtime = createFakeRuntime();
    const manager = new RuntimeManager({
      provisionWorkspace: vi
        .fn<(options: ProvisionWorkspaceArgs) => Promise<HostWorkspace>>()
        .mockResolvedValueOnce(destroyedWorkspace)
        .mockResolvedValueOnce(recreatedWorkspace),
      createRuntime: () => runtime,
    });
    await manager.ensureEnvironment({
      environmentId: "env-1",
      workspacePath: "/tmp/env-1",
    });

    const router = createRouter({ runtimeManager: manager });
    await router.handleCommands([
      {
        commandId: "destroy",
        command: {
          type: "environment.destroy",
          environmentId: "env-1",
          workspaceContext: {
            workspacePath: "/tmp/env-1",
            workspaceProvisionType: "managed-worktree",
          },
        },
      },
    ]);

    expect(manager.get("env-1")).toBeUndefined();

    await manager.ensureEnvironment({
      environmentId: "env-1",
      workspacePath: "/tmp/env-1",
    });
    const response = await router.executeOnlineRpcCommand({
      type: "workspace.status",
      environmentId: "env-1",
      workspaceContext: {
        workspacePath: "/tmp/env-1",
        workspaceProvisionType: "unmanaged",
      },
      mergeBaseBranch: "main",
    });

    expect(response).toEqual(
      expect.objectContaining({
        outcome: "available",
      }),
    );
    expect(recreatedWorkspace.getStatus).toHaveBeenCalledTimes(1);
  });

  it("recovers result reporting after a transient report failure", async () => {
    const manager = new RuntimeManager({
      provisionWorkspace: async () => createFakeWorkspace("/tmp/env-1"),
      createRuntime: () => createFakeRuntime(),
    });
    const logger = createLogger();
    let shouldFail = true;
    const reported: string[] = [];
    const router = createRouter({
      logger,
      reportResult: async (result) => {
        if (shouldFail) {
          shouldFail = false;
          throw new Error("report failed");
        }
        reported.push(result.commandId);
      },
      runtimeManager: manager,
    });

    await router.handleCommands([
      {
        commandId: "cmd-1",
        command: {
          type: "thread.start",
          environmentId: "env-1",
          threadId: "thread-1",
          ...createStandardRuntimeCommandContext({
            workspacePath: "/tmp/env-1",
          }),
          requestId: nextClientRequestId(),
          input: [{ type: "text", text: "start thread 1" }],
        },
      },
    ]);

    expect(reported).toEqual([]);

    await router.handleCommands([
      {
        commandId: "cmd-2",
        command: {
          type: "thread.start",
          environmentId: "env-1",
          threadId: "thread-2",
          ...createStandardRuntimeCommandContext({
            workspacePath: "/tmp/env-1",
          }),
          requestId: nextClientRequestId(),
          input: [{ type: "text", text: "start thread 2" }],
        },
      },
    ]);

    await vi.waitFor(() => {
      expect(reported).toEqual(["cmd-2", "cmd-1"]);
    });
    expect(logger.warn).toHaveBeenCalledWith(
      {
        err: expect.any(Error),
      },
      "failed to report command result, will retry on next completion",
    );
  });

  it("reports later command results when an older pending result keeps failing", async () => {
    const manager = new RuntimeManager({
      provisionWorkspace: async () => createFakeWorkspace("/tmp/env-1"),
      createRuntime: () => createFakeRuntime(),
    });
    const logger = createLogger();
    const reported: string[] = [];
    const router = createRouter({
      logger,
      reportResult: async (result) => {
        if (result.commandId === "cmd-1") {
          throw new Error("stale report failed");
        }
        reported.push(result.commandId);
      },
      runtimeManager: manager,
    });

    await router.handleCommands([
      {
        commandId: "cmd-1",
        command: {
          type: "thread.start",
          environmentId: "env-1",
          threadId: "thread-1",
          ...createStandardRuntimeCommandContext({
            workspacePath: "/tmp/env-1",
          }),
          requestId: nextClientRequestId(),
          input: [{ type: "text", text: "start thread 1" }],
        },
      },
    ]);

    expect(reported).toEqual([]);

    await router.handleCommands([
      {
        commandId: "cmd-2",
        command: {
          type: "thread.start",
          environmentId: "env-1",
          threadId: "thread-2",
          ...createStandardRuntimeCommandContext({
            workspacePath: "/tmp/env-1",
          }),
          requestId: nextClientRequestId(),
          input: [{ type: "text", text: "start thread 2" }],
        },
      },
    ]);

    await vi.waitFor(() => {
      expect(logger.warn).toHaveBeenCalledWith(
        {
          err: expect.any(Error),
        },
        "failed to report pending command result, will retry on next completion",
      );
    });
    expect(reported).toEqual(["cmd-2"]);
  });
});
