import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type {
  ProviderErrorInfo,
  ProviderRateLimitState,
  ProviderRateLimitStatus,
  ThreadEventItem,
  ThreadEventTokenUsageBreakdown,
} from "@bb/domain";
import type {
  ProviderDriverError,
  ProviderDriverErrorCategory,
  ProviderDriverItem,
} from "@bb/provider-driver-contract";
import type {
  ProviderDriverEventEmitter,
  ProviderDriverEventInput,
} from "@bb/provider-driver-sdk";
import {
  extractResultText,
  toOptionalRecord,
  withParentToolCallId,
} from "../shared/adapter-utils.js";
import {
  buildToolResultItem,
  buildToolUseItem,
} from "../shared/tool-item-translation.js";
import { bashArgsSchema } from "../shared/tool-arg-schemas.js";
import { buildClaudeProviderErrorInfo } from "./error-info.js";
import {
  claudeApiRetryMessageSchema,
  claudeAssistantMessageSchema,
  claudeCompactBoundarySystemMessageSchema,
  claudeModelFallbackSystemMessageSchema,
  claudeModelRefusalNoFallbackSystemMessageSchema,
  claudePermissionDeniedSystemMessageSchema,
  claudeRateLimitEventSchema,
  claudeResultMessageSchema,
  claudeSdkMessageTypeSchema,
  claudeStatusSystemMessageSchema,
  claudeStreamEventMessageSchema,
  claudeSystemMessageSchema,
  claudeUserMessageSchema,
  type ClaudeApiRetryMessage,
  type ClaudeAssistantMessage,
  type ClaudeRateLimitEvent,
  type ClaudeResultMessage,
  type ClaudeToolUseResult,
  type ClaudeFileEditArgs,
  type ClaudeWebFetchArgs,
  type ClaudeWebSearchArgs,
  claudeFileEditArgsSchema,
  claudeWebFetchArgsSchema,
  claudeWebSearchArgsSchema,
} from "./schemas.js";
import {
  extractAssistantText,
  extractClaudeCommandExecutionOutput,
  extractClaudeContextWindowUsage,
  extractClaudeRequestContextTokens,
  extractStreamTextDelta,
  extractStreamThinkingDelta,
  extractThinkingBlocks,
  extractTokenUsage,
  extractToolResults,
  extractToolUses,
  getNestedMessageId,
  getNestedParentToolUseId,
  resolveClaudeModelContextWindowHint,
} from "./sdk-extraction.js";
import {
  hasCompletionBlockingClaudeTasks,
  translateClaudeTaskMessage,
  type ClaudeTaskMap,
} from "./task-translation.js";
import {
  claudeTaskToolNameSchema,
  claudeTaskToolOutputSchema,
} from "@bb/domain";

interface ClaudeCanonicalEventTranslatorOptions {
  attachmentId: string;
  events: ProviderDriverEventEmitter;
  selectedModel: string;
}

interface ClaudeNormalizedWebFetch {
  prompt: string | null;
  url: string;
}

const CLAUDE_COMMAND_TOOL_NAMES = new Set(["Bash"]);
const CLAUDE_FILE_CHANGE_TOOL_NAMES = new Set(["Edit", "Write"]);

function toOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function getClaudeFileEditPath(args: ClaudeFileEditArgs): string | null {
  return args.file_path ?? args.path ?? null;
}

function normalizeClaudeWebSearchArgs(
  args: ClaudeWebSearchArgs,
): string[] | null {
  const query = toOptionalString(args.query);
  return query ? [query] : null;
}

function normalizeClaudeWebFetchArgs(
  args: ClaudeWebFetchArgs,
): ClaudeNormalizedWebFetch | null {
  const url = toOptionalString(args.url);
  return url ? { url, prompt: toOptionalString(args.prompt) ?? null } : null;
}

function translateClaudeWebToolUse(input: {
  args: unknown;
  callId: string;
  parentToolCallId?: string;
  toolName: string;
}): ThreadEventItem | null {
  if (input.toolName === "WebSearch") {
    const parsed = claudeWebSearchArgsSchema.safeParse(input.args);
    const queries = parsed.success
      ? normalizeClaudeWebSearchArgs(parsed.data)
      : null;
    return queries
      ? withParentToolCallId(
          { type: "webSearch", id: input.callId, queries, resultText: null },
          input.parentToolCallId,
        )
      : null;
  }
  if (input.toolName !== "WebFetch") return null;
  const parsed = claudeWebFetchArgsSchema.safeParse(input.args);
  const normalized = parsed.success
    ? normalizeClaudeWebFetchArgs(parsed.data)
    : null;
  return normalized
    ? withParentToolCallId(
        {
          type: "webFetch",
          id: input.callId,
          url: normalized.url,
          prompt: normalized.prompt,
          pattern: null,
          resultText: null,
        },
        input.parentToolCallId,
      )
    : null;
}

function translateClaudeToolUseItem(input: {
  args: unknown;
  callId: string;
  parentToolCallId?: string;
  toolName: string;
}): ThreadEventItem {
  return buildToolUseItem(input, {
    commandToolNames: CLAUDE_COMMAND_TOOL_NAMES,
    fileChangeToolNames: CLAUDE_FILE_CHANGE_TOOL_NAMES,
    parseCommand(args) {
      const parsed = bashArgsSchema.safeParse(args);
      const command = parsed.success
        ? toOptionalString(parsed.data.command)
        : undefined;
      return command
        ? {
            command,
            cwd: parsed.success
              ? (toOptionalString(parsed.data.cwd) ?? "")
              : "",
          }
        : null;
    },
    parseFileChange(args) {
      const parsed = claudeFileEditArgsSchema.safeParse(args);
      return parsed.success
        ? {
            arguments: parsed.data,
            path: getClaudeFileEditPath(parsed.data) ?? undefined,
            oldText: parsed.data.old_string,
            newText: parsed.data.new_string ?? parsed.data.content,
          }
        : null;
    },
    translateSpecialToolUse: translateClaudeWebToolUse,
  });
}

function parseClaudeTaskToolOutputValue(value: unknown) {
  const parsed = claudeTaskToolOutputSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  if (typeof value !== "string") return null;
  try {
    const json: unknown = JSON.parse(value);
    const parsedJson = claudeTaskToolOutputSchema.safeParse(json);
    return parsedJson.success ? parsedJson.data : null;
  } catch {
    return null;
  }
}

function translateClaudeToolResultItem(input: {
  callId: string;
  content: unknown;
  isError: boolean;
  parentToolCallId?: string;
  startedItem?: ThreadEventItem;
  toolName?: string;
  toolUseResult: ClaudeToolUseResult | null;
}): ThreadEventItem {
  const outputText =
    input.toolName === "Bash" || input.startedItem?.type === "commandExecution"
      ? extractClaudeCommandExecutionOutput({
          content: input.content,
          toolUseResult: input.toolUseResult,
        })
      : extractResultText(input.content);
  const resultToolName =
    input.startedItem?.type === "toolCall"
      ? input.startedItem.tool
      : input.toolName;
  const taskToolResult =
    resultToolName && claudeTaskToolNameSchema.safeParse(resultToolName).success
      ? (parseClaudeTaskToolOutputValue(input.content) ??
        parseClaudeTaskToolOutputValue(input.toolUseResult) ??
        parseClaudeTaskToolOutputValue(outputText))
      : null;
  return buildToolResultItem({
    ...input,
    commandOutputText: outputText,
    commandToolNames: CLAUDE_COMMAND_TOOL_NAMES,
    completeWebItems: true,
    fileChangeToolNames: CLAUDE_FILE_CHANGE_TOOL_NAMES,
    outputText,
    toolCallResult: taskToolResult ?? outputText,
  });
}

function canonicalCategory(
  info: ProviderErrorInfo | null,
): ProviderDriverErrorCategory {
  if (!info) return "provider";
  switch (info.category) {
    case "rate-limit":
      return "rate_limit";
    case "unauthorized":
      return "authentication";
    case "bad-request":
      return "configuration";
    case "context-window-exceeded":
      return "context_limit";
    case "policy":
    case "sandbox":
      return "permission";
    case "overloaded":
    case "connection-failed":
    case "stream-disconnected":
      return "provider_unavailable";
    case "billing":
      return "billing";
    case "budget-exceeded":
      return "budget_exceeded";
    case "max-output-tokens":
      return "max_output_tokens";
    case "max-turns":
      return "max_turns";
    case "structured-output-retries":
      return "structured_output_retries";
    case "internal":
      return "internal";
    default:
      return "provider";
  }
}

function canonicalProviderError(args: {
  code: string;
  detail: string;
  info: ProviderErrorInfo | null;
  retry?: ProviderDriverError["retry"];
}): ProviderDriverError {
  return {
    code: args.info?.providerCode ?? args.code,
    category: canonicalCategory(args.info),
    message: "Provider error",
    detail: args.detail,
    ...(args.info?.httpStatusCode !== null &&
    args.info?.httpStatusCode !== undefined
      ? { httpStatusCode: args.info.httpStatusCode }
      : {}),
    retry: args.retry ?? { disposition: "never" },
  };
}

function failedItemError(item: ProviderDriverItem): ProviderDriverError {
  return {
    code: "claude_item_failed",
    category: "provider",
    message: `Claude ${item.type} item failed`,
    ...(item.type === "toolCall" && item.error ? { detail: item.error } : {}),
    retry: { disposition: "never" },
  };
}

function initialItem(item: ProviderDriverItem): ProviderDriverItem {
  switch (item.type) {
    case "agentMessage":
      return { ...item, text: "" };
    case "reasoning":
      return { ...item, summary: [], content: [] };
    case "commandExecution":
      return {
        ...item,
        aggregatedOutput: undefined,
        exitCode: undefined,
        status: "pending",
      };
    case "fileChange":
      return { ...item, status: "pending" };
    case "toolCall":
      return {
        ...item,
        status: "pending",
        result: undefined,
        error: undefined,
      };
    case "plan":
      return { ...item, text: "" };
    case "webSearch":
      return { ...item, resultText: null };
    case "webFetch":
      return { ...item, resultText: null };
    case "imageView":
    case "contextCompaction":
    case "backgroundTask":
      return item;
  }
}

const resultFallbackErrorDetails: Record<string, string> = {
  error_during_execution: "Claude Code failed during execution.",
  error_max_budget_usd: "Claude Code exceeded the configured budget.",
  error_max_structured_output_retries:
    "Claude Code exhausted structured output retries.",
  error_max_turns: "Claude Code reached the maximum number of turns.",
};

function isResultFailure(message: ClaudeResultMessage): boolean {
  return message.is_error === true || message.subtype.startsWith("error");
}

function resultErrorDetail(message: ClaudeResultMessage): string {
  if (message.is_error && typeof message.result === "string")
    return message.result;
  const errors = (message.errors ?? [])
    .map((error) => error.trim())
    .filter(Boolean);
  return errors.length > 0
    ? errors.join("\n")
    : (resultFallbackErrorDetails[message.subtype] ??
        `Claude Code result failed: ${message.subtype}`);
}

function apiRetryDetail(message: ClaudeApiRetryMessage): string {
  const status =
    message.error_status !== null ? ` HTTP ${message.error_status}` : "";
  return `Claude Code API retry ${message.attempt}/${message.max_retries} after ${message.retry_delay_ms}ms:${status} ${message.error}`;
}

function normalizeRateLimitStatus(status: string): ProviderRateLimitStatus {
  switch (status) {
    case "allowed":
      return "allowed";
    case "allowed_warning":
      return "warning";
    case "rejected":
      return "blocked";
    default:
      return "unknown";
  }
}

function rateLimitLabel(providerKey: string | undefined): string | null {
  const labels: Record<string, string> = {
    five_hour: "Five-hour limit",
    seven_day: "Weekly limit",
    seven_day_opus: "Weekly Opus limit",
    seven_day_sonnet: "Weekly Sonnet limit",
    seven_day_overage_included: "Weekly included overage",
    overage: "Overage",
  };
  return providerKey ? (labels[providerKey] ?? null) : null;
}

function normalizeOverageStatus(
  status: string | undefined,
): ProviderRateLimitState["overageStatus"] {
  switch (status) {
    case undefined:
      return null;
    case "allowed":
      return "allowed";
    case "allowed_warning":
      return "warning";
    case "rejected":
      return "rejected";
    default:
      return "unavailable";
  }
}

function normalizeRateLimits(
  message: ClaudeRateLimitEvent,
): ProviderRateLimitState {
  const info = message.rate_limit_info;
  const windowStatus = normalizeRateLimitStatus(info.status);
  const overageStatus = normalizeOverageStatus(info.overageStatus);
  const status =
    windowStatus === "blocked" && overageStatus === "allowed"
      ? "allowed"
      : windowStatus === "blocked" && overageStatus === "warning"
        ? "warning"
        : windowStatus;
  const providerKey = info.rateLimitType ?? null;
  return {
    providerId: "claude-code",
    status,
    kind:
      providerKey === "overage"
        ? "credits"
        : providerKey === null
          ? "unknown"
          : "subscription-window",
    windows: [
      {
        providerKey,
        label: rateLimitLabel(info.rateLimitType),
        status: windowStatus,
        resetsAtMs: info.resetsAt === undefined ? null : info.resetsAt * 1_000,
      },
    ],
    reachedReason:
      windowStatus === "blocked"
        ? (info.rateLimitType ?? "rate_limit_rejected")
        : null,
    overageStatus,
    overageReason: info.overageDisabledReason ?? null,
  };
}

function hardRateLimitRejection(message: ClaudeRateLimitEvent): boolean {
  const info = message.rate_limit_info;
  return (
    info.status === "rejected" &&
    info.overageStatus !== "allowed" &&
    info.overageStatus !== "allowed_warning"
  );
}

function rateLimitDetail(message: ClaudeRateLimitEvent): string {
  const info = message.rate_limit_info;
  const details = ["Claude Code rate limit rejected"];
  if (info.rateLimitType) details.push(`type ${info.rateLimitType}`);
  if (info.resetsAt !== undefined) details.push(`resetsAt ${info.resetsAt}`);
  if (info.overageStatus) details.push(`overage ${info.overageStatus}`);
  if (info.overageDisabledReason)
    details.push(`overage disabled: ${info.overageDisabledReason}`);
  return details.join("; ");
}

function fallbackTransition(message: ClaudeAssistantMessage) {
  const nested = toOptionalRecord(message.message);
  const content = nested?.content;
  if (
    !Array.isArray(content) ||
    content.length === 0 ||
    !content.every((block) => toOptionalRecord(block)?.type === "fallback")
  )
    return null;
  const block = toOptionalRecord(content[0]);
  const originalModel = toOptionalRecord(block?.from)?.model;
  const fallbackModel = toOptionalRecord(block?.to)?.model;
  return typeof originalModel === "string" && typeof fallbackModel === "string"
    ? { originalModel, fallbackModel }
    : null;
}

function syntheticNoResponse(message: ClaudeAssistantMessage): boolean {
  const nested = toOptionalRecord(message.message);
  const usage = toOptionalRecord(nested?.usage);
  return (
    nested?.model === "<synthetic>" &&
    nested.role === "assistant" &&
    nested.stop_reason === "stop_sequence" &&
    nested.stop_sequence === "" &&
    toOptionalRecord(message)?.error === undefined &&
    usage !== undefined &&
    [
      "input_tokens",
      "cache_creation_input_tokens",
      "cache_read_input_tokens",
      "output_tokens",
    ].every((key) => usage[key] === 0) &&
    extractAssistantText(message) === "No response requested."
  );
}

/** Translates Claude Agent SDK messages directly into canonical driver events. */
export class ClaudeCanonicalEventTranslator {
  private activeTurnId: string | null = null;
  private assistantCounter = 0;
  private readonly attachmentId: string;
  private readonly cumulativeTokens: ThreadEventTokenUsageBreakdown = {
    totalTokens: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
  };
  private readonly events: ProviderDriverEventEmitter;
  private lastFallback: {
    fallbackModel: string;
    originalModel: string;
    turnId: string;
  } | null = null;
  private latestCheckpointId: string | null = null;
  private latestRequestContextTokens: number | undefined;
  private readonly openAssistantMessageIdsByScope = new Map<string, string>();
  private readonly openCompactionIds = new Set<string>();
  private readonly openItems = new Map<string, ProviderDriverItem>();
  private readonly openReasoningItemIdsByScope = new Map<string, string>();
  private readonly selectedModelContextWindow: { value: number | null };
  private readonly tasksById: ClaudeTaskMap = new Map();
  private readonly toolItemsByCallId = new Map<string, ThreadEventItem>();

  constructor(options: ClaudeCanonicalEventTranslatorOptions) {
    this.attachmentId = options.attachmentId;
    this.events = options.events;
    this.selectedModelContextWindow = {
      value: resolveClaudeModelContextWindowHint(options.selectedModel),
    };
  }

  beginTurn(turnId: string, selectedModel: string): void {
    this.activeTurnId = turnId;
    this.latestRequestContextTokens = undefined;
    this.openAssistantMessageIdsByScope.clear();
    this.openReasoningItemIdsByScope.clear();
    this.toolItemsByCallId.clear();
    this.selectedModelContextWindow.value =
      resolveClaudeModelContextWindowHint(selectedModel);
  }

  getActiveTurnId(): string | null {
    return this.activeTurnId;
  }

  translateSdkMessage(message: SDKMessage): void {
    const messageType = claudeSdkMessageTypeSchema.safeParse(message);
    if (!messageType.success) return;
    const parentToolCallId = getNestedParentToolUseId(message);
    switch (messageType.data.type) {
      case "system":
        this.translateSystem(message);
        return;
      case "assistant":
        this.translateAssistant(message, parentToolCallId);
        return;
      case "stream_event":
        this.translateStream(message, parentToolCallId);
        return;
      case "user":
        this.translateUser(message, parentToolCallId);
        return;
      case "result":
        this.translateResult(message);
        return;
      case "rate_limit_event":
        this.translateRateLimit(message);
        return;
    }
  }

  settleFailed(error: ProviderDriverError): void {
    const turnId = this.activeTurnId;
    if (!turnId) {
      this.events.emit({
        type: "provider.warning",
        attachmentId: this.attachmentId,
        code: error.code,
        message: error.detail ?? error.message,
      });
      return;
    }
    this.events.emit({
      type: "turn.settled",
      attachmentId: this.attachmentId,
      turnId,
      outcome: "failed",
      error,
      providerCheckpointId: this.latestCheckpointId,
    });
    this.finishTurn();
  }

  settleCancelled(): void {
    const turnId = this.activeTurnId;
    if (!turnId) return;
    this.events.emit({
      type: "turn.settled",
      attachmentId: this.attachmentId,
      turnId,
      outcome: "cancelled",
      error: null,
      providerCheckpointId: this.latestCheckpointId,
    });
    this.finishTurn();
  }

  interruptBackgroundTasks(): void {
    for (const event of this.buildInterruptedTaskEvents())
      this.events.emit(event);
  }

  private buildInterruptedTaskEvents(): ProviderDriverEventInput[] {
    const events: ProviderDriverEventInput[] = [];
    for (const task of this.tasksById.values()) {
      if (task.terminal) continue;
      task.taskStatus = "stopped";
      task.terminal = true;
      const item: Extract<ProviderDriverItem, { type: "backgroundTask" }> = {
        type: "backgroundTask",
        id: task.itemId,
        taskType: task.taskType,
        description: task.description,
        status: "interrupted",
        taskStatus: task.taskStatus,
        skipTranscript: task.skipTranscript,
        ...(task.workflowName ? { workflowName: task.workflowName } : {}),
        ...(task.toolUseId ? { parentToolCallId: task.toolUseId } : {}),
      };
      events.push({
        type: "background_task.completed",
        attachmentId: this.attachmentId,
        item,
        turnId: this.activeTurnId,
      });
    }
    return events;
  }

  private translateSystem(raw: unknown): void {
    const parsed = claudeSystemMessageSchema.safeParse(raw);
    if (!parsed.success) return;
    const retry = claudeApiRetryMessageSchema.safeParse(raw);
    if (retry.success && this.activeTurnId) {
      this.events.emit({
        type: "turn.retrying",
        attachmentId: this.attachmentId,
        turnId: this.activeTurnId,
        attempt: retry.data.attempt,
        message: apiRetryDetail(retry.data),
        retryAt: new Date(Date.now() + retry.data.retry_delay_ms).toISOString(),
      });
      return;
    }
    const status = claudeStatusSystemMessageSchema.safeParse(raw);
    if (status.success) {
      if (!this.activeTurnId) return;
      if (status.data.status === "compacting") {
        const id = `claude-compaction-${this.activeTurnId}`;
        if (!this.openCompactionIds.has(id)) {
          this.openCompactionIds.add(id);
          this.startItem({ type: "contextCompaction", id });
        }
      } else {
        for (const id of this.openCompactionIds) {
          this.completeItem({ type: "contextCompaction", id });
          this.openCompactionIds.delete(id);
        }
      }
      return;
    }
    const compact = claudeCompactBoundarySystemMessageSchema.safeParse(raw);
    if (compact.success && this.activeTurnId) {
      this.events.emit({
        type: "turn.compacted",
        attachmentId: this.attachmentId,
        turnId: this.activeTurnId,
      });
      return;
    }
    const fallback = claudeModelFallbackSystemMessageSchema.safeParse(raw);
    if (fallback.success) {
      this.emitFallback({
        originalModel: fallback.data.original_model,
        fallbackModel: fallback.data.fallback_model,
        reason:
          fallback.data.subtype === "model_refusal_fallback"
            ? "refusal"
            : "provider",
        message:
          fallback.data.content ??
          `Switched from ${fallback.data.original_model} to ${fallback.data.fallback_model}.`,
      });
      return;
    }
    const noFallback =
      claudeModelRefusalNoFallbackSystemMessageSchema.safeParse(raw);
    if (noFallback.success) {
      this.events.emit({
        type: "provider.warning",
        attachmentId: this.attachmentId,
        code: "model_refusal_no_fallback",
        message:
          noFallback.data.content ??
          "The selected model refused the request and no fallback model was available.",
      });
      return;
    }
    const denied = claudePermissionDeniedSystemMessageSchema.safeParse(raw);
    if (denied.success) {
      this.events.emit({
        type: "provider.warning",
        attachmentId: this.attachmentId,
        code: "permission_denied",
        message: `${denied.data.tool_name} was denied automatically: ${denied.data.decision_reason ?? denied.data.message}`,
      });
      return;
    }
    const taskEvents = translateClaudeTaskMessage({
      ensureTurnStarted: () => this.requireTurn(),
      event: raw,
      now: Date.now(),
      tasks: this.tasksById,
      threadId: "",
    });
    if (!taskEvents) return;
    for (const event of taskEvents) this.emitLegacyTaskEvent(event);
  }

  private emitLegacyTaskEvent(
    event: ReturnType<typeof translateClaudeTaskMessage> extends
      | (infer E)[]
      | null
      ? E
      : never,
  ): void {
    if (!event) return;
    switch (event.type) {
      case "item/started":
        if (event.item.type === "backgroundTask") this.startItem(event.item);
        return;
      case "item/backgroundTask/progress":
        this.events.emit({
          type: "background_task.progress",
          attachmentId: this.attachmentId,
          item: event.item,
          turnId: this.activeTurnId,
        });
        return;
      case "item/backgroundTask/completed":
        this.events.emit({
          type: "background_task.completed",
          attachmentId: this.attachmentId,
          item: event.item,
          turnId: this.activeTurnId,
        });
        return;
      default:
        return;
    }
  }

  private translateAssistant(
    raw: unknown,
    parentToolCallId: string | undefined,
  ): void {
    const parsed = claudeAssistantMessageSchema.safeParse(raw);
    if (!parsed.success || !this.activeTurnId) return;
    const message = parsed.data;
    if (!parentToolCallId && message.uuid) {
      this.latestCheckpointId = message.uuid;
    }
    const transition = fallbackTransition(message);
    if (transition) {
      this.emitFallback({
        ...transition,
        reason: "provider",
        message: `Switched from ${transition.originalModel} to ${transition.fallbackModel}.`,
      });
      return;
    }
    if (syntheticNoResponse(message)) {
      if (!hasCompletionBlockingClaudeTasks(this.tasksById))
        this.settleCompleted();
      return;
    }
    const contextTokens = extractClaudeRequestContextTokens(message);
    if (contextTokens !== null) this.latestRequestContextTokens = contextTokens;
    const assistantMessageId = getNestedMessageId(message.message);
    for (const thinking of extractThinkingBlocks(message)) {
      const key = `${parentToolCallId ?? "root"}:${thinking.contentIndex}`;
      const itemId =
        this.openReasoningItemIdsByScope.get(key) ??
        `claude-reasoning-${this.openReasoningItemIdsByScope.size + 1}`;
      this.openReasoningItemIdsByScope.delete(key);
      this.completeItem(
        withParentToolCallId(
          {
            type: "reasoning",
            id: itemId,
            summary: [],
            content: [thinking.text],
          },
          parentToolCallId,
        ),
      );
    }
    const text = extractAssistantText(message);
    if (text) {
      const itemId = this.resolveAssistantItemId(
        parentToolCallId,
        assistantMessageId,
      );
      this.completeItem(
        withParentToolCallId(
          { type: "agentMessage", id: itemId, text },
          parentToolCallId,
        ),
      );
    }
    for (const toolUse of extractToolUses(message)) {
      const item = translateClaudeToolUseItem({
        callId: toolUse.id,
        toolName: toolUse.name,
        args: toolUse.input,
        ...(parentToolCallId ? { parentToolCallId } : {}),
      });
      if (item.type === "userMessage") continue;
      this.toolItemsByCallId.set(toolUse.id, item);
      this.startItem(item);
    }
  }

  private translateStream(
    raw: unknown,
    parentToolCallId: string | undefined,
  ): void {
    const parsed = claudeStreamEventMessageSchema.safeParse(raw);
    if (!parsed.success || !this.activeTurnId) return;
    const reasoning = extractStreamThinkingDelta(parsed.data);
    if (reasoning) {
      const key = `${parentToolCallId ?? "root"}:${reasoning.contentIndex}`;
      let itemId = this.openReasoningItemIdsByScope.get(key);
      if (!itemId) {
        itemId = `claude-reasoning-${this.openReasoningItemIdsByScope.size + 1}`;
        this.openReasoningItemIdsByScope.set(key, itemId);
        this.startItem(
          withParentToolCallId(
            { type: "reasoning", id: itemId, summary: [], content: [] },
            parentToolCallId,
          ),
        );
      }
      this.emitDelta(itemId, "reasoning_text", reasoning.delta);
    }
    const text = extractStreamTextDelta(parsed.data);
    if (text) {
      const itemId = this.getOrCreateAssistantItemId(parentToolCallId);
      this.emitDelta(itemId, "assistant_text", text.delta);
    }
  }

  private translateUser(
    raw: unknown,
    parentToolCallId: string | undefined,
  ): void {
    const parsed = claudeUserMessageSchema.safeParse(raw);
    if (!parsed.success || !this.activeTurnId) return;
    for (const result of extractToolResults(parsed.data)) {
      const startedItem = this.toolItemsByCallId.get(result.toolUseId);
      if (!startedItem) continue;
      const completedItem = translateClaudeToolResultItem({
        callId: result.toolUseId,
        content: result.content,
        isError: result.isError,
        ...(result.toolName ? { toolName: result.toolName } : {}),
        toolUseResult: result.toolUseResult,
        startedItem,
        ...(parentToolCallId ? { parentToolCallId } : {}),
      });
      if (completedItem.type !== "userMessage") {
        this.completeItem(completedItem);
      }
      this.toolItemsByCallId.delete(result.toolUseId);
    }
  }

  private translateResult(raw: unknown): void {
    const parsed = claudeResultMessageSchema.safeParse(raw);
    if (!parsed.success || !this.activeTurnId) return;
    const message = parsed.data;
    const context = extractClaudeContextWindowUsage({
      fallbackModelContextWindow: this.selectedModelContextWindow.value,
      latestRequestContextTokens: this.latestRequestContextTokens,
      message,
    });
    if (context) {
      if (context.modelContextWindow !== null)
        this.selectedModelContextWindow.value = context.modelContextWindow;
      this.events.emit({
        type: "session.context_window_usage_changed",
        attachmentId: this.attachmentId,
        contextWindowUsage: context,
      });
    }
    const usage = extractTokenUsage(message, this.cumulativeTokens);
    if (usage)
      this.events.emit({
        type: "turn.token_usage_changed",
        attachmentId: this.attachmentId,
        turnId: this.activeTurnId,
        tokenUsage: usage,
      });
    if (isResultFailure(message)) {
      this.settleFailed(
        canonicalProviderError({
          code: message.subtype,
          detail: resultErrorDetail(message),
          info: buildClaudeProviderErrorInfo({
            httpStatusCode: message.api_error_status,
            resultSubtype: message.subtype,
          }),
        }),
      );
      return;
    }
    if (!hasCompletionBlockingClaudeTasks(this.tasksById))
      this.settleCompleted();
  }

  private translateRateLimit(raw: unknown): void {
    const parsed = claudeRateLimitEventSchema.safeParse(raw);
    if (!parsed.success) return;
    this.events.emit({
      type: "provider.rate_limits_changed",
      attachmentId: this.attachmentId,
      rateLimits: normalizeRateLimits(parsed.data),
    });
    if (hardRateLimitRejection(parsed.data) && this.activeTurnId) {
      this.settleFailed(
        canonicalProviderError({
          code: "rate_limit_event",
          detail: rateLimitDetail(parsed.data),
          info: {
            category: "rate-limit",
            providerCode: "rate_limit_event",
            httpStatusCode: null,
          },
        }),
      );
    }
  }

  private emitFallback(args: {
    originalModel: string;
    fallbackModel: string;
    reason: "refusal" | "provider";
    message: string;
  }): void {
    const turnId = this.activeTurnId;
    if (
      turnId &&
      this.lastFallback?.turnId === turnId &&
      this.lastFallback.originalModel === args.originalModel &&
      this.lastFallback.fallbackModel === args.fallbackModel
    )
      return;
    if (turnId)
      this.lastFallback = {
        originalModel: args.originalModel,
        fallbackModel: args.fallbackModel,
        turnId,
      };
    this.events.emit({
      type: "provider.model_fallback",
      attachmentId: this.attachmentId,
      ...args,
      turnId,
    });
  }

  private requireTurn(): string {
    if (!this.activeTurnId)
      throw new Error("Claude emitted a turn event without an accepted turn");
    return this.activeTurnId;
  }

  private startItem(item: ProviderDriverItem): void {
    const turnId = this.requireTurn();
    if (this.openItems.has(item.id)) return;
    this.events.emit({
      type: "item.started",
      attachmentId: this.attachmentId,
      turnId,
      item,
    });
    this.openItems.set(item.id, item);
  }

  private completeItem(item: ProviderDriverItem): void {
    const turnId = this.requireTurn();
    if (!this.openItems.has(item.id)) this.startItem(initialItem(item));
    const status = "status" in item ? item.status : "completed";
    const outcome =
      status === "failed"
        ? "failed"
        : status === "interrupted"
          ? "cancelled"
          : "completed";
    this.events.emit({
      type: "item.completed",
      attachmentId: this.attachmentId,
      turnId,
      item,
      outcome,
      error: outcome === "failed" ? failedItemError(item) : null,
    });
    this.openItems.delete(item.id);
  }

  private emitDelta(
    itemId: string,
    channel: "assistant_text" | "reasoning_text",
    delta: string,
  ): void {
    this.events.emit({
      type: "item.delta",
      attachmentId: this.attachmentId,
      turnId: this.requireTurn(),
      itemId,
      channel,
      delta,
      reset: false,
    });
  }

  private assistantScope(parentToolCallId: string | undefined): string {
    return parentToolCallId ?? "root";
  }

  private getOrCreateAssistantItemId(
    parentToolCallId: string | undefined,
  ): string {
    const scope = this.assistantScope(parentToolCallId);
    let id = this.openAssistantMessageIdsByScope.get(scope);
    if (!id) {
      id = `claude-assistant-${++this.assistantCounter}`;
      this.openAssistantMessageIdsByScope.set(scope, id);
      this.startItem(
        withParentToolCallId(
          { type: "agentMessage", id, text: "" },
          parentToolCallId,
        ),
      );
    }
    return id;
  }

  private resolveAssistantItemId(
    parentToolCallId: string | undefined,
    providerId: string | undefined,
  ): string {
    const scope = this.assistantScope(parentToolCallId);
    const id =
      this.openAssistantMessageIdsByScope.get(scope) ??
      providerId ??
      `claude-assistant-${++this.assistantCounter}`;
    this.openAssistantMessageIdsByScope.delete(scope);
    return id;
  }

  private settleCompleted(): void {
    const turnId = this.requireTurn();
    this.events.emit({
      type: "turn.settled",
      attachmentId: this.attachmentId,
      turnId,
      outcome: "completed",
      error: null,
      providerCheckpointId: this.latestCheckpointId,
    });
    this.finishTurn();
  }

  private finishTurn(): void {
    this.activeTurnId = null;
    this.latestRequestContextTokens = undefined;
    this.openAssistantMessageIdsByScope.clear();
    this.openReasoningItemIdsByScope.clear();
    this.openCompactionIds.clear();
    this.openItems.clear();
    this.toolItemsByCallId.clear();
  }
}
