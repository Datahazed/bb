import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  closeSession,
  createConnection,
  createEnvironment,
  createProject,
  createThread,
  environmentGitStatusSnapshots,
  environmentPullRequestStatusSnapshots,
  hostDaemonSessions,
  migrate,
  noopNotifier,
  openSession,
  upsertHost,
  writeEnvironmentGitStatusSnapshot,
  writeEnvironmentPullRequestStatusSnapshot,
  type DbConnection,
  type ThreadWithPendingInteractionState,
} from "@bb/db";
import type {
  Thread,
  ThreadEnvironmentGitStatusSnapshot,
  ThreadPullRequest,
  ThreadRuntimeState,
} from "@bb/domain";
import { DAEMON_DISCONNECT_GRACE_MS } from "../../../src/constants.js";
import {
  resolveThreadRuntimeState,
  toThreadListEntryResponses,
} from "../../../src/services/threads/thread-runtime-display.js";

interface SetupResult {
  db: DbConnection;
  hostId: string;
}

interface OpenTestSessionArgs {
  db: DbConnection;
  hostId: string;
  leaseExpiresAt?: number;
}

interface CloseTestSessionArgs {
  closedAt: number;
  db: DbConnection;
  sessionId: string;
}

interface CreateThreadWithEnvironmentArgs {
  db: DbConnection;
  hostId: string;
  status?: Thread["status"];
}

interface ThreadWithPinSortKey extends Thread {
  pinSortKey: string | null;
}

interface CreateThreadListEntryArgs {
  environmentHostId: string | null;
  overrides?: Partial<ThreadWithPendingInteractionState>;
  thread: ThreadWithPinSortKey;
}

function setup(): SetupResult {
  const db = createConnection(":memory:");
  migrate(db);
  const host = upsertHost(db, noopNotifier, {
    id: "host-runtime-display",
    name: "Runtime Display Host",
    type: "persistent",
  });
  return { db, hostId: host.id };
}

function openTestSession(args: OpenTestSessionArgs) {
  const session = openSession(args.db, noopNotifier, {
    hostId: args.hostId,
    instanceId: `instance-${randomUUID()}`,
    hostName: "Runtime Display Host",
    hostType: "persistent",
    dataDir: `/tmp/${args.hostId}`,
    protocolVersion: 1,
    heartbeatIntervalMs: 5_000,
    leaseTimeoutMs: 30_000,
  });

  if (args.leaseExpiresAt !== undefined) {
    args.db
      .update(hostDaemonSessions)
      .set({ leaseExpiresAt: args.leaseExpiresAt })
      .where(eq(hostDaemonSessions.id, session.id))
      .run();
  }

  return session;
}

function closeTestSession(args: CloseTestSessionArgs): void {
  closeSession(args.db, noopNotifier, args.sessionId, "daemon-disconnect");
  args.db
    .update(hostDaemonSessions)
    .set({
      closedAt: args.closedAt,
      updatedAt: args.closedAt,
    })
    .where(eq(hostDaemonSessions.id, args.sessionId))
    .run();
}

function createThreadWithEnvironment(args: CreateThreadWithEnvironmentArgs) {
  const suffix = randomUUID();
  const { project } = createProject(args.db, noopNotifier, {
    name: `Runtime Display Project ${suffix}`,
    source: {
      type: "local_path",
      hostId: args.hostId,
      path: `/tmp/${args.hostId}/project/${suffix}`,
    },
  });
  const environment = createEnvironment(args.db, noopNotifier, {
    hostId: args.hostId,
    projectId: project.id,
    workspaceProvisionType: "unmanaged",
    path: `/tmp/${args.hostId}/environment/${suffix}`,
    status: "ready",
  });
  const thread = createThread(args.db, noopNotifier, {
    projectId: project.id,
    environmentId: environment.id,
    providerId: "codex",
    status: args.status ?? "active",
  });

  return { environment, project, thread };
}

function createThreadListEntry(
  args: CreateThreadListEntryArgs,
): ThreadWithPendingInteractionState {
  return {
    ...args.thread,
    modelOverride: null,
    reasoningLevelOverride: null,
    environmentBranchName: null,
    environmentHostId: args.environmentHostId,
    environmentName: null,
    environmentWorkspaceDisplayKind: "other",
    gitStatusSnapshotJson: null,
    gitStatusSnapshotErrorCode: null,
    gitStatusSnapshotErrorMessage: null,
    gitStatusSnapshotRefreshedAt: null,
    gitStatusSnapshotStatus: null,
    hasPendingInteraction: false,
    pullRequestStatusSnapshotJson: null,
    pullRequestStatusSnapshotErrorCode: null,
    pullRequestStatusSnapshotErrorMessage: null,
    pullRequestStatusSnapshotRefreshedAt: null,
    pullRequestStatusSnapshotStatus: null,
    ...args.overrides,
  };
}

function makeGitStatusSnapshot(): ThreadEnvironmentGitStatusSnapshot {
  return {
    checkout: {
      kind: "branch",
      branchName: "feature/status-signals",
      headSha: "abc123",
    },
    currentBranch: "feature/status-signals",
    defaultBranch: "main",
    hasChanges: true,
    workingTree: {
      fileCount: 1,
      insertions: 12,
      deletions: 3,
      files: [
        {
          path: "apps/app/src/components/sidebar/ThreadRow.tsx",
          status: "M",
        },
      ],
      hasUncommittedChanges: true,
      state: "dirty_uncommitted",
    },
    mergeBase: null,
  };
}

function makePullRequest(): ThreadPullRequest {
  return {
    number: 42,
    title: "Show thread status signals",
    state: "open",
    url: "https://github.com/acme/bb/pull/42",
    baseRefName: "main",
    headRefName: "feature/status-signals",
    updatedAt: "2026-01-01T00:00:00.000Z",
    checks: {
      state: "passing",
      totalCount: 1,
      passedCount: 1,
      failedCount: 0,
      pendingCount: 0,
    },
    review: { state: "approved", reviewRequestCount: 0 },
    mergeability: {
      state: "mergeable",
      mergeStateStatus: "CLEAN",
      mergeable: "MERGEABLE",
    },
    attention: "ready_to_merge",
  };
}

describe("thread runtime display", () => {
  it("keeps active threads active while the latest host session is active", () => {
    const { db, hostId } = setup();
    const now = 1_000;
    openTestSession({
      db,
      hostId,
      leaseExpiresAt: now + 30_000,
    });

    expect(
      resolveThreadRuntimeState(
        { db },
        { environmentHostId: hostId, now, status: "active" },
      ),
    ).toEqual({
      displayStatus: "active",
      hostReconnectGraceExpiresAt: null,
    } satisfies ThreadRuntimeState);
  });

  it("shows host-reconnecting while a daemon disconnect is inside the grace period", () => {
    const { db, hostId } = setup();
    const now = 10_000;
    const session = openTestSession({ db, hostId });
    closeTestSession({
      closedAt: now - 1_000,
      db,
      sessionId: session.id,
    });

    expect(
      resolveThreadRuntimeState(
        { db },
        { environmentHostId: hostId, now, status: "active" },
      ),
    ).toEqual({
      displayStatus: "host-reconnecting",
      hostReconnectGraceExpiresAt: now - 1_000 + DAEMON_DISCONNECT_GRACE_MS,
    } satisfies ThreadRuntimeState);
  });

  it("shows waiting-for-host after the daemon disconnect grace period expires", () => {
    const { db, hostId } = setup();
    const now = 10_000;
    const session = openTestSession({ db, hostId });
    closeTestSession({
      closedAt: now - DAEMON_DISCONNECT_GRACE_MS - 1,
      db,
      sessionId: session.id,
    });

    expect(
      resolveThreadRuntimeState(
        { db },
        { environmentHostId: hostId, now, status: "active" },
      ),
    ).toEqual({
      displayStatus: "waiting-for-host",
      hostReconnectGraceExpiresAt: null,
    } satisfies ThreadRuntimeState);
  });

  it("uses the thread status directly for non-active statuses", () => {
    const { db, hostId } = setup();

    expect(
      resolveThreadRuntimeState(
        { db },
        { environmentHostId: hostId, now: 1_000, status: "idle" },
      ),
    ).toEqual({
      displayStatus: "idle",
      hostReconnectGraceExpiresAt: null,
    } satisfies ThreadRuntimeState);
  });

  it("does not require a host id for active threads without an environment host", () => {
    const { db } = setup();

    expect(
      resolveThreadRuntimeState(
        { db },
        { environmentHostId: null, now: 1_000, status: "active" },
      ),
    ).toEqual({
      displayStatus: "active",
      hostReconnectGraceExpiresAt: null,
    } satisfies ThreadRuntimeState);
  });

  it("resolves list entry runtime from the latest session per host", () => {
    const { db, hostId } = setup();
    const now = 1_000;
    openTestSession({
      db,
      hostId,
      leaseExpiresAt: now + 30_000,
    });
    const first = createThreadWithEnvironment({ db, hostId });
    const second = createThreadWithEnvironment({ db, hostId });
    const noHost = createThreadWithEnvironment({
      db,
      hostId,
      status: "active",
    });

    const entries = toThreadListEntryResponses(
      { db },
      {
        now,
        threads: [
          createThreadListEntry({
            environmentHostId: hostId,
            thread: first.thread,
          }),
          createThreadListEntry({
            environmentHostId: hostId,
            thread: second.thread,
          }),
          createThreadListEntry({
            environmentHostId: null,
            thread: noHost.thread,
          }),
        ],
      },
    );

    expect(entries.map((entry) => entry.runtime)).toEqual([
      {
        displayStatus: "active",
        hostReconnectGraceExpiresAt: null,
      },
      {
        displayStatus: "active",
        hostReconnectGraceExpiresAt: null,
      },
      {
        displayStatus: "active",
        hostReconnectGraceExpiresAt: null,
      },
    ] satisfies ThreadRuntimeState[]);
  });

  it("projects environment status snapshots into thread list entries", () => {
    const { db, hostId } = setup();
    const now = 1_000;
    const { thread } = createThreadWithEnvironment({ db, hostId });
    const gitStatusSnapshot = makeGitStatusSnapshot();
    const pullRequest = makePullRequest();

    const [entry] = toThreadListEntryResponses(
      { db },
      {
        now,
        threads: [
          createThreadListEntry({
            environmentHostId: hostId,
            overrides: {
              gitStatusSnapshotJson: JSON.stringify(gitStatusSnapshot),
              gitStatusSnapshotRefreshedAt: now - 100,
              gitStatusSnapshotStatus: "available",
              pullRequestStatusSnapshotJson: JSON.stringify(pullRequest),
              pullRequestStatusSnapshotRefreshedAt: now - 50,
              pullRequestStatusSnapshotStatus: "available",
            },
            thread,
          }),
        ],
      },
    );

    expect(entry?.environmentStatusSummary).toEqual({
      git: {
        state: "available",
        refreshedAt: now - 100,
        snapshot: gitStatusSnapshot,
      },
      pullRequest: {
        state: "available",
        refreshedAt: now - 50,
        pullRequest,
      },
    });
  });

  it("marks demanded environment status snapshots due from thread list reads", () => {
    const { db, hostId } = setup();
    const now = 1_000;
    const future = now + 60_000;
    const { environment, thread } = createThreadWithEnvironment({ db, hostId });
    writeEnvironmentGitStatusSnapshot(db, {
      environmentId: environment.id,
      status: "not_applicable",
      gitStatusJson: null,
      errorCode: null,
      errorMessage: null,
      refreshedAt: now - 100,
      nextRefreshAt: future,
      now: now - 100,
    });
    writeEnvironmentPullRequestStatusSnapshot(db, {
      environmentId: environment.id,
      status: "not_applicable",
      pullRequestJson: null,
      errorCode: null,
      errorMessage: null,
      refreshedAt: now - 100,
      nextRefreshAt: future,
      now: now - 100,
    });

    toThreadListEntryResponses(
      { db },
      {
        now,
        threads: [
          createThreadListEntry({
            environmentHostId: hostId,
            thread,
          }),
        ],
      },
    );

    expect(
      db
        .select({ nextRefreshAt: environmentGitStatusSnapshots.nextRefreshAt })
        .from(environmentGitStatusSnapshots)
        .where(eq(environmentGitStatusSnapshots.environmentId, environment.id))
        .get(),
    ).toEqual({ nextRefreshAt: now });
    expect(
      db
        .select({
          nextRefreshAt: environmentPullRequestStatusSnapshots.nextRefreshAt,
        })
        .from(environmentPullRequestStatusSnapshots)
        .where(
          eq(
            environmentPullRequestStatusSnapshots.environmentId,
            environment.id,
          ),
        )
        .get(),
    ).toEqual({ nextRefreshAt: now });
  });
});
