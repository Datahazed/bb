// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type {
  ThreadTimelineResponse,
  TimelinePaginationCursor,
  TimelineRow,
} from "@bb/server-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as api from "@/lib/api";
import { threadTimelineQueryKey } from "@/hooks/queries/query-keys";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { conversationRow } from "@/test/fixtures/thread-timeline-rows";
import { useThreadTimelineController } from "./useThreadTimelineController";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    getThreadTimeline: vi.fn(),
  };
});

vi.mock("@/hooks/useRealtimeSubscription", () => ({
  useThreadDetailRealtimeSubscription: vi.fn(),
}));

vi.mock("@/hooks/useServerConnectionState", () => ({
  useServerConnectionState: () => "connected",
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function makeTimelineResponse({
  olderCursor = null,
  rows = [],
}: {
  olderCursor?: TimelinePaginationCursor | null;
  rows?: TimelineRow[];
} = {}): ThreadTimelineResponse {
  return {
    rows,
    activePromptMode: null,
    activeThinking: null,
    activeWorkflow: null,
    activeBackgroundCommands: [],
    pendingTodos: null,
    goal: null,
    modelFallback: null,
    maxSeq: 0,
    timelinePage: {
      kind: "latest",
      segmentLimit: 20,
      returnedSegmentCount: rows.length > 0 ? 1 : 0,
      hasOlderRows: olderCursor !== null,
      olderCursor,
    },
  };
}

describe("useThreadTimelineController", () => {
  it("keeps an initial timeline refetch in loading state instead of showing the previous error", async () => {
    const response = makeTimelineResponse();
    let resolveRefetch: (value: ThreadTimelineResponse) => void = () => {};
    vi.mocked(api.getThreadTimeline)
      .mockRejectedValueOnce(
        new api.HttpError({
          status: 500,
          message: "Server error",
        }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<ThreadTimelineResponse>((resolve) => {
            resolveRefetch = resolve;
          }),
      );

    const { queryClient, wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(
      () => useThreadTimelineController({ threadId: "thread-1" }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.timelineError).toBeInstanceOf(api.HttpError);
    });

    act(() => {
      void queryClient.refetchQueries({
        queryKey: threadTimelineQueryKey("thread-1"),
      });
    });

    await waitFor(() => {
      expect(result.current.timelineLoading).toBe(true);
    });
    expect(result.current.timelineError).toBeNull();

    resolveRefetch(response);

    await waitFor(() => {
      expect(result.current.timelineLoading).toBe(false);
      expect(result.current.timelineError).toBeNull();
      expect(api.getThreadTimeline).toHaveBeenCalledTimes(2);
    });
  });

  it("starts only one older-page request when callers overlap", async () => {
    const cursor = { anchorId: "older-page", anchorSeq: 20 };
    const newer = conversationRow({
      id: "newer-message",
      role: "assistant",
      sourceSeqEnd: 40,
      sourceSeqStart: 40,
      text: "Newer message",
      threadId: "thread-1",
      turnId: "turn-1",
    });
    const older = conversationRow({
      id: "older-message",
      role: "user",
      sourceSeqEnd: 10,
      sourceSeqStart: 10,
      text: "Older message",
      threadId: "thread-1",
      turnId: "turn-0",
    });
    let resolveOlderPage: (response: ThreadTimelineResponse) => void = () => {};
    vi.mocked(api.getThreadTimeline)
      .mockResolvedValueOnce(
        makeTimelineResponse({ olderCursor: cursor, rows: [newer] }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<ThreadTimelineResponse>((resolve) => {
            resolveOlderPage = resolve;
          }),
      );

    const { wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(
      () => useThreadTimelineController({ threadId: "thread-1" }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.hasOlderTimelineRows).toBe(true));

    let firstRequest!: Promise<boolean>;
    let overlappingRequest!: Promise<boolean>;
    act(() => {
      firstRequest = result.current.loadOlderTimelineRows();
      overlappingRequest = result.current.loadOlderTimelineRows();
    });
    await expect(overlappingRequest).resolves.toBe(false);
    expect(api.getThreadTimeline).toHaveBeenCalledTimes(2);

    resolveOlderPage(makeTimelineResponse({ rows: [older] }));
    await expect(firstRequest).resolves.toBe(true);
    await waitFor(() => {
      expect(result.current.timelineRows.map((row) => row.id)).toEqual([
        "older-message",
        "newer-message",
      ]);
      expect(result.current.isLoadingOlderTimelineRows).toBe(false);
    });
  });

  it("rejects an older-page response after the pagination surface changes", async () => {
    const cursor = { anchorId: "older-page", anchorSeq: 20 };
    const newer = conversationRow({
      id: "newer-message",
      role: "assistant",
      sourceSeqEnd: 40,
      sourceSeqStart: 40,
      text: "Newer message",
      threadId: "thread-1",
      turnId: "turn-1",
    });
    const older = conversationRow({
      id: "older-message",
      role: "user",
      sourceSeqEnd: 10,
      sourceSeqStart: 10,
      text: "Older message",
      threadId: "thread-1",
      turnId: "turn-0",
    });
    let resolveOlderPage: (response: ThreadTimelineResponse) => void = () => {};
    vi.mocked(api.getThreadTimeline)
      .mockResolvedValueOnce(
        makeTimelineResponse({ olderCursor: cursor, rows: [newer] }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<ThreadTimelineResponse>((resolve) => {
            resolveOlderPage = resolve;
          }),
      );

    const { wrapper } = createQueryClientTestHarness();
    const { result, rerender } = renderHook(
      ({ surfaceKey }) =>
        useThreadTimelineController({ surfaceKey, threadId: "thread-1" }),
      { initialProps: { surfaceKey: "surface-1" }, wrapper },
    );
    await waitFor(() => expect(result.current.hasOlderTimelineRows).toBe(true));

    let request!: Promise<boolean>;
    act(() => {
      request = result.current.loadOlderTimelineRows();
    });
    rerender({ surfaceKey: "surface-2" });
    resolveOlderPage(makeTimelineResponse({ rows: [older] }));

    await expect(request).resolves.toBe(false);
    await waitFor(() => {
      expect(result.current.paginationSurfaceKey).toBe("surface-2");
      expect(result.current.timelineRows.map((row) => row.id)).toEqual([
        "newer-message",
      ]);
      expect(result.current.isLoadingOlderTimelineRows).toBe(false);
    });
  });

  it("does not reuse an in-flight request when a surface key returns", async () => {
    const cursor = { anchorId: "older-page", anchorSeq: 20 };
    const newer = conversationRow({
      id: "newer-message",
      role: "assistant",
      sourceSeqEnd: 40,
      sourceSeqStart: 40,
      text: "Newer message",
      threadId: "thread-1",
      turnId: "turn-1",
    });
    const staleOlder = conversationRow({
      id: "stale-older-message",
      role: "user",
      sourceSeqEnd: 10,
      sourceSeqStart: 10,
      text: "Stale older message",
      threadId: "thread-1",
      turnId: "turn-0",
    });
    const currentOlder = conversationRow({
      id: "current-older-message",
      role: "user",
      sourceSeqEnd: 11,
      sourceSeqStart: 11,
      text: "Current older message",
      threadId: "thread-1",
      turnId: "turn-0",
    });
    let resolveStalePage: (response: ThreadTimelineResponse) => void = () => {};
    let resolveCurrentPage: (
      response: ThreadTimelineResponse,
    ) => void = () => {};
    vi.mocked(api.getThreadTimeline)
      .mockResolvedValueOnce(
        makeTimelineResponse({ olderCursor: cursor, rows: [newer] }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<ThreadTimelineResponse>((resolve) => {
            resolveStalePage = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<ThreadTimelineResponse>((resolve) => {
            resolveCurrentPage = resolve;
          }),
      );

    const { wrapper } = createQueryClientTestHarness();
    const { result, rerender } = renderHook(
      ({ surfaceKey }) =>
        useThreadTimelineController({ surfaceKey, threadId: "thread-1" }),
      { initialProps: { surfaceKey: "surface-a" }, wrapper },
    );
    await waitFor(() => expect(result.current.hasOlderTimelineRows).toBe(true));

    let staleRequest!: Promise<boolean>;
    act(() => {
      staleRequest = result.current.loadOlderTimelineRows();
    });
    rerender({ surfaceKey: "surface-b" });
    rerender({ surfaceKey: "surface-a" });
    await waitFor(() => {
      expect(result.current.hasOlderTimelineRows).toBe(true);
      expect(result.current.isLoadingOlderTimelineRows).toBe(false);
    });

    let currentRequest!: Promise<boolean>;
    act(() => {
      currentRequest = result.current.loadOlderTimelineRows();
    });
    expect(api.getThreadTimeline).toHaveBeenCalledTimes(3);

    resolveStalePage(makeTimelineResponse({ rows: [staleOlder] }));
    await expect(staleRequest).resolves.toBe(false);
    expect(result.current.timelineRows.map((row) => row.id)).toEqual([
      "newer-message",
    ]);

    resolveCurrentPage(makeTimelineResponse({ rows: [currentOlder] }));
    await expect(currentRequest).resolves.toBe(true);
    await waitFor(() => {
      expect(result.current.timelineRows.map((row) => row.id)).toEqual([
        "current-older-message",
        "newer-message",
      ]);
    });
  });

  it("does not apply stale-cursor recovery across a surface lifecycle", async () => {
    const cursor = { anchorId: "older-page", anchorSeq: 20 };
    const newer = conversationRow({
      id: "newer-message",
      role: "assistant",
      sourceSeqEnd: 40,
      sourceSeqStart: 40,
      text: "Newer message",
      threadId: "thread-1",
      turnId: "turn-1",
    });
    const currentOlder = conversationRow({
      id: "current-older-message",
      role: "user",
      sourceSeqEnd: 11,
      sourceSeqStart: 11,
      text: "Current older message",
      threadId: "thread-1",
      turnId: "turn-0",
    });
    let resolveRecoveryRefetch: (
      response: ThreadTimelineResponse,
    ) => void = () => {};
    let resolveCurrentPage: (
      response: ThreadTimelineResponse,
    ) => void = () => {};
    vi.mocked(api.getThreadTimeline)
      .mockResolvedValueOnce(
        makeTimelineResponse({ olderCursor: cursor, rows: [newer] }),
      )
      .mockRejectedValueOnce(
        new api.HttpError({
          code: "invalid_request",
          message: "The timeline cursor is stale",
          status: 400,
        }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<ThreadTimelineResponse>((resolve) => {
            resolveRecoveryRefetch = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<ThreadTimelineResponse>((resolve) => {
            resolveCurrentPage = resolve;
          }),
      );

    const { wrapper } = createQueryClientTestHarness();
    const { result, rerender } = renderHook(
      ({ surfaceKey }) =>
        useThreadTimelineController({ surfaceKey, threadId: "thread-1" }),
      { initialProps: { surfaceKey: "surface-a" }, wrapper },
    );
    await waitFor(() => expect(result.current.hasOlderTimelineRows).toBe(true));

    let staleRequest!: Promise<boolean>;
    act(() => {
      staleRequest = result.current.loadOlderTimelineRows();
    });
    await waitFor(() => expect(api.getThreadTimeline).toHaveBeenCalledTimes(3));

    rerender({ surfaceKey: "surface-b" });
    rerender({ surfaceKey: "surface-a" });
    await waitFor(() => {
      expect(result.current.hasOlderTimelineRows).toBe(true);
      expect(result.current.isLoadingOlderTimelineRows).toBe(false);
    });
    let currentRequest!: Promise<boolean>;
    act(() => {
      currentRequest = result.current.loadOlderTimelineRows();
    });
    expect(api.getThreadTimeline).toHaveBeenCalledTimes(4);

    resolveRecoveryRefetch(
      makeTimelineResponse({ olderCursor: cursor, rows: [newer] }),
    );
    await expect(staleRequest).resolves.toBe(false);
    expect(result.current.isLoadingOlderTimelineRows).toBe(true);

    resolveCurrentPage(makeTimelineResponse({ rows: [currentOlder] }));
    await expect(currentRequest).resolves.toBe(true);
    await waitFor(() => {
      expect(result.current.timelineRows.map((row) => row.id)).toEqual([
        "current-older-message",
        "newer-message",
      ]);
      expect(result.current.isLoadingOlderTimelineRows).toBe(false);
    });
  });
});
