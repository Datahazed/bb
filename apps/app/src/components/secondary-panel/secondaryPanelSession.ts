import { useCallback, useEffect, useLayoutEffect } from "react";
import { atom, useAtomValue, useSetAtom, useStore } from "jotai";
import { atomFamily } from "jotai-family";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { TerminalSession } from "@bb/server-contract";
import { COMPACT_VIEWPORT_QUERY } from "@bb/shared-ui/hooks/use-compact-viewport";
import {
  closeFixedSecondaryPanelState,
  getFixedPanelTabsStateAtom,
  openFixedSecondaryPanelState,
  removeFixedPanelTabsStateAtom,
  removeFixedRightTerminalTabState,
  setFixedRightTerminalActiveTerminalState,
  setFixedSecondaryPanelTabState,
  touchFixedPanelTabsState,
  useFixedPanelTabsStorageMaintenance,
  type FixedPanelTabsStateUpdater,
} from "@/lib/fixed-panel-tabs";
import {
  createBrowserFixedPanelTab,
  createHostFilePreviewFixedPanelTab,
  createNewTabFixedPanelTab,
  createPluginPanelFixedPanelTab,
  createThreadStorageFilePreviewFixedPanelTab,
  createWorkspaceFilePreviewFixedPanelTab,
  type BrowserFixedPanelTab,
  type FixedPanelTab,
  type HostFilePreviewFixedPanelTab,
  type NewTabFixedPanelTab,
  type PluginPanelFixedPanelTab,
  type SecondaryFixedPanelTab,
  type ThreadStorageFilePreviewFixedPanelTab,
  type WorkspaceFilePreviewFixedPanelTab,
} from "@/lib/fixed-panel-tabs-state";
import type { ThreadSecondaryPanel } from "@/lib/thread-secondary-panel";
import {
  areThreadTabListsEquivalent,
  hasPendingThreadTabsWrite,
  reconcileFixedPanelTabsState,
  scheduleLocalThreadTabsMigration,
  scheduleThreadTabsPersistence,
} from "@/lib/thread-tabs-sync";
import { useThreadTabs } from "@/hooks/queries/thread-tabs-query";
import { getPluginSlotSnapshot } from "@/lib/plugin-slots";
import { fileOpenerPreferenceAtom } from "@/lib/file-opener-preference";
import {
  createFileOpenerTabForRequest,
  type FileTabViewerOverride,
} from "@/components/plugin/file-opener-tabs";
import type { OpenPluginPanelArgs } from "@/components/plugin/PluginPanelActions";
import type {
  HostFileTabState,
  ThreadStorageFileTabState,
  WorkspaceFileTabState,
} from "@/lib/file-preview";
import type { PromptMentionLinkResolver } from "@/components/promptbox/editor/prompt-mention-link";
import type { MarkdownPreviewLinkHandler } from "@/components/ui/markdown-link";
import {
  openUrlByPreference,
  resolveUrlOpenTarget,
  useOpenLinksInAppBrowserPreference,
} from "@/lib/in-app-browser-link-preference";
import { openUrlInExternalBrowser } from "@/lib/url-open-routing";
import { isDesktopBrowserAvailable } from "@/lib/bb-desktop";
import type { ThreadTerminalTarget } from "@/components/thread/terminal/useThreadTerminalController";
import {
  activateSecondaryPanelTabInState,
  buildOrderedSecondaryPanelFileTabs,
  clearActiveSecondaryFileTabInState,
  closeSecondaryPanelTabInState,
  findSecondaryPanelTab,
  getActiveTabIdAfterPrune,
  isBrowserTab,
  openSecondaryPanelTabInState,
  pruneStorageTabs,
  removeWorkspaceTabsForOtherEnvironments,
  reorderSecondaryPanelFileTabInState,
  replaceNewTabWithSecondaryPanelTabInState,
  setSecondaryPanelTabsInState,
  updateSecondaryPanelTabInState,
  type FileSearchSelection,
  type OpenSecondaryPanelTabRequest,
  type UpdateBrowserTabArgs,
} from "./secondaryPanelTabState";
import type {
  SecondaryPanelTabReorderRequest,
} from "./secondaryPanelFileTab";
import {
  pruneTerminalTabsForSessions,
  syncTerminalTabsInFixedPanelState,
} from "./terminalPanelTabs";
import {
  getThreadRecentItemsAtom,
  recordRecentItem,
  removeThreadRecentItemsAtom,
} from "./threadRecentItems";
import { removeThreadConversationCollapsedAtom } from "./threadSecondaryPanelAtoms";

/**
 * Atom-based state and actions for one secondary panel session, keyed by
 * `panelStateId` ("root-compose" for the New thread surface, the thread id for
 * thread detail). Views and deep consumers (timeline links, composer
 * typeahead, headers) read and write these atoms at point of use; the
 * `SecondaryPanel` component owns the session's effects and rendering.
 *
 * Lifetime: the durable pieces (tab deck, recent items, conversation collapse)
 * are storage-backed atoms that survive unmounts and reloads, exactly like the
 * previous hook architecture. Ephemeral pieces (session config, auto-focus
 * flags, the compact-drawer owner) live in plain atoms; they are reset when
 * the last `SecondaryPanel` for the id unmounts via the retain/release
 * refcount below, matching the previous per-mount React state semantics and
 * keeping long sessions from accumulating hundreds of atomFamily members.
 */

const FIXED_PANEL_TABS_TOUCH_THROTTLE_MS = 60 * 1000;

export type SecondaryPanelVariant = "root-compose" | "thread";

export interface SecondaryPanelNavigation {
  canOpenStorageFiles: boolean;
  canOpenWorkspaceFiles: boolean;
  defaultProjectId: string | null;
  openProject: (projectId: string) => void;
  openThread: (args: { projectId: string; threadId: string }) => void;
}

export interface SecondaryPanelSessionConfig {
  canCreateTerminal: boolean;
  /** `undefined` while the owning context has not resolved an environment. */
  environmentId: string | null | undefined;
  /** The thread that owns files opened from this panel (root compose can
   * borrow a reuse-environment thread). */
  fileOwnerThreadId: string | null;
  navigation: SecondaryPanelNavigation;
  projectId: string | null;
  /** Thread whose server-side tab deck this session syncs with, if any. */
  syncThreadId: string | null;
  terminalTarget: ThreadTerminalTarget | null;
  /** The thread in view; gates browser tabs on root compose. */
  threadId: string | null;
  variant: SecondaryPanelVariant;
}

export interface SecondaryPanelFileOpenOptions {
  /** Per-open viewer choice (link context menu); absent = extension default. */
  viewer?: FileTabViewerOverride;
}

export interface SecondaryPanelStorageFile {
  path: string;
}

type OpenedSecondaryPanelTab =
  | WorkspaceFilePreviewFixedPanelTab
  | HostFilePreviewFixedPanelTab
  | ThreadStorageFilePreviewFixedPanelTab
  | BrowserFixedPanelTab
  | NewTabFixedPanelTab
  | PluginPanelFixedPanelTab;

// The thread-tabs persistence queue needs the app QueryClient outside React.
// The session effects hook registers the ambient client (they are the same
// object app-wide); until a session mounts there is nothing to persist.
let sessionQueryClient: QueryClient | null = null;

/**
 * Mirrors the compact-viewport media query into an atom so write atoms can
 * branch on drawer-vs-persisted semantics. Only live while subscribed — the
 * session effects hook keeps it hot whenever a panel session is mounted.
 */
export const isCompactViewportAtom = atom(false);
isCompactViewportAtom.onMount = (set) => {
  if (typeof window === "undefined" || window.matchMedia === undefined) {
    return;
  }
  const mql = window.matchMedia(COMPACT_VIEWPORT_QUERY);
  const update = () => set(mql.matches);
  update();
  mql.addEventListener("change", update);
  return () => mql.removeEventListener("change", update);
};

/**
 * Which panel session owns the compact bottom drawer. A single global slot:
 * opening a drawer for one session implicitly closes any other, and switching
 * threads (a different panelStateId) leaves the drawer closed for the new
 * thread — the same isolation the per-mount React state used to provide.
 */
const compactDrawerPanelStateIdAtom = atom<string | null>(null);

const configFamily = atomFamily((_panelStateId: string) =>
  atom<SecondaryPanelSessionConfig | null>(null),
);

const newTabAutoFocusFamily = atomFamily((_panelStateId: string) =>
  atom(false),
);
const terminalAutoFocusFamily = atomFamily((_panelStateId: string) =>
  atom(false),
);

export function getNewTabAutoFocusAtom(panelStateId: string) {
  return newTabAutoFocusFamily(panelStateId);
}

export function getTerminalAutoFocusAtom(panelStateId: string) {
  return terminalAutoFocusFamily(panelStateId);
}

// ---------------------------------------------------------------------------
// Derived reads
// ---------------------------------------------------------------------------

const persistedOpenFamily = atomFamily((panelStateId: string) =>
  atom((get) => get(getFixedPanelTabsStateAtom(panelStateId)).secondary.isOpen),
);

const isOpenFamily = atomFamily((panelStateId: string) =>
  atom((get) =>
    get(isCompactViewportAtom)
      ? get(compactDrawerPanelStateIdAtom) === panelStateId
      : get(persistedOpenFamily(panelStateId)),
  ),
);

const activeFixedSecondaryTabFamily = atomFamily((panelStateId: string) =>
  atom((get): SecondaryFixedPanelTab | null => {
    const state = get(getFixedPanelTabsStateAtom(panelStateId));
    return (
      state.secondary.tabs.find(
        (tab) => tab.id === state.secondary.activeTabId,
      ) ?? null
    );
  }),
);

const orderedSecondaryFileTabsFamily = atomFamily((panelStateId: string) =>
  atom((get) => {
    const config = get(configFamily(panelStateId));
    const state = get(getFixedPanelTabsStateAtom(panelStateId));
    return buildOrderedSecondaryPanelFileTabs({
      includeWorkspaceTabsOutsideEnvironment:
        config?.variant === "root-compose",
      tabs: state.secondary.tabs,
      resolvedEnvironmentId: config === null ? undefined : config.environmentId,
    });
  }),
);

const browserTabsFamily = atomFamily((panelStateId: string) =>
  atom((get) =>
    get(getFixedPanelTabsStateAtom(panelStateId)).secondary.tabs.filter(
      isBrowserTab,
    ),
  ),
);

export interface SecondaryPanelActiveFileTabs {
  activeBrowserTab: BrowserFixedPanelTab | null;
  activeHostFileEnvironmentId: string | null;
  activeHostFileLineRange: HostFilePreviewFixedPanelTab["lineRange"] | null;
  activeHostFilePath: string | null;
  activeHostFileThreadId: string | null;
  activePluginPanelTab: PluginPanelFixedPanelTab | null;
  activeStorageFileEnvironmentId: string | null;
  activeStorageFileLineRange:
    | ThreadStorageFilePreviewFixedPanelTab["lineRange"]
    | null;
  activeStorageFilePath: string | null;
  activeStorageFileThreadId: string | null;
  activeWorkspaceFileEnvironmentId: string | null;
  activeWorkspaceFileLineRange:
    | WorkspaceFilePreviewFixedPanelTab["lineRange"]
    | null;
  activeWorkspaceFilePath: string | null;
  activeWorkspaceFileProjectId: string | null;
  activeWorkspaceFileSource: WorkspaceFilePreviewFixedPanelTab["source"] | null;
  activeWorkspaceFileStatusLabel:
    | WorkspaceFilePreviewFixedPanelTab["statusLabel"]
    | null;
  isNewTabActive: boolean;
}

const activeFileTabsFamily = atomFamily((panelStateId: string) =>
  atom((get): SecondaryPanelActiveFileTabs => {
    const config = get(configFamily(panelStateId));
    const activeTab = get(activeFixedSecondaryTabFamily(panelStateId));
    const preserveWorkspaceTabsAcrossContexts =
      config?.variant === "root-compose";
    const resolvedEnvironmentId =
      config === null ? undefined : config.environmentId;
    const activeWorkspaceFileTab =
      activeTab?.kind === "workspace-file-preview" &&
      (preserveWorkspaceTabsAcrossContexts ||
        activeTab.environmentId === resolvedEnvironmentId)
        ? activeTab
        : null;
    const activeStorageFileTab =
      activeTab?.kind === "thread-storage-file-preview" ? activeTab : null;
    const activeHostFileTab =
      activeTab?.kind === "host-file-preview" ? activeTab : null;
    return {
      activeBrowserTab: activeTab?.kind === "browser" ? activeTab : null,
      activeHostFileEnvironmentId: activeHostFileTab?.environmentId ?? null,
      activeHostFileLineRange: activeHostFileTab?.lineRange ?? null,
      activeHostFilePath: activeHostFileTab?.path ?? null,
      activeHostFileThreadId: activeHostFileTab?.threadId ?? null,
      activePluginPanelTab:
        activeTab?.kind === "plugin-panel" ? activeTab : null,
      activeStorageFileEnvironmentId:
        activeStorageFileTab?.environmentId ?? null,
      activeStorageFileLineRange: activeStorageFileTab?.lineRange ?? null,
      activeStorageFilePath: activeStorageFileTab?.path ?? null,
      activeStorageFileThreadId: activeStorageFileTab?.threadId ?? null,
      activeWorkspaceFileEnvironmentId:
        activeWorkspaceFileTab?.environmentId ?? null,
      activeWorkspaceFileLineRange: activeWorkspaceFileTab?.lineRange ?? null,
      activeWorkspaceFilePath: activeWorkspaceFileTab?.path ?? null,
      activeWorkspaceFileProjectId: activeWorkspaceFileTab?.projectId ?? null,
      activeWorkspaceFileSource: activeWorkspaceFileTab?.source ?? null,
      activeWorkspaceFileStatusLabel:
        activeWorkspaceFileTab?.statusLabel ?? null,
      isNewTabActive: activeTab?.kind === "new-tab",
    };
  }),
);

export function getIsSecondaryPanelOpenAtom(panelStateId: string) {
  return isOpenFamily(panelStateId);
}

export function getPersistedSecondaryPanelOpenAtom(panelStateId: string) {
  return persistedOpenFamily(panelStateId);
}

export function getActiveFixedSecondaryTabAtom(panelStateId: string) {
  return activeFixedSecondaryTabFamily(panelStateId);
}

export function getOrderedSecondaryFileTabsAtom(panelStateId: string) {
  return orderedSecondaryFileTabsFamily(panelStateId);
}

export function getSecondaryPanelBrowserTabsAtom(panelStateId: string) {
  return browserTabsFamily(panelStateId);
}

export function getSecondaryPanelActiveFileTabsAtom(panelStateId: string) {
  return activeFileTabsFamily(panelStateId);
}

// ---------------------------------------------------------------------------
// Write atoms
// ---------------------------------------------------------------------------

// One throttle slot per session, mirroring the previous per-hook ref.
const lastTabsTouchByPanelStateId = new Map<string, number>();

const updateTabsFamily = atomFamily((panelStateId: string) =>
  atom(null, (get, set, update: FixedPanelTabsStateUpdater) => {
    const stateAtom = getFixedPanelTabsStateAtom(panelStateId);
    const now = Date.now();
    const current = get(stateAtom);
    const next = update(current);
    if (next === current) {
      return;
    }
    const touched = touchFixedPanelTabsState(next, now);
    set(stateAtom, touched);
    const syncThreadId = get(configFamily(panelStateId))?.syncThreadId ?? null;
    if (
      syncThreadId !== null &&
      sessionQueryClient !== null &&
      !areThreadTabListsEquivalent(
        current.secondary.tabs,
        touched.secondary.tabs,
      )
    ) {
      scheduleThreadTabsPersistence({
        tabs: touched.secondary.tabs,
        queryClient: sessionQueryClient,
        threadId: syncThreadId,
      });
    }
  }),
);

const touchTabsFamily = atomFamily((panelStateId: string) =>
  atom(null, (_get, set) => {
    const now = Date.now();
    const lastTouch = lastTabsTouchByPanelStateId.get(panelStateId);
    if (
      lastTouch !== undefined &&
      now - lastTouch < FIXED_PANEL_TABS_TOUCH_THROTTLE_MS
    ) {
      return;
    }
    lastTabsTouchByPanelStateId.set(panelStateId, now);
    set(updateTabsFamily(panelStateId), (current) => {
      if (!current.secondary.isOpen && current.secondary.tabs.length === 0) {
        return current;
      }
      if (now - current.lastUsedAt < FIXED_PANEL_TABS_TOUCH_THROTTLE_MS) {
        return current;
      }
      return { ...current };
    });
  }),
);

function createStorageTab(
  environmentId: string | null,
  tab: ThreadStorageFileTabState,
  threadId: string,
): ThreadStorageFilePreviewFixedPanelTab {
  return createThreadStorageFilePreviewFixedPanelTab({
    environmentId,
    isPinned: false,
    tab,
    threadId,
  });
}

interface CreateTabForOpenRequestArgs {
  projectId: string | null;
  request: OpenSecondaryPanelTabRequest;
  resolvedEnvironmentId: string | null | undefined;
  threadId: string | null | undefined;
}

function createTabForOpenRequest({
  projectId,
  request,
  resolvedEnvironmentId,
  threadId,
}: CreateTabForOpenRequestArgs): OpenedSecondaryPanelTab | null {
  switch (request.kind) {
    case "workspace-file-preview":
      if (resolvedEnvironmentId === undefined) return null;
      return createWorkspaceFilePreviewFixedPanelTab({
        environmentId: resolvedEnvironmentId,
        projectId: resolvedEnvironmentId === null ? projectId : null,
        tab: request.tab,
      });
    case "host-file-preview":
      if (!threadId || !resolvedEnvironmentId) return null;
      return createHostFilePreviewFixedPanelTab({
        environmentId: resolvedEnvironmentId,
        tab: request.tab,
        threadId,
      });
    case "thread-storage-file-preview":
      if (!threadId) return null;
      return createStorageTab(
        resolvedEnvironmentId ?? null,
        request.tab,
        threadId,
      );
    case "browser":
      return createBrowserFixedPanelTab({
        environmentId: resolvedEnvironmentId ?? null,
        url: request.url,
      });
    case "new-tab":
      return createNewTabFixedPanelTab();
  }
}

const openTabFamily = atomFamily((panelStateId: string) =>
  atom(
    null,
    (
      get,
      set,
      request: OpenSecondaryPanelTabRequest,
      options?: SecondaryPanelFileOpenOptions,
    ): OpenedSecondaryPanelTab | null => {
      const config = get(configFamily(panelStateId));
      if (config === null) return null;
      const resolvedEnvironmentId = config.environmentId;
      const fileOwnerThreadId = config.fileOwnerThreadId;
      // Default-opener diversion (plugin design §5.2): every file-open flow
      // funnels through here (links, file search, `bb thread open`), so a
      // preferred plugin opener applies uniformly. Falls through to the
      // built-in tab when no opener matches; a link menu's per-open viewer
      // choice overrides the default in either direction.
      const openerTab = createFileOpenerTabForRequest({
        fileOpeners: getPluginSlotSnapshot().fileOpeners,
        preference: get(fileOpenerPreferenceAtom),
        projectId: config.projectId,
        request,
        resolvedEnvironmentId,
        threadId: fileOwnerThreadId,
        ...(options?.viewer !== undefined ? { viewer: options.viewer } : {}),
      });
      const tab =
        openerTab ??
        createTabForOpenRequest({
          projectId: config.projectId,
          request,
          resolvedEnvironmentId,
          threadId: fileOwnerThreadId,
        });
      if (tab === null) return null;

      if (
        request.kind === "workspace-file-preview" &&
        request.tab.source.kind === "working-tree"
      ) {
        set(getThreadRecentItemsAtom(panelStateId), (items) =>
          recordRecentItem({
            items,
            source: "workspace",
            path: request.tab.path,
            openedAt: Date.now(),
          }),
        );
      }
      if (request.kind === "thread-storage-file-preview") {
        set(getThreadRecentItemsAtom(panelStateId), (items) =>
          recordRecentItem({
            items,
            source: "thread-storage",
            path: request.tab.path,
            openedAt: Date.now(),
          }),
        );
      }

      set(updateTabsFamily(panelStateId), (state) => {
        if (request.kind === "browser") {
          return replaceNewTabWithSecondaryPanelTabInState({ state, tab });
        }
        return openSecondaryPanelTabInState({ state, tab });
      });
      return tab;
    },
  ),
);

const openCompactDrawerFamily = atomFamily((panelStateId: string) =>
  atom(null, (get, set) => {
    if (!get(isCompactViewportAtom)) {
      return;
    }
    set(compactDrawerPanelStateIdAtom, panelStateId);
  }),
);

const closePanelFamily = atomFamily((panelStateId: string) =>
  atom(null, (get, set) => {
    if (get(isCompactViewportAtom)) {
      set(compactDrawerPanelStateIdAtom, (current) =>
        current === panelStateId ? null : current,
      );
      return;
    }
    set(updateTabsFamily(panelStateId), closeFixedSecondaryPanelState);
  }),
);

const openNewTabFamily = atomFamily((panelStateId: string) =>
  atom(null, (_get, set) => {
    set(openTabFamily(panelStateId), { kind: "new-tab" });
    set(openCompactDrawerFamily(panelStateId));
    set(newTabAutoFocusFamily(panelStateId), true);
  }),
);

const toggleFamily = atomFamily((panelStateId: string) =>
  atom(null, (get, set) => {
    const isCompact = get(isCompactViewportAtom);
    const isOpen = isCompact
      ? get(compactDrawerPanelStateIdAtom) === panelStateId
      : get(persistedOpenFamily(panelStateId));
    if (isOpen) {
      set(closePanelFamily(panelStateId));
      return;
    }
    // Root compose has no default info tab, so opening from the toggle lands
    // on a fresh "New tab" (with its search focused) instead of a blank panel.
    if (get(configFamily(panelStateId))?.variant === "root-compose") {
      set(openNewTabFamily(panelStateId));
      return;
    }
    if (isCompact) {
      set(compactDrawerPanelStateIdAtom, panelStateId);
      return;
    }
    set(updateTabsFamily(panelStateId), openFixedSecondaryPanelState);
  }),
);

const openPanelFamily = atomFamily((panelStateId: string) =>
  atom(null, (_get, set, panel: ThreadSecondaryPanel) => {
    set(updateTabsFamily(panelStateId), (state) =>
      setFixedSecondaryPanelTabState(state, panel),
    );
    set(openCompactDrawerFamily(panelStateId));
  }),
);

const changePanelFamily = atomFamily((panelStateId: string) =>
  atom(null, (_get, set, panel: ThreadSecondaryPanel) => {
    set(clearActiveFileTabsFamily(panelStateId));
    set(openPanelFamily(panelStateId), panel);
  }),
);

const setPersistedPanelFamily = atomFamily((panelStateId: string) =>
  atom(null, (_get, set, panel: ThreadSecondaryPanel | null) => {
    set(updateTabsFamily(panelStateId), (state) =>
      panel === null
        ? closeFixedSecondaryPanelState(state)
        : setFixedSecondaryPanelTabState(state, panel),
    );
  }),
);

const openWorkspaceFileFamily = atomFamily((panelStateId: string) =>
  atom(
    null,
    (
      _get,
      set,
      file: WorkspaceFileTabState,
      options?: SecondaryPanelFileOpenOptions,
    ) => {
      set(
        openTabFamily(panelStateId),
        { kind: "workspace-file-preview", tab: file },
        options,
      );
      set(openCompactDrawerFamily(panelStateId));
    },
  ),
);

const openStorageFileFamily = atomFamily((panelStateId: string) =>
  atom(
    null,
    (
      _get,
      set,
      file: ThreadStorageFileTabState,
      options?: SecondaryPanelFileOpenOptions,
    ) => {
      set(
        openTabFamily(panelStateId),
        { kind: "thread-storage-file-preview", tab: file },
        options,
      );
      set(openCompactDrawerFamily(panelStateId));
    },
  ),
);

const openHostFileFamily = atomFamily((panelStateId: string) =>
  atom(
    null,
    (
      _get,
      set,
      file: HostFileTabState,
      options?: SecondaryPanelFileOpenOptions,
    ) => {
      set(
        openTabFamily(panelStateId),
        { kind: "host-file-preview", tab: file },
        options,
      );
      set(openCompactDrawerFamily(panelStateId));
    },
  ),
);

const openBrowserTabAndRevealFamily = atomFamily((panelStateId: string) =>
  atom(null, (get, set, url?: string): OpenedSecondaryPanelTab | null => {
    const config = get(configFamily(panelStateId));
    if (config === null || config.threadId === null) return null;
    const tab = set(openTabFamily(panelStateId), {
      kind: "browser",
      url: url ?? "",
    });
    set(openCompactDrawerFamily(panelStateId));
    return tab;
  }),
);

const openPluginPanelFamily = atomFamily((panelStateId: string) =>
  atom(null, (_get, set, args: OpenPluginPanelArgs) => {
    // Opens (or focuses) a plugin panel tab from a panel action. Params are
    // part of the tab identity: identical params focus the existing tab
    // (refreshing its title), different params open a sibling tab. Launched
    // from the new-tab page, so the transient new-tab is replaced like the
    // file/browser launchers do.
    const tab = createPluginPanelFixedPanelTab({
      actionId: args.actionId,
      paramsJson: args.paramsJson,
      pluginId: args.pluginId,
      title: args.title,
    });
    set(updateTabsFamily(panelStateId), (state) => {
      const existing = findSecondaryPanelTab(state.secondary.tabs, tab.id);
      if (existing !== null && existing.kind === "plugin-panel") {
        const withTitle =
          existing.title === args.title
            ? state
            : updateSecondaryPanelTabInState({
                state,
                tab: { ...existing, title: args.title },
              });
        return activateSecondaryPanelTabInState(withTitle, tab.id);
      }
      return replaceNewTabWithSecondaryPanelTabInState({ state, tab });
    });
  }),
);

interface CreateTabForFileSearchSelectionArgs {
  projectId: string | null;
  resolvedEnvironmentId: string | null | undefined;
  selection: FileSearchSelection;
  threadId: string | null | undefined;
}

function createTabForFileSearchSelection({
  projectId,
  resolvedEnvironmentId,
  selection,
  threadId,
}: CreateTabForFileSearchSelectionArgs):
  | WorkspaceFilePreviewFixedPanelTab
  | ThreadStorageFilePreviewFixedPanelTab
  | null {
  if (selection.source === "workspace") {
    if (resolvedEnvironmentId === undefined) return null;
    return createWorkspaceFilePreviewFixedPanelTab({
      environmentId: resolvedEnvironmentId,
      projectId: resolvedEnvironmentId === null ? projectId : null,
      tab: {
        lineRange: null,
        path: selection.path,
        source: { kind: "working-tree" },
        statusLabel: null,
      },
    });
  }

  if (!threadId) return null;
  return createStorageTab(
    resolvedEnvironmentId ?? null,
    {
      lineRange: null,
      path: selection.path,
    },
    threadId,
  );
}

const selectFileSearchResultFamily = atomFamily((panelStateId: string) =>
  atom(null, (get, set, selection: FileSearchSelection) => {
    const config = get(configFamily(panelStateId));
    if (config === null) return;
    const tab = createTabForFileSearchSelection({
      projectId: config.projectId,
      resolvedEnvironmentId: config.environmentId,
      selection,
      threadId: config.fileOwnerThreadId,
    });
    if (tab === null) return;

    set(getThreadRecentItemsAtom(panelStateId), (items) =>
      recordRecentItem({
        items,
        source: selection.source,
        path: selection.path,
        openedAt: Date.now(),
      }),
    );
    set(updateTabsFamily(panelStateId), (state) =>
      replaceNewTabWithSecondaryPanelTabInState({ state, tab }),
    );
    set(openCompactDrawerFamily(panelStateId));
  }),
);

const activateFileTabFamily = atomFamily((panelStateId: string) =>
  atom(null, (_get, set, tabId: string) => {
    set(updateTabsFamily(panelStateId), (state) =>
      activateSecondaryPanelTabInState(state, tabId),
    );
    set(openCompactDrawerFamily(panelStateId));
  }),
);

const closeTabFamily = atomFamily((panelStateId: string) =>
  atom(null, (_get, set, tabId: string) => {
    set(updateTabsFamily(panelStateId), (state) =>
      closeSecondaryPanelTabInState(state, tabId),
    );
  }),
);

const reorderFileTabFamily = atomFamily((panelStateId: string) =>
  atom(null, (_get, set, request: SecondaryPanelTabReorderRequest) => {
    set(updateTabsFamily(panelStateId), (state) =>
      reorderSecondaryPanelFileTabInState({ ...request, state }),
    );
  }),
);

const updateBrowserTabFamily = atomFamily((panelStateId: string) =>
  atom(null, (_get, set, args: UpdateBrowserTabArgs) => {
    set(updateTabsFamily(panelStateId), (state) => {
      const tab = findSecondaryPanelTab(state.secondary.tabs, args.tabId);
      if (!tab || !isBrowserTab(tab)) {
        return state;
      }
      return updateSecondaryPanelTabInState({
        state,
        tab: {
          ...tab,
          title: args.title,
          url: args.url,
        },
      });
    });
  }),
);

const clearActiveFileTabsFamily = atomFamily((panelStateId: string) =>
  atom(null, (_get, set) => {
    set(updateTabsFamily(panelStateId), clearActiveSecondaryFileTabInState);
  }),
);

const setActiveTerminalFamily = atomFamily((panelStateId: string) =>
  atom(null, (_get, set, terminalId: string | null) => {
    set(updateTabsFamily(panelStateId), (state) =>
      setFixedRightTerminalActiveTerminalState(state, terminalId),
    );
  }),
);

const removeTerminalTabFamily = atomFamily((panelStateId: string) =>
  atom(null, (_get, set, terminalId: string) => {
    set(updateTabsFamily(panelStateId), (state) =>
      removeFixedRightTerminalTabState(state, terminalId),
    );
  }),
);

const activateTerminalTabFamily = atomFamily((panelStateId: string) =>
  atom(null, (_get, set, terminalId: string) => {
    set(terminalAutoFocusFamily(panelStateId), true);
    set(setActiveTerminalFamily(panelStateId), terminalId);
    set(openCompactDrawerFamily(panelStateId));
  }),
);

export function getTouchFixedPanelTabsAtom(panelStateId: string) {
  return touchTabsFamily(panelStateId);
}

export function getOpenSecondaryPanelTabAtom(panelStateId: string) {
  return openTabFamily(panelStateId);
}

export function getOpenCompactDrawerAtom(panelStateId: string) {
  return openCompactDrawerFamily(panelStateId);
}

export function getCloseSecondaryPanelAtom(panelStateId: string) {
  return closePanelFamily(panelStateId);
}

export function getOpenSecondaryPanelNewTabAtom(panelStateId: string) {
  return openNewTabFamily(panelStateId);
}

export function getToggleSecondaryPanelAtom(panelStateId: string) {
  return toggleFamily(panelStateId);
}

export function getChangeSecondaryPanelAtom(panelStateId: string) {
  return changePanelFamily(panelStateId);
}

export function getSetPersistedSecondaryPanelAtom(panelStateId: string) {
  return setPersistedPanelFamily(panelStateId);
}

export function getOpenWorkspaceFileAtom(panelStateId: string) {
  return openWorkspaceFileFamily(panelStateId);
}

export function getOpenStorageFileAtom(panelStateId: string) {
  return openStorageFileFamily(panelStateId);
}

export function getOpenHostFileAtom(panelStateId: string) {
  return openHostFileFamily(panelStateId);
}

export function getOpenBrowserTabAndRevealAtom(panelStateId: string) {
  return openBrowserTabAndRevealFamily(panelStateId);
}

export function getOpenPluginPanelAtom(panelStateId: string) {
  return openPluginPanelFamily(panelStateId);
}

export function getSelectFileSearchResultAtom(panelStateId: string) {
  return selectFileSearchResultFamily(panelStateId);
}

export function getActivateSecondaryFileTabAtom(panelStateId: string) {
  return activateFileTabFamily(panelStateId);
}

export function getCloseSecondaryFileTabAtom(panelStateId: string) {
  return closeTabFamily(panelStateId);
}

export function getReorderSecondaryFileTabAtom(panelStateId: string) {
  return reorderFileTabFamily(panelStateId);
}

export function getUpdateSecondaryBrowserTabAtom(panelStateId: string) {
  return updateBrowserTabFamily(panelStateId);
}

export function getClearActiveSecondaryFileTabsAtom(panelStateId: string) {
  return clearActiveFileTabsFamily(panelStateId);
}

export function getSetActiveSecondaryTerminalAtom(panelStateId: string) {
  return setActiveTerminalFamily(panelStateId);
}

export function getRemoveSecondaryTerminalTabAtom(panelStateId: string) {
  return removeTerminalTabFamily(panelStateId);
}

export function getActivateSecondaryTerminalTabAtom(panelStateId: string) {
  return activateTerminalTabFamily(panelStateId);
}

// ---------------------------------------------------------------------------
// Point-of-use hooks
// ---------------------------------------------------------------------------

/** Drawer visibility on compact viewports, persisted deck state otherwise. */
export function useIsSecondaryPanelOpen(panelStateId: string): boolean {
  return useAtomValue(isOpenFamily(panelStateId));
}

/**
 * Resolves prompt mention links (threads, projects, files) against this
 * session's navigation config and file-open atoms. Identity follows the
 * synced config, so consumers re-resolve when e.g. an environment appears.
 */
export function useSecondaryPanelMentionLinkResolver(
  panelStateId: string,
): PromptMentionLinkResolver {
  const store = useStore();
  const config = useAtomValue(configFamily(panelStateId));
  return useCallback<PromptMentionLinkResolver>(
    (resource) => {
      if (config === null) return null;
      const navigation = config.navigation;
      if (resource.kind === "thread") {
        const targetProjectId =
          resource.projectId ?? navigation.defaultProjectId;
        if (targetProjectId === null) return null;
        return () =>
          navigation.openThread({
            projectId: targetProjectId,
            threadId: resource.threadId,
          });
      }
      if (resource.kind === "project") {
        return () => navigation.openProject(resource.projectId);
      }
      if (resource.kind !== "path" || resource.entryKind !== "file") {
        return null;
      }
      if (resource.source === "thread-storage") {
        if (!navigation.canOpenStorageFiles) return null;
        return () =>
          store.set(openStorageFileFamily(panelStateId), {
            lineRange: null,
            path: resource.path,
          });
      }
      if (!navigation.canOpenWorkspaceFiles) return null;
      return () =>
        store.set(openWorkspaceFileFamily(panelStateId), {
          lineRange: null,
          path: resource.path,
          source: { kind: "working-tree" },
          statusLabel: null,
        });
    },
    [config, panelStateId, store],
  );
}

export interface SecondaryPanelUrlOpener {
  /** Markdown/terminal link handler: consume in-app-browser links only. */
  handlePanelLink: MarkdownPreviewLinkHandler;
  /** Route a URL to the in-app browser or the external browser. */
  openUrlByPreference: (url: string) => boolean;
}

export function useSecondaryPanelUrlOpener(
  panelStateId: string,
): SecondaryPanelUrlOpener {
  const store = useStore();
  const [openLinksInAppBrowser] = useOpenLinksInAppBrowserPreference();
  const desktopBrowserAvailable = isDesktopBrowserAvailable();
  const openBrowserTabAndReveal = useSetAtom(
    openBrowserTabAndRevealFamily(panelStateId),
  );
  const handleOpenUrlByPreference = useCallback(
    (url: string) =>
      openUrlByPreference({
        desktopBrowserAvailable,
        openExternalBrowser: openUrlInExternalBrowser,
        openInAppBrowser: openBrowserTabAndReveal,
        openLinksInAppBrowser,
        url,
      }),
    [desktopBrowserAvailable, openBrowserTabAndReveal, openLinksInAppBrowser],
  );
  const handlePanelLink = useCallback<MarkdownPreviewLinkHandler>(
    ({ href }) => {
      const threadId =
        store.get(configFamily(panelStateId))?.threadId ?? null;
      if (
        threadId === null ||
        resolveUrlOpenTarget({
          desktopBrowserAvailable,
          openLinksInAppBrowser,
          url: href,
        }) !== "in-app-browser"
      ) {
        return false;
      }
      openBrowserTabAndReveal(href);
      return true;
    },
    [
      desktopBrowserAvailable,
      openBrowserTabAndReveal,
      openLinksInAppBrowser,
      panelStateId,
      store,
    ],
  );
  return { handlePanelLink, openUrlByPreference: handleOpenUrlByPreference };
}

// ---------------------------------------------------------------------------
// Session lifetime + effects
// ---------------------------------------------------------------------------

const sessionRetainCounts = new Map<string, number>();

function evictSecondaryPanelSession(panelStateId: string): void {
  configFamily.remove(panelStateId);
  newTabAutoFocusFamily.remove(panelStateId);
  terminalAutoFocusFamily.remove(panelStateId);
  persistedOpenFamily.remove(panelStateId);
  isOpenFamily.remove(panelStateId);
  activeFixedSecondaryTabFamily.remove(panelStateId);
  orderedSecondaryFileTabsFamily.remove(panelStateId);
  browserTabsFamily.remove(panelStateId);
  activeFileTabsFamily.remove(panelStateId);
  updateTabsFamily.remove(panelStateId);
  touchTabsFamily.remove(panelStateId);
  openTabFamily.remove(panelStateId);
  openCompactDrawerFamily.remove(panelStateId);
  closePanelFamily.remove(panelStateId);
  openNewTabFamily.remove(panelStateId);
  toggleFamily.remove(panelStateId);
  openPanelFamily.remove(panelStateId);
  changePanelFamily.remove(panelStateId);
  setPersistedPanelFamily.remove(panelStateId);
  openWorkspaceFileFamily.remove(panelStateId);
  openStorageFileFamily.remove(panelStateId);
  openHostFileFamily.remove(panelStateId);
  openBrowserTabAndRevealFamily.remove(panelStateId);
  openPluginPanelFamily.remove(panelStateId);
  selectFileSearchResultFamily.remove(panelStateId);
  activateFileTabFamily.remove(panelStateId);
  closeTabFamily.remove(panelStateId);
  reorderFileTabFamily.remove(panelStateId);
  updateBrowserTabFamily.remove(panelStateId);
  clearActiveFileTabsFamily.remove(panelStateId);
  setActiveTerminalFamily.remove(panelStateId);
  removeTerminalTabFamily.remove(panelStateId);
  activateTerminalTabFamily.remove(panelStateId);
  lastTabsTouchByPanelStateId.delete(panelStateId);
  // Storage-backed families owned by other modules: safe to drop, a later
  // access recreates them from localStorage with identical contents.
  removeFixedPanelTabsStateAtom(panelStateId);
  removeThreadRecentItemsAtom(panelStateId);
  removeThreadConversationCollapsedAtom(panelStateId);
}

/**
 * Refcounted retention: a session's atomFamily members are dropped when the
 * last mounted `SecondaryPanel` for the id releases it, so hundreds of thread
 * visits in one app session don't accumulate memoized atoms. Refcounted (not
 * plain unmount cleanup) because split panes can host the same thread twice.
 */
function retainSecondaryPanelSession(panelStateId: string): () => void {
  sessionRetainCounts.set(
    panelStateId,
    (sessionRetainCounts.get(panelStateId) ?? 0) + 1,
  );
  return () => {
    const next = (sessionRetainCounts.get(panelStateId) ?? 1) - 1;
    if (next > 0) {
      sessionRetainCounts.set(panelStateId, next);
      return;
    }
    sessionRetainCounts.delete(panelStateId);
    evictSecondaryPanelSession(panelStateId);
  };
}

function areConfigsEqual(
  left: SecondaryPanelSessionConfig,
  right: SecondaryPanelSessionConfig,
): boolean {
  return (
    left.canCreateTerminal === right.canCreateTerminal &&
    left.environmentId === right.environmentId &&
    left.fileOwnerThreadId === right.fileOwnerThreadId &&
    left.navigation === right.navigation &&
    left.projectId === right.projectId &&
    left.syncThreadId === right.syncThreadId &&
    left.terminalTarget === right.terminalTarget &&
    left.threadId === right.threadId &&
    left.variant === right.variant
  );
}

export interface SecondaryPanelSessionArgs extends SecondaryPanelSessionConfig {
  panelStateId: string;
  /** Retained terminal tab id (active while the panel is open). */
  retainedTerminalId: string | null;
  storageFiles: readonly SecondaryPanelStorageFile[] | undefined;
  /** Loaded terminal sessions; undefined until the list query resolves. */
  terminalSessions: readonly TerminalSession[] | undefined;
}

/**
 * Owns one panel session's non-render responsibilities: config publication,
 * localStorage maintenance, server tab-deck sync, tab normalization/pruning,
 * terminal tab reconciliation, the root-compose auto "New tab", and session
 * retention. Rendered once per mounted `SecondaryPanel`.
 */
export function useSecondaryPanelSessionEffects({
  panelStateId,
  retainedTerminalId,
  storageFiles,
  terminalSessions,
  ...config
}: SecondaryPanelSessionArgs): void {
  const store = useStore();
  const queryClient = useQueryClient();
  const {
    environmentId,
    fileOwnerThreadId,
    syncThreadId,
    variant,
  } = config;

  useFixedPanelTabsStorageMaintenance(panelStateId);

  // Keep the file-opener preference atom mounted while a session is live:
  // atomWithStorage only re-reads localStorage on mount, and the open-tab
  // write atom reads it without subscribing.
  useAtomValue(fileOpenerPreferenceAtom);

  useEffect(() => {
    sessionQueryClient = queryClient;
  }, [queryClient]);

  useEffect(
    () => retainSecondaryPanelSession(panelStateId),
    [panelStateId],
  );

  // Publish the session config before paint so point-of-use consumers (write
  // atoms, mention resolvers, derived tab reads) see the current context in
  // the same committed frame.
  const {
    canCreateTerminal,
    navigation,
    projectId,
    terminalTarget,
    threadId,
  } = config;
  useLayoutEffect(() => {
    const configAtom = configFamily(panelStateId);
    const next: SecondaryPanelSessionConfig = {
      canCreateTerminal,
      environmentId,
      fileOwnerThreadId,
      navigation,
      projectId,
      syncThreadId,
      terminalTarget,
      threadId,
      variant,
    };
    const current = store.get(configAtom);
    if (current !== null && areConfigsEqual(current, next)) {
      return;
    }
    store.set(configAtom, next);
  });

  // The compact drawer is per-mount state: leaving the surface (or leaving the
  // compact viewport) closes it, exactly like the previous React state.
  const isCompactViewport = useAtomValue(isCompactViewportAtom);
  useEffect(() => {
    if (isCompactViewport) return;
    store.set(compactDrawerPanelStateIdAtom, (current) =>
      current === panelStateId ? null : current,
    );
  }, [isCompactViewport, panelStateId, store]);
  useEffect(
    () => () => {
      store.set(compactDrawerPanelStateIdAtom, (current) =>
        current === panelStateId ? null : current,
      );
    },
    [panelStateId, store],
  );

  // Server tab-deck sync: reconcile straight into the state atom (not the
  // update write atom) so a server echo never re-touches lastUsedAt or
  // re-persists what the server just sent.
  const tabsQuery = useThreadTabs(syncThreadId ?? "", {
    enabled: syncThreadId !== null,
  });
  const stateAtom = getFixedPanelTabsStateAtom(panelStateId);
  const localTabs = useAtomValue(stateAtom).secondary.tabs;
  const serverTabs = tabsQuery.data;
  useEffect(() => {
    if (syncThreadId === null || serverTabs === undefined) {
      return;
    }
    if (hasPendingThreadTabsWrite(queryClient, syncThreadId)) {
      return;
    }
    if (serverTabs.revision === 0 && localTabs.length > 0) {
      scheduleLocalThreadTabsMigration({
        queryClient,
        tabs: localTabs,
        threadId: syncThreadId,
      });
      return;
    }
    store.set(stateAtom, (current) =>
      reconcileFixedPanelTabsState(current, serverTabs.tabs),
    );
  }, [localTabs, queryClient, serverTabs, stateAtom, store, syncThreadId]);

  const updateTabs = useSetAtom(updateTabsFamily(panelStateId));

  // Rebind legacy owner-less file tabs to the session's file-owner thread.
  useEffect(() => {
    if (!fileOwnerThreadId) return;
    updateTabs((state) => {
      let didChange = false;
      const tabIdMap = new Map<string, string>();
      const seenTabIds = new Set<string>();
      const tabs: FixedPanelTab[] = [];
      for (const tab of state.secondary.tabs) {
        let nextTab = tab;
        if (
          tab.kind === "host-file-preview" &&
          tab.threadId === null &&
          environmentId
        ) {
          nextTab = createHostFilePreviewFixedPanelTab({
            environmentId,
            tab: {
              lineRange: tab.lineRange,
              path: tab.path,
            },
            threadId: fileOwnerThreadId,
          });
          didChange = true;
          tabIdMap.set(tab.id, nextTab.id);
        } else if (
          tab.kind === "thread-storage-file-preview" &&
          tab.threadId === null
        ) {
          nextTab = createThreadStorageFilePreviewFixedPanelTab({
            environmentId: tab.environmentId ?? environmentId ?? null,
            isPinned: tab.isPinned,
            tab: {
              lineRange: tab.lineRange,
              path: tab.path,
            },
            threadId: fileOwnerThreadId,
          });
          didChange = true;
          tabIdMap.set(tab.id, nextTab.id);
        }
        if (seenTabIds.has(nextTab.id)) {
          didChange = true;
          tabIdMap.set(tab.id, nextTab.id);
          continue;
        }
        seenTabIds.add(nextTab.id);
        tabs.push(nextTab);
      }
      if (!didChange) return state;
      const activeTabId =
        state.secondary.activeTabId === null
          ? null
          : (tabIdMap.get(state.secondary.activeTabId) ??
            state.secondary.activeTabId);
      return setSecondaryPanelTabsInState({
        activeTabId,
        isOpen: state.secondary.isOpen,
        state,
        tabs,
      });
    });
  }, [environmentId, fileOwnerThreadId, updateTabs]);

  // Thread detail's workspace tabs are environment-scoped; root compose spans
  // project/environment contexts in one persisted deck and keeps them all.
  useEffect(() => {
    if (variant === "root-compose") return;
    if (environmentId === undefined) return;
    updateTabs((state) => {
      const tabs = removeWorkspaceTabsForOtherEnvironments(
        state.secondary.tabs,
        environmentId,
      );
      return setSecondaryPanelTabsInState({
        activeTabId: getActiveTabIdAfterPrune(
          tabs,
          state.secondary.activeTabId,
        ),
        isOpen: state.secondary.isOpen,
        state,
        tabs: tabs === state.secondary.tabs ? state.secondary.tabs : tabs,
      });
    });
  }, [environmentId, updateTabs, variant]);

  // Drop storage tabs whose file no longer exists in the thread's storage.
  useEffect(() => {
    if (!storageFiles) return;
    updateTabs((state) => {
      const knownPaths = new Set(storageFiles.map((file) => file.path));
      const tabs = pruneStorageTabs({
        knownPaths,
        tabs: state.secondary.tabs,
        threadId: fileOwnerThreadId,
      });
      return setSecondaryPanelTabsInState({
        activeTabId: getActiveTabIdAfterPrune(
          tabs,
          state.secondary.activeTabId,
        ),
        isOpen: state.secondary.isOpen,
        state,
        tabs: tabs === state.secondary.tabs ? state.secondary.tabs : tabs,
      });
    });
  }, [fileOwnerThreadId, storageFiles, updateTabs]);

  // Drop terminal tabs whose session is gone (unless retained), then mirror
  // live sessions into the deck.
  useEffect(() => {
    if (terminalSessions === undefined) return;
    updateTabs((state) => {
      const tabs = pruneTerminalTabsForSessions({
        retainedTerminalId,
        tabs: state.secondary.tabs,
        terminalSessions,
      });
      return setSecondaryPanelTabsInState({
        activeTabId: getActiveTabIdAfterPrune(
          tabs,
          state.secondary.activeTabId,
        ),
        isOpen: state.secondary.isOpen,
        state,
        tabs: tabs === state.secondary.tabs ? state.secondary.tabs : tabs,
      });
    });
  }, [retainedTerminalId, terminalSessions, updateTabs]);

  useEffect(() => {
    if (terminalSessions === undefined) return;
    updateTabs((state) =>
      syncTerminalTabsInFixedPanelState({
        retainedTerminalId,
        state,
        terminalSessions,
      }),
    );
  }, [retainedTerminalId, terminalSessions, updateTabs]);

  // Root compose recreates an empty open panel with a placeholder "New tab".
  const isOpen = useAtomValue(isOpenFamily(panelStateId));
  const activeFixedSecondaryTab = useAtomValue(
    activeFixedSecondaryTabFamily(panelStateId),
  );
  const openTab = useSetAtom(openTabFamily(panelStateId));
  useEffect(() => {
    if (variant !== "root-compose" || !isOpen) return;
    if (
      activeFixedSecondaryTab !== null &&
      activeFixedSecondaryTab.kind !== "thread-info" &&
      activeFixedSecondaryTab.kind !== "git-diff"
    ) {
      return;
    }
    openTab({ kind: "new-tab" });
  }, [activeFixedSecondaryTab, isOpen, openTab, variant]);
}
