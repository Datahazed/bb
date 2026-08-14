import { randomUUID } from "node:crypto";
import {
  jsonObjectSchema,
  runtimePermissionPolicySchema,
  threadEventSchema,
  threadScope,
  turnScope,
  type JsonObject,
  type ProviderCapabilities,
  type RuntimeThreadExecutionOptions,
  type ThreadEvent,
} from "@bb/domain";
import {
  type ProviderDriverError,
  type ProviderDriverEvent,
  type ProviderDriverExecutionOptions,
  type ProviderDriverOperationResult,
  type ProviderDriverSkillSource,
  type ProviderSessionOpenParams,
} from "@bb/provider-driver-contract";
import type { AgentRuntimeSkillRoot } from "../types.js";
import { buildAcceptedUserMessageEvent } from "../shared/accepted-user-messages.js";
import { projectProviderDriverEvent } from "./canonical-event-projector.js";
import type {
  ProviderDriverConnection,
  ProviderDriverSessionOpenArgs,
  ProviderDriverSessionOpenResult,
  ProviderDriverSessionTarget,
  ProviderDriverStopSessionArgs,
  ProviderDriverStopSessionResult,
  ProviderDriverTurnSubmissionResult,
  ProviderDriverTurnSubmitArgs,
} from "./connection.js";
import type { ProcessProviderDriverConnection } from "./process-connection.js";

const CANONICAL_TURN_SETTLEMENT_TIMEOUT_MS = 30_000;
const MAX_QUEUED_ATTACHMENT_EVENTS = 1_024;

interface SettlementWaiter {
  readonly reject: (error: Error) => void;
  readonly resolve: () => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

interface CanonicalAttachment {
  activeTurnId: string | null;
  readonly attachmentId: string;
  readonly bbThreadId: string;
  latestProviderCheckpointId: string | null;
  opening: boolean;
  providerSessionId: string | null;
  readonly queuedEvents: ProviderDriverEvent[];
  submitting: boolean;
  readonly settlementWaiters: Map<string, Set<SettlementWaiter>>;
}

export interface CanonicalProcessProviderConnectionOptions {
  readonly additionalWorkspaceWriteRoots: readonly string[];
  readonly buildProviderOptions?: (
    execution: ProviderDriverTurnSubmitArgs["execution"],
  ) => JsonObject;
  readonly capabilities: ProviderCapabilities;
  readonly classifyExecutionSettingsChange: ProviderDriverConnection["classifyExecutionSettingsChange"];
  readonly displayName: string;
  readonly normalizeExecutionOptions?: (
    options: RuntimeThreadExecutionOptions,
  ) => RuntimeThreadExecutionOptions;
  readonly processConnection: ProcessProviderDriverConnection;
  readonly providerId: string;
  readonly resolveThreadStoragePath: (bbThreadId: string) => string;
}

export class CanonicalProviderDriverRejectedError extends Error {
  constructor(readonly driverError: ProviderDriverError) {
    super(driverError.message);
    this.name = "CanonicalProviderDriverRejectedError";
  }
}

function createProtocolId(prefix: string): string {
  return `${prefix}:${randomUUID()}`;
}

function requiredExecutionValue<Value>(
  value: Value | undefined,
  label: string,
): Value {
  if (value === undefined) {
    throw new Error(`Canonical provider execution requires ${label}`);
  }
  return value;
}

function skillRootPath(skillRoot: AgentRuntimeSkillRoot): string {
  return skillRoot.providerId === "claude-code"
    ? skillRoot.localPluginPath
    : skillRoot.skillDirectoryRootPath;
}

function toSkillSource(
  skillRoot: AgentRuntimeSkillRoot,
): ProviderDriverSkillSource {
  return {
    id: skillRoot.id,
    rootPath: skillRootPath(skillRoot),
    skills:
      skillRoot.providerId === "acp"
        ? skillRoot.skills.map((skill) => ({
            name: skill.name,
            description: skill.description,
          }))
        : [],
  };
}

function operationApplied(result: ProviderDriverOperationResult): boolean {
  return result.outcome === "applied" || result.outcome === "unchanged";
}

/**
 * Compatibility projection from the canonical process peer into AgentRuntime's
 * current semantic connection. This owns attachment IDs, operation IDs,
 * canonical turn IDs, and the temporary ThreadEvent projection; it contains no
 * provider-specific translation.
 */
export class CanonicalProcessProviderConnection implements ProviderDriverConnection {
  readonly capabilities: ProviderCapabilities;
  readonly identity: { displayName: string; providerId: string };

  private readonly additionalWorkspaceWriteRoots: readonly string[];
  private readonly attachmentsById = new Map<string, CanonicalAttachment>();
  private readonly attachmentsByThreadId = new Map<
    string,
    CanonicalAttachment
  >();
  private readonly buildProviderOptions: (
    execution: ProviderDriverTurnSubmitArgs["execution"],
  ) => JsonObject;
  private readonly classifySettings: ProviderDriverConnection["classifyExecutionSettingsChange"];
  private readonly eventListeners = new Set<(events: ThreadEvent[]) => void>();
  private readonly normalizeOptions:
    | ((
        options: RuntimeThreadExecutionOptions,
      ) => RuntimeThreadExecutionOptions)
    | undefined;
  private readonly processConnection: ProcessProviderDriverConnection;
  private readonly resolveThreadStoragePath: (bbThreadId: string) => string;
  private skillRoots: readonly AgentRuntimeSkillRoot[] = [];

  constructor(options: CanonicalProcessProviderConnectionOptions) {
    this.additionalWorkspaceWriteRoots = options.additionalWorkspaceWriteRoots;
    this.buildProviderOptions = options.buildProviderOptions ?? (() => ({}));
    this.capabilities = options.capabilities;
    this.classifySettings = options.classifyExecutionSettingsChange;
    this.identity = {
      displayName: options.displayName,
      providerId: options.providerId,
    };
    this.normalizeOptions = options.normalizeExecutionOptions;
    this.processConnection = options.processConnection;
    this.resolveThreadStoragePath = options.resolveThreadStoragePath;
    this.processConnection.onEvent(this.handleEvent);
    this.processConnection.onExit((exit) => {
      this.rejectSettlementWaiters(
        new Error(
          `Canonical provider process exited (${exit.code ?? exit.signal ?? "unknown"})`,
        ),
      );
    });
  }

  normalizeExecutionOptions(
    options: RuntimeThreadExecutionOptions,
  ): RuntimeThreadExecutionOptions {
    return this.normalizeOptions?.(options) ?? options;
  }

  classifyExecutionSettingsChange(args: {
    current: RuntimeThreadExecutionOptions;
    next: RuntimeThreadExecutionOptions;
  }) {
    return this.classifySettings(args);
  }

  async initialize(
    skillRoots: readonly AgentRuntimeSkillRoot[],
  ): Promise<void> {
    this.skillRoots = [...skillRoots];
  }

  async inspectModels(args: { cwd?: string }) {
    const result = await this.processConnection.inspect({
      cwd: args.cwd ?? null,
      operation: null,
    });
    return {
      models: result.models,
      selectedOnlyModels: result.selectedOnlyModels,
    };
  }

  async openSession(
    args: ProviderDriverSessionOpenArgs,
  ): Promise<ProviderDriverSessionOpenResult> {
    const existing = this.attachmentsByThreadId.get(args.bbThreadId);
    if (existing) {
      await this.detachAttachment(existing);
    }

    const attachment: CanonicalAttachment = {
      activeTurnId: null,
      attachmentId: createProtocolId("attachment"),
      bbThreadId: args.bbThreadId,
      latestProviderCheckpointId: null,
      opening: true,
      providerSessionId: null,
      queuedEvents: [],
      submitting: false,
      settlementWaiters: new Map(),
    };
    this.attachmentsById.set(attachment.attachmentId, attachment);
    this.attachmentsByThreadId.set(args.bbThreadId, attachment);

    try {
      const result = await this.processConnection.openSession(
        this.toSessionOpenParams(args, attachment.attachmentId),
      );
      attachment.providerSessionId = result.providerSessionId;
      attachment.opening = false;
      const events = this.drainQueuedEvents(attachment);
      return {
        events,
        providerSessionId: result.providerSessionId,
        providerSessionIdForCleanup: result.providerSessionId,
      };
    } catch (error) {
      this.removeAttachment(attachment);
      throw error;
    }
  }

  async submitTurn(
    args: ProviderDriverTurnSubmitArgs,
  ): Promise<ProviderDriverTurnSubmissionResult> {
    const attachment = this.requireAttachment(args);
    const turnId =
      args.mode.kind === "start"
        ? createProtocolId("turn")
        : args.mode.expectedTurnId;
    attachment.submitting = true;
    try {
      const result = await this.processConnection.submitTurn({
        operationId: createProtocolId("operation"),
        clientRequestId: args.clientRequestId,
        attachmentId: attachment.attachmentId,
        inputGroups: args.inputGroups ?? [args.input],
        execution: this.toExecutionOptions(args.execution),
        ...(args.mode.kind === "start"
          ? { mode: "start", turnId }
          : {
              mode: "steer",
              expectedTurnId: args.mode.expectedTurnId,
            }),
      });

      if (result.outcome === "rejected") {
        throw new CanonicalProviderDriverRejectedError(result.error);
      }
      if (result.outcome === "stale") {
        this.notifyEvents(this.drainQueuedEvents(attachment));
        attachment.submitting = false;
        return {
          disposition: "stale",
          activeTurnId: result.activeTurnId,
          events: [],
        };
      }

      attachment.activeTurnId = result.turnId;
      const acceptedEvents: ThreadEvent[] = [];
      if (args.mode.kind === "start") {
        acceptedEvents.push(
          threadEventSchema.parse({
            type: "turn/started",
            threadId: args.bbThreadId,
            providerThreadId: args.providerSessionId,
            scope: turnScope(result.turnId),
          }),
        );
      }
      acceptedEvents.push(
        ...buildAcceptedUserMessageEvent({
          clientRequestId: args.clientRequestId,
          providerThreadId: args.providerSessionId,
          threadId: args.bbThreadId,
          turnId: result.turnId,
        }),
        ...this.drainQueuedEvents(attachment),
      );
      // Push acceptance and any response-buffered provider events before
      // releasing the submission barrier. Later process events can therefore
      // never overtake turn/started or turn/input/accepted in AgentRuntime.
      this.notifyEvents(acceptedEvents);
      attachment.submitting = false;
      return { disposition: "accepted", events: [] };
    } catch (error) {
      attachment.submitting = false;
      const queuedEvents = this.drainQueuedEvents(attachment);
      if (queuedEvents.length > 0) {
        this.notifyEvents(queuedEvents);
      }
      throw error;
    }
  }

  async stopSession(
    args: ProviderDriverStopSessionArgs,
  ): Promise<ProviderDriverStopSessionResult> {
    const attachment = this.requireAttachment(args);
    if (args.activeTurnId !== null) {
      const result = await this.processConnection.cancelTurn({
        operationId: createProtocolId("operation"),
        attachmentId: attachment.attachmentId,
        turnId: args.activeTurnId,
      });
      if (
        result.outcome === "cancellation_requested" &&
        attachment.activeTurnId === args.activeTurnId
      ) {
        await this.waitForSettlement(attachment, args.activeTurnId);
      }
    }
    const result = await this.detachAttachment(attachment);
    return {
      disposition: "stopped",
      events: [],
      noopReason: null,
      providerCheckpointId:
        result.providerCheckpointId ?? attachment.latestProviderCheckpointId,
    };
  }

  async discardSession(args: ProviderDriverSessionTarget): Promise<void> {
    const attachment = this.requireAttachment(args);
    await this.processConnection.discardSession({
      operationId: createProtocolId("operation"),
      attachmentId: attachment.attachmentId,
      providerSessionId: args.providerSessionId,
    });
    this.removeAttachment(attachment);
  }

  async clearSessionGoal(args: ProviderDriverSessionTarget) {
    const attachment = this.requireAttachment(args);
    const result = await this.processConnection.clearSessionGoal({
      operationId: createProtocolId("operation"),
      attachmentId: attachment.attachmentId,
    });
    const cleared = operationApplied(result);
    if (cleared) {
      this.notifyEvents([
        threadEventSchema.parse({
          type: "thread/goal/cleared",
          threadId: args.bbThreadId,
          providerThreadId: args.providerSessionId,
          scope: threadScope(),
        }),
      ]);
    }
    return { cleared };
  }

  async renameSession(args: {
    bbThreadId: string;
    providerSessionId: string;
    title: string;
  }) {
    const attachment = this.requireAttachment(args);
    const result = await this.processConnection.renameSession({
      operationId: createProtocolId("operation"),
      attachmentId: attachment.attachmentId,
      title: args.title,
    });
    return operationApplied(result)
      ? [
          threadEventSchema.parse({
            type: "thread/name/updated",
            threadId: args.bbThreadId,
            providerThreadId: args.providerSessionId,
            scope: threadScope(),
            threadName: args.title,
          }),
        ]
      : [];
  }

  async setSessionArchived(args: {
    archived: boolean;
    bbThreadId: string;
    providerSessionId: string;
  }) {
    const attachment = this.requireAttachment(args);
    await this.processConnection.setSessionArchived({
      operationId: createProtocolId("operation"),
      attachmentId: attachment.attachmentId,
      archived: args.archived,
    });
    return [];
  }

  resolveAttachment(attachmentId: string) {
    const attachment = this.attachmentsById.get(attachmentId);
    return attachment?.providerSessionId
      ? {
          bbThreadId: attachment.bbThreadId,
          providerSessionId: attachment.providerSessionId,
        }
      : null;
  }

  onEvent(listener: (events: ThreadEvent[]) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  rejectPendingRequests(error: Error): void {
    this.rejectSettlementWaiters(error);
  }

  private toExecutionOptions(
    execution: ProviderDriverTurnSubmitArgs["execution"],
  ): ProviderDriverExecutionOptions {
    return {
      model: requiredExecutionValue(execution.model, "a model"),
      reasoningLevel: requiredExecutionValue(
        execution.reasoningLevel,
        "a reasoning level",
      ),
      serviceTier: requiredExecutionValue(
        execution.serviceTier,
        "a service tier",
      ),
      permission: runtimePermissionPolicySchema.parse(execution),
      features: {
        workflowsEnabled: execution.workflowsEnabled,
        memoryEnabled: execution.memoryEnabled ?? false,
        subagentsEnabled: execution.providerSubagentsEnabled ?? false,
      },
      providerOptions: jsonObjectSchema.parse(
        this.buildProviderOptions(execution),
      ),
    };
  }

  private toSessionOpenParams(
    args: ProviderDriverSessionOpenArgs,
    attachmentId: string,
  ): ProviderSessionOpenParams {
    return {
      operationId: createProtocolId("operation"),
      attachmentId,
      bbThreadId: args.bbThreadId,
      mode:
        args.mode.kind === "fork"
          ? {
              kind: "fork",
              sourceProviderSessionId: args.mode.sourceProviderSessionId,
              sourceCheckpointId: args.mode.sourceProviderCheckpointId ?? null,
            }
          : args.mode,
      workspace: {
        cwd: args.cwd,
        additionalWriteRoots: [...this.additionalWorkspaceWriteRoots],
        threadStoragePath: this.resolveThreadStoragePath(args.bbThreadId),
      },
      execution: this.toExecutionOptions(args.execution),
      instructions: {
        mode: args.instructionMode,
        text: args.execution.instructions ?? "",
      },
      skillSources: this.skillRoots.map(toSkillSource),
      dynamicTools: (args.dynamicTools ?? []).map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: jsonObjectSchema.parse(tool.inputSchema),
        statusLabels: null,
      })),
      disallowedTools: [...(args.disallowedTools ?? [])],
      outputSchema: args.outputSchema ?? null,
      shellEnvironment: { ...(args.execution.envVars ?? {}) },
    };
  }

  private requireAttachment(args: ProviderDriverSessionTarget) {
    const attachment = this.attachmentsByThreadId.get(args.bbThreadId);
    if (!attachment) {
      throw new Error(
        `No canonical provider attachment for BB thread ${args.bbThreadId}`,
      );
    }
    if (attachment.providerSessionId !== args.providerSessionId) {
      throw new Error(
        `Canonical provider session mismatch for BB thread ${args.bbThreadId}`,
      );
    }
    return attachment;
  }

  private async detachAttachment(attachment: CanonicalAttachment) {
    const result = await this.processConnection.detachSession({
      operationId: createProtocolId("operation"),
      attachmentId: attachment.attachmentId,
    });
    this.removeAttachment(attachment);
    return result;
  }

  private removeAttachment(attachment: CanonicalAttachment): void {
    if (this.attachmentsByThreadId.get(attachment.bbThreadId) === attachment) {
      this.attachmentsByThreadId.delete(attachment.bbThreadId);
    }
    this.attachmentsById.delete(attachment.attachmentId);
    for (const waiters of attachment.settlementWaiters.values()) {
      for (const waiter of waiters) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error("Canonical provider attachment was removed"));
      }
    }
    attachment.settlementWaiters.clear();
  }

  private readonly handleEvent = (event: ProviderDriverEvent): void => {
    const attachment = this.attachmentsById.get(event.attachmentId);
    if (!attachment) {
      throw new Error(
        `Canonical provider event targets unknown attachment ${event.attachmentId}`,
      );
    }
    if (attachment.opening || attachment.submitting) {
      if (attachment.queuedEvents.length >= MAX_QUEUED_ATTACHMENT_EVENTS) {
        throw new Error(
          `Canonical provider attachment ${event.attachmentId} event queue is full`,
        );
      }
      attachment.queuedEvents.push(event);
      return;
    }
    this.notifyEvents(this.projectAndObserve(attachment, event));
  };

  private drainQueuedEvents(attachment: CanonicalAttachment): ThreadEvent[] {
    const events: ThreadEvent[] = [];
    for (const event of attachment.queuedEvents.splice(0)) {
      events.push(...this.projectAndObserve(attachment, event));
    }
    return events;
  }

  private projectAndObserve(
    attachment: CanonicalAttachment,
    event: ProviderDriverEvent,
  ): ThreadEvent[] {
    if (event.type === "session.checkpoint_changed") {
      attachment.latestProviderCheckpointId = event.providerCheckpointId;
    }
    if (event.type === "turn.settled") {
      attachment.activeTurnId = null;
      if (event.providerCheckpointId !== null) {
        attachment.latestProviderCheckpointId = event.providerCheckpointId;
      }
      this.resolveSettlementWaiters(attachment, event.turnId);
    }
    if (attachment.providerSessionId === null) {
      throw new Error(
        `Canonical provider attachment ${attachment.attachmentId} has no session identity`,
      );
    }
    return projectProviderDriverEvent({
      bbThreadId: attachment.bbThreadId,
      providerSessionId: attachment.providerSessionId,
      event,
    });
  }

  private notifyEvents(events: ThreadEvent[]): void {
    if (events.length === 0) return;
    for (const listener of this.eventListeners) {
      listener(events);
    }
  }

  private waitForSettlement(
    attachment: CanonicalAttachment,
    turnId: string,
  ): Promise<void> {
    if (attachment.activeTurnId !== turnId) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const waiter: SettlementWaiter = {
        reject,
        resolve,
        timer: setTimeout(() => {
          const waiters = attachment.settlementWaiters.get(turnId);
          waiters?.delete(waiter);
          if (waiters?.size === 0) {
            attachment.settlementWaiters.delete(turnId);
          }
          reject(
            new Error(
              `Canonical provider turn ${turnId} did not settle after cancellation`,
            ),
          );
        }, CANONICAL_TURN_SETTLEMENT_TIMEOUT_MS),
      };
      const waiters = attachment.settlementWaiters.get(turnId) ?? new Set();
      waiters.add(waiter);
      attachment.settlementWaiters.set(turnId, waiters);
    });
  }

  private resolveSettlementWaiters(
    attachment: CanonicalAttachment,
    turnId: string,
  ): void {
    const waiters = attachment.settlementWaiters.get(turnId);
    if (!waiters) return;
    attachment.settlementWaiters.delete(turnId);
    for (const waiter of waiters) {
      clearTimeout(waiter.timer);
      waiter.resolve();
    }
  }

  private rejectSettlementWaiters(error: Error): void {
    for (const attachment of this.attachmentsById.values()) {
      for (const waiters of attachment.settlementWaiters.values()) {
        for (const waiter of waiters) {
          clearTimeout(waiter.timer);
          waiter.reject(error);
        }
      }
      attachment.settlementWaiters.clear();
    }
  }
}
