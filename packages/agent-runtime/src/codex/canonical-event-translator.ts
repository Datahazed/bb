import { getThreadEventScopeTurnId, type ThreadEvent } from "@bb/domain";
import type {
  ProviderDriverError,
  ProviderDriverItem,
} from "@bb/provider-driver-contract";
import type {
  ProviderDriverEventEmitter,
  ProviderDriverEventInput,
} from "@bb/provider-driver-sdk";
import {
  applyCodexRateLimitUpdate,
  createCodexEventTranslationState,
  translateCodexEvent,
} from "./event-translation.js";
import {
  codexBridgeEnvelopeSchema,
  codexRawResponseItemCompletedParamsSchema,
  codexSubAgentActivityItemSchema,
} from "./schemas.js";
import type { ProviderRuntimeEvent } from "../provider-json-rpc.js";
import { extractResultText } from "../shared/provider-utils.js";
import { codexRateLimitReadResponseSchema } from "./schemas.js";

const CODEX_SHELL_TOOL_NAMES = new Set(["exec_command", "Bash", "bash"]);
const CODEX_ACCOUNT_ERROR_TEXT_PATTERN =
  /\b(?:40[19]|429|auth(?:entication|orization)?|credits?|quota|rate[-\s]?limit(?:ed)?|unauthori[sz]ed|usage limit)\b/iu;

interface CodexRawCommandOutputState {
  readonly outputsByCallId: Map<string, string>;
  readonly shellCallIds: Set<string>;
}

interface PendingCommandCompletion {
  readonly item: Extract<ProviderDriverItem, { type: "commandExecution" }>;
  readonly turnId: string;
}

interface CodexSubagentState {
  readonly agentPath: string;
  readonly agentThreadId: string;
  readonly callId: string;
  readonly parentTurnId: string;
  terminal: boolean;
}

function recoveredCommandOutput(raw: unknown): string | null {
  const text = extractResultText(raw).replace(/\r\n?/gu, "\n");
  if (text.length === 0) return "";
  const marker = "Output:\n";
  const markerIndex = text.indexOf(marker);
  // Only strip Codex's wrapper when the marker follows known metadata. A
  // literal command output line named "Output:" must remain user output.
  const wrapper = text.slice(0, markerIndex);
  const hasCodexMetadata =
    wrapper.startsWith("Chunk ID:") &&
    wrapper.includes("Wall time:") &&
    wrapper.includes("Process exited with code ");
  return markerIndex === -1 || !hasCodexMetadata
    ? text
    : text.slice(markerIndex + marker.length);
}

function mergeCommandOutput(
  streamed: string | undefined,
  completed: string | undefined,
): string | undefined {
  if (!streamed) return completed;
  if (!completed || streamed.endsWith(completed)) return streamed;
  if (completed.startsWith(streamed)) return completed;
  return `${streamed}${completed}`;
}

interface CodexCanonicalEventTranslatorOptions {
  readonly attachmentId: string;
  readonly events: ProviderDriverEventEmitter;
  readonly onAccountRestartRequired?: () => void;
}

function canonicalCodexError(args: {
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
    case "webFetch":
      return { ...item, resultText: null };
    case "imageView":
    case "contextCompaction":
    case "backgroundTask":
      return item;
  }
}

function itemStatus(item: ProviderDriverItem): string {
  return "status" in item ? item.status : "completed";
}

function terminalAccountErrorCategory(
  event: Extract<ThreadEvent, { type: "provider/error" }>,
): ProviderDriverError["category"] | null {
  if (event.willRetry === true) return null;
  if (event.errorInfo?.category === "rate-limit") return "rate_limit";
  if (event.errorInfo?.category === "unauthorized") return "authentication";
  const text = [event.message, event.detail]
    .filter((part) => part !== undefined)
    .join("\n");
  if (!CODEX_ACCOUNT_ERROR_TEXT_PATTERN.test(text)) return null;
  return /\b(?:40[19]|auth(?:entication|orization)?|unauthori[sz]ed)\b/iu.test(
    text,
  )
    ? "authentication"
    : "rate_limit";
}

function failedItemError(item: ProviderDriverItem): ProviderDriverError {
  return canonicalCodexError({
    code: "codex_item_failed",
    message: `Codex ${item.type} item failed`,
    ...(item.type === "toolCall" && item.error ? { detail: item.error } : {}),
  });
}

export class CodexCanonicalEventTranslator {
  private readonly attachmentId: string;
  private readonly events: ProviderDriverEventEmitter;
  private readonly onAccountRestartRequired: () => void;
  private readonly openItems = new Map<string, ProviderDriverItem>();
  private readonly pendingCommandCompletions = new Map<
    string,
    PendingCommandCompletion
  >();
  private readonly rawCommandOutputState: CodexRawCommandOutputState = {
    outputsByCallId: new Map(),
    shellCallIds: new Set(),
  };
  private readonly state = createCodexEventTranslationState();
  private readonly childParentCallByProviderThreadId = new Map<
    string,
    string
  >();
  private readonly childParentCallByProviderTurnId = new Map<string, string>();
  private readonly pendingChildParentCallIds: string[] = [];
  private readonly subagentsByAgentThreadId = new Map<
    string,
    CodexSubagentState
  >();
  private readonly subagentsByCallId = new Map<string, CodexSubagentState>();
  private activeProviderTurnId: string | null = null;
  private activeProviderTurnStarted = false;
  private activeTurnId: string | null = null;

  constructor(options: CodexCanonicalEventTranslatorOptions) {
    this.attachmentId = options.attachmentId;
    this.events = options.events;
    this.onAccountRestartRequired =
      options.onAccountRestartRequired ?? (() => {});
  }

  get activeTurn(): string | null {
    return this.activeTurnId;
  }

  get providerTurn(): string | null {
    return this.activeProviderTurnId;
  }

  get providerTurnReady(): boolean {
    return this.activeProviderTurnStarted;
  }

  beginTurn(turnId: string): void {
    this.activeTurnId = turnId;
    this.activeProviderTurnId = null;
    this.activeProviderTurnStarted = false;
    this.openItems.clear();
  }

  setProviderTurnId(providerTurnId: string): void {
    if (
      this.activeProviderTurnId !== null &&
      this.activeProviderTurnId !== providerTurnId
    ) {
      throw new Error(
        `Codex started provider turn ${this.activeProviderTurnId}, but turn/start returned ${providerTurnId}`,
      );
    }
    this.activeProviderTurnId = providerTurnId;
  }

  translateEvents(events: readonly ThreadEvent[]): void {
    for (const event of events) this.project(event);
  }

  hydrateRateLimits(result: unknown): void {
    const parsed = codexRateLimitReadResponseSchema.parse(result);
    applyCodexRateLimitUpdate(this.state, parsed.rateLimits);
  }

  translate(method: string, params: unknown): void {
    const rawEvent: ProviderRuntimeEvent = {
      jsonrpc: "2.0",
      method,
      ...(params === undefined ? {} : { params }),
    };
    if (this.consumeRawCommandOutput(rawEvent)) return;
    if (this.consumeSubagentActivity(rawEvent)) return;
    this.translateEvents(translateCodexEvent(rawEvent, this.state));
  }

  failActiveTurn(message: string): void {
    const turnId = this.activeTurnId;
    if (turnId === null) return;
    this.completeOpenItems("failed");
    this.events.emit({
      type: "turn.settled",
      attachmentId: this.attachmentId,
      turnId,
      outcome: "failed",
      error: canonicalCodexError({
        code: "codex_app_server_failed",
        message,
      }),
      providerCheckpointId: null,
    });
    this.finishTurn();
  }

  private project(event: ThreadEvent): void {
    const providerTurnId = getThreadEventScopeTurnId(event.scope);
    const turnId = this.canonicalTurnIdForProviderTurn(providerTurnId);
    switch (event.type) {
      case "turn/started":
        if (!turnId || !providerTurnId) return;
        if (this.activeProviderTurnId === null) {
          this.activeProviderTurnId = providerTurnId;
        }
        if (providerTurnId === this.activeProviderTurnId) {
          this.activeProviderTurnStarted = true;
        } else {
          this.linkChildTurn(event.providerThreadId, providerTurnId);
        }
        return;
      case "turn/completed": {
        if (!turnId || !providerTurnId) return;
        if (this.activeProviderTurnId === null) {
          this.activeProviderTurnId = providerTurnId;
        }
        if (providerTurnId !== this.activeProviderTurnId) {
          this.completeChildTurn(providerTurnId, event.status);
          return;
        }
        this.completeOpenItems(event.status);
        const failed = event.status === "failed";
        this.events.emit({
          type: "turn.settled",
          attachmentId: this.attachmentId,
          turnId,
          outcome:
            event.status === "completed"
              ? "completed"
              : event.status === "interrupted"
                ? "cancelled"
                : "failed",
          error: failed
            ? canonicalCodexError({
                code: "codex_turn_failed",
                message: event.error?.message ?? "Codex turn failed",
              })
            : null,
          providerCheckpointId: providerTurnId ?? null,
        });
        this.finishTurn();
        return;
      }
      case "item/started":
        if (!turnId || event.item.type === "userMessage") return;
        this.observeDelegation(event.item, event.providerThreadId);
        this.startItem(
          turnId,
          this.withChildParent(event.item, providerTurnId),
        );
        return;
      case "item/completed": {
        if (!turnId || event.item.type === "userMessage") return;
        this.observeDelegation(event.item, event.providerThreadId);
        const item = this.withChildParent(event.item, providerTurnId);
        if (
          item.type === "commandExecution" &&
          this.rawCommandOutputState.shellCallIds.has(item.id) &&
          !this.rawCommandOutputState.outputsByCallId.has(item.id)
        ) {
          // Codex can emit item/completed before its raw function-call output.
          // Keep the item open briefly so the authoritative full shell output
          // can repair normalized output that omitted an early chunk.
          this.pendingCommandCompletions.set(item.id, { item, turnId });
          return;
        }
        this.completeItem(turnId, item);
        return;
      }
      case "item/agentMessage/delta":
        this.emitDelta(turnId, event.itemId, "assistant_text", event.delta);
        return;
      case "item/reasoning/textDelta":
        this.emitDelta(turnId, event.itemId, "reasoning_text", event.delta);
        return;
      case "item/reasoning/summaryTextDelta":
        this.emitDelta(turnId, event.itemId, "reasoning_summary", event.delta);
        return;
      case "item/commandExecution/outputDelta":
        this.emitDelta(turnId, event.itemId, "command_output", event.delta);
        return;
      case "item/fileChange/outputDelta":
        this.emitDelta(turnId, event.itemId, "file_change_output", event.delta);
        return;
      case "item/plan/delta":
        this.emitDelta(turnId, event.itemId, "plan_text", event.delta);
        return;
      case "item/toolCall/progress":
        this.emitDelta(
          turnId,
          event.itemId,
          "tool_output",
          event.message ?? "",
        );
        return;
      case "thread/tokenUsage/updated":
        if (!turnId) return;
        this.events.emit({
          type: "turn.token_usage_changed",
          attachmentId: this.attachmentId,
          turnId,
          tokenUsage: event.tokenUsage,
        });
        return;
      case "thread/contextWindowUsage/updated":
        this.events.emit({
          type: "session.context_window_usage_changed",
          attachmentId: this.attachmentId,
          contextWindowUsage: event.contextWindowUsage,
        });
        return;
      case "thread/compacted":
        if (!turnId) return;
        this.events.emit({
          type: "turn.compacted",
          attachmentId: this.attachmentId,
          turnId,
        });
        return;
      case "provider/rateLimits/updated":
        this.events.emit({
          type: "provider.rate_limits_changed",
          attachmentId: this.attachmentId,
          rateLimits: event.rateLimits,
        });
        return;
      case "provider/warning":
        this.events.emit({
          type: "provider.warning",
          attachmentId: this.attachmentId,
          code: `codex_${event.category}`,
          message: event.details
            ? `${event.summary}\n${event.details}`
            : event.summary || "Codex warning",
        });
        return;
      case "provider/error": {
        if (event.willRetry === true && turnId) {
          this.events.emit({
            type: "turn.retrying",
            attachmentId: this.attachmentId,
            turnId,
            attempt: 1,
            message: event.detail ?? event.message,
            retryAt: null,
          });
          return;
        }
        const accountCategory = terminalAccountErrorCategory(event);
        if (accountCategory === null) return;
        this.onAccountRestartRequired();
        if (!turnId) return;
        this.completeOpenItems("failed");
        this.events.emit({
          type: "turn.settled",
          attachmentId: this.attachmentId,
          turnId,
          outcome: "failed",
          error: {
            code: "codex_account_error",
            category: accountCategory,
            message: event.detail ?? event.message,
            retry: { disposition: "never" },
          },
          providerCheckpointId: providerTurnId ?? null,
        });
        this.finishTurn();
        return;
      }
      case "turn/plan/updated": {
        if (!turnId) return;
        const text = event.plan
          .map((step) =>
            step.status ? `[${step.status}] ${step.step}` : step.step,
          )
          .join("\n");
        const item: ProviderDriverItem = {
          type: "plan",
          id: `codex-plan-${turnId}`,
          text,
        };
        if (!this.openItems.has(item.id)) {
          this.openItems.set(item.id, initialItem(item));
          this.events.emit({
            type: "item.started",
            attachmentId: this.attachmentId,
            turnId,
            item: initialItem(item),
          });
        }
        this.events.emit({
          type: "item.delta",
          attachmentId: this.attachmentId,
          turnId,
          itemId: item.id,
          channel: "plan_text",
          delta: text,
          reset: true,
        });
        this.openItems.set(item.id, item);
        return;
      }
      case "thread/started":
      case "thread/identity":
      case "thread/name/updated":
      case "thread/goal/updated":
      case "thread/goal/cleared":
      case "provider/unhandled":
      case "provider/modelFallback":
      case "item/backgroundTask/progress":
      case "item/backgroundTask/completed":
      case "turn/input/accepted":
        return;
    }
  }

  private canonicalTurnIdForProviderTurn(
    _providerTurnId: string | undefined,
  ): string | undefined {
    return this.activeTurnId ?? undefined;
  }

  private startItem(turnId: string, item: ProviderDriverItem): void {
    if (this.openItems.has(item.id)) return;
    this.openItems.set(item.id, item);
    this.events.emit({
      type: "item.started",
      attachmentId: this.attachmentId,
      turnId,
      item,
    });
  }

  private emitDelta(
    turnId: string | undefined,
    itemId: string,
    channel: Extract<
      ProviderDriverEventInput,
      { type: "item.delta" }
    >["channel"],
    delta: string,
  ): void {
    if (!turnId) return;
    const item = this.openItems.get(itemId);
    if (!item) return;
    if (channel === "command_output" && item.type === "commandExecution") {
      this.openItems.set(itemId, {
        ...item,
        aggregatedOutput: `${item.aggregatedOutput ?? ""}${delta}`,
      });
    }
    this.events.emit({
      type: "item.delta",
      attachmentId: this.attachmentId,
      turnId,
      itemId,
      channel,
      delta,
      reset: false,
    });
  }

  private completeItem(turnId: string, item: ProviderDriverItem): void {
    const openItem = this.openItems.get(item.id);
    const streamedOutput =
      openItem?.type === "commandExecution"
        ? openItem.aggregatedOutput
        : undefined;
    const completedItem =
      item.type === "commandExecution"
        ? {
            ...item,
            aggregatedOutput:
              this.rawCommandOutputState.outputsByCallId.get(item.id) ??
              mergeCommandOutput(streamedOutput, item.aggregatedOutput),
          }
        : item;
    this.rawCommandOutputState.outputsByCallId.delete(item.id);
    this.rawCommandOutputState.shellCallIds.delete(item.id);
    if (!this.openItems.has(completedItem.id)) {
      this.openItems.set(completedItem.id, initialItem(completedItem));
      this.events.emit({
        type: "item.started",
        attachmentId: this.attachmentId,
        turnId,
        item: initialItem(completedItem),
      });
    }
    const status = itemStatus(completedItem);
    const outcome =
      status === "failed"
        ? "failed"
        : status === "interrupted" || status === "declined"
          ? "cancelled"
          : "completed";
    this.events.emit({
      type: "item.completed",
      attachmentId: this.attachmentId,
      turnId,
      item: completedItem,
      outcome,
      error: outcome === "failed" ? failedItemError(completedItem) : null,
    });
    this.openItems.delete(completedItem.id);
  }

  private completeOpenItems(
    status: "completed" | "failed" | "interrupted",
  ): void {
    const turnId = this.activeTurnId;
    if (!turnId) return;
    for (const pending of [...this.pendingCommandCompletions.values()]) {
      this.completeItem(pending.turnId, pending.item);
    }
    this.pendingCommandCompletions.clear();
    for (const item of [...this.openItems.values()]) {
      if ("status" in item) {
        this.completeItem(turnId, { ...item, status });
      } else {
        this.completeItem(turnId, item);
      }
    }
  }

  private consumeSubagentActivity(event: ProviderRuntimeEvent): boolean {
    const envelope = codexBridgeEnvelopeSchema.safeParse(event);
    if (!envelope.success || envelope.data.method !== "item/completed") {
      return false;
    }
    const params = envelope.data.params;
    if (
      !params ||
      typeof params.turnId !== "string" ||
      typeof params.threadId !== "string"
    ) {
      return false;
    }
    const item = codexSubAgentActivityItemSchema.safeParse(params.item);
    if (!item.success) return false;
    const parentTurnId = this.canonicalTurnIdForProviderTurn(params.turnId);
    if (!parentTurnId) return true;

    switch (item.data.kind) {
      case "started": {
        if (this.subagentsByCallId.has(item.data.id)) return true;
        const subagent: CodexSubagentState = {
          agentPath: item.data.agentPath,
          agentThreadId: item.data.agentThreadId,
          callId: item.data.id,
          parentTurnId: params.turnId,
          terminal: false,
        };
        this.subagentsByCallId.set(subagent.callId, subagent);
        this.subagentsByAgentThreadId.set(subagent.agentThreadId, subagent);
        this.childParentCallByProviderThreadId.set(
          subagent.agentThreadId,
          subagent.callId,
        );
        this.pendingChildParentCallIds.push(subagent.callId);
        this.startItem(parentTurnId, this.subagentItem(subagent, "pending"));
        return true;
      }
      case "interacted":
        return true;
      case "interrupted": {
        const subagent = this.subagentsByAgentThreadId.get(
          item.data.agentThreadId,
        );
        if (subagent) this.completeSubagent(subagent, "interrupted");
        return true;
      }
    }
  }

  private observeDelegation(
    item: ProviderDriverItem,
    providerThreadId: string,
  ): void {
    if (
      item.type !== "toolCall" ||
      (item.tool !== "spawnAgent" && item.tool !== "resumeAgent")
    ) {
      return;
    }
    const receivers = item.arguments?.receiverThreadIds;
    if (Array.isArray(receivers)) {
      for (const receiver of receivers) {
        if (typeof receiver === "string" && receiver !== providerThreadId) {
          this.childParentCallByProviderThreadId.set(receiver, item.id);
        }
      }
    }
    if (!Array.isArray(receivers) || receivers.length === 0) {
      this.pendingChildParentCallIds.push(item.id);
    }
  }

  private linkChildTurn(
    providerThreadId: string,
    providerTurnId: string,
  ): void {
    const parentCallId =
      this.childParentCallByProviderThreadId.get(providerThreadId) ??
      this.pendingChildParentCallIds.shift();
    if (parentCallId) {
      this.childParentCallByProviderTurnId.set(providerTurnId, parentCallId);
    }
  }

  private withChildParent(
    item: ProviderDriverItem,
    providerTurnId: string | undefined,
  ): ProviderDriverItem {
    const parentToolCallId = providerTurnId
      ? this.childParentCallByProviderTurnId.get(providerTurnId)
      : undefined;
    return parentToolCallId &&
      !("parentToolCallId" in item && item.parentToolCallId)
      ? { ...item, parentToolCallId }
      : item;
  }

  private subagentItem(
    subagent: CodexSubagentState,
    status: "pending" | "completed" | "failed" | "interrupted",
  ): ProviderDriverItem {
    return {
      type: "toolCall",
      id: subagent.callId,
      tool: "spawnAgent",
      arguments: {
        senderTurnId: subagent.parentTurnId,
        receiverThreadIds: [subagent.agentThreadId],
        description: subagent.agentPath,
      },
      status,
      ...(status === "pending"
        ? {}
        : {
            result: {
              agentPath: subagent.agentPath,
              agentThreadId: subagent.agentThreadId,
            },
          }),
    };
  }

  private completeChildTurn(
    providerTurnId: string,
    status: "completed" | "failed" | "interrupted",
  ): void {
    const callId = this.childParentCallByProviderTurnId.get(providerTurnId);
    this.childParentCallByProviderTurnId.delete(providerTurnId);
    if (!callId) return;
    const subagent = this.subagentsByCallId.get(callId);
    if (subagent) this.completeSubagent(subagent, status);
  }

  private completeSubagent(
    subagent: CodexSubagentState,
    status: "completed" | "failed" | "interrupted",
  ): void {
    const parentTurnId = this.canonicalTurnIdForProviderTurn(
      subagent.parentTurnId,
    );
    if (subagent.terminal || !parentTurnId) return;
    subagent.terminal = true;
    this.completeItem(parentTurnId, this.subagentItem(subagent, status));
  }

  private consumeRawCommandOutput(event: ProviderRuntimeEvent): boolean {
    const envelope = codexBridgeEnvelopeSchema.safeParse(event);
    if (
      !envelope.success ||
      envelope.data.method !== "rawResponseItem/completed"
    ) {
      return false;
    }
    const parsed = codexRawResponseItemCompletedParamsSchema.safeParse(
      envelope.data.params,
    );
    if (!parsed.success) return true;
    const item = parsed.data.item;
    if (
      item.type === "function_call" &&
      CODEX_SHELL_TOOL_NAMES.has(item.name)
    ) {
      this.rawCommandOutputState.shellCallIds.add(item.call_id);
      return true;
    }
    if (
      item.type === "function_call_output" &&
      this.rawCommandOutputState.shellCallIds.has(item.call_id)
    ) {
      const output = recoveredCommandOutput(item.output);
      if (output !== null) {
        this.rawCommandOutputState.outputsByCallId.set(item.call_id, output);
        const pending = this.pendingCommandCompletions.get(item.call_id);
        if (pending) {
          this.pendingCommandCompletions.delete(item.call_id);
          this.completeItem(pending.turnId, pending.item);
        }
      }
    }
    return true;
  }

  private finishTurn(): void {
    this.pendingCommandCompletions.clear();
    this.activeTurnId = null;
    this.activeProviderTurnId = null;
    this.activeProviderTurnStarted = false;
    this.openItems.clear();
    this.childParentCallByProviderThreadId.clear();
    this.childParentCallByProviderTurnId.clear();
    this.pendingChildParentCallIds.length = 0;
    this.subagentsByAgentThreadId.clear();
    this.subagentsByCallId.clear();
  }
}
