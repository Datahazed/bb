import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";
import { appToast } from "@/components/ui/app-toast";
import { defaultExperiments, type Thread } from "@bb/domain";
import {
  useArchiveThread,
  useDeleteThread,
  useMarkThreadRead,
  useMarkThreadUnread,
  usePinThread,
  useUnarchiveThread,
  useUnpinThread,
  useUpdateThread,
} from "@/hooks/mutations/thread-state-mutations";
import { useRouteState } from "@/hooks/useRouteState";
import { useDialogState } from "@/hooks/useDialogState";
import { getMutationErrorMessage } from "@/lib/mutation-errors";
import { getThreadDisplayTitle } from "@/lib/thread-title";
import {
  ThreadRenameDialog,
  type ThreadRenameDialogTarget,
} from "@/components/dialogs/ThreadRenameDialog";
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
  archiveThread: (thread: Thread) => void;
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

export function ThreadActionsProvider({
  children,
}: ThreadActionsProviderProps) {
  const navigate = useNavigate();
  const setRootComposeProjectId = useSetRootComposeProjectId();
  const { threadId: viewedThreadId } = useRouteState();
  const archiveThreadMutation = useArchiveThread();
  const unarchiveThreadMutation = useUnarchiveThread();
  const markThreadRead = useMarkThreadRead();
  const markThreadUnread = useMarkThreadUnread();
  const pinThread = usePinThread();
  const unpinThread = useUnpinThread();
  const deleteThread = useDeleteThread();
  const updateThread = useUpdateThread();
  const systemConfigQuery = useSystemConfig();
  // Destructure `.mutate` so useCallback deps see stable references across
  // renders. Depending on the full mutation objects would churn callback
  // identities on every isPending flip and force every useThreadActions()
  // consumer to re-render whenever any mutation fires.
  const { mutate: archiveThreadMutate } = archiveThreadMutation;
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
      openRenameDialog({
        id: thread.id,
        currentTitle: getThreadDisplayTitle(thread),
      });
    },
    [openRenameDialog],
  );

  const submitRename = useCallback(
    (threadId: string, title: string) => {
      updateMutate(
        { id: threadId, title },
        {
          onSuccess: () => {
            closeRenameDialog();
          },
        },
      );
    },
    [closeRenameDialog, updateMutate],
  );

  const confirmDelete = useCallback(
    (target: ThreadDeleteDialogTarget) => {
      const { thread } = target;
      deleteMutate(
        { id: thread.id },
        {
          onSuccess: () => {
            destroyPersistedBrowserViewsForThread({
              desktopBrowser: getDesktopBrowserApi(),
              threadId: thread.id,
            });
            closeDeleteDialog();
            navigateAwayIfViewing(thread);
          },
        },
      );
    },
    [closeDeleteDialog, deleteMutate, navigateAwayIfViewing],
  );

  const requestDelete = useCallback(
    (thread: Thread) => {
      openDeleteDialog({ thread });
    },
    [openDeleteDialog],
  );

  const unarchiveThreadAction = useCallback(
    (thread: Thread) => {
      unarchiveMutate({ id: thread.id });
    },
    [unarchiveMutate],
  );

  const archiveThreadAction = useCallback(
    (thread: Thread) => {
      archiveThreadMutate(
        { id: thread.id },
        {
          onSuccess: () => {
            if (viewedThreadId === thread.id) {
              setRootComposeProjectId(thread.projectId);
              navigate(getRootComposeRoutePath());
            }
            const toastId = `thread-archived-${thread.id}`;
            appToast.success(
              <ArchivedThreadToastTitle
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
                fallbackMessage: "Failed to archive thread",
                lifecycleOperation: "archive_thread",
              }),
            );
          },
        },
      );
    },
    [archiveThreadMutate, navigate, setRootComposeProjectId, viewedThreadId],
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
      archiveThread: archiveThreadAction,
      sendToPopout,
      unarchiveThread: unarchiveThreadAction,
      togglePin,
      toggleRead,
    }),
    [
      archiveThreadAction,
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
        pending={updateThread.isPending}
        onOpenChange={renameDialog.onOpenChange}
        onRename={submitRename}
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
