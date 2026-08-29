import { findLocalPathProjectSourceForHost } from "@bb/domain";
import type { ProjectResponse } from "@bb/server-contract";
import type { MouseEvent, ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@bb/shared-ui/button";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { COARSE_POINTER_ICON_SIZE_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@bb/shared-ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { CompactLongPressMenu } from "@/components/ui/compact-long-press-menu";
import { usePathPickerHost } from "@/hooks/useLocalPathPicker";
import { getProjectSettingsRoutePath } from "@/lib/route-paths";
import { cn } from "@bb/shared-ui/lib/utils";
import { useProjectActions } from "./ProjectActionsProvider";

interface ProjectActionsMenuBaseProps {
  onCreateThread?: () => void;
  project: ProjectResponse;
}

interface ProjectActionsMenuProps extends ProjectActionsMenuBaseProps {
  triggerClassName?: string;
  onCreateThread?: () => void;
  onOpenChange?: (open: boolean) => void;
}

interface ProjectActionsContextMenuProps extends ProjectActionsMenuBaseProps {
  children: ReactNode;
  onOpenChange?: (open: boolean) => void;
}

type ProjectActionsMenuSurface = "context" | "dropdown";

interface ProjectActionsMenuItemsProps extends ProjectActionsMenuBaseProps {
  onCreateThread?: () => void;
  surface: ProjectActionsMenuSurface;
}

interface ProjectActionMenuItemProps {
  children: ReactNode;
  className?: string;
  variant?: "default" | "destructive";
  icon: IconName;
  onSelect?: (event: Event) => void;
  surface: ProjectActionsMenuSurface;
}

interface ProjectActionMenuSeparatorProps {
  surface: ProjectActionsMenuSurface;
}

function stopProjectActionsMenuClickPropagation(event: MouseEvent) {
  event.stopPropagation();
}

function ProjectActionMenuItem({
  children,
  className,
  variant,
  icon,
  onSelect,
  surface,
}: ProjectActionMenuItemProps) {
  const content = (
    <>
      <Icon name={icon} aria-hidden="true" />
      {children}
    </>
  );

  if (surface === "context") {
    return (
      <ContextMenuItem
        className={cn(
          className,
          variant === "destructive" &&
            "text-destructive focus:bg-destructive/15 focus:text-destructive data-[last-hovered]:bg-destructive/15 data-[last-hovered]:text-destructive",
        )}
        onSelect={onSelect}
      >
        {content}
      </ContextMenuItem>
    );
  }

  return (
    <DropdownMenuItem
      className={className}
      variant={variant}
      onSelect={onSelect}
    >
      {content}
    </DropdownMenuItem>
  );
}

function ProjectActionMenuSeparator({
  surface,
}: ProjectActionMenuSeparatorProps) {
  return surface === "context" ? (
    <ContextMenuSeparator />
  ) : (
    <DropdownMenuSeparator />
  );
}

function ProjectActionsMenuItems({
  onCreateThread,
  project,
  surface,
}: ProjectActionsMenuItemsProps) {
  const navigate = useNavigate();
  const { hostId: pickerHostId } = usePathPickerHost();
  const { requestRename, requestDelete, requestAddLocalPath } =
    useProjectActions();
  const showAddLocalPath =
    pickerHostId != null &&
    !findLocalPathProjectSourceForHost(project.sources, pickerHostId);

  return (
    <>
      {onCreateThread ? (
        <>
          <ProjectActionMenuItem
            surface={surface}
            icon="MessageSquarePlus"
            onSelect={onCreateThread}
          >
            New thread
          </ProjectActionMenuItem>
          <ProjectActionMenuSeparator surface={surface} />
        </>
      ) : null}
      <ProjectActionMenuItem
        surface={surface}
        icon="Settings"
        onSelect={() => {
          navigate(getProjectSettingsRoutePath(project.id));
        }}
      >
        Project settings
      </ProjectActionMenuItem>
      <ProjectActionMenuSeparator surface={surface} />
      <ProjectActionMenuItem
        surface={surface}
        icon="Edit"
        onSelect={() => {
          requestRename(project);
        }}
      >
        Rename
      </ProjectActionMenuItem>
      {showAddLocalPath ? (
        <ProjectActionMenuItem
          surface={surface}
          icon="FolderPlus"
          onSelect={() => {
            requestAddLocalPath(project);
          }}
        >
          Add local path
        </ProjectActionMenuItem>
      ) : null}
      <ProjectActionMenuItem
        surface={surface}
        icon="Trash2"
        variant="destructive"
        onSelect={() => {
          requestDelete(project);
        }}
      >
        Remove
      </ProjectActionMenuItem>
    </>
  );
}

export function ProjectActionsMenu({
  onCreateThread,
  project,
  triggerClassName,
  onOpenChange,
}: ProjectActionsMenuProps) {
  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(
            "rounded-md p-0 text-muted-foreground",
            triggerClassName,
            "data-[state=open]:bg-state-active data-[state=open]:text-foreground",
          )}
          aria-label={`${project.name} actions`}
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
      <DropdownMenuContent
        align="end"
        onClick={stopProjectActionsMenuClickPropagation}
      >
        <ProjectActionsMenuItems
          project={project}
          onCreateThread={onCreateThread}
          surface="dropdown"
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ProjectActionsContextMenu(
  props: ProjectActionsContextMenuProps,
) {
  const isCompactViewport = useIsCompactViewport();
  if (isCompactViewport) {
    return <ProjectActionsCompactLongPressMenu {...props} />;
  }
  return <ProjectActionsDesktopContextMenu {...props} />;
}

function ProjectActionsCompactLongPressMenu({
  children,
  onCreateThread,
  project,
  onOpenChange,
}: ProjectActionsContextMenuProps) {
  return (
    <CompactLongPressMenu
      label={`${project.name} actions`}
      onOpenChange={onOpenChange}
      items={
        <ProjectActionsMenuItems
          project={project}
          onCreateThread={onCreateThread}
          surface="dropdown"
        />
      }
    >
      {children}
    </CompactLongPressMenu>
  );
}

function ProjectActionsDesktopContextMenu({
  children,
  onCreateThread,
  project,
  onOpenChange,
}: ProjectActionsContextMenuProps) {
  return (
    <ContextMenu onOpenChange={onOpenChange}>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent
        aria-label={`${project.name} actions`}
        onClick={stopProjectActionsMenuClickPropagation}
      >
        <ProjectActionsMenuItems
          project={project}
          onCreateThread={onCreateThread}
          surface="context"
        />
      </ContextMenuContent>
    </ContextMenu>
  );
}
