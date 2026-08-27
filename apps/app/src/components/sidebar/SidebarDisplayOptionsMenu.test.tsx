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
import { SidebarDisplayOptionsMenu } from "./ProjectList";
import { sidebarThreadLifecycleSelectionAtom } from "./sidebarThreadLifecycle";

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
    ).toEqual(["Organize", "Sort by", "Show"]);
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
