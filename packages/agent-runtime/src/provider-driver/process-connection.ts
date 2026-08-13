import type { Readable, Writable } from "node:stream";
import {
  ProviderDriverFrameDecoder,
  ProviderDriverLifecycle,
  ProviderDriverLifecycleError,
  encodeProviderDriverFrame,
  providerDriverEventNotificationSchema,
  providerDriverHostMethodSchemas,
  providerDriverHostRequestSchema,
  providerDriverMethodSchemas,
  providerDriverRpcResponseSchema,
  type ProviderDriverConnectionExitSnapshot,
  type ProviderDriverError,
  type ProviderDriverEvent,
  type ProviderDriverHostInteractionRequestParams,
  type ProviderDriverHostInteractionRequestResult,
  type ProviderDriverHostToolCallParams,
  type ProviderDriverHostToolCallResult,
  type ProviderDriverInitializeParams,
  type ProviderDriverInitializeResult,
  type ProviderDriverInspectParams,
  type ProviderDriverInspectResult,
  type ProviderDriverOperationResult,
  type ProviderDriverRpcResponse,
  type ProviderSessionDetachParams,
  type ProviderSessionDetachResult,
  type ProviderSessionDiscardParams,
  type ProviderSessionOpenParams,
  type ProviderSessionOpenResult,
  type ProviderSessionArchiveParams,
  type ProviderSessionClearGoalParams,
  type ProviderSessionCompactParams,
  type ProviderSessionRenameParams,
  type ProviderTurnCancelParams,
  type ProviderTurnCancelResult,
  type ProviderTurnSubmitParams,
  type ProviderTurnSubmitResult,
} from "@bb/provider-driver-contract";
import type { z } from "zod";

const DEFAULT_PROVIDER_DRIVER_REQUEST_TIMEOUT_MS = 30_000;
const MAX_PENDING_PROVIDER_DRIVER_REQUESTS = 1_024;
const MAX_PENDING_PROVIDER_DRIVER_HOST_REQUESTS = 256;

export interface ProviderDriverProcessExit {
  code: number | null;
  lifecycle: ProviderDriverConnectionExitSnapshot;
  signal: string | null;
}

export interface ProcessProviderDriverHostHandlers {
  requestInteraction?: (
    params: ProviderDriverHostInteractionRequestParams,
  ) => Promise<ProviderDriverHostInteractionRequestResult>;
  callTool?: (
    params: ProviderDriverHostToolCallParams,
  ) => Promise<ProviderDriverHostToolCallResult>;
}

export interface ProcessProviderDriverConnectionOptions {
  hostHandlers?: ProcessProviderDriverHostHandlers;
  onProtocolError?: (error: Error) => void;
  readable: Readable;
  requestTimeoutMs?: number;
  writable: Writable;
}

export interface ProcessProviderDriverConnectionRequestTimeouts {
  driverInitializeMs?: number;
  driverInspectMs?: number;
  sessionOpenMs?: number;
  defaultMs?: number;
}

interface PendingProviderDriverRequest {
  reject(error: Error): void;
  settle(response: ProviderDriverRpcResponse): void;
  timeout: ReturnType<typeof setTimeout>;
}

interface RpcRequestLike {
  id: string | number;
  method: string;
}

export class ProviderDriverRemoteError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data: ProviderDriverError | null,
  ) {
    super(message);
    this.name = "ProviderDriverRemoteError";
  }
}

export class ProviderDriverProtocolError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ProviderDriverProtocolError";
  }
}

export class ProviderDriverProcessExitedError extends Error {
  constructor(readonly exit: Omit<ProviderDriverProcessExit, "lifecycle">) {
    super(
      `Provider driver process exited (${exit.code !== null ? `code ${exit.code}` : exit.signal !== null ? `signal ${exit.signal}` : "unknown status"})`,
    );
    this.name = "ProviderDriverProcessExitedError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isRpcId(value: unknown): value is string | number {
  return (
    (typeof value === "string" && value.length > 0) ||
    (typeof value === "number" && Number.isSafeInteger(value))
  );
}

function parseRpcRequestLike(value: unknown): RpcRequestLike | null {
  if (
    !isRecord(value) ||
    value.jsonrpc !== "2.0" ||
    !isRpcId(value.id) ||
    typeof value.method !== "string"
  ) {
    return null;
  }
  return { id: value.id, method: value.method };
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * Canonical framed JSON-RPC peer for one provider driver process.
 *
 * This class owns framing, request correlation, host callbacks, and canonical
 * lifecycle validation. Process launch/termination and diagnostic stdout and
 * stderr belong to ProviderDriverSupervisor.
 */
export class ProcessProviderDriverConnection {
  private readonly activeHostRequestIds = new Set<string | number>();
  private readonly decoder = new ProviderDriverFrameDecoder();
  private readonly eventListeners = new Set<
    (event: ProviderDriverEvent) => void
  >();
  private readonly exitListeners = new Set<
    (exit: ProviderDriverProcessExit) => void
  >();
  private readonly hostHandlers: ProcessProviderDriverHostHandlers;
  private readonly lifecycle = new ProviderDriverLifecycle();
  private readonly onProtocolError: ((error: Error) => void) | undefined;
  private readonly pending = new Map<
    string | number,
    PendingProviderDriverRequest
  >();
  private readonly readable: Readable;
  private readonly requestTimeoutMs: number;
  private readonly requestTimeouts = new Map<string, number>();
  private readonly writable: Writable;
  private activeHostRequests = 0;
  private closed = false;
  private initialized = false;
  private initializing = false;
  private nextRequestId = 1;
  private protocolFailed = false;
  private recordedExit: ProviderDriverProcessExit | null = null;

  constructor(options: ProcessProviderDriverConnectionOptions) {
    this.hostHandlers = options.hostHandlers ?? {};
    this.onProtocolError = options.onProtocolError;
    this.readable = options.readable;
    this.requestTimeoutMs =
      options.requestTimeoutMs ?? DEFAULT_PROVIDER_DRIVER_REQUEST_TIMEOUT_MS;
    this.writable = options.writable;

    this.readable.on("data", this.handleData);
    this.readable.on("error", this.handleStreamError);
    this.writable.on("error", this.handleStreamError);
  }

  configureRequestTimeouts(
    timeouts: ProcessProviderDriverConnectionRequestTimeouts,
  ): void {
    if (timeouts.defaultMs !== undefined) {
      this.requestTimeouts.set("default", timeouts.defaultMs);
    }
    if (timeouts.driverInitializeMs !== undefined) {
      this.requestTimeouts.set(
        "driver.initialize",
        timeouts.driverInitializeMs,
      );
    }
    if (timeouts.driverInspectMs !== undefined) {
      this.requestTimeouts.set("driver.inspect", timeouts.driverInspectMs);
    }
    if (timeouts.sessionOpenMs !== undefined) {
      this.requestTimeouts.set("session.open", timeouts.sessionOpenMs);
    }
  }

  async initialize(
    params: ProviderDriverInitializeParams,
  ): Promise<ProviderDriverInitializeResult> {
    if (this.initialized || this.initializing) {
      throw new ProviderDriverProtocolError(
        "Provider driver connection is already initializing or initialized",
      );
    }
    this.initializing = true;
    try {
      return await this.request(
        "driver.initialize",
        params,
        providerDriverMethodSchemas["driver.initialize"].params,
        providerDriverMethodSchemas["driver.initialize"].result,
        (result) => {
          this.lifecycle.recordInitialized(params, result);
          this.initialized = true;
        },
      );
    } finally {
      this.initializing = false;
    }
  }

  inspect(
    params: ProviderDriverInspectParams,
  ): Promise<ProviderDriverInspectResult> {
    this.requireInitialized();
    return this.request(
      "driver.inspect",
      params,
      providerDriverMethodSchemas["driver.inspect"].params,
      providerDriverMethodSchemas["driver.inspect"].result,
    );
  }

  openSession(
    params: ProviderSessionOpenParams,
  ): Promise<ProviderSessionOpenResult> {
    this.requireInitialized();
    return this.request(
      "session.open",
      params,
      providerDriverMethodSchemas["session.open"].params,
      providerDriverMethodSchemas["session.open"].result,
      (result) => {
        this.lifecycle.recordSessionOpened(params, result);
      },
    );
  }

  detachSession(
    params: ProviderSessionDetachParams,
  ): Promise<ProviderSessionDetachResult> {
    this.requireInitialized();
    return this.request(
      "session.detach",
      params,
      providerDriverMethodSchemas["session.detach"].params,
      providerDriverMethodSchemas["session.detach"].result,
      (result) => {
        this.lifecycle.recordSessionDetached(params, result);
      },
    );
  }

  async discardSession(params: ProviderSessionDiscardParams): Promise<void> {
    this.requireInitialized();
    await this.request(
      "session.discard",
      params,
      providerDriverMethodSchemas["session.discard"].params,
      providerDriverMethodSchemas["session.discard"].result,
      () => {
        this.lifecycle.recordSessionDiscarded(params);
      },
    );
  }

  submitTurn(
    params: ProviderTurnSubmitParams,
  ): Promise<ProviderTurnSubmitResult> {
    this.requireInitialized();
    return this.request(
      "turn.submit",
      params,
      providerDriverMethodSchemas["turn.submit"].params,
      providerDriverMethodSchemas["turn.submit"].result,
      (result) => {
        this.lifecycle.recordTurnSubmitted(params, result);
      },
    );
  }

  cancelTurn(
    params: ProviderTurnCancelParams,
  ): Promise<ProviderTurnCancelResult> {
    this.requireInitialized();
    return this.request(
      "turn.cancel",
      params,
      providerDriverMethodSchemas["turn.cancel"].params,
      providerDriverMethodSchemas["turn.cancel"].result,
      (result) => {
        this.lifecycle.recordTurnCancellationRequested(params, result);
      },
    );
  }

  renameSession(
    params: ProviderSessionRenameParams,
  ): Promise<ProviderDriverOperationResult> {
    this.requireInitialized();
    return this.request(
      "session.rename",
      params,
      providerDriverMethodSchemas["session.rename"].params,
      providerDriverMethodSchemas["session.rename"].result,
    );
  }

  setSessionArchived(
    params: ProviderSessionArchiveParams,
  ): Promise<ProviderDriverOperationResult> {
    this.requireInitialized();
    return this.request(
      "session.set_archived",
      params,
      providerDriverMethodSchemas["session.set_archived"].params,
      providerDriverMethodSchemas["session.set_archived"].result,
    );
  }

  compactSession(
    params: ProviderSessionCompactParams,
  ): Promise<ProviderDriverOperationResult> {
    this.requireInitialized();
    return this.request(
      "session.compact",
      params,
      providerDriverMethodSchemas["session.compact"].params,
      providerDriverMethodSchemas["session.compact"].result,
    );
  }

  clearSessionGoal(
    params: ProviderSessionClearGoalParams,
  ): Promise<ProviderDriverOperationResult> {
    this.requireInitialized();
    return this.request(
      "session.clear_goal",
      params,
      providerDriverMethodSchemas["session.clear_goal"].params,
      providerDriverMethodSchemas["session.clear_goal"].result,
    );
  }

  async shutdown(): Promise<void> {
    if (this.closed) {
      return;
    }
    if (this.initialized) {
      await this.request(
        "driver.shutdown",
        {},
        providerDriverMethodSchemas["driver.shutdown"].params,
        providerDriverMethodSchemas["driver.shutdown"].result,
      );
    }
    this.writable.end();
  }

  onEvent(listener: (event: ProviderDriverEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  onExit(listener: (exit: ProviderDriverProcessExit) => void): () => void {
    this.exitListeners.add(listener);
    return () => this.exitListeners.delete(listener);
  }

  recordProcessExit(args: {
    code: number | null;
    signal: string | null;
  }): ProviderDriverProcessExit {
    if (this.recordedExit !== null) {
      return this.recordedExit;
    }
    this.closed = true;
    this.readable.off("data", this.handleData);
    this.readable.off("error", this.handleStreamError);
    this.writable.off("error", this.handleStreamError);

    if (!this.protocolFailed) {
      try {
        this.decoder.finish();
      } catch (error) {
        this.reportProtocolError(toError(error));
      }
    }

    const exitError = new ProviderDriverProcessExitedError(args);
    this.rejectPending(exitError);
    const exit: ProviderDriverProcessExit = {
      ...args,
      lifecycle: this.lifecycle.recordConnectionExited(),
    };
    this.recordedExit = exit;
    for (const listener of this.exitListeners) {
      listener(exit);
    }
    return exit;
  }

  private readonly handleData = (chunk: Buffer): void => {
    if (this.closed) return;
    try {
      const messages = this.decoder.push(chunk);
      for (const message of messages) {
        if (this.closed) return;
        this.handleMessage(message);
      }
    } catch (error) {
      this.failProtocol(toError(error));
    }
  };

  private readonly handleStreamError = (error: Error): void => {
    this.failProtocol(error);
  };

  private handleMessage(message: unknown): void {
    const eventNotification =
      providerDriverEventNotificationSchema.safeParse(message);
    if (eventNotification.success) {
      try {
        this.lifecycle.recordEvent(eventNotification.data.params);
      } catch (error) {
        this.failProtocol(toError(error));
        return;
      }
      for (const listener of this.eventListeners) {
        listener(eventNotification.data.params);
      }
      return;
    }

    const hostRequest = providerDriverHostRequestSchema.safeParse(message);
    if (hostRequest.success) {
      this.handleHostRequest(hostRequest.data);
      return;
    }

    const response = providerDriverRpcResponseSchema.safeParse(message);
    if (response.success) {
      this.handleResponse(response.data);
      return;
    }

    const requestLike = parseRpcRequestLike(message);
    if (requestLike) {
      this.writeError({
        id: requestLike.id,
        code: requestLike.method.startsWith("host.") ? -32602 : -32601,
        message: requestLike.method.startsWith("host.")
          ? `Invalid params for ${requestLike.method}`
          : `Unsupported driver request ${requestLike.method}`,
      });
      return;
    }

    this.failProtocol(
      new ProviderDriverProtocolError("Invalid provider driver RPC envelope"),
    );
  }

  private handleResponse(response: ProviderDriverRpcResponse): void {
    const pending = this.pending.get(response.id);
    if (!pending) {
      this.failProtocol(
        new ProviderDriverProtocolError(
          `Provider driver returned unknown response id ${String(response.id)}`,
        ),
      );
      return;
    }
    this.pending.delete(response.id);
    clearTimeout(pending.timeout);
    pending.settle(response);
  }

  private handleHostRequest(
    request: z.output<typeof providerDriverHostRequestSchema>,
  ): void {
    if (this.activeHostRequestIds.has(request.id)) {
      this.failProtocol(
        new ProviderDriverProtocolError(
          `Provider driver reused active host request id ${String(request.id)}`,
        ),
      );
      return;
    }
    try {
      this.lifecycle.validateActiveTurnScope({
        attachmentId: request.params.attachmentId,
        turnId: request.params.turnId,
      });
    } catch (error) {
      this.failProtocol(toError(error));
      return;
    }

    switch (request.method) {
      case "host.tool.call": {
        const handler = this.hostHandlers.callTool;
        if (!handler) {
          this.writeError({
            id: request.id,
            code: -32601,
            message: "Host tool calls are not configured",
          });
          return;
        }
        this.executeHostRequest(
          request.id,
          providerDriverHostMethodSchemas["host.tool.call"].result,
          () => handler(request.params),
        );
        return;
      }
      case "host.interaction.request": {
        const handler = this.hostHandlers.requestInteraction;
        if (!handler) {
          this.writeError({
            id: request.id,
            code: -32601,
            message: "Host interactions are not configured",
          });
          return;
        }
        this.executeHostRequest(
          request.id,
          providerDriverHostMethodSchemas["host.interaction.request"].result,
          () => handler(request.params),
        );
      }
    }
  }

  private executeHostRequest<Result>(
    id: string | number,
    schema: z.ZodType<Result>,
    execute: () => Promise<Result>,
  ): void {
    if (this.activeHostRequests >= MAX_PENDING_PROVIDER_DRIVER_HOST_REQUESTS) {
      this.writeError({
        id,
        code: -32000,
        message: "Too many pending provider driver host requests",
      });
      return;
    }
    this.activeHostRequests += 1;
    this.activeHostRequestIds.add(id);
    void execute()
      .then((result) => this.writeValidatedHostResult(id, schema, result))
      .catch((error) => this.writeHandlerError(id, error))
      .finally(() => {
        this.activeHostRequests -= 1;
        this.activeHostRequestIds.delete(id);
      });
  }

  private writeValidatedHostResult<Result>(
    id: string | number,
    schema: z.ZodType<Result>,
    result: Result,
  ): void {
    const parsed = schema.safeParse(result);
    if (!parsed.success) {
      this.writeError({
        id,
        code: -32603,
        message: "Host handler returned an invalid result",
      });
      return;
    }
    this.writeMessage({ jsonrpc: "2.0", id, result: parsed.data });
  }

  private writeHandlerError(id: string | number, error: unknown): void {
    this.writeError({
      id,
      code: -32000,
      message: toError(error).message,
    });
  }

  private request<Params, Result>(
    method: string,
    params: Params,
    paramsSchema: z.ZodType,
    resultSchema: z.ZodType<Result>,
    onResult?: (result: Result) => void,
  ): Promise<Result> {
    this.requireOpen();
    const parsedParams = paramsSchema.safeParse(params);
    if (!parsedParams.success) {
      return Promise.reject(
        new ProviderDriverProtocolError(
          `Invalid daemon params for provider driver method ${method}`,
          { cause: parsedParams.error },
        ),
      );
    }
    if (this.pending.size >= MAX_PENDING_PROVIDER_DRIVER_REQUESTS) {
      return Promise.reject(
        new ProviderDriverProtocolError(
          `Provider driver has ${this.pending.size} pending requests; refusing ${method}`,
        ),
      );
    }

    const id = this.nextRequestId++;
    return new Promise<Result>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        const error = new ProviderDriverProtocolError(
          `Provider driver request timed out: ${method}`,
        );
        reject(error);
        // The provider may have accepted a timed-out mutation. Close the
        // connection rather than allowing a late response to race a retry.
        this.failProtocol(error);
      }, this.timeoutForMethod(method));
      this.pending.set(id, {
        timeout,
        reject,
        settle: (response) => {
          if ("error" in response) {
            reject(
              new ProviderDriverRemoteError(
                response.error.code,
                response.error.message,
                response.error.data,
              ),
            );
            return;
          }

          const result = resultSchema.safeParse(response.result);
          if (!result.success) {
            const error = new ProviderDriverProtocolError(
              `Invalid provider driver result for ${method}`,
              { cause: result.error },
            );
            this.failProtocol(error);
            reject(error);
            return;
          }
          try {
            onResult?.(result.data);
          } catch (error) {
            const protocolError =
              error instanceof ProviderDriverLifecycleError
                ? new ProviderDriverProtocolError(error.message, {
                    cause: error,
                  })
                : toError(error);
            this.failProtocol(protocolError);
            reject(protocolError);
            return;
          }
          resolve(result.data);
        },
      });
      this.writeMessage({
        jsonrpc: "2.0",
        id,
        method,
        params: parsedParams.data,
      });
    });
  }

  private timeoutForMethod(method: string): number {
    return (
      this.requestTimeouts.get(method) ??
      this.requestTimeouts.get("default") ??
      this.requestTimeoutMs
    );
  }

  private writeError(args: {
    code: number;
    id: string | number;
    message: string;
  }): void {
    this.writeMessage({
      jsonrpc: "2.0",
      id: args.id,
      error: {
        code: args.code,
        message: args.message,
        data: null,
      },
    });
  }

  private writeMessage(message: unknown): void {
    if (this.closed) return;
    try {
      this.writable.write(encodeProviderDriverFrame(message));
    } catch (error) {
      this.failProtocol(toError(error));
    }
  }

  private requireInitialized(): void {
    if (!this.initialized) {
      throw new ProviderDriverProtocolError(
        "Provider driver connection is not initialized",
      );
    }
  }

  private requireOpen(): void {
    if (this.closed) {
      throw new ProviderDriverProtocolError(
        "Provider driver connection is closed",
      );
    }
  }

  private failProtocol(error: Error): void {
    if (this.closed) return;
    const protocolError =
      error instanceof ProviderDriverProtocolError
        ? error
        : new ProviderDriverProtocolError(error.message, { cause: error });
    this.protocolFailed = true;
    this.reportProtocolError(protocolError);
    this.closed = true;
    this.rejectPending(protocolError);
    this.readable.destroy();
    this.writable.destroy();
  }

  private reportProtocolError(error: Error): void {
    this.onProtocolError?.(
      error instanceof ProviderDriverProtocolError
        ? error
        : new ProviderDriverProtocolError(error.message, { cause: error }),
    );
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
