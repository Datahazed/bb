// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getDefaultStore } from "jotai";
import { useAtomValue, useSetAtom } from "jotai";
import type { TerminalSession } from "@bb/server-contract";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createBrowserFixedPanelTab,
  createEmptyFixedPanelTabsState,
  createHostFilePreviewFixedPanelTab,
  createTerminalFixedPanelTab,
  createThreadStorageFilePreviewFixedPanelTab,
  getFixedPanelTabsStateStorageKey,
  serializeFixedPanelTabsState,
  FIXED_PANEL_TABS_STATE_STORAGE_VERSION,
} from "@/lib/fixed-panel-tabs-state";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import {
  getOpenPluginPanelAtom,
  getOpenSecondaryPanelTabAtom,
  getOrderedSecondaryFileTabsAtom,
  getSecondaryPanelActiveFileTabsAtom,
  getToggleSecondaryPanelAtom,
  isCompactViewportAtom,
  useIsSecondaryPanelOpen,
  useSecondaryPanelSessionEffects,
  type SecondaryPanelNavigation,
  type SecondaryPanelStorageFile,
  type SecondaryPanelVariant,
} from "./secondaryPanelSession";

const syncMocks = vi.hoisted(() => ({
  scheduleLocalThreadTabsMigration: vi.fn(),
  scheduleThreadTabsPersistence: vi.fn(),
  useThreadTabs: vi.fn(() => ({ data: undefined })),
}));

vi.mock("@/hooks/queries/thread-tabs-query", () => ({
  useThreadTabs: syncMocks.useThreadTabs,
}));

vi.mock("@/lib/thread-tabs-sync", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/thread-tabs-sync")>();
  return {
    ...actual,
    hasPendingThreadTabsWrite: () => false,
    scheduleLocalThreadTabsMigration:
      syncMocks.scheduleLocalThreadTabsMigration,
    scheduleThreadTabsPersistence: syncMocks.scheduleThreadTabsPersistence,
  };
});

type TerminalSessionOverrides = Partial<TerminalSession>;

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

const TEST_NAVIGATION: SecondaryPanelNavigation = {
  canOpenStorageFiles: true,
  canOpenWorkspaceFiles: true,
  defaultProjectId: null,
  openProject: () => undefined,
  openThread: () => undefined,
};

interface SessionHarnessArgs {
  environmentId: string | null | undefined;
  fileOwnerThreadId?: string | null;
  panelStateId: string;
  projectId?: string | null;
  retainedTerminalId?: string | null;
  storageFiles: readonly SecondaryPanelStorageFile[] | undefined;
  syncThreadId: string | null;
  terminalSessions: readonly TerminalSession[] | undefined;
  variant?: SecondaryPanelVariant;
}

function useSessionHarness(args: SessionHarnessArgs) {
  useSecondaryPanelSessionEffects({
    canCreateTerminal: false,
    environmentId: args.environmentId,
    fileOwnerThreadId:
      args.fileOwnerThreadId !== undefined
        ? args.fileOwnerThreadId
        : (args.syncThreadId ?? null),
    navigation: TEST_NAVIGATION,
    panelStateId: args.panelStateId,
    projectId: args.projectId ?? null,
    retainedTerminalId: args.retainedTerminalId ?? null,
    storageFiles: args.storageFiles,
    syncThreadId: args.syncThreadId,
    terminalSessions: args.terminalSessions,
    terminalTarget: null,
    threadId: null,
    variant: args.variant ?? "thread",
  });
  const active = useAtomValue(
    getSecondaryPanelActiveFileTabsAtom(args.panelStateId),
  );
  const orderedSecondaryFileTabs = useAtomValue(
    getOrderedSecondaryFileTabsAtom(args.panelStateId),
  );
  const openTab = useSetAtom(getOpenSecondaryPanelTabAtom(args.panelStateId));
  const openPluginPanel = useSetAtom(
    getOpenPluginPanelAtom(args.panelStateId),
  );
  const isOpen = useIsSecondaryPanelOpen(args.panelStateId);
  const toggle = useSetAtom(getToggleSecondaryPanelAtom(args.panelStateId));
  return {
    ...active,
    isOpen,
    openPluginPanel,
    openTab,
    orderedSecondaryFileTabs,
    toggle,
  };
}

function QueryWrapper({ children }: { children: ReactNode }) {
  return createElement(QueryClientProvider, { client: queryClient }, children);
}

function renderSessionHook(args: SessionHarnessArgs) {
  return renderHook(() => useSessionHarness(args), { wrapper: QueryWrapper });
}

function terminalSession(overrides: TerminalSessionOverrides): TerminalSession {
  return {
    id: "term_1",
    threadId: "thr_1",
    environmentId: "env_1",
    hostId: "host_1",
    title: "Terminal",
    initialCwd: "/workspace",
    cols: 100,
    rows: 30,
    status: "running",
    exitCode: null,
    closeReason: null,
    createdAt: 1,
    updatedAt: 1,
    lastUserInputAt: null,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  queryClient.clear();
  window.localStorage.clear();
  resetPluginSlotStoreForTest();
  getDefaultStore().set(isCompactViewportAtom, false);
  syncMocks.scheduleLocalThreadTabsMigration.mockClear();
  syncMocks.scheduleThreadTabsPersistence.mockClear();
  syncMocks.useThreadTabs.mockClear();
});

describe("secondary panel session terminal pruning", () => {
  it("keeps root-compose file tabs local", () => {
    const { result } = renderSessionHook({
      panelStateId: "root-compose",
      syncThreadId: null,
      environmentId: "env_root",
      variant: "root-compose",
      storageFiles: undefined,
      terminalSessions: undefined,
    });

    act(() => {
      result.current.openTab({ kind: "new-tab" });
    });

    expect(syncMocks.useThreadTabs).toHaveBeenCalledWith("", {
      enabled: false,
    });
    expect(syncMocks.scheduleLocalThreadTabsMigration).not.toHaveBeenCalled();
    expect(syncMocks.scheduleThreadTabsPersistence).not.toHaveBeenCalled();
  });

  it("drops disconnected terminal tabs when not retained", async () => {
    const threadId = "terminal-prune-unretained";
    const disconnectedTab = createTerminalFixedPanelTab({
      terminalId: "term_disconnected",
    });
    const runningTab = createTerminalFixedPanelTab({
      terminalId: "term_running",
    });
    const state = createEmptyFixedPanelTabsState({
      secondary: {
        activeTabId: runningTab.id,
        isOpen: true,
        tabs: [disconnectedTab, runningTab],
      },
      lastUsedAt: Date.now(),
    });
    window.localStorage.setItem(
      getFixedPanelTabsStateStorageKey({ threadId }),
      serializeFixedPanelTabsState({ state }),
    );

    const { result } = renderSessionHook({
      panelStateId: threadId,
      syncThreadId: threadId,
      environmentId: "env_current",
      storageFiles: undefined,
      terminalSessions: [
        terminalSession({
          id: "term_disconnected",
          status: "disconnected",
        }),
        terminalSession({ id: "term_running" }),
      ],
    });

    await waitFor(() => {
      expect(
        result.current.orderedSecondaryFileTabs.map((tab) => tab.id),
      ).toEqual([runningTab.id]);
    });
  });

  it("keeps a retained disconnected terminal tab", async () => {
    const threadId = "terminal-prune-retained";
    const disconnectedTab = createTerminalFixedPanelTab({
      terminalId: "term_disconnected",
    });
    const runningTab = createTerminalFixedPanelTab({
      terminalId: "term_running",
    });
    window.localStorage.setItem(
      getFixedPanelTabsStateStorageKey({ threadId }),
      serializeFixedPanelTabsState({
        state: createEmptyFixedPanelTabsState({
          secondary: {
            activeTabId: disconnectedTab.id,
            isOpen: true,
            tabs: [disconnectedTab, runningTab],
          },
          lastUsedAt: Date.now(),
        }),
      }),
    );

    const { result } = renderSessionHook({
      panelStateId: threadId,
      syncThreadId: threadId,
      environmentId: "env_current",
      retainedTerminalId: "term_disconnected",
      storageFiles: undefined,
      terminalSessions: [
        terminalSession({
          id: "term_disconnected",
          status: "disconnected",
        }),
        terminalSession({ id: "term_running" }),
      ],
    });

    await waitFor(() => {
      expect(
        result.current.orderedSecondaryFileTabs.map((tab) => tab.id),
      ).toEqual([disconnectedTab.id, runningTab.id]);
    });
  });
});

describe("secondary panel session active owners", () => {
  it("returns owner ids for an active restored host file tab", () => {
    const threadId = "root-compose-ownerful";
    const hostTab = createHostFilePreviewFixedPanelTab({
      environmentId: "env_file",
      tab: {
        lineRange: null,
        path: "/tmp/log.txt",
      },
      threadId: "thr_file",
    });
    const state = createEmptyFixedPanelTabsState({
      secondary: {
        activeTabId: hostTab.id,
        isOpen: true,
        tabs: [hostTab],
      },
      lastUsedAt: Date.now(),
    });
    window.localStorage.setItem(
      getFixedPanelTabsStateStorageKey({ threadId }),
      serializeFixedPanelTabsState({ state }),
    );

    const { result } = renderSessionHook({
      panelStateId: threadId,
      syncThreadId: threadId,
      environmentId: "env_current",
      fileOwnerThreadId: "thr_current",
      variant: "root-compose",
      storageFiles: undefined,
      terminalSessions: undefined,
    });

    expect(result.current.activeHostFilePath).toBe("/tmp/log.txt");
    expect(result.current.activeHostFileThreadId).toBe("thr_file");
    expect(result.current.activeHostFileEnvironmentId).toBe("env_file");
  });

  it("backfills owner ids for an active legacy storage file tab", async () => {
    const threadId = "root-compose-legacy-storage";
    const legacyStorageTab = {
      id: "thread-storage-file-preview:artifact.txt:none",
      isPinned: false,
      kind: "thread-storage-file-preview",
      lineRange: null,
      path: "artifact.txt",
    };
    window.localStorage.setItem(
      getFixedPanelTabsStateStorageKey({ threadId }),
      JSON.stringify({
        version: FIXED_PANEL_TABS_STATE_STORAGE_VERSION,
        secondary: {
          activeTabId: legacyStorageTab.id,
          isOpen: true,
          tabs: [legacyStorageTab],
        },
        lastUsedAt: Date.now(),
      }),
    );

    const { result } = renderSessionHook({
      panelStateId: threadId,
      syncThreadId: threadId,
      environmentId: "env_root",
      fileOwnerThreadId: "thr_root",
      variant: "root-compose",
      storageFiles: undefined,
      terminalSessions: undefined,
    });

    await waitFor(() => {
      expect(result.current.activeStorageFilePath).toBe("artifact.txt");
      expect(result.current.activeStorageFileThreadId).toBe("thr_root");
      expect(result.current.activeStorageFileEnvironmentId).toBe("env_root");
    });
  });

  it("returns owner ids for an active restored storage file tab", () => {
    const threadId = "root-compose-ownerful-storage";
    const storageTab = createThreadStorageFilePreviewFixedPanelTab({
      environmentId: "env_file",
      isPinned: false,
      tab: {
        lineRange: null,
        path: "artifact.txt",
      },
      threadId: "thr_file",
    });
    const state = createEmptyFixedPanelTabsState({
      secondary: {
        activeTabId: storageTab.id,
        isOpen: true,
        tabs: [storageTab],
      },
      lastUsedAt: Date.now(),
    });
    window.localStorage.setItem(
      getFixedPanelTabsStateStorageKey({ threadId }),
      serializeFixedPanelTabsState({ state }),
    );

    const { result } = renderSessionHook({
      panelStateId: threadId,
      syncThreadId: threadId,
      environmentId: "env_current",
      fileOwnerThreadId: "thr_current",
      variant: "root-compose",
      storageFiles: undefined,
      terminalSessions: undefined,
    });

    expect(result.current.activeStorageFilePath).toBe("artifact.txt");
    expect(result.current.activeStorageFileThreadId).toBe("thr_file");
    expect(result.current.activeStorageFileEnvironmentId).toBe("env_file");
  });
});

describe("secondary panel session plugin panel tabs", () => {
  it("opens, focuses identical re-opens (title refreshed), and opens siblings for new params", () => {
    const threadId = "plugin-panel-open";
    const { result } = renderSessionHook({
      panelStateId: threadId,
      syncThreadId: threadId,
      environmentId: "env_1",
      storageFiles: undefined,
      terminalSessions: undefined,
    });

    act(() =>
      result.current.openPluginPanel({
        pluginId: "demo",
        actionId: "issue",
        title: "Issue #1",
        paramsJson: '{"n":1}',
      }),
    );
    expect(result.current.orderedSecondaryFileTabs).toHaveLength(1);
    const firstTab = result.current.activePluginPanelTab;
    expect(firstTab).toMatchObject({
      kind: "plugin-panel",
      pluginId: "demo",
      actionId: "issue",
      title: "Issue #1",
      paramsJson: '{"n":1}',
    });

    // Identical params: no new tab, but the title refreshes.
    act(() =>
      result.current.openPluginPanel({
        pluginId: "demo",
        actionId: "issue",
        title: "Issue #1 (renamed)",
        paramsJson: '{"n":1}',
      }),
    );
    expect(result.current.orderedSecondaryFileTabs).toHaveLength(1);
    expect(result.current.activePluginPanelTab?.id).toBe(firstTab?.id);
    expect(result.current.activePluginPanelTab?.title).toBe(
      "Issue #1 (renamed)",
    );

    // Different params: a sibling tab opens and becomes active.
    act(() =>
      result.current.openPluginPanel({
        pluginId: "demo",
        actionId: "issue",
        title: "Issue #2",
        paramsJson: '{"n":2}',
      }),
    );
    expect(result.current.orderedSecondaryFileTabs).toHaveLength(2);
    expect(result.current.activePluginPanelTab?.paramsJson).toBe('{"n":2}');
  });

  it("replaces a transient new-tab like the other launchers", () => {
    const threadId = "plugin-panel-replace-new-tab";
    const { result } = renderSessionHook({
      panelStateId: threadId,
      syncThreadId: threadId,
      environmentId: "env_1",
      storageFiles: undefined,
      terminalSessions: undefined,
    });
    act(() => {
      result.current.openTab({ kind: "new-tab" });
    });
    expect(result.current.isNewTabActive).toBe(true);
    act(() =>
      result.current.openPluginPanel({
        pluginId: "demo",
        actionId: "issue",
        title: "Issue",
        paramsJson: null,
      }),
    );
    expect(result.current.isNewTabActive).toBe(false);
    expect(
      result.current.orderedSecondaryFileTabs.map((tab) => tab.kind),
    ).toEqual(["plugin-panel"]);
  });
});

describe("secondary panel session file opener diversion", () => {
  function NotesEditor() {
    return null;
  }

  function registerNotesOpener() {
    setPluginSlotRegistrations("notes", {
      homepageSections: [],
      settingsSections: [],
      navPanels: [],
      threadPanelActions: [],
      sidebarFooterActions: [],
      fileOpeners: [
        {
          id: "editor",
          title: "Notes editor",
          extensions: ["md"],
          component: NotesEditor,
        },
      ],
      messageDirectives: [],
    });
  }

  function setDefaultOpener() {
    window.localStorage.setItem(
      "bb.fileOpenerByExtension",
      JSON.stringify({ md: "notes:editor" }),
    );
  }

  it("diverts working-tree markdown opens to the preferred opener tab", () => {
    registerNotesOpener();
    setDefaultOpener();
    const { result } = renderSessionHook({
      panelStateId: "opener-divert",
      syncThreadId: "opener-divert",
      environmentId: "env_1",
      storageFiles: undefined,
      terminalSessions: undefined,
    });

    act(() => {
      result.current.openTab({
        kind: "workspace-file-preview",
        tab: {
          lineRange: null,
          path: "notes/todo.md",
          source: { kind: "working-tree" },
          statusLabel: null,
        },
      });
    });

    expect(result.current.activePluginPanelTab).toMatchObject({
      kind: "plugin-panel",
      pluginId: "notes",
      actionId: "file-opener:editor",
      title: "todo.md",
    });
    const params = JSON.parse(
      result.current.activePluginPanelTab?.paramsJson ?? "null",
    ) as {
      path: string;
      source: { kind: string; environmentId: string | null };
    };
    expect(params.path).toBe("notes/todo.md");
    expect(params.source).toMatchObject({
      kind: "workspace",
      environmentId: "env_1",
    });
  });

  it("keeps the built-in preview for ref snapshots and unmatched extensions", () => {
    registerNotesOpener();
    setDefaultOpener();
    const { result } = renderSessionHook({
      panelStateId: "opener-skip",
      syncThreadId: "opener-skip",
      environmentId: "env_1",
      storageFiles: undefined,
      terminalSessions: undefined,
    });

    // A git-ref snapshot never diverts, even for a matching extension.
    act(() => {
      result.current.openTab({
        kind: "workspace-file-preview",
        tab: {
          lineRange: null,
          path: "notes/todo.md",
          source: { kind: "head" },
          statusLabel: null,
        },
      });
    });
    expect(result.current.activePluginPanelTab).toBeNull();
    expect(result.current.activeWorkspaceFilePath).toBe("notes/todo.md");

    // Unmatched extension stays built-in too.
    act(() => {
      result.current.openTab({
        kind: "workspace-file-preview",
        tab: {
          lineRange: null,
          path: "src/index.ts",
          source: { kind: "working-tree" },
          statusLabel: null,
        },
      });
    });
    expect(result.current.activePluginPanelTab).toBeNull();
    expect(result.current.activeWorkspaceFilePath).toBe("src/index.ts");
  });

  it("falls back to the built-in preview when the preferred opener is gone", () => {
    // Preference points at an opener that is not registered (plugin removed).
    setDefaultOpener();
    const { result } = renderSessionHook({
      panelStateId: "opener-gone",
      syncThreadId: "opener-gone",
      environmentId: "env_1",
      storageFiles: undefined,
      terminalSessions: undefined,
    });

    act(() => {
      result.current.openTab({
        kind: "workspace-file-preview",
        tab: {
          lineRange: null,
          path: "notes/todo.md",
          source: { kind: "working-tree" },
          statusLabel: null,
        },
      });
    });
    expect(result.current.activePluginPanelTab).toBeNull();
    expect(result.current.activeWorkspaceFilePath).toBe("notes/todo.md");
  });

  it("honors per-open viewer overrides in both directions", () => {
    registerNotesOpener();
    setDefaultOpener();
    const { result } = renderSessionHook({
      panelStateId: "opener-override",
      syncThreadId: "opener-override",
      environmentId: "env_1",
      storageFiles: undefined,
      terminalSessions: undefined,
    });

    // "builtin" override skips the opener default entirely.
    act(() => {
      result.current.openTab(
        {
          kind: "workspace-file-preview",
          tab: {
            lineRange: null,
            path: "notes/todo.md",
            source: { kind: "working-tree" },
            statusLabel: null,
          },
        },
        { viewer: "builtin" },
      );
    });
    expect(result.current.activePluginPanelTab).toBeNull();
    expect(result.current.activeWorkspaceFilePath).toBe("notes/todo.md");

    // A forced opener applies even with no default preference set.
    window.localStorage.removeItem("bb.fileOpenerByExtension");
    act(() => {
      result.current.openTab(
        {
          kind: "workspace-file-preview",
          tab: {
            lineRange: null,
            path: "notes/other.md",
            source: { kind: "working-tree" },
            statusLabel: null,
          },
        },
        { viewer: { pluginId: "notes", openerId: "editor" } },
      );
    });
    expect(result.current.activePluginPanelTab).toMatchObject({
      pluginId: "notes",
      actionId: "file-opener:editor",
      title: "other.md",
    });
  });
});

describe("secondary panel session legacy side-chat tabs", () => {
  // The native side chat is gone. Its persisted tabs must not reappear in the
  // strip, and they must not break the rest of a thread's stored tabs.
  it("drops tabs persisted before the native side chat was removed", () => {
    const threadId = "legacy-side-chat";
    const browserTab = createBrowserFixedPanelTab({
      environmentId: "env_current",
      url: "https://example.com",
    });
    window.localStorage.setItem(
      getFixedPanelTabsStateStorageKey({ threadId }),
      JSON.stringify({
        version: FIXED_PANEL_TABS_STATE_STORAGE_VERSION,
        lastUsedAt: Date.now(),
        secondary: {
          activeTabId: "side-chat:legacy",
          isOpen: true,
          tabs: [
            browserTab,
            {
              id: "side-chat:legacy",
              kind: "side-chat",
              sourceMessageText: "anchor message",
              sourceSeqEnd: null,
              threadId: "thr_child",
              title: "Side chat",
            },
          ],
        },
      }),
    );

    const { result } = renderSessionHook({
      panelStateId: threadId,
      syncThreadId: threadId,
      environmentId: "env_current",
      storageFiles: undefined,
      terminalSessions: undefined,
    });

    expect(
      result.current.orderedSecondaryFileTabs.map((tab) => tab.id),
    ).toEqual([browserTab.id]);
  });
});

describe("secondary panel visibility atoms", () => {
  it("toggles the persisted deck on wide viewports and opens a New tab for root compose", () => {
    const rootId = "toggle-root-wide";
    const { result } = renderSessionHook({
      panelStateId: rootId,
      syncThreadId: null,
      environmentId: "env_root",
      variant: "root-compose",
      storageFiles: undefined,
      terminalSessions: undefined,
    });

    expect(result.current.isOpen).toBe(false);
    act(() => result.current.toggle());
    // Root compose opens straight onto a placeholder "New tab" so the panel
    // never opens empty.
    expect(result.current.isOpen).toBe(true);
    expect(result.current.isNewTabActive).toBe(true);
    act(() => result.current.toggle());
    expect(result.current.isOpen).toBe(false);
  });

  it("scopes the compact drawer to one session and closes it when another opens", () => {
    const store = getDefaultStore();
    const first = renderSessionHook({
      panelStateId: "drawer-thread-a",
      syncThreadId: "drawer-thread-a",
      environmentId: "env_a",
      storageFiles: undefined,
      terminalSessions: undefined,
    });
    const second = renderSessionHook({
      panelStateId: "drawer-thread-b",
      syncThreadId: "drawer-thread-b",
      environmentId: "env_b",
      storageFiles: undefined,
      terminalSessions: undefined,
    });
    act(() => store.set(isCompactViewportAtom, true));

    act(() => first.result.current.toggle());
    expect(first.result.current.isOpen).toBe(true);
    expect(second.result.current.isOpen).toBe(false);
    // The drawer is a single global slot: opening it for another session
    // implicitly closes the first (matching per-thread drawer isolation).
    act(() => second.result.current.toggle());
    expect(first.result.current.isOpen).toBe(false);
    expect(second.result.current.isOpen).toBe(true);
    // Unmounting the owning session releases the drawer instead of leaking
    // an open-drawer flag to the next visit.
    second.unmount();
    expect(store.get(isCompactViewportAtom)).toBe(true);
    act(() => first.result.current.toggle());
    expect(first.result.current.isOpen).toBe(true);
  });
});
