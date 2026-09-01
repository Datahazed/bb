// @vitest-environment jsdom

import { createRef } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  SidebarRow,
  SidebarRowAccessory,
  SidebarRowActions,
  SidebarRowContent,
  SidebarRowDisclosureRail,
  SidebarRowIdentityRail,
  SidebarRowStatusRail,
} from "./SidebarRow";

afterEach(cleanup);

describe("SidebarRow", () => {
  it("preserves an asChild semantic element, attributes, focus, and ref", () => {
    const ref = createRef<HTMLDivElement>();

    render(
      <SidebarRow
        ref={ref}
        asChild
        anatomy="navigation"
        density="compact"
        depth={2}
        variant="groupLabel"
      >
        <button type="button" aria-label="Open tools" data-domain-row="tools">
          <SidebarRowIdentityRail>Icon</SidebarRowIdentityRail>
          <SidebarRowContent>Tools</SidebarRowContent>
        </button>
      </SidebarRow>,
    );

    const button = screen.getByRole("button", { name: "Open tools" });
    button.focus();

    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("data-domain-row")).toBe("tools");
    expect(button.getAttribute("data-sidebar-row-anatomy")).toBe(
      "navigation",
    );
    expect(button.getAttribute("data-sidebar-row-density")).toBe("compact");
    expect(button.getAttribute("data-sidebar-row-depth")).toBe("2");
    expect(button.getAttribute("data-sidebar-row-variant")).toBe(
      "groupLabel",
    );
    expect(button.style.getPropertyValue("--sidebar-row-depth")).toBe("2");
    expect(document.activeElement).toBe(button);
    expect(ref.current).toBe(button);
  });

  it("maps tree anatomy to stable semantic rails without per-row transforms", () => {
    const { container } = render(
      <SidebarRow anatomy="tree" depth={3}>
        <SidebarRowStatusRail />
        <SidebarRowIdentityRail>Icon</SidebarRowIdentityRail>
        <SidebarRowContent>Nested thread</SidebarRowContent>
        <SidebarRowAccessory>Meta</SidebarRowAccessory>
        <SidebarRowActions>Actions</SidebarRowActions>
        <SidebarRowDisclosureRail />
      </SidebarRow>,
    );

    const row = container.querySelector("[data-sidebar-row]");
    const status = container.querySelector('[data-sidebar-row-slot="status"]');
    const content = container.querySelector(
      '[data-sidebar-row-slot="content"]',
    );
    const disclosure = container.querySelector(
      '[data-sidebar-row-slot="disclosure"]',
    );

    expect(row?.getAttribute("data-sidebar-row-anatomy")).toBe("tree");
    expect(row?.getAttribute("data-sidebar-row-depth")).toBe("3");
    expect(row?.classList.contains("relative")).toBe(false);
    expect(status?.childElementCount).toBe(0);
    expect(status?.classList.contains("[grid-area:status]")).toBe(true);
    expect(status?.className).not.toContain("translate");
    expect(content?.classList.contains("[grid-area:content]")).toBe(true);
    expect(disclosure?.childElementCount).toBe(0);
    expect(disclosure?.classList.contains("[grid-area:disclosure]")).toBe(
      true,
    );
  });

  it("keeps recipe and density choices orthogonal to anatomy", () => {
    const { rerender } = render(
      <SidebarRow anatomy="navigation" density="label" variant="viewHeader">
        <SidebarRowContent>Projects</SidebarRowContent>
      </SidebarRow>,
    );

    expect(
      screen
        .getByText("Projects")
        .parentElement?.getAttribute("data-sidebar-row-variant"),
    ).toBe("viewHeader");
    expect(
      screen
        .getByText("Projects")
        .parentElement?.getAttribute("data-sidebar-row-density"),
    ).toBe("label");

    rerender(
      <SidebarRow anatomy="tree" density="standard" variant="item">
        <SidebarRowStatusRail />
        <SidebarRowContent>Thread</SidebarRowContent>
      </SidebarRow>,
    );

    expect(
      screen
        .getByText("Thread")
        .parentElement?.getAttribute("data-sidebar-row-variant"),
    ).toBe("item");
    expect(
      screen
        .getByText("Thread")
        .parentElement?.getAttribute("data-sidebar-row-density"),
    ).toBe("standard");
  });
});
