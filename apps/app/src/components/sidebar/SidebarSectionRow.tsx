import {
  memo,
  useCallback,
  useState,
  type MouseEvent,
  type MouseEventHandler,
} from "react";
import { Button } from "@bb/shared-ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { Icon } from "@bb/shared-ui/icon";
import { SidebarStickyTier } from "@/components/ui/sidebar.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "@bb/shared-ui/tooltip";
import {
  COARSE_POINTER_ICON_SIZE_CLASS,
  COARSE_POINTER_ROW_ACTION_SIZE_CLASS,
} from "@bb/shared-ui/coarse-pointer-sizing";
import { LIST_HOVER_TRANSITION } from "@bb/shared-ui/motion";
import {
  SIDEBAR_COLLAPSIBLE_TRAILING_CONTROLS_CLASS,
  SIDEBAR_HOVER_ACTIONS_CLASS,
  SIDEBAR_HOVER_ACTIONS_GAP_CLASS,
  SIDEBAR_HOVER_ACTIONS_MOBILE_ALWAYS_VALUE,
  SIDEBAR_HOVER_ACTIONS_ROW_CLASS,
} from "@/components/ui/sidebar-hover-actions.js";
import { cn } from "@bb/shared-ui/lib/utils";
import type { CollapsedChildActivity } from "@bb/client-core";
import {
  SIDEBAR_MORE_ACTION_TRIGGER_CLASS,
  SIDEBAR_ROW_STATIC_STATE_CLASS,
} from "./sidebarRowClasses";
import { SidebarChildToggleChevron } from "./SidebarChildToggleChevron";
import { CollapsedThreadStatusGlyph } from "./ThreadRow";
import type { SidebarSortableDragBindings } from "./sortableMotion";
import type { ConsumeDragClickSuppression } from "@/components/ui/use-drag-click-suppression";
import {
  useThreadGroupSplitIndicator,
  type ThreadSplitIndicatorTarget,
} from "./paneContentSplitIndicator";
import { SplitPaneMiniMap } from "./SplitPaneMiniMap";
import { usePluginThreadRowStatusForThreads } from "@/lib/plugin-thread-row-status";
import { SidebarItemStatusSlot } from "./SidebarItemStatus";
import {
  SidebarRow,
  SidebarRowActions,
  SidebarRowContent,
  SidebarRowDisclosureRail,
  SidebarRowStatusRail,
} from "./SidebarRow";

const EMPTY_SPLIT_INDICATOR_THREADS: readonly ThreadSplitIndicatorTarget[] = [];

function stopActionsClick(event: MouseEvent<HTMLElement>) {
  event.stopPropagation();
}

interface SidebarSectionRowProps {
  name: string;
  label: string;
  depth: number;
  activity: CollapsedChildActivity;
  collapsedThreads?: readonly ThreadSplitIndicatorTarget[];
  isCollapsed: boolean;
  onToggleCollapsed: () => void;
  stickyLevel?: number;
  consumeClickSuppression?: ConsumeDragClickSuppression;
  dragBindings?: SidebarSortableDragBindings;
  isDropTargetActive?: boolean;
  onCreateThread?: () => void;
  onRename?: () => void;
  onRemove?: () => void;
}

function SidebarSectionRowComponent({
  name,
  label,
  depth,
  activity,
  collapsedThreads = EMPTY_SPLIT_INDICATOR_THREADS,
  consumeClickSuppression,
  dragBindings,
  isDropTargetActive = false,
  isCollapsed,
  onToggleCollapsed,
  onCreateThread,
  onRename,
  onRemove,
  stickyLevel,
}: SidebarSectionRowProps) {
  const [isActionsOpen, setIsActionsOpen] = useState(false);
  const collapsedSplitIndicator = useThreadGroupSplitIndicator(
    collapsedThreads,
    isCollapsed,
  );
  const pluginStatus = usePluginThreadRowStatusForThreads(collapsedThreads);
  const hasMenuActions = Boolean(onCreateThread || onRename || onRemove);
  const hasActions = hasMenuActions;
  const showRollupIndicator =
    isCollapsed &&
    (collapsedSplitIndicator.miniMap !== null ||
      activity.pending ||
      activity.working ||
      activity.hasUnsubmittedDraft ||
      activity.unread ||
      activity.unreadError ||
      pluginStatus !== null);
  const renderRollupIndicator = () =>
    collapsedSplitIndicator.miniMap ? (
      <SplitPaneMiniMap
        slots={collapsedSplitIndicator.miniMap}
        label={`${label} — contains a thread open in split`}
        isWorking={activity.working || pluginStatus?.tone === "running"}
      />
    ) : (
      <CollapsedThreadStatusGlyph
        activity={activity}
        pluginStatus={pluginStatus}
      />
    );
  const className = cn(
    SIDEBAR_HOVER_ACTIONS_ROW_CLASS,
    stickyLevel === undefined && "relative",
    LIST_HOVER_TRANSITION,
    SIDEBAR_ROW_STATIC_STATE_CLASS,
    dragBindings && !dragBindings.disabled && "select-none",
    isDropTargetActive && "bg-sidebar-accent text-sidebar-accent-foreground",
  );
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
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        onClick={onToggleCollapsed}
        className="absolute inset-0 rounded-md outline-none ring-sidebar-ring focus-visible:ring-2"
      />
      <SidebarRowStatusRail
        data-sidebar-group-status-slot=""
        className="relative z-10"
      >
        <SidebarItemStatusSlot
          status={showRollupIndicator ? "collapsed-rollup" : "none"}
        >
          {showRollupIndicator ? renderRollupIndicator() : null}
        </SidebarItemStatusSlot>
      </SidebarRowStatusRail>
      <SidebarRowContent className="relative z-10 flex items-center text-left">
        <span className="min-w-0 truncate">{name}</span>
      </SidebarRowContent>
      {hasActions ? (
        <SidebarRowActions
          data-sidebar-collapsible-trailing-controls=""
          className={cn(
            SIDEBAR_COLLAPSIBLE_TRAILING_CONTROLS_CLASS,
            "relative z-10 inline-flex shrink-0 items-center",
          )}
        >
          <span
            data-sidebar-hover-actions-open={isActionsOpen ? "true" : undefined}
            data-sidebar-hover-actions-mobile={
              SIDEBAR_HOVER_ACTIONS_MOBILE_ALWAYS_VALUE
            }
            className={cn(
              SIDEBAR_HOVER_ACTIONS_CLASS,
              "relative z-10 inline-flex shrink-0 items-center",
              SIDEBAR_HOVER_ACTIONS_GAP_CLASS,
            )}
            onClick={stopActionsClick}
          >
            {onCreateThread ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`New thread in ${label}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onCreateThread();
                    }}
                    className={cn(
                      "rounded-md p-0 text-subtle-foreground hover:bg-transparent hover:text-foreground max-md:pointer-coarse:hidden",
                      COARSE_POINTER_ROW_ACTION_SIZE_CLASS,
                    )}
                  >
                    <Icon
                      name="MessageSquarePlus"
                      className={COARSE_POINTER_ICON_SIZE_CLASS}
                    />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">New thread</TooltipContent>
              </Tooltip>
            ) : null}
            {hasMenuActions ? (
              <DropdownMenu onOpenChange={setIsActionsOpen}>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`${label} section actions`}
                    className={cn(
                      "rounded-md p-0 text-subtle-foreground hover:bg-transparent hover:text-foreground",
                      SIDEBAR_MORE_ACTION_TRIGGER_CLASS,
                    )}
                  >
                    <Icon
                      name="MoreHorizontal"
                      className={COARSE_POINTER_ICON_SIZE_CLASS}
                    />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {onCreateThread ? (
                    <DropdownMenuItem onSelect={onCreateThread}>
                      <Icon name="MessageSquarePlus" aria-hidden="true" />
                      New thread
                    </DropdownMenuItem>
                  ) : null}
                  {onCreateThread && (onRename || onRemove) ? (
                    <DropdownMenuSeparator />
                  ) : null}
                  {onRename ? (
                    <DropdownMenuItem onSelect={onRename}>
                      <Icon name="Edit" aria-hidden="true" />
                      Rename
                    </DropdownMenuItem>
                  ) : null}
                  {onRemove ? (
                    <DropdownMenuItem variant="destructive" onSelect={onRemove}>
                      <Icon name="Trash2" aria-hidden="true" />
                      Remove
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </span>
        </SidebarRowActions>
      ) : null}
      <SidebarRowDisclosureRail data-sidebar-collapse-caret-slot="">
        <SidebarChildToggleChevron
          isCollapsed={isCollapsed}
          expandLabel={`Expand ${label} section`}
          collapseLabel={`Collapse ${label} section`}
          onToggle={onToggleCollapsed}
        />
      </SidebarRowDisclosureRail>
    </>
  );

  if (stickyLevel !== undefined) {
    return (
      <SidebarRow
        asChild
        depth={depth}
        density="compact"
        variant="groupLabel"
      >
        <SidebarStickyTier
          ref={dragBindings?.setActivatorNodeRef}
          tier="parent"
          level={stickyLevel}
          className={className}
          {...dragBindings?.attributes}
          {...(dragBindings?.listeners ?? {})}
          onClickCapture={
            consumeClickSuppression ? handleClickCapture : undefined
          }
        >
          {content}
        </SidebarStickyTier>
      </SidebarRow>
    );
  }

  return (
    <SidebarRow
      asChild
      depth={depth}
      density="compact"
      variant="groupLabel"
    >
      <div
        ref={dragBindings?.setActivatorNodeRef}
        className={className}
        {...dragBindings?.attributes}
        {...(dragBindings?.listeners ?? {})}
        onClickCapture={
          consumeClickSuppression ? handleClickCapture : undefined
        }
      >
        {content}
      </div>
    </SidebarRow>
  );
}

export const SidebarSectionRow = memo(SidebarSectionRowComponent);
