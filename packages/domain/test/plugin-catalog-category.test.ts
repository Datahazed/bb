import { describe, expect, it } from "vitest";

import {
  PLUGIN_CATALOG_CATEGORIES,
  PLUGIN_CATALOG_CATEGORY_IDS,
  PLUGIN_CATALOG_SHELF_GROUPS,
  pluginCatalogCategory,
  pluginCatalogCategoryIdSchema,
  pluginCatalogShelfGroupForCategory,
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

  it("assigns every canonical category to exactly one browse shelf", () => {
    const groupedCategoryIds = PLUGIN_CATALOG_SHELF_GROUPS.flatMap(
      (group) => group.categoryIds,
    );

    expect(PLUGIN_CATALOG_SHELF_GROUPS).toHaveLength(5);
    expect(groupedCategoryIds).toHaveLength(PLUGIN_CATALOG_CATEGORIES.length);
    expect(new Set(groupedCategoryIds).size).toBe(
      PLUGIN_CATALOG_CATEGORIES.length,
    );
    expect(new Set(groupedCategoryIds)).toEqual(
      new Set(PLUGIN_CATALOG_CATEGORY_IDS),
    );

    for (const group of PLUGIN_CATALOG_SHELF_GROUPS) {
      expect(group.displayName).not.toHaveLength(0);
      expect(group.description).not.toHaveLength(0);
      for (const categoryId of group.categoryIds) {
        expect(pluginCatalogShelfGroupForCategory(categoryId)).toBe(group);
      }
    }
  });
});
