import type {
  ClientTurnRequestId,
  DynamicTool,
  InstructionMode,
  JsonObject,
  PendingInteractionCreate,
  PendingInteractionResolution,
  PromptInput,
  ProviderCapabilities,
  RuntimeThreadExecutionOptions,
  ThreadEvent,
  ToolCallRequest,
  ToolCallResponse,
} from "@bb/domain";
import type { ProviderDriverInspectResult } from "@bb/provider-driver-contract";
import type { HostDaemonProviderDriverLaunchSpec } from "@bb/host-daemon-contract";

export type AgentRuntimeShellEnvironment = Record<string, string>;

export type AgentRuntimeExecutionOptions = RuntimeThreadExecutionOptions;

/** Host-local executable acquired from an immutable provider-driver artifact. */
export interface AgentRuntimeResolvedProviderDriverLaunch {
  artifactDigest: string;
  capabilities: ProviderCapabilities;
  config: JsonObject;
  displayName: string;
  identity: { driverId: string; pluginId: string; providerId: string };
  process: { command: string; args: string[]; env?: Record<string, string> };
  providerDataDir: string;
  processCapabilities: { multiplexSessions: boolean };
  supportsLiveExecutionChanges: boolean;
  release(): void;
}

export interface AgentRuntimeSkillSource {
  id: string;
  /** Root of the staged skill package. Skills live under its `skills/` child. */
  rootPath: string;
  skills: readonly { description: string; name: string }[];
}

/**
 * Final per-thread state snapshot taken when a provider process exits,
 * captured before the runtime clears the thread's state. This is the only
 * way consumers can see which turn a crashed thread was running.
 */
export interface AgentRuntimeProcessExitThreadState {
  activeTurnId: string | null;
  providerThreadId: string | null;
  threadId: string;
}

export interface AgentRuntimeProcessExitInfo {
  providerId: string;
  threads: AgentRuntimeProcessExitThreadState[];
  code: number | null;
  expected: boolean;
  signal: string | null;
  stderr: string | null;
}

// ---------------------------------------------------------------------------
// Runtime options
// ---------------------------------------------------------------------------

export interface AgentRuntimeOptions {
  /** Working directory for provider processes. */
  workspacePath: string;

  /** Extra paths workspace-write providers may mutate in addition to workspacePath. */
  additionalWorkspaceWriteRoots?: readonly string[];

  /** Environment variables passed to ALL provider processes. */
  env?: Record<string, string>;

  /** Environment variables injected into agent shell execution through provider drivers. */
  shellEnv?: AgentRuntimeShellEnvironment;

  /** Root directory containing per-thread storage directories. */
  threadStorageRootPath?: string;

  /** Optional caller-provided staged skill packages to expose to sessions. */
  skillSources?: readonly AgentRuntimeSkillSource[];

  /** Acquire and verify a plugin-contributed provider driver on this host. */
  resolveProviderDriverLaunch?: (
    spec: HostDaemonProviderDriverLaunchSpec,
  ) => Promise<AgentRuntimeResolvedProviderDriverLaunch>;

  /** Called when a provider emits a translated event.
   *  Every event has `threadId` (bb ID) and `providerThreadId` (provider's internal ID). */
  onEvent: (event: ThreadEvent) => void;

  /** Called when a provider needs to execute a tool.
   *  `threadId` is always the BB thread id and `providerThreadId` is always present. */
  onToolCall: (request: ToolCallRequest) => Promise<ToolCallResponse>;

  /** Called when a provider pauses for user permission or approval.
   *  The runtime converts provider-native requests into bb's shared pending-interaction contract. */
  onInteractiveRequest?: (
    request: PendingInteractionCreate,
  ) => Promise<PendingInteractionResolution>;

  /** Called on provider stderr lines. */
  onStderr?: (line: string, threadId?: string) => void;

  /** Called when a provider process exits unexpectedly. */
  onProcessExit?: (info: AgentRuntimeProcessExitInfo) => void;
}

// ---------------------------------------------------------------------------
// Runtime interface
// ---------------------------------------------------------------------------

export interface EnsureProviderArgs {
  providerDriver?: HostDaemonProviderDriverLaunchSpec;
  /**
   * Providers with thread-scoped processes use this to start the process for a
   * specific bb thread. Omit it for provider-scoped maintenance work such as
   * model listing.
   */
  forThreadId?: string;
  providerId: string;
}

export interface StartThreadArgs {
  providerDriver?: HostDaemonProviderDriverLaunchSpec;
  environmentId: string;
  threadId: string;
  projectId: string;
  providerId: string;
  clientRequestId?: ClientTurnRequestId;
  input?: PromptInput[];
  inputGroups?: PromptInput[][];
  options: AgentRuntimeExecutionOptions;
  instructions?: string;
  dynamicTools?: DynamicTool[];
  disallowedTools?: readonly string[];
  instructionMode?: InstructionMode;
  /** JSON Schema constraining the session's structured output. Drivers that
   *  do not support structured output reject it. Absent means unconstrained. */
  outputSchema?: JsonObject;
  /**
   * Present means fork the new thread from this source provider session
   * instead of starting fresh; absent means a normal start.
   */
  fork?: { sourceProviderThreadId: string };
}

export interface StartThreadResult {
  providerThreadId: string;
}

export interface PrepareThreadRewindArgs {
  providerDriver?: HostDaemonProviderDriverLaunchSpec;
  environmentId: string;
  threadId: string;
  leaseId: string;
  projectId: string;
  providerId: string;
  sourceProviderThreadId: string;
  retainThroughProviderCheckpoint: string;
  options: AgentRuntimeExecutionOptions;
  instructions?: string;
  dynamicTools?: DynamicTool[];
  disallowedTools?: readonly string[];
  instructionMode?: InstructionMode;
}

export interface PrepareThreadRewindResult {
  providerThreadId: string;
}

export interface DiscardThreadRewindArgs {
  leaseId: string;
}

export interface ResumeThreadArgs {
  providerDriver?: HostDaemonProviderDriverLaunchSpec;
  environmentId: string;
  threadId: string;
  projectId?: string;
  providerThreadId?: string;
  providerId: string;
  options: AgentRuntimeExecutionOptions;
  instructions?: string;
  dynamicTools?: DynamicTool[];
  disallowedTools?: readonly string[];
  instructionMode?: InstructionMode;
}

export interface ResumeThreadResult {
  providerThreadId: string;
}

export interface RunTurnArgs {
  threadId: string;
  input: PromptInput[];
  inputGroups?: PromptInput[][];
  clientRequestId: ClientTurnRequestId;
  options: AgentRuntimeExecutionOptions;
  instructions?: string;
}

export interface SteerTurnArgs {
  threadId: string;
  expectedTurnId: string;
  input: PromptInput[];
  inputGroups?: PromptInput[][];
  clientRequestId: ClientTurnRequestId;
  options: AgentRuntimeExecutionOptions;
  instructions?: string;
}

export interface SteerTurnAppliedResult {
  status: "steered";
}

export interface SteerTurnStaleResult {
  status: "stale";
  activeTurnId: string | null;
}

export type SteerTurnResult = SteerTurnAppliedResult | SteerTurnStaleResult;

export interface StopThreadArgs {
  threadId: string;
}

export interface StopThreadResult {
  providerCheckpointId: string | null;
}

export interface AgentRuntimeProviderSession {
  providerId: string;
  providerThreadId: string;
}

export interface WaitForActiveTurnArgs {
  timeoutMs: number;
}

export interface ReapIdleProviderSessionsArgs {
  idleForMs: number;
  nowMs: number;
}

export interface ReapedIdleProviderSession {
  idleForMs: number;
  providerId: string;
  providerThreadId: string;
  threadId: string;
}

export interface ReapIdleProviderSessionsResult {
  reapedSessions: ReapedIdleProviderSession[];
}

export interface RenameThreadArgs {
  threadId: string;
  title: string;
}

export interface ClearThreadGoalArgs {
  threadId: string;
}

export interface ArchiveThreadArgs {
  providerDriver?: HostDaemonProviderDriverLaunchSpec;
  providerId: string;
  providerThreadId: string;
  threadId: string;
}

export interface UnarchiveThreadArgs {
  providerDriver?: HostDaemonProviderDriverLaunchSpec;
  providerId: string;
  providerThreadId: string;
  threadId: string;
}

export interface ListModelsArgs {
  providerDriver?: HostDaemonProviderDriverLaunchSpec;
  providerId: string;
  cwd?: string;
}

export interface AgentRuntime {
  ensureProvider(args: EnsureProviderArgs): Promise<void>;

  startThread(args: StartThreadArgs): Promise<StartThreadResult>;

  prepareThreadRewind(
    args: PrepareThreadRewindArgs,
  ): Promise<PrepareThreadRewindResult>;

  discardThreadRewind(args: DiscardThreadRewindArgs): Promise<void>;

  resumeThread(args: ResumeThreadArgs): Promise<ResumeThreadResult>;

  runTurn(args: RunTurnArgs): Promise<void>;

  steerTurn(args: SteerTurnArgs): Promise<SteerTurnResult>;

  /**
   * Stops the thread's active turn and removes the thread from the runtime:
   * identity, execution config, and turn state are cleared, so `hasThread`
   * reports `false` afterwards and the next turn must go through
   * `resumeThread`. The provider process keeps running for other threads.
   */
  stopThread(args: StopThreadArgs): Promise<StopThreadResult>;

  clearThreadGoal(args: ClearThreadGoalArgs): Promise<{ cleared: boolean }>;

  renameThread(args: RenameThreadArgs): Promise<void>;

  archiveThread(args: ArchiveThreadArgs): Promise<void>;

  unarchiveThread(args: UnarchiveThreadArgs): Promise<void>;

  listModels(args: ListModelsArgs): Promise<ProviderDriverInspectResult>;

  listRunningProviders(): string[];

  /** Active turn id for the thread, or `null` when no turn is running. */
  getActiveTurnId(threadId: string): string | null;

  /**
   * Resolves with the active turn id as soon as one is known: immediately if
   * a turn is already active, on the next `turn/started` observation
   * otherwise. Resolves `null` on timeout or when the thread goes idle
   * (stopped, cleared, or its provider process exits) before a turn starts.
   */
  waitForActiveTurn(
    threadId: string,
    args: WaitForActiveTurnArgs,
  ): Promise<string | null>;

  /** Provider identity for a hosted thread, or `null` when not hosted. */
  getProviderSession(threadId: string): AgentRuntimeProviderSession | null;

  /**
   * Stops idle live provider sessions without deleting bb thread state or
   * provider history. The next turn must resume from the persisted provider
   * thread id.
   */
  reapIdleProviderSessions(
    args: ReapIdleProviderSessionsArgs,
  ): Promise<ReapIdleProviderSessionsResult>;

  /** Whether the runtime currently hosts the thread (turns can run on it). */
  hasThread(threadId: string): boolean;

  /** Thread ids with an active turn or an accepted turn awaiting its first event. */
  getLiveThreadIds(): string[];

  /**
   * Whether any hosted thread still has an open background task (a workflow or
   * backgrounded command). These outlive their spawning turn, so a runtime with
   * no active turn can still be doing real work that a shutdown would destroy.
   */
  hasOpenBackgroundWork(): boolean;

  shutdown(): Promise<void>;
}
