import { and, count, inArray, isNull } from "drizzle-orm";
import { threads, type DbQueryConnection } from "@bb/db";

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
