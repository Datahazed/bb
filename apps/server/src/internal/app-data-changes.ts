import {
  hostDaemonAppDataChangeRequestSchema,
  hostDaemonAppDataResyncRequestSchema,
  typedRoutes,
  type HostDaemonInternalSchema,
} from "@bb/host-daemon-contract";
import type { Hono } from "hono";
import type { AppDeps } from "../types.js";
import { ApiError } from "../errors.js";
import {
  requireEnvironment,
  requirePublicThread,
} from "../services/lib/entity-lookup.js";
import { runWithDaemonCommandWaitForbidden } from "../services/hosts/command-wait-context.js";
import {
  requireAuthenticatedDaemonSession,
  type RequireAuthenticatedDaemonSessionArgs,
} from "./session-state.js";

interface RequireSessionOwnedThreadArgs {
  context: RequireAuthenticatedDaemonSessionArgs["context"];
  deps: AppDeps;
  sessionId: string;
  threadId: string;
}

function requireSessionOwnedThread(args: RequireSessionOwnedThreadArgs): void {
  const session = requireAuthenticatedDaemonSession({
    context: args.context,
    db: args.deps.db,
    sessionId: args.sessionId,
  });
  const thread = requirePublicThread(args.deps.db, args.threadId);
  if (!thread.environmentId) {
    throw new ApiError(
      403,
      "invalid_request",
      "Thread does not belong to an environment",
    );
  }
  const environment = requireEnvironment(args.deps.db, thread.environmentId);
  if (environment.hostId !== session.hostId) {
    throw new ApiError(
      403,
      "invalid_request",
      "Thread does not belong to the session host",
    );
  }
}

export function registerInternalAppDataChangeRoutes(
  app: Hono,
  deps: AppDeps,
): void {
  const { post } = typedRoutes<HostDaemonInternalSchema>(app, {
    onValidationError: (msg) => new ApiError(400, "invalid_request", msg),
  });

  post(
    "/session/app-data-change",
    hostDaemonAppDataChangeRequestSchema,
    (context, payload) =>
      runWithDaemonCommandWaitForbidden({
        reason: "/session/app-data-change",
        work: async () => {
          requireSessionOwnedThread({
            context,
            deps,
            sessionId: payload.sessionId,
            threadId: payload.threadId,
          });

          deps.hub.notifyThreadAppData({
            type: "app-data.changed",
            threadId: payload.threadId,
            appId: payload.appId,
            path: payload.path,
            value: payload.value,
            deleted: payload.deleted,
            version: payload.version,
          });
          return context.json({ ok: true });
        },
      }),
  );

  post(
    "/session/app-data-resync",
    hostDaemonAppDataResyncRequestSchema,
    (context, payload) =>
      runWithDaemonCommandWaitForbidden({
        reason: "/session/app-data-resync",
        work: async () => {
          requireSessionOwnedThread({
            context,
            deps,
            sessionId: payload.sessionId,
            threadId: payload.threadId,
          });

          deps.hub.notifyThreadAppData({
            type: "app-data.resync",
            threadId: payload.threadId,
            appId: payload.appId,
          });
          return context.json({ ok: true });
        },
      }),
  );
}
