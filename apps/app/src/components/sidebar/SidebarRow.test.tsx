// @vitest-environment jsdom

import { createRef } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  SidebarRow,
  SidebarRowAccessory,
  SidebarRowActions,
  SidebarRowBody,
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
        <SidebarRowBody>
          <SidebarRowIdentityRail>Icon</SidebarRowIdentityRail>
          <SidebarRowContent>Nested thread</SidebarRowContent>
          <SidebarRowAccessory>Meta</SidebarRowAccessory>
        </SidebarRowBody>
        <SidebarRowActions>Actions</SidebarRowActions>
        <SidebarRowDisclosureRail />
      </SidebarRow>,
    );

    const row = container.querySelector("[data-sidebar-row]");
    const status = container.querySelector('[data-sidebar-row-slot="status"]');
    const content = container.querySelector(
      '[data-sidebar-row-slot="content"]',
    );
    const body = container.querySelector('[data-sidebar-row-slot="body"]');
    const disclosure = container.querySelector(
      '[data-sidebar-row-slot="disclosure"]',
    );

    expect(row?.getAttribute("data-sidebar-row-anatomy")).toBe("tree");
    expect(row?.getAttribute("data-sidebar-row-depth")).toBe("3");
    expect(row?.classList.contains("relative")).toBe(false);
    expect(row?.className).toContain(
      "[grid-template-areas:'status_body_actions_disclosure']",
    );
    expect(row?.className).toContain("[--sidebar-row-depth-step:0.75rem]");
    expect(status?.childElementCount).toBe(0);
    expect(status?.classList.contains("[grid-area:status]")).toBe(true);
    expect(status?.className).not.toContain("translate");
    expect(body?.classList.contains("[grid-area:body]")).toBe(true);
    expect(body?.className).toContain("pl-[var(--sidebar-row-body-inset)]");
    expect(content?.classList.contains("[grid-area:content]")).toBe(true);
    expect(disclosure?.childElementCount).toBe(0);
    expect(disclosure?.classList.contains("[grid-area:disclosure]")).toBe(
      true,
    );
    expect(disclosure?.classList.contains("justify-center")).toBe(true);
  });

  it("does not move the fixed tree rails when optional row content changes", () => {
    const { container } = render(
      <>
        <SidebarRow anatomy="tree" data-testid="plain-row">
          <SidebarRowStatusRail />
          <SidebarRowBody>
            <SidebarRowContent>Plain thread</SidebarRowContent>
          </SidebarRowBody>
        </SidebarRow>
        <SidebarRow anatomy="tree" data-testid="collapsible-row">
          <SidebarRowStatusRail />
          <SidebarRowBody>
            <SidebarRowIdentityRail>Icon</SidebarRowIdentityRail>
            <SidebarRowContent>Parent thread</SidebarRowContent>
          </SidebarRowBody>
          <SidebarRowActions>Actions</SidebarRowActions>
          <SidebarRowDisclosureRail>Disclosure</SidebarRowDisclosureRail>
        </SidebarRow>
      </>,
    );

    const plainRow = screen.getByTestId("plain-row");
    const collapsibleRow = screen.getByTestId("collapsible-row");
    const plainStatus = plainRow.querySelector(
      '[data-sidebar-row-slot="status"]',
    );
    const collapsibleStatus = collapsibleRow.querySelector(
      '[data-sidebar-row-slot="status"]',
    );
    const disclosure = collapsibleRow.querySelector(
      '[data-sidebar-row-slot="disclosure"]',
    );

    expect(plainRow.className).toContain(
      "[grid-template-columns:var(--sidebar-row-status-rail)_minmax(0,1fr)_auto_var(--sidebar-row-disclosure-rail)]",
    );
    expect(collapsibleRow.className).toContain(
      "[grid-template-columns:var(--sidebar-row-status-rail)_minmax(0,1fr)_auto_var(--sidebar-row-disclosure-rail)]",
    );
    expect(plainStatus?.className).toBe(collapsibleStatus?.className);
    expect(disclosure?.classList.contains("justify-center")).toBe(true);
    expect(container.querySelectorAll("[data-sidebar-row]")).toHaveLength(2);
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
        .closest("[data-sidebar-row]")
        ?.getAttribute("data-sidebar-row-variant"),
    ).toBe("viewHeader");
    expect(
      screen
        .getByText("Projects")
        .closest("[data-sidebar-row]")
        ?.getAttribute("data-sidebar-row-density"),
    ).toBe("label");

    rerender(
      <SidebarRow anatomy="tree" density="standard" variant="item">
        <SidebarRowStatusRail />
        <SidebarRowBody>
          <SidebarRowContent>Thread</SidebarRowContent>
        </SidebarRowBody>
      </SidebarRow>,
    );

    expect(
      screen
        .getByText("Thread")
        .closest("[data-sidebar-row]")
        ?.getAttribute("data-sidebar-row-variant"),
    ).toBe("item");
    expect(
      screen
        .getByText("Thread")
        .closest("[data-sidebar-row]")
        ?.getAttribute("data-sidebar-row-density"),
    ).toBe("standard");
  });
});
