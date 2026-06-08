import {
  systemExecutionOptionsQuerySchema,
  systemProvidersQuerySchema,
  typedRoutes,
  type PublicApiSchema,
} from "@bb/server-contract";
import type { Hono } from "hono";
import type { ServerAppDeps } from "../types.js";
import { COMMAND_TIMEOUT_MS } from "../constants.js";
import { ApiError } from "../errors.js";
import { callEngineOnlineRpc } from "../services/engine/online-rpc.js";
import {
  resolveVoiceTranscriptionEnabled,
  transcribeVoiceInput,
} from "../services/ai/voice-transcription.js";
import { resolveSystemExecutionOptions } from "../services/system/execution-options.js";
import { resolveSystemLookupHostId } from "../services/system/host-lookup.js";

export function registerSystemRoutes(app: Hono, deps: ServerAppDeps): void {
  const { get, post } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (msg) => new ApiError(400, "invalid_request", msg),
  });

  get("/system/config", (context) =>
    context.json({
      featureFlags: deps.config.featureFlags,
      // Decision 5: the server serves the former :38887 local API itself, so
      // the port it advertises for it is its own. The field keeps its frozen
      // wire name — the FE/desktop probe reads `hostDaemonPort`.
      hostDaemonPort: deps.config.serverPort,
      voiceTranscriptionEnabled: resolveVoiceTranscriptionEnabled(deps),
    }),
  );

  post("/system/config/reload", async (context) => {
    try {
      await deps.bbAppManagedConfig.reload({ notify: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ApiError(422, "invalid_config", message);
    }
    return context.json({ ok: true });
  });

  get(
    "/system/providers",
    systemProvidersQuerySchema,
    async (context, query) => {
      // Query host scoping is accepted-but-single-host now; environment
      // references are still validated.
      resolveSystemLookupHostId(deps, query);
      const result = await callEngineOnlineRpc(deps, {
        timeoutMs: COMMAND_TIMEOUT_MS,
        command: { type: "provider.list" },
      });
      return context.json(result.providers);
    },
  );

  get(
    "/system/execution-options",
    systemExecutionOptionsQuerySchema,
    async (context, query) =>
      context.json(await resolveSystemExecutionOptions(deps, query)),
  );

  post("/system/voice-transcription", async (context) => {
    const formData = await context.req.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      throw new ApiError(400, "invalid_request", "Audio file is required");
    }
    return context.json({
      text: await transcribeVoiceInput(deps, {
        file,
        prompt:
          typeof formData.get("prompt") === "string"
            ? String(formData.get("prompt"))
            : undefined,
      }),
    });
  });

  get("/system/version", async (context) =>
    context.json(await deps.appVersion.getSystemVersion()),
  );
}
