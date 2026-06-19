import { asc, eq } from "drizzle-orm";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import type {
  DbConnection,
  DbQueryConnection,
  DbTransaction,
} from "../connection.js";
import { createThreadFolderId } from "../ids.js";
import type { DbNotifier } from "../notifier.js";
import { threadFolders } from "../schema.js";

type ThreadFolderWriteConnection = DbConnection | DbTransaction;

export type ThreadFolderRow = typeof threadFolders.$inferSelect;

export interface CreateThreadFolderInput {
  path: string;
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

export function getThreadFolderByPath(
  db: DbQueryConnection,
  path: string,
): ThreadFolderRow | null {
  const normalized = normalizeThreadFolderPath(path);
  if (!normalized) {
    return null;
  }
  return (
    db
      .select()
      .from(threadFolders)
      .where(eq(threadFolders.path, normalized))
      .get() ?? null
  );
}

export function listThreadFolders(db: DbQueryConnection): ThreadFolderRow[] {
  return db
    .select()
    .from(threadFolders)
    .orderBy(asc(threadFolders.path), asc(threadFolders.id))
    .all();
}

export function ensureThreadFolderPath(
  db: ThreadFolderWriteConnection,
  notifier: DbNotifier,
  path: string | null | undefined,
): ThreadFolderRow | null {
  const normalized = normalizeThreadFolderPath(path);
  if (!normalized) {
    return null;
  }

  const now = Date.now();
  let createdAny = false;
  let deepest: ThreadFolderRow | null = null;
  for (const ancestorPath of folderAncestors(normalized)) {
    const inserted =
      db
        .insert(threadFolders)
        .values({
          id: createThreadFolderId(),
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
    deepest = getThreadFolderByPath(db, ancestorPath);
  }

  if (createdAny) {
    notifier.notifyProject(PERSONAL_PROJECT_ID, ["threads-changed"]);
  }
  return deepest;
}

export function createThreadFolder(
  db: DbConnection,
  notifier: DbNotifier,
  input: CreateThreadFolderInput,
): ThreadFolderRow {
  const folder = ensureThreadFolderPath(db, notifier, input.path);
  if (!folder) {
    throw new Error("Thread folder path cannot be empty");
  }
  return folder;
}
