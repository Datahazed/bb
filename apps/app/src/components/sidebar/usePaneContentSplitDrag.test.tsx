// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { splitLayoutAtom } from "@/lib/split-layout/atoms";
import { countPanes, findPaneByContent, listPanes } from "@/lib/split-layout";
import type { SplitLayout } from "@/lib/split-layout";
import type { SplitDragConfig } from "@/lib/split-drag";
import { usePaneContentSplitDrag } from "./usePaneContentSplitDrag";

const { compactState, dragState, navigateSpy } = vi.hoisted(() => ({
  compactState: { value: false },
  dragState: { config: null as SplitDragConfig | null },
  navigateSpy: vi.fn(),
}));

vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => navigateSpy,
}));

vi.mock("@bb/shared-ui/hooks/use-compact-viewport", () => ({
  useIsCompactViewport: () => compactState.value,
}));

vi.mock("@/lib/split-drag", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/split-drag")>()),
  beginSplitDrag: (config: SplitDragConfig) => {
    dragState.config = config;
  },
}));

function singlePane(): SplitLayout {
  return {
    root: {
      type: "pane",
      paneId: "pane-1",
      content: { kind: "thread", projectId: "p1", threadId: "t1" },
    },
    focusedPaneId: "pane-1",
  };
}

function renderFreshComposeSplit(layout: SplitLayout | null) {
  const store = createStore();
  store.set(splitLayoutAtom, layout);
  let sequence = 0;
  const createContent = vi.fn(() => ({
    kind: "new-thread" as const,
    draftSlotId: `slot-${(sequence += 1)}`,
  }));
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );
  const { result } = renderHook(
    () =>
      usePaneContentSplitDrag({
        createContent,
        enabled: true,
        label: "New thread",
      }),
    { wrapper },
  );
  return { createContent, result, store, wrapper };
}

beforeEach(() => {
  compactState.value = false;
  dragState.config = null;
  navigateSpy.mockReset();
});

afterEach(cleanup);

describe("usePaneContentSplitDrag with fresh content", () => {
  it("creates a distinct New thread slot for every cmd-click open", () => {
    const { result, store } = renderFreshComposeSplit(singlePane());

    act(() => result.current.openInSplit());
    act(() => result.current.openInSplit());

    const layout = store.get(splitLayoutAtom);
    expect(layout).not.toBeNull();
    expect(countPanes(layout!.root)).toBe(3);
    expect(
      findPaneByContent(layout!.root, {
        kind: "new-thread",
        draftSlotId: "slot-1",
      }),
    ).not.toBeNull();
    expect(
      findPaneByContent(layout!.root, {
        kind: "new-thread",
        draftSlotId: "slot-2",
      }),
    ).not.toBeNull();
    expect(navigateSpy).toHaveBeenNthCalledWith(1, "/", {
      state: { draftSlotId: "slot-1" },
    });
    expect(navigateSpy).toHaveBeenNthCalledWith(2, "/", {
      state: { draftSlotId: "slot-2" },
    });
  });

  it("does not allocate a slot for a canceled pointer gesture", () => {
    const { createContent, result, wrapper } =
      renderFreshComposeSplit(singlePane());

    render(
      <button onPointerDown={result.current.onPointerDown}>New thread</button>,
      { wrapper },
    );
    fireEvent.pointerDown(screen.getByRole("button", { name: "New thread" }), {
      button: 0,
      clientX: 10,
      clientY: 10,
    });

    expect(dragState.config).not.toBeNull();
    expect(createContent).not.toHaveBeenCalled();
  });

  it("allocates once only after a successful drop", () => {
    const { createContent, result, store, wrapper } =
      renderFreshComposeSplit(singlePane());
    render(
      <button onPointerDown={result.current.onPointerDown}>New thread</button>,
      { wrapper },
    );
    fireEvent.pointerDown(screen.getByRole("button", { name: "New thread" }), {
      button: 0,
      clientX: 10,
      clientY: 10,
    });

    act(() => dragState.config?.onDrop({ paneId: "pane-1", zone: "right" }));

    expect(createContent).toHaveBeenCalledTimes(1);
    expect(listPanes(store.get(splitLayoutAtom)!.root)).toHaveLength(2);
    expect(navigateSpy).toHaveBeenCalledWith("/", {
      state: { draftSlotId: "slot-1" },
    });
  });

  it("keeps the fresh binding when compact mode falls back to navigation", () => {
    compactState.value = true;
    const initial = singlePane();
    const { result, store } = renderFreshComposeSplit(initial);

    act(() => result.current.openInSplit());

    expect(store.get(splitLayoutAtom)).toBe(initial);
    expect(navigateSpy).toHaveBeenCalledWith("/", {
      state: { draftSlotId: "slot-1" },
    });
  });
});
