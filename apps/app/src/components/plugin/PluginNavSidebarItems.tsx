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
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { DndContext, type DragEndEvent } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { Button } from "@bb/shared-ui/button";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@bb/shared-ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { COARSE_POINTER_ICON_SIZE_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import { PluginIcon } from "@/components/plugin/PluginIcon";
import { PROJECT_LIST_ACTION_BUTTON_CLASS } from "@/components/sidebar/ProjectList";
import {
  ConfirmDeleteDialog,
  ConfirmDeleteDialogContent,
} from "@/components/dialogs/ConfirmDeleteDialog";
import { appToast } from "@/components/ui/app-toast";
import { CONTEXT_MENU_DESTRUCTIVE_ITEM_CLASS } from "@/components/ui/menu-item-tone";
import { invalidatePluginList } from "@/hooks/cache-owners/plugin-cache-owner";
import {
  removePlugin,
  setPluginEnabled,
  usePluginList,
  type PluginListItem,
} from "@/hooks/queries/plugin-settings-queries";
import { pluginAdminErrorMessage } from "@/lib/plugin-admin-error";
import {
  getPluginPanelRoutePath,
  getRootComposeRoutePath,
  isPluginPanelRoutePath,
} from "@/lib/route-paths";
import { usePluginSlots } from "@/lib/plugin-slots";
import { cn } from "@bb/shared-ui/lib/utils";
import type { PluginNavPanelSlot } from "@/lib/plugin-slots";
import { usePaneContentSplitDrag } from "@/components/sidebar/usePaneContentSplitDrag";
import { usePaneContentSplitIndicator } from "@/components/sidebar/paneContentSplitIndicator";
import type { MiniMapSlot } from "@/components/sidebar/paneContentSplitIndicator";
import { SplitPaneMiniMap } from "@/components/sidebar/SplitPaneMiniMap";
import { SIDEBAR_MORE_ACTION_TRIGGER_CLASS } from "@/components/sidebar/sidebarRowClasses";
import {
  SIDEBAR_HOVER_ACTIONS_CLASS,
  SIDEBAR_HOVER_ACTIONS_ROW_CLASS,
} from "@/components/ui/sidebar-hover-actions";
import { useSidebarSortable } from "@/components/sidebar/sortableMotion";
import { useSidebarReorderDnd } from "@/components/sidebar/useSidebarReorderDnd";
import type { SidebarSortableDragBindings } from "@/components/sidebar/sortableMotion";
import {
  pluginRemovalBlockedReason,
  pluginRemovalConfirmCopy,
  pluginRemovalLabel,
  pluginRemovalSuccessMessage,
} from "./plugin-removal";
import {
  hiddenPluginNavPanelsAtom,
  pluginNavPanelOrderAtom,
} from "./pluginNavSidebarAtoms";
import {
  arrangePluginNavPanels,
  getPluginNavPanelKey,
  havePluginNavPanelOrdersDiverged,
  hidePluginNavPanel,
  reorderPluginNavPanels,
  seedLeadingNavPanelKeys,
  showPluginNavPanel,
} from "./pluginNavSidebarOrder";

/**
 * Reserved plugin id for rows the host owns rather than a plugin. Real plugin
 * ids come from a plugin manifest name, so they never take this shape.
 */
const BUILTIN_NAV_ROW_PLUGIN_ID = "__builtin__";

/**
 * Order/hidden preference key of the built-in Extensions row. The id stays
 * "tools" so an order or hidden list saved under the row's old name keeps
 * naming the same row.
 */
export const TOOLS_NAV_ROW_KEY = getPluginNavPanelKey({
  pluginId: BUILTIN_NAV_ROW_PLUGIN_ID,
  id: "tools",
});

/**
 * One sidebar nav row. Plugin rows come from `navPanel` slots; the Extensions
 * row is host chrome that shares the list so both obey the same order and hide
 * preferences.
 */
type SidebarNavRow =
  | {
      kind: "tools";
      pluginId: string;
      id: string;
      title: string;
      /** Last visited Extensions route, so the row returns where the user was. */
      routePath: string;
    }
  | {
      kind: "plugin";
      pluginId: string;
      id: string;
      title: string;
      panel: PluginNavPanelSlot;
    };

/**
 * Sidebar entries for plugin `navPanel` slots (plugin design §5.2) plus the
 * built-in Extensions row: one row per entry, styled like primary sidebar
 * actions.
 * Plugin rows navigate to the panel's own route under
 * /plugins/<pluginId>/<path>. Renders nothing while no row qualifies. Only host
 * chrome renders here — a plugin's component mounts on the route
 * (PluginPanelView).
 *
 * Rows are drag-reorderable and can be hidden; hidden rows move into a
 * collapsed "More" disclosure below the list rather than disappearing. Both
 * preferences live in `pluginNavSidebarAtoms`.
 */
export function PluginNavSidebarItems({
  toolsRoutePath,
  ...props
}: {
  onNavigate?: () => void;
  splitEnabled?: boolean;
  /** Omit to drop the built-in Extensions row, e.g. when its experiment is off. */
  toolsRoutePath?: string;
}) {
  const { navPanels } = usePluginSlots();
  const rows = useMemo<SidebarNavRow[]>(() => {
    const pluginRows = navPanels.map<SidebarNavRow>((panel) => ({
      kind: "plugin",
      pluginId: panel.pluginId,
      id: panel.id,
      title: panel.title,
      panel,
    }));
    if (toolsRoutePath === undefined) return pluginRows;
    return [
      {
        kind: "tools",
        pluginId: BUILTIN_NAV_ROW_PLUGIN_ID,
        id: "tools",
        title: "Extensions",
        routePath: toolsRoutePath,
      },
      ...pluginRows,
    ];
  }, [navPanels, toolsRoutePath]);
  // Router hooks live in the inner component so hosts without a Router
  // (isolated sidebar tests/stories) can render the empty state.
  if (rows.length === 0) return null;
  return <PluginNavSidebarItemList {...props} rows={rows} />;
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
  const [storedOrder, setStoredOrder] = useAtom(pluginNavPanelOrderAtom);
  const [hiddenKeys, setHiddenKeys] = useAtom(hiddenPluginNavPanelsAtom);
  const [isOverflowOpen, setIsOverflowOpen] = useState(false);
  // Only plugin rows carry lifecycle actions, so a sidebar showing nothing but
  // the Extensions row never asks the server for the installed list.
  const { lifecycle, removeTarget, removePending, confirmRemove, cancelRemove } =
    usePluginNavRowLifecycle(rows.some((row) => row.kind === "plugin"));

  const { visible, hidden, normalizedOrder } = useMemo(() => {
    // Users who customized their plugin order before the Extensions row joined
    // the list keep it on top instead of finding it at the bottom. Seed only
    // while the row exists, so a build without it saves no key for it.
    const leadingKeys = rows.some((row) => row.kind === "tools")
      ? [TOOLS_NAV_ROW_KEY]
      : [];
    return arrangePluginNavPanels({
      panels: rows,
      storedOrder: seedLeadingNavPanelKeys(storedOrder, leadingKeys),
      hiddenKeys,
    });
  }, [hiddenKeys, rows, storedOrder]);

  // Give newly installed panels a slot in the persisted order. This only ever
  // adds keys: a plugin frontend that has not registered yet keeps its slot, so
  // an early mount cannot save a shortened order over the user's arrangement.
  useEffect(() => {
    if (!havePluginNavPanelOrdersDiverged(storedOrder, normalizedOrder)) return;
    setStoredOrder(normalizedOrder);
  }, [normalizedOrder, setStoredOrder, storedOrder]);

  const visibleKeys = useMemo(
    () => visible.map(getPluginNavPanelKey),
    [visible],
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
        visibleKeys,
      });
      if (nextOrder) setStoredOrder(nextOrder);
    },
    [normalizedOrder, setStoredOrder, visibleKeys],
  );
  const { dndContextProps, onClickCapture } = useSidebarReorderDnd({
    onDragEnd: handleDragEnd,
  });

  const handleHide = useCallback(
    (key: string) => {
      setHiddenKeys((current) => hidePluginNavPanel(current, key));
    },
    [setHiddenKeys],
  );
  const handleShow = useCallback(
    (key: string) => {
      setHiddenKeys((current) => showPluginNavPanel(current, key));
    },
    [setHiddenKeys],
  );

  const reorderDisabled = visible.length < 2;
  const rowProps = {
    onNavigate,
    pathname: location.pathname,
    splitEnabled,
    lifecycle,
  };

  return (
    <div
      // Pull back most of the primary-actions bottom padding so plugin panel
      // rows keep the same compact 2px rhythm as sidebar thread rows.
      className="-mt-1.5 shrink-0 space-y-0.5 px-2 pb-2 group-data-[collapsible=icon]:hidden"
      data-testid="plugin-nav-sidebar-items"
      onClickCapture={onClickCapture}
    >
      <DndContext {...dndContextProps}>
        <SortableContext
          items={visibleKeys}
          strategy={verticalListSortingStrategy}
        >
          {visible.map((row) => (
            <SortableSidebarNavRow
              key={getPluginNavPanelKey(row)}
              row={row}
              reorderDisabled={reorderDisabled}
              onHide={handleHide}
              {...rowProps}
            />
          ))}
        </SortableContext>
      </DndContext>
      {hidden.length > 0 ? (
        <>
          <PluginNavSidebarOverflowToggle
            count={hidden.length}
            isOpen={isOverflowOpen}
            onToggle={() => setIsOverflowOpen((open) => !open)}
          />
          {isOverflowOpen
            ? hidden.map((row) => (
                <SidebarNavRowItem
                  key={getPluginNavPanelKey(row)}
                  row={row}
                  isHidden
                  onShow={handleShow}
                  {...rowProps}
                />
              ))
            : null}
        </>
      ) : null}
      <ConfirmDeleteDialog
        open={removeTarget !== null}
        onOpenChange={(open) => {
          if (!open && !removePending) cancelRemove();
        }}
      >
        {removeTarget ? (
          <ConfirmDeleteDialogContent
            title={pluginRemovalConfirmCopy(removeTarget).title}
            description={pluginRemovalConfirmCopy(removeTarget).description}
            confirmLabel={pluginRemovalLabel(removeTarget)}
            pending={removePending}
            onConfirm={confirmRemove}
            onCancel={cancelRemove}
          />
        ) : null}
      </ConfirmDeleteDialog>
    </div>
  );
}

function PluginNavSidebarOverflowToggle({
  count,
  isOpen,
  onToggle,
}: {
  count: number;
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
        // Quieter than the hidden rows it heads, matching the sidebar's
        // section labels ("Pinned"). Hover still brightens it via the shared
        // interactive-state class.
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
      <span className="min-w-0 truncate text-left">{`More (${count})`}</span>
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
  lifecycle: PluginNavRowLifecycle;
  /** Present for rows parked in the "More" disclosure. */
  isHidden?: boolean;
  onHide?: (key: string) => void;
  onShow?: (key: string) => void;
  dragBindings?: SidebarSortableDragBindings;
  rowRef?: (element: HTMLElement | null) => void;
  rowStyle?: CSSProperties;
}

function SidebarNavRowItem({
  row,
  splitEnabled,
  lifecycle,
  ...props
}: SidebarNavRowItemProps) {
  return row.kind === "tools" ? (
    // Extensions is host chrome, not a plugin: it has nothing to disable.
    <ToolsNavSidebarItem {...props} row={row} />
  ) : (
    <PluginNavSidebarItem
      {...props}
      row={row}
      splitEnabled={splitEnabled}
      lifecycle={lifecycle}
    />
  );
}

type PluginNavRowMenuSurface = "context" | "dropdown";

/**
 * One row action, rendered into whichever menu surface asked for it. The
 * right-click and "…" menus carry the same items, so every action is written
 * once and switches only its primitive.
 */
function PluginNavRowMenuItem({
  children,
  disabled = false,
  disabledReason,
  icon,
  onSelect,
  surface,
  variant = "default",
}: {
  children: ReactNode;
  disabled?: boolean;
  /** Shown on hover while `disabled`, so a refused action explains itself. */
  disabledReason?: string;
  icon: IconName;
  onSelect: () => void;
  surface: PluginNavRowMenuSurface;
  variant?: "default" | "destructive";
}) {
  const content = (
    <>
      <Icon name={icon} aria-hidden="true" />
      {children}
    </>
  );
  return surface === "context" ? (
    <ContextMenuItem
      className={cn(
        variant === "destructive" && CONTEXT_MENU_DESTRUCTIVE_ITEM_CLASS,
      )}
      disabled={disabled}
      title={disabledReason}
      onSelect={onSelect}
    >
      {content}
    </ContextMenuItem>
  ) : (
    <DropdownMenuItem
      disabled={disabled}
      title={disabledReason}
      variant={variant}
      onSelect={onSelect}
    >
      {content}
    </DropdownMenuItem>
  );
}

function PluginNavRowVisibilityMenuItem({
  isHidden,
  onSelect,
  surface,
}: {
  isHidden: boolean;
  onSelect: () => void;
  surface: PluginNavRowMenuSurface;
}) {
  return (
    <PluginNavRowMenuItem
      surface={surface}
      icon={isHidden ? "Eye" : "EyeOff"}
      onSelect={onSelect}
    >
      {isHidden ? "Show in sidebar" : "Hide from sidebar"}
    </PluginNavRowMenuItem>
  );
}

/**
 * Lifecycle actions for the plugin behind a row: the reversible enable toggle,
 * then removal last as the destructive action. Both call the same admin routes
 * the Extensions pages use, so the two surfaces cannot drift apart.
 */
function PluginNavRowLifecycleMenuItems({
  lifecycle,
  plugin,
  surface,
}: {
  lifecycle: PluginNavRowLifecycle;
  plugin: PluginListItem;
  surface: PluginNavRowMenuSurface;
}) {
  const pending = lifecycle.pendingPluginId === plugin.id;
  const blockedReason = pluginRemovalBlockedReason(plugin);
  return (
    <>
      <PluginNavRowMenuItem
        surface={surface}
        icon={plugin.enabled ? "CircleX" : "CircleCheck"}
        disabled={pending}
        onSelect={() => lifecycle.onToggleEnabled(plugin)}
      >
        {plugin.enabled ? "Disable" : "Enable"}
      </PluginNavRowMenuItem>
      <PluginNavRowMenuItem
        surface={surface}
        icon="Trash2"
        variant="destructive"
        disabled={pending || blockedReason !== null}
        disabledReason={blockedReason ?? undefined}
        onSelect={() => lifecycle.onRequestRemove(plugin)}
      >
        {pluginRemovalLabel(plugin)}
      </PluginNavRowMenuItem>
    </>
  );
}

/** Row-facing half of {@link usePluginNavRowLifecycle}. */
interface PluginNavRowLifecycle {
  /** The installed record for a row's plugin, or null until the list loads. */
  pluginFor: (pluginId: string) => PluginListItem | null;
  /** The plugin with a lifecycle request in flight, if any. */
  pendingPluginId: string | null;
  onToggleEnabled: (plugin: PluginListItem) => void;
  onRequestRemove: (plugin: PluginListItem) => void;
}

interface PluginNavRowLifecycleState {
  lifecycle: PluginNavRowLifecycle;
  /** The plugin awaiting removal confirmation, if any. */
  removeTarget: PluginListItem | null;
  removePending: boolean;
  confirmRemove: () => void;
  cancelRemove: () => void;
}

/**
 * Enable/disable and uninstall for plugin nav rows.
 *
 * The list owns this rather than the row: disabling or uninstalling
 * unregisters the plugin's panels, so the row that started the request is gone
 * before it settles — and with it any toast, navigation, or dialog it owned.
 */
function usePluginNavRowLifecycle(
  enabled: boolean,
): PluginNavRowLifecycleState {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const listQuery = usePluginList({ enabled });
  const [removeTarget, setRemoveTarget] = useState<PluginListItem | null>(null);

  const toggleEnabled = useMutation({
    mutationFn: (plugin: PluginListItem) =>
      setPluginEnabled(fetch, plugin.id, !plugin.enabled),
    onSuccess: () => invalidatePluginList({ queryClient }),
    onError: (error, plugin) => {
      appToast.error(
        `${plugin.enabled ? "Disabling" : "Enabling"} ${
          plugin.name ?? plugin.id
        } failed`,
        { description: pluginAdminErrorMessage(error) },
      );
    },
  });
  const remove = useMutation({
    mutationFn: (plugin: PluginListItem) => removePlugin(fetch, plugin.id),
    onSuccess: (_result, plugin) => {
      setRemoveTarget(null);
      invalidatePluginList({ queryClient });
      appToast.success(pluginRemovalSuccessMessage(plugin));
      // The panel route this row opens now belongs to a plugin that no longer
      // exists. Staying would leave the "panel is not available" placeholder
      // standing in for a page nothing can restore.
      if (
        isPluginPanelRoutePath({
          pathname: location.pathname,
          pluginId: plugin.id,
        })
      ) {
        void navigate(getRootComposeRoutePath());
      }
    },
    onError: (error, plugin) => {
      appToast.error(`Removing ${plugin.name ?? plugin.id} failed`, {
        description: pluginAdminErrorMessage(error),
      });
    },
  });

  const plugins = listQuery.data?.plugins;
  const pendingPluginId = toggleEnabled.isPending
    ? (toggleEnabled.variables?.id ?? null)
    : remove.isPending
      ? (remove.variables?.id ?? null)
      : null;

  return {
    lifecycle: {
      pluginFor: (pluginId) =>
        plugins?.find((candidate) => candidate.id === pluginId) ?? null,
      pendingPluginId,
      onToggleEnabled: (plugin) => toggleEnabled.mutate(plugin),
      onRequestRemove: (plugin) => setRemoveTarget(plugin),
    },
    removeTarget,
    removePending: remove.isPending,
    confirmRemove: () => {
      if (removeTarget !== null) remove.mutate(removeTarget);
    },
    cancelRemove: () => setRemoveTarget(null),
  };
}

/**
 * The Extensions row. It has no split-pane content kind, so it navigates in
 * place and draws no mini-map; everything else matches a plugin row.
 */
function ToolsNavSidebarItem({
  row,
  pathname: _pathname,
  onNavigate,
  ...props
}: Omit<SidebarNavRowItemProps, "row" | "splitEnabled" | "lifecycle"> & {
  row: Extract<SidebarNavRow, { kind: "tools" }>;
}) {
  const navigate = useNavigate();
  return (
    <SidebarNavRowChrome
      {...props}
      rowKey={getPluginNavPanelKey(row)}
      title={row.title}
      icon={<Icon name="Toolbox" />}
      // Never active: AppLayout swaps AppSidebar out for ToolsSidebar on every
      // Extensions route, so this row is only on screen while Extensions is
      // closed.
      isActive={false}
      onSelect={() => {
        onNavigate?.();
        void navigate(row.routePath);
      }}
    />
  );
}

function PluginNavSidebarItem({
  row,
  pathname,
  onNavigate,
  splitEnabled,
  lifecycle,
  ...props
}: Omit<SidebarNavRowItemProps, "row"> & {
  row: Extract<SidebarNavRow, { kind: "plugin" }>;
}) {
  const { panel } = row;
  const plugin = lifecycle.pluginFor(panel.pluginId);
  const navigate = useNavigate();
  const path = getPluginPanelRoutePath({
    pluginId: panel.pluginId,
    path: panel.path,
  });
  const content = {
    kind: "plugin-panel",
    pluginId: panel.pluginId,
    panelPath: panel.path,
    subPath: "",
  } as const;
  const { onPointerDown, openInSplit } = usePaneContentSplitDrag({
    content,
    enabled: splitEnabled,
    label: panel.title,
  });
  const splitIndicator = usePaneContentSplitIndicator(content, splitEnabled);

  return (
    <SidebarNavRowChrome
      {...props}
      rowKey={getPluginNavPanelKey(row)}
      title={panel.title}
      icon={<PluginIcon pluginId={panel.pluginId} icon={panel.icon} />}
      isActive={pathname === path || pathname.startsWith(`${path}/`)}
      splitMiniMap={splitIndicator.miniMap}
      // Omitted until the installed-plugin list resolves: a lifecycle action
      // needs the plugin's real enabled state and provenance to label itself.
      renderMenuItems={
        plugin === null
          ? undefined
          : (surface) => (
              <PluginNavRowLifecycleMenuItems
                surface={surface}
                plugin={plugin}
                lifecycle={lifecycle}
              />
            )
      }
      // Split-drag initiator; engages only when the pointer leaves the
      // sidebar, so it coexists with the dnd-kit reorder listeners.
      onPointerDown={onPointerDown}
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
  splitMiniMap?: MiniMapSlot[] | null;
  isHidden?: boolean;
  onHide?: (key: string) => void;
  onShow?: (key: string) => void;
  dragBindings?: SidebarSortableDragBindings;
  rowRef?: (element: HTMLElement | null) => void;
  rowStyle?: CSSProperties;
  /** Row-specific actions, appended below the shared visibility item. */
  renderMenuItems?: (surface: PluginNavRowMenuSurface) => ReactNode;
}

/** Shared chrome for every sidebar nav row: button, hide menus, drag handle. */
function SidebarNavRowChrome({
  rowKey,
  title,
  icon,
  isActive,
  onSelect,
  onPointerDown,
  splitMiniMap = null,
  isHidden = false,
  onHide,
  onShow,
  dragBindings,
  rowRef,
  rowStyle,
  renderMenuItems,
}: SidebarNavRowChromeProps) {
  const [isActionsOpen, setIsActionsOpen] = useState(false);
  // dnd-kit's KeyboardSensor activates on Space/Enter and preventDefaults them.
  // On a real <button> row that would swallow Enter-to-open, so the row keeps
  // only the pointer/touch drag activators. Reordering stays a pointer gesture.
  const { onKeyDown: _keyboardDragActivator, ...pointerDragListeners } =
    dragBindings?.listeners ?? {};
  const visibilityItem = (surface: PluginNavRowMenuSurface): ReactNode => (
    <PluginNavRowVisibilityMenuItem
      surface={surface}
      isHidden={isHidden}
      onSelect={() => (isHidden ? onShow?.(rowKey) : onHide?.(rowKey))}
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
              isActive && "bg-sidebar-accent text-sidebar-foreground",
              isHidden && "text-subtle-foreground",
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
          <div
            data-sidebar-hover-actions-open={isActionsOpen ? "true" : undefined}
            className={cn(
              SIDEBAR_HOVER_ACTIONS_CLASS,
              // right-0 (not right-1): the trigger's own m-1 supplies the inset,
              // so the glyph centers on the same column as the sidebar search
              // icon above and the thread-row more menus below.
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
                {visibilityItem("dropdown")}
                {renderMenuItems?.("dropdown")}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent aria-label={`${title} panel options`}>
        {visibilityItem("context")}
        {renderMenuItems?.("context")}
      </ContextMenuContent>
    </ContextMenu>
  );
}
