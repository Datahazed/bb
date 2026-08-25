import { useMemo, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
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
import { CheckPluginUpdatesButton } from "@/components/plugin/management/CheckPluginUpdatesButton";
import { InstalledPluginsTab } from "@/components/plugin/management/InstalledPluginsTab";
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
  getRootComposeRoutePath,
} from "@/lib/route-paths";

type PluginsCollectionMode = "installed" | "browse";

function modeFromSearchParams(value: string | null): PluginsCollectionMode {
  if (value === "installed") return value;
  return "browse";
}

/**
 * The canonical Plugins collection: installed resources, discoverable
 * resources from BB's official catalog.
 * Modes are URL-backed projections of one collection, not separate settings
 * pages; plugin configuration and lifecycle depth remain on the detail route.
 */
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
  // One projection identity resets both the accumulated rows and their
  // viewport measurement when search, filters, or sorting changes.
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
        getPluginDetailRoutePath({
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
            // Published plugins first, then the user's own; publishers
            // themselves stay in one alphabetical run so the sort direction
            // still controls the whole list.
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
  // Pages load as the sentinel scrolls into view; the page machinery stays
  // (viewport-fit chunk size, projection reset keys) but rows accumulate.
  const installedList = useResourceInfiniteItems(visiblePlugins, {
    pageSize: installedPageSize,
    resetKey: installedResetKey,
  });

  // Installed's New plugin goes to the real new-thread page: the inline hero
  // composer is Browse's own affordance, and bouncing Installed users through
  // Browse read as a mis-navigation rather than a shortcut.
  const startCreatePlugin = (prompt?: string) => {
    navigate(getRootComposeRoutePath(), {
      state: {
        focusPrompt: true,
        initialPrompt: prompt ?? CREATE_PLUGIN_PROMPT,
        replaceInitialPrompt: prompt !== undefined,
      },
    });
  };

  // Browse renders no page shell at all — its actions live in the hero's CTA
  // row. Installed keeps the New plugin button, which starts a thread, plus
  // an on-demand update check beside it (the server also sweeps every 6h).
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
  } else {
    content = (
      <ResourceCollectionViewport
        scrollId="plugins-installed-results"
        viewportRef={setInstalledViewport}
        bandClassName={TOOLS_PAGE_BAND_CLASSES}
        // Like Browse, Installed is vertical-only. Radix's generated
        // display:table wrapper otherwise takes the rows' desktop max-content
        // width on compact screens and clips their persistent switches.
        contentClassName="[&>div]:!block [&>div]:!min-w-0 [&>div]:!w-full"
        toolbar={
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
              <InstalledPluginCategoryChips
                total={plugins.length}
                options={categoryOptions}
                value={activeCategoryFilter}
                onChange={setCategoryFilter}
              />
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
  }

  // Browse and Installed are separate top-nav destinations now, not tabs:
  // Browse is the full-bleed discovery page (its description lives in the
  // hero), while Installed keeps the collection shell for its description and
  // actions row.
  return (
    <>
      {activeMode === "browse" ? (
        <div className="flex h-full min-h-0 flex-col">{content}</div>
      ) : (
        <ResourceCollectionPage
          id="plugins-collection"
          description={PLUGINS_INSTALLED_DESCRIPTION}
          bandClassName={TOOLS_PAGE_BAND_CLASSES}
        >
          {content}
        </ResourceCollectionPage>
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

function InstalledPluginCategoryChips({
  total,
  options,
  value,
  onChange,
}: {
  total: number;
  options: readonly { id: string; label: string }[];
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  if (options.length === 0) return null;
  const chipClassName =
    "h-7 shrink-0 rounded-full px-3 font-normal aria-pressed:bg-state-active aria-pressed:text-foreground";
  return (
    <div
      role="radiogroup"
      aria-label="Filter installed plugins by category"
      className="flex min-w-0 items-center gap-2 overflow-x-auto pb-1"
    >
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={chipClassName}
        role="radio"
        aria-checked={value === null}
        aria-pressed={value === null}
        onClick={() => onChange(null)}
      >
        All · {total}
      </Button>
      {options.map((option) => (
        <Button
          key={option.id}
          type="button"
          variant="outline"
          size="sm"
          className={chipClassName}
          role="radio"
          aria-checked={value === option.id}
          aria-pressed={value === option.id}
          onClick={() => onChange(option.id)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}
