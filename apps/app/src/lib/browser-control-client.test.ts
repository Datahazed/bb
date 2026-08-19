import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BrowserControlCancelMessage,
  BrowserControlRequestMessage,
} from "@bb/server-contract";

const socket = vi.hoisted(() => ({
  cancel: null as ((message: BrowserControlCancelMessage) => void) | null,
  connected: null as (() => void) | null,
  connectionState: "connected" as "connected" | "connecting" | "reconnecting",
  connectionStateChanged: null as (() => void) | null,
  request: null as ((message: BrowserControlRequestMessage) => void) | null,
  sendBrowserClientState: vi.fn(),
  sendBrowserControlResponse: vi.fn(),
}));

vi.mock("./ws", () => ({
  wsManager: {
    onBrowserControlCancel(
      listener: (message: BrowserControlCancelMessage) => void,
    ) {
      socket.cancel = listener;
      return () => undefined;
    },
    onBrowserControlRequest(
      listener: (message: BrowserControlRequestMessage) => void,
    ) {
      socket.request = listener;
      return () => undefined;
    },
    onConnected(listener: () => void) {
      socket.connected = listener;
      return () => undefined;
    },
    onConnectionStateChange(listener: () => void) {
      socket.connectionStateChanged = listener;
      return () => undefined;
    },
    getConnectionState() {
      return socket.connectionState;
    },
    sendBrowserClientState: socket.sendBrowserClientState,
    sendBrowserControlResponse: socket.sendBrowserControlResponse,
  },
}));

import {
  browserControlActivitySnapshot,
  browserControlTarget,
  registerBrowserControlTab,
  subscribeBrowserControlActivity,
} from "./browser-control-client";

function request(overrides: Partial<BrowserControlRequestMessage> = {}) {
  const state = socket.sendBrowserClientState.mock.calls.at(-1)?.[0];
  const tab = state.tabs[0];
  return {
    type: "browser-control-request" as const,
    requestId: "request-a",
    target: {
      clientId: state.clientId,
      windowId: state.windowId,
      tabId: tab.tabId,
      navigationEpoch: tab.navigationEpoch,
    },
    action: { kind: "snapshot" as const, mode: "interactive" as const },
    ...overrides,
  };
}

describe("Browser control client", () => {
  beforeEach(() => {
    socket.connectionState = "connected";
    socket.sendBrowserClientState.mockClear();
    socket.sendBrowserControlResponse.mockClear();
  });

  it("publishes an exact tab target and runs a request through the isolated runtime", async () => {
    const run = vi.fn(
      async (_request: unknown, _options: { signal?: AbortSignal }) => ({
        requestId: "page-request",
        navigationEpoch: 7,
        value: { nodes: [{ name: "Invite member" }] },
      }),
    );
    const registration = registerBrowserControlTab({
      active: true,
      desktopBrowser: {
        navigate: vi.fn(),
        experimental_cancelBrowserPageScript: vi.fn(),
        experimental_runBrowserPageScript: run,
      } as never,
      projectId: "project-a",
      state: {
        tabId: "tab-a",
        url: "https://example.test/",
        title: "Example",
        navigationEpoch: 7,
      } as never,
      tabId: "tab-a",
      threadId: "thread-a",
      url: "https://fallback.test/",
    });

    expect(socket.sendBrowserClientState).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: "browser-client-state",
        tabs: [
          expect.objectContaining({
            tabId: "tab-a",
            threadId: "thread-a",
            projectId: "project-a",
            navigationEpoch: 7,
          }),
        ],
      }),
    );
    const published = socket.sendBrowserClientState.mock.calls.at(-1)?.[0];
    expect(browserControlTarget("tab-a", 7)).toEqual({
      clientId: published.clientId,
      windowId: published.windowId,
      tabId: "tab-a",
      navigationEpoch: 7,
    });

    socket.request?.(request());
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
    expect(run.mock.calls[0]?.[0]).toMatchObject({
      tabId: "tab-a",
      expectedNavigationEpoch: 7,
      input: { kind: "snapshot", mode: "interactive" },
    });
    await vi.waitFor(() =>
      expect(socket.sendBrowserControlResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: "request-a",
          ok: true,
          value: { nodes: [{ name: "Invite member" }] },
        }),
      ),
    );

    registration.update({
      active: false,
      state: {
        tabId: "tab-a",
        url: "https://example.test/next",
        title: "Next",
        navigationEpoch: 8,
      } as never,
      url: "https://example.test/next",
    });
    expect(socket.sendBrowserClientState).toHaveBeenLastCalledWith(
      expect.objectContaining({
        tabs: [
          expect.objectContaining({
            url: "https://example.test/next",
            active: false,
            navigationEpoch: 8,
          }),
        ],
      }),
    );
    expect(
      socket.sendBrowserClientState.mock.calls
        .slice(0, -1)
        .some(
          (call) =>
            (call as unknown as [{ tabs: unknown[] }])[0].tabs.length === 0,
        ),
    ).toBe(false);

    registration.dispose();
    expect(socket.sendBrowserClientState).toHaveBeenLastCalledWith(
      expect.objectContaining({ tabs: [] }),
    );
  });

  it("cancels one concurrent request and exposes visible per-tab activity", async () => {
    let rejectRun!: (error: Error) => void;
    const run = vi.fn(
      () =>
        new Promise<never>((_resolve, reject) => {
          rejectRun = reject;
        }),
    );
    const cancelPageScript = vi.fn(() =>
      rejectRun(new DOMException("cancelled", "AbortError")),
    );
    const registration = registerBrowserControlTab({
      active: true,
      desktopBrowser: {
        navigate: vi.fn(),
        experimental_cancelBrowserPageScript: cancelPageScript,
        experimental_runBrowserPageScript: run,
      } as never,
      projectId: null,
      state: {
        tabId: "tab-a",
        url: "https://example.test/",
        title: "Example",
        navigationEpoch: 7,
      } as never,
      tabId: "tab-a",
      threadId: null,
      url: "https://example.test/",
    });
    const activity = vi.fn();
    const unsubscribe = subscribeBrowserControlActivity(activity);

    socket.request?.(request());
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
    expect(browserControlActivitySnapshot("tab-a")).toBe(1);
    socket.cancel?.({
      type: "browser-control-cancel",
      requestId: "request-a",
      reason: "cancelled",
    });
    await vi.waitFor(() => expect(cancelPageScript).toHaveBeenCalledOnce());
    await vi.waitFor(() =>
      expect(browserControlActivitySnapshot("tab-a")).toBe(0),
    );
    expect(activity).toHaveBeenCalled();
    expect(socket.sendBrowserControlResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: "request-a",
        ok: false,
        error: expect.objectContaining({ code: "AbortError" }),
      }),
    );

    unsubscribe();
    registration.dispose();
  });

  it("cancels active work when the Browser client disconnects", async () => {
    let rejectRun!: (error: Error) => void;
    const run = vi.fn(
      () =>
        new Promise<never>((_resolve, reject) => {
          rejectRun = reject;
        }),
    );
    const cancelPageScript = vi.fn(() =>
      rejectRun(new DOMException("disconnected", "AbortError")),
    );
    const registration = registerBrowserControlTab({
      active: true,
      desktopBrowser: {
        navigate: vi.fn(),
        experimental_cancelBrowserPageScript: cancelPageScript,
        experimental_runBrowserPageScript: run,
      } as never,
      projectId: null,
      state: {
        tabId: "tab-a",
        url: "https://example.test/",
        title: "Example",
        navigationEpoch: 7,
      } as never,
      tabId: "tab-a",
      threadId: null,
      url: "https://example.test/",
    });

    socket.request?.(request());
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
    socket.connectionState = "reconnecting";
    socket.connectionStateChanged?.();
    await vi.waitFor(() => expect(cancelPageScript).toHaveBeenCalledOnce());
    await vi.waitFor(() =>
      expect(browserControlActivitySnapshot("tab-a")).toBe(0),
    );

    registration.dispose();
  });

  it("binds screenshots and explicit main-world scripts to one page revision", async () => {
    const run = vi.fn(async () => ({
      requestId: "page-request",
      navigationEpoch: 7,
      value: { component: "InviteButton" },
    }));
    const capture = vi.fn(async () => ({
      navigationEpoch: 7,
      dataUrl: "data:image/png;base64,aQ==",
      pixelSize: { width: 1200, height: 800 },
    }));
    const registration = registerBrowserControlTab({
      active: true,
      desktopBrowser: {
        navigate: vi.fn(),
        experimental_cancelBrowserPageScript: vi.fn(),
        experimental_runBrowserPageScript: run,
        experimental_captureBrowserPage: capture,
      } as never,
      projectId: "project-a",
      state: {
        tabId: "tab-a",
        url: "https://example.test/",
        title: "Example",
        navigationEpoch: 7,
      } as never,
      tabId: "tab-a",
      threadId: "thread-a",
      url: "https://example.test/",
    });

    socket.request?.(
      request({
        requestId: "script-request",
        action: {
          kind: "script",
          world: "main",
          source: "() => ({ component: 'InviteButton' })",
          input: null,
          timeoutMs: 1_000,
        },
      }),
    );
    await vi.waitFor(() =>
      expect(run).toHaveBeenCalledWith(
        expect.objectContaining({
          tabId: "tab-a",
          world: "main",
          source: "() => ({ component: 'InviteButton' })",
        }),
      ),
    );

    socket.request?.(
      request({
        requestId: "screenshot-request",
        action: { kind: "screenshot", format: "png" },
      }),
    );
    await vi.waitFor(() =>
      expect(capture).toHaveBeenCalledWith({
        tabId: "tab-a",
        format: "png",
        quality: 85,
        expectedNavigationEpoch: 7,
      }),
    );
    await vi.waitFor(() =>
      expect(socket.sendBrowserControlResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: "screenshot-request",
          ok: true,
          value: expect.objectContaining({ navigationEpoch: 7 }),
        }),
      ),
    );

    registration.dispose();
  });

  it("rejects a request for a stale navigation epoch", async () => {
    const run = vi.fn();
    const registration = registerBrowserControlTab({
      active: true,
      desktopBrowser: {
        navigate: vi.fn(),
        experimental_cancelBrowserPageScript: vi.fn(),
        experimental_runBrowserPageScript: run,
      } as never,
      projectId: null,
      state: {
        tabId: "tab-a",
        url: "https://example.test/",
        title: "Example",
        navigationEpoch: 7,
      } as never,
      tabId: "tab-a",
      threadId: null,
      url: "https://example.test/",
    });
    const stale = request();
    stale.target.navigationEpoch = 6;
    socket.request?.(stale);
    await vi.waitFor(() =>
      expect(socket.sendBrowserControlResponse).toHaveBeenCalledWith({
        type: "browser-control-response",
        requestId: "request-a",
        target: stale.target,
        ok: false,
        error: {
          code: "BrowserControlTargetChangedError",
          message: "The target Browser tab is no longer at that page revision",
        },
      }),
    );
    expect(run).not.toHaveBeenCalled();
    registration.dispose();
  });

  it("uses acknowledged epoch-bound navigation", async () => {
    const navigate = vi.fn(async () => ({
      navigationEpoch: 7,
      url: "https://example.test/next",
    }));
    const registration = registerBrowserControlTab({
      active: true,
      desktopBrowser: {
        navigate: vi.fn(),
        experimental_navigateBrowserPage: navigate,
      } as never,
      projectId: null,
      state: {
        tabId: "tab-a",
        url: "https://example.test/",
        title: "Example",
        navigationEpoch: 7,
      } as never,
      tabId: "tab-a",
      threadId: null,
      url: "https://example.test/",
    });

    socket.request?.(
      request({
        action: { kind: "navigate", url: "https://example.test/next" },
      }),
    );
    await vi.waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({
        tabId: "tab-a",
        url: "https://example.test/next",
        expectedNavigationEpoch: 7,
      }),
    );
    await vi.waitFor(() =>
      expect(socket.sendBrowserControlResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: "request-a",
          ok: true,
          value: {
            navigating: true,
            url: "https://example.test/next",
          },
        }),
      ),
    );
    registration.dispose();
  });

  it("cancels active work when its tab registration is disposed", async () => {
    let rejectRun!: (error: Error) => void;
    const run = vi.fn(
      () =>
        new Promise<never>((_resolve, reject) => {
          rejectRun = reject;
        }),
    );
    const cancelPageScript = vi.fn(() =>
      rejectRun(new DOMException("disposed", "AbortError")),
    );
    const registration = registerBrowserControlTab({
      active: true,
      desktopBrowser: {
        navigate: vi.fn(),
        experimental_cancelBrowserPageScript: cancelPageScript,
        experimental_runBrowserPageScript: run,
      } as never,
      projectId: null,
      state: {
        tabId: "tab-a",
        url: "https://example.test/",
        title: "Example",
        navigationEpoch: 7,
      } as never,
      tabId: "tab-a",
      threadId: null,
      url: "https://example.test/",
    });

    socket.request?.(request());
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
    registration.dispose();
    await vi.waitFor(() => expect(cancelPageScript).toHaveBeenCalledOnce());
    await vi.waitFor(() =>
      expect(socket.sendBrowserControlResponse).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: "request-a", ok: false }),
      ),
    );
  });

  it("cancels active work when another registration replaces its tab", async () => {
    let rejectRun!: (error: Error) => void;
    const run = vi.fn(
      () =>
        new Promise<never>((_resolve, reject) => {
          rejectRun = reject;
        }),
    );
    const cancelPageScript = vi.fn(() =>
      rejectRun(new DOMException("replaced", "AbortError")),
    );
    const first = registerBrowserControlTab({
      active: true,
      desktopBrowser: {
        navigate: vi.fn(),
        experimental_cancelBrowserPageScript: cancelPageScript,
        experimental_runBrowserPageScript: run,
      } as never,
      projectId: null,
      state: {
        tabId: "tab-a",
        url: "https://example.test/",
        title: "Example",
        navigationEpoch: 7,
      } as never,
      tabId: "tab-a",
      threadId: null,
      url: "https://example.test/",
    });
    socket.request?.(request());
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());

    const replacement = registerBrowserControlTab({
      active: true,
      desktopBrowser: { navigate: vi.fn() } as never,
      projectId: null,
      state: {
        tabId: "tab-a",
        url: "https://replacement.test/",
        title: "Replacement",
        navigationEpoch: 8,
      } as never,
      tabId: "tab-a",
      threadId: null,
      url: "https://replacement.test/",
    });

    await vi.waitFor(() => expect(cancelPageScript).toHaveBeenCalledOnce());
    await vi.waitFor(() =>
      expect(socket.sendBrowserControlResponse).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: "request-a", ok: false }),
      ),
    );
    first.dispose();
    replacement.dispose();
  });
});
