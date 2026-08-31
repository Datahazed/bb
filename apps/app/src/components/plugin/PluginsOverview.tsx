import { useMemo, useState, type ReactNode } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import {
  ResourceInfiniteScrollSentinel,
  useResourceInfiniteItems,
  useResourceViewportPageSize,
} from "@bb/shared-ui/resource-pagination";
import {
  ResourceCollectionPage,
  ResourceCollectionViewport,
  ResourceFilterMenu,
  ResourceListState,
  ResourceSortMenu,
  ResourceToolbar,
} from "@bb/shared-ui/resource-list";
import { cn } from "@bb/shared-ui/lib/utils";
import { CreateWithTemplatesButton } from "@/components/create-via-prompt-examples";
import { CREATE_PLUGIN_PROMPT } from "@bb/client-core";
import { TOOLS_PAGE_BAND_CLASSES } from "@/components/tools/tools-navigation";
import {
  AddPluginDialog,
  type AddPluginInitial,
} from "@/components/plugin/management/AddPluginDialog";
import { BrowsePluginsTab } from "@/components/plugin/management/BrowsePluginsTab";
import { CheckPluginUpdatesButton } from "@/components/plugin/management/CheckPluginUpdatesButton";
import { InstalledPluginsTab } from "@/components/plugin/management/InstalledPluginsTab";
import { MyPluginsTab } from "@/components/plugin/management/MyPluginsTab";
import { OpenPluginGuideButton } from "@/components/plugin/management/OpenPluginGuideButton";
import {
  PLUGIN_SOURCE_FILTER_OPTIONS,
  pluginSourceFilterId,
  type PluginSourceFilter,
} from "@/components/plugin/plugin-provenance";
import { PLUGINS_INSTALLED_DESCRIPTION } from "@/components/plugin/plugins-collection-copy";
import { usePluginList } from "@/hooks/queries/plugin-settings-queries";
import {
  getPluginDetailRoutePath,
  getPluginsRoutePath,
  getRootComposeRoutePath,
} from "@/lib/route-paths";

type PluginsCollectionMode = "installed" | "browse" | "my";
type InstalledStateFilter = "enabled" | "disabled";
type InstalledSourceFilter = Exclude<PluginSourceFilter, "all">;

const INSTALLED_STATE_FILTER_OPTIONS = [
  { id: "enabled", label: "Enabled" },
  { id: "disabled", label: "Disabled" },
] satisfies readonly { id: InstalledStateFilter; label: string }[];

const INSTALLED_SOURCE_FILTER_OPTIONS = PLUGIN_SOURCE_FILTER_OPTIONS.filter(
  (
    option,
  ): option is {
    id: InstalledSourceFilter;
    label: string;
  } => option.id !== "all",
);

const UNCATEGORIZED_CATEGORY_FILTER = "__uncategorized__";

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
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const listQuery = usePluginList({ enabled: true });
  const plugins = useMemo(
    () => listQuery.data?.plugins ?? [],
    [listQuery.data?.plugins],
  );
  const pluginGuide = plugins.find((plugin) => plugin.id === "plugin-api-docs");
  const activeMode = modeFromSearchParams(searchParams.get("view"));
  const [installedQuery, setInstalledQuery] = useState("");
  const [installedViewport, setInstalledViewport] =
    useState<HTMLDivElement | null>(null);
  const [installedSortDirection, setInstalledSortDirection] = useState<
    "asc" | "desc"
  >("asc");
  const [installedSort, setInstalledSort] = useState<"alpha" | null>(null);
  const [stateFilters, setStateFilters] = useState<InstalledStateFilter[]>([]);
  const [sourceFilters, setSourceFilters] = useState<InstalledSourceFilter[]>(
    [],
  );
  const [categoryFilters, setCategoryFilters] = useState<string[]>([]);
  const categoryOptions = useMemo(() => {
    const byId = new Map<string, string>();
    let hasUncategorized = false;
    for (const plugin of plugins) {
      if (plugin.categoryId != null && plugin.category != null) {
        byId.set(plugin.categoryId, plugin.category);
      } else {
        hasUncategorized = true;
      }
    }
    const declaredCategories = [...byId.entries()]
      .map(([id, label]) => ({ id, label }))
      .sort((left, right) => left.label.localeCompare(right.label));
    return [
      ...declaredCategories,
      ...(hasUncategorized
        ? [
            {
              id: UNCATEGORIZED_CATEGORY_FILTER,
              label: "Uncategorized",
            },
          ]
        : []),
    ];
  }, [plugins]);
  const activeCategoryFilters = useMemo(
    () =>
      categoryFilters.filter((categoryId) =>
        categoryOptions.some((option) => option.id === categoryId),
      ),
    [categoryFilters, categoryOptions],
  );
  const filtersAreDefault =
    stateFilters.length === 0 &&
    sourceFilters.length === 0 &&
    activeCategoryFilters.length === 0;
  const normalizedInstalledQuery = installedQuery.trim().toLowerCase();
  const installedResetKey = [
    normalizedInstalledQuery,
    installedSort ?? "default",
    installedSortDirection,
    stateFilters.join(","),
    sourceFilters.join(","),
    activeCategoryFilters.join(","),
  ].join("\u0000");
  const installedPageSize = useResourceViewportPageSize(installedViewport, {
    resetKey: installedResetKey,
  });
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

  const visiblePlugins = useMemo(
    () =>
      plugins
        .filter((plugin) => {
          if (
            stateFilters.length > 0 &&
            !stateFilters.includes(plugin.enabled ? "enabled" : "disabled")
          ) {
            return false;
          }
          if (
            sourceFilters.length > 0 &&
            !sourceFilters.includes(pluginSourceFilterId(plugin))
          ) {
            return false;
          }
          const categoryId =
            plugin.categoryId != null && plugin.category != null
              ? plugin.categoryId
              : UNCATEGORIZED_CATEGORY_FILTER;
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
        })
        .sort((left, right) => {
          const enabledResult = Number(!left.enabled) - Number(!right.enabled);
          if (enabledResult !== 0) return enabledResult;
          if (left.enabled) {
            const leftPublisher = left.publisherLabel;
            const rightPublisher = right.publisherLabel;
            const publisherResult =
              Number(leftPublisher === null) - Number(rightPublisher === null);
            if (publisherResult !== 0) return publisherResult;
          }
          const result = (left.name ?? left.id).localeCompare(
            right.name ?? right.id,
          );
          if (result !== 0) {
            return installedSortDirection === "asc" ? result : -result;
          }
          return left.id.localeCompare(right.id);
        }),
    [
      activeCategoryFilters,
      installedSortDirection,
      normalizedInstalledQuery,
      plugins,
      sourceFilters,
      stateFilters,
    ],
  );
  const installedList = useResourceInfiniteItems(visiblePlugins, {
    pageSize: installedPageSize,
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

  if (
    activeMode === "installed" &&
    listQuery.isSuccess &&
    plugins.length === 0
  ) {
    return <Navigate to={getPluginsRoutePath()} replace />;
  }

  const installedActions = (
    <>
      {plugins.length > 0 ? <CheckPluginUpdatesButton /> : null}
      <CreateWithTemplatesButton
        kind="plugin"
        label="Create a plugin"
        menuActions={[
          {
            label: "Install from source",
            icon: "Download",
            onSelect: () => setAddDialog({ open: true, initial: null }),
          },
        ]}
        onCreate={startCreatePlugin}
      />
    </>
  );

  let content: ReactNode;
  if (activeMode === "browse") {
    content = (
      <BrowsePluginsTab
        onInstall={(initial) => setAddDialog({ open: true, initial })}
        onOpenPlugin={(pluginId) => openPlugin(pluginId, "browse")}
        onInstallFromSource={() => setAddDialog({ open: true, initial: null })}
      />
    );
  } else if (activeMode === "installed") {
    content = (
      <ResourceCollectionViewport
        scrollId="plugins-installed-results"
        viewportRef={setInstalledViewport}
        bandClassName={TOOLS_PAGE_BAND_CLASSES}
        contentClassName="[&>div]:!block [&>div]:!min-w-0 [&>div]:!w-full"
        toolbar={
          plugins.length > 0 ? (
            <ResourceToolbar
              searchValue={installedQuery}
              searchPlaceholder="Search installed plugins"
              onSearchChange={setInstalledQuery}
              action={installedActions}
              controls={
                <>
                  <ResourceFilterMenu
                    compact
                    engaged={!filtersAreDefault}
                    groups={[
                      {
                        id: "state",
                        label: "State",
                        options: INSTALLED_STATE_FILTER_OPTIONS,
                        selectedValues: stateFilters,
                        onChange: (values) =>
                          setStateFilters(
                            values.filter(
                              (value): value is InstalledStateFilter =>
                                value === "enabled" || value === "disabled",
                            ),
                          ),
                      },
                      {
                        id: "source",
                        label: "Source",
                        options: INSTALLED_SOURCE_FILTER_OPTIONS,
                        selectedValues: sourceFilters,
                        onChange: (values) =>
                          setSourceFilters(
                            values.filter(
                              (value): value is InstalledSourceFilter =>
                                value === "builtin" ||
                                value === "catalog" ||
                                value === "direct",
                            ),
                          ),
                      },
                      {
                        id: "category",
                        label: "Category",
                        options: categoryOptions,
                        selectedValues: activeCategoryFilters,
                        onChange: setCategoryFilters,
                      },
                    ]}
                  />
                  <ResourceSortMenu
                    value={installedSort}
                    direction={installedSortDirection}
                    compact
                    options={[{ id: "alpha", label: "Plugin name" }]}
                    placeholderLabel="Sort plugins"
                    onClear={() => {
                      setInstalledSort(null);
                      setInstalledSortDirection("asc");
                    }}
                    onChange={() => {
                      if (installedSort === "alpha") {
                        setInstalledSortDirection((current) =>
                          current === "asc" ? "desc" : "asc",
                        );
                        return;
                      }
                      setInstalledSort("alpha");
                      setInstalledSortDirection("asc");
                    }}
                  />
                </>
              }
              controlsClassName="max-w-full flex-wrap justify-end"
            />
          ) : undefined
        }
      >
        <div className={cn("space-y-3", TOOLS_PAGE_BAND_CLASSES)}>
          {listQuery.isError ? (
            <ResourceListState
              state="error"
              message="Couldn't load plugins."
              onRetry={() => void listQuery.refetch()}
            />
          ) : listQuery.isFetching && listQuery.data === undefined ? (
            <ResourceListState state="loading" message="Loading plugins" />
          ) : plugins.length > 0 && visiblePlugins.length === 0 ? (
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
      {activeMode === "installed" ? (
        <ResourceCollectionPage
          id="plugins-collection"
          description={PLUGINS_INSTALLED_DESCRIPTION}
          bandClassName={TOOLS_PAGE_BAND_CLASSES}
        >
          {content}
        </ResourceCollectionPage>
      ) : (
        <div className="flex h-full min-h-0 flex-col">{content}</div>
      )}
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
