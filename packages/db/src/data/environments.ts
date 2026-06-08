import { and, eq, inArray, ne } from "drizzle-orm";
import type {
  DiscoveredWorkspaceProperties,
  EnvironmentChangeKind,
  EnvironmentCleanupMode,
  EnvironmentStatus,
  WorkspaceProvisionType,
} from "@bb/domain";
import type { DbConnection, DbTransaction } from "../connection.js";
import type { DbNotifier } from "../notifier.js";
import { environments } from "../schema.js";
import { createEnvironmentId } from "../ids.js";

type EnvironmentReadConnection = DbConnection | DbTransaction;
type EnvironmentWriteConnection = DbConnection | DbTransaction;
type EnvironmentRow = typeof environments.$inferSelect;

export interface CreateEnvironmentInput {
  cleanupMode?: EnvironmentCleanupMode | null;
  cleanupRequestedAt?: number | null;
  projectId: string;
  hostId: string;
  workspaceProvisionType: WorkspaceProvisionType;
  path?: string | null;
  managed?: boolean;
  isGitRepo?: boolean;
  isWorktree?: boolean;
  branchName?: string | null;
  baseBranch?: string | null;
  defaultBranch?: string | null;
  mergeBaseBranch?: string | null;
  status?: EnvironmentStatus;
}

export function createEnvironment(
  db: EnvironmentWriteConnection,
  notifier: DbNotifier,
  input: CreateEnvironmentInput,
) {
  const now = Date.now();
  const id = createEnvironmentId();
  const row = db
    .insert(environments)
    .values({
      id,
      projectId: input.projectId,
      hostId: input.hostId,
      path: input.path ?? null,
      managed: input.managed ?? false,
      isGitRepo: input.isGitRepo ?? false,
      isWorktree: input.isWorktree ?? false,
      branchName: input.branchName ?? null,
      baseBranch: input.baseBranch ?? null,
      defaultBranch: input.defaultBranch ?? null,
      mergeBaseBranch: input.mergeBaseBranch ?? null,
      cleanupRequestedAt: input.cleanupRequestedAt ?? null,
      cleanupMode: input.cleanupMode ?? null,
      workspaceProvisionType: input.workspaceProvisionType,
      status: input.status ?? "provisioning",
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  notifier.notifyEnvironment(id, ["environment-created"]);
  return row;
}

export function getEnvironment(db: EnvironmentReadConnection, id: string) {
  return (
    db.select().from(environments).where(eq(environments.id, id)).get() ?? null
  );
}

export function findEnvironmentByHostPath(
  db: DbConnection,
  hostId: string,
  path: string,
) {
  return (
    db
      .select()
      .from(environments)
      .where(and(eq(environments.hostId, hostId), eq(environments.path, path)))
      .get() ?? null
  );
}

export function listEnvironments(db: DbConnection, projectId?: string) {
  if (projectId) {
    return db
      .select()
      .from(environments)
      .where(eq(environments.projectId, projectId))
      .all();
  }
  return db.select().from(environments).all();
}

export function listEnvironmentsByIds(
  db: DbConnection,
  environmentIds: readonly string[],
) {
  if (environmentIds.length === 0) {
    return [];
  }

  return db
    .select()
    .from(environments)
    .where(inArray(environments.id, [...environmentIds]))
    .all();
}

interface EnvironmentMetadataUpdateColumns {
  baseBranch?: string | null;
  branchName?: string | null;
  defaultBranch?: string | null;
  isGitRepo?: boolean;
  isWorktree?: boolean;
  mergeBaseBranch?: string | null;
  path?: string | null;
}

interface EnvironmentCleanupUpdateColumns {
  cleanupMode: EnvironmentCleanupMode | null;
  cleanupRequestedAt: number | null;
}

interface EnvironmentMetadataChangeArgs {
  existing: EnvironmentRow;
  metadata: EnvironmentMetadataUpdateColumns;
  updated: EnvironmentRow;
}

interface EnvironmentCleanupChangeArgs {
  existing: EnvironmentRow;
  updated: EnvironmentRow;
}

interface EnvironmentStatusChangeArgs {
  existing: EnvironmentRow;
  updated: EnvironmentRow;
}

export interface ApplyProvisionedEnvironmentInput extends DiscoveredWorkspaceProperties {
  baseBranch?: string | null;
  mergeBaseBranch?: string | null;
  status: EnvironmentStatus;
}

export interface UpdateEnvironmentMetadataInput {
  mergeBaseBranch: string | null;
}

export interface UpdateEnvironmentStatusInput {
  status: EnvironmentStatus;
}

export interface RequestEnvironmentCleanupInput {
  requestedAt?: number;
}

export interface ClaimManagedEnvironmentReprovisionArgs {
  environmentId: string;
  now?: number;
}

export interface ListRetiredLoadedEnvironmentIdsOnHostArgs {
  environmentIds: readonly string[];
  hostId: string;
}

export function listRetiredLoadedEnvironmentIdsOnHost(
  db: EnvironmentReadConnection,
  args: ListRetiredLoadedEnvironmentIdsOnHostArgs,
): string[] {
  const environmentIds = [...new Set(args.environmentIds)];
  if (environmentIds.length === 0) {
    return [];
  }

  const retainedRows = db
    .select({ id: environments.id })
    .from(environments)
    .where(
      and(
        inArray(environments.id, environmentIds),
        eq(environments.hostId, args.hostId),
        ne(environments.status, "destroyed"),
      ),
    )
    .all();
  const retainedEnvironmentIds = new Set(
    retainedRows.map((environment) => environment.id),
  );

  return environmentIds.filter(
    (environmentId) => !retainedEnvironmentIds.has(environmentId),
  );
}

function buildEnvironmentMetadataUpdateSet(
  input: EnvironmentMetadataUpdateColumns,
): EnvironmentMetadataUpdateColumns {
  const set: EnvironmentMetadataUpdateColumns = {};
  if ("baseBranch" in input) set.baseBranch = input.baseBranch;
  if ("path" in input) set.path = input.path;
  if ("isGitRepo" in input) set.isGitRepo = input.isGitRepo;
  if ("isWorktree" in input) set.isWorktree = input.isWorktree;
  if ("branchName" in input) set.branchName = input.branchName;
  if ("defaultBranch" in input) set.defaultBranch = input.defaultBranch;
  if ("mergeBaseBranch" in input) set.mergeBaseBranch = input.mergeBaseBranch;
  return set;
}

function environmentMetadataChanged(
  args: EnvironmentMetadataChangeArgs,
): boolean {
  return (
    ("baseBranch" in args.metadata &&
      args.updated.baseBranch !== args.existing.baseBranch) ||
    ("path" in args.metadata && args.updated.path !== args.existing.path) ||
    ("isGitRepo" in args.metadata &&
      args.updated.isGitRepo !== args.existing.isGitRepo) ||
    ("isWorktree" in args.metadata &&
      args.updated.isWorktree !== args.existing.isWorktree) ||
    ("branchName" in args.metadata &&
      args.updated.branchName !== args.existing.branchName) ||
    ("defaultBranch" in args.metadata &&
      args.updated.defaultBranch !== args.existing.defaultBranch) ||
    ("mergeBaseBranch" in args.metadata &&
      args.updated.mergeBaseBranch !== args.existing.mergeBaseBranch)
  );
}

function environmentCleanupChanged(args: EnvironmentCleanupChangeArgs): boolean {
  return (
    args.updated.cleanupRequestedAt !== args.existing.cleanupRequestedAt ||
    args.updated.cleanupMode !== args.existing.cleanupMode
  );
}

function environmentStatusChanged(args: EnvironmentStatusChangeArgs): boolean {
  return args.updated.status !== args.existing.status;
}

function updateEnvironmentMetadataRecord(
  db: EnvironmentWriteConnection,
  notifier: DbNotifier,
  id: string,
  metadataInput: EnvironmentMetadataUpdateColumns,
) {
  const existing = getEnvironment(db, id);
  if (!existing) return null;

  const metadata = buildEnvironmentMetadataUpdateSet(metadataInput);
  const updated = db
    .update(environments)
    .set({ ...metadata, updatedAt: Date.now() })
    .where(eq(environments.id, id))
    .returning()
    .get();

  if (!updated) {
    return null;
  }

  if (environmentMetadataChanged({ existing, metadata, updated })) {
    notifier.notifyEnvironment(id, ["metadata-changed"]);
  }

  return updated;
}

function updateEnvironmentStatusRecord(
  db: EnvironmentWriteConnection,
  notifier: DbNotifier,
  id: string,
  status: EnvironmentStatus,
) {
  const existing = getEnvironment(db, id);
  if (!existing) return null;

  const updated = db
    .update(environments)
    .set({ status, updatedAt: Date.now() })
    .where(eq(environments.id, id))
    .returning()
    .get();

  if (!updated) {
    return null;
  }

  if (environmentStatusChanged({ existing, updated })) {
    notifier.notifyEnvironment(id, ["status-changed"]);
  }

  return updated;
}

function updateEnvironmentCleanupRecord(
  db: EnvironmentWriteConnection,
  notifier: DbNotifier,
  id: string,
  cleanup: EnvironmentCleanupUpdateColumns,
) {
  const existing = getEnvironment(db, id);
  if (!existing) return null;

  const updated = db
    .update(environments)
    .set({ ...cleanup, updatedAt: Date.now() })
    .where(eq(environments.id, id))
    .returning()
    .get();

  if (!updated) {
    return null;
  }

  if (environmentCleanupChanged({ existing, updated })) {
    notifier.notifyEnvironment(id, ["metadata-changed"]);
  }

  return updated;
}

export function applyProvisionedEnvironmentRecord(
  db: EnvironmentWriteConnection,
  notifier: DbNotifier,
  id: string,
  input: ApplyProvisionedEnvironmentInput,
) {
  const existing = getEnvironment(db, id);
  if (!existing) return null;

  const metadata = buildEnvironmentMetadataUpdateSet({
    path: input.path,
    isGitRepo: input.isGitRepo,
    isWorktree: input.isWorktree,
    branchName: input.branchName,
    ...(input.baseBranch !== undefined ? { baseBranch: input.baseBranch } : {}),
    defaultBranch: input.defaultBranch,
    ...(input.mergeBaseBranch !== undefined
      ? { mergeBaseBranch: input.mergeBaseBranch }
      : {}),
  });
  const updated = db
    .update(environments)
    .set({ ...metadata, status: input.status, updatedAt: Date.now() })
    .where(eq(environments.id, id))
    .returning()
    .get();

  if (!updated) {
    return null;
  }

  const changes: EnvironmentChangeKind[] = [];
  if (environmentStatusChanged({ existing, updated })) {
    changes.push("status-changed");
  }
  if (environmentMetadataChanged({ existing, metadata, updated })) {
    changes.push("metadata-changed");
  }
  if (changes.length > 0) {
    notifier.notifyEnvironment(id, changes);
  }

  return updated;
}

export function updateEnvironmentMetadata(
  db: EnvironmentWriteConnection,
  notifier: DbNotifier,
  id: string,
  input: UpdateEnvironmentMetadataInput,
) {
  return updateEnvironmentMetadataRecord(db, notifier, id, {
    mergeBaseBranch: input.mergeBaseBranch,
  });
}

export function setEnvironmentStatus(
  db: EnvironmentWriteConnection,
  notifier: DbNotifier,
  id: string,
  input: UpdateEnvironmentStatusInput,
) {
  return updateEnvironmentStatusRecord(db, notifier, id, input.status);
}

export function recordEnvironmentCleanupRequest(
  db: EnvironmentWriteConnection,
  notifier: DbNotifier,
  id: string,
  input: RequestEnvironmentCleanupInput,
) {
  const existing = getEnvironment(db, id);
  if (!existing) {
    return null;
  }

  return updateEnvironmentCleanupRecord(db, notifier, id, {
    cleanupRequestedAt:
      existing.cleanupRequestedAt ?? input.requestedAt ?? Date.now(),
    cleanupMode: "safe",
  });
}

export function clearEnvironmentCleanupRequestRecord(
  db: EnvironmentWriteConnection,
  notifier: DbNotifier,
  id: string,
) {
  return updateEnvironmentCleanupRecord(db, notifier, id, {
    cleanupRequestedAt: null,
    cleanupMode: null,
  });
}

export function setEnvironmentRecordDestroyed(
  db: EnvironmentWriteConnection,
  notifier: DbNotifier,
  id: string,
) {
  const existing = getEnvironment(db, id);
  if (!existing) return null;

  const cleanup: EnvironmentCleanupUpdateColumns = {
    cleanupRequestedAt: null,
    cleanupMode: null,
  };
  const updated = db
    .update(environments)
    .set({ ...cleanup, status: "destroyed", updatedAt: Date.now() })
    .where(eq(environments.id, id))
    .returning()
    .get();

  if (!updated) {
    return null;
  }

  const changes: EnvironmentChangeKind[] = [];
  if (environmentStatusChanged({ existing, updated })) {
    changes.push("status-changed");
  }
  if (environmentCleanupChanged({ existing, updated })) {
    changes.push("metadata-changed");
  }
  if (changes.length > 0) {
    notifier.notifyEnvironment(id, changes);
  }

  return updated;
}

