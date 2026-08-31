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
  it("lets the thread toolbar own its preceding divider", () => {
    const view = render(<SidebarTopLevelSections sections={sections} />);

    expect(renderedSectionIds()).toEqual([
      "new-thread-extensions",
      "plugin-pages",
      "thread-list",
    ]);
    const dividers = view.container.querySelectorAll(
      "[data-sidebar-top-level-divider]",
    );
    expect(dividers).toHaveLength(1);
    for (const divider of dividers) {
      expect(divider.getAttribute("aria-hidden")).toBe("true");
      expect(divider.getAttribute("tabindex")).toBeNull();
      expect(divider.classList.contains("bg-sidebar-border")).toBe(true);
    }
    expect(
      view.container.querySelector('[data-sidebar-region="threads"]'),
    ).toHaveAttribute("data-sidebar-integrated-divider", "");
    expect(
      screen.getAllByRole("button").map((button) => button.textContent),
    ).toEqual(["New thread", "Plugin page", "Thread row"]);
  });

  it("keeps region and keyboard order fixed even when object keys differ", () => {
    render(
      <SidebarTopLevelSections
        sections={{
          "thread-list": sections["thread-list"],
          "plugin-pages": sections["plugin-pages"],
          "new-thread-extensions": sections["new-thread-extensions"],
        }}
      />,
    );

    expect(renderedSectionIds()).toEqual([
      "new-thread-extensions",
      "plugin-pages",
      "thread-list",
    ]);
    expect(
      screen.getAllByRole("button").map((button) => button.textContent),
    ).toEqual(["New thread", "Plugin page", "Thread row"]);
  });

  it("renders regions and keyboard order in the persisted order", () => {
    render(
      <SidebarTopLevelSections
        order={["threads", "bb-controls", "plugins"]}
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

  it("draws no divider beside empty regions", () => {
    const view = render(
      <SidebarTopLevelSections
        sections={{
          ...sections,
          "new-thread-extensions": null,
          "plugin-pages": null,
        }}
      />,
    );

    expect(renderedSectionIds()).toEqual(["thread-list"]);
    expect(
      view.container.querySelectorAll("[data-sidebar-top-level-divider]"),
    ).toHaveLength(0);
  });

  it("draws one seam when the middle plugin region is empty", () => {
    const view = render(
      <SidebarTopLevelSections
        sections={{ ...sections, "plugin-pages": null }}
      />,
    );

    expect(renderedSectionIds()).toEqual([
      "new-thread-extensions",
      "thread-list",
    ]);
    expect(
      view.container.querySelectorAll("[data-sidebar-top-level-divider]"),
    ).toHaveLength(0);
    expect(
      view.container.querySelector('[data-sidebar-region="threads"]'),
    ).toHaveAttribute("data-sidebar-integrated-divider", "");
  });

  it("collapses an empty BB-controls region after reordering", () => {
    const view = render(
      <SidebarTopLevelSections
        order={["threads", "bb-controls", "plugins"]}
        sections={{ ...sections, "new-thread-extensions": null }}
      />,
    );

    expect(renderedSectionIds()).toEqual(["thread-list", "plugin-pages"]);
    expect(
      view.container.querySelectorAll("[data-sidebar-top-level-divider]"),
    ).toHaveLength(1);
  });
});
