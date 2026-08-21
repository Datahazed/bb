import fs from "node:fs/promises";
import path from "node:path";
import { fuzzyMatchPaths } from "@bb/fuzzy-match";
import type {
  HostPathEntry,
  HostPathEntryKind,
  PathListPolicy,
} from "@bb/host-daemon-contract";
import { WorkspaceError, runGitWithNullRecordLimit } from "@bb/host-workspace";

/**
 * Hard ceiling on the entries one listing call may produce, whichever source
 * feeds it. A bare host folder under `$HOME` or a non-git tree with a `.venv`
 * must not pin the daemon; callers see `truncated: true` instead.
 */
export const PATH_LIST_ENTRY_LIMIT = 50_000;

const GIT_LS_FILES_TIMEOUT_MS = 15_000;

interface FinalizeListedFilesArgs {
  filePaths: string[];
  limit: number;
  query?: string;
}

interface FinalizedFileList {
  files: FileListEntry[];
  truncated: boolean;
}

interface FileListEntry {
  path: string;
  name: string;
}

interface ListedPath {
  kind: HostPathEntryKind;
  path: string;
  name: string;
}

interface PathListInclusion {
  includeFiles: boolean;
  includeDirectories: boolean;
}

interface FinalizeListedPathsArgs extends PathListInclusion {
  paths: ListedPath[];
  limit: number;
  query?: string;
}

interface FinalizedPathList {
  paths: HostPathEntry[];
  truncated: boolean;
}

interface ListRootPathsArgs extends PathListInclusion, PathListPolicy {
  root: string;
}

interface ListPathsRecursivelyArgs extends PathListInclusion {
  dir: string;
  root: string;
  includeHidden: boolean;
  excludeNames: ReadonlySet<string>;
  maxEntries: number;
}

interface ListedPathList {
  paths: ListedPath[];
  /** True when the walk stopped at `maxEntries` before the tree was exhausted. */
  truncated: boolean;
}

function shouldIncludePath(
  pathKind: HostPathEntryKind,
  inclusion: PathListInclusion,
): boolean {
  return pathKind === "directory"
    ? inclusion.includeDirectories
    : inclusion.includeFiles;
}

function toFileListEntry(pathEntry: HostPathEntry): FileListEntry {
  return {
    path: pathEntry.path,
    name: pathEntry.name,
  };
}

function toListedFile(filePath: string): ListedPath {
  return {
    kind: "file",
    path: filePath,
    name: path.basename(filePath),
  };
}

export function normalizeListedPath(relativePath: string): string {
  return relativePath.replace(/\\/g, "/");
}

export function finalizeListedFiles(
  args: FinalizeListedFilesArgs,
): FinalizedFileList {
  const result = finalizeListedPaths({
    paths: args.filePaths.map(toListedFile),
    limit: args.limit,
    includeFiles: true,
    includeDirectories: false,
    ...(args.query ? { query: args.query } : {}),
  });

  return {
    files: result.paths.map(toFileListEntry),
    truncated: result.truncated,
  };
}

export function finalizeListedPaths(
  args: FinalizeListedPathsArgs,
): FinalizedPathList {
  let pathEntries = args.paths.filter((pathEntry) =>
    shouldIncludePath(pathEntry.kind, args),
  );
  let rankedEntries: HostPathEntry[];

  if (args.query) {
    const matches = fuzzyMatchPaths({
      items: pathEntries,
      query: args.query,
      getPath: (pathEntry) => pathEntry.path,
      limit: args.limit + 1,
    });
    rankedEntries = matches.map((match) => ({
      ...match.item,
      score: match.score,
      positions: match.positions,
    }));
  } else {
    rankedEntries = pathEntries.map((pathEntry) => ({
      ...pathEntry,
      score: 0,
      positions: [],
    }));
  }

  let truncated = false;
  if (rankedEntries.length > args.limit) {
    rankedEntries = rankedEntries.slice(0, args.limit);
    truncated = true;
  }

  return {
    paths: rankedEntries,
    truncated,
  };
}

function isHiddenName(name: string): boolean {
  return name.startsWith(".");
}

/**
 * Readdir walk. Applies the caller's policy at each directory entry, never
 * descends `.git` (that is not a product decision: nothing should list the
 * object store), skips symlinks so a link cycle cannot loop the walk, and
 * stops at `maxEntries`.
 */
export async function listPathsRecursively(
  args: ListPathsRecursivelyArgs,
): Promise<ListedPathList> {
  const results: ListedPath[] = [];
  // Counts every entry the walk visits, listed or not, so the bound is on
  // the work done rather than on what the caller asked to see.
  let visited = 0;
  let truncated = false;

  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (truncated) return;
      if (entry.name === ".git") continue;
      if (!args.includeHidden && isHiddenName(entry.name)) continue;
      if (args.excludeNames.has(entry.name)) continue;
      if (entry.isSymbolicLink()) continue;
      visited += 1;
      if (visited > args.maxEntries) {
        truncated = true;
        return;
      }

      const fullPath = path.join(dir, entry.name);
      const relativePath = normalizeListedPath(
        path.relative(args.root, fullPath),
      );
      if (entry.isDirectory()) {
        if (args.includeDirectories) {
          results.push({
            kind: "directory",
            path: relativePath,
            name: entry.name,
          });
        }
        await walk(fullPath);
        continue;
      }

      if (args.includeFiles) {
        results.push({
          kind: "file",
          path: relativePath,
          name: entry.name,
        });
      }
    }
  }

  await walk(args.dir);
  return { paths: results, truncated };
}

interface ListGitWorktreePathsArgs extends PathListInclusion {
  root: string;
  includeHidden: boolean;
  excludeNames: ReadonlySet<string>;
  maxEntries: number;
}

function isExcludedGitPath(
  segments: string[],
  args: Pick<ListGitWorktreePathsArgs, "includeHidden" | "excludeNames">,
): boolean {
  return segments.some(
    (segment) =>
      (!args.includeHidden && isHiddenName(segment)) ||
      args.excludeNames.has(segment),
  );
}

/**
 * Candidate list for a root inside a git worktree: tracked plus
 * untracked-not-ignored files from `git ls-files`, relative to `root` (git
 * scopes the listing to the cwd, so a project rooted in a repo subdirectory
 * lists only its own subtree). Directory entries are synthesised from the
 * file paths because git does not track directories; an empty directory
 * therefore does not appear, and a submodule shows as one file-kind entry.
 *
 * Returns `null` when `root` is not inside a git worktree, or when git lists
 * nothing — either the repository is empty (the readdir fallback then finds
 * nothing either) or the root itself is ignored, in which case the caller
 * asked for a listing of an ignored tree and should get the readdir walk.
 */
async function listGitWorktreePaths(
  args: ListGitWorktreePathsArgs,
): Promise<ListedPathList | null> {
  let result;
  try {
    result = await runGitWithNullRecordLimit(
      ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
      {
        cwd: args.root,
        allowFailure: true,
        timeoutMs: GIT_LS_FILES_TIMEOUT_MS,
      },
      "single",
      args.maxEntries + 1,
    );
  } catch (error) {
    // No git on this host, or git stalled: the readdir walk still works.
    if (error instanceof WorkspaceError) return null;
    throw error;
  }
  if (result.exitCode !== 0 || result.recordCount === 0) {
    return null;
  }

  const paths: ListedPath[] = [];
  const seenDirectories = new Set<string>();
  let truncated = result.recordLimitReached;

  // git prints the cached and the untracked sets as two separately sorted
  // runs; one sorted pass keeps the unqueried listing stable and every
  // synthesised directory ahead of its children.
  const records = result.stdout
    .split("\0")
    .filter((record) => record.length > 0)
    .sort();
  for (const record of records) {
    if (paths.length >= args.maxEntries) {
      truncated = true;
      break;
    }
    const segments = record.split("/");
    if (isExcludedGitPath(segments, args)) continue;

    if (args.includeDirectories) {
      for (let depth = 1; depth < segments.length; depth += 1) {
        const directoryPath = segments.slice(0, depth).join("/");
        if (seenDirectories.has(directoryPath)) continue;
        seenDirectories.add(directoryPath);
        if (paths.length >= args.maxEntries) {
          truncated = true;
          break;
        }
        paths.push({
          kind: "directory",
          path: directoryPath,
          name: segments[depth - 1] ?? directoryPath,
        });
      }
      if (truncated) break;
    }

    if (args.includeFiles) {
      paths.push({
        kind: "file",
        path: record,
        name: segments[segments.length - 1] ?? record,
      });
    }
  }

  return { paths, truncated };
}

/**
 * List every path under `root` according to the server-supplied policy.
 * `respectGitignore` prefers the git candidate list (see
 * `listGitWorktreePaths`); everything else, and every non-git root, takes the
 * capped readdir walk.
 */
export async function listRootPaths(
  args: ListRootPathsArgs,
): Promise<ListedPathList> {
  const excludeNames = new Set(args.excludeNames);
  if (args.respectGitignore) {
    const gitListed = await listGitWorktreePaths({
      root: args.root,
      includeFiles: args.includeFiles,
      includeDirectories: args.includeDirectories,
      includeHidden: args.includeHidden,
      excludeNames,
      maxEntries: PATH_LIST_ENTRY_LIMIT,
    });
    if (gitListed !== null) return gitListed;
  }
  return listPathsRecursively({
    dir: args.root,
    root: args.root,
    includeFiles: args.includeFiles,
    includeDirectories: args.includeDirectories,
    includeHidden: args.includeHidden,
    excludeNames,
    maxEntries: PATH_LIST_ENTRY_LIMIT,
  });
}
