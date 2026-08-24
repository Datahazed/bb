import {
  PERSONAL_PROJECT_ID,
  type ThreadStatusChangeMetadata,
} from "@bb/domain";
import type { SidebarBootstrapResponse } from "@bb/server-contract";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import {
  archivedThreadsListQueryKey,
  sidebarNavigationQueryKey,
  threadListQueryKey,
  threadQueryKey,
  threadSearchQueryKey,
} from "@/lib/query/query-keys";
import { project, sidebarBootstrap, threadListEntry } from "../test/fixtures";
import {
  getFetchingThreadListQueryKeys,
  updateCachedThreadListStatusState,
  type ThreadListCacheData,
} from "./thread-list-cache";

const ACTIVE_STATUS_CHANGE: ThreadStatusChangeMetadata = {
  status: "active",
  runtime: { displayStatus: "active", hostReconnectGraceExpiresAt: null },
  activity: {
    activeWorkflowCount: 0,
    activeBackgroundAgentCount: 0,
    activeBackgroundCommandCount: 0,
    activePlanModeCount: 1,
    activeGoalCount: 0,
  },
  latestAttentionAt: 500,
  updatedAt: 500,
};

describe("updateCachedThreadListStatusState", () => {
  it("patches the row in flat lists, archived pages and the sidebar, leaving lists without the row referentially equal", () => {
    const queryClient = new QueryClient();
    const t1 = threadListEntry({ id: "t1" });
    const t2 = threadListEntry({ id: "t2", projectId: "proj_2" });
    const tp = threadListEntry({ id: "tp", projectId: PERSONAL_PROJECT_ID });
    const ta = threadListEntry({ id: "ta", archivedAt: 5 });
    const tb = threadListEntry({ id: "tb", archivedAt: 6 });
    queryClient.setQueryData(
      sidebarNavigationQueryKey(),
      sidebarBootstrap({
        projects: [
          project({ id: "proj_1", threads: [t1] }),
          project({ id: "proj_2", threads: [t2] }),
        ],
        personalProject: project({
          id: PERSONAL_PROJECT_ID,
          kind: "personal",
          threads: [tp],
        }),
      }),
    );
    const proj1Key = threadListQueryKey({
      archived: false,
      projectId: "proj_1",
    });
    const proj2Key = threadListQueryKey({
      archived: false,
      projectId: "proj_2",
    });
    queryClient.setQueryData(proj1Key, [t1]);
    queryClient.setQueryData(proj2Key, [t2]);
    queryClient.setQueryData(archivedThreadsListQueryKey({}), {
      pageParams: [0, 50],
      pages: [[ta], [tb]],
    });
    const sidebarBefore = queryClient.getQueryData<SidebarBootstrapResponse>(
      sidebarNavigationQueryKey(),
    );
    const proj2Before = queryClient.getQueryData(proj2Key);
    const archivedBefore = queryClient.getQueryData<ThreadListCacheData>(
      archivedThreadsListQueryKey({}),
    );

    updateCachedThreadListStatusState(queryClient, "t1", ACTIVE_STATUS_CHANGE);
    const patched = { ...t1, ...ACTIVE_STATUS_CHANGE };
    expect(queryClient.getQueryData(proj1Key)).toEqual([patched]);
    const sidebar = queryClient.getQueryData<SidebarBootstrapResponse>(
      sidebarNavigationQueryKey(),
    );
    expect(sidebar?.projects[0].threads).toEqual([patched]);
    // Only the list holding the row is rebuilt; the rest keep their identity.
    expect(sidebar?.projects[1]).toBe(sidebarBefore?.projects[1]);
    expect(sidebar?.personalProject).toBe(sidebarBefore?.personalProject);
    expect(queryClient.getQueryData(proj2Key)).toBe(proj2Before);
    expect(queryClient.getQueryData(archivedThreadsListQueryKey({}))).toBe(
      archivedBefore,
    );

    updateCachedThreadListStatusState(queryClient, "tp", ACTIVE_STATUS_CHANGE);
    expect(
      queryClient.getQueryData<SidebarBootstrapResponse>(
        sidebarNavigationQueryKey(),
      )?.personalProject.threads,
    ).toEqual([{ ...tp, ...ACTIVE_STATUS_CHANGE }]);

    updateCachedThreadListStatusState(queryClient, "tb", ACTIVE_STATUS_CHANGE);
    const archived = queryClient.getQueryData<{
      pageParams: number[];
      pages: (typeof ta)[][];
    }>(archivedThreadsListQueryKey({}));
    expect(archived?.pages[1]).toEqual([{ ...tb, ...ACTIVE_STATUS_CHANGE }]);
    expect(archived?.pageParams).toEqual([0, 50]);
    if (!archivedBefore || Array.isArray(archivedBefore))
      throw new Error("setup");
    expect(archived?.pages[0]).toBe(archivedBefore.pages[0]);
  });

  it("is a no-op for a thread in no cached list", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(
      sidebarNavigationQueryKey(),
      sidebarBootstrap({
        projects: [
          project({ id: "proj_1", threads: [threadListEntry({ id: "t1" })] }),
        ],
      }),
    );
    const before = queryClient.getQueryData(sidebarNavigationQueryKey());
    updateCachedThreadListStatusState(queryClient, "t9", ACTIVE_STATUS_CHANGE);
    expect(queryClient.getQueryData(sidebarNavigationQueryKey())).toBe(before);
  });
});

describe("getFetchingThreadListQueryKeys", () => {
  it("returns only the thread list and sidebar keys with a fetch in flight", () => {
    const queryClient = new QueryClient();
    const never = () => new Promise<never>(() => {});
    const fetchingList = threadListQueryKey({
      archived: false,
      projectId: "proj_1",
    });
    for (const queryKey of [
      sidebarNavigationQueryKey(),
      fetchingList,
      archivedThreadsListQueryKey({}),
      // Not lists: the record and the search results.
      threadQueryKey("t1"),
      threadSearchQueryKey({ query: "x", limitPerGroup: 5 }),
    ]) {
      // `clear()` below cancels these; the rejection is expected.
      queryClient.fetchQuery({ queryKey, queryFn: never }).catch(() => {});
    }
    // Cached but idle.
    queryClient.setQueryData(
      threadListQueryKey({ archived: false, projectId: "proj_2" }),
      [],
    );

    const keys = getFetchingThreadListQueryKeys(queryClient);
    expect(keys).toHaveLength(3);
    expect(keys).toEqual(
      expect.arrayContaining([
        sidebarNavigationQueryKey(),
        fetchingList,
        archivedThreadsListQueryKey({}),
      ]),
    );
    queryClient.clear();
  });
});
