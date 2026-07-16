import type { ThreadTimelineResponse, TimelineRow } from "@bb/server-contract";

/**
 * Caps the largest inline strings in a timeline window. A handful of tool/
 * command outputs and diffs are enormous (observed up to ~1 MB) and dominate
 * both payload bytes and client parse/render cost. The window only needs a
 * readable preview; the full content stays available on demand via the
 * (un-truncated) `timeline/turn-summary-details` route once the turn completes.
 *
 * Conservative by design: the threshold is far above a normal output, so only
 * true outliers are touched. Conversation/message text is never truncated.
 * Rows are rebuilt only when something actually changes, so unchanged rows keep
 * their identity (cheap, and stable for delta diffing).
 */
export const DEFAULT_MAX_INLINE_OUTPUT_CHARS = 32_000;

function truncateString(value: string, max: number, hint: string): string {
  if (value.length <= max) {
    return value;
  }
  const dropped = value.length - max;
  return `${value.slice(0, max)}\n…[${dropped.toLocaleString()} more characters truncated${hint}]`;
}

const TIMELINE_TRUNCATION_HINT = " — open the turn to view the full output";
const TURN_WORK_PAGE_TRUNCATION_HINT = "";

function truncateRow(row: TimelineRow, max: number, hint: string): TimelineRow {
  if (row.kind === "turn") {
    if (!row.children) {
      return row;
    }
    const children = truncateRows(row.children, max, hint);
    return children === row.children ? row : { ...row, children };
  }

  if (row.kind !== "work") {
    return row;
  }

  switch (row.workKind) {
    case "command":
    case "tool": {
      const output = truncateString(row.output, max, hint);
      return output === row.output ? row : { ...row, output };
    }
    case "file-change": {
      const diff =
        row.change.diff === null
          ? null
          : truncateString(row.change.diff, max, hint);
      const stdout =
        row.stdout === null ? null : truncateString(row.stdout, max, hint);
      const stderr =
        row.stderr === null ? null : truncateString(row.stderr, max, hint);
      if (
        diff === row.change.diff &&
        stdout === row.stdout &&
        stderr === row.stderr
      ) {
        return row;
      }
      return {
        ...row,
        change: diff === row.change.diff ? row.change : { ...row.change, diff },
        stdout,
        stderr,
      };
    }
    case "delegation": {
      const output = truncateString(row.output, max, hint);
      const childRows = truncateRows(row.childRows, max, hint);
      if (output === row.output && childRows === row.childRows) {
        return row;
      }
      return { ...row, output, childRows };
    }
    default:
      return row;
  }
}

function truncateRows(
  rows: TimelineRow[],
  max: number,
  hint: string,
): TimelineRow[] {
  let changed = false;
  const next = rows.map((row) => {
    const truncated = truncateRow(row, max, hint);
    if (truncated !== row) {
      changed = true;
    }
    return truncated;
  });
  return changed ? next : rows;
}

export function truncateTimelineResponseOutputs(
  response: ThreadTimelineResponse,
  max: number = DEFAULT_MAX_INLINE_OUTPUT_CHARS,
): ThreadTimelineResponse {
  const rows = truncateRows(response.rows, max, TIMELINE_TRUNCATION_HINT);
  return rows === response.rows ? response : { ...response, rows };
}

/**
 * Same cap for paged turn-work rows. Full (un-paged) turn detail stays
 * un-truncated — it is the "view the full output" escape hatch — but paged
 * responses exist precisely because the turn is enormous, and a single page
 * containing a few ~1 MB command outputs would defeat the point of paging.
 */
export function truncateTimelineRowsOutputs(
  rows: TimelineRow[],
  max: number = DEFAULT_MAX_INLINE_OUTPUT_CHARS,
): TimelineRow[] {
  return truncateRows(rows, max, TURN_WORK_PAGE_TRUNCATION_HINT);
}
