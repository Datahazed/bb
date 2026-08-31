// @vitest-environment jsdom

import { createStore } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  normalizeSidebarRegionOrder,
  reorderSidebarRegions,
  SIDEBAR_REGION_ORDER_STORAGE_KEY,
  sidebarRegionOrderAtom,
} from "./sidebarRegionOrderPreferences";

afterEach(() => {
  window.localStorage.clear();
  vi.resetModules();
});
describe("sidebar region order preferences", () => {
  it("defaults to BB controls, Plugins, then Threads", () => {
    const store = createStore();

    expect(store.get(sidebarRegionOrderAtom)).toEqual([
      "bb-controls",
      "plugins",
      "threads",
    ]);
  });

  it("drops unknown and duplicate ids and appends missing regions", () => {
    expect(
      normalizeSidebarRegionOrder([
        "threads",
        "unknown",
        "threads",
        "bb-controls",
      ]),
    ).toEqual(["bb-controls", "plugins", "threads"]);
    expect(
      normalizeSidebarRegionOrder([
        "thread-list",
        "new-thread-extensions",
        "plugin-pages",
      ]),
    ).toEqual(["bb-controls", "plugins", "threads"]);
    expect(normalizeSidebarRegionOrder({ order: ["threads"] })).toEqual([
      "bb-controls",
      "plugins",
      "threads",
    ]);
  });

  it("normalizes and rewrites legacy stored order when the atom reads it", async () => {
    window.localStorage.setItem(
      SIDEBAR_REGION_ORDER_STORAGE_KEY,
      JSON.stringify(["thread-list", "thread-list", "unknown"]),
    );
    vi.resetModules();
    const reloadedModule = await import("./sidebarRegionOrderPreferences");
    const store = createStore();

    expect(store.get(reloadedModule.sidebarRegionOrderAtom)).toEqual([
      "bb-controls",
      "plugins",
      "threads",
    ]);
    expect(window.localStorage.getItem(SIDEBAR_REGION_ORDER_STORAGE_KEY)).toBe(
      JSON.stringify(["new-thread-extensions", "plugin-pages", "thread-list"]),
    );
  });

  it("moves reorderable regions but keeps Threads last", () => {
    expect(
      reorderSidebarRegions(
        ["bb-controls", "plugins", "threads"],
        "plugins",
        "bb-controls",
      ),
    ).toEqual(["plugins", "bb-controls", "threads"]);
    expect(
      reorderSidebarRegions(
        ["bb-controls", "plugins", "threads"],
        "threads",
        "bb-controls",
      ),
    ).toEqual(["bb-controls", "plugins", "threads"]);
  });
});
