import {
  createHostJoinRequestSchema,
  updateHostRequestSchema,
  typedRoutes,
  type PublicApiSchema,
} from "@bb/server-contract";
import type { Hono } from "hono";
import { ApiError } from "../errors.js";
import { getLocalHost, requireLocalHost } from "../services/hosts/local-host.js";

/**
 * Single-host surface (plan §4.1): the read routes answer with the synthetic
 * `'local'` host; the four host-mutation routes stay in `PublicApiSchema`
 * (the frozen FE compiles against them) but are stubbed at runtime — joining
 * another host is gone with the daemon transport (410), and the one local
 * host can be neither renamed (its name is the machine hostname) nor removed
 * (422).
 */
export function registerHostRoutes(app: Hono): void {
  const { get, post, patch, del } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (message) =>
      new ApiError(400, "invalid_request", message),
  });

  get("/hosts", (context) => context.json([getLocalHost()]));

  post("/hosts/join", createHostJoinRequestSchema, () => {
    throw new ApiError(
      410,
      "unsupported_operation",
      "Multi-host support has been removed; this server manages only the local host",
    );
  });

  del("/hosts/:id/join", () => {
    throw new ApiError(
      410,
      "unsupported_operation",
      "Multi-host support has been removed; this server manages only the local host",
    );
  });

  get("/hosts/:id", (context) =>
    context.json(requireLocalHost(context.req.param("id"))),
  );

  patch("/hosts/:id", updateHostRequestSchema, (context) => {
    requireLocalHost(context.req.param("id"));
    throw new ApiError(
      422,
      "unsupported_operation",
      "The local host cannot be renamed; its name is the machine hostname",
    );
  });

  del("/hosts/:id", (context) => {
    requireLocalHost(context.req.param("id"));
    throw new ApiError(
      422,
      "unsupported_operation",
      "The local host cannot be removed",
    );
  });
}
