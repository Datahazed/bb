import { describe, expect, it } from "vitest";
import {
  arrangePluginNavPanels,
  getPluginNavPanelKey,
  migrateLegacyHiddenPluginNavPanelOrder,
  movePluginNavPanelToTop,
  reorderPluginNavPanels,
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

  it("moves a panel to the top without duplicating it", () => {
    expect(
      movePluginNavPanelToTop(
        ["github/pulls", "docs/vault", "tasks/board"],
        "tasks/board",
      ),
    ).toEqual(["tasks/board", "github/pulls", "docs/vault"]);
  });
});

describe("reorderPluginNavPanels", () => {
  it("moves a row across the five-row overflow boundary", () => {
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
