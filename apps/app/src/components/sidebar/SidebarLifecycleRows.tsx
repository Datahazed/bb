import type { ThreadListEntry } from "@bb/domain";
import { Button } from "@bb/shared-ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@bb/shared-ui/context-menu";
import {
  COARSE_POINTER_ICON_SIZE_CLASS,
  COARSE_POINTER_ROW_HEIGHT_CLASS,
} from "@bb/shared-ui/coarse-pointer-sizing";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { LIST_HOVER_TRANSITION } from "@bb/shared-ui/motion";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink } from "react-router-dom";
import {
  ThreadActionsContextMenu,
  ThreadActionsMenu,
} from "@/components/thread/ThreadActionsMenu";
import { CompactLongPressMenu } from "@/components/ui/compact-long-press-menu";
import {
  SIDEBAR_CONTENT_SELECTOR,
  useSidebarContentElementRef,
} from "@/components/ui/sidebar.js";
import {
  SIDEBAR_HOVER_ACTIONS_CLASS,
  SIDEBAR_HOVER_ACTIONS_INSET_CLASS,
  SIDEBAR_HOVER_ACTIONS_ROW_CLASS,
} from "@/components/ui/sidebar-hover-actions.js";
import { getThreadDisplayTitle } from "@/lib/thread-title";
import { getThreadRoutePath } from "@/lib/route-paths";
import { useSplitWorkspaceActive } from "@/hooks/useSplitWorkspaceActive";
import {
  SIDEBAR_MORE_ACTION_TRIGGER_CLASS,
  SIDEBAR_ROW_BASE_CLASS,
  SIDEBAR_ROW_GLYPH_SLOT_CLASS,
  SIDEBAR_ROW_INTERACTIVE_STATE_CLASS,
  SIDEBAR_ROW_SELECTED_STATE_CLASS,
  SIDEBAR_STANDARD_ROW_PADDING_CLASS,
} from "./sidebarRowClasses";
import { SidebarWindowedItems } from "./SidebarWindowedItems";
import { TopLevelSidebarSection } from "./TopLevelSidebarSection";
import { usePaneContentSplitDrag } from "./usePaneContentSplitDrag";

export interface SidebarDraftRowItem {
  id: string;
  title: string;
  delete: () => void;
}

interface SidebarDraftRowsProps {
  drafts: readonly SidebarDraftRowItem[];
  onOpenDraft: (draftId: string) => void;
}

type DraftActionsMenuSurface = "context" | "dropdown";

function DraftActionsMenuItems({
  onDelete,
  onOpenInSplit,
  surface,
}: {
  onDelete: () => void;
  onOpenInSplit?: () => void;
  surface: DraftActionsMenuSurface;
}) {
  const deleteContent = (
    <>
      <Icon name="Trash2" aria-hidden="true" />
      Delete draft
    </>
  );

  if (surface === "context") {
    return (
      <>
        {onOpenInSplit ? (
          <ContextMenuItem onSelect={onOpenInSplit}>
            <Icon name="Columns2" aria-hidden="true" />
            Open in split
          </ContextMenuItem>
        ) : null}
        <ContextMenuItem
          className="text-destructive focus:bg-destructive/15 focus:text-destructive data-[last-hovered]:bg-destructive/15 data-[last-hovered]:text-destructive"
          onSelect={onDelete}
        >
          {deleteContent}
        </ContextMenuItem>
      </>
    );
  }

  return (
    <>
      {onOpenInSplit ? (
        <DropdownMenuItem onSelect={onOpenInSplit}>
          <Icon name="Columns2" aria-hidden="true" />
          Open in split
        </DropdownMenuItem>
      ) : null}
      <DropdownMenuItem variant="destructive" onSelect={onDelete}>
        {deleteContent}
      </DropdownMenuItem>
    </>
  );
}

function DraftActionsMenu({
  onDelete,
  onOpenInSplit,
  onOpenChange,
}: {
  onDelete: () => void;
  onOpenInSplit?: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(
            "rounded-md p-0 text-subtle-foreground hover:bg-transparent hover:text-foreground",
            "data-[state=open]:bg-state-active data-[state=open]:text-foreground",
            SIDEBAR_MORE_ACTION_TRIGGER_CLASS,
          )}
          aria-label="Draft actions"
          onClick={(event) => {
            event.stopPropagation();
          }}
        >
          <Icon
            name="MoreHorizontal"
            className={COARSE_POINTER_ICON_SIZE_CLASS}
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DraftActionsMenuItems
          surface="dropdown"
          onDelete={onDelete}
          onOpenInSplit={onOpenInSplit}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DraftActionsContextMenu({
  children,
  onDelete,
  onOpenInSplit,
  onOpenChange,
}: {
  children: ReactNode;
  onDelete: () => void;
  onOpenInSplit?: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  const isCompactViewport = useIsCompactViewport();

  if (isCompactViewport) {
    return (
      <CompactLongPressMenu
        label="Draft actions"
        onOpenChange={onOpenChange}
        items={
          <DraftActionsMenuItems
            surface="dropdown"
            onDelete={onDelete}
            onOpenInSplit={onOpenInSplit}
          />
        }
      >
        {children}
      </CompactLongPressMenu>
    );
  }

  return (
    <ContextMenu onOpenChange={onOpenChange}>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent aria-label="Draft actions">
        <DraftActionsMenuItems
          surface="context"
          onDelete={onDelete}
          onOpenInSplit={onOpenInSplit}
        />
      </ContextMenuContent>
    </ContextMenu>
  );
}

function SidebarDraftRow({
  draft,
  onOpenDraft,
  splitEnabled,
}: {
  draft: SidebarDraftRowItem;
  onOpenDraft: (draftId: string) => void;
  splitEnabled: boolean;
}) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const actionsOpen = dropdownOpen || contextOpen;
  const draftSplit = usePaneContentSplitDrag({
    content: { kind: "new-thread", draftSlotId: draft.id },
    enabled: splitEnabled,
    label: draft.title,
  });

  const row = (
    <div
      data-sidebar-draft-id={draft.id}
      className={cn(
        SIDEBAR_HOVER_ACTIONS_ROW_CLASS,
        SIDEBAR_ROW_BASE_CLASS,
        SIDEBAR_ROW_INTERACTIVE_STATE_CLASS,
        SIDEBAR_STANDARD_ROW_PADDING_CLASS,
        COARSE_POINTER_ROW_HEIGHT_CLASS,
        LIST_HOVER_TRANSITION,
        "group/draft-row relative min-w-0",
        "has-[[data-state=open]]:bg-sidebar-accent",
      )}
    >
      <button
        type="button"
        className="absolute inset-0 rounded-md outline-none ring-sidebar-ring focus-visible:ring-2"
        aria-label={`Open draft ${draft.title}`}
        onClick={() => onOpenDraft(draft.id)}
      />
      <span
        className={cn(
          SIDEBAR_HOVER_ACTIONS_INSET_CLASS,
          "flex min-w-0 flex-1 items-center gap-2",
        )}
      >
        <span className={cn(SIDEBAR_ROW_GLYPH_SLOT_CLASS, "w-4")}>
          <Icon
            name="EditFile"
            className={COARSE_POINTER_ICON_SIZE_CLASS}
            aria-hidden="true"
          />
        </span>
        <span className="min-w-0 truncate" title={draft.title}>
          {draft.title}
        </span>
      </span>
      <span
        data-sidebar-hover-actions-open={actionsOpen ? "true" : undefined}
        className={cn(
          SIDEBAR_HOVER_ACTIONS_CLASS,
          "absolute inset-y-0 right-0 z-10 flex items-center justify-end max-md:pointer-coarse:hidden",
        )}
      >
        <DraftActionsMenu
          onDelete={draft.delete}
          onOpenInSplit={splitEnabled ? draftSplit.openInSplit : undefined}
          onOpenChange={setDropdownOpen}
        />
      </span>
    </div>
  );

  return (
    <DraftActionsContextMenu
      onDelete={draft.delete}
      onOpenInSplit={splitEnabled ? draftSplit.openInSplit : undefined}
      onOpenChange={setContextOpen}
    >
      {row}
    </DraftActionsContextMenu>
  );
}

/**
 * Unlabelled, caller-ordered draft rows. The draft-slot model supplies these
 * newest first; this component deliberately preserves that order so sidebar
 * sort and organization preferences never reach the phantom rows.
 */
export function SidebarDraftRows({
  drafts,
  onOpenDraft,
}: SidebarDraftRowsProps) {
  const splitEnabled = useSplitWorkspaceActive();
  if (drafts.length === 0) {
    return null;
  }

  return (
    <div data-sidebar-draft-cluster="">
      {drafts.map((draft) => (
        <SidebarDraftRow
          key={draft.id}
          draft={draft}
          onOpenDraft={onOpenDraft}
          splitEnabled={splitEnabled}
        />
      ))}
    </div>
  );
}

interface SidebarArchivedThreadGroupProps {
  threads: readonly ThreadListEntry[];
  activeThreadId?: string | null;
  actions?: ReactNode;
  actionsOpen?: boolean;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
  onNavigate?: () => void;
}

function SidebarArchivedThreadRow({
  isActive,
  onNavigate,
  thread,
}: {
  isActive: boolean;
  onNavigate?: () => void;
  thread: ThreadListEntry;
}) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const actionsOpen = dropdownOpen || contextOpen;
  const title = getThreadDisplayTitle(thread);

  const row = (
    <div
      data-sidebar-archived-thread-id={thread.id}
      className={cn(
        SIDEBAR_HOVER_ACTIONS_ROW_CLASS,
        SIDEBAR_ROW_BASE_CLASS,
        SIDEBAR_STANDARD_ROW_PADDING_CLASS,
        COARSE_POINTER_ROW_HEIGHT_CLASS,
        LIST_HOVER_TRANSITION,
        "group/archived-thread-row relative min-w-0",
        isActive
          ? SIDEBAR_ROW_SELECTED_STATE_CLASS
          : [
              SIDEBAR_ROW_INTERACTIVE_STATE_CLASS,
              "text-sidebar-foreground/60 dark:text-sidebar-foreground/60",
            ],
        !isActive && "has-[[data-state=open]]:bg-sidebar-accent",
      )}
    >
      <NavLink
        to={getThreadRoutePath({
          projectId: thread.projectId,
          threadId: thread.id,
        })}
        data-sidebar-thread-shortcut-target=""
        data-sidebar-thread-id={thread.id}
        className="absolute inset-0 rounded-md outline-none ring-sidebar-ring focus-visible:ring-2"
        aria-label={`Open archived thread ${title}`}
        onClick={onNavigate}
      />
      <span
        className={cn(
          SIDEBAR_HOVER_ACTIONS_INSET_CLASS,
          "flex min-w-0 flex-1 items-center gap-2",
        )}
      >
        <span className={cn(SIDEBAR_ROW_GLYPH_SLOT_CLASS, "w-4")}>
          <Icon
            name="Archive"
            className={COARSE_POINTER_ICON_SIZE_CLASS}
            aria-hidden="true"
          />
        </span>
        <span className="min-w-0 truncate" title={title}>
          {title}
        </span>
      </span>
      <span
        data-sidebar-hover-actions-open={actionsOpen ? "true" : undefined}
        className={cn(
          SIDEBAR_HOVER_ACTIONS_CLASS,
          "absolute inset-y-0 right-0 z-10 flex items-center justify-end max-md:pointer-coarse:hidden",
        )}
      >
        <ThreadActionsMenu
          thread={thread}
          triggerClassName={cn(
            "text-subtle-foreground hover:bg-transparent hover:text-foreground",
            SIDEBAR_MORE_ACTION_TRIGGER_CLASS,
          )}
          onOpenChange={setDropdownOpen}
        />
      </span>
    </div>
  );

  return (
    <ThreadActionsContextMenu thread={thread} onOpenChange={setContextOpen}>
      {row}
    </ThreadActionsContextMenu>
  );
}

function ArchivedThreadsLoadMore({
  hasNextPage,
  isFetchingNextPage,
  loadedCount,
  onLoadMore,
}: {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  loadedCount: number;
  onLoadMore: () => void;
}) {
  const sentinelRef = useRef<HTMLButtonElement>(null);
  const scrollElementRef = useSidebarContentElementRef();
  const autoRequestedAtCountRef = useRef<number | null>(null);

  useEffect(() => {
    if (
      !hasNextPage ||
      isFetchingNextPage ||
      typeof IntersectionObserver === "undefined"
    ) {
      return;
    }
    const sentinel = sentinelRef.current;
    if (sentinel === null) {
      return;
    }
    const scrollElement =
      scrollElementRef?.current ??
      sentinel.closest<HTMLElement>(SIDEBAR_CONTENT_SELECTOR);
    const observer = new IntersectionObserver(
      (entries) => {
        if (
          entries.some((entry) => entry.isIntersecting) &&
          autoRequestedAtCountRef.current !== loadedCount
        ) {
          autoRequestedAtCountRef.current = loadedCount;
          onLoadMore();
        }
      },
      { root: scrollElement ?? null, rootMargin: "240px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [
    hasNextPage,
    isFetchingNextPage,
    loadedCount,
    onLoadMore,
    scrollElementRef,
  ]);

  if (!hasNextPage) {
    return null;
  }

  return (
    <Button
      ref={sentinelRef}
      type="button"
      variant="ghost"
      className={cn(
        "mx-2 mt-1 w-[calc(100%-1rem)] font-normal text-muted-foreground",
        "h-7 max-md:pointer-coarse:h-9",
      )}
      disabled={isFetchingNextPage}
      aria-busy={isFetchingNextPage}
      onClick={onLoadMore}
    >
      {isFetchingNextPage
        ? "Loading more archived threads…"
        : "Load more archived threads"}
    </Button>
  );
}

/**
 * The archive's own, caller-ordered trailing group. Each page remains in query
 * order; sidebar organization and sort never reach this component.
 */
export function SidebarArchivedThreadGroup({
  threads,
  activeThreadId = null,
  actions,
  actionsOpen = false,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
  onNavigate,
}: SidebarArchivedThreadGroupProps) {
  if (threads.length === 0 && !hasNextPage) {
    return null;
  }

  return (
    <TopLevelSidebarSection
      label="Archived"
      actions={actions}
      actionsOpen={actionsOpen}
    >
      <SidebarWindowedItems
        itemKeys={threads.map((thread) => thread.id)}
        estimateRows={() => 1}
        alwaysMountedKeys={
          activeThreadId === null ? undefined : new Set([activeThreadId])
        }
        getNavigationEntries={(index) => {
          const thread = threads[index];
          return thread
            ? [{ projectId: thread.projectId, threadId: thread.id }]
            : [];
        }}
        renderItem={(index) => {
          const thread = threads[index];
          return thread ? (
            <SidebarArchivedThreadRow
              thread={thread}
              isActive={thread.id === activeThreadId}
              onNavigate={onNavigate}
            />
          ) : null;
        }}
      />
      <ArchivedThreadsLoadMore
        hasNextPage={hasNextPage}
        isFetchingNextPage={isFetchingNextPage}
        loadedCount={threads.length}
        onLoadMore={onLoadMore}
      />
    </TopLevelSidebarSection>
  );
}
