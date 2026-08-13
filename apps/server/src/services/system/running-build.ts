import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";
import type { SystemBuild } from "@bb/server-contract";
import { sanitizeInheritedChildProcessEnv } from "@bb/process-utils";

const execFileAsync = promisify(execFile);
const DEFAULT_REFRESH_INTERVAL_MS = 5_000;
const GIT_TIMEOUT_MS = 5_000;

export interface RunningBuildCache {
  getBuild(): SystemBuild | null;
  stop(): void;
}

interface CreateRunningBuildCacheArgs {
  checkoutRoot: string | null;
  refreshIntervalMs?: number;
  resolveBuild?: (checkoutRoot: string) => Promise<SystemBuild | null>;
}

/**
 * Source builds use apps/server. Production builds from a checkout use the
 * copied server under packages/bb-app. Installed packages match neither path.
 */
export function resolveRunningCheckoutRoot(moduleDir: string): string | null {
  const candidates = [
    resolve(moduleDir, "../../.."),
    resolve(moduleDir, "../../../.."),
  ];
  for (const candidate of candidates) {
    const knownModuleDirs = [
      resolve(candidate, "apps/server/src"),
      resolve(candidate, "apps/server/dist"),
      resolve(candidate, "packages/bb-app/server/dist"),
    ];
    if (
      knownModuleDirs.includes(resolve(moduleDir)) &&
      existsSync(resolve(candidate, ".git")) &&
      existsSync(resolve(candidate, "pnpm-workspace.yaml")) &&
      existsSync(resolve(candidate, "apps/server/package.json"))
    ) {
      return candidate;
    }
  }
  return null;
}

export function parseGitBuildStatus(output: string): SystemBuild | null {
  let branch: string | null = null;
  let commit: string | null = null;
  let dirty = false;

  for (const line of output.split("\n")) {
    if (line.startsWith("# branch.oid ")) {
      commit = line.slice("# branch.oid ".length);
    } else if (line.startsWith("# branch.head ")) {
      const head = line.slice("# branch.head ".length);
      branch = head === "(detached)" ? "HEAD" : head;
    } else if (line.length > 0 && !line.startsWith("# ")) {
      dirty = true;
    }
  }

  if (
    branch === null ||
    branch.length === 0 ||
    commit === null ||
    !/^[0-9a-f]{40}$/u.test(commit)
  ) {
    return null;
  }

  return {
    branch,
    commit,
    shortCommit: commit.slice(0, 7),
    dirty,
  };
}

async function resolveGitBuild(
  checkoutRoot: string,
): Promise<SystemBuild | null> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      [
        "-C",
        checkoutRoot,
        "status",
        "--porcelain=v2",
        "--branch",
        "--untracked-files=no",
        "--ignore-submodules=untracked",
      ],
      {
        encoding: "utf8",
        env: {
          ...sanitizeInheritedChildProcessEnv({ env: process.env }),
          GIT_OPTIONAL_LOCKS: "0",
        },
        timeout: GIT_TIMEOUT_MS,
      },
    );
    return parseGitBuildStatus(stdout);
  } catch {
    return null;
  }
}

export async function createRunningBuildCache(
  args: CreateRunningBuildCacheArgs,
): Promise<RunningBuildCache> {
  if (args.checkoutRoot === null) {
    return {
      getBuild: () => null,
      stop() {},
    };
  }

  const checkoutRoot = args.checkoutRoot;
  const resolveBuild = args.resolveBuild ?? resolveGitBuild;
  let build: SystemBuild | null = null;
  let stopped = false;
  let refreshPromise: Promise<void> | null = null;

  function refresh(): Promise<void> {
    if (refreshPromise !== null) return refreshPromise;
    const currentRefresh = resolveBuild(checkoutRoot).then(
      (nextBuild) => {
        if (!stopped) build = nextBuild;
      },
      () => {
        if (!stopped) build = null;
      },
    );
    const trackedRefresh = currentRefresh.finally(() => {
      if (refreshPromise === trackedRefresh) refreshPromise = null;
    });
    refreshPromise = trackedRefresh;
    return trackedRefresh;
  }

  // Requests only read this cache. The background refresh reflects a branch
  // switch or commit without putting a git child process on the request path.
  await refresh();
  const interval = setInterval(
    () => void refresh(),
    args.refreshIntervalMs ?? DEFAULT_REFRESH_INTERVAL_MS,
  );
  interval.unref();

  return {
    getBuild: () => build,
    stop() {
      stopped = true;
      clearInterval(interval);
    },
  };
}
