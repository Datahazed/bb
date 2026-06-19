import {
  memo,
  useCallback,
  useMemo,
  useState,
  type CSSProperties,
  type MouseEventHandler,
  type ReactNode,
} from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { DndContext, type DragEndEvent } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { PERSONAL_PROJECT_ID, type ThreadListEntry } from "@bb/domain";
import type { ProjectResponse } from "@bb/server-contract";
import { NavLink, useNavigate } from "react-router-dom";
import { useCreateThreadInWorktree } from "@/hooks/useCreateThreadInWorktree";
import { usePromptDraftHasInput } from "@/hooks/usePromptDraftStorage";
import {
  useArchiveEnvironmentThreads,
  useUpdateEnvironment,
} from "@/hooks/mutations/environment-mutations";
import { useUpdateThread } from "@/hooks/mutations/thread-state-mutations";
import { useDialogState } from "@/hooks/useDialogState";
import { Button } from "@/components/ui/button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js";
import { EmptyState } from "@/components/ui/empty-state.js";
import { Icon, type IconName } from "@/components/ui/icon.js";
import {
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarStickyGroup,
  SidebarStickyTier,
} from "@/components/ui/sidebar.js";
import {
  ProjectActionsContextMenu,
  ProjectActionsMenu,
} from "@/components/project/ProjectActionsMenu";
import {
  EnvironmentRenameDialog,
  type EnvironmentRenameDialogTarget,
} from "@/components/dialogs/EnvironmentRenameDialog";
import {
  COARSE_POINTER_COMPACT_ROW_HEIGHT_CLASS,
  COARSE_POINTER_GLYPH_BOX_CLASS,
  COARSE_POINTER_ICON_SIZE_CLASS,
  COARSE_POINTER_ROW_ACTION_SIZE_CLASS,
} from "@/components/ui/coarse-pointer-sizing.js";
import {
  SIDEBAR_HOVER_ACTIONS_CLASS,
  SIDEBAR_HOVER_ACTIONS_FADE_CLASS,
  SIDEBAR_HOVER_ACTIONS_GAP_CLASS,
  SIDEBAR_HOVER_ACTIONS_MOBILE_ALWAYS_VALUE,
  SIDEBAR_HOVER_ACTIONS_ROW_CLASS,
} from "@/components/ui/sidebar-hover-actions.js";
import type { CollapsedChildActivity } from "@/lib/thread-activity";
import { cn } from "@/lib/utils";
import { getMutationErrorMessage } from "@/lib/mutation-errors";
import { getProjectSettingsRoutePath } from "@/lib/route-paths";
import { getThreadDisplayTitle } from "@/lib/thread-title";
import { appToast } from "@/components/ui/app-toast";
import {
  ThreadRow,
  ThreadStatusGlyph,
  type ThreadRowOptions,
} from "./ThreadRow";
import {
  buildChronologicalThreadList,
  buildProjectThreadGroups,
  CHRONOLOGICAL_CONTAINER_ID,
  getManualOrderItemKey,
  type EnvironmentThreadGroup,
  type ProjectThreadItem,
  type ProjectThreadNode,
  type SidebarFolderGroup,
  type ThreadComparator,
} from "./projectThreadGroups";
import { SidebarFolderRow } from "./SidebarFolderRow";
import {
  formatFolderPathLabel,
  normalizeFolderPath,
  splitFolderPath,
} from "./folderPath";
import { sidebarCollapsedFoldersAtom } from "./sidebarCollapsedAtoms";
import {
  SIDEBAR_PROJECT_GROUP_LINE_CLASS,
  SIDEBAR_ROW_BASE_CLASS,
  SIDEBAR_ROW_INTERACTIVE_STATE_CLASS,
  SIDEBAR_ROW_SELECTED_STATE_CLASS,
  getSidebarThreadGroupLineLeft,
  getSidebarThreadRowPaddingLeft,
} from "./sidebarRowClasses";
import {
  useSidebarSortable,
  type SidebarSortableDragBindings,
} from "./sortableMotion";
import type { ConsumeDragClickSuppression } from "@/components/ui/use-drag-click-suppression";
import { SidebarChildToggleChevron } from "./SidebarChildToggleChevron";
import type { SidebarReorderDndContextProps } from "./useSidebarReorderDnd";
import { useSidebarReorderDnd } from "./useSidebarReorderDnd";

// Pin the project row plus this many parent levels (parent threads,
// worktree group headers); rows deeper than the cap render non-sticky so a deep
// chain can't pin more ancestors than a short viewport can hold.
const SIDEBAR_STICKY_PARENT_DEPTH_CAP = 4;

export type ProjectThreadListState =
  | {
      status: "loading";
    }
  | {
      status: "ready";
      threads: ThreadListEntry[];
    }
  | {
      status: "unavailable";
    };

export interface ProjectRowProps {
  project: ProjectResponse;
  threadListState: ProjectThreadListState;
  folderPaths?: readonly string[];
  selectedThreadId?: string;
  isActive: boolean;
  isCollapsed: boolean;
  compareThreads: ThreadComparator;
  collapsedThreadIds: Set<string>;
  collapsedEnvironmentIds: Set<string>;
  isLocalPathInvalid: boolean;
  onProjectSelect?: () => void;
  onCreateProjectThread?: (projectId: string) => void;
  onToggleProjectCollapsed: (projectId: string) => void;
  onToggleThreadCollapsed: (threadId: string) => void;
  onToggleEnvironmentCollapsed: (environmentId: string) => void;
  consumeProjectClickSuppression?: ConsumeDragClickSuppression;
  projectDragBindings?: SidebarSortableDragBindings;
  projectRowRef?: (element: HTMLLIElement | null) => void;
  projectRowStyle?: CSSProperties;
}

export interface ProjectThreadTreeProps {
  projectId: string;
  threadListState: ProjectThreadListState;
  compareThreads: ThreadComparator;
  folderPaths?: readonly string[];
  selectedThreadId?: string;
  collapsedThreadIds: Set<string>;
  collapsedEnvironmentIds: Set<string>;
  variant: ProjectThreadTreeVariant;
  onProjectSelect?: () => void;
  onToggleThreadCollapsed: (threadId: string) => void;
  onToggleEnvironmentCollapsed: (environmentId: string) => void;
}

export interface ChronologicalThreadTreeProps {
  threadListState: ProjectThreadListState;
  compareThreads: ThreadComparator;
  folderPaths?: readonly string[];
  selectedThreadId?: string;
  collapsedThreadIds: Set<string>;
  collapsedEnvironmentIds: Set<string>;
  onProjectSelect?: () => void;
  onToggleThreadCollapsed: (threadId: string) => void;
  onToggleEnvironmentCollapsed: (environmentId: string) => void;
}

export type ProjectThreadTreeVariant = "project" | "section";

type ProjectItemClickCaptureHandler = MouseEventHandler<HTMLLIElement>;
type ProjectThreadListClickCaptureHandler = MouseEventHandler<HTMLDivElement>;

const EMPTY_PROJECT_THREADS: ThreadListEntry[] = [];
const EMPTY_FOLDER_PATHS: readonly string[] = [];
const PROJECT_ROW_LEADING_SLOT_CLASS =
  "h-7 w-8 max-md:pointer-coarse:h-10 max-md:pointer-coarse:w-10";

interface ProjectThreadTreeGroupProps {
  children: ReactNode;
  variant: ProjectThreadTreeVariant;
  onClickCapture?: ProjectThreadListClickCaptureHandler;
}

interface ThreadTreeNodeRowProps {
  projectId: string;
  node: ProjectThreadNode;
  depthOffset: number;
  isEnvGrouped: boolean;
  selectedThreadId?: string;
  collapsedThreadIds: Set<string>;
  collapsedEnvironmentIds: Set<string>;
  variant: ProjectThreadTreeVariant;
  onProjectSelect?: () => void;
  onToggleThreadCollapsed: (threadId: string) => void;
  onToggleEnvironmentCollapsed: (environmentId: string) => void;
  consumeClickSuppression?: ConsumeDragClickSuppression;
  dragBindings?: SidebarSortableDragBindings;
  sortableRef?: (element: HTMLDivElement | null) => void;
  sortableStyle?: CSSProperties;
  // True when this row is a direct member of a folder: show the leaf, keep the
  // full path for a11y. Its own child threads stay full-titled.
  insideFolder?: boolean;
}

interface ThreadTreeItemRowProps {
  projectId: string;
  item: ProjectThreadItem;
  depthOffset: number;
  // True for the direct members of a folder, so thread rows show the leaf.
  insideFolder?: boolean;
  selectedThreadId?: string;
  collapsedThreadIds: Set<string>;
  collapsedEnvironmentIds: Set<string>;
  variant: ProjectThreadTreeVariant;
  onProjectSelect?: () => void;
  onToggleThreadCollapsed: (threadId: string) => void;
  onToggleEnvironmentCollapsed: (environmentId: string) => void;
  consumeClickSuppression?: ConsumeDragClickSuppression;
  dragBindings?: SidebarSortableDragBindings;
  manualSort?: ManualThreadTreeDndState;
  sortableRef?: (element: HTMLDivElement | null) => void;
  sortableStyle?: CSSProperties;
}

interface FolderTreeItemRowProps {
  folder: SidebarFolderGroup;
  depthOffset: number;
  selectedThreadId?: string;
  collapsedThreadIds: Set<string>;
  collapsedEnvironmentIds: Set<string>;
  variant: ProjectThreadTreeVariant;
  onProjectSelect?: () => void;
  onToggleThreadCollapsed: (threadId: string) => void;
  onToggleEnvironmentCollapsed: (environmentId: string) => void;
  consumeClickSuppression?: ConsumeDragClickSuppression;
  dragBindings?: SidebarSortableDragBindings;
  manualSort?: ManualThreadTreeDndState;
  sortableRef?: (element: HTMLDivElement | null) => void;
  sortableStyle?: CSSProperties;
}

interface ManualThreadTreeDndState {
  consumeClickSuppression: ConsumeDragClickSuppression;
  dndContextProps: SidebarReorderDndContextProps;
  enabled: boolean;
  itemIdsByParentKey: ReadonlyMap<string, readonly string[]>;
  onClickCapture: MouseEventHandler<HTMLElement>;
}

interface UseManualThreadTreeDndArgs {
  containerId: string;
  enabled: boolean;
  rootItems: readonly ProjectThreadItem[];
}

type ManualSortableItemKind = "thread" | "folder" | "environment";

interface ManualThreadTreeLookup {
  folderPathByParentKey: Map<string, readonly string[]>;
  itemIdsByParentKey: Map<string, string[]>;
  itemKindById: Map<string, ManualSortableItemKind>;
  parentKeyByItemId: Map<string, string>;
  threadByItemId: Map<string, ThreadListEntry>;
}

// Render key + routing projectId for any item kind. Folders derive from their
// first nested item, so a folder spanning projects (chronological) still routes
// each contained thread to its own project.
export function getItemKey(item: ProjectThreadItem): string {
  switch (item.kind) {
    case "thread":
      return `thread:${item.node.thread.id}`;
    case "environment":
      return `env:${item.group.environmentId}`;
    case "folder":
      return `folder:${item.group.key}`;
  }
}

export function getItemProjectId(item: ProjectThreadItem): string {
  switch (item.kind) {
    case "thread":
      return item.node.thread.projectId;
    case "environment":
      return item.group.nodes[0].thread.projectId;
    case "folder":
      if (item.group.items.length === 0) {
        return PERSONAL_PROJECT_ID;
      }
      return getItemProjectId(item.group.items[0]);
  }
}

function getManualSortableItemKind(
  item: ProjectThreadItem,
): ManualSortableItemKind {
  return item.kind;
}

function collectManualThreadTreeLookup(
  items: readonly ProjectThreadItem[],
  containerId: string,
): ManualThreadTreeLookup {
  const lookup: ManualThreadTreeLookup = {
    folderPathByParentKey: new Map([[containerId, []]]),
    itemIdsByParentKey: new Map(),
    itemKindById: new Map(),
    parentKeyByItemId: new Map(),
    threadByItemId: new Map(),
  };

  const walk = (
    siblingItems: readonly ProjectThreadItem[],
    parentKey: string,
  ) => {
    const itemIds = siblingItems.map(getManualOrderItemKey);
    lookup.itemIdsByParentKey.set(parentKey, itemIds);

    for (const item of siblingItems) {
      const itemId = getManualOrderItemKey(item);
      lookup.itemKindById.set(itemId, getManualSortableItemKind(item));
      lookup.parentKeyByItemId.set(itemId, parentKey);

      if (item.kind === "thread") {
        lookup.threadByItemId.set(itemId, item.node.thread);
      } else if (item.kind === "folder") {
        lookup.folderPathByParentKey.set(item.group.key, item.group.path);
        walk(item.group.items, item.group.key);
      }
    }
  };

  walk(items, containerId);
  return lookup;
}

function hasFolderItems(items: readonly ProjectThreadItem[]): boolean {
  return items.some(
    (item) =>
      item.kind === "folder" ||
      (item.kind === "thread" && hasFolderItems(item.node.children)) ||
      (item.kind === "environment" &&
        item.group.nodes.some((node) => hasFolderItems(node.children))),
  );
}

function useManualThreadTreeDnd({
  containerId,
  enabled,
  rootItems,
}: UseManualThreadTreeDndArgs): ManualThreadTreeDndState | null {
  const lookup = useMemo(
    () => collectManualThreadTreeLookup(rootItems, containerId),
    [containerId, rootItems],
  );
  const updateThread = useUpdateThread();

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      if (!enabled) return;

      const { active, over } = event;
      if (
        !over ||
        typeof active.id !== "string" ||
        typeof over.id !== "string"
      ) {
        return;
      }

      const activeId = active.id;
      const overId = over.id;
      if (activeId === overId) return;

      const activeKind = lookup.itemKindById.get(activeId);
      const overKind = lookup.itemKindById.get(overId);
      const fromParentKey = lookup.parentKeyByItemId.get(activeId);
      let toParentKey = lookup.parentKeyByItemId.get(overId);

      if (!activeKind || !overKind || !fromParentKey || !toParentKey) {
        return;
      }

      // Dropping a thread on a folder header means "move into this folder".
      if (activeKind === "thread" && overKind === "folder") {
        toParentKey = overId;
      }

      if (activeKind !== "thread" || fromParentKey === toParentKey) {
        return;
      }

      const thread = lookup.threadByItemId.get(activeId);
      if (!thread) return;

      const destinationFolderPath = normalizeFolderPath(
        (lookup.folderPathByParentKey.get(toParentKey) ?? []).join("/"),
      );
      updateThread.mutate({ id: activeId, folderPath: destinationFolderPath });
    },
    [enabled, lookup, updateThread],
  );

  const { consumeClickSuppression, dndContextProps, onClickCapture } =
    useSidebarReorderDnd({ onDragEnd: handleDragEnd });

  if (!enabled) {
    return null;
  }

  return {
    consumeClickSuppression,
    dndContextProps,
    enabled,
    itemIdsByParentKey: lookup.itemIdsByParentKey,
    onClickCapture,
  };
}

interface EnvironmentThreadGroupRowProps {
  projectId: string;
  environmentThreadGroup: EnvironmentThreadGroup;
  depthOffset: number;
  selectedThreadId?: string;
  isCollapsed: boolean;
  collapsedThreadIds: Set<string>;
  collapsedEnvironmentIds: Set<string>;
  variant: ProjectThreadTreeVariant;
  onProjectSelect?: () => void;
  onToggleThreadCollapsed: (threadId: string) => void;
  onToggleEnvironmentCollapsed: (environmentId: string) => void;
}

interface ThreadTreeGroupLineProps {
  parentRowDepth: number;
}

interface ThreadTreeLineContinuationProps {
  parentRowDepth: number;
}

interface GetThreadNodeStickyLevelArgs {
  depthOffset: number;
  node: ProjectThreadNode;
}

interface EnvironmentThreadGroupHeaderProps {
  environmentId: string;
  representativeThread: ThreadListEntry;
  rowDepth: number;
  stickyLevel?: number;
  parentLineDepth?: number;
  childActivity: CollapsedChildActivity;
  isCollapsed: boolean;
  archiveThreadsPending?: boolean;
  onArchiveThreads?: () => void;
  onCreateNewThread?: () => void;
  onRenameEnvironment?: () => void;
  onToggleCollapsed: (environmentId: string) => void;
}

interface EnvironmentThreadGroupHeaderActionsProps {
  archiveThreadsPending: boolean;
  onArchiveThreads?: () => void;
  onCreateNewThread?: () => void;
  onRenameEnvironment?: () => void;
  onOpenChange: (open: boolean) => void;
}

interface UseArchiveEnvironmentThreadGroupActionArgs {
  environmentId: string;
  projectId: string;
  selectedThreadId?: string;
  threads: readonly ThreadListEntry[];
}

interface UseArchiveEnvironmentThreadGroupActionResult {
  archiveThreadsPending: boolean;
  onArchiveThreads: () => void;
}

interface UseEnvironmentThreadGroupRenameActionArgs {
  environmentId: string;
  representativeThread: ThreadListEntry;
}

interface UseEnvironmentThreadGroupRenameActionResult {
  onRenameDialogOpenChange: (open: boolean) => void;
  onRenameEnvironment: () => void;
  onSubmitRenameEnvironment: (
    environmentId: string,
    name: string | null,
  ) => void;
  renameDialogTarget: EnvironmentRenameDialogTarget | null;
  renameEnvironmentErrorMessage: string | null;
  renameEnvironmentPending: boolean;
}

interface FormatArchivedEnvironmentThreadsToastTitleArgs {
  archivedThreadIds: readonly string[];
  threads: readonly Pick<ThreadListEntry, "id" | "title" | "titleFallback">[];
}

export function formatArchivedEnvironmentThreadsToastTitle({
  archivedThreadIds,
  threads,
}: FormatArchivedEnvironmentThreadsToastTitleArgs): string {
  if (archivedThreadIds.length !== 1) {
    return `Archived ${archivedThreadIds.length} threads`;
  }

  const archivedThread = threads.find(
    (thread) => thread.id === archivedThreadIds[0],
  );
  if (!archivedThread) {
    return "Archived 1 thread";
  }
  return `Archived ${getThreadDisplayTitle(archivedThread)}`;
}

function getProjectThreadTreeEmptyStateIcon(
  variant: ProjectThreadTreeVariant,
): IconName | undefined {
  if (variant === "section") {
    return "MessageSquare";
  }

  return undefined;
}

function getProjectThreadTreeEmptyStateClassName(
  variant: ProjectThreadTreeVariant,
): string {
  return cn(
    "py-0.5",
    variant === "section" ? "px-2" : "pl-8 pr-2",
    "group-data-[collapsible=icon]:hidden",
  );
}

function getProjectThreadTreeEmptyStateMessageClassName(
  variant: ProjectThreadTreeVariant,
): string {
  return cn(
    "text-xs leading-4",
    variant === "project"
      ? "font-medium text-sidebar-foreground/85"
      : "text-muted-foreground",
  );
}

function getProjectThreadTreeGroupLineClassName(
  variant: ProjectThreadTreeVariant,
): string | undefined {
  if (variant === "project") {
    return SIDEBAR_PROJECT_GROUP_LINE_CLASS;
  }

  return undefined;
}

function getProjectThreadTreeRootDepthOffset(
  variant: ProjectThreadTreeVariant,
): number {
  return variant === "section" ? 0 : 1;
}

function getThreadRowDepth({
  depthOffset,
  nodeDepth,
  variant,
}: GetThreadRowDepthArgs): number {
  return getProjectThreadTreeRootDepthOffset(variant) + nodeDepth + depthOffset;
}

function getThreadRowOptions({
  childActivity,
  childCount,
  consumeClickSuppression,
  dragBindings,
  depthOffset,
  isCollapsed,
  isEnvGrouped,
  isParent,
  nodeDepth,
  onToggleThreadCollapsed,
  stickyLevel,
  variant,
}: GetThreadRowOptionsArgs): ThreadRowOptions {
  const depth = getThreadRowDepth({ depthOffset, nodeDepth, variant });
  const baseOptions = {
    depth,
    isCompact: nodeDepth > 0 || isEnvGrouped,
    ...(consumeClickSuppression ? { consumeClickSuppression } : {}),
    ...(dragBindings ? { dragBindings } : {}),
  };

  if (!isParent) {
    return {
      ...baseOptions,
      kind: "default",
    };
  }

  return {
    ...baseOptions,
    kind: "parent",
    isCollapsed,
    childCount,
    childActivity,
    ...(stickyLevel !== undefined ? { stickyLevel } : {}),
    onToggleCollapsed: onToggleThreadCollapsed,
  };
}

interface GetThreadRowOptionsArgs {
  childActivity: CollapsedChildActivity;
  childCount: number;
  consumeClickSuppression?: ConsumeDragClickSuppression;
  dragBindings?: SidebarSortableDragBindings;
  isCollapsed: boolean;
  isEnvGrouped: boolean;
  isParent: boolean;
  depthOffset: number;
  nodeDepth: number;
  onToggleThreadCollapsed: (threadId: string) => void;
  stickyLevel?: number;
  variant: ProjectThreadTreeVariant;
}

interface GetThreadRowDepthArgs {
  depthOffset: number;
  nodeDepth: number;
  variant: ProjectThreadTreeVariant;
}

// A node's pin depth among parents equals how many ancestor rows sit above it
// in the tree: its tree depth plus any offset from an enclosing env group
// header (which occupies a row of its own). Beyond the cap, return undefined so
// the row renders non-sticky.
function getThreadNodeStickyLevel({
  depthOffset,
  node,
}: GetThreadNodeStickyLevelArgs): number | undefined {
  const level = node.depth + depthOffset;
  return level < SIDEBAR_STICKY_PARENT_DEPTH_CAP ? level : undefined;
}

function ThreadTreeGroupLine({ parentRowDepth }: ThreadTreeGroupLineProps) {
  return (
    <span
      className="pointer-events-none absolute bottom-0 top-0 z-30 w-px bg-border-hairline opacity-70"
      style={{ left: getSidebarThreadGroupLineLeft(parentRowDepth) }}
      aria-hidden="true"
    />
  );
}

function ThreadTreeLineContinuation({
  parentRowDepth,
}: ThreadTreeLineContinuationProps) {
  return (
    <span
      className="pointer-events-none absolute -bottom-0.5 top-0 z-[1] w-px bg-border-hairline opacity-70"
      style={{ left: getSidebarThreadGroupLineLeft(parentRowDepth) }}
      aria-hidden="true"
    />
  );
}

function ProjectThreadTreeGroup({
  children,
  variant,
  onClickCapture,
}: ProjectThreadTreeGroupProps) {
  return (
    <div
      data-sidebar-sticky-section={variant === "section" ? "" : undefined}
      className={cn(
        "relative space-y-0.5 group-data-[collapsible=icon]:hidden",
        getProjectThreadTreeGroupLineClassName(variant),
      )}
      onClickCapture={onClickCapture}
    >
      {children}
    </div>
  );
}

function ManualSortableList({
  children,
  manualSort,
  parentKey,
}: {
  children: ReactNode;
  manualSort?: ManualThreadTreeDndState | null;
  parentKey: string;
}) {
  if (!manualSort?.enabled) {
    return <>{children}</>;
  }

  return (
    <SortableContext
      items={[...(manualSort.itemIdsByParentKey.get(parentKey) ?? [])]}
      strategy={verticalListSortingStrategy}
    >
      {children}
    </SortableContext>
  );
}

const ManualSortableThreadTreeItemRow = memo(
  function ManualSortableThreadTreeItemRow({
    manualSort,
    ...props
  }: ThreadTreeItemRowProps) {
    const itemId = getManualOrderItemKey(props.item);
    const { dragBindings, setNodeRef, style } = useSidebarSortable({
      id: itemId,
      disabled: !manualSort?.enabled || props.item.kind === "environment",
    });

    if (!manualSort?.enabled || props.item.kind === "environment") {
      return <ThreadTreeItemRow manualSort={manualSort} {...props} />;
    }

    return (
      <ThreadTreeItemRow
        {...props}
        consumeClickSuppression={manualSort.consumeClickSuppression}
        dragBindings={dragBindings}
        manualSort={manualSort}
        sortableRef={setNodeRef}
        sortableStyle={style}
      />
    );
  },
);

function useArchiveEnvironmentThreadGroupAction({
  environmentId,
  projectId,
  selectedThreadId,
  threads,
}: UseArchiveEnvironmentThreadGroupActionArgs): UseArchiveEnvironmentThreadGroupActionResult {
  const navigate = useNavigate();
  const archiveEnvironmentThreads = useArchiveEnvironmentThreads();
  const {
    isPending: archiveThreadsIsPending,
    mutateAsync: archiveThreads,
    variables,
  } = archiveEnvironmentThreads;
  const archiveThreadsPending =
    archiveThreadsIsPending && variables?.id === environmentId;
  const onArchiveThreads = useCallback(() => {
    void archiveThreads({ id: environmentId })
      .then((response) => {
        appToast.success(
          formatArchivedEnvironmentThreadsToastTitle({
            archivedThreadIds: response.archivedThreadIds,
            threads,
          }),
        );
        if (
          selectedThreadId &&
          response.archivedThreadIds.includes(selectedThreadId)
        ) {
          navigate(`/projects/${projectId}`);
        }
      })
      .catch(() => undefined);
  }, [
    archiveThreads,
    environmentId,
    navigate,
    projectId,
    selectedThreadId,
    threads,
  ]);

  return {
    archiveThreadsPending,
    onArchiveThreads,
  };
}

function useEnvironmentThreadGroupRenameAction({
  environmentId,
  representativeThread,
}: UseEnvironmentThreadGroupRenameActionArgs): UseEnvironmentThreadGroupRenameActionResult {
  const renameDialog = useDialogState<EnvironmentRenameDialogTarget>();
  const updateEnvironment = useUpdateEnvironment();
  const {
    error,
    isPending,
    mutate: updateEnvironmentMutate,
    reset: resetUpdateEnvironment,
    variables,
  } = updateEnvironment;
  const renameEnvironmentPending = isPending && variables?.id === environmentId;
  const renameEnvironmentErrorMessage =
    error && variables?.id === environmentId
      ? getMutationErrorMessage({
          error,
          fallbackMessage: "Failed to update environment.",
        })
      : null;
  const { onClose, onOpen, onOpenChange, target } = renameDialog;

  const onRenameEnvironment = useCallback(() => {
    resetUpdateEnvironment();
    onOpen({
      ...(representativeThread.environmentBranchName !== null
        ? { branchName: representativeThread.environmentBranchName }
        : {}),
      canClearName: representativeThread.environmentName !== null,
      id: environmentId,
      currentName: representativeThread.environmentName ?? "",
    });
  }, [environmentId, onOpen, representativeThread, resetUpdateEnvironment]);

  const onSubmitRenameEnvironment = useCallback(
    (targetEnvironmentId: string, name: string | null) => {
      updateEnvironmentMutate(
        { id: targetEnvironmentId, name },
        { onSuccess: onClose },
      );
    },
    [onClose, updateEnvironmentMutate],
  );

  return {
    onRenameDialogOpenChange: onOpenChange,
    onRenameEnvironment,
    onSubmitRenameEnvironment,
    renameDialogTarget: target,
    renameEnvironmentErrorMessage,
    renameEnvironmentPending,
  };
}

function EnvironmentThreadGroupHeaderActions({
  archiveThreadsPending,
  onArchiveThreads,
  onCreateNewThread,
  onRenameEnvironment,
  onOpenChange,
}: EnvironmentThreadGroupHeaderActionsProps) {
  if (!onCreateNewThread && !onArchiveThreads && !onRenameEnvironment) {
    return null;
  }

  return (
    <span className="inline-flex shrink-0 items-center">
      <DropdownMenu onOpenChange={onOpenChange}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Worktree actions"
            title="Worktree actions"
            className={cn(
              "rounded-md p-0 text-muted-foreground",
              "data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-foreground",
              COARSE_POINTER_ROW_ACTION_SIZE_CLASS,
            )}
          >
            <Icon
              name="MoreHorizontal"
              className={COARSE_POINTER_ICON_SIZE_CLASS}
            />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          {onCreateNewThread ? (
            <DropdownMenuItem onSelect={onCreateNewThread}>
              New thread
            </DropdownMenuItem>
          ) : null}
          {onRenameEnvironment ? (
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault();
                onRenameEnvironment();
              }}
            >
              Rename
            </DropdownMenuItem>
          ) : null}
          {onArchiveThreads ? (
            <DropdownMenuItem
              disabled={archiveThreadsPending}
              onSelect={(event) => {
                if (archiveThreadsPending) {
                  event.preventDefault();
                  return;
                }
                onArchiveThreads();
              }}
            >
              Archive worktree
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}

function EnvironmentThreadGroupHeader({
  environmentId,
  representativeThread,
  rowDepth,
  stickyLevel,
  parentLineDepth,
  childActivity,
  isCollapsed,
  archiveThreadsPending = false,
  onArchiveThreads,
  onCreateNewThread,
  onRenameEnvironment,
  onToggleCollapsed,
}: EnvironmentThreadGroupHeaderProps) {
  const [isActionsOpen, setIsActionsOpen] = useState(false);
  const environmentName = representativeThread.environmentName;
  const branchName = representativeThread.environmentBranchName;
  const displayName = environmentName || branchName || "Worktree";
  const iconName: IconName = "FolderGit";
  // Collapsed: the header speaks for its hidden children through one status
  // glyph (pending > working > unread). Expanded: the children show their own
  // glyphs, and the synthetic header has no status of its own.
  const showRollupGlyph =
    isCollapsed &&
    (childActivity.pending || childActivity.working || childActivity.unread);
  const className = cn(
    SIDEBAR_HOVER_ACTIONS_ROW_CLASS,
    // A pinned header is already a positioned (sticky) box for its absolute
    // children; adding `relative` (a utility-layer rule) would override the
    // component-layer `position: sticky` and silently un-stick it. Only the
    // non-sticky header needs `relative`. Mirrors ThreadRow.
    stickyLevel === undefined && "relative",
    SIDEBAR_ROW_BASE_CLASS,
    COARSE_POINTER_COMPACT_ROW_HEIGHT_CLASS,
    "cursor-default",
  );
  const style = {
    paddingLeft: getSidebarThreadRowPaddingLeft(rowDepth),
  };
  const content = (
    <>
      {parentLineDepth === undefined ? null : (
        <ThreadTreeLineContinuation parentRowDepth={parentLineDepth} />
      )}
      <span
        className={cn(
          "pointer-events-none relative z-10 inline-flex shrink-0 items-center justify-center text-subtle-foreground",
          COARSE_POINTER_GLYPH_BOX_CLASS,
        )}
        aria-hidden="true"
      >
        <Icon
          name={iconName}
          className={COARSE_POINTER_ICON_SIZE_CLASS}
          aria-hidden="true"
        />
      </span>
      <span className="pointer-events-none relative z-10 flex min-w-0 flex-1 items-center gap-1.5 text-left text-subtle-foreground/80">
        <span className="min-w-0 truncate">
          <span>{displayName}</span>
        </span>
        <SidebarChildToggleChevron
          isCollapsed={isCollapsed}
          expandLabel={`Expand ${displayName} threads`}
          collapseLabel={`Collapse ${displayName} threads`}
          expandTitle="Expand worktree threads"
          collapseTitle="Collapse worktree threads"
          onToggle={() => onToggleCollapsed(environmentId)}
          revealOnHover
        />
      </span>
      <span
        className={cn(
          "relative z-10 shrink-0",
          COARSE_POINTER_ROW_ACTION_SIZE_CLASS,
        )}
      >
        {showRollupGlyph ? (
          <span
            data-sidebar-hover-actions-open={isActionsOpen ? "true" : undefined}
            className={cn(
              SIDEBAR_HOVER_ACTIONS_FADE_CLASS,
              "pointer-events-none absolute inset-0 flex items-center justify-center text-subtle-foreground",
            )}
          >
            <ThreadStatusGlyph
              hasPendingInteraction={childActivity.pending}
              isBusy={childActivity.working}
              showUnreadBadge={childActivity.unread}
              unreadBadgeTone={childActivity.unreadError ? "error" : "default"}
            />
          </span>
        ) : null}
        <div
          data-sidebar-hover-actions-open={isActionsOpen ? "true" : undefined}
          className={cn(
            SIDEBAR_HOVER_ACTIONS_CLASS,
            "absolute inset-0 flex items-center justify-end",
          )}
        >
          <EnvironmentThreadGroupHeaderActions
            archiveThreadsPending={archiveThreadsPending}
            onArchiveThreads={onArchiveThreads}
            onCreateNewThread={onCreateNewThread}
            onRenameEnvironment={onRenameEnvironment}
            onOpenChange={setIsActionsOpen}
          />
        </div>
      </span>
    </>
  );

  if (stickyLevel !== undefined) {
    return (
      <SidebarStickyTier
        tier="parent"
        level={stickyLevel}
        className={className}
        style={style}
        title={displayName}
      >
        {content}
      </SidebarStickyTier>
    );
  }

  return (
    <div className={className} style={style} title={displayName}>
      {content}
    </div>
  );
}

const EnvironmentThreadGroupRow = memo(function EnvironmentThreadGroupRow({
  projectId,
  environmentThreadGroup,
  depthOffset,
  selectedThreadId,
  isCollapsed,
  variant,
  onProjectSelect,
  collapsedThreadIds,
  collapsedEnvironmentIds,
  onToggleThreadCollapsed,
  onToggleEnvironmentCollapsed,
}: EnvironmentThreadGroupRowProps) {
  const { environmentId, nodes, stats } = environmentThreadGroup;
  const representativeNode = nodes[0];
  const representativeThread = representativeNode.thread;
  const nodeDepth = representativeNode.depth;
  const rowDepth = getThreadRowDepth({
    depthOffset,
    nodeDepth,
    variant,
  });
  const parentLineDepth =
    nodeDepth > 0
      ? getThreadRowDepth({
          depthOffset,
          nodeDepth: nodeDepth - 1,
          variant,
        })
      : undefined;
  const createThreadInWorktree = useCreateThreadInWorktree({
    projectId,
    environmentId,
  });
  const threads = useMemo(() => nodes.map((node) => node.thread), [nodes]);
  const { archiveThreadsPending, onArchiveThreads } =
    useArchiveEnvironmentThreadGroupAction({
      environmentId,
      projectId,
      selectedThreadId,
      threads,
    });
  const handleCreateNewThread = useCallback(() => {
    onProjectSelect?.();
    createThreadInWorktree();
  }, [createThreadInWorktree, onProjectSelect]);
  const {
    onRenameDialogOpenChange,
    onRenameEnvironment,
    onSubmitRenameEnvironment,
    renameDialogTarget,
    renameEnvironmentErrorMessage,
    renameEnvironmentPending,
  } = useEnvironmentThreadGroupRenameAction({
    environmentId,
    representativeThread,
  });

  return (
    <>
      <SidebarStickyGroup className="space-y-0.5">
        <EnvironmentThreadGroupHeader
          environmentId={environmentId}
          representativeThread={representativeThread}
          rowDepth={rowDepth}
          stickyLevel={getThreadNodeStickyLevel({
            depthOffset,
            node: representativeNode,
          })}
          parentLineDepth={parentLineDepth}
          childActivity={stats.childActivity}
          isCollapsed={isCollapsed}
          archiveThreadsPending={archiveThreadsPending}
          onArchiveThreads={onArchiveThreads}
          onCreateNewThread={handleCreateNewThread}
          onRenameEnvironment={onRenameEnvironment}
          onToggleCollapsed={onToggleEnvironmentCollapsed}
        />
        {!isCollapsed ? (
          <div className="relative space-y-px">
            <ThreadTreeGroupLine parentRowDepth={rowDepth} />
            {nodes.map((node) => (
              <ThreadTreeNodeRow
                key={node.thread.id}
                projectId={projectId}
                node={node}
                depthOffset={depthOffset + 1}
                isEnvGrouped
                selectedThreadId={selectedThreadId}
                collapsedThreadIds={collapsedThreadIds}
                collapsedEnvironmentIds={collapsedEnvironmentIds}
                variant={variant}
                onProjectSelect={onProjectSelect}
                onToggleThreadCollapsed={onToggleThreadCollapsed}
                onToggleEnvironmentCollapsed={onToggleEnvironmentCollapsed}
              />
            ))}
          </div>
        ) : null}
      </SidebarStickyGroup>
      <EnvironmentRenameDialog
        errorMessage={renameEnvironmentErrorMessage}
        target={renameDialogTarget}
        pending={renameEnvironmentPending}
        onOpenChange={onRenameDialogOpenChange}
        onRename={onSubmitRenameEnvironment}
      />
    </>
  );
});

export const ThreadTreeItemRow = memo(function ThreadTreeItemRow({
  projectId,
  item,
  depthOffset,
  insideFolder = false,
  selectedThreadId,
  collapsedThreadIds,
  collapsedEnvironmentIds,
  variant,
  onProjectSelect,
  onToggleThreadCollapsed,
  onToggleEnvironmentCollapsed,
  consumeClickSuppression,
  dragBindings,
  manualSort,
  sortableRef,
  sortableStyle,
}: ThreadTreeItemRowProps) {
  if (item.kind === "folder") {
    return (
      <FolderTreeItemRow
        folder={item.group}
        depthOffset={depthOffset}
        selectedThreadId={selectedThreadId}
        collapsedThreadIds={collapsedThreadIds}
        collapsedEnvironmentIds={collapsedEnvironmentIds}
        variant={variant}
        onProjectSelect={onProjectSelect}
        onToggleThreadCollapsed={onToggleThreadCollapsed}
        onToggleEnvironmentCollapsed={onToggleEnvironmentCollapsed}
        consumeClickSuppression={consumeClickSuppression}
        dragBindings={dragBindings}
        manualSort={manualSort}
        sortableRef={sortableRef}
        sortableStyle={sortableStyle}
      />
    );
  }

  if (item.kind === "thread") {
    return (
      <ThreadTreeNodeRow
        projectId={projectId}
        node={item.node}
        depthOffset={depthOffset}
        isEnvGrouped={false}
        insideFolder={insideFolder}
        selectedThreadId={selectedThreadId}
        collapsedThreadIds={collapsedThreadIds}
        collapsedEnvironmentIds={collapsedEnvironmentIds}
        variant={variant}
        onProjectSelect={onProjectSelect}
        onToggleThreadCollapsed={onToggleThreadCollapsed}
        onToggleEnvironmentCollapsed={onToggleEnvironmentCollapsed}
        consumeClickSuppression={consumeClickSuppression}
        dragBindings={dragBindings}
        sortableRef={sortableRef}
        sortableStyle={sortableStyle}
      />
    );
  }

  return (
    <EnvironmentThreadGroupRow
      projectId={projectId}
      environmentThreadGroup={item.group}
      depthOffset={depthOffset}
      selectedThreadId={selectedThreadId}
      isCollapsed={collapsedEnvironmentIds.has(item.group.environmentId)}
      collapsedThreadIds={collapsedThreadIds}
      collapsedEnvironmentIds={collapsedEnvironmentIds}
      variant={variant}
      onProjectSelect={onProjectSelect}
      onToggleThreadCollapsed={onToggleThreadCollapsed}
      onToggleEnvironmentCollapsed={onToggleEnvironmentCollapsed}
    />
  );
});

// A derived folder and its (recursively rendered) contents. Collapse state lives
// in sidebarCollapsedFoldersAtom — read here rather than threaded so the rest of
// the tree's prop wiring and memo equality stay untouched. Children render one
// depth deeper and, when threads, show their leaf via insideFolder.
const FolderTreeItemRow = memo(function FolderTreeItemRow({
  folder,
  depthOffset,
  selectedThreadId,
  collapsedThreadIds,
  collapsedEnvironmentIds,
  variant,
  onProjectSelect,
  onToggleThreadCollapsed,
  onToggleEnvironmentCollapsed,
  consumeClickSuppression,
  dragBindings,
  manualSort,
  sortableRef,
  sortableStyle,
}: FolderTreeItemRowProps) {
  const collapsedFolders = useAtomValue(sidebarCollapsedFoldersAtom);
  const setCollapsedFolders = useSetAtom(sidebarCollapsedFoldersAtom);
  const folderKey = folder.key;
  const isCollapsed = collapsedFolders.includes(folderKey);
  const handleToggleCollapsed = useCallback(() => {
    setCollapsedFolders((current) =>
      current.includes(folderKey)
        ? current.filter((key) => key !== folderKey)
        : [...current, folderKey],
    );
  }, [folderKey, setCollapsedFolders]);

  const headerDepth = getThreadRowDepth({ depthOffset, nodeDepth: 0, variant });
  const stickyLevel =
    depthOffset < SIDEBAR_STICKY_PARENT_DEPTH_CAP ? depthOffset : undefined;

  return (
    <SidebarStickyGroup
      ref={sortableRef}
      style={sortableStyle}
      className="space-y-0.5"
    >
      <SidebarFolderRow
        name={folder.name}
        pathLabel={formatFolderPathLabel(folder.path)}
        depth={headerDepth}
        activity={folder.activity}
        consumeClickSuppression={consumeClickSuppression}
        dragBindings={dragBindings}
        isCollapsed={isCollapsed}
        onToggleCollapsed={handleToggleCollapsed}
        stickyLevel={stickyLevel}
      />
      {!isCollapsed && folder.items.length > 0 ? (
        <div className="relative space-y-px">
          <ThreadTreeGroupLine parentRowDepth={headerDepth} />
          <ManualSortableList manualSort={manualSort} parentKey={folder.key}>
            {folder.items.map((item) => (
              <ManualSortableThreadTreeItemRow
                key={getItemKey(item)}
                projectId={getItemProjectId(item)}
                item={item}
                depthOffset={depthOffset + 1}
                insideFolder
                selectedThreadId={selectedThreadId}
                collapsedThreadIds={collapsedThreadIds}
                collapsedEnvironmentIds={collapsedEnvironmentIds}
                variant={variant}
                onProjectSelect={onProjectSelect}
                onToggleThreadCollapsed={onToggleThreadCollapsed}
                onToggleEnvironmentCollapsed={onToggleEnvironmentCollapsed}
                manualSort={manualSort}
              />
            ))}
          </ManualSortableList>
        </div>
      ) : null}
    </SidebarStickyGroup>
  );
});

export const ThreadTreeNodeRow = memo(function ThreadTreeNodeRow({
  projectId,
  node,
  depthOffset,
  isEnvGrouped,
  selectedThreadId,
  collapsedThreadIds,
  collapsedEnvironmentIds,
  variant,
  onProjectSelect,
  onToggleThreadCollapsed,
  onToggleEnvironmentCollapsed,
  consumeClickSuppression,
  dragBindings,
  sortableRef,
  sortableStyle,
  insideFolder = false,
}: ThreadTreeNodeRowProps) {
  const isCollapsed = collapsedThreadIds.has(node.thread.id);
  const hasChildren = node.children.length > 0;
  const isParent = hasChildren;
  const parentRowDepth = getThreadRowDepth({
    depthOffset,
    nodeDepth: node.depth,
    variant,
  });
  const options = useMemo<ThreadRowOptions>(
    () =>
      getThreadRowOptions({
        childActivity: node.stats.childActivity,
        childCount: node.stats.childCount,
        consumeClickSuppression,
        dragBindings,
        depthOffset,
        isCollapsed,
        isEnvGrouped,
        isParent,
        nodeDepth: node.depth,
        onToggleThreadCollapsed,
        stickyLevel: hasChildren
          ? getThreadNodeStickyLevel({ depthOffset, node })
          : undefined,
        variant,
      }),
    [
      consumeClickSuppression,
      depthOffset,
      dragBindings,
      isCollapsed,
      isEnvGrouped,
      isParent,
      hasChildren,
      node,
      onToggleThreadCollapsed,
      variant,
    ],
  );
  const showChildren = !isCollapsed && hasChildren;
  const hasComposerDraft = usePromptDraftHasInput({
    kind: "thread",
    projectId,
    threadId: node.thread.id,
  });
  // Inside a folder the row shows its leaf but keeps the full path for a11y;
  // outside a folder (or for this node's own children) it shows the full title.
  const folderTitles = useMemo(() => {
    if (!insideFolder) {
      return undefined;
    }
    const title = getThreadDisplayTitle(node.thread);
    const folders = splitFolderPath(node.thread.folderPath);
    return {
      displayTitle: title,
      accessibleTitle:
        folders.length > 0 ? formatFolderPathLabel([...folders, title]) : title,
    };
  }, [insideFolder, node.thread]);
  const row = (
    <ThreadRow
      projectId={projectId}
      thread={node.thread}
      isActive={selectedThreadId === node.thread.id}
      hasComposerDraft={hasComposerDraft}
      onProjectSelect={onProjectSelect}
      options={options}
      displayTitle={folderTitles?.displayTitle}
      accessibleTitle={folderTitles?.accessibleTitle}
    />
  );

  if (!hasChildren && !sortableRef) {
    return row;
  }

  return (
    <SidebarStickyGroup
      ref={sortableRef}
      style={sortableStyle}
      className="space-y-0.5"
    >
      {row}
      {showChildren ? (
        <div className="relative space-y-px">
          <ThreadTreeGroupLine parentRowDepth={parentRowDepth} />
          {node.children.map((item) => (
            <ThreadTreeItemRow
              key={getItemKey(item)}
              projectId={projectId}
              item={item}
              depthOffset={depthOffset}
              selectedThreadId={selectedThreadId}
              collapsedThreadIds={collapsedThreadIds}
              collapsedEnvironmentIds={collapsedEnvironmentIds}
              variant={variant}
              onProjectSelect={onProjectSelect}
              onToggleThreadCollapsed={onToggleThreadCollapsed}
              onToggleEnvironmentCollapsed={onToggleEnvironmentCollapsed}
            />
          ))}
        </div>
      ) : null}
    </SidebarStickyGroup>
  );
});

export const ProjectThreadTree = memo(function ProjectThreadTree({
  projectId,
  threadListState,
  compareThreads,
  folderPaths = EMPTY_FOLDER_PATHS,
  selectedThreadId,
  collapsedThreadIds,
  collapsedEnvironmentIds,
  variant,
  onProjectSelect,
  onToggleThreadCollapsed,
  onToggleEnvironmentCollapsed,
}: ProjectThreadTreeProps) {
  const groupBy = "folder" as const;
  const projectThreads =
    threadListState.status === "ready"
      ? threadListState.threads
      : EMPTY_PROJECT_THREADS;
  const rootItems = useMemo(
    () =>
      buildProjectThreadGroups(projectThreads, compareThreads, {
        groupBy,
        containerId: projectId,
        folderPaths,
      }),
    [compareThreads, projectThreads, groupBy, projectId, folderPaths],
  );
  const manualSort = useManualThreadTreeDnd({
    containerId: projectId,
    enabled: hasFolderItems(rootItems),
    rootItems,
  });

  if (threadListState.status === "loading") {
    return (
      <div className="group-data-[collapsible=icon]:hidden">
        <SidebarMenuSkeleton />
      </div>
    );
  }

  if (rootItems.length === 0) {
    const emptyState = (
      <EmptyState
        message={
          threadListState.status === "unavailable"
            ? "Threads unavailable"
            : "No threads"
        }
        icon={getProjectThreadTreeEmptyStateIcon(variant)}
        className={getProjectThreadTreeEmptyStateClassName(variant)}
        iconClassName="size-3.5"
        messageClassName={getProjectThreadTreeEmptyStateMessageClassName(
          variant,
        )}
      />
    );

    if (variant === "section") {
      return emptyState;
    }

    return (
      <ProjectThreadTreeGroup variant={variant}>
        {emptyState}
      </ProjectThreadTreeGroup>
    );
  }

  const tree = (
    <ProjectThreadTreeGroup
      variant={variant}
      onClickCapture={manualSort?.onClickCapture}
    >
      <ManualSortableList manualSort={manualSort} parentKey={projectId}>
        {rootItems.map((item) => (
          <ManualSortableThreadTreeItemRow
            key={getItemKey(item)}
            projectId={projectId}
            item={item}
            depthOffset={0}
            selectedThreadId={selectedThreadId}
            collapsedThreadIds={collapsedThreadIds}
            collapsedEnvironmentIds={collapsedEnvironmentIds}
            variant={variant}
            onProjectSelect={onProjectSelect}
            onToggleThreadCollapsed={onToggleThreadCollapsed}
            onToggleEnvironmentCollapsed={onToggleEnvironmentCollapsed}
            manualSort={manualSort ?? undefined}
          />
        ))}
      </ManualSortableList>
    </ProjectThreadTreeGroup>
  );

  return manualSort ? (
    <DndContext {...manualSort.dndContextProps}>{tree}</DndContext>
  ) : (
    tree
  );
});

// Flat "All Threads" bucket for chronological mode: one top-level row per
// non-pinned thread across all projects, globally ordered by the chosen
// comparator (no parent/child nesting or worktree grouping, so nothing hides
// behind a collapsed parent). Derives projectId per row from its own thread so
// cross-project rows still route correctly.
export const ChronologicalThreadTree = memo(function ChronologicalThreadTree({
  threadListState,
  compareThreads,
  folderPaths = EMPTY_FOLDER_PATHS,
  selectedThreadId,
  collapsedThreadIds,
  collapsedEnvironmentIds,
  onProjectSelect,
  onToggleThreadCollapsed,
  onToggleEnvironmentCollapsed,
}: ChronologicalThreadTreeProps) {
  const groupBy = "folder" as const;
  const threads =
    threadListState.status === "ready"
      ? threadListState.threads
      : EMPTY_PROJECT_THREADS;
  const rootItems = useMemo(
    () =>
      buildChronologicalThreadList(threads, compareThreads, {
        groupBy,
        containerId: CHRONOLOGICAL_CONTAINER_ID,
        folderPaths,
      }),
    [threads, compareThreads, groupBy, folderPaths],
  );
  const manualSort = useManualThreadTreeDnd({
    containerId: CHRONOLOGICAL_CONTAINER_ID,
    enabled: hasFolderItems(rootItems),
    rootItems,
  });

  if (threadListState.status === "loading") {
    return (
      <div className="group-data-[collapsible=icon]:hidden">
        <SidebarMenuSkeleton />
      </div>
    );
  }

  if (rootItems.length === 0) {
    return (
      <EmptyState
        message={
          threadListState.status === "unavailable"
            ? "Threads unavailable"
            : "No threads"
        }
        icon={getProjectThreadTreeEmptyStateIcon("section")}
        className={getProjectThreadTreeEmptyStateClassName("section")}
        iconClassName="size-3.5"
        messageClassName={getProjectThreadTreeEmptyStateMessageClassName(
          "section",
        )}
      />
    );
  }

  const tree = (
    <ProjectThreadTreeGroup
      variant="section"
      onClickCapture={manualSort?.onClickCapture}
    >
      <ManualSortableList
        manualSort={manualSort}
        parentKey={CHRONOLOGICAL_CONTAINER_ID}
      >
        {rootItems.map((item) => (
          <ManualSortableThreadTreeItemRow
            key={getItemKey(item)}
            projectId={getItemProjectId(item)}
            item={item}
            depthOffset={0}
            selectedThreadId={selectedThreadId}
            collapsedThreadIds={collapsedThreadIds}
            collapsedEnvironmentIds={collapsedEnvironmentIds}
            variant="section"
            onProjectSelect={onProjectSelect}
            onToggleThreadCollapsed={onToggleThreadCollapsed}
            onToggleEnvironmentCollapsed={onToggleEnvironmentCollapsed}
            manualSort={manualSort ?? undefined}
          />
        ))}
      </ManualSortableList>
    </ProjectThreadTreeGroup>
  );

  return manualSort ? (
    <DndContext {...manualSort.dndContextProps}>{tree}</DndContext>
  ) : (
    tree
  );
});

function ProjectRowComponent({
  project,
  threadListState,
  folderPaths = EMPTY_FOLDER_PATHS,
  selectedThreadId,
  isActive,
  isCollapsed,
  compareThreads,
  collapsedThreadIds,
  collapsedEnvironmentIds,
  isLocalPathInvalid,
  onProjectSelect,
  onCreateProjectThread,
  onToggleProjectCollapsed,
  onToggleThreadCollapsed,
  onToggleEnvironmentCollapsed,
  consumeProjectClickSuppression,
  projectDragBindings,
  projectRowRef,
  projectRowStyle,
}: ProjectRowProps) {
  const [isDropdownActionsOpen, setIsDropdownActionsOpen] = useState(false);
  const [isContextActionsOpen, setIsContextActionsOpen] = useState(false);
  const isActionsOpen = isDropdownActionsOpen || isContextActionsOpen;
  const handleProjectRowClickCapture =
    useCallback<ProjectItemClickCaptureHandler>(
      (event) => {
        if (!consumeProjectClickSuppression?.()) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
      },
      [consumeProjectClickSuppression],
    );
  const handleProjectRowToggle = useCallback(() => {
    onToggleProjectCollapsed(project.id);
  }, [onToggleProjectCollapsed, project.id]);
  const handleCreateThread = useCallback(() => {
    onCreateProjectThread?.(project.id);
  }, [onCreateProjectThread, project.id]);
  return (
    <SidebarStickyGroup asChild data-sidebar-sticky-project-item="">
      <SidebarMenuItem
        ref={projectRowRef}
        style={projectRowStyle}
        onClickCapture={handleProjectRowClickCapture}
      >
        <ProjectActionsContextMenu
          project={project}
          onOpenChange={setIsContextActionsOpen}
        >
          <SidebarStickyTier
            ref={projectDragBindings?.setActivatorNodeRef}
            tier="project"
            className={cn(
              SIDEBAR_HOVER_ACTIONS_ROW_CLASS,
              "group/project-row flex w-full items-center rounded-md text-sm transition-colors",
              isActive
                ? SIDEBAR_ROW_SELECTED_STATE_CLASS
                : SIDEBAR_ROW_INTERACTIVE_STATE_CLASS,
              projectDragBindings &&
                !projectDragBindings.disabled &&
                "select-none",
            )}
            title={project.name}
            onClick={handleProjectRowToggle}
            {...projectDragBindings?.attributes}
            {...(projectDragBindings?.listeners ?? {})}
          >
            <button
              type="button"
              aria-hidden="true"
              tabIndex={-1}
              onClick={handleProjectRowToggle}
              className="absolute inset-0 rounded-md outline-none ring-sidebar-ring focus-visible:ring-2"
            />
            <span
              className={cn(
                "pointer-events-none relative z-10 flex shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors group-hover/project-row:text-sidebar-foreground",
                PROJECT_ROW_LEADING_SLOT_CLASS,
              )}
              aria-hidden
            >
              <Icon
                name={isCollapsed ? "Folder" : "FolderOpen"}
                className={COARSE_POINTER_ICON_SIZE_CLASS}
              />
            </span>
            <span className="pointer-events-none relative z-10 flex min-w-0 flex-1 items-center gap-1.5 text-left">
              <span className="min-w-0 truncate">{project.name}</span>
              <SidebarChildToggleChevron
                isCollapsed={isCollapsed}
                expandLabel={`Expand ${project.name}`}
                collapseLabel={`Collapse ${project.name}`}
                expandTitle="Expand project threads"
                collapseTitle="Collapse project threads"
                onToggle={handleProjectRowToggle}
                revealOnHover
              />
            </span>
            {isLocalPathInvalid ? (
              <NavLink
                to={getProjectSettingsRoutePath(project.id)}
                onClick={(event) => {
                  event.stopPropagation();
                  onProjectSelect?.();
                }}
                title="Project folder not found. Open project settings to fix."
                aria-label="Project folder not found"
                className={cn(
                  "relative z-10 inline-flex shrink-0 items-center justify-center rounded-md text-destructive outline-none ring-sidebar-ring transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:ring-2",
                  COARSE_POINTER_ROW_ACTION_SIZE_CLASS,
                )}
              >
                <Icon
                  name="AlertTriangle"
                  className={COARSE_POINTER_ICON_SIZE_CLASS}
                />
              </NavLink>
            ) : null}
            <span
              data-sidebar-hover-actions-open={
                isActionsOpen ? "true" : undefined
              }
              data-sidebar-hover-actions-mobile={
                SIDEBAR_HOVER_ACTIONS_MOBILE_ALWAYS_VALUE
              }
              className={cn(
                SIDEBAR_HOVER_ACTIONS_CLASS,
                "relative z-10 inline-flex shrink-0 items-center",
                SIDEBAR_HOVER_ACTIONS_GAP_CLASS,
              )}
            >
              <ProjectActionsMenu
                project={project}
                onOpenChange={setIsDropdownActionsOpen}
                triggerClassName={cn(
                  "relative z-10 text-subtle-foreground hover:bg-transparent hover:text-foreground",
                  COARSE_POINTER_ROW_ACTION_SIZE_CLASS,
                )}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`New thread in ${project.name}`}
                title="New thread"
                disabled={!onCreateProjectThread}
                onClick={(event) => {
                  event.stopPropagation();
                  handleCreateThread();
                }}
                className={cn(
                  "rounded-md p-0 text-subtle-foreground hover:bg-transparent hover:text-foreground",
                  COARSE_POINTER_ROW_ACTION_SIZE_CLASS,
                )}
              >
                <Icon
                  name="MessageSquarePlus"
                  className={COARSE_POINTER_ICON_SIZE_CLASS}
                />
              </Button>
            </span>
          </SidebarStickyTier>
        </ProjectActionsContextMenu>

        {!isCollapsed ? (
          <ProjectThreadTree
            projectId={project.id}
            threadListState={threadListState}
            folderPaths={folderPaths}
            selectedThreadId={selectedThreadId}
            collapsedThreadIds={collapsedThreadIds}
            collapsedEnvironmentIds={collapsedEnvironmentIds}
            compareThreads={compareThreads}
            variant="project"
            onProjectSelect={onProjectSelect}
            onToggleThreadCollapsed={onToggleThreadCollapsed}
            onToggleEnvironmentCollapsed={onToggleEnvironmentCollapsed}
          />
        ) : null}
      </SidebarMenuItem>
    </SidebarStickyGroup>
  );
}

interface ProjectRowPropsComparisonArgs {
  prev: ProjectRowProps;
  next: ProjectRowProps;
}

function getThreadIdsWithChildren(
  threads: readonly ThreadListEntry[],
): Set<string> {
  const threadIds = new Set(threads.map((thread) => thread.id));
  const threadIdsWithChildren = new Set<string>();

  for (const thread of threads) {
    if (thread.parentThreadId === null) continue;
    if (!threadIds.has(thread.parentThreadId)) continue;

    threadIdsWithChildren.add(thread.parentThreadId);
  }

  return threadIdsWithChildren;
}

function hasCollapsedThreadStateChanged({
  prev,
  next,
}: ProjectRowPropsComparisonArgs): boolean {
  if (prev.collapsedThreadIds === next.collapsedThreadIds) {
    return false;
  }
  if (prev.threadListState.status !== "ready") {
    return false;
  }

  const threadIdsWithChildren = getThreadIdsWithChildren(
    prev.threadListState.threads,
  );
  for (const threadId of threadIdsWithChildren) {
    if (
      prev.collapsedThreadIds.has(threadId) !==
      next.collapsedThreadIds.has(threadId)
    ) {
      return true;
    }
  }

  return false;
}

function hasCollapsedEnvironmentStateChanged({
  prev,
  next,
}: ProjectRowPropsComparisonArgs): boolean {
  if (prev.collapsedEnvironmentIds === next.collapsedEnvironmentIds) {
    return false;
  }
  if (prev.threadListState.status !== "ready") {
    return false;
  }

  for (const thread of prev.threadListState.threads) {
    if (thread.environmentId === null) continue;
    if (
      prev.collapsedEnvironmentIds.has(thread.environmentId) !==
      next.collapsedEnvironmentIds.has(thread.environmentId)
    ) {
      return true;
    }
  }

  return false;
}

function areProjectRowPropsEqual(
  prev: ProjectRowProps,
  next: ProjectRowProps,
): boolean {
  if (
    prev.project !== next.project ||
    prev.threadListState !== next.threadListState ||
    prev.folderPaths !== next.folderPaths ||
    prev.isActive !== next.isActive ||
    prev.isCollapsed !== next.isCollapsed ||
    prev.compareThreads !== next.compareThreads ||
    prev.isLocalPathInvalid !== next.isLocalPathInvalid ||
    prev.onProjectSelect !== next.onProjectSelect ||
    prev.onCreateProjectThread !== next.onCreateProjectThread ||
    prev.onToggleProjectCollapsed !== next.onToggleProjectCollapsed ||
    prev.onToggleThreadCollapsed !== next.onToggleThreadCollapsed ||
    prev.onToggleEnvironmentCollapsed !== next.onToggleEnvironmentCollapsed ||
    prev.consumeProjectClickSuppression !==
      next.consumeProjectClickSuppression ||
    prev.projectDragBindings !== next.projectDragBindings ||
    prev.projectRowRef !== next.projectRowRef ||
    prev.projectRowStyle !== next.projectRowStyle
  ) {
    return false;
  }
  // selectedThreadId is a shared sidebar prop; only projects containing the
  // previously- or newly-selected thread need to re-render.
  if (prev.selectedThreadId !== next.selectedThreadId) {
    if (prev.threadListState.status !== "ready") {
      return false;
    }
    for (const thread of prev.threadListState.threads) {
      if (
        thread.id === prev.selectedThreadId ||
        thread.id === next.selectedThreadId
      ) {
        return false;
      }
    }
  }
  // Collapsed row sets are shared sidebar props; only invalidate if this
  // project's parent-thread or worktree-env collapse state actually changed.
  if (prev.threadListState.status !== "ready") {
    return true;
  }
  return (
    !hasCollapsedThreadStateChanged({ prev, next }) &&
    !hasCollapsedEnvironmentStateChanged({ prev, next })
  );
}

export const ProjectRow = memo(ProjectRowComponent, areProjectRowPropsEqual);
