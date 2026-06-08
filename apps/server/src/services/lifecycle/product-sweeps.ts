/**
 * Product sweep scheduler (Phase 2, plan §3): the periodic work that exists
 * because the product needs it — retention/truncation, destroyed-environment
 * TTL, automations, manager nudges, the provider-turn watchdog, queued-message
 * auto-send, managed-env archive cleanup (driven by the durable
 * `cleanupRequestedAt` intent, §5.12), project-deletion drain (driven by the
 * durable `projects.deleteRequestedAt` intent), and hourly DB maintenance.
 *
 * The queue-era lifecycle re-drive sweeps (environment provisioning re-drive,
 * thread provision/start/stop re-drive) died with the operation tables:
 * in-memory tasks own their work end to end and boot reconciliation owns
 * crash recovery.
 */
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
  isDatabaseMaintenanceIdle,
  runIncrementalVacuum,
  shouldCompactDatabase,
  shouldRunIncrementalVacuum,
  sweepDestroyingEnvironments,
  sweepManagedEnvironments,
  truncateCompletedEventItemOutputs,
} from "@bb/db";
import type { AppDeps } from "../../types.js";
import { sweepDueAutomations } from "../scheduling/automation-sweep.js";
import { sweepDueNudges } from "../scheduling/nudge-sweep-runner.js";
import {
  isCommandTimeoutError,
  runtimeErrorLogFields,
} from "../lib/error-log-fields.js";
import { runQueuedMessageAutoSendSweep } from "../threads/queued-messages.js";
import { runProviderTurnWatchdogSweep } from "../threads/provider-turn-watchdog.js";

export type DatabaseMaintenanceSweepDeps = Pick<AppDeps, "db" | "logger">;

export type ProductSweepDeps = Pick<
  AppDeps,
  | "config"
  | "db"
  | "engineDispatch"
  | "environmentLifecycle"
  | "hub"
  | "lifecycleDedupers"
  | "logger"
  | "pendingInteractions"
  | "projectLifecycle"
  | "terminalSessions"
  | "threadLifecycle"
>;

const DATABASE_MAINTENANCE_CHECK_INTERVAL_MS = 60 * 60_000;

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

/** Drives recorded cleanup intent for managed envs with zero live threads. */
export async function runManagedEnvironmentArchiveCleanupSweep(
  deps: ProductSweepDeps,
): Promise<void> {
  for (const environment of sweepManagedEnvironments(deps.db)) {
    try {
      await deps.environmentLifecycle.advanceCleanup({
        environmentId: environment.id,
      });
    } catch (error) {
      if (isCommandTimeoutError(error)) {
        deps.logger.debug(
          {
            environmentId: environment.id,
            ...runtimeErrorLogFields(deps.config, error),
          },
          "Managed environment archive cleanup deferred by preflight timeout",
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
  deps: ProductSweepDeps,
): Promise<void> {
  for (const projectId of deps.projectLifecycle.listProjectsPendingDeletion()) {
    try {
      await deps.projectLifecycle.advanceDeletion({ projectId });
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

export async function runProductSweeps(deps: ProductSweepDeps): Promise<void> {
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
    runProviderTurnWatchdogSweep(deps, { now });
    await runQueuedMessageAutoSendSweep(deps);
    await runManagedEnvironmentArchiveCleanupSweep(deps);
    await runProjectDeletionSweep(deps);
    runDatabaseMaintenanceSweep(deps, now);
  } catch (error) {
    deps.logger.error({ err: error }, "Periodic sweep failed");
  }
}
