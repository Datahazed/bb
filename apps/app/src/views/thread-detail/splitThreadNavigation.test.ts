import { describe, expect, it } from "vitest";
import {
  activePaneContent,
  findContentTab,
  findPane,
  findPaneByContent,
  findPaneByThread,
  listPanes,
  MAX_PANES,
  setFocus,
  splitPane,
} from "@/lib/split-layout";
import type { SplitLayout } from "@/lib/split-layout";
import {
  applyThreadOpenToLayout,
  applyThreadPaneActionToLayout,
  createSinglePaneLayout,
  focusedPaneRoute,
  focusedThreadRoute,
  reconcileLayoutForContent,
  reconcileLayoutForRoute,
} from "./splitThreadNavigation";

function twoPaneLayout(): SplitLayout {
  // pane-2 (thread-2) is focused (splitPane focuses the new pane); pane-1 holds
  // thread-1.
  return splitPane(
    createSinglePaneLayout({ projectId: "p1", threadId: "thread-1" }),
    "pane-1",
    "right",
    {
      kind: "thread",
      projectId: "p1",
      threadId: "thread-2",
    },
  );
}

function expectLayout(layout: SplitLayout | null): SplitLayout {
  expect(layout).not.toBeNull();
  if (layout === null) {
    throw new Error("Expected a split layout");
  }
  return layout;
}

function eightPaneLayout(): SplitLayout {
  let layout = twoPaneLayout();
  for (let index = 3; index <= MAX_PANES; index += 1) {
    layout = applyThreadOpenToLayout(
      layout,
      { projectId: "p1", threadId: `thread-${index}` },
      "right",
    );
  }
  return layout;
}

describe("reconcileLayoutForRoute", () => {
  it("seeds a single pane from the route when there is no layout (restore fallback)", () => {
    const layout = reconcileLayoutForRoute(null, {
      projectId: "p1",
      threadId: "thread-1",
    });

    expect(listPanes(layout.root)).toHaveLength(1);
    expect(layout.focusedPaneId).toBe("pane-1");
    expect(findPaneByThread(layout.root, "p1", "thread-1")?.paneId).toBe(
      "pane-1",
    );
  });

  it("adds a preview tab to the focused group, preserving committed tabs", () => {
    const before = twoPaneLayout();

    const after = reconcileLayoutForRoute(before, {
      projectId: "p1",
      threadId: "thread-3",
    });

    expect(listPanes(after.root)).toHaveLength(2);
    expect(after.focusedPaneId).toBe("pane-2");
    expect(findPaneByThread(after.root, "p1", "thread-3")?.paneId).toBe(
      "pane-2",
    );
    expect(findPaneByThread(after.root, "p1", "thread-1")?.paneId).toBe(
      "pane-1",
    );
    const focused = findPane(after.root, "pane-2")!;
    expect(focused.tabs).toHaveLength(2);
    expect(focused.tabs[0]?.content).toEqual({
      kind: "thread",
      projectId: "p1",
      threadId: "thread-2",
    });
    expect(focused.tabs[0]?.preview).toBe(false);
    expect(focused.tabs[1]?.preview).toBe(true);
  });

  it("replaces the focused group's existing preview in place", () => {
    const first = reconcileLayoutForRoute(twoPaneLayout(), {
      projectId: "p1",
      threadId: "thread-3",
    });
    const previewId = findPane(first.root, "pane-2")!.activeTabId;
    const second = reconcileLayoutForRoute(first, {
      projectId: "p1",
      threadId: "thread-4",
    });
    const focused = findPane(second.root, "pane-2")!;

    expect(focused.tabs).toHaveLength(2);
    expect(focused.activeTabId).toBe(previewId);
    expect(activePaneContent(focused)).toEqual({
      kind: "thread",
      projectId: "p1",
      threadId: "thread-4",
    });
    expect(findPaneByThread(second.root, "p1", "thread-3")).toBeNull();
  });

  it("focuses an existing pane instead of duplicating an already-open thread", () => {
    const before = twoPaneLayout();

    const after = reconcileLayoutForRoute(before, {
      projectId: "p1",
      threadId: "thread-1",
    });

    expect(listPanes(after.root)).toHaveLength(2);
    expect(after.focusedPaneId).toBe("pane-1");
  });

  it("activates an existing inactive tab and focuses its group", () => {
    const withTab = applyThreadOpenToLayout(
      twoPaneLayout(),
      { projectId: "p1", threadId: "thread-3" },
      "replace",
    );
    const movedFocus = reconcileLayoutForRoute(withTab, {
      projectId: "p1",
      threadId: "thread-1",
    });

    const after = reconcileLayoutForRoute(movedFocus, {
      projectId: "p1",
      threadId: "thread-3",
    });
    expect(after.focusedPaneId).toBe("pane-2");
    expect(activePaneContent(findPane(after.root, "pane-2")!)).toEqual({
      kind: "thread",
      projectId: "p1",
      threadId: "thread-3",
    });
    expect(findPane(after.root, "pane-2")?.tabs).toHaveLength(2);
  });

  it("is a no-op when the route already matches the focused pane", () => {
    const before = twoPaneLayout();

    const after = reconcileLayoutForRoute(before, {
      projectId: "p1",
      threadId: "thread-2",
    });

    expect(after).toBe(before);
  });
});

describe("mixed page navigation", () => {
  it("keeps New Thread as a singleton and focuses its existing pane", () => {
    const withCompose = splitPane(twoPaneLayout(), "pane-2", "bottom", {
      kind: "new-thread",
    });

    const after = expectLayout(
      reconcileLayoutForContent(withCompose, { kind: "new-thread" }),
    );

    expect(listPanes(after.root)).toHaveLength(3);
    expect(after.focusedPaneId).toBe(
      findPaneByContent(after.root, { kind: "new-thread" })?.paneId,
    );
    expect(focusedPaneRoute(after)).toBe("/");
  });

  it("updates a plugin pane's subpath without duplicating the panel", () => {
    const plugin = {
      kind: "plugin-panel",
      pluginId: "notes",
      panelPath: "notes",
      subPath: "inbox.md",
    } as const;
    const before = splitPane(twoPaneLayout(), "pane-1", "bottom", plugin);

    const after = expectLayout(
      reconcileLayoutForContent(before, {
        ...plugin,
        subPath: "work/today.md",
      }),
    );

    expect(listPanes(after.root)).toHaveLength(3);
    expect(findContentTab(after.root, plugin)?.tab.content).toEqual({
      ...plugin,
      subPath: "work/today.md",
    });
    expect(focusedPaneRoute(after)).toBe("/plugins/notes/notes/work/today.md");
  });

  it("leaves a null layout null for an unopened URL-derived terminal", () => {
    expect(
      reconcileLayoutForContent(null, {
        kind: "terminal",
        terminalId: "term-1",
      }),
    ).toBeNull();
  });

  it("treats an unopened URL-derived terminal as a reveal-only no-op for an existing layout", () => {
    const before = twoPaneLayout();
    const after = reconcileLayoutForContent(before, {
      kind: "terminal",
      terminalId: "term-1",
    });

    expect(after).toBe(before);
  });

  it("reveals an existing terminal by id regardless of target", () => {
    const terminal = {
      kind: "terminal",
      terminalId: "term-1",
      target: { kind: "thread", threadId: "thread-1" },
    } as const;
    const before = setFocus(
      splitPane(twoPaneLayout(), "pane-1", "bottom", terminal),
      "pane-2",
    );
    const after = expectLayout(
      reconcileLayoutForContent(before, {
        kind: "terminal",
        terminalId: "term-1",
      }),
    );

    expect(after.focusedPaneId).toBe(
      findPaneByContent(after.root, terminal)?.paneId,
    );
    expect(findContentTab(after.root, terminal)?.tab.preview).toBe(false);
  });
});

describe("focusedThreadRoute", () => {
  it("reports the focused pane's thread so URL sync targets it", () => {
    const layout = twoPaneLayout();

    expect(focusedThreadRoute(layout)).toEqual({
      projectId: "p1",
      threadId: "thread-2",
    });

    // Reconciling to the other open thread focuses it, and URL sync follows.
    const focusedOther = reconcileLayoutForRoute(layout, {
      projectId: "p1",
      threadId: "thread-1",
    });
    expect(focusedThreadRoute(focusedOther)).toEqual({
      projectId: "p1",
      threadId: "thread-1",
    });
  });
});

describe("applyThreadOpenToLayout", () => {
  it("adds a committed tab for a replace intent", () => {
    const before = twoPaneLayout();
    const after = applyThreadOpenToLayout(
      before,
      { projectId: "p2", threadId: "thread-replace" },
      "replace",
    );
    const focused = findPane(after.root, "pane-2")!;

    expect(listPanes(after.root)).toHaveLength(2);
    expect(focused.tabs).toHaveLength(2);
    expect(activePaneContent(focused)).toEqual({
      kind: "thread",
      projectId: "p2",
      threadId: "thread-replace",
    });
    expect(
      focused.tabs.find((tab) => tab.tabId === focused.activeTabId)?.preview,
    ).toBe(false);
  });

  it("splits from the focused pane and focuses the opened thread", () => {
    const before = twoPaneLayout();
    const after = applyThreadOpenToLayout(
      before,
      { projectId: "p2", threadId: "thread-3" },
      "down",
    );

    expect(listPanes(after.root)).toHaveLength(3);
    expect(focusedThreadRoute(after)).toEqual({
      projectId: "p2",
      threadId: "thread-3",
    });
  });

  it("focuses an already-open thread instead of duplicating it", () => {
    const before = twoPaneLayout();
    const after = applyThreadOpenToLayout(
      before,
      { projectId: "p1", threadId: "thread-1" },
      "right",
    );

    expect(listPanes(after.root)).toHaveLength(2);
    expect(after.focusedPaneId).toBe("pane-1");
  });

  it("creates panes through eight, then coerces a ninth edge open to a committed center tab", () => {
    const eight = eightPaneLayout();
    const focusedPaneId = eight.focusedPaneId;

    expect(listPanes(eight.root)).toHaveLength(MAX_PANES);
    expect(eight.root).toMatchObject({
      type: "split",
      dir: "row",
      sizes: Array.from({ length: MAX_PANES }, () => 1 / MAX_PANES),
    });
    for (let index = 5; index <= MAX_PANES; index += 1) {
      expect(
        findPaneByThread(eight.root, "p1", `thread-${index}`),
      ).not.toBeNull();
    }

    const after = applyThreadOpenToLayout(
      eight,
      { projectId: "p2", threadId: "thread-9" },
      "left",
    );

    expect(listPanes(after.root)).toHaveLength(MAX_PANES);
    expect(after.focusedPaneId).toBe(focusedPaneId);
    expect(findPaneByThread(after.root, "p2", "thread-9")?.paneId).toBe(
      focusedPaneId,
    );
    expect(findPaneByThread(after.root, "p1", "thread-8")?.paneId).toBe(
      focusedPaneId,
    );
    const focused = findPane(after.root, focusedPaneId)!;
    expect(focused.tabs).toHaveLength(2);
    expect(
      focused.tabs.find((tab) => tab.tabId === focused.activeTabId)?.preview,
    ).toBe(false);
  });
});

describe("applyThreadPaneActionToLayout", () => {
  it("focuses and maximizes the targeted open thread without changing the tree", () => {
    const before = twoPaneLayout();
    const result = applyThreadPaneActionToLayout(
      before,
      null,
      { projectId: "p1", threadId: "thread-1" },
      "maximize",
    );

    expect(result.layout.root).toEqual(before.root);
    expect(result.layout.focusedPaneId).toBe("pane-1");
    expect(result.maximizedPaneId).toBe("pane-1");
  });

  it("restores only the targeted maximized pane and toggles it back", () => {
    const before = twoPaneLayout();
    const restored = applyThreadPaneActionToLayout(
      before,
      "pane-2",
      { projectId: "p1", threadId: "thread-2" },
      "restore",
    );
    expect(restored).toEqual({ layout: before, maximizedPaneId: null });

    const toggled = applyThreadPaneActionToLayout(
      restored.layout,
      restored.maximizedPaneId,
      { projectId: "p1", threadId: "thread-2" },
      "toggle",
    );
    expect(toggled.maximizedPaneId).toBe("pane-2");
  });

  it("is a no-op when the target is not open", () => {
    const before = twoPaneLayout();
    expect(
      applyThreadPaneActionToLayout(
        before,
        "pane-2",
        { projectId: "p1", threadId: "missing" },
        "maximize",
      ),
    ).toEqual({ layout: before, maximizedPaneId: "pane-2" });
  });
});
