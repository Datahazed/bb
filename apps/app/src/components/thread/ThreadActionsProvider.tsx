import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAtom } from "jotai";
import { useNavigate } from "react-router-dom";
import { appToast } from "@/components/ui/app-toast";
import { defaultExperiments, type Thread } from "@bb/domain";
import {
  useArchiveThreadAndChildren,
  useDeleteThread,
  useMarkThreadRead,
  useMarkThreadUnread,
  usePinThread,
  useUnarchiveThread,
  useUnpinThread,
  useUpdateThread,
} from "@/hooks/mutations/thread-state-mutations";
import { getThreadChildSummary } from "@/lib/api";
import { useRouteState } from "@/hooks/useRouteState";
import { useDialogState } from "@/hooks/useDialogState";
import {
  getMutationErrorMessage,
  shouldShowMutationErrorToast,
} from "@/lib/mutation-errors";
import { getThreadDisplayTitle } from "@/lib/thread-title";
import {
  ThreadRenameDialog,
  type ThreadRenameDialogTarget,
} from "@/components/dialogs/ThreadRenameDialog";
import { FolderOnboardingDialog } from "@/components/dialogs/FolderOnboardingDialog";
import {
  formatFolderPathLabel,
  normalizeThreadTitle,
  parseThreadFolderPath,
  titleCreatesFolder,
} from "@/components/sidebar/folderPath";
import {
  folderOnboardingSeenAtom,
  sidebarGroupByAtom,
} from "@/components/sidebar/sidebarCollapsedAtoms";
import {
  ThreadDeleteDialog,
  type ThreadDeleteDialogTarget,
} from "@/components/dialogs/ThreadDeleteDialog";
import { ArchivedThreadToastTitle } from "@/components/thread/ArchivedThreadToastTitle";
import { destroyPersistedBrowserViewsForThread } from "@/components/secondary-panel/browserViewVisibilityCoordinator";
import { getThreadReadToggleAction } from "@/components/sidebar/threadReadState";
import {
  getRootComposeRoutePath,
  getThreadRoutePath,
} from "@/lib/route-paths";
import { getDesktopBrowserApi, getDesktopPopoutApi } from "@/lib/bb-desktop";
import { useSetRootComposeProjectId } from "@/lib/root-compose-selection";
import { useSystemConfig } from "@/hooks/queries/system-queries";

export interface ThreadActionsContextValue {
  archiveThreadAndChildren: (thread: Thread) => void;
  requestRename: (thread: Thread) => void;
  requestDelete: (thread: Thread) => void;
  sendToPopout: ((thread: Thread) => void) | null;
  unarchiveThread: (thread: Thread) => void;
  togglePin: (thread: Thread) => void;
  toggleRead: (thread: Thread) => void;
}

const ThreadActionsContext = createContext<ThreadActionsContextValue | null>(
  null,
);

export function useThreadActions(): ThreadActionsContextValue {
  const value = useContext(ThreadActionsContext);
  if (!value) {
    throw new Error(
      "useThreadActions must be used within a <ThreadActionsProvider>",
    );
  }
  return value;
}

interface ThreadActionsProviderProps {
  children: ReactNode;
}

interface DeleteThreadActionRequest {
  childThreadsConfirmed: boolean;
  closeDialog: () => void;
  thread: Thread;
}

interface ThreadActionContext {
  childThreadCount: number;
}

// Full breadcrumb segments for the first-folder modal preview
// ("Work › Q3 › Planning"): the folder ancestors plus the leaf.
function folderPreviewSegments(title: string): string[] {
  const { folders, leaf } = parseThreadFolderPath(title);
  return [...folders, leaf];
}

export function ThreadActionsProvider({
  children,
}: ThreadActionsProviderProps) {
  const navigate = useNavigate();
  const setRootComposeProjectId = useSetRootComposeProjectId();
  const { threadId: viewedThreadId } = useRouteState();
  const archiveThreadAndChildrenMutation = useArchiveThreadAndChildren();
  const unarchiveThreadMutation = useUnarchiveThread();
  const markThreadRead = useMarkThreadRead();
  const markThreadUnread = useMarkThreadUnread();
  const pinThread = usePinThread();
  const unpinThread = useUnpinThread();
  const deleteThread = useDeleteThread();
  const updateThread = useUpdateThread();
  const systemConfigQuery = useSystemConfig();
  const threadActionContextAbortRef = useRef<AbortController | null>(null);
  // Destructure `.mutate` so useCallback deps see stable references across
  // renders. Depending on the full mutation objects would churn callback
  // identities on every isPending flip and force every useThreadActions()
  // consumer to re-render whenever any mutation fires.
  const { mutate: archiveThreadAndChildrenMutate } =
    archiveThreadAndChildrenMutation;
  const { mutate: unarchiveMutate } = unarchiveThreadMutation;
  const { mutate: markReadMutate } = markThreadRead;
  const { mutate: markUnreadMutate } = markThreadUnread;
  const { mutate: pinMutate } = pinThread;
  const { mutate: unpinMutate } = unpinThread;
  const { mutate: deleteMutate } = deleteThread;
  const { mutate: updateMutate } = updateThread;

  const renameDialog = useDialogState<ThreadRenameDialogTarget>();
  const deleteDialog = useDialogState<ThreadDeleteDialogTarget>();

  const { onClose: closeRenameDialog, onOpen: openRenameDialog } = renameDialog;
  const { onClose: closeDeleteDialog, onOpen: openDeleteDialog } = deleteDialog;

  // The rename draft is lifted here (not local to the dialog) so it survives a
  // rename → first-folder modal → rename round trip.
  const [renameDraft, setRenameDraft] = useState("");
  const [renameValidationError, setRenameValidationError] = useState<
    string | null
  >(null);
  // Stashed rename awaiting first-folder confirmation; null when the modal is
  // closed. Holds the raw draft so a decline can reopen rename unchanged.
  const [pendingFolderRename, setPendingFolderRename] = useState<{
    threadId: string;
    draft: string;
  } | null>(null);
  const [folderOnboardingSeen, setFolderOnboardingSeen] = useAtom(
    folderOnboardingSeenAtom,
  );
  const [groupBy, setGroupBy] = useAtom(sidebarGroupByAtom);

  useEffect(() => {
    return () => {
      threadActionContextAbortRef.current?.abort();
      threadActionContextAbortRef.current = null;
    };
  }, []);

  const navigateAwayIfViewing = useCallback(
    (thread: Thread) => {
      if (viewedThreadId === thread.id) {
        setRootComposeProjectId(thread.projectId);
        // Push (not replace) so the back button still returns the user to the
        // archived/deleted thread's URL if they want to re-open it.
        navigate(getRootComposeRoutePath());
      }
    },
    [navigate, setRootComposeProjectId, viewedThreadId],
  );

  const requestRename = useCallback(
    (thread: Thread) => {
      // Seed from the raw stored title (not the display fallback) so an
      // untitled thread never parses "Thread xxxx" as a folder path.
      setRenameDraft(thread.title ?? "");
      setRenameValidationError(null);
      openRenameDialog({ id: thread.id });
    },
    [openRenameDialog],
  );

  const handleRenameDraftChange = useCallback((value: string) => {
    setRenameDraft(value);
    setRenameValidationError(null);
  }, []);

  const submitRename = useCallback(() => {
    const target = renameDialog.target;
    if (!target) return;
    const normalized = normalizeThreadTitle(renameDraft);
    if (!normalized) {
      setRenameValidationError("Thread name cannot be empty.");
      return;
    }
    // First time a rename creates a folder: stash and teach via the modal
    // before submitting. Afterwards (seen === true) slash renames submit directly.
    if (titleCreatesFolder(normalized) && !folderOnboardingSeen) {
      setPendingFolderRename({ threadId: target.id, draft: renameDraft });
      closeRenameDialog();
      return;
    }
    updateMutate(
      { id: target.id, title: normalized },
      { onSuccess: () => closeRenameDialog() },
    );
  }, [
    closeRenameDialog,
    folderOnboardingSeen,
    renameDialog.target,
    renameDraft,
    updateMutate,
  ]);

  const handleFolderOnboardingConfirm = useCallback(() => {
    if (!pendingFolderRename) return;
    const { threadId, draft } = pendingFolderRename;
    updateMutate(
      { id: threadId, title: normalizeThreadTitle(draft) },
      {
        onSuccess: () => {
          setFolderOnboardingSeen(true);
          // Auto-enable folder grouping once, so the new folder is visible.
          if (groupBy === "none") {
            setGroupBy("folder");
          }
          setPendingFolderRename(null);
        },
      },
    );
  }, [
    groupBy,
    pendingFolderRename,
    setFolderOnboardingSeen,
    setGroupBy,
    updateMutate,
  ]);

  const handleFolderOnboardingCancel = useCallback(() => {
    if (!pendingFolderRename) return;
    // Reopen rename seeded from the stashed draft; seen stays false so the
    // modal still teaches on a later attempt.
    setRenameDraft(pendingFolderRename.draft);
    setRenameValidationError(null);
    openRenameDialog({ id: pendingFolderRename.threadId });
    setPendingFolderRename(null);
  }, [openRenameDialog, pendingFolderRename]);

  const handleFolderOnboardingOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        handleFolderOnboardingCancel();
      }
    },
    [handleFolderOnboardingCancel],
  );

  // Fetches the delete dialog context. Returns null when the caller's request
  // was superseded (a newer click aborted us) or the fetch errored; in the
  // error case, also surfaces a toast before returning.
  const loadThreadActionContext = useCallback(
    async (
      thread: Thread,
      signal: AbortSignal,
    ): Promise<ThreadActionContext | null> => {
      try {
        const childSummary = await getThreadChildSummary(thread.id, signal);
        if (signal.aborted) return null;

        return {
          childThreadCount: childSummary?.nonDeletedChildCount ?? 0,
        };
      } catch (error) {
        if (signal.aborted) return null;
        if (shouldShowMutationErrorToast(error)) {
          appToast.error(
            getMutationErrorMessage({
              error,
              fallbackMessage: "Failed to check thread state",
            }),
          );
        }
        return null;
      }
    },
    [],
  );

  const claimThreadActionContextAbortController =
    useCallback((): AbortController => {
      threadActionContextAbortRef.current?.abort();
      const controller = new AbortController();
      threadActionContextAbortRef.current = controller;
      return controller;
    }, []);

  function buildDialogTargetFromContext<T extends { thread: Thread }>(
    base: T,
    context: ThreadActionContext,
  ): T & { childThreadCount?: number } {
    return {
      ...base,
      ...(context.childThreadCount > 0
        ? { childThreadCount: context.childThreadCount }
        : {}),
    };
  }

  const performDelete = useCallback(
    ({
      childThreadsConfirmed,
      closeDialog,
      thread,
    }: DeleteThreadActionRequest) => {
      deleteMutate(
        { id: thread.id, childThreadsConfirmed },
        {
          onSuccess: () => {
            destroyPersistedBrowserViewsForThread({
              desktopBrowser: getDesktopBrowserApi(),
              threadId: thread.id,
            });
            closeDialog();
            navigateAwayIfViewing(thread);
          },
        },
      );
    },
    [deleteMutate, navigateAwayIfViewing],
  );

  const requestDelete = useCallback(
    async (thread: Thread) => {
      const controller = claimThreadActionContextAbortController();
      const context = await loadThreadActionContext(thread, controller.signal);
      if (context === null || controller.signal.aborted) return;
      if (threadActionContextAbortRef.current === controller) {
        threadActionContextAbortRef.current = null;
      }
      openDeleteDialog(buildDialogTargetFromContext({ thread }, context));
    },
    [
      claimThreadActionContextAbortController,
      loadThreadActionContext,
      openDeleteDialog,
    ],
  );

  const confirmDelete = useCallback(
    (target: ThreadDeleteDialogTarget) => {
      performDelete({
        childThreadsConfirmed: target.childThreadCount !== undefined,
        closeDialog: closeDeleteDialog,
        thread: target.thread,
      });
    },
    [closeDeleteDialog, performDelete],
  );

  const unarchiveThreadAction = useCallback(
    (thread: Thread) => {
      unarchiveMutate({ id: thread.id });
    },
    [unarchiveMutate],
  );

  const archiveThreadAndChildrenAction = useCallback(
    (thread: Thread) => {
      archiveThreadAndChildrenMutate(
        { id: thread.id },
        {
          onSuccess: (response) => {
            if (
              viewedThreadId &&
              response.archivedThreadIds.includes(viewedThreadId)
            ) {
              setRootComposeProjectId(thread.projectId);
              navigate(getRootComposeRoutePath());
            }
            const toastId = `thread-archived-${thread.id}`;
            appToast.success(
              <ArchivedThreadToastTitle
                archivedThreadCount={response.archivedThreadIds.length}
                threadTitle={getThreadDisplayTitle(thread)}
                onOpenThread={() => {
                  navigate(
                    getThreadRoutePath({
                      projectId: thread.projectId,
                      threadId: thread.id,
                    }),
                  );
                  appToast.dismiss(toastId);
                }}
              />,
              { id: toastId },
            );
          },
          onError: (error) => {
            appToast.error(
              getMutationErrorMessage({
                error,
                fallbackMessage: "Failed to archive thread and children",
                lifecycleOperation: "archive_thread",
              }),
            );
          },
        },
      );
    },
    [
      archiveThreadAndChildrenMutate,
      navigate,
      setRootComposeProjectId,
      viewedThreadId,
    ],
  );

  const toggleRead = useCallback(
    (thread: Thread) => {
      if (getThreadReadToggleAction(thread) === "mark_unread") {
        markUnreadMutate(thread.id, {
          onError: (error) => {
            appToast.error(
              getMutationErrorMessage({
                error,
                fallbackMessage: "Failed to mark thread unread",
              }),
            );
          },
        });
        return;
      }
      markReadMutate(thread.id, {
        onError: (error) => {
          appToast.error(
            getMutationErrorMessage({
              error,
              fallbackMessage: "Failed to mark thread read",
            }),
          );
        },
      });
    },
    [markReadMutate, markUnreadMutate],
  );

  const togglePin = useCallback(
    (thread: Thread) => {
      if (thread.pinnedAt !== null) {
        unpinMutate({ id: thread.id });
        return;
      }
      pinMutate({ id: thread.id });
    },
    [pinMutate, unpinMutate],
  );

  const experiments = systemConfigQuery.data?.experiments ?? defaultExperiments;
  const desktopPopout = getDesktopPopoutApi();
  const sendToPopout = useMemo<ThreadActionsContextValue["sendToPopout"]>(() => {
    if (!experiments.popoutChat || desktopPopout === null) {
      return null;
    }
    return (thread) => {
      desktopPopout.setThread({
        projectId: thread.projectId,
        threadId: thread.id,
      });
    };
  }, [desktopPopout, experiments.popoutChat]);

  const value = useMemo<ThreadActionsContextValue>(
    () => ({
      requestRename,
      requestDelete,
      archiveThreadAndChildren: archiveThreadAndChildrenAction,
      sendToPopout,
      unarchiveThread: unarchiveThreadAction,
      togglePin,
      toggleRead,
    }),
    [
      archiveThreadAndChildrenAction,
      requestRename,
      requestDelete,
      sendToPopout,
      togglePin,
      toggleRead,
      unarchiveThreadAction,
    ],
  );

  return (
    <ThreadActionsContext.Provider value={value}>
      {children}
      <ThreadRenameDialog
        target={renameDialog.target}
        draft={renameDraft}
        validationMessage={renameValidationError}
        pending={updateThread.isPending}
        onDraftChange={handleRenameDraftChange}
        onSubmit={submitRename}
        onOpenChange={renameDialog.onOpenChange}
      />
      <FolderOnboardingDialog
        open={pendingFolderRename !== null}
        pathLabel={
          pendingFolderRename
            ? formatFolderPathLabel(
                folderPreviewSegments(pendingFolderRename.draft),
              )
            : ""
        }
        showGroupingHint={groupBy === "none"}
        pending={updateThread.isPending}
        onConfirm={handleFolderOnboardingConfirm}
        onCancel={handleFolderOnboardingCancel}
        onOpenChange={handleFolderOnboardingOpenChange}
      />
      <ThreadDeleteDialog
        target={deleteDialog.target}
        pending={deleteThread.isPending}
        onOpenChange={deleteDialog.onOpenChange}
        onDelete={confirmDelete}
      />
    </ThreadActionsContext.Provider>
  );
}
