// Pure helpers for sidebar folders. Thread titles are display text; folder
// membership lives in `thread.folderPath`. Slash parsing is only used by
// explicit UI affordances that choose to write folder metadata.

export interface ThreadFolderShortcut {
  /** Normalized folder path written to thread.folderPath, or null for none. */
  folderPath: string | null;
  /** Thread title written separately from the folder path. */
  title: string;
}

function splitPathSegments(value: string): string[] {
  return value
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

export function splitFolderPath(
  folderPath: string | null | undefined,
): string[] {
  if (!folderPath) {
    return [];
  }
  return splitPathSegments(folderPath);
}

export function normalizeFolderPath(
  folderPath: string | null | undefined,
): string | null {
  const normalized = splitFolderPath(folderPath).join("/");
  return normalized.length > 0 ? normalized : null;
}

export function parseThreadFolderShortcut(value: string): ThreadFolderShortcut {
  const segments = splitPathSegments(value);
  if (segments.length <= 1) {
    return { folderPath: null, title: value.trim() };
  }
  return {
    folderPath: segments.slice(0, -1).join("/"),
    title: segments[segments.length - 1],
  };
}

export function titleCreatesFolder(value: string): boolean {
  return parseThreadFolderShortcut(value).folderPath !== null;
}

// Every ancestor folder key for a stored folder path, outermost first — e.g.
// "Work/Q3" in container "p" → ["p::Work", "p::Work/Q3"]. Used to un-collapse
// the folders hiding a selected thread.
export function folderAncestorKeys(
  containerId: string,
  folderPath: string | null | undefined,
): string[] {
  const folders = splitFolderPath(folderPath);
  const keys: string[] = [];
  for (let depth = 1; depth <= folders.length; depth += 1) {
    keys.push(buildFolderKey(containerId, folders.slice(0, depth)));
  }
  return keys;
}

// Human-readable folder path, used for tooltips and accessible names. The
// visible separator differs from the stored "/" so paths read as breadcrumbs.
export const FOLDER_PATH_SEPARATOR = " › ";

export function formatFolderPathLabel(segments: readonly string[]): string {
  return segments.join(FOLDER_PATH_SEPARATOR);
}

// Stable identity for a folder within a section. `containerId` is the owner of
// the section — a `proj_*` id for project sections, or a fixed sentinel for the
// global sections — so "Work" in project A never collides with "Work" in
// project B or in pinned. Renaming an ancestor segment changes the key, which
// intentionally resets that folder's collapse state (it is a different folder).
export function buildFolderKey(
  containerId: string,
  path: readonly string[],
): string {
  return `${containerId}::${path.join("/")}`;
}
