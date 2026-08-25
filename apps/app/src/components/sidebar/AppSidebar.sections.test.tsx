// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SidebarTopLevelSections } from "./AppSidebar";

afterEach(cleanup);

const sections = {
  "new-thread-extensions": <button type="button">New thread</button>,
  "plugin-pages": <button type="button">Plugin page</button>,
  "thread-list": <button type="button">Thread row</button>,
} as const;

function renderedSectionIds(): string[] {
  return Array.from(
    document.querySelectorAll("[data-sidebar-top-level-section]"),
  ).map((section) => section.getAttribute("data-sidebar-top-level-section")!);
}

describe("SidebarTopLevelSections", () => {
  it("renders all three sections in default order with full dividers", () => {
    const view = render(
      <SidebarTopLevelSections
        order={["new-thread-extensions", "plugin-pages", "thread-list"]}
        hiddenSectionIds={[]}
        sections={sections}
      />,
    );

    expect(renderedSectionIds()).toEqual([
      "new-thread-extensions",
      "plugin-pages",
      "thread-list",
    ]);
    const dividers = view.container.querySelectorAll(
      "[data-sidebar-top-level-divider]",
    );
    expect(dividers).toHaveLength(2);
    for (const divider of dividers) {
      expect(divider.getAttribute("aria-hidden")).toBe("true");
      expect(divider.getAttribute("tabindex")).toBeNull();
      expect(divider.classList.contains("bg-sidebar-border")).toBe(true);
    }
    expect(
      screen.getAllByRole("button").map((button) => button.textContent),
    ).toEqual(["New thread", "Plugin page", "Thread row"]);
  });

  it("reorders all regions and keeps keyboard controls in that order", () => {
    render(
      <SidebarTopLevelSections
        order={["thread-list", "new-thread-extensions", "plugin-pages"]}
        hiddenSectionIds={[]}
        sections={sections}
      />,
    );

    expect(renderedSectionIds()).toEqual([
      "thread-list",
      "new-thread-extensions",
      "plugin-pages",
    ]);
    expect(
      screen.getAllByRole("button").map((button) => button.textContent),
    ).toEqual(["Thread row", "New thread", "Plugin page"]);
  });

  it("draws no divider beside a hidden or empty region", () => {
    const view = render(
      <SidebarTopLevelSections
        order={["new-thread-extensions", "plugin-pages", "thread-list"]}
        hiddenSectionIds={["new-thread-extensions"]}
        sections={{ ...sections, "plugin-pages": null }}
      />,
    );

    expect(renderedSectionIds()).toEqual(["thread-list"]);
    expect(
      view.container.querySelectorAll("[data-sidebar-top-level-divider]"),
    ).toHaveLength(0);
  });
});
