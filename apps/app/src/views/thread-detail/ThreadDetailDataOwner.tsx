import { resolveEnvironmentMergeBaseBranch } from "@bb/domain";
import type {
  ThreadResponse,
  ThreadWithIncludesResponse,
} from "@bb/server-contract";
import {
  useEnvironment,
  useEnvironmentPullRequest,
  useEnvironmentWorkStatus,
} from "@/hooks/queries/environment-queries";
import { useThreadComposerBootstrap } from "@/hooks/queries/thread-composer-bootstrap-query";
import {
  useThreadPendingInteractions,
  useThreadSchedules,
  useThreadStorageFiles,
  useThreadTimelineFeed,
  useThreads,
} from "@/hooks/queries/thread-queries";
import { useThreadTerminals } from "@/hooks/queries/thread-terminal-queries";
import { DEFAULT_THREAD_STORAGE_FILE_LIST_OPTIONS } from "@/lib/thread-storage-files";
import { resolveThreadComposerBootstrapReady } from "./threadDetailComposerBootstrapState";

const THREAD_DETAIL_DATA_OWNER_STALE_TIME_MS = 10_000;

interface ThreadDetailDataOwnerProps {
  bootstrapThread?: ThreadWithIncludesResponse;
  cachedThread?: ThreadResponse;
  enabled: boolean;
  hasThreadDetailBootstrapSettled: boolean;
  projectId?: string;
  threadId?: string;
}

export function ThreadDetailDataOwner({
  bootstrapThread,
  cachedThread,
  enabled,
  hasThreadDetailBootstrapSettled,
  projectId,
  threadId,
}: ThreadDetailDataOwnerProps) {
  const routeThreadId = threadId ?? "";
  const bootstrapThreadForRoute =
    bootstrapThread?.id === routeThreadId ? bootstrapThread : undefined;
  const cachedThreadForRoute =
    cachedThread?.id === routeThreadId ? cachedThread : undefined;
  const thread = bootstrapThreadForRoute ?? cachedThreadForRoute;
  const activeThreadId = thread?.id ?? "";
  const activeProjectId = thread?.projectId ?? projectId;
  const environmentId = thread?.environmentId ?? undefined;
  const canLoadThreadData =
    enabled && hasThreadDetailBootstrapSettled && Boolean(activeThreadId);

  const environmentQuery = useEnvironment(environmentId, {
    enabled: canLoadThreadData && Boolean(environmentId),
    staleTime: THREAD_DETAIL_DATA_OWNER_STALE_TIME_MS,
  });
  const environment =
    environmentQuery.data ?? bootstrapThreadForRoute?.environment;
  const canUseGitUi = canLoadThreadData && environment?.isGitRepo === true;
  const environmentMergeBaseBranch =
    resolveEnvironmentMergeBaseBranch(environment);

  const threadComposerBootstrapQuery = useThreadComposerBootstrap(
    activeThreadId,
    {
      enabled: canLoadThreadData,
      environmentId,
      providerId: thread?.providerId,
    },
  );
  const hasThreadComposerBootstrapData =
    threadComposerBootstrapQuery.data !== undefined;
  const hasThreadComposerBootstrapReady = resolveThreadComposerBootstrapReady({
    hasData: hasThreadComposerBootstrapData,
    isError: threadComposerBootstrapQuery.isError,
    isFetching: threadComposerBootstrapQuery.isFetching,
    isSuccess: threadComposerBootstrapQuery.isSuccess,
  });

  useThreads(
    {
      archived: false,
      projectId: activeProjectId,
    },
    {
      enabled: canLoadThreadData && Boolean(activeProjectId),
    },
  );
  useThreadTimelineFeed(activeThreadId, {
    enabled: canLoadThreadData,
    staleTime: Infinity,
  });
  useThreadSchedules(activeThreadId, {
    enabled: canLoadThreadData,
    staleTime: THREAD_DETAIL_DATA_OWNER_STALE_TIME_MS,
  });
  useThreadStorageFiles(
    activeThreadId,
    DEFAULT_THREAD_STORAGE_FILE_LIST_OPTIONS,
    {
      enabled: canLoadThreadData,
      staleTime: THREAD_DETAIL_DATA_OWNER_STALE_TIME_MS,
    },
  );
  useThreadTerminals(activeThreadId, {
    enabled: canLoadThreadData,
    staleTime: THREAD_DETAIL_DATA_OWNER_STALE_TIME_MS,
  });
  useThreadPendingInteractions(activeThreadId, {
    enabled: hasThreadComposerBootstrapReady,
    staleTime: hasThreadComposerBootstrapData
      ? THREAD_DETAIL_DATA_OWNER_STALE_TIME_MS
      : undefined,
  });
  useEnvironmentWorkStatus(environmentId, environmentMergeBaseBranch, {
    enabled: canUseGitUi && environment !== undefined,
  });
  useEnvironmentPullRequest(environmentId, {
    enabled: canUseGitUi && environment !== undefined,
  });

  return null;
}
