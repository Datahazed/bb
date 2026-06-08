import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import {
  createHostDaemonCommandId,
  type DbNotifier,
  type DbQueryConnection,
  type DbTransaction,
  type EnvironmentOperationRow,
  getEnvironment,
  getEnvironmentOperationByCommandId,
  getThreadOperation,
  listStoredThreadProvisioningRowsByProvisioningId,
  threadOperations,
  threads,
} from "@bb/db";
import {
  applyProvisionedEnvironmentRecord,
  cancelEnvironmentOperationRecord,
  markEnvironmentOperationRecordCompleted,
  markEnvironmentOperationRecordFailed,
  markEnvironmentOperationRecordQueued,
  setEnvironmentStatus,
  upsertEnvironmentOperationRecord,
} from "@bb/db/internal-environment-lifecycle";
import type {
  Environment,
  ProvisioningTranscriptEntry,
  SystemThreadProvisioningStatus,
  ThreadProvisioningStage,
  ThreadStatus,
} from "@bb/domain";
import {
  activeLifecycleOperationStates,
  isActiveLifecycleOperationState,
  systemThreadProvisioningEventDataSchema,
  threadScope,
} from "@bb/domain";
import type {
  AppDeps,
  LoggedWorkSessionDeps,
  WorkSessionDeps,
} from "../../types.js";
import { ApiError } from "../../errors.js";
import {
  appendSystemErrorEventInTransaction,
  appendThreadProvisioningEventInTransaction,
  buildCwdBranchEntries,
} from "../threads/thread-events.js";
import {
  buildEnvironmentProvisionCommand,
  buildManagedBranchName,
  SETUP_TIMEOUT_MS,
  requireSourceForHost,
  storedBaseBranchNameToSpec,
} from "../threads/thread-create-helpers.js";
import {
  resolveManagedTargetPath,
  resolvePersonalTargetPath,
} from "../threads/worktree-paths.js";
import {
  buildDirectEnvironmentProvisionRequest,
  environmentProvisionRequestSchema,
  type EnvironmentProvisionRequest,
} from "./environment-provision-request.js";
import { parseJsonWithSchema } from "../lib/json-parsing.js";
import { tryTransitionInTransaction } from "../threads/thread-transitions.js";
import { readThreadProvisioningIdFromRecord } from "../threads/thread-provisioning-context.js";
import {
  advanceThreadProvisioning,
  recordThreadProvisionWorkspaceReadyInTransaction,
} from "../threads/thread-provisioning.js";
import {
  finalizeStoppedThreadAndRequestCleanupAdvance,
  finalizeStoppedThreadInTransaction,
  requestThreadStopForCurrentState,
} from "../threads/thread-lifecycle.js";
import { runEnvironmentCleanupAdvance } from "./environment-cleanup-internal.js";
import {
  getActiveEnvironmentProvisionOperation,
  type EnvironmentProvisionOperationKind,
} from "./environment-provisioning-operations.js";
import {
  emptyCommandResultSideEffects,
  type CommandResultPostCommitAction,
  type CommandResultReportForType,
  type CommandResultSideEffectsResult,
  type HostDaemonCommandForType,
  type SettledEngineCommand,
} from "../engine/command-result-side-effects.js";
import type { EngineDispatchBuffer } from "../engine/engine-dispatch.js";

type EnvironmentProvisionCommand =
  HostDaemonCommandForType<"environment.provision">;
type EnvironmentProvisionCommandResultReport =
  CommandResultReportForType<"environment.provision">;
type EnvironmentProvisionCancelCommand =
  HostDaemonCommandForType<"environment.provision.cancel">;
type EnvironmentProvisionCancelCommandResultReport =
  CommandResultReportForType<"environment.provision.cancel">;

interface EnvironmentProvisionReadDeps {
  db: DbQueryConnection;
}

interface EnvironmentProvisionWriteDeps extends EnvironmentProvisionReadDeps {
  hub: DbNotifier;
}

interface EnvironmentProvisionTransactionDeps extends EnvironmentProvisionWriteDeps {
  db: DbTransaction;
  engineDispatch: AppDeps["engineDispatch"];
  /** Follow-up dispatches staged in-transaction; flushed by the tx owner. */
  engineDispatches: EngineDispatchBuffer;
  logger: AppDeps["logger"];
  pendingInteractions: AppDeps["pendingInteractions"];
}

interface RequestEnvironmentProvisionArgs {
  environmentId: string;
  request: EnvironmentProvisionRequest;
}

interface RequestEnvironmentReprovisionArgs extends RequestEnvironmentProvisionArgs {}

interface AdvanceEnvironmentProvisioningArgs {
  environmentId: string | null | undefined;
}

interface SettleEnvironmentProvisionCommandResultArgs {
  command: EnvironmentProvisionCommand;
  settledCommand: SettledEngineCommand;
  deps: EnvironmentProvisionTransactionDeps;
  report: EnvironmentProvisionCommandResultReport;
}

interface SettleEnvironmentProvisionCancelCommandResultArgs {
  command: EnvironmentProvisionCancelCommand;
  settledCommand: SettledEngineCommand;
  deps: EnvironmentProvisionTransactionDeps;
  report: EnvironmentProvisionCancelCommandResultReport;
}

interface QueueEnvironmentProvisionCommandArgs {
  command: EnvironmentProvisionCommand;
  environment: Environment;
  kind: EnvironmentProvisionOperationKind;
}

interface FailEnvironmentProvisioningDurablyArgs {
  commandId: string;
  environmentId: string;
  failureEntry: ProvisioningTranscriptEntry;
  failureReason: string;
}

interface LiveEnvironmentThread {
  id: string;
  provisionEventSequence: number | null;
  provisionOperationProvisioningEnvironmentId: string | null;
  provisionOperationProvisioningId: string | null;
  provisionOperationProvisioningStage: ThreadProvisioningStage | null;
  stopRequestedAt: number | null;
  workspaceReadyEventSequence: number | null;
}

interface StopRequestedEnvironmentProvisionThread {
  id: string;
  status: ThreadStatus;
  stopRequestedAt: number | null;
}

interface AppendThreadProvisioningEventToEnvironmentThreadsArgs {
  entries: ProvisioningTranscriptEntry[];
  environmentId: string;
  fallbackProvisioningId: string;
  status: SystemThreadProvisioningStatus;
  threads?: LiveEnvironmentThread[];
}

function listLiveEnvironmentThreads(
  deps: EnvironmentProvisionReadDeps,
  environmentId: string,
): LiveEnvironmentThread[] {
  return deps.db
    .select({
      id: threads.id,
      provisionEventSequence: threadOperations.provisionEventSequence,
      provisionOperationProvisioningEnvironmentId:
        threadOperations.provisioningEnvironmentId,
      provisionOperationProvisioningId: threadOperations.provisioningId,
      provisionOperationProvisioningStage: threadOperations.provisioningStage,
      stopRequestedAt: threads.stopRequestedAt,
      workspaceReadyEventSequence: threadOperations.workspaceReadyEventSequence,
    })
    .from(threads)
    .leftJoin(
      threadOperations,
      and(
        eq(threadOperations.threadId, threads.id),
        eq(threadOperations.kind, "provision"),
        inArray(threadOperations.state, [...activeLifecycleOperationStates]),
      ),
    )
    .where(
      and(eq(threads.environmentId, environmentId), isNull(threads.deletedAt)),
    )
    .all();
}

function listStopRequestedEnvironmentProvisionThreads(
  deps: EnvironmentProvisionReadDeps,
  environmentId: string,
): StopRequestedEnvironmentProvisionThread[] {
  return deps.db
    .select({
      id: threads.id,
      status: threads.status,
      stopRequestedAt: threads.stopRequestedAt,
    })
    .from(threads)
    .where(
      and(
        eq(threads.environmentId, environmentId),
        inArray(threads.status, ["created", "provisioning"]),
        // This settlement is for explicit user stop intent only. Archived and
        // deleted threads continue through their existing cleanup paths.
        isNull(threads.archivedAt),
        isNull(threads.deletedAt),
        isNotNull(threads.stopRequestedAt),
      ),
    )
    .all();
}

function resolveLiveThreadProvisioningId(
  thread: LiveEnvironmentThread,
  fallbackProvisioningId: string,
): string {
  if (
    thread.provisionOperationProvisioningId === null &&
    thread.provisionOperationProvisioningStage === null
  ) {
    return fallbackProvisioningId;
  }
  return readThreadProvisioningIdFromRecord({
    provisionEventSequence: thread.provisionEventSequence,
    provisioningEnvironmentId:
      thread.provisionOperationProvisioningEnvironmentId,
    provisioningId: thread.provisionOperationProvisioningId,
    provisioningStage: thread.provisionOperationProvisioningStage,
    workspaceReadyEventSequence: thread.workspaceReadyEventSequence,
  });
}

function appendThreadProvisioningEventToEnvironmentThreadsInTransaction(
  deps: EnvironmentProvisionTransactionDeps,
  args: AppendThreadProvisioningEventToEnvironmentThreadsArgs,
): void {
  const liveThreads =
    args.threads ?? listLiveEnvironmentThreads(deps, args.environmentId);

  for (const thread of liveThreads) {
    const provisioningId = resolveLiveThreadProvisioningId(
      thread,
      args.fallbackProvisioningId,
    );
    appendThreadProvisioningEventInTransaction(deps.db, {
      entries: args.entries,
      environmentId: args.environmentId,
      provisioningId,
      status: args.status,
      threadId: thread.id,
    });
    deps.hub.notifyThread(thread.id, ["events-appended"], {
      eventTypes: ["system/thread-provisioning"],
    });
  }
}

function queueEnvironmentProvisionCommand(
  deps: Pick<AppDeps, "db" | "engineDispatch">,
  args: QueueEnvironmentProvisionCommandArgs,
): string {
  const commandId = createHostDaemonCommandId();
  markEnvironmentOperationRecordQueued(deps.db, {
    environmentId: args.environment.id,
    kind: args.kind,
    commandId,
  });
  deps.engineDispatch.dispatch({ command: args.command, commandId });
  return commandId;
}

function getActiveProvisionOperationByCommandId(
  deps: EnvironmentProvisionReadDeps,
  commandId: string,
) {
  const operation = getEnvironmentOperationByCommandId(deps.db, commandId);
  if (
    !operation ||
    (operation.kind !== "provision" && operation.kind !== "reprovision") ||
    !isActiveLifecycleOperationState(operation.state)
  ) {
    return null;
  }

  return operation;
}

function readEnvironmentProvisioningIdFromOperation(
  operation: EnvironmentOperationRow,
): string {
  return parseJsonWithSchema(
    operation.payload,
    environmentProvisionRequestSchema,
  ).provisioningId;
}

function isWorkspaceProvisioningTranscriptEntry(
  entry: ProvisioningTranscriptEntry,
): boolean {
  return WORKSPACE_PROVISIONING_TRANSCRIPT_KEYS.has(entry.key);
}

const WORKSPACE_PROVISIONING_TRANSCRIPT_KEYS = new Set([
  "git-checkout-completed",
  "git-checkout-failed",
  "git-checkout-started",
  "git-clone-completed",
  "git-clone-failed",
  "git-clone-started",
  "git-worktree-command",
  "git-worktree-completed",
  "git-worktree-failed",
  "git-worktree-started",
  "setup-completed",
  "setup-failed",
  "setup-started",
  "workspace-branch",
  "workspace-path",
  "workspace-source",
  "workspace-target",
]);

function hasStreamedProvisioningTranscript(
  deps: EnvironmentProvisionReadDeps,
  threadId: string,
  provisioningId: string,
): boolean {
  const rows = listStoredThreadProvisioningRowsByProvisioningId(deps.db, {
    threadId,
    provisioningId,
  });

  return rows.some((row) => {
    const eventData = systemThreadProvisioningEventDataSchema.parse(
      JSON.parse(row.data),
    );
    return (
      eventData.provisioningId === provisioningId &&
      eventData.entries.some(isWorkspaceProvisioningTranscriptEntry)
    );
  });
}

function hasActiveThreadProvisionOperation(
  deps: EnvironmentProvisionReadDeps,
  threadId: string,
): boolean {
  const operation = getThreadOperation(deps.db, {
    threadId,
    kind: "provision",
  });
  return Boolean(operation && isActiveLifecycleOperationState(operation.state));
}

function hasCancelledThreadProvisionOperation(
  deps: EnvironmentProvisionReadDeps,
  threadId: string,
): boolean {
  const operation = getThreadOperation(deps.db, {
    threadId,
    kind: "provision",
  });
  return operation?.state === "cancelled";
}

function shouldPreserveThreadProvisionCancellationOutcome(
  deps: EnvironmentProvisionReadDeps,
  thread: LiveEnvironmentThread,
): boolean {
  return (
    thread.stopRequestedAt !== null ||
    hasCancelledThreadProvisionOperation(deps, thread.id)
  );
}

interface ProvisionedEnvironmentBranchMetadata {
  baseBranch?: string | null;
  mergeBaseBranch?: string | null;
}

function resolveProvisionedEnvironmentBranchMetadata(
  command: EnvironmentProvisionCommand,
): ProvisionedEnvironmentBranchMetadata {
  if (command.workspaceProvisionType !== "unmanaged") {
    return {};
  }

  if (!command.checkout) {
    return {};
  }

  if (command.checkout.kind === "new") {
    return {
      baseBranch: null,
      mergeBaseBranch: command.checkout.baseBranch,
    };
  }

  return {
    baseBranch: null,
    mergeBaseBranch: null,
  };
}

export function completeEnvironmentProvisioning(
  deps: EnvironmentProvisionReadDeps,
  args: { environmentId: string },
): boolean {
  const operation = getActiveEnvironmentProvisionOperation(
    deps,
    args.environmentId,
  );
  if (!operation) {
    return false;
  }

  markEnvironmentOperationRecordCompleted(deps.db, {
    environmentId: args.environmentId,
    kind: operation.kind,
  });
  return true;
}

function recordEnvironmentProvisioningFailureInTransaction(
  deps: EnvironmentProvisionTransactionDeps,
  args: FailEnvironmentProvisioningDurablyArgs,
): boolean {
  const environment = getEnvironment(deps.db, args.environmentId);
  if (!environment) {
    return false;
  }
  const operation = getActiveProvisionOperationByCommandId(
    deps,
    args.commandId,
  );
  if (!operation) {
    return false;
  }
  const liveThreads = listLiveEnvironmentThreads(deps, environment.id);
  const failureThreads = liveThreads.filter(
    (thread) => !shouldPreserveThreadProvisionCancellationOutcome(deps, thread),
  );
  const provisioningId = readEnvironmentProvisioningIdFromOperation(operation);

  markEnvironmentOperationRecordFailed(deps.db, {
    environmentId: operation.environmentId,
    kind: operation.kind,
    failureReason: args.failureReason,
  });
  if (environment.status !== "destroyed" && environment.status !== "error") {
    setEnvironmentStatus(deps.db, deps.hub, environment.id, {
      status: "error",
    });
  }

  appendThreadProvisioningEventToEnvironmentThreadsInTransaction(deps, {
    environmentId: environment.id,
    fallbackProvisioningId: provisioningId,
    status: "failed",
    threads: failureThreads,
    entries: [args.failureEntry],
  });

  for (const thread of failureThreads) {
    appendSystemErrorEventInTransaction(deps, {
      threadId: thread.id,
      environmentId: environment.id,
      code: "thread_provisioning_failed",
      message: "Provisioning thread failed",
      detail: args.failureReason,
      scope: threadScope(),
    });
    tryTransitionInTransaction(deps.db, deps.hub, thread.id, "error");
  }

  return true;
}

export function settleEnvironmentProvisionCommandResult(
  args: SettleEnvironmentProvisionCommandResultArgs,
): CommandResultSideEffectsResult {
  const postCommitActions: CommandResultPostCommitAction[] = [];
  const operation = getActiveProvisionOperationByCommandId(
    args.deps,
    args.settledCommand.id,
  );
  if (!operation) {
    return emptyCommandResultSideEffects();
  }

  const environmentProvisioningId =
    readEnvironmentProvisioningIdFromOperation(operation);

  const boundThreads = args.deps.db
    .select()
    .from(threads)
    .where(eq(threads.environmentId, args.command.environmentId))
    .all();

  if (args.report.ok) {
    applyProvisionedEnvironmentRecord(
      args.deps.db,
      args.deps.hub,
      args.command.environmentId,
      {
        path: args.report.result.path,
        status: "ready",
        isGitRepo: args.report.result.isGitRepo,
        isWorktree: args.report.result.isWorktree,
        branchName: args.report.result.branchName,
        defaultBranch: args.report.result.defaultBranch,
        ...resolveProvisionedEnvironmentBranchMetadata(args.command),
      },
    );
    args.deps.hub.notifyEnvironment(args.command.environmentId, [
      "work-status-changed",
    ]);

    const cwdBranchEntries = buildCwdBranchEntries({
      path: args.report.result.path,
      branchName: args.report.result.branchName,
    });

    for (const thread of boundThreads) {
      if (thread.deletedAt !== null) {
        const finalized = finalizeStoppedThreadInTransaction(args.deps, {
          threadId: thread.id,
        });
        if (finalized) {
          postCommitActions.push({
            name: "Environment cleanup advance after deleted thread finalize",
            context: {
              environmentId: args.command.environmentId,
              threadId: thread.id,
            },
            run: (deps) =>
              runEnvironmentCleanupAdvance(deps, {
                environmentId: args.command.environmentId,
              }),
          });
        } else {
          postCommitActions.push({
            name: "Deleted thread finalization retry after environment provision",
            context: {
              environmentId: args.command.environmentId,
              threadId: thread.id,
            },
            run: (deps) => {
              finalizeStoppedThreadAndRequestCleanupAdvance(deps, {
                threadId: thread.id,
              });
            },
          });
        }
        continue;
      }
      if (
        thread.archivedAt !== null ||
        thread.stopRequestedAt !== null ||
        hasCancelledThreadProvisionOperation(args.deps, thread.id)
      ) {
        continue;
      }

      const isInitiator = thread.id === args.command.initiator?.threadId;
      const hasStreamedTranscript =
        isInitiator && args.command.initiator
          ? hasStreamedProvisioningTranscript(
              args.deps,
              thread.id,
              args.command.initiator.provisioningId,
            )
          : false;
      const entries = hasStreamedTranscript
        ? []
        : isInitiator && args.report.result.transcript.length > 0
          ? args.report.result.transcript
          : cwdBranchEntries;

      if (!hasActiveThreadProvisionOperation(args.deps, thread.id)) {
        appendThreadProvisioningEventInTransaction(args.deps.db, {
          threadId: thread.id,
          environmentId: args.command.environmentId,
          provisioningId: environmentProvisioningId,
          status: thread.status === "provisioning" ? "active" : "completed",
          entries,
        });
        args.deps.hub.notifyThread(thread.id, ["events-appended"], {
          eventTypes: ["system/thread-provisioning"],
        });
        continue;
      }

      recordThreadProvisionWorkspaceReadyInTransaction(args.deps, {
        threadId: thread.id,
        environmentId: args.command.environmentId,
        entries,
      });
      postCommitActions.push({
        name: "Thread provisioning advance after workspace ready",
        context: {
          environmentId: args.command.environmentId,
          threadId: thread.id,
        },
        run: (deps) => advanceThreadProvisioning(deps, { threadId: thread.id }),
      });
    }

    markEnvironmentOperationRecordCompleted(args.deps.db, {
      environmentId: operation.environmentId,
      kind: operation.kind,
    });

    postCommitActions.push({
      name: "Environment cleanup advance after provision result",
      context: {
        environmentId: args.command.environmentId,
      },
      run: (deps) =>
        runEnvironmentCleanupAdvance(deps, {
          environmentId: args.command.environmentId,
        }),
    });
    return { postCommitActions };
  }

  const failureRecorded = recordEnvironmentProvisioningFailureInTransaction(
    args.deps,
    {
      commandId: args.settledCommand.id,
      environmentId: args.command.environmentId,
      failureReason: args.report.errorMessage,
      failureEntry: {
        type: "step",
        key: "workspace-failed",
        text: "Workspace setup failed",
        status: "failed",
        startedAt: args.settledCommand.dispatchedAt,
        metadata: { durationMs: Date.now() - args.settledCommand.dispatchedAt },
      },
    },
  );
  if (failureRecorded) {
    postCommitActions.push({
      name: "Environment cleanup advance after provision failure",
      context: {
        environmentId: args.command.environmentId,
      },
      run: (deps) =>
        runEnvironmentCleanupAdvance(deps, {
          environmentId: args.command.environmentId,
        }),
    });
  }
  return { postCommitActions };
}

export function settleEnvironmentProvisionCancelCommandResult(
  args: SettleEnvironmentProvisionCancelCommandResultArgs,
): CommandResultSideEffectsResult {
  const stoppedThreads = listStopRequestedEnvironmentProvisionThreads(
    args.deps,
    args.command.environmentId,
  );
  if (!args.report.ok) {
    const operation = getActiveEnvironmentProvisionOperation(
      args.deps,
      args.command.environmentId,
    );
    args.deps.logger.warn(
      {
        activeProvisionOperationCommandId: operation?.commandId ?? null,
        activeProvisionOperationKind: operation?.kind ?? null,
        activeProvisionOperationState: operation?.state ?? null,
        commandId: args.settledCommand.id,
        environmentId: args.command.environmentId,
        errorCode: args.report.errorCode,
        errorMessage: args.report.errorMessage,
        stoppedThreadCount: stoppedThreads.length,
        stoppedThreadIds: stoppedThreads.map((thread) => thread.id),
      },
      "Environment provision cancel command failed",
    );

    const environment = getEnvironment(args.deps.db, args.command.environmentId);
    if (!environment || stoppedThreads.length === 0) {
      return emptyCommandResultSideEffects();
    }

    return {
      postCommitActions: [
        {
          name: "Retry thread stop after provision cancellation failure",
          context: {
            environmentId: args.command.environmentId,
          },
          run: (deps) => {
            for (const thread of stoppedThreads) {
              requestThreadStopForCurrentState(
                deps,
                {
                  environmentId: args.command.environmentId,
                  id: thread.id,
                  status: thread.status,
                  stopRequestedAt: thread.stopRequestedAt,
                },
                {
                  id: environment.id,
                },
              );
            }
          },
        },
      ],
    };
  }

  const postCommitActions: CommandResultPostCommitAction[] = [];
  const operation = getActiveEnvironmentProvisionOperation(
    args.deps,
    args.command.environmentId,
  );
  if (operation) {
    // Cancelling the op record is the whole settlement now: the durable
    // command row the daemon flow also cancelled no longer exists, and a
    // late provision result is ignored because the op is no longer active.
    cancelEnvironmentOperationRecord(args.deps.db, {
      environmentId: operation.environmentId,
      kind: operation.kind,
    });
  }

  const environment = getEnvironment(args.deps.db, args.command.environmentId);
  if (environment?.status === "provisioning") {
    setEnvironmentStatus(args.deps.db, args.deps.hub, environment.id, {
      status: environment.path ? "ready" : "error",
    });
  }

  let finalizedThread = false;
  for (const thread of stoppedThreads) {
    finalizedThread =
      finalizeStoppedThreadInTransaction(args.deps, {
        threadId: thread.id,
      }) || finalizedThread;
  }

  if (finalizedThread) {
    postCommitActions.push({
      name: "Environment cleanup advance after provision cancellation",
      context: {
        environmentId: args.command.environmentId,
      },
      run: (deps) =>
        runEnvironmentCleanupAdvance(deps, {
          environmentId: args.command.environmentId,
        }),
    });
  }

  return { postCommitActions };
}

export function requestEnvironmentProvision(
  deps: EnvironmentProvisionWriteDeps,
  args: RequestEnvironmentProvisionArgs,
): void {
  upsertEnvironmentOperationRecord(deps.db, {
    environmentId: args.environmentId,
    kind: "provision",
    payload: JSON.stringify(args.request),
  });

  const environment = getEnvironment(deps.db, args.environmentId);
  if (environment && environment.status !== "provisioning") {
    setEnvironmentStatus(deps.db, deps.hub, environment.id, {
      status: "provisioning",
    });
  }
}

export function requestEnvironmentReprovision(
  deps: EnvironmentProvisionWriteDeps,
  args: RequestEnvironmentReprovisionArgs,
): void {
  upsertEnvironmentOperationRecord(deps.db, {
    environmentId: args.environmentId,
    kind: "reprovision",
    payload: JSON.stringify(args.request),
  });

  const environment = getEnvironment(deps.db, args.environmentId);
  if (environment && environment.status !== "provisioning") {
    setEnvironmentStatus(deps.db, deps.hub, environment.id, {
      status: "provisioning",
    });
  }
}

export async function advanceEnvironmentProvisioning(
  deps: LoggedWorkSessionDeps,
  args: AdvanceEnvironmentProvisioningArgs,
): Promise<string | null> {
  if (!args.environmentId) {
    return null;
  }

  const environment = getEnvironment(deps.db, args.environmentId);
  if (!environment || environment.status === "destroyed") {
    return null;
  }

  const operation = getActiveEnvironmentProvisionOperation(deps, environment.id);
  if (!operation) {
    return null;
  }

  // The in-flight registry is the re-dispatch guard (plan R9): without it the
  // 10s provisioning sweep would re-dispatch a minutes-long provision every
  // tick.
  if (deps.engineDispatch.isCommandInFlight(operation.commandId)) {
    return operation.commandId;
  }

  const request = parseJsonWithSchema(
    operation.payload,
    environmentProvisionRequestSchema,
  );

  return queueEnvironmentProvisionCommand(deps, {
    command: request.command,
    environment,
    kind: operation.kind,
  });
}

export const MANAGED_REPROVISION_QUEUED = "queued" as const;
export const MANAGED_REPROVISION_IN_PROGRESS = "already-provisioning" as const;
interface QueuedManagedReprovision {
  provisionEventSequence: number;
  status: typeof MANAGED_REPROVISION_QUEUED;
}
type ManagedReprovisionResult =
  | QueuedManagedReprovision
  | typeof MANAGED_REPROVISION_IN_PROGRESS;

interface ActiveManagedEnvironmentProvisionArgs {
  environmentId: string;
}

interface QueueManagedEnvironmentReprovisionArgs {
  environment: Environment;
  projectId: string;
  provisionEventSequence: number;
  provisioningId: string;
  threadId: string;
}

export function hasActiveManagedEnvironmentProvision(
  deps: Pick<AppDeps, "db">,
  args: ActiveManagedEnvironmentProvisionArgs,
): boolean {
  return Boolean(
    getActiveEnvironmentProvisionOperation(deps, args.environmentId),
  );
}

export async function queueManagedEnvironmentReprovision(
  deps: WorkSessionDeps,
  args: QueueManagedEnvironmentReprovisionArgs,
): Promise<ManagedReprovisionResult> {
  const provisionType = args.environment.workspaceProvisionType;
  if (!args.environment.managed || provisionType === "unmanaged") {
    throw new ApiError(
      409,
      "invalid_request",
      "Environment cannot be reprovisioned automatically",
      {
        details: {
          managed: args.environment.managed,
          workspaceProvisionType: provisionType,
        },
      },
    );
  }

  const activeOperation = getActiveEnvironmentProvisionOperation(
    deps,
    args.environment.id,
  );
  if (activeOperation) {
    return MANAGED_REPROVISION_IN_PROGRESS;
  }

  const initiator = {
    threadId: args.threadId,
    provisioningId: args.provisioningId,
  };
  const command =
    provisionType === "personal"
      ? buildEnvironmentProvisionCommand({
          environmentId: args.environment.id,
          hostId: args.environment.hostId,
          initiator,
          targetPath:
            args.environment.path ??
            resolvePersonalTargetPath({
              dataDir: deps.config.dataDir,
              environmentId: args.environment.id,
            }),
          workspaceProvisionType: provisionType,
        })
      : (() => {
          const source = requireSourceForHost(
            deps,
            args.projectId,
            args.environment.hostId,
          );
          const targetPath =
            args.environment.path ??
            resolveManagedTargetPath({
              dataDir: deps.config.dataDir,
              environmentId: args.environment.id,
              sourcePath: source.path,
            });
          const branchName =
            args.environment.branchName ??
            buildManagedBranchName({ threadId: args.threadId });
          const baseBranch = storedBaseBranchNameToSpec(
            args.environment.baseBranch,
          );
          return buildEnvironmentProvisionCommand({
            branchName,
            baseBranch,
            environmentId: args.environment.id,
            hostId: args.environment.hostId,
            initiator,
            sourcePath: source.path,
            targetPath,
            workspaceProvisionType: provisionType,
            setupTimeoutMs: SETUP_TIMEOUT_MS,
          });
        })();

  requestEnvironmentReprovision(deps, {
    environmentId: args.environment.id,
    request: buildDirectEnvironmentProvisionRequest({
      command,
      provisioningId: args.provisioningId,
    }),
  });
  queueEnvironmentProvisionCommand(deps, {
    command,
    environment: args.environment,
    kind: "reprovision",
  });
  return {
    provisionEventSequence: args.provisionEventSequence,
    status: MANAGED_REPROVISION_QUEUED,
  };
}
