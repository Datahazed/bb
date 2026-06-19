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
