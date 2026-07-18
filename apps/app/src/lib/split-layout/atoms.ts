import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import {
  createNullableLocalStorageEnumStorage,
  createLocalStorageSyncStorage,
  type SyncStorage,
} from "@/lib/browser-storage";
import type { ThreadRoutePathArgs } from "@/lib/route-paths";
import {
  activePaneContent,
  closeTab,
  findPane,
  listPanes,
  listTabs,
} from "./ops";
import {
  deserializeSplitLayout,
  serializeSplitLayout,
  SPLIT_LAYOUT_STORAGE_KEY,
} from "./persistence";
import type { SplitLayout } from "./types";

function createSplitLayoutStorage(): SyncStorage<SplitLayout | null> {
  return createLocalStorageSyncStorage<SplitLayout | null>({
    // A malformed or stale value deserializes to null, which the split area
    // reads as "seed a single pane from the current route".
    parse: (storedValue) => deserializeSplitLayout(storedValue),
    serialize: (value) => (value === null ? "" : serializeSplitLayout(value)),
  });
}

/**
 * Global split layout, shared across projects like {@link
 * sidebarCollapsedAtoms}. Null until the first thread view seeds a single pane
 * from the route; persisted through the versioned split-layout codec so reload
 * restores the arrangement (the URL's thread claims focus). The focused pane is
 * carried inside {@link SplitLayout.focusedPaneId}, not a separate atom.
 */
export const splitLayoutAtom = atomWithStorage<SplitLayout | null>(
  SPLIT_LAYOUT_STORAGE_KEY,
  null,
  createSplitLayoutStorage(),
  { getOnInit: true },
);

export const MAXIMIZED_PANE_STORAGE_KEY = "bb.splitLayout.maximizedPaneId";

function isPersistedPaneId(value: string): value is string {
  return value.length > 0;
}

/**
 * The pane temporarily filling the split workspace. This is persisted beside,
 * rather than inside, the versioned split tree so maximizing never rewrites or
 * migrates the exact arrangement and sizes it will restore. SplitThreadArea
 * validates the id against the hydrated layout and clears stale values.
 */
export const maximizedPaneIdAtom = atomWithStorage<string | null>(
  MAXIMIZED_PANE_STORAGE_KEY,
  null,
  createNullableLocalStorageEnumStorage(isPersistedPaneId),
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
    // A tab belongs to a targeted thread when it IS the thread view or a view
    // bound to it (its diff). Terminal tabs survive: the PTY resource outlives
    // the thread view and closing it is a separate decision.
    const isTargetedTab = (content: ReturnType<typeof activePaneContent>) =>
      (content.kind === "thread" || content.kind === "diff") &&
      targets.has(content.threadId);
    let layout = current;
    let removedAny = false;
    for (;;) {
      const location = listTabs(layout.root).find(({ tab }) =>
        isTargetedTab(tab.content),
      );
      if (location === undefined) {
        break;
      }
      const next = closeTab(layout, location.pane.paneId, location.tab.tabId);
      if (next === layout) {
        // closeTab refuses to remove the last pane's last tab.
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
    // Clear the layout only when NOTHING valid survives (a recursive archive
    // covering every view). Non-targeted tabs — a spared terminal, another
    // thread — keep the layout alive even when the focused view is still a
    // targeted thread; the null route then tells the caller to run its
    // pre-split navigate-away while the arrangement persists.
    const hasValidSurvivor = listTabs(layout.root).some(
      ({ tab }) => !isTargetedTab(tab.content),
    );
    if (!hasValidSurvivor) {
      set(splitLayoutAtom, null);
      set(maximizedPaneIdAtom, null);
      return { removedAny: true, focusedRoute: null };
    }
    set(splitLayoutAtom, layout);
    const focused = findPane(layout.root, layout.focusedPaneId);
    const focusedContent = focused === null ? null : activePaneContent(focused);
    const survivorRoute =
      focusedContent !== null &&
      focusedContent.kind === "thread" &&
      !targets.has(focusedContent.threadId)
        ? {
            projectId: focusedContent.projectId,
            threadId: focusedContent.threadId,
          }
        : null;
    return { removedAny: true, focusedRoute: survivorRoute };
  },
);
