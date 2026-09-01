import { eq, inArray } from "drizzle-orm";
import type { DbConnection } from "../connection.js";
import { threadTimelineProjections } from "../schema.js";

export interface ThreadTimelineProjectionRecord {
  payloadJson: string;
  projectionKey: string;
}

export function getThreadTimelineProjectionRecord(
  db: DbConnection,
  threadId: string,
): ThreadTimelineProjectionRecord | null {
  return (
    db
      .select({
        payloadJson: threadTimelineProjections.payloadJson,
        projectionKey: threadTimelineProjections.projectionKey,
      })
      .from(threadTimelineProjections)
      .where(eq(threadTimelineProjections.threadId, threadId))
      .get() ?? null
  );
}

export function upsertThreadTimelineProjectionRecord(
  db: DbConnection,
  args: ThreadTimelineProjectionRecord & { threadId: string },
): void {
  db.insert(threadTimelineProjections)
    .values(args)
    .onConflictDoUpdate({
      target: threadTimelineProjections.threadId,
      set: {
        payloadJson: args.payloadJson,
        projectionKey: args.projectionKey,
      },
    })
    .run();
}

/**
 * Sweeps that rewrite stored events in place cannot invalidate through the
 * tip-keyed projection key, so they drop the affected threads' rows.
 */
export function deleteThreadTimelineProjectionRecords(
  db: DbConnection,
  threadIds: readonly string[],
): void {
  if (threadIds.length === 0) {
    return;
  }
  db.delete(threadTimelineProjections)
    .where(inArray(threadTimelineProjections.threadId, [...threadIds]))
    .run();
}
