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
import { SidebarDisplayOptionsMenu } from "./ProjectList";
import {
  sidebarChronologicalSortAtom,
  sidebarOrganizationModeAtom,
} from "./sidebarCollapsedAtoms";
import { sidebarThreadLifecycleSelectionAtom } from "./sidebarThreadLifecycle";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

function renderMenu() {
  const store = createStore();
  render(
    <Provider store={store}>
      <TooltipProvider>
        <SidebarDisplayOptionsMenu />
      </TooltipProvider>
    </Provider>,
  );
  return store;
}

function openMenu() {
  fireEvent.pointerDown(
    screen.getByRole("button", { name: /^Sidebar display options/ }),
    { button: 0 },
  );
}

function getStatusItem(name: string) {
  return within(screen.getByRole("group", { name: "Thread status" })).getByRole(
    "menuitemcheckbox",
    { name: new RegExp(`^${name}`) },
  );
}

describe("SidebarDisplayOptionsMenu lifecycle filter", () => {
  it("renders count-free Thread status below Organize and Sort by", async () => {
    renderMenu();
    openMenu();

    await screen.findByRole("group", { name: "Thread status" });
    expect(
      screen
        .getAllByRole("group")
        .map((group) => group.getAttribute("aria-label"))
        .filter(Boolean),
    ).toEqual(["Organize", "Sort by", "Thread status"]);
    expect(getStatusItem("Active").textContent).toBe("Active");
    expect(getStatusItem("Drafts").textContent).toBe("Drafts");
    expect(getStatusItem("Archived").textContent).toBe("Archived");
    expect(
      within(screen.getByRole("group", { name: "Organize" }))
        .getAllByRole("menuitemcheckbox")
        .map((item) => item.textContent),
    ).toEqual(["By project", "By machine", "Manual"]);
    for (const item of screen.getAllByRole("menuitemcheckbox")) {
      expect(item.querySelector("svg")).not.toBeNull();
      expect(item.querySelector(".absolute.right-2")).not.toBeNull();
    }
    expect(
      document.querySelector("[data-sidebar-display-filter-dot]"),
    ).toBeNull();
  });

  it("builds unions, keeps one state selected, and marks an off-default filter", async () => {
    const store = renderMenu();
    openMenu();
    await screen.findByRole("group", { name: "Thread status" });

    fireEvent.click(getStatusItem("Drafts"));
    openMenu();
    fireEvent.click(getStatusItem("Active"));
    expect([...store.get(sidebarThreadLifecycleSelectionAtom)]).toEqual([
      "drafts",
    ]);
    openMenu();
    fireEvent.click(getStatusItem("Drafts"));
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

  it("marks an off-default organization choice", () => {
    const store = renderMenu();
    act(() => store.set(sidebarOrganizationModeAtom, "manual"));

    expect(
      screen.getByRole("button", {
        name: "Sidebar display options (filtered)",
      }),
    ).toBeDefined();
    expect(
      document.querySelector("[data-sidebar-display-filter-dot]"),
    ).not.toBeNull();
  });

  it("marks an off-default sort choice", () => {
    const store = renderMenu();
    act(() => store.set(sidebarChronologicalSortAtom, "created"));

    expect(
      screen.getByRole("button", {
        name: "Sidebar display options (filtered)",
      }),
    ).toBeDefined();
    expect(
      document.querySelector("[data-sidebar-display-filter-dot]"),
    ).not.toBeNull();
  });
});
