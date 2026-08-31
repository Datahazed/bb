// @vitest-environment jsdom

import type { ThreadListEntry } from "@bb/domain";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { createStore, Provider } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SidebarContent } from "@/components/ui/sidebar.js";
import {
  SidebarArchivedThreadGroup,
  SidebarDraftRows,
  type SidebarDraftRowItem,
} from "./SidebarLifecycleRows";
import { splitLayoutAtom } from "@/lib/split-layout/atoms";
import { listPanes } from "@/lib/split-layout";

const threadActions = vi.hoisted(() => ({
  archiveThreadAndChildren: vi.fn(),
  requestDelete: vi.fn(),
  requestRename: vi.fn(),
  togglePin: vi.fn(),
  toggleRead: vi.fn(),
  unarchiveThread: vi.fn(),
}));

vi.mock("@/components/thread/ThreadActionsProvider", () => ({
  useThreadActions: () => ({
    ...threadActions,
    renameThread: vi.fn(),
  }),
}));

function createThread(
  id: string,
  title: string,
  overrides: Partial<ThreadListEntry> = {},
): ThreadListEntry {
  return {
    id,
    projectId: "proj_test",
    environmentId: null,
    providerId: "codex",
    title,
    titleFallback: title,
    sectionId: null,
    status: "idle",
    parentThreadId: null,
    sourceThreadId: null,
    originKind: null,
    originPluginId: null,
    visibility: "visible",
    archivedAt: 100,
    pinnedAt: null,
    pinSortKey: null,
    deletedAt: null,
    lastReadAt: 100,
    latestAttentionAt: 100,
    createdAt: 0,
    updatedAt: 100,
    activity: {
      activeWorkflowCount: 0,
      activeBackgroundAgentCount: 0,
      activeBackgroundCommandCount: 0,
      activePlanModeCount: 0,
      activeGoalCount: 0,
    },
    hasPendingInteraction: false,
    environmentHostId: null,
    environmentName: null,
    environmentBranchName: null,
    environmentWorkspaceDisplayKind: "other",
    runtime: { displayStatus: "idle", hostReconnectGraceExpiresAt: null },
    ...overrides,
  };
}

function renderLifecycleRows(
  children: ReactNode,
  {
    compact = false,
    store = createStore(),
  }: { compact?: boolean; store?: ReturnType<typeof createStore> } = {},
) {
  const root = document.createElement("div");
  root.id = "root";
  document.body.appendChild(root);
  return render(
    <Provider store={store}>
      <CompactViewportOverrideProvider isCompactViewport={compact}>
        <TooltipProvider>
          <MemoryRouter>{children}</MemoryRouter>
        </TooltipProvider>
      </CompactViewportOverrideProvider>
    </Provider>,
    { container: root },
  );
}

afterEach(() => {
  cleanup();
  document.getElementById("root")?.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  for (const action of Object.values(threadActions)) {
    action.mockReset();
  }
});

describe("SidebarDraftRows", () => {
  function createDrafts(): SidebarDraftRowItem[] {
    return [
      { id: "newest", title: "Newest draft", delete: vi.fn() },
      { id: "older", title: "Older draft", delete: vi.fn() },
    ];
  }

  it("keeps the input's newest-first order and opens the selected slot", () => {
    const drafts = createDrafts();
    const onOpenDraft = vi.fn();
    const { container } = renderLifecycleRows(
      <SidebarDraftRows drafts={drafts} onOpenDraft={onOpenDraft} />,
    );

    const rows = [
      ...container.querySelectorAll<HTMLElement>("[data-sidebar-draft-id]"),
    ];
    expect(rows.map((row) => row.dataset.sidebarDraftId)).toEqual([
      "newest",
      "older",
    ]);
    expect(container.querySelector('[data-icon="EditFile"]')).toBeNull();
    expect(
      container.querySelectorAll("[data-sidebar-draft-state]"),
    ).toHaveLength(2);
    expect(screen.getAllByText("Draft")).toHaveLength(2);

    fireEvent.click(
      screen.getByRole("button", { name: "Open draft Older draft" }),
    );
    expect(onOpenDraft).toHaveBeenCalledWith("older");
  });

  it("offers Delete draft and Open in split, but no Archive, from both menus", () => {
    const drafts = createDrafts();
    const { container } = renderLifecycleRows(
      <SidebarDraftRows drafts={drafts} onOpenDraft={vi.fn()} />,
    );

    fireEvent.pointerDown(
      screen.getAllByRole("button", { name: "Draft actions" })[0],
    );
    const overflowDelete = screen.getByRole("menuitem", {
      name: "Delete draft",
    });
    expect(
      screen.getByRole("menuitem", { name: "Open in split" }),
    ).not.toBeNull();
    expect(screen.queryByRole("menuitem", { name: /archive/iu })).toBeNull();
    fireEvent.click(overflowDelete);
    expect(drafts[0]?.delete).toHaveBeenCalledTimes(1);

    const olderRow = container.querySelector<HTMLElement>(
      '[data-sidebar-draft-id="older"]',
    );
    expect(olderRow).not.toBeNull();
    fireEvent.contextMenu(olderRow!);
    const contextMenu = screen.getByRole("menu", { name: "Draft actions" });
    expect(
      within(contextMenu).getByRole("menuitem", { name: "Delete draft" }),
    ).not.toBeNull();
    expect(
      within(contextMenu).getByRole("menuitem", { name: "Open in split" }),
    ).not.toBeNull();
    expect(within(contextMenu).queryByText(/archive/iu)).toBeNull();
  });

  it("opens the selected draft slot in a split and omits the item when unavailable", () => {
    const store = createStore();
    store.set(splitLayoutAtom, {
      focusedPaneId: "pane-thread",
      root: {
        type: "pane",
        paneId: "pane-thread",
        content: {
          kind: "thread",
          projectId: "proj_test",
          threadId: "thr_test",
        },
      },
    });
    const drafts = createDrafts();
    const wide = renderLifecycleRows(
      <SidebarDraftRows drafts={drafts} onOpenDraft={vi.fn()} />,
      { store },
    );

    fireEvent.pointerDown(
      screen.getAllByRole("button", { name: "Draft actions" })[0],
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Open in split" }));

    const panes = listPanes(store.get(splitLayoutAtom)!.root);
    expect(panes).toHaveLength(2);
    expect(panes[1]?.content).toEqual({
      kind: "new-thread",
      draftSlotId: "newest",
    });

    wide.unmount();
    renderLifecycleRows(
      <SidebarDraftRows drafts={drafts} onOpenDraft={vi.fn()} />,
      { compact: true },
    );
    fireEvent.pointerDown(
      screen.getAllByRole("button", { name: "Draft actions" })[0],
    );
    expect(
      screen.queryByRole("menuitem", { name: "Open in split" }),
    ).toBeNull();
  });

  it("uses the persistent compact drawer for a touch long-press", () => {
    vi.useFakeTimers();
    const drafts = createDrafts();
    const { container } = renderLifecycleRows(
      <SidebarDraftRows drafts={drafts} onOpenDraft={vi.fn()} />,
      { compact: true },
    );
    const row = container.querySelector<HTMLElement>(
      '[data-sidebar-draft-id="newest"]',
    );
    expect(row).not.toBeNull();

    fireEvent.pointerDown(row!, {
      pointerId: 1,
      pointerType: "touch",
      isPrimary: true,
      clientX: 100,
      clientY: 100,
    });
    act(() => {
      vi.advanceTimersByTime(700);
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(
      screen.getByRole("menuitem", { name: "Delete draft" }),
    ).not.toBeNull();
    expect(document.querySelector("#root")?.hasAttribute("inert")).toBe(false);
    expect(document.querySelector("#root")?.getAttribute("aria-hidden")).toBe(
      null,
    );
  });
});

describe("SidebarArchivedThreadGroup", () => {
  const archivedThreads = [
    createThread("first", "First archived"),
    createThread("second", "Second archived"),
    createThread("third", "Third archived"),
  ];

  it("renders one labeled group in archive-query order and opens a thread", () => {
    const onNavigate = vi.fn();
    const { container } = renderLifecycleRows(
      <SidebarArchivedThreadGroup
        threads={archivedThreads}
        hasNextPage={false}
        isFetchingNextPage={false}
        onLoadMore={vi.fn()}
        onNavigate={onNavigate}
      />,
    );

    expect(screen.getByTitle("Archived")).not.toBeNull();
    const rows = [
      ...container.querySelectorAll<HTMLElement>(
        "[data-sidebar-archived-thread-id]",
      ),
    ];
    expect(rows.map((row) => row.dataset.sidebarArchivedThreadId)).toEqual([
      "first",
      "second",
      "third",
    ]);
    expect(container.querySelector('[data-icon="Archive"]')).toBeNull();
    expect(
      container.querySelectorAll("[data-sidebar-archived-state]"),
    ).toHaveLength(3);
    const secondLink = screen.getByRole("link", {
      name: "Open archived thread Second archived",
    });
    expect(secondLink.getAttribute("href")).toBe(
      "/projects/proj_test/threads/second",
    );
    fireEvent.click(secondLink);
    expect(onNavigate).toHaveBeenCalledOnce();
  });

  it("replaces the right-edge state with quick Unarchive and keeps it in both menus", () => {
    const { container } = renderLifecycleRows(
      <SidebarArchivedThreadGroup
        threads={[archivedThreads[0]!]}
        hasNextPage={false}
        isFetchingNextPage={false}
        onLoadMore={vi.fn()}
      />,
    );

    const archivedState = container.querySelector<HTMLElement>(
      "[data-sidebar-archived-state]",
    );
    expect(archivedState?.textContent).toBe("Archived");
    expect(archivedState?.className).toContain(
      "group-focus-within/archived-thread-row:opacity-0",
    );
    fireEvent.click(screen.getByRole("button", { name: "Unarchive thread" }));
    expect(threadActions.unarchiveThread).toHaveBeenCalledWith(
      archivedThreads[0],
    );
    threadActions.unarchiveThread.mockClear();

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Thread actions" }),
    );
    expect(screen.getByRole("menuitem", { name: "Unarchive" })).not.toBeNull();
    expect(
      screen.queryByRole("menuitem", { name: "Open in split" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: "Unarchive" }));
    expect(threadActions.unarchiveThread).toHaveBeenCalledWith(
      archivedThreads[0],
    );

    const row = container.querySelector<HTMLElement>(
      '[data-sidebar-archived-thread-id="first"]',
    );
    expect(row).not.toBeNull();
    fireEvent.contextMenu(row!);
    const contextMenu = screen.getByRole("menu", { name: "Thread actions" });
    expect(
      within(contextMenu).getByRole("menuitem", { name: "Unarchive" }),
    ).not.toBeNull();
    expect(
      within(contextMenu).queryByRole("menuitem", { name: "Open in split" }),
    ).toBeNull();
  });

  it("windows archived rows through SidebarWindowedItems", () => {
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    vi.spyOn(Element.prototype, "clientHeight", "get").mockReturnValue(500);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        if (this.hasAttribute("data-sidebar-windowed-item")) {
          return new DOMRect(0, 1_000, 300, 30);
        }
        return new DOMRect(0, 0, 300, 500);
      },
    );

    const { container } = renderLifecycleRows(
      <SidebarContent>
        <SidebarArchivedThreadGroup
          threads={archivedThreads}
          hasNextPage={false}
          isFetchingNextPage={false}
          onLoadMore={vi.fn()}
        />
      </SidebarContent>,
    );

    expect(
      container.querySelectorAll("[data-sidebar-windowed-item]"),
    ).toHaveLength(3);
    expect(
      container.querySelectorAll("[data-sidebar-windowed-nav]"),
    ).toHaveLength(3);
    expect(
      container.querySelector("[data-sidebar-archived-thread-id]"),
    ).toBeNull();
  });

  it("exposes click and scroll loading through one accessible sentinel", () => {
    const observers: Array<{
      callback: IntersectionObserverCallback;
      observed: Element[];
    }> = [];
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        private readonly record: (typeof observers)[number];

        constructor(callback: IntersectionObserverCallback) {
          this.record = { callback, observed: [] };
          observers.push(this.record);
        }

        observe(target: Element) {
          this.record.observed.push(target);
        }

        unobserve() {}
        disconnect() {}
      },
    );
    const onLoadMore = vi.fn();
    renderLifecycleRows(
      <SidebarArchivedThreadGroup
        threads={archivedThreads}
        hasNextPage
        isFetchingNextPage={false}
        onLoadMore={onLoadMore}
      />,
    );
    const loadMore = screen.getByRole("button", {
      name: "Load more archived threads",
    });

    fireEvent.click(loadMore);
    expect(onLoadMore).toHaveBeenCalledTimes(1);

    const sentinelObserver = observers.find((observer) =>
      observer.observed.includes(loadMore),
    );
    expect(sentinelObserver).toBeDefined();
    act(() => {
      sentinelObserver?.callback(
        [
          {
            boundingClientRect: new DOMRect(),
            intersectionRatio: 1,
            intersectionRect: new DOMRect(),
            isIntersecting: true,
            rootBounds: null,
            target: loadMore,
            time: 0,
          },
        ],
        {} as IntersectionObserver,
      );
    });
    expect(onLoadMore).toHaveBeenCalledTimes(2);
  });
});
