import type { ThreadListEntry } from "@bb/domain";
import { describe, expect, it } from "vitest";
import { buildPinnedSidebarState } from "./pinnedSidebarThreads";

type ThreadListEntryOverrides = Partial<ThreadListEntry>;

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

function pinnedThreadIds(
  state: ReturnType<typeof buildPinnedSidebarState>,
): string[] {
  return state.threadNodes.map((node) => node.thread.id);
}

describe("buildPinnedSidebarState", () => {
  it("sorts visible pinned threads by global pin sort key", () => {
    const state = buildPinnedSidebarState({
      threads: [
        createThread({
          id: "unpinned",
          createdAt: 4,
        }),
        createThread({
          id: "pinned-late",
          pinnedAt: 1_000,
          pinSortKey: "b",
        }),
        createThread({
          id: "pinned-early",
          pinnedAt: 2_000,
          pinSortKey: "a",
        }),
      ],
    });

    expect(pinnedThreadIds(state)).toEqual(["pinned-early", "pinned-late"]);
    expect([...state.effectivePinnedThreadIds].sort()).toEqual([
      "pinned-early",
      "pinned-late",
    ]);
  });

  it("orders pin sort keys by codepoint, not locale", () => {
    const state = buildPinnedSidebarState({
      threads: [
        createThread({
          id: "pinned-lower",
          pinnedAt: 1_000,
          pinSortKey: "a",
        }),
        createThread({
          id: "pinned-upper",
          pinnedAt: 2_000,
          pinSortKey: "Z",
        }),
      ],
    });

    expect(pinnedThreadIds(state)).toEqual(["pinned-upper", "pinned-lower"]);
  });

  it("includes only explicitly pinned threads", () => {
    const state = buildPinnedSidebarState({
      threads: [
        createThread({
          id: "pinned-thread",
          pinnedAt: 1_000,
          pinSortKey: "a",
        }),
        createThread({
          id: "unpinned-thread",
        }),
      ],
    });

    expect([...state.effectivePinnedThreadIds].sort()).toEqual([
      "pinned-thread",
    ]);
    expect(pinnedThreadIds(state)).toEqual(["pinned-thread"]);
  });
});
