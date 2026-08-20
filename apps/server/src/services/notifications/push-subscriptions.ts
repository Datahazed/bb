import {
  deletePushSubscription,
  listPushSubscriptions,
  upsertPushSubscription,
  type DbConnection,
} from "@bb/db";
import type {
  PushSubscription,
  RegisterPushSubscriptionRequest,
} from "@bb/server-contract";
import { ApiError } from "../../errors.js";
import type { ServerLogger } from "../../types.js";

export interface PushSubscriptionServiceDeps {
  db: DbConnection;
  logger: ServerLogger;
}

export type RegisterPushSubscriptionResult =
  | { outcome: "created"; subscription: PushSubscription }
  | { outcome: "updated"; subscription: PushSubscription };

/** Every device registered for push, oldest first. */
export function listRegisteredPushSubscriptions(
  deps: Pick<PushSubscriptionServiceDeps, "db">,
): PushSubscription[] {
  return listPushSubscriptions(deps.db);
}

/**
 * Register a device token or refresh an existing registration. The request
 * carries every field explicitly (the contract has no defaults), so the row
 * is exactly what the device told us.
 */
export function registerPushSubscription(
  deps: PushSubscriptionServiceDeps,
  request: RegisterPushSubscriptionRequest,
): RegisterPushSubscriptionResult {
  const result = upsertPushSubscription(deps.db, {
    expoPushToken: request.expoPushToken,
    platform: request.platform,
    deviceLabel: request.deviceLabel,
  });
  if (result.outcome === "created") {
    deps.logger.info(
      {
        pushSubscriptionId: result.subscription.id,
        platform: result.subscription.platform,
      },
      "Registered push subscription",
    );
  }
  return result;
}

/** Remove a registration by id; 404 when it does not exist. */
export function removePushSubscription(
  deps: PushSubscriptionServiceDeps,
  id: string,
): void {
  if (!deletePushSubscription(deps.db, id)) {
    throw new ApiError(
      404,
      "push_subscription_not_found",
      "Push subscription not found",
    );
  }
  deps.logger.info({ pushSubscriptionId: id }, "Removed push subscription");
}
