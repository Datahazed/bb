import { eq, sql } from "drizzle-orm";
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
 * Sweeps that mutate stored events in place cannot invalidate through the
 * tip-keyed projection key, so they drop every persisted projection.
 */
export function deleteAllThreadTimelineProjectionRecords(
  db: DbConnection,
): number {
  const result = db.run(sql`DELETE FROM thread_timeline_projections`);
  return result.changes;
}
