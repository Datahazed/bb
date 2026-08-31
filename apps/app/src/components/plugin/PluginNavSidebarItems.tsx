import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEventHandler,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAtom } from "jotai";
import { DndContext, type DragEndEvent } from "@dnd-kit/core";
import { UnavailableIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
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
import { COARSE_POINTER_ICON_SIZE_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { PluginIcon } from "@/components/plugin/PluginIcon";
import { PluginSlotMount } from "@/components/plugin/PluginSlotMount";
import { PROJECT_LIST_ACTION_BUTTON_CLASS } from "@/components/sidebar/ProjectList";
import {
  AUTOMATIONS_PLUGIN_ID,
  getPluginDetailRoutePath,
  getPluginPanelRoutePath,
  getPluginPanelRoutePluginId,
  getPluginsRoutePath,
} from "@/lib/route-paths";
import {
  usePluginNavPanelChrome,
  type PluginNavPanelChrome,
  type PluginNavPanelChromeEntry,
} from "@/lib/plugin-nav-panel-chrome";
import { cn } from "@bb/shared-ui/lib/utils";
import type { PluginNavPanelSlot } from "@/lib/plugin-slots";
import { usePaneContentSplitDrag } from "@/components/sidebar/usePaneContentSplitDrag";
import { usePaneContentSplitIndicator } from "@/components/sidebar/paneContentSplitIndicator";
import type { MiniMapSlot } from "@/components/sidebar/paneContentSplitIndicator";
import { SplitPaneMiniMap } from "@/components/sidebar/SplitPaneMiniMap";
import { SIDEBAR_MORE_ACTION_TRIGGER_CLASS } from "@/components/sidebar/sidebarRowClasses";
import {
  SIDEBAR_HOVER_ACTIONS_CLASS,
  SIDEBAR_HOVER_ACTIONS_FADE_CLASS,
  SIDEBAR_HOVER_ACTIONS_MOBILE_ALWAYS_VALUE,
  SIDEBAR_HOVER_ACTIONS_ROW_CLASS,
} from "@/components/ui/sidebar-hover-actions";
import { useSidebarSortable } from "@/components/sidebar/sortableMotion";
import { useSidebarReorderDnd } from "@/components/sidebar/useSidebarReorderDnd";
import type { SidebarSortableDragBindings } from "@/components/sidebar/sortableMotion";
import { appToast } from "@/components/ui/app-toast";
import { invalidatePluginList } from "@/hooks/cache-owners/plugin-cache-owner";
import { setPluginEnabled } from "@/hooks/queries/plugin-settings-queries";
import { appQueryClient } from "@/lib/app-query-client";
import { pluginNavPanelOrderAtom } from "./pluginNavSidebarAtoms";
import {
  arrangePluginNavPanels,
  getPluginNavPanelKey,
  havePluginNavPanelOrdersDiverged,
  movePluginNavPanelToTop,
  reorderPluginNavPanels,
} from "./pluginNavSidebarOrder";

export const PLUGIN_NAV_VISIBLE_LIMIT = 5;

type SidebarNavRow = {
  pluginId: string;
  id: string;
  title: string;
  chrome: PluginNavPanelChrome;
  panel: PluginNavPanelSlot | null;
};

export function getTraditionalPluginNavPanelEntries(
  entries: readonly PluginNavPanelChromeEntry[],
): PluginNavPanelChromeEntry[] {
  return entries.filter(
    ({ chrome }) => chrome.pluginId !== AUTOMATIONS_PLUGIN_ID,
  );
}

export function PluginNavSidebarItems(props: {
  entries?: readonly PluginNavPanelChromeEntry[];
  onNavigate?: () => void;
  showDivider?: boolean;
  splitEnabled?: boolean;
}) {
  const discoveredEntries = usePluginNavPanelChrome();
  const entries = props.entries ?? discoveredEntries;
  const rows = useMemo<SidebarNavRow[]>(
    () =>
      getTraditionalPluginNavPanelEntries(entries).map(
        ({ chrome, panel }) => ({
          pluginId: chrome.pluginId,
          id: chrome.id,
          title: chrome.title,
          chrome,
          panel,
        }),
      ),
    [entries],
  );
  if (rows.length === 0) return null;
  return (
    <PluginNavSidebarItemList
      rows={rows}
      splitEnabled={props.splitEnabled ?? false}
      {...(props.onNavigate ? { onNavigate: props.onNavigate } : {})}
    />
  );
}

function PluginNavSidebarItemList({
  onNavigate,
  rows,
  splitEnabled = false,
}: {
  onNavigate?: () => void;
  rows: readonly SidebarNavRow[];
  splitEnabled?: boolean;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const [storedOrder, setStoredOrder] = useAtom(pluginNavPanelOrderAtom);
  const [isOverflowOpen, setIsOverflowOpen] = useState(false);
  const [disablePendingPluginId, setDisablePendingPluginId] = useState<
    string | null
  >(null);
  const handleDisable = useCallback(
    async (row: SidebarNavRow) => {
      setDisablePendingPluginId(row.pluginId);
      try {
        await setPluginEnabled(fetch, row.pluginId, false);
        appToast.success(`${row.title} disabled`);
        if (getPluginPanelRoutePluginId(location.pathname) === row.pluginId) {
          onNavigate?.();
          void navigate(getPluginsRoutePath());
        }
      } catch (error) {
        appToast.error(`Failed to disable ${row.title}`, {
          description: error instanceof Error ? error.message : String(error),
        });
      } finally {
        await invalidatePluginList({ queryClient: appQueryClient });
        setDisablePendingPluginId(null);
      }
    },
    [location.pathname, navigate, onNavigate],
  );

  const { ordered, normalizedOrder } = useMemo(
    () => arrangePluginNavPanels({ panels: rows, storedOrder }),
    [rows, storedOrder],
  );
  const visible = ordered.slice(0, PLUGIN_NAV_VISIBLE_LIMIT);
  const overflow = ordered.slice(PLUGIN_NAV_VISIBLE_LIMIT);

  useEffect(() => {
    if (!havePluginNavPanelOrdersDiverged(storedOrder, normalizedOrder)) return;
    setStoredOrder(normalizedOrder);
  }, [normalizedOrder, setStoredOrder, storedOrder]);

  const orderedKeys = useMemo(
    () => ordered.map(getPluginNavPanelKey),
    [ordered],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      if (
        !event.over ||
        typeof event.active.id !== "string" ||
        typeof event.over.id !== "string"
      ) {
        return;
      }
      const nextOrder = reorderPluginNavPanels({
        activeKey: event.active.id,
        overKey: event.over.id,
        order: normalizedOrder,
        visibleKeys: orderedKeys,
      });
      if (nextOrder) setStoredOrder(nextOrder);
    },
    [normalizedOrder, orderedKeys, setStoredOrder],
  );
  const { dndContextProps, onClickCapture } = useSidebarReorderDnd({
    onDragEnd: handleDragEnd,
  });

  const handleMoveToTop = useCallback(
    (key: string) => {
      setStoredOrder(movePluginNavPanelToTop(normalizedOrder, key));
    },
    [normalizedOrder, setStoredOrder],
  );
  const handleMoveToOverflow = useCallback(
    (key: string) => {
      const overflowTarget = orderedKeys[PLUGIN_NAV_VISIBLE_LIMIT];
      if (!overflowTarget) return;
      const nextOrder = reorderPluginNavPanels({
        activeKey: key,
        overKey: overflowTarget,
        order: normalizedOrder,
        visibleKeys: orderedKeys,
      });
      if (nextOrder) setStoredOrder(nextOrder);
    },
    [normalizedOrder, orderedKeys, setStoredOrder],
  );

  const reorderDisabled = ordered.length < 2;
  const rowProps = {
    onNavigate,
    pathname: location.pathname,
    splitEnabled,
    orderedKeys,
    onMoveToTop: handleMoveToTop,
    onMoveToOverflow: handleMoveToOverflow,
    disablePending: disablePendingPluginId !== null,
    onDisable: (row: SidebarNavRow) => void handleDisable(row),
  };

  return (
    <>
      {props.showDivider === false ? null : (
        <div
          aria-hidden="true"
          data-sidebar-navigation-divider="plugins"
          className="mx-2 h-px shrink-0 bg-sidebar-border"
        />
      )}
      <div
        className="shrink-0 space-y-0.5 px-2 py-2 group-data-[collapsible=icon]:hidden"
        data-testid="plugin-nav-sidebar-items"
        onClickCapture={onClickCapture}
      >
        <DndContext {...dndContextProps}>
          <SortableContext
            items={orderedKeys}
            strategy={verticalListSortingStrategy}
          >
            {visible.map((row) => (
              <SortableSidebarNavRow
                key={getPluginNavPanelKey(row)}
                row={row}
                reorderDisabled={reorderDisabled}
                {...rowProps}
              />
            ))}
            {overflow.length > 0 ? (
              <>
                <PluginNavSidebarOverflowToggle
                  isOpen={isOverflowOpen}
                  onToggle={() => setIsOverflowOpen((open) => !open)}
                />
                {isOverflowOpen
                  ? overflow.map((row) => (
                      <SortableSidebarNavRow
                        key={getPluginNavPanelKey(row)}
                        row={row}
                        reorderDisabled={reorderDisabled}
                        {...rowProps}
                      />
                    ))
                  : null}
              </>
            ) : null}
          </SortableContext>
        </DndContext>
      </div>
    </>
  );
}

function PluginNavSidebarOverflowToggle({
  isOpen,
  onToggle,
}: {
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      aria-expanded={isOpen}
      className={cn(
        PROJECT_LIST_ACTION_BUTTON_CLASS,
        "w-full text-subtle-foreground/75",
      )}
      onClick={onToggle}
      data-testid="plugin-nav-sidebar-overflow-toggle"
    >
      <Icon
        name="ChevronRight"
        className={cn(
          "size-3 shrink-0 transition-transform duration-150",
          isOpen && "rotate-90",
        )}
        aria-hidden="true"
      />
      <span className="min-w-0 truncate text-left">
        {isOpen ? "Show fewer" : "More plugins"}
      </span>
    </Button>
  );
}

const SortableSidebarNavRow = function SortableSidebarNavRow({
  row,
  reorderDisabled,
  ...props
}: SidebarNavRowItemProps & { reorderDisabled: boolean }) {
  const { dragBindings, setNodeRef, style } = useSidebarSortable({
    id: getPluginNavPanelKey(row),
    disabled: reorderDisabled,
  });
  return (
    <SidebarNavRowItem
      {...props}
      row={row}
      dragBindings={dragBindings}
      rowRef={setNodeRef}
      rowStyle={style}
    />
  );
};

interface SidebarNavRowItemProps {
  row: SidebarNavRow;
  pathname: string;
  onNavigate?: () => void;
  splitEnabled: boolean;
  orderedKeys: readonly string[];
  onMoveToTop: (key: string) => void;
  onMoveToOverflow: (key: string) => void;
  disablePending: boolean;
  onDisable: (row: SidebarNavRow) => void;
  dragBindings?: SidebarSortableDragBindings;
  rowRef?: (element: HTMLElement | null) => void;
  rowStyle?: CSSProperties;
}

function SidebarNavRowItem({
  row,
  splitEnabled,
  ...props
}: SidebarNavRowItemProps) {
  return (
    <PluginNavSidebarItem {...props} row={row} splitEnabled={splitEnabled} />
  );
}

type PluginNavRowMenuSurface = "context" | "dropdown";

function PluginNavRowMenuItem({
  children,
  disabled = false,
  icon,
  onSelect,
  surface,
}: {
  children: ReactNode;
  disabled?: boolean;
  icon: "ArrowDown" | "ArrowUp" | "Columns2" | "Info" | "Unavailable";
  onSelect: () => void;
  surface: PluginNavRowMenuSurface;
}) {
  const content = (
    <>
      {icon === "Unavailable" ? (
        <HugeiconsIcon icon={UnavailableIcon} aria-hidden="true" />
      ) : (
        <Icon name={icon} aria-hidden="true" />
      )}
      {children}
    </>
  );
  return surface === "context" ? (
    <ContextMenuItem disabled={disabled} onSelect={onSelect}>
      {content}
    </ContextMenuItem>
  ) : (
    <DropdownMenuItem disabled={disabled} onSelect={onSelect}>
      {content}
    </DropdownMenuItem>
  );
}

function PluginNavRowMenuSeparator({
  surface,
}: {
  surface: PluginNavRowMenuSurface;
}) {
  return surface === "context" ? (
    <ContextMenuSeparator />
  ) : (
    <DropdownMenuSeparator />
  );
}

function PluginNavRowMenuItems({
  canMoveToTop,
  canMoveToOverflow,
  canOpenInSplit,
  disablePending,
  onDisable,
  onOpenInSplit,
  onOpenDetails,
  onMoveToTop,
  onMoveToOverflow,
  surface,
}: {
  canMoveToTop: boolean;
  canMoveToOverflow: boolean;
  canOpenInSplit: boolean;
  disablePending: boolean;
  onDisable: () => void;
  onOpenInSplit: () => void;
  onOpenDetails: () => void;
  onMoveToTop: () => void;
  onMoveToOverflow: () => void;
  surface: PluginNavRowMenuSurface;
}) {
  return (
    <>
      {canOpenInSplit ? (
        <PluginNavRowMenuItem
          surface={surface}
          icon="Columns2"
          onSelect={onOpenInSplit}
        >
          Open in split
        </PluginNavRowMenuItem>
      ) : null}
      <PluginNavRowMenuItem
        surface={surface}
        icon="Info"
        onSelect={onOpenDetails}
      >
        View details
      </PluginNavRowMenuItem>
      <PluginNavRowMenuSeparator surface={surface} />
      <PluginNavRowMenuItem
        surface={surface}
        icon="ArrowUp"
        disabled={!canMoveToTop}
        onSelect={onMoveToTop}
      >
        Move to top
      </PluginNavRowMenuItem>
      <PluginNavRowMenuItem
        surface={surface}
        icon="ArrowDown"
        disabled={!canMoveToOverflow}
        onSelect={onMoveToOverflow}
      >
        Move to overflow
      </PluginNavRowMenuItem>
      <PluginNavRowMenuSeparator surface={surface} />
      <PluginNavRowMenuItem
        surface={surface}
        icon="Unavailable"
        disabled={disablePending}
        onSelect={onDisable}
      >
        Disable
      </PluginNavRowMenuItem>
    </>
  );
}

function ToolsNavSidebarItemIcon() {
  return (
    <span className="bb-sidebar-row-icon-swap shrink-0" aria-hidden="true">
      <Icon name="Toolbox" className="bb-sidebar-row-icon-rest" />
      <Icon name="ToolCase" className="bb-sidebar-row-icon-hover" />
    </span>
  );
}

export function ExtensionsNavSidebarItem({
  routePath,
  onNavigate,
}: {
  routePath: string;
  onNavigate?: () => void;
}) {
  const navigate = useNavigate();
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className={cn(PROJECT_LIST_ACTION_BUTTON_CLASS, "w-full")}
      onClick={() => {
        onNavigate?.();
        void navigate(routePath);
      }}
    >
      <ToolsNavSidebarItemIcon />
      <span className="min-w-0 truncate text-left">Extensions</span>
    </Button>
  );
}

export function AutomationsNavSidebarItem({
  chrome,
  onNavigate,
}: {
  chrome: PluginNavPanelChrome;
  onNavigate?: () => void;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const path = getPluginPanelRoutePath({
    pluginId: chrome.pluginId,
    path: chrome.path,
  });
  const isActive =
    location.pathname === path || location.pathname.startsWith(`${path}/`);
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className={cn(
        PROJECT_LIST_ACTION_BUTTON_CLASS,
        "w-full",
        isActive && "bg-sidebar-accent text-sidebar-foreground",
      )}
      aria-current={isActive ? "page" : undefined}
      onClick={() => {
        onNavigate?.();
        void navigate(path);
      }}
    >
      <PluginIcon pluginId={chrome.pluginId} icon={chrome.icon} />
      <span className="min-w-0 truncate text-left">{chrome.title}</span>
    </Button>
  );
}

function PluginNavSidebarItem({
  row,
  pathname,
  onNavigate,
  onDisable,
  splitEnabled,
  ...props
}: Omit<SidebarNavRowItemProps, "row"> & {
  row: SidebarNavRow;
}) {
  const { chrome, panel } = row;
  const navigate = useNavigate();
  const isCompactViewport = useIsCompactViewport();
  const path = getPluginPanelRoutePath({
    pluginId: chrome.pluginId,
    path: chrome.path,
  });
  const content = {
    kind: "plugin-panel",
    pluginId: chrome.pluginId,
    panelPath: chrome.path,
    subPath: "",
  } as const;
  const { onPointerDown, openInSplit } = usePaneContentSplitDrag({
    content,
    enabled: splitEnabled,
    label: chrome.title,
  });
  const splitIndicator = usePaneContentSplitIndicator(content, splitEnabled);
  const SidebarAccessory = panel?.experimental_sidebarAccessory;
  const sidebarAccessory =
    panel !== null && !isCompactViewport && SidebarAccessory !== undefined ? (
      <PluginSlotMount
        key={`${panel.pluginId}/${panel.id}/${panel.generation}`}
        pluginId={panel.pluginId}
        slotKind="navPanelSidebarAccessory"
        slotId={panel.id}
        crashFallback={<></>}
      >
        <SidebarAccessory />
      </PluginSlotMount>
    ) : null;

  return (
    <SidebarNavRowChrome
      {...props}
      rowKey={getPluginNavPanelKey(row)}
      title={chrome.title}
      icon={<PluginIcon pluginId={chrome.pluginId} icon={chrome.icon} />}
      isActive={pathname === path || pathname.startsWith(`${path}/`)}
      splitMiniMap={splitIndicator.miniMap}
      accessory={sidebarAccessory}
      onPointerDown={onPointerDown}
      onOpenInSplit={splitEnabled ? openInSplit : undefined}
      onOpenDetails={() => {
        onNavigate?.();
        void navigate(getPluginDetailRoutePath({ pluginId: chrome.pluginId }));
      }}
      onDisable={() => onDisable(row)}
      onSelect={(event) => {
        onNavigate?.();
        if (event.metaKey || event.ctrlKey) {
          openInSplit();
          return;
        }
        void navigate(path);
      }}
    />
  );
}

interface SidebarNavRowChromeProps {
  rowKey: string;
  title: string;
  icon: ReactNode;
  isActive: boolean;
  onSelect: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onPointerDown?: PointerEventHandler<HTMLElement>;
  onOpenInSplit?: () => void;
  onOpenDetails: () => void;
  onDisable: () => void;
  disablePending: boolean;
  splitMiniMap?: MiniMapSlot[] | null;
  accessory?: ReactNode;
  orderedKeys: readonly string[];
  onMoveToTop: (key: string) => void;
  onMoveToOverflow: (key: string) => void;
  dragBindings?: SidebarSortableDragBindings;
  rowRef?: (element: HTMLElement | null) => void;
  rowStyle?: CSSProperties;
}

function SidebarNavRowChrome({
  rowKey,
  title,
  icon,
  isActive,
  onSelect,
  onPointerDown,
  onOpenInSplit,
  onOpenDetails,
  onDisable,
  disablePending,
  splitMiniMap = null,
  accessory,
  orderedKeys,
  onMoveToTop,
  onMoveToOverflow,
  dragBindings,
  rowRef,
  rowStyle,
}: SidebarNavRowChromeProps) {
  const [isActionsOpen, setIsActionsOpen] = useState(false);
  const { onKeyDown: _keyboardDragActivator, ...pointerDragListeners } =
    dragBindings?.listeners ?? {};
  const rowIndex = orderedKeys.indexOf(rowKey);
  const menuItems = (surface: PluginNavRowMenuSurface): ReactNode => (
    <PluginNavRowMenuItems
      surface={surface}
      canMoveToTop={rowIndex > 0}
      canMoveToOverflow={
        orderedKeys.length > PLUGIN_NAV_VISIBLE_LIMIT &&
        rowIndex >= 0 &&
        rowIndex < PLUGIN_NAV_VISIBLE_LIMIT
      }
      canOpenInSplit={onOpenInSplit !== undefined}
      disablePending={disablePending}
      onDisable={onDisable}
      onOpenInSplit={() => onOpenInSplit?.()}
      onOpenDetails={onOpenDetails}
      onMoveToTop={() => onMoveToTop(rowKey)}
      onMoveToOverflow={() => onMoveToOverflow(rowKey)}
    />
  );

  return (
    <ContextMenu onOpenChange={setIsActionsOpen}>
      <ContextMenuTrigger asChild>
        <div
          ref={rowRef}
          style={rowStyle}
          className={cn(SIDEBAR_HOVER_ACTIONS_ROW_CLASS, "relative")}
        >
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className={cn(
              PROJECT_LIST_ACTION_BUTTON_CLASS,
              "w-full pr-7",
              accessory && "pr-18",
              isActive && "bg-sidebar-accent text-sidebar-foreground",
            )}
            aria-current={isActive ? "page" : undefined}
            ref={dragBindings?.setActivatorNodeRef}
            {...dragBindings?.attributes}
            {...pointerDragListeners}
            onPointerDown={onPointerDown}
            onClick={onSelect}
          >
            {icon}
            <span className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
              <span className="min-w-0 truncate">{title}</span>
              {splitMiniMap ? (
                <SplitPaneMiniMap
                  slots={splitMiniMap}
                  label={`${title} — open in split`}
                />
              ) : null}
            </span>
          </Button>
          {accessory ? (
            <span
              data-plugin-nav-sidebar-accessory=""
              data-sidebar-hover-actions-open={
                isActionsOpen ? "true" : undefined
              }
              className={cn(
                SIDEBAR_HOVER_ACTIONS_FADE_CLASS,
                "pointer-events-none absolute right-1 top-1/2 block min-w-5 max-h-5 max-w-16 -translate-y-1/2 overflow-hidden text-xs text-ellipsis whitespace-nowrap text-center leading-5",
              )}
            >
              {accessory}
            </span>
          ) : null}
          <div
            data-sidebar-hover-actions-open={isActionsOpen ? "true" : undefined}
            data-sidebar-hover-actions-mobile={
              SIDEBAR_HOVER_ACTIONS_MOBILE_ALWAYS_VALUE
            }
            className={cn(
              SIDEBAR_HOVER_ACTIONS_CLASS,
              "absolute inset-y-0 right-0 flex items-center",
            )}
          >
            <DropdownMenu onOpenChange={setIsActionsOpen}>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`${title} panel options`}
                  className={cn(
                    "rounded-md p-0 text-muted-foreground",
                    "data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-foreground",
                    SIDEBAR_MORE_ACTION_TRIGGER_CLASS,
                  )}
                >
                  <Icon
                    name="MoreHorizontal"
                    className={COARSE_POINTER_ICON_SIZE_CLASS}
                  />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {menuItems("dropdown")}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent aria-label={`${title} panel options`}>
        {menuItems("context")}
      </ContextMenuContent>
    </ContextMenu>
  );
}
