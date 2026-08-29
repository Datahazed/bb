import {
  PLUGIN_CATALOG_CATEGORY_IDS,
  type PluginCatalogCategoryId,
} from "./plugin-catalog-category.js";

export type PluginDiscoverySort = "recently-added" | "most-installed" | "name";
export type PluginDiscoverySortDirection = "asc" | "desc";

export interface PluginDiscoveryEntryAccessors<Entry, Category> {
  entryId: (entry: Entry) => string;
  displayName: (entry: Entry) => string;
  category: (entry: Entry) => Category | undefined;
  categoryId: (category: Category) => PluginCatalogCategoryId;
  installs: (entry: Entry) => number | undefined;
  publishedAt: (entry: Entry) => string | undefined;
}

export interface PluginDiscoveryShelf<Entry, Category> {
  category: Category;
  entries: Entry[];
}

const CATEGORY_ORDER = new Map<PluginCatalogCategoryId, number>(
  PLUGIN_CATALOG_CATEGORY_IDS.map((categoryId, index) => [categoryId, index]),
);

export function pluginDiscoveryShelves<Entry, Category>(
  entries: readonly Entry[],
  accessors: PluginDiscoveryEntryAccessors<Entry, Category>,
): PluginDiscoveryShelf<Entry, Category>[] {
  const shelves = new Map<
    PluginCatalogCategoryId,
    PluginDiscoveryShelf<Entry, Category>
  >();
  for (const entry of entries) {
    const category = accessors.category(entry);
    if (category === undefined) continue;
    const categoryId = accessors.categoryId(category);
    const shelf = shelves.get(categoryId);
    if (shelf === undefined) {
      shelves.set(categoryId, { category, entries: [entry] });
    } else {
      shelf.entries.push(entry);
    }
  }

  for (const shelf of shelves.values()) {
    shelf.entries.sort((left, right) => compareNames(left, right, accessors));
  }

  return [...shelves.values()].sort((left, right) => {
    const leftCategoryId = accessors.categoryId(left.category);
    const rightCategoryId = accessors.categoryId(right.category);
    return (
      right.entries.length - left.entries.length ||
      (CATEGORY_ORDER.get(leftCategoryId) ?? CATEGORY_ORDER.size) -
        (CATEGORY_ORDER.get(rightCategoryId) ?? CATEGORY_ORDER.size)
    );
  });
}

export function sortPluginDiscoveryEntries<Entry, Category>(
  entries: readonly Entry[],
  sort: PluginDiscoverySort,
  accessors: PluginDiscoveryEntryAccessors<Entry, Category>,
  direction: PluginDiscoverySortDirection = defaultPluginDiscoverySortDirection(
    sort,
  ),
): Entry[] {
  return [...entries].sort((left, right) => {
    if (sort === "name") {
      const comparison = compareNames(left, right, accessors);
      return direction === "asc" ? comparison : -comparison;
    }
    if (sort === "most-installed") {
      return (
        compareOptionalNumbers(
          accessors.installs(left),
          accessors.installs(right),
          direction,
        ) || compareNames(left, right, accessors)
      );
    }
    return comparePublishedAt(left, right, accessors, direction);
  });
}

export function defaultPluginDiscoverySortDirection(
  sort: PluginDiscoverySort,
): PluginDiscoverySortDirection {
  return sort === "name" ? "asc" : "desc";
}

export function pluginDiscoveryNewAndNotableEntries<Entry, Category>(
  entries: readonly Entry[],
  accessors: PluginDiscoveryEntryAccessors<Entry, Category> & {
    newAndNotableRank: (entry: Entry) => number | undefined;
  },
): Entry[] {
  const categorized = entries.filter(
    (entry) => accessors.category(entry) !== undefined,
  );
  const curated = categorized
    .map((entry) => ({ entry, rank: accessors.newAndNotableRank(entry) }))
    .filter(
      (candidate): candidate is { entry: Entry; rank: number } =>
        candidate.rank !== undefined,
    )
    .sort(
      (left, right) =>
        left.rank - right.rank ||
        compareNames(left.entry, right.entry, accessors),
    )
    .map(({ entry }) => entry);
  if (curated.length > 0) return curated;

  return sortPluginDiscoveryEntries(
    categorized,
    "recently-added",
    accessors,
  ).slice(0, 6);
}

function comparePublishedAt<Entry, Category>(
  left: Entry,
  right: Entry,
  accessors: PluginDiscoveryEntryAccessors<Entry, Category>,
  direction: PluginDiscoverySortDirection = "desc",
): number {
  const leftPublishedAt = accessors.publishedAt(left);
  const rightPublishedAt = accessors.publishedAt(right);
  return (
    compareOptionalNumbers(
      leftPublishedAt === undefined ? undefined : Date.parse(leftPublishedAt),
      rightPublishedAt === undefined ? undefined : Date.parse(rightPublishedAt),
      direction,
    ) || compareNames(left, right, accessors)
  );
}

function compareOptionalNumbers(
  left: number | undefined,
  right: number | undefined,
  direction: PluginDiscoverySortDirection,
): number {
  if (left === undefined) return right === undefined ? 0 : 1;
  if (right === undefined) return -1;
  return direction === "asc" ? left - right : right - left;
}

function compareNames<Entry, Category>(
  left: Entry,
  right: Entry,
  accessors: PluginDiscoveryEntryAccessors<Entry, Category>,
): number {
  return (
    accessors.displayName(left).localeCompare(accessors.displayName(right)) ||
    accessors.entryId(left).localeCompare(accessors.entryId(right))
  );
}

export function visiblePluginCategoryChipCount(args: {
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
