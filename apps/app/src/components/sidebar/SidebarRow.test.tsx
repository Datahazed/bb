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
  SidebarRowLeadingAction,
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
    expect(button).toHaveAttribute("data-domain-row", "tools");
    expect(button).toHaveAttribute("data-sidebar-row-anatomy", "navigation");
    expect(button).toHaveAttribute("data-sidebar-row-density", "compact");
    expect(button).toHaveAttribute("data-sidebar-row-depth", "2");
    expect(button).toHaveAttribute("data-sidebar-row-variant", "groupLabel");
    expect(button.style.getPropertyValue("--sidebar-row-depth")).toBe("2");
    expect(document.activeElement).toBe(button);
    expect(ref.current).toBe(button);
  });

  it("maps tree anatomy to stable semantic rails without per-row transforms", () => {
    const { container } = render(
      <SidebarRow anatomy="tree" depth={3}>
        <SidebarRowStatusRail />
        <SidebarRowLeadingAction>Archive</SidebarRowLeadingAction>
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
    const leadingAction = container.querySelector(
      "[data-sidebar-row-leading-action]",
    );

    expect(row).toHaveAttribute("data-sidebar-row-anatomy", "tree");
    expect(row).toHaveAttribute("data-sidebar-row-depth", "3");
    expect(status).toBeEmptyDOMElement();
    expect(status).toHaveClass("[grid-area:status]");
    expect(status?.className).not.toContain("translate");
    expect(leadingAction).toHaveClass("absolute", "left-0");
    expect(leadingAction).not.toHaveAttribute("data-sidebar-row-slot");
    expect(content).toHaveClass("[grid-area:content]");
    expect(disclosure).toBeEmptyDOMElement();
    expect(disclosure).toHaveClass("[grid-area:disclosure]");
  });

  it("keeps recipe and density choices orthogonal to anatomy", () => {
    const { rerender } = render(
      <SidebarRow anatomy="navigation" density="label" variant="viewHeader">
        <SidebarRowContent>Projects</SidebarRowContent>
      </SidebarRow>,
    );

    expect(screen.getByText("Projects").parentElement).toHaveAttribute(
      "data-sidebar-row-variant",
      "viewHeader",
    );
    expect(screen.getByText("Projects").parentElement).toHaveAttribute(
      "data-sidebar-row-density",
      "label",
    );

    rerender(
      <SidebarRow anatomy="tree" density="standard" variant="item">
        <SidebarRowStatusRail />
        <SidebarRowContent>Thread</SidebarRowContent>
      </SidebarRow>,
    );

    expect(screen.getByText("Thread").parentElement).toHaveAttribute(
      "data-sidebar-row-variant",
      "item",
    );
    expect(screen.getByText("Thread").parentElement).toHaveAttribute(
      "data-sidebar-row-density",
      "standard",
    );
  });
});
