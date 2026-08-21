// @vitest-environment jsdom

import type { ExperimentalUiInspectionSessionEvent } from "@get-bb/plugin-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createPluginUiInspectionApi,
  registerUiInspectionMetadata,
  resolveUiInspectionTarget,
  startUiInspectionSession,
} from "./ui-inspection";

function pointerEvent(
  type: string,
  init: {
    target: Element;
    pointerId?: number;
    button?: number;
    isPrimary?: boolean;
    clientX?: number;
    clientY?: number;
  },
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    pointerId: { value: init.pointerId ?? 1 },
    button: { value: init.button ?? 0 },
    isPrimary: { value: init.isPrimary ?? true },
    clientX: { value: init.clientX ?? 12 },
    clientY: { value: init.clientY ?? 24 },
  });
  init.target.dispatchEvent(event);
  return event;
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("UI inspection registry", () => {
  it("resolves data attributes and logical parents root-to-target", () => {
    const app = document.createElement("main");
    app.dataset.codeName = "app window";
    app.dataset.codeLabel = "App window";
    app.dataset.codeKind = "window";
    const sidebar = document.createElement("aside");
    const action = document.createElement("button");
    action.textContent = "Inspect";
    action.setAttribute("aria-pressed", "true");
    sidebar.append(action);
    app.append(sidebar);
    document.body.append(app);

    const sidebarRegistration = registerUiInspectionMetadata(sidebar, {
      codeName: "left sidebar",
      name: "Left sidebar",
      kind: "region",
      component: "Sidebar",
      tokens: ["surface-sidebar"],
    });
    const actionRegistration = registerUiInspectionMetadata(action, {
      codeName: "footer actions",
      name: "Footer actions",
      kind: "action",
      logicalParent: app,
    });

    const result = resolveUiInspectionTarget(action.firstChild?.parentElement!);

    expect(result?.hierarchy.map(({ metadata }) => metadata.codeName)).toEqual([
      "app window",
      "footer actions",
    ]);
    expect(result?.target).toMatchObject({
      metadata: {
        codeName: "footer actions",
        name: "Footer actions",
        kind: "action",
      },
      source: { kind: "core" },
      accessibility: {
        role: "button",
        name: "Inspect",
        pressed: true,
      },
    });
    expect(result?.target.metadata).not.toHaveProperty("logicalParent");

    actionRegistration.dispose();
    sidebarRegistration.dispose();
  });

  it("stamps plugin identity and aborts every generation-owned handle once", () => {
    const controller = new AbortController();
    const element = document.createElement("div");
    document.body.append(element);
    const api = createPluginUiInspectionApi("plugin-guide", controller.signal);
    const registration = api.register(element, {
      codeName: "inspect card",
      name: "Inspect card",
      kind: "card",
    });
    const session = api.startSession({ onEvent() {} });

    expect(resolveUiInspectionTarget(element)?.target.source).toEqual({
      kind: "plugin",
      pluginId: "plugin-guide",
    });
    expect(
      document.querySelectorAll("[data-bb-ui-inspection-overlay]"),
    ).toHaveLength(1);

    controller.abort();
    controller.abort();
    registration.dispose();
    session.dispose();

    expect(resolveUiInspectionTarget(element)).toBeNull();
    expect(
      document.querySelector("[data-bb-ui-inspection-overlay]"),
    ).toBeNull();
  });
});

describe("UI inspection session", () => {
  it("coalesces hover work, highlights without layout input, and cleans up", () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    const cancelFrame = vi
      .spyOn(window, "cancelAnimationFrame")
      .mockImplementation(() => undefined);
    const element = document.createElement("button");
    element.dataset.codeName = "action";
    vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
      x: 10,
      y: 20,
      width: 100,
      height: 30,
      top: 20,
      right: 110,
      bottom: 50,
      left: 10,
      toJSON: () => ({}),
    });
    document.body.append(element);
    const events: ExperimentalUiInspectionSessionEvent[] = [];
    const session = startUiInspectionSession({
      onEvent: (event) => events.push(event),
    });

    pointerEvent("pointermove", { target: element, clientX: 10 });
    pointerEvent("pointermove", { target: element, clientX: 20 });
    expect(frames).toHaveLength(1);
    frames[0]?.(0);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "hover",
      pointer: { x: 20, y: 24 },
      target: { target: { metadata: { codeName: "action" } } },
    });
    const overlay = document.querySelector<HTMLElement>(
      "[data-bb-ui-inspection-overlay]",
    );
    expect(overlay?.style).toMatchObject({
      pointerEvents: "none",
      position: "fixed",
      left: "10px",
      top: "20px",
      width: "100px",
      height: "30px",
    });

    pointerEvent("pointermove", { target: element });
    session.dispose();
    session.dispose();
    expect(cancelFrame).toHaveBeenCalledTimes(1);
    expect(
      document.querySelector("[data-bb-ui-inspection-overlay]"),
    ).toBeNull();
    frames[1]?.(1);
    expect(events).toHaveLength(1);
  });

  it("consumes only a matching primary activation and selects the frozen target", () => {
    const element = document.createElement("button");
    element.dataset.codeName = "new thread";
    document.body.append(element);
    const underlying = vi.fn();
    element.addEventListener("click", underlying);
    const events: ExperimentalUiInspectionSessionEvent[] = [];
    const session = startUiInspectionSession({
      onEvent: (event) => events.push(event),
    });

    const secondary = pointerEvent("pointerdown", {
      target: element,
      button: 2,
    });
    expect(secondary.defaultPrevented).toBe(false);

    const down = pointerEvent("pointerdown", { target: element, pointerId: 7 });
    const unrelatedUp = pointerEvent("pointerup", {
      target: element,
      pointerId: 8,
    });
    const up = pointerEvent("pointerup", { target: element, pointerId: 7 });
    const click = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 0,
    });
    element.dispatchEvent(click);

    expect(down.defaultPrevented).toBe(true);
    expect(unrelatedUp.defaultPrevented).toBe(false);
    expect(up.defaultPrevented).toBe(true);
    expect(click.defaultPrevented).toBe(true);
    expect(underlying).not.toHaveBeenCalled();
    expect(events.filter(({ type }) => type === "select")).toHaveLength(1);
    expect(events.find(({ type }) => type === "select")).toMatchObject({
      target: { target: { metadata: { codeName: "new thread" } } },
    });
    session.dispose();
  });

  it("reports a frozen target that detaches before selection", () => {
    const element = document.createElement("button");
    element.dataset.codeName = "removed";
    document.body.append(element);
    const events: ExperimentalUiInspectionSessionEvent[] = [];
    const session = startUiInspectionSession({
      onEvent: (event) => events.push(event),
    });

    pointerEvent("pointerdown", { target: element, pointerId: 3 });
    element.remove();
    pointerEvent("pointerup", { target: document.body, pointerId: 3 });

    expect(events).toContainEqual({
      type: "error",
      code: "target-detached",
      message: "The inspected element is no longer attached.",
    });
    expect(events.some(({ type }) => type === "select")).toBe(false);
    session.dispose();
  });

  it("contains callback errors and continues delivering events", () => {
    const warn = vi.fn();
    const element = document.createElement("button");
    element.dataset.codeName = "action";
    document.body.append(element);
    const onEvent = vi
      .fn<(event: ExperimentalUiInspectionSessionEvent) => void>()
      .mockImplementationOnce(() => {
        throw new Error("plugin exploded");
      });
    const session = startUiInspectionSession({ onEvent }, document, warn);

    pointerEvent("pointerdown", { target: element, pointerId: 1 });
    pointerEvent("pointerup", { target: element, pointerId: 1 });
    pointerEvent("pointerdown", { target: element, pointerId: 2 });
    pointerEvent("pointerup", { target: element, pointerId: 2 });

    expect(onEvent).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(
      "bb UI inspection callback failed: plugin exploded",
    );
    session.dispose();
  });
});
