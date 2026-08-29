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
  ResourceListState,
  ResourceSortMenu,
  ResourceToolbar,
} from "@bb/shared-ui/resource-list";
import { Button } from "@bb/shared-ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { CreateWithTemplatesButton } from "@/components/create-via-prompt-examples";
import { CREATE_PLUGIN_PROMPT } from "@bb/client-core";
import { TOOLS_PAGE_BAND_CLASSES } from "@/components/tools/tools-navigation";
import {
  AddPluginDialog,
  type AddPluginInitial,
} from "@/components/plugin/management/AddPluginDialog";
import { BrowsePluginsTab } from "@/components/plugin/management/BrowsePluginsTab";
import { PluginCategoryChips } from "@/components/plugin/management/PluginCategoryChips";
import { CheckPluginUpdatesButton } from "@/components/plugin/management/CheckPluginUpdatesButton";
import { InstalledPluginsTab } from "@/components/plugin/management/InstalledPluginsTab";
import { MyPluginsTab } from "@/components/plugin/management/MyPluginsTab";
import {
  PLUGIN_SOURCE_FILTER_OPTIONS,
  pluginSourceFilterId,
  pluginSourceFilterLabel,
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
  const activeMode = modeFromSearchParams(searchParams.get("view"));
  const [installedQuery, setInstalledQuery] = useState("");
  const [installedViewport, setInstalledViewport] =
    useState<HTMLDivElement | null>(null);
  const [installedSortDirection, setInstalledSortDirection] = useState<
    "asc" | "desc"
  >("asc");
  const [sourceFilter, setSourceFilter] = useState<PluginSourceFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const categoryOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const plugin of plugins) {
      if (plugin.categoryId != null && plugin.category != null) {
        byId.set(plugin.categoryId, plugin.category);
      }
    }
    return [...byId.entries()]
      .map(([id, label]) => ({ id, label }))
      .sort((left, right) => left.label.localeCompare(right.label));
  }, [plugins]);
  const activeCategoryFilter = categoryOptions.some(
    (option) => option.id === categoryFilter,
  )
    ? categoryFilter
    : null;
  const normalizedInstalledQuery = installedQuery.trim().toLowerCase();
  const installedResetKey = [
    normalizedInstalledQuery,
    installedSortDirection,
    sourceFilter,
    activeCategoryFilter ?? "",
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
            sourceFilter !== "all" &&
            pluginSourceFilterId(plugin) !== sourceFilter
          ) {
            return false;
          }
          if (
            activeCategoryFilter !== null &&
            plugin.categoryId !== activeCategoryFilter
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
      activeCategoryFilter,
      installedSortDirection,
      normalizedInstalledQuery,
      plugins,
      sourceFilter,
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
        label="New plugin"
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
                  <InstalledPluginSourceFilter
                    value={sourceFilter}
                    onChange={setSourceFilter}
                  />
                  <ResourceSortMenu
                    value="alpha"
                    direction={installedSortDirection}
                    compact
                    options={[{ id: "alpha", label: "Plugin name" }]}
                    onChange={() =>
                      setInstalledSortDirection((current) =>
                        current === "asc" ? "desc" : "asc",
                      )
                    }
                  />
                </>
              }
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
                  : sourceFilter !== "all" || activeCategoryFilter !== null
                    ? `No plugins match "${installedQuery}" with these filters.`
                    : `No plugins match "${installedQuery}"`
              }
            />
          ) : (
            <>
              {plugins.length > 0 ? (
                <PluginCategoryChips
                  options={categoryOptions}
                  value={activeCategoryFilter}
                  allLabel={`All · ${plugins.length}`}
                  ariaLabel="Filter installed plugins by category"
                  onChange={setCategoryFilter}
                />
              ) : null}
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
      >
        <div className={cn("space-y-3", TOOLS_PAGE_BAND_CLASSES)}>
          <MyPluginsTab
            plugins={plugins}
            onOpenPlugin={(pluginId) => openPlugin(pluginId, "my")}
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

function InstalledPluginSourceFilter({
  value,
  onChange,
}: {
  value: PluginSourceFilter;
  onChange: (value: PluginSourceFilter) => void;
}) {
  const label = pluginSourceFilterLabel(value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="h-8 min-w-36 justify-between gap-2 px-3 text-xs font-normal"
          aria-label={`Source: ${label}`}
        >
          <span className="flex min-w-0 items-center gap-2">
            <Icon
              name="SlidersHorizontal"
              className="size-3.5 shrink-0"
              aria-hidden
            />
            <span className="truncate">{label}</span>
          </span>
          <Icon name="ChevronDown" className="size-3.5 shrink-0" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        {PLUGIN_SOURCE_FILTER_OPTIONS.map((option) => (
          <DropdownMenuItem
            key={option.id}
            onSelect={() => onChange(option.id)}
            className="flex items-center justify-between gap-3"
          >
            <span className="min-w-0 flex-1 truncate">{option.label}</span>
            <Icon
              name="Check"
              className={cn(
                "size-3.5",
                option.id === value ? "opacity-100" : "opacity-0",
              )}
              aria-hidden
            />
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
