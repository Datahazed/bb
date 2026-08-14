import type {
  PendingInteractionApprovalDecision,
  ThreadEventItem,
  ThreadEventItemStatus,
  ThreadEventPlanStep,
} from "@bb/domain";
import type {
  ProviderDriverError,
  ProviderDriverItem,
} from "@bb/provider-driver-contract";
import type {
  ProviderDriverEventEmitter,
  ProviderDriverEventInput,
} from "@bb/provider-driver-sdk";
import { z } from "zod";
import {
  buildEditDiff,
  extractResultText,
  toOptionalString,
} from "@bb/provider-driver-helpers/provider-utils";
import { completeStartedToolItem } from "@bb/provider-driver-helpers/tool-item-translation";
import type { AcpPermissionOption } from "./wire.js";
import {
  acpAgentMessageChunkUpdateSchema,
  acpAgentThoughtChunkUpdateSchema,
  acpPlanUpdateSchema,
  acpToolCallUpdateEventSchema,
  acpUsageUpdateSchema,
  extractAcpContentText,
  type AcpSessionUpdate,
  type AcpStopReason,
  type AcpToolCallUpdateEvent,
} from "./wire.js";

interface AcpCanonicalEventTranslatorOptions {
  readonly attachmentId: string;
  readonly events: ProviderDriverEventEmitter;
}

const ACP_PLAN_STEP_STATUS_BY_ENTRY_STATUS = {
  pending: "pending",
  in_progress: "active",
  completed: "completed",
} as const;

const acpRawInputCommandSchema = z
  .object({ command: z.string() })
  .passthrough();
const acpRawInputPathSchema = z
  .object({
    path: z.string().optional(),
    filePath: z.string().optional(),
    file_path: z.string().optional(),
  })
  .passthrough();

function canonicalAcpError(args: {
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

function mapAcpToolCallStatus(
  status: AcpToolCallUpdateEvent["status"],
): "pending" | "completed" | "failed" {
  switch (status) {
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    default:
      return "pending";
  }
}

function extractAcpCommand(event: {
  rawInput?: unknown;
  title?: string;
}): string | undefined {
  const parsed = acpRawInputCommandSchema.safeParse(event.rawInput);
  if (parsed.success && parsed.data.command.trim().length > 0) {
    return parsed.data.command;
  }
  return toOptionalString(event.title);
}

function extractAcpToolCallPath(
  event: Pick<AcpToolCallUpdateEvent, "locations" | "rawInput">,
): string | undefined {
  for (const location of event.locations ?? []) {
    if (location.path.trim().length > 0) return location.path;
  }
  const parsed = acpRawInputPathSchema.safeParse(event.rawInput);
  if (!parsed.success) return undefined;
  return [parsed.data.path, parsed.data.filePath, parsed.data.file_path].find(
    (value): value is string =>
      typeof value === "string" && value.trim().length > 0,
  );
}

function extractAcpToolCallOutputText(
  event: AcpToolCallUpdateEvent,
): string | undefined {
  const chunks: string[] = [];
  for (const entry of event.content ?? []) {
    if (entry.type !== "content") continue;
    const text = extractAcpContentText(entry.content);
    if (text) chunks.push(text);
  }
  if (chunks.length > 0) return chunks.join("\n");
  if (event.rawOutput === undefined) return undefined;
  const rawOutputText = extractResultText(event.rawOutput).trim();
  return rawOutputText.length > 0 ? rawOutputText : undefined;
}

function buildAcpFileChangesFromToolCall(
  event: AcpToolCallUpdateEvent,
): Extract<ThreadEventItem, { type: "fileChange" }>["changes"] {
  const changes: Extract<ThreadEventItem, { type: "fileChange" }>["changes"] =
    [];
  for (const entry of event.content ?? []) {
    if (entry.type !== "diff") continue;
    const oldText = entry.oldText ?? undefined;
    const diff = buildEditDiff(entry.path, oldText, entry.newText);
    changes.push({
      path: entry.path,
      kind: oldText === undefined ? "add" : "update",
      ...(diff ? { diff } : {}),
    });
  }
  if (changes.length > 0) return changes;

  const path = extractAcpToolCallPath(event);
  if (!path) return [];
  if (event.kind === "edit") return [{ path, kind: "update" }];
  if (event.kind === "delete") return [{ path, kind: "delete" }];
  return [];
}

function translateAcpToolCallItem(
  event: AcpToolCallUpdateEvent,
): ProviderDriverItem {
  const status = mapAcpToolCallStatus(event.status);
  if (event.kind === "execute") {
    const command = extractAcpCommand(event);
    if (command) {
      const outputText = extractAcpToolCallOutputText(event);
      return {
        type: "commandExecution",
        id: event.toolCallId,
        command,
        cwd: "",
        status,
        approvalStatus: null,
        ...(outputText === undefined ? {} : { aggregatedOutput: outputText }),
        ...(status === "completed" || status === "failed"
          ? { exitCode: status === "failed" ? 1 : 0 }
          : {}),
      };
    }
  }

  const changes = buildAcpFileChangesFromToolCall(event);
  if (changes.length > 0) {
    return {
      type: "fileChange",
      id: event.toolCallId,
      changes,
      status,
      approvalStatus: null,
    };
  }

  const outputText = extractAcpToolCallOutputText(event);
  return {
    type: "toolCall",
    id: event.toolCallId,
    tool: toOptionalString(event.title) ?? event.kind ?? "tool",
    status,
    ...(outputText === undefined ? {} : { result: outputText }),
  };
}

function completeAcpStartedToolItem(
  item: ProviderDriverItem,
  event: AcpToolCallUpdateEvent | undefined,
  status: ThreadEventItemStatus,
): ProviderDriverItem {
  const outputText = event ? extractAcpToolCallOutputText(event) : undefined;
  const completed = completeStartedToolItem({
    callId: item.id,
    commandOutputText: outputText,
    ...(status === "completed" || status === "failed"
      ? { exitCode: status === "failed" ? 1 : 0 }
      : {}),
    outputText,
    parentToolCallId: undefined,
    startedItem: item,
    status,
    toolCallResult: outputText,
  });
  return completed?.type === "userMessage" ? item : (completed ?? item);
}

function mergeAcpToolCallEvents(
  started: AcpToolCallUpdateEvent | undefined,
  update: AcpToolCallUpdateEvent,
): AcpToolCallUpdateEvent {
  if (!started) return update;
  return {
    ...started,
    ...(update.title !== undefined ? { title: update.title } : {}),
    ...(update.kind !== undefined ? { kind: update.kind } : {}),
    ...(update.status !== undefined ? { status: update.status } : {}),
    ...(update.content !== undefined ? { content: update.content } : {}),
    ...(update.locations !== undefined ? { locations: update.locations } : {}),
    ...(update.rawInput !== undefined ? { rawInput: update.rawInput } : {}),
    ...(update.rawOutput !== undefined ? { rawOutput: update.rawOutput } : {}),
  };
}

export function buildAcpApprovalDecisions(
  options: readonly AcpPermissionOption[],
): PendingInteractionApprovalDecision[] {
  const kinds = new Set(options.map((option) => option.kind));
  const decisions: PendingInteractionApprovalDecision[] = [];
  if (kinds.has("allow_once")) decisions.push("allow_once");
  if (kinds.has("allow_always")) decisions.push("allow_for_session");
  if (kinds.has("reject_once") || kinds.has("reject_always")) {
    decisions.push("deny");
  }
  return decisions.length > 0 ? decisions : ["deny"];
}

export function buildOpaqueAcpPermissionCommand(toolCall: {
  command?: string;
  title?: string;
  kind?: string;
}): string {
  return (
    toOptionalString(toolCall.command) ??
    toOptionalString(toolCall.title) ??
    toolCall.kind ??
    "ACP permission request"
  );
}

export class AcpCanonicalEventTranslator {
  private readonly attachmentId: string;
  private readonly events: ProviderDriverEventEmitter;
  private activeTurnId: string | null = null;
  private assistantCounter = 0;
  private assistantItemId: string | null = null;
  private assistantText = "";
  private compactionItemId: string | null = null;
  private fsWriteCounter = 0;
  private readonly openItems = new Map<string, ProviderDriverItem>();
  private reasoningCounter = 0;
  private reasoningItemId: string | null = null;
  private reasoningText = "";
  private readonly toolCallEvents = new Map<string, AcpToolCallUpdateEvent>();

  constructor(options: AcpCanonicalEventTranslatorOptions) {
    this.attachmentId = options.attachmentId;
    this.events = options.events;
  }

  beginTurn(turnId: string): void {
    this.activeTurnId = turnId;
    this.assistantItemId = null;
    this.assistantText = "";
    this.reasoningItemId = null;
    this.reasoningText = "";
    this.compactionItemId = null;
    this.openItems.clear();
    this.toolCallEvents.clear();
  }

  beginCompaction(turnId: string): void {
    this.beginTurn(turnId);
    this.compactionItemId = `acp-compaction-${turnId}`;
    this.startItem({
      type: "contextCompaction",
      id: this.compactionItemId,
    });
  }

  translateUpdate(update: AcpSessionUpdate): void {
    switch (update.sessionUpdate) {
      case "agent_message_chunk": {
        const parsed = acpAgentMessageChunkUpdateSchema.safeParse(update);
        const text = parsed.success
          ? extractAcpContentText(parsed.data.content)
          : undefined;
        if (text === undefined) return;
        this.flushReasoning();
        const itemId = this.getOrCreateAssistantItem();
        this.assistantText += text;
        this.emitTurn({
          type: "item.delta",
          attachmentId: this.attachmentId,
          itemId,
          channel: "assistant_text",
          delta: text,
          reset: false,
        });
        return;
      }
      case "agent_thought_chunk": {
        const parsed = acpAgentThoughtChunkUpdateSchema.safeParse(update);
        const text = parsed.success
          ? extractAcpContentText(parsed.data.content)
          : undefined;
        if (text === undefined) return;
        const itemId = this.getOrCreateReasoningItem();
        this.reasoningText += text;
        this.emitTurn({
          type: "item.delta",
          attachmentId: this.attachmentId,
          itemId,
          channel: "reasoning_text",
          delta: text,
          reset: false,
        });
        return;
      }
      case "tool_call": {
        const parsed = acpToolCallUpdateEventSchema.safeParse(update);
        if (!parsed.success) return;
        this.flushTextItems();
        const item = translateAcpToolCallItem(parsed.data);
        if (this.isTerminalItem(item)) {
          this.startItem(initialItem(item));
          this.completeItem(item);
          return;
        }
        this.toolCallEvents.set(parsed.data.toolCallId, parsed.data);
        this.startItem(item);
        return;
      }
      case "tool_call_update": {
        const parsed = acpToolCallUpdateEventSchema.safeParse(update);
        if (!parsed.success || this.activeTurnId === null) return;
        const startedEvent = this.toolCallEvents.get(parsed.data.toolCallId);
        const startedItem = this.openItems.get(parsed.data.toolCallId);
        const mergedEvent = mergeAcpToolCallEvents(startedEvent, parsed.data);
        const mergedItem = translateAcpToolCallItem(mergedEvent);
        if (
          mergedEvent.status === "completed" ||
          mergedEvent.status === "failed"
        ) {
          this.toolCallEvents.delete(parsed.data.toolCallId);
          const status = mapAcpToolCallStatus(mergedEvent.status);
          if (!startedItem) {
            this.startItem(initialItem(mergedItem));
            this.completeItem(mergedItem);
            return;
          }
          if (startedItem.type !== mergedItem.type) {
            this.completeItem(
              completeAcpStartedToolItem(startedItem, mergedEvent, status),
            );
            this.startItem(initialItem(mergedItem));
          }
          this.completeItem(mergedItem);
          return;
        }
        this.toolCallEvents.set(parsed.data.toolCallId, mergedEvent);
        const progressText = extractAcpToolCallOutputText(parsed.data);
        if (progressText && startedItem?.type === "toolCall") {
          this.emitTurn({
            type: "item.delta",
            attachmentId: this.attachmentId,
            itemId: parsed.data.toolCallId,
            channel: "tool_output",
            delta: progressText,
            reset: false,
          });
        }
        return;
      }
      case "plan": {
        const parsed = acpPlanUpdateSchema.safeParse(update);
        if (!parsed.success) return;
        const plan: ThreadEventPlanStep[] = parsed.data.entries.map(
          (entry) => ({
            step: entry.content,
            ...(entry.status
              ? { status: ACP_PLAN_STEP_STATUS_BY_ENTRY_STATUS[entry.status] }
              : {}),
          }),
        );
        const text = plan
          .map((entry) =>
            entry.status ? `[${entry.status}] ${entry.step}` : entry.step,
          )
          .join("\n");
        const itemId = "acp-plan";
        const existing = this.openItems.get(itemId);
        if (!existing) {
          this.startItem({ type: "plan", id: itemId, text: "" });
        }
        this.emitTurn({
          type: "item.delta",
          attachmentId: this.attachmentId,
          itemId,
          channel: "plan_text",
          delta: text,
          reset: true,
        });
        this.openItems.set(itemId, { type: "plan", id: itemId, text });
        return;
      }
      case "usage_update": {
        const parsed = acpUsageUpdateSchema.safeParse(update);
        if (!parsed.success) return;
        this.events.emit({
          type: "session.context_window_usage_changed",
          attachmentId: this.attachmentId,
          contextWindowUsage: {
            usedTokens: parsed.data.used,
            modelContextWindow: parsed.data.size,
            estimated: false,
          },
        });
        return;
      }
      default:
        return;
    }
  }

  translateFsWrite(args: {
    path: string;
    kind: "add" | "update";
    diff?: string;
  }): void {
    const turnId = this.activeTurnId;
    if (turnId === null) return;
    this.fsWriteCounter += 1;
    const item: ProviderDriverItem = {
      type: "fileChange",
      id: `acp-fs-write-${turnId}-${this.fsWriteCounter}`,
      changes: [
        {
          path: args.path,
          kind: args.kind,
          ...(args.diff ? { diff: args.diff } : {}),
        },
      ],
      status: "completed",
      approvalStatus: null,
    };
    this.startItem(initialItem(item));
    this.completeItem(item);
  }

  warning(code: string, message: string): void {
    this.events.emit({
      type: "provider.warning",
      attachmentId: this.attachmentId,
      code,
      message,
    });
  }

  finishTurn(stopReason: AcpStopReason): void {
    const turnId = this.activeTurnId;
    if (turnId === null) return;
    const itemStatus: ThreadEventItemStatus =
      stopReason === "end_turn"
        ? "completed"
        : stopReason === "cancelled"
          ? "interrupted"
          : "failed";
    this.flushOpenItems(itemStatus);
    const failed = stopReason !== "end_turn" && stopReason !== "cancelled";
    this.events.emit({
      type: "turn.settled",
      attachmentId: this.attachmentId,
      turnId,
      outcome:
        stopReason === "end_turn"
          ? "completed"
          : stopReason === "cancelled"
            ? "cancelled"
            : "failed",
      error: failed
        ? canonicalAcpError({
            code: `acp_${stopReason}`,
            message: `Agent stopped the turn: ${stopReason}`,
          })
        : null,
      providerCheckpointId: null,
    });
    this.resetTurn();
  }

  finishCompaction(
    args:
      | { status: "completed" }
      | { status: "interrupted" }
      | { status: "failed"; error: string },
  ): void {
    const turnId = this.activeTurnId;
    if (turnId === null) return;
    this.flushOpenItems(
      args.status === "completed"
        ? "completed"
        : args.status === "interrupted"
          ? "interrupted"
          : "failed",
    );
    if (args.status === "completed") {
      this.events.emit({
        type: "turn.compacted",
        attachmentId: this.attachmentId,
        turnId,
      });
    }
    this.events.emit({
      type: "turn.settled",
      attachmentId: this.attachmentId,
      turnId,
      outcome:
        args.status === "completed"
          ? "completed"
          : args.status === "interrupted"
            ? "cancelled"
            : "failed",
      error:
        args.status === "failed"
          ? canonicalAcpError({
              code: "acp_compaction_failed",
              message: args.error,
            })
          : null,
      providerCheckpointId: null,
    });
    this.resetTurn();
  }

  failActiveTurn(message: string): void {
    const turnId = this.activeTurnId;
    if (turnId === null) return;
    this.flushOpenItems("failed");
    this.events.emit({
      type: "turn.settled",
      attachmentId: this.attachmentId,
      turnId,
      outcome: "failed",
      error: canonicalAcpError({
        code: "acp_prompt_failed",
        message,
      }),
      providerCheckpointId: null,
    });
    this.resetTurn();
  }

  private getOrCreateAssistantItem(): string {
    if (this.assistantItemId) return this.assistantItemId;
    this.assistantCounter += 1;
    this.assistantItemId = `acp-assistant-${this.assistantCounter}`;
    this.startItem({
      type: "agentMessage",
      id: this.assistantItemId,
      text: "",
    });
    return this.assistantItemId;
  }

  private getOrCreateReasoningItem(): string {
    if (this.reasoningItemId) return this.reasoningItemId;
    this.reasoningCounter += 1;
    this.reasoningItemId = `acp-reasoning-${this.reasoningCounter}`;
    this.startItem({
      type: "reasoning",
      id: this.reasoningItemId,
      summary: [],
      content: [],
    });
    return this.reasoningItemId;
  }

  private flushTextItems(): void {
    this.flushReasoning();
    if (!this.assistantItemId) return;
    this.completeItem({
      type: "agentMessage",
      id: this.assistantItemId,
      text: this.assistantText,
    });
    this.assistantItemId = null;
    this.assistantText = "";
  }

  private flushReasoning(): void {
    if (!this.reasoningItemId) return;
    this.completeItem({
      type: "reasoning",
      id: this.reasoningItemId,
      summary: [],
      content: [this.reasoningText],
    });
    this.reasoningItemId = null;
    this.reasoningText = "";
  }

  private flushOpenItems(status: ThreadEventItemStatus): void {
    this.flushTextItems();
    for (const item of [...this.openItems.values()]) {
      this.completeItem(completeAcpStartedToolItem(item, undefined, status));
    }
  }

  private startItem(item: ProviderDriverItem): void {
    if (this.activeTurnId === null || this.openItems.has(item.id)) return;
    this.emitTurn({
      type: "item.started",
      attachmentId: this.attachmentId,
      item,
    });
    this.openItems.set(item.id, item);
  }

  private completeItem(item: ProviderDriverItem): void {
    if (this.activeTurnId === null) return;
    if (!this.openItems.has(item.id)) this.startItem(initialItem(item));
    const status = "status" in item ? item.status : "completed";
    const outcome =
      status === "failed"
        ? "failed"
        : status === "interrupted"
          ? "cancelled"
          : "completed";
    this.emitTurn({
      type: "item.completed",
      attachmentId: this.attachmentId,
      item,
      outcome,
      error:
        outcome === "failed"
          ? canonicalAcpError({
              code: "acp_item_failed",
              message: `ACP ${item.type} item failed`,
            })
          : null,
    });
    this.openItems.delete(item.id);
  }

  private isTerminalItem(item: ProviderDriverItem): boolean {
    return (
      "status" in item &&
      (item.status === "completed" || item.status === "failed")
    );
  }

  private emitTurn(
    event: ProviderDriverEventInput extends infer Event
      ? Event extends ProviderDriverEventInput
        ? Event extends { turnId: string }
          ? Omit<Event, "turnId">
          : never
        : never
      : never,
  ): void {
    if (this.activeTurnId === null) return;
    this.events.emit({
      ...event,
      turnId: this.activeTurnId,
    } as ProviderDriverEventInput);
  }

  private resetTurn(): void {
    this.activeTurnId = null;
    this.assistantItemId = null;
    this.assistantText = "";
    this.reasoningItemId = null;
    this.reasoningText = "";
    this.compactionItemId = null;
    this.openItems.clear();
    this.toolCallEvents.clear();
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
    case "backgroundTask":
      return item;
  }
}
