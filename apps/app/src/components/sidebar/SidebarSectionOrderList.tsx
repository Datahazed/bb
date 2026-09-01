import { Fragment, type ReactNode } from "react";
import { DndContext } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type { SidebarSectionId } from "./sidebarCollapsedAtoms";
import type { SidebarReorderDndContextProps } from "./useSidebarReorderDnd";

interface SidebarSectionOrderListProps {
  children: (sectionId: SidebarSectionId) => ReactNode;
  dndContextProps?: SidebarReorderDndContextProps;
  order: readonly SidebarSectionId[];
  pinnedTrailingContent?: ReactNode;
}

export function SidebarSectionOrderList({
  children,
  dndContextProps,
  order,
  pinnedTrailingContent,
}: SidebarSectionOrderListProps) {
  const hasPinnedSection = order.includes("pinned");
  const content = (
    <SortableContext items={[...order]} strategy={verticalListSortingStrategy}>
      <div className="space-y-4">
        {!hasPinnedSection ? pinnedTrailingContent : null}
        {order.map((sectionId) => (
          <Fragment key={sectionId}>
            {children(sectionId)}
            {sectionId === "pinned" ? pinnedTrailingContent : null}
          </Fragment>
        ))}
      </div>
    </SortableContext>
  );

  return dndContextProps ? (
    <DndContext {...dndContextProps}>{content}</DndContext>
  ) : (
    content
  );
}
