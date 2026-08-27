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
    installs: null,
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

describe("recently added ordering", () => {
  it("puts the newest published entry first", () => {
    const ordered = sortPluginEntries(
      [
        entry("older", { publishedAt: "2026-01-05T00:00:00Z" }),
        entry("newest", { publishedAt: "2026-08-20T00:00:00Z" }),
        entry("middle", { publishedAt: "2026-04-11T00:00:00Z" }),
      ],
      "recently-added",
    );
    expect(ordered.map((candidate) => candidate.entryId)).toEqual([
      "newest",
      "middle",
      "older",
    ]);
  });

  it("reverses to oldest first when the direction flips", () => {
    const ordered = sortPluginEntries(
      [
        entry("newest", { publishedAt: "2026-08-20T00:00:00Z" }),
        entry("older", { publishedAt: "2026-01-05T00:00:00Z" }),
      ],
      "recently-added",
      "asc",
    );
    expect(ordered.map((candidate) => candidate.entryId)).toEqual([
      "older",
      "newest",
    ]);
  });

  it("falls back to name order when no entry carries a timestamp", () => {
    // Today's catalog is in exactly this state: nothing publishes publishedAt,
    // so the control cannot order anything until the registry emits it.
    const ordered = sortPluginEntries(
      [entry("zulu"), entry("alpha")],
      "recently-added",
    );
    expect(ordered.map((candidate) => candidate.entryId)).toEqual([
      "alpha",
      "zulu",
    ]);
  });
});
