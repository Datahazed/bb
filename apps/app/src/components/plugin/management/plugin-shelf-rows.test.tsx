// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { PluginCatalogSearchEntry } from "@/hooks/queries/plugin-catalog-queries";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { PluginCatalogGrid } from "./BrowsePluginsTab";

afterEach(cleanup);

// Vitest runs from the app package root.
const APP_CSS = readFileSync("src/app.css", "utf8");

/**
 * The shelf's column counts and its visible-card cutoff both live in CSS
 * container queries, which jsdom does not evaluate. Read them back out of the
 * stylesheet so the invariant is asserted against the source of truth rather
 * than a copy of it that could drift.
 */
function shelfBreakpoints() {
  const columns = [...APP_CSS.matchAll(
    /@container plugin-shelf \(min-width: ([\d.]+)rem\)\s*\{\s*\[data-plugin-shelf-grid\]\s*\{\s*grid-template-columns: repeat\((\d+),/gu,
  )].map(([, rem, cols]) => ({ rem: Number(rem), cols: Number(cols) }));
  const cutoff = /@container plugin-shelf \(max-width: ([\d.]+)rem\)\s*\{\s*\[data-plugin-shelf-grid\] > :nth-child\(n \+ (\d+)\)/u.exec(
    APP_CSS,
  );
  return { columns, cutoff };
}

const ENTRY: PluginCatalogSearchEntry = {
  entryId: "memory",
  marketplace: "bb-community",
  pluginId: "memory",
  displayName: "Memory",
  description: "Durable memory for agents.",
  icon: "Brain",
  iconUrl: null,
  iconTinted: false,
  category: undefined,
  categoryId: undefined,
  screenshots: [],
  newAndNotableRank: null,
  publisherKey: "bb-community",
  publisherLabel: "BB Community",
  marketplaceDisplayName: "BB Community",
  official: true,
  installs: null,
  installed: false,
  compatible: true,
  incompatibleReason: null,
  repositoryUrl: null,
  source: null,
  author: null,
  updatedAt: undefined,
  publishedAt: undefined,
} as unknown as PluginCatalogSearchEntry;

const SHELF_ENTRIES = Array.from({ length: 6 }, (_, index) => ({
  ...ENTRY,
  entryId: `plugin-${index}`,
  pluginId: `plugin-${index}`,
  displayName: `Plugin ${index}`,
}));

describe("browse shelf rows", () => {
  it("pairs every column count with a card count that fills its rows", () => {
    const { columns, cutoff } = shelfBreakpoints();
    expect(cutoff).not.toBeNull();
    // `:nth-child(n + 5)` hides the fifth card onward, so four remain.
    const narrowCount = Number(cutoff?.[2]) - 1;
    const cutoffRem = Number(cutoff?.[1]);
    const wideCount = SHELF_ENTRIES.length;

    // Below the cutoff the shelf shows `narrowCount`; at or above it, all six.
    // Each column count must divide whichever count applies at its width.
    const cases = [
      { cols: 1, count: narrowCount },
      ...columns.map(({ rem, cols }) => ({
        cols,
        count: rem > cutoffRem ? wideCount : narrowCount,
      })),
    ];
    for (const { cols, count } of cases) {
      expect({ cols, count, remainder: count % cols }).toMatchObject({
        remainder: 0,
      });
      // A shelf that is more than one column wide reads as pairs.
      if (cols >= 2) expect({ cols, count, even: count % 2 === 0 }).toMatchObject({ even: true });
    }
    expect(cases.length).toBeGreaterThanOrEqual(3);
  });

  it("keeps the widest column count reachable before the cards appear", () => {
    // The bug: three columns arrived at a narrower width than the fifth and
    // sixth cards did, so the shelf drew 3 + 1. The cutoff must not sit above
    // the width where the last column count starts.
    const { columns, cutoff } = shelfBreakpoints();
    const widest = Math.max(...columns.map((c) => c.rem));
    expect(Number(cutoff?.[1])).toBeLessThan(widest + 1);
  });

  it("renders every card in order and marks the shelf for its container", () => {
    const { wrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter>
        <PluginCatalogGrid
          entries={SHELF_ENTRIES}
          preview
          onInstall={() => {}}
          onOpenPlugin={() => {}}
        />
      </MemoryRouter>,
      { wrapper },
    );
    // Hiding is presentational: all six stay in the DOM in order, so "View
    // all" and assistive technology still see the whole shelf.
    const names = screen
      .getAllByRole("button", { name: /^Open Plugin \d details$/u })
      .map((button) => button.getAttribute("aria-label"));
    expect(names).toEqual([
      "Open Plugin 0 details",
      "Open Plugin 1 details",
      "Open Plugin 2 details",
      "Open Plugin 3 details",
      "Open Plugin 4 details",
      "Open Plugin 5 details",
    ]);
    expect(document.querySelector("[data-plugin-shelf]")).not.toBeNull();
    expect(document.querySelector("[data-plugin-shelf-grid]")).not.toBeNull();
  });

  it("leaves a full grid alone, where a short last row is the honest result", () => {
    // Search results and author pages show everything they have; only the
    // shelf preview drops a tail to keep its rows square.
    const { wrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter>
        <PluginCatalogGrid
          entries={SHELF_ENTRIES}
          onInstall={() => {}}
          onOpenPlugin={() => {}}
        />
      </MemoryRouter>,
      { wrapper },
    );
    expect(document.querySelector("[data-plugin-shelf]")).toBeNull();
    expect(document.querySelector("[data-plugin-shelf-grid]")).toBeNull();
  });
});
