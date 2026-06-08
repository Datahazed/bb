import { performance } from "node:perf_hooks";
import {
  hostDaemonCommandResultSchemaByType,
  type HostDaemonCommand,
  type HostDaemonCommandResult,
  type HostDaemonDurableCommandType,
} from "@bb/host-daemon-contract";
import type { CommandResultWaiterResponse } from "../../internal/command-result-side-effects.js";
import type { AppDeps, LoggedWorkSessionDeps } from "../../types.js";
import { ApiError } from "../../errors.js";
import { roundDurationMs } from "../lib/duration.js";

export interface DispatchEngineCommandAndWaitArgs<
  TType extends HostDaemonDurableCommandType,
> {
  command: Extract<HostDaemonCommand, { type: TType }>;
  timeoutMs: number;
}

export interface WaitForDispatchedCommandResultArgs<
  TType extends HostDaemonDurableCommandType,
> {
  commandId: string;
  timeoutMs: number;
  type: TType;
}

type SlowCommandWaitOutcome =
  | "success"
  | "timeout"
  | "provider_error"
  | "result_type_mismatch"
  | "api_error"
  | "unknown_error";

interface LogSlowCommandWaitArgs {
  commandId: string;
  commandType: HostDaemonDurableCommandType;
  completed: boolean;
  durationMs: number;
  errorCode?: string;
  errorName?: string;
  outcome: SlowCommandWaitOutcome;
  status?: number;
}

interface SlowCommandWaitFailureLogFields {
  errorCode?: string;
  errorName?: string;
  outcome: Exclude<SlowCommandWaitOutcome, "success">;
  status?: number;
}

const SLOW_ENGINE_COMMAND_WAIT_LOG_THRESHOLD_MS = 1_000;

function logSlowCommandWait(
  deps: LoggedWorkSessionDeps,
  args: LogSlowCommandWaitArgs,
): void {
  if (args.durationMs < SLOW_ENGINE_COMMAND_WAIT_LOG_THRESHOLD_MS) {
    return;
  }
  deps.logger.debug(
    {
      commandId: args.commandId,
      commandType: args.commandType,
      completed: args.completed,
      durationMs: roundDurationMs(args.durationMs),
      ...(args.errorCode ? { errorCode: args.errorCode } : {}),
      ...(args.errorName ? { errorName: args.errorName } : {}),
      outcome: args.outcome,
      ...(args.status !== undefined ? { status: args.status } : {}),
    },
    "Slow engine command wait",
  );
}

function classifySlowCommandWaitFailure(
  error: unknown,
): SlowCommandWaitFailureLogFields {
  if (error instanceof ApiError) {
    const errorCode = error.body.code;
    if (errorCode === "command_timeout") {
      return {
        errorCode,
        outcome: "timeout",
        status: error.status,
      };
    }
    if (errorCode === "command_result_type_mismatch") {
      return {
        errorCode,
        outcome: "result_type_mismatch",
        status: error.status,
      };
    }
    if (error.status === 502) {
      return {
        errorCode,
        outcome: "provider_error",
        status: error.status,
      };
    }
    return {
      errorCode,
      outcome: "api_error",
      status: error.status,
    };
  }

  if (error instanceof Error) {
    return {
      errorName: error.name,
      outcome: "unknown_error",
    };
  }

  return {
    outcome: "unknown_error",
  };
}

/**
 * Dispatches one durable-type command into the engine and awaits its settled
 * result — the Phase 1 replacement for `queueCommand` + the durable queue's
 * result wait. The waiter registry and its 504/502 error taxonomy are
 * unchanged (plan §4.1: 504-on-long-op behavior preserved).
 */
export function dispatchEngineCommandAndWait<
  TType extends HostDaemonDurableCommandType,
>(
  deps: LoggedWorkSessionDeps,
  args: DispatchEngineCommandAndWaitArgs<TType>,
): Promise<HostDaemonCommandResult<TType>>;
export async function dispatchEngineCommandAndWait(
  deps: LoggedWorkSessionDeps,
  args: DispatchEngineCommandAndWaitArgs<HostDaemonDurableCommandType>,
): Promise<HostDaemonCommandResult> {
  const dispatched = deps.engineDispatch.dispatch({ command: args.command });

  const startedAt = performance.now();
  let logOutcome: SlowCommandWaitOutcome = "success";
  let completed = true;
  let failureLogFields: SlowCommandWaitFailureLogFields | null = null;
  try {
    return await waitForDispatchedCommandResult(deps, {
      commandId: dispatched.commandId,
      timeoutMs: args.timeoutMs,
      type: args.command.type,
    });
  } catch (error) {
    completed = false;
    failureLogFields = classifySlowCommandWaitFailure(error);
    logOutcome = failureLogFields.outcome;
    throw error;
  } finally {
    logSlowCommandWait(deps, {
      commandId: dispatched.commandId,
      commandType: args.command.type,
      completed,
      durationMs: performance.now() - startedAt,
      ...(failureLogFields?.errorCode
        ? { errorCode: failureLogFields.errorCode }
        : {}),
      ...(failureLogFields?.errorName
        ? { errorName: failureLogFields.errorName }
        : {}),
      outcome: logOutcome,
      ...(failureLogFields?.status !== undefined
        ? { status: failureLogFields.status }
        : {}),
    });
  }
}

export function waitForDispatchedCommandResult<
  TType extends HostDaemonDurableCommandType,
>(
  deps: Pick<AppDeps, "hub">,
  args: WaitForDispatchedCommandResultArgs<TType>,
): Promise<HostDaemonCommandResult<TType>>;
export async function waitForDispatchedCommandResult(
  deps: Pick<AppDeps, "hub">,
  args: WaitForDispatchedCommandResultArgs<HostDaemonDurableCommandType>,
): Promise<HostDaemonCommandResult> {
  let completed: CommandResultWaiterResponse;
  try {
    completed = await deps.hub.waitForCommandResult(
      args.commandId,
      args.timeoutMs,
    );
  } catch {
    throw new ApiError(
      504,
      "command_timeout",
      "Timed out waiting for command result",
    );
  }

  if (!completed.ok) {
    throw new ApiError(
      502,
      completed.errorCode ?? "provider_rpc_error",
      completed.errorMessage ?? "Command failed",
      false,
    );
  }

  if (completed.type !== args.type) {
    throw new ApiError(
      500,
      "command_result_type_mismatch",
      `Command ${args.commandId} completed with unexpected type ${completed.type}`,
    );
  }

  return hostDaemonCommandResultSchemaByType[args.type].parse(completed.result);
}
