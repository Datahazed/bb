import { useMemo, type ReactNode } from "react";
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
}

export function SidebarSectionOrderList({
  children,
  dndContextProps,
  order,
}: SidebarSectionOrderListProps) {
  // `SortableContext` memoizes its context value on the items array, and every
  // `useSortable` row subscribes to it; a fresh copy per render re-rendered
  // every row whenever the list did. The copy only exists because the prop is
  // readonly and dnd-kit wants a mutable array.
  const items = useMemo(() => [...order], [order]);
  const content = (
    <SortableContext items={items} strategy={verticalListSortingStrategy}>
      <div className="space-y-4">{order.map(children)}</div>
    </SortableContext>
  );

  return dndContextProps ? (
    <DndContext {...dndContextProps}>{content}</DndContext>
  ) : (
    content
  );
}
