// @vitest-environment jsdom

import {
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
  hiddenSidebarTopLevelSectionIdsAtom,
  sidebarTopLevelSectionOrderAtom,
} from "./sidebarTopLevelSectionPreferences";

afterEach(cleanup);

function renderMenu() {
  const store = createStore();
  store.set(sidebarTopLevelSectionOrderAtom, [
    "new-thread-extensions",
    "plugin-pages",
    "thread-list",
  ]);
  store.set(hiddenSidebarTopLevelSectionIdsAtom, []);
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
    screen.getByRole("button", { name: "Sidebar display options" }),
    { button: 0 },
  );
}

function openSectionSubmenu(name: string) {
  const group = screen.getByRole("group", { name: "Sidebar sections" });
  const trigger = within(group).getByRole("menuitem", { name });
  fireEvent.click(trigger);
}

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
