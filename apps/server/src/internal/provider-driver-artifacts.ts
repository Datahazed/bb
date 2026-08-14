/* eslint-disable no-restricted-imports -- serves immutable server-owned plugin artifact storage. */
import { createReadStream } from "node:fs";
import { providerDriverArtifactDigestSchema } from "@bb/provider-driver-contract";
import type { Hono } from "hono";
import { stream } from "hono/streaming";
import { ApiError } from "../errors.js";
import type { PluginService } from "../services/plugins/plugin-service.js";
import { getAuthenticatedDaemon } from "./auth.js";

export function registerInternalProviderDriverArtifactRoutes(
  app: Hono,
  plugins: Pick<PluginService, "getHostDriverArtifact">,
): void {
  app.get("/provider-drivers/artifacts/:digest", (context) => {
    // The enclosing /internal middleware authenticates the daemon. Reading the
    // context here also prevents this route from being mounted without it in a
    // future refactor.
    getAuthenticatedDaemon(context);
    const parsedDigest = providerDriverArtifactDigestSchema.safeParse(
      context.req.param("digest"),
    );
    if (!parsedDigest.success) {
      throw new ApiError(
        404,
        "not_found",
        "Provider driver artifact not found",
      );
    }
    const artifact = plugins.getHostDriverArtifact(parsedDigest.data);
    if (artifact === undefined) {
      throw new ApiError(
        404,
        "not_found",
        "Provider driver artifact not found",
      );
    }
    context.header("cache-control", "private, max-age=31536000, immutable");
    context.header("content-length", String(artifact.sizeBytes));
    context.header("content-type", "application/gzip");
    context.header("x-bb-artifact-digest", artifact.descriptor.digest);
    return stream(context, async (output) => {
      for await (const chunk of createReadStream(artifact.archivePath)) {
        await output.write(chunk);
      }
    });
  });
}
