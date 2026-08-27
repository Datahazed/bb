import { useMemo, type CSSProperties } from "react";
import { useAtom } from "jotai";
import {
  closestCenter,
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type Modifier,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@bb/shared-ui/button";
import { CHROME_SECTION_LABEL_CLASS } from "@bb/shared-ui/chrome-style-tokens";
import { COARSE_POINTER_HEADER_ICON_BUTTON_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@bb/shared-ui/tooltip";
import {
  reorderSidebarTopRegionItems,
  setSidebarTopRegionItemVisible,
  sidebarTopRegionItemPreferencesAtom,
  type SidebarTopRegionItemId,
} from "./sidebarTopRegionItemPreferences";

const ITEM_LABELS: Record<SidebarTopRegionItemId, string> = {
  "new-thread": "New thread",
  extensions: "Extensions",
  automations: "Automations",
};

const restrictDragToVerticalAxis: Modifier = ({ transform }) => ({
  ...transform,
  x: 0,
});

const dragModifiers: Modifier[] = [restrictDragToVerticalAxis];

function SortableTopRegionItem({ id }: { id: SidebarTopRegionItemId }) {
  const [preferences, setPreferences] = useAtom(
    sidebarTopRegionItemPreferencesAtom,
  );
  const {
    isDragging,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id });
  const style = useMemo<CSSProperties>(
    () => ({
      transform: CSS.Translate.toString(transform),
      transition,
    }),
    [transform, transition],
  );
  const visible = !preferences.hiddenIds.includes(id);

  return (
    <DropdownMenuCheckboxItem
      ref={setNodeRef}
      style={style}
      checked={visible}
      textValue={ITEM_LABELS[id]}
      onSelect={(event) => event.preventDefault()}
      onCheckedChange={(checked) =>
        setPreferences((current) =>
          setSidebarTopRegionItemVisible(current, id, checked === true),
        )
      }
      className={cn(
        "gap-2",
        isDragging && "relative z-10 bg-state-hover opacity-90 shadow-sm",
      )}
      data-sidebar-customize-item={id}
    >
      <span
        ref={setActivatorNodeRef}
        {...listeners}
        aria-hidden="true"
        className="flex shrink-0 cursor-grab touch-none items-center text-muted-foreground active:cursor-grabbing"
        data-sidebar-customize-drag-handle={id}
      >
        <Icon name="DragDropVertical" className="size-3.5" />
      </span>
      <span className="min-w-0 flex-1 truncate">{ITEM_LABELS[id]}</span>
    </DropdownMenuCheckboxItem>
  );
}

export function SidebarTopRegionCustomizeMenu({
  className,
}: {
  className?: string;
}) {
  const [preferences, setPreferences] = useAtom(
    sidebarTopRegionItemPreferencesAtom,
  );
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );
  const handleDragEnd = (event: DragEndEvent) => {
    if (
      typeof event.active.id !== "string" ||
      typeof event.over?.id !== "string"
    ) {
      return;
    }
    const activeId = event.active.id as SidebarTopRegionItemId;
    const overId = event.over.id as SidebarTopRegionItemId;
    setPreferences((current) =>
      reorderSidebarTopRegionItems(current, activeId, overId),
    );
  };

  return (
    <DropdownMenu>
      <Tooltip delayDuration={350} disableHoverableContent>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Customize sidebar"
              className={cn(
                COARSE_POINTER_HEADER_ICON_BUTTON_CLASS,
                "text-muted-foreground ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2",
                className,
              )}
            >
              <Icon name="SlidersHorizontal" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="px-2 py-1">
          Customize sidebar
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        align="end"
        className="min-w-52"
        mobileTitle="Sidebar items"
      >
        <DropdownMenuLabel className={CHROME_SECTION_LABEL_CLASS}>
          Sidebar items
        </DropdownMenuLabel>
        <p className="px-2 pb-2 text-xs text-muted-foreground">
          Drag to reorder. Uncheck to hide.
        </p>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={dragModifiers}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={preferences.order}
            strategy={verticalListSortingStrategy}
          >
            {preferences.order.map((id) => (
              <SortableTopRegionItem key={id} id={id} />
            ))}
          </SortableContext>
        </DndContext>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
