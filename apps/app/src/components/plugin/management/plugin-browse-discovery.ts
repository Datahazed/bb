import { PLUGIN_CATALOG_CATEGORY_IDS } from "@bb/server-contract";
import type { PluginCatalogSearchEntry } from "@/hooks/queries/plugin-catalog-queries";

export type PluginBrowseSort = "recently-added" | "most-installed" | "name";

export type CategorizedPluginCatalogEntry = PluginCatalogSearchEntry & {
  categoryId: NonNullable<PluginCatalogSearchEntry["categoryId"]>;
  category: string;
};

export interface PluginCategoryShelf {
  id: CategorizedPluginCatalogEntry["categoryId"];
  label: string;
  entries: CategorizedPluginCatalogEntry[];
}

export interface PluginPublisherGroup {
  key: string;
  label: string;
  thirdParty: boolean;
  entries: PluginCatalogSearchEntry[];
}

export function hasPluginCatalogCategory(
  entry: PluginCatalogSearchEntry,
): entry is CategorizedPluginCatalogEntry {
  return entry.categoryId !== undefined && entry.category !== undefined;
}

const CATEGORY_ORDER = new Map<string, number>(
  PLUGIN_CATALOG_CATEGORY_IDS.map((categoryId, index) => [categoryId, index]),
);

/**
 * Groups each categorized entry exactly once. Shelf size is the primary
 * order, and the registry's stable order breaks ties.
 */
export function categoryShelves(
  entries: readonly PluginCatalogSearchEntry[],
): PluginCategoryShelf[] {
  const groups = new Map<string, PluginCategoryShelf>();
  for (const entry of entries) {
    if (!hasPluginCatalogCategory(entry)) continue;
    const group = groups.get(entry.categoryId);
    if (group === undefined) {
      groups.set(entry.categoryId, {
        id: entry.categoryId,
        label: entry.category,
        entries: [entry],
      });
    } else {
      group.entries.push(entry);
    }
  }

  for (const group of groups.values()) {
    group.entries.sort(compareNames);
  }

  return [...groups.values()].sort((left, right) => {
    return (
      right.entries.length - left.entries.length ||
      (CATEGORY_ORDER.get(left.id) ?? CATEGORY_ORDER.size) -
        (CATEGORY_ORDER.get(right.id) ?? CATEGORY_ORDER.size)
    );
  });
}

/** Curated order wins; a categorized catalog without one falls back to newest. */
export function newAndNotableEntries(
  entries: readonly PluginCatalogSearchEntry[],
): CategorizedPluginCatalogEntry[] {
  const categorized = entries.filter(hasPluginCatalogCategory);
  const curated = categorized
    .filter((entry) => entry.official && entry.newAndNotableRank !== null)
    .sort(
      (left, right) =>
        (left.newAndNotableRank ?? 0) - (right.newAndNotableRank ?? 0) ||
        compareNames(left, right),
    );
  if (curated.length > 0) return curated;

  return [...categorized].sort(comparePublishedAt).slice(0, 6);
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
): PluginCatalogSearchEntry[] {
  return [...entries].sort((left, right) => {
    if (sort === "name") return compareNames(left, right);
    if (sort === "most-installed") {
      return (
        compareOptionalNumbersDescending(
          left.installCount,
          right.installCount,
        ) || compareNames(left, right)
      );
    }
    return comparePublishedAt(left, right);
  });
}

function comparePublishedAt(
  left: PluginCatalogSearchEntry,
  right: PluginCatalogSearchEntry,
): number {
  return (
    compareOptionalNumbersDescending(
      left.publishedAt === undefined ? undefined : Date.parse(left.publishedAt),
      right.publishedAt === undefined
        ? undefined
        : Date.parse(right.publishedAt),
    ) || compareNames(left, right)
  );
}

function compareOptionalNumbersDescending(
  left: number | undefined,
  right: number | undefined,
): number {
  if (left === undefined) return right === undefined ? 0 : 1;
  if (right === undefined) return -1;
  return right - left;
}

function compareNames(
  left: PluginCatalogSearchEntry,
  right: PluginCatalogSearchEntry,
): number {
  return (
    left.displayName.localeCompare(right.displayName) ||
    left.entryId.localeCompare(right.entryId)
  );
}

/**
 * Returns how many category chips fit beside the always-visible All chip and
 * an exact-width overflow control. Overflow is absent when every chip fits.
 */
export function visibleCategoryChipCount(args: {
  containerWidth: number;
  allWidth: number;
  categoryWidths: readonly number[];
  overflowWidthsByHiddenCount: readonly number[];
  gap: number;
}): number {
  const { categoryWidths } = args;
  const allChipsWidth =
    args.allWidth +
    categoryWidths.reduce((total, width) => total + width, 0) +
    args.gap * categoryWidths.length;
  if (allChipsWidth <= args.containerWidth) return categoryWidths.length;

  let visibleWidth = args.allWidth;
  for (let visible = 0; visible < categoryWidths.length; visible += 1) {
    const nextVisible = visible + 1;
    const hidden = categoryWidths.length - nextVisible;
    const overflowWidth = args.overflowWidthsByHiddenCount[hidden] ?? 0;
    const candidateWidth =
      visibleWidth +
      args.gap +
      categoryWidths[visible]! +
      (hidden > 0 ? args.gap + overflowWidth : 0);
    if (candidateWidth > args.containerWidth) return visible;
    visibleWidth += args.gap + categoryWidths[visible]!;
  }
  return categoryWidths.length;
}
