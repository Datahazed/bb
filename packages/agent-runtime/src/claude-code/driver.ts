/** Canonical Claude Code provider driver. */

import { randomUUID } from "node:crypto";
import { resolve as resolvePath } from "node:path";
import {
  DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_CONFIG,
  DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_ENDPOINT,
  jsonObjectSchema,
  removeCommandMentionsFromPromptInput,
  type PendingInteractionGrantedPermissionProfile,
  type PromptInput,
  type PermissionEscalation,
  type ReasoningLevel,
} from "@bb/domain";
import {
  forkSession,
  type CanUseTool,
  type HookCallback,
  type PermissionResult,
  type SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
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
import { extractEnvOverrides } from "../shared/adapter-utils.js";
import { withoutBridgeRuntimeEnv } from "../shared/bridge-runtime-env.js";
import { shouldAutoDenyInteractiveRequest } from "../shared/permission-policy.js";
import { SdkSession, type SdkSessionOptions } from "./sdk-session.js";
import { listClaudeCodeDriverModels } from "./driver-model-list.js";
import { ClaudeCanonicalEventTranslator } from "./canonical-event-translator.js";
import {
  buildReadonlyDenialMessage,
  buildMutableFlagSettings,
  buildSessionOptions,
  buildWorkspaceWriteDenialMessage,
  toSdkEffort,
  type BuildSessionOptionsArgs,
  type PermissionEscalationWorkContext,
} from "./session-options.js";
import {
  startClaudeCodeMockCliTrafficProxy,
  type ClaudeCodeMockCliTrafficProxy,
} from "./mock-cli-traffic-proxy.js";
import { buildReadonlyBashUpdatedInput } from "./readonly-bash-policy.js";
import {
  buildClaudeMcpServer,
  getAllowedToolNames,
  CLAUDE_MCP_SERVER_NAME,
} from "./tool-proxy-mcp.js";
import {
  type ClaudePermissionMode,
  type ClaudeSuggestedPermissionUpdate,
  type ClaudeUserQuestionInput,
  CLAUDE_EXIT_PLAN_MODE_TOOL_NAME,
  CLAUDE_USER_QUESTION_TOOL_NAME,
  buildClaudePlanRejectionMessage,
  buildClaudeSessionPermissionUpdates,
  claudeExitPlanModeInputSchema,
  claudeSuggestedPermissionUpdateSchema,
  claudeUserQuestionInputSchema,
  shouldRequestClaudePermissionApproval,
  toClaudePermissionMode,
  toPendingInteractionPermissionProfile,
} from "./interactive-contract.js";

const CLAUDE_PROVIDER_SUBAGENT_TOOL_NAMES = new Set(["Agent", "Task"]);
const CLAUDE_WORKFLOW_TOOL_NAME = "Workflow";

interface ThreadIdRef {
  current: string;
}

interface CurrentThreadSessionArgs {
  sessionSerial: number;
  threadId: string;
}

interface CreateSdkCallbackArgs {
  sessionSerial: number;
  threadIdRef: ThreadIdRef;
}

interface ClaudeSessionPermissionGrant {
  permissions: PendingInteractionGrantedPermissionProfile;
  toolName: string | null;
}

interface ClaudeSessionPermissionCoverageArgs {
  grants: ClaudeSessionPermissionGrant[];
  permissions: PendingInteractionGrantedPermissionProfile;
  toolName: string;
}

interface ClaudeSessionPermissionGrantCoverageArgs {
  grant: ClaudeSessionPermissionGrant;
  permissions: PendingInteractionGrantedPermissionProfile;
  toolName: string;
}

interface ClaudeLiveSessionSettings {
  memoryEnabled: boolean;
  model: string;
  providerSubagentsEnabled: boolean;
  reasoningLevel: ReasoningLevel;
  workflowsEnabled: boolean;
}

interface SessionConstructionConfig {
  dynamicTools: ProviderSessionOpenParams["dynamicTools"];
  sessionOptions: Omit<
    BuildSessionOptionsArgs,
    | "getPermissionEscalation"
    | "memoryEnabled"
    | "model"
    | "reasoningLevel"
    | "workflowsEnabled"
  >;
}

interface ThreadSession {
  activeTurnId: string | null;
  attachmentId: string;
  context: ProviderDriverContext;
  session: SdkSession;
  sessionConstructionConfig: SessionConstructionConfig;
  sessionOptions: SdkSessionOptions;
  sessionSerial: number;
  closing: boolean;
  streamEnded: boolean;
  mockCliTrafficProxy: ClaudeCodeMockCliTrafficProxy | null;
  permissionEscalation: PermissionEscalation | null;
  permissionEscalationByAgentId: Map<string, PermissionEscalation | null>;
  permissionEscalationByPromptId: Map<string, PermissionEscalation | null>;
  permissionEscalationBySubagentParentToolUseId: Map<
    string,
    PermissionEscalation | null
  >;
  permissionEscalationByToolUseId: Map<string, PermissionEscalation | null>;
  permissionMode: ClaudePermissionMode;
  liveSettings: ClaudeLiveSessionSettings;
  approvedPlanPermissionMode: ClaudePermissionMode;
  providerThreadId: string;
  sessionPermissionGrants: ClaudeSessionPermissionGrant[];
  threadIdRef: ThreadIdRef;
  translator: ClaudeCanonicalEventTranslator;
}

interface PreparedSessionEnv {
  env: NodeJS.ProcessEnv;
  mockCliTrafficProxy: ClaudeCodeMockCliTrafficProxy | null;
}

interface CreateThreadSessionArgs {
  activeTurnId?: string | null;
  attachmentId: string;
  context: ProviderDriverContext;
  liveSettings: ClaudeLiveSessionSettings;
  mockCliTrafficProxy: ClaudeCodeMockCliTrafficProxy | null;
  permissionEscalation: PermissionEscalation | null;
  permissionMode: ClaudePermissionMode;
  approvedPlanPermissionMode: ClaudePermissionMode;
  providerThreadId: string;
  sessionConstructionConfig: SessionConstructionConfig;
  sessionOptions: SdkSessionOptions;
  sessionPermissionGrants?: ClaudeSessionPermissionGrant[];
  threadIdRef: ThreadIdRef;
  translator: ClaudeCanonicalEventTranslator;
}

interface PrepareSessionEnvParams {
  claudeCodeMockCliTraffic: { enabled: boolean; endpoint: string };
  config?: Record<string, unknown>;
  threadId: string;
}

interface ClaudeCanUseToolDecisionContext {
  blockedPath: string | undefined;
  decisionReason: string | undefined;
  suggestions: ClaudeSuggestedPermissionUpdate[] | undefined;
  toolName: string;
}

interface BuildInteractiveRequestParamsArgs {
  providerThreadId: string;
  threadId: string;
  toolName: string;
  toolUseId: string;
  input: Record<string, unknown>;
  decisionReason: string | undefined;
  promptText: string | undefined;
  blockedPath: string | undefined;
  suggestions: ClaudeSuggestedPermissionUpdate[] | undefined;
}

interface ForwardInteractiveRequestArgs extends BuildInteractiveRequestParamsArgs {
  signal: AbortSignal;
}

interface BuildUserQuestionRequestParamsArgs {
  input: ClaudeUserQuestionInput;
  providerThreadId: string;
  threadId: string;
  toolUseId: string;
}

interface ForwardUserQuestionRequestArgs extends BuildUserQuestionRequestParamsArgs {
  signal: AbortSignal;
}

let sessionSerialCounter = 0;
const THREAD_STOP_CLOSE_TIMEOUT_MS = 4_000;
const sessions = new Map<string, ThreadSession>();
const sessionsByAttachmentId = new Map<string, ThreadSession>();

function normalizePermissionPath(path: string): string {
  return resolvePath(path);
}

function permissionPathCovers(
  grantPath: string,
  requestedPath: string,
): boolean {
  const normalizedGrantPath = normalizePermissionPath(grantPath);
  const normalizedRequestedPath = normalizePermissionPath(requestedPath);
  if (normalizedGrantPath === normalizedRequestedPath) {
    return true;
  }
  const grantPrefix = normalizedGrantPath.endsWith("/")
    ? normalizedGrantPath
    : `${normalizedGrantPath}/`;
  return normalizedRequestedPath.startsWith(grantPrefix);
}

function permissionPathListCovers(
  grantedPaths: string[],
  requestedPaths: string[],
): boolean {
  return requestedPaths.every((requestedPath) =>
    grantedPaths.some((grantedPath) =>
      permissionPathCovers(grantedPath, requestedPath),
    ),
  );
}

function fileSystemPermissionsCover(
  granted: PendingInteractionGrantedPermissionProfile["fileSystem"],
  requested: PendingInteractionGrantedPermissionProfile["fileSystem"],
): boolean {
  if (requested === null) {
    return true;
  }
  if (granted === null) {
    return false;
  }
  const grantedReadPaths = [...granted.read, ...granted.write];
  return (
    permissionPathListCovers(grantedReadPaths, requested.read) &&
    permissionPathListCovers(granted.write, requested.write)
  );
}

function networkPermissionsCover(
  granted: PendingInteractionGrantedPermissionProfile["network"],
  requested: PendingInteractionGrantedPermissionProfile["network"],
): boolean {
  return requested?.enabled === true ? granted?.enabled === true : true;
}

function sessionPermissionGrantCovers(
  args: ClaudeSessionPermissionGrantCoverageArgs,
): boolean {
  if (args.grant.toolName !== null && args.grant.toolName !== args.toolName) {
    return false;
  }
  return (
    networkPermissionsCover(
      args.grant.permissions.network,
      args.permissions.network,
    ) &&
    fileSystemPermissionsCover(
      args.grant.permissions.fileSystem,
      args.permissions.fileSystem,
    )
  );
}

function hasClaudeSessionPermissionGrant(
  args: ClaudeSessionPermissionCoverageArgs,
): boolean {
  return args.grants.some((grant) =>
    sessionPermissionGrantCovers({
      grant,
      permissions: args.permissions,
      toolName: args.toolName,
    }),
  );
}

function ignoreInputConsumption(promise: Promise<void>): void {
  void promise.catch(() => {});
}

function pushPromptInput(
  threadSession: ThreadSession,
  input: string,
  permissionEscalation: PermissionEscalation | null,
): Promise<void> {
  const promptId = randomUUID();
  threadSession.permissionEscalationByPromptId.set(
    promptId,
    permissionEscalation,
  );
  return threadSession.session.pushInput(input, promptId).catch((error) => {
    threadSession.permissionEscalationByPromptId.delete(promptId);
    throw error;
  });
}

function queuePromptInputs(
  threadSession: ThreadSession,
  inputs: readonly string[],
  permissionEscalation: PermissionEscalation | null,
): boolean {
  if (!threadSession.session.canPushInput()) {
    return false;
  }
  for (const input of inputs) {
    ignoreInputConsumption(
      pushPromptInput(threadSession, input, permissionEscalation),
    );
  }
  return true;
}

async function applyLiveSessionSettings(
  threadSession: ThreadSession,
  next: ClaudeLiveSessionSettings,
): Promise<void> {
  const current = threadSession.liveSettings;
  if (current.model !== next.model) {
    await threadSession.session.setModel(next.model);
  }

  if (
    current.memoryEnabled !== next.memoryEnabled ||
    current.reasoningLevel !== next.reasoningLevel ||
    current.workflowsEnabled !== next.workflowsEnabled
  ) {
    await threadSession.session.applyMutableSettings({
      effort:
        next.reasoningLevel === undefined
          ? undefined
          : toSdkEffort(next.reasoningLevel),
      settings: buildMutableFlagSettings({
        memoryEnabled: next.memoryEnabled,
        reasoningLevel: next.reasoningLevel,
        workflowsEnabled: next.workflowsEnabled,
      }),
    });
  }

  threadSession.liveSettings = next;
}

function nextSessionSerial(): number {
  sessionSerialCounter += 1;
  return sessionSerialCounter;
}

function withTrackedPermissionEscalation(
  params: ProviderSessionOpenParams,
  threadIdRef: ThreadIdRef,
): BuildSessionOptionsArgs {
  const permissionMode = resolveClaudePermissionMode(params);
  return {
    additionalWorkspaceWriteRoots:
      params.execution.permission.permissionScope === "workspace"
        ? params.workspace.additionalWriteRoots
        : [],
    baseInstructions: params.instructions.text,
    cwd: params.workspace.cwd,
    disallowedTools: params.disallowedTools,
    instructionMode: params.instructions.mode,
    permissionMode,
    permissionScope: params.execution.permission.permissionScope,
    plugins: params.skillSources.map((source) => ({
      type: "local" as const,
      path: source.rootPath,
    })),
    model: params.execution.model,
    reasoningLevel: params.execution.reasoningLevel,
    workflowsEnabled: params.execution.features.workflowsEnabled,
    memoryEnabled: params.execution.features.memoryEnabled,
    getPermissionEscalation: (context) => {
      const threadSession = sessions.get(threadIdRef.current);
      return threadSession
        ? resolvePermissionEscalationForWork(threadSession, context)
        : null;
    },
  };
}

function createThreadSession(args: CreateThreadSessionArgs): ThreadSession {
  const sessionSerial = nextSessionSerial();
  const session = new SdkSession(
    args.sessionOptions,
    createOnSdkMessage({
      sessionSerial,
      threadIdRef: args.threadIdRef,
    }),
    createOnSdkDone({
      sessionSerial,
      threadIdRef: args.threadIdRef,
    }),
  );

  return {
    activeTurnId: args.activeTurnId ?? null,
    attachmentId: args.attachmentId,
    context: args.context,
    session,
    sessionConstructionConfig: args.sessionConstructionConfig,
    sessionOptions: args.sessionOptions,
    sessionSerial,
    closing: false,
    streamEnded: false,
    mockCliTrafficProxy: args.mockCliTrafficProxy,
    permissionEscalation: args.permissionEscalation,
    permissionEscalationByAgentId: new Map(),
    permissionEscalationByPromptId: new Map(),
    permissionEscalationBySubagentParentToolUseId: new Map(),
    permissionEscalationByToolUseId: new Map(),
    permissionMode: args.permissionMode,
    liveSettings: args.liveSettings,
    approvedPlanPermissionMode: args.approvedPlanPermissionMode,
    providerThreadId: args.providerThreadId,
    sessionPermissionGrants: [...(args.sessionPermissionGrants ?? [])],
    threadIdRef: args.threadIdRef,
    translator: args.translator,
  };
}

function getTrackedPermissionEscalation(
  values: Map<string, PermissionEscalation | null>,
  key: string | undefined,
): PermissionEscalation | null | undefined {
  if (key === undefined || !values.has(key)) {
    return undefined;
  }
  return values.get(key) ?? null;
}

function resolvePermissionEscalationForWork(
  threadSession: ThreadSession,
  context: PermissionEscalationWorkContext,
): PermissionEscalation | null {
  const toolPermissionEscalation = getTrackedPermissionEscalation(
    threadSession.permissionEscalationByToolUseId,
    context.toolUseId,
  );
  if (toolPermissionEscalation !== undefined) {
    return toolPermissionEscalation;
  }

  const agentPermissionEscalation = getTrackedPermissionEscalation(
    threadSession.permissionEscalationByAgentId,
    context.agentId,
  );
  if (agentPermissionEscalation !== undefined) {
    return agentPermissionEscalation;
  }

  const promptPermissionEscalation = getTrackedPermissionEscalation(
    threadSession.permissionEscalationByPromptId,
    context.promptId,
  );
  return promptPermissionEscalation === undefined
    ? threadSession.permissionEscalation
    : promptPermissionEscalation;
}

function trackSdkAssistantPermissionEscalation(
  threadSession: ThreadSession,
  message: SDKMessage,
): void {
  if (message.type !== "assistant") {
    return;
  }

  const parentToolUseId = message.parent_tool_use_id ?? undefined;
  const parentPermissionEscalation = getTrackedPermissionEscalation(
    threadSession.permissionEscalationBySubagentParentToolUseId,
    parentToolUseId,
  );
  const permissionEscalation =
    parentPermissionEscalation === undefined
      ? threadSession.permissionEscalation
      : parentPermissionEscalation;

  for (const content of message.message.content) {
    if (content.type !== "tool_use") {
      continue;
    }
    threadSession.permissionEscalationByToolUseId.set(
      content.id,
      permissionEscalation,
    );
    if (CLAUDE_PROVIDER_SUBAGENT_TOOL_NAMES.has(content.name)) {
      threadSession.permissionEscalationBySubagentParentToolUseId.set(
        content.id,
        permissionEscalation,
      );
    }
  }
}

function buildPermissionEscalationTrackingHooks(
  threadIdRef: ThreadIdRef,
): NonNullable<SdkSessionOptions["hooks"]> {
  const trackPermissionRequest: HookCallback = async (input, toolUseId) => {
    if (
      input.hook_event_name !== "PermissionRequest" ||
      toolUseId === undefined
    ) {
      return { continue: true };
    }
    const threadSession = sessions.get(threadIdRef.current);
    if (threadSession) {
      // Claude can omit agentID from the later canUseTool callback. Preserve
      // the work's provenance at the permission boundary, where the hook
      // still carries its agent/prompt metadata.
      threadSession.permissionEscalationByToolUseId.set(
        toolUseId,
        resolvePermissionEscalationForWork(threadSession, {
          ...(input.agent_id !== undefined ? { agentId: input.agent_id } : {}),
          ...(input.prompt_id !== undefined
            ? { promptId: input.prompt_id }
            : {}),
        }),
      );
    }
    return { continue: true };
  };

  const trackPreToolUse: HookCallback = async (input) => {
    if (input.hook_event_name !== "PreToolUse") {
      return { continue: true };
    }
    const threadSession = sessions.get(threadIdRef.current);
    if (threadSession) {
      const permissionEscalation = resolvePermissionEscalationForWork(
        threadSession,
        {
          ...(input.agent_id !== undefined ? { agentId: input.agent_id } : {}),
          ...(input.prompt_id !== undefined
            ? { promptId: input.prompt_id }
            : {}),
        },
      );
      threadSession.permissionEscalationByToolUseId.set(
        input.tool_use_id,
        permissionEscalation,
      );
      if (CLAUDE_PROVIDER_SUBAGENT_TOOL_NAMES.has(input.tool_name)) {
        threadSession.permissionEscalationBySubagentParentToolUseId.set(
          input.tool_use_id,
          permissionEscalation,
        );
      }
      if (
        !threadSession.liveSettings.providerSubagentsEnabled &&
        CLAUDE_PROVIDER_SUBAGENT_TOOL_NAMES.has(input.tool_name)
      ) {
        return {
          continue: true,
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason:
              "bb has disabled Claude Code native subagents; use bb delegation instead.",
          },
        };
      }
      if (
        !threadSession.liveSettings.workflowsEnabled &&
        input.tool_name === CLAUDE_WORKFLOW_TOOL_NAME
      ) {
        return {
          continue: true,
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason:
              "bb has disabled the Claude Code Workflow tool.",
          },
        };
      }
    }
    return { continue: true };
  };

  const trackSubagentStart: HookCallback = async (input) => {
    if (input.hook_event_name !== "SubagentStart") {
      return { continue: true };
    }
    const threadSession = sessions.get(threadIdRef.current);
    if (threadSession) {
      threadSession.permissionEscalationByAgentId.set(
        input.agent_id,
        resolvePermissionEscalationForWork(threadSession, {
          ...(input.prompt_id !== undefined
            ? { promptId: input.prompt_id }
            : {}),
        }),
      );
    }
    return { continue: true };
  };

  const clearSubagent: HookCallback = async (input) => {
    if (input.hook_event_name === "SubagentStop") {
      sessions
        .get(threadIdRef.current)
        ?.permissionEscalationByAgentId.delete(input.agent_id);
    }
    return { continue: true };
  };

  const clearToolUse: HookCallback = async (input) => {
    if (
      input.hook_event_name === "PostToolUse" ||
      input.hook_event_name === "PostToolUseFailure" ||
      input.hook_event_name === "PermissionDenied"
    ) {
      sessions
        .get(threadIdRef.current)
        ?.permissionEscalationByToolUseId.delete(input.tool_use_id);
    }
    return { continue: true };
  };

  return {
    PermissionDenied: [{ hooks: [clearToolUse] }],
    PermissionRequest: [{ hooks: [trackPermissionRequest] }],
    PostToolUse: [{ hooks: [clearToolUse] }],
    PostToolUseFailure: [{ hooks: [clearToolUse] }],
    PreToolUse: [{ hooks: [trackPreToolUse] }],
    SubagentStart: [{ hooks: [trackSubagentStart] }],
    SubagentStop: [{ hooks: [clearSubagent] }],
  };
}

function addPermissionEscalationTrackingHooks(
  sessionOptions: SdkSessionOptions,
  threadIdRef: ThreadIdRef,
): void {
  const existingHooks = sessionOptions.hooks;
  const trackingHooks = buildPermissionEscalationTrackingHooks(threadIdRef);
  // PreToolUse tracking must run before enforcement hooks so those hooks can
  // resolve the tool ID back to the prompt or subagent that originated it.
  sessionOptions.hooks = {
    ...existingHooks,
    PermissionDenied: [
      ...(trackingHooks.PermissionDenied ?? []),
      ...(existingHooks?.PermissionDenied ?? []),
    ],
    PermissionRequest: [
      ...(trackingHooks.PermissionRequest ?? []),
      ...(existingHooks?.PermissionRequest ?? []),
    ],
    PostToolUse: [
      ...(trackingHooks.PostToolUse ?? []),
      ...(existingHooks?.PostToolUse ?? []),
    ],
    PostToolUseFailure: [
      ...(trackingHooks.PostToolUseFailure ?? []),
      ...(existingHooks?.PostToolUseFailure ?? []),
    ],
    PreToolUse: [
      ...(trackingHooks.PreToolUse ?? []),
      ...(existingHooks?.PreToolUse ?? []),
    ],
    SubagentStart: [
      ...(trackingHooks.SubagentStart ?? []),
      ...(existingHooks?.SubagentStart ?? []),
    ],
    SubagentStop: [
      ...(trackingHooks.SubagentStop ?? []),
      ...(existingHooks?.SubagentStop ?? []),
    ],
  };
}

function buildTrackedSessionOptions(
  params: ProviderSessionOpenParams,
  env: NodeJS.ProcessEnv,
  threadIdRef: ThreadIdRef,
): SdkSessionOptions {
  const sessionOptions = buildSessionOptions(
    withTrackedPermissionEscalation(params, threadIdRef),
    env,
  );
  addPermissionEscalationTrackingHooks(sessionOptions, threadIdRef);
  return sessionOptions;
}

function getCurrentThreadSession(
  args: CurrentThreadSessionArgs,
): ThreadSession | undefined {
  const threadSession = sessions.get(args.threadId);
  if (
    !threadSession ||
    threadSession.closing ||
    threadSession.sessionSerial !== args.sessionSerial
  ) {
    return undefined;
  }
  return threadSession;
}

function createOnSdkMessage(
  args: CreateSdkCallbackArgs,
): (message: SDKMessage) => void {
  return (message: SDKMessage) => {
    const threadSession = getCurrentThreadSession({
      sessionSerial: args.sessionSerial,
      threadId: args.threadIdRef.current,
    });
    if (!threadSession) return;
    const providerThreadId = message.session_id?.trim() ?? "";
    if (
      providerThreadId.length > 0 &&
      threadSession.providerThreadId !== providerThreadId
    ) {
      threadSession.providerThreadId = providerThreadId;
    }
    trackSdkAssistantPermissionEscalation(threadSession, message);
    threadSession.translator.translateSdkMessage(message);
    threadSession.activeTurnId = threadSession.translator.getActiveTurnId();
  };
}

function createOnSdkDone(
  args: CreateSdkCallbackArgs,
): (error?: unknown) => void {
  return (error?: unknown) => {
    const threadSession = getCurrentThreadSession({
      sessionSerial: args.sessionSerial,
      threadId: args.threadIdRef.current,
    });
    if (!threadSession) return;

    threadSession.streamEnded = true;
    if (error !== undefined && threadSession.activeTurnId !== null) {
      threadSession.translator.settleFailed(
        driverError({
          code: "claude_sdk_stream_failed",
          category: "provider",
          message: "Claude SDK stream failed",
          detail: error instanceof Error ? error.message : String(error),
        }),
      );
      threadSession.activeTurnId = null;
    }
  };
}

async function closeClaudeThreadSession(
  threadSession: ThreadSession,
  graceful: boolean,
): Promise<void> {
  try {
    if (graceful) {
      await threadSession.session.closeGracefully(THREAD_STOP_CLOSE_TIMEOUT_MS);
    } else {
      threadSession.session.stop();
    }
  } finally {
    await threadSession.mockCliTrafficProxy?.close();
    threadSession.mockCliTrafficProxy = null;
  }
}

/**
 * Builds the environment for an SDK-spawned Claude session so its API traffic
 * presents like the headless Claude CLI (`claude -p`) instead of a third-party
 * SDK app.
 *
 * - `CLAUDE_CODE_ENTRYPOINT=cli` makes the session report `cc_entrypoint=sdk-cli`
 *   and a `(external, sdk-cli, ...)` user-agent. The Agent SDK only defaults
 *   this to `sdk-ts` when it is unset, so we set it explicitly. The spawned
 *   binary always adds the `sdk-` prefix (and an `agent-sdk/<version>`
 *   user-agent segment) because it runs in stream-json mode, so the interactive
 *   `cli` entrypoint is not reachable from the SDK.
 * - Omitting `CLAUDE_AGENT_SDK_CLIENT_APP` drops the `client-app/...` user-agent
 *   segment, matching the CLI. The delete also clears any value inherited from a
 *   parent SDK process.
 */
function buildSessionEnv(
  envOverrides: Record<string, string>,
): NodeJS.ProcessEnv {
  const sessionEnv: NodeJS.ProcessEnv = {
    ...withoutBridgeRuntimeEnv(process.env),
    ...envOverrides,
    CLAUDE_CODE_ENTRYPOINT: "cli",
  };
  delete sessionEnv.CLAUDE_AGENT_SDK_CLIENT_APP;
  return sessionEnv;
}

function appendNoProxyLoopback(value: string | undefined): string {
  const entries = new Set(
    (value ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  );
  entries.add("127.0.0.1");
  entries.add("localhost");
  return [...entries].join(",");
}

async function prepareSessionEnv(
  params: PrepareSessionEnvParams,
): Promise<PreparedSessionEnv> {
  const envOverrides = extractEnvOverrides(params.config);
  if (!params.claudeCodeMockCliTraffic.enabled) {
    return {
      env: buildSessionEnv(envOverrides),
      mockCliTrafficProxy: null,
    };
  }

  const mockCliTrafficProxy = await startClaudeCodeMockCliTrafficProxy({
    endpoint: DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_ENDPOINT,
    threadId: params.threadId,
  });
  return {
    env: buildSessionEnv({
      ...envOverrides,
      ANTHROPIC_BASE_URL: mockCliTrafficProxy.baseUrl,
      NO_PROXY: appendNoProxyLoopback(
        envOverrides.NO_PROXY ?? process.env.NO_PROXY,
      ),
      no_proxy: appendNoProxyLoopback(
        envOverrides.no_proxy ?? process.env.no_proxy,
      ),
    }),
    mockCliTrafficProxy,
  };
}

function parseClaudeSuggestedPermissionUpdates(
  value: unknown,
): ClaudeSuggestedPermissionUpdate[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const parsedUpdates = value.flatMap((entry) => {
    const parsed = claudeSuggestedPermissionUpdateSchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });

  return parsedUpdates.length > 0 ? parsedUpdates : undefined;
}

function buildApprovalPayload(args: BuildInteractiveRequestParamsArgs) {
  const permissions = toPendingInteractionPermissionProfile({
    toolName: args.toolName,
    blockedPath: args.blockedPath,
    suggestions: args.suggestions,
  });
  const availableDecisions =
    args.toolName === CLAUDE_EXIT_PLAN_MODE_TOOL_NAME
      ? (["allow_once", "deny"] as const)
      : (["allow_once", "allow_for_session", "deny"] as const);
  const subject =
    args.toolName === CLAUDE_EXIT_PLAN_MODE_TOOL_NAME
      ? (() => {
          const parsed = claudeExitPlanModeInputSchema.safeParse(args.input);
          return parsed.success
            ? {
                kind: "plan" as const,
                itemId: args.toolUseId,
                plan: parsed.data.plan,
                planFilePath: parsed.data.planFilePath ?? null,
              }
            : {
                kind: "permission_grant" as const,
                itemId: args.toolUseId,
                toolName: args.toolName,
                permissions,
              };
        })()
      : {
          kind: "permission_grant" as const,
          itemId: args.toolUseId,
          toolName: args.toolName,
          permissions,
        };
  return {
    payload: {
      kind: "approval" as const,
      subject,
      reason: args.decisionReason ?? args.promptText ?? null,
      availableDecisions: [...availableDecisions],
    },
    permissions,
  };
}

function buildUserQuestionPayload(
  input: ClaudeUserQuestionInput,
  itemId: string,
) {
  return {
    kind: "user_question" as const,
    questions: input.questions.map((question, questionIndex) => {
      const id = `${itemId}:question-${questionIndex + 1}`;
      return {
        id,
        prompt: question.question,
        shortLabel: question.header,
        multiSelect: question.multiSelect,
        options: question.options.map((option, optionIndex) => ({
          value: `${id}:option-${optionIndex + 1}`,
          label: option.label,
          description: option.description,
        })),
        allowFreeText: true,
      };
    }),
  };
}

function buildUserQuestionOutput(
  input: ClaudeUserQuestionInput,
  payload: ReturnType<typeof buildUserQuestionPayload>,
  resolution: Extract<
    Awaited<
      ReturnType<ProviderDriverContext["host"]["requestInteraction"]>
    >["resolution"],
    { kind: "user_answer" }
  >,
) {
  const answers: Record<string, string> = {};
  for (const [index, question] of payload.questions.entries()) {
    const answer = resolution.answers[question.id];
    if (!answer) throw new Error(`Missing answer for ${question.id}`);
    const selected = answer.selected.map((value) => {
      const option = question.options.find(
        (candidate) => candidate.value === value,
      );
      if (!option) throw new Error(`Unknown answer option ${value}`);
      return option.label;
    });
    const text = [
      ...selected,
      ...(answer.freeText ? [answer.freeText] : []),
    ].join(", ");
    if (!text) throw new Error(`Empty answer for ${question.id}`);
    answers[input.questions[index]?.question ?? question.prompt] = text;
  }
  return { questions: input.questions, answers };
}

function createForwardInteractiveRequest(
  threadIdRef: ThreadIdRef,
): (args: ForwardInteractiveRequestArgs) => Promise<PermissionResult> {
  return async (args) => {
    const threadSession = sessions.get(threadIdRef.current);
    if (!threadSession || !threadSession.activeTurnId) {
      return {
        behavior: "deny",
        message: "Thread session has no active turn",
        toolUseID: args.toolUseId,
      };
    }
    const { payload, permissions } = buildApprovalPayload(args);
    const response = await threadSession.context.host.requestInteraction({
      attachmentId: threadSession.attachmentId,
      turnId: threadSession.activeTurnId,
      requestId: args.toolUseId,
      payload,
    });
    if (!("decision" in response.resolution)) {
      return {
        behavior: "deny",
        message: "Interaction response kind mismatch",
        toolUseID: args.toolUseId,
      };
    }
    if (response.resolution.decision === "deny") {
      return {
        behavior: "deny",
        message:
          payload.subject.kind === "plan"
            ? buildClaudePlanRejectionMessage()
            : "Permission request denied",
        decisionClassification: "user_reject",
        toolUseID: args.toolUseId,
      };
    }
    const permanent = response.resolution.decision === "allow_for_session";
    if (permanent) {
      threadSession.sessionPermissionGrants.push({
        permissions,
        toolName: args.toolName,
      });
    }
    if (args.toolName === CLAUDE_EXIT_PLAN_MODE_TOOL_NAME) {
      restoreApprovedPlanPermissionMode(threadSession);
    }
    return {
      behavior: "allow",
      updatedInput: args.input,
      ...(permanent
        ? {
            decisionClassification: "user_permanent" as const,
            updatedPermissions: buildClaudeSessionPermissionUpdates({
              permissions,
              toolName: args.toolName,
            }),
          }
        : { decisionClassification: "user_temporary" as const }),
      toolUseID: args.toolUseId,
    };
  };
}

function createForwardUserQuestionRequest(
  threadIdRef: ThreadIdRef,
): (args: ForwardUserQuestionRequestArgs) => Promise<PermissionResult> {
  return async (args) => {
    const threadSession = sessions.get(threadIdRef.current);
    if (!threadSession || !threadSession.activeTurnId) {
      return {
        behavior: "deny",
        message: "Thread session has no active turn",
        toolUseID: args.toolUseId,
      };
    }
    const payload = buildUserQuestionPayload(args.input, args.toolUseId);
    const response = await threadSession.context.host.requestInteraction({
      attachmentId: threadSession.attachmentId,
      turnId: threadSession.activeTurnId,
      requestId: args.toolUseId,
      payload,
    });
    if (!("answers" in response.resolution)) {
      return {
        behavior: "deny",
        message: "Interaction response kind mismatch",
        toolUseID: args.toolUseId,
      };
    }
    return {
      behavior: "allow",
      updatedInput: buildUserQuestionOutput(
        args.input,
        payload,
        response.resolution,
      ),
      toolUseID: args.toolUseId,
    };
  };
}

function restoreApprovedPlanPermissionMode(threadSession: ThreadSession): void {
  if (
    threadSession.permissionMode === threadSession.approvedPlanPermissionMode
  ) {
    return;
  }
  threadSession.permissionMode = threadSession.approvedPlanPermissionMode;
  void threadSession.session
    .setPermissionMode(threadSession.approvedPlanPermissionMode)
    .catch((error: unknown) => {
      process.stderr.write(
        `claude-code driver: Failed to leave Plan mode: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    });
}

function createCanUseTool(threadIdRef: ThreadIdRef): CanUseTool {
  const forwardInteractiveRequest =
    createForwardInteractiveRequest(threadIdRef);
  const forwardUserQuestionRequest =
    createForwardUserQuestionRequest(threadIdRef);

  return async (toolName, input, options) => {
    // Claude can dispatch canUseTool while the preceding assistant tool-use
    // message is queued for the SDK async iterator. Give the stream consumer
    // one turn to record its parent-tool provenance before resolving policy.
    await new Promise<void>((resolve) => setImmediate(resolve));

    const threadSession = sessions.get(threadIdRef.current);
    if (!threadSession) {
      return {
        behavior: "deny",
        message: "Thread session not found",
        toolUseID: options.toolUseID,
      };
    }

    if (toolName === CLAUDE_USER_QUESTION_TOOL_NAME) {
      const parsedInput = claudeUserQuestionInputSchema.safeParse(input);
      if (!parsedInput.success) {
        return {
          behavior: "deny",
          message: "Invalid AskUserQuestion input",
          toolUseID: options.toolUseID,
        };
      }
      return forwardUserQuestionRequest({
        threadId: threadIdRef.current,
        providerThreadId: threadSession.providerThreadId ?? threadIdRef.current,
        toolUseId: options.toolUseID,
        input: parsedInput.data,
        signal: options.signal,
      });
    }

    // Like AskUserQuestion, this tool call is the prompt itself rather than a
    // guard on a side effect, so it must reach the user before any of the
    // policy shortcuts below. `/plan` also overrides the session permission
    // mode, so a "full" preset does not mean the user waived plan review.
    if (toolName === CLAUDE_EXIT_PLAN_MODE_TOOL_NAME) {
      if (!claudeExitPlanModeInputSchema.safeParse(input).success) {
        return {
          behavior: "deny",
          message: "Invalid ExitPlanMode input",
          toolUseID: options.toolUseID,
        };
      }
      return forwardInteractiveRequest({
        threadId: threadIdRef.current,
        providerThreadId: threadSession.providerThreadId ?? threadIdRef.current,
        toolName,
        toolUseId: options.toolUseID,
        input,
        decisionReason: undefined,
        promptText: undefined,
        blockedPath: undefined,
        suggestions: undefined,
        signal: options.signal,
      });
    }

    const interactiveRequestPolicy = {
      permissionEscalation: resolvePermissionEscalationForWork(threadSession, {
        ...(options.agentID !== undefined ? { agentId: options.agentID } : {}),
        toolUseId: options.toolUseID,
      }),
    };
    const suggestions = parseClaudeSuggestedPermissionUpdates(
      options.suggestions,
    );

    const requestContext: ClaudeCanUseToolDecisionContext = {
      toolName,
      blockedPath: options.blockedPath,
      decisionReason: options.decisionReason,
      suggestions,
    };
    const requestedPermissions =
      toPendingInteractionPermissionProfile(requestContext);
    if (
      toolName === "Bash" &&
      shouldAutoDenyInteractiveRequest(interactiveRequestPolicy) &&
      typeof input === "object" &&
      input !== null &&
      (input as { dangerouslyDisableSandbox?: unknown })
        .dangerouslyDisableSandbox === true
    ) {
      // With `allowUnsandboxedCommands` permanently enabled, this deny is the
      // only gate on the unsandboxed retry for escalation-denied turns. It must
      // run before the session-grant shortcut: grants survive escalation flips
      // now that an escalation-only change reuses the session.
      return {
        behavior: "deny",
        message: buildWorkspaceWriteDenialMessage(),
        toolUseID: options.toolUseID,
      };
    }
    if (
      hasClaudeSessionPermissionGrant({
        grants: threadSession.sessionPermissionGrants,
        permissions: requestedPermissions,
        toolName,
      })
    ) {
      return {
        behavior: "allow",
        updatedInput: input,
        toolUseID: options.toolUseID,
        decisionClassification: "user_permanent",
      };
    }

    if (
      toolName === "Bash" &&
      (threadSession.permissionMode === "default" ||
        threadSession.permissionMode === "dontAsk")
    ) {
      // Defensive mirror of the readonly PreToolUse allowlist: Claude may still
      // call canUseTool after hook input rewriting, and safe policy allows are
      // not user decisions, so no decisionClassification is attached.
      const updatedInput = buildReadonlyBashUpdatedInput(input);
      if (updatedInput) {
        return {
          behavior: "allow",
          updatedInput,
          toolUseID: options.toolUseID,
        };
      }
    }

    const shouldRequestApproval =
      shouldRequestClaudePermissionApproval(requestContext) ||
      (options.suggestions?.length ?? 0) > 0;

    if (!shouldRequestApproval) {
      return {
        behavior: "allow",
        updatedInput: input,
        toolUseID: options.toolUseID,
      };
    }

    if (threadSession.permissionMode === "bypassPermissions") {
      return {
        behavior: "allow",
        updatedInput: input,
        toolUseID: options.toolUseID,
      };
    }

    if (
      shouldAutoDenyInteractiveRequest(interactiveRequestPolicy) ||
      threadSession.permissionMode === "dontAsk"
    ) {
      const policyMessage =
        threadSession.permissionMode === "acceptEdits" ||
        threadSession.permissionMode === "auto"
          ? buildWorkspaceWriteDenialMessage()
          : buildReadonlyDenialMessage();
      return {
        behavior: "deny",
        message: options.decisionReason ?? policyMessage,
        toolUseID: options.toolUseID,
      };
    }

    return forwardInteractiveRequest({
      threadId: threadIdRef.current,
      providerThreadId: threadSession.providerThreadId ?? threadIdRef.current,
      toolName,
      toolUseId: options.toolUseID,
      input,
      decisionReason: options.decisionReason,
      promptText: options.title ?? options.description,
      blockedPath: options.blockedPath,
      suggestions,
      signal: options.signal,
    });
  };
}

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

function requireSession(attachmentId: string): ThreadSession {
  const session = sessionsByAttachmentId.get(attachmentId);
  if (!session || session.closing) {
    rejectRequest({
      code: "claude_session_not_found",
      category: "driver",
      message: `No Claude session for attachment ${attachmentId}`,
    });
  }
  return session;
}

function ensureWritableSession(session: ThreadSession): ThreadSession {
  if (!session.streamEnded) return session;
  const replacement = createThreadSession({
    activeTurnId: session.activeTurnId,
    attachmentId: session.attachmentId,
    context: session.context,
    liveSettings: session.liveSettings,
    mockCliTrafficProxy: session.mockCliTrafficProxy,
    permissionEscalation: session.permissionEscalation,
    permissionMode: session.permissionMode,
    approvedPlanPermissionMode: session.approvedPlanPermissionMode,
    providerThreadId: session.providerThreadId,
    sessionConstructionConfig: session.sessionConstructionConfig,
    sessionOptions: session.sessionOptions,
    sessionPermissionGrants: session.sessionPermissionGrants,
    threadIdRef: session.threadIdRef,
    translator: session.translator,
  });
  session.closing = true;
  sessions.set(session.threadIdRef.current, replacement);
  sessionsByAttachmentId.set(session.attachmentId, replacement);
  replacement.session.start(session.providerThreadId);
  return replacement;
}

function resolveClaudePermissionMode(
  params: ProviderSessionOpenParams,
): ClaudePermissionMode {
  const override = params.execution.providerOptions.claudeCodePermissionMode;
  if (override === "plan") return "plan";
  return toClaudePermissionMode(params.execution.permission);
}

function mockCliTrafficConfig(params: ProviderSessionOpenParams) {
  const value = params.execution.providerOptions.claudeCodeMockCliTraffic;
  if (value === undefined) return DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_CONFIG;
  if (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof value.enabled === "boolean" &&
    typeof value.endpoint === "string"
  ) {
    return { enabled: value.enabled, endpoint: value.endpoint };
  }
  rejectRequest({
    code: "claude_provider_options_invalid",
    category: "configuration",
    message: "Claude Code provider options are invalid",
  });
}

function liveSettingsFromExecution(
  execution:
    | ProviderTurnSubmitParams["execution"]
    | ProviderSessionOpenParams["execution"],
): ClaudeLiveSessionSettings {
  return {
    memoryEnabled: execution.features.memoryEnabled,
    model: execution.model,
    providerSubagentsEnabled: execution.features.subagentsEnabled,
    reasoningLevel: execution.reasoningLevel,
    workflowsEnabled: execution.features.workflowsEnabled,
  };
}

function constructionConfig(
  params: ProviderSessionOpenParams,
): SessionConstructionConfig {
  return {
    dynamicTools: params.dynamicTools,
    sessionOptions: {
      additionalWorkspaceWriteRoots:
        params.execution.permission.permissionScope === "workspace"
          ? params.workspace.additionalWriteRoots
          : [],
      baseInstructions: params.instructions.text,
      cwd: params.workspace.cwd,
      disallowedTools: params.disallowedTools,
      instructionMode: params.instructions.mode,
      permissionMode: resolveClaudePermissionMode(params),
      permissionScope: params.execution.permission.permissionScope,
      plugins: params.skillSources.map((source) => ({
        type: "local",
        path: source.rootPath,
      })),
    },
  };
}

function stripPlanCommand(
  group: readonly PromptInput[],
  permissionMode: ClaudePermissionMode,
): PromptInput[] {
  return permissionMode === "plan"
    ? removeCommandMentionsFromPromptInput(group, {
        trigger: "/",
        name: "plan",
      })
    : [...group];
}

function localAttachmentMarker(args: {
  kind: "image" | "file";
  path: string;
  name?: string;
  mimeType?: string;
  sizeBytes?: number;
}): string {
  const name = args.name ? ` "${args.name}"` : "";
  const details = [
    ...(args.mimeType ? [args.mimeType] : []),
    ...(args.sizeBytes !== undefined ? [`${args.sizeBytes} bytes`] : []),
  ];
  const suffix = details.length > 0 ? ` (${details.join(", ")})` : "";
  return `[Attached ${args.kind}${name}${suffix}. It is on disk at ${args.path} — use the Read tool to view it.]`;
}

function buildPromptText(input: readonly PromptInput[]): string | null {
  const chunks: string[] = [];
  for (const item of input) {
    switch (item.type) {
      case "text":
        if (item.text) chunks.push(item.text);
        break;
      case "image":
        chunks.push(`[Attached image: ${item.url}]`);
        break;
      case "localImage":
        chunks.push(localAttachmentMarker({ kind: "image", path: item.path }));
        break;
      case "localFile":
        chunks.push(
          localAttachmentMarker({
            kind: "file",
            path: item.path,
            ...(item.name ? { name: item.name } : {}),
            ...(item.mimeType ? { mimeType: item.mimeType } : {}),
            ...(item.sizeBytes !== undefined
              ? { sizeBytes: item.sizeBytes }
              : {}),
          }),
        );
        break;
    }
  }
  return chunks.length > 0 ? chunks.join("\n") : null;
}

function buildPromptTexts(
  inputGroups: readonly (readonly PromptInput[])[],
  permissionMode: ClaudePermissionMode,
): string[] | null {
  const texts: string[] = [];
  for (const group of inputGroups) {
    const text = buildPromptText(stripPlanCommand(group, permissionMode));
    if (!text) return null;
    texts.push(text);
  }
  return texts;
}

function canonicalCallId(callId: string): string {
  const cleaned = callId.replace(/[^A-Za-z0-9._:@/-]/gu, "_");
  return cleaned && /^[A-Za-z0-9]/u.test(cleaned)
    ? cleaned.slice(0, 512)
    : `claude-call-${Date.now()}`;
}

function buildDynamicToolForwarder(threadIdRef: ThreadIdRef) {
  return async (
    toolName: string,
    args: Record<string, unknown>,
    callId?: string,
  ) => {
    const session = sessions.get(threadIdRef.current);
    if (!session || !session.activeTurnId) {
      return { content: "Claude tool call has no active turn", isError: true };
    }
    const result = await session.context.host.callTool({
      attachmentId: session.attachmentId,
      turnId: session.activeTurnId,
      callId: canonicalCallId(callId ?? randomUUID()),
      tool: toolName,
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
  };
}

async function closeSession(
  session: ThreadSession,
  options: { remove: boolean; graceful: boolean } = {
    remove: true,
    graceful: true,
  },
): Promise<void> {
  if (!session.closing) {
    session.closing = true;
    session.translator.interruptBackgroundTasks();
    await closeClaudeThreadSession(session, options.graceful);
  }
  if (options.remove) {
    if (sessions.get(session.threadIdRef.current) === session) {
      sessions.delete(session.threadIdRef.current);
    }
    if (sessionsByAttachmentId.get(session.attachmentId) === session) {
      sessionsByAttachmentId.delete(session.attachmentId);
    }
  }
}

async function createCanonicalSession(
  params: ProviderSessionOpenParams,
  context: ProviderDriverContext,
  providerThreadId: string,
): Promise<ThreadSession> {
  const threadIdRef = { current: params.bbThreadId };
  const preparedEnv = await prepareSessionEnv({
    claudeCodeMockCliTraffic: mockCliTrafficConfig(params),
    config: params.shellEnvironment,
    threadId: params.bbThreadId,
  });
  const sessionOptions = buildTrackedSessionOptions(
    params,
    preparedEnv.env,
    threadIdRef,
  );
  if (params.mode.kind === "start") sessionOptions.sessionId = providerThreadId;
  sessionOptions.canUseTool = createCanUseTool(threadIdRef);
  if (params.dynamicTools.length > 0) {
    const mcpServer = buildClaudeMcpServer(
      params.dynamicTools,
      buildDynamicToolForwarder(threadIdRef),
    );
    sessionOptions.mcpServers = { [CLAUDE_MCP_SERVER_NAME]: mcpServer };
    sessionOptions.allowedTools = getAllowedToolNames(params.dynamicTools);
  }
  const translator = new ClaudeCanonicalEventTranslator({
    attachmentId: params.attachmentId,
    events: context.events,
    selectedModel: params.execution.model,
  });
  const permissionMode = resolveClaudePermissionMode(params);
  const session = createThreadSession({
    attachmentId: params.attachmentId,
    context,
    mockCliTrafficProxy: preparedEnv.mockCliTrafficProxy,
    liveSettings: liveSettingsFromExecution(params.execution),
    permissionEscalation: params.execution.permission.permissionEscalation,
    permissionMode,
    approvedPlanPermissionMode: toClaudePermissionMode(
      params.execution.permission,
    ),
    providerThreadId,
    sessionConstructionConfig: constructionConfig(params),
    sessionOptions,
    sessionPermissionGrants: [],
    threadIdRef,
    translator,
  });
  sessions.set(params.bbThreadId, session);
  sessionsByAttachmentId.set(params.attachmentId, session);
  try {
    session.session.start(
      params.mode.kind === "start" ? undefined : providerThreadId,
    );
  } catch (error) {
    sessions.delete(params.bbThreadId);
    sessionsByAttachmentId.delete(params.attachmentId);
    await preparedEnv.mockCliTrafficProxy?.close();
    throw error;
  }
  return session;
}

export const claudeCodeProviderDriver = defineProviderDriver({
  identity: {
    pluginId: "claude-code",
    driverId: "claude-code",
    providerId: "claude-code",
  },
  processCapabilities: { multiplexSessions: true },

  async inspect() {
    try {
      const models = await listClaudeCodeDriverModels();
      return {
        readiness: { status: "ready" as const },
        capabilities: {
          multiplexSessions: true,
          supportedSessionOperations: ["fork" as const],
          supportedPermissionModes: [
            "accept-edits" as const,
            "auto" as const,
            "full" as const,
          ],
          supportsServiceTier: false,
          supportsSteering: true,
          supportsUserQuestions: true,
        },
        ...models,
        diagnostics: [],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        readiness: {
          status: "unavailable" as const,
          reason: message,
          retryable: true,
        },
        capabilities: {
          multiplexSessions: true,
          supportedSessionOperations: ["fork" as const],
          supportedPermissionModes: [
            "accept-edits" as const,
            "auto" as const,
            "full" as const,
          ],
          supportsServiceTier: false,
          supportsSteering: true,
          supportsUserQuestions: true,
        },
        models: [],
        selectedOnlyModels: [],
        diagnostics: [
          {
            level: "error" as const,
            code: "claude_model_inspection_failed",
            message,
            detail: null,
          },
        ],
      };
    }
  },

  async openSession(params, context) {
    if (params.execution.serviceTier !== "default") {
      rejectRequest({
        code: "claude_service_tier_unsupported",
        category: "configuration",
        message: "Claude Code does not support a non-default service tier",
      });
    }
    if (params.outputSchema !== null) {
      rejectRequest({
        code: "claude_structured_output_unsupported",
        category: "configuration",
        message: "Claude Code structured output is not implemented",
      });
    }
    const existing = sessions.get(params.bbThreadId);
    if (existing)
      await closeSession(existing, { remove: true, graceful: false });
    let providerThreadId: string;
    if (params.mode.kind === "start") {
      providerThreadId = randomUUID();
    } else if (params.mode.kind === "resume") {
      providerThreadId = params.mode.providerSessionId;
    } else {
      const result = await forkSession(params.mode.sourceProviderSessionId, {
        dir: params.workspace.cwd,
        ...(params.mode.sourceCheckpointId
          ? { upToMessageId: params.mode.sourceCheckpointId }
          : {}),
      });
      providerThreadId = result.sessionId;
    }
    await createCanonicalSession(params, context, providerThreadId);
    return {
      providerSessionId: providerThreadId,
      sessionFormatVersion: "claude-agent-sdk-v1",
    };
  },

  async detachSession(params) {
    const session = requireSession(params.attachmentId);
    await closeSession(session);
    return { providerCheckpointId: null };
  },

  async discardSession(params) {
    const session = requireSession(params.attachmentId);
    await closeSession(session);
  },

  async submitTurn(params) {
    const session = ensureWritableSession(requireSession(params.attachmentId));
    if (params.mode === "steer") {
      if (session.activeTurnId !== params.expectedTurnId) {
        return {
          outcome: "stale" as const,
          activeTurnId: session.activeTurnId,
        };
      }
    } else if (session.activeTurnId !== null) {
      return {
        outcome: "rejected" as const,
        error: driverError({
          code: "claude_turn_active",
          category: "provider",
          message: `Claude turn ${session.activeTurnId} is already active`,
        }),
      };
    }
    const inputs = buildPromptTexts(params.inputGroups, session.permissionMode);
    if (!inputs) {
      return {
        outcome: "rejected" as const,
        error: driverError({
          code: "claude_input_required",
          category: "configuration",
          message: "Claude Code requires prompt input",
        }),
      };
    }
    try {
      await applyLiveSessionSettings(
        session,
        liveSettingsFromExecution(params.execution),
      );
    } catch (error) {
      return {
        outcome: "rejected" as const,
        error: driverError({
          code: "claude_settings_rejected",
          category: "provider",
          message: "Claude Code rejected live settings",
          detail: error instanceof Error ? error.message : String(error),
        }),
      };
    }
    const turnId =
      params.mode === "start" ? params.turnId : params.expectedTurnId;
    if (params.mode === "start") {
      session.activeTurnId = turnId;
      session.translator.beginTurn(turnId, params.execution.model);
      if (
        !queuePromptInputs(
          session,
          inputs,
          params.execution.permission.permissionEscalation,
        )
      ) {
        session.activeTurnId = null;
        return {
          outcome: "rejected" as const,
          error: driverError({
            code: "claude_input_closed",
            category: "provider",
            message: "Claude SDK input stream is closed",
          }),
        };
      }
      session.permissionEscalation =
        params.execution.permission.permissionEscalation;
      return {
        outcome: "accepted" as const,
        disposition: "started" as const,
        turnId,
        providerTurnId: null,
      };
    }
    try {
      if (inputs.length > 1) {
        if (
          !queuePromptInputs(
            session,
            inputs,
            params.execution.permission.permissionEscalation,
          )
        ) {
          throw new Error("Claude SDK input stream is closed");
        }
      } else {
        await pushPromptInput(
          session,
          inputs[0] ?? "",
          params.execution.permission.permissionEscalation,
        );
      }
      session.permissionEscalation =
        params.execution.permission.permissionEscalation;
      return {
        outcome: "accepted" as const,
        disposition:
          inputs.length > 1 ? ("queued" as const) : ("steered" as const),
        turnId,
        providerTurnId: null,
      };
    } catch (error) {
      return {
        outcome: "rejected" as const,
        error: driverError({
          code: "claude_steer_rejected",
          category: "provider",
          message: "Claude Code rejected steering input",
          detail: error instanceof Error ? error.message : String(error),
        }),
      };
    }
  },

  async cancelTurn(params) {
    const session = requireSession(params.attachmentId);
    if (session.activeTurnId !== params.turnId)
      return { outcome: "not_active" as const };
    await closeClaudeThreadSession(session, true);
    session.streamEnded = true;
    session.translator.settleCancelled();
    session.activeTurnId = null;
    return { outcome: "cancellation_requested" as const };
  },

  async shutdown() {
    await Promise.all(
      [...sessionsByAttachmentId.values()].map((session) =>
        closeSession(session),
      ),
    );
  },
});
