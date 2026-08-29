import { describe, expect, it } from "vitest";

import {
  PLUGIN_CATALOG_CATEGORIES,
  PLUGIN_CATALOG_CATEGORY_IDS,
  pluginCatalogCategory,
  pluginCatalogCategoryAccentToken,
  pluginCatalogCategoryIdSchema,
} from "../src/plugin-catalog-category.js";

describe("plugin catalog categories", () => {
  it("keeps one complete, ordered record for every stable category id", () => {
    expect(PLUGIN_CATALOG_CATEGORIES).toHaveLength(15);
    expect(new Set(PLUGIN_CATALOG_CATEGORY_IDS).size).toBe(15);
    expect(PLUGIN_CATALOG_CATEGORY_IDS).toEqual([
      "themes-and-appearance",
      "thread-lists-and-navigation",
      "thread-content",
      "memory-and-context",
      "security",
      "agents-and-providers",
      "token-usage-and-cost",
      "notifications-and-attention",
      "code-and-reviews",
      "files-and-viewers",
      "remote-development",
      "terminals",
      "system-management",
      "plugin-development",
      "tasks-workflows",
    ]);
    expect(PLUGIN_CATALOG_CATEGORY_IDS).toEqual(
      PLUGIN_CATALOG_CATEGORIES.map((category) => category.id),
    );

    for (const category of PLUGIN_CATALOG_CATEGORIES) {
      expect(category.displayName).not.toHaveLength(0);
      expect(category.description).not.toHaveLength(0);
      expect(category.accentToken).toMatch(/^--/u);
      expect(pluginCatalogCategory(category.id)).toBe(category);
      expect(pluginCatalogCategoryAccentToken(category.id)).toBe(
        category.accentToken,
      );
      expect(pluginCatalogCategoryIdSchema.parse(category.id)).toBe(
        category.id,
      );
    }
  });

  it("uses the approved category display names", () => {
    expect(
      PLUGIN_CATALOG_CATEGORIES.map((category) => category.displayName),
    ).toEqual([
      "Themes & Appearance",
      "Thread Management",
      "Thread Content",
      "Memory & Context",
      "Security",
      "Agents & Providers",
      "Token Usage & Limits",
      "Notifications",
      "Code & Reviews",
      "File Viewers & Editors",
      "Cloud & Remote",
      "Command Line",
      "Utilities",
      "Plugin Development",
      "Tasks & Workflows",
    ]);
  });

  it("keeps the category vocabulary closed", () => {
    expect(pluginCatalogCategoryIdSchema.safeParse("Other").success).toBe(
      false,
    );
    expect(pluginCatalogCategoryIdSchema.safeParse("other").success).toBe(
      false,
    );
  });

  it("leaves unknown or absent categories without an accent", () => {
    expect(pluginCatalogCategoryAccentToken(undefined)).toBeUndefined();
    expect(pluginCatalogCategoryAccentToken("not-a-category")).toBeUndefined();
  });
});
