import type { ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import {
  buildAcpProviderInfo,
  getBuiltInAgentProviderInfo,
  isAcpProviderId,
} from "@bb/agent-providers";
import type { ThreadEvent } from "@bb/domain";
import type { HostDaemonAcpLaunchSpec } from "@bb/host-daemon-contract";
import {
  PROVIDER_DRIVER_PROTOCOL_VERSION,
  type ProviderDriverHostInteractionRequestParams,
  type ProviderDriverHostInteractionRequestResult,
  type ProviderDriverHostToolCallParams,
  type ProviderDriverHostToolCallResult,
} from "@bb/provider-driver-contract";
import {
  sanitizeInheritedChildProcessEnv,
  spawnPortablePipedProcess,
} from "@bb/process-utils";
import type {
  ProviderAdapter,
  ProviderAdapterFactory,
} from "./provider-adapter.js";
import { filterSkillRootsForProvider } from "./runtime-skill-roots.js";
import {
  classifyClaudeExecutionSettingsChange,
  classifySessionExecutionSettingsChange,
  normalizeClaudeExecutionOptions,
} from "./execution-options.js";
import { resolveBridgeProcessArgs } from "./shared/bridge-path.js";
import type { ProviderDriverConnection } from "./provider-driver/connection.js";
import { CanonicalProcessProviderConnection } from "./provider-driver/canonical-process-connection.js";
import { LegacyAdapterConnection } from "./provider-driver/legacy-adapter-connection.js";
import {
  ProviderDriverSupervisor,
  type SupervisedProviderDriver,
} from "./provider-driver/supervisor.js";
import type { RuntimeProviderIdentityState } from "./runtime-thread-identity.js";
import type {
  AgentRuntimeOptions,
  AgentRuntimeProcessExitThreadState,
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
  stop?: () => Promise<void>;
  stderrLineTail: Buffer;
  stderrTail: Buffer;
}

export interface RuntimeProviderProcessLineArgs {
  line: string;
  providerProcess: RuntimeProviderProcess;
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

export interface RuntimeProviderProcessManagerArgs {
  additionalWorkspaceWriteRoots: readonly string[];
  adapterFactory?: ProviderAdapterFactory;
  bridgeBundleDir: string | undefined;
  bridgeNodeEnv?: Record<string, string>;
  bridgeNodeExecutablePath?: string;
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
  getNextRequestId: () => number;
  handleCanonicalInteraction: (
    args: RuntimeProviderCanonicalInteractionArgs,
  ) => Promise<ProviderDriverHostInteractionRequestResult>;
  handleCanonicalToolCall: (
    args: RuntimeProviderCanonicalToolCallArgs,
  ) => Promise<ProviderDriverHostToolCallResult>;
  handleConnectionEvents: (args: RuntimeProviderConnectionEventsArgs) => void;
  handleStdoutLine: (args: RuntimeProviderProcessLineArgs) => void;
  onProcessExit: AgentRuntimeOptions["onProcessExit"];
  onProviderIdentityWaitersInterrupted: (
    providerProcess: RuntimeProviderProcess,
  ) => void;
  onProviderThreadDetached: (
    threadId: string,
    providerProcess: RuntimeProviderProcess,
  ) => void;
  onStderr: AgentRuntimeOptions["onStderr"];
  resolveThreadStoragePath: (threadId: string) => string;
  skillRoots: readonly AgentRuntimeSkillRoot[];
  workspacePath: string;
}

export interface EnsureRuntimeProviderArgs {
  acpLaunchSpec?: HostDaemonAcpLaunchSpec;
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
  timeoutMs?: number;
}

interface CleanupFailedStartupArgs {
  processKey: string;
  providerId: string;
  providerProcess: RuntimeProviderProcess;
  startupError: Error;
}

interface TerminateProviderProcessArgs {
  providerProcess: RuntimeProviderProcess;
  timeoutMs?: number;
}

interface SpawnProviderArgs {
  adapter: ProviderAdapter;
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
const ACP_DRIVER_ID = "acp";
const CLAUDE_CODE_PROVIDER_ID = "claude-code";
const CODEX_PROVIDER_ID = "codex";
const PI_PROVIDER_ID = "pi";

function createAdapterTurnIdPrefix(): string {
  const adapterId = randomUUID().replaceAll("-", "").slice(0, 16);
  return `turn_${adapterId}_`;
}

function resolveCanonicalDriverProcessArgs(args: {
  bridgeBundleDir: string | undefined;
  providerId: string;
}): string[] {
  const driver = isAcpProviderId(args.providerId)
    ? {
        bundleFileName: "bb-acp-driver.mjs",
        bridgeRelativePath: "acp/driver-entry.js",
      }
    : args.providerId === CODEX_PROVIDER_ID
      ? {
          bundleFileName: "bb-codex-driver.mjs",
          bridgeRelativePath: "codex/driver-entry.js",
        }
      : args.providerId === PI_PROVIDER_ID
        ? {
            bundleFileName: "bb-pi-driver.mjs",
            bridgeRelativePath: "pi/driver-entry.js",
          }
        : {
            bundleFileName: "bb-claude-code-driver.mjs",
            bridgeRelativePath: "claude-code/driver-entry.js",
          };
  return resolveBridgeProcessArgs({
    bridgeBundleDir: args.bridgeBundleDir,
    importMetaUrl: import.meta.url,
    ...driver,
  });
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

    const startPromise = (async () => {
      if (this.args.adapterFactory === undefined) {
        await this.startCanonicalProvider(args);
        return;
      }

      const adapter = this.getTestAdapter(args.providerId, args.acpLaunchSpec);
      const providerProcess = this.spawnProvider({
        adapter,
        processKey: args.processKey,
        providerId: args.providerId,
      });

      try {
        if (hasChildProcessExited(providerProcess.child)) {
          const stderr = formatProviderStderr(
            providerProcess.stderrTail,
          )?.slice(0, 500);
          throw new Error(
            `Provider "${args.providerId}" exited during startup with ${formatChildProcessExitStatus(providerProcess.child)}` +
              (stderr ? `\nstderr: ${stderr}` : ""),
          );
        }

        const providerSkillRoots = filterSkillRootsForProvider({
          providerId: args.providerId,
          skillRoots: this.args.skillRoots,
        });
        await providerProcess.connection.initialize(providerSkillRoots);
      } catch (startupError) {
        await this.cleanupFailedStartup({
          processKey: args.processKey,
          providerId: args.providerId,
          providerProcess,
          startupError:
            startupError instanceof Error
              ? startupError
              : new Error(String(startupError)),
        });
        throw startupError;
      }
    })();

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
    if (providerProcess.stop) {
      await providerProcess.stop();
      return;
    }
    await this.terminateProviderProcess({
      providerProcess,
      timeoutMs: args.timeoutMs,
    });
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    const shutdownPromises: Promise<void>[] = [];

    for (const [processKey, providerProcess] of this.processes) {
      shutdownPromises.push(
        providerProcess.stop
          ? providerProcess.stop()
          : new Promise<void>((resolve) => {
              const timer = setTimeout(() => {
                providerProcess.child.kill("SIGKILL");
                resolve();
              }, 5000);

              providerProcess.child.on("exit", () => {
                clearTimeout(timer);
                resolve();
              });

              providerProcess.child.kill("SIGTERM");
            }),
      );
      providerProcess.connection.rejectPendingRequests(
        new Error("Runtime shutting down"),
      );
      this.args.onProviderIdentityWaitersInterrupted(providerProcess);

      for (const threadId of providerProcess.identity.threadIds) {
        this.args.onProviderThreadDetached(threadId, providerProcess);
      }
      this.processes.delete(processKey);
    }

    await Promise.all(shutdownPromises);
    await this.canonicalSupervisor.shutdown();
  }

  private async startCanonicalProvider(
    args: EnsureRuntimeProviderArgs,
  ): Promise<void> {
    const providerId = args.providerId;
    if (
      providerId !== PI_PROVIDER_ID &&
      providerId !== CLAUDE_CODE_PROVIDER_ID &&
      providerId !== CODEX_PROVIDER_ID &&
      !isAcpProviderId(providerId)
    ) {
      throw new Error(`Unsupported provider "${providerId}"`);
    }
    const acpProfile = args.acpLaunchSpec;
    if (isAcpProviderId(providerId) && acpProfile === undefined) {
      throw new Error(`ACP provider "${providerId}" requires a launch spec`);
    }
    const driverIdentity = isAcpProviderId(providerId)
      ? ACP_DRIVER_ID
      : providerId;
    const processArgs = resolveCanonicalDriverProcessArgs({
      bridgeBundleDir: this.args.bridgeBundleDir,
      providerId,
    });
    let diagnosticsTail: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let providerProcess: RuntimeProviderProcess | null = null;
    let supervised: SupervisedProviderDriver;
    try {
      supervised = await this.canonicalSupervisor.launch({
        processKey: args.processKey,
        initialize: {
          supportedProtocolVersions: [PROVIDER_DRIVER_PROTOCOL_VERSION],
          expected: {
            pluginId: driverIdentity,
            driverId: driverIdentity,
            providerId: driverIdentity,
            artifactDigest: driverArtifactDigest(processArgs),
          },
          host: {
            platform: process.platform,
            architecture: process.arch,
          },
          paths: {
            providerDataDir: join(
              homedir(),
              ".bb",
              "provider-data",
              providerId,
            ),
          },
          config: acpProfile ?? {},
        },
        launch: {
          command: this.args.bridgeNodeExecutablePath ?? process.execPath,
          args: processArgs,
          cwd: this.args.workspacePath,
          env: {
            ...this.args.env,
            ...this.args.bridgeNodeEnv,
          },
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
    } catch (error) {
      const detail = formatProviderStderr(diagnosticsTail);
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}${detail ? `\nstderr: ${detail}` : ""}`,
        { cause: error },
      );
    }

    const providerInfo = isAcpProviderId(providerId)
      ? buildAcpProviderInfo({
          id: providerId,
          displayName: acpProfile?.displayName ?? providerId,
          logoUrl: null,
        })
      : getBuiltInAgentProviderInfo(
          providerId === PI_PROVIDER_ID
            ? PI_PROVIDER_ID
            : providerId === CODEX_PROVIDER_ID
              ? CODEX_PROVIDER_ID
              : CLAUDE_CODE_PROVIDER_ID,
        );
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
            classifyExecutionSettingsChange:
              classifyClaudeExecutionSettingsChange,
            normalizeExecutionOptions: normalizeClaudeExecutionOptions,
          }
        : {
            classifyExecutionSettingsChange:
              classifySessionExecutionSettingsChange,
          }),
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
      stderrLineTail: Buffer.alloc(0),
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

  private getTestAdapter(
    providerId: string,
    acpLaunchSpec: HostDaemonAcpLaunchSpec | undefined,
  ): ProviderAdapter {
    const adapterOptions = {
      additionalWorkspaceWriteRoots: this.args.additionalWorkspaceWriteRoots,
      ...(acpLaunchSpec !== undefined ? { acpLaunchSpec } : {}),
      bridgeBundleDir: this.args.bridgeBundleDir,
      ...(this.args.bridgeNodeEnv !== undefined
        ? { bridgeNodeEnv: this.args.bridgeNodeEnv }
        : {}),
      ...(this.args.bridgeNodeExecutablePath !== undefined
        ? { bridgeNodeExecutablePath: this.args.bridgeNodeExecutablePath }
        : {}),
      turnIdPrefix: createAdapterTurnIdPrefix(),
    };

    if (!this.args.adapterFactory) {
      throw new Error("Test adapter factory is not configured");
    }
    return this.args.adapterFactory(providerId, adapterOptions);
  }

  private spawnProvider(args: SpawnProviderArgs): RuntimeProviderProcess {
    const processConfig = args.adapter.process;
    const env: NodeJS.ProcessEnv = {
      ...sanitizeInheritedChildProcessEnv({ env: process.env }),
      ...this.args.env,
      ...processConfig.env,
    };

    const child = spawnPortablePipedProcess({
      command: processConfig.command,
      args: processConfig.args,
      cwd: this.args.workspacePath,
      env,
    });

    const providerProcess: RuntimeProviderProcess = {
      child,
      connection: new LegacyAdapterConnection({
        adapter: args.adapter,
        child,
        getNextRequestId: this.args.getNextRequestId,
      }),
      expectedShutdownExpectations: 0,
      identity: this.args.createProviderIdentityState(args.providerId),
      interactiveRequestScope: randomUUID(),
      processKey: args.processKey,
      providerId: args.providerId,
      stderrLineTail: Buffer.alloc(0),
      stderrTail: Buffer.alloc(0),
    };

    providerProcess.connection.onEvent((events) => {
      if (this.shuttingDown) return;
      this.args.handleConnectionEvents({ events, providerProcess });
    });

    const stdout = createInterface({ input: child.stdout });
    stdout.on("line", (line) => {
      if (this.shuttingDown) {
        return;
      }
      this.args.handleStdoutLine({
        line,
        providerProcess,
      });
    });

    child.stderr.on("data", (chunk: Buffer) => {
      if (this.shuttingDown) {
        return;
      }
      consumeProviderStderrChunk({
        chunk,
        onLine: this.args.onStderr,
        providerProcess,
      });
    });
    child.stderr.on("end", () => {
      if (this.shuttingDown || providerProcess.stderrLineTail.length === 0) {
        return;
      }
      this.args.onStderr?.(decodeStderrLine(providerProcess.stderrLineTail));
      providerProcess.stderrLineTail = Buffer.alloc(0);
    });

    child.on("error", (err) => {
      this.handleProviderProcessError({
        err,
        providerId: args.providerId,
        providerProcess,
      });
    });
    child.on("exit", (code, signal) => {
      this.handleProviderProcessExit({
        code: code ?? null,
        providerId: args.providerId,
        providerProcess,
        signal: signal ?? null,
      });
    });

    this.processes.set(args.processKey, providerProcess);
    return providerProcess;
  }

  private async cleanupFailedStartup(
    args: CleanupFailedStartupArgs,
  ): Promise<void> {
    if (this.processes.get(args.processKey) !== args.providerProcess) {
      return;
    }

    this.processes.delete(args.processKey);
    args.providerProcess.expectedShutdownExpectations += 1;
    args.providerProcess.connection.rejectPendingRequests(args.startupError);
    this.args.onProviderIdentityWaitersInterrupted(args.providerProcess);

    if (args.providerProcess.stop) {
      await args.providerProcess.stop();
      return;
    }
    await this.terminateProviderProcess({
      providerProcess: args.providerProcess,
    });
  }

  private async terminateProviderProcess(
    args: TerminateProviderProcessArgs,
  ): Promise<void> {
    if (hasChildProcessExited(args.providerProcess.child)) {
      return;
    }

    await new Promise<void>((resolve) => {
      const timeoutMs = args.timeoutMs ?? 5000;
      const softTimer = setTimeout(() => {
        if (!hasChildProcessExited(args.providerProcess.child)) {
          args.providerProcess.child.kill("SIGKILL");
        }
      }, timeoutMs);
      const hardTimer = setTimeout(resolve, timeoutMs + 1000);

      args.providerProcess.child.once("exit", () => {
        clearTimeout(softTimer);
        clearTimeout(hardTimer);
        resolve();
      });

      args.providerProcess.child.kill("SIGTERM");
    });
  }

  private handleProviderProcessError(args: ProviderProcessErrorArgs): void {
    if (this.shuttingDown) return;
    if (!this.isCurrentProviderProcess(args)) return;
    const expected = consumeExpectedProviderProcessShutdown(
      args.providerProcess,
    );
    this.processes.delete(args.providerProcess.processKey);
    const message = args.err.message;
    args.providerProcess.connection.rejectPendingRequests(
      new Error(`Provider "${args.providerId}" failed to start: ${message}`),
    );
    this.args.onProviderIdentityWaitersInterrupted(args.providerProcess);

    this.args.onProcessExit?.({
      providerId: args.providerId,
      threads: [...args.providerProcess.identity.threadIds].map((threadId) =>
        this.args.captureThreadExitState(threadId),
      ),
      code: null,
      expected,
      signal: null,
      stderr: null,
    });
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
      this.args.onProviderThreadDetached(threadId, args.providerProcess);
    }
    args.providerProcess.connection.rejectPendingRequests(
      new ProviderProcessExitedError({
        providerId: args.providerId,
        status: { code: args.code, signal: args.signal },
        stderrTail: args.providerProcess.stderrTail,
      }),
    );
    this.args.onProviderIdentityWaitersInterrupted(args.providerProcess);

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

function decodeStderrLine(line: Buffer): string {
  const end = line.at(-1) === 0x0d ? line.length - 1 : line.length;
  return line.toString("utf8", 0, end);
}

function consumeProviderStderrChunk(args: {
  chunk: Buffer;
  onLine: AgentRuntimeOptions["onStderr"];
  providerProcess: RuntimeProviderProcess;
}): void {
  args.providerProcess.stderrTail = appendBoundedStderrBytes(
    args.providerProcess.stderrTail,
    args.chunk,
  );

  let offset = 0;
  let newline = args.chunk.indexOf(0x0a, offset);
  while (newline !== -1) {
    args.providerProcess.stderrLineTail = appendBoundedStderrBytes(
      args.providerProcess.stderrLineTail,
      args.chunk.subarray(offset, newline),
    );
    args.onLine?.(decodeStderrLine(args.providerProcess.stderrLineTail));
    args.providerProcess.stderrLineTail = Buffer.alloc(0);
    offset = newline + 1;
    newline = args.chunk.indexOf(0x0a, offset);
  }

  if (offset < args.chunk.length) {
    args.providerProcess.stderrLineTail = appendBoundedStderrBytes(
      args.providerProcess.stderrLineTail,
      args.chunk.subarray(offset),
    );
  }
}

function consumeExpectedProviderProcessShutdown(
  providerProcess: RuntimeProviderProcess,
): boolean {
  // One process exit consumes all outstanding explicit shutdown requests.
  const expected = providerProcess.expectedShutdownExpectations > 0;
  providerProcess.expectedShutdownExpectations = 0;
  return expected;
}

interface ProviderProcessErrorArgs {
  err: Error;
  providerId: string;
  providerProcess: RuntimeProviderProcess;
}

interface ProviderProcessExitArgs {
  code: number | null;
  providerId: string;
  providerProcess: RuntimeProviderProcess;
  signal: string | null;
}
