import {
  deletePushSubscription,
  listPushSubscriptions,
  upsertPushSubscription,
  type DbConnection,
} from "@bb/db";
import type {
  PushSubscription,
  PushSubscriptionSummary,
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

export function listRegisteredPushSubscriptions(
  deps: Pick<PushSubscriptionServiceDeps, "db">,
): PushSubscriptionSummary[] {
  return listPushSubscriptions(deps.db).map(
    ({ expoPushToken, ...subscription }) => ({
      ...subscription,
      tokenSuffix: expoPushToken.slice(-6),
    }),
  );
}

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
