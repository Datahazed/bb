// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TimelineTurnSummaryDetailsResponse } from "@bb/server-contract";
import type { ThreadTimelineTurnSummaryDetailsQueryIdentity } from "@/hooks/queries/query-keys";
import {
  commandRow,
  conversationRow,
  delegationRow,
  turnRow,
} from "@/test/fixtures/thread-timeline-rows";
import { ThreadTimelineRows } from "./ThreadTimelineRows";
import { ThreadTimelineSurface } from "./ThreadTimelineSurface";

const query = vi.hoisted(() => ({
  data: undefined as
    | { pages: TimelineTurnSummaryDetailsResponse[] }
    | undefined,
  fetchNextPage: vi.fn(),
  hasNextPage: false,
  isError: false,
  isFetchingNextPage: false,
  refetch: vi.fn(),
}));
const captureScrollAnchor = vi.hoisted(() => vi.fn());
const cancelScrollAnchor = vi.hoisted(() => vi.fn());
const restoreScrollAnchor = vi.hoisted(() => vi.fn());
const useDetails = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/queries/thread-queries", () => ({
  useThreadTimelineTurnSummaryDetails: useDetails,
}));

vi.mock("@/components/ui/bottom-anchored-scroll-body.js", () => ({
  useBottomAnchoredScroll: () => ({ captureScrollAnchor }),
}));

function detailResponse(
  text: string,
  sequence: number,
  hasOlderRows: boolean,
): TimelineTurnSummaryDetailsResponse {
  return {
    rows: [
      conversationRow({
        id: `assistant-${sequence}`,
        role: "assistant",
        sourceSeqEnd: sequence,
        sourceSeqStart: sequence,
        text,
        threadId: "thread-1",
        turnId: "turn-1",
      }),
    ],
    timelinePage: {
      hasOlderRows,
      olderCursor: hasOlderRows
        ? { anchorId: `assistant-${sequence}`, anchorSeq: sequence }
        : null,
    },
  };
}

function pendingSummaryElement(sourceSeqStart = 2) {
  return (
    <MemoryRouter>
      <ThreadTimelineRows
        initialExpanded={new Set(["active-summary"])}
        threadId="thread-1"
        threadRuntimeDisplayStatus="active"
        timelineRows={[
          turnRow({
            children: null,
            durationMs: null,
            id: "active-summary",
            sourceSeqEnd: 50,
            sourceSeqStart,
            status: "pending",
            threadId: "thread-1",
            turnId: "turn-1",
          }),
        ]}
        workspaceRootPath={undefined}
      />
    </MemoryRouter>
  );
}

function renderPendingSummary() {
  return render(pendingSummaryElement());
}

describe("lazy turn-summary pagination", () => {
  beforeEach(() => {
    query.data = { pages: [] };
    query.fetchNextPage.mockReset();
    query.hasNextPage = false;
    query.isError = false;
    query.isFetchingNextPage = false;
    query.refetch.mockReset();
    captureScrollAnchor.mockReset();
    cancelScrollAnchor.mockReset();
    restoreScrollAnchor.mockReset();
    captureScrollAnchor.mockReturnValue({
      cancel: cancelScrollAnchor,
      restore: restoreScrollAnchor,
    });
    query.fetchNextPage.mockResolvedValue({ data: query.data, isError: false });
    useDetails.mockReset();
    useDetails.mockImplementation(() => query);
  });

  afterEach(() => cleanup());

  it("restores only after the requested older page commits", async () => {
    const newerPage = detailResponse("Newer loaded work", 40, true);
    const realtimePage = detailResponse("Realtime work", 41, true);
    const olderPage = detailResponse("Older loaded work", 20, false);
    query.data = {
      pages: [newerPage],
    };
    query.hasNextPage = true;
    let resolveFetch: (result: {
      data: typeof query.data;
      isError: boolean;
    }) => void = () => {};
    query.fetchNextPage.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    );

    const view = renderPendingSummary();

    fireEvent.click(screen.getByRole("button", { name: "Show earlier work" }));
    expect(captureScrollAnchor).toHaveBeenCalledTimes(1);
    expect(query.fetchNextPage).toHaveBeenCalledTimes(1);

    // A realtime refetch can change the active page while the older request is
    // pending, but it must not consume this request's anchor.
    query.data = { pages: [realtimePage] };
    view.rerender(pendingSummaryElement());
    expect(restoreScrollAnchor).not.toHaveBeenCalled();

    query.data = { pages: [realtimePage, olderPage] };
    resolveFetch({ data: query.data, isError: false });
    await waitFor(() => expect(restoreScrollAnchor).toHaveBeenCalledTimes(1));

    const older = screen.getByText("Older loaded work");
    const realtime = screen.getByText("Realtime work");
    expect(
      older.compareDocumentPosition(realtime) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("waits for the detail-page render when the request completes first", async () => {
    const newerPage = detailResponse("Newer loaded work", 40, true);
    const olderPage = detailResponse("Older loaded work", 20, false);
    query.data = { pages: [newerPage] };
    query.hasNextPage = true;
    let resolveFetch: (result: {
      data: { pages: TimelineTurnSummaryDetailsResponse[] };
      isError: boolean;
    }) => void = () => {};
    query.fetchNextPage.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    );
    const view = renderPendingSummary();

    fireEvent.click(screen.getByRole("button", { name: "Show earlier work" }));
    resolveFetch({ data: { pages: [newerPage, olderPage] }, isError: false });
    await Promise.resolve();
    expect(restoreScrollAnchor).not.toHaveBeenCalled();

    query.data = { pages: [newerPage, olderPage] };
    view.rerender(pendingSummaryElement());
    await waitFor(() => expect(restoreScrollAnchor).toHaveBeenCalledTimes(1));
  });

  it("cancels an in-flight anchor when the detail identity changes", async () => {
    const newerPage = detailResponse("Newer loaded work", 40, true);
    const olderPage = detailResponse("Older loaded work", 20, false);
    query.data = { pages: [newerPage] };
    query.hasNextPage = true;
    let resolveFetch: (result: {
      data: { pages: TimelineTurnSummaryDetailsResponse[] };
      isError: boolean;
    }) => void = () => {};
    query.fetchNextPage.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    );
    const view = renderPendingSummary();

    fireEvent.click(screen.getByRole("button", { name: "Show earlier work" }));
    view.rerender(pendingSummaryElement(3));
    expect(cancelScrollAnchor).toHaveBeenCalledTimes(1);

    resolveFetch({ data: { pages: [newerPage, olderPage] }, isError: false });
    await Promise.resolve();
    expect(restoreScrollAnchor).not.toHaveBeenCalled();
  });

  it("loads direct child summaries from a delegation-owned boundary", () => {
    query.data = {
      pages: [
        {
          rows: [
            turnRow({
              children: null,
              id: "child-summary",
              sourceSeqEnd: 30,
              sourceSeqStart: 20,
              status: "completed",
              threadId: "thread-1",
              turnId: "child-turn",
            }),
          ],
          timelinePage: { hasOlderRows: false, olderCursor: null },
        },
      ],
    };
    render(
      <MemoryRouter>
        <ThreadTimelineRows
          initialExpanded={new Set(["delegation-1"])}
          threadId="thread-1"
          threadRuntimeDisplayStatus="active"
          timelineRows={[
            {
              ...delegationRow({
                childRows: [],
                id: "delegation-1",
                status: "completed",
                threadId: "thread-1",
                turnId: "parent-turn",
              }),
              childPage: {
                intervals: [
                  {
                    beforeChildRowId: null,
                    directTurnSourceSeqEnd: 30,
                    directTurnSourceSeqStart: 20,
                  },
                ],
                ownerTurnId: "parent-turn",
                parentToolCallId: "delegation-1",
                sourceSeqEnd: 30,
                sourceSeqStart: 20,
              },
            },
          ]}
          workspaceRootPath={undefined}
        />
      </MemoryRouter>,
    );

    expect(useDetails).toHaveBeenCalledWith(
      expect.objectContaining({
        detailKind: "delegation-children",
        directTurnSourceSeqEnd: 30,
        directTurnSourceSeqStart: 20,
        parentToolCallId: "delegation-1",
        sourceSeqEnd: 30,
        sourceSeqStart: 20,
        turnId: "parent-turn",
      }),
    );
    expect(screen.getByText(/Worked for/)).toBeTruthy();
  });

  it("renders each interval once between projected retained summaries, including before trailing work", () => {
    const intervalQueries = new Map([
      ["20:20", detailResponse("Cross-turn child one", 20, false)],
      ["40:40", detailResponse("Cross-turn child two", 40, false)],
    ]);
    useDetails.mockImplementation(
      (identity: ThreadTimelineTurnSummaryDetailsQueryIdentity) => ({
        ...query,
        data:
          identity.detailKind === "delegation-children"
            ? {
                pages: [
                  intervalQueries.get(
                    `${identity.directTurnSourceSeqStart}:${identity.directTurnSourceSeqEnd}`,
                  ),
                ].filter(
                  (page): page is TimelineTurnSummaryDetailsResponse =>
                    page !== undefined,
                ),
              }
            : query.data,
      }),
    );
    const view = render(
      <MemoryRouter>
        <ThreadTimelineRows
          initialExpanded={new Set(["delegation-1"])}
          threadId="thread-1"
          threadRuntimeDisplayStatus="active"
          timelineRows={[
            {
              ...delegationRow({
                childRows: [
                  commandRow({
                    command: "printf retained-one-a",
                    id: "retained-1a",
                    sourceSeqEnd: 10,
                    sourceSeqStart: 10,
                    threadId: "thread-1",
                    turnId: "parent-turn",
                  }),
                  commandRow({
                    command: "printf retained-one-b",
                    id: "retained-1b",
                    sourceSeqEnd: 11,
                    sourceSeqStart: 11,
                    threadId: "thread-1",
                    turnId: "parent-turn",
                  }),
                  commandRow({
                    command: "printf retained-two-a",
                    id: "retained-2a",
                    sourceSeqEnd: 30,
                    sourceSeqStart: 30,
                    threadId: "thread-1",
                    turnId: "parent-turn",
                  }),
                  commandRow({
                    command: "printf retained-two-b",
                    id: "retained-2b",
                    sourceSeqEnd: 31,
                    sourceSeqStart: 31,
                    threadId: "thread-1",
                    turnId: "parent-turn",
                  }),
                  commandRow({
                    command: "printf retained-three-a",
                    id: "retained-3a",
                    sourceSeqEnd: 50,
                    sourceSeqStart: 50,
                    threadId: "thread-1",
                    turnId: "parent-turn",
                  }),
                  commandRow({
                    command: "printf retained-three-b",
                    id: "retained-3b",
                    sourceSeqEnd: 51,
                    sourceSeqStart: 51,
                    threadId: "thread-1",
                    turnId: "parent-turn",
                  }),
                ],
                id: "delegation-1",
                status: "completed",
                threadId: "thread-1",
                turnId: "parent-turn",
              }),
              childPage: {
                intervals: [
                  {
                    beforeChildRowId: "retained-2a",
                    directTurnSourceSeqEnd: 20,
                    directTurnSourceSeqStart: 20,
                  },
                  {
                    beforeChildRowId: "retained-3a",
                    directTurnSourceSeqEnd: 40,
                    directTurnSourceSeqStart: 40,
                  },
                ],
                ownerTurnId: "parent-turn",
                parentToolCallId: "delegation-1",
                sourceSeqEnd: 40,
                sourceSeqStart: 20,
              },
            },
          ]}
          workspaceRootPath={undefined}
        />
      </MemoryRouter>,
    );

    const nestedList = view.container.querySelector(
      '[data-timeline-row-list="nested"]',
    );
    if (!nestedList) throw new Error("Expected delegation child row list");
    const directChildren = Array.from(nestedList.children);
    expect(
      directChildren.map((element) =>
        element.hasAttribute("data-timeline-row-id") ? "summary" : "interval",
      ),
    ).toEqual(["summary", "interval", "summary", "interval", "summary"]);
    expect(
      directChildren
        .filter((element) => element.hasAttribute("data-timeline-row-id"))
        .map((element) => element.getAttribute("data-timeline-row-id")),
    ).toEqual([
      "thread-1:parent-turn:work-summary:retained-1a",
      "thread-1:parent-turn:work-summary:retained-2a",
      "thread-1:parent-turn:work-summary:retained-3a",
    ]);
    expect(directChildren[1]?.textContent).toContain("Cross-turn child one");
    expect(directChildren[3]?.textContent).toContain("Cross-turn child two");
    expect(screen.getAllByText("Cross-turn child one")).toHaveLength(1);
    expect(screen.getAllByText("Cross-turn child two")).toHaveLength(1);
    expect(useDetails).toHaveBeenCalledWith(
      expect.objectContaining({
        detailKind: "delegation-children",
        directTurnSourceSeqEnd: 20,
        directTurnSourceSeqStart: 20,
      }),
    );
    expect(useDetails).toHaveBeenCalledWith(
      expect.objectContaining({
        detailKind: "delegation-children",
        directTurnSourceSeqEnd: 40,
        directTurnSourceSeqStart: 40,
      }),
    );
  });

  it("cancels the prepend anchor when loading earlier work fails", async () => {
    query.data = { pages: [detailResponse("Newest work", 40, true)] };
    query.hasNextPage = true;
    query.fetchNextPage.mockRejectedValue(new Error("network failure"));
    renderPendingSummary();

    fireEvent.click(screen.getByRole("button", { name: "Show earlier work" }));

    await waitFor(() => expect(cancelScrollAnchor).toHaveBeenCalledTimes(1));
  });

  it("rebuilds detail pages when a signed older cursor expires", async () => {
    query.data = { pages: [detailResponse("Newest work", 40, true)] };
    query.hasNextPage = true;
    query.fetchNextPage.mockResolvedValue({
      data: query.data,
      isError: true,
    });
    renderPendingSummary();

    fireEvent.click(screen.getByRole("button", { name: "Show earlier work" }));

    await waitFor(() => expect(cancelScrollAnchor).toHaveBeenCalledTimes(1));
    expect(query.refetch).toHaveBeenCalledTimes(1);
  });

  it("cancels an in-flight prepend anchor when the summary unmounts", async () => {
    query.data = { pages: [detailResponse("Newest work", 40, true)] };
    query.hasNextPage = true;
    let resolveFetch: (result: {
      data: typeof query.data;
      isError: boolean;
    }) => void = () => {};
    query.fetchNextPage.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    );
    const view = renderPendingSummary();

    fireEvent.click(screen.getByRole("button", { name: "Show earlier work" }));
    view.unmount();
    expect(cancelScrollAnchor).toHaveBeenCalledTimes(1);

    resolveFetch({ data: query.data, isError: false });
    await Promise.resolve();
    expect(restoreScrollAnchor).not.toHaveBeenCalled();
  });

  it("shows the loading state and permits retry after an initial failure", () => {
    query.data = { pages: [detailResponse("Newest work", 40, true)] };
    query.hasNextPage = true;
    query.isFetchingNextPage = true;
    renderPendingSummary();
    expect(
      screen
        .getByRole("button", { name: "Loading earlier work…" })
        .hasAttribute("disabled"),
    ).toBe(true);

    cleanup();
    query.data = undefined;
    query.hasNextPage = false;
    query.isError = true;
    query.isFetchingNextPage = false;
    renderPendingSummary();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(query.refetch).toHaveBeenCalledTimes(1);
  });
});

describe("top-level timeline pagination", () => {
  beforeEach(() => {
    captureScrollAnchor.mockReset();
    cancelScrollAnchor.mockReset();
    restoreScrollAnchor.mockReset();
    captureScrollAnchor.mockReturnValue({
      cancel: cancelScrollAnchor,
      restore: restoreScrollAnchor,
    });
  });

  afterEach(() => cleanup());

  it("restores after the requested top-level prepend commits", async () => {
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
      sourceSeqEnd: 20,
      sourceSeqStart: 20,
      text: "Older message",
      threadId: "thread-1",
      turnId: "turn-0",
    });
    let resolveLoad: (appended: boolean) => void = () => {};
    const onLoadOlderRows = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveLoad = resolve;
        }),
    );
    const surface = (
      timelineRows: (typeof newer)[],
      hasOlderTimelineRows = true,
    ) => (
      <MemoryRouter>
        <ThreadTimelineSurface
          activeThinking={null}
          hasOlderTimelineRows={hasOlderTimelineRows}
          isThreadTimelinePending={false}
          onLoadOlderRows={onLoadOlderRows}
          showOngoingIndicator={false}
          timelineError={false}
          timelineRows={timelineRows}
          threadId="thread-1"
          threadRuntimeDisplayStatus="idle"
          workspaceRootPath={undefined}
        />
      </MemoryRouter>
    );
    const view = render(surface([newer]));

    fireEvent.click(
      screen.getByRole("button", { name: "Load older messages" }),
    );
    expect(captureScrollAnchor).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onLoadOlderRows).toHaveBeenCalledTimes(1));

    view.rerender(surface([older, newer], false));
    expect(
      screen.queryByRole("button", { name: "Load older messages" }),
    ).toBeNull();
    expect(restoreScrollAnchor).not.toHaveBeenCalled();
    resolveLoad(true);

    await waitFor(() => expect(restoreScrollAnchor).toHaveBeenCalledTimes(1));
  });

  it("waits for a row commit when the request completes first", async () => {
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
      sourceSeqEnd: 20,
      sourceSeqStart: 20,
      text: "Older message",
      threadId: "thread-1",
      turnId: "turn-0",
    });
    const onLoadOlderRows = vi.fn().mockResolvedValue(true);
    const surface = (timelineRows: (typeof newer)[]) => (
      <MemoryRouter>
        <ThreadTimelineSurface
          activeThinking={null}
          hasOlderTimelineRows
          isThreadTimelinePending={false}
          onLoadOlderRows={onLoadOlderRows}
          paginationSurfaceKey="surface-1"
          showOngoingIndicator={false}
          timelineError={false}
          timelineRows={timelineRows}
          threadId="thread-1"
          threadRuntimeDisplayStatus="idle"
          workspaceRootPath={undefined}
        />
      </MemoryRouter>
    );
    const view = render(surface([newer]));

    fireEvent.click(
      screen.getByRole("button", { name: "Load older messages" }),
    );
    await waitFor(() => expect(onLoadOlderRows).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(restoreScrollAnchor).not.toHaveBeenCalled();

    view.rerender(surface([older, newer]));
    await waitFor(() => expect(restoreScrollAnchor).toHaveBeenCalledTimes(1));
  });

  it("cancels an old request when the pagination surface changes", async () => {
    const newer = conversationRow({
      id: "newer-message",
      role: "assistant",
      sourceSeqEnd: 40,
      sourceSeqStart: 40,
      text: "Newer message",
      threadId: "thread-1",
      turnId: "turn-1",
    });
    let resolveLoad: (appended: boolean) => void = () => {};
    const onLoadOlderRows = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveLoad = resolve;
        }),
    );
    const surface = (paginationSurfaceKey: string) => (
      <MemoryRouter>
        <ThreadTimelineSurface
          activeThinking={null}
          hasOlderTimelineRows
          isThreadTimelinePending={false}
          onLoadOlderRows={onLoadOlderRows}
          paginationSurfaceKey={paginationSurfaceKey}
          showOngoingIndicator={false}
          timelineError={false}
          timelineRows={[newer]}
          threadId="thread-1"
          threadRuntimeDisplayStatus="idle"
          workspaceRootPath={undefined}
        />
      </MemoryRouter>
    );
    const view = render(surface("surface-1"));

    fireEvent.click(
      screen.getByRole("button", { name: "Load older messages" }),
    );
    await waitFor(() => expect(onLoadOlderRows).toHaveBeenCalledTimes(1));
    view.rerender(surface("surface-2"));
    expect(cancelScrollAnchor).toHaveBeenCalledTimes(1);

    resolveLoad(true);
    await Promise.resolve();
    expect(restoreScrollAnchor).not.toHaveBeenCalled();
  });

  it("cancels immediately when the loader reports an empty page", async () => {
    const newer = conversationRow({
      id: "newer-message",
      role: "assistant",
      sourceSeqEnd: 40,
      sourceSeqStart: 40,
      text: "Newer message",
      threadId: "thread-1",
      turnId: "turn-1",
    });
    render(
      <MemoryRouter>
        <ThreadTimelineSurface
          activeThinking={null}
          hasOlderTimelineRows
          isThreadTimelinePending={false}
          onLoadOlderRows={() => false}
          showOngoingIndicator={false}
          timelineError={false}
          timelineRows={[newer]}
          threadId="thread-1"
          threadRuntimeDisplayStatus="idle"
          workspaceRootPath={undefined}
        />
      </MemoryRouter>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Load older messages" }),
    );
    await waitFor(() => expect(cancelScrollAnchor).toHaveBeenCalledTimes(1));
    expect(restoreScrollAnchor).not.toHaveBeenCalled();
  });
});
