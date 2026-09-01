import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  PLUGIN_CATALOG_CATEGORIES,
  defaultPluginDiscoverySortDirection,
} from "@bb/domain";
import { Icon } from "@bb/shared-ui/icon";
import {
  ResourceCollectionViewport,
  ResourceListState,
  ResourceSortMenu,
  ResourceToolbar,
} from "@bb/shared-ui/resource-list";
import { cn } from "@bb/shared-ui/lib/utils";
import { TOOLS_PAGE_BAND_CLASSES } from "@/components/tools/tools-navigation";
import {
  usePluginCatalogSearch,
  type PluginCatalogSearchEntry,
} from "@/hooks/queries/plugin-catalog-queries";
import {
  sortPluginEntries,
  type PluginBrowseSort,
} from "./plugin-browse-discovery";
import { entriesByMarketplaceAuthor } from "./plugin-marketplace-author";
import { AddPluginDialog, type AddPluginInitial } from "./AddPluginDialog";
import { PluginCatalogGrid } from "./BrowsePluginsTab";
import { PluginAuthorAvatar } from "./PluginAuthorAvatar";
import { PluginAuthorBackLink } from "./PluginAuthorLink";
import {
  PluginBrowseCategoryFilter,
  pluginBrowseSort,
  pluginBrowseSortDirection,
  pluginBrowseSortOptions,
  type PluginBrowseCategoryOption,
} from "./PluginBrowseControls";

function matchesAuthorSearch(
  entry: PluginCatalogSearchEntry,
  query: string,
): boolean {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (normalizedQuery === "") return true;
  return [
    entry.entryId,
    entry.pluginId,
    entry.displayName,
    entry.description,
    entry.category ?? "",
    entry.marketplaceDisplayName,
  ]
    .join("\n")
    .toLocaleLowerCase()
    .includes(normalizedQuery);
}

export function PluginAuthorPage({
  authorId,
  onOpenPlugin,
}: {
  authorId: string;
  onOpenPlugin: (pluginId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [searchParams, setSearchParams] = useSearchParams();
  const catalogQuery = usePluginCatalogSearch("", { enabled: true });
  const entries = useMemo(
    () => entriesByMarketplaceAuthor(catalogQuery.data ?? [], authorId),
    [authorId, catalogQuery.data],
  );
  const author = entries[0]?.author ?? null;
  const hasInstallCounts = entries.some((entry) => entry.installs !== null);
  const requestedSort = pluginBrowseSort(searchParams.get("sort"));
  const activeSort =
    requestedSort === "most-installed" && !hasInstallCounts
      ? null
      : requestedSort;
  const activeDirection =
    activeSort === null
      ? "asc"
      : (pluginBrowseSortDirection(searchParams.get("direction")) ??
        defaultPluginDiscoverySortDirection(activeSort));
  const sortOptions = pluginBrowseSortOptions(hasInstallCounts);
  const categoryCounts = new Map<string, number>();
  for (const entry of entries) {
    if (entry.categoryId === undefined || entry.category === undefined) {
      continue;
    }
    categoryCounts.set(
      entry.categoryId,
      (categoryCounts.get(entry.categoryId) ?? 0) + 1,
    );
  }
  const selectedCategoryIds = [
    ...new Set(searchParams.getAll("category").filter(Boolean)),
  ];
  const categoryOptions: PluginBrowseCategoryOption[] =
    PLUGIN_CATALOG_CATEGORIES.map((category) => ({
      id: category.id,
      label: category.displayName,
      count: categoryCounts.get(category.id) ?? 0,
    }));
  for (const categoryId of selectedCategoryIds) {
    if (
      PLUGIN_CATALOG_CATEGORIES.some((category) => category.id === categoryId)
    ) {
      continue;
    }
    categoryOptions.push({
      id: categoryId,
      label: categoryId,
      count: categoryCounts.get(categoryId) ?? 0,
    });
  }
  const dropdownCategoryOptions = [...categoryOptions].sort(
    (left, right) =>
      right.count - left.count || left.label.localeCompare(right.label),
  );
  const selectedCategorySet = new Set(selectedCategoryIds);
  const visibleEntries = sortPluginEntries(
    entries.filter(
      (entry) =>
        matchesAuthorSearch(entry, query) &&
        (selectedCategorySet.size === 0 ||
          (entry.categoryId !== undefined &&
            selectedCategorySet.has(entry.categoryId))),
    ),
    activeSort ?? "name",
    activeDirection,
  );
  const [installTarget, setInstallTarget] = useState<AddPluginInitial | null>(
    null,
  );

  function setCategories(categoryIds: readonly string[]) {
    const nextSearchParams = new URLSearchParams(searchParams);
    nextSearchParams.delete("shelf");
    nextSearchParams.delete("category");
    for (const categoryId of categoryIds) {
      nextSearchParams.append("category", categoryId);
    }
    setSearchParams(nextSearchParams);
  }

  function setSort(sort: PluginBrowseSort) {
    const nextSearchParams = new URLSearchParams(searchParams);
    nextSearchParams.set("sort", sort);
    nextSearchParams.set(
      "direction",
      sort === activeSort
        ? activeDirection === "asc"
          ? "desc"
          : "asc"
        : defaultPluginDiscoverySortDirection(sort),
    );
    setSearchParams(nextSearchParams);
  }

  function clearSort() {
    const nextSearchParams = new URLSearchParams(searchParams);
    nextSearchParams.delete("sort");
    nextSearchParams.delete("direction");
    setSearchParams(nextSearchParams);
  }

  return (
    <>
      <ResourceCollectionViewport
        scrollId="plugin-author-results"
        contentClassName="[&>div]:!block [&>div]:!min-w-0 [&>div]:!w-full"
      >
        <div className={cn("space-y-6", TOOLS_PAGE_BAND_CLASSES)}>
          <div className="space-y-1">
            <PluginAuthorBackLink
              className="-ml-1 inline-flex items-center gap-1 rounded-sm px-1 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <Icon name="ChevronLeft" className="size-3" aria-hidden />
              Browse plugins
            </PluginAuthorBackLink>
            {author === null ? null : (
              <div className="flex items-center gap-3">
                <PluginAuthorAvatar
                  name={author.name}
                  github={author.github}
                  size="page"
                />
                <div className="min-w-0 space-y-1">
                  <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold text-foreground">
                    <span>{author.name}</span>
                    <span className="rounded-md bg-muted px-2 py-1 text-2xs font-medium tabular-nums text-subtle-foreground">
                      {entries.length.toLocaleString()}{" "}
                      {entries.length === 1 ? "plugin" : "plugins"}
                    </span>
                  </h1>
                  {author.github === null ? null : (
                    <p className="text-xs text-subtle-foreground">
                      <a
                        href={`https://github.com/${author.github}`}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-sm underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      >
                        github.com/{author.github}
                        <Icon
                          name="ExternalLink"
                          className="ml-0.5 inline size-3"
                          aria-hidden
                        />
                      </a>
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>

          {catalogQuery.isPending ? (
            <ResourceListState state="loading" message="Loading author" />
          ) : catalogQuery.isError ? (
            <ResourceListState
              state="error"
              message="Couldn't load this author."
              onRetry={() => void catalogQuery.refetch()}
            />
          ) : author === null ? (
            <ResourceListState state="empty" message="Author not found." />
          ) : (
            <section className="space-y-6">
              <ResourceToolbar
                searchValue={query}
                searchPlaceholder="Search plugins"
                onSearchChange={setQuery}
                controls={
                  <>
                    <ResourceSortMenu
                      value={activeSort}
                      direction={activeDirection}
                      options={sortOptions}
                      compact
                      placeholderLabel="Sort plugins"
                      onClear={clearSort}
                      onChange={(value) => {
                        const sort = pluginBrowseSort(value);
                        if (sort !== null) setSort(sort);
                      }}
                    />
                    <PluginBrowseCategoryFilter
                      selectionMode="multiple"
                      value={selectedCategoryIds}
                      options={dropdownCategoryOptions}
                      onChange={setCategories}
                    />
                  </>
                }
              />
              {visibleEntries.length === 0 ? (
                <ResourceListState
                  state="empty"
                  message="No plugins match your filters."
                />
              ) : (
                <PluginCatalogGrid
                  entries={visibleEntries}
                  showCategory
                  onInstall={setInstallTarget}
                  onOpenPlugin={onOpenPlugin}
                />
              )}
            </section>
          )}
        </div>
      </ResourceCollectionViewport>
      <AddPluginDialog
        open={installTarget !== null}
        initial={installTarget}
        onOpenChange={(open) => {
          if (!open) setInstallTarget(null);
        }}
        onInstalled={(plugin) => onOpenPlugin(plugin.id)}
      />
    </>
  );
}
