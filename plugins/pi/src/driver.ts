#!/usr/bin/env node

import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  SessionManager,
  type AgentSessionEvent,
  type ContextUsage,
} from "@earendil-works/pi-coding-agent";
import {
  isStandaloneBuiltinCompactCommand,
  jsonObjectSchema,
  type PromptInput,
} from "@bb/domain";
import type {
  ProviderDriverError,
  ProviderSessionOpenParams,
  ProviderTurnSubmitParams,
} from "@bb/provider-driver-contract";
import {
  ProviderDriverRequestError,
  defineProviderDriver,
  type ProviderDriverContext,
} from "@bb/provider-driver-sdk";
import { flattenPromptInputGroups } from "@bb/provider-driver-helpers/prompt-input-groups";
import { PiCanonicalEventTranslator } from "./canonical-event-translator.js";
import { listPiDriverModels } from "./driver-model-list.js";
import { getPiModelRuntime } from "./model-runtime.js";
import { extractPiPromptInput } from "./prompt-input.js";
import { PiSdkSession, type PiSdkSessionOptions } from "./sdk-session.js";
import {
  resolvePiDriverSessionDir,
  resolvePiSessionFilePath,
} from "./session-paths.js";
import { buildDynamicTools } from "./tool-proxy.js";

const PI_SESSION_CLOSE_TIMEOUT_MS = 4_000;

interface PiDriverSession {
  activeTurnId: string | null;
  readonly attachmentId: string;
  readonly bbThreadId: string;
  closing: boolean;
  readonly context: ProviderDriverContext;
  latestProviderCheckpointId: string | null;
  readonly providerSessionId: string;
  readonly session: PiSdkSession;
  readonly translator: PiCanonicalEventTranslator;
}

const sessionsByAttachmentId = new Map<string, PiDriverSession>();
const sessionsByProviderSessionId = new Map<string, PiDriverSession>();

function driverError(args: {
  category: ProviderDriverError["category"];
  code: string;
  message: string;
  detail?: string;
}): ProviderDriverError {
  return {
    code: args.code,
    category: args.category,
    message: args.message,
    ...(args.detail !== undefined ? { detail: args.detail } : {}),
    retry: { disposition: "never" },
  };
}

function rejectRequest(args: Parameters<typeof driverError>[0]): never {
  throw new ProviderDriverRequestError(driverError(args));
}

function requireAttachedSession(attachmentId: string): PiDriverSession {
  const session = sessionsByAttachmentId.get(attachmentId);
  if (!session) {
    rejectRequest({
      code: "pi_session_not_found",
      category: "driver",
      message: `No Pi session for attachment ${attachmentId}`,
    });
  }
  return session;
}

function requireSession(attachmentId: string): PiDriverSession {
  const session = requireAttachedSession(attachmentId);
  if (session.closing) {
    rejectRequest({
      code: "pi_session_closed",
      category: "driver",
      message: `Pi session for attachment ${attachmentId} is closed`,
    });
  }
  return session;
}

function validatePiSessionOptions(params: ProviderSessionOpenParams): void {
  if (params.execution.permission.permissionMode !== "full") {
    rejectRequest({
      code: "pi_permission_mode_unsupported",
      category: "configuration",
      message: "Pi currently requires full permission mode",
    });
  }
  if (params.execution.serviceTier !== "default") {
    rejectRequest({
      code: "pi_service_tier_unsupported",
      category: "configuration",
      message: "Pi does not support a non-default service tier",
    });
  }
  if (params.outputSchema !== null) {
    rejectRequest({
      code: "pi_structured_output_unsupported",
      category: "configuration",
      message: "Pi does not support structured output",
    });
  }
  if (params.disallowedTools.length > 0) {
    rejectRequest({
      code: "pi_disallowed_tools_unsupported",
      category: "configuration",
      message: "Pi does not support per-session disallowed tools",
    });
  }
  if (
    params.execution.features.workflowsEnabled ||
    params.execution.features.memoryEnabled
  ) {
    rejectRequest({
      code: "pi_feature_flags_unsupported",
      category: "configuration",
      message: "Pi does not support BB workflow or memory flags",
    });
  }
  if (Object.keys(params.execution.providerOptions).length > 0) {
    rejectRequest({
      code: "pi_provider_options_unsupported",
      category: "configuration",
      message: "Pi received unsupported provider options",
    });
  }
}

function toPiThinkingLevel(
  reasoningLevel: ProviderSessionOpenParams["execution"]["reasoningLevel"],
): PiSdkSessionOptions["thinkingLevel"] {
  switch (reasoningLevel) {
    case "low":
    case "medium":
    case "high":
    case "xhigh":
    case "max":
      return reasoningLevel;
    case "none":
      return undefined;
    case "ultra":
    case "ultracode":
      rejectRequest({
        code: "pi_reasoning_level_unsupported",
        category: "configuration",
        message: `Pi does not support reasoning level ${reasoningLevel}`,
      });
  }
}

function toContextWindowUsage(contextUsage: ContextUsage | undefined) {
  if (!contextUsage) return null;
  return {
    usedTokens: contextUsage.tokens ?? null,
    modelContextWindow:
      contextUsage.contextWindow > 0 ? contextUsage.contextWindow : null,
    estimated: true,
  };
}

function emitContextWindowUsage(record: PiDriverSession): void {
  const usage = toContextWindowUsage(record.session.getContextUsage());
  if (usage) {
    record.translator.translateContextWindowUsage(usage);
  }
}

function canonicalCallId(providerCallId: string | undefined): string {
  const cleaned = providerCallId?.replace(/[^A-Za-z0-9._:@/-]/gu, "_");
  return cleaned && /^[A-Za-z0-9]/u.test(cleaned)
    ? cleaned.slice(0, 512)
    : `pi-call-${Date.now()}`;
}

function dynamicTools(
  params: ProviderSessionOpenParams,
  record: () => PiDriverSession,
) {
  return buildDynamicTools(params.dynamicTools, async (tool, args, callId) => {
    const current = record();
    const turnId = current.activeTurnId;
    if (turnId === null) {
      return { content: "Pi tool call has no active turn", isError: true };
    }
    const result = await current.context.host.callTool({
      attachmentId: current.attachmentId,
      turnId,
      callId: canonicalCallId(callId),
      tool,
      arguments: jsonObjectSchema.parse(args),
    });
    return {
      content: result.content
        .map((item) =>
          item.type === "text" ? item.text : `[image](${item.imageUrl})`,
        )
        .join("\n"),
      ...(result.success ? {} : { isError: true }),
    };
  });
}

function buildSessionOptions(
  params: ProviderSessionOpenParams,
  providerSessionId: string,
  record: () => PiDriverSession,
): PiSdkSessionOptions {
  const instructions = params.instructions.text.trim();
  const thinkingLevel = toPiThinkingLevel(params.execution.reasoningLevel);
  return {
    cwd: params.workspace.cwd,
    model: params.execution.model,
    sessionFilePath: resolvePiSessionFilePath({
      env: process.env,
      threadId: providerSessionId,
    }),
    ...(params.instructions.mode === "replace" && instructions
      ? { systemPrompt: instructions }
      : {}),
    ...(params.instructions.mode === "append" && instructions
      ? { appendSystemPrompt: instructions }
      : {}),
    ...(params.skillSources.length > 0
      ? {
          additionalSkillPaths: params.skillSources.map((source) =>
            join(source.rootPath, "skills"),
          ),
        }
      : {}),
    ...(Object.keys(params.shellEnvironment).length > 0
      ? { shellEnvOverrides: params.shellEnvironment }
      : {}),
    ...(thinkingLevel !== undefined ? { thinkingLevel } : {}),
    ...(params.dynamicTools.length > 0
      ? { customTools: dynamicTools(params, record) }
      : {}),
  };
}

function materializeFork(params: ProviderSessionOpenParams): void {
  if (params.mode.kind !== "fork") return;
  const sourceSessionFile = resolvePiSessionFilePath({
    env: process.env,
    threadId: params.mode.sourceProviderSessionId,
  });
  if (!existsSync(sourceSessionFile)) {
    rejectRequest({
      code: "pi_fork_source_missing",
      category: "configuration",
      message: `Cannot fork: source Pi session ${params.mode.sourceProviderSessionId} was not found`,
    });
  }

  const targetSessionFile = resolvePiSessionFilePath({
    env: process.env,
    threadId: params.bbThreadId,
  });
  const sessionDir = resolvePiDriverSessionDir({ env: process.env });
  const forkedFile =
    params.mode.sourceCheckpointId === null
      ? SessionManager.forkFrom(
          sourceSessionFile,
          params.workspace.cwd,
          sessionDir,
        ).getSessionFile()
      : SessionManager.open(
          sourceSessionFile,
          sessionDir,
          params.workspace.cwd,
        ).createBranchedSession(params.mode.sourceCheckpointId);
  if (!forkedFile) {
    rejectRequest({
      code: "pi_fork_not_persisted",
      category: "driver",
      message: "Cannot fork: forked Pi session was not persisted",
    });
  }

  try {
    const targetDir = dirname(targetSessionFile);
    if (!existsSync(targetDir)) {
      mkdirSync(targetDir, { recursive: true });
    }
    if (forkedFile !== targetSessionFile) {
      renameSync(forkedFile, targetSessionFile);
    }
  } catch (error) {
    rmSync(forkedFile, { force: true });
    throw error;
  }
}

async function closeSession(
  record: PiDriverSession,
  options: { remove: boolean } = { remove: true },
): Promise<string | null> {
  if (!record.closing) {
    record.closing = true;
    const checkpoint =
      (await record.session.closeGracefully(PI_SESSION_CLOSE_TIMEOUT_MS)) ??
      null;
    record.latestProviderCheckpointId = checkpoint;
  }
  if (options.remove) {
    if (sessionsByAttachmentId.get(record.attachmentId) === record) {
      sessionsByAttachmentId.delete(record.attachmentId);
    }
    if (sessionsByProviderSessionId.get(record.providerSessionId) === record) {
      sessionsByProviderSessionId.delete(record.providerSessionId);
    }
  }
  return record.latestProviderCheckpointId;
}

function flattenInput(params: ProviderTurnSubmitParams): PromptInput[] {
  return flattenPromptInputGroups([], params.inputGroups);
}

export const piProviderDriver = defineProviderDriver({
  identity: { pluginId: "pi", driverId: "pi", providerId: "pi" },
  processCapabilities: { multiplexSessions: true },

  async inspect(params) {
    try {
      const models = await listPiDriverModels(
        await getPiModelRuntime(params.cwd ?? undefined),
      );
      return {
        readiness: { status: "ready" },
        capabilities: {
          multiplexSessions: true,
          supportedSessionOperations: ["fork"],
          supportedPermissionModes: ["full"],
          supportsServiceTier: false,
          supportsSteering: true,
          supportsUserQuestions: false,
        },
        ...models,
        diagnostics: [],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        readiness: {
          status: "unavailable",
          reason: message,
          retryable: true,
        },
        capabilities: {
          multiplexSessions: true,
          supportedSessionOperations: ["fork"],
          supportedPermissionModes: ["full"],
          supportsServiceTier: false,
          supportsSteering: true,
          supportsUserQuestions: false,
        },
        models: [],
        selectedOnlyModels: [],
        diagnostics: [
          {
            level: "error",
            code: "pi_model_inspection_failed",
            message,
            detail: null,
          },
        ],
      };
    }
  },

  async openSession(params, context) {
    validatePiSessionOptions(params);
    if (sessionsByAttachmentId.has(params.attachmentId)) {
      rejectRequest({
        code: "pi_attachment_exists",
        category: "driver",
        message: `Pi attachment ${params.attachmentId} is already open`,
      });
    }
    const providerSessionId =
      params.mode.kind === "resume"
        ? params.mode.providerSessionId
        : params.bbThreadId;
    if (sessionsByProviderSessionId.has(providerSessionId)) {
      rejectRequest({
        code: "pi_session_already_attached",
        category: "driver",
        message: `Pi session ${providerSessionId} is already attached`,
      });
    }
    materializeFork(params);

    const translator = new PiCanonicalEventTranslator({
      attachmentId: params.attachmentId,
      events: context.events,
    });
    let record: PiDriverSession | null = null;
    const currentRecord = (): PiDriverSession => {
      if (!record) throw new Error("Pi driver session is not initialized");
      return record;
    };
    const session = new PiSdkSession(
      buildSessionOptions(params, providerSessionId, currentRecord),
      (event: AgentSessionEvent) => {
        const current = currentRecord();
        if (current.closing) return;
        const providerCheckpointId =
          event.type === "agent_end"
            ? current.session.getProviderCheckpointId()
            : undefined;
        const enriched =
          providerCheckpointId === undefined
            ? event
            : { ...event, providerCheckpointId };
        current.translator.translateSdkEvent(enriched);
        if (event.type === "agent_end" && !event.willRetry) {
          current.activeTurnId = null;
          current.latestProviderCheckpointId = providerCheckpointId ?? null;
          emitContextWindowUsage(current);
        }
        if (event.type === "compaction_end") {
          emitContextWindowUsage(current);
          if (event.reason === "manual") {
            current.activeTurnId = null;
          }
        }
      },
      (error?: unknown) => {
        const current = currentRecord();
        if (current.closing) return;
        if (error !== undefined) {
          current.translator.settleFailed(
            driverError({
              code: "pi_session_error",
              category: "provider",
              message: "Pi session failed",
              detail: error instanceof Error ? error.message : String(error),
            }),
          );
          current.activeTurnId = null;
          return;
        }
        current.translator.settleCancelled(
          current.session.getProviderCheckpointId() ?? null,
        );
        current.activeTurnId = null;
        void closeSession(current);
      },
    );
    record = {
      activeTurnId: null,
      attachmentId: params.attachmentId,
      bbThreadId: params.bbThreadId,
      closing: false,
      context,
      latestProviderCheckpointId: null,
      providerSessionId,
      session,
      translator,
    };
    sessionsByAttachmentId.set(params.attachmentId, record);
    sessionsByProviderSessionId.set(providerSessionId, record);
    try {
      await session.start();
    } catch (error) {
      sessionsByAttachmentId.delete(params.attachmentId);
      sessionsByProviderSessionId.delete(providerSessionId);
      throw error;
    }
    return { providerSessionId, sessionFormatVersion: "pi-jsonl-v1" };
  },

  async detachSession(params) {
    const record = requireAttachedSession(params.attachmentId);
    const providerCheckpointId = await closeSession(record);
    return { providerCheckpointId };
  },

  async discardSession(params) {
    const record = requireAttachedSession(params.attachmentId);
    await closeSession(record);
    rmSync(
      resolvePiSessionFilePath({
        env: process.env,
        threadId: params.providerSessionId,
      }),
      { force: true },
    );
  },

  async submitTurn(params) {
    const record = requireSession(params.attachmentId);
    if (params.mode === "steer") {
      if (record.activeTurnId !== params.expectedTurnId) {
        return { outcome: "stale", activeTurnId: record.activeTurnId };
      }
    } else if (record.activeTurnId !== null) {
      return {
        outcome: "rejected",
        error: driverError({
          code: "pi_turn_active",
          category: "provider",
          message: `Pi turn ${record.activeTurnId} is already active`,
        }),
      };
    }

    const input = flattenInput(params);
    const { text, images } = extractPiPromptInput(input);
    if (!text) {
      return {
        outcome: "rejected",
        error: driverError({
          code: "pi_input_text_required",
          category: "configuration",
          message: "Pi requires text input",
        }),
      };
    }

    const turnId =
      params.mode === "start" ? params.turnId : params.expectedTurnId;
    if (params.mode === "start") {
      record.activeTurnId = turnId;
      record.translator.beginTurn(turnId);
      if (isStandaloneBuiltinCompactCommand(input)) {
        void record.session.compact().catch((error: unknown) => {
          record.translator.settleFailed(
            driverError({
              code: "pi_compaction_failed",
              category: "provider",
              message: "Pi compaction failed",
              detail: error instanceof Error ? error.message : String(error),
            }),
          );
          record.activeTurnId = null;
        });
      } else {
        void record.session.prompt(
          text,
          images.length > 0 ? images : undefined,
        );
      }
      return {
        outcome: "accepted",
        disposition: "started",
        turnId,
        providerTurnId: null,
      };
    }

    if (record.session.getIsCompacting()) {
      return {
        outcome: "rejected",
        error: driverError({
          code: "pi_compaction_active",
          category: "provider",
          message: "Cannot steer while Pi context compaction is active",
        }),
      };
    }
    try {
      await record.session.steer(text, images.length > 0 ? images : undefined);
      return {
        outcome: "accepted",
        disposition: "steered",
        turnId,
        providerTurnId: null,
      };
    } catch (error) {
      return {
        outcome: "rejected",
        error: driverError({
          code: "pi_steer_rejected",
          category: "provider",
          message: "Pi rejected steering input",
          detail: error instanceof Error ? error.message : String(error),
        }),
      };
    }
  },

  async cancelTurn(params) {
    const record = requireSession(params.attachmentId);
    if (record.activeTurnId !== params.turnId) {
      return { outcome: "not_active" };
    }
    const providerCheckpointId = await closeSession(record, { remove: false });
    record.translator.settleCancelled(providerCheckpointId);
    record.activeTurnId = null;
    return { outcome: "cancellation_requested" };
  },

  async compactSession(params) {
    const record = requireSession(params.attachmentId);
    if (record.activeTurnId !== null) {
      return {
        outcome: "unsupported",
        message: "Submit the built-in compact command as a turn",
      };
    }
    return {
      outcome: "unsupported",
      message: "Pi compaction requires a canonical turn for event scope",
    };
  },

  async shutdown() {
    await Promise.all(
      [...sessionsByAttachmentId.values()].map((record) =>
        closeSession(record),
      ),
    );
  },
});
