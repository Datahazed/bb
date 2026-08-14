#!/usr/bin/env node

/** Canonical driver for ACP-compatible agents. */

import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { promises as fs, readFileSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  hostDaemonAcpLaunchSpecSchema,
  normalizeHostDaemonAcpLaunchSpec,
  type HostDaemonAcpLaunchSpec,
} from "@bb/host-daemon-contract";
import {
  isApprovalPendingInteractionResolution,
  isStandaloneBuiltinCompactCommand,
  jsonObjectSchema,
  reasoningEffortsForLevels,
  type AvailableModel,
  type PromptInput,
  type ReasoningLevel,
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
import { z } from "zod";
import { buildEditDiff } from "../shared/provider-utils.js";
import { withoutBridgeRuntimeEnv } from "../shared/bridge-runtime-env.js";
import { mimeTypeFromExtension } from "../shared/mime-types.js";
import { flattenPromptInputGroups } from "../shared/prompt-input-groups.js";
import {
  ACP_DEFAULT_MODEL_ID,
  type AcpBridgeAgentCommand,
  type AcpBridgeNativeReasoning,
  type AcpBridgePermissionCli,
  type AcpBridgeReasoningCli,
  type AcpBridgeThreadStartParams,
} from "./session-config.js";
import {
  ACP_PROTOCOL_VERSION,
  type AcpConfigOption,
  acpConfigStateResultSchema,
  acpInitializeResultSchema,
  acpPromptResultSchema,
  acpReadTextFileParamsSchema,
  acpRequestPermissionParamsSchema,
  acpSessionNewResultSchema,
  acpSessionNotificationParamsSchema,
  acpUsageUpdateSchema,
  type AcpConfigStateResult,
  type AcpSessionModels,
  type AcpUsageUpdate,
  acpStopReasonSchema,
  acpWriteTextFileParamsSchema,
  type AcpContentBlock,
  type AcpPermissionOption,
} from "./wire.js";
import {
  createAcpAgentConnection,
  type AcpAgentConnection,
  type AcpAgentRequestResponder,
} from "./agent-connection.js";
import {
  buildAgentModelCatalog,
  buildAcpNativeReasoningSupport,
  buildModelCatalogFromConfigOptions,
  buildModelCatalogFromSessionModels,
  acpNativeReasoningLevelToValue,
  findAcpModelConfigOption,
  findAcpThoughtLevelConfigOption,
  parseAgentModelLines,
  splitPrimaryModels,
  type AcpNativeReasoningSupport,
  type AgentModelCatalog,
} from "./model-catalog.js";
import {
  buildAcpMcpServerConfig,
  runAcpDynamicToolMcpServer,
  type AcpMcpServerConfig,
} from "./tool-proxy-mcp.js";
import {
  AcpCanonicalEventTranslator,
  buildAcpApprovalDecisions,
  buildOpaqueAcpPermissionCommand,
} from "./canonical-event-translator.js";

interface AcpSessionPolicy {
  permissionMode: "accept-edits" | "full";
  permissionEscalation: "ask" | "deny" | null;
  workspaceWriteRoots: string[];
}

interface PendingAcpPermission {
  responder: AcpAgentRequestResponder;
  options: AcpPermissionOption[];
}

interface AcpThreadSession {
  activePromptKind: "turn" | "compaction" | null;
  activeTurnId: string | null;
  readonly agentLabel: string;
  readonly attachmentId: string;
  readonly connection: AcpAgentConnection;
  readonly context: ProviderDriverContext;
  readonly cwd: string;
  loading: boolean;
  loadingSessionId: string | undefined;
  pendingInstructions: string | undefined;
  pendingLoadUsageUpdate: AcpUsageUpdate | undefined;
  readonly pendingPermissions: Set<PendingAcpPermission>;
  readonly policy: AcpSessionPolicy;
  providerThreadId: string;
  queuedInputs: PromptInput[][];
  stopping: boolean;
  supportsImageInput: boolean;
  readonly translator: AcpCanonicalEventTranslator;
  turnSettled: Promise<void> | undefined;
}

const sessionsByAttachmentId = new Map<string, AcpThreadSession>();
const sessionsByProviderThreadId = new Map<string, AcpThreadSession>();
let dynamicToolBridgePromise: Promise<AcpDynamicToolBridge> | null = null;
const THREAD_STOP_CANCEL_TIMEOUT_MS = 4_000;

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

function requireSession(attachmentId: string): AcpThreadSession {
  const session = sessionsByAttachmentId.get(attachmentId);
  if (!session || session.stopping) {
    rejectRequest({
      code: "acp_session_not_found",
      category: "driver",
      message: `No active ACP session for attachment ${attachmentId}`,
    });
  }
  return session;
}

function resolveDriverProcessArgsForMcpServer(): string[] {
  const entryPoint = process.argv[1]
    ? resolve(process.argv[1])
    : fileURLToPath(import.meta.url);
  return [...process.execArgv, entryPoint, "--mcp-stdio"];
}

function resolveDriverProcessEnvForMcpServer(): AcpMcpServerConfig["env"] {
  const electronRunAsNode = process.env.ELECTRON_RUN_AS_NODE;
  return electronRunAsNode === undefined
    ? []
    : [{ name: "ELECTRON_RUN_AS_NODE", value: electronRunAsNode }];
}

async function forwardDynamicToolCall(args: {
  arguments: Record<string, unknown>;
  callId: string;
  threadId: string;
  tool: string;
}): Promise<
  | { ok: true; content: string; isError?: boolean }
  | { ok: false; error: string }
> {
  const session = sessionsByAttachmentId.get(args.threadId);
  const turnId = session?.activeTurnId;
  if (!session || session.stopping || turnId == null) {
    return { ok: false, error: "No active ACP turn for dynamic tool call." };
  }
  try {
    const result = await session.context.host.callTool({
      attachmentId: session.attachmentId,
      turnId,
      callId: args.callId,
      tool: args.tool,
      arguments: jsonObjectSchema.parse(args.arguments),
    });
    return {
      ok: true,
      content: result.content
        .map((item) =>
          item.type === "text" ? item.text : `[image](${item.imageUrl})`,
        )
        .join("\n"),
      ...(result.success ? {} : { isError: true }),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function handleDynamicToolBridgeSocket(
  bridge: AcpDynamicToolBridge,
  socket: Socket,
): void {
  let buffer = "";
  socket.setEncoding("utf8");
  socket.on("data", (chunk) => {
    buffer += chunk;
    const newlineIndex = buffer.indexOf("\n");
    if (newlineIndex === -1) return;
    const line = buffer.slice(0, newlineIndex);
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      socket.end(`${JSON.stringify({ ok: false, error: "Invalid JSON" })}\n`);
      return;
    }
    const request = dynamicToolBridgeRequestSchema.safeParse(parsed);
    if (!request.success || request.data.token !== bridge.token) {
      socket.end(
        `${JSON.stringify({ ok: false, error: "Invalid dynamic tool request" })}\n`,
      );
      return;
    }
    void forwardDynamicToolCall(request.data).then((response) => {
      socket.end(`${JSON.stringify(response)}\n`);
    });
  });
}

async function ensureDynamicToolBridge(): Promise<AcpDynamicToolBridge> {
  if (dynamicToolBridgePromise) return dynamicToolBridgePromise;
  dynamicToolBridgePromise = new Promise((resolveBridge, rejectBridge) => {
    const host = "127.0.0.1";
    const server = createServer((socket) => {
      void dynamicToolBridgePromise?.then((bridge) => {
        handleDynamicToolBridgeSocket(bridge, socket);
      });
    });
    server.once("error", rejectBridge);
    server.listen(0, host, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        rejectBridge(
          new Error("ACP dynamic tool bridge did not bind a TCP port"),
        );
        return;
      }
      resolveBridge({
        host,
        port: address.port,
        server,
        token: randomBytes(32).toString("hex"),
      });
    });
  });
  return dynamicToolBridgePromise;
}

async function buildSessionMcpServers(
  params: AcpBridgeThreadStartParams,
): Promise<AcpMcpServerConfig[]> {
  const dynamicTools = params.dynamicTools ?? [];
  if (dynamicTools.length === 0) return [];
  const bridge = await ensureDynamicToolBridge();
  return [
    buildAcpMcpServerConfig({
      bridgeArgs: resolveDriverProcessArgsForMcpServer(),
      command: process.execPath,
      dynamicTools,
      host: bridge.host,
      port: bridge.port,
      runtimeEnv: resolveDriverProcessEnvForMcpServer(),
      threadId: params.threadId,
      token: bridge.token,
    }),
  ];
}

interface AcpDynamicToolBridge {
  host: string;
  port: number;
  server: Server;
  token: string;
}

const dynamicToolBridgeRequestSchema = z.object({
  arguments: z.record(z.string(), z.unknown()).default({}),
  callId: z.string().min(1),
  threadId: z.string().min(1),
  token: z.string().min(1),
  tool: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Model catalog — parsed from the agent CLI's list command, with the
// synthetic "Agent default" entry as the resilience fallback
// ---------------------------------------------------------------------------

const ACP_DEFAULT_MODEL: AvailableModel = {
  id: ACP_DEFAULT_MODEL_ID,
  model: ACP_DEFAULT_MODEL_ID,
  displayName: "Agent default",
  description: "Model selection is managed by the connected ACP agent.",
  supportedReasoningEfforts: [
    {
      reasoningEffort: "medium",
      description: "Reasoning effort is managed by the connected ACP agent.",
    },
  ],
  defaultReasoningEffort: "medium",
  isDefault: true,
};

const MODEL_LIST_TIMEOUT_MS = 30_000;
const ACP_NATIVE_REASONING_DISCOVERY_TIMEOUT_MS = 5_000;
const AUTH_REQUIRED_MODEL_LIST_ERROR_MESSAGE =
  "ACP agent is not authenticated.";

function reasoningSupportFromCli(
  reasoningCli: AcpBridgeReasoningCli | undefined,
):
  | Pick<AvailableModel, "supportedReasoningEfforts" | "defaultReasoningEffort">
  | undefined {
  if (reasoningCli === undefined) {
    return undefined;
  }
  const supportedLevels = reasoningCli.supportedLevels;
  const defaultReasoningEffort =
    reasoningCli.defaultLevel !== undefined &&
    supportedLevels.includes(reasoningCli.defaultLevel)
      ? reasoningCli.defaultLevel
      : supportedLevels.includes("medium")
        ? "medium"
        : supportedLevels[0];
  return {
    supportedReasoningEfforts: reasoningEffortsForLevels(supportedLevels),
    defaultReasoningEffort,
  };
}

function reasoningSupportFromNativeHint(
  nativeReasoning: AcpBridgeNativeReasoning | undefined,
):
  | Pick<AvailableModel, "supportedReasoningEfforts" | "defaultReasoningEffort">
  | undefined {
  if (nativeReasoning === undefined) {
    return undefined;
  }
  const supportedLevels = nativeReasoning.supportedLevels;
  const defaultReasoningEffort =
    nativeReasoning.defaultLevel !== undefined &&
    supportedLevels.includes(nativeReasoning.defaultLevel)
      ? nativeReasoning.defaultLevel
      : supportedLevels.includes("medium")
        ? "medium"
        : supportedLevels[0];
  return {
    supportedReasoningEfforts: reasoningEffortsForLevels(supportedLevels),
    defaultReasoningEffort,
  };
}

function applyReasoningCliToModel(
  model: AvailableModel,
  reasoningCli: AcpBridgeReasoningCli | undefined,
): AvailableModel {
  const reasoningSupport = reasoningSupportFromCli(reasoningCli);
  return reasoningSupport === undefined
    ? model
    : {
        ...model,
        ...reasoningSupport,
      };
}

function modelHasOnlyAgentManagedReasoning(model: AvailableModel): boolean {
  return (
    model.supportedReasoningEfforts.length === 1 &&
    model.supportedReasoningEfforts[0]?.reasoningEffort === "medium" &&
    model.defaultReasoningEffort === "medium"
  );
}

function applyNativeReasoningHintToModel(
  model: AvailableModel,
  nativeReasoning: AcpBridgeNativeReasoning | undefined,
): AvailableModel {
  const reasoningSupport = reasoningSupportFromNativeHint(nativeReasoning);
  return reasoningSupport === undefined ||
    !modelHasOnlyAgentManagedReasoning(model)
    ? model
    : {
        ...model,
        ...reasoningSupport,
      };
}

function applyConfiguredReasoningToModel(
  model: AvailableModel,
  args: {
    reasoningCli: AcpBridgeReasoningCli | undefined;
    nativeReasoning: AcpBridgeNativeReasoning | undefined;
  },
): AvailableModel {
  return args.reasoningCli !== undefined
    ? applyReasoningCliToModel(model, args.reasoningCli)
    : applyNativeReasoningHintToModel(model, args.nativeReasoning);
}

function applyConfiguredReasoningToModels(
  models: readonly AvailableModel[],
  args: {
    reasoningCli: AcpBridgeReasoningCli | undefined;
    nativeReasoning: AcpBridgeNativeReasoning | undefined;
  },
): AvailableModel[] {
  return models.map((model) => applyConfiguredReasoningToModel(model, args));
}

function resolveReasoningCliValue(args: {
  reasoningCli: AcpBridgeReasoningCli;
  reasoningLevel: ReasoningLevel;
}): string | undefined {
  const override = args.reasoningCli.levelValues?.[args.reasoningLevel];
  if (override !== undefined) {
    return override;
  }
  return args.reasoningCli.supportedLevels.includes(args.reasoningLevel)
    ? args.reasoningLevel
    : undefined;
}

function nativeReasoningLevelToValue(args: {
  nativeReasoning: AcpBridgeNativeReasoning;
  reasoningLevel: ReasoningLevel;
}): string | undefined {
  const override = args.nativeReasoning.levelValues?.[args.reasoningLevel];
  if (override !== undefined) {
    return override;
  }
  return args.nativeReasoning.supportedLevels.includes(args.reasoningLevel)
    ? args.reasoningLevel
    : undefined;
}

function nativeReasoningToThoughtLevelOption(
  nativeReasoning: AcpBridgeNativeReasoning | undefined,
): AcpConfigOption | undefined {
  if (nativeReasoning === undefined) {
    return undefined;
  }
  const options = nativeReasoning.supportedLevels.flatMap((level) => {
    const value = nativeReasoningLevelToValue({
      nativeReasoning,
      reasoningLevel: level,
    });
    return value === undefined
      ? []
      : [
          {
            value,
            name: value,
          },
        ];
  });
  const currentValue =
    nativeReasoning.defaultLevel === undefined
      ? undefined
      : nativeReasoningLevelToValue({
          nativeReasoning,
          reasoningLevel: nativeReasoning.defaultLevel,
        });
  return {
    id: nativeReasoning.configId,
    category: "thought_level",
    type: "select",
    ...(currentValue !== undefined ? { currentValue } : {}),
    options,
  };
}

function permissionCliArgsForMode(
  permissionCli: AcpBridgePermissionCli | undefined,
  permissionMode: AcpSessionPolicy["permissionMode"],
): string[] {
  if (permissionCli === undefined) {
    return [];
  }
  switch (permissionMode) {
    case "full":
      return permissionCli.full ?? [];
    case "accept-edits":
      return permissionCli.workspaceWrite ?? [];
  }
}

function applyPermissionCliArgs(
  agentArgs: readonly string[],
  permissionCli: AcpBridgePermissionCli | undefined,
  permissionMode: AcpSessionPolicy["permissionMode"],
): string[] {
  const permissionArgs = permissionCliArgsForMode(
    permissionCli,
    permissionMode,
  );
  if (permissionArgs.length === 0) {
    return [...agentArgs];
  }
  const insertAfterArgs = Math.min(
    permissionCli?.insertAfterArgs ?? 0,
    agentArgs.length,
  );
  return [
    ...agentArgs.slice(0, insertAfterArgs),
    ...permissionArgs,
    ...agentArgs.slice(insertAfterArgs),
  ];
}

let cachedModelCatalog: { key: string; catalog: AgentModelCatalog } | null =
  null;
// ACP-native model discovery spawns a throwaway session, so its result is
// cached. Unlike the CLI list (which re-runs every call), discovery is too
// expensive to repeat per picker open — but a short TTL lets external changes
// to the agent (auth, added model providers) surface on the next open.
const SESSION_MODEL_DISCOVERY_TTL_MS = 60_000;
let cachedSessionDiscoveredModels: {
  key: string;
  models: AvailableModel[];
  fetchedAt: number;
} | null = null;

function resolveAcpAuthMethodId(
  authMethods: readonly { id: string }[] | undefined,
  env: Record<string, string | undefined>,
): string | undefined {
  // Grok is currently the only known ACP agent that advertises auth methods.
  // Keep this preference local until another authenticated ACP provider needs
  // a data-driven policy; cached_token is an ACP-side local-login flow.
  const methodIds = new Set((authMethods ?? []).map((method) => method.id));
  if (methodIds.size === 0) {
    return undefined;
  }
  if (env.XAI_API_KEY && methodIds.has("xai.api_key")) {
    return "xai.api_key";
  }
  if (methodIds.has("cached_token")) {
    return "cached_token";
  }
  return undefined;
}

async function authenticateAcpAgent(args: {
  connection: AcpAgentConnection;
  env: Record<string, string | undefined>;
  initializeResult: { authMethods?: readonly { id: string }[] };
}): Promise<void> {
  const methodId = resolveAcpAuthMethodId(
    args.initializeResult.authMethods,
    args.env,
  );
  if (methodId === undefined) {
    return;
  }
  await args.connection.request({
    method: "authenticate",
    params: { methodId, _meta: { headless: true } },
    resultSchema: z.unknown(),
  });
}

/**
 * Run the agent's model list command and build the variant catalog, cached
 * per list command for the driver's lifetime (model/list refreshes it on the
 * next picker open; session starts reuse it for variant resolution). Returns
 * null when the command fails or lists nothing so callers can fall back —
 * the picker to the synthetic entry, session starts to the unresolved id.
 */
async function loadAgentModelCatalog(
  listCommand: AcpBridgeAgentCommand,
): Promise<AgentModelCatalog | null> {
  const stdout = await new Promise<string | null>((resolveExec, rejectExec) => {
    execFile(
      listCommand.command,
      listCommand.args,
      {
        ...(listCommand.cwd !== undefined ? { cwd: listCommand.cwd } : {}),
        env: {
          ...withoutBridgeRuntimeEnv(process.env),
          ...(listCommand.envVars ?? {}),
        },
        timeout: MODEL_LIST_TIMEOUT_MS,
      },
      (error, out, stderr) => {
        if (!error) {
          resolveExec(out);
          return;
        }
        if (isMissingExecutableError(error)) {
          rejectExec(error);
          return;
        }
        if (isAuthRequiredModelListError(error, out, stderr)) {
          rejectExec(new AcpModelListAuthRequiredError());
          return;
        }
        resolveExec(null);
      },
    );
  });
  const key = JSON.stringify(listCommand);
  if (stdout === null) {
    process.stderr.write(
      `acp driver: model list command "${listCommand.command}" failed\n`,
    );
    return cachedModelCatalog?.key === key ? cachedModelCatalog.catalog : null;
  }
  const catalog = buildAgentModelCatalog(parseAgentModelLines(stdout));
  if (!catalog) {
    process.stderr.write(
      `acp driver: model list command "${listCommand.command}" printed no models\n`,
    );
    return cachedModelCatalog?.key === key ? cachedModelCatalog.catalog : null;
  }
  cachedModelCatalog = { key, catalog };
  return catalog;
}

async function loadSessionDiscoveredModels(
  agent: AcpBridgeAgentCommand,
): Promise<AvailableModel[] | null> {
  const key = JSON.stringify(agent);
  if (
    cachedSessionDiscoveredModels?.key === key &&
    Date.now() - cachedSessionDiscoveredModels.fetchedAt <
      SESSION_MODEL_DISCOVERY_TTL_MS
  ) {
    return cachedSessionDiscoveredModels.models;
  }

  const childEnv = {
    ...withoutBridgeRuntimeEnv(process.env),
    ...(agent.envVars ?? {}),
  };
  const connection = createAcpAgentConnection({
    command: agent.command,
    args: agent.args,
    cwd: agent.cwd ?? process.cwd(),
    env: childEnv,
    onNotification: () => {},
    onRequest: (_method, _params, responder) => {
      responder.error(-32601, "ACP model discovery does not support requests");
    },
    onExit: () => {},
  });

  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutReached = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      connection.kill();
      reject(
        new Error(
          `ACP-native model discovery timed out after ${MODEL_LIST_TIMEOUT_MS}ms`,
        ),
      );
    }, MODEL_LIST_TIMEOUT_MS);
  });

  try {
    const newSession = await Promise.race([
      (async () => {
        const initializeResult = await connection.request({
          method: "initialize",
          params: {
            protocolVersion: ACP_PROTOCOL_VERSION,
            clientInfo: { name: "bb", version: "1.0.0" },
            clientCapabilities: {
              fs: { readTextFile: false, writeTextFile: false },
              terminal: false,
            },
          },
          resultSchema: acpInitializeResultSchema,
        });
        await authenticateAcpAgent({
          connection,
          env: childEnv,
          initializeResult,
        });
        return await connection.request({
          method: "session/new",
          params: { cwd: agent.cwd ?? process.cwd(), mcpServers: [] },
          resultSchema: acpSessionNewResultSchema,
        });
      })(),
      timeoutReached,
    ]);
    if (timeout !== undefined) {
      clearTimeout(timeout);
      timeout = undefined;
    }

    const modelOption = findAcpModelConfigOption(newSession.configOptions);
    const configOptionModels = buildModelCatalogFromConfigOptions(modelOption);
    const sessionModels = buildModelCatalogFromSessionModels(newSession.models);
    if (configOptionModels.length === 0 && sessionModels.length === 0) {
      return null;
    }

    if (configOptionModels.length === 0) {
      cachedSessionDiscoveredModels = {
        key,
        models: sessionModels,
        fetchedAt: Date.now(),
      };
      return sessionModels;
    }

    const reasoningByModel = await discoverAcpNativeReasoningByModel({
      connection,
      sessionId: newSession.sessionId,
      modelOption,
    });
    const models =
      reasoningByModel === null
        ? configOptionModels
        : buildModelCatalogFromConfigOptions(modelOption, reasoningByModel);
    cachedSessionDiscoveredModels = {
      key,
      models,
      fetchedAt: Date.now(),
    };
    return models;
  } catch (error) {
    process.stderr.write(
      `acp driver: ACP-native model discovery for "${agent.command}" failed: ${
        error instanceof Error ? error.message : String(error)
      }\n`,
    );
    return null;
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
    connection.kill();
  }
}

async function discoverAcpNativeReasoningByModel(args: {
  connection: AcpAgentConnection;
  sessionId: string;
  modelOption: AcpConfigOption | undefined;
}): Promise<ReadonlyMap<string, AcpNativeReasoningSupport> | null> {
  const modelOptions = args.modelOption?.options ?? [];
  if (!args.modelOption || modelOptions.length === 0) {
    return null;
  }
  const modelOption = args.modelOption;

  // Each probe is one set_config_option round trip to the local agent, so
  // work is bounded by the time budget rather than a model-count cutoff
  // (omp's catalog alone is ~90 models). On timeout or a mid-probe error the
  // partial map is kept: probed models surface their real reasoning levels
  // and unprobed models fall back to the agent-managed default.
  const supportByModel = new Map<string, AcpNativeReasoningSupport>();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutReached = new Promise<
    ReadonlyMap<string, AcpNativeReasoningSupport>
  >((resolve) => {
    timeout = setTimeout(() => {
      args.connection.kill();
      resolve(supportByModel);
    }, ACP_NATIVE_REASONING_DISCOVERY_TIMEOUT_MS);
  });

  try {
    return await Promise.race([
      (async () => {
        for (const model of modelOptions) {
          const configState = await args.connection.request({
            method: "session/set_config_option",
            params: {
              sessionId: args.sessionId,
              configId: modelOption.id,
              value: model.value,
            },
            resultSchema: acpConfigStateResultSchema,
          });
          supportByModel.set(
            model.value,
            buildAcpNativeReasoningSupport(
              findAcpThoughtLevelConfigOption(configState.configOptions),
            ),
          );
        }
        return supportByModel;
      })(),
      timeoutReached,
    ]);
  } catch {
    return supportByModel.size > 0 ? supportByModel : null;
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

function isMissingExecutableError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    error.code === "ENOENT" &&
    "syscall" in error &&
    typeof error.syscall === "string" &&
    error.syscall.startsWith("spawn")
  );
}

class AcpModelListAuthRequiredError extends Error {
  readonly code = "auth_required";

  constructor() {
    super(AUTH_REQUIRED_MODEL_LIST_ERROR_MESSAGE);
    this.name = "AcpModelListAuthRequiredError";
  }
}

function isAuthRequiredModelListError(
  error: unknown,
  stdout: string,
  stderr: string,
): boolean {
  const text = [
    error instanceof Error ? error.message : String(error),
    stdout,
    stderr,
  ].join("\n");
  return (
    text.includes("Authentication required") &&
    (text.includes("agent login") ||
      text.includes("CURSOR_API_KEY") ||
      text.includes("CURSOR_AUTH_TOKEN") ||
      text.includes("auth token") ||
      text.includes("api key") ||
      text.includes("login"))
  );
}

/**
 * Resolve the session's model pin to the exact raw agent id and compose global
 * launch args before the ACP subcommand. CLI model selection still resolves
 * reasoning by model-id variant; agents such as Grok can additionally receive
 * reasoning as a separate global flag (`grok --reasoning-effort high agent
 * stdio`).
 */
async function resolveAgentLaunchArgs(
  params: AcpBridgeThreadStartParams,
): Promise<{ args: string[]; warning: string | undefined }> {
  const selection = params.modelSelection;
  const agentArgs = applyPermissionCliArgs(
    params.agent.args,
    params.permissionCli,
    params.permissionMode,
  );
  const prefixArgs: string[] = [];
  let warning: string | undefined;

  if (selection && "selectFlag" in selection) {
    let resolved: string | undefined;
    const variantReasoningLevel =
      params.reasoningCli === undefined ? selection.reasoningLevel : undefined;
    // Resolve whenever the selection narrows the raw id: an explicit reasoning
    // effort, or Fast mode (which picks the model's `-fast` twin).
    if (
      variantReasoningLevel !== undefined ||
      selection.serviceTier === "fast"
    ) {
      // Prefer the catalog cached by the last model/list (the picker the
      // selection came from) over re-running the list command per spawn.
      const key = JSON.stringify(selection.listCommand);
      const catalog =
        cachedModelCatalog?.key === key
          ? cachedModelCatalog.catalog
          : await loadAgentModelCatalog(selection.listCommand);
      resolved = catalog?.resolveVariant({
        model: selection.model,
        reasoningLevel: variantReasoningLevel,
        serviceTier: selection.serviceTier,
      });
      if (resolved === undefined && variantReasoningLevel !== undefined) {
        warning = `Model "${selection.model}" has no ${variantReasoningLevel} reasoning variant; launching it at its default effort.`;
      }
    }
    prefixArgs.push(selection.selectFlag, resolved ?? selection.model);
  }

  if (
    params.reasoningCli !== undefined &&
    params.launchReasoningLevel !== undefined
  ) {
    const reasoningValue = resolveReasoningCliValue({
      reasoningCli: params.reasoningCli,
      reasoningLevel: params.launchReasoningLevel,
    });
    if (reasoningValue !== undefined) {
      prefixArgs.push(params.reasoningCli.flag, reasoningValue);
    } else if (warning === undefined) {
      warning = `Reasoning level "${params.launchReasoningLevel}" is not supported by this ACP agent's launch flag; launching it at its default effort.`;
    }
  }

  return {
    args: [...prefixArgs, ...agentArgs],
    warning,
  };
}

async function selectAcpNativeModel(args: {
  connection: AcpAgentConnection;
  sessionId: string;
  configOptions: readonly AcpConfigOption[] | undefined;
  models: AcpSessionModels | undefined;
  modelSelection: AcpBridgeThreadStartParams["modelSelection"];
  nativeReasoning: AcpBridgeNativeReasoning | undefined;
}): Promise<void> {
  const selection = args.modelSelection;
  if (!selection || !("modelId" in selection)) {
    return;
  }
  let configOptions = args.configOptions;
  const modelOption = findAcpModelConfigOption(args.configOptions);
  const availableSessionModels = args.models?.availableModels ?? [];
  const sessionModelsIncludeSelection = availableSessionModels.some(
    (model) => model.modelId === selection.modelId,
  );
  const shouldSetModel =
    (modelOption && modelOption.currentValue !== selection.modelId) ||
    (!modelOption &&
      sessionModelsIncludeSelection &&
      args.models?.currentModelId !== selection.modelId);
  if (shouldSetModel) {
    // Agents that surface a "model" config option (e.g. omp) pin the model via
    // the standard session/set_config_option and may not implement the legacy
    // session/set_model method, while agents that only report session models
    // state (e.g. opencode) support only session/set_model. Prefer the config
    // option when the agent advertises one and fall back to set_model so
    // option-advertising agents that only implement the legacy method keep
    // working.
    let configState: AcpConfigStateResult | null = null;
    let setModel = true;
    if (modelOption) {
      try {
        configState = await args.connection.request({
          method: "session/set_config_option",
          params: {
            sessionId: args.sessionId,
            configId: modelOption.id,
            value: selection.modelId,
          },
          resultSchema: z.union([acpConfigStateResultSchema, z.null()]),
        });
        setModel = false;
      } catch {
        setModel = true;
      }
    }
    if (setModel) {
      configState = await args.connection.request({
        method: "session/set_model",
        params: { sessionId: args.sessionId, modelId: selection.modelId },
        resultSchema: z.union([acpConfigStateResultSchema, z.null()]),
      });
    }
    configOptions = configState?.configOptions ?? configOptions;
  }
  await selectAcpNativeReasoning({
    connection: args.connection,
    sessionId: args.sessionId,
    configOptions,
    modelSelection: selection,
    nativeReasoning: args.nativeReasoning,
  });
}

async function selectAcpNativeReasoning(args: {
  connection: AcpAgentConnection;
  sessionId: string;
  configOptions: readonly AcpConfigOption[] | undefined;
  modelSelection: Extract<
    AcpBridgeThreadStartParams["modelSelection"],
    { modelId: string }
  >;
  nativeReasoning: AcpBridgeNativeReasoning | undefined;
}): Promise<void> {
  const reasoningLevel = args.modelSelection.reasoningLevel;
  if (reasoningLevel === undefined) {
    return;
  }
  const thoughtLevelOption =
    findAcpThoughtLevelConfigOption(args.configOptions) ??
    nativeReasoningToThoughtLevelOption(args.nativeReasoning);
  if (!thoughtLevelOption) {
    return;
  }
  const value = acpNativeReasoningLevelToValue(
    reasoningLevel,
    thoughtLevelOption,
  );
  if (value === undefined) {
    return;
  }
  try {
    await args.connection.request({
      method: "session/set_config_option",
      params: {
        sessionId: args.sessionId,
        configId: thoughtLevelOption.id,
        value,
      },
      resultSchema: acpConfigStateResultSchema,
    });
  } catch {
    // Unsupported or stale thought levels should leave the agent default intact.
  }
}

// ---------------------------------------------------------------------------
// Prompt content
// ---------------------------------------------------------------------------

function buildPromptContentBlocks(
  session: AcpThreadSession,
  input: PromptInput[],
): AcpContentBlock[] {
  const blocks: AcpContentBlock[] = [];

  const instructions = session.pendingInstructions;
  if (instructions) {
    session.pendingInstructions = undefined;
    blocks.push({
      type: "text",
      text: `<system_instructions>\n${instructions}\n</system_instructions>`,
    });
  }

  for (const item of input) {
    switch (item.type) {
      case "text":
        blocks.push({ type: "text", text: item.text });
        break;
      case "image":
        blocks.push({ type: "text", text: `[image attachment: ${item.url}]` });
        break;
      case "localImage": {
        if (!session.supportsImageInput) {
          blocks.push({
            type: "text",
            text: `[image attachment on disk: ${item.path}]`,
          });
          break;
        }
        try {
          const data = readFileSync(item.path).toString("base64");
          blocks.push({
            type: "image",
            data,
            mimeType: mimeTypeFromExtension(item.path),
          });
        } catch {
          blocks.push({
            type: "text",
            text: `[unreadable image attachment: ${item.path}]`,
          });
        }
        break;
      }
      case "localFile":
        blocks.push({
          type: "resource_link",
          uri: `file://${item.path}`,
          name: item.name ?? basename(item.path),
        });
        break;
    }
  }

  return blocks;
}

// ---------------------------------------------------------------------------
// Permission policy
// ---------------------------------------------------------------------------

function findOptionIdByKinds(
  options: AcpPermissionOption[],
  kinds: AcpPermissionOption["kind"][],
): string | undefined {
  for (const kind of kinds) {
    const option = options.find((candidate) => candidate.kind === kind);
    if (option) return option.optionId;
  }
  return undefined;
}

function pickPermissionOptionId(
  options: AcpPermissionOption[],
  decision: "allow_once" | "allow_for_session" | "deny",
): string | undefined {
  switch (decision) {
    case "allow_once":
      return findOptionIdByKinds(options, ["allow_once", "allow_always"]);
    case "allow_for_session":
      return findOptionIdByKinds(options, ["allow_always", "allow_once"]);
    case "deny":
      return findOptionIdByKinds(options, ["reject_once", "reject_always"]);
  }
}

function respondPermission(
  pending: PendingAcpPermission,
  decision: "allow_once" | "allow_for_session" | "deny" | null,
): void {
  const optionId =
    decision === null
      ? undefined
      : pickPermissionOptionId(pending.options, decision);
  pending.responder.result(
    optionId === undefined
      ? { outcome: { outcome: "cancelled" } }
      : { outcome: { outcome: "selected", optionId } },
  );
}

function cancelPendingPermissions(session: AcpThreadSession): void {
  for (const pending of session.pendingPermissions) {
    respondPermission(pending, null);
  }
  session.pendingPermissions.clear();
}

const acpRawInputCommandSchema = z
  .object({ command: z.string() })
  .passthrough();

function handlePermissionRequest(
  session: AcpThreadSession,
  params: unknown,
  responder: AcpAgentRequestResponder,
): void {
  const parsed = acpRequestPermissionParamsSchema.safeParse(params);
  if (!parsed.success) {
    responder.error(-32602, "Invalid session/request_permission params");
    return;
  }
  const turnId = session.activeTurnId;
  if (
    session.stopping ||
    session.activePromptKind !== "turn" ||
    turnId === null
  ) {
    responder.result({ outcome: { outcome: "cancelled" } });
    return;
  }

  const pending: PendingAcpPermission = {
    responder,
    options: parsed.data.options,
  };
  if (session.policy.permissionMode === "full") {
    respondPermission(pending, "allow_once");
    return;
  }
  session.pendingPermissions.add(pending);

  const toolCall = parsed.data.toolCall;
  const rawInputCommand = acpRawInputCommandSchema.safeParse(
    toolCall?.rawInput,
  );
  const command = buildOpaqueAcpPermissionCommand({
    ...(rawInputCommand.success
      ? { command: rawInputCommand.data.command }
      : {}),
    ...(toolCall?.title ? { title: toolCall.title } : {}),
    ...(toolCall?.kind ? { kind: toolCall.kind } : {}),
  });
  void session.context.host
    .requestInteraction({
      attachmentId: session.attachmentId,
      turnId,
      requestId: toolCall?.toolCallId || `acp-permission-${Date.now()}`,
      payload: {
        kind: "approval",
        subject: {
          kind: "command",
          itemId: toolCall?.toolCallId ?? "acp-permission",
          command,
          cwd: null,
          actions: [{ type: "unknown", command }],
          sessionGrant: null,
        },
        reason: null,
        availableDecisions: buildAcpApprovalDecisions(parsed.data.options),
      },
    })
    .then(({ resolution }) => {
      if (!session.pendingPermissions.delete(pending)) return;
      respondPermission(
        pending,
        isApprovalPendingInteractionResolution(resolution)
          ? resolution.decision
          : null,
      );
    })
    .catch(() => {
      if (!session.pendingPermissions.delete(pending)) return;
      respondPermission(pending, null);
    });
}

// ---------------------------------------------------------------------------
// Client fs methods
// ---------------------------------------------------------------------------

function isPathInsideRoots(targetPath: string, roots: string[]): boolean {
  const resolvedTarget = resolve(targetPath);
  return roots.some((root) => {
    const relativePath = relative(resolve(root), resolvedTarget);
    return (
      relativePath === "" ||
      (!relativePath.startsWith("..") && !isAbsolute(relativePath))
    );
  });
}

function sliceFileContent(
  content: string,
  line: number | null | undefined,
  limit: number | null | undefined,
): string {
  if (line == null && limit == null) return content;
  const lines = content.split("\n");
  const startIndex = line == null ? 0 : Math.max(0, line - 1);
  const endIndex = limit == null ? lines.length : startIndex + limit;
  return lines.slice(startIndex, endIndex).join("\n");
}

async function handleFsReadTextFile(
  params: unknown,
  responder: AcpAgentRequestResponder,
): Promise<void> {
  const parsed = acpReadTextFileParamsSchema.safeParse(params);
  if (!parsed.success) {
    responder.error(-32602, "Invalid fs/read_text_file params");
    return;
  }
  try {
    const content = await fs.readFile(parsed.data.path, "utf8");
    responder.result({
      content: sliceFileContent(content, parsed.data.line, parsed.data.limit),
    });
  } catch (error) {
    responder.error(
      -32603,
      error instanceof Error ? error.message : String(error),
    );
  }
}

async function handleFsWriteTextFile(
  session: AcpThreadSession,
  params: unknown,
  responder: AcpAgentRequestResponder,
): Promise<void> {
  const parsed = acpWriteTextFileParamsSchema.safeParse(params);
  if (!parsed.success) {
    responder.error(-32602, "Invalid fs/write_text_file params");
    return;
  }
  if (
    session.policy.permissionMode === "accept-edits" &&
    !isPathInsideRoots(parsed.data.path, session.policy.workspaceWriteRoots)
  ) {
    responder.error(
      -32000,
      `File writes outside the workspace are denied by BB's accept-edits permission mode: ${parsed.data.path}`,
    );
    return;
  }
  try {
    let oldText: string | undefined;
    try {
      oldText = await fs.readFile(parsed.data.path, "utf8");
    } catch {
      oldText = undefined;
    }
    await fs.mkdir(dirname(parsed.data.path), { recursive: true });
    await fs.writeFile(parsed.data.path, parsed.data.content, "utf8");
    const diff = buildEditDiff(parsed.data.path, oldText, parsed.data.content);
    session.translator.translateFsWrite({
      path: parsed.data.path,
      kind: oldText === undefined ? "add" : "update",
      ...(diff ? { diff } : {}),
    });
    responder.result(null);
  } catch (error) {
    responder.error(
      -32603,
      error instanceof Error ? error.message : String(error),
    );
  }
}

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

function removeSession(session: AcpThreadSession): void {
  if (sessionsByAttachmentId.get(session.attachmentId) === session) {
    sessionsByAttachmentId.delete(session.attachmentId);
  }
  if (sessionsByProviderThreadId.get(session.providerThreadId) === session) {
    sessionsByProviderThreadId.delete(session.providerThreadId);
  }
}

function buildSessionParams(
  params: ProviderSessionOpenParams,
  profile: HostDaemonAcpLaunchSpec,
): AcpBridgeThreadStartParams {
  if (params.execution.permission.permissionMode === "auto") {
    rejectRequest({
      code: "acp_permission_mode_unsupported",
      category: "configuration",
      message: `Provider "${profile.displayName}" does not support permission mode "auto".`,
    });
  }
  if (params.mode.kind === "fork") {
    rejectRequest({
      code: "acp_fork_unsupported",
      category: "configuration",
      message: "ACP does not support session forks",
    });
  }
  if (params.outputSchema !== null || params.disallowedTools.length > 0) {
    rejectRequest({
      code: "acp_session_options_unsupported",
      category: "configuration",
      message: "ACP does not support structured output or disallowed tools",
    });
  }
  acpDriverProviderOptionsSchema.parse(params.execution.providerOptions);
  const baseInstructions = params.instructions.text.trim();
  const skillsInstructions = buildAcpSkillsInstructions(params.skillSources);
  const instructions = [baseInstructions, skillsInstructions]
    .filter((value) => value.length > 0)
    .join("\n\n");
  const cwd = profile.cwd ?? params.workspace.cwd;
  const modelSelection = buildModelSelection({
    model: params.execution.model,
    nativeReasoning: profile.nativeReasoning,
    modelCli: profile.modelCli,
    reasoningLevel: params.execution.reasoningLevel,
    serviceTier: params.execution.serviceTier,
    command: profile.command,
    cwd: profile.cwd,
    env: profile.env,
  });
  return {
    threadId: params.attachmentId,
    cwd,
    agent: { command: profile.command, args: [...profile.args] },
    ...(modelSelection ? { modelSelection } : {}),
    ...(profile.reasoningCli ? { reasoningCli: profile.reasoningCli } : {}),
    ...(profile.nativeReasoning
      ? { nativeReasoning: profile.nativeReasoning }
      : {}),
    ...(profile.permissionCli ? { permissionCli: profile.permissionCli } : {}),
    ...(profile.reasoningCli
      ? { launchReasoningLevel: params.execution.reasoningLevel }
      : {}),
    permissionMode: params.execution.permission.permissionMode,
    permissionEscalation: params.execution.permission.permissionEscalation,
    workspaceWriteRoots: [cwd, ...params.workspace.additionalWriteRoots],
    envVars: { ...profile.env, ...params.shellEnvironment },
    ...(instructions ? { instructions } : {}),
    ...(params.dynamicTools.length > 0
      ? { dynamicTools: params.dynamicTools }
      : {}),
  };
}

function buildAcpSkillsInstructions(
  skillSources: ProviderSessionOpenParams["skillSources"],
): string {
  const lines = skillSources.flatMap((source) =>
    source.skills.map((skill) => {
      const description = (skill.description ?? "(description unavailable)")
        .replace(/[\r\n]+/gu, " ")
        .replace(/\s+/gu, " ")
        .replace(/[<>]/gu, "")
        .trim();
      return `- ${skill.name}: ${description || "(description unavailable)"} (SKILL.md: ${resolve(source.rootPath, skill.name, "SKILL.md")})`;
    }),
  );
  return lines.length === 0
    ? ""
    : [
        "bb skills are reusable instruction folders. When the current task matches a listed skill description, read that skill's SKILL.md at the absolute path before proceeding; you may read supporting files in the same skill directory that SKILL.md references. If a listed path does not exist, the list is stale and should be ignored.",
        "",
        "Available bb skills:",
        ...lines,
      ].join("\n");
}

function buildModelSelection(args: {
  command: string;
  cwd?: string;
  env: Record<string, string>;
  model: string;
  modelCli?: NonNullable<HostDaemonAcpLaunchSpec["modelCli"]>;
  nativeReasoning?: HostDaemonAcpLaunchSpec["nativeReasoning"];
  reasoningLevel: ReasoningLevel;
  serviceTier: ProviderSessionOpenParams["execution"]["serviceTier"];
}): AcpBridgeThreadStartParams["modelSelection"] {
  if (args.model === ACP_DEFAULT_MODEL_ID) return undefined;
  if (args.modelCli?.selectFlag) {
    return {
      listCommand: {
        command: args.command,
        args: [...args.modelCli.listArgs],
        ...(args.cwd ? { cwd: args.cwd } : {}),
        ...(Object.keys(args.env).length > 0 ? { envVars: args.env } : {}),
      },
      selectFlag: args.modelCli.selectFlag,
      model: args.model,
      reasoningLevel: args.reasoningLevel,
      ...(args.serviceTier === "fast" ? { serviceTier: "fast" } : {}),
    };
  }
  return { modelId: args.model, reasoningLevel: args.reasoningLevel };
}

async function startAgentSession(args: {
  context: ProviderDriverContext;
  params: ProviderSessionOpenParams;
  profile: HostDaemonAcpLaunchSpec;
}): Promise<AcpThreadSession> {
  const params = buildSessionParams(args.params, args.profile);
  const launch = await resolveAgentLaunchArgs(params);
  const agentLabel = [params.agent.command, ...params.agent.args].join(" ");
  let session: AcpThreadSession;
  const childEnv = {
    ...withoutBridgeRuntimeEnv(process.env),
    ...params.envVars,
  };
  const connection = createAcpAgentConnection({
    command: params.agent.command,
    args: launch.args,
    cwd: params.cwd,
    env: childEnv,
    onNotification: (method, notificationParams) =>
      handleAgentNotification(session, method, notificationParams),
    onRequest: (method, requestParams, responder) =>
      handleAgentRequest(session, method, requestParams, responder),
    onExit: (info) => {
      const wasCurrent =
        sessionsByAttachmentId.get(args.params.attachmentId) === session;
      cancelPendingPermissions(session);
      removeSession(session);
      if (!wasCurrent || session.stopping) return;
      session.translator.failActiveTurn(
        `ACP agent "${agentLabel}" exited unexpectedly` +
          `${info.code !== null ? ` (code ${info.code})` : ""}` +
          `${info.stderrTail ? `: ${info.stderrTail}` : ""}`,
      );
    },
  });
  const translator = new AcpCanonicalEventTranslator({
    attachmentId: args.params.attachmentId,
    events: args.context.events,
  });
  session = {
    activePromptKind: null,
    activeTurnId: null,
    agentLabel,
    attachmentId: args.params.attachmentId,
    connection,
    context: args.context,
    cwd: params.cwd,
    loading: false,
    loadingSessionId: undefined,
    pendingInstructions: params.instructions,
    pendingLoadUsageUpdate: undefined,
    pendingPermissions: new Set(),
    policy: {
      permissionMode: params.permissionMode,
      permissionEscalation: params.permissionEscalation,
      workspaceWriteRoots: params.workspaceWriteRoots,
    },
    providerThreadId: "",
    queuedInputs: [],
    stopping: false,
    supportsImageInput: false,
    translator,
    turnSettled: undefined,
  };
  if (launch.warning) translator.warning("acp_launch_warning", launch.warning);

  try {
    const initializeResult = await connection.request({
      method: "initialize",
      params: {
        protocolVersion: ACP_PROTOCOL_VERSION,
        clientInfo: { name: "bb", version: "1.0.0" },
        clientCapabilities: {
          fs: { readTextFile: true, writeTextFile: true },
          terminal: false,
        },
      },
      resultSchema: acpInitializeResultSchema,
    });
    await authenticateAcpAgent({
      connection,
      env: childEnv,
      initializeResult,
    });
    session.supportsImageInput =
      initializeResult.agentCapabilities?.promptCapabilities?.image ?? false;
    const supportsLoadSession =
      initializeResult.agentCapabilities?.loadSession ?? false;
    const mcpServers = await buildSessionMcpServers(params);

    let sessionId: string | undefined;
    let loadedConfigOptions: readonly AcpConfigOption[] | undefined;
    let loadedModels: AcpSessionModels | undefined;
    if (args.params.mode.kind === "resume" && supportsLoadSession) {
      session.loading = true;
      session.loadingSessionId = args.params.mode.providerSessionId;
      try {
        const configState = await connection.request({
          method: "session/load",
          params: {
            sessionId: args.params.mode.providerSessionId,
            cwd: params.cwd,
            mcpServers,
          },
          resultSchema: z.union([acpConfigStateResultSchema, z.null()]),
        });
        loadedConfigOptions = configState?.configOptions;
        loadedModels = configState?.models;
        sessionId = args.params.mode.providerSessionId;
      } catch {
        session.loading = false;
        session.loadingSessionId = undefined;
        session.pendingLoadUsageUpdate = undefined;
      }
    }

    if (sessionId === undefined) {
      session.loading = false;
      session.loadingSessionId = undefined;
      session.pendingLoadUsageUpdate = undefined;
      const newSession = await connection.request({
        method: "session/new",
        params: { cwd: params.cwd, mcpServers },
        resultSchema: acpSessionNewResultSchema,
      });
      sessionId = newSession.sessionId;
      await selectAcpNativeModel({
        connection,
        sessionId,
        configOptions: newSession.configOptions,
        models: newSession.models,
        modelSelection: params.modelSelection,
        nativeReasoning: params.nativeReasoning,
      });
      if (args.params.mode.kind === "resume") {
        translator.warning(
          "acp_resume_fallback",
          `${agentLabel} could not restore the previous session; continuing in a fresh session without in-agent history.`,
        );
      }
    } else {
      await selectAcpNativeModel({
        connection,
        sessionId,
        configOptions: loadedConfigOptions,
        models: loadedModels,
        modelSelection: params.modelSelection,
        nativeReasoning: params.nativeReasoning,
      });
      const loadUsageUpdate = session.pendingLoadUsageUpdate;
      session.loading = false;
      session.loadingSessionId = undefined;
      session.pendingLoadUsageUpdate = undefined;
      if (loadUsageUpdate) translator.translateUpdate(loadUsageUpdate);
    }

    session.providerThreadId = sessionId;
    sessionsByAttachmentId.set(session.attachmentId, session);
    sessionsByProviderThreadId.set(sessionId, session);
    return session;
  } catch (error) {
    session.stopping = true;
    connection.kill();
    removeSession(session);
    throw error;
  }
}

async function stopSession(session: AcpThreadSession): Promise<void> {
  if (session.stopping) return;
  session.stopping = true;
  session.queuedInputs = [];
  cancelPendingPermissions(session);
  if (session.activePromptKind !== null && !session.connection.exited) {
    session.connection.notify("session/cancel", {
      sessionId: session.providerThreadId,
    });
    if (session.turnSettled) {
      await Promise.race([
        session.turnSettled,
        new Promise<void>((resolveTimeout) =>
          setTimeout(resolveTimeout, THREAD_STOP_CANCEL_TIMEOUT_MS),
        ),
      ]);
    }
  }
  session.connection.kill();
  removeSession(session);
}

function runTurn(session: AcpThreadSession, firstInput: PromptInput[]): void {
  session.activePromptKind = "turn";
  session.turnSettled = (async () => {
    let input = firstInput;
    for (;;) {
      let stopReason: z.infer<typeof acpStopReasonSchema>;
      try {
        const result = await session.connection.request({
          method: "session/prompt",
          params: {
            sessionId: session.providerThreadId,
            prompt: buildPromptContentBlocks(session, input),
          },
          resultSchema: acpPromptResultSchema,
        });
        stopReason = result.stopReason;
      } catch (error) {
        session.activePromptKind = null;
        session.queuedInputs = [];
        if (!session.stopping && !session.connection.exited) {
          session.translator.failActiveTurn(
            error instanceof Error ? error.message : String(error),
          );
        }
        return;
      }
      if (stopReason !== "cancelled" && !session.stopping) {
        const next = session.queuedInputs.shift();
        if (next) {
          input = next;
          continue;
        }
      }
      session.activePromptKind = null;
      session.queuedInputs = [];
      session.translator.finishTurn(stopReason);
      session.activeTurnId = null;
      return;
    }
  })().finally(() => {
    session.turnSettled = undefined;
  });
}

function startCompaction(session: AcpThreadSession, turnId: string): void {
  if (session.activePromptKind !== null) {
    throw new Error("Cannot compact context while an ACP turn is active");
  }
  session.activePromptKind = "compaction";
  session.activeTurnId = turnId;
  session.translator.beginCompaction(turnId);
  session.turnSettled = session.connection
    .request({
      method: "session/prompt",
      params: {
        sessionId: session.providerThreadId,
        prompt: [{ type: "text", text: "/compact" }],
      },
      resultSchema: acpPromptResultSchema,
    })
    .then((result) => {
      session.translator.finishCompaction(
        result.stopReason === "end_turn"
          ? { status: "completed" }
          : result.stopReason === "cancelled"
            ? { status: "interrupted" }
            : {
                status: "failed",
                error: `Agent stopped compaction: ${result.stopReason}`,
              },
      );
    })
    .catch((error: unknown) => {
      session.translator.finishCompaction({
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
    })
    .finally(() => {
      session.activePromptKind = null;
      session.activeTurnId = null;
      session.turnSettled = undefined;
    });
}

function handleAgentRequest(
  session: AcpThreadSession,
  method: string,
  params: unknown,
  responder: AcpAgentRequestResponder,
): void {
  switch (method) {
    case "session/request_permission":
      handlePermissionRequest(session, params, responder);
      return;
    case "fs/read_text_file":
      void handleFsReadTextFile(params, responder);
      return;
    case "fs/write_text_file":
      void handleFsWriteTextFile(session, params, responder);
      return;
    default:
      responder.error(-32601, `Unsupported ACP client method "${method}"`);
  }
}

function handleAgentNotification(
  session: AcpThreadSession,
  method: string,
  params: unknown,
): void {
  if (method !== "session/update" || session.stopping) return;
  const parsed = acpSessionNotificationParamsSchema.safeParse(params);
  if (!parsed.success) return;
  if (session.loading) {
    if (
      parsed.data.sessionId === session.loadingSessionId &&
      parsed.data.update.sessionUpdate === "usage_update"
    ) {
      const usageUpdate = acpUsageUpdateSchema.safeParse(parsed.data.update);
      if (usageUpdate.success)
        session.pendingLoadUsageUpdate = usageUpdate.data;
    }
    return;
  }
  if (
    session.providerThreadId !== "" &&
    parsed.data.sessionId !== session.providerThreadId
  ) {
    return;
  }
  session.translator.translateUpdate(parsed.data.update);
}

const acpDriverProviderOptionsSchema = z.object({}).strict();

function profileFromInitialization(
  context: ProviderDriverContext,
): HostDaemonAcpLaunchSpec {
  const parsed = hostDaemonAcpLaunchSpecSchema.parse(
    context.initialization.config,
  );
  return normalizeHostDaemonAcpLaunchSpec(parsed);
}

async function listModelsForProfile(profile: HostDaemonAcpLaunchSpec) {
  const listCommand =
    profile.modelCli && profile.modelCli.listArgs.length > 0
      ? {
          command: profile.command,
          args: [...profile.modelCli.listArgs],
          ...(profile.cwd ? { cwd: profile.cwd } : {}),
          ...(Object.keys(profile.env).length > 0
            ? { envVars: profile.env }
            : {}),
        }
      : undefined;
  const catalog = listCommand ? await loadAgentModelCatalog(listCommand) : null;
  if (catalog) {
    return splitPrimaryModels(
      applyConfiguredReasoningToModels(catalog.models, {
        reasoningCli: profile.reasoningCli,
        nativeReasoning: profile.nativeReasoning,
      }),
      profile.modelCli?.primaryModels ?? [],
    );
  }
  const discovered =
    listCommand === undefined
      ? await loadSessionDiscoveredModels({
          command: profile.command,
          args: [...profile.args],
          ...(profile.cwd ? { cwd: profile.cwd } : {}),
          ...(Object.keys(profile.env).length > 0
            ? { envVars: profile.env }
            : {}),
        })
      : null;
  if (discovered) {
    return {
      models: applyConfiguredReasoningToModels(discovered, {
        reasoningCli: profile.reasoningCli,
        nativeReasoning: profile.nativeReasoning,
      }),
      selectedOnlyModels: [],
    };
  }
  return {
    models: [
      applyConfiguredReasoningToModel(ACP_DEFAULT_MODEL, {
        reasoningCli: profile.reasoningCli,
        nativeReasoning: profile.nativeReasoning,
      }),
    ],
    selectedOnlyModels: [],
  };
}

export const acpProviderDriver = defineProviderDriver({
  identity: {
    pluginId: "acp",
    driverId: "acp",
    providerId: "acp",
  },
  processCapabilities: { multiplexSessions: true },

  async inspect(_params, context) {
    const profile = profileFromInitialization(context);
    try {
      const models = await listModelsForProfile(profile);
      return {
        readiness: { status: "ready" },
        capabilities: {
          multiplexSessions: true,
          supportedSessionOperations: [],
          supportedPermissionModes: ["accept-edits", "full"],
          supportsServiceTier: true,
          supportsSteering: true,
          supportsUserQuestions: false,
        },
        ...models,
        diagnostics: [],
      };
    } catch (error) {
      return {
        readiness: {
          status: "missing_dependency",
          reason: error instanceof Error ? error.message : String(error),
        },
        capabilities: {
          multiplexSessions: true,
          supportedSessionOperations: [],
          supportedPermissionModes: ["accept-edits", "full"],
          supportsServiceTier: true,
          supportsSteering: true,
          supportsUserQuestions: false,
        },
        models: [ACP_DEFAULT_MODEL],
        selectedOnlyModels: [],
        diagnostics: [],
      };
    }
  },

  async openSession(params, context) {
    const profile = profileFromInitialization(context);
    const session = await startAgentSession({ context, params, profile });
    return {
      providerSessionId: session.providerThreadId,
      sessionFormatVersion: String(ACP_PROTOCOL_VERSION),
    };
  },

  async detachSession(params) {
    const session = requireSession(params.attachmentId);
    await stopSession(session);
    return { providerCheckpointId: null };
  },

  async discardSession(params) {
    const session = sessionsByAttachmentId.get(params.attachmentId);
    if (session) await stopSession(session);
  },

  async submitTurn(params: ProviderTurnSubmitParams) {
    const session = requireSession(params.attachmentId);
    if (params.mode === "steer") {
      if (
        session.activePromptKind !== "turn" ||
        session.activeTurnId !== params.expectedTurnId
      ) {
        return { outcome: "stale", activeTurnId: session.activeTurnId };
      }
      session.queuedInputs.push(
        flattenPromptInputGroups([], params.inputGroups),
      );
      return {
        outcome: "accepted",
        disposition: "steered",
        turnId: params.expectedTurnId,
        providerTurnId: null,
      };
    }
    if (session.activePromptKind !== null) {
      return {
        outcome: "rejected",
        error: driverError({
          code: "acp_turn_active",
          category: "provider",
          message: "An ACP turn is already active",
        }),
      };
    }
    const input = flattenPromptInputGroups([], params.inputGroups);
    if (
      isStandaloneBuiltinCompactCommand(input) &&
      profileFromInitialization(session.context).command.includes("opencode")
    ) {
      startCompaction(session, params.turnId);
    } else {
      session.activeTurnId = params.turnId;
      session.translator.beginTurn(params.turnId);
      runTurn(session, input);
    }
    return {
      outcome: "accepted",
      disposition: "started",
      turnId: params.turnId,
      providerTurnId: null,
    };
  },

  async cancelTurn(params) {
    const session = requireSession(params.attachmentId);
    if (session.activeTurnId !== params.turnId) {
      return { outcome: "not_active" };
    }
    session.connection.notify("session/cancel", {
      sessionId: session.providerThreadId,
    });
    cancelPendingPermissions(session);
    return { outcome: "cancellation_requested" };
  },

  async shutdown() {
    await Promise.all([...sessionsByAttachmentId.values()].map(stopSession));
    const dynamicToolBridge = dynamicToolBridgePromise
      ? await dynamicToolBridgePromise.catch(() => null)
      : null;
    await new Promise<void>((resolveClose) => {
      if (!dynamicToolBridge) {
        resolveClose();
        return;
      }
      dynamicToolBridge.server.close(() => resolveClose());
    });
  },
});

export function isAcpMcpStdioProcess(): boolean {
  return process.argv.includes("--mcp-stdio");
}

export function runAcpMcpStdioProcess(): void {
  runAcpDynamicToolMcpServer();
}
