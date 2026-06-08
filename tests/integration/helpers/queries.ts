import { and, count, desc, eq, isNotNull } from "drizzle-orm";
import { events, threads, type DbConnection } from "@bb/db";

export interface StoredTurnEventRow {
  sequence: number;
  turnId: string | null;
  type: string;
}

export function readStoredTurnEvents(
  db: DbConnection,
  threadId: string,
): StoredTurnEventRow[] {
  return db
    .select({
      sequence: events.sequence,
      turnId: events.turnId,
      type: events.type,
    })
    .from(events)
    .where(eq(events.threadId, threadId))
    .orderBy(events.sequence)
    .all();
}

export function readLatestProviderThreadId(
  db: DbConnection,
  threadId: string,
): string | null {
  return (
    db
      .select({ providerThreadId: events.providerThreadId })
      .from(events)
      .where(
        and(eq(events.threadId, threadId), isNotNull(events.providerThreadId)),
      )
      .orderBy(desc(events.sequence))
      .limit(1)
      .get()?.providerThreadId ?? null
  );
}

export function countStoredThreads(db: DbConnection): number {
  return db.select({ count: count() }).from(threads).get()?.count ?? 0;
}
