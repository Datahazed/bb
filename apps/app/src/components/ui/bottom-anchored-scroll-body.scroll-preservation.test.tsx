// @vitest-environment jsdom

import { cleanup, fireEvent, render } from "@testing-library/react";
import { useRef, useState } from "react";
import { getDefaultStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BottomAnchoredScrollBody,
  type CapturedScrollAnchor,
  useBottomAnchoredScroll,
} from "@/components/ui/bottom-anchored-scroll-body";
import { threadTimelineScrollAnchorAtomFamily } from "@/lib/thread-timeline-scroll-anchor";

// Real externals only: the ResizeObserver/rAF used by the scroll body are
// browser primitives jsdom omits, so they are stubbed; nothing in our own code
// is mocked. The atom is read back from the real default jotai store the
// component writes to.

interface ScrollMetrics {
  scrollHeight: number;
  clientHeight: number;
  scrollTop: number;
}

interface RowRect {
  top: number;
  bottom: number;
}

const SCROLL_AREA_CLASS = "scroll-area";
const SCROLL_AREA_TOP = 0;
const SCROLL_AREA_HEIGHT = 100;
let nextAnimationFrameId = 1;
let animationFrameCallbacks = new Map<number, FrameRequestCallback>();

class ResizeObserverMock implements ResizeObserver {
  static instances: ResizeObserverMock[] = [];
  readonly callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    ResizeObserverMock.instances.push(this);
  }
  observe() {}
  unobserve() {}
  disconnect() {}
  trigger() {
    this.callback([], this);
  }
}

function getLatestResizeObserver(): ResizeObserverMock {
  const instance = ResizeObserverMock.instances.at(-1);
  if (!instance) throw new Error("Expected a ResizeObserver instance.");
  return instance;
}

function installAnimationFrameMocks() {
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((callback: FrameRequestCallback) => {
      const frameId = nextAnimationFrameId++;
      animationFrameCallbacks.set(frameId, callback);
      return frameId;
    }),
  );
  vi.stubGlobal(
    "cancelAnimationFrame",
    vi.fn((frameId: number) => {
      animationFrameCallbacks.delete(frameId);
    }),
  );
}

function flushAnimationFrames() {
  while (animationFrameCallbacks.size > 0) {
    const callbacks = [...animationFrameCallbacks.values()];
    animationFrameCallbacks.clear();
    for (const callback of callbacks) {
      callback(window.performance.now());
    }
  }
}

function setScrollMetrics(element: HTMLElement, metrics: ScrollMetrics) {
  Object.defineProperty(element, "scrollHeight", {
    configurable: true,
    value: metrics.scrollHeight,
  });
  Object.defineProperty(element, "clientHeight", {
    configurable: true,
    value: metrics.clientHeight,
  });
  element.scrollTop = metrics.scrollTop;
}

function mockScrollAreaRect(scrollArea: HTMLElement) {
  vi.spyOn(scrollArea, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, SCROLL_AREA_TOP, 100, SCROLL_AREA_HEIGHT),
  );
}

function mockRowRect(row: HTMLElement, rect: RowRect) {
  vi.spyOn(row, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, rect.top, 100, rect.bottom - rect.top),
  );
}

function requireHTMLElement(element: Element | null) {
  if (!(element instanceof HTMLElement)) {
    throw new Error("Expected HTMLElement.");
  }
  return element;
}

interface RenderArgs {
  threadId: string;
  rowIds: string[];
  nestedRowIdsByParent?: Readonly<Record<string, readonly string[]>>;
  revealClampedRowId?: string;
  showPrependAnchorControl?: boolean;
  showScrollToBottomControl?: boolean;
}

function ScrollToBottomControl() {
  const bottomAnchor = useBottomAnchoredScroll();
  return (
    <button type="button" onClick={() => bottomAnchor?.scrollToBottom()}>
      Bottom
    </button>
  );
}

function PrependAnchorControl() {
  const bottomAnchor = useBottomAnchoredScroll();
  const anchorRef = useRef<CapturedScrollAnchor | null>(null);
  const [, setRenderCount] = useState(0);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          anchorRef.current = bottomAnchor?.captureScrollAnchor() ?? null;
        }}
      >
        Arm prepend
      </button>
      <button type="button" onClick={() => anchorRef.current?.cancel()}>
        Cancel prepend
      </button>
      <button type="button" onClick={() => anchorRef.current?.restore()}>
        Restore prepend
      </button>
      <button
        type="button"
        onClick={() => setRenderCount((count) => count + 1)}
      >
        Rerender
      </button>
    </>
  );
}

function RevealClampedControl({ rowId }: { rowId: string }) {
  const bottomAnchor = useBottomAnchoredScroll();
  return (
    <button
      type="button"
      onClick={() => {
        const element = document.querySelector<HTMLElement>(
          `[data-timeline-row-id="${rowId}"]`,
        );
        if (element) {
          bottomAnchor?.scrollElementIntoViewClampedToMaxScroll({ element });
        }
      }}
    >
      Reveal clamped
    </button>
  );
}

function renderTimeline({
  threadId,
  rowIds,
  nestedRowIdsByParent = {},
  revealClampedRowId,
  showPrependAnchorControl = false,
  showScrollToBottomControl = false,
}: RenderArgs) {
  const view = render(
    <BottomAnchoredScrollBody
      footer={<div>Footer</div>}
      maxWidthClassName="max-w-none"
      scrollAreaClassName={SCROLL_AREA_CLASS}
      scrollAnchorThreadId={threadId}
    >
      {showScrollToBottomControl ? <ScrollToBottomControl /> : null}
      {showPrependAnchorControl ? <PrependAnchorControl /> : null}
      {revealClampedRowId ? (
        <RevealClampedControl rowId={revealClampedRowId} />
      ) : null}
      {rowIds.map((rowId) => (
        <div key={rowId} data-timeline-row-id={rowId}>
          {rowId}
          {(nestedRowIdsByParent[rowId] ?? []).map((nestedRowId) => (
            <div key={nestedRowId} data-timeline-row-id={nestedRowId}>
              {nestedRowId}
            </div>
          ))}
        </div>
      ))}
    </BottomAnchoredScrollBody>,
  );

  const scrollArea = requireHTMLElement(
    view.container.querySelector(`.${SCROLL_AREA_CLASS}`),
  );
  const rowElements = new Map<string, HTMLElement>();
  const allRowIds = [
    ...rowIds,
    ...rowIds.flatMap((rowId) => nestedRowIdsByParent[rowId] ?? []),
  ];
  for (const rowId of allRowIds) {
    rowElements.set(
      rowId,
      requireHTMLElement(
        view.container.querySelector(`[data-timeline-row-id="${rowId}"]`),
      ),
    );
  }

  return {
    getByRole: view.getByRole,
    scrollArea,
    rowElements,
    unmount: view.unmount,
  };
}

function readAnchor(threadId: string) {
  return getDefaultStore().get(threadTimelineScrollAnchorAtomFamily(threadId));
}

beforeEach(() => {
  ResizeObserverMock.instances = [];
  nextAnimationFrameId = 1;
  animationFrameCallbacks = new Map();
  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  installAnimationFrameMocks();
});

afterEach(() => {
  cleanup();
  // Reset the in-memory anchors so tests don't leak captured state.
  const store = getDefaultStore();
  for (const threadId of ["thread-a", "thread-b"]) {
    store.set(threadTimelineScrollAnchorAtomFamily(threadId), null);
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("BottomAnchoredScrollBody scroll preservation", () => {
  it("does not apply a cancelled prepend anchor to unrelated later growth", () => {
    const { getByRole, scrollArea } = renderTimeline({
      threadId: "thread-a",
      rowIds: ["row-a", "row-b"],
      showPrependAnchorControl: true,
    });
    setScrollMetrics(scrollArea, {
      scrollHeight: 400,
      clientHeight: 100,
      scrollTop: 150,
    });

    fireEvent.click(getByRole("button", { name: "Arm prepend" }));
    fireEvent.click(getByRole("button", { name: "Cancel prepend" }));
    setScrollMetrics(scrollArea, {
      scrollHeight: 450,
      clientHeight: 100,
      scrollTop: 150,
    });
    fireEvent.click(getByRole("button", { name: "Rerender" }));

    expect(scrollArea.scrollTop).toBe(150);
  });

  it("restores the captured row only when the matching prepend commits", () => {
    const { getByRole, scrollArea, rowElements } = renderTimeline({
      threadId: "thread-a",
      rowIds: ["row-a", "row-b", "row-c"],
      showPrependAnchorControl: true,
    });
    mockScrollAreaRect(scrollArea);
    mockRowRect(requireHTMLElement(rowElements.get("row-a")!), {
      top: -120,
      bottom: -20,
    });
    const rowB = requireHTMLElement(rowElements.get("row-b")!);
    const rowBRect = vi
      .spyOn(rowB, "getBoundingClientRect")
      .mockReturnValue(new DOMRect(0, -20, 100, 100));
    mockRowRect(requireHTMLElement(rowElements.get("row-c")!), {
      top: 80,
      bottom: 180,
    });
    setScrollMetrics(scrollArea, {
      scrollHeight: 400,
      clientHeight: 100,
      scrollTop: 150,
    });

    fireEvent.click(getByRole("button", { name: "Arm prepend" }));

    // Realtime growth below the viewport does not consume or apply the anchor.
    setScrollMetrics(scrollArea, {
      scrollHeight: 450,
      clientHeight: 100,
      scrollTop: 150,
    });
    fireEvent.click(getByRole("button", { name: "Rerender" }));
    expect(scrollArea.scrollTop).toBe(150);

    // The requested prepend moves the captured row down by 100px. Explicitly
    // restoring that request preserves the row's prior viewport position.
    rowBRect.mockReturnValue(new DOMRect(0, 80, 100, 100));
    fireEvent.click(getByRole("button", { name: "Restore prepend" }));
    expect(scrollArea.scrollTop).toBe(250);
  });

  it("anchors a visible nested row and suppresses later sticky-bottom restoration", () => {
    const { getByRole, scrollArea, rowElements } = renderTimeline({
      threadId: "thread-a",
      rowIds: ["turn-row"],
      nestedRowIdsByParent: {
        "turn-row": ["nested-older", "nested-visible"],
      },
      revealClampedRowId: "nested-visible",
      showPrependAnchorControl: true,
    });
    mockScrollAreaRect(scrollArea);
    const turnRow = requireHTMLElement(rowElements.get("turn-row")!);
    mockRowRect(turnRow, { top: -200, bottom: 200 });
    mockRowRect(requireHTMLElement(rowElements.get("nested-older")!), {
      top: -120,
      bottom: -20,
    });
    const visibleNestedRow = requireHTMLElement(
      rowElements.get("nested-visible")!,
    );
    const visibleNestedRect = vi
      .spyOn(visibleNestedRow, "getBoundingClientRect")
      .mockReturnValue(new DOMRect(0, -20, 100, 100));
    setScrollMetrics(scrollArea, {
      scrollHeight: 400,
      clientHeight: 100,
      scrollTop: 300,
    });

    fireEvent.click(getByRole("button", { name: "Arm prepend" }));

    // Prepending inside the expanded turn leaves the outer wrapper's top
    // unchanged but moves the first visible child down by 100px.
    visibleNestedRect.mockReturnValue(new DOMRect(0, 80, 100, 100));
    setScrollMetrics(scrollArea, {
      scrollHeight: 500,
      clientHeight: 100,
      scrollTop: 300,
    });
    fireEvent.click(getByRole("button", { name: "Restore prepend" }));
    expect(scrollArea.scrollTop).toBe(400);
    // Browsers emit scroll for the programmatic correction. Even though the
    // corrected geometry is exactly at bottom, the request remains detached.
    fireEvent.scroll(scrollArea);
    flushAnimationFrames();
    expect(scrollArea.scrollTop).toBe(400);

    // Later realtime growth and its ResizeObserver pass must not re-arm the
    // pre-request sticky-bottom state and pull the viewport to the new bottom.
    setScrollMetrics(scrollArea, {
      scrollHeight: 650,
      clientHeight: 100,
      scrollTop: 400,
    });
    getLatestResizeObserver().trigger();
    flushAnimationFrames();
    expect(scrollArea.scrollTop).toBe(400);

    // An explicit clamped reveal that lands at max opts back into following.
    visibleNestedRect.mockReturnValue(new DOMRect(0, 200, 100, 100));
    fireEvent.click(getByRole("button", { name: "Reveal clamped" }));
    fireEvent.scroll(scrollArea);
    setScrollMetrics(scrollArea, {
      scrollHeight: 750,
      clientHeight: 100,
      scrollTop: 550,
    });
    getLatestResizeObserver().trigger();
    flushAnimationFrames();
    expect(scrollArea.scrollTop).toBe(650);
  });

  it("keeps the visible ancestor when a nested row is only a bottom sliver", () => {
    const { getByRole, scrollArea, rowElements } = renderTimeline({
      threadId: "thread-a",
      rowIds: ["turn-row"],
      nestedRowIdsByParent: { "turn-row": ["nested-sliver"] },
      showPrependAnchorControl: true,
    });
    mockScrollAreaRect(scrollArea);
    const turnRow = requireHTMLElement(rowElements.get("turn-row")!);
    mockRowRect(turnRow, { top: -20, bottom: 110 });
    const nestedSliver = requireHTMLElement(rowElements.get("nested-sliver")!);
    const nestedRect = vi
      .spyOn(nestedSliver, "getBoundingClientRect")
      .mockReturnValue(new DOMRect(0, 90, 100, 20));
    setScrollMetrics(scrollArea, {
      scrollHeight: 400,
      clientHeight: 100,
      scrollTop: 150,
    });

    fireEvent.click(getByRole("button", { name: "Arm prepend" }));
    nestedRect.mockReturnValue(new DOMRect(0, 140, 100, 20));
    fireEvent.click(getByRole("button", { name: "Restore prepend" }));

    // The outer content is what occupied the viewport; preserving a 10px child
    // sliver would have shifted scrollTop by 50px.
    expect(scrollArea.scrollTop).toBe(150);
  });

  it("does not restore a visible nested row after user scroll intent", () => {
    const { getByRole, scrollArea, rowElements } = renderTimeline({
      threadId: "thread-a",
      rowIds: ["turn-row"],
      nestedRowIdsByParent: { "turn-row": ["nested-visible"] },
      showPrependAnchorControl: true,
    });
    mockScrollAreaRect(scrollArea);
    mockRowRect(requireHTMLElement(rowElements.get("turn-row")!), {
      top: -200,
      bottom: 200,
    });
    const visibleNestedRow = requireHTMLElement(
      rowElements.get("nested-visible")!,
    );
    const visibleNestedRect = vi
      .spyOn(visibleNestedRow, "getBoundingClientRect")
      .mockReturnValue(new DOMRect(0, -20, 100, 100));
    setScrollMetrics(scrollArea, {
      scrollHeight: 400,
      clientHeight: 100,
      scrollTop: 150,
    });

    fireEvent.click(getByRole("button", { name: "Arm prepend" }));
    fireEvent.wheel(scrollArea, { deltaY: -20 });
    visibleNestedRect.mockReturnValue(new DOMRect(0, 80, 100, 100));
    fireEvent.click(getByRole("button", { name: "Restore prepend" }));

    expect(scrollArea.scrollTop).toBe(150);
  });

  it("does not restore a prepend anchor after user scroll intent", () => {
    const { getByRole, scrollArea, rowElements } = renderTimeline({
      threadId: "thread-a",
      rowIds: ["row-a", "row-b"],
      showPrependAnchorControl: true,
    });
    mockScrollAreaRect(scrollArea);
    mockRowRect(requireHTMLElement(rowElements.get("row-a")!), {
      top: -120,
      bottom: -20,
    });
    const rowB = requireHTMLElement(rowElements.get("row-b")!);
    const rowBRect = vi
      .spyOn(rowB, "getBoundingClientRect")
      .mockReturnValue(new DOMRect(0, -20, 100, 100));
    setScrollMetrics(scrollArea, {
      scrollHeight: 400,
      clientHeight: 100,
      scrollTop: 150,
    });

    fireEvent.click(getByRole("button", { name: "Arm prepend" }));
    fireEvent.wheel(scrollArea, { deltaY: -20 });
    rowBRect.mockReturnValue(new DOMRect(0, 80, 100, 100));
    fireEvent.click(getByRole("button", { name: "Restore prepend" }));

    expect(scrollArea.scrollTop).toBe(150);
  });

  it("captures the top-most visible row when scrolled mid-timeline", () => {
    const { scrollArea, rowElements } = renderTimeline({
      threadId: "thread-a",
      rowIds: ["row-a", "row-b", "row-c"],
    });
    mockScrollAreaRect(scrollArea);
    // row-a fully above the viewport; row-b is the first still visible, scrolled
    // 20px past its own top; row-c below it.
    mockRowRect(requireHTMLElement(rowElements.get("row-a")!), {
      top: -120,
      bottom: -20,
    });
    mockRowRect(requireHTMLElement(rowElements.get("row-b")!), {
      top: -20,
      bottom: 80,
    });
    mockRowRect(requireHTMLElement(rowElements.get("row-c")!), {
      top: 80,
      bottom: 180,
    });
    setScrollMetrics(scrollArea, {
      scrollHeight: 400,
      clientHeight: 100,
      scrollTop: 150,
    });

    // User-intent scroll away from bottom, then a scroll event triggers capture.
    fireEvent.wheel(scrollArea);
    fireEvent.scroll(scrollArea);

    expect(readAnchor("thread-a")).toEqual({
      rowId: "row-b",
      offsetWithinRow: 20,
      atBottom: false,
    });
  });

  it("restores near the saved row when returning to a thread", () => {
    getDefaultStore().set(threadTimelineScrollAnchorAtomFamily("thread-a"), {
      rowId: "row-b",
      offsetWithinRow: 20,
      atBottom: false,
    });

    const { scrollArea, rowElements } = renderTimeline({
      threadId: "thread-a",
      rowIds: ["row-a", "row-b", "row-c"],
    });
    mockScrollAreaRect(scrollArea);
    // On remount row-b's top sits 200px down from the scroll area's top, so
    // revealing it requires scrollTop 200; the within-row offset adds 20.
    mockRowRect(requireHTMLElement(rowElements.get("row-b")!), {
      top: 200,
      bottom: 300,
    });
    setScrollMetrics(scrollArea, {
      scrollHeight: 400,
      clientHeight: 100,
      scrollTop: 0,
    });

    // The mount layout effect already ran during render; re-driving the
    // ResizeObserver settle path applies the restore against the mocked rects.
    getLatestResizeObserver().trigger();

    expect(scrollArea.scrollTop).toBe(220);
  });

  it("returns to the bottom when the thread was left at the bottom", () => {
    const { scrollArea } = renderTimeline({
      threadId: "thread-a",
      rowIds: ["row-a", "row-b", "row-c"],
    });
    mockScrollAreaRect(scrollArea);
    setScrollMetrics(scrollArea, {
      scrollHeight: 400,
      clientHeight: 100,
      scrollTop: 300,
    });

    fireEvent.scroll(scrollArea);

    // Capture records at-bottom, not a row.
    expect(readAnchor("thread-a")).toEqual({
      rowId: "",
      offsetWithinRow: 0,
      atBottom: true,
    });
  });

  it("does not restore a row when the saved anchor is at the bottom", () => {
    getDefaultStore().set(threadTimelineScrollAnchorAtomFamily("thread-a"), {
      rowId: "",
      offsetWithinRow: 0,
      atBottom: true,
    });

    const { scrollArea, rowElements } = renderTimeline({
      threadId: "thread-a",
      rowIds: ["row-a", "row-b"],
    });
    mockScrollAreaRect(scrollArea);
    const rowB = requireHTMLElement(rowElements.get("row-b")!);
    const rowBScrollSpy = vi.spyOn(rowB, "getBoundingClientRect");
    setScrollMetrics(scrollArea, {
      scrollHeight: 400,
      clientHeight: 100,
      scrollTop: 300,
    });

    getLatestResizeObserver().trigger();

    // A bottom anchor must not pull the view to a row; scrollTop stays at bottom.
    expect(scrollArea.scrollTop).toBe(300);
    expect(rowBScrollSpy).not.toHaveBeenCalled();
  });

  it("falls back to the bottom when the saved row never appears", () => {
    getDefaultStore().set(threadTimelineScrollAnchorAtomFamily("thread-a"), {
      rowId: "row-gone",
      offsetWithinRow: 20,
      atBottom: false,
    });

    // The saved row id isn't among the rendered rows (it was deleted/never
    // hydrated), so restore can never anchor to it.
    const { scrollArea } = renderTimeline({
      threadId: "thread-a",
      rowIds: ["row-a", "row-b"],
    });
    mockScrollAreaRect(scrollArea);
    setScrollMetrics(scrollArea, {
      scrollHeight: 400,
      clientHeight: 100,
      scrollTop: 0,
    });

    // Exhaust the settle attempts. The mount layout effect consumed the first of
    // the 8 attempts, so 7 ResizeObserver passes drive the remainder to zero; the
    // final pass re-enables stick-to-bottom and scrolls to the bottom inline.
    // (No surplus trigger here: an extra pass after the fallback would scroll to
    // bottom via `handleScrollAreaResize`'s own `queueBottomRestore`, masking a
    // fallback that forgot to scroll.)
    const observer = getLatestResizeObserver();
    for (let attempt = 0; attempt < 7; attempt += 1) {
      observer.trigger();
    }

    expect(scrollArea.scrollTop).toBe(300);
  });

  it("does not let a pending saved-row restore undo an explicit bottom scroll", () => {
    getDefaultStore().set(threadTimelineScrollAnchorAtomFamily("thread-a"), {
      rowId: "row-b",
      offsetWithinRow: 20,
      atBottom: false,
    });

    const { getByRole, scrollArea, rowElements } = renderTimeline({
      threadId: "thread-a",
      rowIds: ["row-a", "row-b", "row-c"],
      showScrollToBottomControl: true,
    });
    mockScrollAreaRect(scrollArea);
    mockRowRect(requireHTMLElement(rowElements.get("row-b")!), {
      top: -100,
      bottom: 0,
    });
    setScrollMetrics(scrollArea, {
      scrollHeight: 400,
      clientHeight: 100,
      scrollTop: 0,
    });

    fireEvent.click(getByRole("button", { name: "Bottom" }));
    expect(scrollArea.scrollTop).toBe(300);

    getLatestResizeObserver().trigger();

    expect(scrollArea.scrollTop).toBe(300);
  });

  it("keeps sticking after manual scroll reaches bottom before more growth", () => {
    const { scrollArea } = renderTimeline({
      threadId: "thread-a",
      rowIds: ["row-a", "row-b", "row-c"],
    });
    mockScrollAreaRect(scrollArea);

    setScrollMetrics(scrollArea, {
      scrollHeight: 400,
      clientHeight: 100,
      scrollTop: 150,
    });

    fireEvent.wheel(scrollArea, { deltaY: 1_000 });
    setScrollMetrics(scrollArea, {
      scrollHeight: 400,
      clientHeight: 100,
      scrollTop: 300,
    });
    fireEvent.scroll(scrollArea);

    fireEvent.wheel(scrollArea, { deltaY: 200 });

    setScrollMetrics(scrollArea, {
      scrollHeight: 450,
      clientHeight: 100,
      scrollTop: scrollArea.scrollTop,
    });
    fireEvent.scroll(scrollArea);

    expect(readAnchor("thread-a")).toEqual({
      rowId: "",
      offsetWithinRow: 0,
      atBottom: true,
    });

    getLatestResizeObserver().trigger();

    expect(scrollArea.scrollTop).toBe(350);
  });

  it("preserves bottom intent when unmounting during transient off-bottom layout", () => {
    const { scrollArea, rowElements, unmount } = renderTimeline({
      threadId: "thread-a",
      rowIds: ["row-a", "row-b", "row-c"],
    });
    getDefaultStore().set(threadTimelineScrollAnchorAtomFamily("thread-a"), {
      rowId: "row-b",
      offsetWithinRow: 20,
      atBottom: false,
    });
    mockScrollAreaRect(scrollArea);
    mockRowRect(requireHTMLElement(rowElements.get("row-a")!), {
      top: -20,
      bottom: 80,
    });
    mockRowRect(requireHTMLElement(rowElements.get("row-b")!), {
      top: 80,
      bottom: 180,
    });
    setScrollMetrics(scrollArea, {
      scrollHeight: 400,
      clientHeight: 100,
      // Layout/streaming has temporarily left us visibly off the physical bottom,
      // but no user scroll intent disabled sticky-bottom.
      scrollTop: 250,
    });

    unmount();

    expect(readAnchor("thread-a")).toEqual({
      rowId: "",
      offsetWithinRow: 0,
      atBottom: true,
    });
  });

  it("preserves a user-scrolled row when unmounting before the scroll event", () => {
    const { scrollArea, rowElements, unmount } = renderTimeline({
      threadId: "thread-a",
      rowIds: ["row-a", "row-b", "row-c"],
    });
    getDefaultStore().set(threadTimelineScrollAnchorAtomFamily("thread-a"), {
      rowId: "",
      offsetWithinRow: 0,
      atBottom: true,
    });
    mockScrollAreaRect(scrollArea);
    mockRowRect(requireHTMLElement(rowElements.get("row-a")!), {
      top: -120,
      bottom: -20,
    });
    mockRowRect(requireHTMLElement(rowElements.get("row-b")!), {
      top: -20,
      bottom: 80,
    });
    mockRowRect(requireHTMLElement(rowElements.get("row-c")!), {
      top: 80,
      bottom: 180,
    });
    setScrollMetrics(scrollArea, {
      scrollHeight: 400,
      clientHeight: 100,
      scrollTop: 150,
    });

    fireEvent.wheel(scrollArea);
    unmount();

    expect(readAnchor("thread-a")).toEqual({
      rowId: "row-b",
      offsetWithinRow: 20,
      atBottom: false,
    });
  });

  it("restores thread A's own anchor after a fast A -> B -> A switch", () => {
    // Leave A mid-timeline at row-b.
    const a1 = renderTimeline({
      threadId: "thread-a",
      rowIds: ["a-row-1", "a-row-2", "a-row-3"],
    });
    mockScrollAreaRect(a1.scrollArea);
    mockRowRect(requireHTMLElement(a1.rowElements.get("a-row-1")!), {
      top: -120,
      bottom: -20,
    });
    mockRowRect(requireHTMLElement(a1.rowElements.get("a-row-2")!), {
      top: -20,
      bottom: 80,
    });
    mockRowRect(requireHTMLElement(a1.rowElements.get("a-row-3")!), {
      top: 80,
      bottom: 180,
    });
    setScrollMetrics(a1.scrollArea, {
      scrollHeight: 400,
      clientHeight: 100,
      scrollTop: 150,
    });
    fireEvent.wheel(a1.scrollArea);
    fireEvent.scroll(a1.scrollArea);
    a1.unmount();

    // Switch to B and leave it mid-timeline at a different row.
    const b = renderTimeline({
      threadId: "thread-b",
      rowIds: ["b-row-1", "b-row-2"],
    });
    mockScrollAreaRect(b.scrollArea);
    mockRowRect(requireHTMLElement(b.rowElements.get("b-row-1")!), {
      top: -10,
      bottom: 90,
    });
    mockRowRect(requireHTMLElement(b.rowElements.get("b-row-2")!), {
      top: 90,
      bottom: 190,
    });
    setScrollMetrics(b.scrollArea, {
      scrollHeight: 400,
      clientHeight: 100,
      scrollTop: 150,
    });
    fireEvent.wheel(b.scrollArea);
    fireEvent.scroll(b.scrollArea);
    b.unmount();

    // Each thread's atom holds its own row, keyed independently.
    expect(readAnchor("thread-a")).toEqual({
      rowId: "a-row-2",
      offsetWithinRow: 20,
      atBottom: false,
    });
    expect(readAnchor("thread-b")).toEqual({
      rowId: "b-row-1",
      offsetWithinRow: 10,
      atBottom: false,
    });

    // Return to A: it must restore A's row (a-row-2), not B's.
    const a2 = renderTimeline({
      threadId: "thread-a",
      rowIds: ["a-row-1", "a-row-2", "a-row-3"],
    });
    mockScrollAreaRect(a2.scrollArea);
    mockRowRect(requireHTMLElement(a2.rowElements.get("a-row-2")!), {
      top: 200,
      bottom: 300,
    });
    setScrollMetrics(a2.scrollArea, {
      scrollHeight: 400,
      clientHeight: 100,
      scrollTop: 0,
    });

    getLatestResizeObserver().trigger();

    expect(a2.scrollArea.scrollTop).toBe(220);
  });
});
