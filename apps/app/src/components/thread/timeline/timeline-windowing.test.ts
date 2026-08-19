import { describe, expect, it } from "vitest";
import {
  buildTimelineWindowLayout,
  buildTimelineWindowSegments,
  computeTimelineWindowRange,
  findTimelineWindowEntryAtOffset,
  resolveTimelineViewportTop,
  resolveTimelineWindowRangeIds,
  timelineWindowEntryHeightPx,
  timelineWindowOverscanPx,
  timelineWindowRangeCoversViewport,
  timelineWindowRangeToIds,
  TIMELINE_WINDOW_MIN_OVERSCAN_PX,
  type TimelineWindowEntry,
} from "./timeline-windowing";

function entries(
  count: number,
  estimatedHeightPx = 100,
): TimelineWindowEntry[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `row_${index}`,
    estimatedHeightPx,
  }));
}

function indexById(list: readonly TimelineWindowEntry[]): Map<string, number> {
  return new Map(list.map((entry, index) => [entry.id, index]));
}

describe("buildTimelineWindowLayout", () => {
  it("prefers measured heights over estimates and accounts for the flex gap", () => {
    const list = entries(3, 100);
    const layout = buildTimelineWindowLayout({
      entries: list,
      gapPx: 8,
      measuredHeightsById: new Map([["row_1", 250]]),
    });
    expect(Array.from(layout.starts)).toEqual([0, 108, 366, 474]);
    expect(layout.totalHeightPx).toBe(466);
    expect(timelineWindowEntryHeightPx(layout, 0)).toBe(100);
    expect(timelineWindowEntryHeightPx(layout, 1)).toBe(250);
    expect(timelineWindowEntryHeightPx(layout, 2)).toBe(100);
  });

  it("handles an empty list", () => {
    const layout = buildTimelineWindowLayout({
      entries: [],
      gapPx: 8,
      measuredHeightsById: new Map(),
    });
    expect(layout.totalHeightPx).toBe(0);
    expect(findTimelineWindowEntryAtOffset(layout, 10)).toBe(-1);
    expect(
      computeTimelineWindowRange({
        layout,
        overscanPx: 100,
        viewportHeightPx: 100,
        viewportTopPx: 0,
      }),
    ).toEqual({ start: 0, end: 0 });
    expect(
      buildTimelineWindowSegments({
        layout,
        range: { start: 0, end: 0 },
        isPinned: () => false,
      }),
    ).toEqual([]);
  });
});

describe("findTimelineWindowEntryAtOffset", () => {
  const layout = buildTimelineWindowLayout({
    entries: entries(5, 100),
    gapPx: 8,
    measuredHeightsById: new Map(),
  });

  it("maps offsets to the entry whose extent (plus trailing gap) contains them", () => {
    expect(findTimelineWindowEntryAtOffset(layout, -50)).toBe(0);
    expect(findTimelineWindowEntryAtOffset(layout, 0)).toBe(0);
    expect(findTimelineWindowEntryAtOffset(layout, 99)).toBe(0);
    // Inside the gap after row 0 still resolves to row 0.
    expect(findTimelineWindowEntryAtOffset(layout, 104)).toBe(0);
    expect(findTimelineWindowEntryAtOffset(layout, 108)).toBe(1);
    expect(findTimelineWindowEntryAtOffset(layout, 432)).toBe(4);
    // Past the end clamps to the last entry.
    expect(findTimelineWindowEntryAtOffset(layout, 10_000)).toBe(4);
  });
});

describe("computeTimelineWindowRange", () => {
  it("covers the viewport plus overscan on both sides and clamps to the list", () => {
    const layout = buildTimelineWindowLayout({
      entries: entries(100, 100),
      gapPx: 0,
      measuredHeightsById: new Map(),
    });
    // Viewport rows 40..47 (800px) with 300px overscan → rows 37..50.
    expect(
      computeTimelineWindowRange({
        layout,
        overscanPx: 300,
        viewportHeightPx: 800,
        viewportTopPx: 4_000,
      }),
    ).toEqual({ start: 37, end: 51 });
    expect(
      computeTimelineWindowRange({
        layout,
        overscanPx: 300,
        viewportHeightPx: 800,
        viewportTopPx: 0,
      }),
    ).toEqual({ start: 0, end: 11 });
    expect(
      computeTimelineWindowRange({
        layout,
        overscanPx: 300,
        viewportHeightPx: 800,
        viewportTopPx: 9_200,
      }),
    ).toEqual({ start: 89, end: 100 });
  });

  it("scales overscan with the viewport but never below the floor", () => {
    expect(timelineWindowOverscanPx(300)).toBe(TIMELINE_WINDOW_MIN_OVERSCAN_PX);
    expect(timelineWindowOverscanPx(1_000)).toBe(2_000);
  });
});

describe("timelineWindowRangeCoversViewport", () => {
  const layout = buildTimelineWindowLayout({
    entries: entries(100, 100),
    gapPx: 0,
    measuredHeightsById: new Map(),
  });

  it("requires the margin on both sides unless the range reaches a list edge", () => {
    const range = { start: 30, end: 60 }; // 3000px..6000px
    const covers = (viewportTopPx: number) =>
      timelineWindowRangeCoversViewport({
        layout,
        marginPx: 500,
        range,
        viewportHeightPx: 800,
        viewportTopPx,
      });
    expect(covers(3_500)).toBe(true);
    expect(covers(4_700)).toBe(true);
    // Top slack shrinks below the margin.
    expect(covers(3_400)).toBe(false);
    // Bottom slack shrinks below the margin.
    expect(covers(4_800)).toBe(false);
    // A range touching the list start needs no top slack.
    expect(
      timelineWindowRangeCoversViewport({
        layout,
        marginPx: 500,
        range: { start: 0, end: 30 },
        viewportHeightPx: 800,
        viewportTopPx: 0,
      }),
    ).toBe(true);
    // A range touching the list end needs no bottom slack.
    expect(
      timelineWindowRangeCoversViewport({
        layout,
        marginPx: 500,
        range: { start: 70, end: 100 },
        viewportHeightPx: 800,
        viewportTopPx: 9_200,
      }),
    ).toBe(true);
  });

  it("rejects ranges that no longer fit the list", () => {
    expect(
      timelineWindowRangeCoversViewport({
        layout,
        marginPx: 0,
        range: { start: 90, end: 120 },
        viewportHeightPx: 800,
        viewportTopPx: 9_000,
      }),
    ).toBe(false);
  });
});

describe("resolveTimelineViewportTop", () => {
  const list = entries(50, 100);
  const layout = buildTimelineWindowLayout({
    entries: list,
    gapPx: 0,
    measuredHeightsById: new Map(),
  });

  it("resolves a bottom anchor to the end of the list", () => {
    expect(
      resolveTimelineViewportTop({
        anchor: null,
        entryIndexById: indexById(list),
        layout,
        viewportHeightPx: 800,
      }),
    ).toBe(4_200);
  });

  it("follows an entry anchor across a prepend", () => {
    const anchor = { entryId: "row_10", offsetWithinEntryPx: 40 };
    expect(
      resolveTimelineViewportTop({
        anchor,
        entryIndexById: indexById(list),
        layout,
        viewportHeightPx: 800,
      }),
    ).toBe(1_040);
    const prepended = [
      ...Array.from({ length: 20 }, (_, index) => ({
        id: `older_${index}`,
        estimatedHeightPx: 100,
      })),
      ...list,
    ];
    const prependedLayout = buildTimelineWindowLayout({
      entries: prepended,
      gapPx: 0,
      measuredHeightsById: new Map(),
    });
    expect(
      resolveTimelineViewportTop({
        anchor,
        entryIndexById: indexById(prepended),
        layout: prependedLayout,
        viewportHeightPx: 800,
      }),
    ).toBe(3_040);
  });

  it("falls back to the bottom when the anchored entry is gone", () => {
    expect(
      resolveTimelineViewportTop({
        anchor: { entryId: "missing", offsetWithinEntryPx: 0 },
        entryIndexById: indexById(list),
        layout,
        viewportHeightPx: 800,
      }),
    ).toBe(4_200);
  });
});

describe("range ids", () => {
  it("round-trips through ids and survives an index shift", () => {
    const list = entries(10);
    const ids = timelineWindowRangeToIds(list, { start: 2, end: 5 });
    expect(ids).toEqual({ startId: "row_2", endId: "row_4" });
    const shifted = [{ id: "older", estimatedHeightPx: 1 }, ...list];
    expect(
      resolveTimelineWindowRangeIds({
        entryIndexById: indexById(shifted),
        ids,
      }),
    ).toEqual({ start: 3, end: 6 });
    expect(
      resolveTimelineWindowRangeIds({
        entryIndexById: indexById(list.slice(0, 3)),
        ids,
      }),
    ).toBeNull();
    expect(
      resolveTimelineWindowRangeIds({
        entryIndexById: indexById(list),
        ids: null,
      }),
    ).toBeNull();
    expect(timelineWindowRangeToIds(list, { start: 0, end: 0 })).toBeNull();
  });
});

describe("buildTimelineWindowSegments", () => {
  it("collapses every run of unmounted entries into a spacer sized to its extent", () => {
    const list = entries(10, 100);
    const layout = buildTimelineWindowLayout({
      entries: list,
      gapPx: 8,
      measuredHeightsById: new Map([
        ["row_0", 50],
        ["row_1", 70],
      ]),
    });
    const segments = buildTimelineWindowSegments({
      layout,
      range: { start: 3, end: 6 },
      isPinned: (index) => index === 9,
    });
    expect(segments).toEqual([
      // rows 0..2: 50 + 8 + 70 + 8 + 100 = 236 (no trailing gap)
      { kind: "spacer", startIndex: 0, endIndex: 3, heightPx: 236 },
      { kind: "entry", index: 3 },
      { kind: "entry", index: 4 },
      { kind: "entry", index: 5 },
      // rows 6..8: 3 * 100 + 2 * 8
      { kind: "spacer", startIndex: 6, endIndex: 9, heightPx: 316 },
      { kind: "entry", index: 9 },
    ]);
    // Spacers plus mounted entries plus the gaps between segments add up to
    // the un-windowed list height, so the scroll range is unchanged.
    const mountedHeight = segments.reduce((sum, segment) => {
      return (
        sum +
        (segment.kind === "spacer"
          ? segment.heightPx
          : timelineWindowEntryHeightPx(layout, segment.index))
      );
    }, 0);
    expect(mountedHeight + (segments.length - 1) * layout.gapPx).toBe(
      layout.totalHeightPx,
    );
  });

  it("mounts everything when the range spans the list", () => {
    const layout = buildTimelineWindowLayout({
      entries: entries(4),
      gapPx: 8,
      measuredHeightsById: new Map(),
    });
    expect(
      buildTimelineWindowSegments({
        layout,
        range: { start: 0, end: 4 },
        isPinned: () => false,
      }),
    ).toEqual([
      { kind: "entry", index: 0 },
      { kind: "entry", index: 1 },
      { kind: "entry", index: 2 },
      { kind: "entry", index: 3 },
    ]);
  });
});
