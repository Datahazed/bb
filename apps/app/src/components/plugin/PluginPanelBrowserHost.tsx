import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Panel, PanelGroup } from "react-resizable-panels";
import { BB_DESKTOP_BROWSER_MAX_URL_LENGTH } from "@bb/desktop-contract";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import {
  PersistentResponsiveDrawerShell,
  useResponsiveDrawerRealization,
} from "@bb/shared-ui/responsive-overlay";
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
import { PANEL_COLLAPSE_TRANSITION_CLASS } from "@/components/secondary-panel/panelTransitionTokens";
import { useOptionalPaneContext } from "@/views/thread-detail/PaneContext";
import { PluginBrowserTabNavigationProvider } from "./plugin-browser-tab-navigation";

const MAIN_PANEL_MIN_SIZE_PERCENT = 30;

function parsePluginBrowserUrl(url: string): URL | null {
  if (url.length > BB_DESKTOP_BROWSER_MAX_URL_LENGTH) {
    return null;
  }
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export function PluginPanelBrowserHost({
  children,
  panelPath,
  pluginId,
}: {
  children: ReactNode;
  panelPath: string;
  pluginId: string;
}) {
  const paneContext = useOptionalPaneContext();
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
  const isOpen = panelState.secondary.isOpen && activeBrowserTab !== null;
  const canShowWideNativeBrowserView =
    paneContext === null || !paneContext.isSplitPane || paneContext.isFocused;
  const drawerSessionKey =
    renderAsDrawer && isOpen ? (activeBrowserTab?.id ?? null) : null;
  const [settledDrawerSessionKey, setSettledDrawerSessionKey] = useState<
    string | null
  >(null);
  const isDrawerSettled =
    drawerSessionKey !== null && settledDrawerSessionKey === drawerSessionKey;
  const { isContentRealized: isPanelRealized, realizeContent: realizePanel } =
    useResponsiveDrawerRealization({ open: isOpen, enabled: renderAsDrawer });
  const drawerSettleFrameRef = useRef<number | null>(null);
  const drawerSettleGenerationRef = useRef(0);
  const drawerSettleStateRef = useRef({
    drawerSessionKey,
    isOpen,
    renderAsDrawer,
  });

  useLayoutEffect(() => {
    drawerSettleStateRef.current = {
      drawerSessionKey,
      isOpen,
      renderAsDrawer,
    };
  }, [drawerSessionKey, isOpen, renderAsDrawer]);

  const cancelDrawerSettleFrame = useCallback(() => {
    drawerSettleGenerationRef.current += 1;
    if (drawerSettleFrameRef.current === null) {
      return;
    }
    window.cancelAnimationFrame(drawerSettleFrameRef.current);
    drawerSettleFrameRef.current = null;
  }, []);

  useLayoutEffect(() => {
    cancelDrawerSettleFrame();
    setSettledDrawerSessionKey(null);
  }, [cancelDrawerSettleFrame, drawerSessionKey, isOpen, renderAsDrawer]);

  useLayoutEffect(
    () => () => {
      cancelDrawerSettleFrame();
    },
    [cancelDrawerSettleFrame],
  );

  const handleDrawerContentAnimationEnd = useCallback(
    (open: boolean) => {
      if (!open) {
        return;
      }
      const currentState = drawerSettleStateRef.current;
      if (
        !currentState.isOpen ||
        !currentState.renderAsDrawer ||
        currentState.drawerSessionKey === null
      ) {
        return;
      }

      cancelDrawerSettleFrame();
      const requestGeneration = drawerSettleGenerationRef.current;
      const requestSessionKey = currentState.drawerSessionKey;
      drawerSettleFrameRef.current = window.requestAnimationFrame(() => {
        drawerSettleFrameRef.current = null;
        const latestState = drawerSettleStateRef.current;
        if (
          drawerSettleGenerationRef.current !== requestGeneration ||
          !latestState.isOpen ||
          !latestState.renderAsDrawer ||
          latestState.drawerSessionKey !== requestSessionKey
        ) {
          return;
        }

        dispatchBrowserViewBoundsSync();

        const stateAfterSync = drawerSettleStateRef.current;
        if (
          drawerSettleGenerationRef.current === requestGeneration &&
          stateAfterSync.isOpen &&
          stateAfterSync.renderAsDrawer &&
          stateAfterSync.drawerSessionKey === requestSessionKey
        ) {
          setSettledDrawerSessionKey(requestSessionKey);
          realizePanel();
        }
      });
    },
    [cancelDrawerSettleFrame, realizePanel],
  );

  const experimentalOpenBrowserTab = useCallback(
    ({ url }: { url: string }) => {
      if (!isDesktopBrowserAvailable() || parsePluginBrowserUrl(url) === null) {
        return false;
      }
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
          isOpen &&
          (renderAsDrawer ? isDrawerSettled : canShowWideNativeBrowserView)
        }
        threadId={panelStateId}
        onUpdate={updateBrowserTab}
      />
    ),
    [
      activeBrowserTab?.id,
      browserTabs,
      canShowWideNativeBrowserView,
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
          tab.title ?? (parsePluginBrowserUrl(tab.url)?.hostname || "Browser"),
        isActive: tab.id === activeBrowserTab?.id,
        leadingVisual: <Icon name="Globe" className="size-3.5" aria-hidden />,
        statusLabel: null,
        onSelect: () => activateTab(tab.id),
        onClose: () => closeTab(tab.id),
      })),
    [activateTab, activeBrowserTab?.id, browserTabs, closeTab],
  );
  const browserPanel =
    browserTabs.length > 0 ? (
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
    ) : (
      browserDeck
    );

  return (
    <PluginBrowserTabNavigationProvider
      experimentalOpenBrowserTab={experimentalOpenBrowserTab}
    >
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
          <PersistentResponsiveDrawerShell
            open={isOpen}
            onOpenChange={(open) => {
              if (!open) {
                closePanel();
              }
            }}
            srLabel="Browser"
            contentClassName="h-[92dvh] max-h-[92dvh]"
            onContentAnimationEnd={handleDrawerContentAnimationEnd}
          >
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              {isPanelRealized ? browserPanel : null}
            </div>
          </PersistentResponsiveDrawerShell>
        ) : null}
      </div>
    </PluginBrowserTabNavigationProvider>
  );
}
