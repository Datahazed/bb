import { useCallback, type PointerEvent as ReactPointerEvent } from "react";
import { useStore } from "jotai";
import { useNavigate } from "react-router-dom";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { splitLayoutAtom } from "@/lib/split-layout/atoms";
import {
  activateTab,
  commitTab,
  countPanes,
  findContentTab,
  listPanes,
  MAX_PANES,
  openTab,
  setFocus,
  splitPane,
  type PaneContent,
  type SplitLayout,
} from "@/lib/split-layout";
import {
  beginSplitDrag,
  decideThreadDrop,
  shouldEngageSidebarSplitDrag,
  type SplitDragFallbackTarget,
} from "@/lib/split-drag";
import { paneContentRoute } from "@/views/thread-detail/splitThreadNavigation";

const SIDEBAR_SELECTOR = '[data-sidebar="sidebar"]';
const MAIN_CONTENT_SELECTOR = "main";

/** Prototype drag/cmd-click source for non-thread pages. */
export function usePaneContentSplitDrag({
  content,
  enabled,
  label,
}: {
  content: PaneContent;
  enabled: boolean;
  label: string;
}) {
  const store = useStore();
  const navigate = useNavigate();
  const isCompact = useIsCompactViewport();

  const openInSplit = useCallback(() => {
    const route = paneContentRoute(content);
    const layout = store.get(splitLayoutAtom);
    if (!enabled || isCompact || layout === null) {
      navigate(route);
      return;
    }
    const existing = findContentTab(layout.root, content);
    let next =
      existing !== null
        ? activateTab(layout, existing.pane.paneId, existing.tab.tabId)
        : countPanes(layout.root) >= MAX_PANES
          ? openTab(layout, layout.focusedPaneId, content)
          : splitPane(layout, layout.focusedPaneId, "right", content);
    if (existing !== null) {
      next = commitTab(next, existing.pane.paneId, existing.tab.tabId);
      next = setFocus(next, existing.pane.paneId);
    }
    if (next !== layout) store.set(splitLayoutAtom, next);
    if (findContentTab(next.root, content) !== null) {
      navigate(route, existing !== null ? { replace: true } : undefined);
    }
  }, [content, enabled, isCompact, navigate, store]);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (!enabled || event.button !== 0) return;
      const rowEl = event.currentTarget;
      const sidebarEl = rowEl.closest(SIDEBAR_SELECTOR);
      const sidebarRightEdge = (sidebarEl ?? rowEl).getBoundingClientRect()
        .right;
      const startX = event.clientX;
      const startY = event.clientY;
      const startLayout = store.get(splitLayoutAtom);
      const fallback = singlePaneFallback(startLayout);
      beginSplitDrag(startX, startY, {
        ghostLabel: label,
        sourceEl: rowEl,
        cancelSidebarReorderOnEngage: true,
        ...(fallback ? { fallback } : {}),
        shouldEngage: (x, y) =>
          shouldEngageSidebarSplitDrag({
            startX,
            startY,
            x,
            y,
            sidebarRightEdge,
          }),
        decide: (_paneId, zone) => {
          const layout = store.get(splitLayoutAtom);
          if (layout === null) return null;
          return decideThreadDrop({
            zone,
            threadAlreadyOpen: findContentTab(layout.root, content) !== null,
            atMaxPanes: countPanes(layout.root) >= MAX_PANES,
          });
        },
        onDrop: (target) => {
          const layout = store.get(splitLayoutAtom);
          if (layout === null) return;
          const existing = findContentTab(layout.root, content);
          let next =
            existing !== null
              ? activateTab(layout, existing.pane.paneId, existing.tab.tabId)
              : target.zone === "center"
                ? openTab(layout, target.paneId, content)
                : splitPane(layout, target.paneId, target.zone, content);
          if (existing !== null) {
            next = commitTab(next, existing.pane.paneId, existing.tab.tabId);
            next = setFocus(next, existing.pane.paneId);
          }
          if (next !== layout) store.set(splitLayoutAtom, next);
          if (findContentTab(next.root, content) === null) return;
          navigate(
            paneContentRoute(content),
            existing !== null ? { replace: true } : undefined,
          );
        },
      });
    },
    [content, enabled, label, navigate, store],
  );

  return {
    onPointerDown: enabled && !isCompact ? onPointerDown : undefined,
    openInSplit,
  };
}

function singlePaneFallback(
  layout: SplitLayout | null,
): SplitDragFallbackTarget | null {
  if (layout === null) return null;
  const panes = listPanes(layout.root);
  const only = panes[0];
  if (panes.length !== 1 || only === undefined) return null;
  return {
    paneId: only.paneId,
    container: document.querySelector<HTMLElement>(MAIN_CONTENT_SELECTOR),
  };
}
