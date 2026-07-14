import { useMemo, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import {
  RESOURCE_LIST_PAGE_SIZE,
  ResourcePagination,
  useResourcePagination,
} from "@bb/shared-ui/resource-pagination";
import {
  ResourceCollectionPage,
  ResourceListState,
  ResourceSortMenu,
  ResourceToolbar,
  type ResourceCollectionMode,
} from "@bb/shared-ui/resource-list";
import {
  CREATE_PLUGIN_PROMPT,
  CreateWithTemplatesButton,
} from "@/components/create-via-prompt-examples";
import {
  AddPluginDialog,
  type AddPluginInitial,
} from "@/components/plugin/management/AddPluginDialog";
import { BrowsePluginsTab } from "@/components/plugin/management/BrowsePluginsTab";
import { InstalledPluginsTab } from "@/components/plugin/management/InstalledPluginsTab";
import { MarketplacesTab } from "@/components/plugin/management/MarketplacesTab";
import { useMarketplaces } from "@/hooks/queries/plugin-marketplace-queries";
import { usePluginList } from "@/hooks/queries/plugin-settings-queries";
import { useSystemConfig } from "@/hooks/queries/system-queries";
import { getRootComposeRoutePath } from "@/lib/route-paths";

type PluginsCollectionMode = "installed" | "browse" | "marketplaces";

const INSTALLABLE_MODES = new Set<PluginsCollectionMode>([
  "browse",
  "marketplaces",
]);

function modeFromSearchParams(
  value: string | null,
  marketplaceManagementEnabled: boolean,
): PluginsCollectionMode {
  if (
    marketplaceManagementEnabled &&
    (value === "browse" || value === "marketplaces")
  ) {
    return value;
  }
  return "installed";
}

/**
 * The canonical Plugins collection: installed resources, discoverable
 * resources, and the marketplace sources that make discovery possible.
 * Modes are URL-backed projections of one collection, not separate settings
 * pages; plugin configuration and lifecycle depth remain on the detail route.
 */
export function PluginsOverview() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const systemConfig = useSystemConfig();
  const marketplaceManagementEnabled =
    systemConfig.data?.experiments.plugins === true;
  // Installed and builtin plugins remain visible even when installing new
  // plugins is disabled by the experiment.
  const listQuery = usePluginList({ enabled: true });
  const marketplacesQuery = useMarketplaces({
    enabled: marketplaceManagementEnabled,
  });
  const plugins = useMemo(
    () => listQuery.data?.plugins ?? [],
    [listQuery.data],
  );
  const activeMode = modeFromSearchParams(
    searchParams.get("view"),
    marketplaceManagementEnabled,
  );
  const [installedQuery, setInstalledQuery] = useState("");
  const [installedSortDirection, setInstalledSortDirection] = useState<
    "asc" | "desc"
  >("asc");
  const [addDialog, setAddDialog] = useState<{
    open: boolean;
    initial: AddPluginInitial | null;
  }>({ open: false, initial: null });
  const [marketplaceAddOpen, setMarketplaceAddOpen] = useState(false);

  const modes: readonly ResourceCollectionMode<PluginsCollectionMode>[] = [
    {
      id: "installed",
      label: "Installed",
      count: plugins.length,
      accessibleLabel: `Installed, ${plugins.length} ${
        plugins.length === 1 ? "plugin" : "plugins"
      }`,
    },
    ...(marketplaceManagementEnabled
      ? [
          { id: "browse" as const, label: "Browse" },
          {
            id: "marketplaces" as const,
            label: "Marketplaces",
            ...(marketplacesQuery.data !== undefined
              ? {
                  count: marketplacesQuery.data.length,
                  accessibleLabel: `Marketplaces, ${marketplacesQuery.data.length} ${
                    marketplacesQuery.data.length === 1
                      ? "marketplace"
                      : "marketplaces"
                  }`,
                }
              : {}),
          },
        ]
      : []),
  ];
  const normalizedInstalledQuery = installedQuery.trim().toLowerCase();
  const visiblePlugins = useMemo(
    () =>
      plugins
        .filter((plugin) => {
          if (normalizedInstalledQuery.length === 0) return true;
          return [
            plugin.id,
            plugin.displayName ?? "",
            plugin.description ?? "",
            plugin.version,
            plugin.sourceDisplay,
          ]
            .join(" ")
            .toLowerCase()
            .includes(normalizedInstalledQuery);
        })
        .sort((left, right) => {
          const result = (left.displayName ?? left.id).localeCompare(
            right.displayName ?? right.id,
          );
          return installedSortDirection === "asc" ? result : -result;
        }),
    [installedSortDirection, normalizedInstalledQuery, plugins],
  );
  const installedPagination = useResourcePagination(visiblePlugins, {
    pageSize: RESOURCE_LIST_PAGE_SIZE,
    resetKey: [normalizedInstalledQuery, installedSortDirection].join("\u0000"),
  });

  const changeMode = (mode: PluginsCollectionMode) => {
    if (!marketplaceManagementEnabled && INSTALLABLE_MODES.has(mode)) return;
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (mode === "installed") next.delete("view");
        else next.set("view", mode);
        return next;
      },
      { replace: false },
    );
  };
  const startCreatePlugin = (prompt?: string) =>
    navigate(getRootComposeRoutePath(), {
      state: {
        focusPrompt: true,
        initialPrompt: prompt ?? CREATE_PLUGIN_PROMPT,
        replaceInitialPrompt: true,
        createDraftKind: "plugin",
      },
    });

  const actions = (
    <>
      <CreateWithTemplatesButton
        kind="plugin"
        label="New plugin"
        onCreate={startCreatePlugin}
      />
      {marketplaceManagementEnabled ? (
        activeMode === "marketplaces" ? (
          <Button
            type="button"
            size="sm"
            className="h-7 px-2.5 text-xs"
            onClick={() => setMarketplaceAddOpen(true)}
          >
            <Icon name="Plus" className="size-3.5" />
            Add marketplace
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            className="h-7 px-2.5 text-xs"
            onClick={() => setAddDialog({ open: true, initial: null })}
          >
            <Icon name="Plus" className="size-3.5" />
            Add plugin
          </Button>
        )
      ) : null}
    </>
  );

  let content: ReactNode;
  if (activeMode === "browse") {
    content = (
      <BrowsePluginsTab
        onInstall={(initial) => setAddDialog({ open: true, initial })}
      />
    );
  } else if (activeMode === "marketplaces") {
    content = (
      <MarketplacesTab
        addOpen={marketplaceAddOpen}
        onAddOpenChange={setMarketplaceAddOpen}
      />
    );
  } else {
    content = (
      <div id="plugins-installed-results" className="space-y-3">
        <ResourceToolbar
          searchValue={installedQuery}
          searchPlaceholder="Search installed plugins"
          onSearchChange={setInstalledQuery}
          containedControls
          controls={
            <ResourceSortMenu
              value="alpha"
              direction={installedSortDirection}
              options={[{ id: "alpha", label: "Plugin name" }]}
              onChange={() =>
                setInstalledSortDirection((current) =>
                  current === "asc" ? "desc" : "asc",
                )
              }
            />
          }
        />
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
            message={`No plugins match "${installedQuery}"`}
          />
        ) : (
          <InstalledPluginsTab plugins={installedPagination.items} />
        )}
        {!listQuery.isError &&
        !(listQuery.isFetching && listQuery.data === undefined) &&
        visiblePlugins.length > 0 ? (
          <ResourcePagination
            page={installedPagination.page}
            pageSize={installedPagination.pageSize}
            total={installedPagination.total}
            visibleCount={installedPagination.visibleCount}
            onPageChange={installedPagination.setPage}
            scrollTargetId="plugins-installed-results"
          />
        ) : null}
        {!marketplaceManagementEnabled && systemConfig.data !== undefined ? (
          <p className="px-1 text-2xs text-subtle-foreground">
            Browsing and installation are off. Turn on Plugins in Settings →
            Experiments to add plugins or marketplaces.
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <ResourceCollectionPage
      id="plugins-collection"
      description="Customize bb with plugins. Plugins can add app surfaces, commands, services, schedules, and skills."
      modes={modes}
      activeMode={activeMode}
      onModeChange={changeMode}
      actions={actions}
    >
      {content}
      <AddPluginDialog
        open={addDialog.open}
        initial={addDialog.initial}
        onOpenChange={(open) =>
          setAddDialog((current) => ({ ...current, open }))
        }
      />
    </ResourceCollectionPage>
  );
}
