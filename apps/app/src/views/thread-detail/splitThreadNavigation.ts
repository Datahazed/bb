import type { ThreadRoutePathArgs } from "@/lib/route-paths";
import type { ThreadOpenSplit, ThreadPaneAction } from "@bb/server-contract";
import {
  activateTab,
  activePaneContent,
  countPanes,
  createPaneNode,
  findContentTab,
  findPane,
  findPaneByThread,
  MAX_PANES,
  openTab,
  replacePaneContent,
  setFocus,
  splitPane,
} from "@/lib/split-layout";
import { decideThreadDrop, type SplitZone } from "@/lib/split-drag";
import type { PaneContent, SplitLayout } from "@/lib/split-layout";
import {
  getPluginPanelRoutePath,
  getRootComposeRoutePath,
  getTerminalRoutePath,
  getThreadDiffRoutePath,
  getThreadRoutePath,
} from "@/lib/route-paths";

const FIRST_PANE_ID = "pane-1";
const FIRST_TAB_ID = "tab-1";

export function threadPaneContent(thread: ThreadRoutePathArgs): PaneContent {
  return {
    kind: "thread",
    projectId: thread.projectId,
    threadId: thread.threadId,
  };
}

export function createSinglePaneLayout(
  thread: ThreadRoutePathArgs,
): SplitLayout {
  return createSinglePaneContentLayout(threadPaneContent(thread));
}

export function createSinglePaneContentLayout(
  content: PaneContent,
): SplitLayout {
  return {
    root: createPaneNode(FIRST_PANE_ID, FIRST_TAB_ID, content),
    focusedPaneId: FIRST_PANE_ID,
  };
}

export function paneContentRoute(content: PaneContent): string {
  switch (content.kind) {
    case "thread":
      return getThreadRoutePath(content);
    case "new-thread":
      return getRootComposeRoutePath();
    case "terminal":
      return getTerminalRoutePath(content.terminalId);
    case "diff":
      return getThreadDiffRoutePath(content);
    case "plugin-panel":
      return getPluginPanelRoutePath({
        pluginId: content.pluginId,
        path: content.panelPath,
        subPath: content.subPath,
      });
  }
}

/** Stateful views never open as previews: a preview slot gets silently
 * replaced by the next single-click, which must not destroy a PTY view. */
function contentPreviewable(content: PaneContent): boolean {
  return content.kind !== "terminal";
}

/**
 * Reconciles any splittable page route into the layout, per the settled
 * docking policy:
 *  - no layout yet => a single pane holding the route's view;
 *  - the view already exists as a tab anywhere => reveal it (focus its pane,
 *    activate its tab), never duplicate;
 *  - otherwise => open it as the focused group's PREVIEW tab (VS Code-style:
 *    single-click navigation replaces the group's preview slot in place),
 *    except stateful kinds which open committed.
 * Plugin-panel subpath changes update the existing tab's content (navigation
 * within the view). Returns the same reference when nothing changes so the
 * driving effect stays idempotent (no history spam, no render loop).
 */
export function reconcileLayoutForContent(
  layout: SplitLayout | null,
  content: PaneContent,
): SplitLayout | null {
  const isRevealOnlyTerminal =
    content.kind === "terminal" && content.target === undefined;
  if (layout === null) {
    // URL-derived terminal content can't seed a layout either — a targetless
    // tab could never locate its session and must not be persisted.
    return isRevealOnlyTerminal ? null : createSinglePaneContentLayout(content);
  }
  const existing = findContentTab(layout.root, content);
  if (existing !== null) {
    const needsSubPathRefresh =
      existing.tab.content.kind === "plugin-panel" &&
      content.kind === "plugin-panel" &&
      existing.tab.content.subPath !== content.subPath;
    let next = layout;
    if (existing.pane.activeTabId !== existing.tab.tabId) {
      next = activateTab(next, existing.pane.paneId, existing.tab.tabId);
    }
    if (needsSubPathRefresh) {
      next = replacePaneContent(next, existing.pane.paneId, content);
    }
    return next.focusedPaneId === existing.pane.paneId
      ? next
      : setFocus(next, existing.pane.paneId);
  }
  if (isRevealOnlyTerminal) {
    // URL-derived terminal content is a reveal intent only: without its
    // context binding the pane couldn't locate its session, so an unopened
    // terminal deep link leaves the layout untouched.
    return layout;
  }
  return openTab(layout, layout.focusedPaneId, content, {
    preview: contentPreviewable(content),
  });
}

export function focusedPaneRoute(layout: SplitLayout): string | null {
  const focused = findPane(layout.root, layout.focusedPaneId);
  return focused === null ? null : paneContentRoute(activePaneContent(focused));
}

/**
 * Folds an external thread route (initial load, sidebar click, deep link) into
 * the layout. Threads are reveal-existing (one view per thread); an unopened
 * thread opens as the focused group's preview tab.
 * Returns the same reference when nothing changes.
 */
export function reconcileLayoutForRoute(
  layout: SplitLayout | null,
  thread: ThreadRoutePathArgs,
): SplitLayout {
  // Thread content never hits the reveal-only terminal guard, so the null
  // branch always seeds a layout; the fallback only satisfies the types.
  return (
    reconcileLayoutForContent(layout, threadPaneContent(thread)) ??
    createSinglePaneLayout(thread)
  );
}

function threadOpenSplitZone(split: ThreadOpenSplit): SplitZone {
  return split === "replace" ? "center" : split === "down" ? "bottom" : split;
}

/**
 * Applies a CLI/SDK thread-open intent to the current layout. This deliberately
 * routes through the same drop decision as sidebar dragging so already-open
 * threads focus, and edge splits at the pane cap coerce to replacement. An
 * explicit open intent is a commit gesture: the tab opens committed, and a
 * center intent adds a tab to the focused group rather than replacing content.
 */
export function applyThreadOpenToLayout(
  layout: SplitLayout | null,
  thread: ThreadRoutePathArgs,
  split: ThreadOpenSplit,
): SplitLayout {
  if (layout === null) {
    return createSinglePaneLayout(thread);
  }
  const existing = findPaneByThread(
    layout.root,
    thread.projectId,
    thread.threadId,
  );
  const decision = decideThreadDrop({
    zone: threadOpenSplitZone(split),
    threadAlreadyOpen: existing !== null,
    atMaxPanes: countPanes(layout.root) >= MAX_PANES,
  });
  if (existing !== null) {
    const content = threadPaneContent(thread);
    const location = findContentTab(layout.root, content);
    let next = layout;
    if (location !== null && location.pane.activeTabId !== location.tab.tabId) {
      next = activateTab(next, location.pane.paneId, location.tab.tabId);
    }
    return next.focusedPaneId === existing.paneId
      ? next
      : setFocus(next, existing.paneId);
  }
  const content = threadPaneContent(thread);
  return decision.zone === "center"
    ? openTab(layout, layout.focusedPaneId, content)
    : splitPane(layout, layout.focusedPaneId, decision.zone, content);
}

export interface ThreadPaneActionLayoutResult {
  layout: SplitLayout;
  maximizedPaneId: string | null;
}

/** Apply one CLI/SDK pane action without creating or replacing pane content. */
export function applyThreadPaneActionToLayout(
  layout: SplitLayout,
  maximizedPaneId: string | null,
  thread: ThreadRoutePathArgs,
  action: ThreadPaneAction,
): ThreadPaneActionLayoutResult {
  const pane = findPaneByThread(layout.root, thread.projectId, thread.threadId);
  if (pane === null || countPanes(layout.root) < 2) {
    return { layout, maximizedPaneId };
  }
  if (action === "restore") {
    return {
      layout,
      maximizedPaneId: maximizedPaneId === pane.paneId ? null : maximizedPaneId,
    };
  }
  if (action === "toggle" && maximizedPaneId === pane.paneId) {
    return { layout, maximizedPaneId: null };
  }
  return {
    layout:
      layout.focusedPaneId === pane.paneId
        ? layout
        : setFocus(layout, pane.paneId),
    maximizedPaneId: pane.paneId,
  };
}

/**
 * The focused pane's thread as route args, or null when its active view isn't
 * a thread. Drives URL sync: the focused pane's active tab owns the address
 * bar.
 */
export function focusedThreadRoute(
  layout: SplitLayout,
): ThreadRoutePathArgs | null {
  const focused = findPane(layout.root, layout.focusedPaneId);
  const content = focused === null ? null : activePaneContent(focused);
  if (content === null || content.kind !== "thread") {
    return null;
  }
  return {
    projectId: content.projectId,
    threadId: content.threadId,
  };
}
