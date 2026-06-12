import type { QueryClient } from "@tanstack/react-query";
import type { ThreadListEntry, ThreadWithRuntime } from "@bb/domain";
import type {
  ProjectResponse,
  ReorderPinnedThreadRequest,
} from "@bb/server-contract";
import { applyNeighborReorder } from "@/lib/neighbor-reorder";
import {
  projectsQueryKey,
  sidebarNavigationQueryKey,
  threadQueryKey,
  threadsQueryKey,
} from "../queries/query-keys";
import { removeEnvironmentScopedQueries } from "./environment-cache-effects";
import {
  invalidateThreadDeleteQueries,
  invalidateThreadListMembershipQueries,
  invalidateThreadListQueries,
  removeThreadScopedQueries,
} from "./mutation-cache-effects";
import {
  applyToCachedThreadListsAndSidebarNavigation,
  restoreCachedSidebarNavigation,
  snapshotCachedSidebarNavigation,
  type CachedSidebarNavigationSnapshot,
} from "./query-cache";
import {
  restoreCachedThreadLists,
  snapshotCachedThreadLists,
  type CachedThreadListSnapshot,
} from "./thread-list-cache-data";

interface ThreadIdCacheArgs {
  queryClient: QueryClient;
  threadId: string;
}

interface ThreadRuntimeCacheArgs {
  queryClient: QueryClient;
  thread: ThreadWithRuntime;
}

interface ThreadPinSuccessArgs extends ThreadRuntimeCacheArgs {
  pinSortKey: string | null;
}

interface BeginThreadPinTransactionArgs extends ThreadIdCacheArgs {
  pinnedAt: number;
}

interface ReorderPinnedThreadTransactionRequest extends ReorderPinnedThreadRequest {
  id: string;
}

interface ReorderPinnedThreadTransactionArgs {
  queryClient: QueryClient;
  request: ReorderPinnedThreadTransactionRequest;
}

interface PinnedThreadResponseArgs {
  orderedThreads: readonly ThreadListEntry[];
  queryClient: QueryClient;
}

interface PinnedThreadOrderListArgs {
  list: ThreadListEntry[];
  request: ReorderPinnedThreadTransactionRequest;
}

interface RollbackThreadListMutationTransactionArgs extends ThreadIdCacheArgs {
  transaction: ThreadListMutationTransaction | undefined;
}

interface RollbackPinnedThreadOrderTransactionArgs {
  queryClient: QueryClient;
  transaction: PinnedThreadOrderTransaction | undefined;
}

interface DeleteThreadTransactionArgs extends ThreadIdCacheArgs {}

interface RollbackDeleteThreadTransactionArgs extends ThreadIdCacheArgs {
  transaction: DeleteThreadTransaction | undefined;
}

interface SettleDeleteThreadTransactionArgs extends ThreadIdCacheArgs {
  transaction: DeleteThreadTransaction | undefined;
}

export interface ThreadListMutationTransaction {
  previousSidebarNavigation: CachedSidebarNavigationSnapshot;
  previousThread: ThreadWithRuntime | undefined;
  previousThreadLists: CachedThreadListSnapshot;
}

export interface PinnedThreadOrderTransaction {
  previousSidebarNavigation: CachedSidebarNavigationSnapshot;
  previousThreadLists: CachedThreadListSnapshot;
}

export interface DeleteThreadTransaction {
  environmentId: string | null | undefined;
  previousProjects: ProjectResponse[] | undefined;
  previousSidebarNavigation: CachedSidebarNavigationSnapshot;
  previousThread: ThreadWithRuntime | undefined;
  previousThreadLists: CachedThreadListSnapshot;
}

function removeThreadFromLists(queryClient: QueryClient, id: string): void {
  applyToCachedThreadListsAndSidebarNavigation(queryClient, (list) =>
    list.filter((thread) => thread.id !== id),
  );
}

function updateThreadInLists({
  queryClient,
  thread,
}: ThreadRuntimeCacheArgs): void {
  const updateThread = (list: ThreadListEntry[]) =>
    list.map((candidate) =>
      candidate.id === thread.id ? { ...candidate, ...thread } : candidate,
    );
  applyToCachedThreadListsAndSidebarNavigation(queryClient, updateThread);
}

function updateThreadPinStateInLists({
  pinSortKey,
  queryClient,
  thread,
}: ThreadPinSuccessArgs): void {
  applyToCachedThreadListsAndSidebarNavigation(queryClient, (list) =>
    list.map((candidate) =>
      candidate.id === thread.id
        ? { ...candidate, ...thread, pinSortKey }
        : candidate,
    ),
  );
}

function applyPinnedThreadResponseToLists({
  orderedThreads,
  queryClient,
}: PinnedThreadResponseArgs): void {
  const threadsById = new Map(
    orderedThreads.map((thread) => [thread.id, thread]),
  );
  applyToCachedThreadListsAndSidebarNavigation(queryClient, (list) =>
    list.map((candidate) => threadsById.get(candidate.id) ?? candidate),
  );
}

function applyPinnedThreadOrderToList({
  list,
  request,
}: PinnedThreadOrderListArgs): ThreadListEntry[] {
  const pinnedThreads = list.filter(
    (thread) => thread.pinnedAt !== null && thread.pinSortKey !== null,
  );
  const reorderedThreads = applyNeighborReorder({
    items: pinnedThreads,
    request: {
      itemId: request.id,
      previousItemId: request.previousThreadId,
      nextItemId: request.nextThreadId,
    },
  });
  const reorderedThreadKeysById = new Map(
    reorderedThreads.map((thread, index) => [
      thread.id,
      pinnedThreads[index]?.pinSortKey ?? thread.pinSortKey,
    ]),
  );
  return list.map((thread) => {
    const pinSortKey = reorderedThreadKeysById.get(thread.id);
    return pinSortKey === undefined ? thread : { ...thread, pinSortKey };
  });
}

function applyOptimisticPinnedThreadOrder({
  queryClient,
  request,
}: ReorderPinnedThreadTransactionArgs): void {
  applyToCachedThreadListsAndSidebarNavigation(queryClient, (list) =>
    applyPinnedThreadOrderToList({ list, request }),
  );
}

export function applyThreadUpdateResult({
  queryClient,
  thread,
}: ThreadRuntimeCacheArgs): void {
  queryClient.setQueryData<ThreadWithRuntime>(
    threadQueryKey(thread.id),
    thread,
  );
  invalidateThreadListQueries({ queryClient });
}

interface OptimisticThreadFieldTransactionArgs extends ThreadIdCacheArgs {
  patch: Partial<ThreadWithRuntime>;
  applyToLists: (queryClient: QueryClient, threadId: string) => void;
}

async function runOptimisticThreadFieldTransaction({
  applyToLists,
  patch,
  queryClient,
  threadId,
}: OptimisticThreadFieldTransactionArgs): Promise<ThreadListMutationTransaction> {
  await queryClient.cancelQueries({ queryKey: threadQueryKey(threadId) });
  await queryClient.cancelQueries({ queryKey: threadsQueryKey() });
  await queryClient.cancelQueries({ queryKey: sidebarNavigationQueryKey() });

  const previousThread = queryClient.getQueryData<ThreadWithRuntime>(
    threadQueryKey(threadId),
  );
  const previousThreadLists = snapshotCachedThreadLists(queryClient, {
    queryKey: threadsQueryKey(),
  });
  const previousSidebarNavigation =
    snapshotCachedSidebarNavigation(queryClient);

  queryClient.setQueryData<ThreadWithRuntime>(
    threadQueryKey(threadId),
    (thread) => {
      if (!thread) {
        return thread;
      }

      return {
        ...thread,
        ...patch,
      };
    },
  );
  applyToLists(queryClient, threadId);

  return {
    previousSidebarNavigation,
    previousThread,
    previousThreadLists,
  };
}

export function beginPinThreadTransaction({
  pinnedAt,
  queryClient,
  threadId,
}: BeginThreadPinTransactionArgs): Promise<ThreadListMutationTransaction> {
  return runOptimisticThreadFieldTransaction({
    applyToLists: (queryClient, threadId) =>
      applyToCachedThreadListsAndSidebarNavigation(queryClient, (list) =>
        list.map((thread) =>
          thread.id === threadId
            ? { ...thread, pinnedAt, pinSortKey: null }
            : thread,
        ),
      ),
    patch: { pinnedAt },
    queryClient,
    threadId,
  });
}

export function beginUnpinThreadTransaction({
  queryClient,
  threadId,
}: ThreadIdCacheArgs): Promise<ThreadListMutationTransaction> {
  return runOptimisticThreadFieldTransaction({
    applyToLists: (queryClient, threadId) =>
      applyToCachedThreadListsAndSidebarNavigation(queryClient, (list) =>
        list.map((thread) =>
          thread.id === threadId
            ? { ...thread, pinnedAt: null, pinSortKey: null }
            : thread,
        ),
      ),
    patch: { pinnedAt: null },
    queryClient,
    threadId,
  });
}

export function rollbackThreadListMutationTransaction({
  queryClient,
  threadId,
  transaction,
}: RollbackThreadListMutationTransactionArgs): void {
  if (!transaction) {
    return;
  }

  queryClient.setQueryData(
    threadQueryKey(threadId),
    transaction.previousThread,
  );
  restoreCachedThreadLists(queryClient, transaction.previousThreadLists);
  restoreCachedSidebarNavigation(
    queryClient,
    transaction.previousSidebarNavigation,
  );
}

export function applyThreadPinStateResult({
  pinSortKey,
  queryClient,
  thread,
}: ThreadPinSuccessArgs): void {
  queryClient.setQueryData<ThreadWithRuntime>(
    threadQueryKey(thread.id),
    thread,
  );
  updateThreadPinStateInLists({ queryClient, thread, pinSortKey });
}

export function settleThreadListMembershipMutation({
  queryClient,
  threadId,
}: ThreadIdCacheArgs): void {
  invalidateThreadListMembershipQueries({ queryClient, threadId });
}

export async function beginReorderPinnedThreadTransaction({
  queryClient,
  request,
}: ReorderPinnedThreadTransactionArgs): Promise<PinnedThreadOrderTransaction> {
  await queryClient.cancelQueries({ queryKey: threadsQueryKey() });
  await queryClient.cancelQueries({ queryKey: sidebarNavigationQueryKey() });
  const previousThreadLists = snapshotCachedThreadLists(queryClient, {
    queryKey: threadsQueryKey(),
  });
  const previousSidebarNavigation =
    snapshotCachedSidebarNavigation(queryClient);
  applyOptimisticPinnedThreadOrder({ queryClient, request });
  return { previousSidebarNavigation, previousThreadLists };
}

export function rollbackReorderPinnedThreadTransaction({
  queryClient,
  transaction,
}: RollbackPinnedThreadOrderTransactionArgs): void {
  if (!transaction) {
    return;
  }
  restoreCachedThreadLists(queryClient, transaction.previousThreadLists);
  restoreCachedSidebarNavigation(
    queryClient,
    transaction.previousSidebarNavigation,
  );
}

export function applyReorderPinnedThreadResult({
  orderedThreads,
  queryClient,
}: PinnedThreadResponseArgs): void {
  applyPinnedThreadResponseToLists({ orderedThreads, queryClient });
}

export function beginArchiveThreadTransaction({
  queryClient,
  threadId,
}: ThreadIdCacheArgs): Promise<ThreadListMutationTransaction> {
  return runOptimisticThreadFieldTransaction({
    applyToLists: removeThreadFromLists,
    patch: { archivedAt: Date.now() },
    queryClient,
    threadId,
  });
}

export function beginUnarchiveThreadTransaction({
  queryClient,
  threadId,
}: ThreadIdCacheArgs): Promise<ThreadListMutationTransaction> {
  return runOptimisticThreadFieldTransaction({
    applyToLists: removeThreadFromLists,
    patch: { archivedAt: null },
    queryClient,
    threadId,
  });
}

export async function beginDeleteThreadTransaction({
  queryClient,
  threadId,
}: DeleteThreadTransactionArgs): Promise<DeleteThreadTransaction> {
  await queryClient.cancelQueries({ queryKey: threadQueryKey(threadId) });
  await queryClient.cancelQueries({ queryKey: threadsQueryKey() });
  await queryClient.cancelQueries({ queryKey: sidebarNavigationQueryKey() });
  await queryClient.cancelQueries({ queryKey: projectsQueryKey() });

  const previousThread = queryClient.getQueryData<ThreadWithRuntime>(
    threadQueryKey(threadId),
  );
  const previousThreadLists = snapshotCachedThreadLists(queryClient, {
    queryKey: threadsQueryKey(),
  });
  const previousSidebarNavigation =
    snapshotCachedSidebarNavigation(queryClient);
  const previousProjects =
    queryClient.getQueryData<ProjectResponse[]>(projectsQueryKey());
  const environmentId = previousThread?.environmentId;

  removeThreadScopedQueries({ queryClient, threadId });
  removeEnvironmentScopedQueries({ environmentId, queryClient });
  removeThreadFromLists(queryClient, threadId);

  return {
    environmentId,
    previousSidebarNavigation,
    previousThread,
    previousThreadLists,
    previousProjects,
  };
}

export function rollbackDeleteThreadTransaction({
  queryClient,
  threadId,
  transaction,
}: RollbackDeleteThreadTransactionArgs): void {
  if (!transaction) {
    return;
  }

  queryClient.setQueryData(
    threadQueryKey(threadId),
    transaction.previousThread,
  );
  restoreCachedThreadLists(queryClient, transaction.previousThreadLists);
  restoreCachedSidebarNavigation(
    queryClient,
    transaction.previousSidebarNavigation,
  );
  queryClient.setQueryData(projectsQueryKey(), transaction.previousProjects);
}

export function settleDeleteThreadTransaction({
  queryClient,
  threadId,
  transaction,
}: SettleDeleteThreadTransactionArgs): void {
  removeThreadScopedQueries({ queryClient, threadId });
  removeEnvironmentScopedQueries({
    environmentId: transaction?.environmentId,
    queryClient,
  });
  invalidateThreadDeleteQueries({ queryClient });
}

export function applyThreadReadStateResult({
  queryClient,
  thread,
}: ThreadRuntimeCacheArgs): void {
  queryClient.setQueryData<ThreadWithRuntime>(
    threadQueryKey(thread.id),
    thread,
  );
  updateThreadInLists({ queryClient, thread });
}
