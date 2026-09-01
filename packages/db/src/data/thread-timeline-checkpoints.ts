import { eq, inArray } from "drizzle-orm";
import type { DbConnection } from "../connection.js";
import { threadTimelineCheckpoints } from "../schema.js";

export interface ThreadTimelineCheckpointRecord {
  checkpointKey: string;
  eventCount: number;
  eventId: string;
  payloadJson: string;
  sequence: number;
}

export function getThreadTimelineCheckpointRecord(
  db: DbConnection,
  threadId: string,
): ThreadTimelineCheckpointRecord | null {
  return (
    db
      .select({
        checkpointKey: threadTimelineCheckpoints.checkpointKey,
        eventCount: threadTimelineCheckpoints.eventCount,
        eventId: threadTimelineCheckpoints.eventId,
        payloadJson: threadTimelineCheckpoints.payloadJson,
        sequence: threadTimelineCheckpoints.sequence,
      })
      .from(threadTimelineCheckpoints)
      .where(eq(threadTimelineCheckpoints.threadId, threadId))
      .get() ?? null
  );
}

export type ThreadTimelineCheckpointIdentity = Omit<
  ThreadTimelineCheckpointRecord,
  "payloadJson"
>;

export function getThreadTimelineCheckpointIdentity(
  db: DbConnection,
  threadId: string,
): ThreadTimelineCheckpointIdentity | null {
  return (
    db
      .select({
        checkpointKey: threadTimelineCheckpoints.checkpointKey,
        eventCount: threadTimelineCheckpoints.eventCount,
        eventId: threadTimelineCheckpoints.eventId,
        sequence: threadTimelineCheckpoints.sequence,
      })
      .from(threadTimelineCheckpoints)
      .where(eq(threadTimelineCheckpoints.threadId, threadId))
      .get() ?? null
  );
}

export function upsertThreadTimelineCheckpointRecord(
  db: DbConnection,
  args: ThreadTimelineCheckpointRecord & { threadId: string },
): void {
  db.insert(threadTimelineCheckpoints)
    .values(args)
    .onConflictDoUpdate({
      target: threadTimelineCheckpoints.threadId,
      set: {
        checkpointKey: args.checkpointKey,
        eventCount: args.eventCount,
        eventId: args.eventId,
        payloadJson: args.payloadJson,
        sequence: args.sequence,
      },
    })
    .run();
}

export function deleteThreadTimelineCheckpointRecords(
  db: DbConnection,
  threadIds: readonly string[],
): void {
  if (threadIds.length === 0) {
    return;
  }
  db.delete(threadTimelineCheckpoints)
    .where(inArray(threadTimelineCheckpoints.threadId, [...threadIds]))
    .run();
}
