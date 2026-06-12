import {
  memo,
  useState,
  type CSSProperties,
  type MouseEventHandler,
  type ReactNode,
} from "react";
import { useSetAtom } from "jotai";
import type { ThreadListEntry } from "@bb/domain";
import {
  getThreadConversationCollapsedAtom,
} from "@/components/secondary-panel/threadSecondaryPanelAtoms";
import { Icon, type IconName } from "@/components/ui/icon.js";
import { NavLink } from "react-router-dom";
import {
  ThreadActionsContextMenu,
  ThreadActionsMenu,
} from "@/components/thread/ThreadActionsMenu";
import {
  COARSE_POINTER_COMPACT_ROW_HEIGHT_CLASS,
  COARSE_POINTER_DOT_SIZE_CLASS,
  COARSE_POINTER_GLYPH_BOX_CLASS,
  COARSE_POINTER_ICON_SIZE_CLASS,
  COARSE_POINTER_ROW_ACTION_SIZE_CLASS,
  COARSE_POINTER_ROW_HEIGHT_CLASS,
} from "@/components/ui/coarse-pointer-sizing.js";
import {
  SIDEBAR_HOVER_ACTIONS_CLASS,
  SIDEBAR_HOVER_ACTIONS_FADE_CLASS,
  SIDEBAR_HOVER_ACTIONS_ROW_CLASS,
} from "@/components/ui/sidebar-hover-actions.js";
import {
  getEnvironmentWorkspaceDisplayIconLabel,
  getEnvironmentWorkspaceDisplayIconName,
} from "@/lib/environment-workspace-display";
import {
  isBusyThread,
  isUnreadDoneThread,
} from "@/lib/thread-activity";
import { getThreadDisplayTitle } from "@/lib/thread-title";
import { getThreadRoutePath } from "@/lib/route-paths";
import { cn } from "@/lib/utils";
import {
  SIDEBAR_ROW_BASE_CLASS,
  SIDEBAR_ROW_GLYPH_SLOT_CLASS,
  SIDEBAR_ROW_INTERACTIVE_STATE_CLASS,
  SIDEBAR_UNREAD_DOT_CLASS_BY_TONE,
  getSidebarThreadRowPaddingLeft,
  type SidebarUnreadDotTone,
} from "./sidebarRowClasses";
import type { ConsumeDragClickSuppression } from "@/components/ui/use-drag-click-suppression";
import type { SidebarSortableDragBindings } from "./sortableMotion";

export interface ThreadRowOptions {
  depth: number;
  isCompact: boolean;
  isEnvGrouped: boolean;
  consumeClickSuppression?: ConsumeDragClickSuppression;
  dragBindings?: SidebarSortableDragBindings;
}

interface ThreadRowProps {
  projectId: string;
  thread: ThreadListEntry;
  isActive: boolean;
  hasComposerDraft: boolean;
  onProjectSelect?: () => void;
  options: ThreadRowOptions;
}

type ThreadRowClickCaptureHandler = MouseEventHandler<HTMLDivElement>;

interface ThreadRowContainerArgs {
  children: ReactNode;
  className: string;
  dragBindings?: SidebarSortableDragBindings;
  onClickCapture?: ThreadRowClickCaptureHandler;
  style: CSSProperties;
}

function ThreadDraftIndicator() {
  return (
    <Icon
      name="Edit"
      className="pointer-events-none size-3.5 shrink-0 text-muted-foreground"
      aria-hidden="true"
    />
  );
}

function getThreadRowStyle(depth: number): CSSProperties {
  return {
    paddingLeft: getSidebarThreadRowPaddingLeft(depth),
  };
}

function renderThreadRowContainer({
  children,
  className,
  dragBindings,
  onClickCapture,
  style,
}: ThreadRowContainerArgs) {
  return (
    <div
      ref={dragBindings?.setActivatorNodeRef}
      className={className}
      style={style}
      {...dragBindings?.attributes}
      {...(dragBindings?.listeners ?? {})}
      onClickCapture={onClickCapture}
    >
      {children}
    </div>
  );
}

interface ThreadStatusGlyphProps {
  hasPendingInteraction: boolean;
  isBusy: boolean;
  showUnreadBadge: boolean;
  unreadBadgeTone: SidebarUnreadDotTone;
}

interface ThreadUnreadBadgeLabelArgs {
  tone: SidebarUnreadDotTone;
}

export function ThreadStatusGlyph({
  hasPendingInteraction,
  isBusy,
  showUnreadBadge,
  unreadBadgeTone,
}: ThreadStatusGlyphProps) {
  if (hasPendingInteraction) {
    return (
      <span
        className={cn(
          "rounded-full bg-attention",
          COARSE_POINTER_DOT_SIZE_CLASS,
        )}
        aria-label="Pending interaction requires attention"
        title="Pending interaction"
      />
    );
  }

  if (isBusy) {
    return (
      <Icon
        name="CircleDashed"
        className={cn(
          "animate-spin text-muted-foreground",
          COARSE_POINTER_ICON_SIZE_CLASS,
        )}
        aria-label="Thread working"
      />
    );
  }

  if (showUnreadBadge) {
    const label = getThreadUnreadBadgeLabel({ tone: unreadBadgeTone });
    return (
      <span
        className={SIDEBAR_UNREAD_DOT_CLASS_BY_TONE[unreadBadgeTone]}
        aria-label={label}
        title={label}
      />
    );
  }

  return null;
}

function getThreadUnreadBadgeLabel({
  tone,
}: ThreadUnreadBadgeLabelArgs): string {
  return tone === "error"
    ? "Unread thread encountered an error"
    : "Unread thread requires attention";
}

interface ThreadTrailingIndicatorProps extends ThreadStatusGlyphProps {
  environmentIcon: IconName | null;
  environmentIconLabel: string | null;
}

function ThreadTrailingIndicator({
  environmentIcon,
  environmentIconLabel,
  hasPendingInteraction,
  isBusy,
  showUnreadBadge,
  unreadBadgeTone,
}: ThreadTrailingIndicatorProps) {
  const showStatusGlyph = hasPendingInteraction || isBusy || showUnreadBadge;

  if (showStatusGlyph) {
    return (
      <span
        className={cn(
          SIDEBAR_ROW_GLYPH_SLOT_CLASS,
          COARSE_POINTER_GLYPH_BOX_CLASS,
        )}
      >
        <ThreadStatusGlyph
          hasPendingInteraction={hasPendingInteraction}
          isBusy={isBusy}
          showUnreadBadge={showUnreadBadge}
          unreadBadgeTone={unreadBadgeTone}
        />
      </span>
    );
  }

  return (
    <ThreadTrailingIcon
      environmentIcon={environmentIcon}
      environmentIconLabel={environmentIconLabel}
    />
  );
}

function ThreadTrailingIcon({
  environmentIcon,
  environmentIconLabel,
}: ThreadTrailingIconProps) {
  return environmentIcon ? (
    <Icon
      name={environmentIcon}
      className={cn("text-muted-foreground", COARSE_POINTER_ICON_SIZE_CLASS)}
      aria-label={environmentIconLabel ?? undefined}
    />
  ) : null;
}

interface ThreadTrailingIconProps {
  environmentIcon: IconName | null;
  environmentIconLabel: string | null;
}

function ThreadRowComponent({
  projectId,
  thread,
  isActive,
  hasComposerDraft,
  onProjectSelect,
  options,
}: ThreadRowProps) {
  const [isDropdownActionsOpen, setIsDropdownActionsOpen] = useState(false);
  const [isContextActionsOpen, setIsContextActionsOpen] = useState(false);
  const setConversationCollapsed = useSetAtom(
    getThreadConversationCollapsedAtom(thread.id),
  );
  const showActive = isActive;
  const hasPendingInteraction = thread.hasPendingInteraction;
  const threadIsBusy = isBusyThread(thread) && !hasPendingInteraction;
  const showUnreadBadge = !hasPendingInteraction && isUnreadDoneThread(thread);
  const unreadBadgeTone: SidebarUnreadDotTone =
    showUnreadBadge && thread.status === "error" ? "error" : "default";
  const threadTitle = getThreadDisplayTitle(thread);
  const linkLabel = hasComposerDraft
    ? `Open ${threadTitle} (unsubmitted draft)`
    : `Open ${threadTitle}`;
  const linkTitle = linkLabel;
  // Env-grouped children sit under a header that already shows the
  // worktree branch + icon, so suppress the redundant trailing icon.
  const environmentIcon = options.isEnvGrouped
    ? null
    : getEnvironmentWorkspaceDisplayIconName(
        thread.environmentWorkspaceDisplayKind,
      );
  const environmentIconLabel = options.isEnvGrouped
    ? null
    : getEnvironmentWorkspaceDisplayIconLabel(
        thread.environmentWorkspaceDisplayKind,
      );
  const { dragBindings } = options;
  const rowClassName = cn(
    SIDEBAR_HOVER_ACTIONS_ROW_CLASS,
    "group/thread-row",
    SIDEBAR_ROW_BASE_CLASS,
    "relative",
    options.isCompact
      ? COARSE_POINTER_COMPACT_ROW_HEIGHT_CLASS
      : COARSE_POINTER_ROW_HEIGHT_CLASS,
    showActive
      ? "bg-sidebar-border text-sidebar-foreground"
      : SIDEBAR_ROW_INTERACTIVE_STATE_CLASS,
    dragBindings &&
      !dragBindings.disabled &&
      "select-none cursor-grab active:cursor-grabbing",
  );
  const rowStyle = getThreadRowStyle(options.depth);
  const isActionsOpen = isDropdownActionsOpen || isContextActionsOpen;
  const handleClickCapture: ThreadRowClickCaptureHandler | undefined =
    options.consumeClickSuppression
      ? (event) => {
          if (!options.consumeClickSuppression?.()) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
        }
      : undefined;

  const rowContent = (
    <>
      <NavLink
        to={getThreadRoutePath({ projectId, threadId: thread.id })}
        onClick={() => {
          // Selecting a thread/agent row restores its conversation without
          // disturbing any other thread's collapsed conversation state.
          setConversationCollapsed(false);
          onProjectSelect?.();
        }}
        aria-label={linkLabel}
        title={linkTitle}
        className="absolute inset-0 rounded-md outline-none ring-sidebar-ring focus-visible:ring-2"
      />
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <span className="min-w-0 truncate">{threadTitle}</span>
        {hasComposerDraft ? <ThreadDraftIndicator /> : null}
      </span>
      <span
        className={cn(
          "flex shrink-0 items-center justify-end max-md:pointer-coarse:pointer-events-none",
          COARSE_POINTER_COMPACT_ROW_HEIGHT_CLASS,
        )}
      >
        <span
          className={cn(
            "relative shrink-0",
            COARSE_POINTER_ROW_ACTION_SIZE_CLASS,
          )}
        >
          <span
            data-sidebar-hover-actions-open={isActionsOpen ? "true" : undefined}
            className={cn(
              SIDEBAR_HOVER_ACTIONS_FADE_CLASS,
              "absolute inset-0 flex items-center justify-center",
            )}
          >
            <ThreadTrailingIndicator
              environmentIcon={environmentIcon}
              environmentIconLabel={environmentIconLabel}
              hasPendingInteraction={hasPendingInteraction}
              isBusy={threadIsBusy}
              showUnreadBadge={showUnreadBadge}
              unreadBadgeTone={unreadBadgeTone}
            />
          </span>
          <div
            data-sidebar-hover-actions-open={isActionsOpen ? "true" : undefined}
            className={cn(
              SIDEBAR_HOVER_ACTIONS_CLASS,
              "absolute inset-0 z-10 flex items-center justify-end max-md:pointer-coarse:hidden",
            )}
          >
            <ThreadActionsMenu
              thread={thread}
              triggerClassName={cn(
                "text-muted-foreground",
                COARSE_POINTER_ROW_ACTION_SIZE_CLASS,
              )}
              onOpenChange={setIsDropdownActionsOpen}
            />
          </div>
        </span>
      </span>
    </>
  );

  const row = renderThreadRowContainer({
    children: rowContent,
    className: rowClassName,
    dragBindings,
    onClickCapture: handleClickCapture,
    style: rowStyle,
  });

  return (
    <ThreadActionsContextMenu
      thread={thread}
      onOpenChange={setIsContextActionsOpen}
    >
      {row}
    </ThreadActionsContextMenu>
  );
}

export const ThreadRow = memo(ThreadRowComponent);
