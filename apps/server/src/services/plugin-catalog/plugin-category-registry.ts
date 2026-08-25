import {
  PLUGIN_CATALOG_CATEGORY_IDS,
  type PluginCatalogCategoryId,
  type PluginCatalogResolvedCategoryId,
} from "@bb/server-contract";
import { listPluginMarketplaces, type DbQueryConnection } from "@bb/db";
import {
  entryScreenshotUrls,
  parseMarketplaceManifestJson,
} from "./marketplace-manifest.js";
import type { MarketplaceEntry } from "./marketplace-manifest.js";

export interface PluginCatalogCategory {
  id: PluginCatalogCategoryId;
  displayName: string;
}

/**
 * The one editable category registry. IDs are persisted in marketplace
 * entries; display names may change without re-filing a plugin.
 */
export const PLUGIN_CATALOG_CATEGORIES = [
  { id: "themes-and-appearance", displayName: "Themes & Appearance" },
  {
    id: "thread-lists-and-navigation",
    displayName: "Thread Lists & Navigation",
  },
  {
    id: "thread-messages-and-timelines",
    displayName: "Thread Messages & Timelines",
  },
  { id: "composer-and-prompts", displayName: "Composer & Prompts" },
  { id: "memory-and-context", displayName: "Memory & Context" },
  { id: "agent-tools", displayName: "Agent Tools" },
  { id: "security", displayName: "Security" },
  { id: "agents-and-providers", displayName: "Agents & Providers" },
  { id: "token-usage-and-cost", displayName: "Token Usage & Cost" },
  {
    id: "notifications-and-attention",
    displayName: "Notifications & Attention",
  },
  { id: "code-and-reviews", displayName: "Code & Reviews" },
  { id: "files-and-viewers", displayName: "Files & Viewers" },
  { id: "machines-and-hosts", displayName: "Machines & Hosts" },
  { id: "plugin-development", displayName: "Plugin Development" },
  { id: "task-tracking", displayName: "Task Tracking" },
  { id: "automation", displayName: "Automation" },
] as const satisfies readonly PluginCatalogCategory[];

if (
  PLUGIN_CATALOG_CATEGORIES.length !== PLUGIN_CATALOG_CATEGORY_IDS.length ||
  PLUGIN_CATALOG_CATEGORIES.some(
    (category, index) => category.id !== PLUGIN_CATALOG_CATEGORY_IDS[index],
  )
) {
  throw new Error("plugin category registry does not match the public IDs");
}

export const OTHER_PLUGIN_CATALOG_CATEGORY = {
  id: "other",
  displayName: "Other",
} as const;

const categoryById = new Map<
  PluginCatalogResolvedCategoryId,
  { id: PluginCatalogResolvedCategoryId; displayName: string }
>([
  ...PLUGIN_CATALOG_CATEGORIES.map(
    (category) => [category.id, category] as const,
  ),
  [OTHER_PLUGIN_CATALOG_CATEGORY.id, OTHER_PLUGIN_CATALOG_CATEGORY],
]);

/**
 * Reviewed taxonomy for the 63 BB Community entries at get-bb/marketplace
 * commit 410621e9d0190a1711623dac8a02db1a8a2a83b2. The marketplace repository
 * uses this map to seed its single source-entry model before projecting v1
 * and v2. Runtime v1 fallback never applies it: v1 remains untouched and its
 * entries resolve to Other.
 */
export const REVIEWED_COMMUNITY_ENTRY_CATEGORIES = {
  ayu: "themes-and-appearance",
  monokai: "themes-and-appearance",
  fonts: "themes-and-appearance",
  pets: "themes-and-appearance",
  "theme-toggle": "themes-and-appearance",
  "tokyo-night": "themes-and-appearance",

  "arc-switcher": "thread-lists-and-navigation",
  cascade: "thread-lists-and-navigation",
  "gtd-sidebar": "thread-lists-and-navigation",
  t3sidebar: "thread-lists-and-navigation",
  "thread-namer": "thread-lists-and-navigation",
  "tinted-threads": "thread-lists-and-navigation",

  "bb-better-latex": "thread-messages-and-timelines",
  "emoji-react": "thread-messages-and-timelines",
  "image-preview": "thread-messages-and-timelines",
  "message-timestamps": "thread-messages-and-timelines",
  "bb-rpiv-todo-renderer": "thread-messages-and-timelines",
  "session-notes": "thread-messages-and-timelines",
  "sticky-notes": "thread-messages-and-timelines",

  dispatch: "composer-and-prompts",
  "prompt-enhancer": "composer-and-prompts",
  prompts: "composer-and-prompts",
  rephrase: "composer-and-prompts",

  noema: "memory-and-context",
  "progressive-skill": "memory-and-context",
  "project-instructions": "memory-and-context",

  advisor: "agent-tools",
  noisegate: "agent-tools",
  perspectives: "agent-tools",
  rtk: "agent-tools",
  unslop: "agent-tools",

  "security-guidance": "security",

  "agent-proxy": "agents-and-providers",
  amp: "agents-and-providers",
  handoff: "agents-and-providers",

  "context-meter": "token-usage-and-cost",
  headroom: "token-usage-and-cost",
  lanes: "token-usage-and-cost",
  "usage-page": "token-usage-and-cost",
  "usage-tracker": "token-usage-and-cost",
  usage: "token-usage-and-cost",

  chime: "notifications-and-attention",
  attention: "notifications-and-attention",
  notify: "notifications-and-attention",
  ntfy: "notifications-and-attention",
  "web-push-notify": "notifications-and-attention",

  callstack: "code-and-reviews",
  dependabot: "code-and-reviews",
  "gh-stack": "code-and-reviews",
  gitlab: "code-and-reviews",
  slopcop: "code-and-reviews",

  monaco: "files-and-viewers",

  "disk-usage": "machines-and-hosts",
  "floating-terminal": "machines-and-hosts",
  "worktree-setup": "machines-and-hosts",
  "wterm-terminal-preview": "machines-and-hosts",

  agentation: "plugin-development",
  "agentation-mentions": "plugin-development",
  "bb-ui-reference": "plugin-development",
  traces: "plugin-development",

  "agent-checklists": "task-tracking",
  taskboard: "task-tracking",

  "global-workflows": "automation",
} as const satisfies Record<string, PluginCatalogCategoryId>;

/** Resolve a stable category ID to the current display record. */
export function pluginCatalogCategory(
  categoryId: PluginCatalogResolvedCategoryId,
): { id: PluginCatalogResolvedCategoryId; displayName: string } {
  const category = categoryById.get(categoryId);
  if (category === undefined) {
    throw new Error(`unknown plugin category ${JSON.stringify(categoryId)}`);
  }
  return category;
}

/**
 * Resolve discovery metadata without interpreting tags. V1 is the immutable
 * legacy contract and always maps to Other; v2 carries the stable category.
 */
export function marketplaceEntryCategoryId(args: {
  schemaVersion: 1 | 2;
  entry: MarketplaceEntry;
}): PluginCatalogResolvedCategoryId {
  if (args.schemaVersion === 1) return "other";
  return args.entry.category ?? "other";
}

export interface PluginCatalogListingMetadata {
  categoryId: PluginCatalogResolvedCategoryId;
  category: string;
  screenshots: string[];
}

/** Collision-free identity of an entry within one marketplace. */
export function marketplaceEntryKey(
  marketplaceName: string,
  entryId: string,
): string {
  return `${marketplaceName}\u0000${entryId}`;
}

/**
 * Listing metadata projected onto installed catalog plugins. Corrupt stored
 * documents are omitted here; the catalog service reports them and Installed
 * keeps the explicit Other/empty defaults.
 */
export function marketplaceListingMetadata(
  db: DbQueryConnection,
): Map<string, PluginCatalogListingMetadata> {
  const metadata = new Map<string, PluginCatalogListingMetadata>();
  for (const row of listPluginMarketplaces(db)) {
    try {
      const catalog = parseMarketplaceManifestJson(
        row.manifestJson,
        `stored "${row.name}" marketplace catalog`,
      );
      const screenshotBase =
        row.sourceKind === "https"
          ? ({ kind: "url", manifestUrl: row.manifestUrl } as const)
          : ({ kind: "dir", root: "" } as const);
      for (const entry of catalog.plugins) {
        const category = pluginCatalogCategory(
          marketplaceEntryCategoryId({
            schemaVersion: catalog.schemaVersion,
            entry,
          }),
        );
        metadata.set(marketplaceEntryKey(row.name, entry.id), {
          categoryId: category.id,
          category: category.displayName,
          screenshots: entryScreenshotUrls(entry, screenshotBase),
        });
      }
    } catch {
      // The catalog service owns refresh errors; plugin inventory stays usable.
    }
  }
  return metadata;
}
