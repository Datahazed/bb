import type { ProviderDriverEvent } from "./events.js";
import type {
  ProviderDriverInitializeParams,
  ProviderDriverInitializeResult,
} from "./protocol.js";
import type {
  ProviderSessionDetachParams,
  ProviderSessionDetachResult,
  ProviderSessionDiscardParams,
  ProviderSessionOpenParams,
  ProviderSessionOpenResult,
  ProviderTurnCancelParams,
  ProviderTurnCancelResult,
  ProviderTurnSubmitParams,
  ProviderTurnSubmitResult,
} from "./session.js";

export const providerDriverLifecycleErrorCodeValues = [
  "already_initialized",
  "not_initialized",
  "connection_closed",
  "initialize_identity_mismatch",
  "unsupported_protocol_version",
  "operation_conflict",
  "duplicate_attachment",
  "unknown_attachment",
  "active_turn_exists",
  "no_active_turn",
  "stale_turn",
  "invalid_command_result",
  "event_sequence_out_of_order",
  "turn_not_accepted",
  "turn_already_settled",
  "duplicate_item",
  "unknown_item",
  "item_already_completed",
] as const;
export type ProviderDriverLifecycleErrorCode =
  (typeof providerDriverLifecycleErrorCodeValues)[number];

export class ProviderDriverLifecycleError extends Error {
  constructor(
    readonly code: ProviderDriverLifecycleErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ProviderDriverLifecycleError";
  }
}

export type ProviderDriverLifecycleRecordOutcome = "recorded" | "replayed";

interface RecordedOperation {
  kind:
    | "session.open"
    | "session.detach"
    | "session.discard"
    | "turn.submit"
    | "turn.cancel";
  params: string;
  result: string;
}

interface ProviderDriverItemState {
  completed: boolean;
}

interface ProviderDriverAttachmentState {
  activeTurnId: string | null;
  itemsByTurnId: Map<string, Map<string, ProviderDriverItemState>>;
  providerSessionId: string;
  settledTurnIds: Set<string>;
}

export interface ProviderDriverAttachmentSnapshot {
  activeTurnId: string | null;
  attachmentId: string;
  providerSessionId: string;
}

export interface ProviderDriverConnectionExitSnapshot {
  activeAttachments: ProviderDriverAttachmentSnapshot[];
}

export interface ProviderDriverLifecycleSnapshot {
  attachments: ProviderDriverAttachmentSnapshot[];
  initialized: boolean;
  closed: boolean;
  lastEventSequence: number;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const entries = Object.entries(value)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries
    .map(
      ([key, entryValue]) =>
        `${JSON.stringify(key)}:${canonicalJson(entryValue)}`,
    )
    .join(",")}}`;
}

function lifecycleError(
  code: ProviderDriverLifecycleErrorCode,
  message: string,
): never {
  throw new ProviderDriverLifecycleError(code, message);
}

/**
 * Pure host-side validator for one driver process connection.
 *
 * It records canonical facts only. Provider-native lifecycle and recovery do
 * not belong here; a driver must translate those before emitting this contract.
 */
export class ProviderDriverLifecycle {
  private readonly attachments = new Map<
    string,
    ProviderDriverAttachmentState
  >();
  private readonly operations = new Map<string, RecordedOperation>();
  private initialized = false;
  private closed = false;
  private lastEventSequence = 0;

  recordInitialized(
    params: ProviderDriverInitializeParams,
    result: ProviderDriverInitializeResult,
  ): void {
    if (this.closed) {
      lifecycleError(
        "connection_closed",
        "Cannot initialize a closed connection",
      );
    }
    if (this.initialized) {
      lifecycleError(
        "already_initialized",
        "Driver connection is already initialized",
      );
    }
    if (!params.supportedProtocolVersions.includes(result.protocolVersion)) {
      lifecycleError(
        "unsupported_protocol_version",
        `Driver selected unsupported protocol version ${result.protocolVersion}`,
      );
    }
    if (
      params.expected.pluginId !== result.identity.pluginId ||
      params.expected.driverId !== result.identity.driverId ||
      params.expected.providerId !== result.identity.providerId
    ) {
      lifecycleError(
        "initialize_identity_mismatch",
        `Expected driver ${params.expected.pluginId}/${params.expected.driverId} for provider ${params.expected.providerId}, received ${result.identity.pluginId}/${result.identity.driverId} for provider ${result.identity.providerId}`,
      );
    }
    this.initialized = true;
  }

  recordSessionOpened(
    params: ProviderSessionOpenParams,
    result: ProviderSessionOpenResult,
  ): ProviderDriverLifecycleRecordOutcome {
    this.requireReady();
    if (
      this.isOperationReplay("session.open", params.operationId, params, result)
    ) {
      return "replayed";
    }
    if (this.attachments.has(params.attachmentId)) {
      lifecycleError(
        "duplicate_attachment",
        `Attachment ${params.attachmentId} is already open`,
      );
    }
    this.attachments.set(params.attachmentId, {
      activeTurnId: null,
      itemsByTurnId: new Map(),
      providerSessionId: result.providerSessionId,
      settledTurnIds: new Set(),
    });
    this.recordOperation("session.open", params.operationId, params, result);
    return "recorded";
  }

  recordSessionDiscarded(
    args: ProviderSessionDiscardParams,
  ): ProviderDriverLifecycleRecordOutcome {
    this.requireReady();
    const result = {};
    if (
      this.isOperationReplay("session.discard", args.operationId, args, result)
    ) {
      return "replayed";
    }
    const attachment = this.requireAttachment(args.attachmentId);
    if (attachment.providerSessionId !== args.providerSessionId) {
      lifecycleError(
        "invalid_command_result",
        `Discard targets provider session ${args.providerSessionId}, expected ${attachment.providerSessionId}`,
      );
    }
    if (attachment.activeTurnId !== null) {
      lifecycleError(
        "active_turn_exists",
        `Cannot discard attachment ${args.attachmentId} while turn ${attachment.activeTurnId} is active`,
      );
    }
    this.attachments.delete(args.attachmentId);
    this.recordOperation("session.discard", args.operationId, args, result);
    return "recorded";
  }

  recordTurnSubmitted(
    params: ProviderTurnSubmitParams,
    result: ProviderTurnSubmitResult,
  ): ProviderDriverLifecycleRecordOutcome {
    this.requireReady();
    if (
      this.isOperationReplay("turn.submit", params.operationId, params, result)
    ) {
      return "replayed";
    }
    const attachment = this.requireAttachment(params.attachmentId);

    switch (result.outcome) {
      case "rejected":
        break;
      case "stale":
        if (params.mode !== "steer") {
          lifecycleError(
            "invalid_command_result",
            "A start submission cannot return a stale result",
          );
        }
        if (result.activeTurnId !== attachment.activeTurnId) {
          lifecycleError(
            "invalid_command_result",
            `Stale result reported active turn ${result.activeTurnId ?? "none"}, expected ${attachment.activeTurnId ?? "none"}`,
          );
        }
        break;
      case "accepted":
        if (params.mode === "start") {
          if (attachment.activeTurnId !== null) {
            lifecycleError(
              "active_turn_exists",
              `Attachment ${params.attachmentId} already has active turn ${attachment.activeTurnId}`,
            );
          }
          if (
            result.disposition !== "started" ||
            result.turnId !== params.turnId
          ) {
            lifecycleError(
              "invalid_command_result",
              "An accepted start must report disposition started and the requested turn id",
            );
          }
          attachment.activeTurnId = params.turnId;
          attachment.itemsByTurnId.set(params.turnId, new Map());
          break;
        }

        if (attachment.activeTurnId === null) {
          lifecycleError(
            "no_active_turn",
            `Attachment ${params.attachmentId} has no active turn to steer`,
          );
        }
        if (attachment.activeTurnId !== params.expectedTurnId) {
          lifecycleError(
            "stale_turn",
            `Expected turn ${params.expectedTurnId}, active turn is ${attachment.activeTurnId}`,
          );
        }
        if (
          result.turnId !== params.expectedTurnId ||
          result.disposition === "started"
        ) {
          lifecycleError(
            "invalid_command_result",
            "An accepted steer must report the expected turn and a steered or queued disposition",
          );
        }
        break;
    }

    this.recordOperation("turn.submit", params.operationId, params, result);
    return "recorded";
  }

  recordTurnCancellationRequested(
    params: ProviderTurnCancelParams,
    result: ProviderTurnCancelResult,
  ): ProviderDriverLifecycleRecordOutcome {
    this.requireReady();
    if (
      this.isOperationReplay("turn.cancel", params.operationId, params, result)
    ) {
      return "replayed";
    }
    const attachment = this.requireAttachment(params.attachmentId);
    const expectedOutcome =
      attachment.activeTurnId === params.turnId
        ? "cancellation_requested"
        : attachment.settledTurnIds.has(params.turnId)
          ? "already_settled"
          : "not_active";
    if (result.outcome !== expectedOutcome) {
      lifecycleError(
        "invalid_command_result",
        `Cancellation returned ${result.outcome}, expected ${expectedOutcome}`,
      );
    }
    this.recordOperation("turn.cancel", params.operationId, params, result);
    return "recorded";
  }

  validateActiveTurnScope(args: {
    attachmentId: string;
    turnId: string;
  }): void {
    this.requireReady();
    const attachment = this.requireAttachment(args.attachmentId);
    this.requireActiveTurn(attachment, args.attachmentId, args.turnId);
  }

  recordEvent(event: ProviderDriverEvent): void {
    this.requireReady();
    const expectedSequence = this.lastEventSequence + 1;
    if (event.sequence !== expectedSequence) {
      lifecycleError(
        "event_sequence_out_of_order",
        `Expected driver event sequence ${expectedSequence}, received ${event.sequence}`,
      );
    }
    const attachment = this.requireAttachment(event.attachmentId);

    switch (event.type) {
      case "turn.settled": {
        if (attachment.settledTurnIds.has(event.turnId)) {
          lifecycleError(
            "turn_already_settled",
            `Turn ${event.turnId} has already settled`,
          );
        }
        this.requireActiveTurn(attachment, event.attachmentId, event.turnId);
        attachment.activeTurnId = null;
        attachment.settledTurnIds.add(event.turnId);
        break;
      }
      case "turn.retrying":
        this.requireActiveTurn(attachment, event.attachmentId, event.turnId);
        break;
      case "item.started": {
        this.requireActiveTurn(attachment, event.attachmentId, event.turnId);
        const items = this.requireTurnItems(attachment, event.turnId);
        if (items.has(event.itemId)) {
          lifecycleError(
            "duplicate_item",
            `Item ${event.itemId} already exists on turn ${event.turnId}`,
          );
        }
        items.set(event.itemId, { completed: false });
        break;
      }
      case "item.delta": {
        this.requireActiveTurn(attachment, event.attachmentId, event.turnId);
        const item = this.requireItem(attachment, event.turnId, event.itemId);
        if (item.completed) {
          lifecycleError(
            "item_already_completed",
            `Item ${event.itemId} has already completed`,
          );
        }
        break;
      }
      case "item.completed": {
        this.requireActiveTurn(attachment, event.attachmentId, event.turnId);
        const item = this.requireItem(attachment, event.turnId, event.itemId);
        if (item.completed) {
          lifecycleError(
            "item_already_completed",
            `Item ${event.itemId} has already completed`,
          );
        }
        item.completed = true;
        break;
      }
      case "session.checkpoint_changed":
      case "session.usage_changed":
      case "provider.rate_limits_changed":
      case "provider.warning":
        break;
    }

    this.lastEventSequence = event.sequence;
  }

  recordSessionDetached(
    params: ProviderSessionDetachParams,
    result: ProviderSessionDetachResult,
  ): ProviderDriverLifecycleRecordOutcome {
    this.requireReady();
    if (
      this.isOperationReplay(
        "session.detach",
        params.operationId,
        params,
        result,
      )
    ) {
      return "replayed";
    }
    const attachment = this.requireAttachment(params.attachmentId);
    if (attachment.activeTurnId !== null) {
      lifecycleError(
        "active_turn_exists",
        `Cannot detach attachment ${params.attachmentId} while turn ${attachment.activeTurnId} is active`,
      );
    }
    this.attachments.delete(params.attachmentId);
    this.recordOperation("session.detach", params.operationId, params, result);
    return "recorded";
  }

  recordConnectionExited(): ProviderDriverConnectionExitSnapshot {
    if (this.closed) {
      return { activeAttachments: [] };
    }
    const activeAttachments = this.attachmentSnapshots().filter(
      (attachment) => attachment.activeTurnId !== null,
    );
    this.closed = true;
    return { activeAttachments };
  }

  snapshot(): ProviderDriverLifecycleSnapshot {
    return {
      attachments: this.attachmentSnapshots(),
      initialized: this.initialized,
      closed: this.closed,
      lastEventSequence: this.lastEventSequence,
    };
  }

  private attachmentSnapshots(): ProviderDriverAttachmentSnapshot[] {
    return [...this.attachments].map(([attachmentId, attachment]) => ({
      activeTurnId: attachment.activeTurnId,
      attachmentId,
      providerSessionId: attachment.providerSessionId,
    }));
  }

  private requireReady(): void {
    if (this.closed) {
      lifecycleError("connection_closed", "Driver connection is closed");
    }
    if (!this.initialized) {
      lifecycleError("not_initialized", "Driver connection is not initialized");
    }
  }

  private requireAttachment(
    attachmentId: string,
  ): ProviderDriverAttachmentState {
    const attachment = this.attachments.get(attachmentId);
    if (!attachment) {
      lifecycleError(
        "unknown_attachment",
        `Unknown driver attachment ${attachmentId}`,
      );
    }
    return attachment;
  }

  private requireActiveTurn(
    attachment: ProviderDriverAttachmentState,
    attachmentId: string,
    turnId: string,
  ): void {
    if (attachment.activeTurnId === null) {
      lifecycleError(
        "turn_not_accepted",
        `Attachment ${attachmentId} has no accepted active turn`,
      );
    }
    if (attachment.activeTurnId !== turnId) {
      lifecycleError(
        "stale_turn",
        `Event targets turn ${turnId}, active turn is ${attachment.activeTurnId}`,
      );
    }
  }

  private requireTurnItems(
    attachment: ProviderDriverAttachmentState,
    turnId: string,
  ): Map<string, ProviderDriverItemState> {
    const items = attachment.itemsByTurnId.get(turnId);
    if (!items) {
      lifecycleError("turn_not_accepted", `Turn ${turnId} was not accepted`);
    }
    return items;
  }

  private requireItem(
    attachment: ProviderDriverAttachmentState,
    turnId: string,
    itemId: string,
  ): ProviderDriverItemState {
    const item = this.requireTurnItems(attachment, turnId).get(itemId);
    if (!item) {
      lifecycleError(
        "unknown_item",
        `Unknown item ${itemId} on turn ${turnId}`,
      );
    }
    return item;
  }

  private isOperationReplay(
    kind: RecordedOperation["kind"],
    operationId: string,
    params: unknown,
    result: unknown,
  ): boolean {
    const existing = this.operations.get(operationId);
    if (!existing) {
      return false;
    }
    if (
      existing.kind !== kind ||
      existing.params !== canonicalJson(params) ||
      existing.result !== canonicalJson(result)
    ) {
      lifecycleError(
        "operation_conflict",
        `Operation ${operationId} was replayed with different semantics`,
      );
    }
    return true;
  }

  private recordOperation(
    kind: RecordedOperation["kind"],
    operationId: string,
    params: unknown,
    result: unknown,
  ): void {
    this.operations.set(operationId, {
      kind,
      params: canonicalJson(params),
      result: canonicalJson(result),
    });
  }
}
