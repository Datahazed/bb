import { useMemo } from "react";
import type { ProviderInfo, ThreadListEntry } from "@bb/domain";
import { RouteAnchor } from "@/components/ui/app-route-anchor";
import { ThreadStatusGlyph } from "@/components/sidebar/ThreadRow";
import { SIDEBAR_WORKING_STATUS_COLOR_CLASS } from "@/components/sidebar/sidebarRowClasses";
import { CHROME_SECTION_LABEL_CLASS } from "@bb/shared-ui/chrome-style-tokens";
import {
  COARSE_POINTER_ICON_SIZE_CLASS,
  COARSE_POINTER_TEXT_BASE_CLASS,
  COARSE_POINTER_TEXT_SM_CLASS,
} from "@bb/shared-ui/coarse-pointer-sizing";
import { Icon } from "@bb/shared-ui/icon";
import { OverflowFade } from "@/components/ui/overflow-fade";
import { getThreadRoutePath, isProjectlessProjectId } from "@/lib/route-paths";
import {
  hasActiveBackgroundAgentActivity,
  hasActiveBackgroundCommandActivity,
  hasActiveGoalActivity,
  hasActivePlanModeActivity,
  hasActiveWorkflowActivity,
  getThreadListIndicatorLabel,
  isRuntimeBusyThread,
  isUnreadDoneThread,
  resolveThreadListIndicator,
  type ThreadListIndicatorState,
} from "@bb/client-core";
import { getThreadDisplayTitle } from "@/lib/thread-title";
import { formatRelativeTime } from "@/lib/relative-time";
import { getEnvironmentWorkspaceDisplayIconName } from "@/lib/environment-workspace-display";
import { getProviderIconInfo } from "@/lib/provider-icon";
import { ProviderIconMark } from "@/components/settings/ProviderIconMark";
import { cn } from "@bb/shared-ui/lib/utils";
import { usePromptDraftHasInput } from "@/hooks/usePromptDraftStorage";

export const MOBILE_RECENT_ROW_HEIGHT_PX = 60;
export const MOBILE_RECENT_LABEL_HEIGHT_PX = 24;

const MOBILE_RECENT_ROW_HEIGHT_CLASS = "h-15";

type ThreadListEntryComparator = (
  left: ThreadListEntry,
  right: ThreadListEntry,
) => number;

interface GetMobileRecentThreadsArgs {
  highlightedThreadId: string | null;
  threads: readonly ThreadListEntry[];
}

interface MobileRecentThreadRowProps {
  highlighted: boolean;
  projectName: string | null;
  provider: ProviderInfo | null;
  thread: ThreadListEntry;
}

function getMobileRecentThreadMetadata({
  projectName,
  thread,
}: {
  projectName: string | null;
  thread: ThreadListEntry;
}): string {
  const workspaceName = thread.environmentBranchName ?? thread.environmentName;
  return [
    projectName,
    workspaceName,
    formatRelativeTime({
      timestamp: thread.latestAttentionAt,
      now: Date.now(),
    }),
  ]
    .filter((part): part is string => part !== null && part.length > 0)
    .join(" \u00b7 ");
}

interface RootComposeMobileRecentsProps {
  highlightedThreadId: string | null;
  projectNamesById: ReadonlyMap<string, string>;
  providersById: ReadonlyMap<string, ProviderInfo>;
  showCreatingRow: boolean;
  threads: readonly ThreadListEntry[];
}

const compareMobileRecentThreads: ThreadListEntryComparator = (left, right) => {
  const latestAttentionAtDelta =
    right.latestAttentionAt - left.latestAttentionAt;
  if (latestAttentionAtDelta !== 0) {
    return latestAttentionAtDelta;
  }

  const createdAtDelta = right.createdAt - left.createdAt;
  if (createdAtDelta !== 0) {
    return createdAtDelta;
  }

  return left.id.localeCompare(right.id);
};

export function getMobileRecentThreads({
  highlightedThreadId,
  threads,
}: GetMobileRecentThreadsArgs): ThreadListEntry[] {
  const sortedThreads = [...threads].sort(compareMobileRecentThreads);
  if (highlightedThreadId === null) {
    return sortedThreads;
  }

  const highlightedThread = sortedThreads.find(
    (thread) => thread.id === highlightedThreadId,
  );
  if (!highlightedThread) {
    return sortedThreads;
  }

  return [
    highlightedThread,
    ...sortedThreads.filter((thread) => thread.id !== highlightedThreadId),
  ];
}

function MobileRecentThreadRow({
  highlighted,
  projectName,
  provider,
  thread,
}: MobileRecentThreadRowProps) {
  const threadTitle = getThreadDisplayTitle(thread);
  const isUnreadDone = isUnreadDoneThread(thread);
  const isUnreadError = isUnreadDone && thread.status === "error";
  const hasUnsubmittedDraft = usePromptDraftHasInput({
    kind: "thread",
    projectId: thread.projectId,
    threadId: thread.id,
  });
  const indicatorState: ThreadListIndicatorState = {
    hasPendingInteraction: thread.hasPendingInteraction,
    hasUnsubmittedDraft,
    hasUnreadError: isUnreadError,
    hasUnreadSuccess: isUnreadDone && !isUnreadError,
    isBackgroundAgentActive: hasActiveBackgroundAgentActivity(thread),
    isBackgroundCommandActive: hasActiveBackgroundCommandActivity(thread),
    isGoalActive: hasActiveGoalActivity(thread),
    isPlanModeActive: hasActivePlanModeActivity(thread),
    isRuntimeActive: isRuntimeBusyThread(thread),
    isWorkflowActive: hasActiveWorkflowActivity(thread),
  };
  const indicatorKind = resolveThreadListIndicator(indicatorState);
  const indicatorLabel = getThreadListIndicatorLabel(indicatorKind);
  const metadataText = getMobileRecentThreadMetadata({ projectName, thread });
  const workspaceIconName = getEnvironmentWorkspaceDisplayIconName(
    thread.environmentWorkspaceDisplayKind,
  );
  const providerIcon = getProviderIconInfo(thread.providerId, provider);
  const ProviderMark = providerIcon?.icon;
  return (
    <li>
      {}
      <RouteAnchor
        href={getThreadRoutePath({
          projectId: thread.projectId,
          threadId: thread.id,
        })}
        aria-label={`Open ${threadTitle}${indicatorLabel ? ` — ${indicatorLabel}` : ""}`}
        className={cn(
          "flex items-center gap-2.5 rounded-md px-2 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          MOBILE_RECENT_ROW_HEIGHT_CLASS,
          highlighted && "bg-surface-selected",
        )}
      >
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border-seam bg-surface-raised">
          {ProviderMark === undefined ? null : provider === null ? (
            <ProviderMark className="size-4" />
          ) : (
            <ProviderIconMark
              provider={provider}
              icon={ProviderMark}
              className="size-4"
            />
          )}
        </span>
        <span className="min-w-0 flex-1 space-y-0.5">
          <span
            className={cn(
              "block min-w-0 truncate font-medium",
              COARSE_POINTER_TEXT_BASE_CLASS,
            )}
          >
            {threadTitle}
          </span>
          <span
            className={cn(
              "flex min-w-0 items-center gap-1.5 leading-4 text-muted-foreground",
              COARSE_POINTER_TEXT_SM_CLASS,
            )}
            title={metadataText}
          >
            {workspaceIconName ? (
              <Icon
                name={workspaceIconName}
                className="size-3.5 shrink-0"
                aria-hidden="true"
              />
            ) : null}
            <span className="min-w-0 truncate">{metadataText}</span>
          </span>
        </span>
        {indicatorKind !== "none" ? (
          <span className="flex size-6 shrink-0 items-center justify-center">
            <ThreadStatusGlyph {...indicatorState} />
          </span>
        ) : null}
      </RouteAnchor>
    </li>
  );
}

export function RootComposeMobileRecents({
  highlightedThreadId,
  projectNamesById,
  providersById,
  showCreatingRow,
  threads,
}: RootComposeMobileRecentsProps) {
  const recentThreads = useMemo(
    () => getMobileRecentThreads({ highlightedThreadId, threads }),
    [highlightedThreadId, threads],
  );

  if (!showCreatingRow && recentThreads.length === 0) {
    return null;
  }

  return (
    <section
      data-root-compose-mobile-recents=""
      aria-labelledby="root-compose-mobile-recents"
      className="md:hidden"
    >
      <div className="sticky top-0 z-10 mb-1 bg-background px-2">
        <h2
          id="root-compose-mobile-recents"
          className={CHROME_SECTION_LABEL_CLASS}
        >
          Recent
        </h2>
        <OverflowFade placement="below" tone="background" size="sm" />
      </div>
      {showCreatingRow ? (
        <div
          role="status"
          className={cn(
            "flex items-center gap-2.5 rounded-md px-2 text-sm text-muted-foreground",
            MOBILE_RECENT_ROW_HEIGHT_CLASS,
          )}
        >
          <span className="min-w-0 flex-1 truncate">Creating thread</span>
          <span className="flex size-6 shrink-0 items-center justify-center">
            <Icon
              name="Loading"
              className={cn(
                "shrink-0 animate-spin",
                SIDEBAR_WORKING_STATUS_COLOR_CLASS,
                COARSE_POINTER_ICON_SIZE_CLASS,
              )}
              aria-hidden="true"
            />
          </span>
        </div>
      ) : null}
      {recentThreads.length > 0 ? (
        <ul className="space-y-px">
          {recentThreads.map((thread) => (
            <MobileRecentThreadRow
              key={thread.id}
              highlighted={thread.id === highlightedThreadId}
              provider={providersById.get(thread.providerId) ?? null}
              projectName={
                isProjectlessProjectId(thread.projectId)
                  ? null
                  : (projectNamesById.get(thread.projectId) ?? null)
              }
              thread={thread}
            />
          ))}
        </ul>
      ) : null}
    </section>
  );
}
