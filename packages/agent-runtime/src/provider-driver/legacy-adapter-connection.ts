import type { ChildProcess } from "node:child_process";
import { z } from "zod";
import type { RuntimeThreadExecutionOptions } from "@bb/domain";
import type {
  AdapterCommand,
  ProviderAdapter,
  ProviderCommandPlan,
  ProviderRequestCommandPlan,
} from "../provider-adapter.js";
import {
  ignoredJsonRpcResultSchema,
  type JsonRpcObject,
  type PendingJsonRpcRequest,
  type ProviderInboundRequest,
  type ProviderRuntimeEvent,
  sendJsonRpcError,
  sendJsonRpcRequest,
  sendJsonRpcResult,
  settleJsonRpcResponse,
} from "../runtime-json-rpc.js";
import {
  resolveThreadIdentityResult,
  threadIdentityResultSchema,
} from "../thread-identity.js";
import type { AgentRuntimeSkillRoot } from "../types.js";
import type {
  ProviderDriverConnection,
  ProviderDriverClearSessionGoalResult,
  ProviderDriverRenameSessionArgs,
  ProviderDriverSessionOpenArgs,
  ProviderDriverSessionOpenResult,
  ProviderDriverSessionTarget,
  ProviderDriverSetSessionArchivedArgs,
  ProviderDriverStopSessionArgs,
  ProviderDriverStopSessionResult,
  ProviderDriverTurnSubmitArgs,
} from "./connection.js";

interface LegacyAdapterConnectionArgs {
  adapter: ProviderAdapter;
  child: ChildProcess;
  getNextRequestId: () => number;
}

const providerThreadStopResultSchema = z
  .object({
    providerCheckpointId: z.string().min(1).nullable().optional(),
  })
  .passthrough();

const threadGoalClearResultSchema = z.object({ cleared: z.boolean() }).strict();

function isAlreadyArchivedStateError(
  archived: boolean,
  error: unknown,
): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return archived
    ? error.message.includes("no rollout found for thread id")
    : error.message.includes("no archived rollout found for thread id");
}

function requireRequestPlan(
  providerId: string,
  command: AdapterCommand,
  plan: ProviderCommandPlan,
): ProviderRequestCommandPlan {
  if (plan.kind === "request") {
    return plan;
  }
  throw new Error(
    `Adapter "${providerId}" returned no provider request for ${command.type}: ${plan.reason}`,
  );
}

/**
 * Compatibility implementation for the current newline-delimited adapter
 * processes. All provider command construction, command-implied event
 * synthesis, and result identity inference is contained here so it can be
 * deleted provider-by-provider as canonical drivers replace adapters.
 */
export class LegacyAdapterConnection implements ProviderDriverConnection {
  readonly approvalRequestPolicy;
  readonly capabilities;
  readonly identity;
  readonly supportsInteractiveResponses;

  private readonly adapter: ProviderAdapter;
  private readonly child: ChildProcess;
  private readonly getNextRequestId: () => number;
  private readonly pending = new Map<string | number, PendingJsonRpcRequest>();

  constructor(args: LegacyAdapterConnectionArgs) {
    this.adapter = args.adapter;
    this.child = args.child;
    this.getNextRequestId = args.getNextRequestId;
    this.approvalRequestPolicy = args.adapter.approvalRequestPolicy;
    this.capabilities = args.adapter.capabilities;
    this.identity = {
      displayName: args.adapter.displayName,
      providerId: args.adapter.id,
    };
    this.supportsInteractiveResponses =
      args.adapter.buildInteractiveResponse !== undefined;
  }

  normalizeExecutionOptions(
    options: RuntimeThreadExecutionOptions,
  ): RuntimeThreadExecutionOptions {
    return this.adapter.normalizeExecutionOptions?.(options) ?? options;
  }

  classifyExecutionSettingsChange(args: {
    current: RuntimeThreadExecutionOptions;
    next: RuntimeThreadExecutionOptions;
  }) {
    return this.adapter.classifyExecutionSettingsChange(args);
  }

  async initialize(
    skillRoots: readonly AgentRuntimeSkillRoot[],
  ): Promise<void> {
    const initialize = this.adapter.buildCommandPlan({ type: "initialize" });
    if (initialize.kind === "request") {
      await this.request(initialize, ignoredJsonRpcResultSchema);
    }

    for (const request of this.adapter.buildPostInitializeRequests?.() ?? []) {
      try {
        const result = await this.request(
          request.plan,
          ignoredJsonRpcResultSchema,
        );
        request.onResult(result);
      } catch (error) {
        if (request.required) throw error;
      }
    }

    if (skillRoots.length === 0) {
      return;
    }
    const configureSkills = this.adapter.buildCommandPlan({
      type: "skills/configure",
      skillRoots,
    });
    if (configureSkills.kind === "request") {
      await this.request(configureSkills, ignoredJsonRpcResultSchema);
    }
  }

  async inspectModels(args: { cwd?: string }) {
    const command: AdapterCommand = {
      type: "model/list",
      ...(args.cwd !== undefined ? { cwd: args.cwd } : {}),
    };
    const result = await this.request(
      requireRequestPlan(
        this.identity.providerId,
        command,
        this.adapter.buildCommandPlan(command),
      ),
      ignoredJsonRpcResultSchema,
    );
    return this.adapter.parseModelListResult(result);
  }

  async openSession(
    args: ProviderDriverSessionOpenArgs,
    options?: {
      synthesizeAcceptedEvents?: boolean;
      timeoutMs?: number;
    },
  ): Promise<ProviderDriverSessionOpenResult> {
    const command = this.buildOpenSessionCommand(args);
    const plan = this.adapter.buildCommandPlan(command);
    if (plan.kind === "noop") {
      return {
        disposition: "unchanged",
        events: [],
        providerSessionId:
          args.mode.kind === "resume" ? args.mode.providerSessionId : null,
        providerSessionIdForCleanup: null,
      };
    }

    const result = await this.request(
      plan,
      threadIdentityResultSchema,
      options,
    );
    // Legacy result shapes are provider-specific and may contain an ambiguous
    // threadId. Keep that candidate only for best-effort cleanup; adoption uses
    // resolveThreadIdentityResult's stricter correlation rules.
    const providerSessionIdForCleanup =
      result.providerThreadId ?? result.thread?.id ?? result.threadId ?? null;
    const providerSessionId =
      resolveThreadIdentityResult({
        result,
        threadId: args.bbThreadId,
      }) ?? null;
    return {
      disposition: "opened",
      events:
        options?.synthesizeAcceptedEvents === false
          ? []
          : this.acceptedEvents(command, providerSessionId),
      providerSessionId,
      providerSessionIdForCleanup,
    };
  }

  async submitTurn(args: ProviderDriverTurnSubmitArgs) {
    const command: AdapterCommand =
      args.mode.kind === "start"
        ? {
            type: "turn/start",
            threadId: args.bbThreadId,
            providerThreadId: args.providerSessionId,
            input: args.input,
            ...(args.inputGroups !== undefined
              ? { inputGroups: args.inputGroups }
              : {}),
            clientRequestId: args.clientRequestId,
            options: args.execution,
          }
        : {
            type: "turn/steer",
            threadId: args.bbThreadId,
            providerThreadId: args.providerSessionId,
            expectedTurnId: args.mode.expectedTurnId,
            input: args.input,
            ...(args.inputGroups !== undefined
              ? { inputGroups: args.inputGroups }
              : {}),
            clientRequestId: args.clientRequestId,
            options: args.execution,
          };
    const request = requireRequestPlan(
      this.identity.providerId,
      command,
      this.adapter.buildCommandPlan(command),
    );
    const prepared =
      command.type === "turn/start"
        ? this.adapter.prepareTurnStart(command)
        : null;
    try {
      await this.request(request, ignoredJsonRpcResultSchema);
    } catch (error) {
      prepared?.rollback();
      throw error;
    }
    return this.acceptedEvents(command);
  }

  async stopSession(
    args: ProviderDriverStopSessionArgs,
  ): Promise<ProviderDriverStopSessionResult> {
    const command: AdapterCommand = {
      type: "thread/stop",
      threadId: args.bbThreadId,
      providerThreadId: args.providerSessionId,
      activeTurnId: args.activeTurnId,
    };
    const plan = this.adapter.buildCommandPlan(command);
    if (plan.kind === "noop") {
      return {
        disposition: "unchanged",
        events: [],
        noopReason: plan.reason,
        providerCheckpointId: null,
      };
    }
    const result = await this.request(plan, providerThreadStopResultSchema);
    return {
      disposition: "stopped",
      events: this.acceptedEvents(command),
      noopReason: null,
      providerCheckpointId: result.providerCheckpointId ?? null,
    };
  }

  async discardSession(args: ProviderDriverSessionTarget): Promise<void> {
    const command: AdapterCommand = {
      type: "thread/discard",
      threadId: args.bbThreadId,
      providerThreadId: args.providerSessionId,
    };
    const plan = this.adapter.buildCommandPlan(command);
    if (plan.kind === "request") {
      await this.request(plan, ignoredJsonRpcResultSchema);
    }
  }

  async clearSessionGoal(
    args: ProviderDriverSessionTarget,
  ): Promise<ProviderDriverClearSessionGoalResult> {
    const command: AdapterCommand = {
      type: "thread/goal/clear",
      threadId: args.bbThreadId,
      providerThreadId: args.providerSessionId,
    };
    return this.request(
      requireRequestPlan(
        this.identity.providerId,
        command,
        this.adapter.buildCommandPlan(command),
      ),
      threadGoalClearResultSchema,
    );
  }

  async renameSession(args: ProviderDriverRenameSessionArgs) {
    const command: AdapterCommand = {
      type: "thread/name/set",
      threadId: args.bbThreadId,
      providerThreadId: args.providerSessionId,
      title: args.title,
    };
    await this.request(
      requireRequestPlan(
        this.identity.providerId,
        command,
        this.adapter.buildCommandPlan(command),
      ),
      ignoredJsonRpcResultSchema,
    );
    return this.acceptedEvents(command);
  }

  async setSessionArchived(args: ProviderDriverSetSessionArchivedArgs) {
    const command: AdapterCommand = {
      type: args.archived ? "thread/archive" : "thread/unarchive",
      threadId: args.bbThreadId,
      providerThreadId: args.providerSessionId,
    };
    try {
      await this.request(
        requireRequestPlan(
          this.identity.providerId,
          command,
          this.adapter.buildCommandPlan(command),
        ),
        ignoredJsonRpcResultSchema,
      );
    } catch (error) {
      if (!isAlreadyArchivedStateError(args.archived, error)) {
        throw error;
      }
      // Codex archive operations are not idempotent at the protocol layer;
      // duplicate-state errors mean the requested final state already holds.
    }
    return this.acceptedEvents(command);
  }

  translateEvent(event: ProviderRuntimeEvent, context?: { threadId?: string }) {
    return this.adapter.translateEvent(event, context);
  }

  buildSessionDetachedEvents(bbThreadId: string) {
    return (
      this.adapter.buildThreadDetachedEvents?.({ threadId: bbThreadId }) ?? []
    );
  }

  decodeToolCallRequest(request: ProviderInboundRequest) {
    return this.adapter.decodeToolCallRequest(request);
  }

  decodeInteractiveRequest(request: ProviderInboundRequest) {
    return this.adapter.decodeInteractiveRequest?.(request) ?? null;
  }

  buildInteractiveResponse(
    args: Parameters<ProviderDriverConnection["buildInteractiveResponse"]>[0],
  ) {
    if (!this.adapter.buildInteractiveResponse) {
      throw new Error(
        `Provider "${this.identity.providerId}" cannot encode interactive responses`,
      );
    }
    return this.adapter.buildInteractiveResponse(args);
  }

  settleResponse(id: string | number, response: JsonRpcObject): void {
    settleJsonRpcResponse({ id, pending: this.pending, response });
  }

  sendError(args: {
    code?: number;
    id: string | number;
    message: string;
  }): void {
    sendJsonRpcError({ child: this.child, ...args });
  }

  sendResult(args: { id: string | number; result: unknown }): void {
    sendJsonRpcResult({ child: this.child, ...args });
  }

  rejectPendingRequests(error: Error): void {
    for (const [, pending] of this.pending) {
      pending.reject(error);
    }
    this.pending.clear();
  }

  private buildOpenSessionCommand(
    args: ProviderDriverSessionOpenArgs,
  ): AdapterCommand {
    const base = {
      threadId: args.bbThreadId,
      cwd: args.cwd,
      options: args.execution,
      dynamicTools: args.dynamicTools,
      disallowedTools: args.disallowedTools,
      instructionMode: args.instructionMode,
    };
    switch (args.mode.kind) {
      case "start":
        return { type: "thread/start", ...base };
      case "resume":
        return {
          type: "thread/resume",
          ...base,
          providerThreadId: args.mode.providerSessionId,
        };
      case "fork":
        return {
          type: "thread/fork",
          ...base,
          sourceProviderThreadId: args.mode.sourceProviderSessionId,
          ...(args.mode.sourceProviderCheckpointId !== undefined
            ? {
                sourceProviderCheckpointId:
                  args.mode.sourceProviderCheckpointId,
              }
            : {}),
        };
    }
  }

  private acceptedEvents(
    command: AdapterCommand,
    providerSessionId?: string | null,
  ) {
    return this.adapter.translateAcceptedCommand({
      command,
      ...(providerSessionId ? { providerThreadId: providerSessionId } : {}),
    });
  }

  private request<TResult>(
    message: ProviderRequestCommandPlan,
    resultSchema: z.ZodType<TResult>,
    options?: { timeoutMs?: number },
  ): Promise<TResult> {
    return sendJsonRpcRequest({
      child: this.child,
      getNextId: this.getNextRequestId,
      message,
      pending: this.pending,
      resultSchema,
      ...(options?.timeoutMs !== undefined
        ? { timeoutMs: options.timeoutMs }
        : {}),
    });
  }
}
