import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  ReorderPinnedThreadRequest,
  ThreadArchiveAllResponse,
  ThreadResponse,
  UpdateThreadRequest,
} from "@bb/server-contract";
import * as api from "@/lib/api";
import { appToast } from "@/components/ui/app-toast";
import type { LifecycleErrorOperation } from "@/lib/lifecycle-errors";
import {
  applyReorderPinnedThreadResult,
  applyThreadPinStateResult,
  applyThreadReadStateResult,
  applyThreadUpdateResult,
  beginArchiveThreadAndChildrenTransaction,
  beginArchiveThreadTransaction,
  beginDeleteThreadTransaction,
  beginPinThreadTransaction,
  beginThreadReadStateTransaction,
  beginThreadTitleTransaction,
  beginReorderPinnedThreadTransaction,
  beginUnarchiveThreadTransaction,
  beginUnpinThreadTransaction,
  rollbackArchiveThreadsTransaction,
  rollbackDeleteThreadTransaction,
  rollbackReorderPinnedThreadTransaction,
  rollbackThreadListMutationTransaction,
  settleArchiveThreadsTransaction,
  settleDeleteThreadTransaction,
  settleThreadListMembershipMutation,
  type ArchiveThreadsTransaction,
  type DeleteThreadTransaction,
  type PinnedThreadOrderTransaction,
  type ThreadListMutationTransaction,
} from "../cache-owners/thread-state-cache-owner";

interface ThreadMutationRequest {
  id: string;
}

/**
 * How long the "Thread archived — Undo" toast stays up. Matches the server's
 * archive grace window (`MANAGED_ENVIRONMENT_RETIRE_GRACE_MS`), within which an
 * Undo revives the environment losslessly (its worktree has not been destroyed
 * yet). After it elapses the durable Unarchive in the read-only banner remains.
 */
const ARCHIVE_UNDO_TOAST_DURATION_MS = 10_000;

type UpdateThreadMutationRequest = ThreadMutationRequest & UpdateThreadRequest;
type ReorderPinnedThreadMutationRequest = ThreadMutationRequest &
  ReorderPinnedThreadRequest;

interface UpdateThreadMutationOptions {
  errorMessage?: string | undefined;
  lifecycleOperation?: LifecycleErrorOperation | undefined;
}

interface ArchiveThreadMutationRequest {
  id: string;
}

interface ArchiveThreadAndChildrenMutationRequest {
  id: string;
}

interface DeleteThreadMutationRequest {
  id: string;
  childThreadsConfirmed: boolean;
}

export function useUpdateThread(options?: UpdateThreadMutationOptions) {
  const queryClient = useQueryClient();

  return useMutation<
    ThreadResponse,
    Error,
    UpdateThreadMutationRequest,
    ThreadListMutationTransaction | undefined
  >({
    meta: {
      errorMessage: options?.errorMessage ?? "Failed to update thread.",
      ...(options?.lifecycleOperation
        ? { lifecycleOperation: options.lifecycleOperation }
        : {}),
    },
    mutationFn: ({ id, ...request }: UpdateThreadMutationRequest) =>
      api.updateThread(id, request),
    onMutate: ({
      id,
      title,
    }): Promise<ThreadListMutationTransaction | undefined> | undefined => {
      if (title === undefined) {
        return undefined;
      }

      return beginThreadTitleTransaction({
        queryClient,
        threadId: id,
        title,
      });
    },
    onError: (_error, variables, context) => {
      rollbackThreadListMutationTransaction({
        queryClient,
        threadId: variables.id,
        transaction: context,
      });
    },
    onSuccess: (thread) => {
      applyThreadUpdateResult({ queryClient, thread });
    },
  });
}

export function usePinThread() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to pin thread.",
    },
    mutationFn: ({ id }: ThreadMutationRequest) => api.pinThread(id),
    onMutate: async ({ id }): Promise<ThreadListMutationTransaction> =>
      beginPinThreadTransaction({
        pinnedAt: Date.now(),
        queryClient,
        threadId: id,
      }),
    onError: (_error, variables, context) => {
      rollbackThreadListMutationTransaction({
        queryClient,
        threadId: variables.id,
        transaction: context,
      });
    },
    onSuccess: (thread) => {
      applyThreadPinStateResult({ queryClient, thread, pinSortKey: null });
    },
    onSettled: (_data, _error, variables) => {
      settleThreadListMembershipMutation({
        queryClient,
        threadId: variables.id,
      });
    },
  });
}

export function useUnpinThread() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to unpin thread.",
    },
    mutationFn: ({ id }: ThreadMutationRequest) => api.unpinThread(id),
    onMutate: async ({ id }): Promise<ThreadListMutationTransaction> =>
      beginUnpinThreadTransaction({ queryClient, threadId: id }),
    onError: (_error, variables, context) => {
      rollbackThreadListMutationTransaction({
        queryClient,
        threadId: variables.id,
        transaction: context,
      });
    },
    onSuccess: (thread) => {
      applyThreadPinStateResult({ queryClient, thread, pinSortKey: null });
    },
    onSettled: (_data, _error, variables) => {
      settleThreadListMembershipMutation({
        queryClient,
        threadId: variables.id,
      });
    },
  });
}

export function useReorderPinnedThread() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to reorder pinned threads.",
      showErrorToast: false,
    },
    mutationFn: ({
      id,
      previousThreadId,
      nextThreadId,
    }: ReorderPinnedThreadMutationRequest) =>
      api.reorderPinnedThread(id, {
        previousThreadId,
        nextThreadId,
      }),
    onMutate: async (request): Promise<PinnedThreadOrderTransaction> =>
      beginReorderPinnedThreadTransaction({ queryClient, request }),
    onError: (_error, _variables, context) => {
      rollbackReorderPinnedThreadTransaction({
        queryClient,
        transaction: context,
      });
    },
    onSuccess: (orderedRoots) => {
      applyReorderPinnedThreadResult({ orderedRoots, queryClient });
    },
  });
}

export function useArchiveThread() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to archive thread.",
      lifecycleOperation: "archive_thread",
      showErrorToast: false,
    },
    mutationFn: ({ id }: ArchiveThreadMutationRequest) => api.archiveThread(id),
    onMutate: async ({ id }): Promise<ThreadListMutationTransaction> =>
      beginArchiveThreadTransaction({ queryClient, threadId: id }),
    onError: (_error, variables, context) => {
      rollbackThreadListMutationTransaction({
        queryClient,
        threadId: variables.id,
        transaction: context,
      });
    },
    onSuccess: (_data, { id }) => {
      // Offer a quick, lossless Undo while the environment is still inside its
      // grace window: un-archiving revives a retiring environment in place
      // (retire.cancelled), so the worktree and uncommitted work are preserved.
      appToast.message("Thread archived", {
        action: {
          label: "Undo",
          onClick: () => {
            void api.unarchiveThread(id).then(() => {
              settleThreadListMembershipMutation({ queryClient, threadId: id });
            });
          },
        },
        duration: ARCHIVE_UNDO_TOAST_DURATION_MS,
      });
    },
    onSettled: (_data, _error, variables) => {
      settleThreadListMembershipMutation({
        queryClient,
        threadId: variables.id,
      });
    },
  });
}

export function useArchiveThreadAndChildren() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to archive thread and children.",
      lifecycleOperation: "archive_thread",
      showErrorToast: false,
    },
    mutationFn: ({
      id,
    }: ArchiveThreadAndChildrenMutationRequest): Promise<ThreadArchiveAllResponse> =>
      api.archiveThreadAndChildren(id),
    onMutate: async ({ id }): Promise<ArchiveThreadsTransaction> =>
      beginArchiveThreadAndChildrenTransaction({
        queryClient,
        threadId: id,
      }),
    onError: (_error, _variables, context) => {
      rollbackArchiveThreadsTransaction({ queryClient, transaction: context });
    },
    onSettled: (data, _error, _variables, context) => {
      settleArchiveThreadsTransaction({
        queryClient,
        response: data,
        transaction: context,
      });
    },
  });
}

export function useUnarchiveThread() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to unarchive thread.",
    },
    mutationFn: ({ id }: ThreadMutationRequest) => api.unarchiveThread(id),
    onMutate: async ({ id }): Promise<ThreadListMutationTransaction> =>
      beginUnarchiveThreadTransaction({ queryClient, threadId: id }),
    onError: (_error, variables, context) => {
      rollbackThreadListMutationTransaction({
        queryClient,
        threadId: variables.id,
        transaction: context,
      });
    },
    onSettled: (_data, _error, variables) => {
      settleThreadListMembershipMutation({
        queryClient,
        threadId: variables.id,
      });
    },
  });
}

export function useRestoreThreadEnvironment() {
  return useMutation({
    meta: {
      errorMessage: "Failed to restore environment.",
    },
    mutationFn: ({ id }: ThreadMutationRequest) =>
      api.restoreThreadEnvironment(id),
    // The server reprovisions a fresh environment and re-seeds the thread; the
    // resulting thread/environment changes arrive over the realtime channel, so
    // no optimistic cache mutation is needed here.
  });
}

export function useDeleteThread() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to delete thread.",
    },
    mutationFn: ({ childThreadsConfirmed, id }: DeleteThreadMutationRequest) =>
      api.deleteThread(id, { childThreadsConfirmed }),
    onMutate: async ({ id }): Promise<DeleteThreadTransaction> =>
      beginDeleteThreadTransaction({ queryClient, threadId: id }),
    onError: (_error, variables, context) => {
      rollbackDeleteThreadTransaction({
        queryClient,
        threadId: variables.id,
        transaction: context,
      });
    },
    onSettled: (_data, _error, variables, context) => {
      settleDeleteThreadTransaction({
        queryClient,
        threadId: variables.id,
        transaction: context,
      });
    },
  });
}

export function useMarkThreadRead() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to mark thread read.",
      showErrorToast: false,
    },
    mutationFn: (threadId: string) => api.markThreadRead(threadId),
    onMutate: (threadId): Promise<ThreadListMutationTransaction> =>
      beginThreadReadStateTransaction({
        lastReadAt: Date.now(),
        queryClient,
        threadId,
      }),
    onError: (_error, threadId, context) => {
      rollbackThreadListMutationTransaction({
        queryClient,
        threadId,
        transaction: context,
      });
    },
    onSuccess: (thread) => {
      applyThreadReadStateResult({ queryClient, thread });
    },
  });
}

export function useMarkThreadUnread() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to mark thread unread.",
      showErrorToast: false,
    },
    mutationFn: (threadId: string) => api.markThreadUnread(threadId),
    onMutate: (threadId): Promise<ThreadListMutationTransaction> =>
      beginThreadReadStateTransaction({
        lastReadAt: null,
        queryClient,
        threadId,
      }),
    onError: (_error, threadId, context) => {
      rollbackThreadListMutationTransaction({
        queryClient,
        threadId,
        transaction: context,
      });
    },
    onSuccess: (thread) => {
      applyThreadReadStateResult({ queryClient, thread });
    },
  });
}
