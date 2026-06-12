import { type ReactNode } from "react";
import type {
  GitBranchRefClassification,
  ThreadTimelinePendingTodoItem,
  ThreadTimelinePendingTodoItemStatus,
  ThreadTimelinePendingTodos,
} from "@bb/domain";
import {
  BranchPicker,
  getMergeBaseBranchCandidateGroups,
} from "@/components/pickers/BranchPicker";
import { PromptStackCard } from "@/components/promptbox/banner/PromptStackCard";
import { WorkspaceChangesList } from "@/components/thread/WorkspaceChangesList";
import {
  formatChangeSummary,
  renderChangeSummary,
  toChangeTally,
  type WorkspaceChangedFileSelection,
  type WorkspaceChangedFilesSection,
} from "@/components/workspace/workspace-change-summary";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon.js";

export interface ContextBannerMergeBaseConfig {
  branch: string;
  branchRef?: GitBranchRefClassification | null;
  options?: readonly string[];
  remoteOptions?: readonly string[];
  optionsLoading?: boolean;
  onChange: (branch: string) => void;
  onPickerOpenChange?: (open: boolean) => void;
  onSearchQueryChange?: (query: string) => void;
}

export interface ThreadPromptTodoSection {
  pendingTodos: ThreadTimelinePendingTodos;
}

export interface ThreadPromptGitSection {
  changedFiles: WorkspaceChangedFilesSection;
  mergeBase: ContextBannerMergeBaseConfig | null;
  onPromptBannerFileClick: (selection: WorkspaceChangedFileSelection) => void;
}

/**
 * Archived-state segment for the banner. When present, the banner renders
 * only this row — archived threads are read-only, so suppressing the other
 * sections keeps the surface focused on "you are looking at a frozen thread".
 */
export interface ThreadPromptArchivedSection {
  archivedAt: number;
}

export type ThreadPromptContextBannerExpandedSection =
  | "todos"
  | "git";

/**
 * Pixel height of the banner's collapsed (single-row) state. Pinned via the
 * outer PromptStackCard's `min-height` so the height is a contract, not a
 * computed coincidence of text size + paddings + border. Imported by
 * FollowUpPromptBox to derive its elastic textarea target — keeping both
 * sides on the same constant means tweaking banner chrome only requires
 * updating this number in one place.
 */
export const THREAD_PROMPT_CONTEXT_BANNER_ROW_HEIGHT = 32;

export interface ThreadPromptContextBannerProps {
  todoSection: ThreadPromptTodoSection | null;
  gitSection: ThreadPromptGitSection | null;
  /**
   * True while the workspace status query for this thread is in flight. Holds
   * banner rendering until the result settles so first paint is the final
   * form.
   */
  gitSectionPending: boolean;
  /**
   * When set, the banner renders the "Thread is archived" row and suppresses
   * todos and git — those represent live work that no longer applies.
   */
  archivedSection: ThreadPromptArchivedSection | null;
  expandedSection: ThreadPromptContextBannerExpandedSection | null;
  onToggleSection: (section: ThreadPromptContextBannerExpandedSection) => void;
}

const KIND_PREFIX: Record<WorkspaceChangedFilesSection["kind"], string> = {
  uncommitted: "Uncommitted",
  untracked: "Untracked",
  committed: "Committed",
};

const ARCHIVED_THREAD_STATUS_LABEL = "Thread is archived";

// Stable ids for aria-controls / aria-labelledby pairing between each
// section's toggle button and its expanded body region.
const SECTION_IDS = {
  todos: {
    toggle: "thread-prompt-banner-todos-toggle",
    body: "thread-prompt-banner-todos-body",
  },
  git: {
    toggle: "thread-prompt-banner-git-toggle",
    body: "thread-prompt-banner-git-body",
  },
} as const;

const STATUS_SORT_RANK: Record<ThreadTimelinePendingTodoItemStatus, number> = {
  in_progress: 0,
  pending: 1,
  completed: 2,
};

function hasObservedTodoItems(
  pendingTodos: ThreadTimelinePendingTodos,
): boolean {
  return pendingTodos.items.length > 0;
}

function renderTodoCounts(
  items: readonly ThreadTimelinePendingTodoItem[],
): ReactNode {
  if (items.length === 0) return null;
  let completedCount = 0;
  for (const item of items) {
    if (item.status === "completed") completedCount += 1;
  }
  if (completedCount === 0) {
    return `${items.length}`;
  }
  return `${completedCount}/${items.length}`;
}

interface SectionToggleButtonProps {
  id: string;
  controlsId: string;
  ariaLabel: string;
  icon: ReactNode;
  label: ReactNode;
  hideLabelInCompact: boolean;
  isExpanded: boolean;
  onToggle: () => void;
}

function SectionToggleButton({
  id,
  controlsId,
  ariaLabel,
  icon,
  label,
  hideLabelInCompact,
  isExpanded,
  onToggle,
}: SectionToggleButtonProps) {
  return (
    <button
      type="button"
      id={id}
      aria-expanded={isExpanded}
      aria-controls={controlsId}
      aria-label={ariaLabel}
      onClick={onToggle}
      className={cn(
        "flex min-w-0 items-center gap-1.5 rounded px-1 py-0.5 text-xs transition-colors hover:bg-state-hover",
        isExpanded ? "text-foreground" : "text-muted-foreground",
      )}
    >
      {icon}
      <span
        className="min-w-0 truncate"
        data-promptbox-hide-compact={hideLabelInCompact ? "" : undefined}
      >
        {label}
      </span>
      <Icon
        name="ChevronDown"
        className={cn(
          "size-3.5 shrink-0 text-subtle-foreground transition-transform duration-200",
          isExpanded && "rotate-180",
        )}
        aria-hidden="true"
      />
    </button>
  );
}

function TodoStatusIcon({
  status,
}: {
  status: ThreadTimelinePendingTodoItemStatus;
}) {
  const className = "size-3.5 shrink-0";
  switch (status) {
    case "in_progress":
      return (
        <Icon
          name="Square"
          className={cn(className, "fill-current text-muted-foreground/30")}
          aria-hidden="true"
        />
      );
    case "completed":
      return (
        <Icon
          name="Check"
          className={cn(className, "text-muted-foreground/60")}
          aria-hidden="true"
        />
      );
    case "pending":
      return (
        <Icon
          name="Square"
          className={cn(className, "text-muted-foreground/45")}
          aria-hidden="true"
        />
      );
  }
}

function TodoBody({
  items,
}: {
  items: readonly ThreadTimelinePendingTodoItem[];
}) {
  const ordered = [...items].sort(
    (a, b) => STATUS_SORT_RANK[a.status] - STATUS_SORT_RANK[b.status],
  );
  return (
    <ul className="max-h-40 space-y-0.5 overflow-y-auto px-3 pb-2 pt-1.5">
      {ordered.map((item) => (
        <li
          key={item.id}
          className="flex min-w-0 items-center gap-2 py-0.5 text-xs"
        >
          <TodoStatusIcon status={item.status} />
          <span
            className={cn(
              "min-w-0 flex-1 truncate",
              item.status === "in_progress" && "font-medium text-foreground",
              item.status === "pending" && "text-muted-foreground",
              item.status === "completed" &&
                "text-subtle-foreground line-through decoration-subtle-foreground",
            )}
            title={item.text}
          >
            {item.text}
          </span>
        </li>
      ))}
    </ul>
  );
}

function AnimatedBody({
  id,
  labelledBy,
  isExpanded,
  children,
}: {
  id: string;
  labelledBy: string;
  isExpanded: boolean;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      role="region"
      aria-labelledby={labelledBy}
      aria-hidden={!isExpanded}
      className={cn(
        "grid overflow-hidden transition-[grid-template-rows,opacity,border-color] duration-200 ease-out",
        isExpanded
          ? "grid-rows-[1fr] border-t border-border opacity-100"
          : "pointer-events-none grid-rows-[0fr] border-t border-transparent opacity-0",
      )}
    >
      <div className="overflow-hidden bg-popover">{children}</div>
    </section>
  );
}

/**
 * Single rounded strip rendered above the FollowUp prompt input. Hosts the
 * thread's high-signal context as inline section toggles (TODO, git) plus
 * the merge-base picker pinned to the right. Only one section can be
 * expanded at a time; the caller owns expandedSection state. See
 * plans/thread-prompt-context-banner.md.
 */
export function ThreadPromptContextBanner({
  todoSection,
  gitSection,
  gitSectionPending,
  archivedSection,
  expandedSection,
  onToggleSection,
}: ThreadPromptContextBannerProps) {
  if (gitSectionPending) {
    return null;
  }
  if (archivedSection) {
    return (
      <PromptStackCard
        ariaLabel="Thread context before sending"
        className="overflow-hidden"
        style={{ minHeight: THREAD_PROMPT_CONTEXT_BANNER_ROW_HEIGHT }}
      >
        <div className="flex items-center gap-0.5 px-2 py-1 text-xs text-muted-foreground">
          <div
            className="flex min-w-0 items-center gap-1.5 px-1 py-0.5"
            role="status"
            aria-label={ARCHIVED_THREAD_STATUS_LABEL}
          >
            <Icon
              name="Archive"
              className="size-3.5 shrink-0"
              aria-hidden="true"
            />
            <span
              className="min-w-0 truncate"
              aria-hidden="true"
            >
              {ARCHIVED_THREAD_STATUS_LABEL}
            </span>
          </div>
        </div>
      </PromptStackCard>
    );
  }
  const showTodo =
    todoSection !== null && hasObservedTodoItems(todoSection.pendingTodos);
  const showGit = gitSection !== null;
  if (!showTodo && !showGit) {
    return null;
  }
  const visibleSegmentCount = Number(showTodo) + Number(showGit);
  const hasSingleVisibleSegment = visibleSegmentCount === 1;
  const todoItems =
    showTodo && todoSection ? todoSection.pendingTodos.items : [];
  const todoCountLabel = renderTodoCounts(todoItems);
  const isTodoExpanded = expandedSection === "todos" && showTodo;
  // selectWorkspaceChangedFilesSection only emits a section when files exist,
  // so showGit implies a non-empty file list.
  const isGitExpanded = expandedSection === "git" && showGit;

  const gitTally = showGit ? toChangeTally(gitSection.changedFiles.stats) : null;
  const gitSummaryText = gitTally ? formatChangeSummary(gitTally) : "";
  const gitSummary: ReactNode =
    showGit && gitTally ? (
      <>
        {showTodo ? null : <>{KIND_PREFIX[gitSection.changedFiles.kind]} · </>}
        {renderChangeSummary(gitTally)}
      </>
    ) : null;

  const mergeBaseCandidates =
    showGit && gitSection.mergeBase
      ? getMergeBaseBranchCandidateGroups({
          mergeBaseBranch: gitSection.mergeBase.branch,
          mergeBaseBranchRef: gitSection.mergeBase.branchRef,
          mergeBaseBranchOptions: gitSection.mergeBase.options,
          remoteMergeBaseBranchOptions: gitSection.mergeBase.remoteOptions,
        })
      : { options: [], remoteOptions: [] };

  return (
    <PromptStackCard
      ariaLabel="Thread context before sending"
      className="overflow-hidden bg-surface-recessed"
      style={{ minHeight: THREAD_PROMPT_CONTEXT_BANNER_ROW_HEIGHT }}
    >
      <div className="flex items-center gap-0.5 px-2 py-1 text-xs text-muted-foreground">
        {showTodo ? (
          <SectionToggleButton
            id={SECTION_IDS.todos.toggle}
            controlsId={SECTION_IDS.todos.body}
            icon={
              <Icon
                name="ListTodo"
                className="size-3.5 shrink-0"
                aria-hidden="true"
              />
            }
            label={todoCountLabel}
            hideLabelInCompact={!hasSingleVisibleSegment}
            ariaLabel={`Todos: ${todoCountLabel ?? todoItems.length}`}
            isExpanded={isTodoExpanded}
            onToggle={() => onToggleSection("todos")}
          />
        ) : null}
        {showGit && gitSummary ? (
          <SectionToggleButton
            id={SECTION_IDS.git.toggle}
            controlsId={SECTION_IDS.git.body}
            icon={
              <Icon
                name="FileDiff"
                className="size-3.5 shrink-0"
                aria-hidden="true"
              />
            }
            label={gitSummary}
            hideLabelInCompact={!hasSingleVisibleSegment}
            ariaLabel={`Changed files: ${gitSummaryText}`}
            isExpanded={isGitExpanded}
            onToggle={() => onToggleSection("git")}
          />
        ) : null}
        {showGit && gitSection.mergeBase ? (
          <div
            className="ml-auto flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground"
            data-promptbox-hide-compact=""
          >
            <Icon
              name="GitMerge"
              className="size-3.5 shrink-0"
              aria-label="Merge base"
            />
            <BranchPicker
              value={gitSection.mergeBase.branch}
              options={mergeBaseCandidates.options}
              remoteOptions={mergeBaseCandidates.remoteOptions}
              selectedOptionKind={mergeBaseCandidates.selectedOptionKind}
              variant="minimal"
              loading={gitSection.mergeBase.optionsLoading}
              onChange={gitSection.mergeBase.onChange}
              onOpenChange={gitSection.mergeBase.onPickerOpenChange}
              onSearchQueryChange={gitSection.mergeBase.onSearchQueryChange}
              className="max-w-[10rem]"
              muted
              popoverAlign="end"
            />
          </div>
        ) : null}
      </div>
      {showTodo ? (
        <AnimatedBody
          id={SECTION_IDS.todos.body}
          labelledBy={SECTION_IDS.todos.toggle}
          isExpanded={isTodoExpanded}
        >
          <TodoBody items={todoItems} />
        </AnimatedBody>
      ) : null}
      {showGit ? (
        <AnimatedBody
          id={SECTION_IDS.git.body}
          labelledBy={SECTION_IDS.git.toggle}
          isExpanded={isGitExpanded}
        >
          <WorkspaceChangesList
            files={gitSection.changedFiles.files}
            className="max-h-32 px-3 pb-2 pt-1"
            onFileClick={(file) =>
              gitSection.onPromptBannerFileClick({
                file,
                section: gitSection.changedFiles,
              })
            }
          />
        </AnimatedBody>
      ) : null}
    </PromptStackCard>
  );
}
