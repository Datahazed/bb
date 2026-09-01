// @vitest-environment jsdom

import { createStore } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  window.localStorage.clear();
  vi.resetModules();
});

describe("pluginNavPanelOrderAtom migration", () => {
  it("converts legacy hidden keys into positional overflow order", async () => {
    window.localStorage.setItem(
      "bb.sidebar.pluginPanelOrder",
      JSON.stringify(["docs/main", "tasks/main", "github/main"]),
    );
    window.localStorage.setItem(
      "bb.sidebar.hiddenPluginPanels",
      JSON.stringify(["tasks/main", "docs/main"]),
    );

    const { pluginNavPanelOrderAtom } = await import("./pluginNavSidebarAtoms");
    const store = createStore();

    expect(store.get(pluginNavPanelOrderAtom)).toEqual([
      "github/main",
      "docs/main",
      "tasks/main",
    ]);
    expect(
      window.localStorage.getItem("bb.sidebar.hiddenPluginPanels"),
    ).toBeNull();
  });

  it("preserves a hidden Automations key for customize migration", async () => {
    window.localStorage.setItem(
      "bb.sidebar.pluginPanelOrder",
      JSON.stringify(["docs/main"]),
    );
    window.localStorage.setItem(
      "bb.sidebar.hiddenPluginPanels",
      JSON.stringify(["docs/main", "automations/main"]),
    );

    const { pluginNavPanelOrderAtom } = await import("./pluginNavSidebarAtoms");
    const store = createStore();

    expect(store.get(pluginNavPanelOrderAtom)).toEqual(["docs/main"]);
    expect(
      window.localStorage.getItem("bb.sidebar.hiddenPluginPanels"),
    ).toBe(JSON.stringify(["automations/main"]));
  });
});
