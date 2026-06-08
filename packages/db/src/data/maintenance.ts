import { and, count, inArray, isNull } from "drizzle-orm";
import { activeLifecycleOperationStates } from "@bb/domain";
import type { DbConnection } from "../connection.js";
import {
  environmentOperations,
  pendingInteractions,
  projectOperations,
  threadOperations,
  threads,
} from "../schema.js";

export const DATABASE_COMPACTION_MIN_RECLAIMABLE_BYTES = 128 * 1024 * 1024;
export const DATABASE_COMPACTION_MIN_RECLAIMABLE_RATIO = 0.15;

/** Below this many freelist pages, incremental reclamation isn't worth a pass. */
export const DATABASE_INCREMENTAL_VACUUM_MIN_FREELIST_PAGES = 1_024;
/**
 * Upper bound on pages reclaimed per incremental pass. Incremental vacuum moves
 * pages individually, so capping the batch keeps each pass short enough to run
 * without stalling a busy server (unlike a full VACUUM).
 */
export const DATABASE_INCREMENTAL_VACUUM_MAX_PAGES = 20_000;
/**
 * Maintenance should give way quickly to foreground database work. The sweep
 * catches SQLITE_BUSY and tries again on a later hourly pass.
 */
export const DATABASE_MAINTENANCE_BUSY_TIMEOUT_MS = 100;

const ACTIVE_THREAD_STATUSES = ["active", "provisioning"] as const;
const ACTIVE_PENDING_INTERACTION_STATUSES = ["pending", "resolving"] as const;

interface CountRow {
  value: number;
}

interface PageCountRow {
  page_count: number;
}

interface PageSizeRow {
  page_size: number;
}

interface FreelistCountRow {
  freelist_count: number;
}

interface BusyTimeoutRow {
  timeout: number;
}

interface DbstatUnusedRow {
  unusedBytes: number;
}

export interface DatabaseMaintenanceActivity {
  activeEnvironmentOperationCount: number;
  activePendingInteractionCount: number;
  activeProjectOperationCount: number;
  activeThreadCount: number;
  activeThreadOperationCount: number;
}

export interface DatabaseCompactionStats {
  databaseBytes: number;
  freelistBytes: number;
  freelistCount: number;
  pageCount: number;
  pageSize: number;
  reclaimableBytes: number;
  unusedBytes: number;
}

export interface DatabaseCompactionDecisionArgs {
  minReclaimableBytes: number;
  minReclaimableRatio: number;
  stats: DatabaseCompactionStats;
}

export interface DatabaseFreelistStats {
  databaseBytes: number;
  freelistBytes: number;
  freelistCount: number;
  pageCount: number;
  pageSize: number;
}

export interface DatabaseIncrementalVacuumDecisionArgs {
  minFreelistPages: number;
  stats: DatabaseFreelistStats;
}

export interface CompactDatabaseResult {
  after: DatabaseCompactionStats;
  before: DatabaseCompactionStats;
}

export interface RunIncrementalVacuumArgs {
  maxPages: number;
}

interface RunWithMaintenanceBusyTimeoutArgs<TValue> {
  db: DbConnection;
  work: () => TValue;
}

function countValue(row: CountRow | undefined): number {
  return row?.value ?? 0;
}

function readPageCount(db: DbConnection): number {
  return (
    db.$client.prepare<[], PageCountRow>("PRAGMA page_count").get()
      ?.page_count ?? 0
  );
}

function readPageSize(db: DbConnection): number {
  return (
    db.$client.prepare<[], PageSizeRow>("PRAGMA page_size").get()?.page_size ??
    0
  );
}

function readFreelistCount(db: DbConnection): number {
  return (
    db.$client
      .prepare<[], FreelistCountRow>("PRAGMA freelist_count")
      .get()?.freelist_count ?? 0
  );
}

function readBusyTimeoutMs(db: DbConnection): number {
  return (
    db.$client.prepare<[], BusyTimeoutRow>("PRAGMA busy_timeout").get()
      ?.timeout ?? 0
  );
}

function readDbstatUnusedBytes(db: DbConnection): number {
  try {
    return (
      db.$client
        .prepare<[], DbstatUnusedRow>(
          "SELECT COALESCE(SUM(unused), 0) AS unusedBytes FROM dbstat WHERE name NOT LIKE 'sqlite_%'",
        )
        .get()?.unusedBytes ?? 0
    );
  } catch {
    return 0;
  }
}

function runWithMaintenanceBusyTimeout<TValue>(
  args: RunWithMaintenanceBusyTimeoutArgs<TValue>,
): TValue {
  const originalBusyTimeoutMs = readBusyTimeoutMs(args.db);
  args.db.$client.exec(
    `PRAGMA busy_timeout = ${DATABASE_MAINTENANCE_BUSY_TIMEOUT_MS}`,
  );
  try {
    return args.work();
  } finally {
    args.db.$client.exec(`PRAGMA busy_timeout = ${originalBusyTimeoutMs}`);
  }
}

export function getDatabaseMaintenanceActivity(
  db: DbConnection,
): DatabaseMaintenanceActivity {
  const activeThreadCount = countValue(
    db
      .select({ value: count() })
      .from(threads)
      .where(
        and(
          inArray(threads.status, [...ACTIVE_THREAD_STATUSES]),
          isNull(threads.deletedAt),
        ),
      )
      .get(),
  );
  const activeProjectOperationCount = countValue(
    db
      .select({ value: count() })
      .from(projectOperations)
      .where(
        inArray(projectOperations.state, [...activeLifecycleOperationStates]),
      )
      .get(),
  );
  const activeEnvironmentOperationCount = countValue(
    db
      .select({ value: count() })
      .from(environmentOperations)
      .where(
        inArray(
          environmentOperations.state,
          [...activeLifecycleOperationStates],
        ),
      )
      .get(),
  );
  const activeThreadOperationCount = countValue(
    db
      .select({ value: count() })
      .from(threadOperations)
      .where(
        inArray(threadOperations.state, [...activeLifecycleOperationStates]),
      )
      .get(),
  );
  const activePendingInteractionCount = countValue(
    db
      .select({ value: count() })
      .from(pendingInteractions)
      .where(
        inArray(pendingInteractions.status, [
          ...ACTIVE_PENDING_INTERACTION_STATUSES,
        ]),
      )
      .get(),
  );

  return {
    activeEnvironmentOperationCount,
    activePendingInteractionCount,
    activeProjectOperationCount,
    activeThreadCount,
    activeThreadOperationCount,
  };
}

export function isDatabaseMaintenanceIdle(
  activity: DatabaseMaintenanceActivity,
): boolean {
  return (
    activity.activeEnvironmentOperationCount === 0 &&
    activity.activePendingInteractionCount === 0 &&
    activity.activeProjectOperationCount === 0 &&
    activity.activeThreadCount === 0 &&
    activity.activeThreadOperationCount === 0
  );
}

export function getDatabaseFreelistStats(
  db: DbConnection,
): DatabaseFreelistStats {
  const pageCount = readPageCount(db);
  const pageSize = readPageSize(db);
  const freelistCount = readFreelistCount(db);
  const databaseBytes = pageCount * pageSize;
  const freelistBytes = freelistCount * pageSize;

  return {
    databaseBytes,
    freelistBytes,
    freelistCount,
    pageCount,
    pageSize,
  };
}

export function getDatabaseCompactionStats(
  db: DbConnection,
): DatabaseCompactionStats {
  const freelistStats = getDatabaseFreelistStats(db);
  const unusedBytes = readDbstatUnusedBytes(db);

  return {
    ...freelistStats,
    reclaimableBytes: freelistStats.freelistBytes + unusedBytes,
    unusedBytes,
  };
}

export function shouldCompactDatabase(
  args: DatabaseCompactionDecisionArgs,
): boolean {
  if (args.stats.databaseBytes <= 0) {
    return false;
  }

  return (
    args.stats.reclaimableBytes >= args.minReclaimableBytes &&
    args.stats.reclaimableBytes / args.stats.databaseBytes >=
      args.minReclaimableRatio
  );
}

export function shouldRunIncrementalVacuum(
  args: DatabaseIncrementalVacuumDecisionArgs,
): boolean {
  return args.stats.freelistCount >= args.minFreelistPages;
}

export type DatabaseAutoVacuumMode = "none" | "full" | "incremental";

interface AutoVacuumModeRow {
  auto_vacuum: number;
}

export function getDatabaseAutoVacuumMode(
  db: DbConnection,
): DatabaseAutoVacuumMode {
  const mode =
    db.$client
      .prepare<[], AutoVacuumModeRow>("PRAGMA auto_vacuum")
      .get()?.auto_vacuum ?? 0;
  switch (mode) {
    case 1:
      return "full";
    case 2:
      return "incremental";
    default:
      return "none";
  }
}

export function compactDatabase(db: DbConnection): CompactDatabaseResult {
  return runWithMaintenanceBusyTimeout({
    db,
    work: () => {
      const before = getDatabaseCompactionStats(db);

      // Convert to incremental auto-vacuum (no-op if already incremental). For
      // legacy auto_vacuum=NONE databases, SQLite applies this mode change only
      // when the full VACUUM below completes successfully.
      db.$client.exec("PRAGMA auto_vacuum = INCREMENTAL");
      db.$client.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      db.$client.exec("VACUUM");
      db.$client.exec("PRAGMA wal_checkpoint(TRUNCATE)");

      return {
        after: getDatabaseCompactionStats(db),
        before,
      };
    },
  });
}

/**
 * Reclaims up to `maxPages` freelist pages on an incremental-auto-vacuum
 * database. Unlike {@link compactDatabase} this does not rewrite the whole
 * file, but it still performs maintenance writes and passive WAL checkpoints.
 * Lock contention is bounded by DATABASE_MAINTENANCE_BUSY_TIMEOUT_MS.
 */
export function runIncrementalVacuum(
  db: DbConnection,
  args: RunIncrementalVacuumArgs,
): CompactDatabaseResult {
  return runWithMaintenanceBusyTimeout({
    db,
    work: () => {
      const before = getDatabaseCompactionStats(db);

      db.$client.exec("PRAGMA wal_checkpoint(PASSIVE)");
      db.$client.exec(`PRAGMA incremental_vacuum(${args.maxPages})`);
      db.$client.exec("PRAGMA wal_checkpoint(PASSIVE)");

      return {
        after: getDatabaseCompactionStats(db),
        before,
      };
    },
  });
}
