// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { splitLayoutAtom } from "@/lib/split-layout/atoms";
import {
  activePaneContent,
  countPanes,
  findPane,
  findPaneByThread,
  listPanes,
  openTab,
} from "@/lib/split-layout";
import type { LayoutNode, PaneContent, SplitLayout } from "@/lib/split-layout";
import type { SplitDragConfig } from "@/lib/split-drag";
import { useThreadRowSplitDrag } from "./useThreadRowSplitDrag";

const { navigateSpy, compactState, experimentState, splitDragState } =
  vi.hoisted(() => ({
    navigateSpy: vi.fn(),
    compactState: { value: false },
    experimentState: { enabled: true },
    splitDragState: { config: null as SplitDragConfig | null },
  }));

vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => navigateSpy,
}));

vi.mock("@bb/shared-ui/hooks/use-compact-viewport", () => ({
  useIsCompactViewport: () => compactState.value,
}));

vi.mock("@/hooks/useThreadSplitsEnabled", () => ({
  useThreadSplitsEnabled: () => experimentState.enabled,
}));

vi.mock("@/lib/split-drag", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/split-drag")>()),
  beginSplitDrag: vi.fn(
    (_startX: number, _startY: number, config: SplitDragConfig) => {
      splitDragState.config = config;
    },
  ),
}));

function content(threadId: string): PaneContent {
  return { kind: "thread", projectId: "p1", threadId };
}

function pane(paneId: string, threadId: string): LayoutNode {
  const tabId = `${paneId}-t1`;
  return {
    type: "pane",
    paneId,
    tabs: [{ tabId, content: content(threadId), preview: false }],
    activeTabId: tabId,
  };
}

function singlePane(): SplitLayout {
  return { root: pane("pane-1", "t1"), focusedPaneId: "pane-1" };
}

function twoPanes(): SplitLayout {
  return {
    root: {
      type: "split",
      dir: "row",
      sizes: [0.5, 0.5],
      children: [pane("pane-1", "t1"), pane("pane-2", "t2")],
    },
    focusedPaneId: "pane-1",
  };
}

function eightPanes(): SplitLayout {
  return {
    root: {
      type: "split",
      dir: "row",
      sizes: Array.from({ length: 8 }, () => 0.125),
      children: Array.from({ length: 8 }, (_, index) =>
        pane(`pane-${index + 1}`, `t${index + 1}`),
      ),
    },
    focusedPaneId: "pane-1",
  };
}

function fullSinglePane(): SplitLayout {
  let layout = singlePane();
  for (let index = 2; index <= 16; index += 1) {
    layout = openTab(layout, "pane-1", content(`t${index}`));
  }
  return layout;
}

function renderOpenInSplit(threadId: string, layout: SplitLayout | null) {
  const store = createStore();
  store.set(splitLayoutAtom, layout);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );
  const { result } = renderHook(
    () => useThreadRowSplitDrag({ projectId: "p1", threadId, title: "Thread" }),
    { wrapper },
  );
  return {
    store,
    getOnPointerDown: () => result.current.onPointerDown,
    openInSplit: () => act(() => result.current.openInSplit()),
    startDrag: () => {
      const row = document.createElement("div");
      const pointerEvent = new PointerEvent("pointerdown", {
        button: 0,
        clientX: 0,
        clientY: 0,
      });
      Object.defineProperty(pointerEvent, "currentTarget", { value: row });
      act(() =>
        result.current.onPointerDown?.(
          pointerEvent as unknown as ReactPointerEvent<HTMLElement>,
        ),
      );
      return splitDragState.config;
    },
  };
}

describe("useThreadRowSplitDrag", () => {
  beforeEach(() => {
    navigateSpy.mockClear();
    compactState.value = false;
    experimentState.enabled = true;
    splitDragState.config = null;
  });

  it("splits the focused pane to the right by default", () => {
    const { store, openInSplit } = renderOpenInSplit("t9", singlePane());
    openInSplit();
    const layout = store.get(splitLayoutAtom);
    expect(layout).not.toBeNull();
    expect(countPanes(layout!.root)).toBe(2);
    const opened = findPaneByThread(layout!.root, "p1", "t9");
    expect(opened).not.toBeNull();
    // Default placement is a right split, so the new pane is the last in order.
    expect(listPanes(layout!.root).at(-1)?.paneId).toBe(opened?.paneId);
    expect(layout!.focusedPaneId).toBe(opened?.paneId);
    // A fresh open pushes a history entry (no replace).
    expect(navigateSpy).toHaveBeenCalledWith("/projects/p1/threads/t9");
  });

  it("reveals an existing inactive tab without growing the layout", () => {
    let seeded = openTab(twoPanes(), "pane-2", content("t3"));
    const beforeTabCount = findPane(seeded.root, "pane-2")!.tabs.length;
    const { store, openInSplit } = renderOpenInSplit("t2", seeded);
    openInSplit();
    const layout = store.get(splitLayoutAtom);
    const paneTwo = findPane(layout!.root, "pane-2")!;
    expect(countPanes(layout!.root)).toBe(2);
    expect(paneTwo.tabs).toHaveLength(beforeTabCount);
    expect(layout!.focusedPaneId).toBe("pane-2");
    expect(activePaneContent(paneTwo)).toEqual(content("t2"));
    expect(
      paneTwo.tabs.find((tab) => tab.tabId === paneTwo.activeTabId)?.preview,
    ).toBe(false);
    expect(navigateSpy).toHaveBeenCalledWith("/projects/p1/threads/t2", {
      replace: true,
    });
  });

  it("coerces to a committed center tab at the eight-pane cap", () => {
    const { store, openInSplit } = renderOpenInSplit("t9", eightPanes());
    openInSplit();
    const layout = store.get(splitLayoutAtom);
    expect(countPanes(layout!.root)).toBe(8);
    const opened = findPaneByThread(layout!.root, "p1", "t9");
    const focused = findPane(layout!.root, "pane-1")!;
    expect(opened?.paneId).toBe("pane-1");
    expect(focused.tabs).toHaveLength(2);
    expect(activePaneContent(focused)).toEqual(content("t9"));
    expect(
      focused.tabs.find((tab) => tab.tabId === focused.activeTabId)?.preview,
    ).toBe(false);
    expect(findPaneByThread(layout!.root, "p1", "t1")?.paneId).toBe("pane-1");
    expect(navigateSpy).toHaveBeenCalledWith("/projects/p1/threads/t9");
  });

  it("does not navigate when a center drop cannot open into a full sixteen-tab group", () => {
    const seeded = fullSinglePane();
    const { store, startDrag } = renderOpenInSplit("t17", seeded);
    const config = startDrag();
    expect(config).not.toBeNull();

    act(() => config?.onDrop({ paneId: "pane-1", zone: "center" }));

    expect(store.get(splitLayoutAtom)).toBe(seeded);
    expect(findPaneByThread(seeded.root, "p1", "t17")).toBeNull();
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it("plain-navigates without touching the layout on compact viewports", () => {
    compactState.value = true;
    const seeded = singlePane();
    const { store, openInSplit } = renderOpenInSplit("t9", seeded);
    openInSplit();
    expect(store.get(splitLayoutAtom)).toBe(seeded); // unchanged reference
    expect(navigateSpy).toHaveBeenCalledWith("/projects/p1/threads/t9");
  });

  it("plain-navigates when there is no layout yet", () => {
    const { store, openInSplit } = renderOpenInSplit("t9", null);
    openInSplit();
    expect(store.get(splitLayoutAtom)).toBeNull();
    expect(navigateSpy).toHaveBeenCalledWith("/projects/p1/threads/t9");
  });

  it("disables drag and plain-navigates without touching the layout when the experiment is off", () => {
    experimentState.enabled = false;
    const seeded = twoPanes();
    const { store, getOnPointerDown, openInSplit } = renderOpenInSplit(
      "t9",
      seeded,
    );

    expect(getOnPointerDown()).toBeUndefined();
    openInSplit();
    expect(store.get(splitLayoutAtom)).toBe(seeded);
    expect(navigateSpy).toHaveBeenCalledWith("/projects/p1/threads/t9");
  });
});
