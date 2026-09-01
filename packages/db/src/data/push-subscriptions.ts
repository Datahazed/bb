import { asc, eq } from "drizzle-orm";
import type { PushSubscription, PushSubscriptionPlatform } from "@bb/domain";
import type { DbConnection, DbQueryConnection } from "../connection.js";
import { createPushSubscriptionId } from "../ids.js";
import { pushSubscriptions } from "../schema.js";

export type PushSubscriptionRow = PushSubscription;

export interface UpsertPushSubscriptionInput {
  expoPushToken: string;
  platform: PushSubscriptionPlatform;
  deviceLabel: string;
}

export type UpsertPushSubscriptionResult =
  | { outcome: "created"; subscription: PushSubscriptionRow }
  | { outcome: "updated"; subscription: PushSubscriptionRow };

export function listPushSubscriptions(
  db: DbQueryConnection,
): PushSubscriptionRow[] {
  return db
    .select()
    .from(pushSubscriptions)
    .orderBy(asc(pushSubscriptions.createdAt), asc(pushSubscriptions.id))
    .all();
}

export function getPushSubscription(
  db: DbQueryConnection,
  id: string,
): PushSubscriptionRow | null {
  return (
    db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.id, id))
      .get() ?? null
  );
}

export function getPushSubscriptionByToken(
  db: DbQueryConnection,
  expoPushToken: string,
): PushSubscriptionRow | null {
  return (
    db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.expoPushToken, expoPushToken))
      .get() ?? null
  );
}

export function upsertPushSubscription(
  db: DbConnection,
  input: UpsertPushSubscriptionInput,
): UpsertPushSubscriptionResult {
  const now = Date.now();
  return db.transaction((tx) => {
    const existing = tx
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.expoPushToken, input.expoPushToken))
      .get();
    if (existing) {
      const subscription = tx
        .update(pushSubscriptions)
        .set({
          deviceLabel: input.deviceLabel,
          platform: input.platform,
          lastSeenAt: Math.max(now, existing.lastSeenAt),
        })
        .where(eq(pushSubscriptions.id, existing.id))
        .returning()
        .get();
      return { outcome: "updated", subscription: subscription ?? existing };
    }
    const subscription = tx
      .insert(pushSubscriptions)
      .values({
        id: createPushSubscriptionId(),
        expoPushToken: input.expoPushToken,
        platform: input.platform,
        deviceLabel: input.deviceLabel,
        createdAt: now,
        lastSeenAt: now,
      })
      .returning()
      .get();
    return { outcome: "created", subscription };
  });
}

export function deletePushSubscription(db: DbConnection, id: string): boolean {
  return (
    db
      .delete(pushSubscriptions)
      .where(eq(pushSubscriptions.id, id))
      .returning({ id: pushSubscriptions.id })
      .get() !== undefined
  );
}

export function deletePushSubscriptionByToken(
  db: DbConnection,
  expoPushToken: string,
): boolean {
  return (
    db
      .delete(pushSubscriptions)
      .where(eq(pushSubscriptions.expoPushToken, expoPushToken))
      .returning({ id: pushSubscriptions.id })
      .get() !== undefined
  );
}
