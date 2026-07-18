import { describe, expect, it } from "vitest";
import {
  MAX_TABS_PER_PANE,
  MAX_PANES,
  activateTab,
  activePaneContent,
  closeTab,
  commitTab,
  contentMatches,
  countPanes,
  findContentTab,
  findPane,
  findPaneByThread,
  listPanes,
  moveTab,
  movePane,
  normalize,
  openTab,
  removePane,
  reorderTab,
  replacePaneContent,
  resizeSplit,
  setFocus,
  splitPane,
  swapPanes,
} from "./ops";
import type { PaneContent, PaneNode, SplitLayout } from "./types";

function threadContent(threadId: string, projectId = "project-1"): PaneContent {
  return { kind: "thread", projectId, threadId };
}

function pane(paneId: string, threadId = paneId): PaneNode {
  const tabId = `${paneId}-t1`;
  return {
    type: "pane",
    paneId,
    tabs: [{ tabId, content: threadContent(threadId), preview: false }],
    activeTabId: tabId,
  };
}

function singlePaneLayout(): SplitLayout {
  return { root: pane("pane-1"), focusedPaneId: "pane-1" };
}

function fourTabLayout(): SplitLayout {
  let layout = singlePaneLayout();
  for (let index = 2; index <= 4; index += 1) {
    layout = openTab(layout, "pane-1", threadContent(`thread-${index}`));
  }
  return layout;
}

function paneThreadOrder(layout: SplitLayout): string[] {
  return findPane(layout.root, "pane-1")!.tabs.map((tab) => {
    if (tab.content.kind !== "thread") {
      throw new Error("Expected thread-only fixture");
    }
    return tab.content.threadId;
  });
}

function layoutAtPaneCount(count: number): SplitLayout {
  let layout = singlePaneLayout();
  for (let index = 2; index <= count; index += 1) {
    layout = splitPane(
      layout,
      layout.focusedPaneId,
      "right",
      threadContent(`thread-${index}`),
    );
  }
  return layout;
}

function expectValidFocus(layout: SplitLayout): void {
  expect(findPane(layout.root, layout.focusedPaneId)).not.toBeNull();
}

function expectNormalizedSizes(layout: SplitLayout): void {
  function visit(node: SplitLayout["root"]): void {
    if (node.type === "pane") {
      return;
    }
    expect(node.sizes).toHaveLength(node.children.length);
    expect(node.sizes.reduce((sum, size) => sum + size, 0)).toBeCloseTo(1, 12);
    const feasibleMinimum = Math.min(0.15, 1 / node.children.length);
    for (const size of node.sizes) {
      expect(size).toBeGreaterThanOrEqual(feasibleMinimum);
      expect(size).toBeLessThanOrEqual(0.85);
    }
    node.children.forEach(visit);
  }
  visit(layout.root);
}

describe("split layout operations", () => {
  it("rebalances seven successive default-right opens into eight equal usable panes", () => {
    const eight = layoutAtPaneCount(MAX_PANES);

    expect(eight.root).toMatchObject({
      type: "split",
      dir: "row",
      children: Array.from({ length: MAX_PANES }, () => ({ type: "pane" })),
    });
    if (eight.root.type !== "split") {
      throw new Error("Expected a flat row split");
    }
    expect(eight.root.sizes).toHaveLength(MAX_PANES);
    for (const size of eight.root.sizes) {
      expect(size).toBeCloseTo(1 / MAX_PANES, 12);
    }
    expect(
      splitPane(eight, eight.focusedPaneId, "right", threadContent("thread-9")),
    ).toBe(eight);
  });

  it("inserts in reading order, focuses the new pane, and enforces the cap", () => {
    const two = splitPane(
      singlePaneLayout(),
      "pane-1",
      "left",
      threadContent("thread-2", "project-2"),
    );
    const three = splitPane(two, "pane-1", "bottom", threadContent("thread-3"));
    const four = splitPane(three, "pane-3", "right", threadContent("thread-4"));
    let eight = four;
    for (let index = 5; index <= MAX_PANES; index += 1) {
      eight = splitPane(
        eight,
        eight.focusedPaneId,
        index % 2 === 0 ? "right" : "bottom",
        threadContent(`thread-${index}`),
      );
    }
    const rejected = splitPane(
      eight,
      "pane-1",
      "top",
      threadContent("thread-9"),
    );

    expect(listPanes(two.root).map((item) => item.paneId)).toEqual([
      "pane-2",
      "pane-1",
    ]);
    expect(two.focusedPaneId).toBe("pane-2");
    expect(listPanes(eight.root).map((item) => item.paneId)).toEqual([
      "pane-2",
      "pane-1",
      "pane-3",
      "pane-4",
      "pane-5",
      "pane-6",
      "pane-7",
      "pane-8",
    ]);
    expect(countPanes(eight.root)).toBe(MAX_PANES);
    expect(eight.focusedPaneId).toBe("pane-8");
    expect(rejected).toBe(eight);
    expect(findPaneByThread(two.root, "project-2", "thread-2")?.paneId).toBe(
      "pane-2",
    );
  });

  it("replaces and swaps content while applying the reference focus semantics", () => {
    const two = splitPane(
      singlePaneLayout(),
      "pane-1",
      "right",
      threadContent("thread-2"),
    );
    const replacement = threadContent("replacement", "project-2");
    const replaced = replacePaneContent(two, "pane-1", replacement);
    const swapped = swapPanes(replaced, "pane-1", "pane-2");

    expect(replaced.focusedPaneId).toBe("pane-1");
    expect(activePaneContent(findPane(swapped.root, "pane-2")!)).toBe(
      replacement,
    );
    expect(activePaneContent(findPane(swapped.root, "pane-1")!)).toEqual(
      threadContent("thread-2"),
    );
    expect(swapped.focusedPaneId).toBe("pane-2");
  });

  it("removes panes, collapses single-child splits, and selects the nearest focus", () => {
    const two = splitPane(
      singlePaneLayout(),
      "pane-1",
      "right",
      threadContent("thread-2"),
    );
    const three = splitPane(two, "pane-2", "bottom", threadContent("thread-3"));
    const removedMiddle = removePane(three, "pane-2");
    const removedEnd = removePane(setFocus(removedMiddle, "pane-3"), "pane-3");

    expect(listPanes(removedMiddle.root).map((item) => item.paneId)).toEqual([
      "pane-1",
      "pane-3",
    ]);
    expect(removedMiddle.root).toMatchObject({
      type: "split",
      dir: "row",
      children: [{ type: "pane" }, { type: "pane" }],
    });
    expect(removedMiddle.focusedPaneId).toBe("pane-3");
    expect(removedEnd.root.type).toBe("pane");
    expect(removedEnd.focusedPaneId).toBe("pane-1");
    expect(removePane(removedEnd, "pane-1")).toBe(removedEnd);
    expectValidFocus(removedMiddle);
    expectValidFocus(removedEnd);
  });

  it("moves a pane at the cap without changing its ID or content identity", () => {
    const eight = layoutAtPaneCount(MAX_PANES);
    const before = findPane(eight.root, "pane-8");
    const moved = movePane(eight, "pane-8", "pane-7", "left");
    const after = findPane(moved.root, "pane-8");

    expect(countPanes(moved.root)).toBe(MAX_PANES);
    expect(after).toBe(before);
    expect(after?.tabs).toBe(before?.tabs);
    expect(moved.focusedPaneId).toBe("pane-8");
    expectValidFocus(moved);
    expect(movePane(moved, "pane-8", "pane-8", "right")).toBe(moved);
  });

  it("keeps focus, resizing, rearrangement, and closing usable at eight panes", () => {
    const eight = layoutAtPaneCount(MAX_PANES);
    const focused = setFocus(eight, "pane-5");
    const resized = resizeSplit(focused, [], 0, 0.7);
    const swapped = swapPanes(resized, "pane-5", "pane-6");
    const closed = removePane(swapped, "pane-6");

    expect(focused.focusedPaneId).toBe("pane-5");
    expect(resized).not.toBe(focused);
    expect(swapped.focusedPaneId).toBe("pane-6");
    expect(countPanes(closed.root)).toBe(MAX_PANES - 1);
    expect(findPane(closed.root, "pane-6")).toBeNull();
    expectValidFocus(closed);
    expectNormalizedSizes(closed);
  });

  it("resizes adjacent pairs with clamped fractions and unit split totals", () => {
    const two = splitPane(
      singlePaneLayout(),
      "pane-1",
      "right",
      threadContent("thread-2"),
    );
    const low = resizeSplit(two, [], 0, -10);
    const high = resizeSplit(low, [], 0, 10);

    if (low.root.type === "split") {
      expect(low.root.sizes[0]).toBeCloseTo(0.15, 12);
      expect(low.root.sizes[1]).toBeCloseTo(0.85, 12);
    }
    if (high.root.type === "split") {
      expect(high.root.sizes[0]).toBeCloseTo(0.85, 12);
      expect(high.root.sizes[1]).toBeCloseTo(0.15, 12);
      expect(high.root.sizes.reduce((sum, size) => sum + size, 0)).toBe(1);
    }
    expect(resizeSplit(high, [], 1, 0.5)).toBe(high);
    expect(resizeSplit(high, [0], 0, 0.5)).toBe(high);
  });

  it("normalizes degenerate trees, invalid sizes, excess panes, and focus", () => {
    const malformed: SplitLayout = {
      root: {
        type: "split",
        dir: "row",
        sizes: [Number.NaN, -1],
        children: [
          {
            type: "split",
            dir: "col",
            sizes: [7],
            children: [pane("pane-1")],
          },
          {
            type: "split",
            dir: "col",
            sizes: [99, 1, 1, 1],
            children: [
              pane("pane-2"),
              pane("pane-3"),
              pane("pane-4"),
              pane("pane-5"),
              pane("pane-6"),
              pane("pane-7"),
              pane("pane-8"),
              pane("pane-9"),
            ],
          },
        ],
      },
      focusedPaneId: "missing-pane",
    };

    const normalized = normalize(malformed);

    expect(countPanes(normalized.root)).toBe(MAX_PANES);
    expect(listPanes(normalized.root).map((item) => item.paneId)).toEqual([
      "pane-1",
      "pane-2",
      "pane-3",
      "pane-4",
      "pane-5",
      "pane-6",
      "pane-7",
      "pane-8",
    ]);
    expect(normalized.focusedPaneId).toBe("pane-1");
    expectNormalizedSizes(normalized);
    expectValidFocus(normalized);
  });

  it("opens committed tabs after the active tab and reveals an existing tab", () => {
    const first = openTab(
      singlePaneLayout(),
      "pane-1",
      threadContent("thread-2"),
    );
    const second = openTab(first, "pane-1", threadContent("thread-3"));
    const activated = activateTab(second, "pane-1", "pane-1-t1");
    const inserted = openTab(activated, "pane-1", threadContent("thread-4"));
    const revealed = openTab(inserted, "pane-1", threadContent("thread-3"));
    const openedPane = findPane(inserted.root, "pane-1")!;

    expect(openedPane.tabs.map((tab) => tab.content)).toEqual([
      threadContent("pane-1"),
      threadContent("thread-4"),
      threadContent("thread-2"),
      threadContent("thread-3"),
    ]);
    expect(openedPane.tabs.every((tab) => !tab.preview)).toBe(true);
    expect(findPane(revealed.root, "pane-1")?.tabs).toHaveLength(4);
    expect(activePaneContent(findPane(revealed.root, "pane-1")!)).toEqual(
      threadContent("thread-3"),
    );
  });

  it("replaces a preview in place, and commits it when reopened non-preview", () => {
    const preview = openTab(
      singlePaneLayout(),
      "pane-1",
      threadContent("preview-1"),
      { preview: true },
    );
    const previewPane = findPane(preview.root, "pane-1")!;
    const previewId = previewPane.activeTabId;
    const replaced = openTab(preview, "pane-1", threadContent("preview-2"), {
      preview: true,
    });
    const replacedPane = findPane(replaced.root, "pane-1")!;
    const committed = openTab(replaced, "pane-1", threadContent("preview-2"));

    expect(replacedPane.tabs).toHaveLength(2);
    expect(replacedPane.tabs[1]).toEqual({
      tabId: previewId,
      content: threadContent("preview-2"),
      preview: true,
    });
    expect(findPane(committed.root, "pane-1")?.tabs[1]?.preview).toBe(false);
  });

  it("caps a pane at sixteen tabs while still allowing reveal-existing", () => {
    let layout = singlePaneLayout();
    for (let index = 2; index <= MAX_TABS_PER_PANE; index += 1) {
      layout = openTab(layout, "pane-1", threadContent(`thread-${index}`));
    }
    const capped = openTab(
      layout,
      "pane-1",
      threadContent(`thread-${MAX_TABS_PER_PANE + 1}`),
    );
    const revealed = openTab(layout, "pane-1", threadContent("thread-2"));

    expect(capped).toBe(layout);
    expect(findPane(revealed.root, "pane-1")?.tabs).toHaveLength(
      MAX_TABS_PER_PANE,
    );
    expect(activePaneContent(findPane(revealed.root, "pane-1")!)).toEqual(
      threadContent("thread-2"),
    );
  });

  it("forces terminal opens committed even when preview is requested", () => {
    const terminal: PaneContent = {
      kind: "terminal",
      terminalId: "term-1",
      target: { kind: "thread", threadId: "thread-1" },
    };
    const opened = openTab(singlePaneLayout(), "pane-1", terminal, {
      preview: true,
    });
    const terminalTab = findContentTab(opened.root, terminal)?.tab;

    expect(terminalTab).toMatchObject({ content: terminal, preview: false });
  });

  it("activates and commits tabs without changing unrelated tab state", () => {
    const preview = openTab(
      singlePaneLayout(),
      "pane-1",
      threadContent("thread-2"),
      { preview: true },
    );
    const previewId = findPane(preview.root, "pane-1")!.activeTabId;
    const activated = activateTab(preview, "pane-1", "pane-1-t1");
    const committed = commitTab(activated, "pane-1", previewId);

    expect(findPane(activated.root, "pane-1")?.activeTabId).toBe("pane-1-t1");
    expect(
      findPane(committed.root, "pane-1")?.tabs.find(
        (tab) => tab.tabId === previewId,
      )?.preview,
    ).toBe(false);
    expect(committed.focusedPaneId).toBe("pane-1");
  });

  it("reorders tabs forward and backward while preserving the active tab", () => {
    const layout = fourTabLayout();
    const paneBefore = findPane(layout.root, "pane-1")!;
    const activeTabId = paneBefore.activeTabId;
    const firstTabId = paneBefore.tabs[0]!.tabId;
    const lastTabId = paneBefore.tabs[3]!.tabId;

    const forward = reorderTab(layout, "pane-1", firstTabId, 2);
    const backward = reorderTab(layout, "pane-1", lastTabId, 1);

    expect(paneThreadOrder(forward)).toEqual([
      "thread-2",
      "thread-3",
      "pane-1",
      "thread-4",
    ]);
    expect(paneThreadOrder(backward)).toEqual([
      "pane-1",
      "thread-4",
      "thread-2",
      "thread-3",
    ]);
    expect(findPane(forward.root, "pane-1")?.activeTabId).toBe(activeTabId);
    expect(findPane(backward.root, "pane-1")?.activeTabId).toBe(activeTabId);
  });

  it("clamps reorder destinations beyond both ends", () => {
    const layout = fourTabLayout();
    const secondTabId = findPane(layout.root, "pane-1")!.tabs[1]!.tabId;
    const thirdTabId = findPane(layout.root, "pane-1")!.tabs[2]!.tabId;

    expect(
      paneThreadOrder(reorderTab(layout, "pane-1", secondTabId, 999)),
    ).toEqual(["pane-1", "thread-3", "thread-4", "thread-2"]);
    expect(
      paneThreadOrder(reorderTab(layout, "pane-1", thirdTabId, -999)),
    ).toEqual(["thread-3", "pane-1", "thread-2", "thread-4"]);
  });

  it("commits a reordered preview and preserves no-op identity", () => {
    const preview = openTab(
      singlePaneLayout(),
      "pane-1",
      threadContent("preview"),
      { preview: true },
    );
    const previewTab = findContentTab(
      preview.root,
      threadContent("preview"),
    )!.tab;
    const reordered = reorderTab(preview, "pane-1", previewTab.tabId, 0);

    expect(paneThreadOrder(reordered)).toEqual(["preview", "pane-1"]);
    expect(
      findContentTab(reordered.root, threadContent("preview"))?.tab.preview,
    ).toBe(false);
    expect(findPane(reordered.root, "pane-1")?.activeTabId).toBe(
      previewTab.tabId,
    );

    const committed = fourTabLayout();
    const sameIndexTab = findPane(committed.root, "pane-1")!.tabs[1]!;
    expect(reorderTab(committed, "pane-1", sameIndexTab.tabId, 1)).toBe(
      committed,
    );
    expect(reorderTab(committed, "missing", sameIndexTab.tabId, 0)).toBe(
      committed,
    );
    expect(reorderTab(committed, "pane-1", "missing", 0)).toBe(committed);
  });

  it("closes tabs with index-neighbor fallback, collapses empty panes, and protects the final tab", () => {
    const withThree = openTab(
      openTab(singlePaneLayout(), "pane-1", threadContent("thread-2")),
      "pane-1",
      threadContent("thread-3"),
    );
    const middleId = findPane(withThree.root, "pane-1")!.tabs[1]!.tabId;
    const activated = activateTab(withThree, "pane-1", middleId);
    const closedMiddle = closeTab(activated, "pane-1", middleId);
    const paneAfterClose = findPane(closedMiddle.root, "pane-1")!;

    expect(activePaneContent(paneAfterClose)).toEqual(
      threadContent("thread-3"),
    );

    const split = splitPane(
      closedMiddle,
      "pane-1",
      "right",
      threadContent("thread-4"),
    );
    const collapsed = closeTab(
      split,
      "pane-2",
      findPane(split.root, "pane-2")!.activeTabId,
    );
    expect(countPanes(collapsed.root)).toBe(1);

    const only = singlePaneLayout();
    expect(closeTab(only, "pane-1", "pane-1-t1")).toBe(only);
  });

  it("moves tabs into groups and side splits with commit and collapse semantics", () => {
    const split = splitPane(
      openTab(singlePaneLayout(), "pane-1", threadContent("preview"), {
        preview: true,
      }),
      "pane-1",
      "right",
      threadContent("target"),
    );
    const previewTab = findContentTab(split.root, threadContent("preview"))!;
    const centered = moveTab(split, "pane-1", previewTab.tab.tabId, {
      type: "center",
      targetPaneId: "pane-2",
    });
    const targetPane = findPane(centered.root, "pane-2")!;

    expect(targetPane.tabs.at(-1)).toMatchObject({
      tabId: previewTab.tab.tabId,
      preview: false,
    });
    expect(targetPane.activeTabId).toBe(previewTab.tab.tabId);
    expect(countPanes(centered.root)).toBe(2);

    const sourceLastTabId = findPane(centered.root, "pane-1")!.activeTabId;
    const dissolved = moveTab(centered, "pane-1", sourceLastTabId, {
      type: "center",
      targetPaneId: "pane-2",
    });
    expect(countPanes(dissolved.root)).toBe(1);
    expect(findPane(dissolved.root, "pane-1")).toBeNull();

    const movedSide = moveTab(dissolved, "pane-2", previewTab.tab.tabId, {
      type: "side",
      targetPaneId: "pane-2",
      side: "left",
    });
    expect(countPanes(movedSide.root)).toBe(2);
    expect(
      findContentTab(movedSide.root, threadContent("preview"))?.tab.preview,
    ).toBe(false);
  });

  it("handles self drops and pane caps according to whether the source survives", () => {
    const preview = openTab(
      singlePaneLayout(),
      "pane-1",
      threadContent("preview"),
      { preview: true },
    );
    const previewId = findPane(preview.root, "pane-1")!.activeTabId;
    const selfCenter = moveTab(preview, "pane-1", previewId, {
      type: "center",
      targetPaneId: "pane-1",
    });
    expect(findPane(selfCenter.root, "pane-1")?.tabs[1]?.preview).toBe(false);

    const only = singlePaneLayout();
    expect(
      moveTab(only, "pane-1", "pane-1-t1", {
        type: "side",
        targetPaneId: "pane-1",
        side: "right",
      }),
    ).toBe(only);

    const atCap = layoutAtPaneCount(MAX_PANES);
    const survivingSource = openTab(atCap, "pane-1", threadContent("extra"));
    const extraId = findContentTab(
      survivingSource.root,
      threadContent("extra"),
    )!.tab.tabId;
    expect(
      moveTab(survivingSource, "pane-1", extraId, {
        type: "side",
        targetPaneId: "pane-2",
        side: "left",
      }),
    ).toBe(survivingSource);

    const lastTabId = findPane(atCap.root, "pane-8")!.activeTabId;
    const paneReplacement = moveTab(atCap, "pane-8", lastTabId, {
      type: "side",
      targetPaneId: "pane-7",
      side: "left",
    });
    expect(countPanes(paneReplacement.root)).toBe(MAX_PANES);
    expect(findPane(paneReplacement.root, "pane-8")).toBeNull();
  });

  it("normalizes empty panes, invalid active tabs, and duplicate previews", () => {
    const malformed: SplitLayout = {
      root: {
        type: "split",
        dir: "row",
        sizes: [0.5, 0.5],
        children: [
          { ...pane("pane-1"), tabs: [], activeTabId: "missing" },
          {
            ...pane("pane-2"),
            activeTabId: "missing",
            tabs: [
              { tabId: "a", content: threadContent("a"), preview: true },
              { tabId: "b", content: threadContent("b"), preview: true },
            ],
          },
        ],
      },
      focusedPaneId: "pane-1",
    };

    const normalized = normalize(malformed);
    const survivor = findPane(normalized.root, "pane-2")!;
    expect(normalized.root.type).toBe("pane");
    expect(normalized.focusedPaneId).toBe("pane-2");
    expect(survivor.activeTabId).toBe("a");
    expect(survivor.tabs.map((tab) => tab.preview)).toEqual([true, false]);
  });

  it("normalizes terminal tabs to committed state", () => {
    const terminal: PaneContent = {
      kind: "terminal",
      terminalId: "term-1",
      target: { kind: "thread", threadId: "thread-1" },
    };
    const malformed: SplitLayout = {
      root: {
        ...pane("pane-1"),
        tabs: [
          {
            tabId: "pane-1-t1",
            content: terminal,
            preview: true,
          },
        ],
      },
      focusedPaneId: "pane-1",
    };

    const normalized = normalize(malformed);
    expect(findContentTab(normalized.root, terminal)?.tab.preview).toBe(false);
  });

  it("trims excess tabs to sixteen without dropping the active tab", () => {
    const activeTabId = `tab-${MAX_TABS_PER_PANE + 2}`;
    const malformed: SplitLayout = {
      root: {
        type: "pane",
        paneId: "pane-1",
        tabs: Array.from({ length: MAX_TABS_PER_PANE + 2 }, (_, index) => ({
          tabId: `tab-${index + 1}`,
          content: threadContent(`thread-${index + 1}`),
          preview: false,
        })),
        activeTabId,
      },
      focusedPaneId: "pane-1",
    };

    const normalized = normalize(malformed);
    const normalizedPane = findPane(normalized.root, "pane-1")!;
    expect(normalizedPane.tabs).toHaveLength(MAX_TABS_PER_PANE);
    expect(normalizedPane.activeTabId).toBe(activeTabId);
    expect(normalizedPane.tabs.at(-1)?.tabId).toBe(activeTabId);
  });

  it("matches view identity by kind, including terminals independent of target", () => {
    const terminal = {
      kind: "terminal",
      terminalId: "term-1",
      target: { kind: "thread", threadId: "thread-1" },
    } as const;
    const layout = openTab(singlePaneLayout(), "pane-1", terminal);

    expect(
      contentMatches(terminal, {
        kind: "terminal",
        terminalId: "term-1",
        target: { kind: "environment", environmentId: "env-1" },
      }),
    ).toBe(true);
    expect(
      findContentTab(layout.root, { kind: "terminal", terminalId: "term-1" })
        ?.tab.content,
    ).toEqual(terminal);
    expect(
      contentMatches(threadContent("same", "p1"), threadContent("same", "p2")),
    ).toBe(false);
    expect(
      contentMatches(
        { kind: "diff", projectId: "p1", threadId: "same" },
        { kind: "diff", projectId: "p2", threadId: "same" },
      ),
    ).toBe(false);
    expect(
      contentMatches(
        {
          kind: "plugin-panel",
          pluginId: "notes",
          panelPath: "files",
          subPath: "a",
        },
        {
          kind: "plugin-panel",
          pluginId: "notes",
          panelPath: "files",
          subPath: "b",
        },
      ),
    ).toBe(true);
  });
});
