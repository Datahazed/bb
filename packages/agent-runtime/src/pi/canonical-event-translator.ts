import {
  getBuiltinModels,
  getBuiltinProviders,
} from "@earendil-works/pi-ai/providers/all";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type {
  ThreadEventItem,
  ThreadEventTokenUsageBreakdown,
} from "@bb/domain";
import type {
  ProviderDriverError,
  ProviderDriverItem,
} from "@bb/provider-driver-contract";
import type {
  ProviderDriverEventEmitter,
  ProviderDriverEventInput,
} from "@bb/provider-driver-sdk";
import {
  diffCumulativeText,
  extractResultText,
  normalizeProviderCommandOutput,
  toNonNegativeNumber,
  toOptionalString,
} from "../shared/adapter-utils.js";
import { bashArgsSchema } from "../shared/tool-arg-schemas.js";
import {
  buildToolResultItem,
  buildToolUseItem,
  type ToolUseTranslationInput,
} from "../shared/tool-item-translation.js";
import { toCanonicalPiModelId } from "./model-list.js";

interface PiCanonicalEventTranslatorOptions {
  readonly attachmentId: string;
  readonly events: ProviderDriverEventEmitter;
}

interface PiContextWindowModel {
  contextWindow?: number;
  id: string;
  provider: string;
}

interface PiModelContextWindowLookup {
  byCanonicalId: ReadonlyMap<string, number>;
  byModelId: ReadonlyMap<string, number>;
}

interface PiFileEditArgs {
  content?: string;
  newText?: string;
  oldText?: string;
  path?: string;
}

interface PiCommandOutputDelta {
  delta: string;
  reset: boolean;
  snapshot: string;
}

const PI_EMPTY_BASH_OUTPUT_PLACEHOLDERS = ["(no output)"] as const;
const PI_COMMAND_TOOL_NAMES = new Set(["bash"]);
const PI_FILE_CHANGE_TOOL_NAMES = new Set(["edit", "write"]);

function canonicalProviderError(args: {
  code: string;
  message: string;
  detail?: string;
}): ProviderDriverError {
  return {
    code: args.code,
    category: "provider",
    message: args.message,
    ...(args.detail !== undefined ? { detail: args.detail } : {}),
    retry: { disposition: "never" },
  };
}

function failedItemError(item: ProviderDriverItem): ProviderDriverError {
  const detail = item.type === "toolCall" ? item.error : undefined;
  return canonicalProviderError({
    code: "pi_item_failed",
    message: `Pi ${item.type} item failed`,
    ...(detail !== undefined ? { detail } : {}),
  });
}

function parseFileEditArgs(value: unknown): PiFileEditArgs | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  return {
    ...(typeof record.path === "string" ? { path: record.path } : {}),
    ...(typeof record.oldText === "string" ? { oldText: record.oldText } : {}),
    ...(typeof record.newText === "string" ? { newText: record.newText } : {}),
    ...(typeof record.content === "string" ? { content: record.content } : {}),
  };
}

function translatePiToolUseItem(
  input: ToolUseTranslationInput,
): ThreadEventItem {
  return buildToolUseItem(input, {
    commandToolNames: PI_COMMAND_TOOL_NAMES,
    fileChangeToolNames: PI_FILE_CHANGE_TOOL_NAMES,
    parseCommand(args) {
      const parsed = bashArgsSchema.safeParse(args);
      const command = parsed.success
        ? toOptionalString(parsed.data.command)
        : undefined;
      const cwd = parsed.success
        ? (toOptionalString(parsed.data.cwd) ?? "")
        : "";
      return command ? { command, cwd } : null;
    },
    parseFileChange(args) {
      const parsed = parseFileEditArgs(args);
      return parsed
        ? {
            arguments: { ...parsed },
            path: parsed.path,
            oldText: parsed.oldText,
            newText: parsed.newText ?? parsed.content,
          }
        : null;
    },
  });
}

function translatePiToolResultItem(args: {
  callId: string;
  content: unknown;
  isError: boolean;
  startedItem?: ThreadEventItem;
  toolName: string;
}): ThreadEventItem {
  const outputText = extractResultText(args.content);
  const commandOutputText =
    args.toolName === "bash" || args.startedItem?.type === "commandExecution"
      ? extractPiCommandOutput(args.content)
      : undefined;
  return buildToolResultItem({
    callId: args.callId,
    commandOutputText,
    commandToolNames: PI_COMMAND_TOOL_NAMES,
    fileChangeToolNames: PI_FILE_CHANGE_TOOL_NAMES,
    isError: args.isError,
    outputText,
    startedItem: args.startedItem,
    toolCallResult: outputText,
    toolName: args.toolName,
  });
}

function buildPiModelContextWindowLookup(
  models: readonly PiContextWindowModel[],
): PiModelContextWindowLookup {
  const byCanonicalId = new Map<string, number>();
  const byModelId = new Map<string, number>();
  for (const model of models) {
    if (
      typeof model.contextWindow !== "number" ||
      !Number.isFinite(model.contextWindow) ||
      model.contextWindow <= 0
    ) {
      continue;
    }
    byCanonicalId.set(
      toCanonicalPiModelId(model.provider, model.id),
      model.contextWindow,
    );
    byModelId.set(model.id, model.contextWindow);
  }
  return { byCanonicalId, byModelId };
}

function resolvePiModelContextWindow(
  message:
    | Extract<AgentSessionEvent, { type: "agent_end" }>["messages"][number]
    | undefined,
  lookup: PiModelContextWindowLookup,
): number | null {
  if (!message || message.role !== "assistant") return null;
  const modelId = toOptionalString(message.model);
  if (!modelId) return null;
  const providerId = toOptionalString(message.provider);
  return providerId
    ? (lookup.byCanonicalId.get(toCanonicalPiModelId(providerId, modelId)) ??
        null)
    : (lookup.byModelId.get(modelId) ?? null);
}

function assistantMessage(
  event: Extract<AgentSessionEvent, { type: "agent_end" }>,
) {
  for (let index = event.messages.length - 1; index >= 0; index -= 1) {
    const message = event.messages[index];
    if (message?.role === "assistant") return message;
  }
  return undefined;
}

function assistantText(
  message: ReturnType<typeof assistantMessage>,
): string | undefined {
  if (!message) return undefined;
  const text = message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
  return text.length > 0 ? text : undefined;
}

function toUsageBreakdown(
  message: ReturnType<typeof assistantMessage>,
): ThreadEventTokenUsageBreakdown | undefined {
  if (!message) return undefined;
  const inputTokens = toNonNegativeNumber(message.usage.input);
  const outputTokens = toNonNegativeNumber(message.usage.output);
  const cachedInputTokens =
    toNonNegativeNumber(message.usage.cacheRead) +
    toNonNegativeNumber(message.usage.cacheWrite);
  const totalTokens = toNonNegativeNumber(message.usage.totalTokens);
  return {
    totalTokens:
      totalTokens > 0
        ? totalTokens
        : inputTokens + outputTokens + cachedInputTokens,
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningOutputTokens: toNonNegativeNumber(message.usage.reasoning),
  };
}

function extractPiCommandOutput(content: unknown): string | undefined {
  return normalizeProviderCommandOutput({
    text: extractResultText(content),
    emptyPlaceholders: PI_EMPTY_BASH_OUTPUT_PLACEHOLDERS,
  });
}

function commandOutputDelta(args: {
  partialResult: unknown;
  previousOutput?: string;
}): PiCommandOutputDelta | null {
  const nextOutput = extractPiCommandOutput(args.partialResult);
  if (nextOutput === undefined) return null;
  const delta = diffCumulativeText({
    previousText: args.previousOutput,
    nextText: nextOutput,
  });
  return delta
    ? {
        delta: delta.delta,
        reset: delta.reset,
        snapshot: delta.nextText,
      }
    : null;
}

function initialItemForDelta(args: {
  channel: Extract<ProviderDriverEventInput, { type: "item.delta" }>["channel"];
  itemId: string;
}): ProviderDriverItem | null {
  switch (args.channel) {
    case "assistant_text":
      return { type: "agentMessage", id: args.itemId, text: "" };
    case "reasoning_text":
    case "reasoning_summary":
      return {
        type: "reasoning",
        id: args.itemId,
        summary: [],
        content: [],
      };
    case "plan_text":
      return { type: "plan", id: args.itemId, text: "" };
    case "command_output":
    case "file_change_output":
    case "tool_output":
      return null;
  }
}

type CanonicalTurnEventInput = ProviderDriverEventInput extends infer Event
  ? Event extends { turnId: string }
    ? Event
    : never
  : never;
type CanonicalTurnEventWithoutTurnId =
  CanonicalTurnEventInput extends infer Event
    ? Event extends CanonicalTurnEventInput
      ? Omit<Event, "turnId">
      : never
    : never;

/** Converts Pi SDK lifecycle events directly into the canonical driver event union. */
export class PiCanonicalEventTranslator {
  private readonly attachmentId: string;
  private readonly events: ProviderDriverEventEmitter;
  private readonly modelContextWindows: PiModelContextWindowLookup;
  private readonly openItems = new Map<string, ProviderDriverItem>();
  private readonly commandOutputSnapshots = new Map<string, string>();
  private readonly toolItems = new Map<string, ThreadEventItem>();
  private readonly totalTokens: ThreadEventTokenUsageBreakdown = {
    totalTokens: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
  };
  private activeTurnId: string | null = null;
  private assistantCounter = 0;
  private assistantItemId: string | null = null;
  private pendingRetryError: string | null = null;
  private reasoningCounter = 0;
  private readonly reasoningItemIds = new Map<number, string>();

  constructor(options: PiCanonicalEventTranslatorOptions) {
    this.attachmentId = options.attachmentId;
    this.events = options.events;
    this.modelContextWindows = buildPiModelContextWindowLookup(
      getBuiltinProviders().flatMap((provider) => getBuiltinModels(provider)),
    );
  }

  beginTurn(turnId: string): void {
    this.activeTurnId = turnId;
    this.assistantItemId = null;
    this.pendingRetryError = null;
    this.openItems.clear();
    this.commandOutputSnapshots.clear();
    this.toolItems.clear();
    this.reasoningItemIds.clear();
  }

  translateSdkEvent(
    event: AgentSessionEvent & { providerCheckpointId?: string },
  ): void {
    switch (event.type) {
      case "agent_start":
        return;
      case "agent_end":
        this.translateAgentEnd(event);
        return;
      case "message_update":
        this.translateMessageUpdate(event);
        return;
      case "tool_execution_start":
        this.translateToolStart(event);
        return;
      case "tool_execution_update":
        this.translateToolUpdate(event);
        return;
      case "tool_execution_end":
        this.translateToolEnd(event);
        return;
      case "compaction_start":
        this.translateCompactionStart(event);
        return;
      case "compaction_end":
        this.translateCompactionEnd(event);
        return;
      case "auto_retry_start":
        this.pendingRetryError = event.errorMessage;
        this.emitTurnEvent({
          type: "turn.retrying",
          attachmentId: this.attachmentId,
          attempt: event.attempt,
          message: event.errorMessage,
          retryAt: new Date(Date.now() + event.delayMs).toISOString(),
        });
        return;
      case "auto_retry_end":
        if (!event.success) {
          this.pendingRetryError =
            event.finalError ?? this.pendingRetryError ?? "Pi retry failed";
        } else {
          this.pendingRetryError = null;
        }
        return;
      case "agent_settled":
      case "queue_update":
      case "turn_start":
      case "turn_end":
      case "message_start":
      case "message_end":
      case "entry_appended":
      case "session_info_changed":
      case "thinking_level_changed":
      case "summarization_retry_scheduled":
      case "summarization_retry_attempt_start":
      case "summarization_retry_finished":
      case "bash_execution_update":
        return;
    }
  }

  translateContextWindowUsage(contextWindowUsage: {
    estimated: boolean;
    modelContextWindow: number | null;
    usedTokens: number | null;
  }): void {
    this.events.emit({
      type: "session.context_window_usage_changed",
      attachmentId: this.attachmentId,
      contextWindowUsage,
    });
  }

  settleFailed(error: ProviderDriverError): void {
    const turnId = this.activeTurnId;
    if (turnId === null) {
      this.events.emit({
        type: "provider.warning",
        attachmentId: this.attachmentId,
        code: error.code,
        message: error.message,
      });
      return;
    }
    this.events.emit({
      type: "turn.settled",
      attachmentId: this.attachmentId,
      turnId,
      outcome: "failed",
      error,
      providerCheckpointId: null,
    });
    this.finishTurn();
  }

  settleCancelled(providerCheckpointId: string | null): void {
    const turnId = this.activeTurnId;
    if (turnId === null) return;
    this.events.emit({
      type: "turn.settled",
      attachmentId: this.attachmentId,
      turnId,
      outcome: "cancelled",
      error: null,
      providerCheckpointId,
    });
    this.finishTurn();
  }

  private translateAgentEnd(
    event: Extract<AgentSessionEvent, { type: "agent_end" }> & {
      providerCheckpointId?: string;
    },
  ): void {
    const message = assistantMessage(event);
    if (event.willRetry) {
      this.pendingRetryError = message?.errorMessage ?? "Pi retrying";
      return;
    }
    const terminalError =
      message?.stopReason === "error"
        ? (message.errorMessage ?? this.pendingRetryError)
        : this.pendingRetryError;
    if (terminalError) {
      this.settleFailed(
        canonicalProviderError({
          code: "pi_provider_error",
          message: "Provider error",
          detail: terminalError,
        }),
      );
      return;
    }
    const text = assistantText(message);
    if (text) {
      const itemId = this.resolveAssistantCompletionId();
      this.completeItem({ type: "agentMessage", id: itemId, text });
    }
    const last = toUsageBreakdown(message);
    if (last) {
      this.totalTokens.totalTokens += last.totalTokens;
      this.totalTokens.inputTokens += last.inputTokens;
      this.totalTokens.cachedInputTokens += last.cachedInputTokens;
      this.totalTokens.outputTokens += last.outputTokens;
      this.totalTokens.reasoningOutputTokens += last.reasoningOutputTokens;
      this.emitTurnEvent({
        type: "turn.token_usage_changed",
        attachmentId: this.attachmentId,
        tokenUsage: {
          total: { ...this.totalTokens },
          last,
          modelContextWindow: resolvePiModelContextWindow(
            message,
            this.modelContextWindows,
          ),
        },
      });
    }
    const turnId = this.activeTurnId;
    if (turnId === null) return;
    this.events.emit({
      type: "turn.settled",
      attachmentId: this.attachmentId,
      turnId,
      outcome: message?.stopReason === "aborted" ? "cancelled" : "completed",
      error: null,
      providerCheckpointId: event.providerCheckpointId ?? null,
    });
    this.finishTurn();
  }

  private translateMessageUpdate(
    event: Extract<AgentSessionEvent, { type: "message_update" }>,
  ): void {
    const assistantEvent = event.assistantMessageEvent;
    switch (assistantEvent.type) {
      case "text_delta":
        this.emitDelta({
          itemId: this.getOrCreateAssistantItemId(),
          channel: "assistant_text",
          delta: assistantEvent.delta,
          reset: false,
        });
        return;
      case "thinking_delta":
        this.emitDelta({
          itemId: this.getOrCreateReasoningItemId(assistantEvent.contentIndex),
          channel: "reasoning_text",
          delta: assistantEvent.delta,
          reset: false,
        });
        return;
      case "thinking_end": {
        const itemId = this.getOrCreateReasoningItemId(
          assistantEvent.contentIndex,
        );
        if (assistantEvent.content) {
          this.completeItem({
            type: "reasoning",
            id: itemId,
            summary: [],
            content: [assistantEvent.content],
          });
        }
        this.reasoningItemIds.delete(assistantEvent.contentIndex);
        return;
      }
      case "start":
      case "text_start":
      case "text_end":
      case "thinking_start":
      case "toolcall_start":
      case "toolcall_delta":
      case "toolcall_end":
      case "done":
      case "error":
        return;
    }
  }

  private translateToolStart(
    event: Extract<AgentSessionEvent, { type: "tool_execution_start" }>,
  ): void {
    this.assistantItemId = null;
    const item = translatePiToolUseItem({
      callId: event.toolCallId,
      toolName: event.toolName,
      args: event.args,
    });
    this.toolItems.set(event.toolCallId, item);
    this.startItem(item);
  }

  private translateToolUpdate(
    event: Extract<AgentSessionEvent, { type: "tool_execution_update" }>,
  ): void {
    if (event.toolName === "bash") {
      const output = commandOutputDelta({
        partialResult: event.partialResult,
        previousOutput: this.commandOutputSnapshots.get(event.toolCallId),
      });
      if (!output) return;
      this.commandOutputSnapshots.set(event.toolCallId, output.snapshot);
      this.emitDelta({
        itemId: event.toolCallId,
        channel: "command_output",
        delta: output.delta,
        reset: output.reset,
      });
      return;
    }
    const message = extractResultText(event.partialResult).trim();
    this.emitDelta({
      itemId: event.toolCallId,
      channel: "tool_output",
      delta: message || `${event.toolName} progress update`,
      reset: false,
    });
  }

  private translateToolEnd(
    event: Extract<AgentSessionEvent, { type: "tool_execution_end" }>,
  ): void {
    this.completeItem(
      translatePiToolResultItem({
        callId: event.toolCallId,
        toolName: event.toolName,
        content: event.result,
        isError: event.isError,
        startedItem: this.toolItems.get(event.toolCallId),
      }),
    );
    this.toolItems.delete(event.toolCallId);
    this.commandOutputSnapshots.delete(event.toolCallId);
  }

  private translateCompactionStart(
    event: Extract<AgentSessionEvent, { type: "compaction_start" }>,
  ): void {
    this.startItem({
      type: "contextCompaction",
      id: `pi-compaction-${this.activeTurnId ?? event.reason}`,
    });
  }

  private translateCompactionEnd(
    event: Extract<AgentSessionEvent, { type: "compaction_end" }>,
  ): void {
    const item = [...this.openItems.values()].find(
      (candidate) => candidate.type === "contextCompaction",
    );
    if (item) this.completeItem(item);
    if (!event.aborted && !event.errorMessage) {
      this.emitTurnEvent({
        type: "turn.compacted",
        attachmentId: this.attachmentId,
      });
    }
    if (event.reason !== "manual") return;
    const turnId = this.activeTurnId;
    if (turnId === null) return;
    const failed = event.errorMessage !== undefined;
    this.events.emit({
      type: "turn.settled",
      attachmentId: this.attachmentId,
      turnId,
      outcome: event.aborted ? "cancelled" : failed ? "failed" : "completed",
      error: failed
        ? canonicalProviderError({
            code: "pi_compaction_failed",
            message: "Pi compaction failed",
            detail: event.errorMessage,
          })
        : null,
      providerCheckpointId: null,
    });
    this.finishTurn();
  }

  private startItem(item: ThreadEventItem): void {
    if (item.type === "userMessage" || item.type === "backgroundTask") return;
    this.emitTurnEvent({
      type: "item.started",
      attachmentId: this.attachmentId,
      item,
    });
    this.openItems.set(item.id, item);
  }

  private completeItem(item: ThreadEventItem): void {
    if (item.type === "userMessage" || item.type === "backgroundTask") return;
    if (!this.openItems.has(item.id)) this.startItem(initialItem(item));
    const status = "status" in item ? item.status : "completed";
    const outcome =
      status === "failed"
        ? "failed"
        : status === "interrupted"
          ? "cancelled"
          : "completed";
    this.emitTurnEvent({
      type: "item.completed",
      attachmentId: this.attachmentId,
      item,
      outcome,
      error: outcome === "failed" ? failedItemError(item) : null,
    });
    this.openItems.delete(item.id);
  }

  private emitDelta(
    event: Omit<
      Extract<ProviderDriverEventInput, { type: "item.delta" }>,
      "attachmentId" | "turnId" | "type"
    >,
  ): void {
    if (!this.openItems.has(event.itemId)) {
      const item = initialItemForDelta(event);
      if (item) this.startItem(item);
    }
    if (!this.openItems.has(event.itemId)) return;
    this.emitTurnEvent({
      type: "item.delta",
      attachmentId: this.attachmentId,
      ...event,
    });
  }

  private getOrCreateAssistantItemId(): string {
    this.assistantItemId ??= `pi-assistant-${++this.assistantCounter}`;
    return this.assistantItemId;
  }

  private resolveAssistantCompletionId(): string {
    const itemId = this.getOrCreateAssistantItemId();
    this.assistantItemId = null;
    return itemId;
  }

  private getOrCreateReasoningItemId(contentIndex: number): string {
    const existing = this.reasoningItemIds.get(contentIndex);
    if (existing) return existing;
    const itemId = `pi-reasoning-${++this.reasoningCounter}`;
    this.reasoningItemIds.set(contentIndex, itemId);
    return itemId;
  }

  private emitTurnEvent(event: CanonicalTurnEventWithoutTurnId): void {
    if (this.activeTurnId === null) return;
    this.events.emit({ ...event, turnId: this.activeTurnId });
  }

  private finishTurn(): void {
    this.activeTurnId = null;
    this.assistantItemId = null;
    this.pendingRetryError = null;
    this.openItems.clear();
    this.commandOutputSnapshots.clear();
    this.toolItems.clear();
    this.reasoningItemIds.clear();
  }
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
      return item;
    case "backgroundTask":
      throw new Error("Pi does not emit background-task items");
  }
}
