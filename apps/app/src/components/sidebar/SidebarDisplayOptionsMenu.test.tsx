// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { sdk } from "@/lib/sdk";
import {
  ProjectListActionButtons,
  SidebarDisplayOptionsMenu,
} from "./ProjectList";
import {
  hiddenSidebarTopLevelSectionIdsAtom,
  sidebarTopLevelSectionOrderAtom,
} from "./sidebarTopLevelSectionPreferences";
import { sidebarThreadLifecycleSelectionAtom } from "./sidebarThreadLifecycle";
import {
  sidebarExtensionsVisibleAtom,
  sidebarNewThreadVisibleAtom,
} from "./sidebarTopRegionItemPreferences";

vi.mock("@/lib/sdk", () => ({
  sdk: {
    threads: {
      count: vi.fn(),
    },
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderMenu({
  activeCount = 3,
  draftCount = 2,
}: {
  activeCount?: number;
  draftCount?: number;
} = {}) {
  const store = createStore();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  store.set(sidebarTopLevelSectionOrderAtom, [
    "new-thread-extensions",
    "plugin-pages",
    "thread-list",
  ]);
  store.set(hiddenSidebarTopLevelSectionIdsAtom, []);
  store.set(sidebarNewThreadVisibleAtom, true);
  store.set(sidebarExtensionsVisibleAtom, true);
  render(
    <QueryClientProvider client={queryClient}>
      <Provider store={store}>
        <TooltipProvider>
          <SidebarDisplayOptionsMenu
            activeCount={activeCount}
            draftCount={draftCount}
          />
        </TooltipProvider>
      </Provider>
    </QueryClientProvider>,
  );
  return store;
}

function openMenu() {
  fireEvent.pointerDown(
    screen.getByRole("button", { name: /^Sidebar display options/ }),
    { button: 0 },
  );
}

function openSectionSubmenu(name: string) {
  const group = screen.getByRole("group", { name: "Sidebar sections" });
  const trigger = within(group).getByRole("menuitem", { name });
  fireEvent.click(trigger);
}

function getShowItem(name: string) {
  return within(screen.getByRole("group", { name: "Show" })).getByRole(
    "menuitemcheckbox",
    { name: new RegExp(`^${name}`) },
  );
}

describe("SidebarDisplayOptionsMenu lifecycle filter", () => {
  it("renders Show below Organize and Sort by with disjoint state counts", async () => {
    vi.mocked(sdk.threads.count).mockResolvedValue({ count: 17 });
    renderMenu({ activeCount: 8, draftCount: 4 });
    openMenu();

    await screen.findByRole("group", { name: "Show" });
    expect(
      screen
        .getAllByRole("group")
        .map((group) => group.getAttribute("aria-label"))
        .filter(Boolean),
    ).toEqual([
      "Organize",
      "Sort by",
      "Show",
      "Sidebar sections",
      "Sidebar items",
    ]);
    expect(getShowItem("Active").textContent).toContain("8");
    expect(getShowItem("Drafts").textContent).toContain("4");
    expect(getShowItem("Archived").textContent).toContain("17");
    expect(
      document.querySelector("[data-sidebar-display-filter-dot]"),
    ).toBeNull();
  });

  it("builds unions, keeps one state selected, and marks an off-default filter", async () => {
    vi.mocked(sdk.threads.count).mockResolvedValue({ count: 0 });
    const store = renderMenu();
    openMenu();
    await screen.findByRole("group", { name: "Show" });

    fireEvent.click(getShowItem("Drafts"));
    openMenu();
    fireEvent.click(getShowItem("Active"));
    expect([...store.get(sidebarThreadLifecycleSelectionAtom)]).toEqual([
      "drafts",
    ]);
    openMenu();
    fireEvent.click(getShowItem("Drafts"));
    expect([...store.get(sidebarThreadLifecycleSelectionAtom)]).toEqual([
      "drafts",
    ]);
    expect(
      screen.getByRole("button", {
        name: "Sidebar display options (filtered)",
      }),
    ).toBeDefined();
    expect(
      document.querySelector("[data-sidebar-display-filter-dot]"),
    ).not.toBeNull();
  });

  it("refetches Archived on every open and freezes each open snapshot", async () => {
    let resolveFirst: ((value: { count: number }) => void) | undefined;
    const first = new Promise<{ count: number }>((resolve) => {
      resolveFirst = resolve;
    });
    vi.mocked(sdk.threads.count)
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce({ count: 9 });
    renderMenu();
    openMenu();
    await screen.findByRole("group", { name: "Show" });
    expect(getShowItem("Archived").textContent).toContain("—");

    resolveFirst?.({ count: 7 });
    expect(await screen.findByText("7")).toBeDefined();
    fireEvent.keyDown(document, { key: "Escape" });
    openMenu();
    expect(getShowItem("Archived").textContent).toContain("—");
    expect(await screen.findByText("9")).toBeDefined();
    expect(sdk.threads.count).toHaveBeenCalledTimes(2);
  });
});

describe("SidebarDisplayOptionsMenu fixed sidebar items", () => {
  it("renders the item toggles last, defaults both on, and keeps the menu open while toggling", async () => {
    const store = renderMenu();
    openMenu();

    await screen.findByRole("group", { name: "Sidebar items" });
    expect(
      screen
        .getAllByRole("group")
        .map((group) => group.getAttribute("aria-label"))
        .filter(Boolean),
    ).toEqual([
      "Organize",
      "Sort by",
      "Show",
      "Sidebar sections",
      "Sidebar items",
    ]);

    const group = screen.getByRole("group", { name: "Sidebar items" });
    const newThread = within(group).getByRole("menuitemcheckbox", {
      name: "New thread",
    });
    const extensions = within(group).getByRole("menuitemcheckbox", {
      name: "Extensions",
    });
    expect(newThread.getAttribute("data-state")).toBe("checked");
    expect(extensions.getAttribute("data-state")).toBe("checked");

    fireEvent.click(extensions);
    expect(store.get(sidebarExtensionsVisibleAtom)).toBe(false);
    expect(store.get(sidebarNewThreadVisibleAtom)).toBe(true);
    expect(screen.getByRole("group", { name: "Sidebar items" })).toBeDefined();
  });

  it("removes the New thread row and its Split action together", () => {
    render(
      <ProjectListActionButtons
        onNewChat={vi.fn()}
        onSplit={vi.fn()}
        showNewThread={false}
      />,
    );

    expect(screen.queryByRole("button", { name: /^New thread/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Split" })).toBeNull();
  });
});

describe("SidebarDisplayOptionsMenu top-level sections", () => {
  it("lists all sections in order and never offers a Thread list hide control", async () => {
    renderMenu();
    openMenu();

    const group = await screen.findByRole("group", {
      name: "Sidebar sections",
    });
    expect(
      within(group)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual(["New thread / Extensions", "Plugin pages", "Thread list"]);

    openSectionSubmenu("Thread list");
    expect(
      screen.queryByRole("menuitemcheckbox", { name: "Show section" }),
    ).toBeNull();
    expect(screen.getByRole("menuitem", { name: "Move up" })).toBeDefined();
  });

  it("hides and restores the first section from Display options", async () => {
    const store = renderMenu();
    openMenu();
    await screen.findByRole("group", { name: "Sidebar sections" });
    openSectionSubmenu("New thread / Extensions");

    const showSection = await screen.findByRole("menuitemcheckbox", {
      name: "Show section",
    });
    expect(showSection.getAttribute("data-state")).toBe("checked");
    fireEvent.click(showSection);
    expect(store.get(hiddenSidebarTopLevelSectionIdsAtom)).toEqual([
      "new-thread-extensions",
    ]);

    openMenu();
    await screen.findByRole("group", { name: "Sidebar sections" });
    openSectionSubmenu("New thread / Extensions");
    const restoreSection = await screen.findByRole("menuitemcheckbox", {
      name: "Show section",
    });
    expect(restoreSection.getAttribute("data-state")).toBe("unchecked");
    fireEvent.click(restoreSection);
    expect(store.get(hiddenSidebarTopLevelSectionIdsAtom)).toEqual([]);
  });

  it("reorders the Thread list from the same menu", async () => {
    const store = renderMenu();
    openMenu();
    await screen.findByRole("group", { name: "Sidebar sections" });
    openSectionSubmenu("Thread list");
    fireEvent.click(await screen.findByRole("menuitem", { name: "Move up" }));

    expect(store.get(sidebarTopLevelSectionOrderAtom)).toEqual([
      "new-thread-extensions",
      "thread-list",
      "plugin-pages",
    ]);
  });
});
