import { createReadStream, createWriteStream } from "node:fs";
import type { Readable, Writable } from "node:stream";
import {
  PROVIDER_DRIVER_MAX_DETAIL_LENGTH,
  PROVIDER_DRIVER_MAX_MESSAGE_LENGTH,
  PROVIDER_DRIVER_PROTOCOL_VERSION,
  ProviderDriverFrameDecoder,
  ProviderDriverLifecycle,
  ProviderDriverLifecycleError,
  providerDriverErrorSchema,
  providerDriverHostMethodSchemas,
  providerDriverInitializeResultSchema,
  providerDriverInspectResultSchema,
  providerDriverMethodSchemas,
  providerDriverRequestSchema,
  providerDriverRpcResponseSchema,
  supportsCurrentProviderDriverProtocol,
  type ProviderDriverError,
  type ProviderDriverHostInteractionRequestParams,
  type ProviderDriverHostInteractionRequestResult,
  type ProviderDriverHostToolCallParams,
  type ProviderDriverHostToolCallResult,
  type ProviderDriverRequest,
  type ProviderDriverRpcResponse,
} from "@bb/provider-driver-contract";
import type { z } from "zod";
import type {
  ProviderDriverContext,
  ProviderDriverDefinition,
  ProviderDriverHost,
} from "./define-provider-driver.js";
import {
  ProviderDriverEventWriter,
  ProviderDriverMessageWriter,
} from "./event-writer.js";
import {
  ProviderDriverOperationCapacityError,
  ProviderDriverOperationConflictError,
  ProviderDriverOperationLedger,
  ProviderDriverOperationResultError,
} from "./operation-idempotency.js";

const DEFAULT_PROVIDER_DRIVER_HOST_REQUEST_TIMEOUT_MS = 30_000;
const MAX_PENDING_DAEMON_REQUESTS = 1_024;
const MAX_PENDING_HOST_REQUESTS = 256;

interface RpcRequestLike {
  id: string | number;
  method: string;
}

interface PendingHostRequest {
  readonly reject: (error: Error) => void;
  readonly settle: (response: ProviderDriverRpcResponse) => void;
  readonly timeout: ReturnType<typeof setTimeout>;
}

export interface ProviderDriverServerOptions {
  readonly driver: ProviderDriverDefinition;
  readonly hostRequestTimeoutMs?: number;
  readonly maxOperationRecords?: number;
  readonly onFatalError?: (error: Error) => void;
  readonly readable: Readable;
  readonly writable: Writable;
}

export interface ProviderDriverProcessOptions {
  readonly hostRequestTimeoutMs?: number;
  readonly maxOperationRecords?: number;
  readonly onFatalError?: (error: Error) => void;
}

export class ProviderDriverRequestError extends Error {
  constructor(
    readonly data: ProviderDriverError,
    readonly rpcCode = -32_000,
  ) {
    super(data.message);
    this.name = "ProviderDriverRequestError";
  }
}

export class ProviderDriverHostRequestError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data: ProviderDriverError | null,
  ) {
    super(message);
    this.name = "ProviderDriverHostRequestError";
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

function truncate(value: string, maximum: number): string {
  return value.length <= maximum ? value : value.slice(0, maximum);
}

function driverError(args: {
  code: string;
  message: string;
  detail?: string;
}): ProviderDriverError {
  return providerDriverErrorSchema.parse({
    code: args.code,
    category: "driver",
    message: truncate(
      args.message || "Provider driver request failed",
      PROVIDER_DRIVER_MAX_MESSAGE_LENGTH,
    ),
    detail:
      args.detail === undefined
        ? undefined
        : truncate(args.detail, PROVIDER_DRIVER_MAX_DETAIL_LENGTH),
    retry: { disposition: "never" },
  });
}

function unsupported(message: string) {
  return { outcome: "unsupported" as const, message };
}

function parseDriverResult<Result>(
  method: string,
  schema: z.ZodType<Result>,
  value: unknown,
): Result {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ProviderDriverOperationResultError(method, {
      cause: parsed.error,
    });
  }
  return parsed.data;
}

class ProviderDriverHostClient implements ProviderDriverHost {
  private readonly awaitAcceptance: (
    attachmentId: string,
  ) => Promise<boolean> | null;
  private readonly lifecycle: ProviderDriverLifecycle;
  private readonly onFatalError: (error: Error) => void;
  private readonly pending = new Map<string, PendingHostRequest>();
  private readonly requestTimeoutMs: number;
  private readonly writer: ProviderDriverMessageWriter;
  private closed = false;
  private nextRequestId = 1;

  constructor(args: {
    awaitAcceptance: (attachmentId: string) => Promise<boolean> | null;
    lifecycle: ProviderDriverLifecycle;
    onFatalError: (error: Error) => void;
    requestTimeoutMs: number;
    writer: ProviderDriverMessageWriter;
  }) {
    this.awaitAcceptance = args.awaitAcceptance;
    this.lifecycle = args.lifecycle;
    this.onFatalError = args.onFatalError;
    this.requestTimeoutMs = args.requestTimeoutMs;
    this.writer = args.writer;
  }

  callTool(
    params: ProviderDriverHostToolCallParams,
  ): Promise<ProviderDriverHostToolCallResult> {
    return this.request(
      "host.tool.call",
      params,
      providerDriverHostMethodSchemas["host.tool.call"].params,
      providerDriverHostMethodSchemas["host.tool.call"].result,
    );
  }

  requestInteraction(
    params: ProviderDriverHostInteractionRequestParams,
  ): Promise<ProviderDriverHostInteractionRequestResult> {
    return this.request(
      "host.interaction.request",
      params,
      providerDriverHostMethodSchemas["host.interaction.request"].params,
      providerDriverHostMethodSchemas["host.interaction.request"].result,
    );
  }

  handleResponse(response: ProviderDriverRpcResponse): void {
    const id = String(response.id);
    const pending = this.pending.get(id);
    if (!pending) {
      this.onFatalError(
        new Error(`Host returned unknown provider driver response id ${id}`),
      );
      return;
    }
    this.pending.delete(id);
    clearTimeout(pending.timeout);
    pending.settle(response);
  }

  close(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private async request<
    Params extends { attachmentId: string; turnId: string },
    Result,
  >(
    method: string,
    params: Params,
    paramsSchema: z.ZodType,
    resultSchema: z.ZodType<Result>,
  ): Promise<Result> {
    const acceptance = this.awaitAcceptance(params.attachmentId);
    if (acceptance && !(await acceptance)) {
      throw new Error(
        `Provider driver turn on attachment ${params.attachmentId} was not accepted`,
      );
    }
    if (this.closed) {
      return Promise.reject(
        new Error("Provider driver host connection closed"),
      );
    }
    if (this.pending.size >= MAX_PENDING_HOST_REQUESTS) {
      return Promise.reject(
        new Error("Provider driver has too many pending host requests"),
      );
    }
    const parsedParams = paramsSchema.safeParse(params);
    if (!parsedParams.success) {
      return Promise.reject(
        new Error(`Invalid provider driver params for ${method}`, {
          cause: parsedParams.error,
        }),
      );
    }
    try {
      this.lifecycle.validateActiveTurnScope({
        attachmentId: params.attachmentId,
        turnId: params.turnId,
      });
    } catch (error) {
      return Promise.reject(toError(error));
    }

    const id = `driver-host-${this.nextRequestId++}`;
    return new Promise<Result>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        const error = new Error(
          `Provider driver host request timed out: ${method}`,
        );
        reject(error);
        this.onFatalError(error);
      }, this.requestTimeoutMs);
      this.pending.set(id, {
        reject,
        timeout,
        settle: (response) => {
          if ("error" in response) {
            reject(
              new ProviderDriverHostRequestError(
                response.error.code,
                response.error.message,
                response.error.data,
              ),
            );
            return;
          }
          const result = resultSchema.safeParse(response.result);
          if (!result.success) {
            const error = new Error(
              `Host returned an invalid result for ${method}`,
              {
                cause: result.error,
              },
            );
            reject(error);
            this.onFatalError(error);
            return;
          }
          resolve(result.data);
        },
      });
      void this.writer
        .send({ jsonrpc: "2.0", id, method, params: parsedParams.data })
        .catch((error: unknown) => {
          const writeError = toError(error);
          const pending = this.pending.get(id);
          if (pending) {
            this.pending.delete(id);
            clearTimeout(pending.timeout);
            pending.reject(writeError);
          }
          this.onFatalError(writeError);
        });
    });
  }
}

/** Canonical provider-driver JSON-RPC server for one isolated process. */
export class ProviderDriverServer {
  private readonly activeRequestIds = new Set<string | number>();
  private readonly decoder = new ProviderDriverFrameDecoder();
  private readonly driver: ProviderDriverDefinition;
  private readonly eventWriter: ProviderDriverEventWriter;
  private readonly hostClient: ProviderDriverHostClient;
  private readonly lifecycle = new ProviderDriverLifecycle();
  private readonly onFatalError: ((error: Error) => void) | undefined;
  private readonly operations: ProviderDriverOperationLedger;
  private readonly readable: Readable;
  private readonly writer: ProviderDriverMessageWriter;
  private closeFinished: (() => void) | null = null;
  private context: ProviderDriverContext | null = null;
  private initialized = false;
  private pendingDaemonRequests = 0;
  private requestQueue = Promise.resolve();
  private stopped = false;
  private terminalError: Error | null = null;

  readonly finished: Promise<void>;

  constructor(options: ProviderDriverServerOptions) {
    this.driver = options.driver;
    this.onFatalError = options.onFatalError;
    this.readable = options.readable;
    this.operations = new ProviderDriverOperationLedger({
      maximum: options.maxOperationRecords,
    });
    this.writer = new ProviderDriverMessageWriter({
      onError: this.fail,
      writable: options.writable,
    });
    this.hostClient = new ProviderDriverHostClient({
      awaitAcceptance: (attachmentId) =>
        this.eventWriter.waitForAcceptance(attachmentId),
      lifecycle: this.lifecycle,
      onFatalError: this.fail,
      requestTimeoutMs:
        options.hostRequestTimeoutMs ??
        DEFAULT_PROVIDER_DRIVER_HOST_REQUEST_TIMEOUT_MS,
      writer: this.writer,
    });
    this.eventWriter = new ProviderDriverEventWriter({
      lifecycle: this.lifecycle,
      onError: this.fail,
      writer: this.writer,
    });
    this.finished = new Promise<void>((resolve) => {
      this.closeFinished = resolve;
    });

    this.readable.on("data", this.handleData);
    this.readable.on("error", this.handleStreamError);
    this.readable.on("end", this.handleStreamEnd);
  }

  get fatalError(): Error | null {
    return this.terminalError;
  }

  private readonly handleData = (chunk: Buffer): void => {
    if (this.stopped) return;
    try {
      for (const message of this.decoder.push(chunk)) {
        if (this.stopped) return;
        this.handleMessage(message);
      }
    } catch (error) {
      this.fail(toError(error));
    }
  };

  private readonly handleStreamError = (error: Error): void => {
    this.fail(error);
  };

  private readonly handleStreamEnd = (): void => {
    if (this.stopped) return;
    try {
      this.decoder.finish();
      this.fail(new Error("Provider driver protocol input ended unexpectedly"));
    } catch (error) {
      this.fail(toError(error));
    }
  };

  private handleMessage(message: unknown): void {
    const response = providerDriverRpcResponseSchema.safeParse(message);
    if (response.success) {
      this.hostClient.handleResponse(response.data);
      return;
    }

    const request = providerDriverRequestSchema.safeParse(message);
    if (request.success) {
      this.enqueueRequest(request.data);
      return;
    }

    const requestLike = parseRpcRequestLike(message);
    if (requestLike) {
      void this.writeError({
        id: requestLike.id,
        code:
          requestLike.method in providerDriverMethodSchemas ? -32_602 : -32_601,
        message:
          requestLike.method in providerDriverMethodSchemas
            ? `Invalid params for ${requestLike.method}`
            : `Unsupported provider driver method ${requestLike.method}`,
        data: null,
      }).catch(this.fail);
      return;
    }
    this.fail(new Error("Invalid provider driver RPC envelope from host"));
  }

  private enqueueRequest(request: ProviderDriverRequest): void {
    if (this.activeRequestIds.has(request.id)) {
      this.fail(
        new Error(
          `Host reused active provider driver request id ${String(request.id)}`,
        ),
      );
      return;
    }
    if (this.pendingDaemonRequests >= MAX_PENDING_DAEMON_REQUESTS) {
      void this.writeError({
        id: request.id,
        code: -32_000,
        message: "Too many pending provider driver requests",
        data: driverError({
          code: "request_capacity_exceeded",
          message: "Provider driver request capacity exceeded",
        }),
      }).catch(this.fail);
      return;
    }
    this.activeRequestIds.add(request.id);
    this.pendingDaemonRequests += 1;
    this.requestQueue = this.requestQueue.then(async () => {
      if (!this.stopped) {
        await this.dispatchRequest(request);
      }
      this.activeRequestIds.delete(request.id);
      this.pendingDaemonRequests -= 1;
    });
    void this.requestQueue.catch(this.fail);
  }

  private async dispatchRequest(request: ProviderDriverRequest): Promise<void> {
    try {
      if (request.method === "driver.initialize") {
        if (this.initialized) {
          throw new ProviderDriverRequestError(
            driverError({
              code: "already_initialized",
              message: "Provider driver is already initialized",
            }),
          );
        }
        if (
          !supportsCurrentProviderDriverProtocol(
            request.params.supportedProtocolVersions,
          )
        ) {
          throw new ProviderDriverRequestError(
            driverError({
              code: "unsupported_protocol_version",
              message: "Host does not support this provider driver protocol",
            }),
          );
        }
        const result = providerDriverInitializeResultSchema.parse({
          protocolVersion: PROVIDER_DRIVER_PROTOCOL_VERSION,
          identity: this.driver.identity,
          processCapabilities: this.driver.processCapabilities,
        });
        await this.driver.initialize?.(request.params);
        this.lifecycle.recordInitialized(request.params, result);
        this.context = {
          events: this.eventWriter,
          host: this.hostClient,
          initialization: request.params,
        };
        this.initialized = true;
        await this.writeResult(request.id, result);
        return;
      }
      if (!this.initialized) {
        throw new ProviderDriverRequestError(
          driverError({
            code: "not_initialized",
            message: "Provider driver is not initialized",
          }),
        );
      }
      const context = this.requireContext();

      switch (request.method) {
        case "driver.inspect": {
          const result = parseDriverResult(
            request.method,
            providerDriverInspectResultSchema,
            await this.driver.inspect(request.params, context),
          );
          await this.writeResult(request.id, result);
          return;
        }
        case "driver.shutdown": {
          await this.driver.shutdown?.(context);
          await this.writeResult(request.id, {});
          await this.stopGracefully();
          return;
        }
        case "session.open": {
          this.eventWriter.beginAcceptanceBarrier(request.params.attachmentId);
          try {
            const { result } = await this.operations.run({
              execute: () => this.driver.openSession(request.params, context),
              kind: request.method,
              operationId: request.params.operationId,
              params: request.params,
              resultSchema: providerDriverMethodSchemas[request.method].result,
            });
            this.lifecycle.recordSessionOpened(request.params, result);
            await this.writeResult(request.id, result);
            this.eventWriter.releaseAcceptanceBarrier({
              attachmentId: request.params.attachmentId,
              emitBufferedEvents: true,
            });
          } catch (error) {
            this.eventWriter.abandonAcceptanceBarrier(
              request.params.attachmentId,
            );
            throw error;
          }
          return;
        }
        case "session.detach": {
          const { result } = await this.operations.run({
            execute: () => this.driver.detachSession(request.params, context),
            kind: request.method,
            operationId: request.params.operationId,
            params: request.params,
            resultSchema: providerDriverMethodSchemas[request.method].result,
          });
          this.lifecycle.recordSessionDetached(request.params, result);
          await this.writeResult(request.id, result);
          return;
        }
        case "session.discard": {
          const { result } = await this.operations.run({
            execute: async () => {
              await this.driver.discardSession(request.params, context);
              return {};
            },
            kind: request.method,
            operationId: request.params.operationId,
            params: request.params,
            resultSchema: providerDriverMethodSchemas[request.method].result,
          });
          this.lifecycle.recordSessionDiscarded(request.params);
          await this.writeResult(request.id, result);
          return;
        }
        case "turn.submit": {
          this.eventWriter.beginAcceptanceBarrier(request.params.attachmentId);
          try {
            const { result } = await this.operations.run({
              execute: () => this.driver.submitTurn(request.params, context),
              kind: request.method,
              operationId: request.params.operationId,
              params: request.params,
              resultSchema: providerDriverMethodSchemas[request.method].result,
            });
            this.lifecycle.recordTurnSubmitted(request.params, result);
            await this.writeResult(request.id, result);
            this.eventWriter.releaseAcceptanceBarrier({
              attachmentId: request.params.attachmentId,
              emitBufferedEvents:
                request.params.mode === "steer" ||
                result.outcome === "accepted",
            });
          } catch (error) {
            this.eventWriter.abandonAcceptanceBarrier(
              request.params.attachmentId,
            );
            throw error;
          }
          return;
        }
        case "turn.cancel": {
          this.eventWriter.beginAcceptanceBarrier(request.params.attachmentId);
          try {
            const { result } = await this.operations.run({
              execute: () => this.driver.cancelTurn(request.params, context),
              kind: request.method,
              operationId: request.params.operationId,
              params: request.params,
              resultSchema: providerDriverMethodSchemas[request.method].result,
            });
            this.lifecycle.recordTurnCancellationRequested(
              request.params,
              result,
            );
            await this.writeResult(request.id, result);
            this.eventWriter.releaseAcceptanceBarrier({
              attachmentId: request.params.attachmentId,
              emitBufferedEvents: true,
            });
          } catch (error) {
            this.eventWriter.abandonAcceptanceBarrier(
              request.params.attachmentId,
            );
            throw error;
          }
          return;
        }
        case "session.rename": {
          const { result } = await this.operations.run({
            execute: () =>
              this.driver.renameSession?.(request.params, context) ??
              unsupported("Session rename is not supported"),
            kind: request.method,
            operationId: request.params.operationId,
            params: request.params,
            resultSchema: providerDriverMethodSchemas[request.method].result,
          });
          await this.writeResult(request.id, result);
          return;
        }
        case "session.set_archived": {
          const { result } = await this.operations.run({
            execute: () =>
              this.driver.setSessionArchived?.(request.params, context) ??
              unsupported("Session archiving is not supported"),
            kind: request.method,
            operationId: request.params.operationId,
            params: request.params,
            resultSchema: providerDriverMethodSchemas[request.method].result,
          });
          await this.writeResult(request.id, result);
          return;
        }
        case "session.compact": {
          const { result } = await this.operations.run({
            execute: () =>
              this.driver.compactSession?.(request.params, context) ??
              unsupported("Session compaction is not supported"),
            kind: request.method,
            operationId: request.params.operationId,
            params: request.params,
            resultSchema: providerDriverMethodSchemas[request.method].result,
          });
          await this.writeResult(request.id, result);
          return;
        }
        case "session.clear_goal": {
          const { result } = await this.operations.run({
            execute: () =>
              this.driver.clearSessionGoal?.(request.params, context) ??
              unsupported("Clearing the session goal is not supported"),
            kind: request.method,
            operationId: request.params.operationId,
            params: request.params,
            resultSchema: providerDriverMethodSchemas[request.method].result,
          });
          await this.writeResult(request.id, result);
        }
      }
    } catch (error) {
      if (this.stopped) return;
      if (
        error instanceof ProviderDriverLifecycleError ||
        error instanceof ProviderDriverOperationResultError
      ) {
        this.fail(toError(error));
        return;
      }
      const requestError = this.requestError(error);
      await this.writeError({
        id: request.id,
        code: requestError.rpcCode,
        message: requestError.message,
        data: requestError.data,
      });
    }
  }

  private requestError(error: unknown): ProviderDriverRequestError {
    if (error instanceof ProviderDriverRequestError) return error;
    if (error instanceof ProviderDriverOperationConflictError) {
      return new ProviderDriverRequestError(
        driverError({ code: "operation_conflict", message: error.message }),
      );
    }
    if (error instanceof ProviderDriverOperationCapacityError) {
      return new ProviderDriverRequestError(
        driverError({
          code: "operation_capacity_exceeded",
          message: error.message,
        }),
      );
    }
    const failure = toError(error);
    return new ProviderDriverRequestError(
      driverError({
        code: "handler_failed",
        message: failure.message,
        detail: failure.stack,
      }),
      -32_603,
    );
  }

  private requireContext(): ProviderDriverContext {
    if (!this.context) {
      throw new ProviderDriverRequestError(
        driverError({
          code: "not_initialized",
          message: "Provider driver is not initialized",
        }),
      );
    }
    return this.context;
  }

  private writeResult(id: string | number, result: unknown): Promise<void> {
    return this.writer.send({ jsonrpc: "2.0", id, result });
  }

  private writeError(args: {
    id: string | number;
    code: number;
    message: string;
    data: ProviderDriverError | null;
  }): Promise<void> {
    return this.writer.send({
      jsonrpc: "2.0",
      id: args.id,
      error: {
        code: args.code,
        message: truncate(
          args.message || "Provider driver error",
          PROVIDER_DRIVER_MAX_MESSAGE_LENGTH,
        ),
        data: args.data,
      },
    });
  }

  private async stopGracefully(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.removeStreamListeners();
    this.eventWriter.close();
    this.hostClient.close(new Error("Provider driver shut down"));
    this.readable.destroy();
    await this.writer.end();
    this.closeFinished?.();
    this.closeFinished = null;
  }

  private readonly fail = (error: Error): void => {
    if (this.stopped) return;
    this.stopped = true;
    this.terminalError = error;
    this.removeStreamListeners();
    this.eventWriter.close();
    this.hostClient.close(error);
    this.readable.destroy();
    this.writer.fail(error);
    this.onFatalError?.(error);
    this.closeFinished?.();
    this.closeFinished = null;
  };

  private removeStreamListeners(): void {
    this.readable.off("data", this.handleData);
    this.readable.off("error", this.handleStreamError);
    this.readable.off("end", this.handleStreamEnd);
  }
}

/**
 * Serves a driver on the canonical child-process file descriptors.
 * fd 3 receives daemon requests and fd 4 carries driver protocol output.
 */
export function serveProviderDriverProcess(
  driver: ProviderDriverDefinition,
  options: ProviderDriverProcessOptions = {},
): ProviderDriverServer {
  const readable = createReadStream("", { fd: 3, autoClose: false });
  const writable = createWriteStream("", { fd: 4, autoClose: false });
  const server = new ProviderDriverServer({
    driver,
    readable,
    writable,
    hostRequestTimeoutMs: options.hostRequestTimeoutMs,
    maxOperationRecords: options.maxOperationRecords,
    onFatalError: (error) => {
      process.exitCode = 1;
      options.onFatalError?.(error);
      setImmediate(() => process.exit(1));
    },
  });
  void server.finished.then(() => {
    if (server.fatalError === null) {
      process.exitCode = 0;
      setImmediate(() => process.exit(0));
    }
  });
  return server;
}
