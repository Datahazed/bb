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
import { SidebarTopRegionCustomizeMenu } from "./SidebarTopRegionCustomizeMenu";
import { sidebarTopRegionItemPreferencesAtom } from "./sidebarTopRegionItemPreferences";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

function renderMenu() {
  const store = createStore();
  render(
    <Provider store={store}>
      <TooltipProvider>
        <SidebarTopRegionCustomizeMenu />
      </TooltipProvider>
    </Provider>,
  );
  fireEvent.pointerDown(
    screen.getByRole("button", { name: "Customize sidebar" }),
    {
      button: 0,
    },
  );
  return store;
}

describe("SidebarTopRegionCustomizeMenu", () => {
  it("shows exactly the three host-owned rows in stored order", async () => {
    const store = createStore();
    store.set(sidebarTopRegionItemPreferencesAtom, {
      order: ["automations", "new-thread", "extensions"],
      hiddenIds: ["extensions"],
    });
    render(
      <Provider store={store}>
        <TooltipProvider>
          <SidebarTopRegionCustomizeMenu />
        </TooltipProvider>
      </Provider>,
    );
    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Customize sidebar" }),
      { button: 0 },
    );

    const items = await screen.findAllByRole("menuitemcheckbox");
    expect(items.map((item) => item.textContent)).toEqual([
      "Automations",
      "New thread",
      "Extensions",
    ]);
    expect(items[2]?.getAttribute("data-state")).toBe("unchecked");
    expect(
      document.querySelectorAll("[data-sidebar-customize-drag-handle]"),
    ).toHaveLength(3);
  });

  it("updates visibility live, stays open, and can restore from all hidden", async () => {
    const store = renderMenu();
    const menu = await screen.findByRole("menu");

    for (const label of ["New thread", "Extensions", "Automations"]) {
      fireEvent.click(
        within(menu).getByRole("menuitemcheckbox", { name: label }),
      );
    }
    expect(store.get(sidebarTopRegionItemPreferencesAtom).hiddenIds).toEqual([
      "new-thread",
      "extensions",
      "automations",
    ]);
    expect(screen.getByRole("menu")).toBeDefined();

    fireEvent.click(
      within(menu).getByRole("menuitemcheckbox", { name: "New thread" }),
    );
    expect(store.get(sidebarTopRegionItemPreferencesAtom).hiddenIds).toEqual([
      "extensions",
      "automations",
    ]);
  });
});
