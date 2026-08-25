import { describe, expect, it } from "vitest";
import { detectPluginSurfaces } from "../src/plugin-surface-detect.js";

describe("detectPluginSurfaces", () => {
  it("finds nothing in a plugin with no frontend", () => {
    const source = `export default function backend(bb) { bb.agents.registerTool(); }`;
    expect(detectPluginSurfaces(source)).toEqual({ slots: [], panelPaths: [] });
  });

  it("reads a nav panel and the path it owns", () => {
    const source = `
      export default definePluginApp((app) => {
        app.slots.navPanel({ path: "board", title: "Board", component: Board });
      });
    `;
    expect(detectPluginSurfaces(source)).toEqual({
      slots: ["navPanel"],
      panelPaths: ["board"],
    });
  });

  it("normalises a leading slash on a panel path", () => {
    const source = `app.slots.navPanel({ path: "/board", component: Board });`;
    expect(detectPluginSurfaces(source).panelPaths).toEqual(["board"]);
  });

  it("keeps every panel a plugin registers, in order", () => {
    const source = `
      app.slots.navPanel({ path: "board", component: Board });
      app.slots.navPanel({ path: "backlog", component: Backlog });
    `;
    expect(detectPluginSurfaces(source).panelPaths).toEqual([
      "board",
      "backlog",
    ]);
  });

  it("returns slots in catalog order, not registration order", () => {
    const source = `
      app.slots.sidebarFooterAction({ component: Footer });
      app.slots.navPanel({ path: "main", component: Main });
      app.slots.homepageSection({ component: Home });
    `;
    expect(detectPluginSurfaces(source).slots).toEqual([
      "navPanel",
      "homepageSection",
      "sidebarFooterAction",
    ]);
  });

  it("detects composer customisation, which is not a slot call", () => {
    const source = `app.composer.customize({ actions: [improve] });`;
    expect(detectPluginSurfaces(source).slots).toEqual(["composer.customize"]);
  });

  it("ignores slots that are only named in a comment", () => {
    // A plugin that documents what it does not do must not be photographed
    // against a surface it never paints.
    const source = `
      // app.slots.homepageSection is deliberately not used here.
      /* app.slots.navPanel({ path: "old" }) — removed in 2.0 */
      app.slots.settingsSection({ component: Settings });
    `;
    expect(detectPluginSurfaces(source)).toEqual({
      slots: ["settingsSection"],
      panelPaths: [],
    });
  });

  it("ignores registrations that are not capturable surfaces", () => {
    const source = `app.slots.messageAction({ id: "quote" });`;
    expect(detectPluginSurfaces(source).slots).toEqual([]);
  });

  it("does not mistake a similarly named method for a slot", () => {
    const source = `myOwnSlots.navPanel({ path: "nope" });`;
    expect(detectPluginSurfaces(source).slots).toEqual([]);
  });
});
