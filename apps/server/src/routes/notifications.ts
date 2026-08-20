import {
  publicApiRoutes,
  typedRoutes,
  type PublicApiSchema,
} from "@bb/server-contract";
import type { Hono } from "hono";
import { ApiError } from "../errors.js";
import {
  listRegisteredPushSubscriptions,
  registerPushSubscription,
  removePushSubscription,
} from "../services/notifications/push-subscriptions.js";
import type { AppDeps } from "../types.js";

export function registerNotificationRoutes(app: Hono, deps: AppDeps): void {
  const { del, get, post } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (msg) => new ApiError(400, "invalid_request", msg),
  });
  const routes = publicApiRoutes.notifications;

  get(routes.listPushSubscriptions, (context) =>
    context.json({ subscriptions: listRegisteredPushSubscriptions(deps) }),
  );

  post(routes.registerPushSubscription, (context, payload) => {
    const result = registerPushSubscription(deps, payload);
    return context.json(
      result.subscription,
      result.outcome === "created" ? 201 : 200,
    );
  });

  del(routes.deletePushSubscription, (context) => {
    removePushSubscription(deps, context.req.param("id"));
    return context.json({ ok: true as const });
  });
}
