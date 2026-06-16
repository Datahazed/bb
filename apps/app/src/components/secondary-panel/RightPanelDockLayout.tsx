import {
  createContext,
  type ReactNode,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  DockviewReact,
  type DockviewApi,
  type IDockviewHeaderActionsProps,
  type DockviewIDisposable,
  type DockviewReadyEvent,
  type IDockviewPanel,
  type IDockviewPanelHeaderProps,
  type IDockviewPanelProps,
  type SerializedDockview,
} from "dockview-react";
import { Button } from "@/components/ui/button.js";
import { Icon } from "@/components/ui/icon.js";
import { EmptyStatePanel } from "@/components/ui/empty-state.js";
import {
  COARSE_POINTER_COMPACT_ICON_BUTTON_CLASS,
  COARSE_POINTER_COMPACT_ICON_SIZE_CLASS,
} from "@/components/ui/coarse-pointer-sizing.js";
import { CHROME_SUBTLE_ICON_BUTTON_FOREGROUND_CLASS } from "@/components/ui/chromeStyleTokens";
import { TabPill } from "@/components/ui/tab-pill";
import { MACOS_WINDOW_NO_DRAG_CLASS } from "@/lib/bb-desktop";
import { cn } from "@/lib/utils";
import type {
  FixedPanelTab,
  SecondaryFixedPanelTab,
} from "@/lib/fixed-panel-tabs-state";
import type { ThreadSecondaryPanel as ThreadSecondaryPanelTab } from "@/lib/thread-secondary-panel";
import type { SecondaryPanelFileTab } from "./secondaryPanelFileTab";

const RIGHT_PANEL_DOCK_COMPONENT = "right-panel-tab";
const RIGHT_PANEL_DOCK_STORAGE_PREFIX = "bb.thread.rightPanelDockLayout";
const RIGHT_PANEL_DOCK_MAX_GROUPS = 4;
const RIGHT_PANEL_DOCK_PERSIST_DELAY_MS = 200;
const RIGHT_PANEL_DOCK_SCROLL_SLOT_CLASS =
  "min-h-0 flex-1 overflow-x-auto overflow-y-auto";

interface RightPanelDockLayoutProps {
  activeTab: SecondaryFixedPanelTab | null;
  browserDeck?: ReactNode;
  fileTabContent?: ReactNode;
  fileTabs?: readonly SecondaryPanelFileTab[];
  gitDiffContent: ReactNode;
  gitDiffToolbar?: ReactNode;
  headerActions: ReactNode;
  isBrowserTabActive: boolean;
  metadataContent: ReactNode;
  onPanelChange: (panel: ThreadSecondaryPanelTab) => void;
  renderTabContent?: (tab: FixedPanelTab) => ReactNode;
  reserveLeftForDesktopTrafficLights: boolean;
  tabs: readonly FixedPanelTab[];
  threadId?: string | null;
  usesDesktopChrome: boolean;
}

interface RightPanelDockTabParams {
  closable: boolean;
  tabId: string;
}

interface SyncDockviewPanelsArgs {
  activeTabId: string | null;
  api: DockviewApi;
  tabs: readonly DockPanelModel[];
}

interface DockPanelModel {
  closable: boolean;
  id: string;
  title: string;
}

interface RightPanelDockRenderContextValue {
  activeTabId: string | null;
  activateDockTab: (tabId: string) => void;
  browserDeck?: ReactNode;
  fileTabContent?: ReactNode;
  gitDiffContent: ReactNode;
  gitDiffToolbar?: ReactNode;
  headerActions: ReactNode;
  isBrowserTabActive: boolean;
  metadataContent: ReactNode;
  renderTabContent?: (tab: FixedPanelTab) => ReactNode;
  tabsById: ReadonlyMap<string, FixedPanelTab>;
  fileTabsById: ReadonlyMap<string, SecondaryPanelFileTab>;
  usesDesktopChrome: boolean;
}

const RightPanelDockRenderContext =
  createContext<RightPanelDockRenderContextValue | null>(null);

const RIGHT_PANEL_DOCK_COMPONENTS = {
  [RIGHT_PANEL_DOCK_COMPONENT]: RightPanelDockPanel,
};

function useRightPanelDockRenderContext(): RightPanelDockRenderContextValue {
  const context = useContext(RightPanelDockRenderContext);
  if (context === null) {
    throw new Error("RightPanelDockLayout context is missing.");
  }
  return context;
}

const RIGHT_PANEL_DOCK_HEADER_ACTIONS = RightPanelDockHeaderActions;

function getDockStorageKey(threadId: string | null | undefined): string | null {
  return threadId ? `${RIGHT_PANEL_DOCK_STORAGE_PREFIX}.${threadId}` : null;
}

function readStoredDockviewLayout(
  threadId: string | null | undefined,
): SerializedDockview | null {
  const storageKey = getDockStorageKey(threadId);
  if (storageKey === null) {
    return null;
  }

  const storedValue = window.localStorage.getItem(storageKey);
  if (storedValue === null) {
    return null;
  }

  try {
    const parsedValue: unknown = JSON.parse(storedValue);
    if (
      typeof parsedValue !== "object" ||
      parsedValue === null ||
      !("grid" in parsedValue) ||
      !("panels" in parsedValue)
    ) {
      return null;
    }
    return parsedValue as SerializedDockview;
  } catch {
    return null;
  }
}

function writeStoredDockviewLayout({
  layout,
  threadId,
}: {
  layout: SerializedDockview;
  threadId: string | null | undefined;
}): void {
  const storageKey = getDockStorageKey(threadId);
  if (storageKey === null) {
    return;
  }
  window.localStorage.setItem(storageKey, JSON.stringify(layout));
}

function isDockClosableTab(tab: FixedPanelTab): boolean {
  switch (tab.kind) {
    case "thread-info":
    case "git-diff":
      return false;
    case "workspace-file-preview":
    case "host-file-preview":
    case "thread-storage-file-preview":
    case "browser":
    case "new-tab":
    case "terminal":
      return true;
  }
}

function findFileTab(
  fileTabs: readonly SecondaryPanelFileTab[] | undefined,
  tabId: string,
): SecondaryPanelFileTab | null {
  return fileTabs?.find((tab) => tab.id === tabId) ?? null;
}

function getFilenameFromPath(path: string): string {
  return path.split("/").at(-1) ?? path;
}

function getDockTabTitle({
  fileTabs,
  tab,
}: {
  fileTabs: readonly SecondaryPanelFileTab[] | undefined;
  tab: FixedPanelTab;
}): string {
  const fileTab = findFileTab(fileTabs, tab.id);
  if (fileTab) {
    return fileTab.filename;
  }

  switch (tab.kind) {
    case "thread-info":
      return "Info";
    case "git-diff":
      return "Diff";
    case "workspace-file-preview":
    case "host-file-preview":
    case "thread-storage-file-preview":
      return getFilenameFromPath(tab.path);
    case "browser":
      return tab.title ?? "Browser";
    case "new-tab":
      return "New tab";
    case "terminal":
      return "Terminal";
  }
}

function buildDockPanelModels({
  fileTabs,
  tabs,
}: {
  fileTabs: readonly SecondaryPanelFileTab[] | undefined;
  tabs: readonly FixedPanelTab[];
}): readonly DockPanelModel[] {
  return tabs.map((tab) => ({
    closable: isDockClosableTab(tab),
    id: tab.id,
    title: getDockTabTitle({ fileTabs, tab }),
  }));
}

function updateDockPanel(panel: IDockviewPanel, model: DockPanelModel): void {
  if (panel.title !== model.title) {
    panel.setTitle(model.title);
  }
  panel.update({
    params: {
      closable: model.closable,
      tabId: model.id,
    } satisfies RightPanelDockTabParams,
  });
}

function syncDockviewPanels({
  activeTabId,
  api,
  tabs,
}: SyncDockviewPanelsArgs): void {
  const wantedIds = new Set(tabs.map((tab) => tab.id));
  for (const panel of api.panels) {
    if (!wantedIds.has(panel.id)) {
      api.removePanel(panel);
    }
  }

  for (const tab of tabs) {
    const existingPanel = api.getPanel(tab.id);
    if (existingPanel) {
      updateDockPanel(existingPanel, tab);
      continue;
    }

    api.addPanel<RightPanelDockTabParams>({
      id: tab.id,
      component: RIGHT_PANEL_DOCK_COMPONENT,
      inactive: tab.id !== activeTabId,
      params: {
        closable: tab.closable,
        tabId: tab.id,
      },
      title: tab.title,
    });
  }

  if (activeTabId) {
    const activePanel = api.getPanel(activeTabId);
    if (activePanel) {
      activePanel.group.model.openPanel(activePanel);
    }
  }
}

function RightPanelDockTab({
  api,
  params,
}: IDockviewPanelHeaderProps<RightPanelDockTabParams>) {
  const { activateDockTab, fileTabsById, tabsById, usesDesktopChrome } =
    useRightPanelDockRenderContext();
  const tab = tabsById.get(params.tabId);
  const fileTab = fileTabsById.get(params.tabId) ?? null;
  const isActive = api.group.activePanel?.id === params.tabId;
  const handleClose = useCallback(() => {
    api.close();
  }, [api]);

  if (tab?.kind === "thread-info" || tab?.kind === "git-diff") {
    return (
      <div
        className={cn(
          "inline-flex items-center justify-center transition-colors",
          COARSE_POINTER_COMPACT_ICON_BUTTON_CLASS,
          CHROME_SUBTLE_ICON_BUTTON_FOREGROUND_CLASS,
          isActive ? "bg-state-active text-foreground" : "hover:bg-state-hover",
          usesDesktopChrome && MACOS_WINDOW_NO_DRAG_CLASS,
        )}
        title={tab.kind === "thread-info" ? "Info" : "Diff"}
      >
        <Icon name={tab.kind === "thread-info" ? "Info" : "FileDiff"} />
      </div>
    );
  }

  if (fileTab) {
    return (
      <div
        className={cn(
          "bb-right-panel-dock-pill",
          usesDesktopChrome && MACOS_WINDOW_NO_DRAG_CLASS,
        )}
      >
        <TabPill
          label={fileTab.filename}
          leadingVisual={fileTab.leadingVisual}
          secondaryLabel={
            fileTab.statusLabel === null ? null : `(${fileTab.statusLabel})`
          }
          title={
            fileTab.statusLabel === null
              ? fileTab.filename
              : `${fileTab.filename} (${fileTab.statusLabel})`
          }
          isActive={isActive}
          onSelect={() => activateDockTab(params.tabId)}
          labelMaxWidthClass="max-w-[160px]"
          closeAction={
            fileTab.isPinned
              ? null
              : {
                  onClose: handleClose,
                  closeLabel: `Close ${fileTab.filename}`,
                  closeTooltip: "Close tab",
                }
          }
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "bb-right-panel-dock-tab",
        isActive
          ? "bg-muted text-foreground"
          : "text-muted-foreground hover:bg-state-hover",
        usesDesktopChrome && MACOS_WINDOW_NO_DRAG_CLASS,
      )}
    >
      <span className="min-w-0 truncate">{api.title ?? "Tab"}</span>
      {params.closable ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(
            COARSE_POINTER_COMPACT_ICON_BUTTON_CLASS,
            "ml-0.5 size-5 shrink-0",
          )}
          onPointerDown={(event) => {
            event.stopPropagation();
          }}
          onClick={(event) => {
            event.stopPropagation();
            handleClose();
          }}
          aria-label={`Close ${api.title ?? "tab"}`}
          title="Close tab"
        >
          <Icon name="X" className={COARSE_POINTER_COMPACT_ICON_SIZE_CLASS} />
        </Button>
      ) : null}
    </div>
  );
}

function RightPanelDockHeaderActions({
  containerApi,
  group,
}: IDockviewHeaderActionsProps) {
  const { headerActions, usesDesktopChrome } = useRightPanelDockRenderContext();
  if (containerApi.groups[0]?.id !== group.id) {
    return null;
  }
  return (
    <div
      className={cn(
        "bb-right-panel-dock-actions flex shrink-0 items-center gap-1",
        usesDesktopChrome && MACOS_WINDOW_NO_DRAG_CLASS,
      )}
    >
      {headerActions}
    </div>
  );
}

function RightPanelDockPanel({
  params,
}: IDockviewPanelProps<RightPanelDockTabParams>) {
  const {
    activeTabId,
    activateDockTab,
    browserDeck,
    fileTabContent,
    gitDiffContent,
    gitDiffToolbar,
    isBrowserTabActive,
    metadataContent,
    renderTabContent,
    tabsById,
  } = useRightPanelDockRenderContext();
  const tab = tabsById.get(params.tabId);
  if (!tab) {
    return null;
  }

  switch (tab.kind) {
    case "thread-info":
      return <ThreadInfoDockContent>{metadataContent}</ThreadInfoDockContent>;
    case "git-diff":
      return (
        <div className="flex h-full min-h-0 flex-col">
          {gitDiffToolbar}
          {gitDiffContent}
        </div>
      );
    case "browser":
      return activeTabId === tab.id && isBrowserTabActive ? (
        <div className="flex h-full min-h-0 flex-col">{browserDeck}</div>
      ) : (
        <InactiveDockTab tabId={tab.id} onSelect={activateDockTab} />
      );
    case "workspace-file-preview":
    case "host-file-preview":
    case "thread-storage-file-preview":
    case "new-tab":
      return (
        <div
          className={cn(RIGHT_PANEL_DOCK_SCROLL_SLOT_CLASS, "pb-3")}
          data-file-preview-scroll-container=""
        >
          {renderTabContent?.(tab) ??
            (activeTabId === tab.id ? (
              fileTabContent
            ) : (
              <EmptyStatePanel className="mx-4 mt-4 rounded-lg">
                No preview content.
              </EmptyStatePanel>
            ))}
        </div>
      );
    case "terminal":
      return activeTabId === tab.id ? (
        <div className="flex h-full min-h-0 flex-col overflow-hidden">
          {fileTabContent ?? (
            <EmptyStatePanel className="mx-4 mt-4 rounded-lg">
              No preview content.
            </EmptyStatePanel>
          )}
        </div>
      ) : (
        <InactiveDockTab tabId={tab.id} onSelect={activateDockTab} />
      );
  }
}

export function RightPanelDockLayout({
  activeTab,
  browserDeck,
  fileTabContent,
  fileTabs,
  gitDiffContent,
  gitDiffToolbar,
  headerActions,
  isBrowserTabActive,
  metadataContent,
  onPanelChange,
  renderTabContent,
  reserveLeftForDesktopTrafficLights,
  tabs,
  threadId,
  usesDesktopChrome,
}: RightPanelDockLayoutProps) {
  const [api, setApi] = useState<DockviewApi | null>(null);
  const isSyncingRef = useRef(false);
  const disposablesRef = useRef<readonly DockviewIDisposable[]>([]);
  const persistTimeoutRef = useRef<number | null>(null);
  const dockPanelModels = useMemo(
    () => buildDockPanelModels({ fileTabs, tabs }),
    [fileTabs, tabs],
  );
  const tabsById = useMemo(
    () => new Map(tabs.map((tab) => [tab.id, tab])),
    [tabs],
  );
  const fileTabsById = useMemo(
    () => new Map((fileTabs ?? []).map((tab) => [tab.id, tab])),
    [fileTabs],
  );
  const activeTabId = activeTab?.id ?? null;

  const activateDockTab = useCallback(
    (tabId: string) => {
      const tab = tabsById.get(tabId);
      if (!tab) {
        return;
      }
      switch (tab.kind) {
        case "thread-info":
          onPanelChange("thread-info");
          return;
        case "git-diff":
          onPanelChange("git-diff");
          return;
        case "workspace-file-preview":
        case "host-file-preview":
        case "thread-storage-file-preview":
        case "browser":
        case "new-tab":
        case "terminal":
          fileTabsById.get(tab.id)?.onSelect();
          return;
      }
    },
    [fileTabsById, onPanelChange, tabsById],
  );
  const activateDockTabRef = useRef(activateDockTab);
  useEffect(() => {
    activateDockTabRef.current = activateDockTab;
  }, [activateDockTab]);

  const closeDockTab = useCallback(
    (tabId: string) => {
      const tab = tabsById.get(tabId);
      if (!tab || !isDockClosableTab(tab)) {
        return;
      }
      fileTabsById.get(tab.id)?.onClose();
    },
    [fileTabsById, tabsById],
  );
  const closeDockTabRef = useRef(closeDockTab);
  useEffect(() => {
    closeDockTabRef.current = closeDockTab;
  }, [closeDockTab]);

  const renderContextValue = useMemo<RightPanelDockRenderContextValue>(
    () => ({
      activeTabId,
      activateDockTab,
      browserDeck,
      fileTabsById,
      fileTabContent,
      gitDiffContent,
      gitDiffToolbar,
      headerActions,
      isBrowserTabActive,
      metadataContent,
      renderTabContent,
      tabsById,
      usesDesktopChrome,
    }),
    [
      activateDockTab,
      activeTabId,
      browserDeck,
      fileTabsById,
      fileTabContent,
      gitDiffContent,
      gitDiffToolbar,
      headerActions,
      isBrowserTabActive,
      metadataContent,
      renderTabContent,
      tabsById,
      usesDesktopChrome,
    ],
  );

  const handleReady = useCallback(
    (event: DockviewReadyEvent) => {
      const dockApi = event.api;
      for (const disposable of disposablesRef.current) {
        disposable.dispose();
      }
      disposablesRef.current = [];
      setApi(dockApi);

      const storedLayout = readStoredDockviewLayout(threadId);
      if (storedLayout) {
        try {
          dockApi.fromJSON(storedLayout, { reuseExistingPanels: true });
        } catch {
          // Fall back to rebuilding from the app-owned tab list below.
        }
      }

      isSyncingRef.current = true;
      syncDockviewPanels({
        activeTabId,
        api: dockApi,
        tabs: dockPanelModels,
      });
      isSyncingRef.current = false;

      disposablesRef.current = [
        dockApi.onDidActivePanelChange((panel) => {
          if (!panel || isSyncingRef.current) {
            return;
          }
          activateDockTabRef.current(panel.id);
        }),
        dockApi.onDidRemovePanel((panel) => {
          if (isSyncingRef.current) {
            return;
          }
          closeDockTabRef.current(panel.id);
        }),
        dockApi.onDidLayoutChange(() => {
          if (isSyncingRef.current) {
            return;
          }
          if (persistTimeoutRef.current !== null) {
            window.clearTimeout(persistTimeoutRef.current);
          }
          persistTimeoutRef.current = window.setTimeout(() => {
            writeStoredDockviewLayout({
              layout: dockApi.toJSON(),
              threadId,
            });
            persistTimeoutRef.current = null;
          }, RIGHT_PANEL_DOCK_PERSIST_DELAY_MS);
        }),
        dockApi.onWillShowOverlay((event) => {
          if (
            event.position !== "center" &&
            event.api.groups.length >= RIGHT_PANEL_DOCK_MAX_GROUPS
          ) {
            event.preventDefault();
          }
        }),
      ];
    },
    [activeTabId, dockPanelModels, threadId],
  );

  useEffect(() => {
    if (!api) {
      return;
    }
    isSyncingRef.current = true;
    syncDockviewPanels({
      activeTabId,
      api,
      tabs: dockPanelModels,
    });
    isSyncingRef.current = false;
  }, [activeTabId, api, dockPanelModels]);

  useEffect(() => {
    return () => {
      for (const disposable of disposablesRef.current) {
        disposable.dispose();
      }
      disposablesRef.current = [];
      if (persistTimeoutRef.current !== null) {
        window.clearTimeout(persistTimeoutRef.current);
      }
    };
  }, []);

  return (
    <RightPanelDockRenderContext.Provider value={renderContextValue}>
      <div
        className={cn(
          "dockview-theme-light bb-right-panel-dock flex h-full min-h-0 min-w-0 flex-1 flex-col",
          usesDesktopChrome && "bb-right-panel-dock-macos",
          reserveLeftForDesktopTrafficLights &&
            "bb-right-panel-dock-reserve-left",
        )}
      >
        <DockviewReact
          components={RIGHT_PANEL_DOCK_COMPONENTS}
          defaultTabComponent={RightPanelDockTab}
          rightHeaderActionsComponent={RIGHT_PANEL_DOCK_HEADER_ACTIONS}
          disableFloatingGroups
          dndStrategy="pointer"
          noPanelsOverlay="emptyGroup"
          onReady={handleReady}
          onWillDrop={(event) => {
            if (
              event.position !== "center" &&
              event.api.groups.length >= RIGHT_PANEL_DOCK_MAX_GROUPS
            ) {
              event.preventDefault();
            }
          }}
        />
      </div>
    </RightPanelDockRenderContext.Provider>
  );
}

function ThreadInfoDockContent({ children }: { children: ReactNode }) {
  return <div className="flex min-h-0 flex-1 flex-col pb-3">{children}</div>;
}

function InactiveDockTab({
  onSelect,
  tabId,
}: {
  onSelect: (tabId: string) => void;
  tabId: string;
}) {
  return (
    <div className="h-full min-h-0 bg-background">
      <button
        type="button"
        className="block h-full w-full cursor-default"
        onClick={() => onSelect(tabId)}
        aria-label="Activate tab"
      />
    </div>
  );
}
