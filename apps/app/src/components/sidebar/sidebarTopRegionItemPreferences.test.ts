// @vitest-environment jsdom

import { createStore } from "jotai";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_SIDEBAR_TOP_REGION_ITEM_PREFERENCES,
  migrateLegacySidebarTopRegionItems,
  normalizeSidebarTopRegionItemPreferences,
  reorderSidebarTopRegionItems,
  setSidebarTopRegionItemVisible,
  sidebarTopRegionItemPreferencesAtom,
} from "./sidebarTopRegionItemPreferences";

class MemoryStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

afterEach(() => {
  window.localStorage.clear();
});

describe("top-region sidebar item preferences", () => {
  it("defaults to all four host-owned items in approved order", () => {
    const store = createStore();

    expect(store.get(sidebarTopRegionItemPreferencesAtom)).toEqual({
      order: ["new-thread", "search", "extensions", "automations"],
      hiddenIds: [],
    });
  });

  it("normalizes duplicate, unknown, and missing ids without losing hidden choices", () => {
    expect(
      normalizeSidebarTopRegionItemPreferences({
        order: ["automations", "unknown", "automations"],
        hiddenIds: ["extensions", "unknown", "extensions"],
      }),
    ).toEqual({
      order: ["automations", "new-thread", "search", "extensions"],
      hiddenIds: ["extensions"],
    });
  });

  it("migrates both booleans and legacy hidden built-in panels atomically", () => {
    const storage = new MemoryStorage();
    storage.setItem("bb.sidebar.newThreadVisible", "false");
    storage.setItem("bb.sidebar.extensionsVisible", "true");
    storage.setItem(
      "bb.sidebar.hiddenPluginPanels",
      JSON.stringify(["docs/main", "__builtin__/tools", "automations/main"]),
    );

    expect(migrateLegacySidebarTopRegionItems(storage)).toEqual({
      order: ["new-thread", "search", "extensions", "automations"],
      hiddenIds: ["new-thread", "extensions", "automations"],
    });
    expect(storage.getItem("bb.sidebar.hiddenPluginPanels")).toBe(
      JSON.stringify(["docs/main"]),
    );
    expect(storage.getItem("bb.sidebar.newThreadVisible")).toBeNull();
    expect(storage.getItem("bb.sidebar.extensionsVisible")).toBeNull();
    expect(
      JSON.parse(storage.getItem("bb.sidebar.topRegionItems") ?? "{}"),
    ).toEqual({
      order: ["new-thread", "search", "extensions", "automations"],
      hiddenIds: ["new-thread", "extensions", "automations"],
    });
  });

  it("preserves an existing combined preference and only consumes owned legacy keys", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      "bb.sidebar.topRegionItems",
      JSON.stringify({
        order: ["automations", "extensions", "new-thread"],
        hiddenIds: ["extensions"],
      }),
    );
    storage.setItem(
      "bb.sidebar.hiddenPluginPanels",
      JSON.stringify(["automations/main", "docs/main"]),
    );

    expect(migrateLegacySidebarTopRegionItems(storage)).toEqual({
      order: ["automations", "extensions", "new-thread", "search"],
      hiddenIds: ["extensions"],
    });
    expect(storage.getItem("bb.sidebar.hiddenPluginPanels")).toBe(
      JSON.stringify(["docs/main"]),
    );
  });

  it("reorders live and can hide then restore every item", () => {
    const reordered = reorderSidebarTopRegionItems(
      DEFAULT_SIDEBAR_TOP_REGION_ITEM_PREFERENCES,
      "automations",
      "new-thread",
    );
    expect(reordered.order).toEqual([
      "automations",
      "new-thread",
      "search",
      "extensions",
    ]);

    let next = reordered;
    for (const id of reordered.order) {
      next = setSidebarTopRegionItemVisible(next, id, false);
    }
    expect(next.hiddenIds).toEqual([
      "automations",
      "new-thread",
      "search",
      "extensions",
    ]);
    next = setSidebarTopRegionItemVisible(next, "new-thread", true);
    expect(next.hiddenIds).toEqual(["automations", "search", "extensions"]);
  });

});
