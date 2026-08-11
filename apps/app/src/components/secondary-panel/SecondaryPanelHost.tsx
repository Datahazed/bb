import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import type { TerminalSession } from "@bb/server-contract";
import { BrowserTabDeck } from "./BrowserTabDeck";
import type { BrowserAddressFocusRequest } from "./BrowserTabContent";
import type { ThreadSecondaryPanelProps } from "./ThreadSecondaryPanel";
import { useSecondaryPanelFileTabs } from "./useSecondaryPanelFileTabs";
import { useThreadFileTabs } from "./useThreadFileTabs";
import {
  buildTerminalSyncedSecondaryFileTabs,
  findActiveTerminalIdInSecondaryFileTabs,
  getRetainedTerminalTabId,
  syncTerminalTabsInFixedPanelState,
} from "./terminalPanelTabs";
import {
  useCloseFixedSecondaryPanel,
  useFixedPanelTabsState,
  useFixedPanelTabsStorageMaintenance,
  useOpenFixedSecondaryPanel,
  useRemoveFixedRightTerminalTab,
  useSetFixedRightTerminalActiveTerminal,
  useSetFixedSecondaryPanelTab,
  useTouchFixedPanelTabsState,
  useUpdateFixedPanelTabsState,
} from "@/lib/fixed-panel-tabs";
import {
  createNewTabFixedPanelTab,
  type SecondaryFixedPanelTab,
} from "@/lib/fixed-panel-tabs-state";
import { isSecondaryFileTab } from "./secondaryPanelTabState";
import {
  useThreadSecondaryPanelDrawerVisibility,
  useThreadSecondaryPanelVisibility,
} from "@/views/thread-detail/useThreadSecondaryPanelVisibility";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
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
import type { PromptMentionLinkResolver } from "@/components/promptbox/editor/prompt-mention-link";
import type { MarkdownPreviewLinkHandler } from "@/components/ui/markdown-link";
import {
  getDesktopBrowserApi,
  getBbDesktopInfo,
  isDesktopBrowserAvailable,
} from "@/lib/bb-desktop";
import { isRoutePath } from "@/lib/route-paths";
import {
  openUrlByPreference,
  resolveUrlOpenTarget,
  useOpenLinksInAppBrowserPreference,
} from "@/lib/in-app-browser-link-preference";
import { openUrlInExternalBrowser } from "@/lib/url-open-routing";
import { useAppCommandHandler } from "@/components/commands/AppCommandProvider";
import { ThreadTerminalPanel } from "@/components/thread/terminal/ThreadTerminalPanel";
import { NewTabPage } from "./NewTabPage";
import { FilePreview } from "./FilePreview";
import {
  HostFilePreviewTabContent,
  ProjectFilePreviewTabContent,
  ThreadStorageFilePreviewTabContent,
  WorkspaceFilePreviewTabContent,
} from "./ThreadSecondaryPanelTabContent";
import {
  buildOpenInEditorHandler,
} from "@/views/thread-detail/threadWorkspaceOpenPath";
import { resolveAbsoluteFilePath } from "@/lib/absolute-file-path";
import { getFilePreviewLineRangeStart } from "@/lib/file-preview";

const EMPTY_TERMINAL_SESSIONS: readonly TerminalSession[] = [];

interface PluginPanelAction {
  id: string;
  icon?: string;
  layout?: "padded" | "flush";
  pluginId: string;
}

export interface SecondaryPanelHostCapabilities {
  /** Root compose keeps its placeholder out of the tab strip. */
  hideNewTab: boolean;
  /** Root compose recreates an empty panel with a placeholder tab. */
  autoOpenNewTabWhenEmpty: boolean;
  /** Root compose spans project/environment contexts in one persisted deck. */
  preserveWorkspaceTabsAcrossContexts: boolean;
  /** Root compose hides a lone placeholder instead of closing/recreating it. */
  closeLoneNewTabByHidingPanel: boolean;
  /** Thread detail applies the user's URL routing preference to browser popups. */
  routeBrowserPopupsByPreference: boolean;
  /** Older desktop shells emit this event instead of the app command. */
  registerLegacyOpenNewTab: boolean;
  /** Root compose opens a new placeholder when toggled open. */
  toggleOpensNewTab: boolean;
}

interface SecondaryPanelNavigation {
  canOpenStorageFiles: boolean;
  canOpenWorkspaceFiles: boolean;
  defaultProjectId: string | null;
  openProject: (projectId: string) => void;
  openThread: (args: { projectId: string; threadId: string }) => void;
}

interface UseSecondaryPanelHostArgs {
  canCreateTerminal: boolean;
  capabilities: SecondaryPanelHostCapabilities;
  environmentId: string | null | undefined;
  fileOwnerThreadId?: string | null;
  isFocused: boolean;
  navigation: SecondaryPanelNavigation;
  onSelectionAddToChat?: (text: string) => void;
  panelStateId: string;
  pluginPanelActions: readonly PluginPanelAction[];
  projectId: string | null;
  storageFiles: readonly { path: string }[] | undefined;
  syncThreadId: string | null;
  terminalTarget: ThreadTerminalTarget | null;
  threadId: string | null;
  workspaceRootPath?: string | null;
}

interface UseSecondaryPanelFileOpenersArgs {
  canOpenPreferredFileTarget: boolean;
  host: Pick<
    SecondaryPanelHost,
    | "activeHostFileLineRange"
    | "activeHostFilePath"
    | "activeStorageFilePath"
    | "activeWorkspaceFileEnvironmentId"
    | "activeWorkspaceFilePath"
    | "activeWorkspaceFileProjectId"
  >;
  onOpenPreferredFallback?: () => boolean;
  openPathInPreferredFileTarget: Parameters<
    typeof buildOpenInEditorHandler
  >[0]["openInPreferredTarget"];
  projectRootPath?: string | null;
  storageRootPath: string | null;
  workspaceRootPath: string | null;
}

interface SecondaryPanelCommandHandlersProps {
  host: Pick<
    SecondaryPanelHost,
    | "canStartTerminal"
    | "handleCloseWindowRequest"
    | "handleOpenNewTab"
    | "handleStartTerminal"
    | "handleToggleSecondaryPanel"
    | "isFocused"
    | "registerLegacyOpenNewTab"
  >;
  onOpenPreferred: () => boolean;
  onToggleDiff?: () => boolean;
}

type TerminalContentProps = Omit<
  ComponentProps<typeof ThreadTerminalPanel>,
  | "autoFocus"
  | "canCreateTerminal"
  | "isPanelOpen"
  | "isPanelPersistedOpen"
  | "onAutoFocusHandled"
>;
type NewTabContentProps = Omit<
  ComponentProps<typeof NewTabPage>,
  "autoFocus" | "onAutoFocusHandled"
>;
type WorkspaceContentProps = Omit<
  ComponentProps<typeof WorkspaceFilePreviewTabContent>,
  "activePath" | "lineRange" | "source" | "statusLabel"
>;
type ProjectContentProps = Omit<
  ComponentProps<typeof ProjectFilePreviewTabContent>,
  "activePath" | "lineRange"
>;
type HostContentProps = Omit<
  ComponentProps<typeof HostFilePreviewTabContent>,
  "activePath" | "lineRange"
>;
type StorageContentProps = Omit<
  ComponentProps<typeof ThreadStorageFilePreviewTabContent>,
  "activePath" | "lineRange"
>;

interface LoadingFileContentProps {
  copyPath: string;
  onOpenInEditor?: (path: string) => void;
}

interface SecondaryPanelHostContentProps {
  host: Pick<
    SecondaryPanelHost,
    | "activeHostFileLineRange"
    | "activeHostFilePath"
    | "activePluginPanelTab"
    | "activeStorageFileLineRange"
    | "activeStorageFilePath"
    | "activeTerminalId"
    | "activeWorkspaceFileLineRange"
    | "activeWorkspaceFilePath"
    | "activeWorkspaceFileSource"
    | "activeWorkspaceFileStatusLabel"
    | "canCreateTerminal"
    | "handleNewTabAutoFocusHandled"
    | "handleTerminalAutoFocusHandled"
    | "isNewTabActive"
    | "isPersistedSecondaryPanelOpen"
    | "isSecondaryPanelOpen"
    | "shouldAutoFocusNewTab"
    | "shouldAutoFocusTerminal"
  >;
  hostFile?: HostContentProps;
  loadingHostFile?: LoadingFileContentProps;
  loadingStorageFile?: LoadingFileContentProps;
  newTab: NewTabContentProps;
  projectFile?: ProjectContentProps;
  renderPluginPanel: (
    tab: NonNullable<SecondaryPanelHost["activePluginPanelTab"]>,
  ) => ReactNode;
  storageFile?: StorageContentProps;
  terminal?: TerminalContentProps;
  workspaceFile?: WorkspaceContentProps;
}

type CommonSecondaryPanelProps = Pick<
  ThreadSecondaryPanelProps,
  | "activeTab"
  | "environmentId"
  | "fileTabs"
  | "fileTabContentFillsRegion"
  | "isBrowserTabActive"
  | "isOpen"
  | "onClose"
  | "onCollapse"
  | "onFileTabReorder"
  | "onOpenNewTab"
  | "onPanelChange"
  | "onPanelFocus"
  | "onSelectionAddToChat"
  | "workspaceRootPath"
> & {
  renderBrowserDeck: (args: {
    canShowNativeBrowserView: boolean;
  }) => ReactNode;
};

export interface SecondaryPanelHost {
  activeBrowserTab: ReturnType<typeof useThreadFileTabs>["activeBrowserTab"];
  activeFixedSecondaryTab: SecondaryFixedPanelTab | null;
  activeFixedSecondaryTabId: string | null;
  activeHostFileLineRange: ReturnType<
    typeof useThreadFileTabs
  >["activeHostFileLineRange"];
  activeHostFilePath: string | null;
  activeHostFileEnvironmentId: string | null;
  activeHostFileThreadId: string | null;
  activePluginPanelTab: ReturnType<
    typeof useThreadFileTabs
  >["activePluginPanelTab"];
  activeStorageFileEnvironmentId: string | null;
  activeStorageFileLineRange: ReturnType<
    typeof useThreadFileTabs
  >["activeStorageFileLineRange"];
  activeStorageFilePath: string | null;
  activeStorageFileThreadId: string | null;
  activeTerminalId: string | null;
  activeWorkspaceFileEnvironmentId: string | null;
  activeWorkspaceFileLineRange: ReturnType<
    typeof useThreadFileTabs
  >["activeWorkspaceFileLineRange"];
  activeWorkspaceFilePath: string | null;
  activeWorkspaceFileProjectId: string | null;
  activeWorkspaceFileSource: ReturnType<
    typeof useThreadFileTabs
  >["activeWorkspaceFileSource"];
  activeWorkspaceFileStatusLabel: ReturnType<
    typeof useThreadFileTabs
  >["activeWorkspaceFileStatusLabel"];
  canCreateTerminal: boolean;
  canStartTerminal: boolean;
  clearActiveFileTabs: () => void;
  closeSecondaryPanel: () => void;
  handleActivateFileTab: (tabId: string) => void;
  handleActivateTerminalTab: (terminalId: string) => void;
  handleCloseTerminalTab: (terminalId: string) => void;
  handleCloseWindowRequest: () => boolean;
  handleNewTabAutoFocusHandled: () => void;
  handleOpenBrowser: () => void;
  handleOpenNewTab: () => void;
  handlePanelLink: MarkdownPreviewLinkHandler;
  handleSecondaryPanelChange: (panel: Parameters<
    ThreadSecondaryPanelProps["onPanelChange"]
  >[0]) => void;
  handleStartTerminal: () => void;
  handleTerminalAutoFocusHandled: () => void;
  handleToggleSecondaryPanel: () => void;
  isFocused: boolean;
  isNewTabActive: boolean;
  isPersistedSecondaryPanelOpen: boolean;
  isSecondaryPanelOpen: boolean;
  loadedTerminalSessions: readonly TerminalSession[] | undefined;
  openBrowserTabAndReveal: (url?: string) => void;
  openCompactDrawer: () => void;
  openHostFile: ReturnType<
    typeof useThreadSecondaryPanelVisibility
  >["openHostFile"];
  openPluginPanel: ReturnType<typeof useThreadFileTabs>["openPluginPanel"];
  openTab: ReturnType<typeof useThreadFileTabs>["openTab"];
  openSecondaryPanel: ReturnType<
    typeof useThreadSecondaryPanelVisibility
  >["openPanel"];
  openStorageFile: ReturnType<
    typeof useThreadSecondaryPanelVisibility
  >["openStorageFile"];
  openUrlByPreference: (url: string) => boolean;
  openWorkspaceFile: ReturnType<
    typeof useThreadSecondaryPanelVisibility
  >["openWorkspaceFile"];
  registerLegacyOpenNewTab: boolean;
  renderSecondaryPanelAsDrawer: boolean;
  renderSecondaryPanelBrowserDeck: CommonSecondaryPanelProps["renderBrowserDeck"];
  resolveMentionLink: PromptMentionLinkResolver;
  secondaryPanelProps: CommonSecondaryPanelProps;
  setPersistedSecondaryPanel: (
    panel: Parameters<ThreadSecondaryPanelProps["onPanelChange"]>[0] | null,
  ) => void;
  selectFileSearchResult: ReturnType<
    typeof useThreadFileTabs
  >["selectFileSearchResult"];
  shouldAutoFocusNewTab: boolean;
  shouldAutoFocusTerminal: boolean;
  syncedOrderedSecondaryFileTabs: ReturnType<
    typeof buildTerminalSyncedSecondaryFileTabs
  >;
  terminalSessions: readonly TerminalSession[];
  toggleSecondaryPanel: () => void;
}

export function resolveSecondaryPanelTerminalSessions({
  sessions,
  terminalTarget,
}: {
  sessions: readonly TerminalSession[] | undefined;
  terminalTarget: ThreadTerminalTarget | null;
}): readonly TerminalSession[] | undefined {
  if (terminalTarget?.kind !== "host_path") {
    return sessions;
  }
  return sessions?.filter(
    (session) =>
      session.threadId === null &&
      session.environmentId === null &&
      session.hostId === terminalTarget.hostId &&
      (terminalTarget.cwd === null ||
        session.initialCwd === terminalTarget.cwd),
  );
}

export function SecondaryPanelCommandHandlers({
  host,
  onOpenPreferred,
  onToggleDiff,
}: SecondaryPanelCommandHandlersProps) {
  useAppCommandHandler("panel.toggle", () => {
    if (!host.isFocused) return false;
    host.handleToggleSecondaryPanel();
    return true;
  });
  useAppCommandHandler("panel.close", () => {
    if (!host.isFocused) return false;
    return host.handleCloseWindowRequest();
  });
  useAppCommandHandler("panel.newTab", () => {
    if (!host.isFocused) return false;
    host.handleOpenNewTab();
    return true;
  });
  useAppCommandHandler("file.quickOpen", () => {
    if (!host.isFocused) return false;
    host.handleOpenNewTab();
    return true;
  });
  useAppCommandHandler("terminal.open", () => {
    if (!host.isFocused || !host.canStartTerminal) return false;
    host.handleStartTerminal();
    return true;
  });
  useAppCommandHandler("workspace.openPreferred", () => {
    if (!host.isFocused) return false;
    return onOpenPreferred();
  });
  useAppCommandHandler("diff.toggle", () => {
    if (!host.isFocused || onToggleDiff === undefined) return false;
    return onToggleDiff();
  });

  useEffect(() => {
    if (!host.isFocused) return;
    const desktopInfo = getBbDesktopInfo();
    if (desktopInfo?.onCloseWindowRequest === undefined) return;
    return desktopInfo.onCloseWindowRequest(host.handleCloseWindowRequest);
  }, [host.handleCloseWindowRequest, host.isFocused]);

  useEffect(() => {
    if (!host.isFocused || !host.registerLegacyOpenNewTab) return;
    const desktopInfo = getBbDesktopInfo();
    if (
      desktopInfo === null ||
      desktopInfo.onAppCommand !== undefined ||
      desktopInfo.onOpenNewTab === undefined
    ) {
      return;
    }
    return desktopInfo.onOpenNewTab(host.handleOpenNewTab);
  }, [host.handleOpenNewTab, host.isFocused, host.registerLegacyOpenNewTab]);

  return null;
}

export function SecondaryPanelHostContent({
  host,
  hostFile,
  loadingHostFile,
  loadingStorageFile,
  newTab,
  projectFile,
  renderPluginPanel,
  storageFile,
  terminal,
  workspaceFile,
}: SecondaryPanelHostContentProps) {
  if (host.activeTerminalId !== null && terminal !== undefined) {
    return (
      <ThreadTerminalPanel
        {...terminal}
        autoFocus={host.shouldAutoFocusTerminal}
        canCreateTerminal={host.canCreateTerminal}
        isPanelOpen={host.isSecondaryPanelOpen}
        isPanelPersistedOpen={host.isPersistedSecondaryPanelOpen}
        onAutoFocusHandled={host.handleTerminalAutoFocusHandled}
      />
    );
  }
  if (host.isNewTabActive) {
    return (
      <NewTabPage
        {...newTab}
        autoFocus={host.shouldAutoFocusNewTab}
        onAutoFocusHandled={host.handleNewTabAutoFocusHandled}
      />
    );
  }
  if (host.activeWorkspaceFilePath !== null) {
    if (workspaceFile !== undefined) {
      return (
        <WorkspaceFilePreviewTabContent
          {...workspaceFile}
          activePath={host.activeWorkspaceFilePath}
          lineRange={host.activeWorkspaceFileLineRange}
          source={host.activeWorkspaceFileSource}
          statusLabel={host.activeWorkspaceFileStatusLabel}
        />
      );
    }
    if (projectFile !== undefined) {
      return (
        <ProjectFilePreviewTabContent
          {...projectFile}
          activePath={host.activeWorkspaceFilePath}
          lineRange={host.activeWorkspaceFileLineRange}
        />
      );
    }
  }
  if (host.activeHostFilePath !== null) {
    if (hostFile !== undefined) {
      return (
        <HostFilePreviewTabContent
          {...hostFile}
          activePath={host.activeHostFilePath}
          lineRange={host.activeHostFileLineRange}
        />
      );
    }
    if (loadingHostFile !== undefined) {
      return (
        <FilePreview
          {...loadingHostFile}
          path={host.activeHostFilePath}
          state={{ kind: "loading" }}
        />
      );
    }
  }
  if (host.activeStorageFilePath !== null) {
    if (storageFile !== undefined) {
      return (
        <ThreadStorageFilePreviewTabContent
          {...storageFile}
          activePath={host.activeStorageFilePath}
          lineRange={host.activeStorageFileLineRange}
        />
      );
    }
    if (loadingStorageFile !== undefined) {
      return (
        <FilePreview
          {...loadingStorageFile}
          path={host.activeStorageFilePath}
          state={{ kind: "loading" }}
        />
      );
    }
  }
  return host.activePluginPanelTab === null
    ? null
    : renderPluginPanel(host.activePluginPanelTab);
}

export function useSecondaryPanelFileOpeners({
  canOpenPreferredFileTarget,
  host,
  onOpenPreferredFallback,
  openPathInPreferredFileTarget,
  projectRootPath = null,
  storageRootPath,
  workspaceRootPath,
}: UseSecondaryPanelFileOpenersArgs) {
  const openWorkspaceFileInEditor = useMemo(
    () =>
      buildOpenInEditorHandler({
        rootPath: workspaceRootPath,
        canOpenPreferredTarget: canOpenPreferredFileTarget,
        openInPreferredTarget: openPathInPreferredFileTarget,
      }),
    [
      canOpenPreferredFileTarget,
      openPathInPreferredFileTarget,
      workspaceRootPath,
    ],
  );
  const openProjectFileInEditor = useMemo(
    () =>
      buildOpenInEditorHandler({
        rootPath: projectRootPath,
        canOpenPreferredTarget: canOpenPreferredFileTarget,
        openInPreferredTarget: openPathInPreferredFileTarget,
      }),
    [
      canOpenPreferredFileTarget,
      openPathInPreferredFileTarget,
      projectRootPath,
    ],
  );
  const openStorageFileInEditor = useMemo(
    () =>
      buildOpenInEditorHandler({
        rootPath: storageRootPath,
        canOpenPreferredTarget: canOpenPreferredFileTarget,
        openInPreferredTarget: openPathInPreferredFileTarget,
      }),
    [
      canOpenPreferredFileTarget,
      openPathInPreferredFileTarget,
      storageRootPath,
    ],
  );
  const openHostFileInEditor = useMemo(() => {
    if (!canOpenPreferredFileTarget) return undefined;
    const lineNumber = getFilePreviewLineRangeStart({
      lineRange: host.activeHostFileLineRange,
    });
    return (path: string) => {
      void openPathInPreferredFileTarget({ lineNumber, path });
    };
  }, [
    canOpenPreferredFileTarget,
    host.activeHostFileLineRange,
    openPathInPreferredFileTarget,
  ]);
  const handleOpenPreferred = useCallback(() => {
    if (
      host.activeWorkspaceFilePath !== null &&
      host.activeWorkspaceFileEnvironmentId !== null &&
      openWorkspaceFileInEditor
    ) {
      openWorkspaceFileInEditor(host.activeWorkspaceFilePath);
      return true;
    }
    if (
      host.activeWorkspaceFilePath !== null &&
      host.activeWorkspaceFileProjectId !== null &&
      openProjectFileInEditor
    ) {
      openProjectFileInEditor(host.activeWorkspaceFilePath);
      return true;
    }
    if (host.activeHostFilePath !== null && openHostFileInEditor) {
      openHostFileInEditor(host.activeHostFilePath);
      return true;
    }
    if (host.activeStorageFilePath !== null && openStorageFileInEditor) {
      openStorageFileInEditor(host.activeStorageFilePath);
      return true;
    }
    return onOpenPreferredFallback?.() ?? false;
  }, [
    host.activeHostFilePath,
    host.activeStorageFilePath,
    host.activeWorkspaceFileEnvironmentId,
    host.activeWorkspaceFilePath,
    host.activeWorkspaceFileProjectId,
    onOpenPreferredFallback,
    openHostFileInEditor,
    openProjectFileInEditor,
    openStorageFileInEditor,
    openWorkspaceFileInEditor,
  ]);
  const workspaceFileCopyPath = host.activeWorkspaceFilePath
    ? resolveAbsoluteFilePath({
        path: host.activeWorkspaceFilePath,
        rootPath: workspaceRootPath,
      })
    : null;
  const projectFileCopyPath = host.activeWorkspaceFilePath
    ? resolveAbsoluteFilePath({
        path: host.activeWorkspaceFilePath,
        rootPath: projectRootPath,
      })
    : null;
  const storageFileCopyPath = host.activeStorageFilePath
    ? resolveAbsoluteFilePath({
        path: host.activeStorageFilePath,
        rootPath: storageRootPath,
      })
    : null;

  return {
    handleOpenPreferred,
    openHostFileInEditor,
    openProjectFileInEditor,
    openStorageFileInEditor,
    openWorkspaceFileInEditor,
    projectFileCopyPath,
    storageFileCopyPath,
    workspaceFileCopyPath,
  };
}

export function useSecondaryPanelHost({
  canCreateTerminal,
  capabilities,
  environmentId,
  fileOwnerThreadId,
  isFocused,
  navigation,
  onSelectionAddToChat,
  panelStateId,
  pluginPanelActions,
  projectId,
  storageFiles,
  syncThreadId,
  terminalTarget,
  threadId,
  workspaceRootPath,
}: UseSecondaryPanelHostArgs): SecondaryPanelHost {
  useFixedPanelTabsStorageMaintenance(panelStateId);
  const fixedPanelTabsState = useFixedPanelTabsState(
    panelStateId,
    syncThreadId,
  );
  const isPersistedSecondaryPanelOpen = fixedPanelTabsState.secondary.isOpen;
  const activeFixedSecondaryTab =
    fixedPanelTabsState.secondary.tabs.find(
      (tab) => tab.id === fixedPanelTabsState.secondary.activeTabId,
    ) ?? null;
  const activeFixedSecondaryTabId = activeFixedSecondaryTab?.id ?? null;
  const retainedTerminalId = getRetainedTerminalTabId({
    activeTab: activeFixedSecondaryTab,
    isPanelOpen: isPersistedSecondaryPanelOpen,
  });
  const renderSecondaryPanelAsDrawer = useIsCompactViewport();
  const drawerVisibility = useThreadSecondaryPanelDrawerVisibility({
    isCompactViewport: renderSecondaryPanelAsDrawer,
    threadId: panelStateId,
  });
  const isSecondaryPanelOpen = renderSecondaryPanelAsDrawer
    ? drawerVisibility.isDrawerVisible
    : isPersistedSecondaryPanelOpen;
  const touchFixedPanelTabsState = useTouchFixedPanelTabsState(
    panelStateId,
    syncThreadId,
  );
  const updateFixedPanelTabsState = useUpdateFixedPanelTabsState(
    panelStateId,
    syncThreadId,
  );
  const setActiveFixedTerminal = useSetFixedRightTerminalActiveTerminal(
    panelStateId,
    syncThreadId,
  );
  const removeFixedTerminalTab = useRemoveFixedRightTerminalTab(
    panelStateId,
    syncThreadId,
  );
  const closePersistedSecondaryPanel = useCloseFixedSecondaryPanel(
    panelStateId,
    syncThreadId,
  );
  const openPersistedSecondaryPanel = useOpenFixedSecondaryPanel(
    panelStateId,
    syncThreadId,
  );
  const setFixedSecondaryPanelTab = useSetFixedSecondaryPanelTab(
    panelStateId,
    syncThreadId,
  );
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
  const terminalSessions = loadedTerminalSessions ?? EMPTY_TERMINAL_SESSIONS;
  const terminalsById = useMemo(
    () => new Map(terminalSessions.map((session) => [session.id, session])),
    [terminalSessions],
  );
  const fileTabState = useThreadFileTabs({
    panelStateId,
    syncThreadId,
    environmentId,
    fileOwnerThreadId,
    preserveWorkspaceTabsAcrossContexts:
      capabilities.preserveWorkspaceTabsAcrossContexts,
    projectId,
    retainedTerminalId,
    storageFiles,
    terminalSessions: loadedTerminalSessions,
  });
  const {
    activateTab,
    activeBrowserTab,
    browserTabs,
    clearActiveFileTabs,
    closeTab,
    openTab,
    orderedSecondaryFileTabs,
    updateBrowserTab,
  } = fileTabState;
  const syncedOrderedSecondaryFileTabs =
    loadedTerminalSessions === undefined
      ? orderedSecondaryFileTabs
      : buildTerminalSyncedSecondaryFileTabs({
          orderedTabs: orderedSecondaryFileTabs,
          retainedTerminalId,
          terminalSessions: loadedTerminalSessions,
        });
  useEffect(() => {
    if (loadedTerminalSessions === undefined) return;
    updateFixedPanelTabsState((state) =>
      syncTerminalTabsInFixedPanelState({
        retainedTerminalId,
        state,
        terminalSessions,
      }),
    );
  }, [
    loadedTerminalSessions,
    retainedTerminalId,
    terminalSessions,
    updateFixedPanelTabsState,
  ]);

  const openPersistedWorkspaceFile = useCallback(
    (...args: Parameters<
      ReturnType<typeof useThreadSecondaryPanelVisibility>["openWorkspaceFile"]
    >) => openTab({ kind: "workspace-file-preview", tab: args[0] }, args[1]),
    [openTab],
  );
  const openPersistedStorageFile = useCallback(
    (...args: Parameters<
      ReturnType<typeof useThreadSecondaryPanelVisibility>["openStorageFile"]
    >) =>
      openTab(
        { kind: "thread-storage-file-preview", tab: args[0] },
        args[1],
      ),
    [openTab],
  );
  const openPersistedHostFile = useCallback(
    (...args: Parameters<
      ReturnType<typeof useThreadSecondaryPanelVisibility>["openHostFile"]
    >) => openTab({ kind: "host-file-preview", tab: args[0] }, args[1]),
    [openTab],
  );
  const openPersistedPanel = useCallback(
    (panel: Parameters<ThreadSecondaryPanelProps["onPanelChange"]>[0]) => {
      setFixedSecondaryPanelTab(panel);
    },
    [setFixedSecondaryPanelTab],
  );
  const setPersistedSecondaryPanel = useCallback(
    (panel: Parameters<ThreadSecondaryPanelProps["onPanelChange"]>[0] | null) => {
      if (panel === null) {
        closePersistedSecondaryPanel();
        return;
      }
      setFixedSecondaryPanelTab(panel);
    },
    [closePersistedSecondaryPanel, setFixedSecondaryPanelTab],
  );
  const togglePersistedPanel = useCallback(() => {
    if (isPersistedSecondaryPanelOpen) {
      closePersistedSecondaryPanel();
      return;
    }
    if (capabilities.toggleOpensNewTab) {
      openTab({ kind: "new-tab" });
      return;
    }
    openPersistedSecondaryPanel();
  }, [
    capabilities.toggleOpensNewTab,
    closePersistedSecondaryPanel,
    openTab,
    isPersistedSecondaryPanelOpen,
    openPersistedSecondaryPanel,
  ]);
  const visibility = useThreadSecondaryPanelVisibility({
    closePersistedPanel: closePersistedSecondaryPanel,
    drawerVisibility,
    isCompactViewport: renderSecondaryPanelAsDrawer,
    isPersistedOpen: isPersistedSecondaryPanelOpen,
    openPersistedCommitDiff: () => undefined,
    openPersistedDiffFile: () => undefined,
    openPersistedDiffPanel: () => undefined,
    openPersistedHostFile,
    openPersistedPanel,
    openPersistedStorageFile,
    openPersistedWorkspaceFile,
    togglePersistedPanel,
  });
  const {
    closePanel,
    isOpen,
    openCompactDrawer,
    openPanel,
    openStorageFile,
    openWorkspaceFile,
    togglePanel,
  } = visibility;

  const [shouldAutoFocusNewTab, setShouldAutoFocusNewTab] = useState(false);
  const [shouldAutoFocusTerminal, setShouldAutoFocusTerminal] = useState(false);
  const [browserAddressFocusRequest, setBrowserAddressFocusRequest] =
    useState<BrowserAddressFocusRequest | null>(null);
  const handleNewTabAutoFocusHandled = useCallback(
    () => setShouldAutoFocusNewTab(false),
    [],
  );
  const handleTerminalAutoFocusHandled = useCallback(
    () => setShouldAutoFocusTerminal(false),
    [],
  );
  const handleOpenNewTab = useCallback(() => {
    openTab({ kind: "new-tab" });
    openCompactDrawer();
    setShouldAutoFocusNewTab(true);
  }, [openCompactDrawer, openTab]);
  const handleToggleSecondaryPanel = useCallback(() => {
    if (!capabilities.toggleOpensNewTab) {
      togglePanel();
      return;
    }
    if (isOpen) {
      closePanel();
      return;
    }
    handleOpenNewTab();
  }, [
    capabilities.toggleOpensNewTab,
    closePanel,
    handleOpenNewTab,
    isOpen,
    togglePanel,
  ]);
  const handleSecondaryPanelChange = useCallback(
    (panel: Parameters<ThreadSecondaryPanelProps["onPanelChange"]>[0]) => {
      clearActiveFileTabs();
      openPanel(panel);
    },
    [clearActiveFileTabs, openPanel],
  );
  const handleSecondaryPanelFocus = useCallback(() => {
    touchFixedPanelTabsState();
  }, [touchFixedPanelTabsState]);

  useEffect(() => {
    if (!capabilities.autoOpenNewTabWhenEmpty || !isOpen) return;
    if (
      activeFixedSecondaryTab !== null &&
      activeFixedSecondaryTab.kind !== "thread-info" &&
      activeFixedSecondaryTab.kind !== "git-diff"
    ) {
      return;
    }
    openTab({ kind: "new-tab" });
  }, [
    activeFixedSecondaryTab,
    capabilities.autoOpenNewTabWhenEmpty,
    isOpen,
    openTab,
  ]);

  const openBrowserTab = useCallback(
    (url?: string) => {
      const browserUrl = url ?? "";
      const tab = openTab({ kind: "browser", url: browserUrl });
      if (browserUrl.length === 0 && tab?.kind === "browser") {
        setBrowserAddressFocusRequest((current) => ({
          requestId: (current?.requestId ?? 0) + 1,
          tabId: tab.id,
        }));
      }
    },
    [openTab],
  );
  const openBrowserTabAndReveal = useCallback(
    (url?: string) => {
      if (threadId === null) return;
      openBrowserTab(url);
      openCompactDrawer();
    },
    [openBrowserTab, openCompactDrawer, threadId],
  );
  const handleOpenBrowser = useCallback(() => {
    openBrowserTabAndReveal();
  }, [openBrowserTabAndReveal]);
  const [openLinksInAppBrowser] = useOpenLinksInAppBrowserPreference();
  const desktopBrowserAvailable = isDesktopBrowserAvailable();
  const handleOpenUrlByPreference = useCallback(
    (url: string) =>
      openUrlByPreference({
        desktopBrowserAvailable,
        openExternalBrowser: openUrlInExternalBrowser,
        openInAppBrowser: openBrowserTabAndReveal,
        openLinksInAppBrowser,
        url,
      }),
    [desktopBrowserAvailable, openBrowserTabAndReveal, openLinksInAppBrowser],
  );
  const handlePanelLink = useCallback<MarkdownPreviewLinkHandler>(
    ({ href }) => {
      if (
        threadId === null ||
        resolveUrlOpenTarget({
          desktopBrowserAvailable,
          openLinksInAppBrowser,
          url: href,
        }) !== "in-app-browser"
      ) {
        return false;
      }
      openBrowserTabAndReveal(href);
      return true;
    },
    [
      desktopBrowserAvailable,
      openBrowserTabAndReveal,
      openLinksInAppBrowser,
      threadId,
    ],
  );
  const browserTabIds = useMemo(
    () => new Set(browserTabs.map((tab) => tab.id)),
    [browserTabs],
  );
  useEffect(() => {
    const browserApi = getDesktopBrowserApi();
    if (browserApi === null) return;
    const openPopup = capabilities.routeBrowserPopupsByPreference
      ? handleOpenUrlByPreference
      : openBrowserTabAndReveal;
    if (browserApi.onScopedOpenTab) {
      return browserApi.onScopedOpenTab(({ tabId, url }) => {
        if (browserTabIds.has(tabId)) openPopup(url);
      });
    }
    return browserApi.onOpenTab(({ url }) => {
      if (!isRoutePath({ path: url })) openPopup(url);
    });
  }, [
    browserTabIds,
    capabilities.routeBrowserPopupsByPreference,
    handleOpenUrlByPreference,
    openBrowserTabAndReveal,
  ]);
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
  const renderSecondaryPanelBrowserDeck = useCallback(
    ({ canShowNativeBrowserView }: { canShowNativeBrowserView: boolean }) => {
      if (threadId === null) return null;
      return (
        <BrowserTabDeck
          browserTabs={browserTabs}
          activeBrowserTabId={activeBrowserTab?.id ?? null}
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
      browserAddressFocusRequest,
      environmentId,
      activeBrowserTab?.id,
      browserTabs,
      handleBrowserAddressFocusRequestConsumed,
      threadId,
      updateBrowserTab,
    ],
  );

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
        closeTab(newTab.id);
        setShouldAutoFocusTerminal(true);
        setActiveFixedTerminal(session.id);
        openCompactDrawer();
      })
      .catch(() => undefined);
  }, [
    canStartTerminal,
    createTerminal,
    closeTab,
    setActiveFixedTerminal,
    terminalTarget,
    openCompactDrawer,
  ]);
  const handleActivateTerminalTab = useCallback(
    (terminalId: string) => {
      setShouldAutoFocusTerminal(true);
      setActiveFixedTerminal(terminalId);
      openCompactDrawer();
    },
    [openCompactDrawer, setActiveFixedTerminal],
  );
  const handleCloseTerminalTab = useCallback(
    (terminalId: string) => {
      if (terminalTarget === null) {
        removeFixedTerminalTab(terminalId);
        return;
      }
      closeTerminal.mutate(
        { mode: "force", terminalId },
        { onSuccess: () => removeFixedTerminalTab(terminalId) },
      );
    },
    [closeTerminal, removeFixedTerminalTab, terminalTarget],
  );
  const handleActivateFileTab = useCallback(
    (tabId: string) => {
      activateTab(tabId);
      openCompactDrawer();
    },
    [activateTab, openCompactDrawer],
  );
  const handleCloseWindowRequest = () => {
    if (!isOpen) return false;
    if (
      activeFixedSecondaryTab !== null &&
      isSecondaryFileTab(activeFixedSecondaryTab)
    ) {
      if (
        capabilities.closeLoneNewTabByHidingPanel &&
        activeFixedSecondaryTab.kind === "new-tab" &&
        fixedPanelTabsState.secondary.tabs.length === 1
      ) {
        closePanel();
        return true;
      }
      if (activeFixedSecondaryTab.kind === "terminal") {
        handleCloseTerminalTab(activeFixedSecondaryTab.terminalId);
      } else {
        closeTab(activeFixedSecondaryTab.id);
      }
      return true;
    }
    closePanel();
    return true;
  };
  const resolveMentionLink = useCallback<PromptMentionLinkResolver>(
    (resource) => {
      if (resource.kind === "thread") {
        const targetProjectId = resource.projectId ?? navigation.defaultProjectId;
        if (targetProjectId === null) return null;
        return () =>
          navigation.openThread({
            projectId: targetProjectId,
            threadId: resource.threadId,
          });
      }
      if (resource.kind === "project") {
        return () => navigation.openProject(resource.projectId);
      }
      if (resource.kind !== "path" || resource.entryKind !== "file") return null;
      if (resource.source === "thread-storage") {
        if (!navigation.canOpenStorageFiles) return null;
        return () =>
          openStorageFile({ lineRange: null, path: resource.path });
      }
      if (!navigation.canOpenWorkspaceFiles) return null;
      return () =>
        openWorkspaceFile({
          lineRange: null,
          path: resource.path,
          source: { kind: "working-tree" },
          statusLabel: null,
        });
    },
    [navigation, openStorageFile, openWorkspaceFile],
  );
  const activeTerminalId = findActiveTerminalIdInSecondaryFileTabs({
    activeTabId: activeFixedSecondaryTabId,
    tabs: syncedOrderedSecondaryFileTabs,
  });
  const fileTabs = useSecondaryPanelFileTabs({
    activeTabId: activeFixedSecondaryTabId,
    hideNewTab: capabilities.hideNewTab,
    onActivateTab: handleActivateFileTab,
    onActivateTerminal: handleActivateTerminalTab,
    onCloseTab: fileTabState.closeTab,
    onCloseTerminal: handleCloseTerminalTab,
    orderedTabs: syncedOrderedSecondaryFileTabs,
    pluginPanelActions,
    terminalsById,
  });
  const activePluginPanelTab = fileTabState.activePluginPanelTab;
  const secondaryPanelProps: CommonSecondaryPanelProps = {
    activeTab: activeFixedSecondaryTab,
    ...(environmentId ? { environmentId } : {}),
    ...(workspaceRootPath ? { workspaceRootPath } : {}),
    fileTabs,
    fileTabContentFillsRegion:
      activePluginPanelTab !== null &&
      pluginPanelActions.find(
        (candidate) =>
          candidate.pluginId === activePluginPanelTab.pluginId &&
          candidate.id === activePluginPanelTab.actionId,
      )?.layout === "flush",
    renderBrowserDeck: renderSecondaryPanelBrowserDeck,
    isBrowserTabActive: fileTabState.activeBrowserTab !== null,
    isOpen: visibility.isOpen,
    onClose: visibility.closePanel,
    onCollapse: visibility.closePanel,
    onFileTabReorder: fileTabState.reorderFileTab,
    onOpenNewTab: handleOpenNewTab,
    onSelectionAddToChat,
    onPanelFocus: handleSecondaryPanelFocus,
    onPanelChange: handleSecondaryPanelChange,
  };

  return {
    ...fileTabState,
    activeFixedSecondaryTab,
    activeFixedSecondaryTabId,
    activeTerminalId,
    canCreateTerminal,
    canStartTerminal,
    closeSecondaryPanel: visibility.closePanel,
    handleActivateFileTab,
    handleActivateTerminalTab,
    handleCloseTerminalTab,
    handleCloseWindowRequest,
    handleNewTabAutoFocusHandled,
    handleOpenBrowser,
    handleOpenNewTab,
    handlePanelLink,
    handleSecondaryPanelChange,
    handleStartTerminal,
    handleTerminalAutoFocusHandled,
    handleToggleSecondaryPanel,
    isFocused,
    isPersistedSecondaryPanelOpen,
    isSecondaryPanelOpen: visibility.isOpen,
    loadedTerminalSessions,
    openBrowserTabAndReveal,
    openCompactDrawer: visibility.openCompactDrawer,
    openHostFile: visibility.openHostFile,
    openSecondaryPanel: visibility.openPanel,
    openStorageFile: visibility.openStorageFile,
    openUrlByPreference: handleOpenUrlByPreference,
    openWorkspaceFile: visibility.openWorkspaceFile,
    registerLegacyOpenNewTab: capabilities.registerLegacyOpenNewTab,
    renderSecondaryPanelAsDrawer,
    renderSecondaryPanelBrowserDeck,
    resolveMentionLink,
    secondaryPanelProps,
    setPersistedSecondaryPanel,
    shouldAutoFocusNewTab,
    shouldAutoFocusTerminal,
    syncedOrderedSecondaryFileTabs,
    terminalSessions,
    toggleSecondaryPanel: visibility.togglePanel,
  };
}
