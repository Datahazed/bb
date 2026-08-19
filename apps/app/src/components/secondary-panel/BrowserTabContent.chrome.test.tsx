// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type {
  BbDesktopBrowserApi,
  BbDesktopBrowserState,
} from "@bb/desktop-contract";
import type { PluginBrowserActionProps } from "@get-bb/plugin-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createBbDesktopApi,
  createNoopDesktopBrowserApi,
} from "@/test/bb-desktop-test-utils";
import { BrowserTabContent } from "./BrowserTabContent";
import { createBrowserViewVisibilityCoordinator } from "./browserViewVisibilityCoordinator";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
  type PluginRegistrationSet,
} from "@/lib/plugin-slots";

const desktopInfo = {
  lastCheckedAt: null,
  latestVersion: null,
  pendingVersion: null,
  platform: "macos" as const,
  updateAvailable: false,
  updateDownloaded: false,
  version: "0.0.0-test",
};

interface BrowserChromeHarness {
  api: BbDesktopBrowserApi;
  cancelPageScript: ReturnType<typeof vi.fn>;
  emitState: (state: BbDesktopBrowserState) => void;
  goBack: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  setVisible: ReturnType<typeof vi.fn>;
}

function createBrowserChromeHarness(
  runPageScript?: BbDesktopBrowserApi["experimental_runBrowserPageScript"],
): BrowserChromeHarness {
  const stateListeners = new Set<(state: BbDesktopBrowserState) => void>();
  const goBack = vi.fn();
  const cancelPageScript = vi.fn();
  const stop = vi.fn();
  const setVisible = vi.fn();
  const api: BbDesktopBrowserApi = {
    ...createNoopDesktopBrowserApi(),
    goBack,
    stop,
    setVisible,
    ...(runPageScript
      ? {
          experimental_browserPageRuntimeVersion: 1 as const,
          experimental_cancelBrowserPageScript: cancelPageScript,
          experimental_runBrowserPageScript: runPageScript,
        }
      : {}),
    onState(listener) {
      stateListeners.add(listener);
      return () => stateListeners.delete(listener);
    },
  };
  return {
    api,
    cancelPageScript,
    emitState(state) {
      for (const listener of stateListeners) listener(state);
    },
    goBack,
    stop,
    setVisible,
  };
}

function registrationSet(
  browserActions: PluginRegistrationSet["browserActions"],
): PluginRegistrationSet {
  return {
    homepageSections: [],
    settingsSections: [],
    navPanels: [],
    threadPanelActions: [],
    sidebarFooterActions: [],
    fileOpeners: [],
    messageDirectives: [],
    browserActions,
  };
}

function browserState(
  overrides: Partial<BbDesktopBrowserState> = {},
): BbDesktopBrowserState {
  return {
    tabId: "browser:test",
    url: "https://example.com/docs",
    title: "Example docs",
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
    errorText: null,
    ...overrides,
  };
}

function renderBrowserChrome(
  harness: BrowserChromeHarness,
  initialUrl = "",
  canShowNativeBrowserView = false,
) {
  window.bbDesktop = createBbDesktopApi(desktopInfo, harness.api);
  return render(
    <>
      <BrowserTabContent
        tabId="browser:test"
        initialUrl={initialUrl}
        addressFocusRequest={null}
        canShowNativeBrowserView={canShowNativeBrowserView}
        visibilityCoordinator={
          canShowNativeBrowserView
            ? createBrowserViewVisibilityCoordinator(harness.api)
            : null
        }
        environmentId={null}
        threadId="thread-1"
        projectId="project-1"
        onUpdate={() => {}}
      />
      <button type="button">Outside browser</button>
    </>,
  );
}

function expectChromeVisible(): HTMLElement {
  const chrome = screen.getByTestId("browser-tab-nav-bar");
  expect(chrome.dataset.state).toBe("expanded");
  return chrome;
}

function setBrowserChromeWidth(width: number): void {
  const getBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      if (this.dataset.testid === "browser-tab-nav-controls") {
        return {
          bottom: 44,
          height: 44,
          left: 0,
          right: width,
          top: 0,
          width,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        };
      }
      return getBoundingClientRect.call(this);
    },
  );
}

function browserActionRegistration(
  id: string,
  title: string,
  onClick: () => void = () => {},
): NonNullable<PluginRegistrationSet["browserActions"]>[number] {
  return {
    id,
    title,
    component: () => (
      <button type="button" aria-label={title} onClick={onClick}>
        {title}
      </button>
    ),
  };
}

describe("BrowserTabContent persistent navigation", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.localStorage.clear();
    resetPluginSlotStoreForTest();
    delete window.bbDesktop;
  });

  it("keeps the top navigation visible through pointer and focus changes", () => {
    const harness = createBrowserChromeHarness();
    renderBrowserChrome(harness, "https://example.com/docs");
    const chrome = expectChromeVisible();

    fireEvent.pointerLeave(chrome);
    act(() => screen.getByRole("button", { name: "Outside browser" }).focus());
    expectChromeVisible();
    expect(screen.getByLabelText("Address and search bar")).not.toBeNull();
  });

  it("keeps navigation visible while loading and preserves the stop action", () => {
    const harness = createBrowserChromeHarness();
    renderBrowserChrome(harness, "https://example.com/docs");

    act(() => harness.emitState(browserState({ isLoading: true })));
    expectChromeVisible();

    const stopButton = screen.getByRole("button", { name: "Stop loading" });
    fireEvent.click(stopButton);
    expect(harness.stop).toHaveBeenCalledWith("browser:test");
  });

  it("preserves browser navigation actions", () => {
    const harness = createBrowserChromeHarness();
    renderBrowserChrome(harness, "https://example.com/docs");
    expectChromeVisible();

    act(() => harness.emitState(browserState({ canGoBack: true })));
    fireEvent.click(screen.getByRole("button", { name: "Go back" }));
    expect(harness.goBack).toHaveBeenCalledWith("browser:test");
  });

  it("keeps plugin actions ordered before the rightmost external-link control", () => {
    setBrowserChromeWidth(760);
    setPluginSlotRegistrations(
      "toolbar",
      registrationSet([
        browserActionRegistration("first", "First action"),
        browserActionRegistration("second", "Second action"),
      ]),
    );
    renderBrowserChrome(
      createBrowserChromeHarness(),
      "https://example.com/docs",
    );

    const controls = within(
      screen.getByTestId("browser-tab-nav-controls"),
    ).getAllByRole("button");
    expect(
      controls.slice(-3).map((control) => control.getAttribute("aria-label")),
    ).toEqual(["First action", "Second action", "Open in external browser"]);
    expect(screen.queryByLabelText(/More Browser actions/)).toBeNull();
  });

  it("moves excess actions into an ordered keyboard-accessible menu before external-link", async () => {
    setBrowserChromeWidth(360);
    const activations: string[] = [];
    setPluginSlotRegistrations(
      "toolbar",
      registrationSet([
        browserActionRegistration("first", "First action", () => {
          activations.push("first");
        }),
        browserActionRegistration("second", "Second action", () => {
          activations.push("second");
        }),
        browserActionRegistration("third", "Third action", () => {
          activations.push("third");
        }),
      ]),
    );
    renderBrowserChrome(
      createBrowserChromeHarness(),
      "https://example.com/docs",
    );

    const controls = within(
      screen.getByTestId("browser-tab-nav-controls"),
    ).getAllByRole("button");
    expect(
      controls.slice(-2).map((control) => control.getAttribute("aria-label")),
    ).toEqual(["More Browser actions (3)", "Open in external browser"]);

    const trigger = screen.getByRole("button", {
      name: "More Browser actions (3)",
    });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "Enter" });

    const menu = await screen.findByRole("menu");
    const items = within(menu).getAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "First action",
      "Second action",
      "Third action",
    ]);
    await waitFor(() => expect(document.activeElement).toBe(items[0]));

    fireEvent.keyDown(items[0]!, { key: "ArrowDown" });
    await waitFor(() => expect(document.activeElement).toBe(items[1]));
    fireEvent.keyDown(items[1]!, { key: "Enter" });

    expect(activations).toEqual(["second"]);
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it("binds generic page scripts to the exact Browser tab", async () => {
    let slotProps: PluginBrowserActionProps | null = null;
    const runPageScript = vi.fn(async (request) => ({
      requestId: request.requestId,
      navigationEpoch: 2,
      value: { title: "Docs" },
    }));
    setPluginSlotRegistrations(
      "context",
      registrationSet([
        {
          id: "inspect",
          title: "Inspect page",
          component: (props) => {
            slotProps = props;
            return <button type="button">Inspect page</button>;
          },
        },
      ]),
    );
    const harness = createBrowserChromeHarness(runPageScript);
    renderBrowserChrome(harness, "https://example.com/docs");

    const controller = new AbortController();
    const capturedProps = slotProps as PluginBrowserActionProps | null;
    expect(capturedProps).not.toBeNull();
    await expect(
      capturedProps!.experimental_runPageContentScript(
        {
          source: "() => ({ title: document.title })",
          input: { intent: "inspect" },
        },
        { signal: controller.signal },
      ),
    ).resolves.toEqual({
      navigationEpoch: 2,
      value: { title: "Docs" },
    });
    expect(runPageScript).toHaveBeenCalledWith({
      tabId: "browser:test",
      requestId: expect.any(String),
      expectedNavigationEpoch: 0,
      source: "() => ({ title: document.title })",
      input: { intent: "inspect" },
      timeoutMs: 30_000,
    });
    expect(capturedProps!.experimental_pageContentScriptsAvailable).toBe(true);
  });

  it("keeps AbortSignal renderer-local and sends a serializable cancel request", async () => {
    let slotProps: PluginBrowserActionProps | null = null;
    let rejectRun!: (error: Error) => void;
    const runPageScript = vi.fn(
      () =>
        new Promise<never>((_resolve, reject) => {
          rejectRun = reject;
        }),
    );
    setPluginSlotRegistrations(
      "context",
      registrationSet([
        {
          id: "inspect",
          title: "Inspect page",
          component: (props) => {
            slotProps = props;
            return <button type="button">Inspect page</button>;
          },
        },
      ]),
    );
    const harness = createBrowserChromeHarness(runPageScript);
    renderBrowserChrome(harness, "https://example.com/docs");
    const controller = new AbortController();
    const pending = slotProps!.experimental_runPageContentScript(
      { source: "() => null" },
      { signal: controller.signal },
    );
    await vi.waitFor(() => expect(runPageScript).toHaveBeenCalledOnce());
    controller.abort();
    expect(harness.cancelPageScript).toHaveBeenCalledWith({
      tabId: "browser:test",
      requestId: expect.any(String),
    });
    rejectRun(new DOMException("cancelled", "AbortError"));
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(runPageScript.mock.calls[0]).toHaveLength(1);
  });

  it("rejects clearly when the desktop page-runtime capability is missing", async () => {
    let slotProps: PluginBrowserActionProps | null = null;
    setPluginSlotRegistrations(
      "context",
      registrationSet([
        {
          id: "inspect",
          title: "Inspect page",
          component: (props) => {
            slotProps = props;
            return <button type="button">Inspect page</button>;
          },
        },
      ]),
    );
    renderBrowserChrome(
      createBrowserChromeHarness(),
      "https://example.com/docs",
    );

    await expect(
      slotProps!.experimental_runPageContentScript(
        { source: "() => null" },
        { signal: new AbortController().signal },
      ),
    ).rejects.toMatchObject({
      name: "ExperimentalBrowserPageScriptsUnavailableError",
      message: expect.stringMatching(/newer BB desktop app/),
    });
  });

  it("suppresses and restores the native view for a plugin overlay", () => {
    function OverlayAction(props: PluginBrowserActionProps) {
      return (
        <>
          <button
            type="button"
            aria-label="Open inspector"
            onClick={() => props.experimental_setOverlayOpen(true)}
          />
          <button
            type="button"
            aria-label="Close inspector"
            onClick={() => props.experimental_setOverlayOpen(false)}
          />
        </>
      );
    }
    setPluginSlotRegistrations(
      "context",
      registrationSet([
        { id: "inspect", title: "Inspect page", component: OverlayAction },
      ]),
    );
    const harness = createBrowserChromeHarness();
    renderBrowserChrome(harness, "https://example.com/docs", true);

    expect(harness.setVisible).toHaveBeenLastCalledWith({
      tabId: "browser:test",
      visible: true,
    });
    fireEvent.click(screen.getByRole("button", { name: "Open inspector" }));
    expect(harness.setVisible).toHaveBeenLastCalledWith({
      tabId: "browser:test",
      visible: false,
    });
    fireEvent.click(screen.getByRole("button", { name: "Close inspector" }));
    expect(harness.setVisible).toHaveBeenLastCalledWith({
      tabId: "browser:test",
      visible: true,
    });
  });

  it("contains a crashing Browser action without losing native controls", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    setPluginSlotRegistrations(
      "broken",
      registrationSet([
        {
          id: "broken",
          title: "Broken",
          component: () => {
            throw new Error("broken action");
          },
        },
      ]),
    );
    setPluginSlotRegistrations(
      "working",
      registrationSet([
        {
          id: "working",
          title: "Working",
          component: () => <button type="button" aria-label="Working action" />,
        },
      ]),
    );
    renderBrowserChrome(
      createBrowserChromeHarness(),
      "https://example.com/docs",
    );

    expect(screen.getByLabelText("Address and search bar")).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "Working action" }),
    ).not.toBeNull();
  });
});
