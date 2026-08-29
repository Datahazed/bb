// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CatalogPluginDetail } from "@/components/tools/PluginDetail";
import type { PluginCatalogSearchEntry } from "@/hooks/queries/plugin-catalog-queries";

function catalogEntry(pluginId: string): PluginCatalogSearchEntry {
  return {
    entryId: pluginId,
    pluginId,
    displayName: pluginId === "usage" ? "Usage" : "Headroom",
    description: `${pluginId} description`,
    icon: "ChartColumn",
    iconUrl: null,
    iconTinted: false,
    categoryId: "token-usage-and-cost",
    category: "Token Usage & Limits",
    screenshots: [],
    newAndNotableRank: null,
    source: `npm:${pluginId}`,
    repositoryUrl: "https://github.com/patlee/usage",
    marketplace: "bb-community",
    marketplaceDisplayName: "BB Community",
    publisherKey: "bb-community",
    publisherLabel: "BB Community",
    official: true,
    author: { name: "Pat Lee", url: "https://github.com/patlee" },
    installed: false,
    installs: null,
    compatible: true,
    incompatibleReason: null,
  };
}

function withoutCategory(
  entry: PluginCatalogSearchEntry,
): PluginCatalogSearchEntry {
  const {
    categoryId: _categoryId,
    category: _category,
    ...categoryless
  } = entry;
  return categoryless;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("PluginMarketplaceListing", () => {
  it("renders zero and supplied listing evidence while hiding absent values", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-25T12:00:00.000Z"));
    const usage = {
      ...catalogEntry("usage"),
      screenshots: ["/screenshots/usage-one.png", "/screenshots/usage-two.png"],
      installs: 0,
      updatedAt: "2026-08-24T12:00:00.000Z",
    };
    const headroom = catalogEntry("headroom");
    const { rerender } = render(
      <MemoryRouter>
        <CatalogPluginDetail
          entry={usage}
          catalogEntries={[usage, headroom]}
          onInstall={() => {}}
          onOpenPlugin={() => {}}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("0 installs")).toBeTruthy();
    expect(screen.getByText(/^updated /u)).toBeTruthy();
    expect(
      screen.getByRole("img", { name: "Usage screenshot 1" }),
    ).toBeTruthy();
    expect(screen.getByText("More from this author")).toBeTruthy();
    expect(screen.getByText("Headroom")).toBeTruthy();
    // "More from this author" points away from this plugin, so everything
    // about this plugin has to come first. Asserted as document order rather
    // than presence: the sections used to be emitted as one block, and the
    // installed page slotted its own sections in after them.
    const sectionOrder = [...document.querySelectorAll("h2, h3")]
      .map((heading) => heading.textContent?.trim())
      .filter(
        (label): label is string =>
          label === "Screenshots" ||
          label === "About" ||
          label === "More from this author",
      );
    expect(sectionOrder.at(-1)).toBe("More from this author");
    expect(sectionOrder).toEqual([
      "Screenshots",
      "About",
      "More from this author",
    ]);
    expect(
      screen
        .getAllByRole("link", { name: /Pat Lee/u })[0]
        ?.getAttribute("href"),
    ).toBe("/extensions/plugins/authors/12%3Abb-community%3Agithub%3Apatlee");

    const withoutEvidence = withoutCategory({
      ...catalogEntry("usage"),
      repositoryUrl: null,
    });
    rerender(
      <MemoryRouter>
        <CatalogPluginDetail entry={withoutEvidence} onInstall={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.queryByText(/installs/u)).toBeNull();
    expect(screen.queryByText(/^updated /u)).toBeNull();
    expect(screen.queryByRole("img", { name: /screenshot/u })).toBeNull();
    expect(screen.queryByText("More from this author")).toBeNull();
    expect(screen.getByText("Pat Lee")).toBeTruthy();
    expect(screen.queryByText("Token Usage & Limits")).toBeNull();
    expect(document.body.textContent).not.toContain("Other");
  });
});
