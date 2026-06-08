import {
  createThread,
  deleteThread,
  getEnvironment,
  getProject,
  getThread,
} from "@bb/db";
import {
  replayRunRequestSchema,
  typedRoutes,
  type PublicApiSchema,
  type ReplayCaptureDetail,
  type ReplayCaptureHostSummary,
} from "@bb/server-contract";
import {
  getReplayCaptureInitialTurn,
  isReplayCaptureId,
  type ReplayCaptureManifest,
} from "@bb/replay-capture";
import type { Hono } from "hono";
import { COMMAND_TIMEOUT_MS } from "../constants.js";
import { ApiError } from "../errors.js";
import type { AppDeps } from "../types.js";
import { LOCAL_HOST_ID } from "../services/hosts/local-host.js";
import { callEngineOnlineRpc } from "../services/hosts/online-rpc.js";
import { appendClientTurnEvent } from "../services/threads/thread-events.js";

interface ResolvedReplayCapture {
  environmentId: string;
  projectId: string;
  providerId: string;
  title: string | null;
}

interface CaptureEnrichment {
  title: string | null;
  projectName: string | null;
}

function firstNonBlank(
  ...values: Array<string | null | undefined>
): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return null;
}

function loadCaptureEnrichment(
  deps: AppDeps,
  args: { projectId: string; threadId: string },
): CaptureEnrichment {
  const thread = getThread(deps.db, args.threadId);
  const project = getProject(deps.db, args.projectId);
  return {
    title: firstNonBlank(thread?.title, thread?.titleFallback),
    projectName: firstNonBlank(project?.name),
  };
}

function toDetail(
  hostId: string,
  manifest: ReplayCaptureManifest,
  enrichment: CaptureEnrichment,
): ReplayCaptureDetail {
  return {
    ...manifest,
    hostId,
    title: enrichment.title,
    projectName: enrichment.projectName,
  };
}

function requireReplayCaptureId(captureId: string): void {
  if (!isReplayCaptureId(captureId)) {
    throw new ApiError(400, "invalid_request", "Invalid replay capture id");
  }
}

function resolveManifestReplayTarget(
  manifest: ReplayCaptureDetail,
): ResolvedReplayCapture {
  return {
    environmentId: manifest.environmentId,
    projectId: manifest.projectId,
    providerId: manifest.providerId,
    title: manifest.title,
  };
}

function isReplayCaptureNotFound(error: unknown): boolean {
  return (
    error instanceof ApiError && error.body.code === "replay_capture_not_found"
  );
}

async function listCaptures(
  deps: AppDeps,
): Promise<ReplayCaptureHostSummary[]> {
  const result = await callEngineOnlineRpc(deps, {
    timeoutMs: COMMAND_TIMEOUT_MS,
    command: {
      type: "development.replay",
      operation: "capture-list",
    },
  });
  return result.captures
    .map((capture): ReplayCaptureHostSummary => {
      const enrichment = loadCaptureEnrichment(deps, {
        projectId: capture.projectId,
        threadId: capture.threadId,
      });
      return {
        ...capture,
        hostId: LOCAL_HOST_ID,
        title: enrichment.title,
        projectName: enrichment.projectName,
      };
    })
    .sort((left, right) => right.capturedAt - left.capturedAt);
}

function rethrowReplayCaptureNotFoundAs404(error: unknown): never {
  if (isReplayCaptureNotFound(error)) {
    throw new ApiError(
      404,
      "replay_capture_not_found",
      "Replay capture not found",
    );
  }
  throw error;
}

async function findCapture(
  deps: AppDeps,
  captureId: string,
): Promise<ReplayCaptureDetail> {
  requireReplayCaptureId(captureId);

  const manifest = await callEngineOnlineRpc(deps, {
    timeoutMs: COMMAND_TIMEOUT_MS,
    command: {
      type: "development.replay",
      operation: "capture-get",
      captureId,
    },
  }).catch(rethrowReplayCaptureNotFoundAs404);
  const enrichment = loadCaptureEnrichment(deps, {
    projectId: manifest.projectId,
    threadId: manifest.threadId,
  });
  return toDetail(LOCAL_HOST_ID, manifest, enrichment);
}

async function deleteCapture(deps: AppDeps, captureId: string): Promise<void> {
  requireReplayCaptureId(captureId);

  await callEngineOnlineRpc(deps, {
    timeoutMs: COMMAND_TIMEOUT_MS,
    command: {
      type: "development.replay",
      operation: "capture-delete",
      captureId,
    },
  }).catch(rethrowReplayCaptureNotFoundAs404);
}

export function registerDevelopmentOnlyReplayRoutes(
  app: Hono,
  deps: AppDeps,
): void {
  const { del, get, post } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (msg) => new ApiError(400, "invalid_request", msg),
  });

  get("/development-only/replay/captures", async (context) => {
    return context.json({ captures: await listCaptures(deps) });
  });

  del("/development-only/replay/captures/:id", async (context) => {
    await deleteCapture(deps, context.req.param("id"));
    return context.json({ ok: true as const });
  });

  post(
    "/development-only/replay/captures/:id/runs",
    replayRunRequestSchema,
    async (context, payload) => {
      const manifest = await findCapture(deps, context.req.param("id"));
      const resolved = resolveManifestReplayTarget(manifest);
      const replayTurn = getReplayCaptureInitialTurn(manifest);
      const environment = getEnvironment(deps.db, resolved.environmentId);
      if (!environment) {
        throw new ApiError(
          404,
          "environment_not_found",
          "Replay environment not found",
        );
      }
      if (environment.projectId !== resolved.projectId) {
        throw new ApiError(
          409,
          "replay_capture_project_mismatch",
          "Replay capture belongs to a different project than its environment",
        );
      }
      const replayThread = createThread(deps.db, deps.hub, {
        projectId: resolved.projectId,
        environmentId: resolved.environmentId,
        providerId: resolved.providerId,
        status: "created",
        title: `[Replay] ${resolved.title ?? manifest.captureId}`,
      });
      try {
        // Replay threads are synthetic development-only artifacts, so their
        // prompts intentionally do not enter prompt_history_entries recall.
        const request = appendClientTurnEvent(deps, {
          threadId: replayThread.id,
          environmentId: resolved.environmentId,
          type: "client/turn/requested",
          input: replayTurn.userInput,
          execution: manifest.execution,
          initiator: "user",
          senderThreadId: null,
          requestMethod:
            manifest.kind === "thread-start" ? "thread/start" : "turn/start",
          source: "tell",
          target: { kind: "new-turn" },
        });
        await callEngineOnlineRpc(deps, {
          timeoutMs: COMMAND_TIMEOUT_MS,
          command: {
            type: "development.replay",
            operation: "run",
            captureId: manifest.captureId,
            environmentId: resolved.environmentId,
            threadId: replayThread.id,
            requestId: request.requestId,
            speed: payload.speed,
          },
        });
        return context.json(
          {
            runId: request.requestId,
            replayThreadId: replayThread.id,
            projectId: replayThread.projectId,
          },
          201,
        );
      } catch (error) {
        deleteThread(deps.db, deps.hub, replayThread.id);
        throw error;
      }
    },
  );
}
