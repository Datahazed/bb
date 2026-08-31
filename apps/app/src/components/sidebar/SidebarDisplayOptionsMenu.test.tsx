// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, describe, expect, it } from "vitest";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import {
  SidebarFilterSortMenu,
  getSidebarThreadListLabel,
  SidebarOrganizeMenu,
  SidebarThreadListToolbar,
} from "./ProjectList";
import {
  sidebarChronologicalSortAtom,
  sidebarOrganizationModeAtom,
  sidebarSortDirectionAtom,
} from "./sidebarCollapsedAtoms";
import { sidebarThreadLifecycleSelectionAtom } from "./sidebarThreadLifecycle";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

function renderMenus() {
  const store = createStore();
  render(
    <Provider store={store}>
      <TooltipProvider>
        <SidebarOrganizeMenu />
        <SidebarFilterSortMenu />
      </TooltipProvider>
    </Provider>,
  );
  return store;
}

function openMenu(name: RegExp) {
  fireEvent.pointerDown(screen.getByRole("button", { name }), { button: 0 });
}

describe("sidebar thread-list menus", () => {
  it("renders the divider separately above the labeled control row", () => {
    const { container } = render(
      <TooltipProvider>
        <SidebarThreadListToolbar
          label="Projects"
          isCreatingSection={false}
          isCreatingProject={false}
          onNewThread={() => {}}
        />
      </TooltipProvider>,
    );

    const toolbar = container.querySelector(
      "[data-sidebar-thread-list-toolbar]",
    );
    const divider = container.querySelector(
      "[data-sidebar-thread-list-divider]",
    );
    expect(toolbar).toHaveClass("items-center");
    expect(divider).toHaveAttribute("aria-hidden", "true");
    expect(divider).toHaveClass("w-full", "bg-sidebar-border");
    expect(divider?.nextElementSibling).toBe(toolbar);
    expect(screen.getByText("Projects")).toBeVisible();
    expect(screen.getByRole("button", { name: /^Organize:/ })).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Filter and sort" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "New thread" })).toBeVisible();
  });

  it.each([
    {
      expected: "Machines",
      hasProjects: false,
      hasSections: false,
      mode: "machine",
    },
    {
      expected: "Projects",
      hasProjects: true,
      hasSections: false,
      mode: "project",
    },
    {
      expected: "Threads",
      hasProjects: false,
      hasSections: false,
      mode: "project",
    },
    {
      expected: "Sections",
      hasProjects: false,
      hasSections: true,
      mode: "manual",
    },
    {
      expected: "Threads",
      hasProjects: false,
      hasSections: false,
      mode: "manual",
    },
  ] as const)(
    "uses $expected for $mode mode with projects=$hasProjects and sections=$hasSections",
    ({ expected, hasProjects, hasSections, mode }) => {
      expect(
        getSidebarThreadListLabel({ hasProjects, hasSections, mode }),
      ).toBe(expected);
    },
  );

  it("separates organization from filtering and uses the approved labels", async () => {
    const store = renderMenus();
    openMenu(/^Organize:/);

    const group = await screen.findByRole("group", { name: "Organize" });
    const organizationItems = within(group).getAllByRole("menuitemcheckbox");
    expect(organizationItems.map((item) => item.textContent)).toEqual([
      "By project",
      "By machine",
      "Custom",
    ]);
    expect(
      organizationItems.map((item) =>
        item
          .querySelector(":scope > [data-icon]")
          ?.getAttribute("data-icon"),
      ),
    ).toEqual(["Folder", "Laptop", "Section"]);
    expect(screen.getByRole("menu")).toHaveClass(
      "p-2",
      "[&_[role=menuitemcheckbox]]:!py-1.5",
    );
    for (const item of organizationItems) {
      expect(item).toHaveClass("gap-2");
    }

    fireEvent.click(
      within(group).getByRole("menuitemcheckbox", { name: "Custom" }),
    );
    expect(store.get(sidebarOrganizationModeAtom)).toBe("manual");
    expect(screen.getByRole("group", { name: "Organize" })).not.toBeNull();
  });

  it("orders status above sort, keeps changes open, and toggles sort direction", async () => {
    const store = renderMenus();
    openMenu(/^Filter and sort$/);

    await screen.findByRole("group", { name: "Thread status" });
    expect(
      screen
        .getAllByRole("group")
        .map((group) => group.getAttribute("aria-label"))
        .filter(Boolean),
    ).toEqual(["Thread status", "Sort by"]);
    const statusItems = within(
      screen.getByRole("group", { name: "Thread status" }),
    ).getAllByRole("menuitemcheckbox");
    expect(statusItems.map((item) => item.textContent)).toEqual([
      "Active",
      "Archived",
      "Drafts",
    ]);
    expect(
      statusItems.map((item) =>
        item
          .querySelector(":scope > [data-icon]")
          ?.getAttribute("data-icon"),
      ),
    ).toEqual(["Circle", "Archive", "Edit"]);
    expect(screen.getByRole("menu")).toHaveClass(
      "p-2",
      "[&_[role=menuitemcheckbox]]:!py-1.5",
    );
    for (const item of statusItems) {
      expect(item).toHaveClass("gap-2");
    }

    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Drafts" }));
    expect([...store.get(sidebarThreadLifecycleSelectionAtom)]).toEqual([
      "active",
      "drafts",
    ]);
    expect(screen.getByRole("group", { name: "Sort by" })).not.toBeNull();

    const updated = screen.getByRole("menuitemradio", { name: "Updated at" });
    const sortItems = within(
      screen.getByRole("group", { name: "Sort by" }),
    ).getAllByRole("menuitemradio");
    expect(
      sortItems.map((item) =>
        item
          .querySelector(":scope > span > [data-icon]")
          ?.getAttribute("data-icon"),
      ),
    ).toEqual(["Clock", "Calendar", "Alphabetical"]);
    expect(updated.querySelector('[data-icon="ArrowDown"]')).not.toBeNull();
    fireEvent.click(updated);
    expect(
      screen
        .getByRole("menuitemradio", { name: "Updated at" })
        .querySelector('[data-icon="ArrowUp"]'),
    ).not.toBeNull();
    expect(store.get(sidebarSortDirectionAtom)).toBe("asc");
    expect(screen.getByRole("group", { name: "Sort by" })).not.toBeNull();

    cleanup();
    const restoredStore = renderMenus();
    expect(restoredStore.get(sidebarSortDirectionAtom)).toBe("asc");
  });

  it("uses the stronger filter variant for every off-default status state", () => {
    const store = renderMenus();
    const defaultTrigger = screen.getByRole("button", {
      name: "Filter and sort",
    });
    expect(defaultTrigger.querySelector('[data-icon="Filter"]')).not.toBeNull();
    expect(defaultTrigger.querySelector('[data-icon="FilterEdit"]')).toBeNull();

    act(() =>
      store.set(
        sidebarThreadLifecycleSelectionAtom,
        new Set(["active", "drafts"]),
      ),
    );
    const additionalStatusTrigger = screen.getByRole("button", {
      name: "Filter and sort (filtered)",
    });
    expect(
      additionalStatusTrigger.querySelector('[data-icon="FilterEdit"]'),
    ).not.toBeNull();
    const filterEditPaths = additionalStatusTrigger.querySelectorAll(
      '[data-icon="FilterEdit"] path',
    );
    expect(filterEditPaths[0]?.getAttribute("stroke")).toBe("currentColor");
    expect(filterEditPaths[0]?.getAttribute("fill")).toBeNull();
    expect(filterEditPaths[1]?.getAttribute("stroke")).toBe("var(--primary)");
    expect(filterEditPaths[1]?.getAttribute("fill")).toBe("var(--primary)");
    expect(filterEditPaths[1]?.getAttribute("transform")).toBe(
      "translate(-1 0)",
    );

    act(() =>
      store.set(sidebarThreadLifecycleSelectionAtom, new Set(["drafts"])),
    );
    const activeDisabledTrigger = screen.getByRole("button", {
      name: "Filter and sort (filtered)",
    });
    expect(
      activeDisabledTrigger.querySelector('[data-icon="FilterEdit"]'),
    ).not.toBeNull();
  });

  it("keeps the stronger filter variant for off-default sorting", () => {
    const store = renderMenus();

    act(() => store.set(sidebarChronologicalSortAtom, "created"));
    const trigger = screen.getByRole("button", {
      name: "Filter and sort (filtered)",
    });
    expect(trigger.querySelector('[data-icon="FilterEdit"]')).not.toBeNull();

    act(() => store.set(sidebarOrganizationModeAtom, "machine"));
    expect(trigger.querySelector('[data-icon="FilterEdit"]')).not.toBeNull();
  });
});
