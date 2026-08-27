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

  it("appends newly installed panels last instead of at the top of a customized list", () => {
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

  it("renders no row for an unregistered key but keeps its slot in the order", () => {
    // A plugin frontend can register after the sidebar mounts. Dropping the key
    // here would persist a shortened order and lose the user's arrangement.
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

  it("returns a late-registering panel to its stored slot", () => {
    const { ordered } = arrangePluginNavPanels({
      panels: [github, docs, tasks],
      storedOrder: ["tasks/board", "docs/vault", "github/pulls"],
    });

    expect(ordered.map(getPluginNavPanelKey)).toEqual([
      "tasks/board",
      "docs/vault",
      "github/pulls",
    ]);
  });

  it("ignores duplicate stored keys so a corrupted list can't render a panel twice", () => {
    const { ordered } = arrangePluginNavPanels({
      panels: [github, docs],
      storedOrder: ["github/pulls", "github/pulls", "docs/vault"],
    });

    expect(ordered.map(getPluginNavPanelKey)).toEqual([
      "github/pulls",
      "docs/vault",
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

  it("retains a legacy hidden key that was missing from the stored order", () => {
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
  it("moves a visible row to the target slot", () => {
    expect(
      reorderPluginNavPanels({
        activeKey: "tasks/board",
        overKey: "github/pulls",
        order: ["github/pulls", "docs/vault", "tasks/board"],
        visibleKeys: ["github/pulls", "docs/vault", "tasks/board"],
      }),
    ).toEqual(["tasks/board", "github/pulls", "docs/vault"]);
  });

  it("keeps hidden panels pinned to their index in the stored order", () => {
    expect(
      reorderPluginNavPanels({
        activeKey: "tasks/board",
        overKey: "github/pulls",
        order: ["github/pulls", "docs/vault", "tasks/board"],
        visibleKeys: ["github/pulls", "tasks/board"],
      }),
    ).toEqual(["tasks/board", "docs/vault", "github/pulls"]);
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

  it("returns null when the drop target is not a visible row", () => {
    expect(
      reorderPluginNavPanels({
        activeKey: "github/pulls",
        overKey: "docs/vault",
        order: ["github/pulls", "docs/vault"],
        visibleKeys: ["github/pulls"],
      }),
    ).toBeNull();
  });
});
