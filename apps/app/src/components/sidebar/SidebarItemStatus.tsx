import type { MouseEvent, ReactNode } from "react";
import { COARSE_POINTER_GLYPH_BOX_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import { cn } from "@bb/shared-ui/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@bb/shared-ui/tooltip";
import {
  SIDEBAR_HOVER_ACTIONS_CLASS,
  SIDEBAR_HOVER_ACTIONS_FADE_CLASS,
} from "@/components/ui/sidebar-hover-actions";
import { SIDEBAR_ROW_GLYPH_SLOT_CLASS } from "./sidebarRowClasses";

interface SidebarItemStatusSlotProps {
  children?: ReactNode;
  hoverAction?: ReactNode;
  onActivate?: () => void;
  status?: string;
  tooltip?: string;
}

/**
 * The fixed status cell shared by sidebar item rows. Empty rows retain the
 * cell so status changes and hover actions never move adjacent content.
 */
export function SidebarItemStatusSlot({
  children,
  hoverAction,
  onActivate,
  status,
  tooltip,
}: SidebarItemStatusSlotProps) {
  const className = cn(
    SIDEBAR_ROW_GLYPH_SLOT_CLASS,
    COARSE_POINTER_GLYPH_BOX_CLASS,
    "relative z-10",
  );

  const statusContent =
    tooltip === undefined ? (
      <span
        data-sidebar-item-status-slot=""
        data-sidebar-item-status={status}
        className={cn(className, "pointer-events-none")}
        aria-hidden={
          children === null || children === undefined ? "true" : undefined
        }
      >
        {children}
      </span>
    ) : (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            data-sidebar-item-status-slot=""
            data-sidebar-item-status={status}
            role="img"
            aria-label={tooltip}
            className={className}
            onClick={(event: MouseEvent<HTMLSpanElement>) => {
              event.preventDefault();
              event.stopPropagation();
              onActivate?.();
            }}
          >
            {children}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top">{tooltip}</TooltipContent>
      </Tooltip>
    );

  if (hoverAction === undefined) return statusContent;

  return (
    <span
      data-sidebar-item-status-action-slot=""
      className="relative z-10 inline-flex shrink-0"
    >
      <span
        className={cn(
          SIDEBAR_HOVER_ACTIONS_FADE_CLASS,
          "inline-flex max-md:pointer-coarse:!opacity-100",
        )}
      >
        {statusContent}
      </span>
      <span
        data-sidebar-item-status-hover-action=""
        className={cn(
          SIDEBAR_HOVER_ACTIONS_CLASS,
          "absolute inset-0 z-20 flex items-center justify-center max-md:pointer-coarse:hidden",
        )}
      >
        {hoverAction}
      </span>
    </span>
  );
}
