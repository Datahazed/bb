import {
  ensureEnvironmentStatusSnapshotRows,
  ensureTrackedEnvironmentStatusSnapshotRows,
  getEnvironment,
  getEnvironmentPullRequestStatusSnapshot,
  getThread,
  listDueEnvironmentGitStatusSnapshots,
  listDueEnvironmentPullRequestStatusSnapshots,
  listEnvironmentThreadNotificationTargets,
  markEnvironmentGitStatusSnapshotsDue,
  markEnvironmentPullRequestStatusSnapshotsDue,
  markEnvironmentStatusSnapshotsDue,
  THREAD_CHANGE_KINDS_AFFECTING_TRACKED_ENVIRONMENTS,
  writeEnvironmentGitStatusSnapshot,
  writeEnvironmentPullRequestStatusSnapshot,
  type EnvironmentGitStatusSnapshotRow,
  type EnvironmentPullRequestStatusSnapshotRow,
} from "@bb/db";
import {
  resolveEnvironmentMergeBaseBranch,
  threadEnvironmentGitStatusSnapshotSchema,
  threadPullRequestSchema,
  type ChangedMessage,
  type Environment,
  type EnvironmentChangeKind,
  type ThreadEnvironmentGitStatusSnapshot,
  type ThreadPullRequest,
  type WorkspaceChangeStats,
  type WorkspaceStatus,
} from "@bb/domain";
import { ApiError } from "../../errors.js";
import type {
  AppDeps,
  LoggedPendingInteractionWorkSessionDeps,
} from "../../types.js";
import { COMMAND_TIMEOUT_MS } from "../../constants.js";
import { callHostRetryableOnlineRpc } from "../hosts/online-rpc.js";
import { assembleThreadPullRequest } from "./pull-request.js";
import { workspaceContextFromPath } from "./workspace-command-target.js";

type SnapshotCoordinatorDeps = Pick<AppDeps, "db" | "hub" | "logger">;
type SnapshotRefreshDeps = LoggedPendingInteractionWorkSessionDeps;
type ReadyGitEnvironment = Environment & {
  isGitRepo: true;
  path: string;
  status: "ready";
};

const SNAPSHOT_REFRESH_BATCH_LIMIT = 10;
const SNAPSHOT_STATUS_FILE_LIMIT = 5;
const GIT_STATUS_BACKSTOP_REFRESH_MS = 5 * 60_000;
const NOT_APPLICABLE_REFRESH_MS = 60 * 60_000;
const UNAVAILABLE_RETRY_MS = 30_000;
const ACTIVE_PULL_REQUEST_STALE_MS = 30_000;
const SETTLED_PULL_REQUEST_STALE_MS = 60 * 60_000;
const ABSENT_PULL_REQUEST_REFRESH_MS = 5 * 60_000;
// Schedules the row due 5s out; the effective cadence is bounded below by the
// periodic sweep interval (10s), so pending-check PRs poll roughly per tick.
const ACTIVE_PULL_REQUEST_REFETCH_MS = 5_000;
/**
 * Demand-driven marks (a client read the thread list, a thread was attached)
 * never schedule a refresh sooner than refreshedAt + this floor. Change-driven
 * marks (the host reported the workspace changed) use floor 0. Without the
 * floor, refresh -> notify -> list refetch -> mark-due closes a loop that
 * re-polls git and GitHub every sweep tick.
 */
export const SNAPSHOT_DEMAND_REFRESH_FLOOR_MS = 30_000;

const ENVIRONMENT_CHANGES_DIRTYING_BOTH = new Set<EnvironmentChangeKind>([
  "environment-created",
  "metadata-changed",
  "status-changed",
]);

function hasAnyChange<TChange extends string>(
  changes: readonly TChange[],
  candidates: ReadonlySet<TChange>,
): boolean {
  return changes.some((change) => candidates.has(change));
}

function serializeJson(value: unknown): string {
  return JSON.stringify(value);
}

function normalizeError(error: unknown): { code: string; message: string } {
  if (error instanceof ApiError) {
    return {
      code: error.body.code,
      message: error.body.message,
    };
  }
  if (error instanceof Error) {
    return {
      code: "snapshot_refresh_failed",
      message: error.message,
    };
  }
  return {
    code: "snapshot_refresh_failed",
    message: String(error),
  };
}

function environmentCanHaveWorkspaceStatus(
  environment: Environment | null,
): environment is ReadyGitEnvironment {
  return (
    environment !== null &&
    environment.status === "ready" &&
    environment.path !== null &&
    environment.isGitRepo
  );
}

function mapChangeStats(stats: WorkspaceChangeStats) {
  return {
    fileCount: stats.files.length,
    insertions: stats.insertions,
    deletions: stats.deletions,
    files: stats.files.slice(0, SNAPSHOT_STATUS_FILE_LIMIT).map((file) => ({
      path: file.path,
      status: file.status,
    })),
  };
}

function mapWorkspaceStatusToGitSnapshot(
  workspaceStatus: WorkspaceStatus,
): ThreadEnvironmentGitStatusSnapshot {
  const workingTree = {
    ...mapChangeStats(workspaceStatus.workingTree),
    hasUncommittedChanges: workspaceStatus.workingTree.hasUncommittedChanges,
    state: workspaceStatus.workingTree.state,
  };
  const mergeBase = workspaceStatus.mergeBase
    ? {
        ...mapChangeStats(workspaceStatus.mergeBase),
        aheadCount: workspaceStatus.mergeBase.aheadCount,
        behindCount: workspaceStatus.mergeBase.behindCount,
        commitCount: workspaceStatus.mergeBase.commits.length,
        hasCommittedUnmergedChanges:
          workspaceStatus.mergeBase.hasCommittedUnmergedChanges,
        mergeBaseBranch: workspaceStatus.mergeBase.mergeBaseBranch,
      }
    : null;

  return threadEnvironmentGitStatusSnapshotSchema.parse({
    checkout: workspaceStatus.checkout,
    currentBranch: workspaceStatus.branch.currentBranch,
    defaultBranch: workspaceStatus.branch.defaultBranch,
    hasChanges:
      workingTree.hasUncommittedChanges ||
      (mergeBase?.hasCommittedUnmergedChanges ?? false),
    workingTree,
    mergeBase,
  });
}

function nextPullRequestRefreshAt(
  pullRequest: ThreadPullRequest | null,
  now: number,
): number {
  if (pullRequest === null) {
    // No PR exists. Demand marks (floored at SNAPSHOT_DEMAND_REFRESH_FLOOR_MS)
    // and git-refs-changed marks pick up an externally created PR sooner; the
    // background cadence only bounds the fully idle case.
    return now + ABSENT_PULL_REQUEST_REFRESH_MS;
  }
  if (pullRequest.state === "merged" || pullRequest.state === "closed") {
    return now + SETTLED_PULL_REQUEST_STALE_MS;
  }
  if (
    pullRequest.state === "open" &&
    (pullRequest.checks.state === "pending" ||
      pullRequest.mergeability.state === "unknown")
  ) {
    return now + ACTIVE_PULL_REQUEST_REFETCH_MS;
  }
  return now + ACTIVE_PULL_REQUEST_STALE_MS;
}

function parseStoredPullRequestSnapshot(
  row: EnvironmentPullRequestStatusSnapshotRow,
): ThreadPullRequest | null {
  if (row.pullRequestJson === null) {
    return null;
  }
  try {
    const parsed = threadPullRequestSchema.safeParse(
      JSON.parse(row.pullRequestJson),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function notifyEnvironmentStatusSummaryChanged(
  deps: SnapshotRefreshDeps,
  environmentId: string,
): void {
  for (const target of listEnvironmentThreadNotificationTargets(
    deps.db,
    environmentId,
  )) {
    deps.hub.notifyThread(
      target.threadId,
      ["environment-status-summary-changed"],
      {
        projectId: target.projectId,
      },
    );
  }
}

async function refreshGitStatusSnapshot(
  deps: SnapshotRefreshDeps,
  row: EnvironmentGitStatusSnapshotRow,
  now: number,
): Promise<void> {
  const environment = getEnvironment(deps.db, row.environmentId);
  if (!environmentCanHaveWorkspaceStatus(environment)) {
    const changed = writeEnvironmentGitStatusSnapshot(deps.db, {
      environmentId: row.environmentId,
      expectedNextRefreshAt: row.nextRefreshAt,
      status: "not_applicable",
      gitStatusJson: null,
      errorCode: null,
      errorMessage: null,
      refreshedAt: now,
      nextRefreshAt: now + NOT_APPLICABLE_REFRESH_MS,
      now,
    });
    if (changed) {
      notifyEnvironmentStatusSummaryChanged(deps, row.environmentId);
    }
    return;
  }

  try {
    const result = await callHostRetryableOnlineRpc(deps, {
      hostId: environment.hostId,
      timeoutMs: COMMAND_TIMEOUT_MS,
      command: {
        type: "workspace.status",
        environmentId: environment.id,
        workspaceContext: workspaceContextFromPath({
          path: environment.path,
          workspaceProvisionType: environment.workspaceProvisionType,
        }),
        ...(resolveEnvironmentMergeBaseBranch(environment)
          ? { mergeBaseBranch: resolveEnvironmentMergeBaseBranch(environment) }
          : {}),
      },
    });

    if (result.outcome === "unavailable") {
      const changed = writeEnvironmentGitStatusSnapshot(deps.db, {
        environmentId: row.environmentId,
        expectedNextRefreshAt: row.nextRefreshAt,
        status: "unavailable",
        gitStatusJson: null,
        errorCode: result.failure.code,
        errorMessage: result.failure.message,
        refreshedAt: now,
        nextRefreshAt: now + UNAVAILABLE_RETRY_MS,
        now,
      });
      if (changed) {
        notifyEnvironmentStatusSummaryChanged(deps, row.environmentId);
      }
      return;
    }

    const snapshot = mapWorkspaceStatusToGitSnapshot(result.workspaceStatus);
    const changed = writeEnvironmentGitStatusSnapshot(deps.db, {
      environmentId: row.environmentId,
      expectedNextRefreshAt: row.nextRefreshAt,
      status: "available",
      gitStatusJson: serializeJson(snapshot),
      errorCode: null,
      errorMessage: null,
      refreshedAt: now,
      nextRefreshAt: now + GIT_STATUS_BACKSTOP_REFRESH_MS,
      now,
    });
    if (changed) {
      notifyEnvironmentStatusSummaryChanged(deps, row.environmentId);
    }
  } catch (error) {
    const normalized = normalizeError(error);
    const changed = writeEnvironmentGitStatusSnapshot(deps.db, {
      environmentId: row.environmentId,
      expectedNextRefreshAt: row.nextRefreshAt,
      status: "unavailable",
      gitStatusJson: null,
      errorCode: normalized.code,
      errorMessage: normalized.message,
      refreshedAt: now,
      nextRefreshAt: now + UNAVAILABLE_RETRY_MS,
      now,
    });
    if (changed) {
      notifyEnvironmentStatusSummaryChanged(deps, row.environmentId);
    }
  }
}

async function refreshPullRequestStatusSnapshot(
  deps: SnapshotRefreshDeps,
  row: EnvironmentPullRequestStatusSnapshotRow,
  now: number,
): Promise<void> {
  const environment = getEnvironment(deps.db, row.environmentId);
  if (!environmentCanHaveWorkspaceStatus(environment)) {
    const changed = writeEnvironmentPullRequestStatusSnapshot(deps.db, {
      environmentId: row.environmentId,
      expectedNextRefreshAt: row.nextRefreshAt,
      status: "not_applicable",
      pullRequestJson: null,
      errorCode: null,
      errorMessage: null,
      refreshedAt: now,
      nextRefreshAt: now + NOT_APPLICABLE_REFRESH_MS,
      now,
    });
    if (changed) {
      notifyEnvironmentStatusSummaryChanged(deps, row.environmentId);
    }
    return;
  }

  try {
    const result = await callHostRetryableOnlineRpc(deps, {
      hostId: environment.hostId,
      timeoutMs: COMMAND_TIMEOUT_MS,
      command: {
        type: "workspace.pull_request",
        environmentId: environment.id,
        workspaceContext: workspaceContextFromPath({
          path: environment.path,
          workspaceProvisionType: environment.workspaceProvisionType,
        }),
      },
    });
    if (result.outcome === "unavailable") {
      throw new Error(result.message);
    }
    const pullRequest =
      result.outcome === "available"
        ? assembleThreadPullRequest(result.pullRequest)
        : null;
    const changed = writeEnvironmentPullRequestStatusSnapshot(deps.db, {
      environmentId: row.environmentId,
      expectedNextRefreshAt: row.nextRefreshAt,
      status: "available",
      pullRequestJson: pullRequest ? serializeJson(pullRequest) : null,
      errorCode: null,
      errorMessage: null,
      refreshedAt: now,
      nextRefreshAt: nextPullRequestRefreshAt(pullRequest, now),
      now,
    });
    if (changed) {
      notifyEnvironmentStatusSummaryChanged(deps, row.environmentId);
    }
  } catch (error) {
    const normalized = normalizeError(error);
    const previousPullRequest = parseStoredPullRequestSnapshot(row);
    const changed = writeEnvironmentPullRequestStatusSnapshot(deps.db, {
      environmentId: row.environmentId,
      expectedNextRefreshAt: row.nextRefreshAt,
      status: "unavailable",
      pullRequestJson: null,
      errorCode: normalized.code,
      errorMessage: normalized.message,
      refreshedAt: now,
      nextRefreshAt: Math.min(
        now + UNAVAILABLE_RETRY_MS,
        nextPullRequestRefreshAt(previousPullRequest, now),
      ),
      now,
    });
    if (changed) {
      notifyEnvironmentStatusSummaryChanged(deps, row.environmentId);
    }
  }
}

function dirtyEnvironmentSnapshotsForChange(
  deps: SnapshotCoordinatorDeps,
  message: Extract<ChangedMessage, { entity: "environment" }>,
): void {
  if (!message.id) {
    return;
  }

  const now = Date.now();
  ensureEnvironmentStatusSnapshotRows(deps.db, {
    environmentIds: [message.id],
    now,
  });

  // Change-driven marks refresh immediately (floor 0): the host or lifecycle
  // told us something actually changed. Local file edits (work-status-changed)
  // cannot change the remote PR, so only git-refs changes and lifecycle
  // changes mark the pull-request snapshot due.
  const lifecycleChanged = hasAnyChange(
    message.changes,
    ENVIRONMENT_CHANGES_DIRTYING_BOTH,
  );
  const gitRefsChanged = message.changes.includes("git-refs-changed");
  if (
    lifecycleChanged ||
    gitRefsChanged ||
    message.changes.includes("work-status-changed")
  ) {
    markEnvironmentGitStatusSnapshotsDue(deps.db, {
      environmentIds: [message.id],
      now,
      floorMs: 0,
    });
  }
  if (lifecycleChanged || gitRefsChanged) {
    markEnvironmentPullRequestStatusSnapshotsDue(deps.db, {
      environmentIds: [message.id],
      now,
      floorMs: 0,
    });
  }
}

function dirtyEnvironmentSnapshotsForThreadChange(
  deps: SnapshotCoordinatorDeps,
  message: Extract<ChangedMessage, { entity: "thread" }>,
): void {
  if (
    !hasAnyChange(
      message.changes,
      THREAD_CHANGE_KINDS_AFFECTING_TRACKED_ENVIRONMENTS,
    )
  ) {
    return;
  }

  const now = Date.now();
  ensureTrackedEnvironmentStatusSnapshotRows(deps.db, { now });
  if (!message.id) {
    return;
  }

  const thread = getThread(deps.db, message.id);
  if (thread?.environmentId) {
    ensureEnvironmentStatusSnapshotRows(deps.db, {
      environmentIds: [thread.environmentId],
      now,
    });
    // Attaching a thread is demand, not a workspace change: fresh snapshots
    // stay as scheduled, stale or never-refreshed ones become due.
    markEnvironmentStatusSnapshotsDue(deps.db, {
      environmentIds: [thread.environmentId],
      now,
      floorMs: SNAPSHOT_DEMAND_REFRESH_FLOOR_MS,
    });
  }
}

export class EnvironmentStatusSnapshotCoordinator {
  private readonly unsubscribe: () => void;

  constructor(private readonly deps: SnapshotCoordinatorDeps) {
    this.unsubscribe = this.deps.hub.onChangedMessage((message) => {
      this.handleChangedMessage(message);
    });
  }

  dispose(): void {
    this.unsubscribe();
  }

  private handleChangedMessage(message: ChangedMessage): void {
    try {
      switch (message.entity) {
        case "environment":
          dirtyEnvironmentSnapshotsForChange(this.deps, message);
          return;
        case "thread":
          dirtyEnvironmentSnapshotsForThreadChange(this.deps, message);
          return;
        case "project":
        case "host":
        case "system":
          return;
      }
    } catch (error) {
      this.deps.logger.warn(
        { err: error },
        "Failed to mark environment status snapshot dirty",
      );
    }
  }
}

export async function refreshDueEnvironmentStatusSnapshots(
  deps: SnapshotRefreshDeps,
  now: number,
): Promise<void> {
  ensureTrackedEnvironmentStatusSnapshotRows(deps.db, { now });

  const gitRows = listDueEnvironmentGitStatusSnapshots(deps.db, {
    now,
    limit: SNAPSHOT_REFRESH_BATCH_LIMIT,
  });
  const pullRequestRows = listDueEnvironmentPullRequestStatusSnapshots(
    deps.db,
    {
      now,
      limit: SNAPSHOT_REFRESH_BATCH_LIMIT,
    },
  );

  // Hosts refresh concurrently and each host's refreshes run serially. Within
  // one pass a slow host delays only its own environments; the pass itself
  // still resolves when the slowest host finishes (the sweep job's running
  // guard skips ticks until then), which bounds a hung host's damage to one
  // batch of RPC timeouts rather than eliminating it.
  const refreshesByHost = new Map<string | null, (() => Promise<void>)[]>();
  const enqueue = (environmentId: string, refresh: () => Promise<void>) => {
    const hostId = getEnvironment(deps.db, environmentId)?.hostId ?? null;
    const queue = refreshesByHost.get(hostId) ?? [];
    queue.push(refresh);
    refreshesByHost.set(hostId, queue);
  };
  for (const row of gitRows) {
    enqueue(row.environmentId, () =>
      refreshGitStatusSnapshot(deps, row, Date.now()),
    );
  }
  for (const row of pullRequestRows) {
    enqueue(row.environmentId, () =>
      refreshPullRequestStatusSnapshot(deps, row, Date.now()),
    );
  }

  await Promise.all(
    [...refreshesByHost.values()].map(async (queue) => {
      for (const refresh of queue) {
        await refresh();
      }
    }),
  );
}

export async function refreshEnvironmentPullRequestStatusSnapshotForEnvironment(
  deps: SnapshotRefreshDeps,
  args: { environmentId: string; now: number },
): Promise<void> {
  ensureEnvironmentStatusSnapshotRows(deps.db, {
    environmentIds: [args.environmentId],
    now: args.now,
  });
  const row = getEnvironmentPullRequestStatusSnapshot(
    deps.db,
    args.environmentId,
  );
  if (row === null) {
    return;
  }
  await refreshPullRequestStatusSnapshot(deps, row, args.now);
}
