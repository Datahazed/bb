import type { ThreadListEntry } from "@bb/domain";
import { describe, expect, it } from "vitest";
import {
  buildProjectThreadGroups,
  type ProjectThreadItem,
} from "./projectThreadGroups";

type ThreadListEntryOverrides = Partial<ThreadListEntry>;
type ThreadGroupSummary = string | { env: string; threads: string[] };

function createThread(
  overrides: ThreadListEntryOverrides = {},
): ThreadListEntry {
  return {
    id: "thr_1",
    projectId: "proj_1",
    environmentId: null,
    automationId: null,
    providerId: "codex",
    title: "Thread",
    titleFallback: "Thread",
    status: "idle",
    archivedAt: null,
    pinnedAt: null,
    pinSortKey: null,
    stopRequestedAt: null,
    deletedAt: null,
    lastReadAt: 0,
    latestAttentionAt: 2,
    createdAt: 1,
    updatedAt: 2,
    hasPendingInteraction: false,
    environmentHostId: null,
    environmentName: null,
    environmentBranchName: null,
    environmentWorkspaceDisplayKind: "other",
    runtime: {
      displayStatus: "idle",
      hostReconnectGraceExpiresAt: null,
    },
    ...overrides,
  };
}

function summarizeItems(
  items: readonly ProjectThreadItem[],
): ThreadGroupSummary[] {
  return items.map((item) =>
    item.kind === "thread"
      ? item.node.thread.id
      : {
          env: item.group.environmentId,
          threads: item.group.nodes.map((node) => node.thread.id),
        },
  );
}

describe("buildProjectThreadGroups", () => {
  it("renders all threads as top-level nodes", () => {
    const topLevelItems = buildProjectThreadGroups([
      createThread({
        id: "active-newer-created",
        status: "active",
        createdAt: 20,
        latestAttentionAt: 1_500,
        runtime: {
          displayStatus: "active",
          hostReconnectGraceExpiresAt: null,
        },
      }),
      createThread({
        id: "active-older-created",
        status: "active",
        createdAt: 10,
        latestAttentionAt: 2_000,
        runtime: {
          displayStatus: "active",
          hostReconnectGraceExpiresAt: null,
        },
      }),
      createThread({
        id: "idle-newer-attention",
        createdAt: 40,
        latestAttentionAt: 900,
      }),
      createThread({
        id: "idle-older-attention",
        createdAt: 30,
        latestAttentionAt: 750,
      }),
    ]);

    expect(summarizeItems(topLevelItems)).toEqual([
      "active-newer-created",
      "active-older-created",
      "idle-newer-attention",
      "idle-older-attention",
    ]);
  });

  it("groups shared worktree environments at the top level", () => {
    const topLevelItems = buildProjectThreadGroups([
      createThread({
        id: "worktree-a",
        environmentId: "env_shared",
        environmentWorkspaceDisplayKind: "managed-worktree",
        createdAt: 10,
        latestAttentionAt: 100,
      }),
      createThread({
        id: "worktree-b",
        environmentId: "env_shared",
        environmentWorkspaceDisplayKind: "managed-worktree",
        createdAt: 20,
        latestAttentionAt: 200,
      }),
      createThread({
        id: "loose-thread",
        createdAt: 5,
        latestAttentionAt: 50,
      }),
    ]);

    expect(summarizeItems(topLevelItems)).toEqual([
      { env: "env_shared", threads: ["worktree-b", "worktree-a"] },
      "loose-thread",
    ]);
  });

  it("rolls environment group activity up from grouped threads", () => {
    const topLevelItems = buildProjectThreadGroups([
      createThread({
        id: "quiet-thread",
        environmentId: "env_shared",
        environmentWorkspaceDisplayKind: "managed-worktree",
      }),
      createThread({
        id: "busy-thread",
        environmentId: "env_shared",
        environmentWorkspaceDisplayKind: "managed-worktree",
        status: "active",
        runtime: {
          displayStatus: "active",
          hostReconnectGraceExpiresAt: null,
        },
      }),
      createThread({
        id: "pending-thread",
        environmentId: "env_shared",
        environmentWorkspaceDisplayKind: "managed-worktree",
        hasPendingInteraction: true,
      }),
    ]);

    const group =
      topLevelItems[0]?.kind === "environment" ? topLevelItems[0].group : null;
    expect(group?.stats).toEqual({
      childActivity: {
        pending: true,
        working: true,
        unread: true,
        unreadError: false,
      },
    });
  });

  it("sorts top-level threads with the regular ordering", () => {
    const topLevelItems = buildProjectThreadGroups([
      createThread({
        id: "root-thread",
        createdAt: 100,
        latestAttentionAt: 100,
      }),
      createThread({
        id: "older-thread",
        createdAt: 10,
        latestAttentionAt: 10,
      }),
      createThread({
        id: "newer-thread",
        createdAt: 20,
        latestAttentionAt: 20,
      }),
    ]);

    expect(summarizeItems(topLevelItems)).toEqual([
      "root-thread",
      "newer-thread",
      "older-thread",
    ]);
  });
});
