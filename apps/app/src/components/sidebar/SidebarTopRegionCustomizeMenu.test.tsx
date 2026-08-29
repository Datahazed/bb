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
import { sidebarRegionOrderAtom } from "./sidebarRegionOrderPreferences";

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
    store.set(sidebarRegionOrderAtom, ["threads", "bb-controls", "plugins"]);
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
    expect(screen.getByText("Customize")).toBeDefined();
    expect(screen.queryByText("Sidebar items")).toBeNull();
    expect(screen.queryByText("Drag to reorder. Uncheck to hide.")).toBeNull();
    expect(
      document.querySelectorAll("[data-sidebar-customize-checkbox]"),
    ).toHaveLength(3);
    expect(
      document
        .querySelector('[data-sidebar-customize-checkbox="extensions"]')
        ?.getAttribute("data-state"),
    ).toBe("unchecked");
    const checkedBox = document.querySelector(
      '[data-sidebar-customize-checkbox="automations"]',
    );
    expect(checkedBox?.classList.contains("bg-foreground")).toBe(false);
    expect(checkedBox?.classList.contains("border-primary")).toBe(true);
    expect(checkedBox?.classList.contains("text-primary")).toBe(true);
    expect(screen.getByRole("menu").classList.contains("w-44")).toBe(true);
    for (const dragIcon of document.querySelectorAll(
      "[data-sidebar-customize-drag-handle] svg",
    )) {
      expect(dragIcon.classList.contains("size-4")).toBe(true);
    }
    expect(screen.getByText("Sidebar order")).toBeDefined();
    expect(
      Array.from(
        document.querySelectorAll("[data-sidebar-customize-region]"),
      ).map((item) => item.textContent),
    ).toEqual(["Threads", "BB controls", "Plugins"]);
    expect(
      document.querySelectorAll(
        "[data-sidebar-customize-region-drag-handle]",
      ),
    ).toHaveLength(3);
    expect(screen.getByRole("group", { name: "BB controls" })).toBeDefined();
    for (const label of [
      "New thread",
      "Extensions",
      "Automations",
      "Threads",
      "BB controls",
      "Plugins",
    ]) {
      const handle = screen.getByLabelText(`Reorder ${label}`);
      expect(handle.getAttribute("tabindex")).toBe("0");
    }
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
