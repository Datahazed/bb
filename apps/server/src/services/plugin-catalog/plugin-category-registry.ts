import {
  PLUGIN_CATALOG_CATEGORIES,
  PLUGIN_CATALOG_CATEGORY_IDS,
  pluginCatalogCategory,
  type PluginCatalogCategory,
  type PluginCatalogCategoryId,
} from "@bb/domain";
import {
  listPluginMarketplaces,
  type DbQueryConnection,
  type PluginMarketplaceRow,
} from "@bb/db";
import {
  entryScreenshotUrls,
  parseMarketplaceManifestJson,
} from "./marketplace-manifest.js";
import type {
  MarketplaceEntry,
  MarketplaceManifest,
} from "./marketplace-manifest.js";

export {
  PLUGIN_CATALOG_CATEGORIES,
  PLUGIN_CATALOG_CATEGORY_IDS,
  pluginCatalogCategory,
  type PluginCatalogCategory,
};

export const REVIEWED_COMMUNITY_ENTRY_DATES: Readonly<
  Record<string, { publishedAt: string; updatedAt: string }>
> = {
  advisor: {
    publishedAt: "2026-08-20T21:49:37+03:00",
    updatedAt: "2026-08-20T21:49:37+03:00",
  },
  "agent-checklists": {
    publishedAt: "2026-08-18T14:36:45-04:00",
    updatedAt: "2026-08-18T14:36:45-04:00",
  },
  "agent-proxy": {
    publishedAt: "2026-08-18T11:36:03-07:00",
    updatedAt: "2026-08-18T11:36:03-07:00",
  },
  agentation: {
    publishedAt: "2026-08-17T20:55:34-03:00",
    updatedAt: "2026-08-19T13:10:02-07:00",
  },
  "agentation-mentions": {
    publishedAt: "2026-08-20T15:48:20-03:00",
    updatedAt: "2026-08-20T15:48:20-03:00",
  },
  amp: {
    publishedAt: "2026-08-18T11:36:07-07:00",
    updatedAt: "2026-08-18T11:36:07-07:00",
  },
  "arc-switcher": {
    publishedAt: "2026-08-17T16:46:44-06:00",
    updatedAt: "2026-08-17T16:46:44-06:00",
  },
  attention: {
    publishedAt: "2026-08-18T14:48:39-04:00",
    updatedAt: "2026-08-18T14:48:39-04:00",
  },
  "audio-preview": {
    publishedAt: "2026-08-24T18:45:12-04:00",
    updatedAt: "2026-08-24T18:45:12-04:00",
  },
  "auto-archive": {
    publishedAt: "2026-08-24T18:44:23-04:00",
    updatedAt: "2026-08-24T18:44:23-04:00",
  },
  autorouter: {
    publishedAt: "2026-08-24T15:44:47-07:00",
    updatedAt: "2026-08-24T15:44:47-07:00",
  },
  ayu: {
    publishedAt: "2026-08-18T16:39:49+02:00",
    updatedAt: "2026-08-18T16:39:49+02:00",
  },
  "bb-better-latex": {
    publishedAt: "2026-08-19T02:35:58+08:00",
    updatedAt: "2026-08-19T02:35:58+08:00",
  },
  "bb-rpiv-todo-renderer": {
    publishedAt: "2026-08-19T02:35:53+08:00",
    updatedAt: "2026-08-19T02:35:53+08:00",
  },
  "bb-sidebar": {
    publishedAt: "2026-08-24T17:45:36-05:00",
    updatedAt: "2026-08-24T17:45:36-05:00",
  },
  "bb-ui-reference": {
    publishedAt: "2026-08-18T15:35:49-03:00",
    updatedAt: "2026-08-20T15:48:26-03:00",
  },
  bots: {
    publishedAt: "2026-08-25T04:15:50+05:30",
    updatedAt: "2026-08-25T04:15:50+05:30",
  },
  callstack: {
    publishedAt: "2026-08-20T11:47:04-07:00",
    updatedAt: "2026-08-20T11:47:04-07:00",
  },
  cascade: {
    publishedAt: "2026-08-14T23:49:10Z",
    updatedAt: "2026-08-14T23:56:38Z",
  },
  chime: {
    publishedAt: "2026-08-19T04:36:37+10:00",
    updatedAt: "2026-08-19T04:36:37+10:00",
  },
  "context-meter": {
    publishedAt: "2026-08-18T15:35:42-03:00",
    updatedAt: "2026-08-18T15:35:42-03:00",
  },
  "copy-session-id": {
    publishedAt: "2026-08-24T18:46:23-04:00",
    updatedAt: "2026-08-24T18:46:23-04:00",
  },
  dependabot: {
    publishedAt: "2026-08-20T14:48:30-04:00",
    updatedAt: "2026-08-20T14:48:30-04:00",
  },
  "disk-usage": {
    publishedAt: "2026-08-20T14:48:41-04:00",
    updatedAt: "2026-08-20T14:48:41-04:00",
  },
  dispatch: {
    publishedAt: "2026-08-18T14:48:30-04:00",
    updatedAt: "2026-08-18T14:48:30-04:00",
  },
  "emoji-react": {
    publishedAt: "2026-08-20T14:47:10-04:00",
    updatedAt: "2026-08-20T14:47:10-04:00",
  },
  "file-manager": {
    publishedAt: "2026-08-25T01:46:14+03:00",
    updatedAt: "2026-08-25T01:46:14+03:00",
  },
  "floating-terminal": {
    publishedAt: "2026-08-19T22:10:26+02:00",
    updatedAt: "2026-08-25T00:45:45+02:00",
  },
  fonts: {
    publishedAt: "2026-08-21T04:47:50+10:00",
    updatedAt: "2026-08-21T04:47:50+10:00",
  },
  "gh-stack": {
    publishedAt: "2026-08-18T11:36:11-07:00",
    updatedAt: "2026-08-18T11:36:11-07:00",
  },
  "git-history": {
    publishedAt: "2026-08-24T17:45:08-05:00",
    updatedAt: "2026-08-24T17:45:08-05:00",
  },
  gitlab: {
    publishedAt: "2026-08-18T20:35:38+02:00",
    updatedAt: "2026-08-18T20:35:38+02:00",
  },
  "global-workflows": {
    publishedAt: "2026-08-18T14:35:34-04:00",
    updatedAt: "2026-08-18T14:35:34-04:00",
  },
  "gtd-sidebar": {
    publishedAt: "2026-08-18T11:36:24-07:00",
    updatedAt: "2026-08-18T11:36:24-07:00",
  },
  handoff: {
    publishedAt: "2026-08-19T22:10:30+02:00",
    updatedAt: "2026-08-19T22:10:30+02:00",
  },
  headroom: {
    publishedAt: "2026-08-21T04:47:16+10:00",
    updatedAt: "2026-08-21T04:47:16+10:00",
  },
  "image-preview": {
    publishedAt: "2026-08-18T19:35:46+01:00",
    updatedAt: "2026-08-18T19:35:46+01:00",
  },
  lanes: {
    publishedAt: "2026-08-18T14:35:26-04:00",
    updatedAt: "2026-08-18T14:35:26-04:00",
  },
  "message-timestamps": {
    publishedAt: "2026-08-17T19:09:33-06:00",
    updatedAt: "2026-08-17T19:09:33-06:00",
  },
  monaco: {
    publishedAt: "2026-08-20T19:36:35-07:00",
    updatedAt: "2026-08-20T19:36:35-07:00",
  },
  monokai: {
    publishedAt: "2026-08-18T11:36:15-07:00",
    updatedAt: "2026-08-18T11:36:15-07:00",
  },
  noema: {
    publishedAt: "2026-08-21T04:47:22+10:00",
    updatedAt: "2026-08-21T04:47:22+10:00",
  },
  noisegate: {
    publishedAt: "2026-08-21T04:47:26+10:00",
    updatedAt: "2026-08-21T04:47:26+10:00",
  },
  notify: {
    publishedAt: "2026-08-18T11:36:20-07:00",
    updatedAt: "2026-08-18T11:36:20-07:00",
  },
  ntfy: {
    publishedAt: "2026-08-17T19:41:45-04:00",
    updatedAt: "2026-08-17T19:41:45-04:00",
  },
  "pdf-viewer": {
    publishedAt: "2026-08-25T01:45:41+03:00",
    updatedAt: "2026-08-25T01:45:41+03:00",
  },
  perspectives: {
    publishedAt: "2026-08-20T15:46:59-03:00",
    updatedAt: "2026-08-20T15:46:59-03:00",
  },
  pets: {
    publishedAt: "2026-08-18T16:39:38+02:00",
    updatedAt: "2026-08-18T16:39:38+02:00",
  },
  ports: {
    publishedAt: "2026-08-25T05:46:04+07:00",
    updatedAt: "2026-08-25T05:46:04+07:00",
  },
  "progressive-skill": {
    publishedAt: "2026-08-21T04:47:31+10:00",
    updatedAt: "2026-08-21T04:47:31+10:00",
  },
  "project-instructions": {
    publishedAt: "2026-08-20T15:48:10-03:00",
    updatedAt: "2026-08-20T15:48:10-03:00",
  },
  "prompt-enhancer": {
    publishedAt: "2026-08-19T22:10:21+02:00",
    updatedAt: "2026-08-19T22:10:21+02:00",
  },
  prompts: {
    publishedAt: "2026-08-19T22:10:16+02:00",
    updatedAt: "2026-08-19T22:10:16+02:00",
  },
  "provider-authentication": {
    publishedAt: "2026-08-24T15:45:55-07:00",
    updatedAt: "2026-08-24T15:45:55-07:00",
  },
  "provider-usage": {
    publishedAt: "2026-08-24T18:45:32-04:00",
    updatedAt: "2026-08-24T18:45:32-04:00",
  },
  rephrase: {
    publishedAt: "2026-08-18T20:36:41+02:00",
    updatedAt: "2026-08-18T20:36:41+02:00",
  },
  "repo-watch": {
    publishedAt: "2026-08-24T18:44:31-04:00",
    updatedAt: "2026-08-24T18:44:31-04:00",
  },
  rtk: {
    publishedAt: "2026-08-21T04:47:36+10:00",
    updatedAt: "2026-08-21T04:47:36+10:00",
  },
  "security-guidance": {
    publishedAt: "2026-08-21T04:47:40+10:00",
    updatedAt: "2026-08-21T04:47:40+10:00",
  },
  "server-status": {
    publishedAt: "2026-08-25T01:46:18+03:00",
    updatedAt: "2026-08-25T01:46:18+03:00",
  },
  "session-notes": {
    publishedAt: "2026-08-18T20:36:30+02:00",
    updatedAt: "2026-08-18T20:36:30+02:00",
  },
  "sidebar-filter": {
    publishedAt: "2026-08-24T18:44:39-04:00",
    updatedAt: "2026-08-24T18:44:39-04:00",
  },
  slopcop: {
    publishedAt: "2026-08-14T14:23:27Z",
    updatedAt: "2026-08-14T20:47:10Z",
  },
  "sticky-notes": {
    publishedAt: "2026-08-17T21:14:48-03:00",
    updatedAt: "2026-08-20T15:48:16-03:00",
  },
  t3sidebar: {
    publishedAt: "2026-08-14T23:49:15Z",
    updatedAt: "2026-08-14T23:49:15Z",
  },
  taskboard: {
    publishedAt: "2026-08-18T15:48:47-03:00",
    updatedAt: "2026-08-18T15:48:47-03:00",
  },
  "theme-toggle": {
    publishedAt: "2026-08-20T21:48:00+03:00",
    updatedAt: "2026-08-25T01:45:22+03:00",
  },
  "thread-namer": {
    publishedAt: "2026-08-20T20:48:05+02:00",
    updatedAt: "2026-08-20T20:48:05+02:00",
  },
  "thread-provider-icons": {
    publishedAt: "2026-08-24T18:45:27-04:00",
    updatedAt: "2026-08-24T18:45:27-04:00",
  },
  "tinted-threads": {
    publishedAt: "2026-08-19T04:36:33+10:00",
    updatedAt: "2026-08-19T04:36:33+10:00",
  },
  tokenmaxx: {
    publishedAt: "2026-08-24T19:46:27-03:00",
    updatedAt: "2026-08-24T19:46:27-03:00",
  },
  "tokyo-night": {
    publishedAt: "2026-08-19T16:10:06-04:00",
    updatedAt: "2026-08-19T16:10:06-04:00",
  },
  traces: {
    publishedAt: "2026-08-19T16:10:11-04:00",
    updatedAt: "2026-08-19T16:10:11-04:00",
  },
  "ui-tweaks": {
    publishedAt: "2026-08-24T23:46:09+01:00",
    updatedAt: "2026-08-24T23:46:09+01:00",
  },
  unslop: {
    publishedAt: "2026-08-21T04:47:45+10:00",
    updatedAt: "2026-08-21T04:47:45+10:00",
  },
  usage: {
    publishedAt: "2026-08-18T02:42:32+05:30",
    updatedAt: "2026-08-18T02:42:32+05:30",
  },
  "usage-meter": {
    publishedAt: "2026-08-25T01:45:59+03:00",
    updatedAt: "2026-08-25T01:45:59+03:00",
  },
  "usage-page": {
    publishedAt: "2026-08-18T19:35:22+01:00",
    updatedAt: "2026-08-18T19:35:22+01:00",
  },
  "usage-tracker": {
    publishedAt: "2026-08-17T21:24:32-03:00",
    updatedAt: "2026-08-17T21:24:32-03:00",
  },
  "web-push-notify": {
    publishedAt: "2026-08-18T04:45:37+05:30",
    updatedAt: "2026-08-18T04:45:37+05:30",
  },
  "worktree-setup": {
    publishedAt: "2026-08-20T01:40:34+05:30",
    updatedAt: "2026-08-21T00:17:55+05:30",
  },
  "wterm-terminal-preview": {
    publishedAt: "2026-08-18T21:35:30+03:00",
    updatedAt: "2026-08-18T21:35:30+03:00",
  },
};

export const REVIEWED_COMMUNITY_ENTRY_CATEGORIES: Readonly<
  Record<string, PluginCatalogCategoryId>
> = {
  "advisor": "code-and-reviews",
  "agent-plugins": "agents-and-providers",
  "agent-proxy": "agents-and-providers",
  "agentation": "plugin-development",
  "agentation-mentions": "plugin-development",
  "amp": "agents-and-providers",
  "arc-switcher": "thread-lists-and-navigation",
  "audio-preview": "files-and-viewers",
  "auto-archive": "thread-lists-and-navigation",
  "autorouter": "agents-and-providers",
  "ayu": "themes-and-appearance",
  "monokai": "themes-and-appearance",
  "bb-sidebar": "thread-lists-and-navigation",
  "bb-ui-reference": "plugin-development",
  "bb-better-latex": "thread-content",
  "bots": "agents-and-providers",
  "callstack": "code-and-reviews",
  "cascade": "thread-lists-and-navigation",
  "agent-checklists": "tasks-workflows",
  "chime": "notifications-and-attention",
  "cloud-sandbox": "remote-development",
  "code-review": "code-and-reviews",
  "context-meter": "token-usage-and-cost",
  "copy-session-id": "thread-lists-and-navigation",
  "dependabot": "code-and-reviews",
  "disk-usage": "system-management",
  "dispatch": "tasks-workflows",
  "emoji-react": "thread-content",
  "file-manager": "files-and-viewers",
  "floating-terminal": "terminals",
  "fonts": "themes-and-appearance",
  "git-history": "code-and-reviews",
  "gh-stack": "code-and-reviews",
  "gitlab": "code-and-reviews",
  "global-workflows": "tasks-workflows",
  "gtd-sidebar": "thread-lists-and-navigation",
  "handoff": "agents-and-providers",
  "headroom": "token-usage-and-cost",
  "image-preview": "thread-content",
  "lanes": "token-usage-and-cost",
  "linear": "tasks-workflows",
  "message-timestamps": "thread-content",
  "model-presets": "agents-and-providers",
  "attention": "notifications-and-attention",
  "noema": "memory-and-context",
  "noisegate": "thread-content",
  "notify": "notifications-and-attention",
  "ntfy": "notifications-and-attention",
  "pdf-viewer": "files-and-viewers",
  "perspectives": "agents-and-providers",
  "pets": "themes-and-appearance",
  "ports": "system-management",
  "pr-manager": "code-and-reviews",
  "progressive-skill": "memory-and-context",
  "project-instructions": "memory-and-context",
  "prompt-enhancer": "thread-content",
  "prompts": "thread-content",
  "provider-authentication": "agents-and-providers",
  "provider-usage": "token-usage-and-cost",
  "rephrase": "thread-content",
  "repo-watch": "code-and-reviews",
  "bb-rpiv-todo-renderer": "thread-content",
  "rtk": "token-usage-and-cost",
  "security-guidance": "security",
  "server-status": "system-management",
  "session-notes": "thread-content",
  "sidebar-filter": "thread-lists-and-navigation",
  "slopcop": "code-and-reviews",
  "sticky-notes": "thread-content",
  "t3sidebar": "thread-lists-and-navigation",
  "theme-toggle": "themes-and-appearance",
  "thread-inbox": "thread-lists-and-navigation",
  "thread-namer": "thread-lists-and-navigation",
  "thread-provider-icons": "thread-lists-and-navigation",
  "tinted-threads": "thread-lists-and-navigation",
  "tokenmaxx": "agents-and-providers",
  "tokyo-night": "themes-and-appearance",
  "traces": "plugin-development",
  "ui-tweaks": "themes-and-appearance",
  "unslop": "thread-content",
  "usage-page": "token-usage-and-cost",
  "usage": "token-usage-and-cost",
  "usage-meter": "token-usage-and-cost",
  "web-push-notify": "notifications-and-attention",
  "worktree-setup": "tasks-workflows",
  "wterm-terminal-preview": "terminals",
  "xcode": "code-and-reviews",
};

export function marketplaceEntryCategoryId(args: {
  schemaVersion: 1 | 2;
  entry: MarketplaceEntry;
}): PluginCatalogCategoryId | undefined {
  if (args.schemaVersion === 1) return undefined;
  if (args.entry.category === undefined) {
    throw new Error("marketplace v2 entry is missing its parsed category");
  }
  return args.entry.category;
}

export interface PluginCatalogListingMetadata {
  categoryId?: PluginCatalogCategoryId;
  category?: string;
  screenshots: string[];
}

export function marketplaceEntryKey(
  marketplaceName: string,
  entryId: string,
): string {
  return `${marketplaceName}\u0000${entryId}`;
}

type StoredMarketplaceCatalogParser = (
  raw: string,
  location: string,
) => MarketplaceManifest;

interface StoredMarketplaceCatalogCacheEntry {
  lastSuccessfulRefreshAt: number | null;
  manifestJson: string;
  catalog: MarketplaceManifest;
}

export function createStoredMarketplaceCatalogReader(
  parse: StoredMarketplaceCatalogParser = parseMarketplaceManifestJson,
): (db: DbQueryConnection, row: PluginMarketplaceRow) => MarketplaceManifest {
  const cacheByDb = new WeakMap<
    DbQueryConnection,
    Map<string, StoredMarketplaceCatalogCacheEntry>
  >();
  return (db, row) => {
    let cache = cacheByDb.get(db);
    if (cache === undefined) {
      cache = new Map();
      cacheByDb.set(db, cache);
    }
    const cached = cache.get(row.name);
    if (
      cached?.lastSuccessfulRefreshAt === row.lastSuccessfulRefreshAt &&
      cached.manifestJson === row.manifestJson
    ) {
      return cached.catalog;
    }
    const catalog = parse(
      row.manifestJson,
      `stored "${row.name}" marketplace catalog`,
    );
    cache.set(row.name, {
      lastSuccessfulRefreshAt: row.lastSuccessfulRefreshAt,
      manifestJson: row.manifestJson,
      catalog,
    });
    return catalog;
  };
}

const readStoredMarketplaceCatalog = createStoredMarketplaceCatalogReader();

export function marketplaceListingMetadata(
  db: DbQueryConnection,
  entryKeys: ReadonlySet<string>,
): Map<string, PluginCatalogListingMetadata> {
  const metadata = new Map<string, PluginCatalogListingMetadata>();
  const requestedEntries = new Map<string, Set<string>>();
  for (const key of entryKeys) {
    const separator = key.indexOf("\u0000");
    if (separator < 0) continue;
    const marketplaceName = key.slice(0, separator);
    const entryId = key.slice(separator + 1);
    const entryIds = requestedEntries.get(marketplaceName) ?? new Set<string>();
    entryIds.add(entryId);
    requestedEntries.set(marketplaceName, entryIds);
  }
  for (const row of listPluginMarketplaces(db)) {
    const requestedEntryIds = requestedEntries.get(row.name);
    if (requestedEntryIds === undefined) continue;
    try {
      const catalog = readStoredMarketplaceCatalog(db, row);
      const screenshotBase =
        row.sourceKind === "https"
          ? ({ kind: "url", manifestUrl: row.manifestUrl } as const)
          : ({ kind: "dir", root: "" } as const);
      for (const entry of catalog.plugins) {
        if (!requestedEntryIds.has(entry.id)) continue;
        const categoryId = marketplaceEntryCategoryId({
          schemaVersion: catalog.schemaVersion,
          entry,
        });
        const category =
          categoryId === undefined
            ? undefined
            : pluginCatalogCategory(categoryId);
        metadata.set(marketplaceEntryKey(row.name, entry.id), {
          ...(category === undefined
            ? {}
            : {
                categoryId: category.id,
                category: category.displayName,
              }),
          screenshots: entryScreenshotUrls(entry, screenshotBase),
        });
      }
    } catch {
    }
  }
  return metadata;
}
