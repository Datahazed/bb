import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createConnection,
  createEnvironment,
  createProject,
  createThread,
  migrate,
  noopNotifier,
  type DbConnection,
  type ThreadWithPendingInteractionState,
} from "@bb/db";
import type { Thread, ThreadRuntimeState } from "@bb/domain";
import {
  resolveThreadRuntimeState,
  toThreadListEntryResponses,
} from "../../../src/services/threads/thread-runtime-display.js";

interface SetupResult {
  db: DbConnection;
  hostId: string;
}

interface CreateThreadWithEnvironmentArgs {
  db: DbConnection;
  hostId: string;
  status?: Thread["status"];
}

interface ThreadWithSortKey extends Thread {
  pinSortKey: string | null;
  sortKey: string | null;
}

interface CreateThreadListEntryArgs {
  environmentHostId: string | null;
  thread: ThreadWithSortKey;
}

function setup(): SetupResult {
  const db = createConnection(":memory:");
  migrate(db);
  return { db, hostId: "local" };
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
    environmentWorkspaceDisplayKind: "other",
    hasPendingInteraction: false,
  };
}

describe("thread runtime display", () => {
  it("keeps active threads active while the latest host session is active", () => {
    const { db, hostId } = setup();
    const now = 1_000;

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
});
