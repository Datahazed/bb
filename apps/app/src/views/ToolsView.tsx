import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  matchPath,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import "@bb/shared-ui/icon-extended";
import { useMutation } from "@tanstack/react-query";
import { useWindowSize } from "usehooks-ts";
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
import {} from "@bb/shared-ui/responsive-overlay";
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
import { marketplaceSecondaryPanelWidthPercentAtom } from "@/components/secondary-panel/threadSecondaryPanelAtoms";
import {
  marketplaceDetailMinPercent,
  MARKETPLACE_DETAIL_MAX_WIDTH_PERCENT,
} from "@/components/tools/marketplacePaneSizing";
import { ThreadSecondaryPanel } from "@/components/secondary-panel/ThreadSecondaryPanel";
import type { SecondaryPanelRenderableTab } from "@/components/secondary-panel/secondaryPanelTab";

let pluginBrowseFocusReturn:
  | { accessibleLabel: string; occurrence: number }
  | undefined;
let retainedPluginDetailId: string | undefined;

function capturePluginBrowseFocusReturn(): void {
  const activeElement = document.activeElement;
  if (
    !(activeElement instanceof HTMLButtonElement) ||
    activeElement.closest("[data-persistent-drawer-content]") !== null
  ) {
    return;
  }
  const accessibleLabel = activeElement.getAttribute("aria-label");
  if (
    accessibleLabel === null ||
    !accessibleLabel.startsWith("Open ") ||
    !accessibleLabel.endsWith(" details")
  ) {
    return;
  }
  const matches = Array.from(
    document.querySelectorAll<HTMLButtonElement>(
      'button[aria-label^="Open "][aria-label$=" details"]',
    ),
  ).filter(
    (candidate) => candidate.getAttribute("aria-label") === accessibleLabel,
  );
  const occurrence = matches.indexOf(activeElement);
  if (occurrence >= 0) {
    pluginBrowseFocusReturn = { accessibleLabel, occurrence };
  }
}

function schedulePluginBrowseFocusRestore(fallbackTarget?: {
  accessibleLabel: string;
  occurrence: number;
}): void {
  const returnTarget = pluginBrowseFocusReturn ?? fallbackTarget;
  if (returnTarget === undefined) return;

  const restore = () => {
    const matches = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        'button[aria-label^="Open "][aria-label$=" details"]',
      ),
    ).filter(
      (candidate) =>
        candidate.getAttribute("aria-label") === returnTarget.accessibleLabel,
    );
    const target = matches[returnTarget.occurrence];
    if (target === undefined) return false;
    target.focus({ preventScroll: true });
    pluginBrowseFocusReturn = undefined;
    return true;
  };

  const observedRoot =
    document.getElementById("plugins-browse-results") ?? document.body;
  const observer = new MutationObserver(() => {
    if (document.activeElement === document.body) restore();
  });
  observer.observe(observedRoot, { childList: true, subtree: true });

  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      restore();
    });
  });
  window.setTimeout(() => {
    observer.disconnect();
    if (document.activeElement === document.body) restore();
  }, 2_000);
}

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
    return value;
  }
}

function PluginDetailToolView({
  pluginId,
  onOpenPlugin,
  seedCatalogEntry,
  seedPlugin,
  focusHeading = false,
}: {
  pluginId: string;
  onOpenPlugin: (pluginId: string) => void;
  seedCatalogEntry?: PluginCatalogSearchEntry | undefined;
  seedPlugin?: PluginListItem | undefined;
  focusHeading?: boolean;
}) {
  const navigate = useNavigate();
  const detailRootRef = useRef<HTMLDivElement>(null);
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
    plugins.find((plugin) => plugin.id === pluginId) ?? seedPlugin ?? null;
  const selectedCatalogEntry =
    catalogQuery.data?.find((entry) => entry.pluginId === pluginId) ??
    allCatalogQuery.data?.find((entry) => entry.pluginId === pluginId) ??
    seedCatalogEntry ??
    null;
  const selectedListingLifecycle =
    listingsQuery.data?.records.find((record) => record.pluginId === pluginId)
      ?.lifecycle ?? null;
  const catalogEntries = useMemo(() => {
    const entries = allCatalogQuery.data ?? catalogQuery.data ?? [];
    if (
      seedCatalogEntry === undefined ||
      entries.some((entry) => entry.pluginId === seedCatalogEntry.pluginId)
    ) {
      return entries;
    }
    return [seedCatalogEntry, ...entries];
  }, [allCatalogQuery.data, catalogQuery.data, seedCatalogEntry]);
  const identityReady =
    selectedPlugin !== null || selectedCatalogEntry !== null;
  useEffect(() => {
    if (!focusHeading || !identityReady) return;
    const frame = window.requestAnimationFrame(() => {
      const heading = detailRootRef.current?.querySelector<HTMLHeadingElement>(
        "h1",
      );
      if (heading === undefined || heading === null) return;
      if (!heading.hasAttribute("tabindex")) heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusHeading, identityReady, pluginId]);
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
  if (selectedPlugin !== null) {
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
  } else if (selectedCatalogEntry !== null && !selectedCatalogEntry.installed) {
    detailContent = (
      <CatalogPluginDetail
        entry={selectedCatalogEntry}
        onInstall={setInstallTarget}
        catalogEntries={catalogEntries}
        onOpenPlugin={onOpenPlugin}
      />
    );
  } else if (listQuery.isError) {
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
  } else if (
    (catalogQuery.isFetching && catalogQuery.data === undefined) ||
    (allCatalogQuery.isFetching && allCatalogQuery.data === undefined)
  ) {
    detailContent = (
      <ResourceListState
        state="loading"
        message="Loading plugin"
        layout="detail"
        maxWidthClassName="max-w-5xl"
      />
    );
  } else if (catalogQuery.isError) {
    detailContent = (
      <ResourceListState
        state="error"
        message="Couldn't load plugin."
        layout="detail"
        maxWidthClassName="max-w-5xl"
        onRetry={() => {
          void catalogQuery.refetch();
          void allCatalogQuery.refetch();
        }}
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
    <div ref={detailRootRef} className="flex h-full min-h-0 flex-col">
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

export function PluginDetailPaneView({ pluginId }: { pluginId: string }) {
  const navigate = useNavigate();
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-hidden">
        <Suspense fallback={<ToolsBodyFallback />}>
          <PluginDetailToolView
            pluginId={pluginId}
            focusHeading
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
  const [isPluginDetailFullPage, setIsPluginDetailFullPage] = useState(false);
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
  const visiblePluginIds = useMemo(() => {
    const visiblePluginId = pluginId ?? retainedPluginDetailId;
    return visiblePluginId === undefined ||
      openedPluginIds.includes(visiblePluginId)
      ? openedPluginIds
      : [...openedPluginIds, visiblePluginId];
  }, [openedPluginIds, pluginId]);

  const navigateToPlugin = useCallback(
    (nextPluginId: string, view?: "browse" | "installed" | "my") => {
      if (pluginId === undefined) capturePluginBrowseFocusReturn();
      retainedPluginDetailId = nextPluginId;
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
    [navigate, panelAuthorId, pluginId, searchParams],
  );

  const closePanel = useCallback(() => {
    setIsPluginDetailFullPage(false);
    if (pluginId !== undefined) retainedPluginDetailId = pluginId;
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
    const closingEntry = catalogQuery.data?.find(
      (entry) => entry.pluginId === pluginId,
    );
    schedulePluginBrowseFocusRestore(
      closingEntry === undefined
        ? undefined
        : {
            accessibleLabel: `Open ${closingEntry.displayName} details`,
            occurrence: 0,
          },
    );
  }, [catalogQuery.data, navigate, panelAuthorId, pluginId, searchParams]);

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
              seedCatalogEntry={catalogEntry}
              seedPlugin={installedPlugin}
              focusHeading={tabPluginId === pluginId}
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
      pluginId,
      visiblePluginIds,
    ],
  );
  const retainedPluginId = pluginId ?? retainedPluginDetailId;
  const activePanelTab =
    retainedPluginId === undefined
      ? null
      : (panelTabs.find(
          (tab) => tab.tab.id === `marketplace-plugin:${retainedPluginId}`,
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
  const { width: viewportWidth } = useWindowSize();
  const detailWidthPolicy = useMemo(
    () => ({
      minPercent: marketplaceDetailMinPercent(viewportWidth),
      maxPercent: MARKETPLACE_DETAIL_MAX_WIDTH_PERCENT,
      widthAtom: marketplaceSecondaryPanelWidthPercentAtom,
    }),
    [viewportWidth],
  );

  const renderPanel = useCallback(
    ({
      presentation,
      isMainCollapsed,
      onToggleMainCollapse,
      resizablePanelId,
    }: {
      presentation: "inline" | "drawer";
      isMainCollapsed: boolean;
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
        showConversationCollapseControl
        showNewTabButton={false}
        onPanelFocus={() => {}}
        onCollapse={closePanel}
        onClose={closePanel}
        hidePanelIcon="X"
        hidePanelLabel="Close plugin details"
        onOpenNewTab={() => {}}
        isConversationCollapsed={isMainCollapsed}
        onToggleConversationCollapse={onToggleMainCollapse}
        renderAsDrawer={presentation === "drawer"}
        resizablePanelId={resizablePanelId}
        widthPolicy={detailWidthPolicy}
      />
    ),
    [
      activePanelTab,
      closePanel,
      detailWidthPolicy,
      panelTabs,
      pluginId,
      reorderPluginTabs,
    ],
  );

  return (
    <div className="-mx-4 -mb-4 -mt-4 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden md:-mx-5 md:-mb-5 md:-mt-5">
      <SecondaryPanelLayout
        open={pluginId !== undefined}
        onToggle={pluginId === undefined ? () => {} : closePanel}
        onClose={closePanel}
        panelGroupKey="extensions-plugin-details"
        resetKey="extensions-plugin-details"
        contentKey={pluginId ?? panelAuthorId ?? "extensions-plugins"}
        drawerLabel="Plugin details"
        drawerFallback={
          <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
            <Skeleton className="h-8 w-40 rounded-md" />
            <Skeleton className="h-36 w-full rounded-md" />
            <Skeleton className="h-24 w-full rounded-md" />
          </div>
        }
        secondaryWidthAtom={marketplaceSecondaryPanelWidthPercentAtom}
        collapse={{
          active: isPluginDetailFullPage,
          onToggle: () => setIsPluginDetailFullPage((current) => !current),
        }}
        mainPanelId="extensions-main-panel"
        main={mainContent}
        renderPanel={renderPanel}
        composerHost={null}
      />
    </div>
  );
}
