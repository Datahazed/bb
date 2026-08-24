import {
  PERSONAL_PROJECT_ID,
  type ThreadListEntry,
  type ThreadStatusChangeMetadata,
} from "@bb/domain";
import type { SidebarBootstrapResponse } from "@bb/server-contract";
import {
  QueryClient,
  QueryObserver,
  type QueryKey,
} from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import {
  archivedThreadsListQueryKey,
  sidebarNavigationQueryKey,
  threadListQueryKey,
  threadQueryKey,
  threadSearchQueryKey,
  threadsQueryKey,
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
    const before = queryClient.getQueryState(sidebarNavigationQueryKey());
    updateCachedThreadListStatusState(queryClient, "t9", ACTIVE_STATUS_CHANGE);
    // Not even a dispatch: the state object is the one from before.
    expect(queryClient.getQueryState(sidebarNavigationQueryKey())).toBe(before);
  });

  it("leaves a pending invalidation and the staleness clock of lists without the row alone, so they still refetch on remount", () => {
    const queryClient = new QueryClient();
    const seededAt = 1_000;
    const archivedKey = archivedThreadsListQueryKey({ projectId: "proj_2" });
    const forksKey = threadListQueryKey({
      archived: false,
      parentThreadId: "t1",
    });
    queryClient.setQueryData(
      archivedKey,
      {
        pageParams: [0],
        pages: [[threadListEntry({ id: "ta", archivedAt: 5 })]],
      },
      { updatedAt: seededAt },
    );
    queryClient.setQueryData(
      forksKey,
      [threadListEntry({ id: "tf", parentThreadId: "t1" })],
      { updatedAt: seededAt },
    );
    queryClient.setQueryData(
      sidebarNavigationQueryKey(),
      sidebarBootstrap({
        projects: [
          project({ id: "proj_1", threads: [threadListEntry({ id: "t1" })] }),
        ],
      }),
      { updatedAt: seededAt },
    );
    // Another client archived a thread while these lists were off screen:
    // the flush flagged them (no observer, so nothing refetches until they
    // remount).
    void queryClient.invalidateQueries({ queryKey: threadsQueryKey() });
    const statesBefore = [archivedKey, forksKey].map((queryKey) =>
      queryClient.getQueryState(queryKey),
    );
    expect(statesBefore.map((state) => state?.isInvalidated)).toEqual([
      true,
      true,
    ]);

    // A turn of a thread in no cached list starts.
    updateCachedThreadListStatusState(queryClient, "t9", ACTIVE_STATUS_CHANGE);

    expect(
      [archivedKey, forksKey].map((queryKey) =>
        queryClient.getQueryState(queryKey),
      ),
    ).toEqual(statesBefore);
    expect(
      queryClient.getQueryState(sidebarNavigationQueryKey())?.dataUpdatedAt,
    ).toBe(seededAt);
    // The forks list remounts (staleTime 10 s): stale by flag, it refetches.
    const queryFn = vi.fn(() => new Promise<never>(() => {}));
    const observer = new QueryObserver(queryClient, {
      queryKey: forksKey,
      queryFn,
      staleTime: 10_000,
    });
    const unsubscribe = observer.subscribe(() => {});
    expect(queryFn).toHaveBeenCalledTimes(1);
    unsubscribe();
    queryClient.clear();
  });

  it("keeps the staleness clock and re-arms a pending invalidation when the patch rewrites a list", () => {
    const queryClient = new QueryClient();
    const seededAt = 1_000;
    const listKey = threadListQueryKey({
      archived: false,
      projectId: "proj_1",
    });
    const t1 = threadListEntry({ id: "t1" });
    queryClient.setQueryData(listKey, [t1], { updatedAt: seededAt });
    void queryClient.invalidateQueries({ queryKey: listKey });

    updateCachedThreadListStatusState(queryClient, "t1", ACTIVE_STATUS_CHANGE);

    const state = queryClient.getQueryState<ThreadListEntry[]>(listKey);
    expect(state?.data).toEqual([{ ...t1, ...ACTIVE_STATUS_CHANGE }]);
    expect(state?.isInvalidated).toBe(true);
    expect(state?.dataUpdatedAt).toBe(seededAt);
  });

  it("keeps an errored sidebar invalidated so its focus retry still fires", async () => {
    const queryClient = new QueryClient();
    const t1 = threadListEntry({ id: "t1" });
    queryClient.setQueryData(
      sidebarNavigationQueryKey(),
      sidebarBootstrap({
        projects: [project({ id: "proj_1", threads: [t1] })],
      }),
    );
    // The refetch after a title change failed: the rows stay, flagged.
    await queryClient
      .fetchQuery({
        queryKey: sidebarNavigationQueryKey(),
        queryFn: () => Promise.reject(new Error("offline")),
        retry: false,
      })
      .catch(() => {});
    expect(
      queryClient.getQueryState(sidebarNavigationQueryKey()),
    ).toMatchObject({ status: "error", isInvalidated: true });

    updateCachedThreadListStatusState(queryClient, "t9", ACTIVE_STATUS_CHANGE);
    expect(
      queryClient.getQueryState(sidebarNavigationQueryKey()),
    ).toMatchObject({ status: "error", isInvalidated: true });

    updateCachedThreadListStatusState(queryClient, "t1", ACTIVE_STATUS_CHANGE);
    const state = queryClient.getQueryState<SidebarBootstrapResponse>(
      sidebarNavigationQueryKey(),
    );
    expect(state?.data?.projects[0].threads[0].status).toBe("active");
    expect(state?.isInvalidated).toBe(true);
  });
});

describe("getFetchingThreadListQueryKeys", () => {
  it("returns only the thread list and sidebar keys with a refetch in flight, leaving first loads out", () => {
    const queryClient = new QueryClient();
    const never = () => new Promise<never>(() => {});
    // `clear()` below cancels these fetches; the rejection is expected.
    const refetching = <T>(queryKey: QueryKey, data: T): void => {
      queryClient.setQueryData(queryKey, data);
      queryClient.fetchQuery({ queryKey, queryFn: never }).catch(() => {});
    };
    const fetchingList = threadListQueryKey({
      archived: false,
      projectId: "proj_1",
    });
    refetching(sidebarNavigationQueryKey(), sidebarBootstrap());
    refetching(fetchingList, []);
    refetching(archivedThreadsListQueryKey({}), {
      pageParams: [0],
      pages: [[]],
    });
    // Not lists: the record and the search results.
    refetching(threadQueryKey("t1"), { id: "t1" });
    refetching(threadSearchQueryKey({ query: "x", limitPerGroup: 5 }), []);
    // A first load holds no row a patch could have touched.
    queryClient
      .fetchQuery({
        queryKey: threadListQueryKey({ archived: false, projectId: "proj_3" }),
        queryFn: never,
      })
      .catch(() => {});
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
