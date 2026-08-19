// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getDefaultStore } from "jotai";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TimelineRow } from "@bb/server-contract";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import {
  BottomAnchorContext,
  type BottomAnchorContextValue,
} from "@/components/ui/bottom-anchored-scroll-body";
import { threadTimelineScrollAnchorAtomFamily } from "@/lib/thread-timeline-scroll-anchor";
import {
  commandRow,
  conversationRow,
  turnRow,
} from "@/test/fixtures/thread-timeline-rows";
import { ThreadTimelineRows } from "./ThreadTimelineRows";
import { TIMELINE_WINDOW_MIN_OVERSCAN_PX } from "./timeline-windowing";

// The window is driven by real DOM primitives jsdom lacks (layout,
// ResizeObserver, rAF), so those are simulated here: a tiny flex-column layout
// engine answers getBoundingClientRect / scrollHeight for the scroll area, the
// list, spacers and row wrappers from per-row heights the test controls, and a
// ResizeObserver stub lets the test report those heights to the hook. Nothing
// in the timeline's own code is mocked.

const THREAD_ID = "thr_windowing";
const ROW_COUNT = 300;
const GAP_PX = 8;
/** `estimateSkippedTimelineRowBlockSizePx` for a turn row (class default). */
const TURN_ROW_ESTIMATE_PX = 20;
const VIEWPORT_HEIGHT_PX = 800;

interface FrameQueue {
  callbacks: Array<() => void>;
}

const frames: FrameQueue = { callbacks: [] };

function flushFrames(): void {
  act(() => {
    // Callbacks scheduled while flushing run in the next flush.
    const pending = frames.callbacks;
    frames.callbacks = [];
    for (const callback of pending) callback();
  });
}

interface ObservedTarget {
  callback: ResizeObserverCallback;
  observer: ResizeObserver;
}

const observedTargets = new Map<Element, ObservedTarget>();

class ResizeObserverStub implements ResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element): void {
    observedTargets.set(target, { callback: this.callback, observer: this });
  }
  unobserve(target: Element): void {
    observedTargets.delete(target);
  }
  disconnect(): void {
    for (const [target, observed] of observedTargets) {
      if (observed.observer === this) observedTargets.delete(target);
    }
  }
}

/** Real heights per row id; rows without one take the estimate. */
const rowHeights = new Map<string, number>();

function reportMeasuredHeights(): void {
  act(() => {
    for (const [target, observed] of observedTargets) {
      if (!(target instanceof HTMLElement)) continue;
      const id = target.dataset.timelineWindowEntry;
      if (id === undefined) continue;
      const height = elementHeight(target);
      observed.callback(
        [
          {
            target,
            contentRect: new DOMRect(0, 0, 320, height),
            borderBoxSize: [{ blockSize: height, inlineSize: 320 }],
            contentBoxSize: [{ blockSize: height, inlineSize: 320 }],
            devicePixelContentBoxSize: [{ blockSize: height, inlineSize: 320 }],
          },
        ],
        observed.observer,
      );
    }
  });
}

function elementHeight(element: HTMLElement): number {
  if (element.dataset.timelineRowSpacer !== undefined) {
    return Number.parseFloat(element.style.height) || 0;
  }
  const id = element.dataset.timelineWindowEntry;
  if (id !== undefined) {
    return rowHeights.get(id) ?? TURN_ROW_ESTIMATE_PX;
  }
  return 0;
}

let scrollArea: HTMLDivElement;
let scrollTopValue = 0;

function listElement(): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    '[data-timeline-row-list="top-level"]',
  );
}

/** Offset of a list child from the top of the list: previous siblings + gaps. */
function contentOffsetOf(element: HTMLElement): number {
  let offset = 0;
  const parent = element.parentElement;
  if (!parent) return 0;
  for (const sibling of Array.from(parent.children)) {
    if (sibling === element) break;
    if (sibling instanceof HTMLElement) {
      offset += elementHeight(sibling) + GAP_PX;
    }
  }
  return offset;
}

function listHeight(): number {
  const list = listElement();
  if (!list) return 0;
  let height = 0;
  const children = Array.from(list.children);
  for (const child of children) {
    if (child instanceof HTMLElement) height += elementHeight(child);
  }
  return height + Math.max(0, children.length - 1) * GAP_PX;
}

function rect(top: number, height: number): DOMRect {
  return new DOMRect(0, top, 320, height);
}

function installLayoutSimulation(): void {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function mockRect(this: HTMLElement) {
      if (this === scrollArea) {
        return rect(0, VIEWPORT_HEIGHT_PX);
      }
      if (this.dataset.timelineRowList === "top-level") {
        return rect(-scrollTopValue, listHeight());
      }
      if (
        this.dataset.timelineWindowEntry !== undefined ||
        this.dataset.timelineRowSpacer !== undefined
      ) {
        return rect(
          contentOffsetOf(this) - scrollTopValue,
          elementHeight(this),
        );
      }
      return rect(0, 0);
    },
  );
}

function createScrollArea(): HTMLDivElement {
  const element = document.createElement("div");
  Object.defineProperty(element, "clientHeight", {
    configurable: true,
    get: () => VIEWPORT_HEIGHT_PX,
  });
  Object.defineProperty(element, "scrollHeight", {
    configurable: true,
    get: () => listHeight(),
  });
  Object.defineProperty(element, "scrollTop", {
    configurable: true,
    get: () => scrollTopValue,
    set: (value: number) => {
      scrollTopValue = Math.max(
        0,
        Math.min(value, Math.max(0, listHeight() - VIEWPORT_HEIGHT_PX)),
      );
    },
  });
  return element;
}

function scrollTo(top: number): void {
  scrollArea.scrollTop = top;
  act(() => {
    scrollArea.dispatchEvent(new Event("scroll"));
  });
  flushFrames();
}

let bottomAnchor: BottomAnchorContextValue;

function createBottomAnchor(): BottomAnchorContextValue {
  return {
    getScrollElement: () => scrollArea,
    isAtBottom: false,
    scrollToBottom: vi.fn(),
    scrollElementIntoView: vi.fn(),
    scrollElementIntoViewClampedToMaxScroll: vi.fn(),
    captureScrollAnchor: vi.fn(),
  };
}

function buildRows({
  count = ROW_COUNT,
  firstIndex = 0,
  withLiveTurn = false,
}: {
  count?: number;
  firstIndex?: number;
  withLiveTurn?: boolean;
} = {}): TimelineRow[] {
  const rows: TimelineRow[] = [];
  for (let index = firstIndex; index < firstIndex + count; index += 1) {
    const seq = index * 10 + 10;
    rows.push(
      turnRow({
        id: `turn_${index}`,
        turnId: `turn_${index}`,
        seq,
        sourceSeqStart: seq,
        sourceSeqEnd: seq + 5,
        status: "completed",
        threadId: THREAD_ID,
        children: [
          commandRow({
            id: `turn_${index}_command`,
            turnId: `turn_${index}`,
            command: `pnpm test --filter ${index}`,
            seq: seq + 1,
            threadId: THREAD_ID,
          }),
        ],
      }),
    );
  }
  // A running turn: several top-level rows sharing one turn id at the tail.
  if (withLiveTurn) {
    const seq = (firstIndex + count) * 10 + 10;
    rows.push(
      conversationRow({
        id: "live_user",
        role: "user",
        text: "Keep going",
        turnId: "turn_live",
        seq,
        threadId: THREAD_ID,
      }),
      turnRow({
        id: "live_turn",
        turnId: "turn_live",
        seq: seq + 1,
        sourceSeqStart: seq + 1,
        sourceSeqEnd: seq + 3,
        status: "pending",
        threadId: THREAD_ID,
        children: [
          commandRow({
            id: "live_command",
            turnId: "turn_live",
            command: "pnpm test",
            seq: seq + 2,
            status: "pending",
            threadId: THREAD_ID,
          }),
        ],
      }),
      conversationRow({
        id: "live_assistant",
        role: "assistant",
        text: "Running the tests now.",
        turnId: "turn_live",
        seq: seq + 4,
        threadId: THREAD_ID,
      }),
    );
  }
  return rows;
}

function Providers({
  children,
  compact,
  withAnchor,
  routerState,
}: {
  children: ReactNode;
  compact: boolean;
  withAnchor: boolean;
  routerState?: unknown;
}) {
  const inner = (
    <MemoryRouter
      initialEntries={[{ pathname: "/thread", state: routerState ?? null }]}
    >
      <QueryClientProvider client={new QueryClient()}>
        <CompactViewportOverrideProvider isCompactViewport={compact}>
          {children}
        </CompactViewportOverrideProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
  return withAnchor ? (
    <BottomAnchorContext.Provider value={bottomAnchor}>
      {inner}
    </BottomAnchorContext.Provider>
  ) : (
    inner
  );
}

function renderTimeline({
  compact = true,
  rows = buildRows(),
  routerState,
  status = "idle" as const,
  withAnchor = true,
}: {
  compact?: boolean;
  rows?: TimelineRow[];
  routerState?: unknown;
  status?: "idle" | "active";
  withAnchor?: boolean;
} = {}) {
  const view = render(
    <Providers
      compact={compact}
      withAnchor={withAnchor}
      routerState={routerState}
    >
      <ThreadTimelineRows
        threadId={THREAD_ID}
        timelineRows={rows}
        threadRuntimeDisplayStatus={status}
        workspaceRootPath={undefined}
      />
    </Providers>,
  );
  const rerender = (nextRows: TimelineRow[], nextStatus = status) => {
    view.rerender(
      <Providers
        compact={compact}
        withAnchor={withAnchor}
        routerState={routerState}
      >
        <ThreadTimelineRows
          threadId={THREAD_ID}
          timelineRows={nextRows}
          threadRuntimeDisplayStatus={nextStatus}
          workspaceRootPath={undefined}
        />
      </Providers>,
    );
  };
  return { ...view, rerender };
}

function mountedRowIds(): string[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>(
      '[data-timeline-row-list="top-level"] > [data-timeline-row-id]',
    ),
  ).map((element) => element.dataset.timelineRowId ?? "");
}

function spacers(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>("[data-timeline-row-spacer]"),
  );
}

function spacerHeight(element: HTMLElement): number {
  return Number.parseFloat(element.style.height);
}

function spacerRowCount(element: HTMLElement): number {
  return Number(element.dataset.timelineRowSpacer);
}

beforeEach(() => {
  frames.callbacks = [];
  observedTargets.clear();
  rowHeights.clear();
  scrollTopValue = 0;
  scrollArea = createScrollArea();
  bottomAnchor = createBottomAnchor();
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((callback: FrameRequestCallback) => {
      frames.callbacks.push(() => callback(performance.now()));
      return frames.callbacks.length;
    }),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  installLayoutSimulation();
  getDefaultStore().set(threadTimelineScrollAnchorAtomFamily(THREAD_ID), null);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ThreadTimelineRows windowing", () => {
  it("renders every row when the viewport is not compact or there is no scroll body", () => {
    renderTimeline({ compact: false });
    expect(mountedRowIds()).toHaveLength(ROW_COUNT);
    expect(spacers()).toHaveLength(0);
    cleanup();

    renderTimeline({ compact: true, withAnchor: false });
    expect(mountedRowIds()).toHaveLength(ROW_COUNT);
    expect(spacers()).toHaveLength(0);
  });

  it("mounts only the trailing rows at first and stands the rest in for one spacer", () => {
    renderTimeline();
    const mounted = mountedRowIds();
    // Bounded well below the page: the initial window covers the assumed
    // viewport plus overscan of never-measured rows.
    expect(mounted.length).toBeGreaterThan(20);
    expect(mounted.length).toBeLessThan(ROW_COUNT / 2);
    expect(mounted.at(-1)).toBe(`turn_${ROW_COUNT - 1}`);
    // Contiguous trailing block.
    const firstMountedIndex = ROW_COUNT - mounted.length;
    expect(mounted[0]).toBe(`turn_${firstMountedIndex}`);
    const [topSpacer, ...rest] = spacers();
    expect(rest).toHaveLength(0);
    expect(topSpacer).toBeDefined();
    expect(spacerRowCount(topSpacer!)).toBe(firstMountedIndex);
    // Estimated height per skipped row plus the gaps between them.
    expect(spacerHeight(topSpacer!)).toBe(
      firstMountedIndex * TURN_ROW_ESTIMATE_PX +
        (firstMountedIndex - 1) * GAP_PX,
    );
    // The spacer precedes the first mounted row in the DOM.
    const list = listElement()!;
    expect(list.firstElementChild).toBe(topSpacer);
  });

  it("follows the viewport up the list, evicting far rows below except the last one", () => {
    renderTimeline();
    // Scroll to the very top of the (estimated) list.
    scrollTo(0);
    const mounted = mountedRowIds();
    expect(mounted[0]).toBe("turn_0");
    // Rows within viewport + overscan stay; the middle of the list is gone.
    const overscanRows = Math.ceil(
      (VIEWPORT_HEIGHT_PX + TIMELINE_WINDOW_MIN_OVERSCAN_PX) /
        (TURN_ROW_ESTIMATE_PX + GAP_PX),
    );
    expect(mounted).toContain(`turn_${overscanRows - 2}`);
    expect(mounted).not.toContain("turn_150");
    // The last row is always mounted (bottom sentinel geometry).
    expect(mounted.at(-1)).toBe(`turn_${ROW_COUNT - 1}`);
    const [bottomSpacer, ...rest] = spacers();
    expect(rest).toHaveLength(0);
    expect(bottomSpacer).toBeDefined();
    // Spacer sits between the mounted head and the pinned last row.
    const list = listElement()!;
    expect(list.lastElementChild?.getAttribute("data-timeline-row-id")).toBe(
      `turn_${ROW_COUNT - 1}`,
    );
    expect(list.lastElementChild?.previousElementSibling).toBe(bottomSpacer);
    // DOM growth stays bounded: mounted rows ≈ viewport + overscan on one side.
    expect(mounted.length).toBeLessThan(overscanRows + 5);
    expect(mounted.length + spacerRowCount(bottomSpacer!)).toBe(ROW_COUNT);
  });

  it("does not re-render the window while the viewport stays inside the slack", () => {
    renderTimeline();
    scrollTo(0);
    const before = mountedRowIds();
    const [spacerBefore] = spacers();
    // A small scroll within the overscan slack changes nothing.
    scrollTo(300);
    expect(mountedRowIds()).toEqual(before);
    expect(spacers()[0]).toBe(spacerBefore);
  });

  it("uses measured heights for evicted rows and re-mounts them in place", () => {
    renderTimeline();
    scrollTo(0);
    // The rows near the top rendered taller than the estimate. Report that
    // through the ResizeObserver, then scroll away so they are evicted.
    for (let index = 0; index < 10; index += 1) {
      rowHeights.set(`turn_${index}`, 100);
    }
    reportMeasuredHeights();
    // Far enough down that the head is evicted: 100 rows * 28px.
    scrollTo(100 * (TURN_ROW_ESTIMATE_PX + GAP_PX));
    const [topSpacer] = spacers();
    expect(topSpacer).toBeDefined();
    const evictedCount = spacerRowCount(topSpacer!);
    expect(evictedCount).toBeGreaterThanOrEqual(10);
    // 10 measured rows at 100px, the rest at the estimate, gaps between all.
    expect(spacerHeight(topSpacer!)).toBe(
      10 * 100 +
        (evictedCount - 10) * TURN_ROW_ESTIMATE_PX +
        (evictedCount - 1) * GAP_PX,
    );
    expect(mountedRowIds()).not.toContain("turn_0");
    // Back to the top: the head re-mounts and the spacer disappears.
    scrollTo(0);
    expect(mountedRowIds()[0]).toBe("turn_0");
    expect(spacers().every((spacer) => spacerRowCount(spacer) > 0)).toBe(true);
    expect(
      listElement()!.firstElementChild?.getAttribute("data-timeline-row-id"),
    ).toBe("turn_0");
  });

  it("corrects scrollTop when re-mounted rows above the viewport are taller than their spacer share", () => {
    renderTimeline();
    scrollTo(0);
    // Evict the head at the estimate (never measured).
    scrollTo(100 * (TURN_ROW_ESTIMATE_PX + GAP_PX));
    const [topSpacer] = spacers();
    const evictedCount = spacerRowCount(topSpacer!);
    expect(evictedCount).toBeGreaterThan(20);
    expect(mountedRowIds()).not.toContain("turn_0");
    // Those rows are "really" 60px each: when they re-mount, everything below
    // them (including the row at the top of the viewport) shifts down by 40px
    // per row, and the window must move scrollTop with it.
    for (let index = 0; index < evictedCount; index += 1) {
      rowHeights.set(`turn_${index}`, 60);
    }
    // Scroll to a mounted row just below the spacer, close enough to the head
    // that the whole spacer re-mounts.
    const referenceIndex = evictedCount + 8;
    const targetScrollTop = referenceIndex * (TURN_ROW_ESTIMATE_PX + GAP_PX);
    scrollTo(targetScrollTop);
    const mounted = mountedRowIds();
    expect(mounted[0]).toBe("turn_0");
    // The reference row (top of the viewport before the swap) is now preceded
    // by `evictedCount` rows of 60px instead of 20px, so its content offset
    // grew by 40px per row and scrollTop followed.
    expect(scrollArea.scrollTop).toBe(targetScrollTop + evictedCount * 40);
  });

  it("keeps the same rows mounted when an older page is prepended", () => {
    const view = renderTimeline();
    scrollTo(0);
    scrollTo(120 * (TURN_ROW_ESTIMATE_PX + GAP_PX));
    const before = mountedRowIds();
    const [topSpacerBefore] = spacers();
    const spacerBeforeHeight = spacerHeight(topSpacerBefore!);
    const spacerBeforeCount = spacerRowCount(topSpacerBefore!);
    // Prepend 100 older rows (an older page landing above everything).
    const older = buildRows({ count: 100, firstIndex: -100 });
    view.rerender([...older, ...buildRows()]);
    expect(mountedRowIds()).toEqual(before);
    const [topSpacerAfter] = spacers();
    expect(spacerRowCount(topSpacerAfter!)).toBe(spacerBeforeCount + 100);
    expect(spacerHeight(topSpacerAfter!)).toBe(
      spacerBeforeHeight + 100 * (TURN_ROW_ESTIMATE_PX + GAP_PX),
    );
  });

  it("re-anchors from the DOM instead of jumping when the anchored row is replaced", () => {
    const view = renderTimeline();
    scrollTo(0);
    const scrollTop = 100 * (TURN_ROW_ESTIMATE_PX + GAP_PX);
    scrollTo(scrollTop);
    // The viewport now starts on turn_100; the window is anchored to it.
    const before = mountedRowIds();
    expect(before).toContain("turn_100");
    // Rows are replaced under the anchor (its id changes, e.g. a projection
    // rebuilt the row) while the user does not scroll.
    const rows = buildRows().map((row) =>
      row.id === "turn_100" ? { ...row, id: "turn_100_replaced" } : row,
    );
    view.rerender(rows);
    const after = mountedRowIds();
    expect(after).toContain("turn_100_replaced");
    expect(after).toContain("turn_99");
    expect(after).toContain("turn_101");
    // Not re-windowed around the bottom.
    expect(after).not.toContain(`turn_${ROW_COUNT - 2}`);
    expect(scrollArea.scrollTop).toBe(scrollTop);
    // And a following scroll inside the slack still changes nothing.
    scrollTo(scrollTop + 200);
    expect(mountedRowIds()).toEqual(after);
  });

  it("keeps the running turn's rows mounted while the user reads far above", () => {
    renderTimeline({
      rows: buildRows({ withLiveTurn: true }),
      status: "active",
    });
    scrollTo(0);
    const mounted = mountedRowIds();
    expect(mounted[0]).toBe("turn_0");
    expect(mounted.slice(-3)).toEqual([
      "live_user",
      "live_turn",
      "live_assistant",
    ]);
    // The completed turn just before the live one is not part of the tail.
    expect(mounted).not.toContain(`turn_${ROW_COUNT - 1}`);
  });

  it("keeps the rows the user is reading mounted when the live turn grows below a stale bottom anchor", () => {
    const rows = buildRows({ withLiveTurn: true });
    const view = renderTimeline({ rows, status: "active" });
    // Read at the bottom, then scroll up a little: inside the slack, so the
    // window is not re-sampled and its anchor still says "bottom".
    scrollTo(listHeight());
    const readingScrollTop = listHeight() - VIEWPORT_HEIGHT_PX - 700;
    scrollTo(readingScrollTop);
    const visibleBefore = mountedRowIds().filter((id) => {
      const wrapper = document.querySelector<HTMLElement>(
        `[data-timeline-row-id="${id}"]`,
      );
      const rowRect = wrapper?.getBoundingClientRect();
      return (
        rowRect !== undefined &&
        rowRect.bottom > 0 &&
        rowRect.top < VIEWPORT_HEIGHT_PX
      );
    });
    expect(visibleBefore.length).toBeGreaterThan(3);
    // The streaming assistant row grows by 3000px (measured), then a rows
    // commit lands: another top-level row of the live turn.
    rowHeights.set("live_assistant", 3000);
    reportMeasuredHeights();
    view.rerender(
      [
        ...rows,
        conversationRow({
          id: "live_assistant_2",
          role: "assistant",
          text: "Still running.",
          turnId: "turn_live",
          seq: ROW_COUNT * 10 + 15,
          threadId: THREAD_ID,
        }),
      ],
      "active",
    );
    // The rows in the viewport must not be evicted into a spacer because the
    // resolved "bottom" moved 3000px below the user; the window re-samples
    // from the DOM instead and keeps them, plus the live tail.
    const after = mountedRowIds();
    for (const id of visibleBefore) {
      expect(after).toContain(id);
    }
    expect(after.slice(-4)).toEqual([
      "live_user",
      "live_turn",
      "live_assistant",
      "live_assistant_2",
    ]);
    expect(scrollArea.scrollTop).toBe(readingScrollTop);
  });

  it("keeps the search target's top-level row mounted so the reveal can find it", () => {
    // Search target is turn_10's command (seq 111), which the initial bottom
    // window would otherwise leave in the spacer.
    renderTimeline({
      routerState: { searchMessageSeq: 111, searchThreadId: THREAD_ID },
    });
    const mounted = mountedRowIds();
    expect(mounted).toContain("turn_10");
    expect(mounted).not.toContain("turn_11");
    expect(mounted).not.toContain("turn_9");
    // It sits between two spacers.
    const [above, below] = spacers();
    expect(above && below).toBeTruthy();
    expect(spacerRowCount(above!)).toBe(10);
  });

  it("seeds the first window from the saved per-thread scroll anchor", () => {
    getDefaultStore().set(threadTimelineScrollAnchorAtomFamily(THREAD_ID), {
      rowId: "turn_50",
      offsetWithinRow: 4,
      atBottom: false,
    });
    renderTimeline();
    const mounted = mountedRowIds();
    expect(mounted).toContain("turn_50");
    expect(mounted).toContain("turn_40");
    expect(mounted).toContain("turn_60");
    // Not the trailing block: the bottom is a spacer plus the pinned last row.
    expect(mounted).not.toContain(`turn_${ROW_COUNT - 2}`);
    expect(mounted.at(-1)).toBe(`turn_${ROW_COUNT - 1}`);
  });

  it("windows around the current viewport when it switches on after mount", () => {
    const rows = buildRows();
    const timeline = (compact: boolean) => (
      <Providers compact={compact} withAnchor>
        <ThreadTimelineRows
          threadId={THREAD_ID}
          timelineRows={rows}
          threadRuntimeDisplayStatus="idle"
          workspaceRootPath={undefined}
        />
      </Providers>
    );
    const view = render(timeline(false));
    expect(mountedRowIds()).toHaveLength(ROW_COUNT);
    // The user is reading at the top of the fully mounted list when the
    // viewport crosses into compact (rotation, split-pane resize).
    scrollArea.scrollTop = 0;
    view.rerender(timeline(true));
    // Until the scroll area is sampled nothing is evicted.
    expect(mountedRowIds()).toHaveLength(ROW_COUNT);
    flushFrames();
    const mounted = mountedRowIds();
    expect(mounted[0]).toBe("turn_0");
    expect(mounted.length).toBeLessThan(ROW_COUNT / 2);
    expect(spacers()).toHaveLength(1);
    expect(scrollArea.scrollTop).toBe(0);
  });

  it("remembers a manually expanded row across eviction and re-mount", () => {
    renderTimeline();
    scrollTo(0);
    const rowWrapper = (id: string) =>
      document.querySelector<HTMLElement>(`[data-timeline-row-id="${id}"]`);
    const toggleOf = (id: string) =>
      rowWrapper(id)?.querySelector<HTMLButtonElement>(
        "button[aria-expanded]",
      ) ?? null;
    expect(toggleOf("turn_2")?.getAttribute("aria-expanded")).toBe("false");
    act(() => {
      toggleOf("turn_2")?.click();
    });
    expect(toggleOf("turn_2")?.getAttribute("aria-expanded")).toBe("true");
    // Scroll far enough to evict the head, then come back.
    scrollTo(100 * (TURN_ROW_ESTIMATE_PX + GAP_PX));
    expect(rowWrapper("turn_2")).toBeNull();
    scrollTo(0);
    expect(toggleOf("turn_2")?.getAttribute("aria-expanded")).toBe("true");
    // Neighbours were not touched.
    expect(toggleOf("turn_3")?.getAttribute("aria-expanded")).toBe("false");
  });

  it("wraps and pins the unread divider", () => {
    const view = render(
      <Providers compact withAnchor>
        <ThreadTimelineRows
          threadId={THREAD_ID}
          timelineRows={buildRows()}
          threadRuntimeDisplayStatus="idle"
          workspaceRootPath={undefined}
          unreadDividerAutoScroll={false}
          unreadDividerPlacement={{ kind: "after-cutoff", cutoffAt: 55 }}
        />
      </Providers>,
    );
    const divider = view.getByTestId("thread-unread-divider");
    const wrapper = divider.parentElement!;
    expect(wrapper.dataset.timelineWindowEntry).toBe("thread-unread-divider");
    // Placed before turn_5 (createdAt 60 > 55) which is far above the initial
    // window, so it renders between two spacers.
    expect(
      wrapper.previousElementSibling?.hasAttribute("data-timeline-row-spacer"),
    ).toBe(true);
    expect(
      wrapper.nextElementSibling?.hasAttribute("data-timeline-row-spacer"),
    ).toBe(true);
    expect(mountedRowIds()).not.toContain("turn_5");
  });
});
