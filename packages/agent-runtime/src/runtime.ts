import { createHash } from "node:crypto";
import path from "node:path";
import {
  isApprovalPendingInteractionResolution,
  isUserQuestionPendingInteractionResolution,
  normalizeProviderThreadNameEvent,
  toProviderExternalThreadName,
} from "@bb/domain";
import type { DynamicTool, InstructionMode, ThreadEvent } from "@bb/domain";
import type {
  HostDaemonAcpLaunchSpec,
  HostDaemonProviderDriverLaunchSpec,
} from "@bb/host-daemon-contract";
import type {
  ProviderDriverConnection,
  ProviderDriverSessionOpenArgs,
} from "./provider-driver/connection.js";
import { getBundledProviderDriverLaunchSpec } from "./provider-driver/bundled-launch-specs.js";
import {
  assertProviderSupportsExecutionOptions,
  toProviderExecutionContext,
} from "./execution-options.js";
import {
  RuntimeProviderProcessManager,
  type RuntimeProviderProcess,
  type RuntimeProviderProcessManagerArgs,
} from "./runtime-provider-process.js";
import {
  filterSkillRootsForProvider,
  normalizeSkillRoots,
} from "./runtime-skill-roots.js";
import {
  RuntimeThreadIdentityRegistry,
  stampThreadEventScope,
} from "./runtime-thread-identity.js";
import { RuntimeThreadGoalState } from "./runtime-thread-goal-state.js";
import { RuntimeTurnReplayFilter } from "./runtime-turn-replay-filter.js";
import { RuntimeBackgroundWorkState } from "./runtime-background-work-state.js";
import { RuntimeTurnState } from "./runtime-turn-state.js";
import type {
  AgentRuntime,
  AgentRuntimeExecutionOptions,
  AgentRuntimeOptions,
  ReapedIdleProviderSession,
  AgentRuntimeSkillRoot,
} from "./types.js";
import { buildThreadShellEnvironment } from "./thread-shell-environment.js";
import { fingerprintAcpLaunchSpec } from "./acp-launch-spec-fingerprint.js";

interface ReconfigureThreadIfNeededArgs {
  options: AgentRuntimeExecutionOptions;
  threadId: string;
}

interface RunThreadOperationArgs<TResult> {
  threadId: string;
  work: () => Promise<TResult>;
}

function normalizeExecutionOptions(args: {
  connection: ProviderDriverConnection;
  options: AgentRuntimeExecutionOptions;
}): AgentRuntimeExecutionOptions {
  return args.connection.normalizeExecutionOptions(args.options);
}

interface PreparedThreadRewind {
  state: "prepared";
  cleanupPromise: Promise<void> | null;
  cleanupTimer: ReturnType<typeof setTimeout> | null;
  processKey: string;
  providerId: string;
  providerState: RuntimeProviderProcess["identity"];
  providerThreadId: string;
  stagingThreadId: string;
  threadId: string;
}

interface PreparingThreadRewind {
  state: "preparing";
  promise: Promise<{ providerThreadId: string }>;
}

/**
 * A staged rewind fork, keyed by the server-minted per-attempt lease id.
 * Each attempt owns exactly one staged fork; there is no cross-attempt
 * sharing, so discarding a lease can never affect another attempt.
 */
type StagedThreadRewind = PreparingThreadRewind | PreparedThreadRewind;

interface ReapIdleProviderSessionCandidate {
  idleSinceMs: number;
  providerThreadId: string;
  threadId: string;
  runtimeConfig: ThreadRuntimeConfig;
}

interface FindReapableIdleProviderSessionArgs {
  idleForMs: number;
  nowMs: number;
  threadId: string;
}

interface ResolveProviderProcessKeyArgs {
  acpLaunchSpec?: HostDaemonAcpLaunchSpec;
  providerDriver?: HostDaemonProviderDriverLaunchSpec;
  providerId: string;
  threadId?: string;
}

interface RequireProviderProcessArgs {
  processKey: string;
  providerId: string;
}

interface ArchiveOrUnarchiveThreadArgs {
  commandType: "thread/archive" | "thread/unarchive";
  providerDriver?: HostDaemonProviderDriverLaunchSpec;
  providerId: string;
  providerThreadId: string;
  threadId: string;
}

interface AgentRuntimeInternalOptions extends AgentRuntimeOptions {
  canonicalProviderDriverFactory?: RuntimeProviderProcessManagerArgs["canonicalProviderDriverFactory"];
}

interface ResolveThreadStoragePathArgs {
  options: AgentRuntimeInternalOptions;
  threadId: string;
}

function defaultBridgeNodeEnv(): Record<string, string> | undefined {
  if (process.versions.electron === undefined) {
    return undefined;
  }
  return { ELECTRON_RUN_AS_NODE: "1" };
}

// ---------------------------------------------------------------------------
// Runtime implementation
// ---------------------------------------------------------------------------

type ProviderProcess = RuntimeProviderProcess;

const THREAD_GOAL_CLEAR_EVENT_TIMEOUT_MS = 5_000;
const PREPARED_THREAD_REWIND_TTL_MS = 5 * 60_000;
const PREPARED_THREAD_REWIND_RETRY_MS = 30_000;

interface ThreadRuntimeConfig {
  dynamicTools?: DynamicTool[];
  disallowedTools?: readonly string[];
  environmentId: string;
  instructionMode: InstructionMode;
  /**
   * The instructions the live provider session was constructed with. Frozen
   * until the next session construction (start, resume, fork).
   */
  instructions?: string;
  options: AgentRuntimeExecutionOptions;
  processKey: string;
  projectId?: string;
  providerId: string;
  skillRoots: readonly AgentRuntimeSkillRoot[];
  workspacePath: string;
}

interface EmitTranslatedEventsArgs {
  events: ThreadEvent[];
  proc: ProviderProcess;
  sourceThreadId?: string;
}

const THREAD_PROCESS_KEY_SEPARATOR = "\0thread:";
const THREAD_CREATION_REQUEST_TIMEOUT_MS = 2 * 60_000;
function resolveThreadStoragePath(
  args: ResolveThreadStoragePathArgs,
): string | undefined {
  const rootPath = args.options.threadStorageRootPath;
  if (!rootPath) {
    return undefined;
  }
  return path.join(rootPath, args.threadId);
}

/**
 * Coordinates provider processes for an environment and bridges provider
 * JSON-RPC traffic into bb thread events, dynamic tool calls, and pending
 * interactions.
 */
export function createAgentRuntime(options: AgentRuntimeOptions): AgentRuntime {
  return createAgentRuntimeInternal(options);
}

export function createAgentRuntimeWithCanonicalProviderDriverFactory(
  options: AgentRuntimeOptions,
  canonicalProviderDriverFactory: NonNullable<
    RuntimeProviderProcessManagerArgs["canonicalProviderDriverFactory"]
  >,
): AgentRuntime {
  return createAgentRuntimeInternal({
    ...options,
    canonicalProviderDriverFactory,
  });
}

function createAgentRuntimeInternal(
  options: AgentRuntimeInternalOptions,
): AgentRuntime {
  const additionalWorkspaceWriteRoots =
    options.additionalWorkspaceWriteRoots ?? [];
  const skillRoots = normalizeSkillRoots({
    skillRoots: options.skillRoots,
  });
  const threadIdentityRegistry = new RuntimeThreadIdentityRegistry();
  const threadRuntimeConfigs = new Map<string, ThreadRuntimeConfig>();
  const idleProviderSessionSinceMsByThreadId = new Map<string, number>();
  const pendingTurnStartThreadIds = new Set<string>();
  const threadOperationCounts = new Map<string, number>();
  const stagedThreadRewinds = new Map<string, StagedThreadRewind>();
  const suppressedThreadEventIds = new Set<string>();
  const threadGoalState = new RuntimeThreadGoalState();
  const turnState = new RuntimeTurnState();
  const backgroundWorkState = new RuntimeBackgroundWorkState();
  const turnReplayFilter = new RuntimeTurnReplayFilter();
  const bridgeNodeEnv = options.bridgeNodeEnv ?? defaultBridgeNodeEnv();

  const providerProcesses = new RuntimeProviderProcessManager({
    additionalWorkspaceWriteRoots,
    canonicalProviderDriverFactory: options.canonicalProviderDriverFactory,
    bridgeBundleDir: options.bridgeBundleDir,
    ...(bridgeNodeEnv !== undefined ? { bridgeNodeEnv } : {}),
    bridgeNodeExecutablePath:
      options.bridgeNodeExecutablePath ?? process.execPath,
    captureThreadExitState: (threadId) => ({
      activeTurnId: turnState.getActiveTurnId(threadId),
      providerThreadId:
        threadIdentityRegistry.getProviderThreadId(threadId) ?? null,
      threadId,
    }),
    createProviderIdentityState: (providerId) =>
      threadIdentityRegistry.createProviderState({ providerId }),
    env: options.env,
    handleCanonicalInteraction: async (args) => {
      const attachment = args.providerProcess.connection.resolveAttachment(
        args.params.attachmentId,
      );
      if (!attachment) {
        throw new Error(
          `Cannot resolve canonical attachment ${args.params.attachmentId}`,
        );
      }
      const activeTurnId = turnState.getActiveTurnId(attachment.bbThreadId);
      if (activeTurnId !== args.params.turnId) {
        throw new Error(
          `Canonical interaction turn ${args.params.turnId} does not match runtime turn ${activeTurnId ?? "none"}`,
        );
      }
      if (!options.onInteractiveRequest) {
        if (
          args.params.payload.kind === "approval" &&
          args.params.payload.availableDecisions.includes("deny")
        ) {
          return { resolution: { decision: "deny" } };
        }
        throw new Error("No runtime interaction handler is configured");
      }
      const resolution = await options.onInteractiveRequest({
        threadId: attachment.bbThreadId,
        turnId: args.params.turnId,
        providerId: args.providerProcess.providerId,
        providerThreadId: attachment.providerSessionId,
        providerRequestId: `${args.providerProcess.interactiveRequestScope}:${args.params.requestId}`,
        payload: args.params.payload,
      });
      if (
        !isApprovalPendingInteractionResolution(resolution) &&
        !isUserQuestionPendingInteractionResolution(resolution)
      ) {
        throw new Error(
          "Canonical provider interaction returned an incompatible plugin resolution",
        );
      }
      return { resolution };
    },
    handleCanonicalToolCall: async (args) => {
      const attachment = args.providerProcess.connection.resolveAttachment(
        args.params.attachmentId,
      );
      if (!attachment) {
        throw new Error(
          `Cannot resolve canonical attachment ${args.params.attachmentId}`,
        );
      }
      const activeTurnId = turnState.getActiveTurnId(attachment.bbThreadId);
      if (activeTurnId !== args.params.turnId) {
        throw new Error(
          `Canonical tool call turn ${args.params.turnId} does not match runtime turn ${activeTurnId ?? "none"}`,
        );
      }
      if (!options.onToolCall) {
        throw new Error("No runtime tool call handler is configured");
      }
      const response = await options.onToolCall({
        requestId: args.params.callId,
        threadId: attachment.bbThreadId,
        providerThreadId: attachment.providerSessionId,
        turnId: args.params.turnId,
        callId: args.params.callId,
        tool: args.params.tool,
        arguments: args.params.arguments,
      });
      return {
        success: response.success,
        content: response.contentItems.map((item) =>
          item.type === "inputText"
            ? { type: "text" as const, text: item.text }
            : { type: "image" as const, imageUrl: item.imageUrl },
        ),
      };
    },
    handleConnectionEvents: (args) =>
      emitTranslatedEvents({
        events: args.events,
        proc: args.providerProcess,
      }),
    onProcessExit: options.onProcessExit,
    onProviderThreadDetached: (threadId) => {
      threadIdentityRegistry.clearThread(threadId);
      clearThreadRuntimeConfig(threadId);
      turnState.clearThread(threadId);
      backgroundWorkState.clearThread(threadId);
      turnReplayFilter.clearThread(threadId);
    },
    onStderr: options.onStderr,
    resolveProviderDriverLaunch: options.resolveProviderDriverLaunch,
    resolveThreadStoragePath: (threadId) => {
      const resolved = resolveThreadStoragePath({ options, threadId });
      if (!resolved) {
        throw new Error(
          `Canonical provider thread ${threadId} requires thread storage`,
        );
      }
      return resolved;
    },
    skillRoots,
    workspacePath: options.workspacePath,
  });

  function resolveProviderProcessKey(
    args: ResolveProviderProcessKeyArgs,
  ): string {
    const driverSpec = getBundledProviderDriverLaunchSpec(args.providerId);
    const processScope =
      args.providerDriver?.process.scope ?? driverSpec?.processPolicy.scope;
    const providerGenerationKey =
      args.providerDriver === undefined
        ? args.providerId
        : `${args.providerId}#driver:${createHash("sha256")
            .update(
              JSON.stringify({
                artifactDigest: args.providerDriver.artifact.digest,
                config: args.providerDriver.config,
                process: args.providerDriver.process,
              }),
            )
            .digest("hex")}`;
    const baseKey =
      processScope !== "thread" || args.threadId === undefined
        ? providerGenerationKey
        : `${providerGenerationKey}${THREAD_PROCESS_KEY_SEPARATOR}${args.threadId}`;
    if (args.acpLaunchSpec === undefined) {
      return baseKey;
    }
    return `${baseKey}#acp:${fingerprintAcpLaunchSpec(args.acpLaunchSpec)}`;
  }

  function requireProviderProcess(
    args: RequireProviderProcessArgs,
  ): ProviderProcess {
    return providerProcesses.requireProviderProcess(args);
  }

  function requireProviderProcessForThread(threadId: string): ProviderProcess {
    const providerId = resolveProviderForThread(threadId);
    const processKey =
      threadRuntimeConfigs.get(threadId)?.processKey ??
      resolveProviderProcessKey({ providerId });
    return requireProviderProcess({ processKey, providerId });
  }

  function isThreadScopedProviderProcess(proc: ProviderProcess): boolean {
    return proc.processKey.startsWith(
      `${proc.providerId}${THREAD_PROCESS_KEY_SEPARATOR}`,
    );
  }

  async function shutdownThreadScopedProviderProcessIfIdle(
    proc: ProviderProcess,
  ): Promise<void> {
    if (
      !isThreadScopedProviderProcess(proc) ||
      proc.identity.threadIds.size > 0
    ) {
      return;
    }
    await providerProcesses.shutdownProvider({
      processKey: proc.processKey,
      providerId: proc.providerId,
    });
  }

  function resolveProviderForThread(threadId: string): string {
    return threadIdentityRegistry.resolveProviderForThread(threadId);
  }

  function skillRootsForProvider(
    providerId: string,
  ): readonly AgentRuntimeSkillRoot[] {
    return filterSkillRootsForProvider({
      providerId,
      skillRoots,
    });
  }

  function setThreadRuntimeConfig(
    threadId: string,
    config: ThreadRuntimeConfig,
  ): void {
    threadRuntimeConfigs.set(threadId, config);
  }

  function clearThreadRuntimeConfig(threadId: string): void {
    idleProviderSessionSinceMsByThreadId.delete(threadId);
    pendingTurnStartThreadIds.delete(threadId);
    threadGoalState.clearThread(threadId);
    threadRuntimeConfigs.delete(threadId);
  }

  function beginThreadOperation(threadId: string): void {
    threadOperationCounts.set(
      threadId,
      (threadOperationCounts.get(threadId) ?? 0) + 1,
    );
  }

  function finishThreadOperation(threadId: string): void {
    const current = threadOperationCounts.get(threadId);
    if (current === undefined || current <= 1) {
      threadOperationCounts.delete(threadId);
      return;
    }
    threadOperationCounts.set(threadId, current - 1);
  }

  function threadHasInFlightOperation(threadId: string): boolean {
    return threadOperationCounts.has(threadId);
  }

  async function runThreadOperation<TResult>(
    args: RunThreadOperationArgs<TResult>,
  ): Promise<TResult> {
    beginThreadOperation(args.threadId);
    try {
      return await args.work();
    } finally {
      finishThreadOperation(args.threadId);
    }
  }

  function recordProviderThreadIdentity(
    threadId: string,
    providerThreadId: string,
  ): void {
    threadIdentityRegistry.recordProviderThreadIdentity({
      threadId,
      providerThreadId,
    });
  }

  /**
   * Removes one thread's runtime state while its provider process keeps
   * running: identity, execution config, turn state (resolving pending
   * active-turn waiters with `null`), and replay-filter state.
   */
  function forgetThreadRuntimeState(
    proc: ProviderProcess,
    threadId: string,
  ): void {
    forgetThreadRuntimeStateForProviderState(proc.identity, threadId);
  }

  function forgetThreadRuntimeStateForProviderState(
    providerState: RuntimeProviderProcess["identity"],
    threadId: string,
  ): void {
    threadIdentityRegistry.forgetThread({
      providerState,
      threadId,
    });
    clearThreadRuntimeConfig(threadId);
    turnState.clearThread(threadId);
    backgroundWorkState.clearThread(threadId);
    turnReplayFilter.clearThread(threadId);
  }

  function markProviderSessionNotIdle(threadId: string): void {
    idleProviderSessionSinceMsByThreadId.delete(threadId);
  }

  function markHostedProviderSessionIdle(threadId: string): void {
    if (
      threadIdentityRegistry.getProviderSession(threadId) === null ||
      turnState.getActiveTurnId(threadId) !== null ||
      pendingTurnStartThreadIds.has(threadId)
    ) {
      return;
    }
    if (!idleProviderSessionSinceMsByThreadId.has(threadId)) {
      idleProviderSessionSinceMsByThreadId.set(threadId, Date.now());
    }
  }

  function observeProviderSessionIdleState(event: ThreadEvent): void {
    if (event.type === "turn/started") {
      pendingTurnStartThreadIds.delete(event.threadId);
      markProviderSessionNotIdle(event.threadId);
      return;
    }

    if (event.type === "turn/completed") {
      pendingTurnStartThreadIds.delete(event.threadId);
      markHostedProviderSessionIdle(event.threadId);
      return;
    }

    if (event.type === "provider/error" && event.willRetry !== true) {
      pendingTurnStartThreadIds.delete(event.threadId);
      markHostedProviderSessionIdle(event.threadId);
    }
  }

  function findReapableIdleProviderSession(
    args: FindReapableIdleProviderSessionArgs,
  ): ReapIdleProviderSessionCandidate | null {
    if (
      threadHasInFlightOperation(args.threadId) ||
      pendingTurnStartThreadIds.has(args.threadId) ||
      turnState.getActiveTurnId(args.threadId) !== null
    ) {
      return null;
    }

    const runtimeConfig = threadRuntimeConfigs.get(args.threadId);
    if (
      !runtimeConfig ||
      !runtimeConfig.processKey.startsWith(
        `${runtimeConfig.providerId}${THREAD_PROCESS_KEY_SEPARATOR}`,
      )
    ) {
      return null;
    }

    const providerThreadId = threadIdentityRegistry.getProviderThreadId(
      args.threadId,
    );
    if (!providerThreadId) {
      return null;
    }

    const idleSinceMs = idleProviderSessionSinceMsByThreadId.get(args.threadId);
    if (idleSinceMs === undefined) {
      return null;
    }

    if (args.nowMs - idleSinceMs < args.idleForMs) {
      return null;
    }

    return {
      idleSinceMs,
      providerThreadId,
      runtimeConfig,
      threadId: args.threadId,
    };
  }

  function requireProviderThreadId(threadId: string): string {
    const providerThreadId =
      threadIdentityRegistry.getProviderThreadId(threadId);
    if (!providerThreadId) {
      throw new Error(`No provider thread id available for ${threadId}`);
    }
    return providerThreadId;
  }

  async function archiveOrUnarchiveThread(
    args: ArchiveOrUnarchiveThreadArgs,
  ): Promise<void> {
    const {
      commandType,
      providerDriver,
      providerId,
      providerThreadId,
      threadId,
    } = args;
    const processKey =
      threadRuntimeConfigs.get(threadId)?.processKey ??
      resolveProviderProcessKey({
        ...(providerDriver !== undefined ? { providerDriver } : {}),
        providerId,
        threadId,
      });
    await providerProcesses.ensureProvider({
      processKey,
      providerId,
      ...(providerDriver !== undefined ? { providerDriver } : {}),
    });
    const proc = requireProviderProcess({ processKey, providerId });
    if (!proc.connection.capabilities.supportsArchive) {
      throw new Error(
        `Provider "${providerId}" does not support thread archive.`,
      );
    }

    const events = await proc.connection.setSessionArchived({
      archived: commandType === "thread/archive",
      bbThreadId: threadId,
      providerSessionId: providerThreadId,
    });
    emitTranslatedEvents({ events, proc, sourceThreadId: threadId });
    if (commandType === "thread/archive") {
      // An archived thread is no longer live in the runtime; the next turn
      // must resume it (after unarchive) instead of reusing stale state.
      forgetThreadRuntimeState(proc, threadId);
    }
    await shutdownThreadScopedProviderProcessIfIdle(proc);
  }

  async function reconfigureThreadIfNeeded(
    args: ReconfigureThreadIfNeededArgs,
  ): Promise<void> {
    const currentConfig = threadRuntimeConfigs.get(args.threadId);
    if (!currentConfig) {
      return;
    }

    const nextOptions = args.options;

    // Instructions are frozen for the life of a provider session: drifted
    // instructions (memory catalog, AGENTS.md edits, plugin dynamic
    // instructions) must never force a thread/resume, because a resume can
    // replace the live CLI session and kill its running background tasks.
    // Fresh instructions apply when the next session is constructed.
    const proc = requireProviderProcess({
      processKey: currentConfig.processKey,
      providerId: currentConfig.providerId,
    });
    const settingsChange = proc.connection.classifyExecutionSettingsChange({
      current: currentConfig.options,
      next: nextOptions,
    });
    if (settingsChange !== "session") {
      // Live settings ride on the next turn command; record them without
      // replacing the session (which would kill its background tasks).
      setThreadRuntimeConfig(args.threadId, {
        ...currentConfig,
        options: nextOptions,
      });
      return;
    }

    const providerSkillRoots = currentConfig.skillRoots;
    const envVars = buildThreadShellEnvironment({
      baseShellEnv: options.shellEnv,
      environmentId: currentConfig.environmentId,
      projectId: currentConfig.projectId,
      threadStoragePath: resolveThreadStoragePath({
        options,
        threadId: args.threadId,
      }),
      threadId: args.threadId,
    });

    const currentProviderSessionId = requireProviderThreadId(args.threadId);
    const openArgs: ProviderDriverSessionOpenArgs = {
      bbThreadId: args.threadId,
      cwd: currentConfig.workspacePath,
      mode: {
        kind: "resume",
        providerSessionId: currentProviderSessionId,
      },
      execution: toProviderExecutionContext({
        envVars,
        execOpts: nextOptions,
        instructions: currentConfig.instructions,
        skillRoots: providerSkillRoots,
      }),
      dynamicTools: currentConfig.dynamicTools,
      disallowedTools: currentConfig.disallowedTools,
      instructionMode: currentConfig.instructionMode,
    };
    const result = await proc.connection.openSession(openArgs);
    recordProviderThreadIdentity(args.threadId, result.providerSessionId);
    emitTranslatedEvents({
      events: result.events,
      proc,
      sourceThreadId: args.threadId,
    });

    setThreadRuntimeConfig(args.threadId, {
      ...currentConfig,
      options: nextOptions,
    });
  }

  function emitTranslatedEvents(args: EmitTranslatedEventsArgs): void {
    for (const event of args.events) {
      const resolvedBbThreadId =
        threadIdentityRegistry.resolveProviderEventThreadId({
          eventThreadId: event.threadId,
          providerState: args.proc.identity,
          sourceThreadId: args.sourceThreadId,
        });

      const targetThreadIds = resolvedBbThreadId ? [resolvedBbThreadId] : [];

      if (targetThreadIds.length === 0) {
        options.onStderr?.(
          `Dropping unscoped provider event ${event.type}; no bb thread could be resolved`,
        );
        continue;
      }

      for (const targetThreadId of targetThreadIds) {
        if (suppressedThreadEventIds.has(targetThreadId)) {
          continue;
        }
        const stampedEvent = stampThreadEventScope({
          event,
          providerThreadId:
            threadIdentityRegistry.getProviderThreadId(targetThreadId),
          threadId: targetThreadId,
        });

        const replayResult = turnReplayFilter.observe(stampedEvent);
        if (replayResult.kind === "drop-replayed-turn-start") {
          options.onStderr?.(
            `Dropping replayed turn/started on already completed turn "${replayResult.turnId}" in thread "${replayResult.threadId}".`,
          );
          continue;
        }

        const normalizedEvent = normalizeProviderThreadNameEvent(
          replayResult.event,
        );
        turnState.observe(normalizedEvent);
        backgroundWorkState.observe(normalizedEvent);
        observeProviderSessionIdleState(normalizedEvent);
        options.onEvent(normalizedEvent);
        threadGoalState.observe(normalizedEvent);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  function schedulePreparedThreadRewindCleanup(
    leaseId: string,
    prepared: PreparedThreadRewind,
    delayMs: number,
  ): void {
    if (prepared.cleanupTimer !== null) {
      clearTimeout(prepared.cleanupTimer);
    }
    prepared.cleanupTimer = setTimeout(() => {
      void discardStagedThreadRewind(leaseId);
    }, delayMs);
    prepared.cleanupTimer.unref?.();
  }

  function finishPreparedThreadRewindCleanup(
    leaseId: string,
    prepared: PreparedThreadRewind,
  ): void {
    if (prepared.cleanupTimer !== null) {
      clearTimeout(prepared.cleanupTimer);
      prepared.cleanupTimer = null;
    }
    if (stagedThreadRewinds.get(leaseId) === prepared) {
      stagedThreadRewinds.delete(leaseId);
    }
    suppressedThreadEventIds.delete(prepared.stagingThreadId);
  }

  async function sendStagedThreadDiscard(
    proc: ProviderProcess,
    stagingThreadId: string,
    providerThreadId: string,
  ): Promise<void> {
    await proc.connection.discardSession({
      bbThreadId: stagingThreadId,
      providerSessionId: providerThreadId,
    });
  }

  async function discardStagedThreadRewind(leaseId: string): Promise<void> {
    const staged = stagedThreadRewinds.get(leaseId);
    if (staged?.state === "preparing") {
      try {
        await staged.promise;
      } catch {
        return;
      }
    }
    const prepared = stagedThreadRewinds.get(leaseId);
    if (prepared === undefined || prepared.state !== "prepared") {
      return;
    }
    if (prepared.cleanupPromise !== null) {
      await prepared.cleanupPromise;
      return;
    }

    const cleanup = (async () => {
      let proc: ProviderProcess;
      try {
        proc = requireProviderProcess({
          processKey: prepared.processKey,
          providerId: prepared.providerId,
        });
      } catch {
        forgetThreadRuntimeStateForProviderState(
          prepared.providerState,
          prepared.stagingThreadId,
        );
        finishPreparedThreadRewindCleanup(leaseId, prepared);
        return;
      }

      try {
        await sendStagedThreadDiscard(
          proc,
          prepared.stagingThreadId,
          prepared.providerThreadId,
        );
      } catch (error) {
        schedulePreparedThreadRewindCleanup(
          leaseId,
          prepared,
          PREPARED_THREAD_REWIND_RETRY_MS,
        );
        options.onStderr?.(
          `Failed to discard staged rewind ${leaseId}; retrying: ${error instanceof Error ? error.message : String(error)}`,
        );
        return;
      }

      forgetThreadRuntimeState(proc, prepared.stagingThreadId);
      finishPreparedThreadRewindCleanup(leaseId, prepared);
      try {
        await shutdownThreadScopedProviderProcessIfIdle(proc);
      } catch (error) {
        options.onStderr?.(
          `Failed to stop the idle provider after discarding staged rewind ${leaseId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    })();
    prepared.cleanupPromise = cleanup;
    try {
      await cleanup;
    } finally {
      if (
        stagedThreadRewinds.get(leaseId) === prepared &&
        prepared.cleanupPromise === cleanup
      ) {
        prepared.cleanupPromise = null;
      }
    }
  }

  const runtime: AgentRuntime = {
    async ensureProvider({
      providerId,
      forThreadId,
      acpLaunchSpec,
      providerDriver,
    }) {
      await providerProcesses.ensureProvider({
        processKey: resolveProviderProcessKey({
          ...(acpLaunchSpec !== undefined ? { acpLaunchSpec } : {}),
          ...(providerDriver !== undefined ? { providerDriver } : {}),
          providerId,
          ...(forThreadId !== undefined ? { threadId: forThreadId } : {}),
        }),
        providerId,
        ...(acpLaunchSpec !== undefined ? { acpLaunchSpec } : {}),
        ...(providerDriver !== undefined ? { providerDriver } : {}),
      });
    },

    async startThread({
      environmentId,
      threadId,
      projectId,
      providerId,
      acpLaunchSpec,
      providerDriver,
      clientRequestId,
      input,
      inputGroups,
      options: execOpts,
      instructions,
      dynamicTools,
      disallowedTools,
      instructionMode = "append",
      outputSchema,
      fork,
    }) {
      return runThreadOperation({
        threadId,
        work: async () => {
          const processKey = resolveProviderProcessKey({
            ...(acpLaunchSpec !== undefined ? { acpLaunchSpec } : {}),
            ...(providerDriver !== undefined ? { providerDriver } : {}),
            providerId,
            threadId,
          });
          await runtime.ensureProvider({
            providerId,
            forThreadId: threadId,
            ...(acpLaunchSpec !== undefined ? { acpLaunchSpec } : {}),
            ...(providerDriver !== undefined ? { providerDriver } : {}),
          });

          const proc = requireProviderProcess({ processKey, providerId });
          const effectiveExecOpts = normalizeExecutionOptions({
            connection: proc.connection,
            options: execOpts,
          });
          const providerSkillRoots = skillRootsForProvider(providerId);
          assertProviderSupportsExecutionOptions({
            capabilities: proc.connection.capabilities,
            options: effectiveExecOpts,
            providerId,
          });
          threadIdentityRegistry.registerThreadProvider({
            providerId,
            providerState: proc.identity,
            threadId,
          });
          setThreadRuntimeConfig(threadId, {
            dynamicTools,
            disallowedTools,
            environmentId,
            instructionMode,
            instructions,
            options: effectiveExecOpts,
            processKey,
            projectId,
            providerId,
            skillRoots: providerSkillRoots,
            workspacePath: options.workspacePath,
          });

          const envVars = buildThreadShellEnvironment({
            baseShellEnv: options.shellEnv,
            environmentId,
            projectId,
            threadStoragePath: resolveThreadStoragePath({
              options,
              threadId,
            }),
            threadId,
          });

          const providerExecutionContext = toProviderExecutionContext({
            envVars,
            execOpts: effectiveExecOpts,
            instructions,
            skillRoots: providerSkillRoots,
          });
          const openArgs: ProviderDriverSessionOpenArgs = {
            bbThreadId: threadId,
            cwd: options.workspacePath,
            mode: fork
              ? {
                  kind: "fork",
                  sourceProviderSessionId: fork.sourceProviderThreadId,
                }
              : { kind: "start" },
            execution: providerExecutionContext,
            dynamicTools,
            disallowedTools,
            instructionMode,
            ...(outputSchema !== undefined ? { outputSchema } : {}),
          };
          const result = await proc.connection.openSession(openArgs, {
            timeoutMs: THREAD_CREATION_REQUEST_TIMEOUT_MS,
          });
          recordProviderThreadIdentity(threadId, result.providerSessionId);
          emitTranslatedEvents({
            events: result.events,
            proc,
            sourceThreadId: threadId,
          });

          if (input && input.length > 0) {
            if (clientRequestId === undefined) {
              throw new Error(
                `Thread start with input requires a client request id for ${threadId}`,
              );
            }
            await runtime.runTurn({
              threadId,
              input,
              ...(inputGroups !== undefined ? { inputGroups } : {}),
              clientRequestId,
              options: effectiveExecOpts,
              instructions,
            });
          }

          markHostedProviderSessionIdle(threadId);
          return { providerThreadId: result.providerSessionId };
        },
      });
    },

    async prepareThreadRewind({
      environmentId,
      threadId,
      leaseId,
      projectId,
      providerId,
      sourceProviderThreadId,
      retainThroughProviderCheckpoint,
      acpLaunchSpec,
      providerDriver,
      options: execOpts,
      instructions,
      dynamicTools,
      disallowedTools,
      instructionMode = "append",
    }) {
      const existing = stagedThreadRewinds.get(leaseId);
      if (existing !== undefined) {
        // The server mints a fresh lease per attempt, so a duplicate can only
        // be a replay of this exact request; return the same staged fork.
        return existing.state === "preparing"
          ? existing.promise
          : { providerThreadId: existing.providerThreadId };
      }

      const preparation = runThreadOperation({
        threadId,
        work: async () => {
          const processKey = resolveProviderProcessKey({
            ...(acpLaunchSpec !== undefined ? { acpLaunchSpec } : {}),
            ...(providerDriver !== undefined ? { providerDriver } : {}),
            providerId,
            threadId,
          });
          await runtime.ensureProvider({
            providerId,
            forThreadId: threadId,
            ...(acpLaunchSpec !== undefined ? { acpLaunchSpec } : {}),
            ...(providerDriver !== undefined ? { providerDriver } : {}),
          });
          const proc = requireProviderProcess({ processKey, providerId });
          if (!proc.connection.capabilities.supportsFork) {
            throw new Error(
              `Preparing a thread rewind is not supported by ${providerId}`,
            );
          }
          const providerSkillRoots = skillRootsForProvider(providerId);
          assertProviderSupportsExecutionOptions({
            capabilities: proc.connection.capabilities,
            options: execOpts,
            providerId,
          });

          // The lease id is a server-minted UUID, so it is safe inside
          // identities that provider drivers may turn into filesystem keys.
          const stagingThreadId = `${threadId}:rewind:${leaseId}`;
          suppressedThreadEventIds.add(stagingThreadId);
          threadIdentityRegistry.registerThreadProvider({
            providerId,
            providerState: proc.identity,
            threadId: stagingThreadId,
          });
          let retainedForDiscard = false;
          let providerThreadIdForCleanup: string | undefined;
          try {
            const envVars = buildThreadShellEnvironment({
              baseShellEnv: options.shellEnv,
              environmentId,
              projectId,
              threadStoragePath: resolveThreadStoragePath({
                options,
                threadId,
              }),
              threadId,
            });
            const result = await proc.connection.openSession(
              {
                bbThreadId: stagingThreadId,
                cwd: options.workspacePath,
                mode: {
                  kind: "fork",
                  sourceProviderSessionId: sourceProviderThreadId,
                  sourceProviderCheckpointId: retainThroughProviderCheckpoint,
                },
                execution: toProviderExecutionContext({
                  envVars,
                  execOpts,
                  instructions,
                  skillRoots: providerSkillRoots,
                }),
                dynamicTools,
                disallowedTools,
                instructionMode,
              },
              { timeoutMs: THREAD_CREATION_REQUEST_TIMEOUT_MS },
            );
            providerThreadIdForCleanup = result.providerSessionIdForCleanup;
            const providerThreadId = result.providerSessionId;
            recordProviderThreadIdentity(stagingThreadId, providerThreadId);
            const prepared: PreparedThreadRewind = {
              state: "prepared",
              cleanupPromise: null,
              cleanupTimer: null,
              processKey,
              providerId,
              providerState: proc.identity,
              providerThreadId,
              stagingThreadId,
              threadId,
            };
            stagedThreadRewinds.set(leaseId, prepared);
            schedulePreparedThreadRewindCleanup(
              leaseId,
              prepared,
              PREPARED_THREAD_REWIND_TTL_MS,
            );
            retainedForDiscard = true;
            return { providerThreadId };
          } finally {
            if (!retainedForDiscard) {
              if (providerThreadIdForCleanup !== undefined) {
                try {
                  await sendStagedThreadDiscard(
                    proc,
                    stagingThreadId,
                    providerThreadIdForCleanup,
                  );
                } catch (error) {
                  options.onStderr?.(
                    `Failed to discard unretained staged rewind ${leaseId}: ${error instanceof Error ? error.message : String(error)}`,
                  );
                }
              }
              suppressedThreadEventIds.delete(stagingThreadId);
              threadIdentityRegistry.forgetThread({
                providerState: proc.identity,
                threadId: stagingThreadId,
              });
            }
          }
        },
      });
      stagedThreadRewinds.set(leaseId, {
        state: "preparing",
        promise: preparation,
      });
      try {
        return await preparation;
      } catch (error) {
        const current = stagedThreadRewinds.get(leaseId);
        if (current?.state === "preparing" && current.promise === preparation) {
          stagedThreadRewinds.delete(leaseId);
        }
        throw error;
      }
    },

    async discardThreadRewind({ leaseId }) {
      await discardStagedThreadRewind(leaseId);
    },

    async resumeThread({
      environmentId,
      threadId,
      projectId,
      providerThreadId,
      providerId,
      acpLaunchSpec,
      providerDriver,
      options: execOpts,
      instructions,
      dynamicTools,
      disallowedTools,
      instructionMode = "append",
    }) {
      return runThreadOperation({
        threadId,
        work: async () => {
          const processKey = resolveProviderProcessKey({
            ...(acpLaunchSpec !== undefined ? { acpLaunchSpec } : {}),
            ...(providerDriver !== undefined ? { providerDriver } : {}),
            providerId,
            threadId,
          });
          await runtime.ensureProvider({
            providerId,
            forThreadId: threadId,
            ...(acpLaunchSpec !== undefined ? { acpLaunchSpec } : {}),
            ...(providerDriver !== undefined ? { providerDriver } : {}),
          });

          const proc = requireProviderProcess({ processKey, providerId });
          const effectiveExecOpts = normalizeExecutionOptions({
            connection: proc.connection,
            options: execOpts,
          });
          const providerSkillRoots = skillRootsForProvider(providerId);
          assertProviderSupportsExecutionOptions({
            capabilities: proc.connection.capabilities,
            options: effectiveExecOpts,
            providerId,
          });
          threadIdentityRegistry.registerThreadProvider({
            providerId,
            providerState: proc.identity,
            threadId,
          });
          setThreadRuntimeConfig(threadId, {
            dynamicTools,
            disallowedTools,
            environmentId,
            instructionMode,
            instructions,
            options: effectiveExecOpts,
            processKey,
            projectId,
            providerId,
            skillRoots: providerSkillRoots,
            workspacePath: options.workspacePath,
          });

          if (providerThreadId) {
            recordProviderThreadIdentity(threadId, providerThreadId);
          }

          const envVars = buildThreadShellEnvironment({
            baseShellEnv: options.shellEnv,
            environmentId,
            projectId,
            threadStoragePath: resolveThreadStoragePath({
              options,
              threadId,
            }),
            threadId,
          });

          const currentProviderSessionId =
            providerThreadId ?? requireProviderThreadId(threadId);
          const openArgs: ProviderDriverSessionOpenArgs = {
            bbThreadId: threadId,
            cwd: options.workspacePath,
            mode: {
              kind: "resume",
              providerSessionId: currentProviderSessionId,
            },
            execution: toProviderExecutionContext({
              envVars,
              execOpts: effectiveExecOpts,
              instructions,
              skillRoots: providerSkillRoots,
            }),
            dynamicTools,
            disallowedTools,
            instructionMode,
          };
          const result = await proc.connection.openSession(openArgs);
          recordProviderThreadIdentity(threadId, result.providerSessionId);
          emitTranslatedEvents({
            events: result.events,
            proc,
            sourceThreadId: threadId,
          });

          markHostedProviderSessionIdle(threadId);
          return { providerThreadId: result.providerSessionId };
        },
      });
    },

    async runTurn({
      threadId,
      input,
      inputGroups,
      clientRequestId,
      options: execOpts,
      instructions,
    }) {
      return runThreadOperation({
        threadId,
        work: async () => {
          const pid = resolveProviderForThread(threadId);
          const proc = requireProviderProcessForThread(threadId);
          const effectiveExecOpts = normalizeExecutionOptions({
            connection: proc.connection,
            options: execOpts,
          });
          assertProviderSupportsExecutionOptions({
            capabilities: proc.connection.capabilities,
            options: effectiveExecOpts,
            providerId: pid,
          });
          await reconfigureThreadIfNeeded({
            threadId,
            options: effectiveExecOpts,
          });

          const providerSessionId = requireProviderThreadId(threadId);
          pendingTurnStartThreadIds.add(threadId);
          markProviderSessionNotIdle(threadId);
          let submission: Awaited<
            ReturnType<ProviderDriverConnection["submitTurn"]>
          >;
          try {
            submission = await proc.connection.submitTurn({
              bbThreadId: threadId,
              providerSessionId,
              mode: { kind: "start" },
              input,
              ...(inputGroups !== undefined ? { inputGroups } : {}),
              clientRequestId,
              execution: toProviderExecutionContext({
                envVars: {},
                execOpts: effectiveExecOpts,
                instructions,
              }),
            });
          } catch (error) {
            pendingTurnStartThreadIds.delete(threadId);
            markHostedProviderSessionIdle(threadId);
            throw error;
          }
          if (submission.disposition !== "accepted") {
            pendingTurnStartThreadIds.delete(threadId);
            markHostedProviderSessionIdle(threadId);
            throw new Error(
              `Provider "${pid}" returned a stale result for a new turn on thread "${threadId}"`,
            );
          }
          emitTranslatedEvents({
            events: submission.events,
            proc,
            sourceThreadId: threadId,
          });
        },
      });
    },

    async steerTurn({
      threadId,
      expectedTurnId,
      input,
      inputGroups,
      clientRequestId,
      options: execOpts,
      instructions,
    }) {
      return runThreadOperation({
        threadId,
        work: async () => {
          const pid = resolveProviderForThread(threadId);
          const currentProc = requireProviderProcessForThread(threadId);
          const effectiveExecOpts = normalizeExecutionOptions({
            connection: currentProc.connection,
            options: execOpts,
          });
          assertProviderSupportsExecutionOptions({
            capabilities: currentProc.connection.capabilities,
            options: effectiveExecOpts,
            providerId: pid,
          });

          const activeTurnId = turnState.getActiveTurnId(threadId);
          if (activeTurnId !== expectedTurnId) {
            options.onStderr?.(
              `Ignoring stale steer for thread "${threadId}" on turn "${expectedTurnId}"; active turn is ${activeTurnId ?? "none"}.`,
            );
            return {
              status: "stale",
              activeTurnId,
            };
          }

          const proc = currentProc;
          await reconfigureThreadIfNeeded({
            threadId,
            options: effectiveExecOpts,
          });

          const providerSessionId = requireProviderThreadId(threadId);
          const submission = await proc.connection.submitTurn({
            bbThreadId: threadId,
            providerSessionId,
            mode: { kind: "steer", expectedTurnId },
            input,
            ...(inputGroups !== undefined ? { inputGroups } : {}),
            clientRequestId,
            execution: toProviderExecutionContext({
              envVars: {},
              execOpts: effectiveExecOpts,
              instructions,
            }),
          });
          emitTranslatedEvents({
            events: submission.events,
            proc,
            sourceThreadId: threadId,
          });
          if (submission.disposition === "stale") {
            return {
              status: "stale",
              activeTurnId: submission.activeTurnId,
            };
          }
          return { status: "steered" };
        },
      });
    },

    async stopThread({ threadId }) {
      return runThreadOperation({
        threadId,
        work: async () => {
          const pid = resolveProviderForThread(threadId);
          const proc = requireProviderProcessForThread(threadId);
          const providerThreadId = requireProviderThreadId(threadId);
          const activeTurnId = turnState.getActiveTurnId(threadId);
          const result = await proc.connection.stopSession({
            bbThreadId: threadId,
            providerSessionId: providerThreadId,
            activeTurnId,
          });

          if (result.disposition === "unchanged" && activeTurnId) {
            throw new Error(
              `Adapter "${pid}" returned no provider request for thread/stop with active turn: ${result.noopReason ?? "unknown reason"}`,
            );
          }

          emitTranslatedEvents({
            events: result.events,
            proc,
            sourceThreadId: threadId,
          });
          forgetThreadRuntimeState(proc, threadId);
          await shutdownThreadScopedProviderProcessIfIdle(proc);
          return {
            providerCheckpointId: result.providerCheckpointId ?? null,
          };
        },
      });
    },

    async clearThreadGoal({ threadId }) {
      return runThreadOperation({
        threadId,
        work: async () => {
          const proc = requireProviderProcessForThread(threadId);
          const clearRevision = threadGoalState.getClearRevision(threadId);
          const result = await proc.connection.clearSessionGoal({
            bbThreadId: threadId,
            providerSessionId: requireProviderThreadId(threadId),
          });
          if (
            !result.cleared &&
            threadGoalState.getClearRevision(threadId) > clearRevision
          ) {
            return { cleared: true };
          }
          const confirmed = await threadGoalState.waitForGoalClear({
            afterRevision: clearRevision,
            threadId,
            timeoutMs: THREAD_GOAL_CLEAR_EVENT_TIMEOUT_MS,
          });
          return { cleared: confirmed };
        },
      });
    },

    async renameThread({ threadId, title }) {
      return runThreadOperation({
        threadId,
        work: async () => {
          const pid = resolveProviderForThread(threadId);
          const proc = requireProviderProcessForThread(threadId);
          if (!proc.connection.capabilities.supportsRename) {
            throw new Error(
              `Provider "${pid}" does not support thread rename.`,
            );
          }

          const events = await proc.connection.renameSession({
            bbThreadId: threadId,
            providerSessionId: requireProviderThreadId(threadId),
            title: toProviderExternalThreadName(title),
          });
          emitTranslatedEvents({ events, proc, sourceThreadId: threadId });
        },
      });
    },

    async archiveThread({
      threadId,
      providerId,
      providerThreadId,
      providerDriver,
    }) {
      return runThreadOperation({
        threadId,
        work: async () => {
          await archiveOrUnarchiveThread({
            commandType: "thread/archive",
            providerId,
            providerThreadId,
            threadId,
            ...(providerDriver !== undefined ? { providerDriver } : {}),
          });
        },
      });
    },

    async unarchiveThread({
      threadId,
      providerId,
      providerThreadId,
      providerDriver,
    }) {
      return runThreadOperation({
        threadId,
        work: async () => {
          await archiveOrUnarchiveThread({
            commandType: "thread/unarchive",
            providerId,
            providerThreadId,
            threadId,
            ...(providerDriver !== undefined ? { providerDriver } : {}),
          });
        },
      });
    },

    async listModels({ providerId, acpLaunchSpec, providerDriver, cwd }) {
      await runtime.ensureProvider({
        providerId,
        ...(acpLaunchSpec !== undefined ? { acpLaunchSpec } : {}),
        ...(providerDriver !== undefined ? { providerDriver } : {}),
      });
      const proc = requireProviderProcess({
        processKey: resolveProviderProcessKey({
          ...(acpLaunchSpec !== undefined ? { acpLaunchSpec } : {}),
          ...(providerDriver !== undefined ? { providerDriver } : {}),
          providerId,
        }),
        providerId,
      });
      return proc.connection.inspectModels({
        ...(cwd !== undefined ? { cwd } : {}),
      });
    },

    listRunningProviders() {
      return providerProcesses.listRunningProviders();
    },

    getActiveTurnId(threadId) {
      return turnState.getActiveTurnId(threadId);
    },

    waitForActiveTurn(threadId, args) {
      return turnState.waitForActiveTurn({
        threadId,
        timeoutMs: args.timeoutMs,
      });
    },

    getProviderSession(threadId) {
      return threadIdentityRegistry.getProviderSession(threadId);
    },

    async reapIdleProviderSessions({ idleForMs, nowMs }) {
      const reapedSessions: ReapedIdleProviderSession[] = [];
      for (const threadId of [...threadRuntimeConfigs.keys()]) {
        const candidate = findReapableIdleProviderSession({
          idleForMs,
          nowMs,
          threadId,
        });
        if (!candidate) {
          continue;
        }

        let proc: ProviderProcess;
        try {
          proc = requireProviderProcess({
            processKey: candidate.runtimeConfig.processKey,
            providerId: candidate.runtimeConfig.providerId,
          });
        } catch {
          continue;
        }
        if (!isThreadScopedProviderProcess(proc)) {
          continue;
        }

        forgetThreadRuntimeState(proc, candidate.threadId);
        await shutdownThreadScopedProviderProcessIfIdle(proc);
        reapedSessions.push({
          idleForMs: Math.max(0, nowMs - candidate.idleSinceMs),
          providerId: candidate.runtimeConfig.providerId,
          providerThreadId: candidate.providerThreadId,
          threadId: candidate.threadId,
        });
      }

      return { reapedSessions };
    },

    hasThread(threadId) {
      return threadIdentityRegistry.getProviderSession(threadId) !== null;
    },

    getLiveThreadIds() {
      return [
        ...new Set([
          ...turnState.getActiveThreadIds(),
          ...pendingTurnStartThreadIds,
        ]),
      ];
    },

    hasOpenBackgroundWork() {
      return backgroundWorkState.hasOpenWork();
    },

    async shutdown() {
      await Promise.all(
        [...stagedThreadRewinds.keys()].map((leaseId) =>
          discardStagedThreadRewind(leaseId),
        ),
      );
      idleProviderSessionSinceMsByThreadId.clear();
      pendingTurnStartThreadIds.clear();
      threadOperationCounts.clear();
      threadGoalState.clear();
      turnState.clear();
      backgroundWorkState.clear();
      turnReplayFilter.clear();
      await providerProcesses.shutdown();
    },
  };

  return runtime;
}
