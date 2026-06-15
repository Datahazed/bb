import { resolveEnvironmentMergeBaseBranch } from "@bb/domain";
import type {
  TimelineFeedDetailPart,
  TimelineFeedRow,
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
  useThreadTimelineRowDetail,
  useThreadSchedules,
  useThreadStorageFiles,
  useThreadTimelineFeed,
  useThreads,
} from "@/hooks/queries/thread-queries";
import { useThreadTerminals } from "@/hooks/queries/thread-terminal-queries";
import { DEFAULT_THREAD_STORAGE_FILE_LIST_OPTIONS } from "@/lib/thread-storage-files";
import { resolveThreadComposerBootstrapReady } from "./threadDetailComposerBootstrapState";

const THREAD_DETAIL_DATA_OWNER_STALE_TIME_MS = 10_000;
const EMPTY_TIMELINE_DETAIL_PARTS: readonly TimelineFeedDetailPart[] = [];

interface ThreadDetailDataOwnerProps {
  bootstrapThread?: ThreadWithIncludesResponse;
  cachedThread?: ThreadResponse;
  enabled: boolean;
  hasThreadDetailBootstrapSettled: boolean;
  projectId?: string;
  threadId?: string;
}

interface ThreadTimelineRowDetailDataOwnerProps {
  row: TimelineFeedRow;
  threadId: string;
}

function initialTimelineRowDetailParts(
  row: TimelineFeedRow,
): readonly TimelineFeedDetailPart[] {
  if (row.detail === null) {
    return EMPTY_TIMELINE_DETAIL_PARTS;
  }

  const availableParts = new Set(row.detail.parts);
  const parts: TimelineFeedDetailPart[] = [];
  const includePart = (part: TimelineFeedDetailPart): void => {
    if (availableParts.has(part)) {
      parts.push(part);
    }
  };

  switch (row.kind) {
    case "conversation":
      includePart("text");
      break;
    case "bundle-summary":
    case "step-summary":
      includePart("children");
      break;
    case "system":
      includePart("system-detail");
      break;
    case "work":
      if (row.workKind === "delegation") {
        includePart("children");
        includePart("output");
      }
      break;
    case "turn":
      break;
  }

  return parts.length > 0 ? parts : EMPTY_TIMELINE_DETAIL_PARTS;
}

function ThreadTimelineRowDetailDataOwner({
  row,
  threadId,
}: ThreadTimelineRowDetailDataOwnerProps) {
  useThreadTimelineRowDetail({
    detail: row.detail,
    parts: initialTimelineRowDetailParts(row),
    threadId,
  });

  return null;
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
  const timelineFeedQuery = useThreadTimelineFeed(activeThreadId, {
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

  return (
    <>
      {timelineFeedQuery.data?.rows.map((row) => (
        <ThreadTimelineRowDetailDataOwner
          key={row.key}
          row={row}
          threadId={activeThreadId}
        />
      ))}
    </>
  );
}
