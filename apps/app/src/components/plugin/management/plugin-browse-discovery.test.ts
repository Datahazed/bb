import { describe, expect, it } from "vitest";
import type { PluginCatalogSearchEntry } from "@/hooks/queries/plugin-catalog-queries";
import {
  categoryShelves,
  newAndNotableEntries,
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
  it("maps server category labels while excluding v1 fallback entries", () => {
    const shelves = categoryShelves([
      entry("agent-b"),
      entry("agent-a"),
      entry("theme-a", {
        categoryId: "themes-and-appearance",
        category: "Themes & Appearance",
      }),
      entry("legacy-v1", { categoryId: undefined, category: undefined }),
    ]);

    expect(
      shelves.map((shelf) => [
        shelf.id,
        shelf.label,
        shelf.entries.map(({ entryId }) => entryId),
      ]),
    ).toEqual([
      ["agent-tools", "Agent Tools", ["agent-a", "agent-b"]],
      ["themes-and-appearance", "Themes & Appearance", ["theme-a"]],
    ]);
  });

  it("uses only categorized official entries for curated app ranks", () => {
    expect(
      newAndNotableEntries([
        entry("third-party", { newAndNotableRank: 0, official: false }),
        entry("official", { newAndNotableRank: 1 }),
        entry("legacy-v1", {
          categoryId: undefined,
          category: undefined,
          newAndNotableRank: 0,
        }),
      ]).map((item) => item.entryId),
    ).toEqual(["official"]);

    expect(
      newAndNotableEntries([
        entry("older", { publishedAt: "2026-08-20T09:30:00Z" }),
        entry("legacy-newer", {
          categoryId: undefined,
          category: undefined,
          publishedAt: "2026-08-24T09:30:00Z",
        }),
      ]).map((item) => item.entryId),
    ).toEqual(["older"]);
  });
});
