/**
 * Shared types for engine command-result settlement (relocated in P1c from
 * the deleted daemon-ingress command-result-side-effects module — the settle*
 * owners and their deps survive the transport; the durable queue's
 * row/attempt gating did not).
 */
import type { DbNotifier, DbTransaction } from "@bb/db";
import type {
  HostDaemonCommand,
  HostDaemonCommandResultReport,
  HostDaemonCommandResultReportWithoutSession,
  HostDaemonDurableCommandType,
} from "../../engine/contract/commands.js";
import type { InteractiveLifecycleCoordinationDeps } from "../../lifecycle-coordination-deps.js";
import type { EngineDispatchBuffer } from "./engine-dispatch.js";
import type { AppDeps } from "../../types.js";

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

/**
 * The surviving slice of the dead durable-queue command row that settlement
 * still reads. The dispatcher fabricates it from its in-flight registry entry
 * (plan §6 Phase 1 settlement); dies with the op tables in Phase 2.
 */
export interface SettledEngineCommand {
  /** The dispatched command — the queue row's payload without the JSON round-trip. */
  command: HostDaemonCommand;
  /** Dispatch time (the queue row's `createdAt`); provisioning settlement derives duration metadata from it. */
  dispatchedAt: number;
  /** Always `LOCAL_HOST_ID`; forwarded into follow-up command staging that still carries hostId. */
  hostId: string;
  /** The dispatch-shim commandId threaded through op rows and `client_turn_requests`. */
  id: string;
}

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
