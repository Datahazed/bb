// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import type {
  BbDesktopBrowserApi,
  BbDesktopBrowserInspectionResultV2,
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
  emitState: (state: BbDesktopBrowserState) => void;
  goBack: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  setVisible: ReturnType<typeof vi.fn>;
  cancelInspection: ReturnType<typeof vi.fn>;
}

function createBrowserChromeHarness(
  inspectPage?: BbDesktopBrowserApi["experimental_inspectPageV2"],
): BrowserChromeHarness {
  const stateListeners = new Set<(state: BbDesktopBrowserState) => void>();
  const goBack = vi.fn();
  const stop = vi.fn();
  const setVisible = vi.fn();
  const cancelInspection = vi.fn();
  const api: BbDesktopBrowserApi = {
    ...createNoopDesktopBrowserApi(),
    goBack,
    stop,
    setVisible,
    ...(inspectPage
      ? {
          experimental_inspectPageV2: inspectPage,
          experimental_cancelPageInspection: cancelInspection,
        }
      : {}),
    onState(listener) {
      stateListeners.add(listener);
      return () => stateListeners.delete(listener);
    },
  };
  return {
    api,
    emitState(state) {
      for (const listener of stateListeners) listener(state);
    },
    goBack,
    stop,
    setVisible,
    cancelInspection,
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
  expect(chrome.classList).toContain("h-11");
  expect(screen.getByTestId("browser-tab-nav-controls").classList).toContain(
    "opacity-100",
  );
  return chrome;
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

  it("maps inspection to the optional desktop capability for the active tab", async () => {
    let slotProps: PluginBrowserActionProps | null = null;
    const result = {
      version: 2,
      kind: "region",
      page: {
        url: "https://example.com/docs",
        title: "Docs",
        viewport: { width: 800, height: 600 },
        scroll: { x: 0, y: 10 },
      },
      rect: { x: 1, y: 2, width: 20, height: 30 },
      element: null,
      region: {
        commonAncestor: null,
        targets: [],
        groups: [],
        omittedTargetCount: 0,
        omittedGroupCount: 0,
        scanTruncated: false,
      },
      screenshot: {
        dataUrl: "data:image/png;base64,AA==",
        pixelSize: { width: 800, height: 600 },
        deviceScaleFactor: 1,
        pageZoom: 1,
        cssToImageScale: { x: 1, y: 1 },
      },
    } satisfies BbDesktopBrowserInspectionResultV2;
    const inspectPage = vi.fn(async () => result);
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
    const harness = createBrowserChromeHarness(inspectPage);
    renderBrowserChrome(harness, "https://example.com/docs");

    const controller = new AbortController();
    const capturedProps = slotProps as PluginBrowserActionProps | null;
    expect(capturedProps).not.toBeNull();
    expect(capturedProps!.experimental_overlayRoot).toBe(
      document.querySelector("[data-browser-plugin-overlay-root]"),
    );
    await expect(
      capturedProps!.experimental_inspectPage(
        { kind: "region" },
        { signal: controller.signal },
      ),
    ).resolves.toEqual(result);
    expect(inspectPage).toHaveBeenCalledWith({
      tabId: "browser:test",
      requestId: expect.any(String),
      kind: "region",
    });
  });

  it("keeps AbortSignal renderer-local and cancels through serializable IPC", async () => {
    let slotProps: PluginBrowserActionProps | null = null;
    let finishInspection: ((value: null) => void) | undefined;
    const inspectPage = vi.fn(
      () =>
        new Promise<null>((resolve) => {
          finishInspection = resolve;
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
    const harness = createBrowserChromeHarness(inspectPage);
    renderBrowserChrome(harness, "https://example.com/docs");

    const controller = new AbortController();
    const pending = slotProps!.experimental_inspectPage(
      { kind: "element" },
      { signal: controller.signal },
    );
    controller.abort();

    expect(inspectPage).toHaveBeenCalledWith({
      tabId: "browser:test",
      requestId: expect.any(String),
      kind: "element",
    });
    expect(harness.cancelInspection).toHaveBeenCalledWith(
      "browser:test",
      expect.any(String),
    );
    finishInspection?.(null);
    await expect(pending).resolves.toBeNull();
  });

  it("rejects retained inspection and overlay callbacks after the action unmounts", async () => {
    let slotProps: PluginBrowserActionProps | null = null;
    const inspectPage = vi.fn(async () => null);
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
    const harness = createBrowserChromeHarness(inspectPage);
    const mounted = renderBrowserChrome(
      harness,
      "https://example.com/docs",
      true,
    );
    const retained = slotProps as PluginBrowserActionProps | null;
    if (retained === null) throw new Error("Expected retained Browser action");

    mounted.unmount();
    const visibilityCallCountAfterUnmount =
      harness.setVisible.mock.calls.length;

    expect(() => retained.experimental_setOverlayOpen(true)).toThrow(
      /no longer active/u,
    );
    expect(() => retained.experimental_setOverlayOpen(false)).not.toThrow();
    await expect(
      retained.experimental_inspectPage(
        { kind: "element" },
        { signal: new AbortController().signal },
      ),
    ).rejects.toMatchObject({
      name: "ExperimentalBrowserActionDisposedError",
    });
    expect(inspectPage).not.toHaveBeenCalled();
    expect(harness.setVisible).toHaveBeenCalledTimes(
      visibilityCallCountAfterUnmount,
    );
  });

  it("rejects clearly when the desktop inspection capability is missing", async () => {
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
      slotProps!.experimental_inspectPage(
        { kind: "element" },
        { signal: new AbortController().signal },
      ),
    ).rejects.toMatchObject({
      name: "ExperimentalBrowserInspectionUnavailableError",
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
