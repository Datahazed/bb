import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefCallback,
} from "react";
import { useStore } from "jotai";
import { useBottomAnchoredScroll } from "@/components/ui/bottom-anchored-scroll-body.js";
import { useAutoHeightSnap } from "@/components/ui/height-transition.js";
import { threadTimelineScrollAnchorAtomFamily } from "@/lib/thread-timeline-scroll-anchor.js";
import {
  buildTimelineWindowLayout,
  buildTimelineWindowSegments,
  computeTimelineWindowRange,
  findTimelineWindowEntryAtOffset,
  resolveTimelineViewportTop,
  resolveTimelineWindowRangeIds,
  timelineWindowOverscanPx,
  timelineWindowRangeCoversViewport,
  timelineWindowRangeToIds,
  TIMELINE_WINDOW_SLACK_FRACTION,
  type TimelineViewportAnchor,
  type TimelineWindowEntry,
  type TimelineWindowLayout,
  type TimelineWindowRange,
  type TimelineWindowRangeIds,
  type TimelineWindowSegment,
} from "./timeline-windowing.js";

/**
 * Windows the top-level timeline list: keeps the entries around the viewport
 * mounted, replaces far entries with height-preserving spacers, and re-mounts
 * them as the viewport approaches. Rows are measured through one
 * ResizeObserver so an evicted row's spacer share is its last real height.
 *
 * Interplay with the surrounding scroll body (see
 * `bottom-anchored-scroll-body.tsx`), all of which keeps working because the
 * window only ever swaps entries that are at least `overscan / 2` away from
 * the viewport and compensates `scrollTop` for any resulting shift:
 *
 * - The bottom sentinel and stick-to-bottom restore see the same trailing
 *   content: the last entry (and the live turn while the thread runs) is
 *   always mounted, and a swap above the viewport is followed by a scrollTop
 *   correction in the same layout pass, so the bottom stays pinned.
 * - Older-page prepends: the viewport is anchored to an entry id, so the same
 *   entries stay mounted while the new page lands as a spacer above (or as
 *   rows, if within overscan). The scroll body's own prepend restore then sees
 *   a height delta equal to the spacer's height, exactly as before.
 * - Per-thread scroll restore and search reveal find their row in the DOM: the
 *   saved anchor seeds the initial window, and the search target's ancestors
 *   are pinned by the caller.
 * - Native scroll anchoring (Chromium) and this hook agree: both preserve the
 *   first visible mounted entry, so the correction is idempotent there and does
 *   the whole job on WebKit, which has no scroll anchoring.
 */
export interface UseTimelineWindowArgs {
  enabled: boolean;
  /** One entry per list item, in list order (memoised by the caller). */
  entries: readonly TimelineWindowEntry[];
  /** Entry ids that stay mounted wherever they are (divider, search target). */
  pinnedEntryIds: ReadonlySet<string>;
  /** Entries at or after this index stay mounted (the live tail). */
  pinnedTailStartIndex: number;
  /**
   * Thread whose saved scroll anchor seeds the first window so the scroll
   * body's mount-time restore finds its row mounted.
   */
  scrollAnchorThreadId: string | undefined;
}

export interface TimelineWindow {
  /**
   * Ref for every mounted entry wrapper. The wrapper must carry
   * `data-timeline-window-entry="<entry id>"`.
   */
  entryRef: RefCallback<HTMLElement>;
  listRef: RefCallback<HTMLDivElement>;
  /** `null` while inactive: render every entry as before. */
  segments: readonly TimelineWindowSegment[] | null;
}

interface TimelineWindowState {
  anchor: TimelineViewportAnchor | null;
  focusedEntryId: string | null;
  /**
   * Serial of the sample this state came from (0 before any sample). Ties a
   * pending scrollTop correction to the commit that renders its window.
   */
  sampleSerial: number;
  /** `null` until the scroll area has been sampled (render everything). */
  viewportHeightPx: number | null;
}

interface PendingScrollCompensation {
  contentOffsetPx: number;
  entryId: string;
  sampleSerial: number;
}

interface LayoutCache {
  entries: readonly TimelineWindowEntry[];
  gapPx: number;
  heightsVersion: number;
  layout: TimelineWindowLayout;
}

/**
 * Mutable, render-independent bookkeeping: measurements, mounted elements and
 * the last committed range. Held in a ref; the render only reads it to build
 * the layout, and every decision that changes what is mounted goes through
 * React state.
 */
class TimelineWindowController {
  committedRangeIds: TimelineWindowRangeIds | null = null;
  /** `sampleSerial` of the state the last committed plan was built from. */
  committedSampleSerial = -1;
  committedSignature: string | null = null;
  readonly elementsById = new Map<string, HTMLElement>();
  entries: readonly TimelineWindowEntry[] = [];
  entryIndexById: ReadonlyMap<string, number> = new Map();
  gapPx = DEFAULT_LIST_GAP_PX;
  readonly heightsById = new Map<string, number>();
  heightsVersion = 0;
  listElement: HTMLDivElement | null = null;
  pendingCompensation: PendingScrollCompensation | null = null;
  sampleSerial = 0;
  private layoutCache: LayoutCache | null = null;
  private resizeObserver: ResizeObserver | null | undefined;

  getLayout(entries: readonly TimelineWindowEntry[]): TimelineWindowLayout {
    const cache = this.layoutCache;
    if (
      cache !== null &&
      cache.entries === entries &&
      cache.gapPx === this.gapPx &&
      cache.heightsVersion === this.heightsVersion
    ) {
      return cache.layout;
    }
    // Ids leave the list when turns are summarised; drop their measurements
    // once they clearly dominate so the map does not grow with thread history.
    if (this.heightsById.size > entries.length * 2 + 64) {
      const liveIds = new Set(entries.map((entry) => entry.id));
      for (const id of this.heightsById.keys()) {
        if (!liveIds.has(id)) {
          this.heightsById.delete(id);
        }
      }
    }
    const layout = buildTimelineWindowLayout({
      entries,
      gapPx: this.gapPx,
      measuredHeightsById: this.heightsById,
    });
    this.layoutCache = {
      entries,
      gapPx: this.gapPx,
      heightsVersion: this.heightsVersion,
      layout,
    };
    return layout;
  }

  getResizeObserver(): ResizeObserver | null {
    if (this.resizeObserver === undefined) {
      this.resizeObserver =
        typeof ResizeObserver === "undefined"
          ? null
          : new ResizeObserver((observed) => {
              for (const entry of observed) {
                const target = entry.target;
                if (!(target instanceof HTMLElement)) {
                  continue;
                }
                const id = target.dataset.timelineWindowEntry;
                if (id === undefined) {
                  continue;
                }
                const height =
                  entry.borderBoxSize?.[0]?.blockSize ??
                  entry.contentRect.height;
                if (this.heightsById.get(id) !== height) {
                  this.heightsById.set(id, height);
                  this.heightsVersion += 1;
                }
              }
            });
    }
    return this.resizeObserver;
  }

  /**
   * (Re)observe every mounted wrapper. Effects can be torn down and re-run
   * without the ref callbacks running again (StrictMode), so the observer is
   * rebuilt from the element map rather than relying on the refs.
   */
  ensureObserving(): void {
    const resizeObserver = this.getResizeObserver();
    if (resizeObserver === null) {
      return;
    }
    for (const element of this.elementsById.values()) {
      resizeObserver.observe(element);
    }
  }

  attachEntry(id: string, element: HTMLElement): void {
    this.elementsById.set(id, element);
    this.getResizeObserver()?.observe(element);
  }

  detachEntry(id: string, element: HTMLElement): void {
    if (this.elementsById.get(id) === element) {
      this.elementsById.delete(id);
    }
    // Only the current observer can be watching it; a replaced one was
    // disconnected wholesale.
    if (this.resizeObserver) {
      this.resizeObserver.unobserve(element);
    }
  }

  disconnect(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = undefined;
  }
}

const DEFAULT_LIST_GAP_PX = 8;
/**
 * Viewport height assumed for the very first render, before the scroll area
 * can be measured. Generous so the first window is a superset of what the
 * real sample keeps; only the trailing (or anchored) entries mount at all.
 */
const INITIAL_VIEWPORT_HEIGHT_PX = 900;
const BOTTOM_THRESHOLD_PX = 4;
/** Below this the scrollTop correction is sub-pixel noise; skip it. */
const MIN_SCROLL_COMPENSATION_PX = 0.5;

function readListGapPx(list: HTMLElement): number {
  if (
    typeof window === "undefined" ||
    typeof window.getComputedStyle !== "function"
  ) {
    return DEFAULT_LIST_GAP_PX;
  }
  const gap = Number.parseFloat(window.getComputedStyle(list).rowGap);
  return Number.isFinite(gap) && gap >= 0 ? gap : DEFAULT_LIST_GAP_PX;
}

function hasActiveSelectionInside(list: HTMLElement): boolean {
  const selection = document.getSelection();
  if (
    selection === null ||
    selection.isCollapsed ||
    selection.rangeCount === 0
  ) {
    return false;
  }
  return (
    (selection.anchorNode !== null && list.contains(selection.anchorNode)) ||
    (selection.focusNode !== null && list.contains(selection.focusNode))
  );
}

function focusedEntryIdInside(list: HTMLElement): string | null {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || !list.contains(active)) {
    return null;
  }
  const wrapper = active.closest<HTMLElement>("[data-timeline-window-entry]");
  return wrapper?.dataset.timelineWindowEntry ?? null;
}

function segmentsSignature(
  segments: readonly TimelineWindowSegment[],
  entries: readonly TimelineWindowEntry[],
): string {
  const parts: string[] = [];
  for (const segment of segments) {
    if (segment.kind === "entry") {
      parts.push(entries[segment.index]?.id ?? "?");
    } else {
      parts.push(
        `s:${entries[segment.startIndex]?.id ?? "?"}-${entries[segment.endIndex - 1]?.id ?? "?"}`,
      );
    }
  }
  return parts.join("|");
}

function contentOffsetOf(
  element: HTMLElement,
  scrollArea: HTMLElement,
): number {
  return (
    element.getBoundingClientRect().top -
    scrollArea.getBoundingClientRect().top +
    scrollArea.scrollTop
  );
}

interface WindowPlan {
  /**
   * The committed range was kept although the state's view of the viewport
   * says it should change, because that view cannot be trusted: the anchor
   * entry left the list (rows replaced under it), or the commit is rows-driven
   * and the anchor is only as fresh as the last sample that changed the window
   * (a scroll inside the slack updates nothing, and content growing below a
   * bottom anchor moves the resolved viewport away from the real one). A
   * forced sample after commit re-reads the DOM and re-ranges from that.
   */
  needsResample: boolean;
  range: TimelineWindowRange;
  segments: TimelineWindowSegment[];
}

export function useTimelineWindow({
  enabled,
  entries,
  pinnedEntryIds,
  pinnedTailStartIndex,
  scrollAnchorThreadId,
}: UseTimelineWindowArgs): TimelineWindow {
  const bottomAnchor = useBottomAnchoredScroll();
  const snapAutoHeight = useAutoHeightSnap();
  const store = useStore();
  // Mutable bookkeeping that outlives renders. The render does read it (to
  // size spacers from the latest measurements), which the compiler flags; that
  // read is deliberate: measurements only ever change for mounted rows, whose
  // spacer share is not rendered until they are evicted by a state change.
  const controllerRef = useRef<TimelineWindowController | null>(null);
  if (controllerRef.current === null) {
    controllerRef.current = new TimelineWindowController();
  }
  const controller = controllerRef.current;
  const [state, setState] = useState<TimelineWindowState>(() => {
    const savedAnchor =
      scrollAnchorThreadId === undefined
        ? null
        : store.get(threadTimelineScrollAnchorAtomFamily(scrollAnchorThreadId));
    return {
      anchor:
        savedAnchor === null || savedAnchor.atBottom
          ? null
          : {
              entryId: savedAnchor.rowId,
              offsetWithinEntryPx: savedAnchor.offsetWithinRow,
            },
      focusedEntryId: null,
      sampleSerial: 0,
      viewportHeightPx: enabled ? INITIAL_VIEWPORT_HEIGHT_PX : null,
    };
  });
  // Windowing that switches on later (viewport crossed the compact breakpoint,
  // scroll body appeared) must not evict what the user is looking at: fall
  // back to rendering everything until the first sample reads the real
  // viewport and picks the range from it.
  const [wasEnabled, setWasEnabled] = useState(enabled);
  if (wasEnabled !== enabled) {
    setWasEnabled(enabled);
    setState((current) => ({
      ...current,
      anchor: null,
      viewportHeightPx: null,
    }));
  }

  const entryIndexById = useMemo(() => {
    const indexById = new Map<string, number>();
    for (const [index, entry] of entries.entries()) {
      indexById.set(entry.id, index);
    }
    return indexById;
  }, [entries]);

  const active =
    enabled &&
    bottomAnchor !== null &&
    state.viewportHeightPx !== null &&
    entries.length > 0;

  let plan: WindowPlan | null = null;
  if (active && state.viewportHeightPx !== null) {
    const viewportHeightPx = state.viewportHeightPx;
    const layout = controller.getLayout(entries);
    const anchorLost =
      state.anchor !== null && !entryIndexById.has(state.anchor.entryId);
    const viewportTopPx = resolveTimelineViewportTop({
      anchor: state.anchor,
      entryIndexById,
      layout,
      viewportHeightPx,
    });
    const overscanPx = timelineWindowOverscanPx(viewportHeightPx);
    const committedRange = resolveTimelineWindowRangeIds({
      entryIndexById,
      ids: controller.committedRangeIds,
    });
    // Reuse the committed range while the viewport keeps its slack inside it,
    // so unrelated re-renders (streaming) do not churn the edges. Only a render
    // driven by a fresh sample may move the range from the state's anchor; a
    // rows-driven commit that finds the range no longer covering (or the
    // anchor gone) keeps what is mounted rather than jump, and asks for a
    // forced sample after commit, which re-anchors from the DOM and lands the
    // new range with its scrollTop correction.
    const isSampleRender =
      state.sampleSerial !== controller.committedSampleSerial;
    const committedRangeCovers =
      committedRange !== null &&
      !anchorLost &&
      timelineWindowRangeCoversViewport({
        layout,
        marginPx: overscanPx * TIMELINE_WINDOW_SLACK_FRACTION,
        range: committedRange,
        viewportHeightPx,
        viewportTopPx,
      });
    const range =
      committedRange !== null &&
      (committedRangeCovers || anchorLost || !isSampleRender)
        ? committedRange
        : computeTimelineWindowRange({
            layout,
            overscanPx,
            viewportHeightPx,
            viewportTopPx,
          });
    // A committed range whose edge rows left the list (turn summarised) cannot
    // be kept, so it is recomputed from the state's anchor; that guess is
    // checked against the DOM the same way.
    const needsResample =
      !committedRangeCovers &&
      (anchorLost ||
        (!isSampleRender && controller.committedRangeIds !== null));
    const focusedEntryId = state.focusedEntryId;
    const segments = buildTimelineWindowSegments({
      layout,
      range,
      isPinned: (index) => {
        if (index >= pinnedTailStartIndex) {
          return true;
        }
        const id = entries[index]?.id;
        return (
          id !== undefined && (pinnedEntryIds.has(id) || id === focusedEntryId)
        );
      },
    });
    plan = { needsResample, range, segments };
  }

  const sample = useCallback(
    (force = false) => {
      const scrollArea = bottomAnchor?.getScrollElement() ?? null;
      const list = controller.listElement;
      if (scrollArea === null || list === null) {
        return;
      }
      const viewportHeightPx = scrollArea.clientHeight;
      const currentEntries = controller.entries;
      if (viewportHeightPx <= 0 || currentEntries.length === 0) {
        return;
      }
      if (hasActiveSelectionInside(list)) {
        // Swapping rows under a live selection would drop its anchor node.
        return;
      }
      const layout = controller.getLayout(currentEntries);
      const scrollAreaRect = scrollArea.getBoundingClientRect();
      const scrollTop = scrollArea.scrollTop;
      const listTopPx =
        list.getBoundingClientRect().top - scrollAreaRect.top + scrollTop;
      const viewportTopPx = scrollTop - listTopPx;
      const overscanPx = timelineWindowOverscanPx(viewportHeightPx);
      const committedRange = resolveTimelineWindowRangeIds({
        entryIndexById: controller.entryIndexById,
        ids: controller.committedRangeIds,
      });
      if (
        !force &&
        committedRange !== null &&
        timelineWindowRangeCoversViewport({
          layout,
          marginPx: overscanPx * TIMELINE_WINDOW_SLACK_FRACTION,
          range: committedRange,
          viewportHeightPx,
          viewportTopPx,
        })
      ) {
        return;
      }
      const nearBottom =
        scrollArea.scrollHeight - viewportHeightPx - scrollTop <=
        BOTTOM_THRESHOLD_PX;
      const anchorIndex = findTimelineWindowEntryAtOffset(
        layout,
        viewportTopPx,
      );
      const anchorEntry = currentEntries[anchorIndex];
      const anchor: TimelineViewportAnchor | null =
        nearBottom || anchorEntry === undefined
          ? null
          : {
              entryId: anchorEntry.id,
              offsetWithinEntryPx: Math.max(
                0,
                viewportTopPx - (layout.starts[anchorIndex] ?? 0),
              ),
            };
      // Reference for the post-commit scrollTop correction: the first mounted
      // entry that is (at least partly) in the viewport. It stays mounted across
      // the swap because the new range covers the viewport.
      controller.sampleSerial += 1;
      const sampleSerial = controller.sampleSerial;
      let pendingCompensation: PendingScrollCompensation | null = null;
      const viewportBottomPx = viewportTopPx + viewportHeightPx;
      for (
        let index = Math.max(0, anchorIndex);
        index < layout.count && (layout.starts[index] ?? 0) < viewportBottomPx;
        index += 1
      ) {
        const entry = currentEntries[index];
        const element =
          entry === undefined
            ? undefined
            : controller.elementsById.get(entry.id);
        if (entry !== undefined && element !== undefined) {
          pendingCompensation = {
            entryId: entry.id,
            contentOffsetPx: contentOffsetOf(element, scrollArea),
            sampleSerial,
          };
          break;
        }
      }
      controller.pendingCompensation = pendingCompensation;
      const focusedEntryId = focusedEntryIdInside(list);
      setState({
        anchor,
        focusedEntryId,
        sampleSerial,
        viewportHeightPx,
      });
    },
    [bottomAnchor, controller],
  );

  // Commit bookkeeping: remember what is mounted for the next sample, then
  // correct scrollTop for whatever the swap shifted and snap the auto-height
  // wrapper so the swap does not ease.
  useLayoutEffect(() => {
    controller.entries = entries;
    controller.entryIndexById = entryIndexById;
    if (plan === null) {
      controller.committedRangeIds = null;
      controller.committedSampleSerial = -1;
      controller.committedSignature = null;
      controller.pendingCompensation = null;
      return;
    }
    controller.committedRangeIds = timelineWindowRangeToIds(
      entries,
      plan.range,
    );
    controller.committedSampleSerial = state.sampleSerial;
    const signature = segmentsSignature(plan.segments, entries);
    // A correction belongs to the commit that renders the sample's window; a
    // rows-driven commit that lands in between leaves it pending, and a
    // superseded one is dropped.
    let pending = controller.pendingCompensation;
    if (pending !== null && pending.sampleSerial > state.sampleSerial) {
      pending = null;
    } else {
      controller.pendingCompensation = null;
    }
    if (plan.needsResample) {
      sample(true);
    }
    if (signature === controller.committedSignature) {
      return;
    }
    controller.committedSignature = signature;
    const scrollArea = bottomAnchor?.getScrollElement() ?? null;
    if (
      pending !== null &&
      pending.sampleSerial === state.sampleSerial &&
      scrollArea !== null
    ) {
      const element = controller.elementsById.get(pending.entryId);
      if (element !== undefined) {
        const delta =
          contentOffsetOf(element, scrollArea) - pending.contentOffsetPx;
        if (Math.abs(delta) >= MIN_SCROLL_COMPENSATION_PX) {
          scrollArea.scrollTop += delta;
        }
      }
    }
    snapAutoHeight?.();
  });

  useEffect(() => {
    if (!enabled || bottomAnchor === null) {
      return;
    }
    const scrollArea = bottomAnchor.getScrollElement();
    if (scrollArea === null) {
      return;
    }
    let frame: number | null = null;
    const schedule = () => {
      if (frame !== null) {
        return;
      }
      frame = window.requestAnimationFrame(() => {
        frame = null;
        sample();
      });
    };
    scrollArea.addEventListener("scroll", schedule, { passive: true });
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(schedule);
    resizeObserver?.observe(scrollArea);
    schedule();
    return () => {
      scrollArea.removeEventListener("scroll", schedule);
      resizeObserver?.disconnect();
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [bottomAnchor, enabled, sample]);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    controller.ensureObserving();
    return () => controller.disconnect();
  }, [controller, enabled]);

  const listRef = useCallback<RefCallback<HTMLDivElement>>(
    (node) => {
      controller.listElement = node;
      if (node !== null) {
        controller.gapPx = readListGapPx(node);
      }
    },
    [controller],
  );

  // Identity changes with `enabled` on purpose: React re-runs the ref for every
  // mounted wrapper, so entries that mounted while windowing was off get
  // observed once it switches on.
  const entryRef = useCallback<RefCallback<HTMLElement>>(
    (node) => {
      if (!enabled || node === null) {
        return;
      }
      const id = node.dataset.timelineWindowEntry;
      if (id === undefined) {
        return;
      }
      controller.attachEntry(id, node);
      return () => {
        controller.detachEntry(id, node);
      };
    },
    [controller, enabled],
  );

  return {
    entryRef,
    listRef,
    segments: plan?.segments ?? null,
  };
}
