import type { HostDaemonCommand } from "@bb/host-daemon-contract";
import {
  EngineCommandDispatcher,
  type DispatchEngineCommandArgs,
  type EngineCommandDispatch,
} from "../../../apps/server/src/services/engine/engine-dispatch.js";

export interface DispatchedEngineCommand {
  command: HostDaemonCommand;
  commandId: string;
}

/**
 * The harness's dispatch observation seam: records every durable-type
 * command the server dispatches into the in-process engine, in dispatch
 * order — the replacement for reading `host_daemon_commands` rows now that
 * the durable queue is cold (single-host rebuild plan §6 Phase 1).
 * Settlement is observable through the dispatcher's own in-flight registry
 * (`isCommandInFlight`).
 */
export class RecordingEngineCommandDispatcher extends EngineCommandDispatcher {
  readonly dispatched: DispatchedEngineCommand[] = [];

  override dispatch(args: DispatchEngineCommandArgs): EngineCommandDispatch {
    const result = super.dispatch(args);
    this.dispatched.push({
      command: args.command,
      commandId: result.commandId,
    });
    return result;
  }
}

export function countDispatchedCommandsByType(
  dispatcher: RecordingEngineCommandDispatcher,
  type: HostDaemonCommand["type"],
): number {
  return dispatcher.dispatched.filter((entry) => entry.command.type === type)
    .length;
}
