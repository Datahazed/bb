// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, describe, expect, it } from "vitest";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import {
  SidebarFilterSortMenu,
  SidebarOrganizeMenu,
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
  it("separates organization from filtering and uses the approved labels", async () => {
    const store = renderMenus();
    openMenu(/^Organize:/);

    const group = await screen.findByRole("group", { name: "Organize" });
    expect(
      within(group)
        .getAllByRole("menuitemradio")
        .map((item) => item.textContent),
    ).toEqual(["By project", "By machine", "Custom"]);
    expect(
      within(group)
        .getAllByRole("menuitemradio")
        .map((item) => item.getAttribute("aria-checked")),
    ).toEqual(["true", "false", "false"]);

    fireEvent.click(
      within(group).getByRole("menuitemradio", { name: "Custom" }),
    );
    expect(store.get(sidebarOrganizationModeAtom)).toBe("manual");
    await waitFor(() =>
      expect(screen.queryByRole("group", { name: "Organize" })).toBeNull(),
    );
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
    expect(
      within(screen.getByRole("group", { name: "Thread status" }))
        .getAllByRole("menuitemcheckbox")
        .map((item) => item.textContent),
    ).toEqual(["Active", "Archived", "Drafts"]);

    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Drafts" }));
    expect([...store.get(sidebarThreadLifecycleSelectionAtom)]).toEqual([
      "active",
      "drafts",
    ]);
    expect(screen.getByRole("group", { name: "Sort by" })).not.toBeNull();

    const updated = screen.getByRole("menuitemradio", { name: "Updated at" });
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

  it("fills and presses the filter control only for off-default status state", () => {
    const store = renderMenus();
    const defaultTrigger = screen.getByRole("button", {
      name: "Filter and sort",
    });
    expect(defaultTrigger.getAttribute("aria-pressed")).toBe("false");
    expect(
      defaultTrigger
        .querySelector('[data-icon="Filter"]')
        ?.classList.contains("[&_path]:fill-current"),
    ).toBe(false);

    act(() => store.set(sidebarChronologicalSortAtom, "created"));
    expect(defaultTrigger.getAttribute("aria-pressed")).toBe("false");
    expect(
      defaultTrigger
        .querySelector('[data-icon="Filter"]')
        ?.classList.contains("[&_path]:fill-current"),
    ).toBe(false);

    act(() =>
      store.set(
        sidebarThreadLifecycleSelectionAtom,
        new Set(["active", "drafts"]),
      ),
    );
    const modifiedTrigger = screen.getByRole("button", {
      name: "Filter and sort (filtered)",
    });
    expect(modifiedTrigger.getAttribute("aria-pressed")).toBe("true");
    expect(
      modifiedTrigger
        .querySelector('[data-icon="Filter"]')
        ?.classList.contains("[&_path]:fill-current"),
    ).toBe(true);
    expect(
      modifiedTrigger.querySelector('[data-icon="FilterEdit"]'),
    ).toBeNull();

    act(() =>
      store.set(sidebarThreadLifecycleSelectionAtom, new Set(["drafts"])),
    );
    expect(modifiedTrigger.getAttribute("aria-pressed")).toBe("true");
    expect(
      modifiedTrigger
        .querySelector('[data-icon="Filter"]')
        ?.classList.contains("[&_path]:fill-current"),
    ).toBe(true);

    act(() =>
      store.set(sidebarThreadLifecycleSelectionAtom, new Set(["active"])),
    );
    const resetTrigger = screen.getByRole("button", {
      name: "Filter and sort",
    });
    expect(resetTrigger.getAttribute("aria-pressed")).toBe("false");
    expect(
      resetTrigger
        .querySelector('[data-icon="Filter"]')
        ?.classList.contains("[&_path]:fill-current"),
    ).toBe(false);
  });
});
