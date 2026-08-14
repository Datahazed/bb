/**
 * Canonical Codex provider driver.
 *
 * Owns an isolated Codex app-server subprocess and translates its native
 * newline-delimited JSON-RPC protocol into bb's canonical framed protocol.
 *
 * Reference: https://github.com/openai/codex (codex-rs/app-server-protocol/)
 */

import { z } from "zod";
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
import {
  createCodexAppServerConnection,
  type CodexAppServerConnection,
} from "./app-server-connection.js";
import { CodexCanonicalEventTranslator } from "./canonical-event-translator.js";
import {
  buildCodexInteractiveResponse,
  decodeCodexInteractiveRequest,
} from "./interactive-requests.js";
import { decodeNativeProviderToolCallRequest } from "../shared/provider-tool-call-contract.js";
import fs from "node:fs";
import path from "node:path";
import {
  isStandaloneBuiltinCompactCommand,
  jsonObjectSchema,
  jsonValueSchema,
} from "@bb/domain";
import type {
  PermissionEscalation,
  PromptInput,
  ReasoningLevel,
  ServiceTier,
} from "@bb/domain";
import type { ReasoningEffort as CodexReasoningEffort } from "./generated/codex-app-server/schema/ReasoningEffort.js";
import type { JsonValue } from "./generated/codex-app-server/schema/serde_json/JsonValue.js";
import type { SandboxPolicy } from "./generated/codex-app-server/schema/v2/SandboxPolicy.js";
import type { DynamicToolSpec } from "./generated/codex-app-server/schema/v2/DynamicToolSpec.js";
import type { SandboxMode as CodexSandboxMode } from "./generated/codex-app-server/schema/v2/SandboxMode.js";
import type { ThreadCompactStartParams } from "./generated/codex-app-server/schema/v2/ThreadCompactStartParams.js";
import type { ThreadResumeParams } from "./generated/codex-app-server/schema/v2/ThreadResumeParams.js";
import type { ThreadStartParams } from "./generated/codex-app-server/schema/v2/ThreadStartParams.js";
import type { UserInput as CodexUserInput } from "./generated/codex-app-server/schema/v2/UserInput.js";
import type { AskForApproval } from "./generated/codex-app-server/schema/v2/AskForApproval.js";
import type { ApprovalsReviewer } from "./generated/codex-app-server/schema/v2/ApprovalsReviewer.js";
import { mapBbReasoningLevelToCodex, parseModelsResponse } from "./models.js";
import { buildShellEnvironmentPolicyConfig } from "../shared/provider-utils.js";
import type { ProviderExecutionContext } from "../provider-driver/connection.js";
import { flattenPromptInputGroups } from "../shared/prompt-input-groups.js";

interface CodexPermissionSettings {
  approvalPolicy: AskForApproval;
  approvalsReviewer: ApprovalsReviewer;
  sandbox: CodexSandboxMode;
  sandboxPolicy: SandboxPolicy;
}

interface CodexThreadPermissionSettings {
  approvalPolicy: AskForApproval;
  approvalsReviewer: ApprovalsReviewer;
  sandbox: CodexSandboxMode;
}

type BbThreadStartParams = ThreadStartParams & {
  experimentalRawEvents?: boolean;
};

type BbThreadForkParams = {
  threadId: string;
  lastTurnId?: string | null;
  model?: string | null;
  serviceTier?: string | null;
  cwd?: string | null;
  approvalPolicy?: AskForApproval | null;
  approvalsReviewer?: ApprovalsReviewer | null;
  sandbox?: CodexSandboxMode | null;
  config?: { [key in string]?: JsonValue } | null;
  baseInstructions?: string | null;
  developerInstructions?: string | null;
  dynamicTools?: DynamicToolSpec[];
};

interface ToCodexPermissionSettingsArgs {
  additionalWorkspaceWriteRoots: readonly string[];
  gitWritableRoots: readonly string[];
  options: ProviderExecutionContext;
}

interface BuildCodexConfigArgs {
  additionalWorkspaceWriteRoots: readonly string[];
  gitWritableRoots: readonly string[];
  options?: ProviderExecutionContext;
  threadId: string;
}

interface RealpathContainedDirectoryArgs {
  candidatePath: string;
  trustedParentPath: string;
}

interface RegularFileInsideDirectoryArgs {
  filePath: string;
  trustedParentPath: string;
}

interface AddRefWritableRootsArgs {
  commonDir: string;
  headRef: string | null;
  writableRoots: string[];
}

interface AddDetachedHeadWritableRootsArgs {
  commonDir: string;
  writableRoots: string[];
}

interface AddOptionalContainedDirectoryArgs extends RealpathContainedDirectoryArgs {
  writableRoots: string[];
}

interface LinkedWorktreeGitDirBelongsToWorkspaceArgs {
  gitDir: string;
  workspaceGitFile: string;
  workspacePath: string;
}

interface ContainedDirectoryResult {
  path: string;
  status: "contained";
}

interface MissingDirectoryResult {
  status: "missing";
}

interface EscapedDirectoryResult {
  status: "escaped";
}

type RealpathContainedDirectoryResult =
  | ContainedDirectoryResult
  | MissingDirectoryResult
  | EscapedDirectoryResult;

type GitHeadState =
  | { type: "detached" }
  | { ref: string; type: "ref" }
  | { type: "unsafe" };

interface CodexInstructionOverrides {
  baseInstructions?: ThreadStartParams["baseInstructions"];
  developerInstructions?: ThreadStartParams["developerInstructions"];
}

const CODEX_ARCHIVED_SESSION_ERROR_PATTERN =
  /(?:\b(?:session|thread)\s+\S+\s+is archived\b|\bno rollout found for thread id \S+)/iu;

function archivedSessionIdForOpen(
  mode: ProviderSessionOpenParams["mode"],
): string | null {
  switch (mode.kind) {
    case "start":
      return null;
    case "resume":
      return mode.providerSessionId;
    case "fork":
      return mode.sourceProviderSessionId;
  }
}

function isArchivedSessionError(error: unknown): error is Error {
  return (
    error instanceof Error &&
    CODEX_ARCHIVED_SESSION_ERROR_PATTERN.test(error.message)
  );
}

function isAlreadyArchivedStateError(
  archived: boolean,
  error: unknown,
): boolean {
  if (!(error instanceof Error)) return false;
  return archived
    ? error.message.includes("no rollout found for thread id")
    : error.message.includes("no archived rollout found for thread id");
}

async function unarchiveCodexSession(
  connection: CodexAppServerConnection,
  providerSessionId: string,
): Promise<void> {
  await connection.request({
    method: "thread/unarchive",
    params: { threadId: providerSessionId },
    resultSchema: z.unknown(),
  });
}

async function withArchivedSessionRecovery<Result>(args: {
  providerSessionId: string | null;
  request(): Promise<Result>;
  unarchive(providerSessionId: string): Promise<void>;
}): Promise<Result> {
  try {
    return await args.request();
  } catch (error) {
    if (args.providerSessionId === null || !isArchivedSessionError(error)) {
      throw error;
    }
    try {
      await args.unarchive(args.providerSessionId);
    } catch (recoveryError) {
      const recoveryMessage =
        recoveryError instanceof Error
          ? recoveryError.message
          : String(recoveryError);
      throw new Error(
        `${error.message}; automatic unarchive failed: ${recoveryMessage}`,
        { cause: recoveryError },
      );
    }
    return args.request();
  }
}

function toWorkspaceWriteCodexSandboxPolicy(
  writableRoots: readonly string[],
): SandboxPolicy {
  return {
    type: "workspaceWrite",
    writableRoots: [...writableRoots],
    networkAccess: true,
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false,
  };
}

function toEscalationApprovalPolicy(
  escalation: PermissionEscalation,
): AskForApproval {
  return escalation === "deny" ? "never" : "on-request";
}

function toWorkspaceApprovalPolicy(options: {
  approvalReviewer: "automatic" | "user";
  permissionEscalation: PermissionEscalation;
}): AskForApproval {
  if (options.approvalReviewer === "automatic") {
    return "on-request";
  }
  return toEscalationApprovalPolicy(options.permissionEscalation);
}

function readTextFileIfPresent(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function realpathDirectoryIfPresent(directoryPath: string): string | null {
  try {
    if (!fs.statSync(directoryPath).isDirectory()) {
      return null;
    }
    return fs.realpathSync.native(directoryPath);
  } catch {
    return null;
  }
}

function regularFilePathInsideDirectoryIfPresent(
  args: RegularFileInsideDirectoryArgs,
): string | null {
  try {
    const filePath = path.normalize(args.filePath);
    if (
      !fs.lstatSync(filePath).isFile() ||
      !isPathInsideOrEqual(args.trustedParentPath, filePath)
    ) {
      return null;
    }
    return filePath;
  } catch {
    return null;
  }
}

function resolveGitPath(cwd: string, rawPath: string): string {
  return path.isAbsolute(rawPath)
    ? path.normalize(rawPath)
    : path.normalize(path.resolve(cwd, rawPath));
}

function parseGitDirPointer(content: string): string | null {
  const firstLine = content.split(/\r?\n/u)[0]?.trim();
  if (!firstLine?.startsWith("gitdir:")) {
    return null;
  }
  const rawGitDir = firstLine.slice("gitdir:".length).trim();
  return rawGitDir.length > 0 ? rawGitDir : null;
}

function parseGitHeadState(content: string | null): GitHeadState {
  const firstLine = content?.split(/\r?\n/u)[0]?.trim();
  if (!firstLine) {
    return { type: "unsafe" };
  }
  if (!firstLine.startsWith("ref:")) {
    return /^[0-9a-fA-F]{40}([0-9a-fA-F]{24})?$/u.test(firstLine)
      ? { type: "detached" }
      : { type: "unsafe" };
  }
  const ref = firstLine.slice("ref:".length).trim();
  return ref.length > 0 ? { type: "ref", ref } : { type: "unsafe" };
}

function resolveCommonGitDir(gitDir: string): string | null {
  const commonDirContent = readTextFileIfPresent(
    path.join(gitDir, "commondir"),
  );
  const commonDir = commonDirContent?.split(/\r?\n/u)[0]?.trim();
  if (!commonDir) {
    return null;
  }
  return path.isAbsolute(commonDir)
    ? path.normalize(commonDir)
    : path.normalize(path.resolve(gitDir, commonDir));
}

function linkedWorktreeGitDirBelongsToWorkspace(
  args: LinkedWorktreeGitDirBelongsToWorkspaceArgs,
): boolean {
  const rawBacklink = readTextFileIfPresent(path.join(args.gitDir, "gitdir"))
    ?.split(/\r?\n/u)[0]
    ?.trim();
  if (!rawBacklink) {
    return false;
  }

  const linkedGitFile = regularFilePathInsideDirectoryIfPresent({
    filePath: resolveGitPath(args.gitDir, rawBacklink),
    trustedParentPath: args.workspacePath,
  });
  return linkedGitFile === args.workspaceGitFile;
}

function isPathInsideOrEqual(
  parentPath: string,
  candidatePath: string,
): boolean {
  const relative = path.relative(parentPath, candidatePath);
  return (
    relative === "" ||
    (relative.length > 0 &&
      !relative.startsWith("..") &&
      !path.isAbsolute(relative))
  );
}

/**
 * Resolves directory symlinks before containment checks so mutable Git metadata
 * cannot smuggle Codex writable roots outside the trusted common dir.
 */
function realpathContainedDirectory(
  args: RealpathContainedDirectoryArgs,
): RealpathContainedDirectoryResult {
  const realCandidatePath = realpathDirectoryIfPresent(args.candidatePath);
  if (!realCandidatePath) {
    return { status: "missing" };
  }
  if (!isPathInsideOrEqual(args.trustedParentPath, realCandidatePath)) {
    return { status: "escaped" };
  }
  return { status: "contained", path: realCandidatePath };
}

function isSafeGitHeadRef(ref: string): boolean {
  return (
    ref.startsWith("refs/") &&
    !path.isAbsolute(ref) &&
    !ref.includes("\\") &&
    !ref.split("/").some((part) => part === "" || part === "." || part === "..")
  );
}

function addOptionalContainedDirectory(
  args: AddOptionalContainedDirectoryArgs,
): boolean {
  const result = realpathContainedDirectory({
    trustedParentPath: args.trustedParentPath,
    candidatePath: args.candidatePath,
  });
  switch (result.status) {
    case "contained":
      args.writableRoots.push(result.path);
      return true;
    case "missing":
      return true;
    case "escaped":
      return false;
  }
}

function addRefWritableRoots(args: AddRefWritableRootsArgs): boolean {
  if (!args.headRef || !isSafeGitHeadRef(args.headRef)) {
    return true;
  }

  // Missing ref/log dirs are valid; escaped existing dirs make the linked
  // worktree metadata untrusted, so reject all extra Git roots.
  const refsRoot = realpathContainedDirectory({
    trustedParentPath: args.commonDir,
    candidatePath: path.join(args.commonDir, "refs"),
  });
  if (refsRoot.status === "escaped") {
    return false;
  }
  if (
    refsRoot.status === "contained" &&
    !addOptionalContainedDirectory({
      trustedParentPath: refsRoot.path,
      candidatePath: path.dirname(path.join(args.commonDir, args.headRef)),
      writableRoots: args.writableRoots,
    })
  ) {
    return false;
  }

  const logsRefsRoot = realpathContainedDirectory({
    trustedParentPath: args.commonDir,
    candidatePath: path.join(args.commonDir, "logs", "refs"),
  });
  if (logsRefsRoot.status === "escaped") {
    return false;
  }
  if (
    logsRefsRoot.status === "contained" &&
    !addOptionalContainedDirectory({
      trustedParentPath: logsRefsRoot.path,
      candidatePath: path.dirname(
        path.join(args.commonDir, "logs", args.headRef),
      ),
      writableRoots: args.writableRoots,
    })
  ) {
    return false;
  }
  return true;
}

function addDetachedHeadWritableRoots(
  args: AddDetachedHeadWritableRootsArgs,
): boolean {
  return (
    addOptionalContainedDirectory({
      trustedParentPath: args.commonDir,
      candidatePath: path.join(args.commonDir, "refs", "heads"),
      writableRoots: args.writableRoots,
    }) &&
    addOptionalContainedDirectory({
      trustedParentPath: args.commonDir,
      candidatePath: path.join(args.commonDir, "logs", "refs", "heads"),
      writableRoots: args.writableRoots,
    })
  );
}

function gitWritableRootsForWorkspace(cwd: string | undefined): string[] {
  const workspacePath = cwd ? realpathDirectoryIfPresent(cwd) : null;
  if (!workspacePath) {
    return [];
  }

  const dotGitPath = path.join(workspacePath, ".git");
  const workspaceGitFile = regularFilePathInsideDirectoryIfPresent({
    filePath: dotGitPath,
    trustedParentPath: workspacePath,
  });
  if (!workspaceGitFile) {
    return [];
  }
  const dotGitContent = readTextFileIfPresent(workspaceGitFile);
  if (!dotGitContent) {
    return [];
  }
  const rawGitDir = parseGitDirPointer(dotGitContent);
  if (!rawGitDir) {
    return [];
  }
  const gitDir = realpathDirectoryIfPresent(
    resolveGitPath(workspacePath, rawGitDir),
  );
  if (!gitDir) {
    return [];
  }
  if (
    !linkedWorktreeGitDirBelongsToWorkspace({
      gitDir,
      workspaceGitFile,
      workspacePath,
    })
  ) {
    return [];
  }

  const commonDirCandidate = resolveCommonGitDir(gitDir);
  const commonDir = commonDirCandidate
    ? realpathDirectoryIfPresent(commonDirCandidate)
    : null;
  if (!commonDir) {
    return [];
  }

  const worktreesRoot = realpathContainedDirectory({
    trustedParentPath: commonDir,
    candidatePath: path.join(commonDir, "worktrees"),
  });
  if (
    worktreesRoot.status !== "contained" ||
    !isPathInsideOrEqual(worktreesRoot.path, gitDir)
  ) {
    return [];
  }

  const objectsRoot = realpathContainedDirectory({
    trustedParentPath: commonDir,
    candidatePath: path.join(commonDir, "objects"),
  });
  if (objectsRoot.status !== "contained") {
    // Missing objects or shared object stores/alternates may be legitimate Git
    // layouts, but Codex workspace-write should not follow object storage
    // outside this worktree's trusted common dir. Fall back to workspace-only
    // access.
    return [];
  }

  const writableRoots = [gitDir, objectsRoot.path];
  const headState = parseGitHeadState(
    readTextFileIfPresent(path.join(gitDir, "HEAD")),
  );
  switch (headState.type) {
    case "detached":
      if (!addDetachedHeadWritableRoots({ commonDir, writableRoots })) {
        return [];
      }
      break;
    case "ref":
      if (
        !addRefWritableRoots({
          commonDir,
          headRef: headState.ref,
          writableRoots,
        })
      ) {
        return [];
      }
      break;
    case "unsafe":
      break;
  }

  return [...new Set(writableRoots)];
}

function combineWorkspaceWriteRoots(
  roots: readonly string[],
  additionalRoots: readonly string[],
): string[] {
  return [...new Set([...additionalRoots, ...roots])];
}

function toCodexApprovalsReviewer(
  options: ProviderExecutionContext,
): ApprovalsReviewer {
  if (
    options.approvalReviewer === "automatic" &&
    options.permissionEscalation === "deny"
  ) {
    return "auto_review";
  }
  // BB's automatic reviewer escalates denied operations to the user in ask
  // mode. Codex's auto_review may approve them itself, so route those
  // escalation requests through the host-owned interaction flow instead.
  return "user";
}

function toCodexThreadPermissionSettings(
  options: ProviderExecutionContext,
): CodexThreadPermissionSettings {
  switch (options.permissionMode) {
    case "auto":
      return {
        approvalPolicy: toWorkspaceApprovalPolicy(options),
        approvalsReviewer: toCodexApprovalsReviewer(options),
        sandbox: "read-only",
      };
    case "accept-edits":
      return {
        approvalPolicy: toWorkspaceApprovalPolicy(options),
        approvalsReviewer: toCodexApprovalsReviewer(options),
        sandbox: "workspace-write",
      };
    case "full":
      return {
        approvalPolicy: "never",
        approvalsReviewer: toCodexApprovalsReviewer(options),
        sandbox: "danger-full-access",
      };
  }
}

function toCodexPermissionSettings(
  args: ToCodexPermissionSettingsArgs,
): CodexPermissionSettings {
  switch (args.options.permissionMode) {
    case "auto":
      return {
        approvalPolicy: toWorkspaceApprovalPolicy(args.options),
        approvalsReviewer: toCodexApprovalsReviewer(args.options),
        sandbox: "read-only",
        sandboxPolicy: { type: "readOnly", networkAccess: false },
      };
    case "accept-edits":
      return {
        approvalPolicy: toWorkspaceApprovalPolicy(args.options),
        approvalsReviewer: toCodexApprovalsReviewer(args.options),
        sandbox: "workspace-write",
        sandboxPolicy: toWorkspaceWriteCodexSandboxPolicy(
          combineWorkspaceWriteRoots(
            args.gitWritableRoots,
            args.additionalWorkspaceWriteRoots,
          ),
        ),
      };
    case "full":
      return {
        approvalPolicy: "never",
        approvalsReviewer: toCodexApprovalsReviewer(args.options),
        sandbox: "danger-full-access",
        sandboxPolicy: { type: "dangerFullAccess" },
      };
  }
}

function toCodexServiceTier(tier: ServiceTier | undefined): "fast" | undefined {
  return tier === "fast" ? "fast" : undefined;
}

function toCodexReasoningEffort(
  reasoningLevel: ReasoningLevel,
): CodexReasoningEffort {
  const codexEffort = mapBbReasoningLevelToCodex(reasoningLevel);
  if (codexEffort == null) {
    // "none" is Cursor-only; "ultracode" is Claude-specific. Codex models
    // never expose either, so model-switch reconciliation maps them away
    // before here — but fail closed if something slips through.
    throw new Error(
      `Codex does not support the ${reasoningLevel} reasoning level.`,
    );
  }
  return codexEffort;
}

function toCodexUserInput(input: PromptInput[]): CodexUserInput[] {
  return input.map((chunk): CodexUserInput => {
    switch (chunk.type) {
      case "text":
        return { type: "text", text: chunk.text, text_elements: [] };
      case "image":
        return { type: "image", url: chunk.url };
      case "localImage":
        return { type: "localImage", path: chunk.path };
      case "localFile":
        return {
          type: "text",
          text: `[Attached file: ${chunk.path}]`,
          text_elements: [],
        };
    }
  });
}

function buildCodexConfig(
  args: BuildCodexConfigArgs,
): { [key in string]?: JsonValue } | undefined {
  const config: { [key in string]?: JsonValue } = {};
  if (args.threadId) {
    config["shell_environment_policy.set.BB_THREAD_ID"] = args.threadId;
  }
  const shellEnvironmentConfig = buildShellEnvironmentPolicyConfig(
    args.options?.envVars,
  );
  if (shellEnvironmentConfig) {
    Object.assign(config, shellEnvironmentConfig);
  }
  if (args.options?.reasoningLevel) {
    config["model_reasoning_effort"] = toCodexReasoningEffort(
      args.options.reasoningLevel,
    );
  }
  config["features.default_mode_request_user_input"] = false;
  if (args.options?.providerSubagentsEnabled === false) {
    config["features.multi_agent"] = false;
    config["features.multi_agent_v2.max_concurrent_threads_per_session"] = 1;
  }
  config["memories.use_memories"] = args.options?.memoryEnabled ?? true;
  config["memories.generate_memories"] = args.options?.memoryEnabled ?? true;
  if (args.options?.permissionMode === "accept-edits") {
    const writableRoots = combineWorkspaceWriteRoots(
      args.gitWritableRoots,
      args.additionalWorkspaceWriteRoots,
    );
    if (writableRoots.length > 0) {
      config["sandbox_workspace_write.writable_roots"] = [...writableRoots];
    }
  }
  return Object.keys(config).length > 0 ? config : undefined;
}

function toCodexDynamicTools(
  dynamicTools: ProviderSessionOpenParams["dynamicTools"],
): DynamicToolSpec[] | undefined {
  return dynamicTools?.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: jsonValueSchema.parse(tool.inputSchema),
  }));
}

// ---------------------------------------------------------------------------
// Canonical driver lifecycle
// ---------------------------------------------------------------------------

interface CodexDriverSession {
  activeTurnId: string | null;
  activeTurnReady: Promise<void> | null;
  readonly attachmentId: string;
  resolveActiveTurnReady: (() => void) | null;
  readonly bbThreadId: string;
  readonly connection: CodexAppServerConnection;
  readonly context: ProviderDriverContext;
  readonly gitWritableRoots: readonly string[];
  readonly openParams: ProviderSessionOpenParams;
  readonly providerSessionId: string;
  providerTurnId: string | null;
  restartBeforeNextTurn: boolean;
  readonly translator: CodexCanonicalEventTranslator;
}

const codexSessions = new Map<string, CodexDriverSession>();
const codexThreadResultSchema = z
  .object({ thread: z.object({ id: z.string().min(1) }).passthrough() })
  .passthrough();
const codexTurnResultSchema = z
  .object({ turn: z.object({ id: z.string().min(1) }).passthrough() })
  .passthrough();
const codexModelListResultSchema = z.unknown();
const codexOperationResultSchema = z.unknown();

function codexDriverError(args: {
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

function rejectCodexRequest(
  args: Parameters<typeof codexDriverError>[0],
): never {
  throw new ProviderDriverRequestError(codexDriverError(args));
}

function requireCodexSession(attachmentId: string): CodexDriverSession {
  const session = codexSessions.get(attachmentId);
  if (!session) {
    rejectCodexRequest({
      code: "codex_session_not_found",
      category: "driver",
      message: `No Codex session for attachment ${attachmentId}`,
    });
  }
  return session;
}

function toProviderExecutionContext(
  params: ProviderSessionOpenParams,
): ProviderExecutionContext {
  return {
    model: params.execution.model,
    reasoningLevel: params.execution.reasoningLevel,
    serviceTier: params.execution.serviceTier,
    ...params.execution.permission,
    claudeCodeMockCliTraffic: {
      enabled: false,
      endpoint: "http://127.0.0.1:0",
    },
    workflowsEnabled: params.execution.features.workflowsEnabled,
    memoryEnabled: params.execution.features.memoryEnabled,
    providerSubagentsEnabled: params.execution.features.subagentsEnabled,
    instructions: params.instructions.text,
    envVars: params.shellEnvironment,
  };
}

function toTurnExecutionContext(
  params: ProviderTurnSubmitParams,
): ProviderExecutionContext {
  return {
    model: params.execution.model,
    reasoningLevel: params.execution.reasoningLevel,
    serviceTier: params.execution.serviceTier,
    ...params.execution.permission,
    claudeCodeMockCliTraffic: {
      enabled: false,
      endpoint: "http://127.0.0.1:0",
    },
    workflowsEnabled: params.execution.features.workflowsEnabled,
    memoryEnabled: params.execution.features.memoryEnabled,
    providerSubagentsEnabled: params.execution.features.subagentsEnabled,
  };
}

function instructionOverrides(
  params: ProviderSessionOpenParams,
): CodexInstructionOverrides {
  const text = params.instructions.text.trim();
  if (!text) return {};
  return params.instructions.mode === "replace"
    ? { baseInstructions: text }
    : { developerInstructions: text };
}

function buildCodexOpenParams(
  params: ProviderSessionOpenParams,
  gitWritableRoots: readonly string[],
): {
  method: "thread/start" | "thread/resume" | "thread/fork";
  params: BbThreadStartParams | ThreadResumeParams | BbThreadForkParams;
} {
  const options = toProviderExecutionContext(params);
  const permissionSettings = toCodexThreadPermissionSettings(options);
  const dynamicTools = toCodexDynamicTools(params.dynamicTools);
  const common = {
    approvalPolicy: permissionSettings.approvalPolicy,
    approvalsReviewer: permissionSettings.approvalsReviewer,
    sandbox: permissionSettings.sandbox,
    cwd: params.workspace.cwd,
    ...instructionOverrides(params),
    model: params.execution.model,
    serviceTier: toCodexServiceTier(params.execution.serviceTier),
    config:
      buildCodexConfig({
        additionalWorkspaceWriteRoots: params.workspace.additionalWriteRoots,
        gitWritableRoots,
        options,
        threadId: params.bbThreadId,
      }) ?? undefined,
    ...(dynamicTools && dynamicTools.length > 0 ? { dynamicTools } : {}),
  };
  switch (params.mode.kind) {
    case "start":
      return {
        method: "thread/start",
        params: {
          ...common,
          ephemeral: false,
          experimentalRawEvents: true,
        },
      };
    case "resume":
      return {
        method: "thread/resume",
        params: { ...common, threadId: params.mode.providerSessionId },
      };
    case "fork":
      return {
        method: "thread/fork",
        params: {
          ...common,
          threadId: params.mode.sourceProviderSessionId,
          ...(params.mode.sourceCheckpointId
            ? { lastTurnId: params.mode.sourceCheckpointId }
            : {}),
        },
      };
  }
}

function buildApprovalResponse(args: {
  method: string;
  params: unknown;
  session: CodexDriverSession;
  responder: {
    result(value: unknown): void;
    error(code: number, message: string): void;
  };
}): void {
  const decoded = decodeCodexInteractiveRequest({
    id: `codex-approval-${Date.now()}`,
    method: args.method,
    params: args.params,
  });
  if (!decoded || args.session.activeTurnId === null) {
    args.responder.error(-32602, `Unsupported Codex request ${args.method}`);
    return;
  }
  void args.session.context.host
    .requestInteraction({
      attachmentId: args.session.attachmentId,
      turnId: args.session.activeTurnId,
      requestId: String(decoded.requestId),
      payload: decoded.payload,
    })
    .then(({ resolution }) => {
      args.responder.result(
        buildCodexInteractiveResponse({ request: decoded, resolution }),
      );
    })
    .catch((error) => {
      args.responder.error(
        -32000,
        error instanceof Error ? error.message : String(error),
      );
    });
}

function handleCodexToolRequest(args: {
  method: string;
  params: unknown;
  session: CodexDriverSession;
  responder: {
    result(value: unknown): void;
    error(code: number, message: string): void;
  };
}): boolean {
  if (args.session.activeTurnId === null) return false;
  const decoded = decodeNativeProviderToolCallRequest(
    1,
    args.method,
    args.params,
  );
  if (!decoded) return false;
  void args.session.context.host
    .callTool({
      attachmentId: args.session.attachmentId,
      turnId: args.session.activeTurnId,
      callId: decoded.callId,
      tool: decoded.tool,
      arguments: jsonObjectSchema.parse(decoded.arguments ?? {}),
    })
    .then((result) => {
      args.responder.result({
        success: result.success,
        contentItems: result.content.map((item) =>
          item.type === "text"
            ? { type: "inputText", text: item.text }
            : { type: "inputImage", imageUrl: item.imageUrl },
        ),
      });
    })
    .catch((error) => {
      args.responder.error(
        -32000,
        error instanceof Error ? error.message : String(error),
      );
    });
  return true;
}

export const codexDriverTestHelpers = {
  archivedSessionIdForOpen,
  gitWritableRootsForWorkspace,
  isAlreadyArchivedStateError,
  withArchivedSessionRecovery,
  toAccountRestartOpenParams,
  toCodexPermissionSettings,
  toCodexThreadPermissionSettings,
  buildCodexConfig,
  buildCodexOpenParams,
};

async function openCodexSession(
  params: ProviderSessionOpenParams,
  context: ProviderDriverContext,
): Promise<CodexDriverSession> {
  const gitWritableRoots =
    params.execution.permission.permissionScope === "workspace"
      ? gitWritableRootsForWorkspace(params.workspace.cwd)
      : [];
  let session: CodexDriverSession | null = null;
  const translator = new CodexCanonicalEventTranslator({
    attachmentId: params.attachmentId,
    events: context.events,
    onAccountRestartRequired: () => {
      if (session) session.restartBeforeNextTurn = true;
    },
  });
  const connection = createCodexAppServerConnection({
    cwd: params.workspace.cwd,
    env: params.shellEnvironment,
    onNotification: (method, notificationParams) => {
      translator.translate(method, notificationParams);
      if (
        method === "turn/started" &&
        session &&
        translator.providerTurnReady
      ) {
        session.providerTurnId = translator.providerTurn;
        session.resolveActiveTurnReady?.();
        session.resolveActiveTurnReady = null;
        session.activeTurnReady = null;
      }
      if (
        session &&
        session.activeTurnId !== null &&
        translator.activeTurn === null
      ) {
        session.resolveActiveTurnReady?.();
        session.resolveActiveTurnReady = null;
        session.activeTurnReady = null;
        session.activeTurnId = null;
        session.providerTurnId = null;
      }
    },
    onRequest: (method, requestParams, responder) => {
      if (!session) {
        responder.error(-32000, "Codex session is still opening");
        return;
      }
      if (
        handleCodexToolRequest({
          method,
          params: requestParams,
          responder,
          session,
        })
      ) {
        return;
      }
      buildApprovalResponse({
        method,
        params: requestParams,
        responder,
        session,
      });
    },
    onExit: (exit) => {
      if (!session || !codexSessions.has(session.attachmentId)) return;
      session.resolveActiveTurnReady?.();
      session.resolveActiveTurnReady = null;
      session.activeTurnReady = null;
      translator.failActiveTurn(
        `Codex app-server exited (${exit.code ?? exit.signal ?? "unknown"})${exit.stderrTail ? `: ${exit.stderrTail}` : ""}`,
      );
      codexSessions.delete(session.attachmentId);
    },
  });
  await connection.request({
    method: "initialize",
    params: {
      clientInfo: { name: "bb", version: "1.0.0", title: null },
      capabilities: { experimentalApi: true },
    },
    resultSchema: z.unknown(),
    timeoutMs: 30_000,
  });
  await connection.request({
    method: "skills/extraRoots/set",
    params: {
      extraRoots: params.skillSources.map((source) => source.rootPath),
    },
    resultSchema: z.unknown(),
  });
  const open = buildCodexOpenParams(params, gitWritableRoots);
  const result = await withArchivedSessionRecovery({
    providerSessionId: archivedSessionIdForOpen(params.mode),
    request: () =>
      connection.request({
        method: open.method,
        params: open.params,
        resultSchema: codexThreadResultSchema,
        timeoutMs: 30_000,
      }),
    unarchive: (providerSessionId) =>
      unarchiveCodexSession(connection, providerSessionId),
  });
  session = {
    activeTurnId: null,
    activeTurnReady: null,
    attachmentId: params.attachmentId,
    bbThreadId: params.bbThreadId,
    connection,
    context,
    gitWritableRoots,
    openParams: params,
    providerSessionId: result.thread.id,
    providerTurnId: null,
    resolveActiveTurnReady: null,
    restartBeforeNextTurn: false,
    translator,
  };
  codexSessions.set(params.attachmentId, session);
  return session;
}

function toAccountRestartOpenParams(args: {
  execution: ProviderTurnSubmitParams["execution"];
  openParams: ProviderSessionOpenParams;
  providerSessionId: string;
}): ProviderSessionOpenParams {
  return {
    ...args.openParams,
    mode: {
      kind: "resume",
      providerSessionId: args.providerSessionId,
    },
    execution: args.execution,
  };
}

async function restartCodexSessionForNextTurn(
  session: CodexDriverSession,
  execution: ProviderTurnSubmitParams["execution"],
): Promise<CodexDriverSession> {
  if (!session.restartBeforeNextTurn) return session;
  if (session.activeTurnId !== null) {
    rejectCodexRequest({
      code: "codex_turn_active",
      category: "provider",
      message: "Cannot restart Codex while a turn is active",
    });
  }

  codexSessions.delete(session.attachmentId);
  await session.connection.stop();
  return openCodexSession(
    toAccountRestartOpenParams({
      execution,
      openParams: session.openParams,
      providerSessionId: session.providerSessionId,
    }),
    session.context,
  );
}

export const codexProviderDriver = defineProviderDriver({
  identity: { pluginId: "codex", driverId: "codex", providerId: "codex" },
  processCapabilities: { multiplexSessions: false },

  async inspect(params) {
    const connection = createCodexAppServerConnection({
      cwd: params.cwd ?? process.cwd(),
      onNotification: () => {},
      onRequest: (_method, _requestParams, responder) =>
        responder.error(-32601, "Codex inspection does not handle requests"),
      onExit: () => {},
    });
    try {
      await connection.request({
        method: "initialize",
        params: {
          clientInfo: { name: "bb", version: "1.0.0", title: null },
          capabilities: { experimentalApi: true },
        },
        resultSchema: z.unknown(),
        timeoutMs: 30_000,
      });
      const result = await connection.request({
        method: "model/list",
        params: {},
        resultSchema: codexModelListResultSchema,
        timeoutMs: 30_000,
      });
      return {
        readiness: { status: "ready" },
        capabilities: {
          multiplexSessions: false,
          supportedSessionOperations: [
            "fork",
            "rename",
            "archive",
            "clear_goal",
          ],
          supportedPermissionModes: ["accept-edits", "auto", "full"],
          supportsServiceTier: true,
          supportsSteering: true,
          supportsUserQuestions: false,
        },
        models: parseModelsResponse(result),
        selectedOnlyModels: [],
        diagnostics: [],
      };
    } finally {
      await connection.stop();
    }
  },

  async openSession(params, context) {
    const existing = codexSessions.get(params.attachmentId);
    if (existing) await existing.connection.stop();
    const session = await openCodexSession(params, context);
    return {
      providerSessionId: session.providerSessionId,
      sessionFormatVersion: "codex-rollout-v1",
    };
  },

  async detachSession(params) {
    const session = requireCodexSession(params.attachmentId);
    codexSessions.delete(params.attachmentId);
    await session.connection.stop();
    return { providerCheckpointId: null };
  },

  async discardSession(params) {
    const session = codexSessions.get(params.attachmentId);
    if (!session) return;
    await session.connection.request({
      method: "thread/archive",
      params: { threadId: params.providerSessionId },
      resultSchema: codexOperationResultSchema,
    });
    codexSessions.delete(params.attachmentId);
    await session.connection.stop();
  },

  async submitTurn(params) {
    let session = requireCodexSession(params.attachmentId);
    session = await restartCodexSessionForNextTurn(session, params.execution);
    if (params.mode === "steer") {
      if (session.activeTurnId !== params.expectedTurnId) {
        return { outcome: "stale", activeTurnId: session.activeTurnId };
      }
      await session.activeTurnReady;
      await withArchivedSessionRecovery({
        providerSessionId: session.providerSessionId,
        request: () =>
          session.connection.request({
            method: "turn/steer",
            params: {
              threadId: session.providerSessionId,
              expectedTurnId: session.providerTurnId ?? params.expectedTurnId,
              input: toCodexUserInput(
                flattenPromptInputGroups([], params.inputGroups),
              ),
            },
            resultSchema: codexOperationResultSchema,
          }),
        unarchive: (providerSessionId) =>
          unarchiveCodexSession(session.connection, providerSessionId),
      });
      return {
        outcome: "accepted",
        disposition: "steered",
        turnId: params.expectedTurnId,
        providerTurnId: session.providerTurnId,
      };
    }
    if (session.activeTurnId !== null) {
      return {
        outcome: "rejected",
        error: codexDriverError({
          code: "codex_turn_active",
          category: "provider",
          message: "A Codex turn is already active",
        }),
      };
    }
    const input = flattenPromptInputGroups([], params.inputGroups);
    session.activeTurnId = params.turnId;
    session.activeTurnReady = new Promise<void>((resolve) => {
      session.resolveActiveTurnReady = resolve;
    });
    session.translator.beginTurn(params.turnId);
    let acceptedProviderTurnId: string | null = null;
    try {
      if (isStandaloneBuiltinCompactCommand(input)) {
        await session.connection.request({
          method: "thread/compact/start",
          params: {
            threadId: session.providerSessionId,
          } satisfies ThreadCompactStartParams,
          resultSchema: codexOperationResultSchema,
        });
      } else {
        const options = toTurnExecutionContext(params);
        const permissions = toCodexPermissionSettings({
          additionalWorkspaceWriteRoots: [],
          gitWritableRoots: session.gitWritableRoots,
          options,
        });
        const turnResult = await withArchivedSessionRecovery({
          providerSessionId: session.providerSessionId,
          request: () =>
            session.connection.request({
              method: "turn/start",
              params: {
                threadId: session.providerSessionId,
                input: toCodexUserInput(input),
                approvalPolicy: permissions.approvalPolicy,
                approvalsReviewer: permissions.approvalsReviewer,
                sandboxPolicy: permissions.sandboxPolicy,
                model: params.execution.model,
                serviceTier: toCodexServiceTier(params.execution.serviceTier),
              },
              resultSchema: codexTurnResultSchema,
            }),
          unarchive: (providerSessionId) =>
            unarchiveCodexSession(session.connection, providerSessionId),
        });
        acceptedProviderTurnId = turnResult.turn.id;
        if (session.translator.activeTurn !== null) {
          session.translator.setProviderTurnId(turnResult.turn.id);
          session.providerTurnId = turnResult.turn.id;
        }
      }
    } catch (error) {
      session.resolveActiveTurnReady?.();
      session.resolveActiveTurnReady = null;
      session.activeTurnReady = null;
      session.activeTurnId = null;
      session.providerTurnId = null;
      throw error;
    }
    return {
      outcome: "accepted",
      disposition: "started",
      turnId: params.turnId,
      providerTurnId: acceptedProviderTurnId,
    };
  },

  async cancelTurn(params) {
    const session = requireCodexSession(params.attachmentId);
    if (session.activeTurnId !== params.turnId) {
      return { outcome: "not_active" };
    }
    await session.activeTurnReady;
    await session.connection.request({
      method: "turn/interrupt",
      params: {
        threadId: session.providerSessionId,
        turnId: session.providerTurnId ?? params.turnId,
      },
      resultSchema: codexOperationResultSchema,
    });
    return { outcome: "cancellation_requested" };
  },

  async renameSession(params) {
    const session = requireCodexSession(params.attachmentId);
    await session.connection.request({
      method: "thread/name/set",
      params: { threadId: session.providerSessionId, name: params.title },
      resultSchema: codexOperationResultSchema,
    });
    return { outcome: "applied" };
  },

  async setSessionArchived(params) {
    const session = requireCodexSession(params.attachmentId);
    try {
      await session.connection.request({
        method: params.archived ? "thread/archive" : "thread/unarchive",
        params: { threadId: session.providerSessionId },
        resultSchema: codexOperationResultSchema,
      });
    } catch (error) {
      if (!isAlreadyArchivedStateError(params.archived, error)) throw error;
      return { outcome: "unchanged" };
    }
    return { outcome: "applied" };
  },

  async clearSessionGoal(params) {
    const session = requireCodexSession(params.attachmentId);
    const result = await session.connection.request({
      method: "thread/goal/clear",
      params: { threadId: session.providerSessionId },
      resultSchema: z.object({ cleared: z.boolean() }).passthrough(),
    });
    return { outcome: result.cleared ? "applied" : "unchanged" };
  },

  async shutdown() {
    await Promise.all(
      [...codexSessions.values()].map((session) => session.connection.stop()),
    );
    codexSessions.clear();
  },
});
