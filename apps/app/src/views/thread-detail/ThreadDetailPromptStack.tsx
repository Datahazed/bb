import { memo, useCallback, useMemo, useState, type ReactNode } from "react";
import type {
  EnvironmentStatus,
  ThreadPullRequest,
  ThreadTimelineModelFallback,
  ThreadTimelinePendingTodos,
  ThreadWithRuntime,
} from "@bb/domain";
import type {
  PullRequestMergeMethod,
  TimelineWorkflowWorkRow,
} from "@bb/server-contract";
import type { PromptMentionLinkResolver } from "@/components/promptbox/editor/prompt-mention-link";
import {
  ThreadPromptContextBanner,
  type ContextBannerMergeBaseConfig,
  type ThreadPromptContextBannerExpandedSection,
  type ThreadPromptChildThreadsSection,
  type ThreadPromptParentThreadSection,
  type ThreadPromptPullRequestSection,
} from "@/components/promptbox/banner/ThreadPromptContextBanner";
import { ThreadTodoCard } from "@/components/promptbox/banner/ThreadTodoCard";
import { ThreadWorkflowCard } from "@/components/promptbox/banner/ThreadWorkflowCard";
import { ThreadBackgroundCommandsCard } from "@/components/promptbox/banner/ThreadBackgroundCommandsCard";
import { ThreadModelFallbackCard } from "@/components/promptbox/banner/ThreadModelFallbackCard";
import {
  QueuedMessagesList,
  type QueuedMessagesListProps,
} from "@/components/promptbox/banner/QueuedMessagesList";
import type {
  WorkspaceChangedFileSelection,
  WorkspaceChangedFilesSection,
} from "@/components/workspace/workspace-change-summary";
import { useUnarchiveThread } from "@/hooks/mutations/thread-state-mutations";

const ignorePromptBannerFileClick = () => {};

export interface ThreadDetailPromptStackProps {
  activeBackgroundCommands: TimelineWorkflowWorkRow[];
  activeWorkflows: TimelineWorkflowWorkRow[];
  /** Goal card element built by the area (shared with the pending-interaction branch). */
  activeGoalCard: ReactNode;
  /** Prompt-mode card element built by the area (shared with the pending-interaction branch). */
  activePromptModeCard: ReactNode;
  archivedAt: ThreadWithRuntime["archivedAt"];
  canUseGitUi: boolean;
  /** Pending permission/question banners from delegated child threads. */
  childPendingInteractionBanners: ReactNode;
  childThreadsSection: ThreadPromptChildThreadsSection | null;
  contextBannerMergeBase: ContextBannerMergeBaseConfig | null;
  environmentGoneStatus: Extract<
    EnvironmentStatus,
    "destroying" | "destroyed"
  > | null;
  isEnvironmentActionPending: boolean;
  modelFallback: ThreadTimelineModelFallback | null;
  onChangedFileClick: (selection: WorkspaceChangedFileSelection) => void;
  onPullRequestDraft?: () => void;
  onPullRequestMerge?: (method: PullRequestMergeMethod) => void;
  onPullRequestReady?: () => void;
  parentThreadSection: ThreadPromptParentThreadSection | null;
  pendingTodos: ThreadTimelinePendingTodos | null;
  pullRequest: ThreadPullRequest | null;
  pullRequestMergeMethod: PullRequestMergeMethod;
  /** Null hides the queue (archived thread, environment gone). */
  queue: ThreadDetailPromptStackQueue | null;
  resolveMentionLink: PromptMentionLinkResolver;
  threadId: string;
  workspaceChangedFilesSection: WorkspaceChangedFilesSection | null;
  workspaceStatusPending: boolean;
}

export type ThreadDetailPromptStackQueue = Omit<
  QueuedMessagesListProps,
  "resolveMentionLink"
>;

/**
 * The context cards, banner and queued-message list stacked above the thread
 * composer, with their expand/collapse state. Memoized so a keystroke (which
 * never reaches here) or an unrelated prompt-area render does not rebuild the
 * cards, and so toggling a card re-renders this subtree only.
 */
export const ThreadDetailPromptStack = memo(function ThreadDetailPromptStack({
  activeBackgroundCommands,
  activeWorkflows,
  activeGoalCard,
  activePromptModeCard,
  archivedAt,
  canUseGitUi,
  childPendingInteractionBanners,
  childThreadsSection,
  contextBannerMergeBase,
  environmentGoneStatus,
  isEnvironmentActionPending,
  modelFallback,
  onChangedFileClick,
  onPullRequestDraft,
  onPullRequestMerge,
  onPullRequestReady,
  parentThreadSection,
  pendingTodos,
  pullRequest,
  pullRequestMergeMethod,
  queue,
  resolveMentionLink,
  threadId,
  workspaceChangedFilesSection,
  workspaceStatusPending,
}: ThreadDetailPromptStackProps) {
  const [expandedBannerSection, setExpandedBannerSection] =
    useState<ThreadPromptContextBannerExpandedSection | null>(null);
  const handleToggleBannerSection = useCallback(
    (section: ThreadPromptContextBannerExpandedSection | null) => {
      setExpandedBannerSection((previous) =>
        previous === section ? null : section,
      );
    },
    [],
  );
  const [isTodoExpanded, setIsTodoExpanded] = useState(false);
  // Expansion is tracked per workflow id so concurrent workflows expand and
  // collapse independently.
  const [expandedWorkflowIds, setExpandedWorkflowIds] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const toggleWorkflowExpanded = useCallback((workflowId: string) => {
    setExpandedWorkflowIds((current) => {
      const next = new Set(current);
      if (!next.delete(workflowId)) {
        next.add(workflowId);
      }
      return next;
    });
  }, []);
  const [isBackgroundCommandsExpanded, setIsBackgroundCommandsExpanded] =
    useState(false);
  const unarchiveThread = useUnarchiveThread();
  const isUnarchiveCurrentThreadPending =
    unarchiveThread.isPending && unarchiveThread.variables?.id === threadId;
  const handleUnarchiveCurrentThread = useCallback(() => {
    unarchiveThread.mutate({ id: threadId });
  }, [threadId, unarchiveThread]);
  const pullRequestSection =
    useMemo<ThreadPromptPullRequestSection | null>(() => {
      if (!pullRequest) {
        return null;
      }
      const actions =
        onPullRequestReady ||
        onPullRequestMerge ||
        onPullRequestDraft ||
        isEnvironmentActionPending
          ? {
              isPending: isEnvironmentActionPending,
              ...(onPullRequestReady
                ? { onMarkReady: onPullRequestReady }
                : {}),
              ...(onPullRequestMerge ? { onMerge: onPullRequestMerge } : {}),
              ...(onPullRequestDraft
                ? { onConvertToDraft: onPullRequestDraft }
                : {}),
              ...(onPullRequestMerge
                ? { selectedMergeMethod: pullRequestMergeMethod }
                : {}),
            }
          : undefined;
      return actions ? { pullRequest, actions } : { pullRequest };
    }, [
      isEnvironmentActionPending,
      onPullRequestDraft,
      onPullRequestMerge,
      onPullRequestReady,
      pullRequest,
      pullRequestMergeMethod,
    ]);

  return (
    <>
      {childPendingInteractionBanners}
      {activeWorkflows.map((workflow) => (
        <ThreadWorkflowCard
          key={workflow.id}
          workflow={workflow}
          isExpanded={expandedWorkflowIds.has(workflow.id)}
          onToggle={() => toggleWorkflowExpanded(workflow.id)}
        />
      ))}
      <ThreadBackgroundCommandsCard
        commands={activeBackgroundCommands}
        isExpanded={isBackgroundCommandsExpanded}
        onToggle={() => setIsBackgroundCommandsExpanded((value) => !value)}
      />
      {activePromptModeCard}
      {activeGoalCard}
      <ThreadTodoCard
        pendingTodos={
          archivedAt === null && environmentGoneStatus === null
            ? pendingTodos
            : null
        }
        isExpanded={isTodoExpanded}
        onToggle={() => setIsTodoExpanded((value) => !value)}
      />
      <ThreadPromptContextBanner
        archivedSection={
          archivedAt !== null
            ? {
                archivedAt,
                onUnarchive: handleUnarchiveCurrentThread,
                unarchivePending: isUnarchiveCurrentThreadPending,
              }
            : null
        }
        environmentGoneSection={
          environmentGoneStatus === null
            ? null
            : { status: environmentGoneStatus }
        }
        parentThreadSection={parentThreadSection}
        childThreadsSection={childThreadsSection}
        pullRequestSection={pullRequestSection}
        gitSection={
          workspaceChangedFilesSection
            ? {
                changedFiles: workspaceChangedFilesSection,
                mergeBase: contextBannerMergeBase,
                onPromptBannerFileClick: canUseGitUi
                  ? onChangedFileClick
                  : ignorePromptBannerFileClick,
              }
            : null
        }
        gitSectionPending={workspaceStatusPending}
        expandedSection={expandedBannerSection}
        onToggleSection={handleToggleBannerSection}
      />
      {modelFallback ? (
        <ThreadModelFallbackCard
          key={`${threadId}:${modelFallback.sourceSeq}`}
          fallback={modelFallback}
          threadId={threadId}
        />
      ) : null}
      {queue ? (
        <QueuedMessagesList
          {...queue}
          resolveMentionLink={resolveMentionLink}
        />
      ) : null}
    </>
  );
});
