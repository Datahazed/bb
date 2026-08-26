import {
  PLUGIN_CATALOG_SHELF_GROUPS,
  defaultPluginDiscoverySortDirection,
  pluginDiscoveryNewAndNotableEntries,
  pluginDiscoveryShelves,
  sortPluginDiscoveryEntries,
  visiblePluginCategoryChipCount,
  type PluginDiscoveryEntryAccessors,
  type PluginDiscoverySort,
  type PluginDiscoverySortDirection,
  type PluginCatalogShelfGroupId,
} from "@bb/domain";
import type { PluginCatalogSearchEntry } from "@/hooks/queries/plugin-catalog-queries";

export type PluginBrowseSort = PluginDiscoverySort;
export type PluginBrowseSortDirection = PluginDiscoverySortDirection;

export type CategorizedPluginCatalogEntry = PluginCatalogSearchEntry & {
  categoryId: NonNullable<PluginCatalogSearchEntry["categoryId"]>;
  category: string;
};

export interface PluginCategoryShelf {
  id: CategorizedPluginCatalogEntry["categoryId"];
  label: string;
  entries: CategorizedPluginCatalogEntry[];
}

export interface PluginBrowseShelfGroup {
  id: PluginCatalogShelfGroupId;
  label: string;
  description: string;
  categoryIds: readonly CategorizedPluginCatalogEntry["categoryId"][];
  entries: CategorizedPluginCatalogEntry[];
}

export interface PluginPublisherGroup {
  key: string;
  label: string;
  thirdParty: boolean;
  entries: PluginCatalogSearchEntry[];
}

interface AppPluginCategory {
  id: CategorizedPluginCatalogEntry["categoryId"];
  label: string;
}

export function hasPluginCatalogCategory(
  entry: PluginCatalogSearchEntry,
): entry is CategorizedPluginCatalogEntry {
  return entry.categoryId !== undefined && entry.category !== undefined;
}

const DISCOVERY_ACCESSORS = {
  entryId: (entry: PluginCatalogSearchEntry) => entry.entryId,
  displayName: (entry: PluginCatalogSearchEntry) => entry.displayName,
  category: (entry: PluginCatalogSearchEntry): AppPluginCategory | undefined =>
    hasPluginCatalogCategory(entry)
      ? { id: entry.categoryId, label: entry.category }
      : undefined,
  categoryId: (category: AppPluginCategory) => category.id,
  installCount: (entry: PluginCatalogSearchEntry) => entry.installCount,
  publishedAt: (entry: PluginCatalogSearchEntry) => entry.publishedAt,
} satisfies PluginDiscoveryEntryAccessors<
  PluginCatalogSearchEntry,
  AppPluginCategory
>;

/** Groups categorized entries while leaving v1 fallback entries ungrouped. */
export function categoryShelves(
  entries: readonly PluginCatalogSearchEntry[],
): PluginCategoryShelf[] {
  return pluginDiscoveryShelves(entries, DISCOVERY_ACCESSORS).map((shelf) => ({
    id: shelf.category.id,
    label: shelf.category.label,
    entries: shelf.entries.filter(hasPluginCatalogCategory),
  }));
}

/** Groups categorized entries into the five presentation shelves. */
export function browseShelfGroups(
  entries: readonly PluginCatalogSearchEntry[],
): PluginBrowseShelfGroup[] {
  const categorizedEntries = entries.filter(hasPluginCatalogCategory);
  return PLUGIN_CATALOG_SHELF_GROUPS.map((group) => {
    const categoryIds = new Set(group.categoryIds);
    return {
      id: group.id,
      label: group.displayName,
      description: group.description,
      categoryIds: group.categoryIds,
      entries: categorizedEntries
        .filter((entry) => categoryIds.has(entry.categoryId))
        .sort((left, right) =>
          left.displayName.localeCompare(right.displayName),
        ),
    };
  }).filter((group) => group.entries.length > 0);
}

/** Curated official order wins; a categorized catalog falls back to newest. */
export function newAndNotableEntries(
  entries: readonly PluginCatalogSearchEntry[],
): CategorizedPluginCatalogEntry[] {
  return pluginDiscoveryNewAndNotableEntries(entries, {
    ...DISCOVERY_ACCESSORS,
    newAndNotableRank: (entry) =>
      entry.official && entry.newAndNotableRank !== null
        ? entry.newAndNotableRank
        : undefined,
  }).filter(hasPluginCatalogCategory);
}

/** Publisher groups preserve the caller's entry order within each group. */
export function publisherGroups(
  entries: readonly PluginCatalogSearchEntry[],
): PluginPublisherGroup[] {
  const groups: PluginPublisherGroup[] = [];
  for (const entry of entries) {
    let group = groups.find(
      (candidate) => candidate.key === entry.publisherKey,
    );
    if (group === undefined) {
      group = {
        key: entry.publisherKey,
        label: entry.publisherLabel,
        thirdParty: !entry.official,
        entries: [],
      };
      groups.push(group);
    }
    group.entries.push(entry);
  }
  return groups;
}

export function sortPluginEntries(
  entries: readonly PluginCatalogSearchEntry[],
  sort: PluginBrowseSort,
  direction: PluginBrowseSortDirection = defaultPluginDiscoverySortDirection(
    sort,
  ),
): PluginCatalogSearchEntry[] {
  return sortPluginDiscoveryEntries(
    entries,
    sort,
    DISCOVERY_ACCESSORS,
    direction,
  );
}

export const visibleCategoryChipCount = visiblePluginCategoryChipCount;
