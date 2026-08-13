import type {
  AvailableModel,
  ClientTurnRequestId,
  ClaudeCodeMockCliTrafficConfig,
  DynamicTool,
  InstructionMode,
  PendingInteractionPayload,
  PendingInteractionResolution,
  PromptInput,
  ProviderCapabilities,
  ReasoningLevel,
  RuntimePermissionPolicy,
  RuntimeThreadExecutionOptions,
  ServiceTier,
  ThreadEvent,
} from "@bb/domain";
import type {
  JsonRpcObject,
  ProviderInboundRequest,
  ProviderRuntimeEvent,
} from "../runtime-json-rpc.js";
import type { AgentRuntimeSkillRoot } from "../types.js";

export interface ProviderTranslationContext {
  threadId?: string;
  parentToolCallId?: string;
}

export type ProviderExecutionContext = {
  model?: string;
  serviceTier?: ServiceTier;
  reasoningLevel?: ReasoningLevel;
  claudeCodePermissionMode?: "plan";
  claudeCodeMockCliTraffic: ClaudeCodeMockCliTrafficConfig;
  workflowsEnabled: boolean;
  memoryEnabled?: boolean;
  providerSubagentsEnabled?: boolean;
  instructions?: string;
  envVars?: Record<string, string>;
  skillRoots?: readonly AgentRuntimeSkillRoot[];
} & RuntimePermissionPolicy;

export interface DecodedToolCallRequest {
  requestId: string | number;
  providerThreadId: string;
  /** Non-empty BB turn id when known; null delegates to the active turn. */
  turnId: string | null;
  callId: string;
  tool: string;
  arguments?: unknown;
  threadId?: string;
}

export interface DecodedInteractiveRequest {
  requestId: string | number;
  method: string;
  providerThreadId: string;
  /** Non-empty BB turn id when known; null delegates to the active turn. */
  turnId: string | null;
  payload: PendingInteractionPayload;
  threadId?: string;
}

export type ProviderInteractiveResponse =
  | boolean
  | number
  | string
  | null
  | ProviderInteractiveResponse[]
  | { [key: string]: ProviderInteractiveResponse | undefined };

export interface BuildInteractiveResponseArgs {
  request: DecodedInteractiveRequest;
  resolution: PendingInteractionResolution;
}

export type ProviderExecutionSettingsChange = "unchanged" | "live" | "session";

export interface ClassifyProviderExecutionSettingsChangeArgs {
  current: RuntimeThreadExecutionOptions;
  next: RuntimeThreadExecutionOptions;
}

export interface ProviderDriverConnectionIdentity {
  displayName: string;
  providerId: string;
}

export interface ProviderDriverSessionOpenArgs {
  bbThreadId: string;
  cwd: string;
  dynamicTools?: DynamicTool[];
  disallowedTools?: readonly string[];
  execution: ProviderExecutionContext;
  instructionMode: InstructionMode;
  mode:
    | { kind: "start" }
    | { kind: "resume"; providerSessionId: string }
    | {
        kind: "fork";
        sourceProviderSessionId: string;
        sourceProviderCheckpointId?: string;
      };
}

/**
 * Legacy adapters can return identity in the request result, in a later event,
 * or both. `providerSessionIdForCleanup` is an intentionally broader identity
 * candidate used only to discard a partially opened compatibility session.
 */
export interface ProviderDriverSessionOpenResult {
  disposition: "opened" | "unchanged";
  events: ThreadEvent[];
  providerSessionId: string | null;
  providerSessionIdForCleanup: string | null;
}

export interface ProviderDriverTurnSubmitArgs {
  bbThreadId: string;
  clientRequestId: ClientTurnRequestId;
  execution: ProviderExecutionContext;
  input: PromptInput[];
  inputGroups?: PromptInput[][];
  mode: { kind: "start" } | { kind: "steer"; expectedTurnId: string };
  providerSessionId: string;
}

export interface ProviderDriverStopSessionArgs {
  activeTurnId: string | null;
  bbThreadId: string;
  providerSessionId: string;
}

export interface ProviderDriverStopSessionResult {
  disposition: "stopped" | "unchanged";
  events: ThreadEvent[];
  noopReason: string | null;
  providerCheckpointId: string | null;
}

export interface ProviderDriverSessionTarget {
  bbThreadId: string;
  providerSessionId: string;
}

export interface ProviderDriverRenameSessionArgs extends ProviderDriverSessionTarget {
  title: string;
}

export interface ProviderDriverSetSessionArchivedArgs extends ProviderDriverSessionTarget {
  archived: boolean;
}

export interface ProviderDriverClearSessionGoalResult {
  cleared: boolean;
}

/**
 * Daemon-side semantic seam for one provider process.
 *
 * The first implementation is a compatibility connection around the existing
 * adapter protocol. Its ThreadEvent translation and asynchronous session-id
 * fallback are explicit migration debt. Canonical process connections will
 * replace those behaviors with @bb/provider-driver-contract results/events.
 */
export interface ProviderDriverConnection {
  readonly approvalRequestPolicy: "runtime" | "provider";
  readonly capabilities: ProviderCapabilities;
  readonly identity: ProviderDriverConnectionIdentity;
  readonly supportsInteractiveResponses: boolean;

  normalizeExecutionOptions(
    options: RuntimeThreadExecutionOptions,
  ): RuntimeThreadExecutionOptions;
  classifyExecutionSettingsChange(args: {
    current: RuntimeThreadExecutionOptions;
    next: RuntimeThreadExecutionOptions;
  }): ProviderExecutionSettingsChange;

  initialize(skillRoots: readonly AgentRuntimeSkillRoot[]): Promise<void>;
  inspectModels(args: { cwd?: string }): Promise<{
    models: AvailableModel[];
    selectedOnlyModels: AvailableModel[];
  }>;
  openSession(
    args: ProviderDriverSessionOpenArgs,
    options?: {
      /** Legacy rewind staging never invoked accepted-command translation. */
      synthesizeAcceptedEvents?: boolean;
      timeoutMs?: number;
    },
  ): Promise<ProviderDriverSessionOpenResult>;
  submitTurn(args: ProviderDriverTurnSubmitArgs): Promise<ThreadEvent[]>;
  stopSession(
    args: ProviderDriverStopSessionArgs,
  ): Promise<ProviderDriverStopSessionResult>;
  discardSession(args: ProviderDriverSessionTarget): Promise<void>;
  clearSessionGoal(
    args: ProviderDriverSessionTarget,
  ): Promise<ProviderDriverClearSessionGoalResult>;
  renameSession(args: ProviderDriverRenameSessionArgs): Promise<ThreadEvent[]>;
  setSessionArchived(
    args: ProviderDriverSetSessionArchivedArgs,
  ): Promise<ThreadEvent[]>;

  translateEvent(
    event: ProviderRuntimeEvent,
    context?: ProviderTranslationContext,
  ): ThreadEvent[];
  buildSessionDetachedEvents(bbThreadId: string): ThreadEvent[];

  decodeToolCallRequest(
    request: ProviderInboundRequest,
  ): DecodedToolCallRequest | null;
  decodeInteractiveRequest(
    request: ProviderInboundRequest,
  ): DecodedInteractiveRequest | null;
  buildInteractiveResponse(
    args: BuildInteractiveResponseArgs,
  ): ProviderInteractiveResponse;

  settleResponse(id: string | number, response: JsonRpcObject): void;
  sendError(args: {
    code?: number;
    id: string | number;
    message: string;
  }): void;
  sendResult(args: { id: string | number; result: unknown }): void;
  rejectPendingRequests(error: Error): void;
}
