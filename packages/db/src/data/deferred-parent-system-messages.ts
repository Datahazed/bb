import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type {
  PromptInput,
  SystemMessageKind,
  SystemMessageSubject,
} from "@bb/domain";
import type { DbConnection, DbQueryConnection } from "../connection.js";
import { createDeferredParentSystemMessageId } from "../ids.js";
import { deferredParentSystemMessages } from "../schema.js";

export interface CreateDeferredParentSystemMessageInput {
  parentThreadId: string;
  input: PromptInput[];
  systemMessageKind: SystemMessageKind;
  systemMessageSubject: SystemMessageSubject | null;
}

export type DeferredParentSystemMessageRow =
  typeof deferredParentSystemMessages.$inferSelect;

export function createDeferredParentSystemMessage(
  db: DbConnection,
  input: CreateDeferredParentSystemMessageInput,
): DeferredParentSystemMessageRow {
  const row: DeferredParentSystemMessageRow = {
    id: createDeferredParentSystemMessageId(),
    parentThreadId: input.parentThreadId,
    input: JSON.stringify(input.input),
    systemMessageKind: input.systemMessageKind,
    systemMessageSubject:
      input.systemMessageSubject === null
        ? null
        : JSON.stringify(input.systemMessageSubject),
    createdAt: Date.now(),
  };
  db.insert(deferredParentSystemMessages).values(row).run();
  return row;
}

export function listDeferredParentSystemMessages(
  db: DbQueryConnection,
  parentThreadId: string,
): DeferredParentSystemMessageRow[] {
  return db
    .select()
    .from(deferredParentSystemMessages)
    .where(eq(deferredParentSystemMessages.parentThreadId, parentThreadId))
    .orderBy(
      asc(deferredParentSystemMessages.createdAt),
      asc(deferredParentSystemMessages.id),
    )
    .all();
}

export function countDeferredParentSystemMessages(
  db: DbQueryConnection,
  parentThreadId: string,
): number {
  const row = db
    .select({ count: sql<number>`count(*)` })
    .from(deferredParentSystemMessages)
    .where(eq(deferredParentSystemMessages.parentThreadId, parentThreadId))
    .get();
  return row?.count ?? 0;
}

export function listThreadIdsWithDeferredParentSystemMessages(
  db: DbQueryConnection,
): string[] {
  return db
    .selectDistinct({
      parentThreadId: deferredParentSystemMessages.parentThreadId,
    })
    .from(deferredParentSystemMessages)
    .all()
    .map((row) => row.parentThreadId);
}

/** Deletes the given rows for one parent; returns how many rows went away. */
export function deleteDeferredParentSystemMessages(
  db: DbConnection,
  args: { ids: string[]; parentThreadId: string },
): number {
  if (args.ids.length === 0) {
    return 0;
  }
  return db
    .delete(deferredParentSystemMessages)
    .where(
      and(
        eq(deferredParentSystemMessages.parentThreadId, args.parentThreadId),
        inArray(deferredParentSystemMessages.id, args.ids),
      ),
    )
    .run().changes;
}
