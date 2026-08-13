// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBbNavigate } from "@/lib/plugin-sdk-hooks";
import {
  PaneContext,
  type PaneContextValue,
} from "@/views/thread-detail/PaneContext";
import { PluginSlotMount } from "./PluginSlotMount";
import {
  ensurePluginRightPanelDefaultView,
  PluginPanelRightPanelHost,
} from "./PluginPanelRightPanelHost";
import { createEmptyFixedPanelTabsState } from "@/lib/fixed-panel-tabs-state";
import type { PluginNavPanelSlot } from "@/lib/plugin-slots";

const hostState = vi.hoisted(() => ({
  activeBrowserTab: null as {
    environmentId: null;
    id: string;
    kind: "browser";
    title: string | null;
    url: string;
  } | null,
  browserTabs: [] as Array<{
    environmentId: null;
    id: string;
    kind: "browser";
    title: string | null;
    url: string;
  }>,
  compact: false,
  panelOpen: true,
}));
const openTab = vi.hoisted(() => vi.fn());
const openPluginPanel = vi.hoisted(() => vi.fn());
const updatePanelState = vi.hoisted(() => vi.fn());
const createTerminalMutate = vi.hoisted(() => vi.fn());
const drawerState = vi.hoisted(
  (): {
    onContentAnimationEnd: ((open: boolean) => void) | null;
  } => ({ onContentAnimationEnd: null }),
);
const dispatchBrowserViewBoundsSync = vi.hoisted(() => vi.fn());
const realizeContent = vi.hoisted(() => vi.fn());

const rightPanelSlot: PluginNavPanelSlot = {
  id: "docs",
  pluginId: "docs",
  generation: 1,
  title: "Docs",
  icon: "FileText",
  path: "docs",
  component: () => null,
  experimental_rightPanel: {
    views: [
      {
        id: "navigation",
        title: "Navigation",
        component: () => null,
        layout: "flush",
      },
    ],
    defaultViewId: "navigation",
  },
};

vi.mock("@bb/shared-ui/hooks/use-compact-viewport", () => ({
  useIsCompactViewport: () => hostState.compact,
}));

vi.mock("@bb/shared-ui/responsive-overlay", async () => {
  const React = await import("react");
  const Drawer = ({
    children,
    onContentAnimationEnd,
  }: {
    children: React.ReactNode;
    onContentAnimationEnd?: (open: boolean) => void;
  }) => {
    drawerState.onContentAnimationEnd = onContentAnimationEnd ?? null;
    return React.createElement("div", { "data-testid": "drawer" }, children);
  };
  return {
    environmentId: null,
    PersistentResponsiveDrawerShell: Drawer,
    ResponsiveDrawerShell: Drawer,
    useResponsiveDrawerRealization: () => ({
      isContentRealized: true,
      realizeContent,
    }),
  };
});

vi.mock("react-resizable-panels", async () => {
  const React = await import("react");
  return {
    Panel: ({ children }: { children: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    PanelGroup: ({ children }: { children: React.ReactNode }) =>
      React.createElement("div", null, children),
  };
});

vi.mock("@/lib/fixed-panel-tabs", () => ({
  useCloseFixedSecondaryPanel: () => vi.fn(),
  useFixedPanelTabsState: () => ({
    version: 1,
    lastUsedAt: 0,
    secondary: {
      isOpen: hostState.panelOpen,
      activeTabId: hostState.activeBrowserTab?.id ?? null,
      tabs: hostState.browserTabs,
    },
  }),
  useUpdateFixedPanelTabsState: () => updatePanelState,
}));

vi.mock("@/lib/plugin-slots", () => ({
  usePluginSlots: () => ({
    navPanels: [
      {
        id: "docs",
        pluginId: "docs",
        generation: 1,
        title: "Docs",
        icon: "FileText",
        path: "docs",
        component: () => null,
        experimental_rightPanel: {
          views: [
            {
              id: "navigation",
              title: "Navigation",
              component: () => null,
              layout: "flush",
            },
          ],
          defaultViewId: "navigation",
          tools: ["browser", "terminal"],
        },
      },
    ],
  }),
}));

vi.mock("@/hooks/queries/thread-terminal-queries", () => ({
  useTerminals: () => ({ data: undefined }),
  useCreateTerminal: () => ({ isPending: false, mutate: createTerminalMutate }),
  useCloseTerminal: () => ({ mutate: vi.fn() }),
}));

vi.mock("@/components/secondary-panel/useThreadFileTabs", () => ({
  useThreadFileTabs: () => ({
    activateTab: vi.fn(),
    activeBrowserTab: hostState.activeBrowserTab,
    activePluginPanelTab: null,
    browserTabs: hostState.browserTabs,
    closeTab: vi.fn(),
    openPluginPanel,
    openTab,
    orderedSecondaryFileTabs: hostState.browserTabs,
    reorderFileTab: vi.fn(),
    updateBrowserTab: vi.fn(),
  }),
}));

vi.mock("@/components/secondary-panel/BrowserTabDeck", async () => {
  const React = await import("react");
  return {
    BrowserTabDeck: ({
      browserTabs,
      canShowNativeBrowserView,
    }: {
      browserTabs: readonly { id: string }[];
      canShowNativeBrowserView: boolean;
    }) =>
      React.createElement("div", {
        "data-browser-tab-count": String(browserTabs.length),
        "data-can-show-native-browser-view": String(canShowNativeBrowserView),
        "data-testid": "browser-deck",
      }),
  };
});

vi.mock("@/components/secondary-panel/ThreadSecondaryPanel", async () => {
  const React = await import("react");
  return {
    ThreadSecondaryPanel: ({ browserDeck }: { browserDeck: React.ReactNode }) =>
      React.createElement("div", null, browserDeck),
  };
});

vi.mock("@/lib/bb-desktop", () => ({
  isDesktopBrowserAvailable: () => true,
}));

vi.mock("@/lib/browser-view-bounds-sync", () => ({
  dispatchBrowserViewBoundsSync,
}));

interface FrameController {
  flushAll: () => void;
}

function installFrameController(): FrameController {
  let nextId = 1;
  const callbacks = new Map<number, FrameRequestCallback>();
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    const id = nextId;
    nextId += 1;
    callbacks.set(id, callback);
    return id;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
    callbacks.delete(id);
  });
  return {
    flushAll: () => {
      const pending = [...callbacks.values()];
      callbacks.clear();
      pending.forEach((callback) => callback(0));
    },
  };
}

function browserTab(url = "https://example.com") {
  return {
    id: "browser-tab-1",
    kind: "browser" as const,
    title: null,
    url,
  };
}

const basePaneContext: PaneContextValue = {
  paneId: "plugin-pane",
  isFocused: true,
  isSplitPane: true,
  secondaryPanelHost: null,
  reservesWindowPanelToggle: false,
  onRequestClose: null,
  isMaximized: false,
  onToggleMaximize: null,
  isBoundedPane: true,
  isTopRow: true,
  ownsWindowTopLeft: true,
  navigateInPane: () => {},
};

function NavigationProbe({ url }: { url: string }) {
  const navigate = useBbNavigate();
  return (
    <>
      <button
        type="button"
        onClick={() => {
          const accepted = navigate.experimental_openRightPanel({
            kind: "browser",
            url,
          });
          document.body.dataset.browserRequestAccepted = String(accepted);
        }}
      >
        Open Browser
      </button>
      <button
        type="button"
        onClick={() => {
          const accepted = navigate.experimental_openRightPanel({
            kind: "view",
            viewId: "navigation",
            params: { selected: "today" },
          });
          document.body.dataset.viewRequestAccepted = String(accepted);
        }}
      >
        Open View
      </button>
      <button
        type="button"
        onClick={() => {
          const accepted = navigate.experimental_openRightPanel({
            kind: "terminal",
            target: { kind: "host_path", hostId: "host-1" },
            title: "Plugin shell",
          });
          document.body.dataset.terminalRequestAccepted = String(accepted);
        }}
      >
        Open Terminal
      </button>
    </>
  );
}

function HostFixture({
  paneContext = basePaneContext,
  url = "https://example.com",
}: {
  paneContext?: PaneContextValue;
  url?: string;
}) {
  return (
    <MemoryRouter>
      <PaneContext.Provider value={paneContext}>
        <PluginPanelRightPanelHost pluginId="docs" panelPath="docs" subPath="">
          <PluginSlotMount pluginId="docs" slotKind="test" slotId="browser">
            <NavigationProbe url={url} />
          </PluginSlotMount>
        </PluginPanelRightPanelHost>
      </PaneContext.Provider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  hostState.activeBrowserTab = null;
  hostState.browserTabs = [];
  hostState.compact = false;
  hostState.panelOpen = true;
  drawerState.onContentAnimationEnd = null;
  delete document.body.dataset.browserRequestAccepted;
  delete document.body.dataset.viewRequestAccepted;
  delete document.body.dataset.terminalRequestAccepted;
  dispatchBrowserViewBoundsSync.mockClear();
  openTab.mockClear();
  openPluginPanel.mockClear();
  updatePanelState.mockClear();
  createTerminalMutate.mockClear();
  realizeContent.mockClear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("PluginPanelRightPanelHost", () => {
  it("initializes one pinned default without reopening a hidden panel", () => {
    const initialized = ensurePluginRightPanelDefaultView(
      createEmptyFixedPanelTabsState(),
      rightPanelSlot,
    );
    expect(initialized.secondary).toMatchObject({
      isOpen: true,
      activeTabId: expect.stringContaining("navigation"),
    });
    expect(initialized.secondary.tabs).toHaveLength(1);

    const hidden = {
      ...initialized,
      secondary: { ...initialized.secondary, isOpen: false },
    };
    expect(ensurePluginRightPanelDefaultView(hidden, rightPanelSlot)).toBe(
      hidden,
    );
  });

  it("adds a newly registered default without stealing an existing active tab", () => {
    const tab = browserTab();
    const state = createEmptyFixedPanelTabsState({
      secondary: { tabs: [tab], activeTabId: tab.id, isOpen: true },
    });
    const migrated = ensurePluginRightPanelDefaultView(state, rightPanelSlot);
    expect(migrated.secondary.activeTabId).toBe(state.secondary.activeTabId);
    expect(migrated.secondary.tabs).toHaveLength(2);
  });

  it.each(["https://", "not a URL", `https://example.com/${"x".repeat(4096)}`])(
    "rejects malformed or oversized Browser URLs: %s",
    (url) => {
      render(<HostFixture url={url} />);

      fireEvent.click(screen.getByRole("button", { name: "Open Browser" }));

      expect(document.body.dataset.browserRequestAccepted).toBe("false");
      expect(openTab).not.toHaveBeenCalled();
    },
  );

  it("accepts a valid HTTP(S) Browser URL", () => {
    render(<HostFixture url="https://example.com/path" />);

    fireEvent.click(screen.getByRole("button", { name: "Open Browser" }));

    expect(document.body.dataset.browserRequestAccepted).toBe("true");
    expect(openTab).toHaveBeenCalledWith({
      kind: "browser",
      url: "https://example.com/path",
    });
  });

  it("opens registered custom views with persisted JSON params", () => {
    render(<HostFixture />);
    fireEvent.click(screen.getByRole("button", { name: "Open View" }));
    expect(document.body.dataset.viewRequestAccepted).toBe("true");
    expect(openPluginPanel).toHaveBeenCalledWith({
      pluginId: "docs",
      actionId: "navigation",
      title: "Navigation",
      paramsJson: '{"selected":"today"}',
    });
  });

  it("creates an enabled Terminal and records its target on the panel tab", () => {
    render(<HostFixture />);
    fireEvent.click(screen.getByRole("button", { name: "Open Terminal" }));
    expect(document.body.dataset.terminalRequestAccepted).toBe("true");
    expect(createTerminalMutate).toHaveBeenCalledWith(
      {
        cols: 100,
        rows: 30,
        target: { kind: "host_path", hostId: "host-1", cwd: null },
        title: "Plugin shell",
      },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    const onSuccess = createTerminalMutate.mock.calls.at(-1)?.[1].onSuccess;
    updatePanelState.mockClear();
    onSuccess({ id: "terminal-1" });
    const update = updatePanelState.mock.calls[0]?.[0];
    const next = update(createEmptyFixedPanelTabsState());
    expect(next.secondary).toMatchObject({
      isOpen: true,
      tabs: [
        expect.objectContaining({
          kind: "terminal",
          terminalId: "terminal-1",
          target: { kind: "host_path", hostId: "host-1", cwd: null },
        }),
      ],
    });
  });

  it("keeps the Browser deck mounted when the final tab is removed", () => {
    const tab = browserTab();
    hostState.activeBrowserTab = tab;
    hostState.browserTabs = [tab];
    const view = render(<HostFixture />);
    expect(screen.getByTestId("browser-deck").dataset.browserTabCount).toBe(
      "1",
    );

    hostState.activeBrowserTab = null;
    hostState.browserTabs = [];
    view.rerender(<HostFixture />);

    expect(screen.getByTestId("browser-deck").dataset.browserTabCount).toBe(
      "0",
    );
  });

  it("hides the native view when focus leaves or a sibling pane is maximized", () => {
    const tab = browserTab();
    hostState.activeBrowserTab = tab;
    hostState.browserTabs = [tab];
    const view = render(<HostFixture />);
    const canShow = () =>
      screen
        .getByTestId("browser-deck")
        .getAttribute("data-can-show-native-browser-view");
    expect(canShow()).toBe("true");

    view.rerender(
      <HostFixture paneContext={{ ...basePaneContext, isFocused: false }} />,
    );
    expect(canShow()).toBe("false");

    view.rerender(
      <HostFixture
        paneContext={{ ...basePaneContext, isFocused: true, isMaximized: true }}
      />,
    );
    expect(canShow()).toBe("true");

    view.rerender(
      <HostFixture
        paneContext={{
          ...basePaneContext,
          isFocused: false,
          isMaximized: false,
        }}
      />,
    );
    expect(canShow()).toBe("false");
  });

  it("does not let stale drawer settle work reveal a quick reopen", () => {
    const frames = installFrameController();
    const tab = browserTab();
    hostState.compact = true;
    hostState.activeBrowserTab = tab;
    hostState.browserTabs = [tab];
    const view = render(<HostFixture />);
    const canShow = () =>
      screen
        .getByTestId("browser-deck")
        .getAttribute("data-can-show-native-browser-view");
    expect(canShow()).toBe("false");

    act(() => drawerState.onContentAnimationEnd?.(true));
    hostState.panelOpen = false;
    view.rerender(<HostFixture />);
    hostState.panelOpen = true;
    view.rerender(<HostFixture />);
    act(() => frames.flushAll());

    expect(canShow()).toBe("false");
    expect(dispatchBrowserViewBoundsSync).not.toHaveBeenCalled();

    act(() => drawerState.onContentAnimationEnd?.(true));
    act(() => frames.flushAll());
    expect(canShow()).toBe("true");
    expect(dispatchBrowserViewBoundsSync).toHaveBeenCalledTimes(1);
  });
});
