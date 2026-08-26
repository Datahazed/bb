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

/**
 * Browse-page presentation groups over the stable category taxonomy.
 *
 * These deliberately do not replace category metadata. They merge the nine
 * discovery themes (Appearance, Threads & Chat, Agents, Work, Code &
 * Integrations, Machines & Hosts, Insights & Alerts, Security, Build for bb)
 * into five shelves sized for the live catalog. Filters and manifests continue
 * to use the sixteen canonical category IDs above.
 */
export const PLUGIN_CATALOG_SHELF_GROUPS = [
  {
    id: "threads-and-interface",
    displayName: "Threads & Interface",
    description:
      "Shape bb's navigation, conversations, prompts, and appearance.",
    categoryIds: [
      "themes-and-appearance",
      "thread-lists-and-navigation",
      "thread-messages-and-timelines",
      "composer-and-prompts",
    ],
  },
  {
    id: "agents-and-workflows",
    displayName: "Agents & Workflows",
    description: "Add providers, context, tools, automation, and task systems.",
    categoryIds: [
      "memory-and-context",
      "agent-tools",
      "agents-and-providers",
      "task-tracking",
      "automation",
    ],
  },
  {
    id: "code-and-integrations",
    displayName: "Code & Integrations",
    description: "Work with code, files, reviews, and the bb plugin platform.",
    categoryIds: [
      "code-and-reviews",
      "files-and-viewers",
      "plugin-development",
    ],
  },
  {
    id: "insights-and-security",
    displayName: "Insights & Security",
    description: "Track usage and attention while protecting sensitive work.",
    categoryIds: [
      "token-usage-and-cost",
      "notifications-and-attention",
      "security",
    ],
  },
  {
    id: "machines-and-hosts",
    displayName: "Machines & Hosts",
    description: "Operate terminals, remote machines, ports, and storage.",
    categoryIds: ["machines-and-hosts"],
  },
] as const satisfies readonly {
  id: string;
  displayName: string;
  description: string;
  categoryIds: readonly PluginCatalogCategoryId[];
}[];

export type PluginCatalogShelfGroup =
  (typeof PLUGIN_CATALOG_SHELF_GROUPS)[number];
export type PluginCatalogShelfGroupId = PluginCatalogShelfGroup["id"];

const pluginCatalogShelfGroupByCategoryId = new Map<
  PluginCatalogCategoryId,
  PluginCatalogShelfGroup
>(
  PLUGIN_CATALOG_SHELF_GROUPS.flatMap((group) =>
    group.categoryIds.map((categoryId) => [categoryId, group] as const),
  ),
);

export function pluginCatalogShelfGroupForCategory(
  categoryId: PluginCatalogCategoryId,
): PluginCatalogShelfGroup {
  const group = pluginCatalogShelfGroupByCategoryId.get(categoryId);
  if (group === undefined) {
    throw new Error(
      `plugin category ${JSON.stringify(categoryId)} has no shelf group`,
    );
  }
  return group;
}

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
