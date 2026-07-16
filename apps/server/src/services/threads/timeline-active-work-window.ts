import type { ThreadStatus } from "@bb/domain";
import type { TimelineRow, TimelineTurnRow } from "@bb/server-contract";

export const ACTIVE_TIMELINE_TAIL_ROW_TARGET = 80;
export const ACTIVE_TIMELINE_TAIL_JSON_BYTE_TARGET = 256_000;
export const ACTIVE_TIMELINE_PINNED_PENDING_ROW_LIMIT = 16;
export const ACTIVE_TIMELINE_PINNED_PENDING_JSON_BYTE_TARGET = 128_000;

function isMessageAnchor(row: TimelineRow): boolean {
  return (
    row.kind === "conversation" &&
    row.role === "user" &&
    row.turnRequest.kind === "message"
  );
}

function rowIsPending(row: TimelineRow): boolean {
  return row.kind !== "conversation" && row.status === "pending";
}

function isRunningThread(status: ThreadStatus): boolean {
  return status === "starting" || status === "active" || status === "stopping";
}

function activeSummaryRow(
  anchor: TimelineRow,
  turnId: string,
  omittedRows: readonly TimelineRow[],
  sourceSeqStartOverride?: number,
): TimelineTurnRow | null {
  const first = omittedRows[0];
  const last = omittedRows.at(-1);
  if (!first || !last) {
    return null;
  }
  const sourceSeqStart = sourceSeqStartOverride ?? first.sourceSeqStart;
  return {
    id: `${anchor.threadId}:${turnId}:active-turn:${sourceSeqStart}`,
    threadId: anchor.threadId,
    turnId,
    detailContextItemIds: [],
    detailParentToolCallId: null,
    sourceSeqStart,
    sourceSeqEnd: omittedRows.reduce(
      (maximum, row) => Math.max(maximum, row.sourceSeqEnd),
      last.sourceSeqEnd,
    ),
    startedAt: first.startedAt,
    createdAt: last.createdAt,
    kind: "turn",
    status: "pending",
    summaryCount: omittedRows.length,
    completedAt: null,
    children: null,
  };
}

/**
 * Keeps the active turn's prompt and mutable frontier visible while replacing
 * an arbitrarily large finalized prefix with the same lazy turn row used by
 * completed "Worked for …" summaries. This runs after full projection, so it
 * changes delivery shape without changing event-replay semantics.
 */
export function collapseActiveTimelineWork(args: {
  olderEventSequence?: number;
  rows: readonly TimelineRow[];
  threadStatus: ThreadStatus;
}): TimelineRow[] {
  const { olderEventSequence, rows, threadStatus } = args;
  if (!isRunningThread(threadStatus)) {
    return [...rows];
  }

  let anchorIndex = -1;
  for (let index = rows.length - 1; index >= 0; index--) {
    const row = rows[index];
    if (row && isMessageAnchor(row)) {
      anchorIndex = index;
      break;
    }
  }
  const anchor = rows[anchorIndex];
  if (!anchor) {
    return [...rows];
  }

  const segment = rows.slice(anchorIndex + 1);
  if (segment.some((row) => row.kind === "turn")) {
    return [...rows];
  }
  const activeTurnId = segment.find((row) => row.turnId !== null)?.turnId;
  if (!activeTurnId) {
    return [...rows];
  }
  const coversOlderEventWindow =
    olderEventSequence !== undefined &&
    olderEventSequence > anchor.sourceSeqEnd;

  let tailStart = segment.length;
  let tailBytes = 0;
  while (tailStart > 0) {
    const candidate = segment[tailStart - 1];
    if (!candidate) break;
    const selectedCount = segment.length - tailStart;
    const candidateBytes = Buffer.byteLength(JSON.stringify(candidate), "utf8");
    if (
      selectedCount >= ACTIVE_TIMELINE_TAIL_ROW_TARGET ||
      (selectedCount > 0 &&
        tailBytes + candidateBytes > ACTIVE_TIMELINE_TAIL_JSON_BYTE_TARGET)
    ) {
      break;
    }
    tailBytes += candidateBytes;
    tailStart--;
  }

  // Keep a bounded set of older mutable rows visible without pulling every
  // finalized row after the oldest one back into the live window. Contiguous
  // omitted runs become independent lazy summaries, which preserves source
  // order and gives every gap an exact expansion range.
  const pinnedPendingIndexes = new Set<number>();
  let pinnedPendingBytes = 0;
  for (let index = tailStart - 1; index >= 0; index--) {
    const row = segment[index];
    if (!row || !rowIsPending(row)) {
      continue;
    }
    if (pinnedPendingIndexes.size >= ACTIVE_TIMELINE_PINNED_PENDING_ROW_LIMIT) {
      break;
    }
    const rowBytes = Buffer.byteLength(JSON.stringify(row), "utf8");
    if (
      pinnedPendingBytes + rowBytes >
      ACTIVE_TIMELINE_PINNED_PENDING_JSON_BYTE_TARGET
    ) {
      continue;
    }
    pinnedPendingIndexes.add(index);
    pinnedPendingBytes += rowBytes;
  }

  if (tailStart === 0 && !coversOlderEventWindow) {
    return [...rows];
  }

  const collapsedRows: TimelineRow[] = [...rows.slice(0, anchorIndex + 1)];
  const historicalEnd =
    olderEventSequence === undefined ? null : olderEventSequence - 1;
  const historicalPinnedIndexes = new Set(
    [...pinnedPendingIndexes].filter((index) => {
      const row = segment[index];
      return (
        historicalEnd !== null &&
        row !== undefined &&
        row.sourceSeqStart <= historicalEnd
      );
    }),
  );
  const combineLeadingGapWithFirstOmittedRun =
    coversOlderEventWindow &&
    tailStart > 0 &&
    !pinnedPendingIndexes.has(0) &&
    historicalPinnedIndexes.size === 0;
  if (
    coversOlderEventWindow &&
    !combineLeadingGapWithFirstOmittedRun &&
    historicalEnd !== null &&
    historicalEnd >= anchor.sourceSeqEnd + 1
  ) {
    const template = segment[0];
    if (template) {
      let gapStart = anchor.sourceSeqEnd + 1;
      for (const index of [...historicalPinnedIndexes].sort(
        (left, right) =>
          (segment[left]?.sourceSeqStart ?? 0) -
          (segment[right]?.sourceSeqStart ?? 0),
      )) {
        const pinned = segment[index];
        if (!pinned) {
          continue;
        }
        if (gapStart < pinned.sourceSeqStart) {
          const gap = activeSummaryRow(anchor, activeTurnId, [
            {
              ...template,
              sourceSeqStart: gapStart,
              sourceSeqEnd: Math.min(historicalEnd, pinned.sourceSeqStart - 1),
            },
          ]);
          if (gap) {
            collapsedRows.push(gap);
          }
        }
        collapsedRows.push(pinned);
        gapStart = Math.max(gapStart, pinned.sourceSeqEnd + 1);
      }
      if (gapStart <= historicalEnd) {
        const gap = activeSummaryRow(anchor, activeTurnId, [
          {
            ...template,
            sourceSeqStart: gapStart,
            sourceSeqEnd: historicalEnd,
          },
        ]);
        if (gap) {
          collapsedRows.push(gap);
        }
      }
    }
  }
  let omittedRun: TimelineRow[] = [];
  let isFirstOmittedRun = true;
  const flushOmittedRun = (): void => {
    const summary = activeSummaryRow(
      anchor,
      activeTurnId,
      omittedRun,
      isFirstOmittedRun && combineLeadingGapWithFirstOmittedRun
        ? anchor.sourceSeqEnd + 1
        : undefined,
    );
    if (summary) {
      collapsedRows.push(summary);
      isFirstOmittedRun = false;
    }
    omittedRun = [];
  };

  for (let index = 0; index < segment.length; index++) {
    const row = segment[index];
    if (!row) {
      continue;
    }
    if (
      historicalPinnedIndexes.has(index) ||
      (historicalEnd !== null && row.sourceSeqEnd <= historicalEnd)
    ) {
      continue;
    }
    if (index >= tailStart || pinnedPendingIndexes.has(index)) {
      flushOmittedRun();
      collapsedRows.push(row);
      continue;
    }
    omittedRun.push(row);
  }
  flushOmittedRun();
  return collapsedRows;
}
