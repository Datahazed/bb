import type { ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { isAcpProviderId } from "@bb/agent-providers";
import type {
  JsonObject,
  ProviderCapabilities,
  ProviderInfo,
  RuntimeThreadExecutionOptions,
  ThreadEvent,
} from "@bb/domain";
import type {
  HostDaemonAcpLaunchSpec,
  HostDaemonProviderDriverLaunchSpec,
} from "@bb/host-daemon-contract";
import {
  PROVIDER_DRIVER_PROTOCOL_VERSION,
  type ProviderDriverCapabilities,
  type ProviderDriverHostInteractionRequestParams,
  type ProviderDriverHostInteractionRequestResult,
  type ProviderDriverHostToolCallParams,
  type ProviderDriverHostToolCallResult,
} from "@bb/provider-driver-contract";
import { filterSkillRootsForProvider } from "./runtime-skill-roots.js";
import {
  classifyClaudeExecutionSettingsChange,
  classifySessionExecutionSettingsChange,
  normalizeClaudeExecutionOptions,
} from "./execution-options.js";
import type { ProviderDriverConnection } from "./provider-driver/connection.js";
import { CanonicalProcessProviderConnection } from "./provider-driver/canonical-process-connection.js";
import {
  ProviderDriverSupervisor,
  type SupervisedProviderDriver,
} from "./provider-driver/supervisor.js";
import type { RuntimeProviderIdentityState } from "./runtime-thread-identity.js";
import type {
  AgentRuntimeOptions,
  AgentRuntimeProcessExitThreadState,
  AgentRuntimeResolvedProviderDriverLaunch,
  AgentRuntimeSkillRoot,
} from "./types.js";

export interface RuntimeProviderProcess {
  child: ChildProcess;
  connection: ProviderDriverConnection;
  expectedShutdownExpectations: number;
  identity: RuntimeProviderIdentityState;
  interactiveRequestScope: string;
  processKey: string;
  providerId: string;
  stop: () => Promise<void>;
  stderrTail: Buffer;
}

export interface RuntimeProviderConnectionEventsArgs {
  events: ThreadEvent[];
  providerProcess: RuntimeProviderProcess;
}

export interface RuntimeProviderCanonicalToolCallArgs {
  params: ProviderDriverHostToolCallParams;
  providerProcess: RuntimeProviderProcess;
}

export interface RuntimeProviderCanonicalInteractionArgs {
  params: ProviderDriverHostInteractionRequestParams;
  providerProcess: RuntimeProviderProcess;
}

export interface RuntimeCanonicalProviderDriverLaunchSpec {
  artifactDigest?: string;
  capabilities: ProviderCapabilities;
  identity: { driverId: string; pluginId: string; providerId?: string };
  classifyExecutionSettingsChange?: ProviderDriverConnection["classifyExecutionSettingsChange"];
  config: JsonObject;
  displayName: string;
  process: { command: string; args: string[]; env?: Record<string, string> };
  providerDataDir?: string;
  processCapabilities: { multiplexSessions: boolean };
  release?: () => void;
  normalizeExecutionOptions?: (
    options: RuntimeThreadExecutionOptions,
  ) => RuntimeThreadExecutionOptions;
}

export type RuntimeCanonicalProviderDriverLaunchSpecFactory = (
  providerId: string,
) => RuntimeCanonicalProviderDriverLaunchSpec;

export interface RuntimeProviderProcessManagerArgs {
  additionalWorkspaceWriteRoots: readonly string[];
  canonicalProviderDriverFactory?: RuntimeCanonicalProviderDriverLaunchSpecFactory;
  /**
   * Snapshots a thread's turn/provider state for the process-exit
   * notification. Invoked before `onProviderThreadDetached` clears the
   * state, so exit consumers still see what the dead process was running.
   */
  captureThreadExitState: (
    threadId: string,
  ) => AgentRuntimeProcessExitThreadState;
  createProviderIdentityState: (
    providerId: string,
  ) => RuntimeProviderIdentityState;
  env: Record<string, string> | undefined;
  handleCanonicalInteraction: (
    args: RuntimeProviderCanonicalInteractionArgs,
  ) => Promise<ProviderDriverHostInteractionRequestResult>;
  handleCanonicalToolCall: (
    args: RuntimeProviderCanonicalToolCallArgs,
  ) => Promise<ProviderDriverHostToolCallResult>;
  handleConnectionEvents: (args: RuntimeProviderConnectionEventsArgs) => void;
  onProcessExit: AgentRuntimeOptions["onProcessExit"];
  onProviderThreadDetached: (threadId: string) => void;
  onStderr: AgentRuntimeOptions["onStderr"];
  resolveProviderDriverLaunch?: AgentRuntimeOptions["resolveProviderDriverLaunch"];
  resolveThreadStoragePath: (threadId: string) => string;
  skillRoots: readonly AgentRuntimeSkillRoot[];
  workspacePath: string;
}

export interface EnsureRuntimeProviderArgs {
  acpLaunchSpec?: HostDaemonAcpLaunchSpec;
  providerDriver?: HostDaemonProviderDriverLaunchSpec;
  processKey: string;
  providerId: string;
}

export interface RequireRuntimeProviderProcessArgs {
  processKey: string;
  providerId: string;
}

export interface ShutdownRuntimeProviderArgs {
  processKey: string;
  providerId: string;
}

interface ProviderProcessExitStatus {
  code: number | null;
  signal: string | null;
}

interface ProviderProcessExitedErrorArgs {
  providerId: string;
  status: ProviderProcessExitStatus;
  stderrTail: Buffer;
}

const PROVIDER_STDERR_TAIL_MAX_BYTES = 4_000;
const CANONICAL_PROVIDER_REQUEST_TIMEOUT_MS = 2 * 60_000;
const CLAUDE_CODE_PROVIDER_ID = "claude-code";

function observedProviderCapabilities(
  capabilities: ProviderDriverCapabilities,
): ProviderCapabilities {
  const operations = new Set(capabilities.supportedSessionOperations);
  return {
    supportsArchive: operations.has("archive"),
    supportsRename: operations.has("rename"),
    supportsServiceTier: capabilities.supportsServiceTier,
    supportsUserQuestion: capabilities.supportsUserQuestions,
    supportsFork: operations.has("fork"),
    supportedPermissionModes: [...capabilities.supportedPermissionModes],
  };
}

function driverArtifactDigest(processArgs: readonly string[]): string {
  const entryPath = processArgs.at(-1);
  if (!entryPath) {
    throw new Error("Provider driver launch has no entry point");
  }
  return createHash("sha256").update(readFileSync(entryPath)).digest("hex");
}

export class ProviderProcessExitedError extends Error {
  constructor(args: ProviderProcessExitedErrorArgs) {
    const stderr = formatProviderStderr(args.stderrTail);
    super(
      `Provider "${args.providerId}" exited unexpectedly (${formatProviderProcessExitStatus(args.status)})` +
        (stderr ? `\nstderr: ${stderr}` : ""),
    );
    this.name = "ProviderProcessExitedError";
  }
}

export class RuntimeProviderProcessManager {
  private readonly args: RuntimeProviderProcessManagerArgs;
  private readonly canonicalSupervisor = new ProviderDriverSupervisor();
  private readonly processes = new Map<string, RuntimeProviderProcess>();
  private readonly providerStarting = new Map<string, Promise<void>>();
  private shuttingDown = false;

  constructor(args: RuntimeProviderProcessManagerArgs) {
    this.args = args;
  }

  async ensureProvider(args: EnsureRuntimeProviderArgs): Promise<void> {
    const existing = this.providerStarting.get(args.processKey);
    if (existing) {
      await existing;
      return;
    }

    if (this.processes.has(args.processKey)) return;

    const startPromise = this.startCanonicalProvider(
      args,
      this.args.canonicalProviderDriverFactory
        ? this.getTestCanonicalDriverSpec(args.providerId)
        : undefined,
    );

    this.providerStarting.set(args.processKey, startPromise);
    try {
      await startPromise;
    } finally {
      if (this.providerStarting.get(args.processKey) === startPromise) {
        this.providerStarting.delete(args.processKey);
      }
    }
  }

  requireProviderProcess(
    args: RequireRuntimeProviderProcessArgs,
  ): RuntimeProviderProcess {
    const providerProcess = this.processes.get(args.processKey);
    if (!providerProcess) {
      throw new Error(`Provider "${args.providerId}" is not running`);
    }
    if (hasChildProcessExited(providerProcess.child)) {
      this.processes.delete(args.processKey);
      throw new Error(
        `Provider "${args.providerId}" has exited (${formatChildProcessExitStatus(providerProcess.child)})`,
      );
    }
    return providerProcess;
  }

  listRunningProviders(): string[] {
    return [
      ...new Set([...this.processes.values()].map((proc) => proc.providerId)),
    ];
  }

  async shutdownProvider(args: ShutdownRuntimeProviderArgs): Promise<void> {
    const providerProcess = this.processes.get(args.processKey);
    if (!providerProcess || hasChildProcessExited(providerProcess.child)) {
      return;
    }

    providerProcess.expectedShutdownExpectations += 1;
    await providerProcess.stop();
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    const shutdownPromises: Promise<void>[] = [];

    for (const [processKey, providerProcess] of this.processes) {
      shutdownPromises.push(providerProcess.stop());
      providerProcess.connection.rejectPendingRequests(
        new Error("Runtime shutting down"),
      );
      for (const threadId of providerProcess.identity.threadIds) {
        this.args.onProviderThreadDetached(threadId);
      }
      this.processes.delete(processKey);
    }

    await Promise.all(shutdownPromises);
    await this.canonicalSupervisor.shutdown();
  }

  private async startCanonicalProvider(
    args: EnsureRuntimeProviderArgs,
    testSpec?: RuntimeCanonicalProviderDriverLaunchSpec,
  ): Promise<void> {
    const providerId = args.providerId;
    let resolvedPluginSpec:
      | AgentRuntimeResolvedProviderDriverLaunch
      | undefined;
    if (args.providerDriver !== undefined) {
      const resolveLaunch = this.args.resolveProviderDriverLaunch;
      if (resolveLaunch === undefined) {
        throw new Error(
          `Provider "${providerId}" requires host-driver artifact resolution`,
        );
      }
      resolvedPluginSpec = await resolveLaunch(args.providerDriver);
    }
    const effectiveSpec = testSpec ?? resolvedPluginSpec;
    if (effectiveSpec === undefined) {
      throw new Error(
        `Provider "${providerId}" requires a registered host-driver artifact`,
      );
    }
    const acpProfile = args.acpLaunchSpec;
    if (isAcpProviderId(providerId) && acpProfile === undefined) {
      throw new Error(`ACP provider "${providerId}" requires a launch spec`);
    }
    const processConfig = effectiveSpec.process;
    const identity = effectiveSpec.identity;
    const declaredMultiplexSessions =
      effectiveSpec.processCapabilities.multiplexSessions;
    let diagnosticsTail: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let providerProcess: RuntimeProviderProcess | null = null;
    let supervised: SupervisedProviderDriver | undefined;
    let runtimeCapabilities: ProviderCapabilities;
    try {
      supervised = await this.canonicalSupervisor.launch({
        processKey: args.processKey,
        initialize: {
          supportedProtocolVersions: [PROVIDER_DRIVER_PROTOCOL_VERSION],
          expected: {
            pluginId: identity.pluginId,
            driverId: identity.driverId,
            providerId: effectiveSpec.identity.providerId ?? providerId,
            artifactDigest:
              effectiveSpec.artifactDigest ??
              driverArtifactDigest(processConfig.args),
          },
          host: {
            platform: process.platform,
            architecture: process.arch,
          },
          paths: {
            providerDataDir:
              effectiveSpec.providerDataDir ??
              join(homedir(), ".bb", "provider-data", providerId),
          },
          config: acpProfile ?? effectiveSpec.config,
        },
        launch: {
          command: processConfig.command,
          args: processConfig.args,
          cwd: this.args.workspacePath,
          env: {
            ...this.args.env,
            ...processConfig.env,
          },
          ...(effectiveSpec.release !== undefined
            ? { release: effectiveSpec.release }
            : {}),
        },
        hostHandlers: {
          callTool: (params) => {
            if (!providerProcess) {
              throw new Error(
                `${providerId} driver requested a tool during startup`,
              );
            }
            return this.args.handleCanonicalToolCall({
              params,
              providerProcess,
            });
          },
          requestInteraction: (params) => {
            if (!providerProcess) {
              throw new Error(
                `${providerId} driver requested an interaction during startup`,
              );
            }
            return this.args.handleCanonicalInteraction({
              params,
              providerProcess,
            });
          },
        },
        onDiagnostic: (diagnostic) => {
          diagnosticsTail = appendBoundedStderrBytes(
            diagnosticsTail,
            Buffer.from(`${diagnostic.line}\n`),
          );
          if (providerProcess) {
            providerProcess.stderrTail = diagnosticsTail;
          }
          this.args.onStderr?.(
            diagnostic.stream === "stderr"
              ? diagnostic.line
              : `${providerId} stdout: ${diagnostic.line}`,
          );
        },
        onExit: (exit) => {
          if (!providerProcess) return;
          this.handleProviderProcessExit({
            code: exit.code,
            providerId,
            providerProcess,
            signal: exit.signal,
          });
        },
        onProtocolError: (error) => {
          this.args.onStderr?.(
            `${providerId} driver protocol error: ${error.message}`,
          );
        },
        requestTimeoutMs: CANONICAL_PROVIDER_REQUEST_TIMEOUT_MS,
        requestTimeouts: {
          driverInitializeMs: 30_000,
          driverInspectMs: 30_000,
          sessionOpenMs: 30_000,
        },
      });
      if (
        supervised.initialization.processCapabilities.multiplexSessions !==
        declaredMultiplexSessions
      ) {
        await supervised.stop();
        throw new Error(
          `${providerId} driver process policy does not match its declared launch spec`,
        );
      }
      const inspection = await supervised.connection.inspect({
        cwd: this.args.workspacePath,
        operation: null,
      });
      runtimeCapabilities = observedProviderCapabilities(
        inspection.capabilities,
      );
    } catch (error) {
      await supervised?.stop();
      const detail = formatProviderStderr(diagnosticsTail);
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}${detail ? `\nstderr: ${detail}` : ""}`,
        { cause: error },
      );
    }

    if (supervised === undefined) {
      throw new Error(`${providerId} driver launch did not return a process`);
    }
    const providerInfo: Pick<ProviderInfo, "capabilities" | "displayName"> = {
      displayName: effectiveSpec.displayName,
      capabilities: runtimeCapabilities,
    };
    const classifyExecutionSettingsChange =
      ("classifyExecutionSettingsChange" in effectiveSpec
        ? effectiveSpec.classifyExecutionSettingsChange
        : undefined) ??
      (providerId === CLAUDE_CODE_PROVIDER_ID
        ? classifyClaudeExecutionSettingsChange
        : classifySessionExecutionSettingsChange);
    const normalizeExecutionOptions =
      ("normalizeExecutionOptions" in effectiveSpec
        ? effectiveSpec.normalizeExecutionOptions
        : undefined) ??
      (providerId === CLAUDE_CODE_PROVIDER_ID
        ? normalizeClaudeExecutionOptions
        : undefined);
    const connection = new CanonicalProcessProviderConnection({
      additionalWorkspaceWriteRoots: this.args.additionalWorkspaceWriteRoots,
      ...(providerId === CLAUDE_CODE_PROVIDER_ID
        ? {
            buildProviderOptions: (execution) => ({
              claudeCodeMockCliTraffic: execution.claudeCodeMockCliTraffic,
              ...(execution.claudeCodePermissionMode !== undefined
                ? {
                    claudeCodePermissionMode:
                      execution.claudeCodePermissionMode,
                  }
                : {}),
            }),
          }
        : {}),
      classifyExecutionSettingsChange,
      ...(normalizeExecutionOptions !== undefined
        ? { normalizeExecutionOptions }
        : {}),
      capabilities: providerInfo.capabilities,
      displayName: providerInfo.displayName,
      processConnection: supervised.connection,
      providerId,
      resolveThreadStoragePath: this.args.resolveThreadStoragePath,
    });
    providerProcess = {
      child: supervised.child,
      connection,
      expectedShutdownExpectations: 0,
      identity: this.args.createProviderIdentityState(providerId),
      interactiveRequestScope: randomUUID(),
      processKey: args.processKey,
      providerId,
      stop: async () => supervised.stop(),
      stderrTail: diagnosticsTail,
    };
    connection.onEvent((events) => {
      if (this.shuttingDown || !providerProcess) return;
      this.args.handleConnectionEvents({ events, providerProcess });
    });
    this.processes.set(args.processKey, providerProcess);

    try {
      await connection.initialize(
        filterSkillRootsForProvider({
          providerId,
          skillRoots: this.args.skillRoots,
        }),
      );
    } catch (error) {
      this.processes.delete(args.processKey);
      await supervised.stop();
      throw error;
    }
  }

  private getTestCanonicalDriverSpec(
    providerId: string,
  ): RuntimeCanonicalProviderDriverLaunchSpec {
    const factory = this.args.canonicalProviderDriverFactory;
    if (!factory) {
      throw new Error(
        "Test canonical provider driver factory is not configured",
      );
    }
    return factory(providerId);
  }

  private handleProviderProcessExit(args: ProviderProcessExitArgs): void {
    if (this.shuttingDown) return;
    if (!this.isCurrentProviderProcess(args)) return;
    const expected = consumeExpectedProviderProcessShutdown(
      args.providerProcess,
    );
    this.processes.delete(args.providerProcess.processKey);
    const threadIds = [...args.providerProcess.identity.threadIds];
    // Snapshot per-thread state before detaching clears it; the exit
    // notification below is the last place this state is observable.
    const threads = threadIds.map((threadId) =>
      this.args.captureThreadExitState(threadId),
    );
    for (const threadId of threadIds) {
      this.args.onProviderThreadDetached(threadId);
    }
    args.providerProcess.connection.rejectPendingRequests(
      new ProviderProcessExitedError({
        providerId: args.providerId,
        status: { code: args.code, signal: args.signal },
        stderrTail: args.providerProcess.stderrTail,
      }),
    );
    this.args.onProcessExit?.({
      providerId: args.providerId,
      threads,
      code: args.code,
      expected,
      signal: args.signal,
      stderr: formatProviderStderr(args.providerProcess.stderrTail),
    });
  }

  private isCurrentProviderProcess(
    args: Pick<ProviderProcessExitArgs, "providerProcess">,
  ): boolean {
    return (
      this.processes.get(args.providerProcess.processKey) ===
      args.providerProcess
    );
  }
}

/**
 * Whether a child process has terminated, covering both normal exits
 * (`exitCode`) and signal terminations (`signalCode`). Node reports a
 * signal-killed child with a null `exitCode` and a set `signalCode`.
 */
export function hasChildProcessExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

function getChildProcessExitStatus(
  child: ChildProcess,
): ProviderProcessExitStatus {
  return { code: child.exitCode, signal: child.signalCode };
}

function formatChildProcessExitStatus(child: ChildProcess): string {
  return formatProviderProcessExitStatus(getChildProcessExitStatus(child));
}

function formatProviderProcessExitStatus(
  status: ProviderProcessExitStatus,
): string {
  if (status.code !== null) {
    return `code ${status.code}`;
  }
  if (status.signal !== null) {
    return `signal ${status.signal}`;
  }
  return "unknown status";
}

function formatProviderStderr(stderrTail: Buffer): string | null {
  const stderr = stderrTail.toString("utf8").trim();
  if (stderr.length === 0) {
    return null;
  }
  return stderr;
}

function appendBoundedStderrBytes(current: Buffer, chunk: Buffer): Buffer {
  if (chunk.length >= PROVIDER_STDERR_TAIL_MAX_BYTES) {
    return Buffer.from(
      chunk.subarray(chunk.length - PROVIDER_STDERR_TAIL_MAX_BYTES),
    );
  }
  const currentBytesToKeep = Math.min(
    current.length,
    PROVIDER_STDERR_TAIL_MAX_BYTES - chunk.length,
  );
  return Buffer.concat([
    current.subarray(current.length - currentBytesToKeep),
    chunk,
  ]);
}

function consumeExpectedProviderProcessShutdown(
  providerProcess: RuntimeProviderProcess,
): boolean {
  // One process exit consumes all outstanding explicit shutdown requests.
  const expected = providerProcess.expectedShutdownExpectations > 0;
  providerProcess.expectedShutdownExpectations = 0;
  return expected;
}

interface ProviderProcessExitArgs {
  code: number | null;
  providerId: string;
  providerProcess: RuntimeProviderProcess;
  signal: string | null;
}
