import { describe, expect, it } from "vitest";
import {
  PLUGIN_CAPTURE_SURFACES,
  planPluginCapture,
  pluginCaptureSurface,
} from "../src/plugin-capture.js";

describe("planPluginCapture", () => {
  it("plans nothing for a plugin with no visual surfaces", () => {
    // An agent-tool or provider plugin has nothing to photograph; a listing
    // must not be held up waiting for a screenshot that cannot exist.
    expect(planPluginCapture({ pluginId: "unslop", slots: [] })).toEqual([]);
  });

  it("routes a nav panel to the panel's own URL", () => {
    const steps = planPluginCapture({
      pluginId: "tasks",
      slots: ["navPanel"],
      panelPaths: ["board"],
    });
    expect(steps).toEqual([
      {
        slot: "navPanel",
        kind: "route",
        url: "/plugins/tasks/board",
        outputFile: "01-panel.png",
        requires: null,
      },
    ]);
  });

  it("captures every panel a plugin contributes, numbered", () => {
    const steps = planPluginCapture({
      pluginId: "tasks",
      slots: ["navPanel"],
      panelPaths: ["board", "backlog"],
    });
    expect(steps.map((step) => step.outputFile)).toEqual([
      "01-panel-1.png",
      "01-panel-2.png",
    ]);
    expect(steps.map((step) => step.url)).toEqual([
      "/plugins/tasks/board",
      "/plugins/tasks/backlog",
    ]);
  });

  it("drops fixture surfaces when no fixture thread is available", () => {
    // Pointing these at a thread route without a seeded thread photographs the
    // empty app, which is worse for a listing than having no shot at all.
    const steps = planPluginCapture({
      pluginId: "side-chat",
      slots: ["messageDirective", "threadPanelAction"],
    });
    expect(steps).toEqual([]);
  });

  it("drives fixture surfaces at the shared fixture thread", () => {
    const steps = planPluginCapture({
      pluginId: "side-chat",
      slots: ["messageDirective"],
      fixtureThreadId: "thr_fixture",
    });
    expect(steps).toEqual([
      {
        slot: "messageDirective",
        kind: "fixture",
        url: "/threads/thr_fixture",
        outputFile: "06-message.png",
        requires: "a thread whose last message carries the plugin's directive",
      },
    ]);
  });

  it("orders steps by surface, not by the order slots were registered", () => {
    const steps = planPluginCapture({
      pluginId: "kitchen-sink",
      slots: ["sidebarFooterAction", "homepageSection", "navPanel"],
      panelPaths: ["main"],
    });
    expect(steps.map((step) => step.slot)).toEqual([
      "navPanel",
      "homepageSection",
      "sidebarFooterAction",
    ]);
  });

  it("ignores slots that are not capturable surfaces", () => {
    const steps = planPluginCapture({
      pluginId: "memory",
      slots: ["bb.agents", "registerMentionProvider"],
    });
    expect(steps).toEqual([]);
  });
});

describe("the surface catalog", () => {
  it("gives every surface a unique output stem", () => {
    const stems = PLUGIN_CAPTURE_SURFACES.map((surface) => surface.stem);
    expect(new Set(stems).size).toBe(stems.length);
  });

  it("explains what every fixture surface needs arranged", () => {
    for (const surface of PLUGIN_CAPTURE_SURFACES) {
      if (surface.kind === "fixture") {
        expect(surface.requires, surface.slot).toBeTruthy();
      }
    }
  });

  it("looks a surface up by slot", () => {
    expect(pluginCaptureSurface("navPanel")?.kind).toBe("route");
    expect(pluginCaptureSurface("nope")).toBeUndefined();
  });
});
