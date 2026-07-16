import type {
  TimelinePaginationCursor,
  TimelineRow,
} from "@bb/server-contract";

export interface PaginatedTimelineTurnDetails {
  hasOlderRows: boolean;
  olderCursor: TimelinePaginationCursor | null;
  rows: TimelineRow[];
}

export interface PaginateTimelineTurnDetailsOptions {
  /** Continuation owned by the exact bounded raw-event window. */
  eventWindowOlderCursor: TimelinePaginationCursor | null;
}

/**
 * Raw event selection is the sole resource and continuation boundary. A
 * projected-row cursor is unsafe because lifecycle/anchor enrichment can give
 * a visible row a source start outside the exact raw window and skip the raw
 * events in between. Projection may amplify a bounded raw window, but it can
 * no longer create an independent pagination boundary.
 */
export function paginateTimelineTurnDetails(
  rows: readonly TimelineRow[],
  options: PaginateTimelineTurnDetailsOptions,
): PaginatedTimelineTurnDetails {
  return {
    hasOlderRows: options.eventWindowOlderCursor !== null,
    olderCursor: options.eventWindowOlderCursor,
    rows: [...rows],
  };
}
