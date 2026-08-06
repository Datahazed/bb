import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import {
  createTabScopedStorage,
  type SyncStorage,
} from "@/lib/browser-storage";
import type { ThreadRoutePathArgs } from "@/lib/route-paths";
import { findPane, listPanes, removePane } from "./ops";
import {
  deserializeSplitLayout,
  serializeSplitLayout,
  SPLIT_LAYOUT_STORAGE_KEY,
} from "./persistence";
import type { PaneContent, SplitLayout } from "./types";

function createSplitLayoutStorage(): SyncStorage<SplitLayout | null> {
  return createTabScopedStorage<SplitLayout | null>({
    // A malformed or stale value deserializes to null, which the split area
    // reads as "seed a single pane from the current route".
    parse: (storedValue) => deserializeSplitLayout(storedValue),
    serialize: (value) => (value === null ? "" : serializeSplitLayout(value)),
  });
}

/**
 * Global split layout, shared across projects like {@link
 * sidebarCollapsedAtoms} but scoped to one tab. Null until the first thread
 * view seeds a single pane from the route; persisted through the versioned
 * split-layout codec so reload restores the arrangement (the URL's thread
 * claims focus). The focused pane is carried inside {@link
 * SplitLayout.focusedPaneId}, not a separate atom.
 *
 * Tab-scoped rather than cross-tab synced: which thread sits in which pane is a
 * property of the window you are looking at, so a second tab must never adopt
 * the first tab's panes (issue #873). See {@link createTabScopedStorage}.
 */
export const splitLayoutAtom = atomWithStorage<SplitLayout | null>(
  SPLIT_LAYOUT_STORAGE_KEY,
  null,
  createSplitLayoutStorage(),
  { getOnInit: true },
);

export const MAXIMIZED_PANE_STORAGE_KEY = "bb.splitLayout.maximizedPaneId";

/**
 * The pane temporarily filling the split workspace. This is persisted beside,
 * rather than inside, the versioned split tree so maximizing never rewrites or
 * migrates the exact arrangement and sizes it will restore. SplitThreadArea
 * validates the id against the hydrated layout and clears stale values.
 *
 * Tab-scoped for the same reason as {@link splitLayoutAtom}: it names a pane in
 * that tab's layout.
 */
export const maximizedPaneIdAtom = atomWithStorage<string | null>(
  MAXIMIZED_PANE_STORAGE_KEY,
  null,
  createTabScopedStorage<string | null>({
    parse: (storedValue, initialValue) =>
      storedValue !== null && storedValue.length > 0
        ? storedValue
        : initialValue,
    serialize: (value) => value ?? "",
  }),
  { getOnInit: true },
);

export interface ClosePanesForThreadsResult {
  /** True when at least one pane closed. */
  removedAny: boolean;
  /**
   * The route of the focused pane that survived the close, or null when nothing
   * closed or no valid pane survived (a recursive archive covering every open
   * pane leaves only a targeted thread, since the last pane can't be removed).
   * The caller replace-navigates to this route so the URL never lingers on a
   * removed pane, and falls back to its pre-split navigate-away when it's null.
   */
  focusedRoute: ThreadRoutePathArgs | null;
}

/**
 * Closes every pane whose thread is in `threadIds`, one at a time, while more
 * than one pane remains (the layout never collapses below a single pane). This
 * bridges archive/delete: a thread open in a split pane closes that pane
 * instead of navigating the whole window away.
 *
 * Route policy lives here so the caller never re-derives it: when a valid pane
 * survives, the result carries its route (the caller syncs the URL to it); when
 * every surviving pane is itself targeted, the layout is cleared and the result
 * carries a null route (the caller runs its pre-split navigate-away/reset).
 */
export const closePanesForThreadsAtom = atom(
  null,
  (get, set, threadIds: readonly string[]): ClosePanesForThreadsResult => {
    const current = get(splitLayoutAtom);
    if (current === null || threadIds.length === 0) {
      return { removedAny: false, focusedRoute: null };
    }
    const targets = new Set(threadIds);
    let layout = current;
    let removedAny = false;
    for (;;) {
      const pane = listPanes(layout.root).find(
        (candidate) =>
          candidate.content.kind === "thread" &&
          targets.has(candidate.content.threadId),
      );
      if (pane === undefined) {
        break;
      }
      const next = removePane(layout, pane.paneId);
      if (next === layout) {
        // removePane refuses to remove the last pane.
        break;
      }
      layout = next;
      removedAny = true;
    }
    if (!removedAny) {
      return { removedAny: false, focusedRoute: null };
    }
    const maximizedPaneId = get(maximizedPaneIdAtom);
    if (
      maximizedPaneId !== null &&
      (listPanes(layout.root).length < 2 ||
        findPane(layout.root, maximizedPaneId) === null)
    ) {
      set(maximizedPaneIdAtom, null);
    }
    // The surviving focused pane may still be a targeted thread (recursive
    // archive covering every pane). Treat that as "no valid survivor": clear the
    // layout so a stale pane isn't left behind, and signal the caller to fall
    // back to navigating the window away.
    const focused = findPane(layout.root, layout.focusedPaneId);
    const survivorRoute =
      focused !== null &&
      focused.content.kind === "thread" &&
      !targets.has(focused.content.threadId)
        ? {
            projectId: focused.content.projectId,
            threadId: focused.content.threadId,
          }
        : null;
    if (survivorRoute === null) {
      set(splitLayoutAtom, null);
      set(maximizedPaneIdAtom, null);
      return { removedAny: true, focusedRoute: null };
    }
    set(splitLayoutAtom, layout);
    return { removedAny: true, focusedRoute: survivorRoute };
  },
);

export interface ClosePanesForPluginResult {
  /** True when at least one pane closed. */
  removedAny: boolean;
  /**
   * Content of the focused pane that survived the close, or null when nothing
   * closed or no valid pane survived. The caller navigates to this pane's own
   * route, so removing a background pane never drags the window off the page
   * the user is actually looking at; a null falls back to its navigate-away.
   */
  focusedContent: PaneContent | null;
}

/**
 * Closes every pane showing a panel from `pluginId`, the split-layout sibling
 * of {@link closePanesForThreadsAtom}. Uninstalling a plugin unregisters its
 * panels, so a pane left behind renders the "panel is not available"
 * placeholder for a page nothing can restore — and reload brings it back,
 * because the layout is persisted.
 *
 * The layout never collapses below a single pane, so a lone plugin pane stays
 * put: the caller's navigation replaces its content instead.
 */
export const closePanesForPluginAtom = atom(
  null,
  (get, set, pluginId: string): ClosePanesForPluginResult => {
    const current = get(splitLayoutAtom);
    if (current === null) {
      return { removedAny: false, focusedContent: null };
    }
    const isRemovedPanel = (content: PaneContent): boolean =>
      content.kind === "plugin-panel" && content.pluginId === pluginId;
    let layout = current;
    let removedAny = false;
    for (;;) {
      const pane = listPanes(layout.root).find((candidate) =>
        isRemovedPanel(candidate.content),
      );
      if (pane === undefined) {
        break;
      }
      const next = removePane(layout, pane.paneId);
      if (next === layout) {
        // removePane refuses to remove the last pane.
        break;
      }
      layout = next;
      removedAny = true;
    }
    if (!removedAny) {
      return { removedAny: false, focusedContent: null };
    }
    const maximizedPaneId = get(maximizedPaneIdAtom);
    if (
      maximizedPaneId !== null &&
      (listPanes(layout.root).length < 2 ||
        findPane(layout.root, maximizedPaneId) === null)
    ) {
      set(maximizedPaneIdAtom, null);
    }
    // The pane that kept focus can still be the removed plugin's own panel,
    // when its panels filled the layout. Treat that as "no valid survivor":
    // clear the layout rather than leave a dead pane behind.
    const focused = findPane(layout.root, layout.focusedPaneId);
    const survivor =
      focused !== null && !isRemovedPanel(focused.content)
        ? focused.content
        : null;
    if (survivor === null) {
      set(splitLayoutAtom, null);
      set(maximizedPaneIdAtom, null);
      return { removedAny: true, focusedContent: null };
    }
    set(splitLayoutAtom, layout);
    return { removedAny: true, focusedContent: survivor };
  },
);
