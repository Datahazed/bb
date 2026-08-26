import { describe, expect, it } from "vitest";
import type { PluginCatalogSearchEntry } from "@/hooks/queries/plugin-catalog-queries";
import {
  browseShelfGroups,
  categoryShelves,
  newAndNotableEntries,
  sortPluginEntries,
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

  it("projects categories through the shared five-shelf grouping", () => {
    const groups = browseShelfGroups([
      entry("theme", {
        categoryId: "themes-and-appearance",
        category: "Themes & Appearance",
      }),
      entry("timeline", {
        categoryId: "thread-messages-and-timelines",
        category: "Thread Messages & Timelines",
      }),
      entry("provider", {
        categoryId: "agents-and-providers",
        category: "Agents & Providers",
      }),
      entry("security", {
        categoryId: "security",
        category: "Security",
      }),
      entry("host", {
        categoryId: "machines-and-hosts",
        category: "Machines & Hosts",
      }),
    ]);

    expect(
      groups.map(({ id, entries }) => [
        id,
        entries.map(({ entryId }) => entryId),
      ]),
    ).toEqual([
      ["threads-and-interface", ["theme", "timeline"]],
      ["agents-and-workflows", ["provider"]],
      ["insights-and-security", ["security"]],
      ["machines-and-hosts", ["host"]],
    ]);
  });

  it("sorts app entries in both directions", () => {
    expect(
      sortPluginEntries([entry("alpha"), entry("zulu")], "name", "desc").map(
        ({ entryId }) => entryId,
      ),
    ).toEqual(["zulu", "alpha"]);
  });
});
