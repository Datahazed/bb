// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { ToolsSidebar } from "./ToolsSidebar";
import { SidebarProvider } from "@/components/ui/sidebar";

afterEach(cleanup);

const PAGE_ROWS = [
  "Browse plugins",
  "Installed plugins",
  "My plugins",
  "Browse skills",
  "Installed skills",
  "My skills",
];

function renderAt(path: string, appRoutePath = "/") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SidebarProvider>
        <ToolsSidebar
          appRoutePath={appRoutePath}
          isResizing={false}
          onResizeMouseDown={() => {}}
          showTopReserve={false}
        />
      </SidebarProvider>
    </MemoryRouter>,
  );
}

const row = (name: string) => screen.getByRole("link", { name });

describe("ToolsSidebar", () => {
  it("groups every Extensions page by noun and keeps the back target", () => {
    renderAt("/extensions/plugins", "/projects/proj_one");

    // Extensions holds two nouns, so the sidebar has two groups. Each row's
    // page lives under exactly one of them.
    expect(screen.getByText("Plugins")).toBeTruthy();
    expect(screen.getByText("Skills")).toBeTruthy();
    expect(row("Browse plugins").getAttribute("href")).toBe(
      "/extensions/plugins",
    );
    expect(row("Installed plugins").getAttribute("href")).toBe(
      "/extensions/plugins?view=installed",
    );
    expect(row("My plugins").getAttribute("href")).toBe(
      "/extensions/plugins?view=my",
    );
    expect(row("Browse skills").getAttribute("href")).toBe(
      "/extensions/skills",
    );
    expect(row("Installed skills").getAttribute("href")).toBe(
      "/extensions/skills?view=installed",
    );
    expect(row("My skills").getAttribute("href")).toBe(
      "/extensions/skills?view=my",
    );
    // The back row must point at the remembered app route, not merely exist.
    expect(row("Back to app").getAttribute("href")).toBe("/projects/proj_one");
  });

  it.each([
    ["/extensions/plugins", "Browse plugins"],
    ["/extensions/plugins?view=installed", "Installed plugins"],
    ["/extensions/plugins?view=my", "My plugins"],
    ["/extensions/plugins/github", "Browse plugins"],
    ["/extensions/plugins/github?view=installed", "Installed plugins"],
    ["/extensions/skills", "Browse skills"],
    ["/extensions/skills/registry", "Browse skills"],
    ["/extensions/skills?view=installed", "Installed skills"],
    ["/extensions/skills?view=my", "My skills"],
    ["/extensions/skills?view=library", "Installed skills"],
    ["/extensions/skills/library/my-skill", "Installed skills"],
    ["/extensions/skills/library/my-skill?view=my", "My skills"],
    // The pre-Library detail path still resolves during its redirect window.
    ["/extensions/skills/installed/my-skill", "Installed skills"],
    ["/extensions/skills/registry/owner%2Frepo%2Fskill", "Browse skills"],
  ])("marks exactly one active page for %s", (path, expected) => {
    renderAt(path);
    // Exclusivity: two lit rows must fail, not just a missing expected row.
    const activeRows = PAGE_ROWS.filter(
      (name) => row(name).getAttribute("aria-current") === "page",
    );
    expect(activeRows).toEqual([expected]);
  });
});
