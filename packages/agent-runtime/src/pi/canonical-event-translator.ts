import {
  type ProviderErrorCategory,
  type ThreadEvent,
  type ThreadEventItem,
} from "@bb/domain";
import type {
  ProviderDriverError,
  ProviderDriverItem,
} from "@bb/provider-driver-contract";
import type {
  ProviderDriverEventEmitter,
  ProviderDriverEventInput,
} from "@bb/provider-driver-sdk";
import type { ProviderAdapter } from "../provider-adapter.js";
import { createPiProviderAdapter } from "./adapter.js";

interface PiCanonicalEventTranslatorOptions {
  readonly attachmentId: string;
  readonly bbThreadId: string;
  readonly events: ProviderDriverEventEmitter;
}

function canonicalErrorCategory(
  category: ProviderErrorCategory | undefined,
): ProviderDriverError["category"] {
  switch (category) {
    case "rate-limit":
    case "billing":
    case "budget-exceeded":
      return "rate_limit";
    case "unauthorized":
      return "authentication";
    case "context-window-exceeded":
    case "max-output-tokens":
      return "context_limit";
    case "policy":
    case "sandbox":
      return "permission";
    case "bad-request":
      return "configuration";
    case "connection-failed":
    case "overloaded":
    case "stream-disconnected":
      return "provider_unavailable";
    case "internal":
      return "driver";
    case "active-turn-not-steerable":
    case "max-turns":
    case "structured-output-retries":
    case "thread-rollback-failed":
    case "too-many-failed-attempts":
    case "unknown":
    case undefined:
      return "provider";
  }
}

function toCanonicalError(
  event: Extract<ThreadEvent, { type: "provider/error" }>,
): ProviderDriverError {
  return {
    code: event.errorInfo?.providerCode ?? "pi_provider_error",
    category: canonicalErrorCategory(event.errorInfo?.category),
    message: event.message,
    ...(event.detail !== undefined ? { detail: event.detail } : {}),
    retry: {
      disposition: event.willRetry === true ? "automatic" : "never",
    },
  };
}

function failedItemError(item: ProviderDriverItem): ProviderDriverError {
  const detail = item.type === "toolCall" ? item.error : undefined;
  return {
    code: "pi_item_failed",
    category: "provider",
    message: `Pi ${item.type} item failed`,
    ...(detail !== undefined ? { detail } : {}),
    retry: { disposition: "never" },
  };
}

function canonicalItem(item: ThreadEventItem): ProviderDriverItem | null {
  return item.type === "userMessage" || item.type === "backgroundTask"
    ? null
    : item;
}

function initialItem(item: ThreadEventItem): ProviderDriverItem | null {
  switch (item.type) {
    case "userMessage":
    case "backgroundTask":
      return null;
    case "agentMessage":
      return { ...item, text: "" };
    case "reasoning":
      return { ...item, summary: [], content: [] };
    case "commandExecution":
      return {
        type: "commandExecution",
        id: item.id,
        command: item.command,
        cwd: item.cwd,
        status: "pending",
        approvalStatus: item.approvalStatus,
        ...(item.parentToolCallId !== undefined
          ? { parentToolCallId: item.parentToolCallId }
          : {}),
      };
    case "fileChange":
      return {
        ...item,
        status: "pending",
      };
    case "toolCall":
      return item.status === "pending"
        ? {
            type: "toolCall",
            id: item.id,
            ...(item.server !== undefined ? { server: item.server } : {}),
            tool: item.tool,
            ...(item.arguments !== undefined
              ? { arguments: item.arguments }
              : {}),
            ...(item.statusLabels !== undefined
              ? { statusLabels: item.statusLabels }
              : {}),
            status: "pending",
            ...(item.parentToolCallId !== undefined
              ? { parentToolCallId: item.parentToolCallId }
              : {}),
          }
        : item;
    case "plan":
      return { ...item, text: "" };
    case "webSearch":
      return { ...item, resultText: null };
    case "webFetch":
      return { ...item, resultText: null };
    case "imageView":
    case "contextCompaction":
      return item;
  }
}

type PiCanonicalTurnEventInput = ProviderDriverEventInput extends infer Event
  ? Event extends { turnId: string }
    ? Event
    : never
  : never;
type PiCanonicalTurnEventWithoutTurnId =
  PiCanonicalTurnEventInput extends infer Event
    ? Event extends PiCanonicalTurnEventInput
      ? Omit<Event, "turnId">
      : never
    : never;

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

/** Transitional Pi translator that runs the retained adapter semantics inside the driver process. */
export class PiCanonicalEventTranslator {
  private readonly adapter: ProviderAdapter;
  private readonly attachmentId: string;
  private readonly bbThreadId: string;
  private readonly events: ProviderDriverEventEmitter;
  private readonly openItems = new Map<string, ProviderDriverItem>();
  private activeTurnId: string | null = null;
  private pendingTurnError: ProviderDriverError | null = null;
  private retryAttempt = 0;

  constructor(options: PiCanonicalEventTranslatorOptions) {
    this.adapter = createPiProviderAdapter();
    this.attachmentId = options.attachmentId;
    this.bbThreadId = options.bbThreadId;
    this.events = options.events;
  }

  beginTurn(turnId: string): void {
    this.activeTurnId = turnId;
    this.pendingTurnError = null;
    this.retryAttempt = 0;
    this.openItems.clear();
  }

  translateSdkEvent(event: unknown): void {
    const translated = this.adapter.translateEvent(
      {
        jsonrpc: "2.0",
        method: "sdk/message",
        params: {
          threadId: this.bbThreadId,
          message: event,
        },
      },
      { threadId: this.bbThreadId },
    );
    this.translateThreadEvents(translated);
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

  private translateThreadEvents(events: ThreadEvent[]): void {
    for (const event of events) {
      this.translateThreadEvent(event);
    }
  }

  private translateThreadEvent(event: ThreadEvent): void {
    switch (event.type) {
      case "turn/started":
      case "turn/input/accepted":
      case "thread/started":
      case "thread/identity":
        return;
      case "item/started":
        this.startItem(event.item);
        return;
      case "item/completed":
        this.completeItem(event.item);
        return;
      case "item/agentMessage/delta":
        this.emitDelta({
          itemId: event.itemId,
          channel: "assistant_text",
          delta: event.delta,
          reset: false,
        });
        return;
      case "item/reasoning/textDelta":
        this.emitDelta({
          itemId: event.itemId,
          channel: "reasoning_text",
          delta: event.delta,
          reset: false,
        });
        return;
      case "item/reasoning/summaryTextDelta":
        this.emitDelta({
          itemId: event.itemId,
          channel: "reasoning_summary",
          delta: event.delta,
          reset: false,
        });
        return;
      case "item/commandExecution/outputDelta":
        this.emitDelta({
          itemId: event.itemId,
          channel: "command_output",
          delta: event.delta,
          reset: event.reset === true,
        });
        return;
      case "item/fileChange/outputDelta":
        this.emitDelta({
          itemId: event.itemId,
          channel: "file_change_output",
          delta: event.delta,
          reset: false,
        });
        return;
      case "item/plan/delta":
        this.emitDelta({
          itemId: event.itemId,
          channel: "plan_text",
          delta: event.delta,
          reset: false,
        });
        return;
      case "item/toolCall/progress":
      case "item/mcpToolCall/progress":
        this.emitDelta({
          itemId: event.itemId,
          channel: "tool_output",
          delta: event.message ?? "Tool progress",
          reset: false,
        });
        return;
      case "thread/compacted":
        this.completeOpenCompactionItem();
        this.emitTurnEvent({
          type: "turn.compacted",
          attachmentId: this.attachmentId,
        });
        return;
      case "thread/tokenUsage/updated":
        this.emitTurnEvent({
          type: "turn.token_usage_changed",
          attachmentId: this.attachmentId,
          tokenUsage: event.tokenUsage,
        });
        return;
      case "thread/contextWindowUsage/updated":
        this.translateContextWindowUsage(event.contextWindowUsage);
        return;
      case "provider/error": {
        const error = toCanonicalError(event);
        if (event.willRetry === true) {
          this.retryAttempt += 1;
          this.emitTurnEvent({
            type: "turn.retrying",
            attachmentId: this.attachmentId,
            attempt: this.retryAttempt,
            message: event.detail ?? event.message,
            retryAt: null,
          });
          return;
        }
        this.pendingTurnError = error;
        return;
      }
      case "turn/completed": {
        const turnId = this.activeTurnId;
        if (turnId === null) return;
        const outcome =
          event.status === "completed"
            ? "completed"
            : event.status === "interrupted"
              ? "cancelled"
              : "failed";
        const error =
          outcome === "failed"
            ? (this.pendingTurnError ?? {
                code: "pi_turn_failed",
                category: "provider" as const,
                message: event.error?.message ?? "Pi turn failed",
                retry: { disposition: "never" as const },
              })
            : null;
        this.events.emit({
          type: "turn.settled",
          attachmentId: this.attachmentId,
          turnId,
          outcome,
          error,
          providerCheckpointId: event.providerCheckpointId ?? null,
        });
        this.finishTurn();
        return;
      }
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
          code: "pi_warning",
          message: event.summary ?? event.details ?? "Pi warning",
        });
        return;
      case "provider/unhandled":
        this.events.emit({
          type: "provider.warning",
          attachmentId: this.attachmentId,
          code: "pi_unhandled_event",
          message: `Unhandled Pi event: ${event.rawType}`,
        });
        return;
      case "provider/modelFallback":
        this.events.emit({
          type: "provider.warning",
          attachmentId: this.attachmentId,
          code: "pi_model_fallback",
          message: event.message,
        });
        return;
      case "thread/name/updated":
      case "thread/goal/updated":
      case "thread/goal/cleared":
      case "turn/plan/updated":
      case "turn/diff/updated":
      case "item/backgroundTask/progress":
      case "item/backgroundTask/completed":
      case "system/error":
      case "system/manager/user_message":
      case "system/thread/interrupted":
      case "system/operation":
      case "system/permissionGrant/lifecycle":
      case "system/userQuestion/lifecycle":
      case "system/thread-provisioning":
      case "system/provider-turn-watchdog":
      case "client/thread/start":
      case "client/turn/requested":
      case "client/turn/start":
        this.events.emit({
          type: "provider.warning",
          attachmentId: this.attachmentId,
          code: "pi_unprojected_event",
          message: `Pi produced unsupported translated event ${event.type}`,
        });
    }
  }

  private startItem(item: ThreadEventItem): void {
    const initial = initialItem(item);
    if (!initial) {
      this.warnUnsupportedItem(item.type);
      return;
    }
    this.emitTurnEvent({
      type: "item.started",
      attachmentId: this.attachmentId,
      item: initial,
    });
    this.openItems.set(initial.id, initial);
  }

  private completeItem(item: ThreadEventItem): void {
    const completed = canonicalItem(item);
    if (!completed) {
      this.warnUnsupportedItem(item.type);
      return;
    }
    if (!this.openItems.has(completed.id)) {
      this.startItem(completed);
    }
    const itemStatus = "status" in item ? item.status : "completed";
    const outcome =
      itemStatus === "failed"
        ? "failed"
        : itemStatus === "interrupted"
          ? "cancelled"
          : "completed";
    this.emitTurnEvent({
      type: "item.completed",
      attachmentId: this.attachmentId,
      item: completed,
      outcome,
      error: outcome === "failed" ? failedItemError(completed) : null,
    });
    this.openItems.delete(completed.id);
  }

  private emitDelta(
    event: Omit<
      Extract<ProviderDriverEventInput, { type: "item.delta" }>,
      "attachmentId" | "turnId" | "type"
    >,
  ): void {
    if (!this.openItems.has(event.itemId)) {
      const initial = initialItemForDelta(event);
      if (initial) {
        this.startItem(initial);
      }
    }
    if (!this.openItems.has(event.itemId)) {
      this.events.emit({
        type: "provider.warning",
        attachmentId: this.attachmentId,
        code: "pi_delta_without_item",
        message: `Pi emitted ${event.channel} for unknown item ${event.itemId}`,
      });
      return;
    }
    this.emitTurnEvent({
      type: "item.delta",
      attachmentId: this.attachmentId,
      ...event,
    });
  }

  private completeOpenCompactionItem(): void {
    const compaction = [...this.openItems.values()].find(
      (item) => item.type === "contextCompaction",
    );
    if (compaction) {
      this.emitTurnEvent({
        type: "item.completed",
        attachmentId: this.attachmentId,
        item: compaction,
        outcome: "completed",
        error: null,
      });
      this.openItems.delete(compaction.id);
    }
  }

  private emitTurnEvent(event: PiCanonicalTurnEventWithoutTurnId): void {
    if (this.activeTurnId === null) {
      this.events.emit({
        type: "provider.warning",
        attachmentId: this.attachmentId,
        code: "pi_event_without_turn",
        message: `Pi emitted ${event.type} without an active canonical turn`,
      });
      return;
    }
    this.events.emit({ ...event, turnId: this.activeTurnId });
  }

  private warnUnsupportedItem(itemType: ThreadEventItem["type"]): void {
    this.events.emit({
      type: "provider.warning",
      attachmentId: this.attachmentId,
      code: "pi_unsupported_item",
      message: `Pi produced unsupported canonical item ${itemType}`,
    });
  }

  private finishTurn(): void {
    this.activeTurnId = null;
    this.pendingTurnError = null;
    this.retryAttempt = 0;
    this.openItems.clear();
  }
}
