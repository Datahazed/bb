import { cn } from "@bb/shared-ui/lib/utils";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import {
  Fragment,
  useContext,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useThread } from "@/hooks/queries/thread-queries";
import { usePluginSlots } from "@/lib/plugin-slots";
import { activeTab } from "@/lib/split-layout";
import type { PaneContent, PaneNode, PaneTab } from "@/lib/split-layout";
import { HEADER_ICON_BUTTON_CLASS } from "@/components/layout/AppPageHeader";
import { PluginIcon } from "@/components/plugin/PluginIcon";
import { SecondaryPanelHostLayoutContext } from "@/components/secondary-panel/SecondaryPanelHostLayoutContext";
import {
  BROWSER_COLLAPSED_HEADER_RESERVE_CLASS,
  CHROME_ROW_CLASS,
  getBbDesktopInfo,
  MACOS_APP_REGION_NO_DRAG_CLASS,
  MACOS_COLLAPSED_HEADER_RESERVE_CLASS,
  MACOS_WINDOW_DRAG_CLASS,
  shouldReserveMacosTrafficLights,
  shouldUseMacosDesktopChrome,
} from "@/lib/bb-desktop";
import { useIsSidebarShowing } from "@/components/ui/sidebar.js";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { useDesktopWindowState } from "@/hooks/useDesktopWindowState";

// Movement before a tab pointerdown becomes a reorder drag (vs a click).
const TAB_DRAG_ENGAGE_DISTANCE_PX = 5;
// How far outside the strip's box the pointer may wander while still
// reordering; beyond it the gesture hands off to the tear-out/split flow.
const STRIP_TEAR_OUT_MARGIN_PX = 16;

/** Where a mid-gesture tear-out hand-off starts the split-drag session. */
export interface TabDragStart {
  clientX: number;
  clientY: number;
  /** The dragged tab element, dimmed by the session while it lives. */
  sourceEl: HTMLElement | null;
}

export type BeginTabTearOut = (
  tabId: string,
  start: TabDragStart,
  label: string,
) => void;

export interface PaneTabStripProps {
  pane: PaneNode;
  isPaneFocused: boolean;
  /** Whether this strip sits on the workspace's top edge — it then doubles as
   * the macOS window-drag row, exactly like the pane header row it replaced. */
  isTopRow: boolean;
  /**
   * True for the workspace's top-right pane: the window panel-toggle overlay
   * floats over this strip's right corner, so reserve its footprint while the
   * window panel is closed (open, the toggle overlays the panel's own chrome).
   */
  reservesWindowPanelToggle?: boolean;
  /**
   * True for the workspace's structural top-left pane. The strip is the
   * titlebar row there, so it — not the in-pane headers below it — clears the
   * pinned sidebar trigger and macOS traffic lights, exactly like the page
   * header row it replaced. Several top-row strips can be drag regions, but
   * only one leaf may own this reserve.
   */
  ownsWindowTopLeft?: boolean;
  onActivateTab: (tabId: string) => void;
  onCommitTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onReorderTab: (tabId: string, toIndex: number) => void;
  onBeginTabTearOut: BeginTabTearOut;
  /**
   * Starts a WHOLE-group move/swap drag from the strip's empty background —
   * the only group-drag handle left when the active view suppresses the pane
   * header (terminal/diff). Absent on the single-pane surface, where a lone
   * group has nothing to reorder.
   */
  onBeginGroupDrag?: (event: ReactPointerEvent, label: string) => void;
}

interface TabDragState {
  tabId: string;
  /** Insertion index among the OTHER tabs (reorderTab's filtered-list index). */
  insertIndex: number;
}

/**
 * The chrome row above a pane's content: one tab per view in the group, sized
 * to the shared 48px chrome-row axis so it carries the old pane header's
 * responsibilities (window drag, the reserved panel-toggle corner). The
 * "Synthesis" treatment from the BB-39 design board: soft elevated container
 * on the active tab, per-kind leading icons, dotted-underline preview state.
 * Click activates (and the URL follows), double-click commits a preview tab,
 * middle-click or the X closes. Dragging a tab within the strip shows a
 * pin-style insertion indicator and reorders on drop; leaving the strip hands
 * off to the tear-out/split flow.
 */
export function PaneTabStrip({
  pane,
  isPaneFocused,
  isTopRow,
  reservesWindowPanelToggle = false,
  ownsWindowTopLeft = false,
  onActivateTab,
  onCommitTab,
  onCloseTab,
  onReorderTab,
  onBeginTabTearOut,
  onBeginGroupDrag,
}: PaneTabStripProps) {
  const stripRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const { navPanels } = usePluginSlots();
  const isWindowPanelOpen =
    useContext(SecondaryPanelHostLayoutContext)?.isOpen === true;
  const [desktopInfo] = useState(getBbDesktopInfo);
  const isWindowDragRegion =
    shouldUseMacosDesktopChrome(desktopInfo) && isTopRow;
  const isSidebarShowing = useIsSidebarShowing();
  const isCompactViewport = useIsCompactViewport();
  const desktopWindowState = useDesktopWindowState();
  const reserveMacosTrafficLights = shouldReserveMacosTrafficLights({
    desktopInfo,
    windowState: desktopWindowState,
  });
  const shouldReserveSidebarTrigger =
    ownsWindowTopLeft && (isCompactViewport || !isSidebarShowing);
  const [drag, setDrag] = useState<TabDragState | null>(null);

  // "+N" chip: how many tabs sit (mostly) outside the scrollport.
  const [overflowCount, setOverflowCount] = useState(0);
  useEffect(() => {
    const scroller = scrollRef.current;
    if (scroller === null) {
      return;
    }
    const update = () => {
      const viewport = scroller.getBoundingClientRect();
      let hidden = 0;
      for (const el of scroller.querySelectorAll<HTMLElement>(
        "[data-pane-tab-id]",
      )) {
        const rect = el.getBoundingClientRect();
        const mid = rect.left + rect.width / 2;
        if (mid < viewport.left || mid > viewport.right) {
          hidden += 1;
        }
      }
      setOverflowCount(hidden);
    };
    update();
    scroller.addEventListener("scroll", update);
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(scroller);
    return () => {
      scroller.removeEventListener("scroll", update);
      observer?.disconnect();
    };
  }, [pane.tabs.length]);

  const handleStripPointerDown = (event: ReactPointerEvent) => {
    // Only the strip's empty background is the group handle: pointerdowns on
    // tabs (and their close buttons) target the tab elements instead.
    if (
      event.button !== 0 ||
      !(event.target instanceof HTMLElement) ||
      event.target.dataset.stripBg === undefined
    ) {
      return;
    }
    onBeginGroupDrag?.(
      event,
      staticTabLabel(activeTab(pane).content, navPanels),
    );
  };

  // One pointer session per tab drag: within the strip's (slightly inflated)
  // box the gesture tracks a pin-style insertion indicator and reorders on
  // drop; crossing out hands the same gesture to the split-drag layer already
  // engaged.
  const beginTabGesture = (
    tab: PaneTab,
    label: string,
    event: ReactPointerEvent,
  ) => {
    const strip = stripRef.current;
    const tabEl = event.currentTarget;
    if (strip === null || !(tabEl instanceof HTMLElement)) {
      return;
    }
    const startX = event.clientX;
    const startY = event.clientY;
    let engaged = false;
    // A drag that never crosses another tab's midpoint drops in place: the
    // dragged tab's own index doubles as its filtered-list insertion index.
    let lastIndex = Math.max(
      0,
      pane.tabs.findIndex((candidate) => candidate.tabId === tab.tabId),
    );

    function cleanup(): void {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleCancel);
      setDrag(null);
    }

    function handleUp(): void {
      const wasEngaged = engaged;
      const toIndex = lastIndex;
      cleanup();
      if (wasEngaged) {
        onReorderTab(tab.tabId, toIndex);
      }
    }

    function handleCancel(): void {
      cleanup();
    }

    function handleMove(move: globalThis.PointerEvent): void {
      if (strip === null || !(tabEl instanceof HTMLElement)) {
        return;
      }
      if (!engaged) {
        if (
          Math.hypot(move.clientX - startX, move.clientY - startY) <=
          TAB_DRAG_ENGAGE_DISTANCE_PX
        ) {
          return;
        }
        engaged = true;
      }
      move.preventDefault();
      const rect = strip.getBoundingClientRect();
      const margin = STRIP_TEAR_OUT_MARGIN_PX;
      const withinStrip =
        move.clientX >= rect.left - margin &&
        move.clientX <= rect.right + margin &&
        move.clientY >= rect.top - margin &&
        move.clientY <= rect.bottom + margin;
      if (!withinStrip) {
        cleanup();
        onBeginTabTearOut(
          tab.tabId,
          { clientX: move.clientX, clientY: move.clientY, sourceEl: tabEl },
          label,
        );
        return;
      }
      // Insertion index = how many OTHER tabs the pointer has passed
      // (midpoint rule), which is exactly reorderTab's filtered-list index.
      let toIndex = 0;
      for (const el of strip.querySelectorAll<HTMLElement>(
        "[data-pane-tab-id]",
      )) {
        if (el.dataset.paneTabId === tab.tabId) {
          continue;
        }
        const tabRect = el.getBoundingClientRect();
        if (tabRect.left + tabRect.width / 2 < move.clientX) {
          toIndex += 1;
        }
      }
      lastIndex = toIndex;
      setDrag({ tabId: tab.tabId, insertIndex: toIndex });
    }

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleCancel);
  };

  // Interleave the insertion indicator at the drop gap: it renders before the
  // (insertIndex + 1)-th non-dragged tab, or trailing when past them all.
  const items: { tab: PaneTab; indicatorBefore: boolean }[] = [];
  let othersSeen = 0;
  let indicatorPlaced = false;
  for (const tab of pane.tabs) {
    const isDragged = drag !== null && drag.tabId === tab.tabId;
    let indicatorBefore = false;
    if (drag !== null && !isDragged) {
      if (othersSeen === drag.insertIndex) {
        indicatorBefore = true;
        indicatorPlaced = true;
      }
      othersSeen += 1;
    }
    items.push({ tab, indicatorBefore });
  }
  const indicatorAtEnd = drag !== null && !indicatorPlaced;

  const scrollToEnd = () => {
    scrollRef.current?.scrollTo({
      left: scrollRef.current.scrollWidth,
      behavior: "smooth",
    });
  };

  return (
    <div
      ref={stripRef}
      role="tablist"
      data-strip-bg
      data-window-top-left-owner={ownsWindowTopLeft ? "true" : undefined}
      onPointerDown={onBeginGroupDrag ? handleStripPointerDown : undefined}
      className={cn(
        // The pane's top chrome row: shares the 48px titlebar axis (and its
        // scrim/seam styling) with the header row it replaced, so strips sit
        // flush at the workspace top edge.
        CHROME_ROW_CLASS,
        "flex-none border-b border-border-seam-vertical/60 bg-surface-scrim px-2",
        !isPaneFocused && "text-muted-foreground",
        isWindowDragRegion && MACOS_WINDOW_DRAG_CLASS,
        onBeginGroupDrag && "cursor-grab touch-none select-none",
        // The pinned sidebar trigger (and macOS traffic lights while visible)
        // share this row's top-left corner; clear their footprint like the
        // page header does so the first tab never slides under them.
        "transition-[padding] duration-200 ease-linear",
        shouldReserveSidebarTrigger &&
          (reserveMacosTrafficLights
            ? MACOS_COLLAPSED_HEADER_RESERVE_CLASS
            : BROWSER_COLLAPSED_HEADER_RESERVE_CLASS),
      )}
    >
      <div
        ref={scrollRef}
        data-strip-bg
        className="flex min-w-0 items-center gap-1 overflow-x-auto"
      >
        {items.map(({ tab, indicatorBefore }) => (
          <Fragment key={tab.tabId}>
            {indicatorBefore ? <DropIndicator /> : null}
            <PaneTabItem
              tab={tab}
              isActive={tab.tabId === pane.activeTabId}
              isPaneFocused={isPaneFocused}
              isWindowDragRegion={isWindowDragRegion}
              isDragSource={drag !== null && drag.tabId === tab.tabId}
              onActivate={() => onActivateTab(tab.tabId)}
              onCommit={() => onCommitTab(tab.tabId)}
              onClose={() => onCloseTab(tab.tabId)}
              onBeginGesture={(event, label) =>
                beginTabGesture(tab, label, event)
              }
            />
          </Fragment>
        ))}
        {indicatorAtEnd ? <DropIndicator /> : null}
      </div>
      {overflowCount > 0 ? (
        <button
          type="button"
          onClick={scrollToEnd}
          aria-label={`${overflowCount} more tabs`}
          className={cn(
            "ml-1 flex h-[22px] flex-none items-center rounded-full border border-border bg-background px-2 text-xs text-muted-foreground hover:text-foreground",
            isWindowDragRegion && MACOS_APP_REGION_NO_DRAG_CLASS,
          )}
        >
          +{overflowCount}
        </button>
      ) : null}
      {/* Remaining width is the group-drag / window-drag background. */}
      <div data-strip-bg className="h-full min-w-2 flex-1" />
      {reservesWindowPanelToggle && !isWindowPanelOpen ? (
        // The floating window panel toggle overlays this corner; reserve its
        // stable 28px footprint so overflowing tabs never slide under it.
        <span aria-hidden className={cn("flex-none", HEADER_ICON_BUTTON_CLASS)} />
      ) : null}
    </div>
  );
}

/** The mock's pin-style insertion mark: a small dot capping a vertical bar. */
function DropIndicator() {
  return (
    <span
      aria-hidden
      data-tab-drop-indicator
      className="relative mx-0.5 h-[26px] w-0.5 flex-none rounded-full bg-primary"
    >
      <span className="absolute -top-[3px] left-1/2 size-1.5 -translate-x-1/2 rounded-full bg-primary" />
    </span>
  );
}

interface PaneTabItemProps {
  tab: PaneTab;
  isActive: boolean;
  isPaneFocused: boolean;
  isWindowDragRegion: boolean;
  isDragSource: boolean;
  onActivate: () => void;
  onCommit: () => void;
  onClose: () => void;
  onBeginGesture: (event: ReactPointerEvent, label: string) => void;
}

function PaneTabItem(props: PaneTabItemProps) {
  if (props.tab.content.kind === "thread") {
    return <ThreadTabItem {...props} threadId={props.tab.content.threadId} />;
  }
  return <StaticTabItem {...props} />;
}

function ThreadTabItem({
  threadId,
  ...props
}: PaneTabItemProps & { threadId: string }) {
  const { data: thread } = useThread(threadId);
  const label =
    thread?.title?.trim() || thread?.titleFallback?.trim() || "Thread";
  return <TabButton {...props} label={label} />;
}

function StaticTabItem(props: PaneTabItemProps) {
  const { navPanels } = usePluginSlots();
  return (
    <TabButton
      {...props}
      label={staticTabLabel(props.tab.content, navPanels)}
    />
  );
}

function staticTabLabel(
  content: PaneContent,
  navPanels: ReturnType<typeof usePluginSlots>["navPanels"],
): string {
  switch (content.kind) {
    // Thread tabs render through ThreadTabItem; this is only the query-less
    // fallback name.
    case "thread":
      return "Thread";
    case "new-thread":
      return "New thread";
    case "terminal":
      return "Terminal";
    case "diff":
      return "Diff";
    case "plugin-panel":
      return (
        navPanels.find(
          (candidate) =>
            candidate.pluginId === content.pluginId &&
            candidate.path === content.panelPath,
        )?.title ?? content.panelPath
      );
  }
}

const KIND_ICONS: Record<Exclude<PaneContent["kind"], "plugin-panel">, IconName> =
  {
    thread: "MessageSquare",
    "new-thread": "Plus",
    terminal: "Terminal",
    diff: "FileDiff",
  };

/** The tab's leading 14px kind icon; inherits the tab's text color. */
function TabKindIcon({ content }: { content: PaneContent }) {
  if (content.kind === "plugin-panel") {
    // PluginIcon resolves the plugin's branding/contribution icon hint and
    // falls back to a generic mark on its own.
    return (
      <PluginIcon
        pluginId={content.pluginId}
        icon={null}
        className="size-3.5 flex-none text-current"
      />
    );
  }
  return (
    <Icon
      name={KIND_ICONS[content.kind]}
      className="size-3.5 flex-none"
      aria-hidden="true"
    />
  );
}

function TabButton({
  tab,
  label,
  isActive,
  isPaneFocused,
  isWindowDragRegion,
  isDragSource,
  onActivate,
  onCommit,
  onClose,
  onBeginGesture,
}: PaneTabItemProps & { label: string }) {
  const handlePointerDown = (event: ReactPointerEvent) => {
    if (event.button === 0) {
      onBeginGesture(event, label);
    } else if (event.button === 1) {
      // Middle-click closes on auxclick; stop the browser's autoscroll mode.
      event.preventDefault();
    }
  };
  const handleAuxClick = (event: ReactMouseEvent) => {
    if (event.button === 1) {
      event.preventDefault();
      onClose();
    }
  };
  return (
    <div
      role="tab"
      data-pane-tab-id={tab.tabId}
      aria-selected={isActive}
      title={label}
      onPointerDown={handlePointerDown}
      onClick={onActivate}
      onDoubleClick={onCommit}
      onAuxClick={handleAuxClick}
      className={cn(
        "group/pane-tab flex h-8 min-w-0 max-w-[180px] flex-none cursor-pointer touch-none select-none items-center gap-1.5 rounded-md border border-transparent pl-2.5 pr-1 text-xs",
        // Active = soft elevated container (Variant 5): subtle raised fill
        // plus hairline border; inactive stays bare with a gentle hover wash.
        isActive
          ? "border-border bg-surface-raised"
          : "hover:bg-state-hover hover:text-foreground",
        isActive && isPaneFocused ? "text-foreground" : null,
        !isActive && "text-muted-foreground",
        // Preview = fainter ink; the dotted underline lives on the label.
        !isActive && tab.preview && "text-muted-foreground/70",
        isDragSource && "opacity-50",
        // Carve interactive tabs out of the strip's window-drag region.
        // Children resolve after their parent in app-region DOM order, so the
        // raw token suffices (no z-index escalation needed).
        isWindowDragRegion && MACOS_APP_REGION_NO_DRAG_CLASS,
      )}
    >
      <TabKindIcon content={tab.content} />
      <span
        className={cn(
          "truncate",
          tab.preview && "underline decoration-dotted underline-offset-[3px]",
        )}
      >
        {label}
      </span>
      <button
        type="button"
        aria-label={`Close ${label}`}
        onPointerDown={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
        className={cn(
          // Slot is always reserved so the hover reveal never shifts layout.
          "inline-flex size-5 flex-none items-center justify-center rounded-sm text-muted-foreground hover:bg-muted-foreground/15 hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          isActive
            ? "opacity-100"
            : "opacity-0 group-hover/pane-tab:opacity-100",
        )}
      >
        <Icon name="X" className="size-3" />
      </button>
    </div>
  );
}
