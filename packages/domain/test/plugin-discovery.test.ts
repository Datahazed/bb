import { describe, expect, it } from "vitest";
import {
  pluginDiscoveryNewAndNotableEntries,
  pluginDiscoveryShelves,
  defaultPluginDiscoverySortDirection,
  sortPluginDiscoveryEntries,
  visiblePluginCategoryChipCount,
  type PluginCatalogCategoryId,
  type PluginDiscoveryEntryAccessors,
} from "../src/index.js";

interface TestCategory {
  id: PluginCatalogCategoryId;
}

interface TestEntry {
  id: string;
  name: string;
  category?: TestCategory;
  installs?: number;
  publishedAt?: string;
  notableRank?: number;
}

const accessors = {
  entryId: (entry: TestEntry) => entry.id,
  displayName: (entry: TestEntry) => entry.name,
  category: (entry: TestEntry) => entry.category,
  categoryId: (category: TestCategory) => category.id,
  installs: (entry: TestEntry) => entry.installs,
  publishedAt: (entry: TestEntry) => entry.publishedAt,
} satisfies PluginDiscoveryEntryAccessors<TestEntry, TestCategory>;

function entry(id: string, overrides: Partial<TestEntry> = {}): TestEntry {
  return {
    id,
    name: id,
    category: { id: "agent-tools" },
    ...overrides,
  };
}

describe("plugin discovery projections", () => {
  it("orders shelves by size, then taxonomy order, and skips uncategorized entries", () => {
    const shelves = pluginDiscoveryShelves(
      [
        entry("security", { category: { id: "security" } }),
        entry("agent-b"),
        entry("agent-a"),
        entry("theme-b", { category: { id: "themes-and-appearance" } }),
        entry("theme-a", { category: { id: "themes-and-appearance" } }),
        entry("legacy", { category: undefined }),
      ],
      accessors,
    );

    expect(
      shelves.map((shelf) => [
        shelf.category.id,
        shelf.entries.map(({ id }) => id),
      ]),
    ).toEqual([
      ["themes-and-appearance", ["theme-a", "theme-b"]],
      ["agent-tools", ["agent-a", "agent-b"]],
      ["security", ["security"]],
    ]);
  });

  it("uses curated rank before the six newest categorized entries", () => {
    expect(
      pluginDiscoveryNewAndNotableEntries(
        [
          entry("second", { notableRank: 1 }),
          entry("first", { notableRank: 0 }),
        ],
        {
          ...accessors,
          newAndNotableRank: (candidate) => candidate.notableRank,
        },
      ).map(({ id }) => id),
    ).toEqual(["first", "second"]);

    expect(
      pluginDiscoveryNewAndNotableEntries(
        [
          entry("day-18", { publishedAt: "2026-08-18T09:30:00Z" }),
          entry("day-19", { publishedAt: "2026-08-19T09:30:00Z" }),
          entry("day-20", { publishedAt: "2026-08-20T09:30:00Z" }),
          entry("day-21", { publishedAt: "2026-08-21T09:30:00Z" }),
          entry("day-22", { publishedAt: "2026-08-22T09:30:00Z" }),
          entry("day-23", { publishedAt: "2026-08-23T09:30:00Z" }),
          entry("day-24", { publishedAt: "2026-08-24T09:30:00Z" }),
          entry("legacy", {
            category: undefined,
            publishedAt: "2026-08-25T09:30:00Z",
          }),
        ],
        { ...accessors, newAndNotableRank: () => undefined },
      ).map(({ id }) => id),
    ).toEqual(["day-24", "day-23", "day-22", "day-21", "day-20", "day-19"]);
  });

  it("sorts known metrics first without fabricating values", () => {
    expect(
      sortPluginDiscoveryEntries(
        [
          entry("unknown"),
          entry("smaller", { installs: 2 }),
          entry("larger", { installs: 10 }),
        ],
        "most-installed",
        accessors,
      ).map(({ id }) => id),
    ).toEqual(["larger", "smaller", "unknown"]);

    expect(
      sortPluginDiscoveryEntries(
        [
          entry("unknown-date"),
          entry("older", { publishedAt: "2026-08-20T09:30:00Z" }),
          entry("newer", { publishedAt: "2026-08-24T09:30:00Z" }),
        ],
        "recently-added",
        accessors,
      ).map(({ id }) => id),
    ).toEqual(["newer", "older", "unknown-date"]);
  });

  it("sorts every criterion in both directions while keeping unknown metrics last", () => {
    const entries = [
      entry("unknown", { name: "Middle" }),
      entry("older", {
        name: "Alpha",
        installs: 2,
        publishedAt: "2026-08-20T09:30:00Z",
      }),
      entry("newer", {
        name: "Zulu",
        installs: 10,
        publishedAt: "2026-08-24T09:30:00Z",
      }),
    ];

    expect(defaultPluginDiscoverySortDirection("name")).toBe("asc");
    expect(defaultPluginDiscoverySortDirection("recently-added")).toBe("desc");
    expect(defaultPluginDiscoverySortDirection("most-installed")).toBe("desc");
    expect(
      sortPluginDiscoveryEntries(entries, "name", accessors, "desc").map(
        ({ id }) => id,
      ),
    ).toEqual(["newer", "unknown", "older"]);
    expect(
      sortPluginDiscoveryEntries(
        entries,
        "most-installed",
        accessors,
        "asc",
      ).map(({ id }) => id),
    ).toEqual(["older", "newer", "unknown"]);
    expect(
      sortPluginDiscoveryEntries(
        entries,
        "recently-added",
        accessors,
        "asc",
      ).map(({ id }) => id),
    ).toEqual(["older", "newer", "unknown"]);
  });

  it("adds overflow only once the exact chip row no longer fits", () => {
    const widths = {
      allWidth: 40,
      categoryWidths: [70, 70, 70],
      overflowWidthsByHiddenCount: [0, 60, 60, 60],
      gap: 8,
    };
    expect(
      visiblePluginCategoryChipCount({ ...widths, containerWidth: 274 }),
    ).toBe(3);
    expect(
      visiblePluginCategoryChipCount({ ...widths, containerWidth: 273 }),
    ).toBe(2);
  });
});
