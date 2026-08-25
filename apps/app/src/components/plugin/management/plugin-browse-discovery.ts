import { PLUGIN_CATALOG_CATEGORY_IDS } from "@bb/server-contract";
import type { PluginCatalogSearchEntry } from "@/hooks/queries/plugin-catalog-queries";

export type PluginBrowseSort = "recently-added" | "most-installed" | "name";

export interface PluginCategoryShelf {
  id: PluginCatalogSearchEntry["categoryId"];
  label: string;
  entries: PluginCatalogSearchEntry[];
}

const CATEGORY_ORDER = new Map<string, number>(
  PLUGIN_CATALOG_CATEGORY_IDS.map((categoryId, index) => [categoryId, index]),
);

/**
 * Groups every entry exactly once. Shelf size is the primary order; the
 * registry's stable order breaks ties, and uncategorized entries stay last.
 */
export function categoryShelves(
  entries: readonly PluginCatalogSearchEntry[],
): PluginCategoryShelf[] {
  const groups = new Map<string, PluginCategoryShelf>();
  for (const entry of entries) {
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
    if (left.id === "other") return right.id === "other" ? 0 : 1;
    if (right.id === "other") return -1;
    return (
      right.entries.length - left.entries.length ||
      (CATEGORY_ORDER.get(left.id) ?? CATEGORY_ORDER.size) -
        (CATEGORY_ORDER.get(right.id) ?? CATEGORY_ORDER.size)
    );
  });
}

/** Curated order wins; v1 and an empty curated list fall back to newest. */
export function newAndNotableEntries(
  entries: readonly PluginCatalogSearchEntry[],
): PluginCatalogSearchEntry[] {
  const curated = entries
    .filter((entry) => entry.official && entry.newAndNotableRank !== null)
    .sort(
      (left, right) =>
        (left.newAndNotableRank ?? 0) - (right.newAndNotableRank ?? 0) ||
        compareNames(left, right),
    );
  if (curated.length > 0) return curated;

  return [...entries].sort(comparePublishedAt).slice(0, 6);
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
