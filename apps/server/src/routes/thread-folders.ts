import { createThreadFolder, normalizeThreadFolderPath } from "@bb/db";
import {
  publicApiRoutes,
  typedRoutes,
  type PublicApiSchema,
} from "@bb/server-contract";
import type { Hono } from "hono";
import type { AppDeps } from "../types.js";
import { ApiError } from "../errors.js";

export function registerThreadFolderRoutes(app: Hono, deps: AppDeps): void {
  const { post } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (msg) => new ApiError(400, "invalid_request", msg),
  });
  const routes = publicApiRoutes.threadFolders;

  post(routes.create, (context, payload) => {
    const path = normalizeThreadFolderPath(payload.path);
    if (!path) {
      throw new ApiError(400, "invalid_request", "Folder name cannot be empty");
    }
    return context.json(
      createThreadFolder(deps.db, deps.hub, {
        path,
      }),
      201,
    );
  });
}
