import {
  PLUGIN_CATALOG_CATEGORIES,
  pluginDiscoveryNewAndNotableEntries,
  pluginDiscoveryShelves,
  sortPluginDiscoveryEntries,
  type PluginDiscoveryEntryAccessors,
  type PluginDiscoverySort,
} from "@bb/domain";
import type {
  MarketplaceCategoryId,
  MarketplaceV2Entry,
  MarketplaceV2Manifest,
} from "./marketplace-v2.js";

export type MarketplaceSort = PluginDiscoverySort;

export const MARKETPLACE_CATEGORIES: ReadonlyArray<{
  id: MarketplaceCategoryId;
  label: string;
  description: string;
}> = PLUGIN_CATALOG_CATEGORIES.map((category) => ({
  id: category.id,
  label: category.displayName,
  description: category.description,
}));

const CATEGORY_BY_ID = new Map(
  MARKETPLACE_CATEGORIES.map((category) => [category.id, category]),
);

type MarketplaceCategory = (typeof MARKETPLACE_CATEGORIES)[number];

export interface MarketplaceShelf {
  category: MarketplaceCategory;
  entries: MarketplaceV2Entry[];
}

export function marketplaceCategory(
  id: MarketplaceCategoryId,
): MarketplaceCategory {
  const category = CATEGORY_BY_ID.get(id);
  if (category === undefined) {
    throw new Error(`unknown marketplace category ${JSON.stringify(id)}`);
  }
  return category;
}

const DISCOVERY_ACCESSORS = {
  entryId: (entry: MarketplaceV2Entry) => entry.id,
  displayName: (entry: MarketplaceV2Entry) => entry.displayName,
  category: (entry: MarketplaceV2Entry) => marketplaceCategory(entry.category),
  categoryId: (category: MarketplaceCategory) => category.id,
  installCount: (entry: MarketplaceV2Entry) => entry.installCount,
  publishedAt: (entry: MarketplaceV2Entry) => entry.publishedAt,
} satisfies PluginDiscoveryEntryAccessors<
  MarketplaceV2Entry,
  MarketplaceCategory
>;

export function marketplaceShelves(
  entries: readonly MarketplaceV2Entry[],
): MarketplaceShelf[] {
  return pluginDiscoveryShelves(entries, DISCOVERY_ACCESSORS);
}

export function newAndNotableEntries(
  manifest: MarketplaceV2Manifest,
): MarketplaceV2Entry[] {
  const curatedOrder = new Map(
    manifest.newAndNotable.map((entryId, index) => [entryId, index]),
  );
  return pluginDiscoveryNewAndNotableEntries(manifest.plugins, {
    ...DISCOVERY_ACCESSORS,
    newAndNotableRank: (entry) => curatedOrder.get(entry.id),
  });
}

export function filterMarketplaceEntries(
  entries: readonly MarketplaceV2Entry[],
  query: string,
): MarketplaceV2Entry[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (normalized.length === 0) return [...entries];
  return entries.filter((entry) => {
    const category = marketplaceCategory(entry.category);
    return [
      entry.displayName,
      entry.description,
      entry.id,
      entry.category,
      entry.author.name,
      entry.author.github,
      category.label,
      ...(entry.tags ?? []),
    ]
      .filter((value) => value !== undefined)
      .some((value) => value.toLocaleLowerCase().includes(normalized));
  });
}

export function sortMarketplaceEntries(
  entries: readonly MarketplaceV2Entry[],
  sort: MarketplaceSort,
): MarketplaceV2Entry[] {
  return sortPluginDiscoveryEntries(entries, sort, DISCOVERY_ACCESSORS);
}

export function marketplaceDetailPath(entryId: string): string {
  return `/marketplace/${encodeURIComponent(entryId)}`;
}

export function marketplaceAssetUrl(declared: string): string {
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(declared)) return declared;
  return new URL(declared, "https://getbb.app/marketplace/v2/marketplace.json")
    .pathname;
}

export function marketplaceInstallCommand(entryId: string): string {
  return `bb plugin install ${entryId}`;
}

export function marketplaceInstallDeepLink(entryId: string): string {
  return `bb://extensions/plugins/${encodeURIComponent(entryId)}?install=1`;
}

export function marketplaceRepositoryUrl(
  entry: MarketplaceV2Entry,
): string | null {
  if ("npm" in entry.source) {
    return entry.source.npm.registry === undefined
      ? `https://www.npmjs.com/package/${entry.source.npm.package}`
      : null;
  }
  return entry.source.git.url.replace(/\.git$/u, "");
}

/**
 * Keep the user-visible fallback deterministic and prove the deeplink is the
 * first attempted side effect. Callers inject the browser operations so the
 * sequencing is directly testable without launching another application.
 */
export function attemptMarketplaceInstall(args: {
  entryId: string;
  openDeepLink: (href: string) => void;
  revealFallback: (command: string) => void;
}): void {
  args.openDeepLink(marketplaceInstallDeepLink(args.entryId));
  args.revealFallback(marketplaceInstallCommand(args.entryId));
}

export function formatInstallCount(value: number | undefined): string | null {
  if (value === undefined) return null;
  return new Intl.NumberFormat("en-US", { notation: "compact" }).format(value);
}

export function formatMarketplaceDate(
  value: string | undefined,
): string | null {
  if (value === undefined) return null;
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}
