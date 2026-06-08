/**
 * Read-style engine command execution — the Phase 1 replacement for the
 * daemon's online host-RPC WS round-trip (`hub.requestHostOnlineRpc`). The
 * engine runs the handler inline through the router's lane scheduler; the
 * 504 `command_timeout` taxonomy survives (plan §4.1), while the
 * `host_unavailable` retry ladder died with the transport — the engine is
 * always reachable in-process.
 */
import type {
  HostDaemonOnlineRpcCommand,
  HostDaemonOnlineRpcResultForCommand,
} from "../../engine/contract/commands.js";
import { getErrorCode } from "../../engine/core/command-dispatch.js";
import { ApiError } from "../../errors.js";
import type { WorkSessionDeps } from "../../types.js";

export interface CallEngineOnlineRpcArgs<
  TCommand extends HostDaemonOnlineRpcCommand,
> {
  command: TCommand;
  timeoutMs: number;
}

class EngineOnlineRpcTimeout {
  readonly kind = "engine-online-rpc-timeout";
}

function waitForTimeout(timeoutMs: number): {
  cancel: () => void;
  promise: Promise<EngineOnlineRpcTimeout>;
} {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<EngineOnlineRpcTimeout>((resolve) => {
    timer = setTimeout(() => resolve(new EngineOnlineRpcTimeout()), timeoutMs);
  });
  return {
    cancel: () => clearTimeout(timer),
    promise,
  };
}

export function callEngineOnlineRpc<
  TCommand extends HostDaemonOnlineRpcCommand,
>(
  deps: Pick<WorkSessionDeps, "engineDispatch">,
  args: CallEngineOnlineRpcArgs<TCommand>,
): Promise<HostDaemonOnlineRpcResultForCommand<TCommand>>;
export async function callEngineOnlineRpc(
  deps: Pick<WorkSessionDeps, "engineDispatch">,
  args: CallEngineOnlineRpcArgs<HostDaemonOnlineRpcCommand>,
): Promise<HostDaemonOnlineRpcResultForCommand> {
  const timeout = waitForTimeout(args.timeoutMs);
  try {
    // The in-process handler cannot be cancelled; on timeout it keeps running
    // detached, exactly as a daemon-side RPC kept running after the WS waiter
    // timed out.
    const outcome = await Promise.race([
      deps.engineDispatch.executeOnlineRpc(args.command),
      timeout.promise,
    ]);
    if (outcome instanceof EngineOnlineRpcTimeout) {
      throw new ApiError(
        504,
        "command_timeout",
        "Timed out waiting for command result",
      );
    }
    return outcome;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(
      502,
      getErrorCode(error),
      error instanceof Error ? error.message : String(error),
      false,
    );
  } finally {
    timeout.cancel();
  }
}
