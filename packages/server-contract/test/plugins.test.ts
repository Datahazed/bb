import { describe, expect, it } from "vitest";
import {
  pluginCatalogInstallRequestSchema,
  pluginCatalogSearchResultSchema,
  pluginCatalogStatusSchema,
} from "../src/index.js";

describe("plugin catalog contracts", () => {
  it("accepts catalog install coordinates without marketplace nesting", () => {
    expect(
      pluginCatalogInstallRequestSchema.parse({
        entryId: "notes",
      }),
    ).toEqual({ entryId: "notes" });
    expect(() =>
      pluginCatalogInstallRequestSchema.parse({
        entryId: "notes",
        version: "1.2.0",
      }),
    ).toThrow();
    expect(() =>
      pluginCatalogInstallRequestSchema.parse({
        marketplace: { marketplaceId: "official", entryId: "notes" },
      }),
    ).toThrow();
  });

  it("keeps status to the bundled plugin count and search fields required", () => {
    const status = {
      pluginCount: 13,
      includedPluginCount: 8,
      optionalPluginCount: 5,
    };
    expect(pluginCatalogStatusSchema.parse(status)).toEqual(status);
    // Refresh-era freshness fields no longer survive parsing.
    expect(
      pluginCatalogStatusSchema.parse({ ...status, lastError: null }),
    ).toEqual(status);

    expect(() =>
      pluginCatalogSearchResultSchema.parse({
        entryId: "notes",
        displayName: "Notes",
        description: "Notes",
        icon: null,
        category: "Productivity",
        source: "builtin:notes",
        installed: false,
        compatible: true,
        incompatibleReason: null,
      }),
    ).toThrow();
  });

  it("adds discovery fields without breaking older search responses", () => {
    const parsed = pluginCatalogSearchResultSchema.parse({
      entryId: "notes",
      pluginId: "notes",
      displayName: "Notes",
      description: "Notes",
      icon: null,
      iconUrl: null,
      category: "Other",
      source: "builtin:notes",
      marketplace: "bb-community",
      marketplaceDisplayName: "BB Community",
      publisherKey: "builtin",
      publisherLabel: "BB Official",
      official: true,
      author: null,
      installed: false,
      compatible: true,
      incompatibleReason: null,
    });

    expect(parsed).toMatchObject({
      categoryId: "other",
      category: "Other",
      screenshots: [],
      newAndNotableRank: null,
    });
    expect(parsed).not.toHaveProperty("installCount");
    expect(parsed).not.toHaveProperty("publishedAt");
    expect(parsed).not.toHaveProperty("updatedAt");
  });

  it("preserves only valid supplied catalog discovery statistics", () => {
    const requiredFields = {
      entryId: "notes",
      pluginId: "notes",
      displayName: "Notes",
      description: "Notes",
      icon: null,
      iconUrl: null,
      source: "builtin:notes",
      marketplace: "bb-community",
      marketplaceDisplayName: "BB Community",
      publisherKey: "builtin",
      publisherLabel: "BB Official",
      official: true,
      author: null,
      installed: false,
      compatible: true,
      incompatibleReason: null,
    };
    expect(
      pluginCatalogSearchResultSchema.parse({
        ...requiredFields,
        installCount: 0,
        publishedAt: "2026-08-20T09:30:00Z",
        updatedAt: "2026-08-24T16:45:00+02:00",
      }),
    ).toMatchObject({
      installCount: 0,
      publishedAt: "2026-08-20T09:30:00Z",
      updatedAt: "2026-08-24T16:45:00+02:00",
    });
    expect(() =>
      pluginCatalogSearchResultSchema.parse({
        ...requiredFields,
        installCount: -1,
      }),
    ).toThrow();
    expect(() =>
      pluginCatalogSearchResultSchema.parse({
        ...requiredFields,
        publishedAt: "not-a-date",
      }),
    ).toThrow();
  });
});
