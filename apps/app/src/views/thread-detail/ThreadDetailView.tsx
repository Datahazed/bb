import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import {
  isRunningThreadRuntimeDisplayStatus,
  type ThreadTimelineEditMessageHandler,
  type ThreadTimelineEditMessageTarget,
  type ThreadTimelineInlineMessageEditor,
  type ThreadTimelineForkMessageHandler,
  type ThreadTimelineSendToMainMessageHandler,
  type ThreadTimelineLinkHandler,
  type ThreadTimelineLocalFileLink,
  type ThreadTimelineLocalFileLinkHandler,
  type ThreadTimelineOpenPluginPanelHandler,
  type TimelineTitleActionResolver,
  useThreadTimelineController,
} from "@/components/thread/timeline";
import { serializePluginPanelParams } from "@/lib/plugin-json-value";
import {
  defaultAppSettings,
  resolveEnvironmentMergeBaseBranch,
  type ThreadListEntry,
  type ThreadWithRuntime,
} from "@bb/domain";
import type {
  PullRequestMergeMethod,
  TimelineRow,
} from "@bb/server-contract";
import type { WorkspaceOpenTarget } from "@bb/host-daemon-contract";
import { appToast } from "@/components/ui/app-toast";
import { copyToClipboardWithToast } from "@/lib/clipboard";
import { useForkThreadFromMessage } from "@/hooks/useForkThreadFromMessage";
import { isThreadForkable } from "@/lib/fork-thread-request";
import { useRequestEnvironmentAction } from "../../hooks/mutations/environment-mutations";
import {
  useMarkThreadRead,
  useUpdateThread,
} from "../../hooks/mutations/thread-state-mutations";
import {
  useCreateThreadQueuedMessage,
  useEditThreadMessage,
  useSendThreadMessage,
} from "../../hooks/mutations/thread-runtime-mutations";
import { useUpdateEnvironment } from "../../hooks/mutations/environment-mutations";
import {
  useEnvironment,
  getEnvironmentPullRequestFromResponse,
  useEnvironmentPullRequest,
  useEnvironmentWorkStatus,
} from "../../hooks/queries/environment-queries";
import {
  didThreadDetailBootstrapRefreshAfterMount,
  getLatestPendingInteraction,
  useProjectThreadSubset,
  useThread,
  useThreadDetailBootstrap,
  useThreadPendingInteractions,
  useThreadQueuedMessages,
  type ProjectThreadSubsetFilters,
} from "../../hooks/queries/thread-queries";
import { isTransientReadError } from "@/hooks/queries/query-helpers";
import { usePromptDraftStorage } from "@/hooks/usePromptDraftStorage";
import { subscribeComposerFocusRequests } from "@/lib/composer-focus-requests";
import { ThreadGitActionDialog } from "@/components/dialogs/ThreadGitActionDialog";
import { PageShell } from "@/components/ui/page-shell.js";
import { HEADER_ICON_BUTTON_CLASS } from "@/components/layout/AppPageHeader";
import {
  ThreadActionsMenu,
  type ThreadActionsMenuResponsiveAction,
} from "@/components/thread/ThreadActionsMenu";
import { PluginThreadHeaderActions } from "@/components/plugin/PluginThreadHeaderActions";
import { ThreadWorkspaceOpenButton } from "@/components/thread/ThreadWorkspaceOpenButton";
import {
  formatEnvironmentDisplay,
  type EnvironmentDisplayHostContext,
} from "@bb/core-ui";
import { assertNever } from "@bb/thread-view";
import { useCreateThreadInWorktree } from "@/hooks/useCreateThreadInWorktree";
import { useHostDaemon } from "@/hooks/useHostDaemon";
import { useLocalOpenTargets } from "@/hooks/useLocalOpenTargets";
import { selectPrimaryHost, useHosts } from "@/hooks/queries/host-queries";
import { useSystemConfig } from "@/hooks/queries/system-queries";
import { useConnectionAwareQueryState } from "@/hooks/queries/connection-aware-query-state";
import { getEnvironmentWorkspaceLabelIconName } from "@/lib/environment-workspace-display";
import { formatWorkspaceCheckoutDisplay } from "@/lib/workspace-checkout-display";
import {
  getAbsoluteDirname,
  isAbsoluteFilePathWithinRoot,
} from "@/lib/absolute-file-path";
import { getGitStatusDisplay } from "@/components/workspace/workspace-status";
import {
  selectWorkspaceChangedFilesSection,
  type WorkspaceChangedFileSelection,
} from "@/components/workspace/workspace-change-summary";
import { getThreadDisplayTitle } from "@/lib/thread-title";
import { getMutationErrorMessage } from "@/lib/mutation-errors";
import {
  arePromptDraftStatesEqual,
  promptInputToDraft,
  type PromptDraftAttachment,
  type PromptDraftState,
} from "@/lib/prompt-draft";
import { createLocalStorageEnumStorage } from "@/lib/browser-storage";
import {
  getProjectComposeRoutePath,
  getThreadRoutePath,
  type ThreadRoutePathArgs,
} from "@/lib/route-paths";
import { useGitDiffPanel } from "@/components/secondary-panel/git-diff/useGitDiffPanel";
import { ThreadDetailHeader } from "./ThreadDetailHeader";
import {
  ThreadDetailPromptArea,
  type ThreadDetailSentMessageEdit,
} from "./ThreadDetailPromptArea";
import {
  type ContextBannerMergeBaseConfig,
  isThreadDisplayStatusBannerActive,
  type ThreadPromptParentThreadSection,
  type ThreadPromptChildThreadsSection,
} from "@/components/promptbox/banner/ThreadPromptContextBanner";
import { ThreadDetailSecondaryContent } from "./ThreadDetailSecondaryContent";
import type { ThreadSecondaryPanelFileOpenOptions } from "./useThreadSecondaryPanelVisibility";
import type { HostConnectionNotice } from "./ThreadTimelinePane";
import { useThreadStorageViewer } from "@/components/secondary-panel/useThreadStorageViewer";
import {
  SecondaryPanelCommandHandlers,
  SecondaryPanelHostContent,
  useSecondaryPanelHost,
  useSecondaryPanelFileOpeners,
  type SecondaryPanelHostCapabilities,
} from "@/components/secondary-panel/SecondaryPanelHost";
import { getThreadConversationCollapsedAtom } from "@/components/secondary-panel/threadSecondaryPanelAtoms";
import {
  SIDE_CHAT_PLUGIN_ID,
  SIDE_CHAT_PLUGIN_PANEL_ACTION_ID,
} from "@/lib/side-chat-plugin";
import {
  PluginPanelTabContent,
  usePluginPanelActions,
} from "@/components/plugin/PluginPanelActions";
import { PluginThreadPanelNavigationProvider } from "@/components/plugin/plugin-thread-panel-navigation";
import { ThreadTimelineNavigationProvider } from "@/components/thread/timeline/ThreadTimelineNavigationContext";
import { usePluginSlots } from "@/lib/plugin-slots";
import { getFileExtension } from "@/lib/file-opener-preference";
import { isDesktopBrowserAvailable } from "@/lib/bb-desktop";
import { UrlOpenRoutingProvider } from "@/lib/url-open-routing";
import { getFilePreviewLineRangeStart } from "@/lib/file-preview";
import {
  useThreadStorageBrowser,
  type ThreadStoragePathSelectHandler,
} from "@/components/secondary-panel/useThreadStorageBrowser";
import type { FileSearchSelection } from "@/components/secondary-panel/useThreadFileTabs";
import { useThreadOpenFileSignal } from "@/components/secondary-panel/useThreadOpenFileSignal";
import { useEnvironmentMergeBase } from "@/components/secondary-panel/git-diff/useEnvironmentMergeBase";
import { useThreadGitActions } from "./useThreadGitActions";
import { useThreadReadTracking } from "@/hooks/useThreadReadTracking";
import { useThreadUnreadDividerState } from "./useThreadUnreadDividerState";
import {
  resolveEnvironmentOpenContext,
  resolveWorkspaceChangedFileOpenTarget,
  resolveThreadWorkspacePreviewRootPath,
  resolveThreadWorkspaceOpenPath,
} from "./threadWorkspaceOpenPath";
import {
  resolveThreadLocalFileLink,
  type ThreadLocalFileLinkResolution,
} from "@/lib/thread-local-file-links";
import {
  MarkdownLocalFileContextMenuContext,
  type MarkdownLinkRouting,
  type MarkdownLocalFileContextMenuItem,
  type MarkdownLocalFileLinkRouting,
} from "@/components/ui/markdown-link-routing";
import { isRootThread } from "./threadParentSelectorOptions";
import { getOpenFixedSecondaryTab } from "./threadSecondaryPanelSelection";
import { useRouteState } from "@/hooks/useRouteState";
import { DefaultPaneContextProvider, usePaneContext } from "./PaneContext";
import { ThreadArchiveCommandHandler } from "./ThreadArchiveCommandHandler";
import { ThreadRenameCommandHandler } from "./ThreadRenameCommandHandler";

const EMPTY_PARENT_THREADS: readonly ThreadListEntry[] = [];
const THREAD_SECONDARY_PANEL_CAPABILITIES = {
  hideNewTab: false,
  autoOpenNewTabWhenEmpty: false,
  preserveWorkspaceTabsAcrossContexts: false,
  closeLoneNewTabByHidingPanel: false,
  routeBrowserPopupsByPreference: true,
  showPluginActionIcons: true,
  registerLegacyOpenNewTab: true,
  toggleOpensNewTab: false,
} satisfies SecondaryPanelHostCapabilities;
const EMPTY_PROJECT_THREAD_SUBSET_FILTERS =
  {} satisfies ProjectThreadSubsetFilters;
const DEFAULT_PULL_REQUEST_MERGE_METHOD: PullRequestMergeMethod = "merge";
const PULL_REQUEST_MERGE_METHOD_STORAGE_KEY = "bb.pullRequest.mergeMethod";

function isPullRequestMergeMethod(
  value: string,
): value is PullRequestMergeMethod {
  return value === "merge" || value === "squash" || value === "rebase";
}

const pullRequestMergeMethodAtom = atomWithStorage<PullRequestMergeMethod>(
  PULL_REQUEST_MERGE_METHOD_STORAGE_KEY,
  DEFAULT_PULL_REQUEST_MERGE_METHOD,
  createLocalStorageEnumStorage<PullRequestMergeMethod>(
    isPullRequestMergeMethod,
  ),
  { getOnInit: true },
);

type MergeBasePickerOpenChangeHandler = NonNullable<
  ContextBannerMergeBaseConfig["onPickerOpenChange"]
>;
type OpenFilePreviewHandler = (relativePath: string) => void;

interface SentMessageEditSession {
  draft: PromptDraftState;
  originalDraft: PromptDraftState;
  operationId: string;
  target: ThreadTimelineEditMessageTarget;
  threadId: string;
}

function hasTimelineRowId(
  rows: readonly TimelineRow[],
  rowId: string,
): boolean {
  return rows.some(
    (row) =>
      row.id === rowId ||
      (row.kind === "turn" &&
        row.children !== null &&
        hasTimelineRowId(row.children, rowId)),
  );
}

function getPullRequestMergeLoadingTitle(
  method: PullRequestMergeMethod,
): string {
  switch (method) {
    case "merge":
      return "Merging pull request";
    case "squash":
      return "Squash merging pull request";
    case "rebase":
      return "Rebase merging pull request";
  }
}

interface ThreadDetailViewPageProps {
  surface: "page";
}

interface ThreadDetailViewPaneProps extends ThreadRoutePathArgs {
  surface: "pane";
}

type ThreadDetailViewProps =
  | ThreadDetailViewPageProps
  | ThreadDetailViewPaneProps;

type ThreadDetailViewInternalProps =
  | (ThreadDetailViewPageProps & ThreadRoutePathArgs)
  | ThreadDetailViewPaneProps;

interface BuildMarkdownPreviewLinkRoutingArgs {
  baseDir: string | undefined;
  onOpenLink: ThreadTimelineLinkHandler;
  onOpenLocalFileLink: ThreadTimelineLocalFileLinkHandler;
  rootPath: string | null | undefined;
}

export interface ResolveHostFilePreviewLinkRootPathArgs {
  baseDir: string | undefined;
  threadStorageRootPath: string | null;
  workspaceRootPath: string | null;
}

function buildHostConnectionNotice(
  thread: ThreadWithRuntime,
  /** Machine name to blame explicitly. Only passed when more than one
   * machine exists — a bare "Host" is unambiguous
   * on a single-machine setup. */
  hostName: string | null,
): HostConnectionNotice | null {
  const displayStatus = thread.runtime.displayStatus;
  if (
    displayStatus !== "host-reconnecting" &&
    displayStatus !== "waiting-for-host"
  ) {
    return null;
  }

  const subject = hostName ?? "Host";
  return {
    label:
      displayStatus === "host-reconnecting"
        ? `${subject} disconnected. Waiting for reconnection...`
        : `${subject} disconnected`,
    tone: displayStatus === "host-reconnecting" ? "pending" : "error",
  };
}

function buildMarkdownPreviewLinkRouting({
  baseDir,
  onOpenLink,
  onOpenLocalFileLink,
  rootPath,
}: BuildMarkdownPreviewLinkRoutingArgs): MarkdownLinkRouting {
  if (rootPath === null || rootPath === undefined) {
    return {
      onOpenLink,
    };
  }

  const localFileRouting: MarkdownLocalFileLinkRouting = {
    absoluteLinks: {
      kind: "contained",
      rootPath,
    },
    onOpenLink: onOpenLocalFileLink,
  };
  if (baseDir !== undefined) {
    localFileRouting.relativeLinks = {
      baseDir,
      rootPath,
    };
  }

  return {
    localFile: localFileRouting,
    onOpenLink,
  };
}

function getLocalFileBasename(path: string): string {
  const normalizedPath = path.replace(/[\\/]+$/u, "");
  return normalizedPath.split(/[\\/]/u).at(-1) ?? path;
}

function buildOpenTargetMenuItemLabel(target: WorkspaceOpenTarget): string {
  return `Open in ${target.label}`;
}

export function resolveHostFilePreviewLinkRootPath({
  baseDir,
  threadStorageRootPath,
  workspaceRootPath,
}: ResolveHostFilePreviewLinkRootPathArgs): string | null {
  if (baseDir === undefined) {
    return null;
  }

  if (
    workspaceRootPath !== null &&
    isAbsoluteFilePathWithinRoot({
      candidatePath: baseDir,
      rootPath: workspaceRootPath,
    })
  ) {
    return workspaceRootPath;
  }

  if (
    threadStorageRootPath !== null &&
    isAbsoluteFilePathWithinRoot({
      candidatePath: baseDir,
      rootPath: threadStorageRootPath,
    })
  ) {
    return threadStorageRootPath;
  }

  return null;
}

function ThreadDetailNotFound() {
  return (
    <PageShell contentClassName="min-h-full items-center justify-center">
      <p className="py-12 text-center text-sm text-destructive">Not found</p>
    </PageShell>
  );
}

function RoutedThreadDetailView() {
  const { projectId, threadId } = useRouteState();

  if (!projectId || !threadId) {
    return <ThreadDetailNotFound />;
  }

  return (
    <DefaultPaneContextProvider>
      <ThreadDetailViewInternal
        surface="page"
        projectId={projectId}
        threadId={threadId}
      />
    </DefaultPaneContextProvider>
  );
}

export function ThreadDetailView(props: ThreadDetailViewProps) {
  if (props.surface === "pane") {
    return <ThreadDetailViewInternal {...props} />;
  }
  return <RoutedThreadDetailView />;
}

function ThreadDetailViewInternal(props: ThreadDetailViewInternalProps) {
  const { projectId, threadId } = props;
  const { isFocused, navigateInPane, onRequestClose, isBoundedPane } =
    usePaneContext();
  const navigate = useNavigate();
  const systemConfigQuery = useSystemConfig();
  const threadDetailBootstrapQuery = useThreadDetailBootstrap(threadId ?? "");
  const hasThreadDetailBootstrapSettled =
    threadDetailBootstrapQuery.isSuccess || threadDetailBootstrapQuery.isError;
  const {
    data: thread,
    isFetching,
    isLoadingError,
    error,
  } = useThread(threadId ?? "", {
    enabled: hasThreadDetailBootstrapSettled,
    // A successful bootstrap just populated this exact query with a fresh
    // thread response; refetching it immediately adds redundant tunnel work.
    refetchOnMount: didThreadDetailBootstrapRefreshAfterMount(
      threadDetailBootstrapQuery,
    )
      ? false
      : "always",
  });
  // Treat placeholder data (a full thread row primed from the sidebar list
  // cache) as resolved so switching to an uncached thread renders the shell
  // immediately instead of flashing a full-page "Loading..." while the
  // bootstrap request is in flight. The timeline pane shows its own loading
  // state as content streams in.
  const threadQueryState = useConnectionAwareQueryState({
    hasResolvedData: thread !== undefined,
    isFetching: threadDetailBootstrapQuery.isFetching || isFetching,
    isLoadingError,
    isRecoverableLoadingError: isTransientReadError(error),
  });
  const threadOriginKind = thread?.originKind ?? thread?.childOrigin ?? null;
  // This thread IS one of the side-chat plugin's forks — the plugin-era
  // successor to `originKind === "side-chat"`. Migration 0084 moved every
  // legacy side chat onto this shape.
  const isSideChatThread =
    threadOriginKind === "fork" &&
    thread?.originPluginId === SIDE_CHAT_PLUGIN_ID;
  const threadSourceThreadId =
    thread?.sourceThreadId ??
    (thread && threadOriginKind ? thread.parentThreadId : null);
  const { data: parentThread } = useThread(thread?.parentThreadId ?? "");
  const { data: sourceThread } = useThread(threadSourceThreadId ?? "");
  const pendingInteractionsQuery = useThreadPendingInteractions(
    thread?.id ?? "",
    {
      enabled: threadQueryState.status === "ready" && Boolean(thread?.id),
    },
  );
  const pendingInteractions = pendingInteractionsQuery.data ?? [];
  const pendingInteractionsInitialLoading =
    pendingInteractionsQuery.data === undefined &&
    (pendingInteractionsQuery.isLoading || pendingInteractionsQuery.isFetching);
  const hasPendingInteraction =
    getLatestPendingInteraction(pendingInteractions) !== null;
  const { data: queuedMessagesForEditEligibility = [] } =
    useThreadQueuedMessages(thread?.id ?? "", {
      enabled: threadQueryState.status === "ready" && Boolean(thread?.id),
    });
  const unreadDividerState = useThreadUnreadDividerState({
    routeThreadId: threadId,
    thread,
  });
  const [hasRequestedMergeBaseOptions, setHasRequestedMergeBaseOptions] =
    useState(false);
  const shouldLoadThreadStorageFiles = thread !== undefined;
  const {
    isThreadStorageFilesLoading,
    refetchThreadStorageFiles,
    threadStorageFiles,
    threadStorageFilesError,
    threadStorageRootPath,
  } = useThreadStorageViewer({
    activePath: null,
    fileListEnabled: shouldLoadThreadStorageFiles,
    filePreviewEnabled: false,
    threadId,
  });
  const environmentQuery = useEnvironment(thread?.environmentId, {
    enabled: hasThreadDetailBootstrapSettled,
    staleTime: 5_000,
  });
  const environment = environmentQuery.data;
  const hostsQuery = useHosts({
    enabled:
      hasThreadDetailBootstrapSettled &&
      thread?.environmentId !== null &&
      thread?.environmentId !== undefined,
  });
  const connectedHostIds = useMemo(
    () =>
      new Set(
        (hostsQuery.data ?? [])
          .filter((host) => host.status === "connected")
          .map((host) => host.id),
      ),
    [hostsQuery.data],
  );
  const threadEnvironmentHost = useMemo(() => {
    const hosts = hostsQuery.data ?? [];
    if (hosts.length <= 1) return null;
    const environmentHostId = environment?.hostId;
    if (!environmentHostId) return null;
    return hosts.find((host) => host.id === environmentHostId) ?? null;
  }, [environment?.hostId, hostsQuery.data]);
  const hostConnectionNotice = useMemo(
    () =>
      thread
        ? buildHostConnectionNotice(thread, threadEnvironmentHost?.name ?? null)
        : null,
    [thread, threadEnvironmentHost],
  );
  const canCreateTerminal =
    thread?.environmentId !== null &&
    thread?.environmentId !== undefined &&
    environment?.status === "ready" &&
    connectedHostIds.has(environment.hostId);
  const {
    fileOpeners: pluginFileOpeners,
    threadPanelActions: pluginThreadPanelActions,
  } = usePluginSlots();
  const threadPanelNavigation = useMemo(
    () => ({
      canOpenStorageFiles: true,
      canOpenWorkspaceFiles: Boolean(thread?.environmentId),
      defaultProjectId: projectId,
      openProject: (targetProjectId: string) =>
        navigate(getProjectComposeRoutePath(targetProjectId)),
      openThread: navigateInPane,
    }),
    [navigate, navigateInPane, projectId, thread?.environmentId],
  );
  const threadTerminalTarget = useMemo(
    () => ({ kind: "thread" as const, threadId }),
    [threadId],
  );
  const secondaryPanelHost = useSecondaryPanelHost({
    canCreateTerminal,
    capabilities: THREAD_SECONDARY_PANEL_CAPABILITIES,
    environmentId: thread?.environmentId,
    isFocused,
    navigation: threadPanelNavigation,
    panelStateId: threadId,
    pluginPanelActions: pluginThreadPanelActions,
    projectId,
    storageFiles: threadStorageFiles?.files,
    syncThreadId: threadId,
    terminalTarget: threadTerminalTarget,
    threadId: thread?.id ?? null,
    workspaceRootPath: environment?.path,
  });
  const {
    activeFixedSecondaryTab,
    activeHostFilePath,
    activeStorageFilePath,
    clearActiveFileTabs,
    closeSecondaryPanel,
    handleOpenBrowser,
    handleStartTerminal,
    isPersistedSecondaryPanelOpen,
    isSecondaryPanelOpen,
    openBrowserTabAndReveal,
    openCompactDrawer,
    openHostFile,
    openPluginPanel,
    openStorageFile,
    openTab,
    openUrlByPreference: handleOpenUrlByPreference,
    openWorkspaceFile,
    renderSecondaryPanelAsDrawer,
    resolveMentionLink,
    secondaryPanelProps,
    selectFileSearchResult,
    setPersistedSecondaryPanel,
    toggleSecondaryPanel,
  } = secondaryPanelHost;
  const pluginPanelActions = usePluginPanelActions({
    openPluginPanel,
    threadId,
  });
  useThreadOpenFileSignal({
    threadId,
    environmentId: thread?.environmentId,
    openTab,
  });
  const desktopBrowserAvailable = isDesktopBrowserAvailable();
  const canOpenUrlsInAppBrowser = desktopBrowserAvailable;
  const isThreadRoot = isRootThread(thread);
  const [
    parentThreadsRequestedForThreadId,
    setParentThreadsRequestedForThreadId,
  ] = useState<string | null>(null);
  const shouldLoadParentThreads =
    threadQueryState.status === "ready" &&
    isThreadRoot &&
    parentThreadsRequestedForThreadId === thread?.id;
  const parentThreadSubsetQuery = useProjectThreadSubset({
    enabled: shouldLoadParentThreads,
    filters: EMPTY_PROJECT_THREAD_SUBSET_FILTERS,
    projectId,
  });
  const childThreadSubsetFilters = useMemo<ProjectThreadSubsetFilters>(() => {
    if (!thread?.id) {
      return EMPTY_PROJECT_THREAD_SUBSET_FILTERS;
    }
    return { parentThreadId: thread.id };
  }, [thread?.id]);
  const childThreadSubsetQuery = useProjectThreadSubset({
    enabled: threadQueryState.status === "ready" && Boolean(thread?.id),
    filters: childThreadSubsetFilters,
    projectId,
  });
  const parentThreads = useMemo(
    () =>
      shouldLoadParentThreads
        ? (parentThreadSubsetQuery.data ?? EMPTY_PARENT_THREADS)
        : EMPTY_PARENT_THREADS,
    [parentThreadSubsetQuery.data, shouldLoadParentThreads],
  );
  const handleParentSelectorOpenChange = useCallback(
    (open: boolean) => {
      if (open && thread?.id) {
        setParentThreadsRequestedForThreadId(thread.id);
      }
    },
    [thread?.id],
  );
  const handleRetryParentThreads = parentThreadSubsetQuery.retry;
  const {
    activePromptMode,
    activeThinking,
    activeWorkflows,
    activeBackgroundCommands,
    contextWindowUsage,
    goal,
    hasOlderTimelineRows,
    isLoadingOlderTimelineRows,
    loadOlderTimelineRows,
    modelFallback,
    pendingTodos,
    timelineError,
    timelineLoading,
    timelineRows,
  } = useThreadTimelineController({
    threadId: threadId ?? "",
  });
  const sendMessage = useSendThreadMessage();
  const editMessage = useEditThreadMessage();
  const createQueuedMessage = useCreateThreadQueuedMessage();
  const requestEnvironmentAction = useRequestEnvironmentAction();
  const [pullRequestMergeMethod, setPullRequestMergeMethod] = useAtom(
    pullRequestMergeMethodAtom,
  );
  const markThreadRead = useMarkThreadRead();
  const updateEnvironment = useUpdateEnvironment();
  const updateThread = useUpdateThread({
    errorMessage: "Failed to assign parent thread.",
  });
  const forkThreadFromMessage = useForkThreadFromMessage({
    sourceThread: thread ?? null,
  });
  const handleForkMessage = useCallback<ThreadTimelineForkMessageHandler>(
    (target) => {
      void forkThreadFromMessage(target);
    },
    [forkThreadFromMessage],
  );
  const isForkAvailable = isThreadForkable(thread ?? null);
  const dismissCompactKeyboard = useCallback(() => {
    if (!renderSecondaryPanelAsDrawer) {
      return;
    }
    // A selection action can leave a previously focused composer active. Blur
    // it on compact web so the keyboard never covers the updated composer or a
    // side-chat drawer; users choose when to focus an input again.
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement) {
      activeElement.blur();
    }
  }, [renderSecondaryPanelAsDrawer]);
  // Same scope (`projectId` + `thread.id`) the composer's `ThreadDetailPromptArea`
  // uses, so the timeline "Add to chat" action and the composer share one
  // localStorage-backed draft — the quoted text is appended to the draft as a
  // `> ` blockquote block and renders inline in the composer immediately, with
  // no duplicated draft state.
  const selectionPromptDraft = usePromptDraftStorage({
    kind: "thread",
    projectId: thread?.projectId ?? projectId ?? "",
    threadId: thread?.id ?? "",
  });
  const addQuoteToComposer = selectionPromptDraft.addQuote;
  // Desktop quote actions keep their existing focus handoff. Mobile web does
  // not focus inputs programmatically; see PromptBoxInternal.
  const [composerFocusRequestNonce, setComposerFocusRequestNonce] = useState(0);
  const [sentMessageEditSession, setSentMessageEditSession] =
    useState<SentMessageEditSession | null>(null);
  const [sentMessageEditHostElement, setSentMessageEditHostElement] =
    useState<HTMLDivElement | null>(null);
  const activeSentMessageEditSession =
    sentMessageEditSession?.threadId === thread?.id
      ? sentMessageEditSession
      : null;
  // Client-side affordance policy for the UX prototype. The eventual mutation
  // must repeat the full eligibility check on the server before changing state.
  const canEditSentMessages =
    thread !== undefined &&
    (systemConfigQuery.data?.experiments.editMessages ?? false) &&
    (thread.providerId === "claude-code" ||
      thread.providerId === "codex" ||
      thread.providerId === "pi") &&
    thread.runtime.displayStatus === "idle" &&
    thread.archivedAt === null &&
    thread.deletedAt === null &&
    !hasPendingInteraction &&
    sentMessageEditSession === null &&
    !sendMessage.isPending &&
    !createQueuedMessage.isPending &&
    !editMessage.isPending &&
    !(timelineLoading && timelineRows.length === 0) &&
    queuedMessagesForEditEligibility.length === 0 &&
    activeWorkflows.length === 0 &&
    thread.activeBackgroundAgentCount === 0 &&
    activeBackgroundCommands.length === 0;
  const sentMessageEditEntryRef = useRef({ canEditSentMessages, thread });
  sentMessageEditEntryRef.current = { canEditSentMessages, thread };
  const handleEditSentMessage = useCallback<ThreadTimelineEditMessageHandler>(
    (target: ThreadTimelineEditMessageTarget) => {
      const current = sentMessageEditEntryRef.current;
      if (!current.thread || !current.canEditSentMessages) {
        return;
      }
      const editDraft = promptInputToDraft(target.input);
      setSentMessageEditHostElement(null);
      setSentMessageEditSession({
        draft: editDraft,
        originalDraft: editDraft,
        operationId: crypto.randomUUID(),
        target,
        threadId: current.thread.id,
      });
    },
    [],
  );
  const sentMessageEditThreadId = sentMessageEditSession?.threadId ?? null;
  const sentMessageEditTargetMessageId =
    sentMessageEditSession?.target.messageId ?? null;
  const currentThreadId = thread?.id ?? null;
  const sentMessageEditTargetStillPresent =
    sentMessageEditThreadId === currentThreadId &&
    sentMessageEditTargetMessageId !== null
      ? hasTimelineRowId(timelineRows, sentMessageEditTargetMessageId)
      : true;
  const shouldDiscardMissingSentMessageEdit =
    sentMessageEditThreadId !== null &&
    sentMessageEditThreadId === currentThreadId &&
    !timelineLoading &&
    !sentMessageEditTargetStillPresent;
  useEffect(() => {
    if (!shouldDiscardMissingSentMessageEdit) {
      return;
    }
    setSentMessageEditHostElement(null);
    setSentMessageEditSession(null);
    appToast.warning("The message being edited is no longer available.");
  }, [shouldDiscardMissingSentMessageEdit]);
  const activeSentMessageEditOperationId =
    activeSentMessageEditSession?.operationId ?? null;
  const updateSentMessageEditDraft = useCallback(
    (update: (current: PromptDraftState) => PromptDraftState) => {
      setSentMessageEditSession((current) =>
        current?.operationId === activeSentMessageEditOperationId
          ? { ...current, draft: update(current.draft) }
          : current,
      );
    },
    [activeSentMessageEditOperationId],
  );
  const finishCancelSentMessageEdit = useCallback((operationId: string) => {
    setSentMessageEditSession((current) =>
      current?.operationId === operationId ? null : current,
    );
  }, []);
  const cancelSentMessageEdit = useCallback(() => {
    const current = activeSentMessageEditSession;
    if (!current) {
      return;
    }
    if (arePromptDraftStatesEqual(current.draft, current.originalDraft)) {
      finishCancelSentMessageEdit(current.operationId);
      return;
    }
    appToast.warning("Discard this message edit?", {
      description:
        "The sent message and conversation are still unchanged. Your follow-up draft is unaffected.",
      action: {
        label: "Discard edit",
        onClick: () => finishCancelSentMessageEdit(current.operationId),
      },
      cancel: { label: "Keep editing", onClick: () => {} },
    });
  }, [activeSentMessageEditSession, finishCancelSentMessageEdit]);
  const submitSentMessageEdit = useCallback<
    ThreadDetailSentMessageEdit["onSubmit"]
  >(
    (target) => {
      if (!activeSentMessageEditSession) {
        return;
      }
      const session = activeSentMessageEditSession;
      const execution = target.execution;
      void editMessage
        .mutateAsync({
          id: session.threadId,
          operationId: session.operationId,
          expectedRequestSequence: session.target.expectedRequestSequence,
          input: target.input,
          ...(execution
            ? {
                model: execution.model,
                permissionMode: execution.permissionMode,
                reasoningLevel: execution.reasoningLevel,
                executionInputSources: execution.executionInputSources,
                ...(execution.supportsServiceTier && execution.serviceTier
                  ? { serviceTier: execution.serviceTier }
                  : {}),
              }
            : {}),
        })
        .then(() => {
          finishCancelSentMessageEdit(session.operationId);
        })
        .catch((error) => {
          appToast.error(
            getMutationErrorMessage({
              error,
              fallbackMessage: "Failed to edit the message",
              lifecycleOperation: "edit_message",
            }),
          );
        });
    },
    [activeSentMessageEditSession, editMessage, finishCancelSentMessageEdit],
  );
  const activeSentMessageEditTargetMessageId =
    activeSentMessageEditSession?.target.messageId ?? null;
  const inlineMessageEditor = useMemo<
    ThreadTimelineInlineMessageEditor | undefined
  >(
    () =>
      activeSentMessageEditTargetMessageId !== null
        ? {
            messageId: activeSentMessageEditTargetMessageId,
            onHostElementChange: setSentMessageEditHostElement,
          }
        : undefined,
    [activeSentMessageEditTargetMessageId],
  );
  const sentMessageEdit = useMemo<ThreadDetailSentMessageEdit | undefined>(
    () =>
      activeSentMessageEditSession
        ? {
            draft: activeSentMessageEditSession.draft,
            hostElement: sentMessageEditHostElement,
            isSubmitting: editMessage.isPending,
            operationId: activeSentMessageEditSession.operationId,
            onCancel: cancelSentMessageEdit,
            onSubmit: submitSentMessageEdit,
            updateDraft: updateSentMessageEditDraft,
          }
        : undefined,
    [
      activeSentMessageEditSession,
      cancelSentMessageEdit,
      editMessage.isPending,
      sentMessageEditHostElement,
      submitSentMessageEdit,
      updateSentMessageEditDraft,
    ],
  );
  // Plugin useComposer() writes ride the focus bus (they can't reach this
  // view's local nonce); same storage key = same draft the composer shows.
  useEffect(
    () =>
      subscribeComposerFocusRequests(selectionPromptDraft.storageKey, () =>
        setComposerFocusRequestNonce((nonce) => nonce + 1),
      ),
    [selectionPromptDraft.storageKey],
  );
  const handleSelectionAddToChat = useCallback(
    (text: string, attachments?: readonly PromptDraftAttachment[]) => {
      dismissCompactKeyboard();
      addQuoteToComposer(text, attachments);
      setComposerFocusRequestNonce((nonce) => nonce + 1);
    },
    [addQuoteToComposer, dismissCompactKeyboard],
  );
  const sendSideChatMessageToMain =
    useCallback<ThreadTimelineSendToMainMessageHandler>(
      (target) => {
        if (
          thread?.id === undefined ||
          !isSideChatThread ||
          threadSourceThreadId === null ||
          createQueuedMessage.isPending
        ) {
          return;
        }

        createQueuedMessage.mutate({
          id: threadSourceThreadId,
          input: [{ type: "text", text: target.messageText, mentions: [] }],
          senderThreadId: thread.id,
        });
      },
      [createQueuedMessage, isSideChatThread, thread?.id, threadSourceThreadId],
    );
  const handleSendToMainMessage =
    isSideChatThread && threadSourceThreadId !== null
      ? sendSideChatMessageToMain
      : undefined;
  const canUseGitUi = environment?.isGitRepo === true;
  const createThreadInWorktree = useCreateThreadInWorktree({
    projectId: projectId ?? "",
    environmentId: thread?.environmentId ?? "",
  });
  const environmentMergeBaseBranch =
    resolveEnvironmentMergeBaseBranch(environment);
  const openFixedSecondaryTab = getOpenFixedSecondaryTab({
    activeFixedSecondaryTab,
    isSecondaryPanelOpen: isPersistedSecondaryPanelOpen,
  });
  const {
    clearPendingGitDiffIntent,
    isLoadingMergeBaseBranchOptions,
    mergeBaseBranchOptions,
    mergeBaseRemoteBranchOptions,
    openCommitDiff: openPersistedCommitDiff,
    openDiffFile: openPersistedDiffFile,
    openThreadDiffPanel: openPersistedDiffPanel,
    pendingGitDiffCommitSha,
    pendingGitDiffScrollPath,
    requestedMergeBaseBranch,
    selectedMergeBaseBranch,
    selectedMergeBaseBranchRef,
    setMergeBaseBranchSearchQuery,
    setSelectedMergeBaseBranch,
  } = useGitDiffPanel({
    activeSecondaryTab: openFixedSecondaryTab,
    clearActiveFileTabs,
    defaultMergeBaseBranch: environmentMergeBaseBranch,
    environmentId: canUseGitUi
      ? (thread?.environmentId ?? undefined)
      : undefined,
    mergeBaseBranchOptionsEnabled: hasRequestedMergeBaseOptions,
    setThreadSecondaryPanel: setPersistedSecondaryPanel,
    threadId,
  });
  const openSecondaryPanelCommitDiff = useCallback(
    (sha: string) => {
      openPersistedCommitDiff(sha);
      openCompactDrawer();
    },
    [openCompactDrawer, openPersistedCommitDiff],
  );
  const openSecondaryPanelDiffFile = useCallback(
    (path: string) => {
      openPersistedDiffFile(path);
      openCompactDrawer();
    },
    [openCompactDrawer, openPersistedDiffFile],
  );
  const openSecondaryPanelDiffPanel = useCallback(() => {
    openPersistedDiffPanel();
    openCompactDrawer();
  }, [openCompactDrawer, openPersistedDiffPanel]);
  const handleToggleDiff = useCallback(() => {
    if (!canUseGitUi) return false;
    if (isSecondaryPanelOpen && activeFixedSecondaryTab?.kind === "git-diff") {
      closeSecondaryPanel();
    } else {
      openSecondaryPanelDiffPanel();
    }
    return true;
  }, [
    activeFixedSecondaryTab?.kind,
    canUseGitUi,
    closeSecondaryPanel,
    isSecondaryPanelOpen,
    openSecondaryPanelDiffPanel,
  ]);
  const handleChangedFileClick = useCallback(
    (selection: WorkspaceChangedFileSelection) => {
      const openTarget = resolveWorkspaceChangedFileOpenTarget(selection);
      if (openTarget.kind === "preview") {
        openWorkspaceFile({
          lineRange: null,
          path: selection.file.path,
          source: openTarget.source,
          statusLabel: openTarget.statusLabel,
        });
        return;
      }
      openSecondaryPanelDiffFile(selection.file.path);
    },
    [openSecondaryPanelDiffFile, openWorkspaceFile],
  );
  const handleCommitClick = useCallback(
    (sha: string) => {
      openSecondaryPanelCommitDiff(sha);
    },
    [openSecondaryPanelCommitDiff],
  );
  const handleOpenTimelinePluginPanel =
    useCallback<ThreadTimelineOpenPluginPanelHandler>(
      ({ pluginId, actionId, title, params }) => {
        const action = pluginThreadPanelActions.find(
          (candidate) =>
            candidate.pluginId === pluginId && candidate.id === actionId,
        );
        if (action === undefined) return false;
        let paramsJson: string | null;
        try {
          paramsJson = serializePluginPanelParams(params);
        } catch (error) {
          console.warn(
            `[plugin:${pluginId}] messageDirective openThreadPanel params are invalid: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          return false;
        }
        openPluginPanel({
          pluginId,
          actionId,
          title: title ?? action.title,
          paramsJson,
        });
        openCompactDrawer();
        return true;
      },
      [openCompactDrawer, openPluginPanel, pluginThreadPanelActions],
    );
  const handleSelectFileSearchResult = useCallback(
    (selection: FileSearchSelection) => {
      selectFileSearchResult(selection);
      openCompactDrawer();
    },
    [openCompactDrawer, selectFileSearchResult],
  );
  const handleSelectStorageBrowserPath =
    useCallback<ThreadStoragePathSelectHandler>(
      (path) => {
        openStorageFile({
          lineRange: null,
          path,
        });
      },
      [openStorageFile],
    );
  const storageBrowserController = useThreadStorageBrowser({
    files: threadStorageFiles?.files,
    onSelectPath: handleSelectStorageBrowserPath,
    selectedPath: activeStorageFilePath,
  });
  const [storedConversationCollapsed, setStoredConversationCollapsed] = useAtom(
    getThreadConversationCollapsedAtom(threadId),
  );
  const isConversationCollapsed = storedConversationCollapsed;
  // The collapse preference only applies while the panel is open on a wide
  // viewport; ThreadDetailSecondaryContent gates it (there is nothing to expand
  // into otherwise) and surfaces the toggle on the seam arrow.
  const toggleConversationCollapse = useCallback(() => {
    setStoredConversationCollapsed((collapsed) => !collapsed);
  }, [setStoredConversationCollapsed]);
  useEffect(() => {
    setHasRequestedMergeBaseOptions(false);
  }, [thread?.environmentId]);
  const handleMergeBasePickerOpenChange =
    useCallback<MergeBasePickerOpenChangeHandler>((open) => {
      if (open) {
        setHasRequestedMergeBaseOptions(true);
      }
    }, []);
  const workStatusQuery = useEnvironmentWorkStatus(
    thread?.environmentId,
    requestedMergeBaseBranch,
    {
      enabled: canUseGitUi && environment !== undefined,
    },
  );
  const workspaceStatusError = workStatusQuery.error;
  const workStatusResponse = workspaceStatusError
    ? undefined
    : workStatusQuery.data;
  const workspaceStatus =
    workStatusResponse?.outcome === "available"
      ? workStatusResponse.workspace
      : undefined;
  const workspaceUnavailable =
    workStatusResponse?.outcome === "unavailable"
      ? workStatusResponse.failure
      : undefined;
  const pullRequestQuery = useEnvironmentPullRequest(thread?.environmentId, {
    enabled: canUseGitUi && environment !== undefined,
  });
  const pullRequest = getEnvironmentPullRequestFromResponse(
    pullRequestQuery.data,
  );
  const handlePullRequestReady = useCallback(async () => {
    const environmentId = thread?.environmentId;
    if (!environmentId) {
      return;
    }
    const toastId = appToast.loading("Marking pull request ready");
    try {
      const response = await requestEnvironmentAction.mutateAsync({
        id: environmentId,
        action: "pull_request_ready",
      });
      if (response.action !== "pull_request_ready") {
        throw new Error("Expected pull request ready action response.");
      }
      appToast.success(response.message, { id: toastId });
    } catch (error) {
      appToast.error("Failed to update pull request", {
        id: toastId,
        description: getMutationErrorMessage({
          error,
          fallbackMessage: "Pull request was not updated",
        }),
      });
    }
  }, [requestEnvironmentAction, thread?.environmentId]);
  const handlePullRequestDraft = useCallback(async () => {
    const environmentId = thread?.environmentId;
    if (!environmentId) {
      return;
    }
    const toastId = appToast.loading("Converting pull request to draft");
    try {
      const response = await requestEnvironmentAction.mutateAsync({
        id: environmentId,
        action: "pull_request_draft",
      });
      if (response.action !== "pull_request_draft") {
        throw new Error("Expected pull request draft action response.");
      }
      appToast.success(response.message, { id: toastId });
    } catch (error) {
      appToast.error("Failed to update pull request", {
        id: toastId,
        description: getMutationErrorMessage({
          error,
          fallbackMessage: "Pull request was not updated",
        }),
      });
    }
  }, [requestEnvironmentAction, thread?.environmentId]);
  const handlePullRequestMerge = useCallback(
    async (method: PullRequestMergeMethod) => {
      const environmentId = thread?.environmentId;
      if (!environmentId) {
        return;
      }
      setPullRequestMergeMethod(method);
      const toastId = appToast.loading(getPullRequestMergeLoadingTitle(method));
      try {
        const response = await requestEnvironmentAction.mutateAsync({
          id: environmentId,
          action: "pull_request_merge",
          options: { method },
        });
        if (response.action !== "pull_request_merge") {
          throw new Error("Expected pull request merge action response.");
        }
        appToast.success(response.message, { id: toastId });
      } catch (error) {
        appToast.error("Failed to merge pull request", {
          id: toastId,
          description: getMutationErrorMessage({
            error,
            fallbackMessage: "Pull request was not merged",
          }),
        });
      }
    },
    [
      requestEnvironmentAction,
      setPullRequestMergeMethod,
      thread?.environmentId,
    ],
  );
  const workspaceBranch = workspaceStatus?.branch;
  const workspaceChangedFilesSection = useMemo(
    () => selectWorkspaceChangedFilesSection(workspaceStatus),
    [workspaceStatus],
  );
  const workingTreeChangedFilesSection = useMemo(() => {
    if (
      workspaceChangedFilesSection === null ||
      workspaceChangedFilesSection.kind === "committed"
    ) {
      return null;
    }
    return workspaceChangedFilesSection;
  }, [workspaceChangedFilesSection]);
  const { isLocalDaemonHost } = useHostDaemon();
  const threadEnvironmentIsLocal = environment
    ? isLocalDaemonHost(environment.hostId)
    : false;
  const environmentDisplayHostContext = useMemo<EnvironmentDisplayHostContext>(
    () => ({
      locality: threadEnvironmentIsLocal ? "local" : "remote",
      identity: threadEnvironmentHost
        ? {
            name: threadEnvironmentHost.name,
            connected: threadEnvironmentHost.status === "connected",
          }
        : null,
    }),
    [threadEnvironmentIsLocal, threadEnvironmentHost],
  );
  const workspacePreviewRootPath = resolveThreadWorkspacePreviewRootPath({
    environment,
  });
  const threadOpenContext = resolveEnvironmentOpenContext({
    environment,
    serverOrigin: window.location.origin,
    threadEnvironmentIsLocal,
  });
  const {
    canOpenPreferredDirectoryTarget,
    canOpenPreferredFileTarget,
    directoryOpenTargets,
    fileOpenTargets,
    openPathInDirectoryTarget,
    openPathInFileTarget,
    openPathInPreferredDirectoryTarget,
    openPathInPreferredFileTarget,
    preferredDirectoryTarget,
  } = useLocalOpenTargets({
    enabled: threadOpenContext !== null,
    ...(threadOpenContext ? { openContext: threadOpenContext } : {}),
  });
  const parentThreadSection: ThreadPromptParentThreadSection | null =
    useMemo(() => {
      const relatedThreadId =
        threadOriginKind !== null
          ? threadSourceThreadId
          : thread?.parentThreadId;
      if (!thread || !relatedThreadId) return null;
      const href = getThreadRoutePath({
        projectId: thread.projectId,
        threadId: relatedThreadId,
      });
      // A side chat is a fork too, so it is tested first.
      const relationship = isSideChatThread
        ? "side-chat"
        : threadOriginKind === "fork"
          ? "fork"
          : "parent";
      const relatedThread =
        relationship === "parent" ? parentThread : sourceThread;
      if (relatedThread === undefined) {
        // Related record not yet loaded — show id-based fallback so the user
        // doesn't get a flicker of "no related thread" before resolution.
        return {
          parentThreadTitle: relatedThreadId.slice(0, 8),
          href,
          relationship,
        };
      }
      // Plan ownership invariants: silently exclude dirty references rather
      // than rendering a stale or unreachable related-thread link.
      if (
        relatedThread.archivedAt !== null ||
        relatedThread.deletedAt !== null ||
        relatedThread.projectId !== thread.projectId
      ) {
        return null;
      }
      return {
        parentThreadTitle: getThreadDisplayTitle(relatedThread),
        href,
        relationship,
      };
    }, [
      isSideChatThread,
      parentThread,
      sourceThread,
      thread,
      threadOriginKind,
      threadSourceThreadId,
    ]);
  const childThreadsSection: ThreadPromptChildThreadsSection | null =
    useMemo(() => {
      const list = childThreadSubsetQuery.data ?? [];
      const activeItems = list
        .filter(
          (entry) =>
            // Forks / side chats are user-driven branches opened directly, not
            // delegated work the parent is waiting on — keep them out of the
            // active-child banner count and drawer.
            entry.childOrigin === null &&
            isThreadDisplayStatusBannerActive(entry.runtime.displayStatus),
        )
        .map((entry) => ({
          id: entry.id,
          title: getThreadDisplayTitle(entry),
          href: getThreadRoutePath({
            projectId: entry.projectId,
            threadId: entry.id,
          }),
        }));
      if (activeItems.length === 0) return null;
      return { items: activeItems };
    }, [childThreadSubsetQuery.data]);
  const isThreadTimelinePending = timelineLoading && timelineRows.length === 0;
  useThreadReadTracking({
    markThreadRead,
    thread,
  });
  const {
    effectiveMergeBaseBranch,
    handleMergeBaseBranchChange,
    showBranchComparisonUi,
    showMergeBase,
    mergeBaseBranch,
  } = useEnvironmentMergeBase({
    environment,
    selectedMergeBaseBranch,
    setSelectedMergeBaseBranch,
    thread,
    updateEnvironment,
    workspaceStatus,
  });
  const gitActions = useThreadGitActions({
    environment,
    requestEnvironmentAction,
    sendMessage,
    thread,
    workspaceStatus,
  });
  useEffect(() => {
    if (gitActions.threadGitActionDialog.target !== null) {
      setHasRequestedMergeBaseOptions(true);
    }
  }, [gitActions.threadGitActionDialog.target]);
  const parentThreadId = thread?.parentThreadId;
  const parentThreadDisplayName =
    parentThread?.title && parentThread.title.trim().length > 0
      ? parentThread.title
      : parentThreadId;
  const handleAssignParent = useCallback(
    (nextParentThreadId: string | null) => {
      if (!thread || updateThread.isPending) {
        return;
      }

      updateThread.mutate({
        id: thread.id,
        parentThreadId: nextParentThreadId,
      });
    },
    [thread, updateThread],
  );
  const handleTimelineLocalFileLinkResolution = useCallback(
    (
      resolution: ThreadLocalFileLinkResolution,
      options?: ThreadSecondaryPanelFileOpenOptions,
    ) => {
      if (resolution.kind === "app-route") {
        return false;
      }
      if (resolution.kind === "error") {
        appToast.error("Failed to open file locally", {
          description: resolution.description,
        });
        return true;
      }

      if (resolution.kind === "open-workspace-path") {
        openWorkspaceFile(
          {
            lineRange: resolution.request.lineRange,
            path: resolution.request.relativePath,
            source: { kind: "working-tree" },
            statusLabel: null,
          },
          options,
        );
        return true;
      }

      if (resolution.kind === "open-thread-storage-path") {
        openStorageFile(
          {
            lineRange: resolution.request.lineRange,
            path: resolution.request.relativePath,
          },
          options,
        );
        return true;
      }

      openHostFile(
        {
          lineRange: resolution.request.lineRange,
          path: resolution.request.path,
        },
        options,
      );
      return true;
    },
    [openHostFile, openStorageFile, openWorkspaceFile],
  );
  const handleOpenTimelineLocalFileLink = useCallback(
    (
      link: ThreadTimelineLocalFileLink,
      options?: ThreadSecondaryPanelFileOpenOptions,
    ) => {
      const resolution = resolveThreadLocalFileLink({
        hostFileLinksAvailable:
          thread?.environmentId !== null && thread?.environmentId !== undefined,
        link,
        threadStorageRootPath,
        workspaceRootPath: workspacePreviewRootPath,
      });

      if (
        resolution.kind !== "open-host-path" ||
        threadStorageRootPath !== null
      ) {
        return handleTimelineLocalFileLinkResolution(resolution, options);
      }

      void refetchThreadStorageFiles()
        .then((result) => {
          const resolvedThreadStorageRootPath =
            result.data?.storageRootPath ?? null;
          if (resolvedThreadStorageRootPath === null) {
            appToast.error("Failed to open file locally", {
              description: "Thread storage path is not available yet.",
            });
            return;
          }

          const resolvedResolution = resolveThreadLocalFileLink({
            hostFileLinksAvailable: true,
            link,
            threadStorageRootPath: resolvedThreadStorageRootPath,
            workspaceRootPath: workspacePreviewRootPath,
          });
          handleTimelineLocalFileLinkResolution(resolvedResolution, options);
        })
        .catch((error: Error) => {
          appToast.error("Failed to open file locally", {
            description: error.message,
          });
        });

      return true;
    },
    [
      handleTimelineLocalFileLinkResolution,
      refetchThreadStorageFiles,
      thread?.environmentId,
      threadStorageRootPath,
      workspacePreviewRootPath,
    ],
  );
  const handleOpenTimelineLink = useCallback<ThreadTimelineLinkHandler>(
    ({ href }) => handleOpenUrlByPreference(href),
    [handleOpenUrlByPreference],
  );
  const handleTimelineTitleAction = useCallback<TimelineTitleActionResolver>(
    (action) => {
      switch (action.kind) {
        case "open-file-diff":
          return () => {
            openSecondaryPanelDiffFile(action.path);
          };
        case "open-plugin-side-chat":
          return () => {
            handleOpenTimelinePluginPanel({
              pluginId: SIDE_CHAT_PLUGIN_ID,
              actionId: SIDE_CHAT_PLUGIN_PANEL_ACTION_ID,
              params:
                threadId === undefined
                  ? { threadId: action.threadId }
                  : { threadId: action.threadId, sourceThreadId: threadId },
            });
          };
        default:
          // Surfaces a compile-time error if a future TimelineTitleAction
          // variant is added without app-side handling, instead of silently
          // returning undefined and leaving a kind unrouted.
          return assertNever(action);
      }
    },
    [openSecondaryPanelDiffFile, handleOpenTimelinePluginPanel, threadId],
  );
  const metadataStorage = useMemo(
    () => ({
      controller: storageBrowserController,
      filesError: threadStorageFilesError,
      isFilesLoading: isThreadStorageFilesLoading,
    }),
    [
      isThreadStorageFilesLoading,
      storageBrowserController,
      threadStorageFilesError,
    ],
  );
  const workspaceOpenPath = resolveThreadWorkspaceOpenPath({
    canOpenWorkspace: canOpenPreferredDirectoryTarget,
    environment,
    hasWorkspaceOpenTargets: directoryOpenTargets.length > 0,
  });
  const handleOpenPreferredWorkspace = useCallback(() => {
    if (!workspaceOpenPath || !preferredDirectoryTarget) return false;
    void openPathInPreferredDirectoryTarget({
      lineNumber: null,
      path: workspaceOpenPath,
    });
    return true;
  }, [
    openPathInPreferredDirectoryTarget,
    preferredDirectoryTarget,
    workspaceOpenPath,
  ]);
  const {
    handleOpenPreferred,
    openHostFileInEditor: handleOpenHostFileInEditor,
    openStorageFileInEditor: handleOpenStorageFileInEditor,
    openWorkspaceFileInEditor: handleOpenFileInEditor,
    storageFileCopyPath,
    workspaceFileCopyPath,
  } = useSecondaryPanelFileOpeners({
    canOpenPreferredFileTarget,
    host: secondaryPanelHost,
    onOpenPreferredFallback: handleOpenPreferredWorkspace,
    openPathInPreferredFileTarget,
    storageRootPath: threadStorageRootPath,
    workspaceRootPath: workspacePreviewRootPath,
  });
  // Relative links inside a previewed markdown file resolve against the file's
  // own directory, mirroring how the file's links would resolve on disk.
  const workspaceFileLinkBaseDir = workspaceFileCopyPath
    ? getAbsoluteDirname({ path: workspaceFileCopyPath })
    : undefined;
  const storageFileLinkBaseDir = storageFileCopyPath
    ? getAbsoluteDirname({ path: storageFileCopyPath })
    : undefined;
  const hostFileLinkBaseDir = activeHostFilePath
    ? getAbsoluteDirname({ path: activeHostFilePath })
    : undefined;
  const hostFileLinkRootPath = resolveHostFilePreviewLinkRootPath({
    baseDir: hostFileLinkBaseDir,
    threadStorageRootPath,
    workspaceRootPath: workspacePreviewRootPath,
  });
  // Right-click local file links: per-open native app choices, optional
  // preview/plugin viewer choices, and utility copy actions. Left-click behavior
  // stays unchanged.
  const getLocalFileContextMenuItems = useCallback(
    (link: ThreadTimelineLocalFileLink) => {
      const extension = getFileExtension(link.path);
      const matching =
        extension === null
          ? []
          : pluginFileOpeners.filter((opener) =>
              opener.extensions.includes(extension),
            );
      const lineNumber = getFilePreviewLineRangeStart({
        lineRange: link.lineRange,
      });
      const openTargetItems = fileOpenTargets.map((target) => ({
        id: `open-target:${target.id}`,
        label: buildOpenTargetMenuItemLabel(target),
        onSelect: () => {
          void openPathInFileTarget({
            lineNumber,
            path: link.path,
            rememberTarget: false,
            targetId: target.id,
          });
        },
      }));
      const items: MarkdownLocalFileContextMenuItem[] = [];
      if (openTargetItems.length > 0) {
        items.push({
          id: "open-in",
          items: openTargetItems,
          label: "Open in",
          type: "submenu",
        });
      }
      if (matching.length > 0) {
        if (items.length > 0) {
          items.push({ id: "open-with-separator", type: "separator" });
        }
        items.push(
          {
            id: "builtin",
            label: "Open with built-in preview",
            onSelect: () => {
              handleOpenTimelineLocalFileLink(link, { viewer: "builtin" });
            },
          },
          ...matching.map((opener) => ({
            id: `${opener.pluginId}:${opener.id}`,
            label: `Open with ${opener.title}`,
            onSelect: () => {
              handleOpenTimelineLocalFileLink(link, {
                viewer: { pluginId: opener.pluginId, openerId: opener.id },
              });
            },
          })),
        );
      }
      if (items.length > 0) {
        items.push({ id: "copy-separator", type: "separator" });
      }
      items.push(
        {
          id: "copy-path",
          label: "Copy file path",
          onSelect: () => {
            void copyToClipboardWithToast(link.path, {
              successMessage: "File path copied",
              errorMessage: "Failed to copy file path",
            });
          },
        },
        {
          id: "copy-name",
          label: "Copy file name",
          onSelect: () => {
            void copyToClipboardWithToast(getLocalFileBasename(link.path), {
              successMessage: "File name copied",
              errorMessage: "Failed to copy file name",
            });
          },
        },
      );
      return items;
    },
    [
      fileOpenTargets,
      handleOpenTimelineLocalFileLink,
      openPathInFileTarget,
      pluginFileOpeners,
    ],
  );
  const workspaceMarkdownLinkRouting = useMemo(
    () =>
      buildMarkdownPreviewLinkRouting({
        baseDir: workspaceFileLinkBaseDir,
        onOpenLink: handleOpenTimelineLink,
        onOpenLocalFileLink: handleOpenTimelineLocalFileLink,
        rootPath: workspacePreviewRootPath,
      }),
    [
      handleOpenTimelineLink,
      handleOpenTimelineLocalFileLink,
      workspaceFileLinkBaseDir,
      workspacePreviewRootPath,
    ],
  );
  const hostMarkdownLinkRouting = useMemo(
    () =>
      buildMarkdownPreviewLinkRouting({
        baseDir: hostFileLinkBaseDir,
        onOpenLink: handleOpenTimelineLink,
        onOpenLocalFileLink: handleOpenTimelineLocalFileLink,
        rootPath: hostFileLinkRootPath,
      }),
    [
      handleOpenTimelineLink,
      handleOpenTimelineLocalFileLink,
      hostFileLinkBaseDir,
      hostFileLinkRootPath,
    ],
  );
  const storageMarkdownLinkRouting = useMemo(
    () =>
      buildMarkdownPreviewLinkRouting({
        baseDir: storageFileLinkBaseDir,
        onOpenLink: handleOpenTimelineLink,
        onOpenLocalFileLink: handleOpenTimelineLocalFileLink,
        rootPath: threadStorageRootPath,
      }),
    [
      handleOpenTimelineLink,
      handleOpenTimelineLocalFileLink,
      storageFileLinkBaseDir,
      threadStorageRootPath,
    ],
  );
  const handleOpenFilePreview = useCallback<OpenFilePreviewHandler>(
    (relativePath) => {
      openWorkspaceFile({
        lineRange: null,
        path: relativePath,
        source: { kind: "working-tree" },
        statusLabel: null,
      });
    },
    [openWorkspaceFile],
  );

  if (threadQueryState.status === "loading") {
    return (
      <PageShell contentClassName="min-h-full items-center justify-center">
        <p className="py-12 text-center text-sm text-muted-foreground">
          Loading...
        </p>
      </PageShell>
    );
  }
  if (!thread || thread.projectId !== projectId) {
    return (
      <PageShell contentClassName="min-h-full items-center justify-center">
        <p className="py-12 text-center text-sm text-destructive">
          {error ? "Failed to load thread." : "Not found"}
        </p>
      </PageShell>
    );
  }
  const canAssignToParent = isThreadRoot;
  const canTakeOverThread = Boolean(thread.parentThreadId);
  const threadEnvironmentDisplay = environment
    ? formatEnvironmentDisplay({
        environment,
        host: environmentDisplayHostContext,
      })
    : undefined;
  // The follow-up composer chip names the machine when the thread doesn't run
  // on the primary host ("Mac Studio · Worktree") — mirrors the new-thread
  // composer chip.
  const environmentMachinePrefix =
    threadEnvironmentHost !== null &&
    threadEnvironmentHost.id !==
      selectPrimaryHost(
        hostsQuery.data,
        systemConfigQuery.data?.primaryHostId ?? null,
      )?.id
      ? `${threadEnvironmentHost.name} · `
      : "";
  const threadEnvironmentIcon = threadEnvironmentDisplay
    ? getEnvironmentWorkspaceLabelIconName(
        threadEnvironmentDisplay.workspaceDisplayKind,
      )
    : null;
  const isThreadOnProvisionedWorktreeEnvironment =
    environment !== undefined &&
    environment.status === "ready" &&
    environment.path !== null &&
    (environment.isWorktree ||
      environment.workspaceProvisionType === "managed-worktree");
  const onCreateNewThreadInWorktree =
    isThreadOnProvisionedWorktreeEnvironment &&
    projectId &&
    thread.environmentId !== null
      ? createThreadInWorktree
      : undefined;
  const promptBannerMergeBaseBranch = effectiveMergeBaseBranch;
  const threadBranchName = workspaceBranch?.currentBranch ?? undefined;
  const threadCheckoutDisplay = workspaceStatus
    ? formatWorkspaceCheckoutDisplay({ checkout: workspaceStatus.checkout })
    : undefined;
  const isWorkspaceDeleted = environment?.status === "destroyed";
  // Decision B*: a thread whose environment is gone (being torn down or already
  // destroyed) is read-only — un-archive never resurrects it, so the composer is
  // replaced with the "environment is gone" banner instead of allowing a send.
  const threadEnvironmentGoneStatus =
    environment?.status === "destroying" || environment?.status === "destroyed"
      ? environment.status
      : null;
  const threadGitStatusDisplay = getGitStatusDisplay(workspaceStatus, {
    mergeBaseBranch,
    showBranchComparison: showBranchComparisonUi,
    error: workspaceStatusError,
    workspaceUnavailable,
    workspaceDeleted: isWorkspaceDeleted,
  });
  const threadTitle = getThreadDisplayTitle(thread);
  const responsiveWorkspaceActions: ThreadActionsMenuResponsiveAction[] =
    workspaceOpenPath && preferredDirectoryTarget
      ? [
          preferredDirectoryTarget,
          ...directoryOpenTargets.filter(
            (target) => target.id !== preferredDirectoryTarget.id,
          ),
        ].map((target) => ({
          icon: "FolderOpen" as const,
          label: `Open workspace in ${target.label}`,
          onSelect: async () => {
            if (target.id === preferredDirectoryTarget.id) {
              await openPathInPreferredDirectoryTarget({
                lineNumber: null,
                path: workspaceOpenPath,
              });
              return;
            }
            await openPathInDirectoryTarget({
              lineNumber: null,
              path: workspaceOpenPath,
              rememberTarget: true,
              targetId: target.id,
            });
          },
        }))
      : [];
  const responsiveGitActions: ThreadActionsMenuResponsiveAction[] =
    gitActions.threadHeaderGitActions.map((action) => ({
      icon: "GitBranch" as const,
      label: action.label,
      onSelect: () => {
        gitActions.threadGitActionDialog.onOpen(action.target);
      },
    }));
  const responsiveHeaderActions = [
    ...responsiveWorkspaceActions,
    ...responsiveGitActions,
  ];
  const workspaceOpenButton =
    workspaceOpenPath && preferredDirectoryTarget ? (
      <ThreadWorkspaceOpenButton
        preferredTarget={preferredDirectoryTarget}
        targets={directoryOpenTargets}
        onOpenPreferredTarget={async () => {
          await openPathInPreferredDirectoryTarget({
            lineNumber: null,
            path: workspaceOpenPath,
          });
        }}
        onOpenTarget={async (targetId) => {
          await openPathInDirectoryTarget({
            lineNumber: null,
            path: workspaceOpenPath,
            rememberTarget: true,
            targetId,
          });
        }}
      />
    ) : undefined;
  const timelineHeader = (
    <ThreadDetailHeader
      actionsMenu={(includeResponsiveActions) => (
        <ThreadActionsMenu
          thread={thread}
          triggerClassName={HEADER_ICON_BUTTON_CLASS}
          align="end"
          responsiveActions={
            includeResponsiveActions ? responsiveHeaderActions : undefined
          }
        />
      )}
      childPillLabel={
        isSideChatThread ? "side chat" : parentThreadId ? "child" : null
      }
      isSecondaryPanelOpen={isSecondaryPanelOpen}
      onClosePane={onRequestClose ?? undefined}
      onOpenThreadGitAction={gitActions.threadGitActionDialog.onOpen}
      onToggleSecondaryPanel={toggleSecondaryPanel}
      pluginActions={
        <PluginThreadHeaderActions
          threadId={thread.id}
          projectId={thread.projectId}
        />
      }
      threadHeaderGitActions={gitActions.threadHeaderGitActions}
      threadTitle={threadTitle}
      workspaceOpenButton={workspaceOpenButton}
    />
  );
  const composerFooter = (
    <ThreadDetailPromptArea
      activeBackgroundAgentCount={thread.activeBackgroundAgentCount}
      canUseGitUi={canUseGitUi}
      contextWindowUsage={contextWindowUsage}
      environmentCheckout={threadCheckoutDisplay}
      environmentCompactLabel={
        threadEnvironmentDisplay
          ? `${environmentMachinePrefix}${threadEnvironmentDisplay.compactModeLabel}`
          : undefined
      }
      environmentIcon={threadEnvironmentIcon ?? undefined}
      environmentLabel={
        threadEnvironmentDisplay
          ? `${environmentMachinePrefix}${threadEnvironmentDisplay.modeLabel}`
          : undefined
      }
      environmentGoneStatus={threadEnvironmentGoneStatus}
      isEnvironmentActionPending={requestEnvironmentAction.isPending}
      onCreateNewThreadInWorktree={onCreateNewThreadInWorktree}
      onEscapeEmptyPrompt={undefined}
      onPullRequestMerge={handlePullRequestMerge}
      onPullRequestDraft={handlePullRequestDraft}
      onPullRequestReady={handlePullRequestReady}
      pullRequestMergeMethod={pullRequestMergeMethod}
      onChangedFileClick={handleChangedFileClick}
      openThreadDiffPanel={openSecondaryPanelDiffPanel}
      projectId={projectId}
      resolveMentionLink={resolveMentionLink}
      workspaceChangedFilesSection={
        canUseGitUi ? workspaceChangedFilesSection : null
      }
      workspaceStatusPending={
        canUseGitUi && (environmentQuery.isLoading || workStatusQuery.isLoading)
      }
      contextBannerMergeBase={
        canUseGitUi && showMergeBase && promptBannerMergeBaseBranch
          ? {
              branch: promptBannerMergeBaseBranch,
              branchRef: selectedMergeBaseBranchRef,
              options: mergeBaseBranchOptions,
              remoteOptions: mergeBaseRemoteBranchOptions,
              optionsLoading: isLoadingMergeBaseBranchOptions,
              onChange: handleMergeBaseBranchChange,
              onPickerOpenChange: handleMergeBasePickerOpenChange,
              onSearchQueryChange: setMergeBaseBranchSearchQuery,
            }
          : null
      }
      composerFocusRequestNonce={composerFocusRequestNonce}
      sendMessage={sendMessage}
      sentMessageEdit={sentMessageEdit}
      steerActiveThreadOnEnter={
        systemConfigQuery.data?.generalSettings.steerActiveThreadOnEnter ??
        defaultAppSettings.steerActiveThreadOnEnter
      }
      pendingInteractions={pendingInteractions}
      pendingInteractionsInitialLoading={pendingInteractionsInitialLoading}
      pendingTodos={pendingTodos}
      activePromptMode={activePromptMode}
      goal={goal}
      modelFallback={modelFallback}
      activeWorkflows={activeWorkflows}
      activeBackgroundCommands={activeBackgroundCommands}
      parentThreadSection={parentThreadSection}
      childThreadsSection={childThreadsSection}
      pullRequest={pullRequest}
      thread={thread}
    />
  );
  const fileTabContent = (
    <SecondaryPanelHostContent
      host={secondaryPanelHost}
      terminal={{
        onOpenLink: handleOpenTimelineLink,
        onSelectionAddToChat: handleSelectionAddToChat,
        target: threadTerminalTarget,
      }}
      newTab={{
        projectId: projectId ?? undefined,
        environmentId: thread.environmentId ?? null,
        currentThreadId: thread.id,
        onSelect: handleSelectFileSearchResult,
        onOpenBrowser: handleOpenBrowser,
        onStartTerminal: canCreateTerminal
          ? handleStartTerminal
          : undefined,
        pluginActions: pluginPanelActions,
      }}
      workspaceFile={{
        copyPath: workspaceFileCopyPath,
        environmentId: thread.environmentId,
        markdownLinkRouting: workspaceMarkdownLinkRouting,
        onOpenInEditor: handleOpenFileInEditor,
        onSelectionAddToChat: handleSelectionAddToChat,
        threadId: thread.id,
      }}
      hostFile={{
        copyPath: activeHostFilePath ?? "",
        environmentId: thread.environmentId,
        markdownLinkRouting: hostMarkdownLinkRouting,
        onOpenInEditor: handleOpenHostFileInEditor,
        onSelectionAddToChat: handleSelectionAddToChat,
        threadId: thread.id,
      }}
      storageFile={{
        copyPath: storageFileCopyPath,
        markdownLinkRouting: storageMarkdownLinkRouting,
        onOpenInEditor: handleOpenStorageFileInEditor,
        onSelectionAddToChat: handleSelectionAddToChat,
        threadId: thread.id,
      }}
      renderPluginPanel={(tab) => (
        <ThreadTimelineNavigationProvider
          environmentId={thread.environmentId}
          onOpenLink={handleOpenTimelineLink}
          onOpenLocalFileLink={handleOpenTimelineLocalFileLink}
          resolveMentionLink={resolveMentionLink}
          workspaceRootPath={environment?.path ?? undefined}
        >
          <PluginPanelTabContent
            tab={tab}
            context={{ kind: "thread", threadId: thread.id }}
          />
        </ThreadTimelineNavigationProvider>
      )}
    />
  );
  const threadDetailContent = (
    <MarkdownLocalFileContextMenuContext.Provider
      value={getLocalFileContextMenuItems}
    >
      <UrlOpenRoutingProvider
        openInAppBrowser={
          canOpenUrlsInAppBrowser ? openBrowserTabAndReveal : null
        }
      >
        <ThreadDetailSecondaryContent
          footer={composerFooter}
          header={timelineHeader}
          isMetadataLoading={environmentQuery.isLoading}
          isSecondaryPanelOpen={isSecondaryPanelOpen}
          isConversationCollapsed={isConversationCollapsed}
          isBoundedPane={isBoundedPane}
          onToggleSecondaryPanel={toggleSecondaryPanel}
          onToggleConversationCollapse={toggleConversationCollapse}
          renderHostedPanel={(panel) => (
            <MarkdownLocalFileContextMenuContext.Provider
              value={getLocalFileContextMenuItems}
            >
              <UrlOpenRoutingProvider
                openInAppBrowser={
                  canOpenUrlsInAppBrowser ? openBrowserTabAndReveal : null
                }
              >
                {panel}
              </UrlOpenRoutingProvider>
            </MarkdownLocalFileContextMenuContext.Provider>
          )}
          metadata={{
            thread,
            projectId,
            parentThreadDisplayName: parentThreadDisplayName ?? null,
            parentThreads,
            canAssignToParent,
            canTakeOverThread,
            isLoadingParentThreads: parentThreadSubsetQuery.isLoading,
            isParentThreadsError: parentThreadSubsetQuery.isError,
            environment: environment ?? null,
            environmentDisplayHost: environmentDisplayHostContext,
            workspaceStatus,
            workspaceStatusError: workspaceStatusError ?? null,
            workspaceUnavailable,
            pullRequest,
            selectedMergeBaseBranch,
            mergeBaseBranchRef: selectedMergeBaseBranchRef,
            mergeBaseBranchOptions,
            mergeBaseRemoteBranchOptions,
            isLoadingMergeBaseBranchOptions,
            updateThreadPending:
              updateThread.isPending || updateEnvironment.isPending,
            storage: metadataStorage,
            onAssignParent: handleAssignParent,
            onParentSelectorOpenChange: handleParentSelectorOpenChange,
            onRetryParentThreads: handleRetryParentThreads,
            onMergeBaseBranchChange: handleMergeBaseBranchChange,
            onMergeBasePickerOpenChange: handleMergeBasePickerOpenChange,
            onMergeBaseBranchSearchQueryChange: setMergeBaseBranchSearchQuery,
            onChangedFileClick: canUseGitUi
              ? handleChangedFileClick
              : undefined,
            onCommitClick: canUseGitUi ? handleCommitClick : undefined,
          }}
          secondaryPanel={{
            ...secondaryPanelProps,
            canUseGitUi,
            fileTabContent,
            onClearPendingGitDiffIntent: clearPendingGitDiffIntent,
            onOpenFileInEditor: handleOpenFileInEditor,
            onOpenFilePreview: handleOpenFilePreview,
            onSelectionAddToChat: handleSelectionAddToChat,
            pendingGitDiffCommitSha,
            pendingGitDiffScrollPath,
            requestedMergeBaseBranch,
            showGitDiffTab: canUseGitUi,
          }}
          timeline={{
            activeThinking,
            canSpawnChild: thread.canSpawnChild,
            threadChildOrigin: threadOriginKind,
            hasOlderTimelineRows,
            hostConnectionNotice,
            isLoadingOlderTimelineRows,
            isThreadTimelinePending,
            timelineError: Boolean(timelineError),
            onForkMessage: isForkAvailable ? handleForkMessage : undefined,
            onEditMessage: canEditSentMessages
              ? handleEditSentMessage
              : undefined,
            inlineMessageEditor,
            onMessageAddToChat: handleSelectionAddToChat,
            onSendToMainMessage: handleSendToMainMessage,
            onSelectionAddToChat: handleSelectionAddToChat,
            onLoadOlderRows: loadOlderTimelineRows,
            onOpenLink: handleOpenTimelineLink,
            onOpenLocalFileLink: handleOpenTimelineLocalFileLink,
            onOpenPluginPanel: handleOpenTimelinePluginPanel,
            onTitleAction: handleTimelineTitleAction,
            projectId,
            resolveMentionLink,
            showOngoingIndicator:
              thread.status !== "stopping" &&
              // A pending interaction (question or approval) already renders its
              // own inline shimmer row, so the bottom indicator would just
              // duplicate it.
              !hasPendingInteraction &&
              isRunningThreadRuntimeDisplayStatus(
                thread.runtime.displayStatus,
              ) &&
              !isThreadTimelinePending,
            ongoingIndicatorLabel:
              thread.runtime.displayStatus === "host-reconnecting"
                ? "Waiting for reconnection"
                : undefined,
            timelineRows,
            isStopping: thread.status === "stopping",
            stoppingAnchorAt: thread.updatedAt,
            threadId: thread.id,
            threadRuntimeDisplayStatus: thread.runtime.displayStatus,
            unreadDividerAutoScroll: unreadDividerState.autoScroll,
            unreadDividerPlacement: unreadDividerState.placement,
            workspaceRootPath: environment?.path ?? undefined,
          }}
        />
        {canUseGitUi ? (
          <ThreadGitActionDialog
            target={gitActions.threadGitActionDialog.target}
            branchName={threadBranchName}
            gitStatusDisplay={threadGitStatusDisplay}
            changedFilesSection={workingTreeChangedFilesSection}
            showMergeBaseDetails={showBranchComparisonUi}
            mergeBaseBranch={effectiveMergeBaseBranch}
            mergeBaseBranchOptions={mergeBaseBranchOptions}
            mergeBaseBranchRef={selectedMergeBaseBranchRef}
            mergeBaseRemoteBranchOptions={mergeBaseRemoteBranchOptions}
            mergeBaseBranchOptionsLoading={isLoadingMergeBaseBranchOptions}
            onMergeBaseBranchSearchQueryChange={setMergeBaseBranchSearchQuery}
            onMergeBaseBranchChange={
              showBranchComparisonUi ? handleMergeBaseBranchChange : undefined
            }
            onOpenChange={(open) => {
              if (!open) {
                gitActions.threadGitActionDialog.onClose();
              }
            }}
            onCommit={gitActions.handleCommitThread}
            onSquashMerge={gitActions.handleSquashMergeThread}
          />
        ) : null}
      </UrlOpenRoutingProvider>
    </MarkdownLocalFileContextMenuContext.Provider>
  );
  return (
    <>
      <SecondaryPanelCommandHandlers
        host={secondaryPanelHost}
        onOpenPreferred={handleOpenPreferred}
        onToggleDiff={handleToggleDiff}
      />
      <ThreadArchiveCommandHandler thread={thread} />
      <ThreadRenameCommandHandler thread={thread} />
      <PluginThreadPanelNavigationProvider
        openThreadPanel={handleOpenTimelinePluginPanel}
      >
        {threadDetailContent}
      </PluginThreadPanelNavigationProvider>
    </>
  );
}
