import { describe, expect, it } from "vitest";
import { createConnection } from "../../src/connection.js";
import { migrate } from "../../src/migrate.js";
import { noopNotifier } from "../../src/notifier.js";
import { createEnvironment } from "../../src/data/environments.js";
import { archiveThread, createThread } from "../../src/data/threads.js";
import {
  ensureEnvironmentStatusSnapshotRows,
  getEnvironmentGitStatusSnapshot,
  listDueEnvironmentGitStatusSnapshots,
  markEnvironmentGitStatusSnapshotsDue,
  writeEnvironmentGitStatusSnapshot,
} from "../../src/data/environment-status-snapshots.js";
import { createProject } from "../../src/data/projects.js";
import { upsertHost } from "../../src/data/hosts.js";

const FLOOR_MS = 30_000;
const BACKSTOP_MS = 5 * 60_000;

function setup() {
  const db = createConnection(":memory:");
  migrate(db);
  const host = upsertHost(db, noopNotifier, {
    name: "test-host",
    type: "persistent",
  });
  const { project } = createProject(db, noopNotifier, {
    name: "test-project",
    source: { type: "local_path", hostId: host.id, path: "/tmp/test" },
  });
  const seedTrackedEnvironment = (path: string) => {
    const environment = createEnvironment(db, noopNotifier, {
      hostId: host.id,
      projectId: project.id,
      workspaceProvisionType: "managed-worktree",
      path,
      status: "ready",
    });
    const thread = createThread(db, noopNotifier, {
      environmentId: environment.id,
      projectId: project.id,
      providerId: "codex",
    });
    return { environment, thread };
  };
  const writeGitSnapshot = (args: {
    environmentId: string;
    refreshedAt: number;
    nextRefreshAt: number;
    expectedNextRefreshAt?: number | null;
  }) =>
    writeEnvironmentGitStatusSnapshot(db, {
      environmentId: args.environmentId,
      expectedNextRefreshAt: args.expectedNextRefreshAt ?? null,
      status: "available",
      gitStatusJson: null,
      errorCode: null,
      errorMessage: null,
      refreshedAt: args.refreshedAt,
      nextRefreshAt: args.nextRefreshAt,
      now: args.refreshedAt,
    });
  return { db, project, seedTrackedEnvironment, writeGitSnapshot };
}

describe("markEnvironment*StatusSnapshotsDue", () => {
  it("floors demand marks at refreshedAt + floorMs and never delays a schedule", () => {
    const { db, seedTrackedEnvironment, writeGitSnapshot } = setup();
    const now = 1_000_000;
    const staleEnv = seedTrackedEnvironment("/tmp/stale").environment;
    const freshEnv = seedTrackedEnvironment("/tmp/fresh").environment;
    // Stale row scheduled far out: pulled in, but not past the floor.
    writeGitSnapshot({
      environmentId: staleEnv.id,
      refreshedAt: now - 10_000,
      nextRefreshAt: now + 60 * 60_000,
    });
    // Fresh row already scheduled sooner than the floor target: untouched.
    writeGitSnapshot({
      environmentId: freshEnv.id,
      refreshedAt: now - 1_000,
      nextRefreshAt: now + 4_000,
    });

    markEnvironmentGitStatusSnapshotsDue(db, {
      environmentIds: [staleEnv.id, freshEnv.id],
      now,
      floorMs: FLOOR_MS,
    });

    expect(getEnvironmentGitStatusSnapshot(db, staleEnv.id)?.nextRefreshAt).toBe(
      now - 10_000 + FLOOR_MS,
    );
    expect(getEnvironmentGitStatusSnapshot(db, freshEnv.id)?.nextRefreshAt).toBe(
      now + 4_000,
    );
  });

  it("keeps change marks that arrive while a refresh is in flight", () => {
    const { db, seedTrackedEnvironment, writeGitSnapshot } = setup();
    const dueAt = 1_000_000;
    const { environment } = seedTrackedEnvironment("/tmp/in-flight");
    writeGitSnapshot({
      environmentId: environment.id,
      refreshedAt: dueAt - BACKSTOP_MS,
      nextRefreshAt: dueAt,
    });

    // Sweep picks the due row up (observing nextRefreshAt = dueAt) and starts
    // the RPC. While it is in flight, the host reports a git change.
    const markAt = dueAt + 1_000;
    markEnvironmentGitStatusSnapshotsDue(db, {
      environmentIds: [environment.id],
      now: markAt,
      floorMs: 0,
    });
    expect(
      getEnvironmentGitStatusSnapshot(db, environment.id)?.nextRefreshAt,
    ).toBe(markAt);

    // The RPC completes with pre-change data; the writer must keep the mark's
    // earlier schedule rather than the computed backstop.
    const writeAt = dueAt + 2_000;
    writeEnvironmentGitStatusSnapshot(db, {
      environmentId: environment.id,
      expectedNextRefreshAt: dueAt,
      status: "available",
      gitStatusJson: null,
      errorCode: null,
      errorMessage: null,
      refreshedAt: writeAt,
      nextRefreshAt: writeAt + BACKSTOP_MS,
      now: writeAt,
    });
    expect(
      getEnvironmentGitStatusSnapshot(db, environment.id)?.nextRefreshAt,
    ).toBe(markAt);
  });

  it("leaves due rows alone for demand marks so an imminent refresh satisfies the demand", () => {
    const { db, seedTrackedEnvironment, writeGitSnapshot } = setup();
    const dueAt = 1_000_000;
    const { environment } = seedTrackedEnvironment("/tmp/demand-due");
    writeGitSnapshot({
      environmentId: environment.id,
      refreshedAt: dueAt - BACKSTOP_MS,
      nextRefreshAt: dueAt,
    });

    markEnvironmentGitStatusSnapshotsDue(db, {
      environmentIds: [environment.id],
      now: dueAt + 1_000,
      floorMs: FLOOR_MS,
    });

    expect(
      getEnvironmentGitStatusSnapshot(db, environment.id)?.nextRefreshAt,
    ).toBe(dueAt);
  });
});

describe("listDueEnvironmentGitStatusSnapshots", () => {
  it("skips refreshed rows of untracked environments but lets pending rows resolve once", () => {
    const { db, seedTrackedEnvironment, writeGitSnapshot } = setup();
    const now = 1_000_000;
    const refreshed = seedTrackedEnvironment("/tmp/refreshed-archived");
    const pending = seedTrackedEnvironment("/tmp/pending-archived");
    writeGitSnapshot({
      environmentId: refreshed.environment.id,
      refreshedAt: now - 60_000,
      nextRefreshAt: now - 1_000,
    });
    // The pending environment's row exists (due immediately) but has never
    // been refreshed.
    ensureEnvironmentStatusSnapshotRows(db, {
      environmentIds: [pending.environment.id],
      now: now - 1_000,
    });
    for (const { thread } of [refreshed, pending]) {
      archiveThread(db, noopNotifier, thread.id);
    }

    const due = listDueEnvironmentGitStatusSnapshots(db, { now, limit: 10 });
    expect(due.map((row) => row.environmentId)).toEqual([
      pending.environment.id,
    ]);
  });
});
