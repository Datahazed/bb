import { useMemo, useState, type ReactNode } from "react";
import {
  Navigate,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import {
  PLUGIN_CATALOG_CATEGORIES,
  defaultPluginDiscoverySortDirection,
  sortPluginDiscoveryEntries,
  type PluginCatalogCategoryId,
  type PluginDiscoveryEntryAccessors,
} from "@bb/domain";
import {
  RESOURCE_GRID_PAGE_SIZE,
  ResourceInfiniteScrollSentinel,
  useResourceInfiniteItems,
} from "@bb/shared-ui/resource-pagination";
import {
  ResourceCollectionViewport,
  ResourceListState,
} from "@bb/shared-ui/resource-list";
import { Button } from "@bb/shared-ui/button";
import { cn } from "@bb/shared-ui/lib/utils";
import { CREATE_PLUGIN_PROMPT } from "@bb/client-core";
import { TOOLS_PAGE_BAND_CLASSES } from "@/components/tools/tools-navigation";
import {
  AddPluginDialog,
  type AddPluginInitial,
} from "@/components/plugin/management/AddPluginDialog";
import { BrowsePluginsTab } from "@/components/plugin/management/BrowsePluginsTab";
import {
  InstalledPluginsTab,
  UNCATEGORIZED_PLUGIN_CATEGORY,
} from "@/components/plugin/management/InstalledPluginsTab";
import { MyPluginsTab } from "@/components/plugin/management/MyPluginsTab";
import { OpenPluginGuideButton } from "@/components/plugin/management/OpenPluginGuideButton";
import {
  PluginCollectionToolbar,
  PluginCreateControl,
} from "@/components/plugin/management/PluginCollectionControls";
import {
  PluginBrowseCategoryFilter,
  PluginSortControl,
  type PluginBrowseCategoryOption,
} from "@/components/plugin/management/PluginBrowseControls";
import type {
  PluginBrowseSort,
  PluginBrowseSortDirection,
} from "@/components/plugin/management/plugin-browse-discovery";
import { PLUGINS_INSTALLED_DESCRIPTION } from "@/components/plugin/plugins-collection-copy";
import {
  usePluginCatalogSearch,
  type PluginCatalogSearchEntry,
} from "@/hooks/queries/plugin-catalog-queries";
import {
  usePluginList,
  type PluginListItem,
} from "@/hooks/queries/plugin-settings-queries";
import {
  getPluginDetailRoutePath,
  getPluginsRoutePath,
  getRootComposeRoutePath,
} from "@/lib/route-paths";

type PluginsCollectionMode = "installed" | "browse" | "my";

interface InstalledPluginSortEntry {
  plugin: PluginListItem;
  catalogEntry: PluginCatalogSearchEntry | null;
}

interface InstalledPluginSortCategory {
  id: PluginCatalogCategoryId;
}

const INSTALLED_PLUGIN_SORT_ACCESSORS = {
  entryId: (entry: InstalledPluginSortEntry) => entry.plugin.id,
  displayName: (entry: InstalledPluginSortEntry) =>
    entry.plugin.name ?? entry.plugin.id,
  category: () => undefined,
  categoryId: (category: InstalledPluginSortCategory) => category.id,
  installs: (entry: InstalledPluginSortEntry) =>
    entry.catalogEntry?.installs ?? undefined,
  publishedAt: (entry: InstalledPluginSortEntry) =>
    entry.catalogEntry?.publishedAt,
} satisfies PluginDiscoveryEntryAccessors<
  InstalledPluginSortEntry,
  InstalledPluginSortCategory
>;

function modeFromSearchParams(value: string | null): PluginsCollectionMode {
  if (value === "installed") return value;
  if (value === "my") return value;
  return "browse";
}

export function PluginsOverview({
  onOpenPlugin,
}: {
  onOpenPlugin?: (pluginId: string, view: PluginsCollectionMode) => void;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const activeMode = modeFromSearchParams(searchParams.get("view"));
  const listQuery = usePluginList({ enabled: true });
  const catalogQuery = usePluginCatalogSearch("", {
    enabled: activeMode === "installed" || activeMode === "my",
  });
  const plugins = useMemo(
    () => listQuery.data?.plugins ?? [],
    [listQuery.data?.plugins],
  );
  const emptyInstalledCollection =
    activeMode === "installed" && listQuery.isSuccess && plugins.length === 0;
  const renderedMode = emptyInstalledCollection ? "browse" : activeMode;
  const pluginGuide = plugins.find((plugin) => plugin.id === "plugin-api-docs");
  const [installedQuery, setInstalledQuery] = useState("");
  const [installedSortDirection, setInstalledSortDirection] =
    useState<PluginBrowseSortDirection>("desc");
  const [installedSort, setInstalledSort] = useState<PluginBrowseSort | null>(
    null,
  );
  const [categoryFilters, setCategoryFilters] = useState<string[]>([]);
  const categoryOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const plugin of plugins) {
      const id =
        plugin.categoryId === null || plugin.category === null
          ? UNCATEGORIZED_PLUGIN_CATEGORY
          : plugin.categoryId;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    const options: PluginBrowseCategoryOption[] =
      PLUGIN_CATALOG_CATEGORIES.flatMap((category) => {
        const count = counts.get(category.id) ?? 0;
        return count === 0
          ? []
          : [{ id: category.id, label: category.displayName, count }];
      });
    if ((counts.get(UNCATEGORIZED_PLUGIN_CATEGORY) ?? 0) > 0) {
      options.push({
        id: UNCATEGORIZED_PLUGIN_CATEGORY,
        label: "Uncategorized",
        count: counts.get(UNCATEGORIZED_PLUGIN_CATEGORY) ?? 0,
      });
    }
    return options.sort(
      (left, right) =>
        right.count - left.count || left.label.localeCompare(right.label),
    );
  }, [plugins]);
  const installedCatalogEntries = useMemo(
    () => (catalogQuery.data ?? []).filter((entry) => entry.compatible),
    [catalogQuery.data],
  );
  const installedCatalogEntriesByPluginId = useMemo(
    () =>
      new Map(installedCatalogEntries.map((entry) => [entry.pluginId, entry])),
    [installedCatalogEntries],
  );
  const installedCatalogHasInstallCounts = installedCatalogEntries.some(
    (entry) => entry.installs !== null,
  );
  const catalogEntriesByEntryId = useMemo(
    () =>
      new Map((catalogQuery.data ?? []).map((entry) => [entry.entryId, entry])),
    [catalogQuery.data],
  );
  const activeCategoryFilters = useMemo(
    () =>
      categoryFilters.filter((categoryId) =>
        categoryOptions.some((option) => option.id === categoryId),
      ),
    [categoryFilters, categoryOptions],
  );
  const filtersAreDefault = activeCategoryFilters.length === 0;
  const normalizedInstalledQuery = installedQuery.trim().toLowerCase();
  const installedResetKey = [
    normalizedInstalledQuery,
    installedSort ?? "default",
    installedSortDirection,
    activeCategoryFilters.join(","),
  ].join("\u0000");
  const [addDialog, setAddDialog] = useState<{
    open: boolean;
    initial: AddPluginInitial | null;
  }>({ open: false, initial: null });
  const openPlugin =
    onOpenPlugin ??
    ((pluginId: string, view: PluginsCollectionMode) =>
      navigate(
        view === "my"
          ? `${getPluginDetailRoutePath({ pluginId })}?view=my`
          : getPluginDetailRoutePath({
              pluginId,
              ...(view === "installed" ? { view } : {}),
            }),
      ));

  const visiblePlugins = useMemo(() => {
    const filteredPlugins = plugins.filter((plugin) => {
      const categoryId =
        plugin.categoryId != null && plugin.category != null
          ? plugin.categoryId
          : UNCATEGORIZED_PLUGIN_CATEGORY;
      if (
        activeCategoryFilters.length > 0 &&
        !activeCategoryFilters.includes(categoryId)
      ) {
        return false;
      }
      if (normalizedInstalledQuery.length === 0) return true;
      return [
        plugin.id,
        plugin.name ?? "",
        plugin.description ?? "",
        plugin.version,
        plugin.sourceDisplay,
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalizedInstalledQuery);
    });
    if (installedSort !== null) {
      return sortPluginDiscoveryEntries(
        filteredPlugins.map((plugin) => ({
          plugin,
          catalogEntry:
            installedCatalogEntriesByPluginId.get(plugin.id) ?? null,
        })),
        installedSort,
        INSTALLED_PLUGIN_SORT_ACCESSORS,
        installedSortDirection,
      ).map((entry) => entry.plugin);
    }
    return filteredPlugins.sort((left, right) => {
      const nameResult = (left.name ?? left.id).localeCompare(
        right.name ?? right.id,
      );
      const enabledResult = Number(!left.enabled) - Number(!right.enabled);
      if (enabledResult !== 0) return enabledResult;
      if (left.enabled) {
        const leftPublisher = left.publisherLabel;
        const rightPublisher = right.publisherLabel;
        const publisherResult =
          Number(leftPublisher === null) - Number(rightPublisher === null);
        if (publisherResult !== 0) return publisherResult;
      }
      if (nameResult !== 0) return nameResult;
      return left.id.localeCompare(right.id);
    });
  }, [
    activeCategoryFilters,
    installedCatalogEntriesByPluginId,
    installedSortDirection,
    installedSort,
    normalizedInstalledQuery,
    plugins,
  ]);
  const installedList = useResourceInfiniteItems(visiblePlugins, {
    pageSize: RESOURCE_GRID_PAGE_SIZE,
    resetKey: installedResetKey,
  });
  const startCreatePlugin = (prompt?: string) => {
    navigate(getRootComposeRoutePath(), {
      state: {
        focusPrompt: true,
        initialPrompt: prompt ?? CREATE_PLUGIN_PROMPT,
        replaceInitialPrompt: prompt !== undefined,
      },
    });
  };

  if (
    activeMode === "installed" &&
    listQuery.data === undefined &&
    listQuery.isFetching
  ) {
    return (
      <div className={cn("py-6", TOOLS_PAGE_BAND_CLASSES)}>
        <ResourceListState state="loading" message="Loading plugins" />
      </div>
    );
  }

  if (emptyInstalledCollection && location.pathname === getPluginsRoutePath()) {
    return <Navigate to={getPluginsRoutePath()} replace />;
  }

  const installedActions = (
    <PluginCreateControl
      onCreate={() => navigate(`${getPluginsRoutePath()}?view=create`)}
      onInstallFromSource={() => setAddDialog({ open: true, initial: null })}
    />
  );

  let content: ReactNode;
  if (renderedMode === "browse") {
    content = (
      <BrowsePluginsTab
        onInstall={(initial) => setAddDialog({ open: true, initial })}
        onOpenPlugin={(pluginId) => openPlugin(pluginId, "browse")}
        onInstallFromSource={() => setAddDialog({ open: true, initial: null })}
      />
    );
  } else if (renderedMode === "installed") {
    content = (
      <ResourceCollectionViewport
        scrollId="plugins-installed-results"
        bandClassName={TOOLS_PAGE_BAND_CLASSES}
        contentClassName="[&>div]:!block [&>div]:!min-w-0 [&>div]:!w-full"
        toolbar={
          <div className="space-y-6">
            <div className="space-y-1" data-installed-plugins-header>
              <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold text-foreground">
                <span>Installed plugins</span>
                <span
                  data-installed-plugin-count
                  className="rounded-md bg-muted px-2 py-1 text-2xs font-medium tabular-nums text-subtle-foreground"
                >
                  {plugins.length.toLocaleString()}{" "}
                  {plugins.length === 1 ? "plugin" : "plugins"}
                </span>
              </h1>
              <p className="text-xs text-subtle-foreground">
                {PLUGINS_INSTALLED_DESCRIPTION}
              </p>
            </div>
            <PluginCollectionToolbar
              searchValue={installedQuery}
              searchPlaceholder="Search installed plugins"
              searchClearLabel="Clear installed plugin search"
              onSearchChange={setInstalledQuery}
              action={installedActions}
              sort={
                plugins.length === 0 ? undefined : (
                  <PluginSortControl
                    value={installedSort}
                    direction={installedSortDirection}
                    hasInstallCounts={installedCatalogHasInstallCounts}
                    onClear={() => {
                      setInstalledSort(null);
                      setInstalledSortDirection("desc");
                    }}
                    onChange={(sort) => {
                      if (installedSort === sort) {
                        setInstalledSortDirection((current) =>
                          current === "asc" ? "desc" : "asc",
                        );
                        return;
                      }
                      setInstalledSort(sort);
                      setInstalledSortDirection(
                        defaultPluginDiscoverySortDirection(sort),
                      );
                    }}
                  />
                )
              }
              filter={
                plugins.length === 0 ? undefined : (
                  <PluginBrowseCategoryFilter
                    selectionMode="multiple"
                    value={activeCategoryFilters}
                    options={categoryOptions}
                    onChange={setCategoryFilters}
                  />
                )
              }
              controlsClassName="max-w-full flex-wrap justify-end"
            />
          </div>
        }
      >
        <div className={cn("space-y-3", TOOLS_PAGE_BAND_CLASSES)}>
          {listQuery.isError && plugins.length > 0 ? (
            <div
              className="flex flex-wrap items-center gap-2 text-xs text-warning-text"
              role="status"
            >
              <span>
                Showing installed plugins from the last successful refresh.
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void listQuery.refetch()}
              >
                Retry
              </Button>
            </div>
          ) : null}
          {listQuery.isError && plugins.length === 0 ? (
            <ResourceListState
              state="error"
              message="Couldn't load plugins."
              onRetry={() => void listQuery.refetch()}
            />
          ) : listQuery.isFetching && listQuery.data === undefined ? (
            <ResourceListState state="loading" message="Loading plugins" />
          ) : visiblePlugins.length === 0 ? (
            <ResourceListState
              state="empty"
              message={
                normalizedInstalledQuery === ""
                  ? "No plugins match these filters."
                  : !filtersAreDefault
                    ? `No plugins match "${installedQuery}" with these filters.`
                    : `No plugins match "${installedQuery}"`
              }
            />
          ) : (
            <>
              <InstalledPluginsTab
                catalogEntriesByPluginId={installedCatalogEntriesByPluginId}
                plugins={installedList.items}
                onOpenPlugin={(pluginId) => openPlugin(pluginId, "installed")}
              />
              <ResourceInfiniteScrollSentinel
                hasMore={installedList.hasMore}
                onLoadMore={installedList.loadMore}
              />
            </>
          )}
        </div>
      </ResourceCollectionViewport>
    );
  } else {
    content = (
      <ResourceCollectionViewport
        scrollId="my-plugins-results"
        bandClassName={TOOLS_PAGE_BAND_CLASSES}
        toolbar={
          <div className="flex justify-end">
            <OpenPluginGuideButton
              plugin={pluginGuide}
              pluginListLoading={
                listQuery.data === undefined && listQuery.isFetching
              }
            />
          </div>
        }
      >
        <div className={cn("space-y-3", TOOLS_PAGE_BAND_CLASSES)}>
          <MyPluginsTab
            catalogEntriesByEntryId={catalogEntriesByEntryId}
            plugins={plugins}
            onOpenPlugin={(pluginId) => openPlugin(pluginId, "my")}
            onCreatePlugin={startCreatePlugin}
          />
        </div>
      </ResourceCollectionViewport>
    );
  }

  return (
    <>
      <div className="flex h-full min-h-0 flex-col">{content}</div>
      <AddPluginDialog
        open={addDialog.open}
        initial={addDialog.initial}
        onOpenChange={(open) =>
          setAddDialog((current) => ({ ...current, open }))
        }
        onInstalled={(plugin) => openPlugin(plugin.id, "installed")}
      />
    </>
  );
}
