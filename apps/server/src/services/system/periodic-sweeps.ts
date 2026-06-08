import {
  compactDatabase,
  COMPLETED_EVENT_OUTPUT_RETENTION_MS,
  DATABASE_COMPACTION_MIN_RECLAIMABLE_BYTES,
  DATABASE_COMPACTION_MIN_RECLAIMABLE_RATIO,
  DATABASE_INCREMENTAL_VACUUM_MAX_PAGES,
  DATABASE_INCREMENTAL_VACUUM_MIN_FREELIST_PAGES,
  DEFAULT_COMPLETED_EVENT_OUTPUT_TRUNCATION_BATCH_SIZE,
  getDatabaseAutoVacuumMode,
  getDatabaseCompactionStats,
  getDatabaseFreelistStats,
  getDatabaseMaintenanceActivity,
  getEnvironment,
  getThread,
  isDatabaseMaintenanceIdle,
  listStopRequestedThreads,
  listEnvironmentOperations,
  listThreadOperations,
  runIncrementalVacuum,
  shouldCompactDatabase,
  shouldRunIncrementalVacuum,
  sweepDestroyingEnvironments,
  sweepManagedEnvironments,
  truncateCompletedEventItemOutputs,
} from "@bb/db";
import { activeLifecycleOperationStates } from "@bb/domain";
import type {
  AppDeps,
  LoggedPendingInteractionWorkSessionDeps,
  LoggedWorkSessionDeps,
} from "../../types.js";
import { sweepDueAutomations } from "../scheduling/automation-sweep.js";
import { advanceEnvironmentCleanup } from "../environments/environment-cleanup-internal.js";
import {
  isCommandTimeoutError,
  runtimeErrorLogFields,
} from "../lib/error-log-fields.js";
import {
  advanceEnvironmentProvisioning,
  completeEnvironmentProvisioning,
} from "../environments/environment-provisioning-internal.js";
import { sweepDueNudges } from "../scheduling/nudge-sweep-runner.js";
import {
  advanceProjectDeletion,
  listProjectsPendingDeletion,
} from "../projects/project-deletion.js";
import {
  advanceThreadStart,
  completeThreadStart,
  finalizeStoppedThreadAndAdvanceCleanup,
  requestThreadStopForCurrentState,
} from "../threads/thread-lifecycle.js";
import { advanceThreadProvisioning } from "../threads/thread-provisioning.js";
import { runQueuedMessageAutoSendSweep } from "../threads/queued-messages.js";
import { runProviderTurnWatchdogSweep } from "../threads/provider-turn-watchdog.js";

export type EvaluateManagedEnvironmentArchiveCleanupFn =
  typeof advanceEnvironmentCleanup;
export type DatabaseMaintenanceSweepDeps = Pick<AppDeps, "db" | "logger">;

const DATABASE_MAINTENANCE_CHECK_INTERVAL_MS = 60 * 60_000;
const STOP_REQUESTED_THREAD_SWEEP_BATCH_SIZE = 50;

let lastDatabaseMaintenanceCheckAt = 0;
let databaseMaintenanceRunning = false;

export function runDatabaseMaintenanceSweep(
  deps: DatabaseMaintenanceSweepDeps,
  now: number = Date.now(),
): void {
  if (databaseMaintenanceRunning) {
    return;
  }

  if (
    now - lastDatabaseMaintenanceCheckAt <
    DATABASE_MAINTENANCE_CHECK_INTERVAL_MS
  ) {
    return;
  }

  lastDatabaseMaintenanceCheckAt = now;

  const autoVacuumMode = getDatabaseAutoVacuumMode(deps.db);

  if (autoVacuumMode === "incremental") {
    const freelistStats = getDatabaseFreelistStats(deps.db);
    if (
      !shouldRunIncrementalVacuum({
        minFreelistPages: DATABASE_INCREMENTAL_VACUUM_MIN_FREELIST_PAGES,
        stats: freelistStats,
      })
    ) {
      // Incremental vacuum only reclaims freelist pages. It does not defragment
      // internal page slack reported by dbstat.unused, and checking dbstat here
      // would add an expensive scan to busy servers that cannot act on it.
      deps.logger.debug(
        { freelistStats },
        "Incremental database vacuum skipped below freelist threshold",
      );
      return;
    }
    // This steady-state path may write and checkpoint, but each attempt is
    // capped by page count and DB busy timeout so active app work can proceed.
    databaseMaintenanceRunning = true;
    try {
      const result = runIncrementalVacuum(deps.db, {
        maxPages: DATABASE_INCREMENTAL_VACUUM_MAX_PAGES,
      });
      deps.logger.info({ result }, "Incremental database vacuum completed");
    } catch (error) {
      deps.logger.warn({ err: error }, "Incremental database vacuum failed");
    } finally {
      databaseMaintenanceRunning = false;
    }
    return;
  }

  // Non-incremental databases need a full VACUUM to reclaim dbstat-reported
  // internal slack and convert legacy auto_vacuum=NONE databases to
  // incremental mode. A full VACUUM rewrites the file, so only compute the
  // expensive dbstat-based compaction stats after the instance is idle.
  const activity = getDatabaseMaintenanceActivity(deps.db);
  if (!isDatabaseMaintenanceIdle(activity)) {
    deps.logger.debug(
      { activity },
      "Database maintenance skipped while app work is active",
    );
    return;
  }

  const stats = getDatabaseCompactionStats(deps.db);
  if (
    !shouldCompactDatabase({
      minReclaimableBytes: DATABASE_COMPACTION_MIN_RECLAIMABLE_BYTES,
      minReclaimableRatio: DATABASE_COMPACTION_MIN_RECLAIMABLE_RATIO,
      stats,
    })
  ) {
    deps.logger.debug(
      { stats },
      "Database maintenance skipped below compaction threshold",
    );
    return;
  }

  databaseMaintenanceRunning = true;
  try {
    const result = compactDatabase(deps.db);
    deps.logger.info({ result }, "Database compaction completed");
  } catch (error) {
    deps.logger.warn({ err: error }, "Database compaction failed");
  } finally {
    databaseMaintenanceRunning = false;
  }
}

export async function runManagedEnvironmentArchiveCleanupSweep(
  deps: LoggedWorkSessionDeps,
  evaluateCleanup: EvaluateManagedEnvironmentArchiveCleanupFn,
): Promise<void> {
  for (const environment of sweepManagedEnvironments(deps.db)) {
    try {
      await evaluateCleanup(deps, {
        environmentId: environment.id,
      });
    } catch (error) {
      if (isCommandTimeoutError(error)) {
        deps.logger.debug(
          {
            environmentId: environment.id,
            ...runtimeErrorLogFields(deps.config, error),
          },
          "Managed environment archive cleanup deferred by host timeout",
        );
        continue;
      }
      deps.logger.warn(
        {
          environmentId: environment.id,
          err: error,
        },
        "Managed environment archive cleanup sweep failed",
      );
    }
  }
}

export async function runProjectDeletionSweep(
  deps: Pick<
    AppDeps,
    | "config"
    | "db"
    | "engineDispatch"
    | "hub"
    | "lifecycleDedupers"
    | "logger"
    | "pendingInteractions"
    | "terminalSessions"
  >,
): Promise<void> {
  for (const projectId of listProjectsPendingDeletion(deps)) {
    try {
      await advanceProjectDeletion(deps, { projectId });
    } catch (error) {
      deps.logger.warn(
        {
          err: error,
          projectId,
        },
        "Project deletion sweep failed",
      );
    }
  }
}

export async function runEnvironmentProvisioningSweep(
  deps: Pick<
    AppDeps,
    | "config"
    | "db"
    | "engineDispatch"
    | "hub"
    | "lifecycleDedupers"
    | "logger"
  >,
): Promise<void> {
  const seenEnvironmentIds = new Set<string>();

  for (const operation of listEnvironmentOperations(deps.db, {
    kinds: ["provision", "reprovision"],
    states: [...activeLifecycleOperationStates],
  })) {
    if (seenEnvironmentIds.has(operation.environmentId)) {
      continue;
    }
    seenEnvironmentIds.add(operation.environmentId);

    try {
      const environment = getEnvironment(deps.db, operation.environmentId);
      if (!environment) {
        continue;
      }
      if (environment.status === "ready") {
        completeEnvironmentProvisioning(deps, {
          environmentId: environment.id,
        });
        continue;
      }
      await advanceEnvironmentProvisioning(deps, {
        environmentId: environment.id,
      });
    } catch (error) {
      deps.logger.warn(
        {
          err: error,
          environmentId: operation.environmentId,
          operationKind: operation.kind,
        },
        "Environment provisioning sweep failed",
      );
    }
  }
}

export async function runThreadLifecycleSweep(
  deps: LoggedPendingInteractionWorkSessionDeps,
): Promise<void> {
  for (const operation of listThreadOperations(deps.db, {
    kinds: ["provision"],
    states: [...activeLifecycleOperationStates],
  })) {
    try {
      await advanceThreadProvisioning(deps, {
        threadId: operation.threadId,
      });
    } catch (error) {
      deps.logger.warn(
        {
          err: error,
          threadId: operation.threadId,
          operationKind: operation.kind,
        },
        "Thread provisioning sweep failed",
      );
    }
  }

  for (const operation of listThreadOperations(deps.db, {
    kinds: ["start"],
    states: [...activeLifecycleOperationStates],
  })) {
    try {
      const thread = getThread(deps.db, operation.threadId);
      if (!thread || thread.deletedAt !== null || !thread.environmentId) {
        continue;
      }
      if (thread.status === "active") {
        completeThreadStart(deps, {
          threadId: thread.id,
        });
        continue;
      }
      if (thread.status === "error") {
        continue;
      }

      const environment = getEnvironment(deps.db, thread.environmentId);
      if (!environment) {
        continue;
      }

      await advanceThreadStart(deps, {
        threadId: thread.id,
      });
    } catch (error) {
      deps.logger.warn(
        {
          err: error,
          threadId: operation.threadId,
          operationKind: operation.kind,
        },
        "Thread start sweep failed",
      );
    }
  }

  const stopRequestedThreads = listStopRequestedThreads(deps.db, {
    limit: STOP_REQUESTED_THREAD_SWEEP_BATCH_SIZE,
  });

  for (const thread of stopRequestedThreads) {
    try {
      if (
        thread.status === "active" ||
        thread.status === "created" ||
        thread.status === "provisioning"
      ) {
        requestThreadStopForCurrentState(
          deps,
          {
            environmentId: thread.environmentId,
            id: thread.threadId,
            status: thread.status,
            stopRequestedAt: thread.stopRequestedAt,
          },
          {
            id: thread.environmentId,
          },
        );
        continue;
      }

      await finalizeStoppedThreadAndAdvanceCleanup(deps, {
        threadId: thread.threadId,
      });
    } catch (error) {
      deps.logger.warn(
        {
          err: error,
          threadId: thread.threadId,
        },
        "Thread stop sweep failed",
      );
    }
  }
}

export async function runPeriodicSweeps(
  deps: Pick<
    AppDeps,
    | "config"
    | "db"
    | "engineDispatch"
    | "hub"
    | "lifecycleDedupers"
    | "logger"
    | "pendingInteractions"
    | "terminalSessions"
  >,
): Promise<void> {
  try {
    const now = Date.now();

    truncateCompletedEventItemOutputs(deps.db, {
      createdBefore: now - COMPLETED_EVENT_OUTPUT_RETENTION_MS,
      limit: DEFAULT_COMPLETED_EVENT_OUTPUT_TRUNCATION_BATCH_SIZE,
      truncatedAt: now,
    });
    sweepDestroyingEnvironments(deps.db, deps.hub);
    await sweepDueAutomations(deps);
    await sweepDueNudges(deps);
    await runEnvironmentProvisioningSweep(deps);
    runProviderTurnWatchdogSweep(deps, { now });
    await runThreadLifecycleSweep(deps);
    await runQueuedMessageAutoSendSweep(deps);
    await runManagedEnvironmentArchiveCleanupSweep(
      deps,
      advanceEnvironmentCleanup,
    );
    await runProjectDeletionSweep(deps);
    runDatabaseMaintenanceSweep(deps, now);
  } catch (error) {
    deps.logger.error({ err: error }, "Periodic sweep failed");
  }
}
