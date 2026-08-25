import { describe, expect, it } from "vitest";
import type { PluginCatalogSearchEntry } from "@/hooks/queries/plugin-catalog-queries";
import {
  categoryShelves,
  newAndNotableEntries,
  sortPluginEntries,
  visibleCategoryChipCount,
} from "./plugin-browse-discovery";

function entry(
  id: string,
  overrides: Partial<PluginCatalogSearchEntry> = {},
): PluginCatalogSearchEntry {
  return {
    entryId: id,
    pluginId: id,
    displayName: id,
    description: `${id} description`,
    icon: null,
    iconUrl: null,
    iconTinted: false,
    categoryId: "agent-tools",
    category: "Agent Tools",
    screenshots: [],
    newAndNotableRank: null,
    source: `builtin:${id}`,
    repositoryUrl: null,
    marketplace: "bb-community",
    marketplaceDisplayName: "BB Community",
    publisherKey: "builtin",
    publisherLabel: "BB Official",
    official: true,
    author: null,
    installed: false,
    compatible: true,
    incompatibleReason: null,
    ...overrides,
  };
}

describe("plugin browse discovery projections", () => {
  it("orders categorized shelves by count and registry ties", () => {
    const shelves = categoryShelves([
      entry("security", {
        categoryId: "security",
        category: "Security",
      }),
      entry("agent-a"),
      entry("agent-b"),
      entry("theme-a", {
        categoryId: "themes-and-appearance",
        category: "Themes & Appearance",
      }),
      entry("theme-b", {
        categoryId: "themes-and-appearance",
        category: "Themes & Appearance",
      }),
      entry("legacy-v1", { categoryId: undefined, category: undefined }),
    ]);

    expect(shelves.map((shelf) => [shelf.id, shelf.entries.length])).toEqual([
      ["themes-and-appearance", 2],
      ["agent-tools", 2],
      ["security", 1],
    ]);
  });

  it("uses curated order, then publishedAt when the v2 list is empty", () => {
    expect(
      newAndNotableEntries([
        entry("second", { newAndNotableRank: 1 }),
        entry("first", { newAndNotableRank: 0 }),
      ]).map((item) => item.entryId),
    ).toEqual(["first", "second"]);

    expect(
      newAndNotableEntries([
        entry("unknown"),
        entry("older", { publishedAt: "2026-08-20T09:30:00Z" }),
        entry("newer", { publishedAt: "2026-08-24T09:30:00Z" }),
      ]).map((item) => item.entryId),
    ).toEqual(["newer", "older", "unknown"]);
  });

  it("keeps unknown metrics after known values instead of fabricating zeros", () => {
    const entries = [
      entry("unknown"),
      entry("smaller", { installCount: 2 }),
      entry("larger", { installCount: 10 }),
    ];
    expect(
      sortPluginEntries(entries, "most-installed").map((item) => item.entryId),
    ).toEqual(["larger", "smaller", "unknown"]);
    expect(
      sortPluginEntries(
        [
          entry("unknown-date"),
          entry("older", { publishedAt: "2026-08-20T09:30:00Z" }),
          entry("newer", { publishedAt: "2026-08-24T09:30:00Z" }),
        ],
        "recently-added",
      ).map((item) => item.entryId),
    ).toEqual(["newer", "older", "unknown-date"]);
  });

  it("adds overflow only once the exact chip row no longer fits", () => {
    const widths = {
      allWidth: 40,
      categoryWidths: [70, 70, 70],
      overflowWidthsByHiddenCount: [0, 60, 60, 60],
      gap: 8,
    };
    expect(visibleCategoryChipCount({ ...widths, containerWidth: 274 })).toBe(
      3,
    );
    expect(visibleCategoryChipCount({ ...widths, containerWidth: 273 })).toBe(
      2,
    );
  });
});
