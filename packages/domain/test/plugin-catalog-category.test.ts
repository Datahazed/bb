import { describe, expect, it } from "vitest";

import {
  PLUGIN_CATALOG_CATEGORIES,
  PLUGIN_CATALOG_CATEGORY_IDS,
  pluginCatalogCategory,
  pluginCatalogCategoryIdSchema,
} from "../src/plugin-catalog-category.js";

describe("plugin catalog categories", () => {
  it("keeps one complete, ordered record for every stable category id", () => {
    expect(PLUGIN_CATALOG_CATEGORIES).toHaveLength(16);
    expect(new Set(PLUGIN_CATALOG_CATEGORY_IDS).size).toBe(16);
    expect(PLUGIN_CATALOG_CATEGORY_IDS).toEqual(
      PLUGIN_CATALOG_CATEGORIES.map((category) => category.id),
    );

    for (const category of PLUGIN_CATALOG_CATEGORIES) {
      expect(category.displayName).not.toHaveLength(0);
      expect(category.description).not.toHaveLength(0);
      expect(pluginCatalogCategory(category.id)).toBe(category);
      expect(pluginCatalogCategoryIdSchema.parse(category.id)).toBe(
        category.id,
      );
    }
  });

  it("keeps the category vocabulary closed", () => {
    expect(pluginCatalogCategoryIdSchema.safeParse("Other").success).toBe(
      false,
    );
    expect(pluginCatalogCategoryIdSchema.safeParse("other").success).toBe(
      false,
    );
  });
});
