import { useMemo, type CSSProperties } from "react";
import { useAtom } from "jotai";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type Modifier,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@bb/shared-ui/button";
import { CHROME_SECTION_LABEL_CLASS } from "@bb/shared-ui/chrome-style-tokens";
import {
  COARSE_POINTER_HEADER_ICON_BUTTON_CLASS,
  COARSE_POINTER_ICON_SIZE_CLASS,
} from "@bb/shared-ui/coarse-pointer-sizing";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
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
import {
  reorderSidebarRegions,
  sidebarRegionOrderAtom,
  type SidebarRegionId,
} from "./sidebarRegionOrderPreferences";

const ITEM_LABELS: Record<SidebarTopRegionItemId, string> = {
  "new-thread": "New thread",
  extensions: "Extensions",
  automations: "Automations",
};

const REGION_LABELS: Record<SidebarRegionId, string> = {
  "bb-controls": "BB controls",
  plugins: "Plugins",
  threads: "Threads",
};

const COMPACT_MENU_CONTENT_CLASS =
  "w-44 min-w-44 p-1 [&_[role=menuitem]]:!py-1 [&_[role=menuitemcheckbox]]:!py-1 [&_[role=separator]]:!my-0.5";
const COMPACT_MENU_LABEL_CLASS = "!px-2 !py-1";
const CUSTOMIZE_MENU_TITLE_CLASS =
  "text-sm font-medium leading-5 text-popover-foreground";
const SORTABLE_ITEM_CLASS = "gap-2 !px-2 !py-1";

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
    attributes,
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
        SORTABLE_ITEM_CLASS,
        "!pr-2 [&>span.absolute]:hidden",
        isDragging && "relative z-10 bg-state-hover opacity-90 shadow-sm",
      )}
      data-sidebar-customize-item={id}
    >
      <span
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={`Reorder ${ITEM_LABELS[id]}`}
        className={cn(
          "flex size-4 shrink-0 cursor-grab touch-none items-center justify-center rounded-sm text-subtle-foreground/60 active:cursor-grabbing",
          "hover:text-sidebar-foreground focus-visible:text-sidebar-foreground",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        )}
        onClick={(event) => event.stopPropagation()}
        data-sidebar-customize-drag-handle={id}
      >
        <Icon
          name="DragDropVertical"
          className={COARSE_POINTER_ICON_SIZE_CLASS}
        />
      </span>
      <span className="min-w-0 flex-1 truncate">{ITEM_LABELS[id]}</span>
      <span
        aria-hidden="true"
        data-sidebar-customize-checkbox={id}
        data-state={visible ? "checked" : "unchecked"}
        className={cn(
          "flex size-4 shrink-0 items-center justify-center rounded-sm border border-input shadow-xs",
          visible && "border-primary text-primary",
        )}
      >
        {visible ? <Icon name="Check" className="size-3.5" /> : null}
      </span>
    </DropdownMenuCheckboxItem>
  );
}

function SortableSidebarRegionItem({ id }: { id: SidebarRegionId }) {
  const {
    attributes,
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
  const label = REGION_LABELS[id];

  return (
    <DropdownMenuItem
      ref={setNodeRef}
      style={style}
      textValue={label}
      onSelect={(event) => event.preventDefault()}
      className={cn(
        SORTABLE_ITEM_CLASS,
        isDragging && "relative z-10 bg-state-hover opacity-90 shadow-sm",
      )}
      data-sidebar-customize-region={id}
    >
      <span
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={`Reorder ${label}`}
        className={cn(
          "flex size-4 shrink-0 cursor-grab touch-none items-center justify-center rounded-sm text-subtle-foreground/60 active:cursor-grabbing",
          "hover:text-sidebar-foreground focus-visible:text-sidebar-foreground",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        )}
        onClick={(event) => event.stopPropagation()}
        data-sidebar-customize-region-drag-handle={id}
      >
        <Icon
          name="DragDropVertical"
          className={COARSE_POINTER_ICON_SIZE_CLASS}
        />
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </DropdownMenuItem>
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
  const [regionOrder, setRegionOrder] = useAtom(sidebarRegionOrderAtom);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const handleTopRegionItemDragEnd = (event: DragEndEvent) => {
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
  const handleRegionDragEnd = (event: DragEndEvent) => {
    if (
      typeof event.active.id !== "string" ||
      typeof event.over?.id !== "string"
    ) {
      return;
    }
    const activeId = event.active.id as SidebarRegionId;
    const overId = event.over.id as SidebarRegionId;
    setRegionOrder((current) =>
      reorderSidebarRegions(current, activeId, overId),
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
        side="right"
        align="start"
        sideOffset={8}
        className={COMPACT_MENU_CONTENT_CLASS}
        mobileTitle="Customize"
      >
        <DropdownMenuLabel
          className={cn(
            CUSTOMIZE_MENU_TITLE_CLASS,
            COMPACT_MENU_LABEL_CLASS,
          )}
        >
          Customize
        </DropdownMenuLabel>
        <div role="group" aria-label="BB controls">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={dragModifiers}
            onDragEnd={handleTopRegionItemDragEnd}
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
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuLabel
          className={cn(CHROME_SECTION_LABEL_CLASS, COMPACT_MENU_LABEL_CLASS)}
        >
          Sidebar order
        </DropdownMenuLabel>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={dragModifiers}
          onDragEnd={handleRegionDragEnd}
        >
          <SortableContext
            items={regionOrder}
            strategy={verticalListSortingStrategy}
          >
            {regionOrder.map((id) => (
              <SortableSidebarRegionItem key={id} id={id} />
            ))}
          </SortableContext>
        </DndContext>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
