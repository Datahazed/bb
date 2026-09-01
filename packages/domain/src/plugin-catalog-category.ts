import { z } from "zod";

const PLUGIN_CATALOG_CATEGORY_FAMILY_ACCENT_TOKENS = {
  experience: "--plugin-category-family-experience",
  agentWork: "--plugin-category-family-agent-work",
  oversight: "--plugin-category-family-oversight",
  development: "--plugin-category-family-development",
  environment: "--plugin-category-family-environment",
} as const;

export const PLUGIN_CATALOG_CATEGORIES = [
  {
    id: "themes-and-appearance",
    displayName: "Themes & Appearance",
    description: "Personalize how bb looks and feels.",
    accentToken: PLUGIN_CATALOG_CATEGORY_FAMILY_ACCENT_TOKENS.experience,
  },
  {
    id: "thread-lists-and-navigation",
    displayName: "Thread Management",
    description: "Find, identify, organize, or archive threads.",
    accentToken: PLUGIN_CATALOG_CATEGORY_FAMILY_ACCENT_TOKENS.experience,
  },
  {
    id: "thread-content",
    displayName: "Thread Content",
    description: "Change what people see or do inside an open thread.",
    accentToken: PLUGIN_CATALOG_CATEGORY_FAMILY_ACCENT_TOKENS.experience,
  },
  {
    id: "memory-and-context",
    displayName: "Memory & Context",
    description:
      "Control durable knowledge or standing context available to agents.",
    accentToken: PLUGIN_CATALOG_CATEGORY_FAMILY_ACCENT_TOKENS.agentWork,
  },
  {
    id: "security",
    displayName: "Security",
    description: "Protect credentials or prevent unsafe code.",
    accentToken: PLUGIN_CATALOG_CATEGORY_FAMILY_ACCENT_TOKENS.oversight,
  },
  {
    id: "agents-and-providers",
    displayName: "Agents & Providers",
    description:
      "Add, choose, configure, route, or coordinate who runs a thread.",
    accentToken: PLUGIN_CATALOG_CATEGORY_FAMILY_ACCENT_TOKENS.agentWork,
  },
  {
    id: "token-usage-and-cost",
    displayName: "Token Usage & Limits",
    description:
      "Understand or control token, context-window, and provider-quota use.",
    accentToken: PLUGIN_CATALOG_CATEGORY_FAMILY_ACCENT_TOKENS.oversight,
  },
  {
    id: "notifications-and-attention",
    displayName: "Notifications",
    description: "Know when work finished, failed, or needs attention.",
    accentToken: PLUGIN_CATALOG_CATEGORY_FAMILY_ACCENT_TOKENS.oversight,
  },
  {
    id: "code-and-reviews",
    displayName: "Code & Reviews",
    description:
      "Work with repositories, builds, changes, pull requests, issues, and reviews.",
    accentToken: PLUGIN_CATALOG_CATEGORY_FAMILY_ACCENT_TOKENS.development,
  },
  {
    id: "files-and-viewers",
    displayName: "File Viewers & Editors",
    description: "Browse, open, preview, or edit files and document vaults.",
    accentToken: PLUGIN_CATALOG_CATEGORY_FAMILY_ACCENT_TOKENS.development,
  },
  {
    id: "remote-development",
    displayName: "Cloud & Remote",
    description:
      "Run bb work in cloud environments or access bb from elsewhere.",
    accentToken: PLUGIN_CATALOG_CATEGORY_FAMILY_ACCENT_TOKENS.environment,
  },
  {
    id: "terminals",
    displayName: "Command Line",
    description: "Work with shells and command-line programs inside bb.",
    accentToken: PLUGIN_CATALOG_CATEGORY_FAMILY_ACCENT_TOKENS.environment,
  },
  {
    id: "system-management",
    displayName: "Machines & Hosts",
    description: "Monitor and control the machines bb runs on.",
    accentToken: PLUGIN_CATALOG_CATEGORY_FAMILY_ACCENT_TOKENS.environment,
  },
  {
    id: "plugin-development",
    displayName: "Plugin Development",
    description:
      "Understand, inspect, build, or debug bb and its plugin surfaces.",
    accentToken: PLUGIN_CATALOG_CATEGORY_FAMILY_ACCENT_TOKENS.development,
  },
  {
    id: "tasks-workflows",
    displayName: "Tasks & Workflows",
    description: "Plan, track, route, schedule, or automate work.",
    accentToken: PLUGIN_CATALOG_CATEGORY_FAMILY_ACCENT_TOKENS.agentWork,
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
