import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
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
  arrayMove,
  sortableKeyboardCoordinates,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { UnavailableIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@bb/shared-ui/button";
import { CHROME_SECTION_LABEL_CLASS } from "@bb/shared-ui/chrome-style-tokens";
import {
  COARSE_POINTER_ICON_SIZE_CLASS,
  COARSE_POINTER_ROW_ACTION_SIZE_CLASS,
} from "@bb/shared-ui/coarse-pointer-sizing";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { createStore, Provider as JotaiProvider, useAtomValue } from "jotai";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";
import {
  SIDEBAR_COLLAPSE_CARET_SLOT_CLASS,
  SIDEBAR_HOVER_ACTIONS_CLASS,
  SIDEBAR_HOVER_ACTIONS_FADE_CLASS,
  SIDEBAR_HOVER_ACTIONS_GAP_CLASS,
  SIDEBAR_HOVER_ACTIONS_INSET_CLASS,
  SIDEBAR_HOVER_ACTIONS_MOBILE_ALWAYS_VALUE,
  SIDEBAR_HOVER_ACTIONS_ROW_CLASS,
} from "@/components/ui/sidebar-hover-actions";
import { OverflowFade } from "@/components/ui/overflow-fade";
import {
  SIDEBAR_LEADING_GLYPH_SLOT_CLASS,
  SIDEBAR_MORE_ACTION_TRIGGER_CLASS,
} from "./sidebarRowClasses";
import { SidebarChildToggleChevron } from "./SidebarChildToggleChevron";
import { SidebarFilterSortMenu, SidebarOrganizeMenu } from "./ProjectList";
import {
  sidebarChronologicalSortAtom,
  sidebarOrganizationModeAtom,
} from "./sidebarCollapsedAtoms";

export default {
  title: "sidebar/View options menu",
};

type Grouping = "project" | "machine" | "manual";
type Sort = "updated" | "created" | "alpha";
type SortDirection = "asc" | "desc";
type ThreadStatus = "active" | "drafts" | "archived";

const PROTOTYPE_ACTION_TONE_CLASS =
  "text-muted-foreground hover:text-sidebar-foreground focus-visible:text-sidebar-foreground data-[state=open]:text-sidebar-foreground";
const PROTOTYPE_COMPACT_MENU_CONTENT_CLASS =
  "p-1 [&_[role=menuitem]]:!py-1 [&_[role=menuitemcheckbox]]:!py-1 [&_[role=menuitemradio]]:!py-1 [&_[role=separator]]:!my-0.5";
const PROTOTYPE_COMPACT_MENU_LABEL_CLASS = "!px-2 !py-1";
const PROTOTYPE_THREAD_LIST_HEADER_CLASS =
  "text-xs font-semibold text-muted-foreground";
const PROTOTYPE_THREAD_GROUP_HEADER_CLASS =
  "text-xs font-medium text-subtle-foreground";
const PROTOTYPE_THREAD_ROW_TEXT_CLASS =
  "text-sm font-normal text-sidebar-foreground/85 dark:text-sidebar-foreground";

const GROUP_OPTIONS = [
  { label: "By project", value: "project" },
  { label: "By machine", value: "machine" },
  { label: "Custom", value: "manual" },
] as const satisfies readonly {
  label: string;
  value: Grouping;
}[];

const GROUPED_THREAD_LIST_LABELS: Record<Grouping, string> = {
  project: "Projects",
  machine: "Machines",
  manual: "Sections",
};

const SORT_OPTIONS = [
  { defaultDirection: "desc", label: "Updated at", value: "updated" },
  { defaultDirection: "desc", label: "Created at", value: "created" },
  { defaultDirection: "asc", label: "Alphabetical", value: "alpha" },
] as const satisfies readonly {
  defaultDirection: SortDirection;
  label: string;
  value: Sort;
}[];

const STATUS_OPTIONS = [
  { label: "Active", value: "active" },
  { label: "Archived", value: "archived" },
  { label: "Drafts", value: "drafts" },
] as const satisfies readonly {
  label: string;
  value: ThreadStatus;
}[];

function usePrototypeSelection(initialGrouping: Grouping = "project") {
  const [grouping, setGrouping] = useState<Grouping>(initialGrouping);
  const [sort, setSort] = useState<Sort>("updated");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [statuses, setStatuses] = useState<ReadonlySet<ThreadStatus>>(
    () => new Set(["active"]),
  );

  const toggleStatus = (status: ThreadStatus) => {
    setStatuses((current) => {
      if (current.has(status) && current.size === 1) return current;
      const next = new Set(current);
      if (next.has(status)) {
        next.delete(status);
      } else {
        next.add(status);
      }
      return next;
    });
  };

  const selectSort = (nextSort: Sort) => {
    if (nextSort === sort) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    const option = SORT_OPTIONS.find(
      (candidate) => candidate.value === nextSort,
    );
    setSort(nextSort);
    setSortDirection(option?.defaultDirection ?? "asc");
  };

  return {
    grouping,
    setGrouping,
    sort,
    sortDirection,
    selectSort,
    statuses,
    toggleStatus,
  };
}

type PrototypeSelection = ReturnType<typeof usePrototypeSelection>;

function IconTrigger({
  fillIcon = false,
  icon,
  label,
  pressed,
}: {
  fillIcon?: boolean;
  icon: IconName;
  label: string;
  pressed?: boolean;
}) {
  return (
    <DropdownMenuTrigger asChild>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={label}
        aria-pressed={pressed}
        className={cn(
          "rounded-md p-0 data-[state=open]:bg-sidebar-accent",
          PROTOTYPE_ACTION_TONE_CLASS,
          COARSE_POINTER_ROW_ACTION_SIZE_CLASS,
        )}
      >
        <Icon
          name={icon}
          className={cn(
            COARSE_POINTER_ICON_SIZE_CLASS,
            fillIcon && "[&_path]:fill-current",
          )}
        />
      </Button>
    </DropdownMenuTrigger>
  );
}

function GroupItems({ state }: { state: PrototypeSelection }) {
  return GROUP_OPTIONS.map((option) => (
    <DropdownMenuCheckboxItem
      key={option.value}
      checked={state.grouping === option.value}
      onCheckedChange={() => state.setGrouping(option.value)}
      className="gap-2"
    >
      <span>{option.label}</span>
    </DropdownMenuCheckboxItem>
  ));
}

function SortItems({ state }: { state: PrototypeSelection }) {
  return SORT_OPTIONS.map((option) => {
    const selected = state.sort === option.value;
    return (
      <DropdownMenuItem
        key={option.value}
        role="menuitemradio"
        aria-checked={selected}
        onSelect={(event) => {
          event.preventDefault();
          state.selectSort(option.value);
        }}
        className="flex items-center justify-between gap-3"
      >
        <span>{option.label}</span>
        <Icon
          name={state.sortDirection === "asc" ? "ArrowUp" : "ArrowDown"}
          aria-hidden="true"
          className={selected ? "size-4 opacity-100" : "size-4 opacity-0"}
        />
      </DropdownMenuItem>
    );
  });
}

function StatusItems({ state }: { state: PrototypeSelection }) {
  return STATUS_OPTIONS.map((option) => (
    <DropdownMenuCheckboxItem
      key={option.value}
      checked={state.statuses.has(option.value)}
      onSelect={(event) => event.preventDefault()}
      onCheckedChange={() => state.toggleStatus(option.value)}
    >
      {option.label}
    </DropdownMenuCheckboxItem>
  ));
}

function RowActionIcon({
  icon,
  label,
  mobileHidden = false,
}: {
  icon: IconName;
  label: string;
  mobileHidden?: boolean;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={label}
      className={cn(
        "rounded-md p-0 hover:bg-transparent",
        PROTOTYPE_ACTION_TONE_CLASS,
        COARSE_POINTER_ROW_ACTION_SIZE_CLASS,
        mobileHidden && "max-md:pointer-coarse:hidden",
      )}
    >
      <Icon name={icon} className={COARSE_POINTER_ICON_SIZE_CLASS} />
    </Button>
  );
}

function RowActionsMenu({
  grouping,
  label,
  onOpenChange,
}: {
  grouping: Grouping;
  label: string;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`${label} actions`}
          className={cn(
            "rounded-md p-0 hover:bg-transparent data-[state=open]:bg-state-active",
            PROTOTYPE_ACTION_TONE_CLASS,
            SIDEBAR_MORE_ACTION_TRIGGER_CLASS,
          )}
        >
          <Icon
            name="MoreHorizontal"
            className={COARSE_POINTER_ICON_SIZE_CLASS}
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className={PROTOTYPE_COMPACT_MENU_CONTENT_CLASS}
      >
        <DropdownMenuItem>
          <Icon name="MessageSquarePlus" aria-hidden="true" />
          New thread
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {grouping === "project" ? (
          <>
            <DropdownMenuItem>
              <Icon name="Settings" aria-hidden="true" />
              Project settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuItem>
          <Icon name="Edit" aria-hidden="true" />
          Rename
        </DropdownMenuItem>
        {grouping === "project" ? (
          <DropdownMenuItem>
            <Icon name="FolderPlus" aria-hidden="true" />
            Add local path
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem variant="destructive">
          <Icon name="Trash2" aria-hidden="true" />
          Remove
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface ViewGroupFixture {
  kind: "entity" | "loose";
  label: string;
  threads: readonly PrototypeThreadFixture[];
}

interface PrototypeThreadFixture {
  title: string;
  status: ThreadStatus;
  isPinned?: boolean;
  isRead?: boolean;
}

const VIEW_FIXTURES: Record<Grouping, readonly ViewGroupFixture[]> = {
  project: [
    {
      kind: "entity",
      label: "Updated Sidebar",
      threads: [
        { title: "Sidebar polish", status: "active", isPinned: true },
        { title: "Search evidence", status: "drafts" },
        { title: "Plugin navigation", status: "archived" },
      ],
    },
    {
      kind: "entity",
      label: "Marketing Site",
      threads: [
        { title: "Homepage refresh", status: "active", isRead: false },
        { title: "Safari verification", status: "archived" },
      ],
    },
    {
      kind: "entity",
      label: "Plugin SDK",
      threads: [
        { title: "Document resource slots", status: "active" },
        { title: "Review compatibility", status: "drafts" },
      ],
    },
    {
      kind: "loose",
      label: "Threads",
      threads: [
        { title: "Cross-project follow-up", status: "active" },
        { title: "Quick question", status: "active", isRead: false },
        { title: "Review release copy", status: "active" },
        { title: "Unassigned release note", status: "drafts" },
      ],
    },
  ],
  machine: [
    {
      kind: "entity",
      label: "This Mac",
      threads: [
        { title: "Updated sidebar", status: "active", isPinned: true },
        { title: "Menu prototypes", status: "drafts" },
        { title: "Dev app", status: "archived" },
      ],
    },
    {
      kind: "entity",
      label: "bb-worker-1",
      threads: [
        { title: "Capture screenshots", status: "active", isRead: false },
        { title: "Run CI", status: "archived" },
      ],
    },
    {
      kind: "entity",
      label: "Old MacBook Air",
      threads: [{ title: "Investigate replay", status: "active" }],
    },
  ],
  manual: [
    {
      kind: "entity",
      label: "Planning",
      threads: [
        { title: "Updated sidebar spec", status: "active" },
        { title: "Menu structure", status: "drafts" },
      ],
    },
    {
      kind: "entity",
      label: "Building",
      threads: [
        { title: "Search palette", status: "active", isPinned: true },
        { title: "Sidebar polish", status: "active", isRead: false },
        { title: "Plugin navigation", status: "archived" },
      ],
    },
    {
      kind: "loose",
      label: "Threads",
      threads: [
        { title: "Investigate flaky test", status: "active" },
        { title: "Inbox cleanup", status: "active", isRead: false },
        { title: "Unsorted feedback", status: "active" },
        { title: "Draft release notes", status: "drafts" },
      ],
    },
  ],
};

const LONG_SIDEBAR_PROJECT_FIXTURES: readonly ViewGroupFixture[] = [
  {
    kind: "entity",
    label: "Agent Runtime",
    threads: [
      { title: "Provider handoff", status: "active" },
      { title: "Session recovery", status: "active" },
    ],
  },
  {
    kind: "entity",
    label: "Mobile Polish",
    threads: [
      { title: "Compact composer", status: "active" },
      { title: "Drawer transitions", status: "active" },
    ],
  },
  {
    kind: "entity",
    label: "Command Palette",
    threads: [
      { title: "Recent commands", status: "active" },
      { title: "Keyboard navigation", status: "active" },
    ],
  },
  {
    kind: "entity",
    label: "Data Import",
    threads: [
      { title: "CSV mapping", status: "active" },
      { title: "Import history", status: "active" },
    ],
  },
  {
    kind: "entity",
    label: "Integrations",
    threads: [
      { title: "GitHub sync", status: "active" },
      { title: "Slack notifications", status: "active" },
    ],
  },
  {
    kind: "entity",
    label: "Documentation",
    threads: [
      { title: "Quickstart refresh", status: "active" },
      { title: "API examples", status: "active" },
    ],
  },
];

type TopItemId = "new-thread" | "extensions" | "automations";
type MainSectionId = "bb-controls" | "plugins" | "threads";

const TOP_ITEMS = {
  "new-thread": { icon: "MessageSquarePlus", label: "New thread" },
  extensions: { icon: "Toolbox", label: "Extensions" },
  automations: { icon: "TimeSchedule", label: "Automations" },
} as const satisfies Record<TopItemId, { icon: IconName; label: string }>;

const MAIN_SECTION_LABELS = {
  "bb-controls": "BB controls",
  plugins: "Plugins",
  threads: "Threads",
} as const satisfies Record<MainSectionId, string>;

const restrictDragToVerticalAxis: Modifier = ({ transform }) => ({
  ...transform,
  x: 0,
});

const dragModifiers: Modifier[] = [restrictDragToVerticalAxis];

function SortableCustomizeItem({
  checked,
  id,
  label,
  onCheckedChange,
}: {
  checked?: boolean;
  id: string;
  label: string;
  onCheckedChange?: (checked: boolean) => void;
}) {
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
  const commonClassName = cn(
    "group/customize-row gap-2 !px-2 !py-1",
    isDragging && "relative z-10 bg-state-hover opacity-90 shadow-sm",
  );
  const content = (
    <>
      <span
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={`Reorder ${label}`}
        title={`Reorder ${label}`}
        data-dragging={isDragging ? "true" : undefined}
        className={cn(
          "flex size-4 shrink-0 cursor-grab touch-none items-center justify-center rounded-sm text-subtle-foreground/60 active:cursor-grabbing",
          "hover:text-sidebar-foreground focus-visible:text-sidebar-foreground",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        )}
        onClick={(event) => event.stopPropagation()}
      >
        <Icon
          name="DragDropVertical"
          className={COARSE_POINTER_ICON_SIZE_CLASS}
        />
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {checked !== undefined ? (
        <span
          aria-hidden="true"
          data-state={checked ? "checked" : "unchecked"}
          className={cn(
            "flex size-4 shrink-0 items-center justify-center rounded-sm border border-input shadow-xs",
            checked && "border-primary text-primary",
          )}
        >
          {checked ? <Icon name="Check" className="size-3.5" /> : null}
        </span>
      ) : null}
    </>
  );

  if (checked === undefined || onCheckedChange === undefined) {
    return (
      <DropdownMenuItem
        ref={setNodeRef}
        style={style}
        textValue={label}
        onSelect={(event) => event.preventDefault()}
        className={commonClassName}
      >
        {content}
      </DropdownMenuItem>
    );
  }

  return (
    <DropdownMenuCheckboxItem
      ref={setNodeRef}
      style={style}
      checked={checked}
      textValue={label}
      onSelect={(event) => event.preventDefault()}
      onCheckedChange={(nextChecked) => onCheckedChange(nextChecked === true)}
      className={cn(commonClassName, "[&>span.absolute]:hidden")}
    >
      {content}
    </DropdownMenuCheckboxItem>
  );
}

function CustomizeSidebarMenu({
  mainSectionOrder,
  onMainSectionOrderChange,
  onTopItemOrderChange,
  onTopItemVisibilityChange,
  topItemOrder,
  visibleTopItems,
}: {
  mainSectionOrder: readonly MainSectionId[];
  onMainSectionOrderChange: (order: MainSectionId[]) => void;
  onTopItemOrderChange: (order: TopItemId[]) => void;
  onTopItemVisibilityChange: (id: TopItemId, visible: boolean) => void;
  topItemOrder: readonly TopItemId[];
  visibleTopItems: ReadonlySet<TopItemId>;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const reorder = <T extends string>(
    event: DragEndEvent,
    order: readonly T[],
    updateOrder: (next: T[]) => void,
  ) => {
    if (
      typeof event.active.id !== "string" ||
      typeof event.over?.id !== "string"
    ) {
      return;
    }
    const from = order.indexOf(event.active.id as T);
    const to = order.indexOf(event.over.id as T);
    if (from !== -1 && to !== -1 && from !== to) {
      updateOrder(arrayMove([...order], from, to));
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Customize sidebar"
          className={cn(
            "size-7 rounded-md hover:bg-sidebar-accent",
            PROTOTYPE_ACTION_TONE_CLASS,
          )}
        >
          <Icon name="SlidersHorizontal" className="size-4" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="right"
        align="start"
        sideOffset={8}
        className={cn("w-44 min-w-44", PROTOTYPE_COMPACT_MENU_CONTENT_CLASS)}
        mobileTitle="Customize"
      >
        <DropdownMenuLabel
          className={cn(
            "text-sm font-medium leading-5 text-popover-foreground",
            PROTOTYPE_COMPACT_MENU_LABEL_CLASS,
          )}
        >
          Customize
        </DropdownMenuLabel>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={dragModifiers}
          onDragEnd={(event) =>
            reorder(event, topItemOrder, onTopItemOrderChange)
          }
        >
          <SortableContext
            items={[...topItemOrder]}
            strategy={verticalListSortingStrategy}
          >
            {topItemOrder.map((id) => (
              <SortableCustomizeItem
                key={id}
                id={id}
                label={TOP_ITEMS[id].label}
                checked={visibleTopItems.has(id)}
                onCheckedChange={(visible) =>
                  onTopItemVisibilityChange(id, visible)
                }
              />
            ))}
          </SortableContext>
        </DndContext>
        <DropdownMenuSeparator />
        <DropdownMenuLabel
          className={cn(
            CHROME_SECTION_LABEL_CLASS,
            PROTOTYPE_COMPACT_MENU_LABEL_CLASS,
          )}
        >
          Sidebar order
        </DropdownMenuLabel>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={dragModifiers}
          onDragEnd={(event) =>
            reorder(event, mainSectionOrder, onMainSectionOrderChange)
          }
        >
          <SortableContext
            items={[...mainSectionOrder]}
            strategy={verticalListSortingStrategy}
          >
            {mainSectionOrder.map((id) => (
              <SortableCustomizeItem
                key={id}
                id={id}
                label={MAIN_SECTION_LABELS[id]}
              />
            ))}
          </SortableContext>
        </DndContext>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SidebarNavRow({
  icon,
  id,
  label,
}: {
  icon: IconName;
  id: TopItemId;
  label: string;
}) {
  const hasSplitAction = id === "new-thread";
  return (
    <div
      className={cn(
        SIDEBAR_HOVER_ACTIONS_ROW_CLASS,
        "relative flex h-8 min-w-0 items-center",
      )}
    >
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="flex h-8 w-full min-w-0 cursor-pointer items-center justify-start gap-2 overflow-hidden rounded-md px-2 font-normal text-sidebar-foreground/85"
      >
        {id === "extensions" ? (
          <span className={SIDEBAR_LEADING_GLYPH_SLOT_CLASS}>
            <span
              className="bb-sidebar-row-icon-swap shrink-0"
              aria-hidden="true"
            >
              <Icon
                name="Toolbox"
                className={cn(
                  "bb-sidebar-row-icon-rest",
                  COARSE_POINTER_ICON_SIZE_CLASS,
                )}
              />
              <Icon
                name="ToolCase"
                className={cn(
                  "bb-sidebar-row-icon-hover",
                  COARSE_POINTER_ICON_SIZE_CLASS,
                )}
              />
            </span>
          </span>
        ) : (
          <span className={SIDEBAR_LEADING_GLYPH_SLOT_CLASS}>
            <Icon
              name={icon}
              className={COARSE_POINTER_ICON_SIZE_CLASS}
              aria-hidden="true"
            />
          </span>
        )}
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-left",
            hasSplitAction && SIDEBAR_HOVER_ACTIONS_INSET_CLASS,
          )}
        >
          {label}
        </span>
      </Button>
      {hasSplitAction ? (
        <span
          className={cn(
            SIDEBAR_HOVER_ACTIONS_CLASS,
            "absolute inset-y-0 right-0 flex items-center",
          )}
        >
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label="Split"
            className={cn(
              "rounded-md p-0",
              PROTOTYPE_ACTION_TONE_CLASS,
              COARSE_POINTER_ROW_ACTION_SIZE_CLASS,
            )}
          >
            <Icon name="Columns2" className={COARSE_POINTER_ICON_SIZE_CLASS} />
          </Button>
        </span>
      ) : null}
    </div>
  );
}

function BbControlsSection({
  topItemOrder,
  visibleTopItems,
}: {
  topItemOrder: readonly TopItemId[];
  visibleTopItems: ReadonlySet<TopItemId>;
}) {
  return (
    <div className="px-2 py-2">
      {topItemOrder
        .filter((id) => visibleTopItems.has(id))
        .map((id) => (
          <SidebarNavRow
            key={id}
            id={id}
            icon={TOP_ITEMS[id].icon}
            label={TOP_ITEMS[id].label}
          />
        ))}
    </div>
  );
}

function PluginSidebarRow({
  icon,
  index,
  label,
}: {
  icon: IconName;
  index: number;
  label: string;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div
      className={cn(
        SIDEBAR_HOVER_ACTIONS_ROW_CLASS,
        "relative flex h-8 items-center rounded-md px-2 text-sm text-sidebar-foreground/85",
      )}
    >
      <span className={SIDEBAR_LEADING_GLYPH_SLOT_CLASS}>
        <Icon
          name={icon}
          className={COARSE_POINTER_ICON_SIZE_CLASS}
          aria-hidden="true"
        />
      </span>
      <span className="ml-2 min-w-0 flex-1 truncate">{label}</span>
      <span
        data-sidebar-hover-actions-open={menuOpen ? "true" : undefined}
        className={cn(
          SIDEBAR_HOVER_ACTIONS_CLASS,
          "absolute inset-y-0 right-0 flex items-center",
        )}
      >
        <DropdownMenu onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`${label} panel options`}
              className={cn(
                "rounded-md p-0 data-[state=open]:bg-sidebar-accent",
                PROTOTYPE_ACTION_TONE_CLASS,
                SIDEBAR_MORE_ACTION_TRIGGER_CLASS,
              )}
            >
              <Icon
                name="MoreHorizontal"
                className={COARSE_POINTER_ICON_SIZE_CLASS}
              />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className={PROTOTYPE_COMPACT_MENU_CONTENT_CLASS}
          >
            <DropdownMenuItem>
              <Icon name="Columns2" aria-hidden="true" />
              Open in split
            </DropdownMenuItem>
            <DropdownMenuItem>
              <Icon name="Info" aria-hidden="true" />
              View details
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={index === 0}>
              <Icon name="ArrowUp" aria-hidden="true" />
              Move to top
            </DropdownMenuItem>
            <DropdownMenuItem disabled>
              <Icon name="ArrowDown" aria-hidden="true" />
              Move to overflow
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem>
              <HugeiconsIcon icon={UnavailableIcon} aria-hidden="true" />
              Disable
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </span>
    </div>
  );
}

function PluginsSection() {
  return (
    <div className="px-1.5 py-2">
      <div
        className={cn(
          "flex h-7 items-center px-2",
          PROTOTYPE_THREAD_GROUP_HEADER_CLASS,
        )}
      >
        Plugins
      </div>
      <PluginSidebarRow icon="Github" index={0} label="GitHub" />
      <PluginSidebarRow icon="Browser" index={1} label="Browser" />
    </div>
  );
}

function ThreadToolbarAdditionalActions({ grouping }: { grouping: Grouping }) {
  if (grouping !== "manual") {
    return <RowActionIcon icon="FolderPlus" label="New project" />;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="More thread actions"
          className={cn(
            "rounded-md p-0 hover:bg-transparent data-[state=open]:bg-state-active",
            PROTOTYPE_ACTION_TONE_CLASS,
            SIDEBAR_MORE_ACTION_TRIGGER_CLASS,
          )}
        >
          <Icon
            name="MoreHorizontal"
            className={COARSE_POINTER_ICON_SIZE_CLASS}
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className={PROTOTYPE_COMPACT_MENU_CONTENT_CLASS}
      >
        <DropdownMenuItem>
          <Icon name="SectionAdd" aria-hidden="true" />
          New section
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem>
          <Icon name="FolderPlus" aria-hidden="true" />
          New project
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MoveThreadSubmenu({
  currentGroup,
  destinations,
  isPinned,
  onMove,
}: {
  currentGroup: string;
  destinations: readonly string[];
  isPinned: boolean;
  onMove: (destination: string) => void;
}) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Icon name="Section" aria-hidden="true" />
        Move to section
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent
        className={cn("min-w-40", PROTOTYPE_COMPACT_MENU_CONTENT_CLASS)}
      >
        {destinations.map((destination) => (
          <DropdownMenuItem
            key={destination}
            disabled={!isPinned && destination === currentGroup}
            aria-current={
              !isPinned && destination === currentGroup ? "true" : undefined
            }
            onSelect={() => {
              if (!isPinned && destination === currentGroup) return;
              onMove(destination);
            }}
            className="flex items-center justify-between gap-3"
          >
            <span>{destination}</span>
            <Icon
              name="Check"
              aria-hidden="true"
              className={cn(
                "size-4",
                !isPinned && destination === currentGroup
                  ? "opacity-100"
                  : "opacity-0",
              )}
            />
          </DropdownMenuItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

function PrototypeThreadActionsMenu({
  currentGroup,
  destinations,
  grouping,
  onMove,
  onOpenChange,
  thread,
}: {
  currentGroup: string;
  destinations: readonly string[];
  grouping: Grouping;
  onMove: (destination: string) => void;
  onOpenChange: (open: boolean) => void;
  thread: PrototypeThreadFixture;
}) {
  const isArchived = thread.status === "archived";
  const isDraft = thread.status === "drafts";
  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`${thread.title} actions`}
          className={cn(
            "rounded-md p-0 hover:bg-transparent data-[state=open]:bg-state-active",
            PROTOTYPE_ACTION_TONE_CLASS,
            SIDEBAR_MORE_ACTION_TRIGGER_CLASS,
          )}
        >
          <Icon
            name="MoreHorizontal"
            className={COARSE_POINTER_ICON_SIZE_CLASS}
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className={PROTOTYPE_COMPACT_MENU_CONTENT_CLASS}
      >
        {!isArchived ? (
          <DropdownMenuItem>
            <Icon name="Columns2" aria-hidden="true" />
            Open in split
          </DropdownMenuItem>
        ) : null}
        {isDraft ? (
          <DropdownMenuItem variant="destructive">
            <Icon name="Trash2" aria-hidden="true" />
            Delete draft
          </DropdownMenuItem>
        ) : (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem>
              <Icon
                name={thread.isRead === false ? "MailOpen" : "Mail"}
                aria-hidden="true"
              />
              {thread.isRead === false ? "Mark read" : "Mark unread"}
            </DropdownMenuItem>
            <DropdownMenuItem>
              <Icon
                name={thread.isPinned ? "PinOff" : "Pin"}
                aria-hidden="true"
              />
              {thread.isPinned ? "Unpin" : "Pin"}
            </DropdownMenuItem>
            {grouping === "manual" && !isArchived ? (
              <MoveThreadSubmenu
                currentGroup={currentGroup}
                destinations={destinations}
                isPinned={thread.isPinned === true}
                onMove={onMove}
              />
            ) : null}
            <DropdownMenuItem>
              <Icon name="Edit" aria-hidden="true" />
              Rename
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem>
              <Icon
                name={isArchived ? "ArchiveRestore" : "Archive"}
                aria-hidden="true"
              />
              {isArchived ? "Unarchive" : "Archive"}
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive">
              <Icon name="Trash2" aria-hidden="true" />
              Delete
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PrototypeThreadRow({
  currentGroup,
  destinations,
  grouping,
  onMove,
  selected,
  thread,
}: {
  currentGroup: string;
  destinations: readonly string[];
  grouping: Grouping;
  onMove: (destination: string) => void;
  selected: boolean;
  thread: PrototypeThreadFixture;
}) {
  const [actionsOpen, setActionsOpen] = useState(false);
  const isArchived = thread.status === "archived";
  const isDraft = thread.status === "drafts";
  return (
    <div
      tabIndex={0}
      data-sidebar-hover-actions-open={actionsOpen ? "true" : undefined}
      className={cn(
        SIDEBAR_HOVER_ACTIONS_ROW_CLASS,
        "relative flex h-8 items-center rounded-sm px-2 pr-14 outline-none focus-visible:ring-1 focus-visible:ring-ring max-md:pointer-coarse:pr-2",
        PROTOTYPE_THREAD_ROW_TEXT_CLASS,
        selected && "bg-sidebar-accent",
      )}
    >
      <span className="min-w-0 flex-1 truncate">{thread.title}</span>
      {isDraft || isArchived ? (
        <span
          className={cn(
            SIDEBAR_HOVER_ACTIONS_FADE_CLASS,
            "absolute right-2 text-2xs text-muted-foreground max-md:pointer-coarse:relative max-md:pointer-coarse:right-auto max-md:pointer-coarse:shrink-0 max-md:pointer-coarse:!opacity-100",
          )}
        >
          {isArchived ? "Archived" : "Draft"}
        </span>
      ) : null}
      <span
        data-sidebar-hover-actions-open={actionsOpen ? "true" : undefined}
        data-sidebar-hover-actions-mobile={
          SIDEBAR_HOVER_ACTIONS_MOBILE_ALWAYS_VALUE
        }
        className={cn(
          SIDEBAR_HOVER_ACTIONS_CLASS,
          SIDEBAR_HOVER_ACTIONS_GAP_CLASS,
          "absolute inset-y-0 right-1 flex items-center max-md:pointer-coarse:relative max-md:pointer-coarse:inset-auto max-md:pointer-coarse:right-auto",
        )}
      >
        {isDraft ? null : (
          <RowActionIcon
            icon={isArchived ? "ArchiveRestore" : "Archive"}
            label={isArchived ? "Unarchive" : "Archive"}
            mobileHidden
          />
        )}
        <PrototypeThreadActionsMenu
          currentGroup={currentGroup}
          destinations={destinations}
          grouping={grouping}
          onMove={onMove}
          onOpenChange={setActionsOpen}
          thread={thread}
        />
      </span>
    </div>
  );
}

function ThreadListSection({
  empty = false,
  initialGrouping,
  longList = false,
  looseOnly = false,
  stickyToolbar = false,
}: {
  empty?: boolean;
  initialGrouping: Grouping;
  longList?: boolean;
  looseOnly?: boolean;
  stickyToolbar?: boolean;
}) {
  const state = usePrototypeSelection(initialGrouping);
  const [organizeOpen, setOrganizeOpen] = useState(false);
  const [filterSortOpen, setFilterSortOpen] = useState(false);
  const [rowMenuOpen, setRowMenuOpen] = useState<string | null>(null);
  const [manualDestinationByThread, setManualDestinationByThread] = useState<
    Readonly<Record<string, string>>
  >({});
  const [manualUnpinnedThreads, setManualUnpinnedThreads] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(
    () =>
      new Set(
        initialGrouping === "project"
          ? ["Marketing Site"]
          : initialGrouping === "machine"
            ? ["bb-worker-1"]
            : ["Building"],
      ),
  );
  const selectedGroupingLabel =
    GROUP_OPTIONS.find((option) => option.value === state.grouping)?.label ??
    state.grouping;
  const manualDestinations = VIEW_FIXTURES.manual.map((group) => group.label);
  const groups = useMemo(() => {
    if (empty) return [];
    if (state.grouping !== "manual") {
      const viewGroups = VIEW_FIXTURES[state.grouping];
      const visibleGroups =
        longList && state.grouping === "project"
          ? [...viewGroups, ...LONG_SIDEBAR_PROJECT_FIXTURES]
          : viewGroups;
      return looseOnly
        ? visibleGroups.filter((group) => group.kind === "loose")
        : visibleGroups;
    }
    const originalDestinationByThread = new Map<string, string>();
    const allThreads = VIEW_FIXTURES.manual.flatMap((group) =>
      group.threads.map((thread) => {
        originalDestinationByThread.set(thread.title, group.label);
        return thread;
      }),
    );
    const visibleGroups = VIEW_FIXTURES.manual.map((group) => ({
      ...group,
      threads: allThreads
        .filter(
          (thread) =>
            (manualDestinationByThread[thread.title] ??
              originalDestinationByThread.get(thread.title)) === group.label,
        )
        .map((thread) =>
          manualUnpinnedThreads.has(thread.title)
            ? { ...thread, isPinned: false }
            : thread,
        ),
    }));
    return looseOnly
      ? visibleGroups.filter((group) => group.kind === "loose")
      : visibleGroups;
  }, [
    empty,
    longList,
    looseOnly,
    manualDestinationByThread,
    manualUnpinnedThreads,
    state.grouping,
  ]);
  const activeGroups = state.statuses.has("active")
    ? groups
        .map((group) => ({
          ...group,
          threads: group.threads.filter((thread) => thread.status === "active"),
        }))
        .filter((group) => group.threads.length > 0)
    : [];
  const draftThreads = state.statuses.has("drafts")
    ? groups.flatMap((group) =>
        group.threads.filter((thread) => thread.status === "drafts"),
      )
    : [];
  const archivedThreads = state.statuses.has("archived")
    ? groups.flatMap((group) =>
        group.threads.filter((thread) => thread.status === "archived"),
      )
    : [];
  const hasVisibleEntityGroups = activeGroups.some(
    (group) => group.kind === "entity",
  );
  const threadListLabel = hasVisibleEntityGroups
    ? GROUPED_THREAD_LIST_LABELS[state.grouping]
    : "Threads";
  const moveThread = (title: string, destination: string) => {
    setManualDestinationByThread((current) => ({
      ...current,
      [title]: destination,
    }));
    setManualUnpinnedThreads((current) => new Set(current).add(title));
  };
  const toggleGroup = (label: string) => {
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(label)) {
        next.delete(label);
      } else {
        next.add(label);
      }
      return next;
    });
  };

  return (
    <div className="py-2">
      <div
        data-prototype-sticky-threads-toolbar={stickyToolbar ? "" : undefined}
        className={cn(
          "relative flex h-9 items-center gap-2 pl-3 pr-2",
          stickyToolbar && "sticky top-0 z-30 bg-sidebar",
        )}
      >
        <span
          className={cn(
            "min-w-0 flex-1 truncate",
            PROTOTYPE_THREAD_LIST_HEADER_CLASS,
          )}
        >
          {threadListLabel}
        </span>
        <span className="inline-flex shrink-0 items-center gap-0.5">
          <DropdownMenu open={organizeOpen} onOpenChange={setOrganizeOpen}>
            <IconTrigger
              icon="Layers"
              label={`Organize: ${selectedGroupingLabel}`}
            />
            <DropdownMenuContent
              align="end"
              mobileTitle="Organize"
              className={PROTOTYPE_COMPACT_MENU_CONTENT_CLASS}
            >
              <DropdownMenuLabel className={PROTOTYPE_COMPACT_MENU_LABEL_CLASS}>
                Organize
              </DropdownMenuLabel>
              <DropdownMenuGroup aria-label="Organize">
                <GroupItems state={state} />
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu open={filterSortOpen} onOpenChange={setFilterSortOpen}>
            <IconTrigger icon="Filter" label="Filter and sort" />
            <DropdownMenuContent
              align="end"
              mobileTitle="Filter and sort"
              className={PROTOTYPE_COMPACT_MENU_CONTENT_CLASS}
            >
              <DropdownMenuLabel className={PROTOTYPE_COMPACT_MENU_LABEL_CLASS}>
                Thread status
              </DropdownMenuLabel>
              <DropdownMenuGroup aria-label="Thread status">
                <StatusItems state={state} />
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className={PROTOTYPE_COMPACT_MENU_LABEL_CLASS}>
                Sort by
              </DropdownMenuLabel>
              <DropdownMenuGroup aria-label="Sort by">
                <SortItems state={state} />
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <RowActionIcon icon="MessageSquarePlus" label="New thread" />
          <ThreadToolbarAdditionalActions grouping={state.grouping} />
        </span>
        {stickyToolbar ? (
          <OverflowFade placement="below" tone="sidebar" size="sm" />
        ) : null}
      </div>
      {empty ? (
        <div className="flex min-h-24 flex-col items-center justify-center gap-1.5 px-6 text-center text-xs text-muted-foreground">
          <Icon
            name="MessageSquare"
            className="size-4 text-subtle-foreground/50"
            aria-hidden="true"
          />
          <span>No threads yet</span>
        </div>
      ) : null}
      {draftThreads.length > 0 ? (
        <div>
          <div
            className={cn(
              "flex h-8 items-center px-3",
              PROTOTYPE_THREAD_GROUP_HEADER_CLASS,
            )}
          >
            Drafts
          </div>
          <div className="px-1.5 pb-1">
            {draftThreads.map((thread) => (
              <PrototypeThreadRow
                key={thread.title}
                currentGroup="Drafts"
                destinations={manualDestinations}
                grouping={state.grouping}
                onMove={(destination) => moveThread(thread.title, destination)}
                selected={false}
                thread={thread}
              />
            ))}
          </div>
        </div>
      ) : null}
      {activeGroups.map((group, groupIndex) => {
        const showEntityActions =
          group.kind === "entity" && state.grouping !== "machine";
        const collapsed = collapsedGroups.has(group.label);
        return (
          <div key={group.label}>
            {group.kind === "entity" ? (
              <div
                className={`${SIDEBAR_HOVER_ACTIONS_ROW_CLASS} flex h-9 items-center pl-3 pr-0`}
              >
                <span
                  className={cn(
                    "flex min-w-0 items-center gap-2",
                    PROTOTYPE_THREAD_GROUP_HEADER_CLASS,
                  )}
                >
                  {state.grouping === "project" ||
                  state.grouping === "machine" ? (
                    <span className={SIDEBAR_LEADING_GLYPH_SLOT_CLASS}>
                      <Icon
                        name={
                          state.grouping === "project" ? "Folder" : "Laptop"
                        }
                        className={COARSE_POINTER_ICON_SIZE_CLASS}
                        aria-hidden="true"
                      />
                    </span>
                  ) : null}
                  <span className="truncate">{group.label}</span>
                </span>
                <span className="ml-auto inline-flex shrink-0 items-center">
                  <span
                    data-sidebar-hover-actions-open={
                      rowMenuOpen === group.label ? "true" : undefined
                    }
                    className={`${SIDEBAR_HOVER_ACTIONS_CLASS} ${SIDEBAR_HOVER_ACTIONS_GAP_CLASS} inline-flex shrink-0 items-center`}
                    data-sidebar-hover-actions-mobile={
                      SIDEBAR_HOVER_ACTIONS_MOBILE_ALWAYS_VALUE
                    }
                  >
                    {showEntityActions ? (
                      <>
                        <RowActionIcon
                          icon="MessageSquarePlus"
                          label={`New thread in ${group.label}`}
                          mobileHidden
                        />
                        <RowActionsMenu
                          grouping={state.grouping}
                          label={group.label}
                          onOpenChange={(open) =>
                            setRowMenuOpen(open ? group.label : null)
                          }
                        />
                      </>
                    ) : null}
                  </span>
                  <span className={SIDEBAR_COLLAPSE_CARET_SLOT_CLASS}>
                    <SidebarChildToggleChevron
                      isCollapsed={collapsed}
                      expandLabel={`Expand ${group.label}`}
                      collapseLabel={`Collapse ${group.label}`}
                      onToggle={() => toggleGroup(group.label)}
                      revealOnHover={!collapsed}
                    />
                  </span>
                </span>
              </div>
            ) : hasVisibleEntityGroups ? (
              <>
                <div
                  aria-hidden="true"
                  className="mx-3 mt-1 h-px bg-border/70"
                />
                <div
                  className={cn(
                    "flex h-8 items-center px-3",
                    PROTOTYPE_THREAD_GROUP_HEADER_CLASS,
                  )}
                >
                  Threads
                </div>
              </>
            ) : null}
            {group.kind === "loose" || !collapsed ? (
              <div className="px-1.5 pb-1">
                {group.threads.map((thread, threadIndex) => (
                  <PrototypeThreadRow
                    key={thread.title}
                    currentGroup={group.label}
                    destinations={manualDestinations}
                    grouping={state.grouping}
                    onMove={(destination) =>
                      moveThread(thread.title, destination)
                    }
                    selected={groupIndex === 0 && threadIndex === 0}
                    thread={thread}
                  />
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
      {archivedThreads.length > 0 ? (
        <div className="mt-1 border-t border-border/70 pt-1">
          <div
            className={cn(
              "flex h-8 items-center px-3",
              PROTOTYPE_THREAD_GROUP_HEADER_CLASS,
            )}
          >
            Archived
          </div>
          <div className="px-1.5 pb-1">
            {archivedThreads.map((thread) => (
              <PrototypeThreadRow
                key={thread.title}
                currentGroup="Archived"
                destinations={manualDestinations}
                grouping={state.grouping}
                onMove={(destination) => moveThread(thread.title, destination)}
                selected={false}
                thread={thread}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function FullSidebarPrototype({
  emptyThreadList = false,
  initialGrouping,
  initialScrollTop = 0,
  longThreadList = false,
  looseThreadsOnly = false,
  stickyThreadsToolbar = false,
}: {
  emptyThreadList?: boolean;
  initialGrouping: Grouping;
  initialScrollTop?: number;
  longThreadList?: boolean;
  looseThreadsOnly?: boolean;
  stickyThreadsToolbar?: boolean;
}) {
  const scrollRegionRef = useRef<HTMLDivElement>(null);
  const [topItemOrder, setTopItemOrder] = useState<TopItemId[]>([
    "new-thread",
    "extensions",
    "automations",
  ]);
  const [visibleTopItems, setVisibleTopItems] = useState<
    ReadonlySet<TopItemId>
  >(() => new Set(topItemOrder));
  const [mainSectionOrder, setMainSectionOrder] = useState<MainSectionId[]>([
    "bb-controls",
    "plugins",
    "threads",
  ]);
  const setTopItemVisible = (id: TopItemId, visible: boolean) => {
    setVisibleTopItems((current) => {
      const next = new Set(current);
      if (visible) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  };

  useEffect(() => {
    if (scrollRegionRef.current !== null) {
      scrollRegionRef.current.scrollTop = initialScrollTop;
    }
  }, [initialScrollTop]);

  return (
    <div className="flex flex-col gap-3">
      <aside className="flex h-[660px] w-[304px] flex-col overflow-visible rounded-md border bg-sidebar text-sidebar-foreground shadow-sm">
        <div className="shrink-0">
          <div className="flex h-10 items-center px-2">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Toggle sidebar"
              className={cn("size-7 rounded-md", PROTOTYPE_ACTION_TONE_CLASS)}
            >
              <Icon name="PanelLeft" className="size-4" aria-hidden />
            </Button>
            <span className="ml-auto inline-flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Back"
                className={cn("size-7 rounded-md", PROTOTYPE_ACTION_TONE_CLASS)}
              >
                <Icon name="ChevronLeft" className="size-4" aria-hidden />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Forward"
                className={cn("size-7 rounded-md", PROTOTYPE_ACTION_TONE_CLASS)}
              >
                <Icon name="ChevronRight" className="size-4" aria-hidden />
              </Button>
            </span>
          </div>
          <div className="flex h-8 items-center justify-end px-2">
            <CustomizeSidebarMenu
              topItemOrder={topItemOrder}
              onTopItemOrderChange={setTopItemOrder}
              visibleTopItems={visibleTopItems}
              onTopItemVisibilityChange={setTopItemVisible}
              mainSectionOrder={mainSectionOrder}
              onMainSectionOrderChange={setMainSectionOrder}
            />
          </div>
        </div>
        <div
          ref={scrollRegionRef}
          data-prototype-sidebar-scroll-region=""
          className="min-h-0 flex-1 overflow-y-auto"
        >
          {mainSectionOrder.map((sectionId, index) => (
            <div
              key={sectionId}
              className={index === 0 ? undefined : "border-t border-border/70"}
            >
              {sectionId === "bb-controls" ? (
                <BbControlsSection
                  topItemOrder={topItemOrder}
                  visibleTopItems={visibleTopItems}
                />
              ) : sectionId === "plugins" ? (
                <PluginsSection />
              ) : (
                <ThreadListSection
                  empty={emptyThreadList}
                  initialGrouping={initialGrouping}
                  longList={longThreadList}
                  looseOnly={looseThreadsOnly}
                  stickyToolbar={stickyThreadsToolbar}
                />
              )}
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}

function PrototypeCard({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-3 rounded-lg border bg-background p-4">
      <h2 className="text-sm font-medium">{title}</h2>
      {children}
    </section>
  );
}

function StateReadout() {
  const organizationMode = useAtomValue(sidebarOrganizationModeAtom);
  const sort = useAtomValue(sidebarChronologicalSortAtom);
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
      <dt className="text-muted-foreground">organize</dt>
      <dd className="font-mono">{organizationMode}</dd>
      <dt className="text-muted-foreground">sort</dt>
      <dd className="font-mono">{sort}</dd>
    </dl>
  );
}

function InteractiveMenu() {
  const store = useMemo(() => {
    const next = createStore();
    next.set(sidebarOrganizationModeAtom, "project");
    next.set(sidebarChronologicalSortAtom, "updated");
    return next;
  }, []);

  return (
    <JotaiProvider store={store}>
      <div className="flex w-72 flex-col gap-4 rounded-md bg-sidebar p-4 text-sidebar-foreground">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">
            Projects
          </span>
          <div className="flex items-center gap-1">
            <span className="inline-flex items-center gap-0.5">
              <SidebarOrganizeMenu />
              <SidebarFilterSortMenu />
            </span>
          </div>
        </div>
        <StateReadout />
      </div>
    </JotaiProvider>
  );
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="interactive"
        hint="open the menus · toggle By project/Custom · pick a sort field and direction"
      >
        <InteractiveMenu />
      </StoryRow>
    </StoryCard>
  );
}

export function RevisedModel() {
  return (
    <div className="grid gap-5 p-6 xl:grid-cols-3">
      <PrototypeCard title="By project">
        <FullSidebarPrototype initialGrouping="project" />
      </PrototypeCard>
      <PrototypeCard title="By machine">
        <FullSidebarPrototype initialGrouping="machine" />
      </PrototypeCard>
      <PrototypeCard title="Custom">
        <FullSidebarPrototype initialGrouping="manual" />
      </PrototypeCard>
    </div>
  );
}

export function StickyThreadsHeader() {
  return (
    <div className="w-[384px] p-6">
      <PrototypeCard title="Long sidebar · sticky Thread list">
        <FullSidebarPrototype
          initialGrouping="project"
          initialScrollTop={310}
          longThreadList
          stickyThreadsToolbar
        />
      </PrototypeCard>
    </div>
  );
}

export function EmptyStates() {
  return (
    <div className="grid gap-5 p-6 xl:grid-cols-3">
      <PrototypeCard title="No threads · By project">
        <FullSidebarPrototype emptyThreadList initialGrouping="project" />
      </PrototypeCard>
      <PrototypeCard title="No threads · By machine">
        <FullSidebarPrototype emptyThreadList initialGrouping="machine" />
      </PrototypeCard>
      <PrototypeCard title="No threads · Custom">
        <FullSidebarPrototype emptyThreadList initialGrouping="manual" />
      </PrototypeCard>
    </div>
  );
}

export function LooseOnlyStates() {
  return (
    <div className="grid gap-5 p-6 lg:grid-cols-2">
      <PrototypeCard title="Loose threads only · By project">
        <FullSidebarPrototype initialGrouping="project" looseThreadsOnly />
      </PrototypeCard>
      <PrototypeCard title="Loose threads only · Custom">
        <FullSidebarPrototype initialGrouping="manual" looseThreadsOnly />
      </PrototypeCard>
    </div>
  );
}
