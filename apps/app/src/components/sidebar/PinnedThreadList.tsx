import { memo, useCallback } from "react";
import { DndContext } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type { NeighborReorderRequest } from "@/lib/neighbor-reorder";
import { ThreadTreeNodeRow } from "./ProjectRow";
import { useSidebarSortable } from "./sortableMotion";
import { useSidebarReorderDnd } from "./useSidebarReorderDnd";
import type { ProjectThreadNode } from "./projectThreadGroups";
import {
  useNeighborReorderSortable,
  type UseNeighborReorderSortableArgs,
} from "./useNeighborReorderSortable";

export interface PinnedThreadReorderCallbacks {
  onSettled: () => void;
}

export interface PinnedThreadListProps {
  threadNodes: readonly ProjectThreadNode[];
  selectedThreadId?: string;
  onProjectSelect?: () => void;
  isPinnedReorderPending?: boolean;
  onReorderPinnedThread?: (
    request: NeighborReorderRequest,
    callbacks: PinnedThreadReorderCallbacks,
  ) => void;
}

interface SortablePinnedThreadListItemProps {
  disabled: boolean;
  node: ProjectThreadNode;
  onProjectSelect?: () => void;
  selectedThreadId?: string;
}

interface PinnedThreadListItemProps
  extends Omit<SortablePinnedThreadListItemProps, "disabled"> {
  consumeClickSuppression?: () => boolean;
}

function getPinnedThreadNodeId(node: ProjectThreadNode): string {
  return node.thread.id;
}

const PinnedThreadListItem = memo(function PinnedThreadListItem({
  consumeClickSuppression,
  node,
  onProjectSelect,
  selectedThreadId,
}: PinnedThreadListItemProps) {
  return (
    <ThreadTreeNodeRow
      projectId={node.thread.projectId}
      node={node}
      depthOffset={0}
      isEnvGrouped={false}
      selectedThreadId={selectedThreadId}
      variant="section"
      onProjectSelect={onProjectSelect}
      consumeClickSuppression={consumeClickSuppression}
    />
  );
});

const SortablePinnedThreadListItem = memo(function SortablePinnedThreadListItem({
  disabled,
  node,
  onProjectSelect,
  selectedThreadId,
}: SortablePinnedThreadListItemProps) {
  const { dragBindings, setNodeRef, style } = useSidebarSortable({
    id: getPinnedThreadNodeId(node),
    disabled,
  });

  return (
    <ThreadTreeNodeRow
      projectId={node.thread.projectId}
      node={node}
      depthOffset={0}
      isEnvGrouped={false}
      selectedThreadId={selectedThreadId}
      variant="section"
      onProjectSelect={onProjectSelect}
      dragBindings={dragBindings}
      sortableRef={setNodeRef}
      sortableStyle={style}
    />
  );
});

export const PinnedThreadList = memo(function PinnedThreadList({
  threadNodes,
  selectedThreadId,
  onProjectSelect,
  isPinnedReorderPending = false,
  onReorderPinnedThread,
}: PinnedThreadListProps) {
  const handleReorderPinnedThread = useCallback<
    UseNeighborReorderSortableArgs<ProjectThreadNode>["onReorder"]
  >(
    (request, callbacks) => {
      onReorderPinnedThread?.(request, callbacks);
    },
    [onReorderPinnedThread],
  );
  const reorderDisabled =
    isPinnedReorderPending || !onReorderPinnedThread || threadNodes.length < 2;
  const {
    handleDragEnd: handleSortableDragEnd,
    itemIds: renderedThreadNodeIds,
    renderedItems: renderedThreadNodes,
  } = useNeighborReorderSortable({
    disabled: reorderDisabled,
    getId: getPinnedThreadNodeId,
    items: threadNodes,
    onReorder: handleReorderPinnedThread,
  });
  const { dndContextProps, consumeClickSuppression, onClickCapture } =
    useSidebarReorderDnd({ onDragEnd: handleSortableDragEnd });

  if (renderedThreadNodes.length === 0) {
    return null;
  }

  return (
    <div
      data-sidebar-sticky-section=""
      className="relative space-y-0.5 group-data-[collapsible=icon]:hidden"
      onClickCapture={onClickCapture}
    >
      {renderedThreadNodes.length > 1 ? (
        <DndContext {...dndContextProps}>
          <SortableContext
            items={renderedThreadNodeIds}
            strategy={verticalListSortingStrategy}
          >
            {renderedThreadNodes.map((node) => (
              <SortablePinnedThreadListItem
                key={getPinnedThreadNodeId(node)}
                node={node}
                disabled={reorderDisabled}
                selectedThreadId={selectedThreadId}
                onProjectSelect={onProjectSelect}
              />
            ))}
          </SortableContext>
        </DndContext>
      ) : (
        renderedThreadNodes.map((node) => (
          <PinnedThreadListItem
            key={getPinnedThreadNodeId(node)}
            node={node}
            selectedThreadId={selectedThreadId}
            onProjectSelect={onProjectSelect}
            consumeClickSuppression={consumeClickSuppression}
          />
        ))
      )}
    </div>
  );
});
