import { z } from "zod";

/**
 * Stable discovery taxonomy for plugin marketplace entries. IDs are persisted
 * in manifests; display copy may change without re-filing an entry.
 */
export const PLUGIN_CATALOG_CATEGORIES = [
  {
    id: "themes-and-appearance",
    displayName: "Themes & Appearance",
    description: "Personalize how bb looks and feels.",
    accentToken: "--file-accent",
  },
  {
    id: "thread-lists-and-navigation",
    displayName: "Thread Management",
    description: "Find, identify, organize, or archive threads.",
    accentToken: "--file-accent",
  },
  {
    id: "thread-content",
    displayName: "Thread Content",
    description: "Change what people see or do inside an open thread.",
    accentToken: "--file-accent",
  },
  {
    id: "memory-and-context",
    displayName: "Memory & Context",
    description:
      "Control durable knowledge or standing context available to agents.",
    accentToken: "--success",
  },
  {
    id: "security",
    displayName: "Security",
    description: "Protect credentials or prevent unsafe code.",
    accentToken: "--warning",
  },
  {
    id: "agents-and-providers",
    displayName: "Agents & Providers",
    description:
      "Add, choose, configure, route, or coordinate who runs a thread.",
    accentToken: "--success",
  },
  {
    id: "token-usage-and-cost",
    displayName: "Token Usage & Limits",
    description:
      "Understand or control token, context-window, and provider-quota use.",
    accentToken: "--warning",
  },
  {
    id: "notifications-and-attention",
    displayName: "Notifications",
    description: "Know when work finished, failed, or needs attention.",
    accentToken: "--warning",
  },
  {
    id: "code-and-reviews",
    displayName: "Code & Reviews",
    description:
      "Work with repositories, builds, changes, pull requests, issues, and reviews.",
    accentToken: "--pr-merged",
  },
  {
    id: "files-and-viewers",
    displayName: "File Viewers & Editors",
    description: "Browse, open, preview, or edit files and document vaults.",
    accentToken: "--pr-merged",
  },
  {
    id: "remote-development",
    displayName: "Cloud & Remote",
    description:
      "Run bb work in cloud environments or access bb from elsewhere.",
    accentToken: "--attention",
  },
  {
    id: "terminals",
    displayName: "Command Line",
    description: "Work with shells and command-line programs inside bb.",
    accentToken: "--attention",
  },
  {
    id: "system-management",
    displayName: "Utilities",
    description: "Inspect or control the computers bb runs on.",
    accentToken: "--attention",
  },
  {
    id: "plugin-development",
    displayName: "Plugin Development",
    description:
      "Understand, inspect, build, or debug bb and its plugin surfaces.",
    accentToken: "--pr-merged",
  },
  {
    id: "tasks-workflows",
    displayName: "Tasks & Workflows",
    description: "Plan, track, route, schedule, or automate work.",
    accentToken: "--success",
  },
] as const;

export type PluginCatalogCategory = (typeof PLUGIN_CATALOG_CATEGORIES)[number];
export type PluginCatalogCategoryId = PluginCatalogCategory["id"];

export const PLUGIN_CATALOG_CATEGORY_IDS = Object.freeze(
  PLUGIN_CATALOG_CATEGORIES.map((category) => category.id),
);

export const pluginCatalogCategoryIdSchema = z.enum(
  PLUGIN_CATALOG_CATEGORY_IDS,
);

const pluginCatalogCategoryById = new Map<string, PluginCatalogCategory>(
  PLUGIN_CATALOG_CATEGORIES.map((category) => [category.id, category]),
);

/** The semantic accent carried by a category pill, never author artwork. */
export function pluginCatalogCategoryAccentToken(
  categoryId: string | undefined,
): string | undefined {
  return categoryId === undefined
    ? undefined
    : pluginCatalogCategoryById.get(categoryId)?.accentToken;
}

export function pluginCatalogCategory(
  categoryId: PluginCatalogCategoryId,
): PluginCatalogCategory {
  const category = pluginCatalogCategoryById.get(categoryId);
  if (category === undefined) {
    throw new Error(`unknown plugin category ${JSON.stringify(categoryId)}`);
  }
  return category;
}
