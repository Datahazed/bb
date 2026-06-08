import {
  and,
  eq,
  inArray,
  isNotNull,
  isNull,
  notInArray,
  or,
} from "drizzle-orm";
import {
  clearThreadStopRequested,
  createHostDaemonCommandId,
  createPendingClientTurnRequestInTransaction,
  deleteThread,
  environments,
  events,
  findStoredClientTurnRequestSequenceByRequestId,
  getEnvironment,
  getThread,
  getThreadOperation,
  getThreadOperationByCommandId,
  listThreadIdsWithLatestHostDaemonRestartInterruption,
  listThreadTurnInterruptionEventStates,
  markThreadStopRequested,
  recordClientTurnRequestCommandCompletedInTransaction,
  settleClientTurnRequestsForCommandInTransaction,
  settlePendingClientTurnRequestsForThreadsInTransaction,
  threads,
  transitionThreadStatusInTransaction,
  type DbNotifier,
  type DbQueryConnection,
  type DbTransaction,
  type HostDaemonCommandRow,
} from "@bb/db";
import type { ThreadOperationRow } from "@bb/db";
import { assertNever } from "@bb/core-ui";
import { z } from "zod";
import {
  cancelThreadOperationRecord,
  markThreadOperationRecordCompleted,
  markThreadOperationRecordFailed,
  markThreadOperationRecordQueued,
  upsertThreadOperationRecord,
} from "@bb/db/internal-lifecycle";
import {
  isActiveLifecycleOperationState,
  type ClientTurnRequestTerminalReason,
  type ProvisioningTranscriptEntry,
  type SystemThreadInterruptedReason,
  type TerminalClientTurnRequestStatus,
  type Thread,
  type ThreadEventScope,
  type ThreadEventType,
  type ThreadStatus,
  systemThreadInterruptedReasonSchema,
  threadScope,
  turnScope,
} from "@bb/domain";
import {
  threadStartCommandSchema,
  threadStopCommandSchema,
} from "@bb/host-daemon-contract";
import type {
  AppDeps,
  LoggedPendingInteractionWorkSessionDeps,
  LoggedWorkSessionDeps,
  PendingInteractionWorkSessionDeps,
  WorkSessionDeps,
} from "../../types.js";
import {
  advanceEnvironmentCleanup,
  requestEnvironmentCleanup,
  requestEnvironmentCleanupAdvance,
  runEnvironmentCleanupAdvance,
} from "../environments/environment-cleanup-internal.js";
import { cancelEnvironmentProvisioningForThreadStopInTransaction } from "../environments/environment-provisioning-cancellation.js";
import {
  emptyCommandResultSideEffects,
  type CommandResultFailureReportForType,
  type CommandResultPostCommitAction,
  type CommandResultReportForType,
  type CommandResultSideEffectsResult,
  type HostDaemonCommandForType,
} from "../../internal/command-result-side-effects.js";
import {
  appendSystemErrorEventInTransaction,
  appendThreadEventInTransaction,
  appendThreadEventsInTransaction,
  appendThreadInterruptedEventInTransaction,
  appendThreadProvisioningEventInTransaction,
  getActiveTurnId,
  getLastProviderThreadId,
} from "./thread-events.js";
import {
  tryTransition,
  tryTransitionInTransaction,
} from "./thread-transitions.js";
import {
  addRequestIdToTurnSubmitCommandPayload,
  buildThreadStartCommand,
  buildThreadStopCommand,
  prepareTurnSubmitCommandPayload,
  queueArchivedThreadProviderArchiveCommand,
  queueThreadDeletedCommandInTransaction,
  queueThreadRenameCommandInTransaction,
  queueTurnSubmitCommandInTransaction,
  type QueueThreadStartCommandArgs,
  type QueueThreadStopCommandArgs,
} from "./thread-commands.js";
import type { EngineCommandEnvelope } from "../../engine/ports.js";
import { EngineDispatchBuffer } from "../engine/engine-dispatch.js";
import { createAsyncDeduper } from "../lib/async-deduper.js";
import { parseJsonWithSchema } from "../lib/json-parsing.js";
import { throwThreadNotWritable } from "../lib/lifecycle-api-errors.js";
import { NotificationBuffer } from "../lib/notification-buffer.js";
import { queueManagedThreadTurnNotificationBestEffort } from "./managed-thread-notifications.js";
import {
  readThreadProvisioningIdFromRecord,
  threadProvisionCommonPayloadSchema,
} from "./thread-provisioning-context.js";
import { isPreStartThreadStatus } from "./thread-status.js";

type QueueReadyThreadTurnCommandResult = "thread.start" | "turn.submit";
type ThreadStartCommand = Awaited<ReturnType<typeof buildThreadStartCommand>>;
type ThreadStopCommand = ReturnType<typeof buildThreadStopCommand>;
type TurnSubmitCommand = HostDaemonCommandForType<"turn.submit">;
type ThreadEventAppendArgs = Parameters<
  typeof appendThreadEventsInTransaction
>[1][number];

type ThreadFailureCommand = ThreadStartCommand | TurnSubmitCommand;

type ThreadFailureResultReport = CommandResultFailureReportForType<
  ThreadFailureCommand["type"]
>;
type ThreadStartCommandResultReport =
  CommandResultReportForType<"thread.start">;
type TurnSubmitCommandResultReport = CommandResultReportForType<"turn.submit">;
type ThreadStopCommandResultReport = CommandResultReportForType<"thread.stop">;

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

export interface QueuePreparedReadyThreadTurnCommandInTransactionArgs {
  command: PreparedReadyThreadTurnCommand;
  requestEventSequence: number;
  thread: Thread;
}

/**
 * Bookkeeping result of a ready-thread turn queue: the caller dispatches the
 * envelope after its transaction commits (Phase 1 dispatch shim).
 */
export interface QueuedReadyThreadTurnCommand {
  envelope: EngineCommandEnvelope;
  mode: QueueReadyThreadTurnCommandResult;
}

interface QueuePreparedThreadStartCommandInTransactionArgs {
  command: PreparedThreadStartCommand;
  requestEventSequence: number;
  thread: Thread;
}

const threadStartRequestDeduper = createAsyncDeduper<string, void>();

interface AdvanceThreadOperationArgs {
  threadId: string;
}

export interface RequestThreadStopArgs extends QueueThreadStopCommandArgs {
  interruptionReason: SystemThreadInterruptedReason;
  stopRequestedAt: number | null;
}

interface RequestThreadStopForCurrentStateEnvironment {
  id: string;
}

type RequestThreadStopForCurrentStateDeps =
  LoggedPendingInteractionWorkSessionDeps;

interface RequestThreadStopForCurrentStateThread {
  environmentId: string | null;
  id: string;
  status: ThreadStatus;
  stopRequestedAt: number | null;
}

interface RequestPreStartThreadStopResult {
  environmentId: string | null;
  finalized: boolean;
}

interface ProvisioningInterruptedThread {
  environmentId: string | null;
  id: string;
}

interface FinalizeStoppedThreadArgs {
  expectedCommandId?: string;
  threadId: string;
}

interface InterruptActiveTurnForThreadArgs {
  environmentId: string | null;
  reason: SystemThreadInterruptedReason;
  threadId: string;
}

interface InterruptActiveThreadArgs {
  environmentId: string | null;
  threadId: string;
}

interface InterruptActiveThreadsArgs {
  reason: SystemThreadInterruptedReason;
  threads: readonly InterruptActiveThreadArgs[];
}

interface InterruptedActiveThreadResult {
  interruptedTurnId: string | null;
  threadId: string;
}

interface InterruptActiveThreadsResult {
  threads: InterruptedActiveThreadResult[];
}

interface ReconcileDaemonReportedThreadsArgs {
  activeThreadIds: readonly string[];
  hostId: string;
}

interface ThreadOperationMutationArgs {
  threadId: string;
}

interface ThreadOperationCommandMutationArgs {
  commandId: string;
}

interface QueueSettledArchivedThreadProviderArchiveCommandArgs {
  threadId: string;
}

interface ThreadCommandResultSettlementDeps {
  db: DbTransaction;
  hub: DbNotifier;
}

interface SettleThreadCommandFailureArgs {
  command: ThreadFailureCommand;
  deps: ThreadCommandResultSettlementDeps;
  report: ThreadFailureResultReport;
}

interface SettleThreadStartCommandResultArgs {
  command: ThreadStartCommand;
  commandRow: HostDaemonCommandRow;
  deps: FinalizeStoppedThreadTransactionDeps;
  report: ThreadStartCommandResultReport;
}

interface SettleTurnSubmitCommandResultArgs {
  command: TurnSubmitCommand;
  commandRow: HostDaemonCommandRow;
  deps: ThreadCommandResultSettlementDeps;
  report: TurnSubmitCommandResultReport;
}

interface SettleThreadStopCommandResultArgs {
  command: ThreadStopCommand;
  commandRow: HostDaemonCommandRow;
  deps: FinalizeStoppedThreadTransactionDeps;
  report: ThreadStopCommandResultReport;
}

interface SettleSuccessfulClientTurnRequestsForCommandArgs {
  commandCompletedAt: number;
  commandId: string;
}

interface SettleFailedClientTurnRequestsForCommandArgs {
  commandCompletedAt: number;
  commandId: string;
  errorCode: string;
  errorMessage: string;
}

interface FailedClientTurnRequestSettlement {
  reasonCode: ClientTurnRequestTerminalReason;
  status: TerminalClientTurnRequestStatus;
}

interface InterruptedClientTurnRequestSettlement {
  message: string;
  reasonCode: ClientTurnRequestTerminalReason;
  status: TerminalClientTurnRequestStatus;
}

interface SettleInterruptedClientTurnRequestsForThreadsArgs {
  reason: SystemThreadInterruptedReason;
  threadIds: readonly string[];
}

interface ThreadStopOperationPayload {
  command: ThreadStopCommand;
  interruptionReason: SystemThreadInterruptedReason;
}

const threadStopOperationPayloadSchema = z.union([
  threadStopCommandSchema.transform(
    (command): ThreadStopOperationPayload => ({
      command,
      interruptionReason: "manual-stop",
    }),
  ),
  z.object({
    command: threadStopCommandSchema,
    interruptionReason: systemThreadInterruptedReasonSchema,
  }),
]);

function settleSuccessfulClientTurnRequestsForCommand(
  db: DbTransaction,
  args: SettleSuccessfulClientTurnRequestsForCommandArgs,
): void {
  recordClientTurnRequestCommandCompletedInTransaction(db, {
    commandCompletedAt: args.commandCompletedAt,
    commandId: args.commandId,
  });
  // Fallback tracked in plans/client-turn-request-lifecycle-follow-up.md:
  // command success is not provider-native acceptance, so keep
  // command_succeeded distinguishable until runtimes report exact outcomes.
  // Native provider acceptance wins when it arrives first; command completion is
  // still recorded above, while this pending-only settlement no-ops.
  settleClientTurnRequestsForCommandInTransaction(db, {
    commandCompletedAt: args.commandCompletedAt,
    commandId: args.commandId,
    reasonCode: "command_succeeded",
    settledAt: args.commandCompletedAt,
    status: "accepted",
  });
}

function clientTurnRequestSettlementForCommandError(
  errorCode: string,
): FailedClientTurnRequestSettlement {
  if (errorCode === "command_expired") {
    return {
      reasonCode: "command_expired",
      status: "expired",
    };
  }

  return {
    reasonCode: "command_failed",
    status: "failed",
  };
}

function settleFailedClientTurnRequestsForCommand(
  db: DbTransaction,
  args: SettleFailedClientTurnRequestsForCommandArgs,
): void {
  const settlement = clientTurnRequestSettlementForCommandError(args.errorCode);
  settleClientTurnRequestsForCommandInTransaction(db, {
    commandCompletedAt: args.commandCompletedAt,
    commandId: args.commandId,
    message: args.errorMessage,
    reasonCode: settlement.reasonCode,
    settledAt: args.commandCompletedAt,
    status: settlement.status,
  });
}

function nextStatusForInterruptedThread(
  reason: SystemThreadInterruptedReason,
): Extract<ThreadStatus, "idle" | "error"> {
  switch (reason) {
    case "manual-stop":
    case "host-daemon-restarted":
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
    case "host-daemon-restarted":
      return "Host daemon restarted while awaiting user interaction";
    case "provider-turn-idle":
      return "Thread stopped after the provider stopped sending progress";
    default:
      return assertNever(reason);
  }
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
    case "host-daemon-restarted":
      return {
        message: "Host daemon restarted before provider accepted the request",
        reasonCode: "provider_restarted",
        status: "canceled",
      };
    case "provider-turn-idle":
      return {
        message: "Provider stopped sending progress before accepting the request",
        reasonCode: "provider_detached",
        status: "failed",
      };
    default:
      return assertNever(reason);
  }
}

function settleInterruptedClientTurnRequestsForThreadsInTransaction(
  db: DbTransaction,
  args: SettleInterruptedClientTurnRequestsForThreadsArgs,
): void {
  const settlement = clientTurnRequestSettlementForInterruption(args.reason);
  settlePendingClientTurnRequestsForThreadsInTransaction(db, {
    message: settlement.message,
    reasonCode: settlement.reasonCode,
    status: settlement.status,
    threadIds: args.threadIds,
  });
}

function parseThreadStopOperationPayload(
  payload: string,
): ThreadStopOperationPayload {
  return parseJsonWithSchema(payload, threadStopOperationPayloadSchema);
}

function readThreadStopInterruptionReason(
  operation: ThreadOperationRow | null,
): SystemThreadInterruptedReason | null {
  if (!operation) {
    return null;
  }
  try {
    return parseThreadStopOperationPayload(operation.payload)
      .interruptionReason;
  } catch {
    return null;
  }
}

interface RequestThreadStartHandoffArgs {
  baseCommand: ThreadStartCommand;
  environmentId: string;
  sourceThreadStatus: ThreadStatus;
  threadId: string;
}

type RequestThreadStartHandoffDisposition =
  | "blocked"
  | "created"
  | "existing-start";

interface RequestThreadStartHandoffResult {
  completedProvisionSequence: number | null;
  disposition: RequestThreadStartHandoffDisposition;
}

interface ThreadLifecycleReadDeps {
  db: DbQueryConnection;
}

interface ThreadLifecycleWriteDeps extends ThreadLifecycleReadDeps {
  hub: DbNotifier;
}

interface ThreadLifecycleCommandQueueDeps {
  db: AppDeps["db"];
  engineDispatch: AppDeps["engineDispatch"];
}

interface ThreadLifecycleTransactionDeps extends ThreadLifecycleWriteDeps {
  db: DbTransaction;
}

interface FinalizeStoppedThreadTransactionDeps extends ThreadLifecycleTransactionDeps {
  engineDispatch: AppDeps["engineDispatch"];
  /** Follow-up dispatches staged in-transaction; flushed by the tx owner. */
  engineDispatches: EngineDispatchBuffer;
  pendingInteractions: AppDeps["pendingInteractions"];
}

interface ApplyActiveTurnInterruptionArgs {
  activeTurnId: string;
  environmentId: string | null;
  providerThreadId: string | null;
  reason: SystemThreadInterruptedReason;
  threadId: string;
}

function getActiveThreadOperation(
  deps: ThreadLifecycleReadDeps,
  args: {
    kind: "provision" | "start" | "stop";
    threadId: string;
  },
) {
  const operation = getThreadOperation(deps.db, args);
  if (!operation || !isActiveLifecycleOperationState(operation.state)) {
    return null;
  }

  return operation;
}

function getActiveThreadOperationByCommandId(
  deps: ThreadLifecycleReadDeps,
  args: {
    commandId: string;
    kind: "start" | "stop";
  },
) {
  const operation = getThreadOperationByCommandId(deps.db, args.commandId);
  if (
    !operation ||
    operation.kind !== args.kind ||
    !isActiveLifecycleOperationState(operation.state)
  ) {
    return null;
  }

  return operation;
}

/**
 * Registry-backed state of a thread operation's dispatched command: an
 * in-flight dispatch maps to the daemon-era `"fetched"` (the engine owns it
 * and finalization must wait); the `"pending"` (queued-but-cancellable) state
 * died with the durable queue, and settled/never-dispatched are
 * indistinguishable in-process — no caller needs the distinction.
 */
function getThreadOperationCommandState(
  deps: Pick<AppDeps, "engineDispatch">,
  commandId: string | null,
): "fetched" | null {
  return deps.engineDispatch.isCommandInFlight(commandId) ? "fetched" : null;
}

function hasThreadInterruptedEvent(
  deps: ThreadLifecycleReadDeps,
  threadId: string,
): boolean {
  const row = deps.db
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

function buildProvisioningStoppedEntry(): ProvisioningTranscriptEntry {
  return {
    type: "step",
    key: "provisioning-stopped",
    text: "Provisioning stopped by user request",
    status: "completed",
    startedAt: Date.now(),
  };
}

function appendProvisioningInterruptedEventInTransaction(
  deps: ThreadLifecycleTransactionDeps,
  thread: ProvisioningInterruptedThread,
  operation: ThreadOperationRow | null,
): void {
  if (!operation) {
    return;
  }
  const environmentId =
    operation.provisioningEnvironmentId ?? thread.environmentId;
  if (environmentId === null) {
    return;
  }

  appendThreadProvisioningEventInTransaction(deps.db, {
    threadId: thread.id,
    environmentId,
    provisioningId: readThreadProvisioningIdFromRecord(operation),
    status: "cancelled",
    entries: [buildProvisioningStoppedEntry()],
  });
  deps.hub.notifyThread(thread.id, ["events-appended"], {
    eventTypes: ["system/thread-provisioning"],
  });
}

function applyActiveTurnInterruptionInTransaction(
  db: DbTransaction,
  args: ApplyActiveTurnInterruptionArgs,
): void {
  appendThreadEventInTransaction(db, {
    threadId: args.threadId,
    environmentId: args.environmentId,
    providerThreadId: args.providerThreadId,
    type: "turn/completed",
    scope: turnScope(args.activeTurnId),
    data: {
      providerThreadId: args.providerThreadId,
      status: "interrupted",
    },
  });
  appendThreadInterruptedEventInTransaction(db, {
    threadId: args.threadId,
    reason: args.reason,
  });
  transitionThreadStatusInTransaction(db, {
    id: args.threadId,
    newStatus: nextStatusForInterruptedThread(args.reason),
  });
}

function hasActiveThreadOperation(
  deps: ThreadLifecycleReadDeps,
  args: {
    kind: "provision" | "start" | "stop";
    threadId: string;
  },
): boolean {
  return getActiveThreadOperation(deps, args) !== null;
}

export function queueSettledArchivedThreadProviderArchiveCommand(
  deps: ThreadLifecycleCommandQueueDeps,
  args: QueueSettledArchivedThreadProviderArchiveCommandArgs,
): boolean {
  const thread = getThread(deps.db, args.threadId);
  if (!thread || thread.status === "active") {
    return false;
  }
  if (
    hasActiveThreadOperation(deps, { kind: "start", threadId: thread.id }) ||
    hasActiveThreadOperation(deps, { kind: "stop", threadId: thread.id })
  ) {
    return false;
  }

  return queueArchivedThreadProviderArchiveCommand(deps, {
    threadId: thread.id,
  });
}

function shouldSyncGeneratedThreadTitle(
  deps: ThreadLifecycleReadDeps,
  threadId: string,
): boolean {
  const operation = getThreadOperation(deps.db, {
    threadId,
    kind: "provision",
  });
  if (!operation) {
    return false;
  }
  const request = parseJsonWithSchema(
    operation.payload,
    threadProvisionCommonPayloadSchema,
  );
  return !request.titleProvided;
}

function getThreadFailureCommandErrorScope(
  command: ThreadFailureCommand,
): ThreadEventScope {
  if (command.type !== "turn.submit") {
    return threadScope();
  }

  return command.target.mode !== "start" && command.target.expectedTurnId
    ? turnScope(command.target.expectedTurnId)
    : threadScope();
}

function hasExpectedTurnCompletedEvent(
  deps: ThreadCommandResultSettlementDeps,
  command: ThreadFailureCommand,
): boolean {
  if (command.type !== "turn.submit" || command.target.mode === "start") {
    return false;
  }
  const turnId = command.target.expectedTurnId;
  if (!turnId) {
    return false;
  }

  return (
    deps.db
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

function settleThreadCommandFailure(
  args: SettleThreadCommandFailureArgs,
): CommandResultSideEffectsResult {
  const postCommitActions: CommandResultPostCommitAction[] = [];
  const thread = getThread(args.deps.db, args.command.threadId);
  if (!thread || thread.deletedAt !== null) {
    return emptyCommandResultSideEffects();
  }
  if (hasExpectedTurnCompletedEvent(args.deps, args.command)) {
    return emptyCommandResultSideEffects();
  }
  appendSystemErrorEventInTransaction(args.deps, {
    threadId: thread.id,
    environmentId: thread.environmentId,
    code: "thread_command_failed",
    message: `Command ${args.report.type} failed`,
    detail: args.report.errorMessage,
    scope: getThreadFailureCommandErrorScope(args.command),
  });
  tryTransitionInTransaction(args.deps.db, args.deps.hub, thread.id, "error");
  if (thread.parentThreadId !== null) {
    const managerThreadId = thread.parentThreadId;
    postCommitActions.push({
      name: "Managed thread command failure notification",
      context: {
        threadId: thread.id,
      },
      run: (deps) =>
        queueManagedThreadTurnNotificationBestEffort(deps, {
          managedThreadId: thread.id,
          managerThreadId,
          title: thread.title,
          turnStatus: "failed",
        }),
    });
  }
  return { postCommitActions };
}

export function settleThreadStartCommandResult(
  args: SettleThreadStartCommandResultArgs,
): CommandResultSideEffectsResult {
  const postCommitActions: CommandResultPostCommitAction[] = [];
  const thread = getThread(args.deps.db, args.command.threadId);
  if (!thread) {
    return emptyCommandResultSideEffects();
  }
  const operation = getActiveThreadOperationByCommandId(args.deps, {
    commandId: args.commandRow.id,
    kind: "start",
  });
  if (!args.report.ok) {
    settleFailedClientTurnRequestsForCommand(args.deps.db, {
      commandCompletedAt: args.report.completedAt,
      commandId: args.commandRow.id,
      errorCode: args.report.errorCode,
      errorMessage: args.report.errorMessage,
    });
    if (operation) {
      markThreadOperationRecordFailed(args.deps.db, {
        threadId: operation.threadId,
        kind: operation.kind,
        failureReason: args.report.errorMessage,
      });
    }
    return settleThreadCommandFailure({
      command: args.command,
      deps: args.deps,
      report: args.report,
    });
  }
  settleSuccessfulClientTurnRequestsForCommand(args.deps.db, {
    commandCompletedAt: args.report.completedAt,
    commandId: args.commandRow.id,
  });

  if (!operation) {
    return emptyCommandResultSideEffects();
  }

  markThreadOperationRecordCompleted(args.deps.db, {
    threadId: operation.threadId,
    kind: operation.kind,
  });
  const currentThread = getThread(args.deps.db, args.command.threadId);
  if (currentThread && currentThread.deletedAt !== null) {
    const finalized = finalizeStoppedThreadInTransaction(args.deps, {
      threadId: currentThread.id,
    });
    if (finalized) {
      postCommitActions.push({
        name: "Environment cleanup advance after deleted thread start finalize",
        context: {
          environmentId: args.command.environmentId,
          threadId: currentThread.id,
        },
        run: (deps) =>
          runEnvironmentCleanupAdvance(deps, {
            environmentId: args.command.environmentId,
          }),
      });
    }
    return { postCommitActions };
  }
  if (thread.title && shouldSyncGeneratedThreadTitle(args.deps, thread.id)) {
    queueThreadRenameCommandInTransaction(args.deps.engineDispatches, {
      environment: {
        id: args.command.environmentId,
        hostId: args.commandRow.hostId,
      },
      providerId: thread.providerId,
      threadId: thread.id,
      title: thread.title,
    });
  }
  return { postCommitActions };
}

export function settleTurnSubmitCommandResult(
  args: SettleTurnSubmitCommandResultArgs,
): CommandResultSideEffectsResult {
  if (!args.report.ok) {
    settleFailedClientTurnRequestsForCommand(args.deps.db, {
      commandCompletedAt: args.report.completedAt,
      commandId: args.commandRow.id,
      errorCode: args.report.errorCode,
      errorMessage: args.report.errorMessage,
    });
    return settleThreadCommandFailure({
      command: args.command,
      deps: args.deps,
      report: args.report,
    });
  }
  settleSuccessfulClientTurnRequestsForCommand(args.deps.db, {
    commandCompletedAt: args.report.completedAt,
    commandId: args.commandRow.id,
  });
  return emptyCommandResultSideEffects();
}

export function ensureThreadCanQueueStartRequest(
  deps: ThreadLifecycleReadDeps,
  thread: Thread,
): void {
  if (
    isPreStartThreadStatus(thread.status) &&
    hasActiveThreadOperation(deps, { kind: "start", threadId: thread.id })
  ) {
    throwThreadNotWritable(
      thread,
      "still_starting",
      "Thread is still starting",
    );
  }
}

export async function prepareReadyThreadTurnCommand(
  deps: LoggedWorkSessionDeps,
  args: QueueThreadStartCommandArgs,
): Promise<PreparedReadyThreadTurnCommand> {
  const providerThreadId = getLastProviderThreadId(deps, args.thread.id);
  if (providerThreadId) {
    const preparedCommand = await prepareTurnSubmitCommandPayload(deps, {
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
    command: await buildThreadStartCommand(deps, args),
    mode: "thread.start",
  };
}

function queuePreparedThreadStartCommandInTransaction(
  tx: DbTransaction,
  args: QueuePreparedThreadStartCommandInTransactionArgs,
): EngineCommandEnvelope {
  if (
    getActiveThreadOperation(
      { db: tx },
      {
        kind: "start",
        threadId: args.thread.id,
      },
    ) !== null
  ) {
    throwThreadNotWritable(
      args.thread,
      "still_starting",
      "Thread is still starting",
    );
  }

  const commandId = createHostDaemonCommandId();
  createPendingClientTurnRequestInTransaction(tx, {
    commandId,
    commandType: "thread.start",
    environmentId: args.command.command.environmentId,
    requestEventSequence: args.requestEventSequence,
    requestId: args.command.command.requestId,
    threadId: args.command.command.threadId,
  });
  upsertThreadOperationRecord(tx, {
    threadId: args.command.command.threadId,
    kind: "start",
    payload: JSON.stringify(args.command.command),
  });
  const queuedOperation = markThreadOperationRecordQueued(tx, {
    threadId: args.command.command.threadId,
    kind: "start",
    commandId,
  });
  if (!queuedOperation) {
    throw new Error(
      `Failed to mark thread start operation queued for ${args.command.command.threadId}`,
    );
  }
  return { command: args.command.command, commandId };
}

export function queuePreparedReadyThreadTurnCommandInTransaction(
  tx: DbTransaction,
  args: QueuePreparedReadyThreadTurnCommandInTransactionArgs,
): QueuedReadyThreadTurnCommand {
  if (args.command.mode === "turn.submit") {
    return {
      envelope: queueTurnSubmitCommandInTransaction(tx, {
        command: args.command.command,
        requestEventSequence: args.requestEventSequence,
      }),
      mode: "turn.submit",
    };
  }

  return {
    envelope: queuePreparedThreadStartCommandInTransaction(tx, {
      command: args.command,
      requestEventSequence: args.requestEventSequence,
      thread: args.thread,
    }),
    mode: "thread.start",
  };
}

export function hasActiveThreadStartOperationForCommand(
  deps: ThreadLifecycleReadDeps,
  args: ThreadOperationCommandMutationArgs,
): boolean {
  return (
    getActiveThreadOperationByCommandId(deps, {
      commandId: args.commandId,
      kind: "start",
    }) !== null
  );
}

export function hasActiveThreadStopOperationForCommand(
  deps: ThreadLifecycleReadDeps,
  args: ThreadOperationCommandMutationArgs,
): boolean {
  return (
    getActiveThreadOperationByCommandId(deps, {
      commandId: args.commandId,
      kind: "stop",
    }) !== null
  );
}

export function completeThreadStart(
  deps: ThreadLifecycleReadDeps,
  args: ThreadOperationMutationArgs,
): boolean {
  const operation = getActiveThreadOperation(deps, {
    threadId: args.threadId,
    kind: "start",
  });
  if (!operation) {
    return false;
  }

  markThreadOperationRecordCompleted(deps.db, {
    threadId: args.threadId,
    kind: operation.kind,
  });
  return true;
}

export function settleThreadStopCommandResult(
  args: SettleThreadStopCommandResultArgs,
): CommandResultSideEffectsResult {
  const operation = getActiveThreadOperationByCommandId(args.deps, {
    commandId: args.commandRow.id,
    kind: "stop",
  });
  if (!operation) {
    return emptyCommandResultSideEffects();
  }

  if (!args.report.ok) {
    markThreadOperationRecordFailed(args.deps.db, {
      threadId: operation.threadId,
      kind: operation.kind,
      failureReason: args.report.errorMessage,
    });
    return emptyCommandResultSideEffects();
  }

  finalizeStoppedThreadInTransaction(args.deps, {
    expectedCommandId: args.commandRow.id,
    threadId: args.command.threadId,
  });

  return {
    postCommitActions: [
      {
        name: "Provider archive forwarding after thread stop",
        context: {
          environmentId: args.command.environmentId,
          threadId: args.command.threadId,
        },
        run: (deps) => {
          queueSettledArchivedThreadProviderArchiveCommand(deps, {
            threadId: args.command.threadId,
          });
        },
      },
      {
        name: "Environment cleanup advance after thread stop",
        context: {
          environmentId: args.command.environmentId,
          threadId: args.command.threadId,
        },
        run: (deps) =>
          runEnvironmentCleanupAdvance(deps, {
            environmentId: args.command.environmentId,
          }),
      },
    ],
  };
}

async function advanceActiveThreadStartIfPresent(
  deps: WorkSessionDeps,
  args: QueueThreadStartCommandArgs,
): Promise<boolean> {
  const operation = getThreadOperation(deps.db, {
    threadId: args.thread.id,
    kind: "start",
  });
  if (!operation || !isActiveLifecycleOperationState(operation.state)) {
    return false;
  }

  if (deps.engineDispatch.isCommandInFlight(operation.commandId)) {
    return true;
  }
  if (operation.state !== "requested") {
    return false;
  }

  await advanceThreadStart(deps, {
    threadId: args.thread.id,
  });
  return true;
}

function hasQueuedActiveThreadStart(
  deps: WorkSessionDeps,
  args: QueueThreadStartCommandArgs,
): boolean {
  const operation = getThreadOperation(deps.db, {
    threadId: args.thread.id,
    kind: "start",
  });
  return (
    operation !== null &&
    isActiveLifecycleOperationState(operation.state) &&
    deps.engineDispatch.isCommandInFlight(operation.commandId)
  );
}

/**
 * Makes the provision-to-start durability boundary atomic: after a crash, the
 * thread should have either an active provision op to retry or an active start
 * op for the lifecycle sweep to advance.
 */
function requestThreadStartHandoff(
  deps: Pick<AppDeps, "db" | "engineDispatch" | "hub">,
  args: RequestThreadStartHandoffArgs,
): RequestThreadStartHandoffResult {
  const result: RequestThreadStartHandoffResult = deps.db.transaction(
    (tx) => {
      const currentThread = getThread(tx, args.threadId);
      const isProvisionHandoff = args.sourceThreadStatus === "provisioning";
      if (
        !currentThread ||
        currentThread.deletedAt !== null ||
        currentThread.archivedAt !== null ||
        currentThread.stopRequestedAt !== null
      ) {
        return {
          completedProvisionSequence: null,
          disposition: "blocked",
        };
      }

      const existingStartOperation = getThreadOperation(tx, {
        threadId: args.threadId,
        kind: "start",
      });
      if (
        existingStartOperation &&
        isActiveLifecycleOperationState(existingStartOperation.state) &&
        deps.engineDispatch.isCommandInFlight(existingStartOperation.commandId)
      ) {
        return {
          completedProvisionSequence: null,
          disposition: "existing-start",
        };
      }

      const provisionOperation = getThreadOperation(tx, {
        threadId: args.threadId,
        kind: "provision",
      });
      if (
        isProvisionHandoff &&
        (!isPreStartThreadStatus(currentThread.status) ||
          !(
            provisionOperation &&
            isActiveLifecycleOperationState(provisionOperation.state)
          )
        )
      ) {
        return {
          completedProvisionSequence: null,
          disposition: "blocked",
        };
      }

      let completedProvisionSequence: number | null = null;
      if (
        provisionOperation &&
        isActiveLifecycleOperationState(provisionOperation.state)
      ) {
        completedProvisionSequence = appendThreadProvisioningEventInTransaction(
          tx,
          {
            threadId: args.threadId,
            environmentId: args.environmentId,
            provisioningId:
              readThreadProvisioningIdFromRecord(provisionOperation),
            status: "completed",
            entries: [],
          },
        );
        markThreadOperationRecordCompleted(tx, {
          threadId: args.threadId,
          kind: "provision",
        });
      }
      upsertThreadOperationRecord(tx, {
        threadId: args.threadId,
        kind: "start",
        payload: JSON.stringify(args.baseCommand),
      });
      return {
        completedProvisionSequence,
        disposition: "created",
      };
    },
    { behavior: "immediate" },
  );

  if (result.completedProvisionSequence !== null) {
    deps.hub.notifyThread(args.threadId, ["events-appended"], {
      eventTypes: ["system/thread-provisioning"],
    });
  }
  return result;
}

export async function requestThreadStart(
  deps: LoggedWorkSessionDeps,
  args: QueueThreadStartCommandArgs,
): Promise<void> {
  await threadStartRequestDeduper.run(args.thread.id, () =>
    requestThreadStartOnce(deps, args),
  );
}

async function requestThreadStartOnce(
  deps: LoggedWorkSessionDeps,
  args: QueueThreadStartCommandArgs,
): Promise<void> {
  if (await advanceActiveThreadStartIfPresent(deps, args)) {
    return;
  }

  const baseCommand = await buildThreadStartCommand(deps, {
    ...args,
  });
  if (hasQueuedActiveThreadStart(deps, args)) {
    return;
  }

  const handoff = requestThreadStartHandoff(deps, {
    baseCommand,
    environmentId: args.environment.id,
    sourceThreadStatus: args.thread.status,
    threadId: args.thread.id,
  });
  if (handoff.disposition === "existing-start") {
    await advanceActiveThreadStartIfPresent(deps, args);
    return;
  }
  if (handoff.disposition === "blocked") {
    return;
  }

  await advanceThreadStart(deps, {
    threadId: args.thread.id,
  });
}

export async function advanceThreadStart(
  deps: WorkSessionDeps,
  args: AdvanceThreadOperationArgs,
): Promise<string | null> {
  const operation = getThreadOperation(deps.db, {
    threadId: args.threadId,
    kind: "start",
  });
  if (!operation || !isActiveLifecycleOperationState(operation.state)) {
    return null;
  }

  if (deps.engineDispatch.isCommandInFlight(operation.commandId)) {
    return operation.commandId;
  }

  const command = parseJsonWithSchema(
    operation.payload,
    threadStartCommandSchema,
  );
  const commandId = createHostDaemonCommandId();
  deps.db.transaction(
    (tx) => {
      const requestEventSequence =
        findStoredClientTurnRequestSequenceByRequestId(tx, {
          requestId: command.requestId,
          threadId: command.threadId,
        });
      if (requestEventSequence !== null) {
        createPendingClientTurnRequestInTransaction(tx, {
          commandId,
          commandType: "thread.start",
          environmentId: command.environmentId,
          requestEventSequence,
          requestId: command.requestId,
          threadId: command.threadId,
        });
      }
      markThreadOperationRecordQueued(tx, {
        threadId: args.threadId,
        kind: "start",
        commandId,
      });
    },
    { behavior: "immediate" },
  );
  deps.engineDispatch.dispatch({ command, commandId });
  return commandId;
}

export function requestThreadStop(
  deps: Pick<AppDeps, "db" | "engineDispatch" | "hub">,
  args: RequestThreadStopArgs,
): void {
  if (args.stopRequestedAt === null) {
    markThreadStopRequested(deps.db, deps.hub, {
      threadId: args.threadId,
    });
  }

  const existingOperation = getThreadOperation(deps.db, {
    threadId: args.threadId,
    kind: "stop",
  });
  if (
    existingOperation &&
    isActiveLifecycleOperationState(existingOperation.state)
  ) {
    if (deps.engineDispatch.isCommandInFlight(existingOperation.commandId)) {
      return;
    }
    advanceThreadStop(deps, {
      threadId: args.threadId,
    });
    return;
  }

  const interruptionReason =
    args.stopRequestedAt === null
      ? args.interruptionReason
      : (readThreadStopInterruptionReason(existingOperation) ??
        args.interruptionReason);
  const payload: ThreadStopOperationPayload = {
    command: buildThreadStopCommand(args),
    interruptionReason,
  };
  upsertThreadOperationRecord(deps.db, {
    threadId: args.threadId,
    kind: "stop",
    payload: JSON.stringify(payload),
  });
  advanceThreadStop(deps, {
    threadId: args.threadId,
  });
}

function requestPreStartThreadStop(
  deps: RequestThreadStopForCurrentStateDeps,
  thread: RequestThreadStopForCurrentStateThread,
): void {
  const notificationBuffer = new NotificationBuffer();
  const engineDispatches = new EngineDispatchBuffer();
  const result: RequestPreStartThreadStopResult = deps.db.transaction(
    (tx) => {
      const txDeps = {
        ...deps,
        db: tx,
        engineDispatches,
        hub: notificationBuffer,
      };
      const currentThread = getThread(tx, thread.id);
      if (!currentThread) {
        return { environmentId: null, finalized: true };
      }

      const provisionOperation = getActiveThreadOperation(txDeps, {
        threadId: currentThread.id,
        kind: "provision",
      });
      if (
        !isPreStartThreadStatus(currentThread.status) &&
        provisionOperation === null
      ) {
        return { environmentId: currentThread.environmentId, finalized: false };
      }

      if (currentThread.stopRequestedAt === null) {
        markThreadStopRequested(tx, notificationBuffer, {
          threadId: currentThread.id,
        });
        appendThreadInterruptedEventInTransaction(tx, {
          threadId: currentThread.id,
          reason: "manual-stop",
        });
        notificationBuffer.notifyThread(currentThread.id, ["events-appended"], {
          eventTypes: ["system/thread/interrupted"],
        });
        appendProvisioningInterruptedEventInTransaction(
          txDeps,
          currentThread,
          provisionOperation,
        );
      }

      if (provisionOperation !== null) {
        cancelThreadOperationRecord(tx, {
          threadId: currentThread.id,
          kind: "provision",
        });
      }

      const environmentId = currentThread.environmentId;
      const cancellation =
        environmentId === null
          ? "ready_to_finalize"
          : cancelEnvironmentProvisioningForThreadStopInTransaction(txDeps, {
              environmentId,
              threadId: currentThread.id,
            });
      if (cancellation === "awaiting_host_cancel") {
        return { environmentId, finalized: false };
      }

      const finalized = finalizeStoppedThreadInTransaction(txDeps, {
        threadId: currentThread.id,
      });
      return { environmentId, finalized };
    },
    { behavior: "immediate" },
  );
  notificationBuffer.flushInto(deps.hub);
  engineDispatches.flushInto(deps.engineDispatch);

  if (result.finalized && result.environmentId !== null) {
    requestEnvironmentCleanup(deps, { environmentId: result.environmentId });
    requestEnvironmentCleanupAdvance(deps, {
      environmentId: result.environmentId,
    });
  }
}

export function requestThreadStopForCurrentState(
  deps: RequestThreadStopForCurrentStateDeps,
  thread: RequestThreadStopForCurrentStateThread,
  environment: RequestThreadStopForCurrentStateEnvironment | null,
): void {
  if (
    thread.status === "active" ||
    hasActiveThreadOperation(deps, { kind: "start", threadId: thread.id })
  ) {
    if (environment === null) {
      return;
    }
    requestThreadStop(deps, {
      environmentId: environment.id,
      interruptionReason: "manual-stop",
      stopRequestedAt: thread.stopRequestedAt,
      threadId: thread.id,
    });
    return;
  }

  if (
    isPreStartThreadStatus(thread.status) ||
    hasActiveThreadOperation(deps, { kind: "provision", threadId: thread.id })
  ) {
    requestPreStartThreadStop(deps, thread);
  }
}

/**
 * Requests a daemon stop only for active runtime work. Pre-start provisioning
 * cancellation goes through requestThreadStopForCurrentState.
 */
export function requestActiveRuntimeThreadStopIfNeeded(
  deps: Pick<AppDeps, "db" | "engineDispatch" | "hub">,
  thread: Pick<Thread, "id" | "status" | "stopRequestedAt">,
  environment: {
    id: string;
  },
): void {
  if (
    thread.status !== "active" &&
    !hasActiveThreadOperation(deps, { kind: "start", threadId: thread.id })
  ) {
    return;
  }
  requestThreadStop(deps, {
    environmentId: environment.id,
    interruptionReason: "manual-stop",
    stopRequestedAt: thread.stopRequestedAt,
    threadId: thread.id,
  });
}

export function interruptActiveTurnForThread(
  deps: Pick<AppDeps, "db" | "hub">,
  args: InterruptActiveTurnForThreadArgs,
): boolean {
  return deps.db.transaction(
    (tx) =>
      interruptActiveTurnForThreadInTransaction(
        { db: tx, hub: deps.hub },
        args,
      ),
    { behavior: "immediate" },
  );
}

function interruptActiveTurnForThreadInTransaction(
  deps: ThreadLifecycleTransactionDeps,
  args: InterruptActiveTurnForThreadArgs,
): boolean {
  const activeTurnId = getActiveTurnId(deps, args.threadId);
  if (!activeTurnId) {
    return false;
  }

  const providerThreadId = getLastProviderThreadId(deps, args.threadId);

  applyActiveTurnInterruptionInTransaction(deps.db, {
    activeTurnId,
    environmentId: args.environmentId,
    providerThreadId,
    reason: args.reason,
    threadId: args.threadId,
  });
  deps.hub.notifyThread(args.threadId, ["events-appended", "status-changed"], {
    eventTypes: ["turn/completed", "system/thread/interrupted"],
  });

  return true;
}

/**
 * Reconciles threads whose server status is active after the host runtime no
 * longer reports them. Every supplied thread gets a thread interruption event;
 * threads with an open turn also get an interrupted turn completion event.
 */
export function interruptActiveThreads(
  deps: Pick<AppDeps, "db" | "hub" | "pendingInteractions">,
  args: InterruptActiveThreadsArgs,
): InterruptActiveThreadsResult {
  if (args.threads.length === 0) {
    return { threads: [] };
  }

  const results: InterruptedActiveThreadResult[] = [];
  const threadIds = args.threads.map((thread) => thread.threadId);
  const nextStatus = nextStatusForInterruptedThread(args.reason);

  deps.db.transaction(
    (tx) => {
      const stateByThreadId = new Map(
        listThreadTurnInterruptionEventStates(tx, { threadIds }).map(
          (state) => [state.threadId, state],
        ),
      );
      const eventArgs: ThreadEventAppendArgs[] = [];

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

  deps.pendingInteractions.interruptPendingInteractionsForThreadIds({
    threadIds: results.map((result) => result.threadId),
    reason: pendingInteractionStopReason(args.reason),
  });

  for (const result of results) {
    const eventTypes: ThreadEventType[] = ["system/thread/interrupted"];
    if (result.interruptedTurnId !== null) {
      eventTypes.unshift("turn/completed");
    }
    deps.hub.notifyThread(
      result.threadId,
      ["events-appended", "status-changed"],
      {
        eventTypes,
      },
    );
  }

  return { threads: results };
}

function advanceThreadStop(
  deps: Pick<AppDeps, "db" | "engineDispatch" | "hub">,
  args: AdvanceThreadOperationArgs,
): string | null {
  const operation = getThreadOperation(deps.db, {
    threadId: args.threadId,
    kind: "stop",
  });
  if (!operation || !isActiveLifecycleOperationState(operation.state)) {
    return null;
  }

  if (deps.engineDispatch.isCommandInFlight(operation.commandId)) {
    return operation.commandId;
  }

  const { command } = parseThreadStopOperationPayload(operation.payload);
  const commandId = createHostDaemonCommandId();
  markThreadOperationRecordQueued(deps.db, {
    threadId: args.threadId,
    kind: "stop",
    commandId,
  });
  deps.engineDispatch.dispatch({ command, commandId });
  return commandId;
}

export function finalizeStoppedThread(
  deps: PendingInteractionWorkSessionDeps,
  args: FinalizeStoppedThreadArgs,
): boolean {
  const notificationBuffer = new NotificationBuffer();
  const engineDispatches = new EngineDispatchBuffer();
  const finalized = deps.db.transaction(
    (tx) =>
      finalizeStoppedThreadInTransaction(
        {
          ...deps,
          db: tx,
          engineDispatches,
          hub: notificationBuffer,
        },
        args,
      ),
    { behavior: "immediate" },
  );
  notificationBuffer.flushInto(deps.hub);
  engineDispatches.flushInto(deps.engineDispatch);
  if (finalized) {
    queueSettledArchivedThreadProviderArchiveCommand(deps, {
      threadId: args.threadId,
    });
  }
  return finalized;
}

export function finalizeStoppedThreadInTransaction(
  deps: FinalizeStoppedThreadTransactionDeps,
  args: FinalizeStoppedThreadArgs,
): boolean {
  const currentThread = getThread(deps.db, args.threadId);
  if (!currentThread) {
    return true;
  }

  const startOperation = getActiveThreadOperation(deps, {
    threadId: args.threadId,
    kind: "start",
  });
  if (startOperation) {
    return false;
  }

  const stopOperation = getActiveThreadOperation(deps, {
    threadId: args.threadId,
    kind: "stop",
  });
  if (
    args.expectedCommandId &&
    stopOperation &&
    stopOperation.commandId !== args.expectedCommandId
  ) {
    return false;
  }
  const stopCommandState = getThreadOperationCommandState(
    deps,
    stopOperation?.commandId ?? null,
  );
  const isSettlingExpectedCommand =
    args.expectedCommandId !== undefined &&
    stopOperation?.commandId === args.expectedCommandId;
  // An in-flight stop dispatch owns finalization; the daemon-era "pending"
  // (queued-but-cancellable) branch died with the durable queue — a dispatch
  // is in the engine's hands the moment it exists.
  if (stopCommandState === "fetched" && !isSettlingExpectedCommand) {
    return false;
  }

  const interruptionReason =
    readThreadStopInterruptionReason(stopOperation) ?? "manual-stop";
  settleInterruptedClientTurnRequestsForThreadsInTransaction(deps.db, {
    reason: interruptionReason,
    threadIds: [currentThread.id],
  });
  let appendedThreadInterruptedEvent = false;
  if (currentThread.status === "active") {
    appendedThreadInterruptedEvent = interruptActiveTurnForThreadInTransaction(
      deps,
      {
        environmentId: currentThread.environmentId,
        threadId: currentThread.id,
        reason: interruptionReason,
      },
    );
    if (!appendedThreadInterruptedEvent) {
      tryTransitionInTransaction(
        deps.db,
        deps.hub,
        currentThread.id,
        nextStatusForInterruptedThread(interruptionReason),
      );
    }
  } else if (isPreStartThreadStatus(currentThread.status)) {
    tryTransitionInTransaction(
      deps.db,
      deps.hub,
      currentThread.id,
      nextStatusForInterruptedThread(interruptionReason),
    );
  }

  const completedStopOperation = getActiveThreadOperation(deps, {
    threadId: args.threadId,
    kind: "stop",
  });
  if (completedStopOperation) {
    markThreadOperationRecordCompleted(deps.db, {
      threadId: args.threadId,
      kind: completedStopOperation.kind,
    });
  }

  if (currentThread.stopRequestedAt !== null) {
    clearThreadStopRequested(deps.db, deps.hub, currentThread.id);
  }

  const finalizedThread = getThread(deps.db, args.threadId);
  if (!finalizedThread) {
    return true;
  }

  if (finalizedThread.deletedAt === null) {
    deps.pendingInteractions.interruptPendingInteractionsForThreadIdsInTransaction(
      deps,
      {
        threadIds: [finalizedThread.id],
        reason: pendingInteractionStopReason(interruptionReason),
      },
    );
    if (
      !appendedThreadInterruptedEvent &&
      !hasThreadInterruptedEvent(deps, finalizedThread.id)
    ) {
      appendThreadInterruptedEventInTransaction(deps.db, {
        threadId: finalizedThread.id,
        reason: interruptionReason,
      });
      deps.hub.notifyThread(finalizedThread.id, ["events-appended"], {
        eventTypes: ["system/thread/interrupted"],
      });
    }
  }

  if (finalizedThread.deletedAt !== null) {
    deps.pendingInteractions.interruptPendingInteractionsForThreadIdsInTransaction(
      deps,
      {
        threadIds: [finalizedThread.id],
        reason: "Thread was deleted while awaiting user interaction",
      },
    );

    const environmentId = finalizedThread.environmentId;
    const environment = environmentId
      ? getEnvironment(deps.db, environmentId)
      : null;
    if (environment) {
      queueThreadDeletedCommandInTransaction(deps.engineDispatches, {
        environment: { hostId: environment.hostId, id: environment.id },
        threadId: finalizedThread.id,
      });
    }
    deleteThread(deps.db, deps.hub, finalizedThread.id);
    requestEnvironmentCleanup(deps, {
      environmentId,
    });
    return true;
  }

  return true;
}

export async function finalizeStoppedThreadAndAdvanceCleanup(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: FinalizeStoppedThreadArgs,
): Promise<boolean> {
  const threadBeforeFinalize = getThread(deps.db, args.threadId);
  const finalized = finalizeStoppedThread(deps, args);
  if (!finalized) {
    return false;
  }

  const threadAfterFinalize = getThread(deps.db, args.threadId);
  const environmentId =
    threadAfterFinalize?.environmentId ??
    threadBeforeFinalize?.environmentId ??
    null;
  if (environmentId) {
    await advanceEnvironmentCleanup(deps, { environmentId });
  }
  return true;
}

export function finalizeStoppedThreadAndRequestCleanupAdvance(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: FinalizeStoppedThreadArgs,
): boolean {
  const threadBeforeFinalize = getThread(deps.db, args.threadId);
  const finalized = finalizeStoppedThread(deps, args);
  if (!finalized) {
    return false;
  }

  const threadAfterFinalize = getThread(deps.db, args.threadId);
  const environmentId =
    threadAfterFinalize?.environmentId ??
    threadBeforeFinalize?.environmentId ??
    null;
  requestEnvironmentCleanupAdvance(deps, { environmentId });
  return true;
}

export async function reconcileDaemonReportedThreads(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: ReconcileDaemonReportedThreadsArgs,
): Promise<void> {
  const activeThreadIdSet = new Set(args.activeThreadIds);

  const pendingThreads = deps.db
    .select({
      deletedAt: threads.deletedAt,
      environmentId: environments.id,
      id: threads.id,
      status: threads.status,
      stopRequestedAt: threads.stopRequestedAt,
    })
    .from(threads)
    .innerJoin(environments, eq(threads.environmentId, environments.id))
    .where(
      and(
        eq(environments.hostId, args.hostId),
        inArray(threads.status, [
          "active",
          "created",
          "idle",
          "error",
          "provisioning",
        ]),
        or(isNotNull(threads.deletedAt), isNotNull(threads.stopRequestedAt)),
      ),
    )
    .all();

  for (const thread of pendingThreads) {
    if (activeThreadIdSet.has(thread.id)) {
      requestThreadStop(deps, {
        environmentId: thread.environmentId,
        interruptionReason: "manual-stop",
        stopRequestedAt: thread.stopRequestedAt,
        threadId: thread.id,
      });
      continue;
    }

    finalizeStoppedThreadAndRequestCleanupAdvance(deps, {
      threadId: thread.id,
    });
  }

  if (args.activeThreadIds.length > 0) {
    const erroredThreads = deps.db
      .select({ id: threads.id })
      .from(threads)
      .innerJoin(environments, eq(threads.environmentId, environments.id))
      .where(
        and(
          eq(environments.hostId, args.hostId),
          eq(threads.status, "error"),
          isNull(threads.deletedAt),
          isNull(threads.stopRequestedAt),
          inArray(threads.id, [...args.activeThreadIds]),
        ),
      )
      .all();

    for (const thread of erroredThreads) {
      tryTransition(deps.db, deps.hub, thread.id, "active");
    }
  }

  const activeButMissing = deps.db
    .select({ environmentId: environments.id, id: threads.id })
    .from(threads)
    .innerJoin(environments, eq(threads.environmentId, environments.id))
    .where(
      and(
        eq(environments.hostId, args.hostId),
        eq(threads.status, "active"),
        isNull(threads.deletedAt),
        isNull(threads.stopRequestedAt),
        args.activeThreadIds.length > 0
          ? notInArray(threads.id, [...args.activeThreadIds])
          : undefined,
      ),
    )
    .all();

  interruptActiveThreads(deps, {
    threads: activeButMissing.map((thread) => ({
      environmentId: thread.environmentId,
      threadId: thread.id,
    })),
    reason: "host-daemon-restarted",
  });

  if (args.activeThreadIds.length === 0) {
    return;
  }

  const inactiveButActive = deps.db
    .select({ id: threads.id })
    .from(threads)
    .innerJoin(environments, eq(threads.environmentId, environments.id))
    .where(
      and(
        eq(environments.hostId, args.hostId),
        inArray(threads.status, ["created", "provisioning", "idle"]),
        isNull(threads.deletedAt),
        isNull(threads.stopRequestedAt),
        inArray(threads.id, [...args.activeThreadIds]),
      ),
    )
    .all();

  const blockedRevivalThreadIds = new Set(
    listThreadIdsWithLatestHostDaemonRestartInterruption(deps.db, {
      threadIds: inactiveButActive.map((thread) => thread.id),
    }),
  );

  for (const thread of inactiveButActive) {
    if (blockedRevivalThreadIds.has(thread.id)) {
      continue;
    }
    tryTransition(deps.db, deps.hub, thread.id, "active");
    completeThreadStart(deps, {
      threadId: thread.id,
    });
  }
}
