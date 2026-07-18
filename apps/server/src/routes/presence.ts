import {
  presenceSnapshotResponseSchema,
  publicApiRoutes,
  typedRoutes,
  type PublicApiSchema,
} from "@bb/server-contract";
import type { Hono } from "hono";
import { ApiError } from "../errors.js";
import type { AppDeps } from "../types.js";

export function registerPresenceRoutes(app: Hono, deps: AppDeps): void {
  const { get } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (message) =>
      new ApiError(400, "invalid_request", message),
  });

  get(publicApiRoutes.presence.snapshot, (context) => {
    const snapshot = presenceSnapshotResponseSchema.parse(
      deps.hub.getPresenceSnapshot(),
    );
    return context.json(snapshot);
  });
}
