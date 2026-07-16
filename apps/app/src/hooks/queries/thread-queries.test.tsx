// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "@/lib/api";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { ARCHIVED_THREADS_PAGE_SIZE } from "./archived-threads-page-size";
import {
  threadHostFilePreviewQueryKey,
  threadQueuedMessagesQueryKey,
  threadTimelineTurnSummaryDetailsQueryKey,
} from "./query-keys";
import {
  useArchivedThreads,
  useThreadHostFilePreview,
  useThreadQueuedMessages,
  useThreadTimelineTurnSummaryDetails,
} from "./thread-queries";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    getThreadHostFilePreview: vi.fn(),
    getThreadTimelineTurnSummaryDetails: vi.fn(),
    listThreadQueuedMessages: vi.fn(),
    listThreads: vi.fn(),
  };
});

vi.mock("@/hooks/useRealtimeSubscription", () => ({
  useThreadDetailRealtimeSubscription: vi.fn(),
  useThreadListRealtimeSubscription: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  vi.mocked(api.listThreads).mockResolvedValue([]);
  vi.mocked(api.listThreadQueuedMessages).mockResolvedValue([]);
  vi.mocked(api.getThreadHostFilePreview).mockResolvedValue({
    kind: "text",
    path: "/tmp/log.txt",
    url: "/api/v1/threads/thread-1/host-files/content?path=%2Ftmp%2Flog.txt",
    mimeType: "text/plain",
    content: "preview",
  });
  vi.mocked(api.getThreadTimelineTurnSummaryDetails).mockImplementation(
    async ({ beforeCursor }) => ({
      rows: [],
      timelinePage: {
        hasOlderRows: beforeCursor === null,
        olderCursor:
          beforeCursor === null
            ? {
                anchorId: "timeline-event-window:event-40",
                anchorSeq: 40,
              }
            : null,
      },
    }),
  );
});

describe("useThreadTimelineTurnSummaryDetails", () => {
  it("keeps distinct context-item sets in distinct detail caches", () => {
    const identity = {
      active: true,
      detailKind: "turn",
      parentToolCallId: null,
      sourceSeqEnd: 100,
      sourceSeqStart: 2,
      threadId: "thread-1",
      turnId: "turn-1",
    } as const;
    expect(
      threadTimelineTurnSummaryDetailsQueryKey({
        ...identity,
        contextItemIds: ["a", "b"],
      }),
    ).not.toEqual(
      threadTimelineTurnSummaryDetailsQueryKey({
        ...identity,
        contextItemIds: ["a\u0000b"],
      }),
    );
  });

  it("keeps delegation child intervals in distinct detail caches", () => {
    const identity = {
      active: false,
      detailKind: "delegation-children",
      directTurnSourceSeqStart: 10,
      parentToolCallId: "delegation-1",
      sourceSeqEnd: 100,
      sourceSeqStart: 1,
      threadId: "thread-1",
      turnId: "turn-1",
    } as const;
    expect(
      threadTimelineTurnSummaryDetailsQueryKey({
        ...identity,
        directTurnSourceSeqEnd: 20,
      }),
    ).not.toEqual(
      threadTimelineTurnSummaryDetailsQueryKey({
        ...identity,
        directTurnSourceSeqEnd: 30,
      }),
    );
  });

  it("refetches loaded active pages when the summary frontier advances", async () => {
    const { wrapper } = createQueryClientTestHarness();
    const { result, rerender } = renderHook(
      ({ sourceSeqEnd }: { sourceSeqEnd: number }) =>
        useThreadTimelineTurnSummaryDetails({
          active: true,
          contextItemIds: [],
          detailKind: "turn",
          parentToolCallId: null,
          sourceSeqEnd,
          sourceSeqStart: 2,
          threadId: "thread-1",
          turnId: "turn-1",
        }),
      { initialProps: { sourceSeqEnd: 100 }, wrapper },
    );
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(1));
    await waitFor(() => expect(result.current.hasNextPage).toBe(true));
    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(2));

    vi.mocked(api.getThreadTimelineTurnSummaryDetails).mockClear();
    rerender({ sourceSeqEnd: 120 });
    expect(result.current.data?.pages).toHaveLength(2);
    await waitFor(() =>
      expect(
        vi
          .mocked(api.getThreadTimelineTurnSummaryDetails)
          .mock.calls.some(([args]) => args.sourceSeqEnd === 120),
      ).toBe(true),
    );
    await waitFor(() => expect(result.current.isFetching).toBe(false));
    expect(result.current.data?.pages).toHaveLength(2);
  });
});

describe("useArchivedThreads", () => {
  it("loads archived threads across all projects when no scope is selected", async () => {
    const { wrapper } = createQueryClientTestHarness();

    renderHook(() => useArchivedThreads({}), { wrapper });

    await waitFor(() => {
      expect(api.listThreads).toHaveBeenCalled();
    });
    expect(vi.mocked(api.listThreads).mock.calls[0]?.[0]).toEqual({
      archived: true,
      limit: ARCHIVED_THREADS_PAGE_SIZE,
      offset: 0,
    });
  });

  it("maps the archived kind filter to the parent-thread query", async () => {
    const { wrapper } = createQueryClientTestHarness();

    renderHook(() => useArchivedThreads({ kind: "child" }), { wrapper });

    await waitFor(() => {
      expect(api.listThreads).toHaveBeenCalled();
    });
    expect(vi.mocked(api.listThreads).mock.calls[0]?.[0]).toEqual({
      archived: true,
      hasParent: true,
      limit: ARCHIVED_THREADS_PAGE_SIZE,
      offset: 0,
    });
  });

  it("keeps project scope for project archived lists", async () => {
    const { wrapper } = createQueryClientTestHarness();

    renderHook(() => useArchivedThreads({ projectId: "proj_1" }), {
      wrapper,
    });

    await waitFor(() => {
      expect(api.listThreads).toHaveBeenCalled();
    });
    expect(vi.mocked(api.listThreads).mock.calls[0]?.[0]).toEqual({
      archived: true,
      limit: ARCHIVED_THREADS_PAGE_SIZE,
      offset: 0,
      projectId: "proj_1",
    });
  });
});

describe("useThreadQueuedMessages", () => {
  it("refetches stale queue data on window focus", async () => {
    const { queryClient, wrapper } = createQueryClientTestHarness();

    renderHook(() => useThreadQueuedMessages("thread-1"), { wrapper });

    await waitFor(() => {
      expect(api.listThreadQueuedMessages).toHaveBeenCalledTimes(1);
    });

    const query = queryClient.getQueryCache().find({
      queryKey: threadQueuedMessagesQueryKey("thread-1"),
    });

    expect(query?.options).toEqual(
      expect.objectContaining({
        refetchOnMount: true,
        refetchOnWindowFocus: true,
      }),
    );
  });
});

describe("useThreadHostFilePreview", () => {
  it("refetches stale host file previews on focus and reconnect", async () => {
    const { queryClient, wrapper } = createQueryClientTestHarness();

    renderHook(
      () => useThreadHostFilePreview("thread-1", "env-1", "/tmp/log.txt"),
      { wrapper },
    );

    await waitFor(() => {
      expect(api.getThreadHostFilePreview).toHaveBeenCalledTimes(1);
    });

    const query = queryClient.getQueryCache().find({
      queryKey: threadHostFilePreviewQueryKey(
        "thread-1",
        "env-1",
        "/tmp/log.txt",
      ),
    });

    expect(query?.options).toEqual(
      expect.objectContaining({
        refetchOnReconnect: true,
        refetchOnWindowFocus: true,
      }),
    );
  });
});
