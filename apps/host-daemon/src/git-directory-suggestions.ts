import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fuzzyMatchPaths } from "@bb/fuzzy-match";
import type {
  GitDirectorySuggestion,
  GitDirectorySuggestionsRequest,
  GitDirectorySuggestionsResponse,
} from "@bb/host-daemon-contract";

const DEFAULT_KNOWN_ROOT_MAX_DEPTH = 2;
const DEFAULT_INDEX_TTL_MS = 30_000;
const EXCLUDED_DIRECTORY_NAMES = new Set([
  "node_modules",
  "bower_components",
  "jspm_packages",
  "vendor",
]);

export interface GitDirectorySuggestionServiceOptions {
  searchRoots?: readonly string[];
  maxDepth?: number;
  indexTtlMs?: number;
  now?: () => number;
}

export interface GitDirectorySuggestionService {
  suggest(
    request: GitDirectorySuggestionsRequest,
  ): Promise<GitDirectorySuggestionsResponse>;
}

interface GitDirectoryIndex {
  directories: GitDirectorySuggestion[];
  updatedAt: number;
}

function isHiddenDirectoryName(name: string): boolean {
  return name.startsWith(".");
}

function shouldPruneDirectoryName(name: string): boolean {
  return isHiddenDirectoryName(name) || EXCLUDED_DIRECTORY_NAMES.has(name);
}

function isMissingOrUnreadableDirectoryError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "ENOENT" ||
      error.code === "ENOTDIR" ||
      error.code === "EACCES" ||
      error.code === "EPERM")
  );
}

async function safeReadDirectory(
  dirPath: string,
): Promise<Dirent[] | null> {
  try {
    return await fs.readdir(dirPath, { withFileTypes: true });
  } catch (error) {
    if (isMissingOrUnreadableDirectoryError(error)) {
      return null;
    }
    throw error;
  }
}

async function hasGitMarker(directoryPath: string): Promise<boolean> {
  try {
    const stat = await fs.lstat(path.join(directoryPath, ".git"));
    return stat.isDirectory() || stat.isFile();
  } catch (error) {
    if (isMissingOrUnreadableDirectoryError(error)) {
      return false;
    }
    throw error;
  }
}

function toSuggestion(directoryPath: string): GitDirectorySuggestion {
  return {
    path: directoryPath,
    name: path.basename(directoryPath),
  };
}

function rankSuggestions(
  directories: readonly GitDirectorySuggestion[],
  query: string | undefined,
  limit: number,
): GitDirectorySuggestionsResponse {
  const matches = fuzzyMatchPaths({
    items: directories,
    query: query ?? "",
    getPath: (directory) => directory.path,
    limit: limit + 1,
  });
  const limitedMatches = matches.slice(0, limit);
  return {
    directories: limitedMatches.map((match) => match.item),
    truncated: matches.length > limit,
  };
}

async function listDirectGitDirectoryChildren(
  parentPath: string,
): Promise<GitDirectorySuggestion[]> {
  if (!path.isAbsolute(parentPath)) {
    return [];
  }

  const entries = await safeReadDirectory(parentPath);
  if (!entries) {
    return [];
  }

  const directories: GitDirectorySuggestion[] = [];
  for (const entry of entries) {
    if (
      !entry.isDirectory() ||
      entry.isSymbolicLink() ||
      shouldPruneDirectoryName(entry.name)
    ) {
      continue;
    }

    const directoryPath = path.join(parentPath, entry.name);
    if (await hasGitMarker(directoryPath)) {
      directories.push(toSuggestion(directoryPath));
    }
  }
  return directories.sort((left, right) => left.path.localeCompare(right.path));
}

async function scanKnownRoot(
  rootPath: string,
  maxDepth: number,
): Promise<GitDirectorySuggestion[]> {
  const root = path.resolve(rootPath);
  const directories: GitDirectorySuggestion[] = [];

  async function scanDirectory(dirPath: string, depth: number): Promise<void> {
    const entries = await safeReadDirectory(dirPath);
    if (!entries) {
      return;
    }

    for (const entry of entries) {
      if (
        !entry.isDirectory() ||
        entry.isSymbolicLink() ||
        shouldPruneDirectoryName(entry.name)
      ) {
        continue;
      }

      const directoryPath = path.join(dirPath, entry.name);
      if (await hasGitMarker(directoryPath)) {
        directories.push(toSuggestion(directoryPath));
        continue;
      }

      if (depth < maxDepth) {
        await scanDirectory(directoryPath, depth + 1);
      }
    }
  }

  await scanDirectory(root, 1);
  return directories;
}

async function scanKnownRootGitDirectories(
  roots: readonly string[],
  maxDepth: number,
): Promise<GitDirectorySuggestion[]> {
  const byPath = new Map<string, GitDirectorySuggestion>();
  for (const root of roots) {
    for (const directory of await scanKnownRoot(root, maxDepth)) {
      byPath.set(directory.path, directory);
    }
  }

  return Array.from(byPath.values()).sort((left, right) =>
    left.path.localeCompare(right.path),
  );
}

export function createGitDirectorySuggestionService(
  options: GitDirectorySuggestionServiceOptions = {},
): GitDirectorySuggestionService {
  const roots = options.searchRoots ?? [os.homedir()];
  const maxDepth = options.maxDepth ?? DEFAULT_KNOWN_ROOT_MAX_DEPTH;
  const indexTtlMs = options.indexTtlMs ?? DEFAULT_INDEX_TTL_MS;
  const now = options.now ?? Date.now;
  let index: GitDirectoryIndex | null = null;
  let refreshPromise: Promise<GitDirectoryIndex> | null = null;

  async function refreshIndex(): Promise<GitDirectoryIndex> {
    if (refreshPromise) {
      return refreshPromise;
    }

    refreshPromise = scanKnownRootGitDirectories(roots, maxDepth)
      .then((directories) => {
        const nextIndex = { directories, updatedAt: now() };
        index = nextIndex;
        return nextIndex;
      })
      .finally(() => {
        refreshPromise = null;
      });
    return refreshPromise;
  }

  async function getKnownRootIndex(): Promise<GitDirectoryIndex> {
    if (!index) {
      return refreshIndex();
    }

    if (now() - index.updatedAt > indexTtlMs) {
      void refreshIndex().catch(() => undefined);
    }

    return index;
  }

  return {
    async suggest(request) {
      if (request.mode === "children") {
        return rankSuggestions(
          await listDirectGitDirectoryChildren(request.parentPath),
          request.query,
          request.limit,
        );
      }

      const currentIndex = await getKnownRootIndex();
      return rankSuggestions(
        currentIndex.directories,
        request.query,
        request.limit,
      );
    },
  };
}
