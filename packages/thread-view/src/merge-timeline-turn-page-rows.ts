import type {
  TimelineRow,
  TimelineTurnDetailSegment,
  TimelineTurnRow,
} from "@bb/server-contract";

interface MergeTimelineTurnPageRowsOptions {
  /**
   * Fresh rows are authoritative from this sequence onward. Detail segments
   * and inline children at or beyond the boundary are replaced, not appended.
   */
  newerWindowStartSequence?: number;
}

function detailSegments(row: TimelineTurnRow): TimelineTurnDetailSegment[] {
  return (
    row.detailSegments ?? [
      {
        sourceSeqStart: row.sourceSeqStart,
        sourceSeqEnd: row.sourceSeqEnd,
        summaryCount: row.summaryCount,
      },
    ]
  );
}

function mergeDetailSegments(
  older: TimelineTurnRow,
  newer: TimelineTurnRow,
  newerWindowStartSequence: number | undefined,
): TimelineTurnDetailSegment[] {
  const retainedOlderSegments = detailSegments(older).filter(
    (segment) =>
      newerWindowStartSequence === undefined ||
      segment.sourceSeqEnd < newerWindowStartSequence,
  );
  const segmentsByRange = new Map<string, TimelineTurnDetailSegment>();
  for (const segment of [...retainedOlderSegments, ...detailSegments(newer)]) {
    segmentsByRange.set(
      `${segment.sourceSeqStart}:${segment.sourceSeqEnd}`,
      segment,
    );
  }
  return [...segmentsByRange.values()].sort(
    (left, right) =>
      left.sourceSeqStart - right.sourceSeqStart ||
      left.sourceSeqEnd - right.sourceSeqEnd,
  );
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
  const rowIndexById = new Map(rows.map((row, index) => [row.id, index]));
  for (const row of newer.children) {
    const existingIndex = rowIndexById.get(row.id);
    if (existingIndex === undefined) {
      rowIndexById.set(row.id, rows.length);
      rows.push(row);
    } else {
      rows[existingIndex] = row;
    }
  }
  return rows;
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
  if (
    older.detailSegments === undefined &&
    newer.detailSegments === undefined
  ) {
    return newer;
  }

  const segments = mergeDetailSegments(
    older,
    newer,
    options.newerWindowStartSequence,
  );
  const firstSegment = segments[0];
  const lastSegment = segments.at(-1);
  if (!firstSegment || !lastSegment) {
    throw new Error("Cannot merge a turn without a detail segment");
  }
  const completedAtCandidates = [older.completedAt, newer.completedAt].filter(
    (value): value is number => value !== null,
  );

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
    detailSegments: segments,
    sourceSeqEnd: lastSegment.sourceSeqEnd,
    sourceSeqStart: firstSegment.sourceSeqStart,
    startedAt: Math.min(older.startedAt, newer.startedAt),
    summaryCount: segments.reduce(
      (count, segment) => count + segment.summaryCount,
      0,
    ),
  };
}

/** Coalesce byte-window turn fragments after timeline pages are concatenated. */
export function coalesceTimelineTurnPageRows(
  rows: readonly TimelineRow[],
): TimelineRow[] {
  const coalescedRows: TimelineRow[] = [];
  const turnIndexById = new Map<string, number>();
  for (const row of rows) {
    if (row.kind !== "turn" || row.detailSegments === undefined) {
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
