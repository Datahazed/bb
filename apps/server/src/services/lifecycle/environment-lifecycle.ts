/**
 * Environment lifecycle (Phase 2 rewrite, plan §6 / Decision 11).
 *
 * Owns environment provisioning, provision cancellation, and managed-env
 * cleanup as in-memory tasks:
 *
 * - `Map<environmentId, EnvironmentProvisionTask>` — one live provision or
 *   reprovision per environment. Task presence IS the dedupe (the queue-era
 *   `environment_operations` rows and their 10s re-drive sweep are gone). The
 *   task settles inline from the engine's typed result; a late provision
 *   result after a successful cancel is ignored because the cancel marked the
 *   task settled first.
 * - `Map<environmentId, EnvironmentDestroyTask>` — one live destroy per
 *   environment; `cancelPendingCleanup` answers `in_progress` while it runs.
 * - Cancel tasks dedupe `environment.provision.cancel` dispatches; the cancel
 *   settlement finalizes every stop-requested pre-start thread on the
 *   environment (shared-env stop semantics preserved).
 *
 * Durable product intent stays in the database: `cleanupRequestedAt` /
 * `cleanupMode` survive restarts (plan §5.12) and the archive-cleanup product
 * sweep plus boot reconciliation re-derive pending cleanup from them. A crash
 * mid-provision is handled by boot reconciliation (provisioning environments
 * fail cleanly with the standard events).
 *
 * Crash/restart behavior: lost engine results reject or error-settle the
 * awaiting task in-process; there are no command retries. Repeated requests
 * join the live task. Expired-command semantics died with the durable queue.
 */
import {
  countLiveThreadsInEnvironment,
  getEnvironment,
  hasPendingThreadShutdownInEnvironment,
  listLiveThreadsInEnvironment,
  listStoredThreadProvisioningRowsByProvisioningId,
  threads,
  type DbQueryConnection,
} from "@bb/db";
import { and, eq, inArray, isNotNull, isNull, ne } from "drizzle-orm";
import {
  applyProvisionedEnvironmentRecord,
  clearEnvironmentCleanupRequestRecord,
  recordEnvironmentCleanupRequest,
  setEnvironmentRecordDestroyed,
  setEnvironmentStatus,
} from "@bb/db/internal-environment-lifecycle";
import {
  resolveEnvironmentMergeBaseBranch,
  systemThreadProvisioningEventDataSchema,
  threadScope,
  type Environment,
  type ProvisioningTranscriptEntry,
  type ThreadStatus,
  type WorkspaceProvisionType,
} from "@bb/domain";
import type {
  EnvironmentProvisionCommand,
  HostDaemonCommandResult,
} from "../../engine/contract/commands.js";
import { ApiError } from "../../errors.js";
import { dispatchEngineCommandAndWait } from "../engine/command-wait.js";
import { EngineDispatchBuffer } from "../engine/engine-dispatch.js";
import { NotificationBuffer } from "../lib/notification-buffer.js";
import { scheduleDetachedWork } from "../lib/detached-work.js";
import {
  appendSystemErrorEventInTransaction,
  appendThreadProvisioningEventInTransaction,
  buildCwdBranchEntries,
} from "../threads/thread-events.js";
import {
  buildEnvironmentProvisionCommand,
  buildManagedBranchName,
  requireSourceForHost,
  SETUP_TIMEOUT_MS,
  storedBaseBranchNameToSpec,
} from "../threads/thread-create-helpers.js";
import {
  resolveManagedTargetPath,
  resolvePersonalTargetPath,
} from "../threads/worktree-paths.js";
import { tryTransitionInTransaction } from "../threads/thread-transitions.js";
import { workspaceContextFromPath } from "../environments/workspace-command-target.js";
import type {
  LifecycleServiceDeps,
  LifecycleTransactionContext,
} from "./shared.js";

export type EnvironmentProvisionKind = "provision" | "reprovision";

export type EnvironmentProvisionCancellationForThreadStopResult =
  | "awaiting_cancel"
  | "ready_to_finalize";

export type CancelPendingEnvironmentCleanupResult =
  | "cancelled"
  | "in_progress"
  | "not_requested";

export const MANAGED_REPROVISION_QUEUED = "queued" as const;
export const MANAGED_REPROVISION_IN_PROGRESS = "already-provisioning" as const;

interface QueuedManagedReprovision {
  provisionEventSequence: number;
  status: typeof MANAGED_REPROVISION_QUEUED;
}

export type ManagedReprovisionResult =
  | QueuedManagedReprovision
  | typeof MANAGED_REPROVISION_IN_PROGRESS;

export interface StartEnvironmentProvisionArgs {
  command: EnvironmentProvisionCommand;
  environmentId: string;
  kind: EnvironmentProvisionKind;
  provisioningId: string;
}

export interface ReprovisionManagedEnvironmentArgs {
  environment: Environment;
  projectId: string;
  provisionEventSequence: number;
  provisioningId: string;
  threadId: string;
}

export interface CancelEnvironmentProvisionForThreadStopArgs {
  environmentId: string;
  threadId: string;
}

export interface EnvironmentIdArgs {
  environmentId: string | null | undefined;
}

export interface WouldCleanupEnvironmentArgs extends EnvironmentIdArgs {
  excludeThreadId?: string;
}

interface StopRequestedHookThread {
  environmentId: string;
  id: string;
  status: ThreadStatus;
  stopRequestedAt: number | null;
}

/**
 * The thread-side surface the environment lifecycle needs when settling
 * provision/cancel results for the threads bound to an environment. Bound at
 * boot (`bindThreadLifecycle`) — implemented by `ThreadRuntimeLifecycle`.
 */
export interface EnvironmentLifecycleThreadHooks {
  /** Finalize inside the settlement transaction; false if a live task refuses. */
  finalizeStoppedThreadInTransaction(
    context: LifecycleTransactionContext,
    args: { threadId: string },
  ): boolean;
  /** Detached finalize retry + cleanup advance (post-commit paths). */
  finalizeStoppedThreadAndRequestCleanupAdvance(args: {
    threadId: string;
  }): boolean;
  /** True while the thread's provision was cancelled (cancellation outcome wins). */
  hasCancelledProvision(threadId: string): boolean;
  /** The live provision task's provisioningId, if one exists. */
  getLiveProvisionProvisioningId(threadId: string): string | null;
  /**
   * Append the idempotent workspace-ready provisioning event for a thread
   * with a live provision task (no-op otherwise) inside the settlement
   * transaction.
   */
  recordWorkspaceReadyInTransaction(
    context: LifecycleTransactionContext,
    args: {
      entries: ProvisioningTranscriptEntry[];
      environmentId: string;
      threadId: string;
    },
  ): void;
  /** Re-drive a stop after a failed provision cancel. */
  requestStopForCurrentState(
    thread: StopRequestedHookThread,
    environment: { id: string },
  ): void;
}

interface EnvironmentProvisionTask {
  cancelRequested: boolean;
  command: EnvironmentProvisionCommand;
  done: Promise<void>;
  kind: EnvironmentProvisionKind;
  provisioningId: string;
  resolveDone: () => void;
  settled: "cancelled" | "completed" | "failed" | null;
}

interface EnvironmentDestroyTask {
  startedAt: number;
}

interface LiveEnvironmentThread {
  id: string;
  stopRequestedAt: number | null;
}

interface StopRequestedEnvironmentProvisionThread {
  id: string;
  status: ThreadStatus;
  stopRequestedAt: number | null;
}

type EnvironmentProvisionResult =
  HostDaemonCommandResult<"environment.provision">;

interface ProvisionedEnvironmentBranchMetadata {
  baseBranch?: string | null;
  mergeBaseBranch?: string | null;
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

function isWorkspaceProvisioningTranscriptEntry(
  entry: ProvisioningTranscriptEntry,
): boolean {
  return WORKSPACE_PROVISIONING_TRANSCRIPT_KEYS.has(entry.key);
}

function cleanupPreflightAllowsDestroy(
  result: HostDaemonCommandResult<"environment.cleanup_preflight">,
): boolean {
  switch (result.outcome) {
    case "safe_to_destroy":
    case "already_missing":
    case "not_inspectable":
      return true;
    case "blocked_by_changes":
    case "probe_failed":
      return false;
  }
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

interface EnvironmentDestroyTarget {
  id: string;
  path: string;
  workspaceProvisionType: WorkspaceProvisionType;
}

export class EnvironmentLifecycle {
  private readonly cancelTasks = new Set<string>();
  private readonly destroyTasks = new Map<string, EnvironmentDestroyTask>();
  private readonly provisionTasks = new Map<
    string,
    EnvironmentProvisionTask
  >();
  private threadHooks: EnvironmentLifecycleThreadHooks | null = null;

  constructor(private readonly deps: LifecycleServiceDeps) {}

  /**
   * Late-bound: the thread lifecycle and the environment lifecycle reference
   * each other (provision settlement touches bound threads; thread stops
   * cancel environment provisions). Both exist before any request is served.
   */
  bindThreadLifecycle(hooks: EnvironmentLifecycleThreadHooks): void {
    this.threadHooks = hooks;
  }

  private requireThreadHooks(): EnvironmentLifecycleThreadHooks {
    if (!this.threadHooks) {
      throw new Error(
        "Environment lifecycle is not bound to a thread lifecycle",
      );
    }
    return this.threadHooks;
  }

  hasActiveProvision(environmentId: string): boolean {
    return this.provisionTasks.has(environmentId);
  }

  getActiveProvisioningId(environmentId: string): string | null {
    return this.provisionTasks.get(environmentId)?.provisioningId ?? null;
  }

  /** Resolves when the live provision settles; null when none is running. */
  getActiveProvisionDone(environmentId: string): Promise<void> | null {
    return this.provisionTasks.get(environmentId)?.done ?? null;
  }

  /** True while an `environment.provision.cancel` is settling (thread-create 409 gate). */
  isCancellingProvision(environmentId: string): boolean {
    return this.cancelTasks.has(environmentId);
  }

  /**
   * Registers and runs one environment provision/reprovision. The caller has
   * already written the environment row (status `provisioning`) and the
   * thread-facing provisioning event; this owns the engine command and its
   * settlement. Joins the live task on repeat requests.
   */
  startProvision(args: StartEnvironmentProvisionArgs): Promise<void> {
    const existing = this.provisionTasks.get(args.environmentId);
    if (existing) {
      return existing.done;
    }

    let resolveDone = (): void => undefined;
    const done = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });
    const task: EnvironmentProvisionTask = {
      cancelRequested: false,
      command: args.command,
      done,
      kind: args.kind,
      provisioningId: args.provisioningId,
      resolveDone,
      settled: null,
    };
    this.provisionTasks.set(args.environmentId, task);
    void this.runProvision(args.environmentId, task);
    return done;
  }

  /**
   * Managed/personal reprovision for a turn that found the workspace path
   * missing (thread-turn-dispatch). Builds the provision command from the
   * stored environment record and dispatches it.
   */
  reprovisionManaged(
    args: ReprovisionManagedEnvironmentArgs,
  ): ManagedReprovisionResult {
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

    if (this.provisionTasks.has(args.environment.id)) {
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
                dataDir: this.deps.config.dataDir,
                environmentId: args.environment.id,
              }),
            workspaceProvisionType: provisionType,
          })
        : (() => {
            const source = requireSourceForHost(
              this.deps,
              args.projectId,
              args.environment.hostId,
            );
            const targetPath =
              args.environment.path ??
              resolveManagedTargetPath({
                dataDir: this.deps.config.dataDir,
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

    const environment = getEnvironment(this.deps.db, args.environment.id);
    if (environment && environment.status !== "provisioning") {
      setEnvironmentStatus(this.deps.db, this.deps.hub, environment.id, {
        status: "provisioning",
      });
    }
    void this.startProvision({
      command,
      environmentId: args.environment.id,
      kind: "reprovision",
      provisioningId: args.provisioningId,
    });
    return {
      provisionEventSequence: args.provisionEventSequence,
      status: MANAGED_REPROVISION_QUEUED,
    };
  }

  /**
   * Pre-start thread stop reached an environment that may be provisioning.
   * Decides inside the caller's transaction whether finalization must wait
   * for an engine-side cancel. When this returns `awaiting_cancel`, the
   * caller MUST invoke `kickProvisionCancel` after its transaction commits;
   * the thread stays `provisioning` with `stopRequestedAt` set until the
   * cancel settles (frozen FE pending-stop semantics, plan §4.1).
   */
  cancelProvisionForThreadStopInTransaction(
    context: LifecycleTransactionContext,
    args: CancelEnvironmentProvisionForThreadStopArgs,
  ): EnvironmentProvisionCancellationForThreadStopResult {
    const task = this.provisionTasks.get(args.environmentId);
    if (!task || task.settled !== null) {
      return "ready_to_finalize";
    }

    if (
      this.hasOtherLiveThreadDependingOnEnvironmentProvision(context.db, args)
    ) {
      // Another live thread still needs this provision: cancel only the
      // stopping thread, leave the environment provision running.
      return "ready_to_finalize";
    }

    const environment = getEnvironment(context.db, args.environmentId);
    if (!environment) {
      return "ready_to_finalize";
    }

    task.cancelRequested = true;
    return "awaiting_cancel";
  }

  /** Post-commit driver for `cancelProvisionForThreadStopInTransaction`. */
  kickProvisionCancel(environmentId: string): void {
    if (this.cancelTasks.has(environmentId)) {
      // A cancel already running covers this stop request too: its
      // settlement finalizes every stop-requested thread on the environment.
      return;
    }
    this.cancelTasks.add(environmentId);
    // Synchronous dispatch so the cancel registers in flight in this frame.
    this.runProvisionCancel(environmentId)
      .catch((error) => {
        this.deps.logger.error(
          { environmentId, err: error },
          "Environment provision cancel settlement failed",
        );
      })
      .finally(() => {
        this.cancelTasks.delete(environmentId);
      });
  }

  requestCleanup(args: EnvironmentIdArgs): void {
    if (!args.environmentId) {
      return;
    }
    const environment = getEnvironment(this.deps.db, args.environmentId);
    if (
      !environment ||
      !environment.managed ||
      environment.status === "destroyed"
    ) {
      return;
    }
    recordEnvironmentCleanupRequest(
      this.deps.db,
      this.deps.hub,
      environment.id,
      {},
    );
  }

  /** `requestCleanup` for callers already inside a lifecycle transaction. */
  requestCleanupInTransaction(
    context: LifecycleTransactionContext,
    args: EnvironmentIdArgs,
  ): void {
    if (!args.environmentId) {
      return;
    }
    const environment = getEnvironment(context.db, args.environmentId);
    if (
      !environment ||
      !environment.managed ||
      environment.status === "destroyed"
    ) {
      return;
    }
    recordEnvironmentCleanupRequest(context.db, context.hub, environment.id, {});
  }

  cancelPendingCleanup(
    args: EnvironmentIdArgs,
  ): CancelPendingEnvironmentCleanupResult {
    if (!args.environmentId) {
      return "not_requested";
    }

    const environmentId = args.environmentId;
    const notificationBuffer = new NotificationBuffer();
    const result = this.deps.db.transaction(
      (tx): CancelPendingEnvironmentCleanupResult => {
        const environment = getEnvironment(tx, environmentId);
        if (!environment || environment.cleanupMode === null) {
          return "not_requested";
        }

        // An in-flight destroy is in the engine's hands and cannot be
        // cancelled.
        if (this.destroyTasks.has(environment.id)) {
          return "in_progress";
        }

        clearEnvironmentCleanupRequestRecord(
          tx,
          notificationBuffer,
          environment.id,
        );
        if (environment.status === "destroying") {
          setEnvironmentStatus(tx, notificationBuffer, environment.id, {
            status: environment.path ? "ready" : "error",
          });
        }
        return "cancelled";
      },
      { behavior: "immediate" },
    );

    notificationBuffer.flushInto(this.deps.hub);
    return result;
  }

  wouldCleanup(args: WouldCleanupEnvironmentArgs): boolean {
    if (!args.environmentId) {
      return false;
    }

    const environment = getEnvironment(this.deps.db, args.environmentId);
    if (!environment || !environment.managed) {
      return false;
    }

    return (
      countLiveThreadsInEnvironment(this.deps.db, {
        environmentId: environment.id,
        ...(args.excludeThreadId
          ? { excludeThreadId: args.excludeThreadId }
          : {}),
      }) === 0
    );
  }

  /**
   * Evaluates recorded cleanup intent (`cleanupRequestedAt`/`cleanupMode`)
   * and destroys the workspace once it is safe: zero live threads, no
   * pending thread shutdown, and a clean preflight for git workspaces.
   * Deduped per environment; safe to call repeatedly (archive routes, thread
   * finalization, the archive-cleanup product sweep, boot reconciliation).
   */
  async advanceCleanup(args: { environmentId: string }): Promise<void> {
    await this.deps.lifecycleDedupers.environmentCleanupAdvance.run(
      args.environmentId,
      () => this.advanceCleanupOnce(args.environmentId),
    );
  }

  /** Detached `advanceCleanup` (request/settlement paths that must not wait). */
  requestCleanupAdvance(args: EnvironmentIdArgs): void {
    if (!args.environmentId) {
      return;
    }
    const environmentId = args.environmentId;
    scheduleDetachedWork({
      config: this.deps.config,
      context: { environmentId },
      logger: this.deps.logger,
      name: "Environment cleanup advance request",
      work: () => this.advanceCleanup({ environmentId }),
    });
  }

  /** Aborts nothing engine-side; process exit owns runtime teardown. */
  shutdown(): void {
    this.provisionTasks.clear();
    this.destroyTasks.clear();
    this.cancelTasks.clear();
  }

  private hasOtherLiveThreadDependingOnEnvironmentProvision(
    db: DbQueryConnection,
    args: CancelEnvironmentProvisionForThreadStopArgs,
  ): boolean {
    const row = db
      .select({ id: threads.id })
      .from(threads)
      .where(
        and(
          eq(threads.environmentId, args.environmentId),
          ne(threads.id, args.threadId),
          isNull(threads.archivedAt),
          isNull(threads.deletedAt),
          isNull(threads.stopRequestedAt),
        ),
      )
      .limit(1)
      .get();
    return row !== undefined;
  }

  private listStopRequestedProvisionThreads(
    db: DbQueryConnection,
    environmentId: string,
  ): StopRequestedEnvironmentProvisionThread[] {
    return db
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
          // This settlement is for explicit user stop intent only. Archived
          // and deleted threads continue through their existing cleanup paths.
          isNull(threads.archivedAt),
          isNull(threads.deletedAt),
          isNotNull(threads.stopRequestedAt),
        ),
      )
      .all();
  }

  private listLiveEnvironmentThreads(
    db: DbQueryConnection,
    environmentId: string,
  ): LiveEnvironmentThread[] {
    return db
      .select({
        id: threads.id,
        stopRequestedAt: threads.stopRequestedAt,
      })
      .from(threads)
      .where(
        and(
          eq(threads.environmentId, environmentId),
          isNull(threads.deletedAt),
        ),
      )
      .all();
  }

  private hasStreamedProvisioningTranscript(
    db: DbQueryConnection,
    threadId: string,
    provisioningId: string,
  ): boolean {
    const rows = listStoredThreadProvisioningRowsByProvisioningId(db, {
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

  private async runProvision(
    environmentId: string,
    task: EnvironmentProvisionTask,
  ): Promise<void> {
    try {
      const executed = await this.deps.engineDispatch.execute({
        command: task.command,
      });
      if (task.settled !== null) {
        // A successful cancel settled this task first; the late provision
        // result is ignored (the environment keeps the cancel outcome).
        return;
      }

      if (
        executed.report.ok &&
        executed.report.type === "environment.provision"
      ) {
        this.settleProvisionSuccess(environmentId, task, {
          result: executed.report.result,
        });
        task.settled = "completed";
        return;
      }

      const errorMessage = executed.report.ok
        ? `Environment provision settled with unexpected result type ${executed.report.type}`
        : executed.report.errorMessage;
      this.settleProvisionFailure(environmentId, task, {
        dispatchedAt: executed.dispatchedAt,
        errorMessage,
      });
      task.settled = "failed";
    } catch (error) {
      if (task.settled === null) {
        this.deps.logger.error(
          { environmentId, err: error },
          "Environment provision settlement failed",
        );
        this.settleProvisionFailure(environmentId, task, {
          dispatchedAt: Date.now(),
          errorMessage:
            error instanceof Error ? error.message : String(error),
        });
        task.settled = "failed";
      }
    } finally {
      if (this.provisionTasks.get(environmentId) === task) {
        this.provisionTasks.delete(environmentId);
      }
      task.resolveDone();
    }
  }

  private settleProvisionSuccess(
    environmentId: string,
    task: EnvironmentProvisionTask,
    args: { result: EnvironmentProvisionResult },
  ): void {
    const hooks = this.requireThreadHooks();
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
        const boundThreads = tx
          .select()
          .from(threads)
          .where(eq(threads.environmentId, environmentId))
          .all();

        applyProvisionedEnvironmentRecord(
          tx,
          notificationBuffer,
          environmentId,
          {
            path: args.result.path,
            status: "ready",
            isGitRepo: args.result.isGitRepo,
            isWorktree: args.result.isWorktree,
            branchName: args.result.branchName,
            defaultBranch: args.result.defaultBranch,
            ...resolveProvisionedEnvironmentBranchMetadata(task.command),
          },
        );
        notificationBuffer.notifyEnvironment(environmentId, [
          "work-status-changed",
        ]);

        const cwdBranchEntries = buildCwdBranchEntries({
          path: args.result.path,
          branchName: args.result.branchName,
        });

        for (const thread of boundThreads) {
          if (thread.deletedAt !== null) {
            const finalized = hooks.finalizeStoppedThreadInTransaction(
              context,
              { threadId: thread.id },
            );
            if (finalized) {
              postCommit.push(() =>
                this.requestCleanupAdvance({ environmentId }),
              );
            } else {
              postCommit.push(() => {
                hooks.finalizeStoppedThreadAndRequestCleanupAdvance({
                  threadId: thread.id,
                });
              });
            }
            continue;
          }
          if (
            thread.archivedAt !== null ||
            thread.stopRequestedAt !== null ||
            hooks.hasCancelledProvision(thread.id)
          ) {
            continue;
          }

          const isInitiator = thread.id === task.command.initiator?.threadId;
          const hasStreamedTranscript =
            isInitiator && task.command.initiator
              ? this.hasStreamedProvisioningTranscript(
                  tx,
                  thread.id,
                  task.command.initiator.provisioningId,
                )
              : false;
          const entries = hasStreamedTranscript
            ? []
            : isInitiator && args.result.transcript.length > 0
              ? args.result.transcript
              : cwdBranchEntries;

          if (hooks.getLiveProvisionProvisioningId(thread.id) === null) {
            appendThreadProvisioningEventInTransaction(tx, {
              threadId: thread.id,
              environmentId,
              provisioningId: task.provisioningId,
              status: thread.status === "provisioning" ? "active" : "completed",
              entries,
            });
            notificationBuffer.notifyThread(thread.id, ["events-appended"], {
              eventTypes: ["system/thread-provisioning"],
            });
            continue;
          }

          hooks.recordWorkspaceReadyInTransaction(context, {
            entries,
            environmentId,
            threadId: thread.id,
          });
        }
      },
      { behavior: "immediate" },
    );

    notificationBuffer.flushInto(this.deps.hub);
    engineDispatches.flushInto(this.deps.engineDispatch);
    for (const action of postCommit) {
      action();
    }
    this.requestCleanupAdvance({ environmentId });
  }

  private settleProvisionFailure(
    environmentId: string,
    task: EnvironmentProvisionTask,
    args: { dispatchedAt: number; errorMessage: string },
  ): void {
    const hooks = this.requireThreadHooks();
    const notificationBuffer = new NotificationBuffer();
    const failureEntry: ProvisioningTranscriptEntry = {
      type: "step",
      key: "workspace-failed",
      text: "Workspace setup failed",
      status: "failed",
      startedAt: args.dispatchedAt,
      metadata: { durationMs: Date.now() - args.dispatchedAt },
    };

    this.deps.db.transaction(
      (tx) => {
        const environment = getEnvironment(tx, environmentId);
        if (!environment) {
          return;
        }
        const failureThreads = this.listLiveEnvironmentThreads(
          tx,
          environmentId,
        ).filter(
          (thread) =>
            thread.stopRequestedAt === null &&
            !hooks.hasCancelledProvision(thread.id),
        );

        if (
          environment.status !== "destroyed" &&
          environment.status !== "error"
        ) {
          setEnvironmentStatus(tx, notificationBuffer, environment.id, {
            status: "error",
          });
        }

        for (const thread of failureThreads) {
          appendThreadProvisioningEventInTransaction(tx, {
            entries: [failureEntry],
            environmentId,
            provisioningId:
              hooks.getLiveProvisionProvisioningId(thread.id) ??
              task.provisioningId,
            status: "failed",
            threadId: thread.id,
          });
          notificationBuffer.notifyThread(thread.id, ["events-appended"], {
            eventTypes: ["system/thread-provisioning"],
          });
          appendSystemErrorEventInTransaction(
            { db: tx, hub: notificationBuffer },
            {
              threadId: thread.id,
              environmentId,
              code: "thread_provisioning_failed",
              message: "Provisioning thread failed",
              detail: args.errorMessage,
              scope: threadScope(),
            },
          );
          tryTransitionInTransaction(tx, notificationBuffer, thread.id, "error");
        }
      },
      { behavior: "immediate" },
    );

    notificationBuffer.flushInto(this.deps.hub);
    this.requestCleanupAdvance({ environmentId });
  }

  private async runProvisionCancel(environmentId: string): Promise<void> {
    const executed = await this.deps.engineDispatch.execute({
      command: {
        type: "environment.provision.cancel",
        environmentId,
      },
    });
    // The engine cancel has settled: clear the dedupe entry before the
    // settlement runs so a failure's stop re-drive can kick a fresh cancel
    // (kickProvisionCancel would otherwise see this task and no-op — and no
    // sweep exists to retry). The `.finally` in kickProvisionCancel stays as
    // the safety net for settlement throws.
    this.cancelTasks.delete(environmentId);

    if (!executed.report.ok) {
      this.settleProvisionCancelFailure(environmentId, {
        commandId: executed.report.commandId,
        errorCode: executed.report.errorCode,
        errorMessage: executed.report.errorMessage,
      });
      return;
    }

    this.settleProvisionCancelSuccess(environmentId);
  }

  private settleProvisionCancelSuccess(environmentId: string): void {
    const hooks = this.requireThreadHooks();
    const task = this.provisionTasks.get(environmentId);
    if (task && task.settled === null) {
      // Cancel won: the provision task is settled here, and its own (late)
      // engine result is ignored.
      task.settled = "cancelled";
      this.provisionTasks.delete(environmentId);
      task.resolveDone();
    }

    const notificationBuffer = new NotificationBuffer();
    const engineDispatches = new EngineDispatchBuffer();
    let finalizedThread = false;
    this.deps.db.transaction(
      (tx) => {
        const context: LifecycleTransactionContext = {
          db: tx,
          engineDispatches,
          hub: notificationBuffer,
        };
        const environment = getEnvironment(tx, environmentId);
        if (environment?.status === "provisioning") {
          setEnvironmentStatus(tx, notificationBuffer, environment.id, {
            status: environment.path ? "ready" : "error",
          });
        }

        for (const thread of this.listStopRequestedProvisionThreads(
          tx,
          environmentId,
        )) {
          finalizedThread =
            hooks.finalizeStoppedThreadInTransaction(context, {
              threadId: thread.id,
            }) || finalizedThread;
        }
      },
      { behavior: "immediate" },
    );

    notificationBuffer.flushInto(this.deps.hub);
    engineDispatches.flushInto(this.deps.engineDispatch);
    if (finalizedThread) {
      this.requestCleanupAdvance({ environmentId });
    }
  }

  private settleProvisionCancelFailure(
    environmentId: string,
    args: { commandId: string; errorCode: string; errorMessage: string },
  ): void {
    const hooks = this.requireThreadHooks();
    const stoppedThreads = this.listStopRequestedProvisionThreads(
      this.deps.db,
      environmentId,
    );
    const task = this.provisionTasks.get(environmentId);
    this.deps.logger.warn(
      {
        activeProvisionKind: task?.kind ?? null,
        activeProvisionSettled: task?.settled ?? null,
        commandId: args.commandId,
        environmentId,
        errorCode: args.errorCode,
        errorMessage: args.errorMessage,
        stoppedThreadCount: stoppedThreads.length,
        stoppedThreadIds: stoppedThreads.map((thread) => thread.id),
      },
      "Environment provision cancel command failed",
    );

    const environment = getEnvironment(this.deps.db, environmentId);
    if (!environment || stoppedThreads.length === 0) {
      return;
    }

    for (const thread of stoppedThreads) {
      hooks.requestStopForCurrentState(
        {
          environmentId,
          id: thread.id,
          status: thread.status,
          stopRequestedAt: thread.stopRequestedAt,
        },
        { id: environment.id },
      );
    }
  }

  private async workspaceCanBeSafelyCleaned(
    environmentId: string,
  ): Promise<boolean> {
    const environment = getEnvironment(this.deps.db, environmentId);
    if (
      !environment ||
      !environment.managed ||
      environment.status !== "ready" ||
      !environment.path
    ) {
      return false;
    }

    if (!environment.isGitRepo) {
      return true;
    }

    if (
      this.deps.engineDispatch.getInFlightEnvironmentCommandId({
        environmentId: environment.id,
        type: "environment.cleanup_preflight",
      }) !== null
    ) {
      return false;
    }

    const mergeBaseBranch = resolveEnvironmentMergeBaseBranch(environment);
    if (!mergeBaseBranch) {
      return false;
    }

    const result = await dispatchEngineCommandAndWait(this.deps, {
      timeoutMs: 30_000,
      command: {
        type: "environment.cleanup_preflight",
        environmentId: environment.id,
        workspaceContext: workspaceContextFromPath({
          path: environment.path,
          workspaceProvisionType: environment.workspaceProvisionType,
        }),
        mergeBaseBranch,
      },
    });
    return cleanupPreflightAllowsDestroy(result);
  }

  private async advanceCleanupOnce(environmentId: string): Promise<void> {
    const environment = getEnvironment(this.deps.db, environmentId);
    if (
      !environment ||
      !environment.managed ||
      environment.status === "destroyed" ||
      environment.cleanupMode === null
    ) {
      return;
    }

    if (
      countLiveThreadsInEnvironment(this.deps.db, {
        environmentId: environment.id,
      }) > 0
    ) {
      return;
    }

    if (
      hasPendingThreadShutdownInEnvironment(this.deps.db, {
        environmentId: environment.id,
      })
    ) {
      return;
    }

    if (!environment.path) {
      if (environment.status === "provisioning") {
        return;
      }
      setEnvironmentRecordDestroyed(
        this.deps.db,
        this.deps.hub,
        environment.id,
      );
      return;
    }

    if (this.destroyTasks.has(environment.id)) {
      return;
    }

    const canDestroyNow = await this.workspaceCanBeSafelyCleaned(
      environment.id,
    );
    if (!canDestroyNow) {
      return;
    }

    // Re-validate every gate after the preflight await.
    const refreshed = getEnvironment(this.deps.db, environment.id);
    if (
      !refreshed ||
      refreshed.status !== "ready" ||
      !refreshed.path ||
      refreshed.cleanupMode === null
    ) {
      return;
    }
    if (
      countLiveThreadsInEnvironment(this.deps.db, {
        environmentId: refreshed.id,
      }) > 0
    ) {
      return;
    }
    if (
      hasPendingThreadShutdownInEnvironment(this.deps.db, {
        environmentId: refreshed.id,
      })
    ) {
      return;
    }
    if (this.destroyTasks.has(refreshed.id)) {
      return;
    }

    // Fire-and-forget like the queue it replaces: the destroy task owns its
    // own settlement; repeated advances dedupe on the task map.
    void this.destroyEnvironment({
      id: refreshed.id,
      path: refreshed.path,
      workspaceProvisionType: refreshed.workspaceProvisionType,
    });
  }

  /**
   * Write-then-execute, normalized (P1b handoff note 4): the environment is
   * marked `destroying` before the destroy command dispatches.
   */
  private async destroyEnvironment(
    target: EnvironmentDestroyTarget,
  ): Promise<void> {
    if (this.destroyTasks.has(target.id)) {
      return;
    }
    this.destroyTasks.set(target.id, { startedAt: Date.now() });
    try {
      setEnvironmentStatus(this.deps.db, this.deps.hub, target.id, {
        status: "destroying",
      });
      const executed = await this.deps.engineDispatch.execute({
        command: {
          type: "environment.destroy",
          environmentId: target.id,
          workspaceContext: workspaceContextFromPath(target),
        },
      });
      this.settleDestroyResult(target.id, {
        ok: executed.report.ok,
        errorMessage: executed.report.ok
          ? null
          : executed.report.errorMessage,
      });
    } catch (error) {
      this.deps.logger.error(
        { environmentId: target.id, err: error },
        "Environment destroy settlement failed",
      );
      this.settleDestroyResult(target.id, {
        ok: false,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.destroyTasks.delete(target.id);
    }
  }

  private settleDestroyResult(
    environmentId: string,
    args: { errorMessage: string | null; ok: boolean },
  ): void {
    const notificationBuffer = new NotificationBuffer();
    let destroyed = false;
    this.deps.db.transaction(
      (tx) => {
        const environment = getEnvironment(tx, environmentId);
        if (!environment) {
          return;
        }

        if (!args.ok) {
          this.deps.logger.warn(
            { environmentId, errorMessage: args.errorMessage },
            "Environment destroy command failed",
          );
          if (environment.status === "destroying") {
            setEnvironmentStatus(tx, notificationBuffer, environmentId, {
              status: environment.path ? "ready" : "error",
            });
          }
          return;
        }

        if (environment.status === "destroying") {
          setEnvironmentRecordDestroyed(tx, notificationBuffer, environmentId);
        } else if (environment.status !== "destroyed") {
          return;
        }
        destroyed = true;

        for (const thread of listLiveThreadsInEnvironment(tx, {
          environmentId,
        })) {
          appendSystemErrorEventInTransaction(
            { db: tx, hub: notificationBuffer },
            {
              threadId: thread.id,
              environmentId,
              code: "environment_workspace_destroyed",
              message:
                "The workspace for this thread was destroyed before the thread could be stopped.",
              scope: threadScope(),
            },
          );
          tryTransitionInTransaction(tx, notificationBuffer, thread.id, "error");
        }
      },
      { behavior: "immediate" },
    );

    notificationBuffer.flushInto(this.deps.hub);
    if (destroyed) {
      this.deps.terminalSessions.closeDestroyedEnvironmentTerminals({
        environmentId,
      });
    }
  }
}
