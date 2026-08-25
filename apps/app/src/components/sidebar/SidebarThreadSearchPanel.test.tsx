// @vitest-environment jsdom

import { createRef } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ThreadListEntry } from "@bb/domain";
import type {
  ThreadSearchMatch,
  ThreadSearchResponse,
} from "@bb/server-contract";
import {
  useThreadSearch,
  type UseThreadSearchResult,
} from "@/hooks/queries/thread-queries";
import {
  useNewThreadDraftSlots,
  type NewThreadDraftRow,
} from "@/hooks/useNewThreadDraftSlots";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { ProjectListActionButtons } from "./ProjectList";
import {
  SidebarThreadSearchPanel,
  SidebarThreadSearchShowMenu,
} from "./SidebarThreadSearchPanel";
import { splitLayoutAtom } from "@/lib/split-layout/atoms";
import {
  getSidebarThreadSearchOptionId,
  haveSameSidebarThreadSearchNavigationItems,
  isThreadSearchKeyboardEventTarget,
  type SidebarThreadSearchNavigationItem,
  useSidebarThreadSearchLifecycleFilter,
} from "./sidebarThreadSearch";

vi.mock("@/hooks/queries/thread-queries", () => ({
  hasThreadSearchableQuery: (value: string) =>
    value.replace(/\s/g, "").length >= 2,
  useThreadSearch: vi.fn(),
}));
vi.mock("@/hooks/useNewThreadDraftSlots", () => ({
  useNewThreadDraftSlots: vi.fn(),
}));

const mockUseThreadSearch = vi.mocked(useThreadSearch);
const mockUseNewThreadDraftSlots = vi.mocked(useNewThreadDraftSlots);

function createThreadListEntry({
  sectionId = null,
  id,
  title,
}: {
  sectionId?: string | null;
  id: string;
  title: string;
}): ThreadListEntry {
  return {
    activity: {
      activeWorkflowCount: 0,
      activeBackgroundAgentCount: 0,
      activeBackgroundCommandCount: 0,
      activePlanModeCount: 0,
      activeGoalCount: 0,
    },
    archivedAt: null,
    createdAt: 1000,
    deletedAt: null,
    environmentBranchName: null,
    environmentHostId: null,
    environmentId: null,
    environmentName: null,
    environmentWorkspaceDisplayKind: "other",
    hasPendingInteraction: false,
    id,
    lastReadAt: null,
    latestAttentionAt: 1000,
    originKind: null,
    originPluginId: null,
    visibility: "visible",
    parentThreadId: null,
    pinSortKey: null,
    pinnedAt: null,
    projectId: "proj_search",
    providerId: "codex",
    runtime: {
      displayStatus: "idle",
      hostReconnectGraceExpiresAt: null,
    },
    sourceThreadId: null,
    status: "idle",
    title,
    titleFallback: null,
    sectionId,
    updatedAt: 1000,
  };
}

function createSearchResponse(
  thread: ThreadListEntry,
  matches: readonly ThreadSearchMatch[] = [],
): ThreadSearchResponse {
  return {
    active: {
      results: [
        {
          matches: [...matches],
          thread,
        },
      ],
      total: 1,
    },
    archived: {
      results: [],
      total: 0,
    },
  };
}

function mockThreadSearch(result: UseThreadSearchResult): void {
  mockUseThreadSearch.mockReturnValue(result);
}

function createDraftRow({
  id,
  lastEditedAt,
  text,
  title = text,
}: {
  id: string;
  lastEditedAt: number;
  text: string;
  title?: string;
}): NewThreadDraftRow {
  return {
    id,
    lastEditedAt,
    title,
    destination: { projectId: "proj_search", sectionId: null },
    draft: { attachments: [], mentions: [], text },
    delete: vi.fn(),
  };
}

beforeEach(() => {
  mockUseNewThreadDraftSlots.mockReturnValue([]);
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("SidebarThreadSearchPanel", () => {
  it("clears stale search rows while the visible query is debouncing", () => {
    mockThreadSearch({
      data: createSearchResponse(
        createThreadListEntry({
          id: "thr_previous",
          title: "Previous needle",
        }),
      ),
      debouncedQuery: "needle",
      hasSearchableQuery: true,
      isDebouncing: true,
      isError: false,
      isFetching: false,
      isLoading: false,
    });

    render(
      <SidebarThreadSearchPanel
        activeIndex={0}
        isRecentsLoading={false}
        onActiveIndexChange={vi.fn()}
        onNavigationItemsChange={vi.fn()}
        onSelect={vi.fn()}
        projectNamesById={new Map()}
        query="needle updated"
        recentThreads={[]}
      />,
    );

    expect(screen.getByText("Searching threads...")).not.toBeNull();
    expect(screen.queryByRole("option")).toBeNull();
  });

  it("uses a stable option id and scrolls the active search row into view", () => {
    const scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView");
    const thread = createThreadListEntry({
      id: "thr_current",
      title: "Current needle",
    });
    const optionId = getSidebarThreadSearchOptionId("active:thr_current");
    mockThreadSearch({
      data: createSearchResponse(thread),
      debouncedQuery: "needle",
      hasSearchableQuery: true,
      isDebouncing: false,
      isError: false,
      isFetching: false,
      isLoading: false,
    });

    render(
      <SidebarThreadSearchPanel
        activeIndex={0}
        isRecentsLoading={false}
        onActiveIndexChange={vi.fn()}
        onNavigationItemsChange={vi.fn()}
        onSelect={vi.fn()}
        projectNamesById={new Map()}
        query="needle"
        recentThreads={[]}
      />,
    );

    expect(screen.getByRole("option").id).toBe(optionId);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
  });

  it("uses shared runtime precedence for search results", () => {
    const thread = createThreadListEntry({
      id: "thr_plan_goal",
      title: "Concurrent Plan and Goal",
    });
    thread.status = "active";
    thread.runtime = {
      displayStatus: "active",
      hostReconnectGraceExpiresAt: null,
    };
    thread.activity = {
      ...thread.activity,
      activePlanModeCount: 1,
      activeGoalCount: 1,
    };
    mockThreadSearch({
      data: createSearchResponse(thread),
      debouncedQuery: "plan",
      hasSearchableQuery: true,
      isDebouncing: false,
      isError: false,
      isFetching: false,
      isLoading: false,
    });

    render(
      <SidebarThreadSearchPanel
        activeIndex={0}
        isRecentsLoading={false}
        onActiveIndexChange={vi.fn()}
        onNavigationItemsChange={vi.fn()}
        onSelect={vi.fn()}
        projectNamesById={new Map()}
        query="plan"
        recentThreads={[]}
      />,
    );

    expect(screen.getByLabelText("Plan mode active")).not.toBeNull();
    expect(screen.queryByLabelText("Thread working")).toBeNull();
    expect(screen.queryByLabelText("Goal active")).toBeNull();
  });

  it("subscribes search results to working draft state", () => {
    const thread = createThreadListEntry({
      id: "thr_search_draft",
      title: "Working draft",
    });
    thread.activity = { ...thread.activity, activePlanModeCount: 1 };
    window.localStorage.setItem(
      "bb.promptbox.contents-proj_search-thr_search_draft-3",
      JSON.stringify({ text: "Keep editing", attachments: [] }),
    );
    mockThreadSearch({
      data: createSearchResponse(thread),
      debouncedQuery: "draft",
      hasSearchableQuery: true,
      isDebouncing: false,
      isError: false,
      isFetching: false,
      isLoading: false,
    });

    render(
      <SidebarThreadSearchPanel
        activeIndex={0}
        isRecentsLoading={false}
        onActiveIndexChange={vi.fn()}
        onNavigationItemsChange={vi.fn()}
        onSelect={vi.fn()}
        projectNamesById={new Map()}
        query="draft"
        recentThreads={[]}
      />,
    );

    expect(
      screen.getByLabelText("Thread working with unsubmitted draft"),
    ).not.toBeNull();
    expect(screen.queryByLabelText("Plan mode active")).toBeNull();
  });

  it("includes an idle draft in the search result accessible name", () => {
    const thread = createThreadListEntry({
      id: "thr_search_idle_draft",
      title: "Idle draft",
    });
    window.localStorage.setItem(
      "bb.promptbox.contents-proj_search-thr_search_idle_draft-3",
      JSON.stringify({ text: "Keep editing", attachments: [] }),
    );
    mockThreadSearch({
      data: createSearchResponse(thread),
      debouncedQuery: "draft",
      hasSearchableQuery: true,
      isDebouncing: false,
      isError: false,
      isFetching: false,
      isLoading: false,
    });

    render(
      <SidebarThreadSearchPanel
        activeIndex={0}
        isRecentsLoading={false}
        onActiveIndexChange={vi.fn()}
        onNavigationItemsChange={vi.fn()}
        onSelect={vi.fn()}
        projectNamesById={new Map()}
        query="draft"
        recentThreads={[]}
      />,
    );

    expect(
      screen.getByLabelText("Thread has unsubmitted draft"),
    ).not.toBeNull();
    expect(
      screen.getByRole("option", {
        name: /Idle draft.*Thread has unsubmitted draft/,
      }),
    ).not.toBeNull();
  });

  it("shows section metadata instead of project metadata in section mode", () => {
    const thread = createThreadListEntry({
      sectionId: "sec_ci",
      id: "thr_section",
      title: "CI cleanup",
    });
    mockThreadSearch({
      data: createSearchResponse(thread),
      debouncedQuery: "needle",
      hasSearchableQuery: true,
      isDebouncing: false,
      isError: false,
      isFetching: false,
      isLoading: false,
    });

    render(
      <SidebarThreadSearchPanel
        activeIndex={0}
        sectionNamesById={new Map([["sec_ci", "Infra / CI"]])}
        isRecentsLoading={false}
        onActiveIndexChange={vi.fn()}
        onNavigationItemsChange={vi.fn()}
        onSelect={vi.fn()}
        projectNamesById={new Map([["proj_search", "Search project"]])}
        query="needle"
        recentThreads={[]}
        showSectionLabels
      />,
    );

    const rowText = screen.getByRole("option").textContent ?? "";
    expect(rowText).toContain("Infra / CI");
    expect(rowText).not.toContain("Search project");
  });

  it("shows overflow counts for capped archived search results", () => {
    const archivedThread = createThreadListEntry({
      id: "thr_archived",
      title: "Archived cleanup",
    });
    mockThreadSearch({
      data: {
        active: {
          results: [],
          total: 0,
        },
        archived: {
          results: [
            {
              matches: [],
              thread: archivedThread,
            },
          ],
          total: 3,
        },
      },
      debouncedQuery: "cleanup",
      hasSearchableQuery: true,
      isDebouncing: false,
      isError: false,
      isFetching: false,
      isLoading: false,
    });

    render(
      <SidebarThreadSearchPanel
        activeIndex={0}
        isRecentsLoading={false}
        onActiveIndexChange={vi.fn()}
        onNavigationItemsChange={vi.fn()}
        onSelect={vi.fn()}
        projectNamesById={new Map()}
        query="cleanup"
        recentThreads={[]}
      />,
    );

    expect(screen.getByText("Archived threads")).not.toBeNull();
    expect(screen.getByText("3")).not.toBeNull();
  });

  it("renders Threads, Drafts, then Archived threads as one flat navigation sequence", () => {
    const activeThread = createThreadListEntry({
      id: "thr_active",
      title: "Active needle",
    });
    const archivedThread = createThreadListEntry({
      id: "thr_archived",
      title: "Archived needle",
    });
    archivedThread.archivedAt = 2_000;
    mockUseNewThreadDraftSlots.mockReturnValue([
      createDraftRow({
        id: "draft_middle",
        lastEditedAt: 1_500,
        text: "Draft needle",
      }),
    ]);
    mockThreadSearch({
      data: {
        active: {
          results: [{ matches: [], thread: activeThread }],
          total: 1,
        },
        archived: {
          results: [{ matches: [], thread: archivedThread }],
          total: 1,
        },
      },
      debouncedQuery: "needle",
      hasSearchableQuery: true,
      isDebouncing: false,
      isError: false,
      isFetching: false,
      isLoading: false,
    });
    const onNavigationItemsChange = vi.fn();

    render(
      <SidebarThreadSearchPanel
        activeIndex={0}
        isRecentsLoading={false}
        onActiveIndexChange={vi.fn()}
        onNavigationItemsChange={onNavigationItemsChange}
        onSelect={vi.fn()}
        projectNamesById={new Map([["proj_search", "Search project"]])}
        query="needle"
        recentThreads={[]}
      />,
    );

    expect(
      screen.getAllByRole("group").map((group) => group.ariaLabel),
    ).toEqual(["Threads", "Drafts", "Archived threads"]);
    expect(
      screen.getAllByRole("option").map((option) => option.textContent),
    ).toEqual([
      expect.stringContaining("Active needle"),
      expect.stringContaining("Draft needle"),
      expect.stringContaining("Archived needle"),
    ]);
    expect(onNavigationItemsChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ kind: "thread", threadId: "thr_active" }),
      expect.objectContaining({ kind: "draft", draftSlotId: "draft_middle" }),
      expect.objectContaining({ kind: "thread", threadId: "thr_archived" }),
    ]);
  });

  it("shows drafts and recently archived threads before a query exists", () => {
    const activeThread = createThreadListEntry({
      id: "thr_active_recent",
      title: "Active recent",
    });
    const archivedThread = createThreadListEntry({
      id: "thr_archived_recent",
      title: "Archived recent",
    });
    archivedThread.archivedAt = 2_000;
    mockUseNewThreadDraftSlots.mockReturnValue([
      createDraftRow({
        id: "draft_recent",
        lastEditedAt: 3_000,
        text: "Recent draft",
      }),
    ]);
    mockThreadSearch({
      data: undefined,
      debouncedQuery: "",
      hasSearchableQuery: false,
      isDebouncing: false,
      isError: false,
      isFetching: false,
      isLoading: false,
    });

    render(
      <SidebarThreadSearchPanel
        activeIndex={0}
        isRecentsLoading={false}
        onActiveIndexChange={vi.fn()}
        onNavigationItemsChange={vi.fn()}
        onSelect={vi.fn()}
        projectNamesById={new Map()}
        query=""
        recentArchivedThreads={[archivedThread]}
        recentThreads={[activeThread]}
      />,
    );

    expect(
      screen.getAllByRole("group").map((group) => group.ariaLabel),
    ).toEqual(["Threads", "Drafts", "Archived threads"]);
  });
});

describe("SidebarThreadSearchShowMenu", () => {
  it("keeps all counts visible while independently narrowing result groups", async () => {
    const activeThread = createThreadListEntry({
      id: "thr_active_filter",
      title: "Active filter",
    });
    const archivedThread = createThreadListEntry({
      id: "thr_archived_filter",
      title: "Archived filter",
    });
    mockUseNewThreadDraftSlots.mockReturnValue([
      createDraftRow({
        id: "draft_filter",
        lastEditedAt: 3_000,
        text: "Draft filter",
      }),
    ]);
    mockThreadSearch({
      data: {
        active: {
          results: [{ matches: [], thread: activeThread }],
          total: 4,
        },
        archived: {
          results: [{ matches: [], thread: archivedThread }],
          total: 7,
        },
      },
      debouncedQuery: "filter",
      hasSearchableQuery: true,
      isDebouncing: false,
      isError: false,
      isFetching: false,
      isLoading: false,
    });

    function Harness() {
      const lifecycleFilter = useSidebarThreadSearchLifecycleFilter();
      return (
        <TooltipProvider>
          <SidebarThreadSearchShowMenu lifecycleFilter={lifecycleFilter} />
          <SidebarThreadSearchPanel
            activeIndex={0}
            isRecentsLoading={false}
            lifecycleFilter={lifecycleFilter}
            onActiveIndexChange={vi.fn()}
            onNavigationItemsChange={vi.fn()}
            onSelect={vi.fn()}
            projectNamesById={new Map()}
            query="filter"
            recentThreads={[]}
          />
        </TooltipProvider>
      );
    }

    render(<Harness />);
    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Search show options" }),
      { button: 0 },
    );
    const showGroup = await screen.findByRole("group", {
      name: "Show search results",
    });
    expect(within(showGroup).getByText("4")).not.toBeNull();
    expect(within(showGroup).getByText("1")).not.toBeNull();
    expect(within(showGroup).getByText("7")).not.toBeNull();

    fireEvent.click(
      within(showGroup).getByRole("menuitemcheckbox", {
        name: /Archived threads/,
      }),
    );

    expect(
      screen.getByRole("button", {
        name: "Search show options (filtered)",
      }),
    ).not.toBeNull();
    expect(
      screen.queryByRole("group", { name: "Archived threads" }),
    ).toBeNull();

    fireEvent.pointerDown(
      screen.getByRole("button", {
        name: "Search show options (filtered)",
      }),
      { button: 0 },
    );
    const reopenedGroup = await screen.findByRole("group", {
      name: "Show search results",
    });
    expect(within(reopenedGroup).getByText("7")).not.toBeNull();
    expect(
      within(reopenedGroup)
        .getByRole("menuitemcheckbox", { name: /Archived threads/ })
        .getAttribute("data-state"),
    ).toBe("unchecked");
  });
});

describe("sidebar thread search navigation items", () => {
  it("treats rows with different message matches as different items", () => {
    const optionId = getSidebarThreadSearchOptionId("active:thr_search");
    const baseItem: SidebarThreadSearchNavigationItem = {
      kind: "thread",
      id: "active:thr_search",
      optionId,
      projectId: "proj_search",
      threadId: "thr_search",
      messageSeq: 3,
    };

    expect(
      haveSameSidebarThreadSearchNavigationItems(
        [baseItem],
        [
          {
            ...baseItem,
            messageSeq: 7,
          },
        ],
      ),
    ).toBe(false);
  });
});

describe("ProjectListActionButtons", () => {
  it("shows the compose pane position when New thread is open in a split", () => {
    const store = createStore();
    store.set(splitLayoutAtom, {
      focusedPaneId: "pane-thread",
      root: {
        type: "split",
        dir: "row",
        sizes: [0.5, 0.5],
        children: [
          {
            type: "pane",
            paneId: "pane-compose",
            content: { kind: "new-thread", draftSlotId: "draft-compose" },
          },
          {
            type: "pane",
            paneId: "pane-thread",
            content: {
              kind: "thread",
              projectId: "proj_test",
              threadId: "thr_test",
            },
          },
        ],
      },
    });

    render(
      <Provider store={store}>
        <ProjectListActionButtons
          splitEnabled
          onNewChat={vi.fn()}
          newThreadSplit={{ openInSplit: vi.fn() }}
        />
      </Provider>,
    );

    const splitMap = screen.getByRole("img", {
      name: "New thread — open in split",
    });
    const label = screen.getByText("New thread");
    expect(label.nextElementSibling).toBe(splitMap);
  });

  it("exposes the active search option on the combobox input", () => {
    const inputRef = createRef<HTMLInputElement>();

    render(
      <ProjectListActionButtons
        onNewChat={vi.fn()}
        threadSearch={{
          activeDescendantId: "active-option",
          inputRef,
          isActive: true,
          onActivate: vi.fn(),
          onClose: vi.fn(),
          onQueryChange: vi.fn(),
          query: "needle",
        }}
      />,
    );

    expect(
      screen.getByRole("combobox").getAttribute("aria-activedescendant"),
    ).toBe("active-option");
  });

  it("labels the search close button as a close-and-clear action when a query exists", () => {
    const inputRef = createRef<HTMLInputElement>();

    render(
      <ProjectListActionButtons
        onNewChat={vi.fn()}
        threadSearch={{
          activeDescendantId: undefined,
          inputRef,
          isActive: true,
          onActivate: vi.fn(),
          onClose: vi.fn(),
          onQueryChange: vi.fn(),
          query: "needle",
        }}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Clear and close search" }),
    ).not.toBeNull();
  });
});

describe("AppSidebar thread search keyboard routing", () => {
  it("handles search keys only from the input or search options", () => {
    const input = document.createElement("input");
    const closeButton = document.createElement("button");
    const option = document.createElement("button");
    const optionLabel = document.createElement("span");
    option.setAttribute("role", "option");
    option.append(optionLabel);

    expect(isThreadSearchKeyboardEventTarget(input, input)).toBe(true);
    expect(isThreadSearchKeyboardEventTarget(option, input)).toBe(true);
    expect(isThreadSearchKeyboardEventTarget(optionLabel, input)).toBe(true);
    expect(isThreadSearchKeyboardEventTarget(closeButton, input)).toBe(false);
  });
});
