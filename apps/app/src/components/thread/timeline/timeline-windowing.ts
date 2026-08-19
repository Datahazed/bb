/**
 * Pure geometry for windowing the top-level timeline list.
 *
 * The list is modelled as a column of entries (rows and the unread divider)
 * separated by a fixed flex gap. Each entry has a height: the last measured
 * height of its wrapper when it has been mounted, or a per-kind estimate when
 * it never has. Entries outside the mounted range are replaced by spacers
 * whose height is the sum of the entry heights they stand in for (plus the
 * gaps between them), so the scroll range and the offsets of mounted entries
 * match the un-windowed list as closely as the measurements allow.
 *
 * Everything here is deterministic and DOM-free so the range/segment math is
 * testable on its own; `useTimelineWindow` wires it to scroll and resize.
 */

export interface TimelineWindowEntry {
  id: string;
  /** Height used while the entry has never been measured. */
  estimatedHeightPx: number;
}

export interface TimelineWindowLayout {
  count: number;
  gapPx: number;
  /**
   * `starts[i]` is the offset of entry `i` from the top of the list;
   * `starts[count]` is one gap past the bottom of the last entry (so
   * `starts[i + 1] - starts[i] - gapPx` is entry `i`'s height).
   */
  starts: Float64Array;
  /** Height of the whole list (no trailing gap). */
  totalHeightPx: number;
}

/** Half-open index range `[start, end)` of mounted entries. */
export interface TimelineWindowRange {
  start: number;
  end: number;
}

/**
 * Where the viewport sits, expressed against an entry so the position survives
 * prepends (older pages), appends and in-place merges of the row list. `null`
 * means "pinned to the bottom".
 */
export interface TimelineViewportAnchor {
  entryId: string;
  /** Distance from the entry's top to the viewport's top (>= 0). */
  offsetWithinEntryPx: number;
}

export type TimelineWindowSegment =
  | { kind: "entry"; index: number }
  | {
      kind: "spacer";
      /** First entry the spacer stands in for. */
      startIndex: number;
      /** One past the last entry the spacer stands in for. */
      endIndex: number;
      heightPx: number;
    };

interface BuildTimelineWindowLayoutArgs {
  entries: readonly TimelineWindowEntry[];
  gapPx: number;
  measuredHeightsById: ReadonlyMap<string, number>;
}

interface ComputeTimelineWindowRangeArgs {
  layout: TimelineWindowLayout;
  overscanPx: number;
  viewportHeightPx: number;
  viewportTopPx: number;
}

interface TimelineWindowRangeCoversViewportArgs {
  layout: TimelineWindowLayout;
  marginPx: number;
  range: TimelineWindowRange;
  viewportHeightPx: number;
  viewportTopPx: number;
}

interface ResolveTimelineViewportTopArgs {
  anchor: TimelineViewportAnchor | null;
  entryIndexById: ReadonlyMap<string, number>;
  layout: TimelineWindowLayout;
  viewportHeightPx: number;
}

interface BuildTimelineWindowSegmentsArgs {
  isPinned: (index: number) => boolean;
  layout: TimelineWindowLayout;
  range: TimelineWindowRange;
}

interface ResolveTimelineWindowRangeIdsArgs {
  entryIndexById: ReadonlyMap<string, number>;
  ids: TimelineWindowRangeIds | null;
}

/** A committed range remembered by entry id so it survives index shifts. */
export interface TimelineWindowRangeIds {
  endId: string;
  startId: string;
}

/**
 * Rows this far beyond the viewport stay mounted on each side. Two viewports
 * keeps a fling from reaching a spacer before the next range lands while
 * bounding the DOM to roughly five viewports of rows; the floor covers short
 * (keyboard-shrunk) viewports.
 */
export const TIMELINE_WINDOW_OVERSCAN_VIEWPORTS = 2;
export const TIMELINE_WINDOW_MIN_OVERSCAN_PX = 1_600;
/**
 * A committed range is reused until the viewport comes within this fraction of
 * the overscan of one of its edges. Re-ranging then re-centres the window, so
 * eviction on the far side happens as a by-product of extending the near side.
 */
export const TIMELINE_WINDOW_SLACK_FRACTION = 0.5;

export function timelineWindowOverscanPx(viewportHeightPx: number): number {
  return Math.max(
    TIMELINE_WINDOW_MIN_OVERSCAN_PX,
    Math.ceil(viewportHeightPx * TIMELINE_WINDOW_OVERSCAN_VIEWPORTS),
  );
}

export function buildTimelineWindowLayout({
  entries,
  gapPx,
  measuredHeightsById,
}: BuildTimelineWindowLayoutArgs): TimelineWindowLayout {
  const starts = new Float64Array(entries.length + 1);
  let offset = 0;
  for (const [index, entry] of entries.entries()) {
    starts[index] = offset;
    const height = measuredHeightsById.get(entry.id) ?? entry.estimatedHeightPx;
    offset += Math.max(0, height) + gapPx;
  }
  starts[entries.length] = offset;
  return {
    count: entries.length,
    gapPx,
    starts,
    totalHeightPx: entries.length === 0 ? 0 : offset - gapPx,
  };
}

export function timelineWindowEntryHeightPx(
  layout: TimelineWindowLayout,
  index: number,
): number {
  const start = layout.starts[index];
  const next = layout.starts[index + 1];
  if (start === undefined || next === undefined) {
    return 0;
  }
  return Math.max(0, next - start - layout.gapPx);
}

/**
 * Index of the entry whose extent (including the gap that follows it) contains
 * `offsetPx`, clamped to the list. Binary search over the monotonic starts.
 */
export function findTimelineWindowEntryAtOffset(
  layout: TimelineWindowLayout,
  offsetPx: number,
): number {
  if (layout.count === 0) {
    return -1;
  }
  if (offsetPx <= 0) {
    return 0;
  }
  let low = 0;
  let high = layout.count - 1;
  while (low < high) {
    const middle = low + Math.ceil((high - low) / 2);
    const start = layout.starts[middle] ?? Number.POSITIVE_INFINITY;
    if (start <= offsetPx) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return low;
}

/**
 * Entries overlapping the viewport extended by `overscanPx` on both sides.
 * The result always covers the visible entries and is never empty for a
 * non-empty list.
 */
export function computeTimelineWindowRange({
  layout,
  overscanPx,
  viewportHeightPx,
  viewportTopPx,
}: ComputeTimelineWindowRangeArgs): TimelineWindowRange {
  if (layout.count === 0) {
    return { start: 0, end: 0 };
  }
  const start = findTimelineWindowEntryAtOffset(
    layout,
    viewportTopPx - overscanPx,
  );
  const bottomEdgePx = viewportTopPx + viewportHeightPx + overscanPx;
  let last = findTimelineWindowEntryAtOffset(layout, bottomEdgePx);
  // An entry that starts exactly on the edge lies outside the range.
  if (last > start && (layout.starts[last] ?? 0) >= bottomEdgePx) {
    last -= 1;
  }
  return { start, end: Math.max(start + 1, last + 1) };
}

/**
 * Whether `range` still extends at least `marginPx` beyond both viewport
 * edges (or reaches the corresponding end of the list). Used as hysteresis so
 * the mounted set only changes when the viewport nears an edge of it.
 */
export function timelineWindowRangeCoversViewport({
  layout,
  marginPx,
  range,
  viewportHeightPx,
  viewportTopPx,
}: TimelineWindowRangeCoversViewportArgs): boolean {
  if (range.start < 0 || range.end > layout.count || range.start >= range.end) {
    return layout.count === 0 && range.start === 0 && range.end === 0;
  }
  const rangeTop = layout.starts[range.start] ?? 0;
  const rangeBottom =
    (layout.starts[range.end] ?? layout.totalHeightPx) - layout.gapPx;
  const topCovered = range.start === 0 || rangeTop <= viewportTopPx - marginPx;
  const bottomCovered =
    range.end === layout.count ||
    rangeBottom >= viewportTopPx + viewportHeightPx + marginPx;
  return topCovered && bottomCovered;
}

/**
 * The viewport's top offset within the list for an anchor. A bottom anchor
 * (`null`) or an anchor whose entry is gone resolves to the bottom of the list.
 */
export function resolveTimelineViewportTop({
  anchor,
  entryIndexById,
  layout,
  viewportHeightPx,
}: ResolveTimelineViewportTopArgs): number {
  const bottomTop = Math.max(0, layout.totalHeightPx - viewportHeightPx);
  if (anchor === null) {
    return bottomTop;
  }
  const index = entryIndexById.get(anchor.entryId);
  if (index === undefined) {
    return bottomTop;
  }
  const start = layout.starts[index] ?? 0;
  return Math.max(0, start + Math.max(0, anchor.offsetWithinEntryPx));
}

export function resolveTimelineWindowRangeIds({
  entryIndexById,
  ids,
}: ResolveTimelineWindowRangeIdsArgs): TimelineWindowRange | null {
  if (ids === null) {
    return null;
  }
  const start = entryIndexById.get(ids.startId);
  const endInclusive = entryIndexById.get(ids.endId);
  if (
    start === undefined ||
    endInclusive === undefined ||
    endInclusive < start
  ) {
    return null;
  }
  return { start, end: endInclusive + 1 };
}

export function timelineWindowRangeToIds(
  entries: readonly TimelineWindowEntry[],
  range: TimelineWindowRange,
): TimelineWindowRangeIds | null {
  const first = entries[range.start];
  const last = entries[range.end - 1];
  if (first === undefined || last === undefined) {
    return null;
  }
  return { startId: first.id, endId: last.id };
}

/**
 * Renders the list as mounted entries and spacers. An entry is mounted when it
 * falls inside `range` or `isPinned` says so (streaming tail, unread divider,
 * search target, focused row); every maximal run of unmounted entries becomes
 * one spacer sized to the run's total extent.
 */
export function buildTimelineWindowSegments({
  isPinned,
  layout,
  range,
}: BuildTimelineWindowSegmentsArgs): TimelineWindowSegment[] {
  const segments: TimelineWindowSegment[] = [];
  let spacerStart = -1;
  const flushSpacer = (endIndex: number) => {
    if (spacerStart === -1) {
      return;
    }
    const top = layout.starts[spacerStart] ?? 0;
    const bottom = (layout.starts[endIndex] ?? top) - layout.gapPx;
    segments.push({
      kind: "spacer",
      startIndex: spacerStart,
      endIndex,
      heightPx: Math.max(0, bottom - top),
    });
    spacerStart = -1;
  };
  for (let index = 0; index < layout.count; index += 1) {
    const mounted =
      (index >= range.start && index < range.end) || isPinned(index);
    if (mounted) {
      flushSpacer(index);
      segments.push({ kind: "entry", index });
      continue;
    }
    if (spacerStart === -1) {
      spacerStart = index;
    }
  }
  flushSpacer(layout.count);
  return segments;
}
