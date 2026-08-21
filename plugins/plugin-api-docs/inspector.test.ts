// @vitest-environment jsdom

import type {
  ExperimentalUiInspectionApi,
  ExperimentalUiInspectionSessionEvent,
  ExperimentalUiInspectionTarget,
  PluginContentScriptContext,
} from "@get-bb/plugin-sdk";
import { loadPluginApp } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createInspectionPayload,
  createPluginGuideInspector,
  formatInspectionAgentPrompt,
} from "./inspector";

const app = await loadPluginApp(() => import("./app"));

function targetFixture(): ExperimentalUiInspectionTarget {
  const appWindow = document.createElement("main");
  const footer = document.createElement("div");
  const button = document.createElement("button");
  button.setAttribute("aria-label", "Inspect bb UI");
  footer.append(button);
  appWindow.append(footer);
  document.body.append(appWindow);
  const style = {
    display: "flex",
    position: "static",
    color: "rgb(240, 240, 244)",
    backgroundColor: "rgb(24, 24, 30)",
    fontFamily: "Inter",
    fontSize: "12px",
    fontWeight: "500",
    lineHeight: "16px",
    padding: "4px",
    margin: "0px",
    border: "0px none rgb(0, 0, 0)",
    borderRadius: "6px",
    gap: "4px",
    opacity: "1",
  };
  const accessibility = {
    role: "button",
    name: "Inspect bb UI",
    disabled: false,
    expanded: null,
    pressed: true,
    selected: null,
  };
  const core = {
    element: appWindow,
    metadata: {
      codeName: "app.window",
      name: "App window",
      kind: "window",
    },
    source: { kind: "core" as const },
    bounds: {
      x: 0,
      y: 0,
      width: 1200,
      height: 800,
      top: 0,
      right: 1200,
      bottom: 800,
      left: 0,
    },
    style,
    accessibility: { ...accessibility, role: "main", name: "App window" },
  };
  const action = {
    element: button,
    metadata: {
      codeName: "app.sidebar.footer-actions.plugin-api-docs.ui-inspector",
      name: "Inspect bb UI",
      kind: "action",
      component: "SidebarMenuButton",
      variant: "icon",
      state: { active: true },
      tokens: ["sidebar-accent", "ring"],
      context: { pluginId: "plugin-api-docs" },
    },
    source: { kind: "core" as const },
    bounds: {
      x: 12,
      y: 744,
      width: 28,
      height: 28,
      top: 744,
      right: 40,
      bottom: 772,
      left: 12,
    },
    style,
    accessibility,
  };
  return { target: action, hierarchy: [core, action] };
}

function inspectionHost() {
  let onEvent:
    | ((event: ExperimentalUiInspectionSessionEvent) => void)
    | undefined;
  const dispose = vi.fn();
  const inspection: ExperimentalUiInspectionApi = {
    register: vi.fn(() => ({ dispose: vi.fn() })),
    startSession: vi.fn((options) => {
      onEvent = options.onEvent;
      return { dispose };
    }),
  };
  return {
    inspection,
    dispose,
    emit(event: ExperimentalUiInspectionSessionEvent) {
      if (!onEvent) throw new Error("inspection session has not started");
      onEvent(event);
    },
  };
}

afterEach(() => {
  document.head.replaceChildren();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("Plugin Guide inspector", () => {
  it("registers one footer entry and routes footer and shortcut through one toggle", async () => {
    expect(app.sidebarFooterActions).toMatchObject([
      {
        id: "ui-inspector",
        title: "Inspect bb UI",
        icon: "Target",
        experimental_activeTitle: "Stop inspecting bb UI",
        experimental_activeIndicator: "dot",
      },
    ]);
    expect(app.contentScripts.map(({ id }) => id)).toEqual(["ui-inspector"]);

    const host = inspectionHost();
    const active = vi.fn();
    let command: (() => void) | undefined;
    const unregister = vi.fn();
    const cleanup = await app.contentScripts[0]!.mount({
      pluginId: "plugin-api-docs",
      generation: 1,
      signal: new AbortController().signal,
      experimental_uiInspection: host.inspection,
      experimental_setSidebarFooterActionActive: (_id, value) => active(value),
      experimental_registerAppCommandHandler: (_id, handler) => {
        command = handler;
        return unregister;
      },
    } satisfies PluginContentScriptContext);

    app.sidebarFooterActions[0]!.run({ openSettings: vi.fn() });
    expect(active).toHaveBeenLastCalledWith(true);
    expect(host.inspection.startSession).toHaveBeenCalledTimes(1);

    command?.();
    expect(active).toHaveBeenLastCalledWith(false);
    expect(host.dispose).toHaveBeenCalledTimes(1);

    await cleanup?.();
    expect(unregister).toHaveBeenCalledTimes(1);
  });

  it("shows structured hover details, pins on select, and copies a serializable payload", async () => {
    const host = inspectionHost();
    const writeText = vi.fn(async () => undefined);
    const active = vi.fn();
    const inspector = createPluginGuideInspector({
      document,
      inspection: host.inspection,
      clipboard: { writeText },
      setFooterActive: active,
      now: () => new Date("2026-08-21T15:00:00.000Z"),
    });
    const target = targetFixture();

    inspector.start();
    host.emit({ type: "hover", target, pointer: { x: 20, y: 30 } });
    expect(inspector.mode).toBe("hover");
    expect(document.body.textContent).toContain(
      "app.window / app.sidebar.footer-actions.plugin-api-docs.ui-inspector",
    );
    expect(document.body.textContent).toContain("SidebarMenuButton · icon");
    expect(document.body.textContent).toContain("sidebar-accent");

    host.emit({ type: "select", target, pointer: { x: 20, y: 30 } });
    expect(inspector.mode).toBe("pinned");
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(
      document.querySelector("[data-bb-plugin-guide-inspector-outline]"),
    ).not.toBeNull();

    const copy = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "Copy payload",
    );
    copy?.click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied = JSON.parse(writeText.mock.calls[0]![0]);
    expect(copied).toMatchObject({
      version: 1,
      path: [
        "app.window",
        "app.sidebar.footer-actions.plugin-api-docs.ui-inspector",
      ],
      target: {
        name: "Inspect bb UI",
        bounds: { width: 28, height: 28 },
      },
    });
    expect(JSON.stringify(copied)).not.toContain("HTMLButtonElement");
    expect(active).toHaveBeenCalledWith(true);
  });

  it("measures a populated hover card before keeping it inside the viewport", () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1280,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 900,
    });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        const populated = this.querySelector(".pgi-body") !== null;
        return DOMRect.fromRect({
          width: populated ? 380 : 0,
          height: populated ? 302 : 0,
        });
      },
    );
    const host = inspectionHost();
    const inspector = createPluginGuideInspector({
      document,
      inspection: host.inspection,
    });

    inspector.start();
    host.emit({
      type: "hover",
      target: targetFixture(),
      pointer: { x: 80, y: 860 },
    });

    const card = document.querySelector<HTMLElement>(
      "[data-bb-plugin-guide-inspector-card]",
    );
    expect(card?.style.left).toBe("92px");
    expect(card?.style.top).toBe("586px");
  });

  it("unwinds handoff, pin, and active states with Escape", async () => {
    const host = inspectionHost();
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify([
            {
              id: "thr_existing",
              title: "Existing agent thread",
              titleFallback: null,
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    const active = vi.fn();
    const inspector = createPluginGuideInspector({
      document,
      inspection: host.inspection,
      fetch: fetchMock,
      setFooterActive: active,
    });
    const target = targetFixture();

    inspector.start();
    host.emit({ type: "select", target, pointer: { x: 20, y: 30 } });
    const handoff = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "Send to thread",
    );
    handoff?.click();
    await vi.waitFor(() => expect(inspector.mode).toBe("handoff"));

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(inspector.mode).toBe("pinned");
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(inspector.mode).toBe("active");
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(inspector.mode).toBe("idle");
    expect(active).toHaveBeenLastCalledWith(false);
  });

  it("shows unavailable metadata and contained inspector errors", () => {
    const active = vi.fn();
    const unavailable = createPluginGuideInspector({
      document,
      setFooterActive: active,
    });
    unavailable.start();
    expect(unavailable.mode).toBe("unavailable");
    expect(document.body.textContent).toContain("Inspector unavailable");
    unavailable.stop();

    const host = inspectionHost();
    const inspector = createPluginGuideInspector({
      document,
      inspection: host.inspection,
    });
    inspector.start();
    host.emit({
      type: "hover",
      target: null,
      pointer: { x: 20, y: 30 },
    });
    expect(document.body.textContent).toContain("No inspection metadata");
    host.emit({ type: "error", code: "internal", message: "Snapshot failed." });
    expect(inspector.mode).toBe("error");
    expect(document.body.textContent).toContain("Snapshot failed.");
  });

  it("sends to an existing thread and opens a new composer with useful context", async () => {
    const host = inspectionHost();
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      requests.push({ url, init });
      if (url.includes("/send")) return new Response("{}", { status: 200 });
      return new Response(
        JSON.stringify([
          {
            id: "thr_existing",
            title: "Existing agent thread",
            titleFallback: null,
          },
        ]),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const navigateToCompose = vi.fn();
    const inspector = createPluginGuideInspector({
      document,
      inspection: host.inspection,
      fetch: fetchMock,
      navigateToCompose,
    });
    const target = targetFixture();
    inspector.start();
    host.emit({ type: "select", target, pointer: { x: 20, y: 30 } });

    [...document.querySelectorAll("button")]
      .find((button) => button.textContent === "Send to thread")
      ?.click();
    await vi.waitFor(() =>
      expect(document.querySelector("select")?.value).toBe("thr_existing"),
    );
    [...document.querySelectorAll("button")]
      .find((button) => button.textContent === "Send")
      ?.click();
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1]!.url).toBe("/api/v1/threads/thr_existing/send");
    expect(JSON.parse(String(requests[1]!.init?.body))).toMatchObject({
      mode: "queue-if-active",
      input: [{ type: "text", mentions: [] }],
    });

    [...document.querySelectorAll("button")]
      .find((button) => button.textContent === "New thread")
      ?.click();
    expect(navigateToCompose).toHaveBeenCalledTimes(1);
    expect(navigateToCompose.mock.calls[0]![0]).toContain(
      "app.window / app.sidebar.footer-actions.plugin-api-docs.ui-inspector",
    );
  });

  it("places new-thread context in React Router location state", () => {
    const host = inspectionHost();
    const inspector = createPluginGuideInspector({
      document,
      inspection: host.inspection,
    });
    inspector.start();
    host.emit({
      type: "select",
      target: targetFixture(),
      pointer: { x: 20, y: 30 },
    });

    [...document.querySelectorAll("button")]
      .find((button) => button.textContent === "New thread")
      ?.click();

    expect(window.location.pathname).toBe("/");
    expect(window.history.state).toMatchObject({
      idx: expect.any(Number),
      key: expect.any(String),
      usr: {
        focusPrompt: true,
        replaceInitialPrompt: true,
        initialPrompt: expect.stringContaining(
          "app.window / app.sidebar.footer-actions.plugin-api-docs.ui-inspector",
        ),
      },
    });
  });
});

describe("inspection handoff payload", () => {
  it("keeps one serializable source of truth for copy and agent prompts", () => {
    const payload = createInspectionPayload(
      targetFixture(),
      new Date("2026-08-21T15:00:00.000Z"),
    );
    const prompt = formatInspectionAgentPrompt(payload);
    expect(prompt).toContain(
      "I inspected this bb UI element with Plugin Guide",
    );
    expect(prompt).toContain('"width": 28');
    expect(prompt).toContain('"left": 12');
  });
});
