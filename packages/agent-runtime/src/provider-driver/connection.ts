import type {
  ClientTurnRequestId,
  ClaudeCodeMockCliTrafficConfig,
  DynamicTool,
  InstructionMode,
  JsonObject,
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
import type { ProviderDriverInspectResult } from "@bb/provider-driver-contract";
import type { AgentRuntimeSkillRoot } from "../types.js";

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
  outputSchema?: JsonObject;
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
 * The cleanup identity remains explicit so a partially opened provider
 * session can be discarded if later runtime setup fails.
 */
export interface ProviderDriverSessionOpenResult {
  events: ThreadEvent[];
  providerSessionId: string;
  providerSessionIdForCleanup: string;
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

export type ProviderDriverTurnSubmissionResult =
  | { disposition: "accepted"; events: ThreadEvent[] }
  | {
      disposition: "stale";
      activeTurnId: string | null;
      events: ThreadEvent[];
    };

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
 * Every production and test provider uses a canonical process connection.
 */
export interface ProviderDriverConnection {
  readonly capabilities: ProviderCapabilities;
  readonly identity: ProviderDriverConnectionIdentity;

  normalizeExecutionOptions(
    options: RuntimeThreadExecutionOptions,
  ): RuntimeThreadExecutionOptions;
  classifyExecutionSettingsChange(args: {
    current: RuntimeThreadExecutionOptions;
    next: RuntimeThreadExecutionOptions;
  }): ProviderExecutionSettingsChange;

  initialize(skillRoots: readonly AgentRuntimeSkillRoot[]): Promise<void>;
  inspectModels(args: { cwd?: string }): Promise<ProviderDriverInspectResult>;
  openSession(
    args: ProviderDriverSessionOpenArgs,
    options?: { timeoutMs?: number },
  ): Promise<ProviderDriverSessionOpenResult>;
  submitTurn(
    args: ProviderDriverTurnSubmitArgs,
  ): Promise<ProviderDriverTurnSubmissionResult>;
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

  resolveAttachment(attachmentId: string): {
    bbThreadId: string;
    providerSessionId: string;
  } | null;
  onEvent(listener: (events: ThreadEvent[]) => void): () => void;
  rejectPendingRequests(error: Error): void;
}
