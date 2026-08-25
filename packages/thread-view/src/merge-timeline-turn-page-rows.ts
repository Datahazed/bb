import type { TimelineRow, TimelineTurnRow } from "@bb/server-contract";

interface MergeTimelineTurnPageRowsOptions {
  /**
   * Fresh rows are authoritative from this sequence onward. Inline children
   * at or beyond the boundary are replaced, not appended.
   */
  newerWindowStartSequence?: number;
}

function mergeInlineChildren(
  older: TimelineTurnRow,
  newer: TimelineTurnRow,
  newerWindowStartSequence: number | undefined,
): TimelineRow[] | null {
  if (older.children === null || newer.children === null) {
    return null;
  }

  const rows =
    newerWindowStartSequence === undefined
      ? [...older.children]
      : older.children.filter(
          (row) => row.sourceSeqEnd < newerWindowStartSequence,
        );
  return coalesceTimelineDetailRows([rows, newer.children]);
}

/**
 * Merge two byte-window fragments of the same logical completed turn.
 * Transport pagination stays bounded while every renderer receives one row.
 */
export function mergeTimelineTurnPageRows(
  older: TimelineTurnRow,
  newer: TimelineTurnRow,
  options: MergeTimelineTurnPageRowsOptions = {},
): TimelineTurnRow {
  if (older.id !== newer.id || older.turnId !== newer.turnId) {
    throw new Error("Cannot merge timeline rows from different turns");
  }
  const completedAtCandidates = [older.completedAt, newer.completedAt].filter(
    (value): value is number => value !== null,
  );
  const retainsOlderWindow =
    options.newerWindowStartSequence !== undefined &&
    older.sourceSeqStart < options.newerWindowStartSequence;

  return {
    ...newer,
    children: mergeInlineChildren(
      older,
      newer,
      options.newerWindowStartSequence,
    ),
    completedAt:
      completedAtCandidates.length === 0
        ? null
        : Math.max(...completedAtCandidates),
    createdAt: Math.max(older.createdAt, newer.createdAt),
    sourceSeqEnd: Math.max(older.sourceSeqEnd, newer.sourceSeqEnd),
    sourceSeqStart: Math.min(older.sourceSeqStart, newer.sourceSeqStart),
    startedAt: Math.min(older.startedAt, newer.startedAt),
    // Completed turns are immutable. A latest-window refresh replaces the
    // newest fragment but keeps the count already accumulated from older
    // pages; an older-page prepend adds a disjoint fragment.
    summaryCount:
      options.newerWindowStartSequence === undefined
        ? older.summaryCount + newer.summaryCount
        : retainsOlderWindow
          ? older.summaryCount
          : newer.summaryCount,
  };
}

/** Coalesce byte-window turn fragments after timeline pages are concatenated. */
export function coalesceTimelineTurnPageRows(
  rows: readonly TimelineRow[],
): TimelineRow[] {
  const coalescedRows: TimelineRow[] = [];
  const turnIndexById = new Map<string, number>();
  for (const row of rows) {
    if (row.kind !== "turn") {
      coalescedRows.push(row);
      continue;
    }
    const existingIndex = turnIndexById.get(row.id);
    if (existingIndex === undefined) {
      turnIndexById.set(row.id, coalescedRows.length);
      coalescedRows.push(row);
      continue;
    }
    const existing = coalescedRows[existingIndex];
    if (existing?.kind !== "turn") {
      throw new Error(`Timeline row id ${row.id} changed kind across pages`);
    }
    coalescedRows[existingIndex] = mergeTimelineTurnPageRows(existing, row);
  }
  return coalescedRows;
}

function mergeTimelineDetailRows(
  older: TimelineRow,
  newer: TimelineRow,
): TimelineRow {
  if (older.kind === "turn" && newer.kind === "turn") {
    return mergeTimelineTurnPageRows(older, newer);
  }
  if (
    older.kind === "work" &&
    older.workKind === "delegation" &&
    newer.kind === "work" &&
    newer.workKind === "delegation"
  ) {
    const completedAtCandidates = [older.completedAt, newer.completedAt].filter(
      (value): value is number => value !== null,
    );
    return {
      ...newer,
      childRows: coalesceTimelineDetailRows([older.childRows, newer.childRows]),
      completedAt:
        completedAtCandidates.length === 0
          ? null
          : Math.max(...completedAtCandidates),
      sourceSeqEnd: Math.max(older.sourceSeqEnd, newer.sourceSeqEnd),
      sourceSeqStart: Math.min(older.sourceSeqStart, newer.sourceSeqStart),
      startedAt: Math.min(older.startedAt, newer.startedAt),
    };
  }
  if (older.kind !== newer.kind) {
    throw new Error(`Timeline row id ${newer.id} changed kind across pages`);
  }
  return newer;
}

function coalesceTimelineDetailRows(
  pages: readonly (readonly TimelineRow[])[],
): TimelineRow[] {
  const rows: TimelineRow[] = [];
  const rowIndexById = new Map<string, number>();
  for (const page of pages) {
    for (const row of page) {
      const existingIndex = rowIndexById.get(row.id);
      if (existingIndex === undefined) {
        rowIndexById.set(row.id, rows.length);
        rows.push(row);
        continue;
      }
      const existing = rows[existingIndex];
      if (!existing) {
        throw new Error(`Missing timeline row ${row.id} while merging pages`);
      }
      rows[existingIndex] = mergeTimelineDetailRows(existing, row);
    }
  }
  return rows;
}

/** Join forward detail pages, with the later page authoritative for closure rows. */
export function coalesceTimelineTurnDetailPageRows(
  pages: readonly (readonly TimelineRow[])[],
): TimelineRow[] {
  return coalesceTimelineDetailRows(pages).sort(
    (left, right) =>
      left.sourceSeqStart - right.sourceSeqStart ||
      left.sourceSeqEnd - right.sourceSeqEnd ||
      left.id.localeCompare(right.id),
  );
}
