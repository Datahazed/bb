import {
  memo,
  useCallback,
  type CSSProperties,
  type MouseEventHandler,
} from "react";
import { Icon } from "@/components/ui/icon.js";
import { SidebarStickyTier } from "@/components/ui/sidebar.js";
import {
  COARSE_POINTER_COMPACT_ROW_HEIGHT_CLASS,
  COARSE_POINTER_GLYPH_BOX_CLASS,
  COARSE_POINTER_ICON_SIZE_CLASS,
  COARSE_POINTER_ROW_ACTION_SIZE_CLASS,
} from "@/components/ui/coarse-pointer-sizing.js";
import {
  SIDEBAR_HOVER_ACTIONS_FADE_CLASS,
  SIDEBAR_HOVER_ACTIONS_ROW_CLASS,
} from "@/components/ui/sidebar-hover-actions.js";
import { cn } from "@/lib/utils";
import type { CollapsedChildActivity } from "@/lib/thread-activity";
import {
  SIDEBAR_ROW_BASE_CLASS,
  SIDEBAR_ROW_INTERACTIVE_STATE_CLASS,
  getSidebarThreadRowPaddingLeft,
} from "./sidebarRowClasses";
import { SidebarChildToggleChevron } from "./SidebarChildToggleChevron";
import { ThreadStatusGlyph } from "./ThreadRow";
import type { SidebarSortableDragBindings } from "./sortableMotion";
import type { ConsumeDragClickSuppression } from "@/components/ui/use-drag-click-suppression";

interface SidebarFolderRowProps {
  // Leaf segment shown on the header ("Q3").
  name: string;
  // Full normalized path for the tooltip + accessible name ("Work › Q3"), so
  // two same-named folders in different branches stay distinguishable.
  pathLabel: string;
  // Render depth (folder nesting + section offset); drives indentation.
  depth: number;
  activity: CollapsedChildActivity;
  isCollapsed: boolean;
  onToggleCollapsed: () => void;
  // Pin depth among parent rows when sticky; absent = not pinned (past the cap).
  stickyLevel?: number;
  consumeClickSuppression?: ConsumeDragClickSuppression;
  dragBindings?: SidebarSortableDragBindings;
  isDropTargetActive?: boolean;
}

// The "Work › Q3" disclosure header for a folder. Not a thread: clicking
// toggles collapse, there is no navigation. It stays visually quieter than a
// project row while still mirroring parent-thread disclosure behavior.
function SidebarFolderRowComponent({
  name,
  pathLabel,
  depth,
  activity,
  consumeClickSuppression,
  dragBindings,
  isDropTargetActive = false,
  isCollapsed,
  onToggleCollapsed,
  stickyLevel,
}: SidebarFolderRowProps) {
  // Collapsed: the header speaks for its hidden descendants through one glyph
  // (pending > working > unread). Expanded: descendants show their own glyphs.
  const showRollupGlyph =
    isCollapsed && (activity.pending || activity.working || activity.unread);
  const className = cn(
    SIDEBAR_HOVER_ACTIONS_ROW_CLASS,
    // Only the non-sticky header needs `relative`; a sticky tier is already a
    // positioned box. Mirrors ThreadRow / EnvironmentThreadGroupHeader.
    stickyLevel === undefined && "relative",
    SIDEBAR_ROW_BASE_CLASS,
    SIDEBAR_ROW_INTERACTIVE_STATE_CLASS,
    COARSE_POINTER_COMPACT_ROW_HEIGHT_CLASS,
    "cursor-pointer",
    dragBindings && !dragBindings.disabled && "select-none",
    isDropTargetActive &&
      "bg-sidebar-accent text-sidebar-accent-foreground ring-1 ring-sidebar-ring",
  );
  const style: CSSProperties = {
    paddingLeft: getSidebarThreadRowPaddingLeft(depth),
  };
  const handleClickCapture = useCallback<MouseEventHandler<HTMLElement>>(
    (event) => {
      if (!consumeClickSuppression?.()) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    },
    [consumeClickSuppression],
  );
  const content = (
    <>
      {/* Full-bleed toggle target for pointer users; the chevron owns keyboard
          focus (mirrors the project row's hidden focus button). */}
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        onClick={onToggleCollapsed}
        className="absolute inset-0 rounded-md outline-none ring-sidebar-ring focus-visible:ring-2"
      />
      <span
        className={cn(
          "pointer-events-none relative z-10 inline-flex shrink-0 items-center justify-center text-subtle-foreground",
          COARSE_POINTER_GLYPH_BOX_CLASS,
        )}
        aria-hidden="true"
      >
        <Icon
          name="FolderTree"
          className={COARSE_POINTER_ICON_SIZE_CLASS}
          aria-hidden="true"
        />
      </span>
      <span className="relative z-10 flex min-w-0 flex-1 items-center gap-1.5 text-left">
        <span className="min-w-0 truncate">{name}</span>
        <SidebarChildToggleChevron
          isCollapsed={isCollapsed}
          expandLabel={`Expand ${pathLabel} folder`}
          collapseLabel={`Collapse ${pathLabel} folder`}
          expandTitle="Expand folder"
          collapseTitle="Collapse folder"
          onToggle={onToggleCollapsed}
        />
      </span>
      <span
        className={cn(
          "relative z-10 shrink-0",
          COARSE_POINTER_ROW_ACTION_SIZE_CLASS,
        )}
      >
        {isDropTargetActive ? (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-end pr-1 text-xs font-medium text-sidebar-accent-foreground">
            Drop inside
          </span>
        ) : showRollupGlyph ? (
          <span
            className={cn(
              SIDEBAR_HOVER_ACTIONS_FADE_CLASS,
              "pointer-events-none absolute inset-0 flex items-center justify-center text-subtle-foreground",
            )}
          >
            <ThreadStatusGlyph
              hasPendingInteraction={activity.pending}
              isBusy={activity.working}
              showUnreadBadge={activity.unread}
              unreadBadgeTone={activity.unreadError ? "error" : "default"}
            />
          </span>
        ) : null}
      </span>
    </>
  );

  if (stickyLevel !== undefined) {
    return (
      <SidebarStickyTier
        ref={dragBindings?.setActivatorNodeRef}
        tier="parent"
        level={stickyLevel}
        className={className}
        style={style}
        title={pathLabel}
        {...dragBindings?.attributes}
        {...(dragBindings?.listeners ?? {})}
        onClickCapture={
          consumeClickSuppression ? handleClickCapture : undefined
        }
      >
        {content}
      </SidebarStickyTier>
    );
  }

  return (
    <div
      ref={dragBindings?.setActivatorNodeRef}
      className={className}
      style={style}
      title={pathLabel}
      {...dragBindings?.attributes}
      {...(dragBindings?.listeners ?? {})}
      onClickCapture={consumeClickSuppression ? handleClickCapture : undefined}
    >
      {content}
    </div>
  );
}

export const SidebarFolderRow = memo(SidebarFolderRowComponent);
