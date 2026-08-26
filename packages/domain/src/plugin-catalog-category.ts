import { z } from "zod";

/**
 * Stable discovery taxonomy for plugin marketplace entries. IDs are persisted
 * in manifests; display copy may change without re-filing an entry.
 */
export const PLUGIN_CATALOG_CATEGORIES = [
  {
    id: "themes-and-appearance",
    displayName: "Themes & Appearance",
    description: "Palettes, typography, and visual customization for bb.",
  },
  {
    id: "thread-lists-and-navigation",
    displayName: "Thread Lists & Navigation",
    description: "Organize thread lists and move through your work.",
  },
  {
    id: "thread-messages-and-timelines",
    displayName: "Thread Messages & Timelines",
    description: "Render and augment what appears inside a thread.",
  },
  {
    id: "composer-and-prompts",
    displayName: "Composer & Prompts",
    description: "Change what you type and how prompts are sent.",
  },
  {
    id: "memory-and-context",
    displayName: "Memory & Context",
    description: "Shape what agents know before they start.",
  },
  {
    id: "agent-tools",
    displayName: "Agent Tools",
    description: "Give agents new capabilities and focused helpers.",
  },
  {
    id: "security",
    displayName: "Security",
    description: "Protect credentials, code, and sensitive workflows.",
  },
  {
    id: "agents-and-providers",
    displayName: "Agents & Providers",
    description: "Add agents, providers, and session handoffs.",
  },
  {
    id: "token-usage-and-cost",
    displayName: "Token Usage & Cost",
    description: "Understand model spend, limits, and context budget.",
  },
  {
    id: "notifications-and-attention",
    displayName: "Notifications & Attention",
    description: "Know when work finishes or needs your attention.",
  },
  {
    id: "code-and-reviews",
    displayName: "Code & Reviews",
    description: "Work with repositories, pull requests, checks, and reviews.",
  },
  {
    id: "files-and-viewers",
    displayName: "Files & Viewers",
    description: "Open, preview, and edit files inside bb.",
  },
  {
    id: "machines-and-hosts",
    displayName: "Machines & Hosts",
    description: "Work with terminals, remote machines, and storage.",
  },
  {
    id: "plugin-development",
    displayName: "Plugin Development",
    description: "Inspect bb and build plugins against its public surfaces.",
  },
  {
    id: "task-tracking",
    displayName: "Task Tracking",
    description: "Track work with boards, lists, and checklists.",
  },
  {
    id: "automation",
    displayName: "Automation",
    description: "Run schedules, triggers, and agent pipelines.",
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

const pluginCatalogCategoryById = new Map<
  PluginCatalogCategoryId,
  PluginCatalogCategory
>(PLUGIN_CATALOG_CATEGORIES.map((category) => [category.id, category]));

export function pluginCatalogCategory(
  categoryId: PluginCatalogCategoryId,
): PluginCatalogCategory {
  const category = pluginCatalogCategoryById.get(categoryId);
  if (category === undefined) {
    throw new Error(`unknown plugin category ${JSON.stringify(categoryId)}`);
  }
  return category;
}
