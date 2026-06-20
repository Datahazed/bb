import { and, asc, eq, isNull, or, sql } from "drizzle-orm";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import type {
  DbConnection,
  DbQueryConnection,
  DbTransaction,
} from "../connection.js";
import { createThreadFolderId } from "../ids.js";
import type { DbNotifier } from "../notifier.js";
import { threadFolders, threads } from "../schema.js";

type ThreadFolderWriteConnection = DbConnection | DbTransaction;

export type ThreadFolderRow = typeof threadFolders.$inferSelect;

export interface CreateThreadFolderInput {
  path: string;
  projectId?: string | null;
}

export interface RenameThreadFolderInput {
  path: string;
  newPath: string;
  projectId?: string | null;
}

export interface DeleteThreadFolderInput {
  path: string;
  projectId?: string | null;
}

export interface ThreadFolderMutationResult {
  path: string;
  updatedThreadCount: number;
}

function splitFolderSegments(path: string): string[] {
  return path
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

export function normalizeThreadFolderPath(
  path: string | null | undefined,
): string | null {
  const normalized = splitFolderSegments(path ?? "").join("/");
  return normalized.length > 0 ? normalized : null;
}

function folderAncestors(path: string): string[] {
  const segments = splitFolderSegments(path);
  const ancestors: string[] = [];
  for (let depth = 1; depth <= segments.length; depth += 1) {
    ancestors.push(segments.slice(0, depth).join("/"));
  }
  return ancestors;
}

function folderPathSubtreeFilter(
  column: typeof threadFolders.path | typeof threads.folderPath,
  path: string,
) {
  return or(
    eq(column, path),
    sql`substr(${column}, 1, ${path.length + 1}) = ${`${path}/`}`,
  );
}

function folderProjectScopeFilter(projectId: string | null | undefined) {
  if (projectId === undefined) {
    return undefined;
  }
  return projectId === null
    ? isNull(threadFolders.projectId)
    : eq(threadFolders.projectId, projectId);
}

function threadProjectScopeFilter(projectId: string | null | undefined) {
  if (projectId === undefined) {
    return undefined;
  }
  return projectId === null ? sql`1 = 0` : eq(threads.projectId, projectId);
}

function replaceFolderPathPrefix(
  value: string,
  oldPath: string,
  newPath: string,
): string {
  if (value === oldPath) {
    return newPath;
  }
  return `${newPath}/${value.slice(oldPath.length + 1)}`;
}

function notifyThreadFolderMutationProjects(
  notifier: DbNotifier,
  projectIds: ReadonlySet<string | null>,
): void {
  for (const projectId of projectIds) {
    notifier.notifyProject(projectId ?? PERSONAL_PROJECT_ID, [
      "threads-changed",
    ]);
  }
}

export function isThreadFolderDescendantPath(
  path: string | null | undefined,
  possibleDescendantPath: string | null | undefined,
): boolean {
  const normalizedPath = normalizeThreadFolderPath(path);
  const normalizedDescendant = normalizeThreadFolderPath(possibleDescendantPath);
  return Boolean(
    normalizedPath &&
      normalizedDescendant &&
      normalizedDescendant.startsWith(`${normalizedPath}/`),
  );
}

export function getThreadFolderByPath(
  db: DbQueryConnection,
  path: string,
  projectId: string | null = null,
): ThreadFolderRow | null {
  const normalized = normalizeThreadFolderPath(path);
  if (!normalized) {
    return null;
  }
  const projectFilter =
    projectId === null
      ? isNull(threadFolders.projectId)
      : eq(threadFolders.projectId, projectId);
  return (
    db
      .select()
      .from(threadFolders)
      .where(and(eq(threadFolders.path, normalized), projectFilter))
      .get() ?? null
  );
}

export function listThreadFolders(db: DbQueryConnection): ThreadFolderRow[] {
  return db
    .select()
    .from(threadFolders)
    .orderBy(
      asc(threadFolders.projectId),
      asc(threadFolders.path),
      asc(threadFolders.id),
    )
    .all();
}

export function ensureThreadFolderPath(
  db: ThreadFolderWriteConnection,
  notifier: DbNotifier,
  path: string | null | undefined,
  projectId: string | null = null,
): ThreadFolderRow | null {
  const normalized = normalizeThreadFolderPath(path);
  if (!normalized) {
    return null;
  }
  const scopedProjectId = projectId ?? null;

  const now = Date.now();
  let createdAny = false;
  let deepest: ThreadFolderRow | null = null;
  for (const ancestorPath of folderAncestors(normalized)) {
    const inserted =
      db
        .insert(threadFolders)
        .values({
          id: createThreadFolderId(),
          projectId: scopedProjectId,
          path: ancestorPath,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .returning()
        .get() ?? null;
    if (inserted) {
      createdAny = true;
      deepest = inserted;
      continue;
    }
    deepest = getThreadFolderByPath(db, ancestorPath, scopedProjectId);
  }

  if (createdAny) {
    notifier.notifyProject(scopedProjectId ?? PERSONAL_PROJECT_ID, [
      "threads-changed",
    ]);
  }
  return deepest;
}

export function createThreadFolder(
  db: DbConnection,
  notifier: DbNotifier,
  input: CreateThreadFolderInput,
): ThreadFolderRow {
  const folder = ensureThreadFolderPath(
    db,
    notifier,
    input.path,
    input.projectId ?? null,
  );
  if (!folder) {
    throw new Error("Thread folder path cannot be empty");
  }
  return folder;
}

export function renameThreadFolder(
  db: DbConnection,
  notifier: DbNotifier,
  input: RenameThreadFolderInput,
): ThreadFolderMutationResult | null {
  const path = normalizeThreadFolderPath(input.path);
  const newPath = normalizeThreadFolderPath(input.newPath);
  if (!path || !newPath) {
    return null;
  }
  if (path === newPath) {
    return { path: newPath, updatedThreadCount: 0 };
  }
  if (isThreadFolderDescendantPath(path, newPath)) {
    return null;
  }

  return db.transaction(
    (tx) => {
      const matchingFolders = tx
        .select()
        .from(threadFolders)
        .where(
          and(
            folderPathSubtreeFilter(threadFolders.path, path),
            folderProjectScopeFilter(input.projectId),
          ),
        )
        .all();
      const matchingThreads = tx
        .select({
          id: threads.id,
          projectId: threads.projectId,
          folderPath: threads.folderPath,
        })
        .from(threads)
        .where(
          and(
            folderPathSubtreeFilter(threads.folderPath, path),
            threadProjectScopeFilter(input.projectId),
          ),
        )
        .all();

      if (matchingFolders.length === 0 && matchingThreads.length === 0) {
        return null;
      }

      tx.delete(threadFolders)
        .where(
          and(
            folderPathSubtreeFilter(threadFolders.path, path),
            folderProjectScopeFilter(input.projectId),
          ),
        )
        .run();

      const affectedProjects = new Set<string | null>();
      for (const folder of matchingFolders) {
        affectedProjects.add(folder.projectId);
        ensureThreadFolderPath(
          tx,
          notifier,
          replaceFolderPathPrefix(folder.path, path, newPath),
          folder.projectId,
        );
      }

      const now = Date.now();
      for (const thread of matchingThreads) {
        if (!thread.folderPath) {
          continue;
        }
        const nextFolderPath = replaceFolderPathPrefix(
          thread.folderPath,
          path,
          newPath,
        );
        affectedProjects.add(thread.projectId);
        ensureThreadFolderPath(tx, notifier, nextFolderPath, thread.projectId);
        tx.update(threads)
          .set({ folderPath: nextFolderPath, updatedAt: now })
          .where(eq(threads.id, thread.id))
          .run();
        notifier.notifyThread(thread.id, ["title-changed"], {
          projectId: thread.projectId,
        });
      }

      notifyThreadFolderMutationProjects(notifier, affectedProjects);
      return { path: newPath, updatedThreadCount: matchingThreads.length };
    },
    { behavior: "immediate" },
  );
}

export function deleteThreadFolder(
  db: DbConnection,
  notifier: DbNotifier,
  input: DeleteThreadFolderInput,
): ThreadFolderMutationResult | null {
  const path = normalizeThreadFolderPath(input.path);
  if (!path) {
    return null;
  }

  return db.transaction(
    (tx) => {
      const matchingFolders = tx
        .select()
        .from(threadFolders)
        .where(
          and(
            folderPathSubtreeFilter(threadFolders.path, path),
            folderProjectScopeFilter(input.projectId),
          ),
        )
        .all();
      const matchingThreads = tx
        .select({
          id: threads.id,
          projectId: threads.projectId,
        })
        .from(threads)
        .where(
          and(
            folderPathSubtreeFilter(threads.folderPath, path),
            threadProjectScopeFilter(input.projectId),
          ),
        )
        .all();

      if (matchingFolders.length === 0 && matchingThreads.length === 0) {
        return null;
      }

      tx.delete(threadFolders)
        .where(
          and(
            folderPathSubtreeFilter(threadFolders.path, path),
            folderProjectScopeFilter(input.projectId),
          ),
        )
        .run();

      const now = Date.now();
      const affectedProjects = new Set<string | null>(
        matchingFolders.map((folder) => folder.projectId),
      );
      for (const thread of matchingThreads) {
        affectedProjects.add(thread.projectId);
        tx.update(threads)
          .set({ folderPath: null, updatedAt: now })
          .where(eq(threads.id, thread.id))
          .run();
        notifier.notifyThread(thread.id, ["title-changed"], {
          projectId: thread.projectId,
        });
      }

      notifyThreadFolderMutationProjects(notifier, affectedProjects);
      return { path, updatedThreadCount: matchingThreads.length };
    },
    { behavior: "immediate" },
  );
}
