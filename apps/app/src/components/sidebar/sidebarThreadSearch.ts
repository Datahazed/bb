import { useCallback, useMemo, useState, type RefObject } from "react";
import type { ThreadSearchMatch } from "@bb/server-contract";

export const SIDEBAR_THREAD_SEARCH_LISTBOX_ID =
  "bb-sidebar-thread-search-results";

interface SidebarThreadSearchNavigationItemBase {
  id: string;
  optionId: string;
}

export interface SidebarThreadSearchThreadNavigationItem extends SidebarThreadSearchNavigationItemBase {
  kind: "thread";
  projectId: string;
  threadId: string;
  /**
   * Event sequence of the matched message, so selecting the result can scroll
   * to that message in the thread. Null when the match is a title or the row is
   * a recent (no-query) entry with no message match.
   */
  messageSeq: number | null;
}

export interface SidebarThreadSearchDraftNavigationItem extends SidebarThreadSearchNavigationItemBase {
  kind: "draft";
  draftSlotId: string;
}

export type SidebarThreadSearchNavigationItem =
  | SidebarThreadSearchThreadNavigationItem
  | SidebarThreadSearchDraftNavigationItem;

export const SIDEBAR_THREAD_SEARCH_LIFECYCLE_STATES = [
  "active",
  "drafts",
  "archived",
] as const;

export type SidebarThreadSearchLifecycleState =
  (typeof SIDEBAR_THREAD_SEARCH_LIFECYCLE_STATES)[number];

export type SidebarThreadSearchLifecycleCounts = Record<
  SidebarThreadSearchLifecycleState,
  number
>;

export interface SidebarThreadSearchLifecycleFilterController {
  counts: SidebarThreadSearchLifecycleCounts;
  isFiltered: boolean;
  onCountsChange: (counts: SidebarThreadSearchLifecycleCounts) => void;
  onStateCheckedChange: (
    state: SidebarThreadSearchLifecycleState,
    checked: boolean,
  ) => void;
  reset: () => void;
  selectedStates: readonly SidebarThreadSearchLifecycleState[];
}

const EMPTY_LIFECYCLE_COUNTS: SidebarThreadSearchLifecycleCounts = {
  active: 0,
  drafts: 0,
  archived: 0,
};

function haveSameLifecycleCounts(
  left: SidebarThreadSearchLifecycleCounts,
  right: SidebarThreadSearchLifecycleCounts,
): boolean {
  return SIDEBAR_THREAD_SEARCH_LIFECYCLE_STATES.every(
    (state) => left[state] === right[state],
  );
}

/**
 * Transient lifecycle state for built-in sidebar search. The owner mounts one
 * controller while search is available; the result panel resets it on
 * dismissal so a fresh search always starts with every group visible.
 */
export function useSidebarThreadSearchLifecycleFilter(): SidebarThreadSearchLifecycleFilterController {
  const [selectedStates, setSelectedStates] = useState<
    readonly SidebarThreadSearchLifecycleState[]
  >(SIDEBAR_THREAD_SEARCH_LIFECYCLE_STATES);
  const [counts, setCounts] = useState<SidebarThreadSearchLifecycleCounts>(
    EMPTY_LIFECYCLE_COUNTS,
  );
  const selectedStateSet = useMemo(
    () => new Set(selectedStates),
    [selectedStates],
  );
  const onCountsChange = useCallback(
    (nextCounts: SidebarThreadSearchLifecycleCounts) => {
      setCounts((current) =>
        haveSameLifecycleCounts(current, nextCounts) ? current : nextCounts,
      );
    },
    [],
  );
  const onStateCheckedChange = useCallback(
    (state: SidebarThreadSearchLifecycleState, checked: boolean) => {
      setSelectedStates((current) => {
        const isSelected = current.includes(state);
        if (checked === isSelected) return current;
        if (!checked && current.length === 1) return current;
        return SIDEBAR_THREAD_SEARCH_LIFECYCLE_STATES.filter((candidate) =>
          candidate === state ? checked : current.includes(candidate),
        );
      });
    },
    [],
  );
  const reset = useCallback(() => {
    setSelectedStates(SIDEBAR_THREAD_SEARCH_LIFECYCLE_STATES);
    setCounts(EMPTY_LIFECYCLE_COUNTS);
  }, []);

  return {
    counts,
    isFiltered:
      selectedStateSet.size < SIDEBAR_THREAD_SEARCH_LIFECYCLE_STATES.length,
    onCountsChange,
    onStateCheckedChange,
    reset,
    selectedStates,
  };
}

export interface SidebarThreadSearchMatchWindow {
  highlightRanges: ThreadSearchMatch["highlightRanges"];
  text: string;
  wasWindowed: boolean;
}

export interface SidebarDraftSearchMatch {
  highlightRanges: ThreadSearchMatch["highlightRanges"];
  text: string;
}

const SIDEBAR_SEARCH_TOKEN_PATTERN = /[\p{L}\p{N}_]+/gu;
const SIDEBAR_SEARCH_HIGHLIGHT_RANGE_LIMIT = 8;

function normalizeSidebarSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Mark}/gu, "")
    .toLocaleLowerCase();
}

function listSidebarSearchTokens(value: string): string[] {
  return [...value.matchAll(SIDEBAR_SEARCH_TOKEN_PATTERN)]
    .map((match) => normalizeSidebarSearchText(match[0]))
    .filter((token) => token.length > 0);
}

function getNormalizedPrefixOriginalEnd(
  value: string,
  normalizedPrefixLength: number,
): number {
  let normalizedLength = 0;
  for (let index = 0; index < value.length; ) {
    const codePoint = value.codePointAt(index);
    if (codePoint === undefined) break;
    const originalValue = String.fromCodePoint(codePoint);
    const end = index + originalValue.length;
    normalizedLength += normalizeSidebarSearchText(originalValue).length;
    if (normalizedLength >= normalizedPrefixLength) return end;
    index = end;
  }
  return value.length;
}

function getSidebarSearchCandidateMatch(
  value: string,
  queryTokens: readonly string[],
): SidebarDraftSearchMatch | null {
  const rangesByToken = new Map<string, ThreadSearchMatch["highlightRanges"]>();
  for (const token of queryTokens) rangesByToken.set(token, []);

  for (const match of value.matchAll(SIDEBAR_SEARCH_TOKEN_PATTERN)) {
    const originalToken = match[0];
    const normalizedToken = normalizeSidebarSearchText(originalToken);
    for (const queryToken of queryTokens) {
      if (!normalizedToken.startsWith(queryToken)) continue;
      const start = match.index;
      rangesByToken.get(queryToken)?.push({
        start,
        end:
          start +
          getNormalizedPrefixOriginalEnd(originalToken, queryToken.length),
      });
    }
  }

  if ([...rangesByToken.values()].some((ranges) => ranges.length === 0)) {
    return null;
  }

  const ranges = [...rangesByToken.values()]
    .flat()
    .sort((left, right) => left.start - right.start || left.end - right.end);
  const mergedRanges: ThreadSearchMatch["highlightRanges"] = [];
  for (const range of ranges) {
    const previous = mergedRanges.at(-1);
    if (previous === undefined || range.start > previous.end) {
      mergedRanges.push({ ...range });
      continue;
    }
    previous.end = Math.max(previous.end, range.end);
  }

  return {
    highlightRanges: mergedRanges.slice(
      0,
      SIDEBAR_SEARCH_HIGHLIGHT_RANGE_LIMIT,
    ),
    text: value,
  };
}

/** Client-side draft matching mirrors server thread-search token semantics. */
export function getSidebarDraftSearchMatch({
  query,
  text,
  title,
}: {
  query: string;
  text: string;
  title: string;
}): SidebarDraftSearchMatch | null {
  const queryTokens = [...new Set(listSidebarSearchTokens(query))];
  if (queryTokens.length === 0) return null;
  return (
    getSidebarSearchCandidateMatch(text, queryTokens) ??
    getSidebarSearchCandidateMatch(title, queryTokens)
  );
}

function isHighSurrogate(value: number): boolean {
  return value >= 0xd800 && value <= 0xdbff;
}

function isLowSurrogate(value: number): boolean {
  return value >= 0xdc00 && value <= 0xdfff;
}

function clampTextOffset(value: number, textLength: number): number {
  return Math.max(0, Math.min(value, textLength));
}

function moveOffsetOffSurrogateSplit(
  text: string,
  value: number,
  direction: "backward" | "forward",
): number {
  const offset = clampTextOffset(value, text.length);
  if (
    offset > 0 &&
    offset < text.length &&
    isHighSurrogate(text.charCodeAt(offset - 1)) &&
    isLowSurrogate(text.charCodeAt(offset))
  ) {
    return direction === "backward" ? offset - 1 : offset + 1;
  }
  return offset;
}

function moveByCodePoints(text: string, from: number, count: number): number {
  let offset = moveOffsetOffSurrogateSplit(
    text,
    from,
    count < 0 ? "backward" : "forward",
  );
  const step = count < 0 ? -1 : 1;
  for (let moved = 0; moved < Math.abs(count); moved += 1) {
    if (step < 0) {
      if (offset === 0) break;
      offset -= 1;
      if (
        offset > 0 &&
        isLowSurrogate(text.charCodeAt(offset)) &&
        isHighSurrogate(text.charCodeAt(offset - 1))
      ) {
        offset -= 1;
      }
    } else {
      if (offset === text.length) break;
      if (
        isHighSurrogate(text.charCodeAt(offset)) &&
        offset + 1 < text.length &&
        isLowSurrogate(text.charCodeAt(offset + 1))
      ) {
        offset += 2;
      } else {
        offset += 1;
      }
    }
  }
  return offset;
}

function isWordCharacter(value: string): boolean {
  return /[\p{L}\p{N}_]/u.test(value);
}

function readCodePointBefore(text: string, offset: number): string {
  if (offset <= 0) return "";
  const previous = moveByCodePoints(text, offset, -1);
  return text.slice(previous, offset);
}

function readCodePointAt(text: string, offset: number): string {
  if (offset >= text.length) return "";
  const next = moveByCodePoints(text, offset, 1);
  return text.slice(offset, next);
}

function isWordStart(text: string, offset: number): boolean {
  const current = readCodePointAt(text, offset);
  return (
    current.length > 0 &&
    isWordCharacter(current) &&
    !isWordCharacter(readCodePointBefore(text, offset))
  );
}

function isWordEnd(text: string, offset: number): boolean {
  const previous = readCodePointBefore(text, offset);
  return (
    previous.length > 0 &&
    isWordCharacter(previous) &&
    !isWordCharacter(readCodePointAt(text, offset))
  );
}

function findWindowStart(
  text: string,
  candidate: number,
  matchStart: number,
): number {
  for (
    let offset = candidate;
    offset < matchStart;
    offset = moveByCodePoints(text, offset, 1)
  ) {
    if (isWordStart(text, offset)) return offset;
  }
  return matchStart;
}

function findWindowEnd(
  text: string,
  matchEnd: number,
  candidate: number,
): number {
  for (
    let offset = candidate;
    offset > matchEnd;
    offset = moveByCodePoints(text, offset, -1)
  ) {
    if (isWordEnd(text, offset)) return offset;
  }
  return matchEnd;
}

function normalizeHighlightRange(
  text: string,
  range: ThreadSearchMatch["highlightRanges"][number],
): ThreadSearchMatch["highlightRanges"][number] | null {
  const start = moveOffsetOffSurrogateSplit(text, range.start, "backward");
  const end = moveOffsetOffSurrogateSplit(text, range.end, "forward");
  return end > start ? { start, end } : null;
}

/**
 * Clips around the first match only after layout proves the ordinary two-line
 * clamp would hide it. Offsets remain UTF-16 indices (matching server ranges),
 * while the 16/40 context limits count Unicode code points and every boundary
 * is moved away from the middle of a surrogate pair.
 */
export function getSidebarThreadSearchMatchWindow({
  highlightRanges,
  matchIsHidden,
  text,
}: {
  highlightRanges: ThreadSearchMatch["highlightRanges"];
  matchIsHidden: boolean;
  text: string;
}): SidebarThreadSearchMatchWindow {
  const normalizedRanges = highlightRanges
    .map((range) => normalizeHighlightRange(text, range))
    .filter((range): range is NonNullable<typeof range> => range !== null)
    .sort((left, right) => left.start - right.start || left.end - right.end);
  const firstMatch = normalizedRanges[0];
  if (!matchIsHidden || firstMatch === undefined) {
    return {
      highlightRanges: normalizedRanges,
      text,
      wasWindowed: false,
    };
  }

  const candidateStart = moveByCodePoints(text, firstMatch.start, -16);
  const candidateEnd = moveByCodePoints(text, firstMatch.end, 40);
  const sliceStart =
    candidateStart === 0
      ? 0
      : findWindowStart(text, candidateStart, firstMatch.start);
  const sliceEnd =
    candidateEnd === text.length
      ? text.length
      : findWindowEnd(text, firstMatch.end, candidateEnd);
  const hasLeadingEllipsis = sliceStart > 0;
  const hasTrailingEllipsis = sliceEnd < text.length;
  const rangeOffset = sliceStart - (hasLeadingEllipsis ? 1 : 0);

  return {
    highlightRanges: normalizedRanges.flatMap((range) => {
      const start = Math.max(range.start, sliceStart);
      const end = Math.min(range.end, sliceEnd);
      return end > start
        ? [{ start: start - rangeOffset, end: end - rangeOffset }]
        : [];
    }),
    text: `${hasLeadingEllipsis ? "…" : ""}${text.slice(sliceStart, sliceEnd)}${hasTrailingEllipsis ? "…" : ""}`,
    wasWindowed: true,
  };
}

export interface SidebarThreadSearchInputController {
  activeDescendantId: string | undefined;
  inputRef: RefObject<HTMLInputElement | null>;
  isActive: boolean;
  onActivate: () => void;
  onClose: () => void;
  onQueryChange: (query: string) => void;
  query: string;
}

export interface SidebarThreadSearchPanelController {
  activeIndex: number;
  isActive: boolean;
  onActiveIndexChange: (index: number) => void;
  onNavigationItemsChange: (
    items: readonly SidebarThreadSearchNavigationItem[],
  ) => void;
  onSelectItem: (item: SidebarThreadSearchNavigationItem) => void;
  query: string;
}

/**
 * The sidebar-wide key handler only owns keys typed in the search field or on a
 * result row. Every other sidebar control keeps its own key behavior.
 */
export function isThreadSearchKeyboardEventTarget(
  target: EventTarget | null,
  input: HTMLInputElement | null,
): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target === input) {
    return true;
  }
  return target.closest('[role="option"]') !== null;
}

export function getSidebarThreadSearchOptionId(rowId: string): string {
  return `${SIDEBAR_THREAD_SEARCH_LISTBOX_ID}-option-${rowId}`;
}

export function isSidebarThreadTitleMatch(match: ThreadSearchMatch): boolean {
  return match.sourceKind === "title" || match.sourceKind === "title_fallback";
}

export function haveSameSidebarThreadSearchNavigationItems(
  left: readonly SidebarThreadSearchNavigationItem[],
  right: readonly SidebarThreadSearchNavigationItem[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every(
    (item, index) =>
      item.id === right[index]?.id &&
      item.optionId === right[index]?.optionId &&
      item.kind === right[index]?.kind &&
      (item.kind === "thread"
        ? right[index]?.kind === "thread" &&
          item.projectId === right[index].projectId &&
          item.threadId === right[index].threadId &&
          item.messageSeq === right[index].messageSeq
        : right[index]?.kind === "draft" &&
          item.draftSlotId === right[index].draftSlotId),
  );
}
