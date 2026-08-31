import {
  createConnection,
  getPluginMarketplace,
  migrate,
  upsertPluginMarketplace,
} from "@bb/db";
import {
  PLUGIN_CATALOG_CATEGORY_IDS,
} from "@bb/server-contract";
import { describe, expect, it, vi } from "vitest";
import {
  createStoredMarketplaceCatalogReader,
  marketplaceEntryCategoryId,
  marketplaceEntryKey,
  marketplaceListingMetadata,
  PLUGIN_CATALOG_CATEGORIES,
  REVIEWED_COMMUNITY_ENTRY_CATEGORIES,
} from "../../../src/services/plugin-catalog/plugin-category-registry.js";
import {
  parseMarketplaceManifestJson,
  type MarketplaceEntry,
} from "../../../src/services/plugin-catalog/marketplace-manifest.js";
import { BUNDLED_PLUGINS } from "../../../src/services/plugins/builtin-registry.js";

function entry(
  id: string,
  category?: MarketplaceEntry["category"],
): MarketplaceEntry {
  return {
    id,
    displayName: id,
    description: id,
    icon: "Zap",
    ...(category === undefined ? {} : { category }),
    author: { name: "Test" },
    source: { npm: { package: `bb-plugin-${id}` } },
  };
}

describe("plugin category registry", () => {
  it("uses the canonical category records in stable id order", () => {
    expect(PLUGIN_CATALOG_CATEGORIES.map((category) => category.id)).toEqual(
      PLUGIN_CATALOG_CATEGORY_IDS,
    );
    expect(PLUGIN_CATALOG_CATEGORIES).toHaveLength(15);
  });

  it("keeps reviewed community entry ids unique and categories valid", () => {
    const ids = Object.keys(REVIEWED_COMMUNITY_ENTRY_CATEGORIES);
    const validCategoryIds = new Set(PLUGIN_CATALOG_CATEGORY_IDS);

    expect(ids).toHaveLength(87);
    expect(new Set(ids).size).toBe(ids.length);
    const assignedCategoryIds = Object.values(
      REVIEWED_COMMUNITY_ENTRY_CATEGORIES,
    );
    for (const categoryId of assignedCategoryIds) {
      expect(validCategoryIds.has(categoryId)).toBe(true);
    }
    expect(new Set(assignedCategoryIds)).toEqual(validCategoryIds);
  });

  it("uses v2 declarations and preserves category absence for v1", () => {
    expect(
      marketplaceEntryCategoryId({
        schemaVersion: 2,
        entry: entry("later-entry", "security"),
      }),
    ).toBe("security");
    expect(
      marketplaceEntryCategoryId({
        schemaVersion: 1,
        entry: entry("later-entry"),
      }),
    ).toBeUndefined();
    expect(
      marketplaceEntryCategoryId({
        schemaVersion: 1,
        entry: entry("advisor", "code-and-reviews"),
      }),
    ).toBeUndefined();
  });

  it("files every bundled plugin under one reviewed category", () => {
    const validIds = new Set(PLUGIN_CATALOG_CATEGORY_IDS);
    expect(BUNDLED_PLUGINS).not.toHaveLength(0);
    for (const plugin of BUNDLED_PLUGINS) {
      expect(validIds.has(plugin.category)).toBe(true);
    }
  });

  it("keys parsed catalogs by database, row identity, and successful refresh", () => {
    const db = createConnection(":memory:");
    migrate(db);
    const store = (
      connection: typeof db,
      name: string,
      lastSuccessfulRefreshAt: number,
    ) => {
      upsertPluginMarketplace(connection, {
        name,
        sourceKind: "https",
        manifestUrl: "https://plugins.example/marketplace.json",
        sourceGitRef: null,
        sourceGitCommit: null,
        manifestJson: JSON.stringify({
          schemaVersion: 2,
          name,
          displayName: name === "acme" ? "Acme" : "Other",
          newAndNotable: [],
          plugins: [entry("listed", "thread-content")],
        }),
        statsJson: null,
        etag: null,
        lastModified: null,
        lastSuccessfulRefreshAt,
        lastAttemptedRefreshAt: lastSuccessfulRefreshAt,
        lastError: null,
      });
      const row = getPluginMarketplace(connection, name);
      if (row === undefined) throw new Error("missing marketplace fixture");
      return row;
    };
    const parse = vi.fn(parseMarketplaceManifestJson);
    const read = createStoredMarketplaceCatalogReader(parse);

    expect(read(db, store(db, "acme", 1)).displayName).toBe("Acme");
    expect(read(db, store(db, "acme", 1)).displayName).toBe("Acme");
    expect(parse).toHaveBeenCalledTimes(1);

    expect(read(db, store(db, "other", 1)).displayName).toBe("Other");
    expect(parse).toHaveBeenCalledTimes(2);

    const otherDb = createConnection(":memory:");
    migrate(otherDb);
    expect(read(otherDb, store(otherDb, "acme", 1)).displayName).toBe("Acme");
    expect(parse).toHaveBeenCalledTimes(3);

    expect(read(db, store(db, "acme", 2)).displayName).toBe("Acme");
    expect(parse).toHaveBeenCalledTimes(4);
    otherDb.$client.close();
    db.$client.close();
  });

  it("projects listing metadata only for requested installed entry keys", () => {
    const db = createConnection(":memory:");
    migrate(db);
    upsertPluginMarketplace(db, {
      name: "acme",
      sourceKind: "https",
      manifestUrl: "https://plugins.example/marketplace.json",
      sourceGitRef: null,
      sourceGitCommit: null,
      manifestJson: JSON.stringify({
        schemaVersion: 2,
        name: "acme",
        displayName: "Acme",
        newAndNotable: [],
        plugins: [
          entry("installed", "thread-content"),
          entry("not-installed", "security"),
        ],
      }),
      statsJson: null,
      etag: null,
      lastModified: null,
      lastSuccessfulRefreshAt: 1,
      lastAttemptedRefreshAt: 1,
      lastError: null,
    });

    const installedKey = marketplaceEntryKey("acme", "installed");
    expect(
      marketplaceListingMetadata(db, new Set([installedKey])),
    ).toEqual(
      new Map([
        [
          installedKey,
          {
            categoryId: "thread-content",
            category: "Thread Content",
            screenshots: [],
          },
        ],
      ]),
    );
    db.$client.close();
  });
});
