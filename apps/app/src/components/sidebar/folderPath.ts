// Pure helpers for the sidebar's derived folder layer. A thread title carries
// its folder path inline: "/" is read as a separator, so "Work/Q3/Plan" is a
// thread named "Plan" inside folders "Work" › "Q3". Nothing about folders is
// stored — these functions are the single canonical home for parsing a title
// into its folder ancestors + leaf, normalizing a title before it is written
// back on rename, and detecting whether a title creates a folder.

export interface ThreadFolderPath {
  /** Folder ancestors, outermost first. Empty when the title has no folder. */
  folders: string[];
  /** The thread's own name — the last path segment (or the whole title). */
  leaf: string;
}

// Split a title into its non-empty, trimmed segments. Collapses leading,
// trailing, and doubled slashes and trims whitespace around each segment, so
// "/Work//Q3/" and "Work / Q3 " both yield ["Work", "Q3"]. Shared by every
// other helper here so parsing, normalizing, and detection stay consistent and
// idempotent (re-running on already-normalized input is a no-op).
function splitTitleSegments(title: string): string[] {
  return title
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

// Split a stored title into folder ancestors + leaf for rendering. A single
// segment (or an all-slashes/empty title) has no folder. The leaf is always the
// final segment; for an empty result the leaf is "".
export function parseThreadFolderPath(title: string): ThreadFolderPath {
  const segments = splitTitleSegments(title);
  if (segments.length === 0) {
    return { folders: [], leaf: "" };
  }
  return {
    folders: segments.slice(0, -1),
    leaf: segments[segments.length - 1],
  };
}

// Canonical form written back on rename submit: split → trim → drop empties →
// re-join with "/". "///" normalizes to "" (then blocked by empty-name
// validation upstream); "Work / Q3 " normalizes to "Work/Q3".
export function normalizeThreadTitle(title: string): string {
  return splitTitleSegments(title).join("/");
}

// True when the normalized title yields at least one folder segment, i.e. two
// or more segments survive normalization. "Work/Q3" → true; "Work", "Work/",
// and "///" → false.
export function titleCreatesFolder(title: string): boolean {
  return parseThreadFolderPath(title).folders.length > 0;
}

// Every ancestor folder key for a title, outermost first — e.g. "Work/Q3/Plan"
// in container "p" → ["p::Work", "p::Work/Q3"]. Used to un-collapse the folders
// hiding a selected thread. Derive `title` from the thread that is actually
// bucketed (a section's top-level thread), since a nested child's "/" is ignored.
export function folderAncestorKeys(
  containerId: string,
  title: string,
): string[] {
  const { folders } = parseThreadFolderPath(title);
  const keys: string[] = [];
  for (let depth = 1; depth <= folders.length; depth += 1) {
    keys.push(buildFolderKey(containerId, folders.slice(0, depth)));
  }
  return keys;
}

// Human-readable folder path, used for tooltips, accessible names, and the
// rename preview ("Work › Q3 › Planning"). The visible separator differs from
// the stored "/" so a path reads as breadcrumbs, not a literal title.
export const FOLDER_PATH_SEPARATOR = " › ";

export function formatFolderPathLabel(segments: readonly string[]): string {
  return segments.join(FOLDER_PATH_SEPARATOR);
}

// Re-file a thread into a destination folder path while keeping its current
// leaf. An empty destination strips the folder prefix and returns just the leaf.
export function buildThreadTitleForFolderPath(
  title: string,
  destinationFolders: readonly string[],
): string {
  const { leaf } = parseThreadFolderPath(title);
  return normalizeThreadTitle([...destinationFolders, leaf].join("/"));
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
