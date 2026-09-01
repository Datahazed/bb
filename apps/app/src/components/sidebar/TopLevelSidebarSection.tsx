import {
  useCallback,
  type CSSProperties,
  type KeyboardEventHandler,
  type MouseEvent,
  type MouseEventHandler,
  type PointerEventHandler,
  type ReactNode,
} from "react";
import { cn } from "@bb/shared-ui/lib/utils";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { COARSE_POINTER_ICON_SIZE_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import { LIST_HOVER_TRANSITION } from "@bb/shared-ui/motion";
import {
  SidebarStickyGroup,
  SidebarStickyTier,
} from "@/components/ui/sidebar.js";
import {
  SIDEBAR_COLLAPSIBLE_TRAILING_CONTROLS_CLASS,
  SIDEBAR_HOVER_ACTIONS_CLASS,
  SIDEBAR_HOVER_ACTIONS_GAP_CLASS,
  SIDEBAR_HOVER_ACTIONS_MOBILE_ALWAYS_VALUE,
  SIDEBAR_HOVER_ACTIONS_ROW_CLASS,
} from "@/components/ui/sidebar-hover-actions.js";
import type { ConsumeDragClickSuppression } from "@/components/ui/use-drag-click-suppression";
import type { SidebarSortableDragBindings } from "./sortableMotion";
import {
  NO_COLLAPSED_CHILD_ACTIVITY,
  type CollapsedChildActivity,
} from "@bb/client-core";
import { CollapsedThreadStatusGlyph } from "./ThreadRow";
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
  SidebarRowBody,
  SidebarRowContent,
  SidebarRowDisclosureRail,
  SidebarRowIdentityRail,
  SidebarRowStatusRail,
  type SidebarRowVariant,
} from "./SidebarRow";

const EMPTY_SPLIT_INDICATOR_THREADS: readonly ThreadSplitIndicatorTarget[] = [];

function stopActionsClick(event: MouseEvent<HTMLSpanElement>) {
  event.stopPropagation();
}

interface TopLevelSidebarSectionCollapseControl {
  isCollapsed: boolean;
  onToggleCollapsed: () => void;
}

export interface TopLevelSidebarSectionProps {
  label: string;
  leadingIcon?: IconName;
  children: ReactNode;
  sectionId?: string;
  actions?: ReactNode;
  actionsAlwaysVisible?: boolean;
  actionsMobileAlways?: boolean;
  actionsOpen?: boolean;
  collapseControl?: TopLevelSidebarSectionCollapseControl;
  collapsedActivity?: CollapsedChildActivity;
  collapsedThreads?: readonly ThreadSplitIndicatorTarget[];
  dragBindings?: SidebarSortableDragBindings;
  sectionRef?: (element: HTMLDivElement | null) => void;
  sectionStyle?: CSSProperties;
  consumeClickSuppression?: ConsumeDragClickSuppression;
  isDropTargetActive?: boolean;
  rowVariant?: SidebarRowVariant;
}

export function TopLevelSidebarSection({
  label,
  leadingIcon,
  children,
  sectionId,
  actions,
  actionsAlwaysVisible = false,
  actionsMobileAlways = false,
  actionsOpen = false,
  collapseControl,
  collapsedActivity,
  collapsedThreads = EMPTY_SPLIT_INDICATOR_THREADS,
  dragBindings,
  sectionRef,
  sectionStyle,
  consumeClickSuppression,
  isDropTargetActive = false,
  rowVariant = "groupLabel",
}: TopLevelSidebarSectionProps) {
  const collapsedSplitIndicator = useThreadGroupSplitIndicator(
    collapsedThreads,
    collapseControl?.isCollapsed === true,
  );
  const pluginStatus = usePluginThreadRowStatusForThreads(collapsedThreads);
  const handleClickCapture = useCallback<MouseEventHandler<HTMLDivElement>>(
    (event) => {
      if (!consumeClickSuppression?.()) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    },
    [consumeClickSuppression],
  );
  const handleCollapseControlClick = useCallback<
    MouseEventHandler<HTMLButtonElement>
  >(
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      collapseControl?.onToggleCollapsed();
    },
    [collapseControl],
  );
  const stopCollapseControlPointerDown = useCallback<
    PointerEventHandler<HTMLButtonElement>
  >((event) => {
    event.stopPropagation();
  }, []);
  const stopCollapseControlKeyDown = useCallback<
    KeyboardEventHandler<HTMLButtonElement>
  >((event) => {
    event.stopPropagation();
  }, []);
  const showCollapsedIndicator =
    collapseControl?.isCollapsed === true &&
    (collapsedSplitIndicator.miniMap !== null ||
      collapsedActivity !== undefined ||
      pluginStatus !== null);
  const renderCollapsedIndicator = () =>
    collapsedSplitIndicator.miniMap ? (
      <SplitPaneMiniMap
        slots={collapsedSplitIndicator.miniMap}
        label={`${label} — contains a thread open in split`}
        isWorking={
          collapsedActivity?.working || pluginStatus?.tone === "running"
        }
      />
    ) : collapsedActivity || pluginStatus ? (
      <CollapsedThreadStatusGlyph
        activity={collapsedActivity ?? NO_COLLAPSED_CHILD_ACTIVITY}
        pluginStatus={pluginStatus}
      />
    ) : null;

  return (
    <SidebarStickyGroup
      ref={sectionRef}
      style={sectionStyle}
      data-sidebar-section-id={sectionId}
      className={cn(
        "group/sidebar-section min-w-0 rounded-md transition-colors",
        isDropTargetActive && "bg-sidebar-accent/60",
      )}
      onClickCapture={handleClickCapture}
    >
      <SidebarRow asChild density="label" variant={rowVariant}>
        <SidebarStickyTier
          ref={dragBindings?.setActivatorNodeRef}
          tier="label"
          className={cn(
            SIDEBAR_HOVER_ACTIONS_ROW_CLASS,
            "rounded-md pr-0 transition-colors",
            dragBindings && !dragBindings.disabled && "select-none",
          )}
          {...dragBindings?.attributes}
          {...(dragBindings?.listeners ?? {})}
        >
          <SidebarRowStatusRail
            data-sidebar-group-status-slot=""
            className="relative z-20 inline-flex shrink-0 items-center"
          >
            {collapseControl ? (
              <SidebarItemStatusSlot
                status={showCollapsedIndicator ? "collapsed-rollup" : "none"}
              >
                {showCollapsedIndicator ? renderCollapsedIndicator() : null}
              </SidebarItemStatusSlot>
            ) : null}
          </SidebarRowStatusRail>
          <SidebarRowBody>
            {leadingIcon ? (
              <SidebarRowIdentityRail className="relative z-10 text-subtle-foreground">
                <Icon
                  name={leadingIcon}
                  className={COARSE_POINTER_ICON_SIZE_CLASS}
                  aria-hidden="true"
                />
              </SidebarRowIdentityRail>
            ) : null}
            <SidebarRowContent className="relative z-10 flex items-center text-left">
              <span className="min-w-0 truncate" title={label}>
                {label}
              </span>
            </SidebarRowContent>
          </SidebarRowBody>
          {actions ? (
            <SidebarRowActions
              data-sidebar-collapsible-trailing-controls=""
              className={cn(
                SIDEBAR_COLLAPSIBLE_TRAILING_CONTROLS_CLASS,
                "relative z-20 h-6",
              )}
              onClick={stopActionsClick}
            >
              <span
                data-sidebar-hover-actions-open={
                  actionsOpen ? "true" : undefined
                }
                data-sidebar-hover-actions-mobile={
                  actionsMobileAlways
                    ? SIDEBAR_HOVER_ACTIONS_MOBILE_ALWAYS_VALUE
                    : undefined
                }
                className={cn(
                  "inline-flex shrink-0 items-center",
                  SIDEBAR_HOVER_ACTIONS_GAP_CLASS,
                  !actionsAlwaysVisible && SIDEBAR_HOVER_ACTIONS_CLASS,
                )}
              >
                {actions}
              </span>
            </SidebarRowActions>
          ) : null}
          {collapseControl ? (
            <SidebarRowDisclosureRail data-sidebar-collapse-caret-slot="">
              <button
                type="button"
                data-sidebar-collapse-caret=""
                aria-expanded={!collapseControl.isCollapsed}
                data-sidebar-hover-actions-mobile={
                  SIDEBAR_HOVER_ACTIONS_MOBILE_ALWAYS_VALUE
                }
                aria-label={
                  collapseControl.isCollapsed
                    ? `Expand ${label} section`
                    : `Collapse ${label} section`
                }
                className={cn(
                  "relative z-20 inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-subtle-foreground/75 outline-none ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2",
                  LIST_HOVER_TRANSITION,
                )}
                onClick={handleCollapseControlClick}
                onPointerDown={stopCollapseControlPointerDown}
                onKeyDown={stopCollapseControlKeyDown}
              >
                <Icon
                  name="ChevronRight"
                  className={cn(
                    "size-3 transition-transform duration-150",
                    !collapseControl.isCollapsed && "rotate-90",
                  )}
                  aria-hidden="true"
                />
              </button>
            </SidebarRowDisclosureRail>
          ) : null}
        </SidebarStickyTier>
      </SidebarRow>
      {collapseControl?.isCollapsed || children == null ? null : (
        <div className="mt-1">{children}</div>
      )}
    </SidebarStickyGroup>
  );
}
