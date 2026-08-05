import {
  and,
  asc,
  eq,
  exists,
  inArray,
  isNull,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";
import type { ThreadChangeKind, WorkspaceProvisionType } from "@bb/domain";
import type { DbConnection, DbTransaction } from "../connection.js";
import {
  environmentGitStatusSnapshots,
  environmentPullRequestStatusSnapshots,
  environments,
  threads,
} from "../schema.js";

type SnapshotReadConnection = DbConnection | DbTransaction;
type SnapshotWriteConnection = DbConnection | DbTransaction;

export type EnvironmentGitStatusSnapshotRow =
  typeof environmentGitStatusSnapshots.$inferSelect;
export type EnvironmentPullRequestStatusSnapshotRow =
  typeof environmentPullRequestStatusSnapshots.$inferSelect;

export type EnvironmentStatusSnapshotStatus =
  EnvironmentGitStatusSnapshotRow["status"];

/**
 * Thread changes that can alter which environments count as tracked (an
 * environment is tracked while at least one non-archived, non-deleted thread
 * references it — the condition `listTrackedEnvironmentIds` queries). The
 * snapshot sweep and the daemon durable watch sets both key off this set so
 * they cannot disagree about which environments to track.
 */
export const THREAD_CHANGE_KINDS_AFFECTING_TRACKED_ENVIRONMENTS: ReadonlySet<ThreadChangeKind> =
  new Set<ThreadChangeKind>([
    "archived-changed",
    "environment-changed",
    "thread-created",
    "thread-deleted",
  ]);

interface EnsureEnvironmentStatusSnapshotRowsArgs {
  environmentIds: readonly string[];
  now: number;
}

interface DueEnvironmentStatusSnapshotsArgs {
  limit: number;
  now: number;
}

interface MarkEnvironmentStatusSnapshotsDueArgs {
  environmentIds: readonly string[];
  now: number;
  /**
   * Staleness floor: the mark schedules a refresh no sooner than
   * refreshedAt + floorMs (and never later than the existing schedule).
   * Pass 0 for change-driven marks ("the workspace changed, refresh now");
   * pass a positive window for demand-driven marks ("a client looked") so
   * repeated reads of fresh data cannot re-trigger refresh loops.
   */
  floorMs: number;
}

interface WriteSnapshotArgs {
  environmentId: string;
  errorCode: string | null;
  errorMessage: string | null;
  nextRefreshAt: number;
  now: number;
  refreshedAt: number;
  status: Exclude<EnvironmentStatusSnapshotStatus, "pending">;
  /**
   * The row's nextRefreshAt observed when this refresh started, or null to
   * overwrite unconditionally. When the stored value no longer matches, a
   * due-mark arrived while the refresh was in flight; the writer then keeps
   * the earlier of the two schedules so that mark is not lost.
   */
  expectedNextRefreshAt: number | null;
}

export interface WriteEnvironmentGitStatusSnapshotArgs
  extends WriteSnapshotArgs {
  gitStatusJson: string | null;
}

export interface WriteEnvironmentPullRequestStatusSnapshotArgs
  extends WriteSnapshotArgs {
  pullRequestJson: string | null;
}

export interface EnvironmentSnapshotWorkspaceWatchTarget {
  environmentId: string;
  path: string;
  workspaceProvisionType: WorkspaceProvisionType;
}

export interface EnvironmentThreadNotificationTarget {
  projectId: string;
  threadId: string;
}

function uniqueEnvironmentIds(environmentIds: readonly string[]): string[] {
  return [...new Set(environmentIds.filter((id) => id.length > 0))];
}

function visibleGitSnapshotChanged(
  existing: EnvironmentGitStatusSnapshotRow | null,
  next: WriteEnvironmentGitStatusSnapshotArgs,
): boolean {
  return (
    existing === null ||
    existing.status !== next.status ||
    existing.gitStatusJson !== next.gitStatusJson ||
    existing.errorCode !== next.errorCode ||
    existing.errorMessage !== next.errorMessage
  );
}

function visiblePullRequestSnapshotChanged(
  existing: EnvironmentPullRequestStatusSnapshotRow | null,
  next: WriteEnvironmentPullRequestStatusSnapshotArgs,
): boolean {
  return (
    existing === null ||
    existing.status !== next.status ||
    existing.pullRequestJson !== next.pullRequestJson ||
    existing.errorCode !== next.errorCode ||
    existing.errorMessage !== next.errorMessage
  );
}

/**
 * Preserve due-marks that arrived while a refresh was in flight: if the
 * stored schedule diverged from what the refresh observed at start, keep the
 * earlier of the mark and the computed schedule.
 */
function resolveNextRefreshAt(
  existing: { nextRefreshAt: number } | null,
  args: WriteSnapshotArgs,
): number {
  if (
    existing === null ||
    args.expectedNextRefreshAt === null ||
    existing.nextRefreshAt === args.expectedNextRefreshAt
  ) {
    return args.nextRefreshAt;
  }
  return Math.min(existing.nextRefreshAt, args.nextRefreshAt);
}

export function ensureEnvironmentStatusSnapshotRows(
  db: SnapshotWriteConnection,
  args: EnsureEnvironmentStatusSnapshotRowsArgs,
): void {
  const environmentIds = uniqueEnvironmentIds(args.environmentIds);
  if (environmentIds.length === 0) {
    return;
  }

  for (const environmentId of environmentIds) {
    db.insert(environmentGitStatusSnapshots)
      .values({
        environmentId,
        status: "pending",
        gitStatusJson: null,
        errorCode: null,
        errorMessage: null,
        refreshedAt: null,
        nextRefreshAt: args.now,
        createdAt: args.now,
        updatedAt: args.now,
      })
      .onConflictDoNothing()
      .run();

    db.insert(environmentPullRequestStatusSnapshots)
      .values({
        environmentId,
        status: "pending",
        pullRequestJson: null,
        errorCode: null,
        errorMessage: null,
        refreshedAt: null,
        nextRefreshAt: args.now,
        createdAt: args.now,
        updatedAt: args.now,
      })
      .onConflictDoNothing()
      .run();
  }
}

export function ensureTrackedEnvironmentStatusSnapshotRows(
  db: SnapshotWriteConnection,
  args: { now: number },
): void {
  ensureEnvironmentStatusSnapshotRows(db, {
    now: args.now,
    environmentIds: listTrackedEnvironmentIds(db),
  });
}

export function listTrackedEnvironmentIds(
  db: SnapshotReadConnection,
): string[] {
  return db
    .select({ environmentId: threads.environmentId })
    .from(threads)
    .innerJoin(environments, eq(threads.environmentId, environments.id))
    .where(
      and(
        isNull(threads.archivedAt),
        isNull(threads.deletedAt),
        ne(environments.status, "destroyed"),
      ),
    )
    .groupBy(threads.environmentId)
    .all()
    .flatMap((row) => (row.environmentId ? [row.environmentId] : []));
}

export function listEnvironmentSnapshotWorkspaceWatchTargetsOnHost(
  db: SnapshotReadConnection,
  hostId: string,
): EnvironmentSnapshotWorkspaceWatchTarget[] {
  return db
    .select({
      environmentId: environments.id,
      path: environments.path,
      workspaceProvisionType: environments.workspaceProvisionType,
    })
    .from(threads)
    .innerJoin(environments, eq(threads.environmentId, environments.id))
    .where(
      and(
        eq(environments.hostId, hostId),
        eq(environments.status, "ready"),
        eq(environments.isGitRepo, true),
        isNull(threads.archivedAt),
        isNull(threads.deletedAt),
      ),
    )
    .groupBy(environments.id)
    .all()
    .flatMap((row) =>
      row.path
        ? [
            {
              environmentId: row.environmentId,
              path: row.path,
              workspaceProvisionType: row.workspaceProvisionType,
            },
          ]
        : [],
    );
}

export function listEnvironmentThreadNotificationTargets(
  db: SnapshotReadConnection,
  environmentId: string,
): EnvironmentThreadNotificationTarget[] {
  return db
    .select({
      projectId: threads.projectId,
      threadId: threads.id,
    })
    .from(threads)
    .where(
      and(
        eq(threads.environmentId, environmentId),
        isNull(threads.archivedAt),
        isNull(threads.deletedAt),
      ),
    )
    .all();
}

/**
 * Only environments that are still tracked (at least one live thread, not
 * destroyed) keep refreshing; rows for other environments stay dormant until
 * a thread references the environment again. Never-refreshed rows are exempt
 * so every row resolves out of "pending" at least once — otherwise a thread
 * archived before its environment's first refresh would render a loading
 * signal forever.
 */
function environmentIsRefreshable(
  table:
    | typeof environmentGitStatusSnapshots
    | typeof environmentPullRequestStatusSnapshots,
) {
  return or(
    isNull(table.refreshedAt),
    exists(
      sql`(select 1 from ${threads}
        inner join ${environments} on ${environments.id} = ${threads.environmentId}
        where ${threads.environmentId} = ${table.environmentId}
          and ${threads.archivedAt} is null
          and ${threads.deletedAt} is null
          and ${environments.status} != 'destroyed')`,
    ),
  );
}

export function listDueEnvironmentGitStatusSnapshots(
  db: SnapshotReadConnection,
  args: DueEnvironmentStatusSnapshotsArgs,
): EnvironmentGitStatusSnapshotRow[] {
  return db
    .select()
    .from(environmentGitStatusSnapshots)
    .where(
      and(
        lte(environmentGitStatusSnapshots.nextRefreshAt, args.now),
        environmentIsRefreshable(environmentGitStatusSnapshots),
      ),
    )
    .orderBy(
      asc(environmentGitStatusSnapshots.nextRefreshAt),
      asc(environmentGitStatusSnapshots.environmentId),
    )
    .limit(args.limit)
    .all();
}

export function listDueEnvironmentPullRequestStatusSnapshots(
  db: SnapshotReadConnection,
  args: DueEnvironmentStatusSnapshotsArgs,
): EnvironmentPullRequestStatusSnapshotRow[] {
  return db
    .select()
    .from(environmentPullRequestStatusSnapshots)
    .where(
      and(
        lte(environmentPullRequestStatusSnapshots.nextRefreshAt, args.now),
        environmentIsRefreshable(environmentPullRequestStatusSnapshots),
      ),
    )
    .orderBy(
      asc(environmentPullRequestStatusSnapshots.nextRefreshAt),
      asc(environmentPullRequestStatusSnapshots.environmentId),
    )
    .limit(args.limit)
    .all();
}

export function getEnvironmentGitStatusSnapshot(
  db: SnapshotReadConnection,
  environmentId: string,
): EnvironmentGitStatusSnapshotRow | null {
  return (
    db
      .select()
      .from(environmentGitStatusSnapshots)
      .where(eq(environmentGitStatusSnapshots.environmentId, environmentId))
      .get() ?? null
  );
}

export function getEnvironmentPullRequestStatusSnapshot(
  db: SnapshotReadConnection,
  environmentId: string,
): EnvironmentPullRequestStatusSnapshotRow | null {
  return (
    db
      .select()
      .from(environmentPullRequestStatusSnapshots)
      .where(
        eq(environmentPullRequestStatusSnapshots.environmentId, environmentId),
      )
      .get() ?? null
  );
}

function markSnapshotTableDue(
  db: SnapshotWriteConnection,
  table:
    | typeof environmentGitStatusSnapshots
    | typeof environmentPullRequestStatusSnapshots,
  args: MarkEnvironmentStatusSnapshotsDueArgs,
): void {
  const environmentIds = uniqueEnvironmentIds(args.environmentIds);
  if (environmentIds.length === 0) {
    return;
  }

  if (args.floorMs === 0) {
    // Change-driven mark: something actually changed, so a refresh must START
    // at or after this mark. Restamping an already-due row matters: it makes
    // the stored schedule diverge from what an in-flight refresh observed at
    // pickup, so the writer's expectedNextRefreshAt check keeps the row due
    // instead of losing the mark under the refresh's computed schedule.
    db.update(table)
      .set({ nextRefreshAt: args.now, updatedAt: args.now })
      .where(
        and(
          inArray(table.environmentId, environmentIds),
          ne(table.nextRefreshAt, args.now),
        ),
      )
      .run();
    return;
  }

  // Demand-driven mark: never refresh sooner than refreshedAt + floorMs, and
  // only ever pull the schedule earlier. A mark that would not advance the
  // schedule is a no-op (no row write on reads of fresh rows), and an
  // already-due row is left alone — the refresh it is about to get satisfies
  // the demand.
  const target = sql`max(${args.now}, coalesce(${table.refreshedAt}, 0) + ${args.floorMs})`;
  db.update(table)
    .set({ nextRefreshAt: target, updatedAt: args.now })
    .where(
      and(
        inArray(table.environmentId, environmentIds),
        sql`${table.nextRefreshAt} > ${target}`,
      ),
    )
    .run();
}

export function markEnvironmentGitStatusSnapshotsDue(
  db: SnapshotWriteConnection,
  args: MarkEnvironmentStatusSnapshotsDueArgs,
): void {
  markSnapshotTableDue(db, environmentGitStatusSnapshots, args);
}

export function markEnvironmentPullRequestStatusSnapshotsDue(
  db: SnapshotWriteConnection,
  args: MarkEnvironmentStatusSnapshotsDueArgs,
): void {
  markSnapshotTableDue(db, environmentPullRequestStatusSnapshots, args);
}

export function markEnvironmentStatusSnapshotsDue(
  db: SnapshotWriteConnection,
  args: MarkEnvironmentStatusSnapshotsDueArgs,
): void {
  markEnvironmentGitStatusSnapshotsDue(db, args);
  markEnvironmentPullRequestStatusSnapshotsDue(db, args);
}

export function writeEnvironmentGitStatusSnapshot(
  db: SnapshotWriteConnection,
  args: WriteEnvironmentGitStatusSnapshotArgs,
): boolean {
  const existing =
    db
      .select()
      .from(environmentGitStatusSnapshots)
      .where(eq(environmentGitStatusSnapshots.environmentId, args.environmentId))
      .get() ?? null;
  const changed = visibleGitSnapshotChanged(existing, args);
  const nextRefreshAt = resolveNextRefreshAt(existing, args);

  db.insert(environmentGitStatusSnapshots)
    .values({
      environmentId: args.environmentId,
      status: args.status,
      gitStatusJson: args.gitStatusJson,
      errorCode: args.errorCode,
      errorMessage: args.errorMessage,
      refreshedAt: args.refreshedAt,
      nextRefreshAt,
      createdAt: args.now,
      updatedAt: args.now,
    })
    .onConflictDoUpdate({
      target: environmentGitStatusSnapshots.environmentId,
      set: {
        status: args.status,
        gitStatusJson: args.gitStatusJson,
        errorCode: args.errorCode,
        errorMessage: args.errorMessage,
        refreshedAt: args.refreshedAt,
        nextRefreshAt,
        updatedAt: args.now,
      },
    })
    .run();

  return changed;
}

export function writeEnvironmentPullRequestStatusSnapshot(
  db: SnapshotWriteConnection,
  args: WriteEnvironmentPullRequestStatusSnapshotArgs,
): boolean {
  const existing =
    db
      .select()
      .from(environmentPullRequestStatusSnapshots)
      .where(
        eq(
          environmentPullRequestStatusSnapshots.environmentId,
          args.environmentId,
        ),
      )
      .get() ?? null;
  const changed = visiblePullRequestSnapshotChanged(existing, args);
  const nextRefreshAt = resolveNextRefreshAt(existing, args);

  db.insert(environmentPullRequestStatusSnapshots)
    .values({
      environmentId: args.environmentId,
      status: args.status,
      pullRequestJson: args.pullRequestJson,
      errorCode: args.errorCode,
      errorMessage: args.errorMessage,
      refreshedAt: args.refreshedAt,
      nextRefreshAt,
      createdAt: args.now,
      updatedAt: args.now,
    })
    .onConflictDoUpdate({
      target: environmentPullRequestStatusSnapshots.environmentId,
      set: {
        status: args.status,
        pullRequestJson: args.pullRequestJson,
        errorCode: args.errorCode,
        errorMessage: args.errorMessage,
        refreshedAt: args.refreshedAt,
        nextRefreshAt,
        updatedAt: args.now,
      },
    })
    .run();

  return changed;
}
