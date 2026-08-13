import {
  useCallback,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Panel, PanelGroup } from "react-resizable-panels";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { ResponsiveDrawerShell } from "@bb/shared-ui/responsive-overlay";
import { Icon } from "@bb/shared-ui/icon";
import { BrowserTabDeck } from "@/components/secondary-panel/BrowserTabDeck";
import { ThreadSecondaryPanel } from "@/components/secondary-panel/ThreadSecondaryPanel";
import { useThreadFileTabs } from "@/components/secondary-panel/useThreadFileTabs";
import {
  useCloseFixedSecondaryPanel,
  useFixedPanelTabsState,
} from "@/lib/fixed-panel-tabs";
import { isDesktopBrowserAvailable } from "@/lib/bb-desktop";
import { dispatchBrowserViewBoundsSync } from "@/lib/browser-view-bounds-sync";
import { isHttpOrHttpsUrl } from "@/lib/in-app-browser-link-preference";
import { PANEL_COLLAPSE_TRANSITION_CLASS } from "@/components/secondary-panel/panelTransitionTokens";
import { PluginBrowserTabNavigationProvider } from "./plugin-browser-tab-navigation";

const MAIN_PANEL_MIN_SIZE_PERCENT = 30;

export function PluginPanelBrowserHost({
  children,
  panelPath,
  pluginId,
}: {
  children: ReactNode;
  panelPath: string;
  pluginId: string;
}) {
  const panelStateId = `plugin-panel:${pluginId}:${panelPath}`;
  const panelState = useFixedPanelTabsState(panelStateId, null);
  const closePanel = useCloseFixedSecondaryPanel(panelStateId, null);
  const {
    activateTab,
    activeBrowserTab,
    browserTabs,
    closeTab,
    openTab,
    reorderFileTab,
    updateBrowserTab,
  } = useThreadFileTabs({
    panelStateId,
    syncThreadId: null,
    environmentId: null,
    storageFiles: undefined,
    terminalSessions: undefined,
  });
  const renderAsDrawer = useIsCompactViewport();
  const isOpen =
    panelState.secondary.isOpen && activeBrowserTab !== null;
  const drawerSessionKey =
    renderAsDrawer && isOpen ? (activeBrowserTab?.id ?? null) : null;
  const [settledDrawerSessionKey, setSettledDrawerSessionKey] = useState<
    string | null
  >(null);
  const isDrawerSettled =
    drawerSessionKey !== null && settledDrawerSessionKey === drawerSessionKey;

  const openBrowserTab = useCallback(
    ({ url }: { url: string }) => {
      if (!isDesktopBrowserAvailable() || !isHttpOrHttpsUrl(url)) return false;
      const existingTab = browserTabs.find((tab) => tab.url === url);
      if (existingTab) {
        activateTab(existingTab.id);
      } else {
        openTab({ kind: "browser", url });
      }
      return true;
    },
    [activateTab, browserTabs, openTab],
  );
  const browserDeck = useMemo(
    () => (
      <BrowserTabDeck
        browserTabs={browserTabs}
        activeBrowserTabId={activeBrowserTab?.id ?? null}
        environmentId={null}
        canShowNativeBrowserView={
          isOpen && (!renderAsDrawer || isDrawerSettled)
        }
        threadId={panelStateId}
        onUpdate={updateBrowserTab}
      />
    ),
    [
      activeBrowserTab?.id,
      browserTabs,
      isDrawerSettled,
      isOpen,
      panelStateId,
      renderAsDrawer,
      updateBrowserTab,
    ],
  );
  const fileTabs = useMemo(
    () =>
      browserTabs.map((tab) => ({
        id: tab.id,
        filename:
          tab.title ??
          (tab.url.length > 0 ? new URL(tab.url).hostname : "Browser"),
        isActive: tab.id === activeBrowserTab?.id,
        leadingVisual: <Icon name="Globe" className="size-3.5" aria-hidden />,
        statusLabel: null,
        onSelect: () => activateTab(tab.id),
        onClose: () => closeTab(tab.id),
      })),
    [activateTab, activeBrowserTab?.id, browserTabs, closeTab],
  );
  const browserPanel = browserTabs.length > 0 ? (
    <ThreadSecondaryPanel
      activeTab={activeBrowserTab}
      canUseGitUi={false}
      metadataContent={null}
      fileTabs={fileTabs}
      onFileTabReorder={reorderFileTab}
      browserDeck={browserDeck}
      isBrowserTabActive={activeBrowserTab !== null}
      isOpen={isOpen}
      showConversationCollapseControl={false}
      showGitDiffTab={false}
      showInfoTab={false}
      showNewTabButton={false}
      topChromeSurface="page"
      onPanelFocus={() => {}}
      onPanelChange={() => {}}
      onCollapse={closePanel}
      onClose={closePanel}
      onOpenNewTab={() => {}}
      isConversationCollapsed={false}
      onToggleConversationCollapse={() => {}}
      renderAsDrawer={renderAsDrawer}
    />
  ) : null;

  return (
    <PluginBrowserTabNavigationProvider openBrowserTab={openBrowserTab}>
      <div className="flex h-full min-h-0 min-w-0 flex-1 overflow-hidden">
        {renderAsDrawer ? (
          children
        ) : (
          <PanelGroup
            direction="horizontal"
            className="@container h-full min-w-0 flex-1"
            style={{ overflow: "clip" }}
          >
            <Panel
              id={`plugin-panel-main-${pluginId}-${panelPath}`}
              defaultSize={isOpen ? 65 : 100}
              minSize={MAIN_PANEL_MIN_SIZE_PERCENT}
              order={1}
              className={`min-w-0 overflow-clip transition-[flex-grow,flex-basis] ${PANEL_COLLAPSE_TRANSITION_CLASS}`}
            >
              {children}
            </Panel>
            {browserPanel}
          </PanelGroup>
        )}
        {renderAsDrawer ? (
          <ResponsiveDrawerShell
            open={isOpen}
            onOpenChange={(open) => {
              if (!open) {
                setSettledDrawerSessionKey(null);
                closePanel();
              }
            }}
            srLabel="Browser"
            contentClassName="h-[92dvh] max-h-[92dvh]"
            onContentAnimationEnd={(open) => {
              if (!open) return;
              window.requestAnimationFrame(() => {
                dispatchBrowserViewBoundsSync();
                setSettledDrawerSessionKey(drawerSessionKey);
              });
            }}
          >
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              {browserPanel}
            </div>
          </ResponsiveDrawerShell>
        ) : null}
      </div>
    </PluginBrowserTabNavigationProvider>
  );
}
