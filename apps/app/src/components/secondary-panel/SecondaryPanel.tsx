import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { useAtom, useAtomValue, useSetAtom, useStore } from "jotai";
import type { TerminalSession } from "@bb/server-contract";
import { EmptyStatePanel } from "@bb/shared-ui/empty-state";
import {
  useCloseTerminal,
  useCreateTerminal,
  useTerminals,
} from "@/hooks/queries/thread-terminal-queries";
import {
  DEFAULT_TERMINAL_COLS,
  DEFAULT_TERMINAL_ROWS,
  type ThreadTerminalTarget,
} from "@/components/thread/terminal/useThreadTerminalController";
import { ThreadTerminalPanel } from "@/components/thread/terminal/ThreadTerminalPanel";
import { useAppCommandHandler } from "@/components/commands/AppCommandProvider";
import { getBbDesktopInfo, getDesktopBrowserApi } from "@/lib/bb-desktop";
import { isRoutePath } from "@/lib/route-paths";
import { createNewTabFixedPanelTab } from "@/lib/fixed-panel-tabs-state";
import { getFixedPanelTabsStateAtom } from "@/lib/fixed-panel-tabs";
import type { PluginPanelFixedPanelTab } from "@/lib/fixed-panel-tabs-state";
import { usePluginSlots } from "@/lib/plugin-slots";
import {
  usePluginNewThreadPanelActions,
  usePluginPanelActions,
} from "@/components/plugin/PluginPanelActions";
import { BrowserTabDeck } from "./BrowserTabDeck";
import type { BrowserAddressFocusRequest } from "./BrowserTabContent";
import { NewTabPage } from "./NewTabPage";
import { FilePreview } from "./FilePreview";
import {
  HostFilePreviewTabContent,
  ProjectFilePreviewTabContent,
  ThreadStorageFilePreviewTabContent,
  WorkspaceFilePreviewTabContent,
} from "./ThreadSecondaryPanelTabContent";
import {
  ThreadSecondaryPanel,
  type ThreadSecondaryPanelProps,
} from "./ThreadSecondaryPanel";
import { useSecondaryPanelFileTabs } from "./useSecondaryPanelFileTabs";
import { isSecondaryFileTab } from "./secondaryPanelTabState";
import {
  buildTerminalSyncedSecondaryFileTabs,
  findActiveTerminalIdInSecondaryFileTabs,
  getRetainedTerminalTabId,
  resolveSecondaryPanelTerminalSessions,
} from "./terminalPanelTabs";
import {
  getActivateSecondaryFileTabAtom,
  getActivateSecondaryTerminalTabAtom,
  getActiveFixedSecondaryTabAtom,
  getCloseSecondaryFileTabAtom,
  getCloseSecondaryPanelAtom,
  getChangeSecondaryPanelAtom,
  getIsSecondaryPanelOpenAtom,
  getNewTabAutoFocusAtom,
  getOpenBrowserTabAndRevealAtom,
  getOpenCompactDrawerAtom,
  getOpenPluginPanelAtom,
  getOpenSecondaryPanelNewTabAtom,
  getOrderedSecondaryFileTabsAtom,
  getPersistedSecondaryPanelOpenAtom,
  getRemoveSecondaryTerminalTabAtom,
  getReorderSecondaryFileTabAtom,
  getSecondaryPanelActiveFileTabsAtom,
  getSecondaryPanelBrowserTabsAtom,
  getSelectFileSearchResultAtom,
  getSetActiveSecondaryTerminalAtom,
  getTerminalAutoFocusAtom,
  getToggleSecondaryPanelAtom,
  getTouchFixedPanelTabsAtom,
  getUpdateSecondaryBrowserTabAtom,
  useSecondaryPanelSessionEffects,
  useSecondaryPanelUrlOpener,
  type SecondaryPanelActiveFileTabs,
  type SecondaryPanelNavigation,
  type SecondaryPanelStorageFile,
  type SecondaryPanelVariant,
} from "./secondaryPanelSession";

/**
 * The one secondary panel component. Both the New thread surface and thread
 * detail render it around their content with view-bound config; it owns the
 * session effects, the app-command handlers, the terminal/browser wiring, and
 * the panel rendering. Layout components place the panel by rendering a
 * {@link SecondaryPanelOutlet} (via the view's `renderSecondaryPanel` slot),
 * which reads this component's context.
 */

type TerminalContent = Omit<
  ComponentProps<typeof ThreadTerminalPanel>,
  | "autoFocus"
  | "canCreateTerminal"
  | "isPanelOpen"
  | "isPanelPersistedOpen"
  | "onAutoFocusHandled"
  | "panelStateId"
  | "target"
>;
type NewTabContent = Omit<
  ComponentProps<typeof NewTabPage>,
  | "autoFocus"
  | "onAutoFocusHandled"
  | "onOpenBrowser"
  | "onSelect"
  | "onStartTerminal"
  | "pluginActions"
  | "recentItemsThreadId"
>;
type WorkspaceFileContent = Omit<
  ComponentProps<typeof WorkspaceFilePreviewTabContent>,
  "activePath" | "lineRange" | "source" | "statusLabel"
>;
type ProjectFileContent = Omit<
  ComponentProps<typeof ProjectFilePreviewTabContent>,
  "activePath" | "lineRange"
>;
type HostFileContent = Omit<
  ComponentProps<typeof HostFilePreviewTabContent>,
  "activePath" | "lineRange"
>;
type StorageFileContent = Omit<
  ComponentProps<typeof ThreadStorageFilePreviewTabContent>,
  "activePath" | "lineRange"
>;

interface LoadingFileContent {
  copyPath: string;
  onOpenInEditor?: (path: string) => void;
}

export interface SecondaryPanelContent {
  hostFile?: HostFileContent;
  loadingHostFile?: LoadingFileContent;
  loadingStorageFile?: LoadingFileContent;
  newTab: NewTabContent;
  projectFile?: ProjectFileContent;
  renderPluginPanel: (tab: PluginPanelFixedPanelTab) => ReactNode;
  storageFile?: StorageFileContent;
  terminal?: TerminalContent;
  workspaceFile?: WorkspaceFileContent;
}

export interface SecondaryPanelGitDiff {
  canUseGitUi: boolean;
  onClearPendingGitDiffIntent: () => void;
  pendingGitDiffCommitSha: string | null;
  pendingGitDiffScrollPath: string | null;
  requestedMergeBaseBranch?: string;
}

export interface SecondaryPanelProps {
  canCreateTerminal: boolean;
  children: ReactNode;
  content: SecondaryPanelContent;
  environmentId: string | null | undefined;
  fileOwnerThreadId: string | null;
  /** Thread-view git-diff wiring; absent on surfaces without git UI. */
  gitDiff?: SecondaryPanelGitDiff;
  inlinePanelToggle?: ThreadSecondaryPanelProps["inlinePanelToggle"];
  isFocused: boolean;
  navigation: SecondaryPanelNavigation;
  onOpenFileInEditor?: (path: string) => void;
  onOpenFilePreview?: (path: string) => void;
  onOpenPreferred: () => boolean;
  onSelectionAddToChat?: (text: string) => void;
  onToggleDiff?: () => boolean;
  panelStateId: string;
  projectId: string | null;
  storageFiles: readonly SecondaryPanelStorageFile[] | undefined;
  syncThreadId: string | null;
  terminalTarget: ThreadTerminalTarget | null;
  threadId: string | null;
  variant: SecondaryPanelVariant;
  workspaceRootPath: string | null;
}

/** Per-slot layout inputs supplied by the layout that places the panel. */
export interface SecondaryPanelSlotProps {
  canShowNativeBrowserView: boolean;
  isConversationCollapsed?: boolean;
  metadataContent?: ReactNode;
  onToggleConversationCollapse?: () => void;
  renderAsDrawer: boolean;
  resizablePanelId?: string;
}

type OutletPanelProps = Omit<
  ThreadSecondaryPanelProps,
  | "browserDeck"
  | "isConversationCollapsed"
  | "metadataContent"
  | "onPanelResize"
  | "onToggleConversationCollapse"
  | "renderAsDrawer"
  | "resizablePanelId"
  | "showNewTabButton"
>;

interface SecondaryPanelOutletModel {
  defaultMetadataContent: ReactNode;
  panelProps: OutletPanelProps;
  renderBrowserDeck: (args: {
    canShowNativeBrowserView: boolean;
  }) => ReactNode;
}

const SecondaryPanelOutletContext =
  createContext<SecondaryPanelOutletModel | null>(null);

const EMPTY_TERMINAL_SESSIONS: readonly TerminalSession[] = [];

function noopToggleConversationCollapse(): void {}

/**
 * Renders the panel where a layout places it. Reads the surrounding
 * `SecondaryPanel`'s context; renders nothing outside one (layout tests).
 */
export function SecondaryPanelOutlet({
  canShowNativeBrowserView,
  isConversationCollapsed = false,
  metadataContent,
  onToggleConversationCollapse = noopToggleConversationCollapse,
  renderAsDrawer,
  resizablePanelId,
}: SecondaryPanelSlotProps) {
  const model = useContext(SecondaryPanelOutletContext);
  if (model === null) return null;
  return (
    <ThreadSecondaryPanel
      {...model.panelProps}
      browserDeck={model.renderBrowserDeck({ canShowNativeBrowserView })}
      isConversationCollapsed={isConversationCollapsed}
      metadataContent={metadataContent ?? model.defaultMetadataContent}
      onToggleConversationCollapse={onToggleConversationCollapse}
      renderAsDrawer={renderAsDrawer}
      {...(resizablePanelId === undefined ? {} : { resizablePanelId })}
    />
  );
}

/** The `renderSecondaryPanel` slot both views hand to their layout. */
export function renderSecondaryPanelOutlet(props: SecondaryPanelSlotProps) {
  return <SecondaryPanelOutlet {...props} />;
}

export interface SecondaryPanelCommandHandlersProps {
  canStartTerminal: boolean;
  isFocused: boolean;
  onCloseRequest: () => boolean;
  onOpenNewTab: () => void;
  onOpenPreferred: () => boolean;
  onStartTerminal: () => void;
  onToggleDiff?: () => boolean;
  onTogglePanel: () => void;
  /** Older desktop shells emit onOpenNewTab instead of the app command. */
  registerLegacyOpenNewTab: boolean;
}

export function SecondaryPanelCommandHandlers({
  canStartTerminal,
  isFocused,
  onCloseRequest,
  onOpenNewTab,
  onOpenPreferred,
  onStartTerminal,
  onToggleDiff,
  onTogglePanel,
  registerLegacyOpenNewTab,
}: SecondaryPanelCommandHandlersProps) {
  useAppCommandHandler("panel.toggle", () => {
    if (!isFocused) return false;
    onTogglePanel();
    return true;
  });
  useAppCommandHandler("panel.close", () => {
    if (!isFocused) return false;
    return onCloseRequest();
  });
  useAppCommandHandler("panel.newTab", () => {
    if (!isFocused) return false;
    onOpenNewTab();
    return true;
  });
  useAppCommandHandler("file.quickOpen", () => {
    if (!isFocused) return false;
    onOpenNewTab();
    return true;
  });
  useAppCommandHandler("terminal.open", () => {
    if (!isFocused || !canStartTerminal) return false;
    onStartTerminal();
    return true;
  });
  useAppCommandHandler("workspace.openPreferred", () => {
    if (!isFocused) return false;
    return onOpenPreferred();
  });
  useAppCommandHandler("diff.toggle", () => {
    if (!isFocused || onToggleDiff === undefined) return false;
    return onToggleDiff();
  });

  useEffect(() => {
    if (!isFocused) return;
    const desktopInfo = getBbDesktopInfo();
    if (desktopInfo?.onCloseWindowRequest === undefined) return;
    return desktopInfo.onCloseWindowRequest(onCloseRequest);
  }, [isFocused, onCloseRequest]);

  useEffect(() => {
    if (!isFocused || !registerLegacyOpenNewTab) return;
    const desktopInfo = getBbDesktopInfo();
    if (
      desktopInfo === null ||
      desktopInfo.onAppCommand !== undefined ||
      desktopInfo.onOpenNewTab === undefined
    ) {
      return;
    }
    return desktopInfo.onOpenNewTab(onOpenNewTab);
  }, [isFocused, onOpenNewTab, registerLegacyOpenNewTab]);

  return null;
}

interface ActiveTabContentProps {
  active: SecondaryPanelActiveFileTabs;
  activeTerminalId: string | null;
  canCreateTerminal: boolean;
  content: SecondaryPanelContent;
  isPersistedSecondaryPanelOpen: boolean;
  isSecondaryPanelOpen: boolean;
  onOpenBrowser: (() => void) | undefined;
  onSelectFileSearchResult: ComponentProps<typeof NewTabPage>["onSelect"];
  onStartTerminal: (() => void) | undefined;
  panelStateId: string;
  pluginActions: ComponentProps<typeof NewTabPage>["pluginActions"];
  terminalTarget: ThreadTerminalTarget | null;
}

function ActiveTabContent({
  active,
  activeTerminalId,
  canCreateTerminal,
  content,
  isPersistedSecondaryPanelOpen,
  isSecondaryPanelOpen,
  onOpenBrowser,
  onSelectFileSearchResult,
  onStartTerminal,
  panelStateId,
  pluginActions,
  terminalTarget,
}: ActiveTabContentProps) {
  const [shouldAutoFocusNewTab, setShouldAutoFocusNewTab] = useAtom(
    getNewTabAutoFocusAtom(panelStateId),
  );
  const [shouldAutoFocusTerminal, setShouldAutoFocusTerminal] = useAtom(
    getTerminalAutoFocusAtom(panelStateId),
  );
  const handleNewTabAutoFocusHandled = useCallback(
    () => setShouldAutoFocusNewTab(false),
    [setShouldAutoFocusNewTab],
  );
  const handleTerminalAutoFocusHandled = useCallback(
    () => setShouldAutoFocusTerminal(false),
    [setShouldAutoFocusTerminal],
  );

  if (
    activeTerminalId !== null &&
    content.terminal !== undefined &&
    terminalTarget !== null
  ) {
    return (
      <ThreadTerminalPanel
        {...content.terminal}
        autoFocus={shouldAutoFocusTerminal}
        canCreateTerminal={canCreateTerminal}
        isPanelOpen={isSecondaryPanelOpen}
        isPanelPersistedOpen={isPersistedSecondaryPanelOpen}
        onAutoFocusHandled={handleTerminalAutoFocusHandled}
        panelStateId={panelStateId}
        target={terminalTarget}
      />
    );
  }
  if (active.isNewTabActive) {
    return (
      <NewTabPage
        {...content.newTab}
        autoFocus={shouldAutoFocusNewTab}
        onAutoFocusHandled={handleNewTabAutoFocusHandled}
        onOpenBrowser={onOpenBrowser}
        onSelect={onSelectFileSearchResult}
        onStartTerminal={onStartTerminal}
        pluginActions={pluginActions}
        recentItemsThreadId={panelStateId}
      />
    );
  }
  if (active.activeWorkspaceFilePath !== null) {
    if (content.workspaceFile !== undefined) {
      return (
        <WorkspaceFilePreviewTabContent
          {...content.workspaceFile}
          activePath={active.activeWorkspaceFilePath}
          lineRange={active.activeWorkspaceFileLineRange}
          source={active.activeWorkspaceFileSource}
          statusLabel={active.activeWorkspaceFileStatusLabel}
        />
      );
    }
    if (content.projectFile !== undefined) {
      return (
        <ProjectFilePreviewTabContent
          {...content.projectFile}
          activePath={active.activeWorkspaceFilePath}
          lineRange={active.activeWorkspaceFileLineRange}
        />
      );
    }
  }
  if (active.activeHostFilePath !== null) {
    if (content.hostFile !== undefined) {
      return (
        <HostFilePreviewTabContent
          {...content.hostFile}
          activePath={active.activeHostFilePath}
          lineRange={active.activeHostFileLineRange}
        />
      );
    }
    if (content.loadingHostFile !== undefined) {
      return (
        <FilePreview
          {...content.loadingHostFile}
          path={active.activeHostFilePath}
          state={{ kind: "loading" }}
        />
      );
    }
  }
  if (active.activeStorageFilePath !== null) {
    if (content.storageFile !== undefined) {
      return (
        <ThreadStorageFilePreviewTabContent
          {...content.storageFile}
          activePath={active.activeStorageFilePath}
          lineRange={active.activeStorageFileLineRange}
        />
      );
    }
    if (content.loadingStorageFile !== undefined) {
      return (
        <FilePreview
          {...content.loadingStorageFile}
          path={active.activeStorageFilePath}
          state={{ kind: "loading" }}
        />
      );
    }
  }
  return active.activePluginPanelTab === null
    ? null
    : content.renderPluginPanel(active.activePluginPanelTab);
}

export function SecondaryPanel({
  canCreateTerminal,
  children,
  content,
  environmentId,
  fileOwnerThreadId,
  gitDiff,
  inlinePanelToggle,
  isFocused,
  navigation,
  onOpenFileInEditor,
  onOpenFilePreview,
  onOpenPreferred,
  onSelectionAddToChat,
  onToggleDiff,
  panelStateId,
  projectId,
  storageFiles,
  syncThreadId,
  terminalTarget,
  threadId,
  variant,
  workspaceRootPath,
}: SecondaryPanelProps) {
  const store = useStore();
  const isSecondaryPanelOpen = useAtomValue(
    getIsSecondaryPanelOpenAtom(panelStateId),
  );
  const isPersistedSecondaryPanelOpen = useAtomValue(
    getPersistedSecondaryPanelOpenAtom(panelStateId),
  );
  const activeFixedSecondaryTab = useAtomValue(
    getActiveFixedSecondaryTabAtom(panelStateId),
  );
  const activeFileTabs = useAtomValue(
    getSecondaryPanelActiveFileTabsAtom(panelStateId),
  );
  const orderedSecondaryFileTabs = useAtomValue(
    getOrderedSecondaryFileTabsAtom(panelStateId),
  );
  const browserTabs = useAtomValue(
    getSecondaryPanelBrowserTabsAtom(panelStateId),
  );

  const activateFileTab = useSetAtom(
    getActivateSecondaryFileTabAtom(panelStateId),
  );
  const activateTerminalTab = useSetAtom(
    getActivateSecondaryTerminalTabAtom(panelStateId),
  );
  const changePanel = useSetAtom(getChangeSecondaryPanelAtom(panelStateId));
  const closePanel = useSetAtom(getCloseSecondaryPanelAtom(panelStateId));
  const closeFileTab = useSetAtom(getCloseSecondaryFileTabAtom(panelStateId));
  const openBrowserTabAndReveal = useSetAtom(
    getOpenBrowserTabAndRevealAtom(panelStateId),
  );
  const openCompactDrawer = useSetAtom(getOpenCompactDrawerAtom(panelStateId));
  const openNewTab = useSetAtom(getOpenSecondaryPanelNewTabAtom(panelStateId));
  const openPluginPanel = useSetAtom(getOpenPluginPanelAtom(panelStateId));
  const removeTerminalTab = useSetAtom(
    getRemoveSecondaryTerminalTabAtom(panelStateId),
  );
  const reorderFileTab = useSetAtom(
    getReorderSecondaryFileTabAtom(panelStateId),
  );
  const selectFileSearchResult = useSetAtom(
    getSelectFileSearchResultAtom(panelStateId),
  );
  const setActiveTerminal = useSetAtom(
    getSetActiveSecondaryTerminalAtom(panelStateId),
  );
  const setTerminalAutoFocus = useSetAtom(
    getTerminalAutoFocusAtom(panelStateId),
  );
  const togglePanel = useSetAtom(getToggleSecondaryPanelAtom(panelStateId));
  const touchTabs = useSetAtom(getTouchFixedPanelTabsAtom(panelStateId));
  const updateBrowserTab = useSetAtom(
    getUpdateSecondaryBrowserTabAtom(panelStateId),
  );

  // Terminal sessions for this panel's target. The deck mirrors them as tabs.
  const retainedTerminalId = getRetainedTerminalTabId({
    activeTab: activeFixedSecondaryTab,
    isPanelOpen: isPersistedSecondaryPanelOpen,
  });
  const terminalQueryScope = useMemo(() => {
    if (terminalTarget?.kind !== "host_path") {
      return terminalTarget;
    }
    return {
      kind: "host_path" as const,
      hostId: terminalTarget.hostId,
      ...(terminalTarget.cwd === null ? {} : { cwd: terminalTarget.cwd }),
    };
  }, [terminalTarget]);
  const terminalsListQuery = useTerminals(terminalQueryScope, {
    enabled: isSecondaryPanelOpen && terminalTarget !== null,
  });
  const loadedTerminalSessions = resolveSecondaryPanelTerminalSessions({
    sessions: terminalsListQuery.data?.sessions,
    terminalTarget,
  });

  useSecondaryPanelSessionEffects({
    canCreateTerminal,
    environmentId,
    fileOwnerThreadId,
    navigation,
    panelStateId,
    projectId,
    retainedTerminalId,
    storageFiles,
    syncThreadId,
    terminalSessions: loadedTerminalSessions,
    terminalTarget,
    threadId,
    variant,
  });

  const createTerminal = useCreateTerminal();
  const closeTerminal = useCloseTerminal();
  const canStartTerminal =
    canCreateTerminal && terminalTarget !== null && !createTerminal.isPending;
  const handleStartTerminal = useCallback(() => {
    if (!canStartTerminal || terminalTarget === null) {
      return;
    }
    const newTab = createNewTabFixedPanelTab();
    void createTerminal
      .mutateAsync({
        cols: DEFAULT_TERMINAL_COLS,
        rows: DEFAULT_TERMINAL_ROWS,
        target: terminalTarget,
      })
      .then((session) => {
        closeFileTab(newTab.id);
        setTerminalAutoFocus(true);
        setActiveTerminal(session.id);
        openCompactDrawer();
      })
      .catch(() => undefined);
  }, [
    canStartTerminal,
    closeFileTab,
    createTerminal,
    openCompactDrawer,
    setActiveTerminal,
    setTerminalAutoFocus,
    terminalTarget,
  ]);
  const handleCloseTerminalTab = useCallback(
    (terminalId: string) => {
      if (terminalTarget === null) {
        removeTerminalTab(terminalId);
        return;
      }
      closeTerminal.mutate(
        { mode: "force", terminalId },
        { onSuccess: () => removeTerminalTab(terminalId) },
      );
    },
    [closeTerminal, removeTerminalTab, terminalTarget],
  );

  const handleCloseWindowRequest = useCallback(() => {
    if (!store.get(getIsSecondaryPanelOpenAtom(panelStateId))) {
      return false;
    }
    const state = store.get(getFixedPanelTabsStateAtom(panelStateId));
    const activeTab =
      state.secondary.tabs.find(
        (tab) => tab.id === state.secondary.activeTabId,
      ) ?? null;
    if (activeTab !== null && isSecondaryFileTab(activeTab)) {
      // Root compose hides a lone placeholder instead of closing/recreating
      // it (the auto-open effect would immediately put it back).
      if (
        variant === "root-compose" &&
        activeTab.kind === "new-tab" &&
        state.secondary.tabs.length === 1
      ) {
        closePanel();
        return true;
      }
      if (activeTab.kind === "terminal") {
        handleCloseTerminalTab(activeTab.terminalId);
      } else {
        closeFileTab(activeTab.id);
      }
      return true;
    }
    closePanel();
    return true;
  }, [
    closeFileTab,
    closePanel,
    handleCloseTerminalTab,
    panelStateId,
    store,
    variant,
  ]);

  // Browser deck: address-bar focus requests are per-mount UI state.
  const [browserAddressFocusRequest, setBrowserAddressFocusRequest] =
    useState<BrowserAddressFocusRequest | null>(null);
  const handleOpenBrowser = useCallback(() => {
    const tab = openBrowserTabAndReveal();
    if (tab !== null && tab.kind === "browser") {
      setBrowserAddressFocusRequest((current) => ({
        requestId: (current?.requestId ?? 0) + 1,
        tabId: tab.id,
      }));
    }
  }, [openBrowserTabAndReveal]);
  const handleBrowserAddressFocusRequestConsumed = useCallback(
    (request: BrowserAddressFocusRequest) => {
      setBrowserAddressFocusRequest((current) =>
        current?.requestId === request.requestId &&
        current.tabId === request.tabId
          ? null
          : current,
      );
    },
    [],
  );
  const activeBrowserTabId = activeFileTabs.activeBrowserTab?.id ?? null;
  const renderBrowserDeck = useCallback(
    ({ canShowNativeBrowserView }: { canShowNativeBrowserView: boolean }) => {
      if (threadId === null) return null;
      return (
        <BrowserTabDeck
          browserTabs={browserTabs}
          activeBrowserTabId={activeBrowserTabId}
          addressFocusRequest={browserAddressFocusRequest}
          onAddressFocusRequestConsumed={
            handleBrowserAddressFocusRequestConsumed
          }
          environmentId={environmentId ?? null}
          canShowNativeBrowserView={canShowNativeBrowserView}
          threadId={threadId}
          onUpdate={updateBrowserTab}
        />
      );
    },
    [
      activeBrowserTabId,
      browserAddressFocusRequest,
      browserTabs,
      environmentId,
      handleBrowserAddressFocusRequestConsumed,
      threadId,
      updateBrowserTab,
    ],
  );

  // Desktop browser popups: thread detail applies the user's URL routing
  // preference; root compose always lands them in the in-app deck.
  const { openUrlByPreference } = useSecondaryPanelUrlOpener(panelStateId);
  const browserTabIds = useMemo(
    () => new Set(browserTabs.map((tab) => tab.id)),
    [browserTabs],
  );
  useEffect(() => {
    const browserApi = getDesktopBrowserApi();
    if (browserApi === null) return;
    const openPopup =
      variant === "thread" ? openUrlByPreference : openBrowserTabAndReveal;
    if (browserApi.onScopedOpenTab) {
      return browserApi.onScopedOpenTab(({ tabId, url }) => {
        if (browserTabIds.has(tabId)) openPopup(url);
      });
    }
    return browserApi.onOpenTab(({ url }) => {
      if (!isRoutePath({ path: url })) openPopup(url);
    });
  }, [browserTabIds, openBrowserTabAndReveal, openUrlByPreference, variant]);

  // Plugin panel actions: registered slots for the strip's icons/layout, and
  // launcher entries (bound to the open-plugin-panel atom) for the new tab.
  const pluginSlots = usePluginSlots();
  const pluginPanelActionSlots =
    variant === "thread"
      ? pluginSlots.threadPanelActions
      : pluginSlots.newThreadPanelActions;
  const threadPluginActionEntries = usePluginPanelActions({
    openPluginPanel,
    threadId: variant === "thread" ? threadId : null,
  });
  const newThreadPluginActionEntries = usePluginNewThreadPanelActions({
    openPluginPanel,
    projectId: variant === "root-compose" ? projectId : null,
  });
  const pluginActionEntries =
    variant === "thread"
      ? threadPluginActionEntries
      : newThreadPluginActionEntries;

  const terminalSessions = loadedTerminalSessions ?? EMPTY_TERMINAL_SESSIONS;
  const syncedOrderedSecondaryFileTabs =
    loadedTerminalSessions === undefined
      ? orderedSecondaryFileTabs
      : buildTerminalSyncedSecondaryFileTabs({
          orderedTabs: orderedSecondaryFileTabs,
          retainedTerminalId,
          terminalSessions: loadedTerminalSessions,
        });
  // No manual memo: `terminalSessions` is conditionally derived, which the
  // React Compiler cannot preserve manual memoization across; it auto-memoizes
  // this in the production build instead.
  const terminalsById = new Map(
    terminalSessions.map((session) => [session.id, session]),
  );
  const activeFixedSecondaryTabId = activeFixedSecondaryTab?.id ?? null;
  const fileTabs = useSecondaryPanelFileTabs({
    activeTabId: activeFixedSecondaryTabId,
    // Root compose keeps its placeholder out of the tab strip.
    hideNewTab: variant === "root-compose",
    onActivateTab: activateFileTab,
    onActivateTerminal: activateTerminalTab,
    onCloseTab: closeFileTab,
    onCloseTerminal: handleCloseTerminalTab,
    orderedTabs: syncedOrderedSecondaryFileTabs,
    pluginPanelActions: pluginPanelActionSlots,
    terminalsById,
  });
  const activeTerminalId = findActiveTerminalIdInSecondaryFileTabs({
    activeTabId: activeFixedSecondaryTabId,
    tabs: syncedOrderedSecondaryFileTabs,
  });
  const activePluginPanelTab = activeFileTabs.activePluginPanelTab;
  const fileTabContentFillsRegion =
    activePluginPanelTab !== null &&
    pluginPanelActionSlots.find(
      (candidate) =>
        candidate.pluginId === activePluginPanelTab.pluginId &&
        candidate.id === activePluginPanelTab.actionId,
    )?.layout === "flush";

  const fileTabContent = (
    <ActiveTabContent
      active={activeFileTabs}
      activeTerminalId={activeTerminalId}
      canCreateTerminal={canCreateTerminal}
      content={content}
      isPersistedSecondaryPanelOpen={isPersistedSecondaryPanelOpen}
      isSecondaryPanelOpen={isSecondaryPanelOpen}
      onOpenBrowser={threadId !== null ? handleOpenBrowser : undefined}
      onSelectFileSearchResult={selectFileSearchResult}
      onStartTerminal={canCreateTerminal ? handleStartTerminal : undefined}
      panelStateId={panelStateId}
      pluginActions={pluginActionEntries}
      terminalTarget={terminalTarget}
    />
  );

  const canUseGitUi = gitDiff?.canUseGitUi ?? false;
  const panelProps: OutletPanelProps = {
    activeTab: activeFixedSecondaryTab,
    canUseGitUi,
    ...(gitDiff?.requestedMergeBaseBranch === undefined
      ? {}
      : { requestedMergeBaseBranch: gitDiff.requestedMergeBaseBranch }),
    ...(environmentId ? { environmentId } : {}),
    ...(workspaceRootPath ? { workspaceRootPath } : {}),
    ...(fileTabs === undefined ? {} : { fileTabs }),
    fileTabContent,
    fileTabContentFillsRegion,
    onFileTabReorder: reorderFileTab,
    isBrowserTabActive: activeFileTabs.activeBrowserTab !== null,
    isOpen: isSecondaryPanelOpen,
    showConversationCollapseControl: variant === "thread",
    showGitDiffTab: canUseGitUi,
    showInfoTab: variant === "thread",
    ...(inlinePanelToggle === undefined ? {} : { inlinePanelToggle }),
    onPanelFocus: touchTabs,
    onPanelChange: changePanel,
    onCollapse: closePanel,
    onClose: closePanel,
    ...(gitDiff === undefined
      ? {}
      : {
          onClearPendingGitDiffIntent: gitDiff.onClearPendingGitDiffIntent,
          pendingGitDiffCommitSha: gitDiff.pendingGitDiffCommitSha,
          pendingGitDiffScrollPath: gitDiff.pendingGitDiffScrollPath,
        }),
    onOpenNewTab: openNewTab,
    ...(onOpenFileInEditor === undefined ? {} : { onOpenFileInEditor }),
    ...(onOpenFilePreview === undefined ? {} : { onOpenFilePreview }),
    ...(onSelectionAddToChat === undefined ? {} : { onSelectionAddToChat }),
  };

  const defaultMetadataContent = (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 pt-1">
      <EmptyStatePanel className="rounded-lg">
        No thread details available.
      </EmptyStatePanel>
    </div>
  );

  const outletModel: SecondaryPanelOutletModel = {
    defaultMetadataContent,
    panelProps,
    renderBrowserDeck,
  };

  return (
    <SecondaryPanelOutletContext.Provider value={outletModel}>
      <SecondaryPanelCommandHandlers
        canStartTerminal={canStartTerminal}
        isFocused={isFocused}
        onCloseRequest={handleCloseWindowRequest}
        onOpenNewTab={openNewTab}
        onOpenPreferred={onOpenPreferred}
        onStartTerminal={handleStartTerminal}
        {...(onToggleDiff === undefined ? {} : { onToggleDiff })}
        onTogglePanel={togglePanel}
        registerLegacyOpenNewTab={variant === "thread"}
      />
      {children}
    </SecondaryPanelOutletContext.Provider>
  );
}
