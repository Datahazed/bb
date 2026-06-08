import type { DbNotifier, DbTransaction } from "@bb/db";
import type {
  HostDaemonCommand,
  HostDaemonCommandResultReport,
  HostDaemonCommandResultReportWithoutSession,
  HostDaemonDurableCommandType,
} from "@bb/host-daemon-contract";
import type { InteractiveLifecycleCoordinationDeps } from "../lifecycle-coordination-deps.js";
import type { EngineDispatchBuffer } from "../services/engine/engine-dispatch.js";
import type { AppDeps } from "../types.js";

type SuccessfulCommandResultReport = Extract<
  HostDaemonCommandResultReport,
  { ok: true }
>;
type FailedCommandResultReport = Extract<
  HostDaemonCommandResultReport,
  { ok: false }
>;

interface CommandResultSuccessWaiterResponse {
  commandId: string;
  ok: true;
  result: SuccessfulCommandResultReport["result"];
  type: SuccessfulCommandResultReport["type"];
}

interface CommandResultFailureWaiterResponse {
  commandId: string;
  errorCode: FailedCommandResultReport["errorCode"];
  errorMessage: string;
  ok: false;
  type: string;
}

export type CommandResultWaiterResponse =
  | CommandResultSuccessWaiterResponse
  | CommandResultFailureWaiterResponse;

export type CommandResultSideEffectsDeps =
  InteractiveLifecycleCoordinationDeps & Pick<AppDeps, "terminalSessions">;

export type CommandResultSettlementDeps = Omit<
  CommandResultSideEffectsDeps,
  "db" | "hub"
> & {
  db: DbTransaction;
  /**
   * Follow-up engine command dispatches staged by settle* owners inside the
   * settlement transaction; the settlement wrapper flushes the buffer into
   * the dispatcher after commit (Phase 1 dispatch shim).
   */
  engineDispatches: EngineDispatchBuffer;
  hub: DbNotifier;
};

export type CommandResultSideEffectReport =
  HostDaemonCommandResultReportWithoutSession;

export type HostDaemonCommandForType<
  TType extends HostDaemonDurableCommandType,
> = Extract<HostDaemonCommand, { type: TType }>;

export type CommandResultReportForType<
  TType extends HostDaemonDurableCommandType,
> = Extract<HostDaemonCommandResultReportWithoutSession, { type: TType }>;

export type CommandResultFailureReportForType<
  TType extends HostDaemonDurableCommandType,
> = Extract<CommandResultReportForType<TType>, { ok: false }>;

interface CommandResultPostCommitActionContext {
  environmentId?: string | null;
  hostId?: string;
  threadId?: string;
}

export interface CommandResultPostCommitAction {
  context?: CommandResultPostCommitActionContext;
  name: string;
  run(deps: CommandResultSideEffectsDeps): Promise<void> | void;
}

export interface CommandResultSideEffectsResult {
  postCommitActions: CommandResultPostCommitAction[];
}

interface BuildCommandResultSettlementDepsArgs {
  db: DbTransaction;
  deps: CommandResultSideEffectsDeps;
  engineDispatches: EngineDispatchBuffer;
  hub: DbNotifier;
}

export function buildCommandResultSettlementDeps(
  args: BuildCommandResultSettlementDepsArgs,
): CommandResultSettlementDeps {
  return {
    ...args.deps,
    db: args.db,
    engineDispatches: args.engineDispatches,
    hub: args.hub,
  };
}

export function emptyCommandResultSideEffects(): CommandResultSideEffectsResult {
  return { postCommitActions: [] };
}
