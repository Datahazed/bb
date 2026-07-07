import { and, count, inArray, isNull } from "drizzle-orm";
import {
  listIdleThreadsWithQueuedMessages,
  threads,
  type DbConnection,
  type DbQueryConnection,
} from "@bb/db";

/** Thread statuses that count as "an agent is running". */
export const BUSY_THREAD_STATUSES = ["starting", "active", "stopping"] as const;

/**
 * Number of live threads an update-triggered restart would interrupt. Shared
 * by the server's own update-when-idle watcher and the desktop shell's
 * deferred-relaunch poller (via /system/agents/activity).
 */
export function countBusyThreads(db: DbQueryConnection): number {
  const row = db
    .select({ value: count() })
    .from(threads)
    .where(
      and(
        inArray(threads.status, [...BUSY_THREAD_STATUSES]),
        isNull(threads.deletedAt),
      ),
    )
    .get();
  return row?.value ?? 0;
}

/**
 * True when a restart right now cannot interrupt or orphan agent work: no
 * busy threads, and no idle thread holding queued messages that the 10s
 * auto-send sweep is about to start. This is the gate for skipping the
 * update quiet period entirely ("Update now").
 */
export function isServerAtRest(db: DbConnection): boolean {
  return (
    countBusyThreads(db) === 0 &&
    listIdleThreadsWithQueuedMessages(db).length === 0
  );
}
