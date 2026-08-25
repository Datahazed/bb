import { useCallback, type PointerEvent as ReactPointerEvent } from "react";
import { useStore } from "jotai";
import { useNavigate } from "react-router-dom";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import {
  getPluginPanelRoutePath,
  getRootComposeRoutePath,
  getThreadRoutePath,
} from "@/lib/route-paths";
import { splitLayoutAtom } from "@/lib/split-layout/atoms";
import {
  countPanes,
  findPaneByContent,
  listPanes,
  MAX_PANES,
  replacePaneContent,
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

const SIDEBAR_SELECTOR = '[data-sidebar="sidebar"]';
const MAIN_CONTENT_SELECTOR = "main";

function routeForContent(content: PaneContent): string {
  if (content.kind === "thread") return getThreadRoutePath(content);
  if (content.kind === "new-thread") return getRootComposeRoutePath();
  return getPluginPanelRoutePath({
    pluginId: content.pluginId,
    path: content.panelPath,
    subPath: content.subPath,
  });
}

function navigationOptionsForContent(
  content: PaneContent,
  replace = false,
): { replace?: true; state?: { draftSlotId: string } } | undefined {
  const state =
    content.kind === "new-thread"
      ? { draftSlotId: content.draftSlotId }
      : undefined;
  if (!replace && state === undefined) return undefined;
  return {
    ...(replace ? { replace: true as const } : {}),
    ...(state === undefined ? {} : { state }),
  };
}

type PaneContentSplitDragSource =
  | { content: PaneContent; createContent?: never }
  | { content?: never; createContent: () => PaneContent };

/** Prototype drag/cmd-click source for non-thread pages. */
export function usePaneContentSplitDrag({
  enabled,
  label,
  ...source
}: PaneContentSplitDragSource & {
  enabled: boolean;
  label: string;
}) {
  const store = useStore();
  const navigate = useNavigate();
  const isCompact = useIsCompactViewport();
  const fixedContent = source.content;
  const createContent = source.createContent;
  const resolveContent = useCallback(() => {
    if (fixedContent !== undefined) return fixedContent;
    if (createContent !== undefined) return createContent();
    throw new Error("A pane-content split source is required.");
  }, [createContent, fixedContent]);

  const openInSplit = useCallback(() => {
    const content = resolveContent();
    const route = routeForContent(content);
    const layout = store.get(splitLayoutAtom);
    if (!enabled || isCompact || layout === null) {
      navigate(route, navigationOptionsForContent(content));
      return;
    }
    const existing = findPaneByContent(layout.root, content);
    const next =
      existing !== null
        ? setFocus(layout, existing.paneId)
        : countPanes(layout.root) >= MAX_PANES
          ? replacePaneContent(layout, layout.focusedPaneId, content)
          : splitPane(layout, layout.focusedPaneId, "right", content);
    if (next !== layout) store.set(splitLayoutAtom, next);
    navigate(
      route,
      navigationOptionsForContent(content, existing !== null),
    );
  }, [enabled, isCompact, navigate, resolveContent, store]);

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
      beginSplitDrag({
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
            // Factory-backed sources create a new identity only after a
            // successful drop, so they can never already be open here.
            threadAlreadyOpen:
              fixedContent !== undefined &&
              findPaneByContent(layout.root, fixedContent) !== null,
            atMaxPanes: countPanes(layout.root) >= MAX_PANES,
          });
        },
        onDrop: (target) => {
          const layout = store.get(splitLayoutAtom);
          if (layout === null) return;
          const content = resolveContent();
          const existing = findPaneByContent(layout.root, content);
          const next =
            existing !== null
              ? setFocus(layout, existing.paneId)
              : target.zone === "center"
                ? replacePaneContent(layout, target.paneId, content)
                : splitPane(layout, target.paneId, target.zone, content);
          if (next !== layout) store.set(splitLayoutAtom, next);
          navigate(
            routeForContent(content),
            navigationOptionsForContent(content, existing !== null),
          );
        },
      });
    },
    [enabled, fixedContent, label, navigate, resolveContent, store],
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
