import { replaceStoredThreadTabs } from "@bb/db";
import {
  publicApiRoutes,
  typedRoutes,
  type PublicApiSchema,
} from "@bb/server-contract";
import type { Hono } from "hono";
import { ApiError } from "../../errors.js";
import { requirePublicThread } from "../../services/lib/entity-lookup.js";
import { readThreadTabs } from "../../services/threads/thread-detail-reads.js";
import type { AppDeps } from "../../types.js";

export function registerThreadTabRoutes(app: Hono, deps: AppDeps): void {
  const { get, put } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (message) =>
      new ApiError(400, "invalid_request", message),
  });
  const routes = publicApiRoutes.threads;

  get(routes.tabs, (context) => {
    const thread = requirePublicThread(deps.db, context.req.param("id"));
    return context.json(readThreadTabs(deps, thread.id));
  });

  put(routes.updateTabs, (context, payload) => {
    const thread = requirePublicThread(deps.db, context.req.param("id"));
    const result = replaceStoredThreadTabs(deps.db, {
      expectedRevision: payload.expectedRevision,
      tabsJson: JSON.stringify(payload.tabs),
      threadId: thread.id,
    });
    if (result.outcome === "conflict") {
      throw new ApiError(
        409,
        "thread_tabs_conflict",
        "Thread tabs changed on another client",
        { details: { currentRevision: result.revision } },
      );
    }
    deps.hub.notifyThread(thread.id, ["tabs-changed"]);
    return context.json({ revision: result.revision, tabs: payload.tabs });
  });
}
