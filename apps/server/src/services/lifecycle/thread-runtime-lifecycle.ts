/**
 * Thread runtime lifecycle (Phase 2 rewrite, plan §6 / Decision 11).
 *
 * Owns provision → start → turn → stop as in-memory tasks with explicit
 * ownership:
 *
 * - `Map<threadId, ThreadProvisionTask>` — the full provision context
 *   (request + stage state) lives in memory; the queue-era
 *   `thread_operations` rows, payload JSON schemas, and 10s re-drive sweeps
 *   are gone. The pipeline runs as one straight-line async function with
 *   AbortController cancellation checked at step boundaries (metadata → env
 *   create → env-provision await → handoff → start dispatch). Engine-side
 *   workspace work is aborted by dispatching `environment.provision.cancel`,
 *   exactly as before — the controller governs only this pipeline's awaits.
 * - `Map<threadId, ThreadStartTask>` — presence is the `still_starting`
 *   409 gate and blocks finalization while a start command is in flight.
 * - `Map<threadId, ThreadStopTask>` — presence dedupes stops and owns
 *   finalization; `stopRequestedAt` stays populated in the DB from the stop
 *   request until `finalizeStoppedThread` clears it (frozen wire field, plan
 *   §4.1), including the awaiting-host-cancel window where a provisioning
 *   thread stays `provisioning` until the environment cancel settles.
 *
 * Engine-command settlement is a straight-line continuation: tasks call
 * `engineDispatch.execute` (which keeps the in-flight registry truthful for
 * the cross-cutting product guards) and settle the typed result inline. The
 * command-result owners registry no longer carries thread lifecycle entries.
 *
 * Crash/restart behavior: a crash drops every task; boot reconciliation
 * (`boot-reconciliation.ts`) interrupts active threads with
 * `server-restarted`, fails provisioning threads, finalizes stop-requested
 * threads, and drains deleted ones. A `thread.stop` engine failure is no
 * longer re-driven by a sweep: in-process a failed stop means the runtime is
 * gone or wedged — log loudly, interrupt + finalize anyway.
 */
import { and, eq } from "drizzle-orm";
import {
  clearThreadStopRequested,
  createEnvironment,
  createPendingClientTurnRequestInTransaction,
  createThreadProvisioningId,
  deleteThread,
  events,
  findStoredClientTurnRequestSequenceByRequestId,
  getEnvironment,
  getThread,
  listThreadTurnInterruptionEventStates,
  markThreadStopRequested,
  settleClientTurnRequestInTransaction,
  settlePendingClientTurnRequestsForThreadsInTransaction,
  transitionThreadStatusInTransaction,
  updateThread,
  type CreateEnvironmentInput,
  type DbQueryConnection,
  type DbTransaction,
} from "@bb/db";
import { assertNever } from "@bb/core-ui";
import {
  threadScope,
  turnScope,
  type ClientTurnRequestId,
  type ClientTurnRequestTerminalReason,
  type Environment,
  type PromptInput,
  type ProvisioningTranscriptEntry,
  type ResolvedThreadExecutionOptions,
  type SystemThreadInterruptedReason,
  type TerminalClientTurnRequestStatus,
  type Thread,
  type ThreadEventScope,
  type ThreadEventType,
  type ThreadProvisioningState,
  type ThreadStatus,
  type ThreadTurnInitiator,
  type TurnRequestTarget,
} from "@bb/domain";
import { setEnvironmentStatus } from "@bb/db/internal-environment-lifecycle";
import type { HostDaemonCommand } from "@bb/host-daemon-contract";
import type { UnmanagedBranchSpec } from "@bb/server-contract";
import { ApiError } from "../../errors.js";
import { LOCAL_HOST_ID } from "../hosts/local-host.js";
import {
  EngineDispatchBuffer,
  type ExecutedEngineCommand,
} from "../engine/engine-dispatch.js";
import { NotificationBuffer } from "../lib/notification-buffer.js";
import { runtimeErrorLogFields } from "../lib/error-log-fields.js";
import { throwThreadNotWritable } from "../lib/lifecycle-api-errors.js";
import { recordAcceptedPromptHistoryEntry } from "../prompt-history.js";
import {
  appendClientTurnEvent,
  appendSystemErrorEvent,
  appendSystemErrorEventInTransaction,
  appendThreadEventsInTransaction,
  appendThreadInterruptedEventInTransaction,
  appendThreadProvisioningEvent,
  appendThreadProvisioningEventInTransaction,
  buildCwdBranchEntries,
  getActiveTurnId,
  getLastProviderThreadId,
} from "../threads/thread-events.js";
import {
  addRequestIdToTurnSubmitCommandPayload,
  buildThreadStartCommand,
  buildThreadStopCommand,
  prepareTurnSubmitCommandPayload,
  queueArchivedThreadProviderArchiveCommand,
  queueThreadDeletedCommandInTransaction,
  queueThreadRenameCommand,
  queueTurnSubmitCommandInTransaction,
  type QueuedTurnSubmitCommandDispatch,
  type QueueThreadStartCommandArgs,
} from "../threads/thread-commands.js";
import {
  buildEnvironmentProvisionCommand,
  buildManagedBranchName,
  baseBranchSpecToStoredName,
  SETUP_TIMEOUT_MS,
  type UnmanagedCheckoutCommand,
} from "../threads/thread-create-helpers.js";
import {
  inferThreadMetadata,
  MANAGED_THREAD_METADATA_TIMEOUT_MAX_ATTEMPTS,
  MANAGED_THREAD_METADATA_TIMEOUT_MS,
} from "../threads/thread-metadata-inference.js";
import { queueManagedThreadTurnNotificationBestEffort } from "../threads/managed-thread-notifications.js";
import { deriveBranchSlugFromTitle } from "../threads/title-generation.js";
import { isPreStartThreadStatus } from "../threads/thread-status.js";
import {
  tryTransition,
  tryTransitionInTransaction,
} from "../threads/thread-transitions.js";
import {
  resolveManagedTargetPath,
  resolvePersonalTargetPath,
} from "../threads/worktree-paths.js";
import { resolvePermissionEscalation } from "../threads/thread-runtime-config.js";
import type { EnvironmentLifecycle } from "./environment-lifecycle.js";
import type {
  ThreadProvisionEnvironmentIntent,
  CheckoutUnmanagedEnvironmentIntent,
  DirectManagedEnvironmentIntent,
  DirectPersonalEnvironmentIntent,
  DirectUnmanagedEnvironmentIntent,
} from "./provision-intent.js";
import type {
  LifecycleServiceDeps,
  LifecycleTransactionContext,
} from "./shared.js";

type ThreadStartCommand = Awaited<ReturnType<typeof buildThreadStartCommand>>;
type TurnSubmitCommand = Extract<HostDaemonCommand, { type: "turn.submit" }>;
type EnvironmentProvisionCommand = Extract<
  HostDaemonCommand,
  { type: "environment.provision" }
>;

export interface PreparedThreadStartCommand {
  command: ThreadStartCommand;
  mode: "thread.start";
}

export interface PreparedReadyTurnSubmitCommand {
  command: TurnSubmitCommand;
  mode: "turn.submit";
}

export type PreparedReadyThreadTurnCommand =
  | PreparedThreadStartCommand
  | PreparedReadyTurnSubmitCommand;

export interface QueuedThreadStartDispatch {
  command: ThreadStartCommand;
  mode: "thread.start";
}

export type QueuedReadyThreadTurnDispatch =
  | QueuedThreadStartDispatch
  | QueuedTurnSubmitCommandDispatch;

export interface QueuePreparedReadyThreadTurnCommandInTransactionArgs {
  command: PreparedReadyThreadTurnCommand;
  requestEventSequence: number;
  thread: Thread;
}

export interface RequestThreadProvisionArgs {
  environmentIntent: ThreadProvisionEnvironmentIntent;
  execution: ResolvedThreadExecutionOptions;
  input: PromptInput[];
  thread: Thread;
  titleProvided: boolean;
}

export interface RequestThreadReprovisionArgs {
  environment: Environment;
  execution: ResolvedThreadExecutionOptions;
  initiator: ThreadTurnInitiator;
  input: PromptInput[];
  provisionEventSequence: number;
  provisioningId: string;
  senderThreadId: string | null;
  thread: Thread;
}

export interface ThreadProvisionHandle {
  /**
   * Resolves once the provision pipeline has attached (or created) the
   * environment row, or terminally failed — thread-create awaits this for
   * personal workspaces so the response carries `environmentId`.
   */
  environmentAttached: Promise<void>;
}

export interface RequestThreadStopArgs {
  environmentId: string;
  reason: SystemThreadInterruptedReason;
  stopRequestedAt: number | null;
  threadId: string;
}

export interface StopForCurrentStateThread {
  environmentId: string | null;
  id: string;
  status: ThreadStatus;
  stopRequestedAt: number | null;
}

export interface FinalizeStoppedThreadArgs {
  threadId: string;
}

export interface InterruptActiveThreadArgs {
  environmentId: string | null;
  threadId: string;
}

export interface InterruptActiveThreadsArgs {
  reason: SystemThreadInterruptedReason;
  threads: readonly InterruptActiveThreadArgs[];
}

export interface InterruptedActiveThreadResult {
  interruptedTurnId: string | null;
  threadId: string;
}

export interface InterruptActiveThreadsResult {
  threads: InterruptedActiveThreadResult[];
}

interface ThreadProvisionRequest {
  branchSlug: string | null;
  clientRequestId: ClientTurnRequestId;
  environmentIntent: ThreadProvisionEnvironmentIntent;
  execution: ResolvedThreadExecutionOptions;
  input: PromptInput[];
  titleProvided: boolean;
}

interface ThreadProvisionTask {
  cancelled: boolean;
  controller: AbortController;
  environmentAttached: Promise<void>;
  request: ThreadProvisionRequest;
  resolveEnvironmentAttached: () => void;
  state: ThreadProvisioningState;
}

interface ThreadStartTask {
  syncGeneratedTitle: boolean;
}

interface ThreadStopTask {
  reason: SystemThreadInterruptedReason;
}

interface ThreadFailureCommandReport {
  errorMessage: string;
  type: "thread.start" | "turn.submit";
}

interface ThreadProvisionEnvironmentPlan {
  buildCommand: (environment: Environment) => EnvironmentProvisionCommand;
  environmentInput: CreateEnvironmentInput;
}

interface FailProvisioningArgs {
  detail: string;
  environmentId: string | null;
  threadId: string;
}

interface PreStartStopResult {
  environmentId: string | null;
  finalized: boolean;
}

const INITIAL_PROVISIONING_TEXT_BY_WORKSPACE_TYPE = {
  unmanaged: "Preparing workspace",
  "managed-worktree": "Preparing worktree",
  personal: "Preparing personal workspace",
} satisfies Record<Environment["workspaceProvisionType"], string>;

function initialProvisioningEntries(
  environment: Pick<Environment, "workspaceProvisionType">,
): ProvisioningTranscriptEntry[] {
  return [
    {
      type: "step",
      key: "workspace-started",
      text: INITIAL_PROVISIONING_TEXT_BY_WORKSPACE_TYPE[
        environment.workspaceProvisionType
      ],
      status: "started",
    },
  ];
}

function buildProvisioningStoppedEntry(): ProvisioningTranscriptEntry {
  return {
    type: "step",
    key: "provisioning-stopped",
    text: "Provisioning stopped by user request",
    status: "completed",
    startedAt: Date.now(),
  };
}

function nextStatusForInterruptedThread(
  reason: SystemThreadInterruptedReason,
): Extract<ThreadStatus, "idle" | "error"> {
  switch (reason) {
    case "manual-stop":
    case "server-restarted":
      return "idle";
    case "provider-turn-idle":
      return "error";
    default:
      return assertNever(reason);
  }
}

function pendingInteractionStopReason(
  reason: SystemThreadInterruptedReason,
): string {
  switch (reason) {
    case "manual-stop":
      return "Thread stopped by user request";
    case "server-restarted":
      return "Server restarted while awaiting user interaction";
    case "provider-turn-idle":
      return "Thread stopped after the provider stopped sending progress";
    default:
      return assertNever(reason);
  }
}

interface InterruptedClientTurnRequestSettlement {
  message: string;
  reasonCode: ClientTurnRequestTerminalReason;
  status: TerminalClientTurnRequestStatus;
}

function clientTurnRequestSettlementForInterruption(
  reason: SystemThreadInterruptedReason,
): InterruptedClientTurnRequestSettlement {
  switch (reason) {
    case "manual-stop":
      return {
        message: "Thread stopped before provider accepted the request",
        reasonCode: "runtime_canceled",
        status: "canceled",
      };
    case "server-restarted":
      return {
        message: "Server restarted before provider accepted the request",
        reasonCode: "provider_restarted",
        status: "canceled",
      };
    case "provider-turn-idle":
      return {
        message:
          "Provider stopped sending progress before accepting the request",
        reasonCode: "provider_detached",
        status: "failed",
      };
    default:
      return assertNever(reason);
  }
}

function settleInterruptedClientTurnRequestsForThreadsInTransaction(
  db: DbTransaction,
  args: {
    reason: SystemThreadInterruptedReason;
    threadIds: readonly string[];
  },
): void {
  const settlement = clientTurnRequestSettlementForInterruption(args.reason);
  settlePendingClientTurnRequestsForThreadsInTransaction(db, {
    message: settlement.message,
    reasonCode: settlement.reasonCode,
    status: settlement.status,
    threadIds: args.threadIds,
  });
}

function settleSuccessfulClientTurnRequest(
  db: DbTransaction,
  args: { completedAt: number; requestId: string; threadId: string },
): void {
  // Command success is not provider-native acceptance, so keep
  // command_succeeded distinguishable until runtimes report exact outcomes.
  // Native provider acceptance wins when it arrives first; this pending-only
  // settlement then no-ops.
  settleClientTurnRequestInTransaction(db, {
    reasonCode: "command_succeeded",
    requestId: args.requestId,
    settledAt: args.completedAt,
    status: "accepted",
    threadId: args.threadId,
  });
}

function settleFailedClientTurnRequest(
  db: DbTransaction,
  args: {
    completedAt: number;
    errorMessage: string;
    requestId: string;
    threadId: string;
  },
): void {
  settleClientTurnRequestInTransaction(db, {
    message: args.errorMessage,
    reasonCode: "command_failed",
    requestId: args.requestId,
    settledAt: args.completedAt,
    status: "failed",
    threadId: args.threadId,
  });
}

function hasThreadInterruptedEvent(
  db: DbQueryConnection,
  threadId: string,
): boolean {
  const row = db
    .select({ id: events.id })
    .from(events)
    .where(
      and(
        eq(events.threadId, threadId),
        eq(events.type, "system/thread/interrupted"),
      ),
    )
    .limit(1)
    .get();
  return row !== undefined;
}

function getThreadFailureCommandErrorScope(
  command: ThreadStartCommand | TurnSubmitCommand,
): ThreadEventScope {
  if (command.type !== "turn.submit") {
    return threadScope();
  }
  return command.target.mode !== "start" && command.target.expectedTurnId
    ? turnScope(command.target.expectedTurnId)
    : threadScope();
}

function hasExpectedTurnCompletedEvent(
  db: DbQueryConnection,
  command: ThreadStartCommand | TurnSubmitCommand,
): boolean {
  if (command.type !== "turn.submit" || command.target.mode === "start") {
    return false;
  }
  const turnId = command.target.expectedTurnId;
  if (!turnId) {
    return false;
  }

  return (
    db
      .select({ id: events.id })
      .from(events)
      .where(
        and(
          eq(events.threadId, command.threadId),
          eq(events.turnId, turnId),
          eq(events.type, "turn/completed"),
        ),
      )
      .limit(1)
      .get() !== undefined
  );
}

export class ThreadRuntimeLifecycle {
  /** Threads whose provision was cancelled; the cancellation outcome wins over late provision results. Cleared on finalize. */
  private readonly cancelledProvisions = new Set<string>();
  private readonly provisionTasks = new Map<string, ThreadProvisionTask>();
  private readonly startTasks = new Map<string, ThreadStartTask>();
  private readonly stopTasks = new Map<string, ThreadStopTask>();

  constructor(
    private readonly deps: LifecycleServiceDeps,
    private readonly environmentLifecycle: EnvironmentLifecycle,
  ) {}

  // ---------------------------------------------------------------------
  // Provisioning
  // ---------------------------------------------------------------------

  /**
   * Appends the spawn request events (client/turn/requested + prompt history
   * + client/thread/start) and runs the provision pipeline as an owned task.
   */
  requestProvision(args: RequestThreadProvisionArgs): ThreadProvisionHandle {
    const initiator: ThreadTurnInitiator =
      args.thread.type === "manager" ? "system" : "user";
    const target: TurnRequestTarget = { kind: "thread-start" };
    const request = appendClientTurnEvent(this.deps, {
      threadId: args.thread.id,
      environmentId: args.thread.environmentId,
      type: "client/turn/requested",
      input: args.input,
      execution: args.execution,
      initiator,
      senderThreadId: null,
      requestMethod: "thread/start",
      source: "spawn",
      target,
    });
    recordAcceptedPromptHistoryEntry(this.deps, {
      thread: args.thread,
      input: args.input,
      initiator,
      target,
      requestSequence: request.sequence,
    });
    appendClientTurnEvent(this.deps, {
      threadId: args.thread.id,
      environmentId: args.thread.environmentId,
      type: "client/thread/start",
      initiator,
      requestMethod: "thread/start",
      source: "spawn",
    });

    const task = this.registerProvisionTask(args.thread.id, {
      request: {
        branchSlug: null,
        clientRequestId: request.requestId,
        environmentIntent: args.environmentIntent,
        execution: args.execution,
        input: args.input,
        titleProvided: args.titleProvided,
      },
      state: {
        environmentId: null,
        provisionEventSequence: null,
        provisioningId: createThreadProvisioningId(),
        stage: "metadata-pending",
        workspaceReadyEventSequence: null,
      },
    });
    void this.runProvisionPipeline(args.thread.id, task);
    return { environmentAttached: task.environmentAttached };
  }

  /**
   * A turn arrived while the managed environment's workspace path is missing
   * (thread-turn-dispatch). The caller already appended the restore
   * provisioning event and dispatched the environment reprovision; this owns
   * the request events and the start handoff once the workspace is back.
   */
  requestReprovision(args: RequestThreadReprovisionArgs): void {
    const request = appendClientTurnEvent(this.deps, {
      threadId: args.thread.id,
      environmentId: args.environment.id,
      type: "client/turn/requested",
      input: args.input,
      execution: args.execution,
      initiator: args.initiator,
      senderThreadId: args.senderThreadId,
      requestMethod: "turn/start",
      source: "tell",
      target: { kind: "new-turn" },
    });
    recordAcceptedPromptHistoryEntry(this.deps, {
      thread: args.thread,
      input: args.input,
      initiator: args.initiator,
      target: { kind: "new-turn" },
      requestSequence: request.sequence,
    });

    const task = this.registerProvisionTask(args.thread.id, {
      request: {
        branchSlug: null,
        clientRequestId: request.requestId,
        environmentIntent: {
          type: "reuse",
          environmentId: args.environment.id,
        },
        execution: args.execution,
        input: args.input,
        titleProvided: true,
      },
      state: {
        environmentId: args.environment.id,
        provisionEventSequence: args.provisionEventSequence,
        provisioningId: args.provisioningId,
        stage: "environment-provisioning",
        workspaceReadyEventSequence: null,
      },
    });
    void this.runProvisionPipeline(args.thread.id, task);
  }

  isProvisioning(threadId: string): boolean {
    return this.provisionTasks.has(threadId);
  }

  isStarting(threadId: string): boolean {
    return this.startTasks.has(threadId);
  }

  // ---------------------------------------------------------------------
  // Start / turn dispatch
  // ---------------------------------------------------------------------

  ensureThreadCanQueueStartRequest(thread: Thread): void {
    if (isPreStartThreadStatus(thread.status) && this.startTasks.has(thread.id)) {
      throwThreadNotWritable(
        thread,
        "still_starting",
        "Thread is still starting",
      );
    }
  }

  /** Provider session exists → turn.submit (mode start); else thread.start. */
  async prepareReadyThreadTurnCommand(
    args: QueueThreadStartCommandArgs,
  ): Promise<PreparedReadyThreadTurnCommand> {
    const providerThreadId = getLastProviderThreadId(this.deps, args.thread.id);
    if (providerThreadId) {
      const preparedCommand = await prepareTurnSubmitCommandPayload(this.deps, {
        environment: args.environment,
        execution: args.execution,
        input: args.input,
        permissionEscalation: args.permissionEscalation,
        providerThreadId,
        target: { mode: "start" },
        thread: args.thread,
      });
      return {
        command: addRequestIdToTurnSubmitCommandPayload({
          preparedCommand,
          requestId: args.requestId,
        }),
        mode: "turn.submit",
      };
    }

    return {
      command: await buildThreadStartCommand(this.deps, args),
      mode: "thread.start",
    };
  }

  /**
   * Writes the turn-request bookkeeping for one prepared ready-thread turn
   * inside the caller's transaction and returns the typed dispatch; the
   * caller hands it to `dispatchQueuedReadyThreadTurn` AFTER its transaction
   * commits (write-then-execute ordering).
   */
  queuePreparedReadyThreadTurnCommandInTransaction(
    tx: DbTransaction,
    args: QueuePreparedReadyThreadTurnCommandInTransactionArgs,
  ): QueuedReadyThreadTurnDispatch {
    if (args.command.mode === "turn.submit") {
      return queueTurnSubmitCommandInTransaction(tx, {
        command: args.command.command,
        requestEventSequence: args.requestEventSequence,
      });
    }

    if (this.startTasks.has(args.thread.id)) {
      throwThreadNotWritable(
        args.thread,
        "still_starting",
        "Thread is still starting",
      );
    }
    createPendingClientTurnRequestInTransaction(tx, {
      environmentId: args.command.command.environmentId,
      requestEventSequence: args.requestEventSequence,
      requestId: args.command.command.requestId,
      threadId: args.command.command.threadId,
    });
    return {
      command: args.command.command,
      mode: "thread.start",
    };
  }

  /**
   * Dispatches a queued ready-thread turn after the bookkeeping transaction
   * committed. thread.start dispatches register a start task (the
   * `still_starting` gate + finalize barrier); turn.submit dispatches settle
   * without one, matching the queue-era op semantics.
   */
  dispatchQueuedReadyThreadTurn(queued: QueuedReadyThreadTurnDispatch): void {
    if (queued.mode === "turn.submit") {
      this.dispatchTurnSubmit(queued);
      return;
    }

    this.startTasks.set(queued.command.threadId, {
      syncGeneratedTitle: false,
    });
    // Dispatch in the same synchronous frame: the in-flight registry (the
    // cross-cutting product guards) must register before anything can
    // interleave with the caller's post-commit flush.
    this.runStartSettlement(queued.command.threadId, queued.command).catch(
      (error) => {
        this.deps.logger.error(
          { err: error, threadId: queued.command.threadId },
          "Thread start settlement failed",
        );
      },
    );
  }

  /** Fire-and-forget turn.submit dispatch + inline settlement. */
  dispatchTurnSubmit(queued: QueuedTurnSubmitCommandDispatch): void {
    // Synchronous dispatch (see dispatchQueuedReadyThreadTurn).
    this.runTurnSubmitSettlement(queued).catch((error) => {
      this.deps.logger.error(
        { err: error, threadId: queued.command.threadId },
        "Turn submit settlement failed",
      );
    });
  }

  // ---------------------------------------------------------------------
  // Stop / finalize
  // ---------------------------------------------------------------------

  /**
   * Stops active runtime work: marks `stopRequestedAt` (FE pending-stop
   * marker), dispatches `thread.stop`, and finalizes on settlement. Idempotent
   * while a stop task is live (the first reason wins).
   */
  requestStop(args: RequestThreadStopArgs): void {
    if (args.stopRequestedAt === null) {
      markThreadStopRequested(this.deps.db, this.deps.hub, {
        threadId: args.threadId,
      });
    }

    if (this.stopTasks.has(args.threadId)) {
      return;
    }
    const task: ThreadStopTask = { reason: args.reason };
    this.stopTasks.set(args.threadId, task);
    // Synchronous dispatch: thread.stop must hit the in-flight registry in
    // this frame (it gates manager system messages and nudges).
    this.runStopTask(args, task).catch((error) => {
      this.deps.logger.error(
        {
          environmentId: args.environmentId,
          err: error,
          threadId: args.threadId,
        },
        "Thread stop settlement failed",
      );
    });
  }

  /**
   * Stop entrypoint that picks the right mechanism for the thread's current
   * state: a runtime stop for active/starting threads, provisioning
   * cancellation (with the "Provisioning stopped by user request" transcript)
   * for pre-start threads.
   */
  requestStopForCurrentState(
    thread: StopForCurrentStateThread,
    environment: { id: string } | null,
  ): void {
    if (thread.status === "active" || this.startTasks.has(thread.id)) {
      if (environment === null) {
        return;
      }
      this.requestStop({
        environmentId: environment.id,
        reason: "manual-stop",
        stopRequestedAt: thread.stopRequestedAt,
        threadId: thread.id,
      });
      return;
    }

    if (
      isPreStartThreadStatus(thread.status) ||
      this.provisionTasks.has(thread.id)
    ) {
      this.requestPreStartStop(thread.id);
    }
  }

  /**
   * Requests a runtime stop only for active work. Pre-start provisioning
   * cancellation goes through `requestStopForCurrentState`.
   */
  requestActiveRuntimeThreadStopIfNeeded(
    thread: Pick<Thread, "id" | "status" | "stopRequestedAt">,
    environment: { id: string },
  ): void {
    if (thread.status !== "active" && !this.startTasks.has(thread.id)) {
      return;
    }
    this.requestStop({
      environmentId: environment.id,
      reason: "manual-stop",
      stopRequestedAt: thread.stopRequestedAt,
      threadId: thread.id,
    });
  }

  finalizeStoppedThread(args: FinalizeStoppedThreadArgs): boolean {
    return this.finalizeStoppedThreadOwned(args.threadId, null);
  }

  async finalizeStoppedThreadAndAdvanceCleanup(
    args: FinalizeStoppedThreadArgs,
  ): Promise<boolean> {
    const threadBeforeFinalize = getThread(this.deps.db, args.threadId);
    const finalized = this.finalizeStoppedThread(args);
    if (!finalized) {
      return false;
    }

    const threadAfterFinalize = getThread(this.deps.db, args.threadId);
    const environmentId =
      threadAfterFinalize?.environmentId ??
      threadBeforeFinalize?.environmentId ??
      null;
    if (environmentId) {
      await this.environmentLifecycle.advanceCleanup({ environmentId });
    }
    return true;
  }

  finalizeStoppedThreadAndRequestCleanupAdvance(
    args: FinalizeStoppedThreadArgs,
  ): boolean {
    const threadBeforeFinalize = getThread(this.deps.db, args.threadId);
    const finalized = this.finalizeStoppedThread(args);
    if (!finalized) {
      return false;
    }

    const threadAfterFinalize = getThread(this.deps.db, args.threadId);
    const environmentId =
      threadAfterFinalize?.environmentId ??
      threadBeforeFinalize?.environmentId ??
      null;
    this.environmentLifecycle.requestCleanupAdvance({ environmentId });
    return true;
  }

  finalizeStoppedThreadInTransaction(
    context: LifecycleTransactionContext,
    args: FinalizeStoppedThreadArgs,
  ): boolean {
    return this.finalizeStoppedThreadInTransactionOwned(context, args.threadId, null);
  }

  /**
   * Forwards a provider-side archive once a thread has settled (not active,
   * no live start/stop task).
   */
  queueSettledArchivedThreadProviderArchiveCommand(args: {
    threadId: string;
  }): boolean {
    const thread = getThread(this.deps.db, args.threadId);
    if (!thread || thread.status === "active") {
      return false;
    }
    if (this.startTasks.has(thread.id) || this.stopTasks.has(thread.id)) {
      return false;
    }

    return queueArchivedThreadProviderArchiveCommand(this.deps, {
      threadId: thread.id,
    });
  }

  /**
   * Interrupts threads whose runtime no longer exists. Every supplied thread
   * gets a thread interruption event; threads with an open turn also get an
   * interrupted turn completion event. Used by boot reconciliation (reason
   * `server-restarted`).
   */
  interruptActiveThreads(
    args: InterruptActiveThreadsArgs,
  ): InterruptActiveThreadsResult {
    if (args.threads.length === 0) {
      return { threads: [] };
    }

    const results: InterruptedActiveThreadResult[] = [];
    const threadIds = args.threads.map((thread) => thread.threadId);
    const nextStatus = nextStatusForInterruptedThread(args.reason);

    this.deps.db.transaction(
      (tx) => {
        const stateByThreadId = new Map(
          listThreadTurnInterruptionEventStates(tx, { threadIds }).map(
            (state) => [state.threadId, state],
          ),
        );
        const eventArgs: Parameters<
          typeof appendThreadEventsInTransaction
        >[1][number][] = [];

        for (const thread of args.threads) {
          const state = stateByThreadId.get(thread.threadId);
          const activeTurnId = state?.activeTurnId ?? null;
          const providerThreadId = state?.latestProviderThreadId ?? null;

          if (activeTurnId !== null) {
            eventArgs.push({
              threadId: thread.threadId,
              environmentId: thread.environmentId,
              providerThreadId,
              type: "turn/completed",
              scope: turnScope(activeTurnId),
              data: {
                providerThreadId,
                status: "interrupted",
              },
            });
          }

          eventArgs.push({
            threadId: thread.threadId,
            type: "system/thread/interrupted",
            scope: threadScope(),
            data: {
              reason: args.reason,
            },
          });
          results.push({
            threadId: thread.threadId,
            interruptedTurnId: activeTurnId,
          });
        }

        appendThreadEventsInTransaction(tx, eventArgs);
        settleInterruptedClientTurnRequestsForThreadsInTransaction(tx, {
          reason: args.reason,
          threadIds,
        });

        for (const thread of args.threads) {
          transitionThreadStatusInTransaction(tx, {
            id: thread.threadId,
            newStatus: nextStatus,
          });
        }
      },
      { behavior: "immediate" },
    );

    this.deps.pendingInteractions.interruptPendingInteractionsForThreadIds({
      threadIds: results.map((result) => result.threadId),
      reason: pendingInteractionStopReason(args.reason),
    });

    for (const result of results) {
      const eventTypes: ThreadEventType[] = ["system/thread/interrupted"];
      if (result.interruptedTurnId !== null) {
        eventTypes.unshift("turn/completed");
      }
      this.deps.hub.notifyThread(
        result.threadId,
        ["events-appended", "status-changed"],
        {
          eventTypes,
        },
      );
    }

    return { threads: results };
  }

  // ---------------------------------------------------------------------
  // Environment lifecycle hooks (EnvironmentLifecycleThreadHooks)
  // ---------------------------------------------------------------------

  hasCancelledProvision(threadId: string): boolean {
    return (
      this.cancelledProvisions.has(threadId) ||
      this.provisionTasks.get(threadId)?.cancelled === true
    );
  }

  getLiveProvisionProvisioningId(threadId: string): string | null {
    const task = this.provisionTasks.get(threadId);
    if (!task || task.cancelled) {
      return null;
    }
    return task.state.provisioningId;
  }

  recordWorkspaceReadyInTransaction(
    context: LifecycleTransactionContext,
    args: {
      entries: ProvisioningTranscriptEntry[];
      environmentId: string;
      threadId: string;
    },
  ): void {
    const task = this.provisionTasks.get(args.threadId);
    if (!task || task.cancelled) {
      return;
    }
    if (task.state.workspaceReadyEventSequence !== null) {
      return;
    }
    const sequence = appendThreadProvisioningEventInTransaction(context.db, {
      threadId: args.threadId,
      environmentId: args.environmentId,
      provisioningId: task.state.provisioningId,
      status: "active",
      entries: args.entries,
    });
    task.state = {
      ...task.state,
      environmentId: args.environmentId,
      stage: "workspace-ready",
      workspaceReadyEventSequence: sequence,
    };
    context.hub.notifyThread(args.threadId, ["events-appended"], {
      eventTypes: ["system/thread-provisioning"],
    });
  }

  /** Aborts provision pipelines without running cancel flows (process exit). */
  shutdown(): void {
    for (const task of this.provisionTasks.values()) {
      task.controller.abort();
    }
    this.provisionTasks.clear();
    this.startTasks.clear();
    this.stopTasks.clear();
  }

  // ---------------------------------------------------------------------
  // Provision pipeline internals
  // ---------------------------------------------------------------------

  private registerProvisionTask(
    threadId: string,
    init: { request: ThreadProvisionRequest; state: ThreadProvisioningState },
  ): ThreadProvisionTask {
    const existing = this.provisionTasks.get(threadId);
    if (existing) {
      this.deps.logger.warn(
        { threadId },
        "Replacing a live thread provision task",
      );
      existing.cancelled = true;
      existing.controller.abort();
    }

    let resolveEnvironmentAttached = (): void => undefined;
    const environmentAttached = new Promise<void>((resolve) => {
      resolveEnvironmentAttached = resolve;
    });
    const task: ThreadProvisionTask = {
      cancelled: false,
      controller: new AbortController(),
      environmentAttached,
      request: init.request,
      resolveEnvironmentAttached,
      state: init.state,
    };
    this.provisionTasks.set(threadId, task);
    return task;
  }

  private async runProvisionPipeline(
    threadId: string,
    task: ThreadProvisionTask,
  ): Promise<void> {
    try {
      await this.advanceProvision(threadId, task);
    } catch (error) {
      if (!task.cancelled) {
        const detail = error instanceof Error ? error.message : String(error);
        this.failProvisioning({
          detail,
          environmentId: task.state.environmentId,
          threadId,
        });
      }
    } finally {
      task.resolveEnvironmentAttached();
      if (this.provisionTasks.get(threadId) === task) {
        this.provisionTasks.delete(threadId);
      }
    }
  }

  private async advanceProvision(
    threadId: string,
    task: ThreadProvisionTask,
  ): Promise<void> {
    const thread = getThread(this.deps.db, threadId);
    if (!thread || thread.deletedAt !== null) {
      return;
    }
    if (thread.status === "error") {
      return;
    }
    if (thread.archivedAt !== null || thread.stopRequestedAt !== null) {
      // Cancellation wins; the stop path owns the rest.
      return;
    }

    await this.resolveProvisionMetadataIfNeeded(thread, task);
    if (task.cancelled) {
      return;
    }

    const environment = await this.ensureProvisionEnvironmentReady(
      thread,
      task,
    );
    if (environment === null || task.cancelled) {
      return;
    }

    // Re-read state after the awaits: the world may have moved.
    const currentThread = getThread(this.deps.db, threadId);
    if (!currentThread || currentThread.deletedAt !== null) {
      return;
    }
    if (currentThread.status === "error") {
      // The environment failure settlement already appended the error events.
      return;
    }
    if (
      currentThread.archivedAt !== null ||
      currentThread.stopRequestedAt !== null
    ) {
      return;
    }

    const readyEnvironment =
      getEnvironment(this.deps.db, environment.id) ?? environment;
    if (readyEnvironment.status === "error") {
      this.failProvisioning({
        detail: "Environment provisioning failed",
        environmentId: readyEnvironment.id,
        threadId,
      });
      return;
    }
    if (readyEnvironment.status !== "ready") {
      this.failProvisioning({
        detail: `Environment is ${readyEnvironment.status}`,
        environmentId: readyEnvironment.id,
        threadId,
      });
      return;
    }
    const workspacePath = readyEnvironment.path;
    if (!workspacePath) {
      this.failProvisioning({
        detail: "Environment is ready without a workspace path",
        environmentId: readyEnvironment.id,
        threadId,
      });
      return;
    }

    this.ensureWorkspaceReadyEvent(task, {
      entries: buildCwdBranchEntries({
        path: workspacePath,
        branchName: readyEnvironment.branchName,
      }),
      environmentId: readyEnvironment.id,
      threadId,
    });
    if (task.cancelled) {
      return;
    }

    await this.handoffToStart(currentThread, readyEnvironment, workspacePath, task);
  }

  private failProvisioning(args: FailProvisioningArgs): void {
    appendSystemErrorEvent(this.deps, {
      threadId: args.threadId,
      environmentId: args.environmentId,
      code: "thread_provisioning_failed",
      message: "Provisioning thread failed",
      detail: args.detail,
      scope: threadScope(),
    });
    tryTransition(this.deps.db, this.deps.hub, args.threadId, "error");
  }

  private async resolveProvisionMetadataIfNeeded(
    thread: Thread,
    task: ThreadProvisionTask,
  ): Promise<void> {
    if (task.state.stage !== "metadata-pending") {
      return;
    }

    const needsBranch =
      task.request.environmentIntent.type === "direct-managed";
    if (!needsBranch) {
      if (!task.request.titleProvided) {
        void inferThreadMetadata(this.deps, {
          environmentId: null,
          generateBranchName: false,
          generateTitle: true,
          input: task.request.input,
          provisioningId: task.state.provisioningId,
          threadId: thread.id,
          writeTranscript: false,
        })
          .then((metadata) => {
            if (!metadata.titleApplied || !metadata.title) {
              return;
            }
            const titledThread = getThread(this.deps.db, thread.id);
            const environment = titledThread?.environmentId
              ? getEnvironment(this.deps.db, titledThread.environmentId)
              : null;
            if (
              !titledThread ||
              !environment ||
              titledThread.status !== "active"
            ) {
              return;
            }
            queueThreadRenameCommand(this.deps, {
              environment: {
                id: environment.id,
                hostId: environment.hostId,
              },
              providerId: titledThread.providerId,
              threadId: titledThread.id,
              title: metadata.title,
            });
          })
          .catch((error) => {
            this.deps.logger.warn(
              {
                threadId: thread.id,
                ...runtimeErrorLogFields(this.deps.config, error),
              },
              "Failed to generate thread title",
            );
          });
      }
      task.request.branchSlug = null;
      task.state = { ...task.state, stage: "environment-pending" };
      return;
    }

    if (task.request.titleProvided) {
      task.request.branchSlug = thread.title
        ? deriveBranchSlugFromTitle(thread.title)
        : null;
      task.state = { ...task.state, stage: "environment-pending" };
      return;
    }

    const metadata = await inferThreadMetadata(this.deps, {
      environmentId: null,
      generateBranchName: true,
      generateTitle: true,
      input: task.request.input,
      provisioningId: task.state.provisioningId,
      threadId: thread.id,
      timeoutMaxAttempts: MANAGED_THREAD_METADATA_TIMEOUT_MAX_ATTEMPTS,
      timeoutMs: MANAGED_THREAD_METADATA_TIMEOUT_MS,
      writeTranscript: false,
    });
    task.request.branchSlug = metadata.branchSlug;
    task.state = { ...task.state, stage: "environment-pending" };
  }

  private attachThreadToEnvironment(
    thread: Thread,
    environment: Environment,
    task: ThreadProvisionTask,
  ): void {
    if (thread.environmentId !== environment.id) {
      updateThread(this.deps.db, this.deps.hub, thread.id, {
        environmentId: environment.id,
      });
    }
    if (task.state.environmentId !== environment.id) {
      task.state = {
        ...task.state,
        environmentId: environment.id,
        stage:
          task.state.stage === "metadata-pending" ||
          task.state.stage === "environment-pending"
            ? "environment-attached"
            : task.state.stage,
      };
    }
    task.resolveEnvironmentAttached();
  }

  private appendProvisioningStartedEventIfNeeded(
    threadId: string,
    environment: Environment,
    task: ThreadProvisionTask,
  ): void {
    if (
      task.state.provisionEventSequence !== null ||
      task.state.workspaceReadyEventSequence !== null
    ) {
      return;
    }
    const sequence = appendThreadProvisioningEvent(this.deps, {
      threadId,
      environmentId: environment.id,
      provisioningId: task.state.provisioningId,
      status: "active",
      entries: initialProvisioningEntries(environment),
    });
    task.state = {
      ...task.state,
      environmentId: environment.id,
      provisionEventSequence: sequence,
      stage: "environment-provisioning",
    };
  }

  private async awaitActiveEnvironmentProvision(
    thread: Thread,
    environment: Environment,
    task: ThreadProvisionTask,
  ): Promise<Environment | null> {
    const done = this.environmentLifecycle.getActiveProvisionDone(
      environment.id,
    );
    if (!done) {
      this.failProvisioning({
        detail: "Environment is provisioning without an active provision operation",
        environmentId: environment.id,
        threadId: thread.id,
      });
      return null;
    }
    this.appendProvisioningStartedEventIfNeeded(thread.id, environment, task);
    await done;
    return getEnvironment(this.deps.db, environment.id) ?? environment;
  }

  private async ensureProvisionEnvironmentReady(
    thread: Thread,
    task: ThreadProvisionTask,
  ): Promise<Environment | null> {
    const intent = task.request.environmentIntent;
    switch (intent.type) {
      case "reuse": {
        const environment = getEnvironment(
          this.deps.db,
          task.state.environmentId ?? intent.environmentId,
        );
        if (!environment) {
          throw new ApiError(
            404,
            "environment_not_found",
            "Environment not found",
          );
        }
        this.attachThreadToEnvironment(thread, environment, task);
        if (environment.status === "provisioning") {
          return this.awaitActiveEnvironmentProvision(thread, environment, task);
        }
        return environment;
      }
      case "checkout-unmanaged":
        return this.ensureCheckoutUnmanagedEnvironment(thread, task, intent);
      case "direct-unmanaged":
      case "direct-managed":
      case "direct-personal":
        return this.ensureDirectEnvironment(thread, task, intent);
      default:
        return assertNever(intent);
    }
  }

  private buildUnmanagedCheckout(
    thread: Thread,
    task: ThreadProvisionTask,
    branch: UnmanagedBranchSpec,
  ): UnmanagedCheckoutCommand {
    if (branch.kind === "existing") {
      return {
        kind: "existing",
        name: branch.name,
      };
    }
    return {
      kind: "new",
      name: buildManagedBranchName({
        branchSlug: task.request.branchSlug,
        threadId: thread.id,
      }),
      baseBranch: branch.baseBranch,
    };
  }

  private async ensureCheckoutUnmanagedEnvironment(
    thread: Thread,
    task: ThreadProvisionTask,
    intent: CheckoutUnmanagedEnvironmentIntent,
  ): Promise<Environment | null> {
    const environment = getEnvironment(this.deps.db, intent.environmentId);
    if (!environment) {
      throw new ApiError(404, "environment_not_found", "Environment not found");
    }
    if (environment.projectId !== thread.projectId) {
      throw new ApiError(
        409,
        "invalid_request",
        "Environment belongs to a different project",
      );
    }
    if (environment.hostId !== intent.hostId) {
      throw new ApiError(
        409,
        "invalid_request",
        "Environment belongs to a different host",
      );
    }
    if (environment.path !== intent.path) {
      throw new ApiError(
        409,
        "invalid_request",
        "Environment path changed before checkout reconciliation",
      );
    }

    this.attachThreadToEnvironment(thread, environment, task);

    if (environment.status === "provisioning") {
      return this.awaitActiveEnvironmentProvision(thread, environment, task);
    }
    if (environment.status !== "ready" || !environment.path) {
      this.failProvisioning({
        detail: `Environment is ${environment.status}`,
        environmentId: environment.id,
        threadId: thread.id,
      });
      return null;
    }
    if (this.environmentLifecycle.hasActiveProvision(environment.id)) {
      this.failProvisioning({
        detail: "Environment already has an active provision operation",
        environmentId: environment.id,
        threadId: thread.id,
      });
      return null;
    }

    const command = buildEnvironmentProvisionCommand({
      environmentId: environment.id,
      hostId: intent.hostId,
      initiator: {
        threadId: thread.id,
        provisioningId: task.state.provisioningId,
      },
      path: intent.path,
      workspaceProvisionType: "unmanaged",
      checkout: this.buildUnmanagedCheckout(thread, task, intent.branch),
    });

    this.appendProvisioningStartedEventIfNeeded(thread.id, environment, task);
    const currentEnvironment = getEnvironment(this.deps.db, environment.id);
    if (currentEnvironment && currentEnvironment.status !== "provisioning") {
      setEnvironmentStatus(this.deps.db, this.deps.hub, environment.id, {
        status: "provisioning",
      });
    }
    await this.environmentLifecycle.startProvision({
      command,
      environmentId: environment.id,
      kind: "reprovision",
      provisioningId: task.state.provisioningId,
    });
    return getEnvironment(this.deps.db, environment.id) ?? environment;
  }

  private resolveDirectEnvironmentPlan(
    thread: Thread,
    task: ThreadProvisionTask,
    intent:
      | DirectManagedEnvironmentIntent
      | DirectPersonalEnvironmentIntent
      | DirectUnmanagedEnvironmentIntent,
  ): ThreadProvisionEnvironmentPlan {
    switch (intent.type) {
      case "direct-unmanaged":
        return {
          environmentInput: {
            projectId: thread.projectId,
            hostId: intent.hostId,
            managed: false,
            workspaceProvisionType: "unmanaged",
            status: "provisioning",
          },
          buildCommand: (environment) =>
            buildEnvironmentProvisionCommand({
              environmentId: environment.id,
              hostId: intent.hostId,
              initiator: {
                threadId: thread.id,
                provisioningId: task.state.provisioningId,
              },
              path: intent.path,
              workspaceProvisionType: "unmanaged",
              ...(intent.branch
                ? {
                    checkout: this.buildUnmanagedCheckout(
                      thread,
                      task,
                      intent.branch,
                    ),
                  }
                : {}),
            }),
        };
      case "direct-managed":
        // Managed workspaces land under the server's own data dir (merged
        // dirs, plan §3).
        return {
          environmentInput: {
            projectId: thread.projectId,
            hostId: intent.hostId,
            managed: true,
            workspaceProvisionType: intent.workspaceProvisionType,
            baseBranch: baseBranchSpecToStoredName(intent.baseBranch),
            status: "provisioning",
          },
          buildCommand: (environment) =>
            buildEnvironmentProvisionCommand({
              branchName: buildManagedBranchName({
                branchSlug: task.request.branchSlug,
                threadId: thread.id,
              }),
              baseBranch: intent.baseBranch,
              environmentId: environment.id,
              hostId: intent.hostId,
              initiator: {
                threadId: thread.id,
                provisioningId: task.state.provisioningId,
              },
              sourcePath: intent.sourcePath,
              targetPath: resolveManagedTargetPath({
                dataDir: this.deps.config.dataDir,
                environmentId: environment.id,
                sourcePath: intent.sourcePath,
              }),
              workspaceProvisionType: intent.workspaceProvisionType,
              setupTimeoutMs: SETUP_TIMEOUT_MS,
            }),
        };
      case "direct-personal":
        return {
          environmentInput: {
            projectId: thread.projectId,
            hostId: intent.hostId,
            managed: true,
            workspaceProvisionType: intent.workspaceProvisionType,
            status: "provisioning",
          },
          buildCommand: (environment) =>
            buildEnvironmentProvisionCommand({
              environmentId: environment.id,
              hostId: intent.hostId,
              initiator: {
                threadId: thread.id,
                provisioningId: task.state.provisioningId,
              },
              targetPath: resolvePersonalTargetPath({
                dataDir: this.deps.config.dataDir,
                environmentId: environment.id,
              }),
              workspaceProvisionType: intent.workspaceProvisionType,
            }),
        };
      default:
        return assertNever(intent);
    }
  }

  private async ensureDirectEnvironment(
    thread: Thread,
    task: ThreadProvisionTask,
    intent:
      | DirectManagedEnvironmentIntent
      | DirectPersonalEnvironmentIntent
      | DirectUnmanagedEnvironmentIntent,
  ): Promise<Environment | null> {
    if (task.state.environmentId !== null) {
      const existing = getEnvironment(this.deps.db, task.state.environmentId);
      if (!existing) {
        throw new Error("Attached provisioning environment no longer exists");
      }
      if (existing.status === "provisioning") {
        return this.awaitActiveEnvironmentProvision(thread, existing, task);
      }
      return existing;
    }

    const plan = this.resolveDirectEnvironmentPlan(thread, task, intent);
    const created = this.deps.db.transaction(
      (tx) => {
        const environment = createEnvironment(
          tx,
          this.deps.hub,
          plan.environmentInput,
        );
        if (thread.environmentId !== environment.id) {
          updateThread(tx, this.deps.hub, thread.id, {
            environmentId: environment.id,
          });
        }
        const provisionEventSequence =
          appendThreadProvisioningEventInTransaction(tx, {
            threadId: thread.id,
            environmentId: environment.id,
            provisioningId: task.state.provisioningId,
            status: "active",
            entries: initialProvisioningEntries(environment),
          });
        return { environment, provisionEventSequence };
      },
      { behavior: "immediate" },
    );
    task.state = {
      ...task.state,
      environmentId: created.environment.id,
      provisionEventSequence: created.provisionEventSequence,
      stage: "environment-provisioning",
    };
    task.resolveEnvironmentAttached();
    this.deps.hub.notifyThread(thread.id, ["events-appended"], {
      eventTypes: ["system/thread-provisioning"],
    });

    await this.environmentLifecycle.startProvision({
      command: plan.buildCommand(created.environment),
      environmentId: created.environment.id,
      kind: "provision",
      provisioningId: task.state.provisioningId,
    });
    return (
      getEnvironment(this.deps.db, created.environment.id) ?? created.environment
    );
  }

  private ensureWorkspaceReadyEvent(
    task: ThreadProvisionTask,
    args: {
      entries: ProvisioningTranscriptEntry[];
      environmentId: string;
      threadId: string;
    },
  ): void {
    if (task.state.workspaceReadyEventSequence !== null) {
      return;
    }
    const sequence = appendThreadProvisioningEvent(this.deps, {
      threadId: args.threadId,
      environmentId: args.environmentId,
      provisioningId: task.state.provisioningId,
      status: "active",
      entries: args.entries,
    });
    task.state = {
      ...task.state,
      environmentId: args.environmentId,
      stage: "workspace-ready",
      workspaceReadyEventSequence: sequence,
    };
  }

  /**
   * Provision → start handoff: appends the provisioning `completed` event and
   * registers the start task in one synchronous frame inside a transaction
   * that re-checks deleted/archived/stopRequestedAt — `blocked` when a stop
   * won the race (no stale start may follow a cancellation).
   */
  private async handoffToStart(
    thread: Thread,
    environment: Environment,
    workspacePath: string,
    task: ThreadProvisionTask,
  ): Promise<void> {
    const command = await buildThreadStartCommand(this.deps, {
      thread,
      environment: {
        id: environment.id,
        hostId: environment.hostId,
        cleanupRequestedAt: environment.cleanupRequestedAt,
        path: workspacePath,
        status: environment.status,
        workspaceProvisionType: environment.workspaceProvisionType,
      },
      input: task.request.input,
      requestId: task.request.clientRequestId,
      execution: task.request.execution,
      permissionEscalation: resolvePermissionEscalation({
        thread,
        initiator: thread.type === "manager" ? "system" : "user",
      }),
      projectId: thread.projectId,
      providerId: thread.providerId,
    });
    if (task.cancelled) {
      return;
    }

    const handoff = this.deps.db.transaction(
      (tx): "blocked" | "created" | "existing-start" => {
        const currentThread = getThread(tx, thread.id);
        if (
          !currentThread ||
          currentThread.deletedAt !== null ||
          currentThread.archivedAt !== null ||
          currentThread.stopRequestedAt !== null ||
          !isPreStartThreadStatus(currentThread.status)
        ) {
          return "blocked";
        }
        if (this.startTasks.has(thread.id)) {
          return "existing-start";
        }

        appendThreadProvisioningEventInTransaction(tx, {
          threadId: thread.id,
          environmentId: environment.id,
          provisioningId: task.state.provisioningId,
          status: "completed",
          entries: [],
        });
        const requestEventSequence =
          findStoredClientTurnRequestSequenceByRequestId(tx, {
            requestId: command.requestId,
            threadId: command.threadId,
          });
        if (requestEventSequence !== null) {
          createPendingClientTurnRequestInTransaction(tx, {
            environmentId: command.environmentId,
            requestEventSequence,
            requestId: command.requestId,
            threadId: command.threadId,
          });
        }
        return "created";
      },
      { behavior: "immediate" },
    );

    if (handoff !== "created") {
      return;
    }
    this.deps.hub.notifyThread(thread.id, ["events-appended"], {
      eventTypes: ["system/thread-provisioning"],
    });
    this.startTasks.set(thread.id, {
      syncGeneratedTitle: !task.request.titleProvided,
    });
    await this.runStartSettlement(thread.id, command);
  }

  // ---------------------------------------------------------------------
  // Start / turn settlement internals
  // ---------------------------------------------------------------------

  private async runStartSettlement(
    threadId: string,
    command: ThreadStartCommand,
  ): Promise<void> {
    const task = this.startTasks.get(threadId) ?? null;
    try {
      const executed = await this.deps.engineDispatch.execute({ command });
      // The start task settles here; remove it before the settlement
      // transaction so finalization paths inside it are not refused.
      if (this.startTasks.get(threadId) === task) {
        this.startTasks.delete(threadId);
      }
      this.settleStartResult(threadId, command, executed, {
        syncGeneratedTitle: task?.syncGeneratedTitle ?? false,
      });
    } catch (error) {
      this.deps.logger.error(
        { err: error, threadId },
        "Thread start settlement failed",
      );
    } finally {
      if (this.startTasks.get(threadId) === task) {
        this.startTasks.delete(threadId);
      }
      this.redriveLostStopIfRequested(threadId);
    }
  }

  /**
   * A stop requested while the start command was in flight could not finalize
   * (the start task owned the thread). Re-drive it now that the start has
   * settled — the in-process replacement for the queue-era stop re-drive
   * sweep.
   */
  private redriveLostStopIfRequested(threadId: string): void {
    if (this.stopTasks.has(threadId)) {
      return;
    }
    const thread = getThread(this.deps.db, threadId);
    if (!thread || thread.deletedAt !== null || thread.stopRequestedAt === null) {
      return;
    }
    this.requestStopForCurrentState(
      {
        environmentId: thread.environmentId,
        id: thread.id,
        status: thread.status,
        stopRequestedAt: thread.stopRequestedAt,
      },
      thread.environmentId === null ? null : { id: thread.environmentId },
    );
  }

  private settleStartResult(
    threadId: string,
    command: ThreadStartCommand,
    executed: ExecutedEngineCommand,
    options: { syncGeneratedTitle: boolean },
  ): void {
    const notificationBuffer = new NotificationBuffer();
    const engineDispatches = new EngineDispatchBuffer();
    const postCommit: Array<() => void> = [];

    this.deps.db.transaction(
      (tx) => {
        const context: LifecycleTransactionContext = {
          db: tx,
          engineDispatches,
          hub: notificationBuffer,
        };
        const thread = getThread(tx, command.threadId);
        if (!thread) {
          return;
        }
        if (!executed.report.ok) {
          settleFailedClientTurnRequest(tx, {
            completedAt: executed.report.completedAt,
            errorMessage: executed.report.errorMessage,
            requestId: command.requestId,
            threadId: command.threadId,
          });
          this.settleThreadCommandFailureInTransaction(
            context,
            command,
            {
              errorMessage: executed.report.errorMessage,
              type: "thread.start",
            },
            postCommit,
          );
          return;
        }

        settleSuccessfulClientTurnRequest(tx, {
          completedAt: executed.report.completedAt,
          requestId: command.requestId,
          threadId: command.threadId,
        });

        if (thread.deletedAt !== null) {
          const finalized = this.finalizeStoppedThreadInTransaction(context, {
            threadId: thread.id,
          });
          if (finalized) {
            postCommit.push(() =>
              this.environmentLifecycle.requestCleanupAdvance({
                environmentId: command.environmentId,
              }),
            );
          }
          return;
        }

        if (thread.title && options.syncGeneratedTitle) {
          const title = thread.title;
          postCommit.push(() =>
            queueThreadRenameCommand(this.deps, {
              environment: {
                id: command.environmentId,
                hostId: LOCAL_HOST_ID,
              },
              providerId: thread.providerId,
              threadId: thread.id,
              title,
            }),
          );
        }
      },
      { behavior: "immediate" },
    );

    notificationBuffer.flushInto(this.deps.hub);
    engineDispatches.flushInto(this.deps.engineDispatch);
    for (const action of postCommit) {
      action();
    }
  }

  private async runTurnSubmitSettlement(
    queued: QueuedTurnSubmitCommandDispatch,
  ): Promise<void> {
    const executed = await this.deps.engineDispatch.execute({
      command: queued.command,
    });

    const notificationBuffer = new NotificationBuffer();
    const engineDispatches = new EngineDispatchBuffer();
    const postCommit: Array<() => void> = [];
    this.deps.db.transaction(
      (tx) => {
        const context: LifecycleTransactionContext = {
          db: tx,
          engineDispatches,
          hub: notificationBuffer,
        };
        if (!executed.report.ok) {
          settleFailedClientTurnRequest(tx, {
            completedAt: executed.report.completedAt,
            errorMessage: executed.report.errorMessage,
            requestId: queued.command.requestId,
            threadId: queued.command.threadId,
          });
          this.settleThreadCommandFailureInTransaction(
            context,
            queued.command,
            {
              errorMessage: executed.report.errorMessage,
              type: "turn.submit",
            },
            postCommit,
          );
          return;
        }
        settleSuccessfulClientTurnRequest(tx, {
          completedAt: executed.report.completedAt,
          requestId: queued.command.requestId,
          threadId: queued.command.threadId,
        });
      },
      { behavior: "immediate" },
    );

    notificationBuffer.flushInto(this.deps.hub);
    engineDispatches.flushInto(this.deps.engineDispatch);
    for (const action of postCommit) {
      action();
    }
  }

  private settleThreadCommandFailureInTransaction(
    context: LifecycleTransactionContext,
    command: ThreadStartCommand | TurnSubmitCommand,
    report: ThreadFailureCommandReport,
    postCommit: Array<() => void>,
  ): void {
    const thread = getThread(context.db, command.threadId);
    if (!thread || thread.deletedAt !== null) {
      return;
    }
    if (hasExpectedTurnCompletedEvent(context.db, command)) {
      return;
    }
    appendSystemErrorEventInTransaction(
      { db: context.db, hub: context.hub },
      {
        threadId: thread.id,
        environmentId: thread.environmentId,
        code: "thread_command_failed",
        message: `Command ${report.type} failed`,
        detail: report.errorMessage,
        scope: getThreadFailureCommandErrorScope(command),
      },
    );
    tryTransitionInTransaction(context.db, context.hub, thread.id, "error");
    if (thread.parentThreadId !== null) {
      const managerThreadId = thread.parentThreadId;
      postCommit.push(() => {
        void queueManagedThreadTurnNotificationBestEffort(
          {
            ...this.deps,
            environmentLifecycle: this.environmentLifecycle,
            threadLifecycle: this,
          },
          {
            managedThreadId: thread.id,
            managerThreadId,
            title: thread.title,
            turnStatus: "failed",
          },
        );
      });
    }
  }

  // ---------------------------------------------------------------------
  // Stop / finalize internals
  // ---------------------------------------------------------------------

  private async runStopTask(
    args: RequestThreadStopArgs,
    task: ThreadStopTask,
  ): Promise<void> {
    try {
      const executed = await this.deps.engineDispatch.execute({
        command: buildThreadStopCommand({
          environmentId: args.environmentId,
          threadId: args.threadId,
        }),
      });
      if (!executed.report.ok) {
        // No sweep re-drives this anymore: a failed in-process stop means the
        // runtime is gone or wedged. Interrupt + finalize anyway, loudly.
        this.deps.logger.error(
          {
            environmentId: args.environmentId,
            errorCode: executed.report.errorCode,
            errorMessage: executed.report.errorMessage,
            threadId: args.threadId,
          },
          "Thread stop command failed; finalizing anyway",
        );
      }

      const finalized = this.finalizeStoppedThreadOwned(args.threadId, task);
      if (finalized) {
        this.queueSettledArchivedThreadProviderArchiveCommand({
          threadId: args.threadId,
        });
        this.environmentLifecycle.requestCleanupAdvance({
          environmentId: args.environmentId,
        });
      }
    } finally {
      if (this.stopTasks.get(args.threadId) === task) {
        this.stopTasks.delete(args.threadId);
      }
    }
  }

  private requestPreStartStop(threadId: string): void {
    const notificationBuffer = new NotificationBuffer();
    const engineDispatches = new EngineDispatchBuffer();
    let kickCancelEnvironmentId: string | null = null;
    const result = this.deps.db.transaction(
      (tx): PreStartStopResult => {
        const context: LifecycleTransactionContext = {
          db: tx,
          engineDispatches,
          hub: notificationBuffer,
        };
        const currentThread = getThread(tx, threadId);
        if (!currentThread) {
          return { environmentId: null, finalized: true };
        }

        const provisionTask = this.provisionTasks.get(threadId) ?? null;
        if (
          !isPreStartThreadStatus(currentThread.status) &&
          provisionTask === null
        ) {
          return {
            environmentId: currentThread.environmentId,
            finalized: false,
          };
        }

        if (currentThread.stopRequestedAt === null) {
          markThreadStopRequested(tx, notificationBuffer, {
            threadId: currentThread.id,
          });
          appendThreadInterruptedEventInTransaction(tx, {
            threadId: currentThread.id,
            reason: "manual-stop",
          });
          notificationBuffer.notifyThread(
            currentThread.id,
            ["events-appended"],
            {
              eventTypes: ["system/thread/interrupted"],
            },
          );
          if (provisionTask) {
            const provisioningEnvironmentId =
              provisionTask.state.environmentId ?? currentThread.environmentId;
            if (provisioningEnvironmentId !== null) {
              appendThreadProvisioningEventInTransaction(tx, {
                threadId: currentThread.id,
                environmentId: provisioningEnvironmentId,
                provisioningId: provisionTask.state.provisioningId,
                status: "cancelled",
                entries: [buildProvisioningStoppedEntry()],
              });
              notificationBuffer.notifyThread(
                currentThread.id,
                ["events-appended"],
                {
                  eventTypes: ["system/thread-provisioning"],
                },
              );
            }
          }
        }

        if (provisionTask) {
          provisionTask.cancelled = true;
          provisionTask.controller.abort();
          this.cancelledProvisions.add(currentThread.id);
        }

        const environmentId = currentThread.environmentId;
        const cancellation =
          environmentId === null
            ? "ready_to_finalize"
            : this.environmentLifecycle.cancelProvisionForThreadStopInTransaction(
                context,
                {
                  environmentId,
                  threadId: currentThread.id,
                },
              );
        if (cancellation === "awaiting_cancel") {
          kickCancelEnvironmentId = environmentId;
          return { environmentId, finalized: false };
        }

        const finalized = this.finalizeStoppedThreadInTransaction(context, {
          threadId: currentThread.id,
        });
        return { environmentId, finalized };
      },
      { behavior: "immediate" },
    );
    notificationBuffer.flushInto(this.deps.hub);
    engineDispatches.flushInto(this.deps.engineDispatch);

    if (kickCancelEnvironmentId !== null) {
      this.environmentLifecycle.kickProvisionCancel(kickCancelEnvironmentId);
    }
    if (result.finalized && result.environmentId !== null) {
      this.environmentLifecycle.requestCleanup({
        environmentId: result.environmentId,
      });
      this.environmentLifecycle.requestCleanupAdvance({
        environmentId: result.environmentId,
      });
    }
  }

  private finalizeStoppedThreadOwned(
    threadId: string,
    owner: ThreadStopTask | null,
  ): boolean {
    const notificationBuffer = new NotificationBuffer();
    const engineDispatches = new EngineDispatchBuffer();
    const finalized = this.deps.db.transaction(
      (tx) =>
        this.finalizeStoppedThreadInTransactionOwned(
          {
            db: tx,
            engineDispatches,
            hub: notificationBuffer,
          },
          threadId,
          owner,
        ),
      { behavior: "immediate" },
    );
    notificationBuffer.flushInto(this.deps.hub);
    engineDispatches.flushInto(this.deps.engineDispatch);
    if (finalized) {
      this.queueSettledArchivedThreadProviderArchiveCommand({ threadId });
    }
    return finalized;
  }

  /**
   * The heart of stop semantics. Refuses while a start task is live or while
   * a stop task other than `owner` owns the thread; settles pending client
   * turn requests by interruption reason; interrupts the open turn (active
   * threads) or transitions pre-start status; clears `stopRequestedAt`;
   * interrupts pending interactions; appends `system/thread/interrupted` at
   * most once per thread; hard-deletes tombstoned threads (with the
   * `thread.deleted` engine notification + environment cleanup request).
   */
  private finalizeStoppedThreadInTransactionOwned(
    context: LifecycleTransactionContext,
    threadId: string,
    owner: ThreadStopTask | null,
  ): boolean {
    const currentThread = getThread(context.db, threadId);
    if (!currentThread) {
      return true;
    }

    if (this.startTasks.has(threadId)) {
      return false;
    }

    const stopTask = this.stopTasks.get(threadId) ?? null;
    if (stopTask !== null && owner !== stopTask) {
      // A live stop dispatch owns finalization.
      return false;
    }

    const interruptionReason = stopTask?.reason ?? "manual-stop";
    settleInterruptedClientTurnRequestsForThreadsInTransaction(context.db, {
      reason: interruptionReason,
      threadIds: [currentThread.id],
    });

    let appendedThreadInterruptedEvent = false;
    if (currentThread.status === "active") {
      appendedThreadInterruptedEvent =
        this.interruptActiveTurnForThreadInTransaction(context, {
          environmentId: currentThread.environmentId,
          reason: interruptionReason,
          threadId: currentThread.id,
        });
      if (!appendedThreadInterruptedEvent) {
        tryTransitionInTransaction(
          context.db,
          context.hub,
          currentThread.id,
          nextStatusForInterruptedThread(interruptionReason),
        );
      }
    } else if (isPreStartThreadStatus(currentThread.status)) {
      tryTransitionInTransaction(
        context.db,
        context.hub,
        currentThread.id,
        nextStatusForInterruptedThread(interruptionReason),
      );
    }

    if (stopTask !== null) {
      this.stopTasks.delete(threadId);
    }
    this.cancelledProvisions.delete(threadId);

    if (currentThread.stopRequestedAt !== null) {
      clearThreadStopRequested(context.db, context.hub, currentThread.id);
    }

    const finalizedThread = getThread(context.db, threadId);
    if (!finalizedThread) {
      return true;
    }

    if (finalizedThread.deletedAt === null) {
      this.deps.pendingInteractions.interruptPendingInteractionsForThreadIdsInTransaction(
        { db: context.db, hub: context.hub },
        {
          threadIds: [finalizedThread.id],
          reason: pendingInteractionStopReason(interruptionReason),
        },
      );
      if (
        !appendedThreadInterruptedEvent &&
        !hasThreadInterruptedEvent(context.db, finalizedThread.id)
      ) {
        appendThreadInterruptedEventInTransaction(context.db, {
          threadId: finalizedThread.id,
          reason: interruptionReason,
        });
        context.hub.notifyThread(finalizedThread.id, ["events-appended"], {
          eventTypes: ["system/thread/interrupted"],
        });
      }
      return true;
    }

    this.deps.pendingInteractions.interruptPendingInteractionsForThreadIdsInTransaction(
      { db: context.db, hub: context.hub },
      {
        threadIds: [finalizedThread.id],
        reason: "Thread was deleted while awaiting user interaction",
      },
    );

    const environmentId = finalizedThread.environmentId;
    const environment = environmentId
      ? getEnvironment(context.db, environmentId)
      : null;
    if (environment) {
      queueThreadDeletedCommandInTransaction(context.engineDispatches, {
        environment: { hostId: environment.hostId, id: environment.id },
        threadId: finalizedThread.id,
      });
    }
    deleteThread(context.db, context.hub, finalizedThread.id);
    this.environmentLifecycle.requestCleanupInTransaction(context, {
      environmentId,
    });
    return true;
  }

  private interruptActiveTurnForThreadInTransaction(
    context: LifecycleTransactionContext,
    args: {
      environmentId: string | null;
      reason: SystemThreadInterruptedReason;
      threadId: string;
    },
  ): boolean {
    const activeTurnId = getActiveTurnId(
      { db: context.db },
      args.threadId,
    );
    if (!activeTurnId) {
      return false;
    }

    const providerThreadId = getLastProviderThreadId(
      { db: context.db },
      args.threadId,
    );

    appendThreadEventsInTransaction(context.db, [
      {
        threadId: args.threadId,
        environmentId: args.environmentId,
        providerThreadId,
        type: "turn/completed",
        scope: turnScope(activeTurnId),
        data: {
          providerThreadId,
          status: "interrupted",
        },
      },
      {
        threadId: args.threadId,
        type: "system/thread/interrupted",
        scope: threadScope(),
        data: {
          reason: args.reason,
        },
      },
    ]);
    transitionThreadStatusInTransaction(context.db, {
      id: args.threadId,
      newStatus: nextStatusForInterruptedThread(args.reason),
    });
    context.hub.notifyThread(
      args.threadId,
      ["events-appended", "status-changed"],
      {
        eventTypes: ["turn/completed", "system/thread/interrupted"],
      },
    );

    return true;
  }
}
