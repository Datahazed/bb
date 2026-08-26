import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  matchPath,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
// Route views render icons outside the shell's core set. Importing the
// extended registry here ships it as a static dependency of this route chunk,
// so those icons never flash blank waiting for an on-demand load.
import "@bb/shared-ui/icon-extended";
import { useMutation } from "@tanstack/react-query";
import { appToast } from "@/components/ui/app-toast";
import { OverflowFade } from "@/components/ui/overflow-fade";
import { useScrollOverflowState } from "@/components/thread/timeline/useScrollOverflowState";
import {
  ConfirmDeleteDialog,
  ConfirmDeleteDialogContent,
} from "@/components/dialogs/ConfirmDeleteDialog";
import { AddPluginDialog } from "@/components/plugin/management/AddPluginDialog";
import {
  ResourceListState,
  useResourceRouteLabel,
} from "@bb/shared-ui/resource-list";
import { Skeleton } from "@bb/shared-ui/skeleton";
import { PluginsOverview } from "@/components/plugin/PluginsOverview";
import { PluginAuthorPage } from "@/components/plugin/management/PluginAuthorPage";
import { PluginIcon } from "@/components/plugin/PluginIcon";
import {
  CatalogPluginDetail,
  CatalogPluginDetailBanner,
  PluginDetail,
  PluginDetailBanners,
  pluginIsLocalSource,
  pluginRemovalDescription,
  pluginRemovalLabel,
} from "@/components/tools/PluginDetail";
import {
  usePluginCatalogSearch,
  type PluginCatalogSearchEntry,
} from "@/hooks/queries/plugin-catalog-queries";
import {
  removePlugin,
  setPluginEnabled,
  usePluginList,
  usePluginListings,
  type PluginListItem,
} from "@/hooks/queries/plugin-settings-queries";
import { useLocalOpenTargets } from "@/hooks/useLocalOpenTargets";
import {
  TOOLS_PLUGIN_AUTHOR_ROUTE_PATH,
  TOOLS_PLUGIN_DETAIL_ROUTE_PATH,
  TOOLS_REGISTRY_SKILLS_ROUTE_PATH,
  TOOLS_SKILLS_ROUTE_PATH,
  getPluginAuthorRoutePath,
  getPluginDetailRoutePath,
  getPluginsRoutePath,
  getRootComposeRoutePath,
} from "@/lib/route-paths";
import { buildEditInstalledPluginPrompt } from "@/lib/plugin-listing-prompts";
import {
  getToolsOwnedCollectionRoutePath,
  resolveToolsSection,
  type ToolsSectionId,
} from "@/components/tools/tools-navigation";
import { cn } from "@bb/shared-ui/lib/utils";
import { SkillsLibrary } from "@/components/tools/SkillsLibrary";
import { SecondaryPanelLayout } from "@/components/secondary-panel/SecondaryPanelLayout";
import { ThreadSecondaryPanel } from "@/components/secondary-panel/ThreadSecondaryPanel";
import type { SecondaryPanelRenderableTab } from "@/components/secondary-panel/secondaryPanelTab";

function ToolsBodyFallback() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-4 pb-4 pt-2 md:px-5">
        <div className="space-y-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-24 w-full rounded-md" />
          <Skeleton className="h-24 w-full rounded-md" />
        </div>
      </div>
    </div>
  );
}

function ToolsScrollPage({
  children,
  fillViewport = false,
}: {
  children: ReactNode;
  fillViewport?: boolean;
}) {
  const {
    scrollRef,
    topSentinelRef,
    bottomSentinelRef,
    aboveOverflow,
    belowOverflow,
  } = useScrollOverflowState<HTMLDivElement>({ measureOverflow: true });
  if (fillViewport) {
    // The child owns the only scrollable region (a ResourceCollectionViewport),
    // so this page must NOT constrain its width: the scroller has to span the
    // whole pane for the wheel to work from the gutters, and each band inside
    // it centers itself with TOOLS_PAGE_BAND_CLASSES instead.
    return (
      <div className="box-border h-full w-full pb-4 pt-3 md:pt-4">
        {children}
      </div>
    );
  }
  return (
    <div className="relative h-full overflow-hidden">
      <div ref={scrollRef} className="h-full overflow-y-auto">
        <div ref={topSentinelRef} aria-hidden className="h-0" />
        <div
          className={cn(
            "mx-auto box-border min-h-full w-full space-y-4 px-4 pb-4 pt-3 md:px-5 md:pt-4",
            "max-w-5xl",
          )}
        >
          {children}
        </div>
        <div ref={bottomSentinelRef} aria-hidden className="h-0" />
      </div>
      {aboveOverflow ? (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-0">
          <OverflowFade placement="below" tone="background" />
        </div>
      ) : null}
      {belowOverflow ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-0">
          <OverflowFade placement="above" tone="background" />
        </div>
      ) : null}
    </div>
  );
}

function ToolsSectionBody({
  activeSection,
  authorId,
  pathname,
  onOpenPlugin,
}: {
  activeSection: ToolsSectionId;
  authorId: string | null;
  pathname: string;
  onOpenPlugin: (
    pluginId: string,
    view?: "browse" | "installed" | "my",
  ) => void;
}) {
  if (activeSection === "skills") {
    const isCollection =
      pathname === TOOLS_SKILLS_ROUTE_PATH ||
      pathname === TOOLS_REGISTRY_SKILLS_ROUTE_PATH;
    return (
      <ToolsScrollPage fillViewport={isCollection}>
        <SkillsLibrary />
      </ToolsScrollPage>
    );
  }
  return <PluginsToolView authorId={authorId} onOpenPlugin={onOpenPlugin} />;
}

function PluginsToolView({
  authorId,
  onOpenPlugin,
}: {
  authorId: string | null;
  onOpenPlugin: (
    pluginId: string,
    view?: "browse" | "installed" | "my",
  ) => void;
}) {
  return authorId === null ? (
    <ToolsScrollPage fillViewport>
      <PluginsOverview onOpenPlugin={onOpenPlugin} />
    </ToolsScrollPage>
  ) : (
    <ToolsScrollPage fillViewport>
      <PluginAuthorPage
        authorId={authorId}
        onOpenPlugin={(pluginId) => onOpenPlugin(pluginId, "browse")}
      />
    </ToolsScrollPage>
  );
}

function decodedRouteParam(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    // A malformed deep link stays addressable and resolves to the ordinary
    // not-found state instead of crashing the Extensions route.
    return value;
  }
}

function PluginDetailToolView({
  pluginId,
  onOpenPlugin,
}: {
  pluginId: string;
  onOpenPlugin: (pluginId: string) => void;
}) {
  const navigate = useNavigate();
  const [deleteTarget, setDeleteTarget] = useState<PluginListItem | null>(null);
  const [installTarget, setInstallTarget] =
    useState<PluginCatalogSearchEntry | null>(null);
  const listQuery = usePluginList({ enabled: true });
  const listingsQuery = usePluginListings({ enabled: true });
  const catalogQuery = usePluginCatalogSearch(pluginId, { enabled: true });
  const allCatalogQuery = usePluginCatalogSearch("", { enabled: true });
  const plugins = useMemo(
    () => listQuery.data?.plugins ?? [],
    [listQuery.data],
  );
  const {
    canOpenPreferredDirectoryTarget,
    openPathInPreferredDirectoryTarget,
  } = useLocalOpenTargets({
    enabled: plugins.some(
      (plugin) => pluginIsLocalSource(plugin) && plugin.rootDir !== null,
    ),
  });
  const pluginToggle = useMutation({
    mutationFn: async (plugin: PluginListItem) => {
      const action = plugin.enabled ? "disable" : "enable";
      try {
        await setPluginEnabled(fetch, plugin.id, !plugin.enabled);
      } catch {
        throw new Error(`Failed to ${action} plugin`);
      }
    },
    onSuccess: () => listQuery.refetch(),
    onError: (error) => {
      appToast.error(error instanceof Error ? error.message : String(error));
    },
  });
  const pluginDelete = useMutation({
    mutationFn: async (plugin: PluginListItem) => {
      try {
        await removePlugin(fetch, plugin.id);
      } catch {
        throw new Error("Failed to delete plugin");
      }
    },
    onSuccess: (_data, deletedPlugin) => {
      appToast.success(
        pluginIsLocalSource(deletedPlugin)
          ? "Plugin removed from bb"
          : "Plugin uninstalled",
      );
      setDeleteTarget(null);
      navigate(getToolsOwnedCollectionRoutePath("plugins"));
      return listQuery.refetch();
    },
    onError: (error) => {
      appToast.error(error instanceof Error ? error.message : String(error));
    },
  });
  const isLoading = listQuery.isFetching && listQuery.data === undefined;
  const selectedPlugin =
    plugins.find((plugin) => plugin.id === pluginId) ?? null;
  const selectedCatalogEntry =
    catalogQuery.data?.find((entry) => entry.pluginId === pluginId) ??
    allCatalogQuery.data?.find((entry) => entry.pluginId === pluginId) ??
    null;
  const selectedListingLifecycle =
    listingsQuery.data?.records.find((record) => record.pluginId === pluginId)
      ?.lifecycle ?? null;
  const catalogEntries = allCatalogQuery.data ?? catalogQuery.data ?? [];
  useResourceRouteLabel(
    selectedPlugin?.name ??
      selectedPlugin?.id ??
      selectedCatalogEntry?.displayName ??
      null,
  );
  const pendingPluginId =
    pluginToggle.isPending && pluginToggle.variables
      ? pluginToggle.variables.id
      : pluginDelete.isPending && pluginDelete.variables
        ? pluginDelete.variables.id
        : null;
  const handleEditPlugin = useCallback(
    (plugin: PluginListItem) => {
      navigate(getRootComposeRoutePath(), {
        state: {
          focusPrompt: true,
          initialPrompt: buildEditInstalledPluginPrompt({
            name: plugin.name ?? plugin.id,
            path: plugin.rootDir,
          }),
          replaceInitialPrompt: true,
        },
      });
    },
    [navigate],
  );
  const handleOpenPluginSource = useCallback(
    (plugin: PluginListItem) => {
      if (!canOpenPreferredDirectoryTarget) return;
      void openPathInPreferredDirectoryTarget({
        path: plugin.rootDir,
        lineNumber: null,
      });
    },
    [canOpenPreferredDirectoryTarget, openPathInPreferredDirectoryTarget],
  );

  let detailContent: ReactNode;
  if (listQuery.isError) {
    detailContent = (
      <ResourceListState
        state="error"
        message="Couldn't load plugin."
        layout="detail"
        maxWidthClassName="max-w-5xl"
        onRetry={() => void listQuery.refetch()}
      />
    );
  } else if (isLoading) {
    detailContent = (
      <ResourceListState
        state="loading"
        message="Loading plugin"
        layout="detail"
        maxWidthClassName="max-w-5xl"
      />
    );
  } else if (selectedPlugin !== null) {
    detailContent = (
      <PluginDetail
        isLoading={false}
        plugin={selectedPlugin}
        pending={pendingPluginId === selectedPlugin.id}
        openSourceDisabled={!canOpenPreferredDirectoryTarget}
        onToggle={(target) => pluginToggle.mutate(target)}
        onEdit={handleEditPlugin}
        onOpenSource={handleOpenPluginSource}
        onDelete={setDeleteTarget}
        catalogEntry={selectedCatalogEntry}
        catalogEntries={catalogEntries}
        onOpenPlugin={onOpenPlugin}
        listingLifecycle={selectedListingLifecycle}
      />
    );
  } else if (catalogQuery.isError) {
    detailContent = (
      <ResourceListState
        state="error"
        message="Couldn't load plugin."
        layout="detail"
        maxWidthClassName="max-w-5xl"
        onRetry={() => void catalogQuery.refetch()}
      />
    );
  } else if (catalogQuery.isFetching && catalogQuery.data === undefined) {
    detailContent = (
      <ResourceListState
        state="loading"
        message="Loading plugin"
        layout="detail"
        maxWidthClassName="max-w-5xl"
      />
    );
  } else if (selectedCatalogEntry !== null && !selectedCatalogEntry.installed) {
    detailContent = (
      <CatalogPluginDetail
        entry={selectedCatalogEntry}
        onInstall={setInstallTarget}
        catalogEntries={catalogEntries}
        onOpenPlugin={onOpenPlugin}
      />
    );
  } else if (selectedCatalogEntry?.installed) {
    detailContent = (
      <ResourceListState
        state="error"
        message="Couldn't load the installed plugin."
        layout="detail"
        maxWidthClassName="max-w-5xl"
        onRetry={() => void listQuery.refetch()}
      />
    );
  } else {
    detailContent = (
      <ResourceListState
        state="empty"
        message="Plugin not found."
        layout="detail"
        maxWidthClassName="max-w-5xl"
      />
    );
  }

  return (
    // The priority notice sits outside the scroll page so runtime conditions
    // and acquisition blockers share the pane-wide alignment and stay with the
    // controls that resolve them.
    <div className="flex h-full min-h-0 flex-col">
      {selectedPlugin !== null ? (
        <PluginDetailBanners plugin={selectedPlugin} />
      ) : selectedCatalogEntry !== null && !selectedCatalogEntry.installed ? (
        <CatalogPluginDetailBanner entry={selectedCatalogEntry} />
      ) : null}
      <div className="min-h-0 flex-1">
        <ToolsScrollPage>
          {detailContent}
          <ConfirmDeleteDialog
            open={deleteTarget !== null}
            onOpenChange={(open) => {
              if (!open && !pluginDelete.isPending) setDeleteTarget(null);
            }}
          >
            {deleteTarget ? (
              <ConfirmDeleteDialogContent
                title={
                  pluginIsLocalSource(deleteTarget)
                    ? "Remove plugin from bb?"
                    : "Uninstall plugin?"
                }
                description={pluginRemovalDescription(deleteTarget)}
                confirmLabel={pluginRemovalLabel(deleteTarget)}
                pending={pluginDelete.isPending}
                onConfirm={() => pluginDelete.mutate(deleteTarget)}
                onCancel={() => setDeleteTarget(null)}
              />
            ) : null}
          </ConfirmDeleteDialog>
          <AddPluginDialog
            open={installTarget !== null}
            initial={
              installTarget === null
                ? null
                : {
                    entryId: installTarget.entryId,
                    marketplace: installTarget.marketplace,
                    publisherLabel: installTarget.publisherLabel,
                    displayName: installTarget.displayName,
                    icon: installTarget.icon,
                    iconUrl: installTarget.iconUrl,
                    iconTinted: installTarget.iconTinted,
                    source: installTarget.source,
                  }
            }
            onOpenChange={(open) => {
              if (!open) setInstallTarget(null);
            }}
            onInstalled={() => void listQuery.refetch()}
          />
        </ToolsScrollPage>
      </div>
    </div>
  );
}

/** Renders a plugin detail directly when a split workspace owns the pane. */
export function PluginDetailPaneView({ pluginId }: { pluginId: string }) {
  const navigate = useNavigate();
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-hidden">
        <Suspense fallback={<ToolsBodyFallback />}>
          <PluginDetailToolView
            pluginId={pluginId}
            onOpenPlugin={(nextPluginId) =>
              navigate(getPluginDetailRoutePath({ pluginId: nextPluginId }))
            }
          />
        </Suspense>
      </div>
    </div>
  );
}

export function ToolsView({
  pluginId: explicitPluginId,
}: {
  pluginId?: string;
} = {}) {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const pluginId =
    explicitPluginId ??
    decodedRouteParam(
      matchPath(TOOLS_PLUGIN_DETAIL_ROUTE_PATH, location.pathname)?.params
        .pluginId,
    );
  const routeAuthorId = decodedRouteParam(
    matchPath(TOOLS_PLUGIN_AUTHOR_ROUTE_PATH, location.pathname)?.params
      .authorId,
  );
  const activeSection = resolveToolsSection(location.pathname);
  const panelAuthorId =
    routeAuthorId ??
    (pluginId === undefined ? null : searchParams.get("author"));
  const [openedPluginIds, setOpenedPluginIds] = useState<string[]>([]);
  const catalogQuery = usePluginCatalogSearch("", {
    enabled: activeSection === "plugins",
  });
  const listQuery = usePluginList({ enabled: activeSection === "plugins" });

  useEffect(() => {
    if (pluginId === undefined) return;
    setOpenedPluginIds((current) =>
      current.includes(pluginId) ? current : [...current, pluginId],
    );
  }, [pluginId]);

  const visiblePluginIds =
    pluginId === undefined || openedPluginIds.includes(pluginId)
      ? openedPluginIds
      : [...openedPluginIds, pluginId];

  const navigateToPlugin = useCallback(
    (nextPluginId: string, view?: "browse" | "installed" | "my") => {
      const nextSearch = new URLSearchParams(searchParams);
      if (panelAuthorId === null) nextSearch.delete("author");
      else nextSearch.set("author", panelAuthorId);
      if (view === "installed") nextSearch.set("view", "installed");
      if (view === "my") nextSearch.set("view", "my");
      if (view === "browse") nextSearch.delete("view");
      const query = nextSearch.toString();
      navigate({
        pathname: getPluginDetailRoutePath({ pluginId: nextPluginId }),
        search: query.length === 0 ? "" : `?${query}`,
      });
    },
    [navigate, panelAuthorId, searchParams],
  );

  const closePanel = useCallback(() => {
    const nextSearch = new URLSearchParams(searchParams);
    nextSearch.delete("author");
    const query = nextSearch.toString();
    navigate({
      pathname:
        panelAuthorId === null
          ? getPluginsRoutePath()
          : getPluginAuthorRoutePath({ authorId: panelAuthorId }),
      search: query.length === 0 ? "" : `?${query}`,
    });
  }, [navigate, panelAuthorId, searchParams]);

  const closePluginTab = useCallback(
    (closingPluginId: string) => {
      const closingIndex = visiblePluginIds.indexOf(closingPluginId);
      const nextPluginIds = visiblePluginIds.filter(
        (candidate) => candidate !== closingPluginId,
      );
      setOpenedPluginIds(nextPluginIds);
      if (pluginId !== closingPluginId) return;
      const nextPluginId =
        nextPluginIds[Math.min(closingIndex, nextPluginIds.length - 1)];
      if (nextPluginId === undefined) closePanel();
      else navigateToPlugin(nextPluginId);
    },
    [closePanel, navigateToPlugin, pluginId, visiblePluginIds],
  );

  const reorderPluginTabs = useCallback(
    ({
      activeTabId,
      overTabId,
    }: {
      activeTabId: string;
      overTabId: string;
    }) => {
      const activePluginId = visiblePluginIds.find(
        (candidate) => `marketplace-plugin:${candidate}` === activeTabId,
      );
      const overPluginId = visiblePluginIds.find(
        (candidate) => `marketplace-plugin:${candidate}` === overTabId,
      );
      if (activePluginId === undefined || overPluginId === undefined) return;
      const nextPluginIds = [...visiblePluginIds];
      const from = nextPluginIds.indexOf(activePluginId);
      const to = nextPluginIds.indexOf(overPluginId);
      nextPluginIds.splice(from, 1);
      nextPluginIds.splice(to, 0, activePluginId);
      setOpenedPluginIds(nextPluginIds);
    },
    [visiblePluginIds],
  );

  const panelTabs = useMemo<readonly SecondaryPanelRenderableTab[]>(
    () =>
      visiblePluginIds.map((tabPluginId) => {
        const catalogEntry = catalogQuery.data?.find(
          (entry) => entry.pluginId === tabPluginId,
        );
        const installedPlugin = listQuery.data?.plugins.find(
          (entry) => entry.id === tabPluginId,
        );
        const label =
          catalogEntry?.displayName ??
          installedPlugin?.name ??
          installedPlugin?.id ??
          tabPluginId;
        return {
          contentFillsRegion: true,
          label,
          leadingVisual: (
            <PluginIcon
              pluginId={tabPluginId}
              icon={catalogEntry?.icon ?? installedPlugin?.icon ?? null}
              compactIconUrl={installedPlugin?.compactIconUrl}
              className="size-3.5"
            />
          ),
          onClose: () => closePluginTab(tabPluginId),
          onSelect: () => navigateToPlugin(tabPluginId),
          renderContent: () => (
            <PluginDetailToolView
              pluginId={tabPluginId}
              onOpenPlugin={navigateToPlugin}
            />
          ),
          statusLabel: null,
          tab: {
            id: `marketplace-plugin:${tabPluginId}`,
            kind: "marketplace-plugin-detail",
          },
        };
      }),
    [
      catalogQuery.data,
      closePluginTab,
      listQuery.data?.plugins,
      navigateToPlugin,
      visiblePluginIds,
    ],
  );
  const activePanelTab =
    pluginId === undefined
      ? null
      : (panelTabs.find(
          (tab) => tab.tab.id === `marketplace-plugin:${pluginId}`,
        )?.tab ?? null);
  const mainContent = (
    <div className="min-h-0 flex-1 overflow-hidden">
      <Suspense fallback={<ToolsBodyFallback />}>
        <ToolsSectionBody
          activeSection={activeSection}
          authorId={panelAuthorId}
          pathname={location.pathname}
          onOpenPlugin={navigateToPlugin}
        />
      </Suspense>
    </div>
  );
  const renderPanel = useCallback(
    ({
      presentation,
      onToggleMainCollapse,
      resizablePanelId,
    }: {
      presentation: "inline" | "drawer";
      onToggleMainCollapse: () => void;
      resizablePanelId?: string;
    }) => (
      <ThreadSecondaryPanel
        activeTab={activePanelTab}
        canUseGitUi={false}
        metadataContent={null}
        tabs={panelTabs}
        fixedTabs={[]}
        onTabReorder={reorderPluginTabs}
        isOpen={pluginId !== undefined}
        showConversationCollapseControl={false}
        showNewTabButton={false}
        onPanelFocus={() => {}}
        onCollapse={closePanel}
        onClose={closePanel}
        onOpenNewTab={() => {}}
        isConversationCollapsed={false}
        onToggleConversationCollapse={onToggleMainCollapse}
        renderAsDrawer={presentation === "drawer"}
        resizablePanelId={resizablePanelId}
      />
    ),
    [activePanelTab, closePanel, panelTabs, pluginId, reorderPluginTabs],
  );

  return (
    <div className="-mx-4 -mb-4 -mt-4 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden md:-mx-5 md:-mb-5 md:-mt-5">
      <SecondaryPanelLayout
        open={pluginId !== undefined}
        onToggle={pluginId === undefined ? () => {} : closePanel}
        onClose={closePanel}
        panelGroupKey="extensions-plugin-details"
        resetKey={pluginId ?? panelAuthorId ?? "extensions-plugins"}
        contentKey={pluginId ?? panelAuthorId ?? "extensions-plugins"}
        drawerLabel="Plugin details"
        drawerFallback={
          <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
            <Skeleton className="h-8 w-40 rounded-md" />
            <Skeleton className="h-36 w-full rounded-md" />
            <Skeleton className="h-24 w-full rounded-md" />
          </div>
        }
        mainPanelId="extensions-main-panel"
        main={mainContent}
        renderPanel={renderPanel}
        composerHost={null}
      />
    </div>
  );
}
