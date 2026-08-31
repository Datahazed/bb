import {
  defaultPluginDiscoverySortDirection,
  pluginCatalogCategory,
  pluginDiscoveryNewAndNotableEntries,
  pluginDiscoveryShelves,
  sortPluginDiscoveryEntries,
  visiblePluginCategoryChipCount,
  type PluginDiscoveryEntryAccessors,
  type PluginDiscoverySort,
  type PluginDiscoverySortDirection,
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
  description: string;
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

export function pluginInstalls(
  entry: PluginCatalogSearchEntry,
): number | undefined {
  return entry.installs ?? undefined;
}

const DISCOVERY_ACCESSORS = {
  entryId: (entry: PluginCatalogSearchEntry) => entry.entryId,
  displayName: (entry: PluginCatalogSearchEntry) => entry.displayName,
  category: (entry: PluginCatalogSearchEntry): AppPluginCategory | undefined =>
    hasPluginCatalogCategory(entry)
      ? { id: entry.categoryId, label: entry.category }
      : undefined,
  categoryId: (category: AppPluginCategory) => category.id,
  installs: pluginInstalls,
  publishedAt: (entry: PluginCatalogSearchEntry) => entry.publishedAt,
} satisfies PluginDiscoveryEntryAccessors<
  PluginCatalogSearchEntry,
  AppPluginCategory
>;

export function categoryShelves(
  entries: readonly PluginCatalogSearchEntry[],
): PluginCategoryShelf[] {
  return pluginDiscoveryShelves(entries, DISCOVERY_ACCESSORS).map((shelf) => {
    const category = pluginCatalogCategory(shelf.category.id);
    return {
      id: category.id,
      label: category.displayName,
      description: category.description,
      entries: shelf.entries.filter(hasPluginCatalogCategory),
    };
  });
}

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
