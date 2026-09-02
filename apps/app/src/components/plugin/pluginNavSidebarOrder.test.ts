import { describe, expect, it } from "vitest";
import {
  arrangePluginNavPanelPreferences,
  arrangePluginNavPanels,
  getPluginNavPanelKey,
  migrateLegacyHiddenPluginNavPanelOrder,
  reorderPluginNavPanels,
  togglePluginNavPanelVisibility,
} from "./pluginNavSidebarOrder";

function panel(pluginId: string, id: string) {
  return { pluginId, id };
}

const github = panel("github", "pulls");
const docs = panel("docs", "vault");
const tasks = panel("tasks", "board");

describe("arrangePluginNavPanels", () => {
  it("falls back to registry order before the user has reordered anything", () => {
    const { ordered, normalizedOrder } = arrangePluginNavPanels({
      panels: [github, docs, tasks],
      storedOrder: [],
    });

    expect(ordered.map(getPluginNavPanelKey)).toEqual([
      "github/pulls",
      "docs/vault",
      "tasks/board",
    ]);
    expect(normalizedOrder).toEqual([
      "github/pulls",
      "docs/vault",
      "tasks/board",
    ]);
  });

  it("appends newly installed panels last", () => {
    const { ordered } = arrangePluginNavPanels({
      panels: [github, docs, tasks],
      storedOrder: ["tasks/board", "github/pulls"],
    });

    expect(ordered.map(getPluginNavPanelKey)).toEqual([
      "tasks/board",
      "github/pulls",
      "docs/vault",
    ]);
  });

  it("keeps unregistered keys in the normalized order", () => {
    const { ordered, normalizedOrder } = arrangePluginNavPanels({
      panels: [github, docs],
      storedOrder: ["strudel/repl", "docs/vault", "github/pulls"],
    });

    expect(ordered.map(getPluginNavPanelKey)).toEqual([
      "docs/vault",
      "github/pulls",
    ]);
    expect(normalizedOrder).toEqual([
      "strudel/repl",
      "docs/vault",
      "github/pulls",
    ]);
  });
});

describe("arrangePluginNavPanelPreferences", () => {
  it("shows the first three ordered panels by default", () => {
    const extra = panel("calendar", "agenda");
    const result = arrangePluginNavPanelPreferences({
      panels: [github, docs, tasks, extra],
      storedOrder: ["tasks/board", "github/pulls"],
      storedVisibleKeys: null,
      defaultVisibleCount: 3,
    });

    expect(result.visible.map(getPluginNavPanelKey)).toEqual([
      "tasks/board",
      "github/pulls",
      "docs/vault",
    ]);
    expect(result.overflow.map(getPluginNavPanelKey)).toEqual([
      "calendar/agenda",
    ]);
    expect(result.visibleKeys).toEqual([
      "tasks/board",
      "github/pulls",
      "docs/vault",
    ]);
    expect(result.normalizedVisibleKeys).toBeNull();
  });

  it("keeps an explicit empty visible list meaningful", () => {
    const result = arrangePluginNavPanelPreferences({
      panels: [github, docs, tasks],
      storedOrder: [],
      storedVisibleKeys: [],
      defaultVisibleCount: 3,
    });

    expect(result.visible).toEqual([]);
    expect(result.overflow.map(getPluginNavPanelKey)).toEqual([
      "github/pulls",
      "docs/vault",
      "tasks/board",
    ]);
    expect(result.normalizedVisibleKeys).toEqual([]);
  });

  it("preserves visibility for a temporarily unregistered panel", () => {
    const result = arrangePluginNavPanelPreferences({
      panels: [github, docs, tasks],
      storedOrder: ["future/main", "docs/vault", "github/pulls"],
      storedVisibleKeys: ["future/main", "github/pulls", "future/main"],
      defaultVisibleCount: 3,
    });

    expect(result.visible.map(getPluginNavPanelKey)).toEqual(["github/pulls"]);
    expect(result.overflow.map(getPluginNavPanelKey)).toEqual([
      "docs/vault",
      "tasks/board",
    ]);
    expect(result.normalizedVisibleKeys).toEqual([
      "future/main",
      "github/pulls",
    ]);
  });

  it("places a newly installed unchecked panel in overflow", () => {
    const result = arrangePluginNavPanelPreferences({
      panels: [github, docs, tasks],
      storedOrder: ["github/pulls", "docs/vault"],
      storedVisibleKeys: ["github/pulls", "docs/vault"],
      defaultVisibleCount: 3,
    });

    expect(result.visible.map(getPluginNavPanelKey)).toEqual([
      "github/pulls",
      "docs/vault",
    ]);
    expect(result.overflow.map(getPluginNavPanelKey)).toEqual(["tasks/board"]);
    expect(result.normalizedOrder).toEqual([
      "github/pulls",
      "docs/vault",
      "tasks/board",
    ]);
  });

  it("uses the master order for both visible and overflow panels", () => {
    const result = arrangePluginNavPanelPreferences({
      panels: [github, docs, tasks],
      storedOrder: ["tasks/board", "github/pulls", "docs/vault"],
      storedVisibleKeys: ["docs/vault", "tasks/board"],
      defaultVisibleCount: 3,
    });

    expect(result.visible.map(getPluginNavPanelKey)).toEqual([
      "tasks/board",
      "docs/vault",
    ]);
    expect(result.overflow.map(getPluginNavPanelKey)).toEqual([
      "github/pulls",
    ]);
  });
});

describe("legacy hidden-panel migration", () => {
  it("moves hidden keys behind visible keys while preserving both orders", () => {
    expect(
      migrateLegacyHiddenPluginNavPanelOrder(
        ["tasks/board", "docs/vault", "github/pulls", "docs/vault"],
        ["tasks/board", "docs/vault"],
      ),
    ).toEqual(["github/pulls", "tasks/board", "docs/vault"]);
  });

  it("retains a hidden key missing from the stored order", () => {
    expect(
      migrateLegacyHiddenPluginNavPanelOrder(
        ["github/pulls"],
        ["docs/vault"],
      ),
    ).toEqual(["github/pulls", "docs/vault"]);
  });

});

describe("reorderPluginNavPanels", () => {
  it("moves a row across an overflow boundary", () => {
    const order = [
      "one/main",
      "two/main",
      "three/main",
      "four/main",
      "five/main",
      "six/main",
      "seven/main",
    ];

    expect(
      reorderPluginNavPanels({
        activeKey: "one/main",
        overKey: "six/main",
        order,
        visibleKeys: order,
      }),
    ).toEqual([
      "two/main",
      "three/main",
      "four/main",
      "five/main",
      "six/main",
      "one/main",
      "seven/main",
    ]);
  });

  it("returns null when the drag lands where it started", () => {
    expect(
      reorderPluginNavPanels({
        activeKey: "github/pulls",
        overKey: "github/pulls",
        order: ["github/pulls", "docs/vault"],
        visibleKeys: ["github/pulls", "docs/vault"],
      }),
    ).toBeNull();
  });
});

describe("togglePluginNavPanelVisibility", () => {
  it("checks and unchecks panels without losing other keys", () => {
    const checked = togglePluginNavPanelVisibility(
      ["github/pulls", "future/main"],
      "docs/vault",
      true,
    );

    expect(checked).toEqual([
      "github/pulls",
      "future/main",
      "docs/vault",
    ]);
    expect(
      togglePluginNavPanelVisibility(checked, "github/pulls", false),
    ).toEqual(["future/main", "docs/vault"]);
  });

  it("does not duplicate a checked panel", () => {
    expect(
      togglePluginNavPanelVisibility(
        ["github/pulls", "github/pulls"],
        "github/pulls",
        true,
      ),
    ).toEqual(["github/pulls"]);
  });
});
