import path from "node:path";
import type {
  HostDaemonOnlineRpcResult,
  WorkspaceContext,
} from "@bb/host-daemon-contract";

const DEFAULT_WORKSPACE_STATUS_CACHE_TTL_MS = 5_000;
const DEFAULT_WORKSPACE_STATUS_CACHE_MAX_ENTRIES = 128;

type WorkspaceStatusResult = HostDaemonOnlineRpcResult<"workspace.status">;

interface WorkspaceStatusCacheEntry {
  environmentId: string;
  expiresAtMs: number | null;
  promise: Promise<WorkspaceStatusResult>;
  workspacePath: string;
}

export interface WorkspaceStatusCacheLoadArgs {
  environmentId: string;
  load: () => Promise<WorkspaceStatusResult>;
  mergeBaseBranch?: string;
  workspaceContext: WorkspaceContext;
}

export interface WorkspaceStatusCacheAccess {
  getOrLoad(args: WorkspaceStatusCacheLoadArgs): Promise<WorkspaceStatusResult>;
  invalidateEnvironment(environmentId: string): void;
  invalidatePath(changedPath: string): void;
}

interface WorkspaceStatusCacheOptions {
  maxEntries?: number;
  nowMs?: () => number;
  ttlMs?: number;
}

function buildWorkspaceStatusCacheKey({
  environmentId,
  mergeBaseBranch,
  workspaceContext,
}: Omit<WorkspaceStatusCacheLoadArgs, "load">): string {
  return JSON.stringify([
    environmentId,
    workspaceContext.workspacePath,
    workspaceContext.workspaceProvisionType,
    mergeBaseBranch ?? null,
  ]);
}

function pathsOverlap(firstPath: string, secondPath: string): boolean {
  const firstRelativeToSecond = path.relative(secondPath, firstPath);
  const secondRelativeToFirst = path.relative(firstPath, secondPath);
  return (
    firstRelativeToSecond === "" ||
    (!firstRelativeToSecond.startsWith("..") &&
      !path.isAbsolute(firstRelativeToSecond)) ||
    (!secondRelativeToFirst.startsWith("..") &&
      !path.isAbsolute(secondRelativeToFirst))
  );
}

export class WorkspaceStatusCache implements WorkspaceStatusCacheAccess {
  private readonly entries = new Map<string, WorkspaceStatusCacheEntry>();
  private readonly maxEntries: number;
  private readonly nowMs: () => number;
  private readonly ttlMs: number;

  constructor(options: WorkspaceStatusCacheOptions = {}) {
    this.maxEntries =
      options.maxEntries ?? DEFAULT_WORKSPACE_STATUS_CACHE_MAX_ENTRIES;
    this.nowMs = options.nowMs ?? Date.now;
    this.ttlMs = options.ttlMs ?? DEFAULT_WORKSPACE_STATUS_CACHE_TTL_MS;
  }

  getOrLoad({
    environmentId,
    load,
    mergeBaseBranch,
    workspaceContext,
  }: WorkspaceStatusCacheLoadArgs): Promise<WorkspaceStatusResult> {
    const key = buildWorkspaceStatusCacheKey({
      environmentId,
      ...(mergeBaseBranch !== undefined ? { mergeBaseBranch } : {}),
      workspaceContext,
    });
    const now = this.nowMs();
    const existing = this.entries.get(key);
    if (
      existing &&
      (existing.expiresAtMs === null || existing.expiresAtMs > now)
    ) {
      return existing.promise;
    }
    if (existing) {
      this.entries.delete(key);
    }

    this.pruneExpiredEntries(now);
    const loadPromise = load();
    const promise = loadPromise.then(
      (result) => {
        // Identity-check the entry so invalidation during an in-flight git
        // probe cannot let that stale result repopulate the cache.
        if (this.entries.get(key) === entry && result.outcome === "available") {
          entry.expiresAtMs = this.nowMs() + this.ttlMs;
        } else if (this.entries.get(key) === entry) {
          this.entries.delete(key);
        }
        return result;
      },
      (error: unknown) => {
        if (this.entries.get(key) === entry) {
          this.entries.delete(key);
        }
        throw error;
      },
    );
    const entry: WorkspaceStatusCacheEntry = {
      environmentId,
      expiresAtMs: null,
      promise,
      workspacePath: workspaceContext.workspacePath,
    };
    this.entries.set(key, entry);
    this.pruneOverflowEntries();
    return promise;
  }

  invalidateEnvironment(environmentId: string): void {
    for (const [key, entry] of this.entries) {
      if (entry.environmentId === environmentId) {
        this.entries.delete(key);
      }
    }
  }

  invalidatePath(changedPath: string): void {
    for (const [key, entry] of this.entries) {
      if (pathsOverlap(changedPath, entry.workspacePath)) {
        this.entries.delete(key);
      }
    }
  }

  private pruneExpiredEntries(now: number): void {
    for (const [key, entry] of this.entries) {
      if (entry.expiresAtMs !== null && entry.expiresAtMs <= now) {
        this.entries.delete(key);
      }
    }
  }

  private pruneOverflowEntries(): void {
    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) {
        return;
      }
      this.entries.delete(oldestKey);
    }
  }
}
