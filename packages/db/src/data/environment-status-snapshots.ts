import { and, asc, eq, inArray, isNull, lte, ne } from "drizzle-orm";
import type { WorkspaceProvisionType } from "@bb/domain";
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
  | "available"
  | "not_applicable"
  | "unavailable";

interface EnsureEnvironmentStatusSnapshotRowsArgs {
  environmentIds: readonly string[];
  now: number;
}

interface DueEnvironmentStatusSnapshotsArgs {
  limit: number;
  now: number;
}

interface MarkEnvironmentStatusSnapshotDueArgs {
  environmentId: string;
  now: number;
}

interface MarkEnvironmentStatusSnapshotsDueArgs {
  environmentIds: readonly string[];
  now: number;
}

interface WriteSnapshotArgs {
  environmentId: string;
  errorCode?: string | null;
  errorMessage?: string | null;
  nextRefreshAt: number;
  now: number;
  refreshedAt: number;
  status: EnvironmentStatusSnapshotStatus;
}

export interface WriteEnvironmentGitStatusSnapshotArgs
  extends WriteSnapshotArgs {
  gitStatusJson?: string | null;
}

export interface WriteEnvironmentPullRequestStatusSnapshotArgs
  extends WriteSnapshotArgs {
  pullRequestJson?: string | null;
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
    existing.gitStatusJson !== (next.gitStatusJson ?? null) ||
    existing.errorCode !== (next.errorCode ?? null) ||
    existing.errorMessage !== (next.errorMessage ?? null)
  );
}

function visiblePullRequestSnapshotChanged(
  existing: EnvironmentPullRequestStatusSnapshotRow | null,
  next: WriteEnvironmentPullRequestStatusSnapshotArgs,
): boolean {
  return (
    existing === null ||
    existing.status !== next.status ||
    existing.pullRequestJson !== (next.pullRequestJson ?? null) ||
    existing.errorCode !== (next.errorCode ?? null) ||
    existing.errorMessage !== (next.errorMessage ?? null)
  );
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

export function listDueEnvironmentGitStatusSnapshots(
  db: SnapshotReadConnection,
  args: DueEnvironmentStatusSnapshotsArgs,
): EnvironmentGitStatusSnapshotRow[] {
  return db
    .select()
    .from(environmentGitStatusSnapshots)
    .where(lte(environmentGitStatusSnapshots.nextRefreshAt, args.now))
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
    .where(lte(environmentPullRequestStatusSnapshots.nextRefreshAt, args.now))
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

export function markEnvironmentGitStatusSnapshotDue(
  db: SnapshotWriteConnection,
  args: MarkEnvironmentStatusSnapshotDueArgs,
): void {
  db.update(environmentGitStatusSnapshots)
    .set({ nextRefreshAt: args.now, updatedAt: args.now })
    .where(eq(environmentGitStatusSnapshots.environmentId, args.environmentId))
    .run();
}

export function markEnvironmentPullRequestStatusSnapshotDue(
  db: SnapshotWriteConnection,
  args: MarkEnvironmentStatusSnapshotDueArgs,
): void {
  db.update(environmentPullRequestStatusSnapshots)
    .set({ nextRefreshAt: args.now, updatedAt: args.now })
    .where(
      eq(
        environmentPullRequestStatusSnapshots.environmentId,
        args.environmentId,
      ),
    )
    .run();
}

export function markEnvironmentStatusSnapshotsDue(
  db: SnapshotWriteConnection,
  args: MarkEnvironmentStatusSnapshotsDueArgs,
): void {
  const environmentIds = uniqueEnvironmentIds(args.environmentIds);
  if (environmentIds.length === 0) {
    return;
  }

  db.update(environmentGitStatusSnapshots)
    .set({ nextRefreshAt: args.now, updatedAt: args.now })
    .where(inArray(environmentGitStatusSnapshots.environmentId, environmentIds))
    .run();
  db.update(environmentPullRequestStatusSnapshots)
    .set({ nextRefreshAt: args.now, updatedAt: args.now })
    .where(
      inArray(
        environmentPullRequestStatusSnapshots.environmentId,
        environmentIds,
      ),
    )
    .run();
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

  db.insert(environmentGitStatusSnapshots)
    .values({
      environmentId: args.environmentId,
      status: args.status,
      gitStatusJson: args.gitStatusJson ?? null,
      errorCode: args.errorCode ?? null,
      errorMessage: args.errorMessage ?? null,
      refreshedAt: args.refreshedAt,
      nextRefreshAt: args.nextRefreshAt,
      createdAt: args.now,
      updatedAt: args.now,
    })
    .onConflictDoUpdate({
      target: environmentGitStatusSnapshots.environmentId,
      set: {
        status: args.status,
        gitStatusJson: args.gitStatusJson ?? null,
        errorCode: args.errorCode ?? null,
        errorMessage: args.errorMessage ?? null,
        refreshedAt: args.refreshedAt,
        nextRefreshAt: args.nextRefreshAt,
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

  db.insert(environmentPullRequestStatusSnapshots)
    .values({
      environmentId: args.environmentId,
      status: args.status,
      pullRequestJson: args.pullRequestJson ?? null,
      errorCode: args.errorCode ?? null,
      errorMessage: args.errorMessage ?? null,
      refreshedAt: args.refreshedAt,
      nextRefreshAt: args.nextRefreshAt,
      createdAt: args.now,
      updatedAt: args.now,
    })
    .onConflictDoUpdate({
      target: environmentPullRequestStatusSnapshots.environmentId,
      set: {
        status: args.status,
        pullRequestJson: args.pullRequestJson ?? null,
        errorCode: args.errorCode ?? null,
        errorMessage: args.errorMessage ?? null,
        refreshedAt: args.refreshedAt,
        nextRefreshAt: args.nextRefreshAt,
        updatedAt: args.now,
      },
    })
    .run();

  return changed;
}
