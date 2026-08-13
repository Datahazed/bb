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
import { PluginPanelBrowserHost } from "./PluginPanelBrowserHost";

const hostState = vi.hoisted(() => ({
  activeBrowserTab: null as {
    id: string;
    kind: "browser";
    title: string | null;
    url: string;
  } | null,
  browserTabs: [] as Array<{
    id: string;
    kind: "browser";
    title: string | null;
    url: string;
  }>,
  compact: false,
  panelOpen: true,
}));
const openTab = vi.hoisted(() => vi.fn());
const drawerState = vi.hoisted(
  (): {
    onContentAnimationEnd: ((open: boolean) => void) | null;
  } => ({ onContentAnimationEnd: null }),
);
const dispatchBrowserViewBoundsSync = vi.hoisted(() => vi.fn());
const realizeContent = vi.hoisted(() => vi.fn());

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
    secondary: { isOpen: hostState.panelOpen },
  }),
}));

vi.mock("@/components/secondary-panel/useThreadFileTabs", () => ({
  useThreadFileTabs: () => ({
    activateTab: vi.fn(),
    activeBrowserTab: hostState.activeBrowserTab,
    browserTabs: hostState.browserTabs,
    closeTab: vi.fn(),
    openTab,
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
    <button
      type="button"
      onClick={() => {
        const accepted = navigate.experimental_openBrowserTab({ url });
        document.body.dataset.browserRequestAccepted = String(accepted);
      }}
    >
      Open Browser
    </button>
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
        <PluginPanelBrowserHost pluginId="docs" panelPath="docs">
          <PluginSlotMount pluginId="docs" slotKind="test" slotId="browser">
            <NavigationProbe url={url} />
          </PluginSlotMount>
        </PluginPanelBrowserHost>
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
  dispatchBrowserViewBoundsSync.mockClear();
  openTab.mockClear();
  realizeContent.mockClear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("PluginPanelBrowserHost", () => {
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
