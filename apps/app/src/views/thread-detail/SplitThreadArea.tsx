import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { cn } from "@bb/shared-ui/lib/utils";
import { PANE_FOCUS_APP_COMMAND_IDS } from "@bb/domain";
import { useAtom, useStore } from "jotai";
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type SetStateAction,
} from "react";
import { useNavigate } from "react-router-dom";
import { useRouteState } from "@/hooks/useRouteState";
import {
  getThreadRoutePath,
  type ThreadRoutePathArgs,
} from "@/lib/route-paths";
import { useIsMutating } from "@tanstack/react-query";
import { BbHttpError } from "@/lib/sdk";
import { useThread } from "@/hooks/queries/thread-queries";
import { useThreadSplitsEnabled } from "@/hooks/useThreadSplitsEnabled";
import { maximizedPaneIdAtom, splitLayoutAtom } from "@/lib/split-layout/atoms";
import {
  activePaneContent,
  activateTab,
  clampSplitPairFraction,
  closeTab,
  commitTab,
  countPanes,
  findPane,
  listPanes,
  movePane,
  moveTab,
  removePane,
  reorderTab,
  replacePaneContent,
  resizeSplit,
  setFocus,
  swapPanes,
} from "@/lib/split-layout";
import type {
  LayoutNode,
  PaneContent,
  PaneNode,
  SplitLayout,
  SplitPath,
} from "@/lib/split-layout";
import { PaneTabStrip, type TabDragStart } from "./PaneTabStrip";
import { TerminalPaneContent } from "@/components/workspace-panes/TerminalPaneContent";
import { DiffPaneContent } from "@/components/workspace-panes/DiffPaneContent";
import {
  beginSplitDrag,
  decidePaneDrop,
  SPLIT_PANE_DATA_ATTR,
} from "@/lib/split-drag";
import {
  useAppCommandContext,
  useAppCommandHandler,
  useIndexedAppCommandHandlers,
} from "@/components/commands/AppCommandProvider";
import {
  PaneContext,
  createPaneSecondaryPanelRegistry,
  type PaneContextValue,
  type PaneSecondaryPanelRegistration,
  type PaneSecondaryPanelRegistry,
} from "./PaneContext";
import { ThreadDetailView } from "./ThreadDetailView";
import { RootComposeView } from "@/views/RootComposeView";
import { PluginPanelView } from "@/views/PluginPanelView";
import { AppPageHeader } from "@/components/layout/AppPageHeader";
import { usePluginSlots } from "@/lib/plugin-slots";
import {
  PluginPanelHeaderActions,
  PluginPanelHeaderCenter,
} from "@/components/plugin/PluginPanelHeader";
import {
  getAdjacentPaneId,
  getPaneIdAtReadingIndex,
} from "./splitPaneCommands";
import {
  applyThreadPaneActionToLayout,
  createSinglePaneLayout,
  focusedPaneRoute,
  paneContentRoute,
  reconcileLayoutForContent,
  threadPaneContent,
} from "./splitThreadNavigation";
import { ThreadDetailWorkerPoolProvider } from "./ThreadDetailWorkerPoolProvider";
import {
  getBbDesktopInfo,
  MACOS_WINDOW_NO_DRAG_CLASS,
  shouldUseMacosDesktopChrome,
} from "@/lib/bb-desktop";
import { SplitWorkspaceSecondaryPanelHost } from "./SplitWorkspaceSecondaryPanelHost";
import { PaneMaximizeButton } from "./PaneMaximizeButton";
import { wsManager } from "@/lib/ws";

// A `pointerdown`-relative move threshold before a pane-header drag engages.
const PANE_DRAG_ENGAGE_DISTANCE_PX = 7;

type BeginPaneDrag = (
  paneId: string,
  event: ReactPointerEvent,
  label: string,
) => void;

type BeginPaneTabDrag = (
  paneId: string,
  tabId: string,
  start: TabDragStart,
  label: string,
) => void;

const EMPTY_PATH: SplitPath = [];

type NavigateInPane = (paneId: string, thread: ThreadRoutePathArgs) => void;

/**
 * Renders the 1–8 thread panes that live in the main content area. It bridges
 * the URL-follows-focus and external-navigation policies between the global
 * split-layout atom and the route, then recursively draws the layout tree.
 * A single pane renders identically to the pre-split page surface (no wrapper,
 * no focus ring); compact viewports disable splits entirely.
 */
interface SplitThreadAreaProps {
  routeContent?: PaneContent;
}

interface PreservedScrollPosition {
  left: number;
  top: number;
}

/**
 * Browsers and virtualized timelines can normalize an invisible scroller back
 * to zero during the maximize layout transition. Record user-visible pane
 * scrollers as they move, ignore normalization events from hidden panes, and
 * restore the same mounted elements after each maximize/restore transition.
 */
function usePreservedSplitScrollPositions(maximizedPaneId: string | null) {
  const workspaceRef = useRef<HTMLDivElement>(null);
  const positionsRef = useRef(new Map<HTMLElement, PreservedScrollPosition>());
  const previousMaximizedPaneIdRef = useRef(maximizedPaneId);

  const captureVisibleScrollPositions = useCallback(() => {
    const workspace = workspaceRef.current;
    if (workspace === null) {
      return;
    }
    for (const pane of workspace.querySelectorAll<HTMLElement>(
      `[${SPLIT_PANE_DATA_ATTR}]:not([aria-hidden="true"])`,
    )) {
      for (const element of pane.querySelectorAll<HTMLElement>("*")) {
        if (element.scrollLeft === 0 && element.scrollTop === 0) {
          positionsRef.current.delete(element);
          continue;
        }
        positionsRef.current.set(element, {
          left: element.scrollLeft,
          top: element.scrollTop,
        });
      }
    }
  }, []);

  useLayoutEffect(() => {
    if (previousMaximizedPaneIdRef.current === maximizedPaneId) {
      return;
    }
    previousMaximizedPaneIdRef.current = maximizedPaneId;

    const restore = () => {
      const workspace = workspaceRef.current;
      for (const [element, position] of positionsRef.current) {
        if (workspace === null || !workspace.contains(element)) {
          positionsRef.current.delete(element);
          continue;
        }
        element.scrollLeft = position.left;
        element.scrollTop = position.top;
      }
    };

    // Restore before paint, then briefly across animation frames so passive
    // timeline effects, virtualization, and browser scroll anchoring cannot
    // overwrite the saved position while pane visibility settles.
    restore();
    let frame: number | null = null;
    let framesRemaining = 30;
    const restoreUntilSettled = () => {
      restore();
      framesRemaining -= 1;
      if (framesRemaining > 0) {
        frame = window.requestAnimationFrame(restoreUntilSettled);
      }
    };
    frame = window.requestAnimationFrame(restoreUntilSettled);
    return () => {
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [maximizedPaneId]);

  return { captureVisibleScrollPositions, workspaceRef };
}

export function SplitThreadArea(props: SplitThreadAreaProps = {}) {
  return (
    <ThreadDetailWorkerPoolProvider>
      <SplitThreadAreaContent {...props} />
    </ThreadDetailWorkerPoolProvider>
  );
}

function SplitThreadAreaContent({ routeContent }: SplitThreadAreaProps) {
  const { projectId, threadId } = useRouteState();
  const isCompact = useIsCompactViewport();
  const threadSplitsEnabled = useThreadSplitsEnabled();
  const navigate = useNavigate();
  const store = useStore();
  const [storedLayout, setLayout] = useAtom(splitLayoutAtom);
  const [maximizedPaneId, setMaximizedPaneIdAtom] =
    useAtom(maximizedPaneIdAtom);
  const secondaryPanelRegistry = useMemo(
    () => createPaneSecondaryPanelRegistry(),
    [],
  );

  const routeThread = useMemo<ThreadRoutePathArgs | null>(
    () => (projectId && threadId ? { projectId, threadId } : null),
    [projectId, threadId],
  );
  const currentContent = useMemo<PaneContent | null>(
    () => routeContent ?? (routeThread ? threadPaneContent(routeThread) : null),
    [routeContent, routeThread],
  );

  // Fold external navigation (initial load, sidebar click, deep link) into the
  // layout. The reconcile is idempotent, so a URL that already matches the
  // focused pane is a no-op — no history spam, no render loop.
  useEffect(() => {
    if (!threadSplitsEnabled || currentContent === null) {
      return;
    }
    setLayout((previous) =>
      reconcileLayoutForContent(previous, currentContent),
    );
  }, [currentContent, setLayout, threadSplitsEnabled]);

  // Effective layout for render/handlers before the effect seeds the atom.
  const layout: SplitLayout | null =
    storedLayout ??
    (currentContent?.kind === "thread" && routeThread
      ? createSinglePaneLayout(routeThread)
      : currentContent
        ? reconcileLayoutForContent(null, currentContent)
        : null);
  const panes = layout === null ? [] : listPanes(layout.root);
  const isSplitActive = threadSplitsEnabled && !isCompact && panes.length > 1;
  const effectiveMaximizedPaneId =
    layout !== null &&
    countPanes(layout.root) > 1 &&
    maximizedPaneId !== null &&
    findPane(layout.root, maximizedPaneId) !== null
      ? maximizedPaneId
      : null;
  const {
    captureVisibleScrollPositions,
    workspaceRef: preservedScrollWorkspaceRef,
  } = usePreservedSplitScrollPositions(effectiveMaximizedPaneId);
  const setMaximizedPaneId = useCallback(
    (next: SetStateAction<string | null>) => {
      captureVisibleScrollPositions();
      setMaximizedPaneIdAtom(next);
    },
    [captureVisibleScrollPositions, setMaximizedPaneIdAtom],
  );

  // CLI/SDK pane actions arrive as ephemeral server broadcasts. This split
  // owner applies them so agent-driven transitions share the local control's
  // scroll snapshot and focus/URL policy.
  useEffect(
    () =>
      wsManager.onThreadPaneAction((signal) => {
        if (!threadSplitsEnabled) {
          return;
        }
        const current = store.get(splitLayoutAtom);
        if (current === null) {
          return;
        }
        const previousMaximizedPaneId = store.get(maximizedPaneIdAtom);
        const next = applyThreadPaneActionToLayout(
          current,
          previousMaximizedPaneId,
          { projectId: signal.projectId, threadId: signal.threadId },
          signal.action,
        );
        if (next.layout !== current) {
          store.set(splitLayoutAtom, next.layout);
          const route = focusedPaneRoute(next.layout);
          if (route !== null) {
            navigate(route, { replace: true });
          }
        }
        if (next.maximizedPaneId !== previousMaximizedPaneId) {
          setMaximizedPaneId(next.maximizedPaneId);
        }
      }),
    [navigate, setMaximizedPaneId, store, threadSplitsEnabled],
  );

  // A maximized pane is always the focused/address-bar owner. External opens
  // and keyboard focus commands can change focus without going through the
  // local callbacks below, so carry maximization to that newly focused pane.
  // Stale persisted ids fail safe by restoring the whole split.
  useEffect(() => {
    if (maximizedPaneId === null) return;
    if (
      layout === null ||
      countPanes(layout.root) < 2 ||
      findPane(layout.root, maximizedPaneId) === null
    ) {
      setMaximizedPaneId(null);
      return;
    }
    if (layout.focusedPaneId !== maximizedPaneId) {
      setMaximizedPaneId(layout.focusedPaneId);
    }
  }, [layout, maximizedPaneId, setMaximizedPaneId]);

  // Content navigation inside a pane pushes history like the page surface does
  // today. replacePaneContent focuses the pane, so the pushed URL matches it.
  const navigateInPane = useCallback<NavigateInPane>(
    (paneId, thread) => {
      setLayout((previous) =>
        previous === null
          ? previous
          : replacePaneContent(previous, paneId, threadPaneContent(thread)),
      );
      navigate(getThreadRoutePath(thread));
    },
    [navigate, setLayout],
  );

  // Focusing a pane rewrites the URL with replace (focus changes shouldn't spam
  // history), and the focused pane becomes the address bar's owner.
  const focusPane = useCallback(
    (paneId: string) => {
      if (layout === null || layout.focusedPaneId === paneId) {
        return;
      }
      const pane = findPane(layout.root, paneId);
      setLayout(setFocus(layout, paneId));
      if (maximizedPaneId !== null) {
        setMaximizedPaneId(paneId);
      }
      if (pane !== null) {
        navigate(paneContentRoute(activePaneContent(pane)), { replace: true });
      }
    },
    [layout, maximizedPaneId, navigate, setLayout, setMaximizedPaneId],
  );

  const closePane = useCallback(
    (paneId: string) => {
      if (layout === null) {
        return;
      }
      const next = removePane(layout, paneId);
      if (next === layout) {
        return;
      }
      setLayout(next);
      if (maximizedPaneId === paneId) {
        setMaximizedPaneId(null);
      }
      if (next.focusedPaneId !== layout.focusedPaneId) {
        const route = focusedPaneRoute(next);
        if (route !== null) {
          navigate(route, { replace: true });
        }
      }
    },
    [layout, maximizedPaneId, navigate, setLayout, setMaximizedPaneId],
  );

  const toggleMaximizePane = useCallback(
    (paneId: string) => {
      const current = store.get(splitLayoutAtom);
      if (
        current === null ||
        countPanes(current.root) < 2 ||
        findPane(current.root, paneId) === null
      ) {
        return;
      }
      if (current.focusedPaneId !== paneId) {
        const next = setFocus(current, paneId);
        store.set(splitLayoutAtom, next);
        const route = focusedPaneRoute(next);
        if (route !== null) navigate(route, { replace: true });
      }
      setMaximizedPaneId((previous) => (previous === paneId ? null : paneId));
    },
    [navigate, setMaximizedPaneId, store],
  );

  const resize = useCallback(
    (splitPath: SplitPath, childIndex: number, fraction: number) => {
      setLayout((previous) =>
        previous === null
          ? previous
          : resizeSplit(previous, splitPath, childIndex, fraction),
      );
    },
    [setLayout],
  );

  // Activating a tab focuses its pane and hands the address bar to that view.
  // Reads the store imperatively so rapid tab clicks act on fresh state.
  const activateTabInPane = useCallback(
    (paneId: string, tabId: string) => {
      const current = store.get(splitLayoutAtom);
      if (current === null) {
        return;
      }
      const pane = findPane(current.root, paneId);
      const tab = pane?.tabs.find((candidate) => candidate.tabId === tabId);
      if (pane === null || pane === undefined || tab === undefined) {
        return;
      }
      store.set(splitLayoutAtom, activateTab(current, paneId, tabId));
      navigate(paneContentRoute(tab.content), { replace: true });
    },
    [navigate, store],
  );

  const commitTabInPane = useCallback(
    (paneId: string, tabId: string) => {
      setLayout((previous) =>
        previous === null ? previous : commitTab(previous, paneId, tabId),
      );
    },
    [setLayout],
  );

  // Closing a tab (X, middle-click, or a stale-thread prune) syncs the URL
  // whenever the focused pane's active view changed — closing the focused
  // pane's active tab reveals its neighbor even though focus didn't move, and
  // a stale URL would make the reconcile effect re-open the closed view.
  // closeTab refuses the last pane's last tab, preserving the old
  // don't-prune-the-last-view behavior.
  const closeTabInPane = useCallback(
    (paneId: string, tabId: string) => {
      const current = store.get(splitLayoutAtom);
      if (current === null) {
        return;
      }
      const next = closeTab(current, paneId, tabId);
      if (next === current) {
        return;
      }
      store.set(splitLayoutAtom, next);
      // Closing the group's last tab dissolves the pane; a maximized pane
      // that vanished must restore the split. Closing a mere tab inside the
      // maximized pane keeps it maximized.
      if (maximizedPaneId === paneId && findPane(next.root, paneId) === null) {
        setMaximizedPaneId(null);
      }
      const route = focusedPaneRoute(next);
      if (route !== null && route !== focusedPaneRoute(current)) {
        navigate(route, { replace: true });
      }
    },
    [maximizedPaneId, navigate, setMaximizedPaneId, store],
  );

  // Live tab reorder within a group's strip (drag while the pointer stays in
  // the strip; see PaneTabStrip.beginTabGesture).
  const reorderTabInPane = useCallback(
    (paneId: string, tabId: string, toIndex: number) => {
      setLayout((previous) =>
        previous === null
          ? previous
          : reorderTab(previous, paneId, tabId, toIndex),
      );
    },
    [setLayout],
  );

  // Tab tear-out: dragging a tab through the shared split-drag layer. Center
  // drop moves the tab into another group; an edge drop splits it out into a
  // new pane (allowed on the source pane itself when it has tabs to spare).
  // The strip hands off mid-gesture (its reorder threshold already passed),
  // so the session engages immediately.
  const beginTabDrag = useCallback<BeginPaneTabDrag>(
    (paneId, tabId, start, label) => {
      const startLayout = store.get(splitLayoutAtom);
      if (startLayout === null) {
        return;
      }
      beginSplitDrag(start.clientX, start.clientY, {
        ghostLabel: label,
        sourceEl: start.sourceEl,
        shouldEngage: () => true,
        decide: (targetPaneId, zone) => {
          if (zone === "center") {
            return targetPaneId === paneId
              ? null
              : { zone, label: "Move tab" };
          }
          if (targetPaneId === paneId) {
            const current = store.get(splitLayoutAtom);
            const pane =
              current === null ? null : findPane(current.root, paneId);
            // A lone tab split against its own pane would be a no-op move.
            if (pane === null || pane.tabs.length <= 1) {
              return null;
            }
          }
          return { zone, label: "Split" };
        },
        onDrop: (target) => {
          const current = store.get(splitLayoutAtom);
          if (current === null) {
            return;
          }
          const next = moveTab(
            current,
            paneId,
            tabId,
            target.zone === "center"
              ? { type: "center", targetPaneId: target.paneId }
              : {
                  type: "side",
                  targetPaneId: target.paneId,
                  side: target.zone,
                },
          );
          if (next === current) {
            return;
          }
          store.set(splitLayoutAtom, next);
          const route = focusedPaneRoute(next);
          if (route !== null) {
            navigate(route, { replace: true });
          }
        },
      });
    },
    [navigate, store],
  );

  // Pane reorder: dragging a pane header through the shared split-drag layer.
  // Edge drop = movePane (allowed at the cap — moves never add a pane), center
  // drop = swapPanes. Both ops set the layout's focus, and the URL follows it.
  // Read the layout imperatively from the store so a drop always acts on the
  // latest arrangement, not the value captured when the drag began.
  const beginPaneDrag = useCallback<BeginPaneDrag>(
    (paneId, event, label) => {
      const startLayout = store.get(splitLayoutAtom);
      if (startLayout === null || countPanes(startLayout.root) < 2) {
        return;
      }
      const restoreMaximizeAfterDrag =
        store.get(maximizedPaneIdAtom) === paneId;
      const sourceEl =
        event.currentTarget instanceof Element
          ? event.currentTarget.closest<HTMLElement>(
              `[${SPLIT_PANE_DATA_ATTR}]`,
            )
          : null;
      const startX = event.clientX;
      const startY = event.clientY;
      beginSplitDrag(startX, startY, {
        ghostLabel: label,
        sourceEl,
        shouldEngage: (x, y) =>
          Math.hypot(x - startX, y - startY) > PANE_DRAG_ENGAGE_DISTANCE_PX,
        // A maximized pane is the only hit-testable pane. Reveal the preserved
        // tree once the drag owns the gesture so move/swap targets are usable,
        // then restore the dragged pane's maximized presentation on every end
        // path. The layout tree and pane instances remain untouched here.
        onEngage: restoreMaximizeAfterDrag
          ? () => setMaximizedPaneId(null)
          : undefined,
        onEnd: restoreMaximizeAfterDrag
          ? () => {
              const current = store.get(splitLayoutAtom);
              if (
                current !== null &&
                findPane(current.root, current.focusedPaneId) !== null
              ) {
                // Edge moves preserve the pane id; center swaps move its
                // content into the target pane id. Both operations focus the
                // dragged content's destination, which is what must remain
                // maximized.
                setMaximizedPaneId(current.focusedPaneId);
              }
            }
          : undefined,
        decide: (targetPaneId, zone) =>
          decidePaneDrop({ zone, isSelf: targetPaneId === paneId }),
        onDrop: (target) => {
          const current = store.get(splitLayoutAtom);
          if (current === null) {
            return;
          }
          const next =
            target.zone === "center"
              ? swapPanes(current, paneId, target.paneId)
              : movePane(current, paneId, target.paneId, target.zone);
          if (next === current) {
            return;
          }
          store.set(splitLayoutAtom, next);
          const route = focusedPaneRoute(next);
          if (route !== null) {
            navigate(route, { replace: true });
          }
        },
      });
    },
    [navigate, setMaximizedPaneId, store],
  );

  // A disabled experiment and compact viewports both render the route thread as
  // single page surface (byte-identical to the pre-split page). The layout atom
  // is preserved so the arrangement returns when the gate opens again.
  if (
    !threadSplitsEnabled ||
    isCompact ||
    layout === null ||
    currentContent === null
  ) {
    return currentContent ? (
      <StandalonePaneContent content={currentContent} />
    ) : null;
  }

  const commandHandlers = (
    <SplitPaneCommandHandlers
      closePane={closePane}
      focusPane={focusPane}
      isSplitActive={isSplitActive}
      layout={layout}
      maximizedPaneId={effectiveMaximizedPaneId}
      panes={panes}
      toggleMaximizePane={toggleMaximizePane}
    />
  );

  const firstPane = panes[0];
  if (panes.length === 1 && firstPane !== undefined) {
    if (firstPane.tabs.length === 1) {
      // Single pane, single tab: DOM-identical to the pre-split page surface —
      // no wrapper, no tab strip, no focus ring, no pane chrome. Sidebar drops
      // still create the first split by hit-testing the main content region
      // (see useThreadRowSplitDrag's single-pane fallback), so no wrapper
      // element is needed here.
      return (
        <>
          {commandHandlers}
          <WorkspacePaneContent
            content={activePaneContent(firstPane)}
            paneId={firstPane.paneId}
            isFocused
            isSplitPane={false}
            secondaryPanelRegistry={null}
            onRequestClose={null}
            isMaximized={false}
            onToggleMaximize={null}
            isBoundedPane={false}
            isTopRow
            ownsWindowTopLeft
            onNavigateInPane={navigateInPane}
          />
        </>
      );
    }
    // Single pane with a tab group: the strip needs a column wrapper, so the
    // pane becomes bounded (content fills the wrapper instead of page-bleeding
    // over the strip). The pane-id marker lets a tab tear-out hit-test its own
    // edges to create the first split.
    return (
      <>
        {commandHandlers}
        <div
          className="-m-4 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden md:-m-5"
          data-split-pane-id={firstPane.paneId}
        >
          {firstPane.tabs.map((tab) =>
            tab.content.kind === "thread" ? (
              <PaneStaleWatcher
                key={tab.tabId}
                threadId={tab.content.threadId}
                onStale={() => closeTabInPane(firstPane.paneId, tab.tabId)}
              />
            ) : null,
          )}
          <PaneTabStrip
            pane={firstPane}
            isPaneFocused
            isTopRow
            ownsWindowTopLeft
            onActivateTab={(tabId) => activateTabInPane(firstPane.paneId, tabId)}
            onCommitTab={(tabId) => commitTabInPane(firstPane.paneId, tabId)}
            onCloseTab={(tabId) => closeTabInPane(firstPane.paneId, tabId)}
            onReorderTab={(tabId, toIndex) =>
              reorderTabInPane(firstPane.paneId, tabId, toIndex)
            }
            onBeginTabTearOut={(tabId, start, label) =>
              beginTabDrag(firstPane.paneId, tabId, start, label)
            }
          />
          <div className="flex min-h-0 min-w-0 flex-1">
            <WorkspacePaneContent
              content={activePaneContent(firstPane)}
              paneId={firstPane.paneId}
              isFocused
              isSplitPane={false}
              secondaryPanelRegistry={null}
              onRequestClose={null}
              isMaximized={false}
              onToggleMaximize={null}
              isBoundedPane
              isTopRow
              ownsWindowTopLeft={false}
              onNavigateInPane={navigateInPane}
            />
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      {commandHandlers}
      {/* Full-bleed like the single-pane page surface: outer edges stay flush,
          so the top pane headers share the chrome axis with the pinned sidebar
          trigger exactly like the unsplit page. overflow-hidden keeps short
          windows from scrolling the whole split when stacked panes hit their
          min content height. */}
      <div
        ref={preservedScrollWorkspaceRef}
        className="relative -m-4 flex min-h-0 min-w-0 flex-1 overflow-hidden md:-m-5"
      >
        <SplitWorkspaceSecondaryPanelHost
          focusedPaneId={effectiveMaximizedPaneId ?? layout.focusedPaneId}
          registry={secondaryPanelRegistry}
        >
          <SplitTree
            node={layout.root}
            path={EMPTY_PATH}
            isTopRow
            isLeftEdge
            isRightEdge
            focusedPaneId={effectiveMaximizedPaneId ?? layout.focusedPaneId}
            maximizedPaneId={effectiveMaximizedPaneId}
            secondaryPanelRegistry={secondaryPanelRegistry}
            onFocusPane={focusPane}
            onClosePane={closePane}
            onToggleMaximizePane={toggleMaximizePane}
            onResize={resize}
            onNavigateInPane={navigateInPane}
            onBeginPaneDrag={beginPaneDrag}
            onActivateTab={activateTabInPane}
            onCommitTab={commitTabInPane}
            onCloseTab={closeTabInPane}
            onReorderTab={reorderTabInPane}
            onBeginTabDrag={beginTabDrag}
          />
        </SplitWorkspaceSecondaryPanelHost>
      </div>
    </>
  );
}

interface SplitPaneCommandHandlersProps {
  closePane: (paneId: string) => void;
  focusPane: (paneId: string) => void;
  isSplitActive: boolean;
  layout: SplitLayout;
  maximizedPaneId: string | null;
  panes: readonly PaneNode[];
  toggleMaximizePane: (paneId: string) => void;
}

/** Mounted only while the experiment is enabled, so OFF unregisters commands. */
function SplitPaneCommandHandlers({
  closePane,
  focusPane,
  isSplitActive,
  layout,
  maximizedPaneId,
  panes,
  toggleMaximizePane,
}: SplitPaneCommandHandlersProps) {
  useAppCommandContext("splitActive", isSplitActive);
  useAppCommandHandler("pane.focus.previous", () => {
    if (!isSplitActive) return false;
    const paneId = getAdjacentPaneId(panes, layout.focusedPaneId, -1);
    if (paneId !== null) focusPane(paneId);
    return true;
  });
  useAppCommandHandler("pane.focus.next", () => {
    if (!isSplitActive) return false;
    const paneId = getAdjacentPaneId(panes, layout.focusedPaneId, 1);
    if (paneId !== null) focusPane(paneId);
    return true;
  });
  useIndexedAppCommandHandlers(PANE_FOCUS_APP_COMMAND_IDS, (index) => {
    if (!isSplitActive) return false;
    const paneId = getPaneIdAtReadingIndex(panes, index);
    if (paneId !== null) focusPane(paneId);
    return true;
  });
  useAppCommandHandler("pane.close", () => {
    if (!isSplitActive) return false;
    closePane(layout.focusedPaneId);
    return true;
  });
  useAppCommandHandler("pane.maximize.toggle", () => {
    if (!isSplitActive) return false;
    toggleMaximizePane(maximizedPaneId ?? layout.focusedPaneId);
    return true;
  });
  return null;
}

interface SplitTreeProps {
  node: LayoutNode;
  path: SplitPath;
  /** Whether this subtree touches the workspace's top edge. */
  isTopRow: boolean;
  /** Whether this subtree touches the workspace's left edge. */
  isLeftEdge: boolean;
  /** Whether this subtree touches the workspace's right edge. */
  isRightEdge: boolean;
  focusedPaneId: string;
  maximizedPaneId: string | null;
  secondaryPanelRegistry: PaneSecondaryPanelRegistry;
  onFocusPane: (paneId: string) => void;
  onClosePane: (paneId: string) => void;
  onToggleMaximizePane: (paneId: string) => void;
  onResize: (
    splitPath: SplitPath,
    childIndex: number,
    fraction: number,
  ) => void;
  onNavigateInPane: NavigateInPane;
  onBeginPaneDrag: BeginPaneDrag;
  onActivateTab: (paneId: string, tabId: string) => void;
  onCommitTab: (paneId: string, tabId: string) => void;
  onCloseTab: (paneId: string, tabId: string) => void;
  onReorderTab: (paneId: string, tabId: string, toIndex: number) => void;
  onBeginTabDrag: BeginPaneTabDrag;
}

function SplitTree(props: SplitTreeProps) {
  const { node, path, isTopRow, isLeftEdge, isRightEdge, focusedPaneId } =
    props;

  if (node.type === "pane") {
    const isFocused = node.paneId === focusedPaneId;
    const isMaximized = node.paneId === props.maximizedPaneId;
    const isHiddenByMaximize = props.maximizedPaneId !== null && !isMaximized;
    return (
      <div
        onPointerDown={() => props.onFocusPane(node.paneId)}
        // Flush tiles: no rounding, outer edges flush; a straight recessed
        // gutter separates panes (see SplitDivider). Bounded panes suppress
        // the content's page-bleed negative margins (see
        // PaneContextValue.isBoundedPane) so content fills the tile exactly.
        aria-hidden={isHiddenByMaximize || undefined}
        // Electron can retain a composited frame from animated descendants
        // (notably the New Thread welcome mark) after visibility changes.
        // Skip subtree painting while preserving the mounted pane and its box.
        style={
          isHiddenByMaximize ? { contentVisibility: "hidden" } : undefined
        }
        className={cn(
          "relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
          isHiddenByMaximize && "invisible pointer-events-none",
          isMaximized && "absolute inset-0 z-30",
        )}
        data-split-pane-id={node.paneId}
        data-maximized={isMaximized ? "true" : undefined}
      >
        {/* Only mounted in split mode, so single panes never pay for the extra
            thread subscriptions. One watcher per thread TAB: a stale thread
            closes its tab, not the whole group (closeTab still refuses the
            layout's last view). */}
        {node.tabs.map((tab) =>
          tab.content.kind === "thread" ? (
            <PaneStaleWatcher
              key={tab.tabId}
              threadId={tab.content.threadId}
              onStale={() => props.onCloseTab(node.paneId, tab.tabId)}
            />
          ) : null,
        )}
        <PaneTabStrip
          pane={node}
          isPaneFocused={isFocused}
          isTopRow={isMaximized || isTopRow}
          reservesWindowPanelToggle={isMaximized || (isTopRow && isRightEdge)}
          ownsWindowTopLeft={
            props.maximizedPaneId !== null
              ? isMaximized
              : isTopRow && isLeftEdge
          }
          onActivateTab={(tabId) => props.onActivateTab(node.paneId, tabId)}
          onCommitTab={(tabId) => props.onCommitTab(node.paneId, tabId)}
          onCloseTab={(tabId) => props.onCloseTab(node.paneId, tabId)}
          onReorderTab={(tabId, toIndex) =>
            props.onReorderTab(node.paneId, tabId, toIndex)
          }
          onBeginTabTearOut={(tabId, start, label) =>
            props.onBeginTabDrag(node.paneId, tabId, start, label)
          }
          onBeginGroupDrag={(event, label) =>
            props.onBeginPaneDrag(node.paneId, event, label)
          }
        />
        <div className="flex min-h-0 min-w-0 flex-1">
          <WorkspacePaneContent
            content={activePaneContent(node)}
            paneId={node.paneId}
            isFocused={isFocused}
            isSplitPane
            secondaryPanelRegistry={props.secondaryPanelRegistry}
            onRequestClose={() => props.onClosePane(node.paneId)}
            isMaximized={isMaximized}
            onToggleMaximize={() => props.onToggleMaximizePane(node.paneId)}
            isBoundedPane
            isTopRow={isMaximized || isTopRow}
            ownsWindowTopLeft={false}
            onNavigateInPane={props.onNavigateInPane}
            onBeginPaneDrag={props.onBeginPaneDrag}
          />
        </div>
        {/* The inactive-pane scrim lives on an overlay ABOVE the pane's content
            because styles painted on the pane element itself get covered by
            children with opaque backgrounds (header scrim, composer). */}
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-0 z-20 transition-colors",
            isFocused ? "bg-transparent" : "bg-background/40",
          )}
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex min-h-0 min-w-0 flex-1",
        node.dir === "col" ? "flex-col" : "flex-row",
      )}
    >
      {node.children.map((child, index) => (
        <Fragment key={paneKey(child)}>
          {index > 0 ? (
            <SplitDivider
              dir={node.dir}
              hidden={props.maximizedPaneId !== null}
              onResize={(fraction) => props.onResize(path, index - 1, fraction)}
            />
          ) : null}
          <div
            className="flex min-h-0 min-w-0"
            style={{ flex: `${node.sizes[index] ?? 1} 1 0` }}
          >
            <SplitTree
              {...props}
              node={child}
              path={[...path, index]}
              // Horizontal siblings all remain on the same top row. In a
              // vertical stack, only the first child can inherit the parent
              // subtree's contact with the workspace top edge.
              isTopRow={isTopRow && (node.dir === "row" || index === 0)}
              // Vertical siblings share the parent's left edge. In a
              // horizontal row, only the first child can inherit it.
              isLeftEdge={isLeftEdge && (node.dir === "col" || index === 0)}
              isRightEdge={
                isRightEdge &&
                (node.dir === "col" || index === node.children.length - 1)
              }
            />
          </div>
        </Fragment>
      ))}
    </div>
  );
}

interface WorkspacePaneContentProps {
  content: PaneContent;
  paneId: string;
  isFocused: boolean;
  isSplitPane: boolean;
  secondaryPanelRegistry: PaneSecondaryPanelRegistry | null;
  onRequestClose: (() => void) | null;
  isMaximized: boolean;
  onToggleMaximize: (() => void) | null;
  // True inside multi-pane split cards; suppresses the page-bleed margins so
  // content fills the card exactly (see PaneContextValue.isBoundedPane).
  isBoundedPane: boolean;
  isTopRow: boolean;
  ownsWindowTopLeft: boolean;
  onNavigateInPane: NavigateInPane;
  // Absent for the single-pane surface — a lone pane has nothing to reorder.
  onBeginPaneDrag?: BeginPaneDrag;
}

function WorkspacePaneContent({
  content,
  paneId,
  isFocused,
  isSplitPane,
  secondaryPanelRegistry,
  onRequestClose,
  isMaximized,
  onToggleMaximize,
  isBoundedPane,
  isTopRow,
  ownsWindowTopLeft,
  onNavigateInPane,
  onBeginPaneDrag,
}: WorkspacePaneContentProps) {
  const navigateInPane = useCallback(
    (thread: ThreadRoutePathArgs) => onNavigateInPane(paneId, thread),
    [onNavigateInPane, paneId],
  );
  const beginPaneDrag = useMemo(
    () =>
      onBeginPaneDrag
        ? (event: ReactPointerEvent, label: string) =>
            onBeginPaneDrag(paneId, event, label)
        : undefined,
    [onBeginPaneDrag, paneId],
  );
  const secondaryPanelHost = useMemo<PaneSecondaryPanelRegistration | null>(
    () =>
      secondaryPanelRegistry === null
        ? null
        : {
            publish: (model) => secondaryPanelRegistry.publish(paneId, model),
            clear: () => secondaryPanelRegistry.clear(paneId),
          },
    [paneId, secondaryPanelRegistry],
  );
  const value = useMemo<PaneContextValue>(
    () => ({
      paneId,
      isFocused,
      isSplitPane,
      secondaryPanelHost,
      // The pane's tab strip owns the top-right panel-toggle reservation now;
      // in-pane headers below it never share a row with the floating toggle.
      reservesWindowPanelToggle: false,
      onRequestClose,
      isMaximized,
      onToggleMaximize,
      isBoundedPane,
      isTopRow,
      ownsWindowTopLeft,
      navigateInPane,
      beginPaneDrag,
    }),
    [
      beginPaneDrag,
      isBoundedPane,
      isFocused,
      isSplitPane,
      isTopRow,
      ownsWindowTopLeft,
      navigateInPane,
      onRequestClose,
      isMaximized,
      onToggleMaximize,
      paneId,
      secondaryPanelHost,
    ],
  );

  if (content.kind !== "thread") {
    return (
      <PaneContext.Provider value={value}>
        <NonThreadPaneContent
          content={content}
          beginPaneDrag={beginPaneDrag}
          isBoundedPane={isBoundedPane}
          isTopRow={isTopRow}
          ownsWindowTopLeft={ownsWindowTopLeft}
        />
      </PaneContext.Provider>
    );
  }

  return (
    <PaneContext.Provider value={value}>
      <ThreadDetailView
        surface="pane"
        projectId={content.projectId}
        threadId={content.threadId}
      />
    </PaneContext.Provider>
  );
}

function StandalonePaneContent({ content }: { content: PaneContent }) {
  switch (content.kind) {
    case "thread":
      return <ThreadDetailView surface="page" />;
    case "new-thread":
      return <RootComposeView />;
    case "terminal":
      return (
        <TerminalPaneContent
          terminalId={content.terminalId}
          target={content.target}
        />
      );
    case "diff":
      return (
        <DiffPaneContent
          projectId={content.projectId}
          threadId={content.threadId}
        />
      );
    case "plugin-panel":
      return (
        <PluginPanelView
          pluginId={content.pluginId}
          panelPath={content.panelPath}
          subPath={content.subPath}
        />
      );
  }
}

function NonThreadPaneContent({
  content,
  beginPaneDrag,
  isBoundedPane,
  isTopRow,
  ownsWindowTopLeft,
}: {
  content: Exclude<PaneContent, { kind: "thread" }>;
  beginPaneDrag?: (event: ReactPointerEvent, label: string) => void;
  isBoundedPane: boolean;
  isTopRow: boolean;
  ownsWindowTopLeft: boolean;
}) {
  const { navPanels } = usePluginSlots();
  const [desktopInfo] = useState(getBbDesktopInfo);
  const usesDesktopChrome = shouldUseMacosDesktopChrome(desktopInfo);
  const panel =
    content.kind === "plugin-panel"
      ? navPanels.find(
          (candidate) =>
            candidate.pluginId === content.pluginId &&
            candidate.path === content.panelPath,
        )
      : undefined;
  const label =
    content.kind === "terminal"
      ? "Terminal"
      : content.kind === "diff"
        ? "Diff"
        : (panel?.title ?? "New thread");
  // The tab strip is the pane chrome now: the tab owns the title and the
  // close/reserve affordances, so bounded panes get no generic title header.
  // Only a resolved plugin panel keeps its header row — it carries real
  // affordances (panel title/icon and the panel's own header actions).
  const showsHeader = panel !== undefined;
  const handlePointerDown = (event: ReactPointerEvent) => {
    if (event.button === 0) beginPaneDrag?.(event, label);
  };
  const actions = panel ? (
    <>
      <PluginPanelHeaderActions
        panel={panel}
        subPath={content.kind === "plugin-panel" ? content.subPath : ""}
      />
      <PaneMaximizeButton />
    </>
  ) : null;

  return (
    <div
      className={cn(
        "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
        content.kind === "plugin-panel" && !isBoundedPane && "-m-4 md:-m-5",
      )}
    >
      {showsHeader ? (
        <AppPageHeader
          bordered={false}
          // Inside a bounded pane the tab strip above already occupies the
          // titlebar row; only the wrapper-less single-pane surface still
          // exposes this header as the OS drag region and the traffic-light
          // corner owner.
          isWindowDragRegion={isTopRow && !isBoundedPane}
          ownsWindowTopLeft={ownsWindowTopLeft && !isBoundedPane}
          className="border-b border-border-seam-vertical/60"
          center={
            <div
              className={cn(
                "flex min-w-0 flex-1 items-center",
                beginPaneDrag &&
                  cn(
                    "cursor-grab touch-none select-none",
                    // AppPageHeader is an OS window-drag region on macOS.
                    // Carve this pane-reorder handle out so Electron routes
                    // the pointer gesture to the split drag layer, matching
                    // the thread-title handle in ThreadDetailHeader.
                    usesDesktopChrome && MACOS_WINDOW_NO_DRAG_CLASS,
                  ),
              )}
              onPointerDown={beginPaneDrag ? handlePointerDown : undefined}
            >
              {panel ? <PluginPanelHeaderCenter panel={panel} /> : null}
            </div>
          }
          actions={actions}
        />
      ) : null}
      <div
        className={cn(
          "flex min-h-0 min-w-0 flex-1 flex-col",
          // Terminal and diff views fill the pane edge-to-edge (they carry
          // their own chrome); the compose and plugin surfaces keep the page
          // padding.
          (content.kind === "new-thread" || content.kind === "plugin-panel") &&
            "p-4 md:p-5",
        )}
      >
        {content.kind === "new-thread" ? (
          <RootComposeView />
        ) : content.kind === "terminal" ? (
          <TerminalPaneContent
            terminalId={content.terminalId}
            target={content.target}
          />
        ) : content.kind === "diff" ? (
          <DiffPaneContent
            projectId={content.projectId}
            threadId={content.threadId}
          />
        ) : (
          <PluginPanelView
            pluginId={content.pluginId}
            panelPath={content.panelPath}
            subPath={content.subPath}
          />
        )}
      </div>
    </div>
  );
}

interface SplitDividerProps {
  dir: "row" | "col";
  hidden: boolean;
  onResize: (fraction: number) => void;
}

interface FrozenTimelineRow {
  containIntrinsicBlockSize: string;
  contentVisibility: string;
  element: HTMLElement;
  height: string;
}

function findVerticalScrollViewport(element: HTMLElement): HTMLElement | null {
  let candidate = element.parentElement;
  while (candidate !== null) {
    const overflowY = window.getComputedStyle(candidate).overflowY;
    if (
      (overflowY === "auto" || overflowY === "scroll") &&
      candidate.scrollHeight > candidate.clientHeight
    ) {
      return candidate;
    }
    candidate = candidate.parentElement;
  }
  return null;
}

function freezeOffscreenTimelineRows(
  previous: HTMLElement,
  next: HTMLElement,
): () => void {
  const rows = [
    ...previous.querySelectorAll<HTMLElement>("[data-timeline-row-id]"),
    ...next.querySelectorAll<HTMLElement>("[data-timeline-row-id]"),
  ];
  const frozenRows: FrozenTimelineRow[] = [];
  const viewportRects = new Map<HTMLElement, DOMRect>();

  // Batch every geometry read before writing styles so this setup incurs at
  // most one layout pass. Keep one viewport of overscan on each side; only
  // rows far outside the clipped pane are skipped during the drag.
  for (const row of rows) {
    const viewport = findVerticalScrollViewport(row);
    if (viewport === null) continue;
    const rowRect = row.getBoundingClientRect();
    let viewportRect = viewportRects.get(viewport);
    if (viewportRect === undefined) {
      viewportRect = viewport.getBoundingClientRect();
      viewportRects.set(viewport, viewportRect);
    }
    const overscan = viewportRect.height;
    const isOffscreen =
      rowRect.bottom < viewportRect.top - overscan ||
      rowRect.top > viewportRect.bottom + overscan;
    if (!isOffscreen || rowRect.height <= 0) continue;
    frozenRows.push({
      containIntrinsicBlockSize: row.style.containIntrinsicBlockSize,
      contentVisibility: row.style.contentVisibility,
      element: row,
      height: `${rowRect.height}px`,
    });
  }

  for (const { element, height } of frozenRows) {
    element.style.containIntrinsicBlockSize = height;
    element.style.contentVisibility = "hidden";
  }

  return () => {
    for (const {
      containIntrinsicBlockSize,
      contentVisibility,
      element,
    } of frozenRows) {
      element.style.containIntrinsicBlockSize = containIntrinsicBlockSize;
      element.style.contentVisibility = contentVisibility;
    }
  };
}

function SplitDivider({ dir, hidden, onResize }: SplitDividerProps) {
  const horizontal = dir === "row";

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const divider = event.currentTarget;
      const previous = divider.previousElementSibling;
      const next = divider.nextElementSibling;
      if (
        !(previous instanceof HTMLElement) ||
        !(next instanceof HTMLElement)
      ) {
        return;
      }
      // The adjacent pair's outer bounds do not move during this drag. Read
      // them once instead of forcing layout twice for every pointer event.
      const previousRect = previous.getBoundingClientRect();
      const nextRect = next.getBoundingClientRect();
      const start = horizontal ? previousRect.left : previousRect.top;
      const end = horizontal ? nextRect.right : nextRect.bottom;
      const span = end - start;
      if (span <= 0) {
        return;
      }

      divider.setPointerCapture(event.pointerId);
      divider.dataset.dragging = "true";

      const previousGrow = Number.parseFloat(
        window.getComputedStyle(previous).flexGrow,
      );
      const nextGrow = Number.parseFloat(
        window.getComputedStyle(next).flexGrow,
      );
      const pairTotal =
        Number.isFinite(previousGrow) &&
        Number.isFinite(nextGrow) &&
        previousGrow + nextGrow > 0
          ? previousGrow + nextGrow
          : 1;
      const previousFlex = previous.style.flex;
      const nextFlex = next.style.flex;
      const restoreTimelineRows = freezeOffscreenTimelineRows(previous, next);
      let pendingFraction: number | null = null;
      let finished = false;

      const onMove = (moveEvent: PointerEvent) => {
        const pointer = horizontal ? moveEvent.clientX : moveEvent.clientY;
        const fraction = clampSplitPairFraction((pointer - start) / span);
        pendingFraction = fraction;

        // Keep high-frequency drag state local to the two flex items. Writing
        // the persisted split-layout atom here would rerender every pane and
        // sidebar split indicator, and serialize localStorage, on every move.
        previous.style.flex = `${pairTotal * fraction} 1 0px`;
        next.style.flex = `${pairTotal * (1 - fraction)} 1 0px`;
      };
      const finish = (commit: boolean) => {
        if (finished) return;
        finished = true;
        delete divider.dataset.dragging;
        divider.removeEventListener("pointermove", onMove);
        divider.removeEventListener("pointerup", onUp);
        divider.removeEventListener("pointercancel", onCancel);
        restoreTimelineRows();
        if (commit && pendingFraction !== null) {
          // Commit once so the imperative flex values above become the
          // canonical persisted layout without a visual jump.
          onResize(pendingFraction);
          return;
        }
        previous.style.flex = previousFlex;
        next.style.flex = nextFlex;
      };
      const onUp = () => finish(true);
      const onCancel = () => finish(false);
      divider.addEventListener("pointermove", onMove);
      divider.addEventListener("pointerup", onUp);
      divider.addEventListener("pointercancel", onCancel);
    },
    [horizontal, onResize],
  );

  return (
    <div
      role="separator"
      aria-orientation={horizontal ? "vertical" : "horizontal"}
      onPointerDown={handlePointerDown}
      className={cn(
        // A straight 6px gutter between flush tiles — squared ends, no
        // rounding, only BETWEEN splits (outer edges stay flush). The gutter
        // is softly recessed so it reads against the identical pane
        // backgrounds; hover/drag warms it as the resize affordance. The
        // absolutely-positioned child widens the grab target without
        // consuming layout space.
        "group relative z-[5] flex-shrink-0 bg-muted/60 transition-colors",
        "hover:bg-ring/40 data-[dragging]:bg-ring/40",
        hidden && "invisible pointer-events-none",
        horizontal ? "w-1.5 cursor-col-resize" : "h-1.5 cursor-row-resize",
      )}
    >
      <div
        className={cn(
          "absolute",
          horizontal ? "-inset-x-1 inset-y-0" : "inset-x-0 -inset-y-1",
        )}
      />
    </div>
  );
}

interface PaneStaleWatcherProps {
  threadId: string;
  onStale: () => void;
}

/**
 * Watches a split pane's thread and signals when it becomes deleted (a 404 once
 * the query settles) or archived, so the pane can be pruned. Shares the same
 * react-query cache entry the pane's own view already subscribes to, so it adds
 * a subscriber, not a fetch. Renders nothing.
 */
function PaneStaleWatcher({ threadId, onStale }: PaneStaleWatcherProps) {
  const { data: thread, isSuccess, isError, error } = useThread(threadId);
  // Archive optimistically stamps `archivedAt` before the server confirms, and a
  // failed archive rolls it back — but the rollback can't restore a pane already
  // pruned from the layout. So only treat "archived" as stale when no archive
  // mutation is in flight (i.e. the archived state is server-settled). Delete,
  // by contrast, drops the query and refetches, so its 404 / `deletedAt` are
  // already server-confirmed and need no gate.
  const archivesInFlight = useIsMutating({
    predicate: (mutation) =>
      mutation.options.meta?.lifecycleOperation === "archive_thread",
  });
  const isGone =
    isError && error instanceof BbHttpError && error.status === 404;
  const isDeleted =
    isSuccess && thread !== undefined && thread.deletedAt !== null;
  const isConfirmedArchived =
    isSuccess &&
    thread !== undefined &&
    thread.archivedAt !== null &&
    archivesInFlight === 0;
  const isStale = isGone || isDeleted || isConfirmedArchived;

  // Keep the latest callback without re-arming the fire effect: it fires once
  // when staleness is first observed. Pruning unmounts this watcher (or is a
  // no-op on the last pane), so a single fire is enough.
  const onStaleRef = useRef(onStale);
  useEffect(() => {
    onStaleRef.current = onStale;
  }, [onStale]);
  useEffect(() => {
    if (isStale) {
      onStaleRef.current();
    }
  }, [isStale]);

  return null;
}

function paneKey(node: LayoutNode): string {
  return node.type === "pane"
    ? node.paneId
    : listPanes(node)
        .map((pane) => pane.paneId)
        .join("-");
}
