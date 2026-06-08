/**
 * The Phase 1 dispatch shim (plan §6 Phase 1): replaces the durable command
 * queue with direct in-process dispatch into the engine's lane-scheduling
 * `CommandRouter`, and replaces `handleCommandResult`'s stored-row +
 * active-attempt settlement with a transaction that fabricates the
 * `commandRow` argument for the command-result owners registry
 * (verification finding [phase1-feasibility]/settlement).
 *
 * Each dispatch's synthesized commandId is threaded through the surviving
 * op-row `'queued'` writes and `client_turn_requests`, and the in-memory
 * in-flight registry replaces the `getCommand`-state guards
 * (`hasQueuedThreadOperationCommand`, `hasQueuedProvisionCommand`,
 * `getThreadOperationCommandState`, the provision-cancel in-flight branch)
 * plus the cross-cutting product guards (`hasPendingHostCommandForThread`,
 * `hasExistingThreadArchiveCommand`, `getPendingEnvironmentCommand`) —
 * lookups by commandId, threadId+type, and environmentId+type (risk R9: the
 * registry is not optional scope; without it the 10s sweeps re-dispatch
 * in-flight provisions every tick).
 *
 * Registered entries are removed only after the router's report chain has
 * settled the result (`handleCommands` awaits result reporting), so a guard
 * can never observe an op row that is neither settled nor in flight.
 */
import { createHostDaemonCommandId, type HostDaemonCommandRow } from "@bb/db";
import type {
  HostDaemonCommand,
  HostDaemonOnlineRpcCommand,
  HostDaemonOnlineRpcResultForCommand,
} from "@bb/host-daemon-contract";
import type { CommandRouter } from "../../engine/core/command-router.js";
import type {
  EngineCommandEnvelope,
  EngineCommandResultReport,
} from "../../engine/ports.js";
import {
  buildCommandResultSettlementDeps,
  type CommandResultSideEffectReport,
  type CommandResultWaiterResponse,
} from "../../internal/command-result-side-effects.js";
import {
  dispatchCommandResultPostCommitActions,
  handleCommandResultSideEffects,
} from "../../internal/command-results.js";
import type { AppDeps } from "../../types.js";
import { NotificationBuffer } from "../lib/notification-buffer.js";
import { LOCAL_ENGINE_SESSION_ID, LOCAL_HOST_ID } from "../hosts/local-host.js";

interface InFlightEngineCommand {
  command: HostDaemonCommand;
  commandId: string;
  dispatchedAt: number;
}

export interface DispatchEngineCommandArgs {
  command: HostDaemonCommand;
  /**
   * Pre-synthesized command id (`createHostDaemonCommandId()`), for callers
   * that must durably thread the id (op-row `'queued'` writes,
   * `client_turn_requests`) *before* engine work can settle against it.
   * Omitted by callers with no durable bookkeeping; the dispatcher
   * synthesizes one.
   */
  commandId?: string;
}

export interface EngineCommandDispatch {
  commandId: string;
}

/**
 * The slice of `CommandRouter` the dispatcher drives. Production binds the
 * real router; unit tests bind a fake that records envelopes / answers RPCs
 * (the in-process analogue of the daemon-WS test helpers).
 */
export type EngineCommandRouting = Pick<
  CommandRouter,
  "executeOnlineRpcCommand" | "handleCommands"
>;

export interface BindEngineCommandDispatcherArgs {
  deps: AppDeps;
  router: EngineCommandRouting;
}

/**
 * The thread-scoped command types the cross-cutting product guards dedupe on
 * (the registry replacement for `hasPendingHostCommandForThread`'s
 * `json_extract($.threadId)` query).
 */
export type InFlightThreadCommandType =
  | "thread.archive"
  | "thread.stop"
  | "turn.submit";

export interface HasInFlightThreadCommandArgs {
  threadId: string;
  type: InFlightThreadCommandType;
}

export interface HasInFlightThreadArchiveCommandArgs {
  providerId: string;
  providerThreadId: string;
  threadId: string;
}

/**
 * The environment-scoped command types the cleanup/cancel guards dedupe on
 * (the registry replacement for `getPendingEnvironmentCommand` and
 * `hasActiveEnvironmentProvisionCancelCommand`).
 */
export type InFlightEnvironmentCommandType =
  | "environment.cleanup_preflight"
  | "environment.destroy"
  | "environment.provision.cancel";

export interface GetInFlightEnvironmentCommandIdArgs {
  environmentId: string;
  type: InFlightEnvironmentCommandType;
}

/**
 * Collects engine command dispatches staged inside a DB transaction so they
 * fire only after the transaction commits — the dispatch-shim replacement
 * for `queueCommandInTransaction` + post-commit `hub.notifyCommand`. A
 * rolled-back transaction simply discards the buffer, preserving the durable
 * queue's "rollback removes the command" semantics. Flush in the same
 * synchronous frame as the commit; nothing can interleave before the
 * registry registers the dispatch.
 */
export class EngineDispatchBuffer {
  private readonly staged: EngineCommandEnvelope[] = [];

  stage(args: Pick<DispatchEngineCommandArgs, "command">): void {
    this.staged.push({
      command: args.command,
      commandId: createHostDaemonCommandId(),
    });
  }

  flushInto(dispatcher: EngineCommandDispatcher): void {
    for (const envelope of this.staged) {
      dispatcher.dispatch(envelope);
    }
    this.staged.length = 0;
  }
}

type InFlightThreadCommand = Extract<
  HostDaemonCommand,
  { type: InFlightThreadCommandType }
>;

type InFlightEnvironmentCommand = Extract<
  HostDaemonCommand,
  { type: InFlightEnvironmentCommandType }
>;

function isThreadCommandOfType(
  command: HostDaemonCommand,
  type: InFlightThreadCommandType,
): command is InFlightThreadCommand {
  return command.type === type;
}

function isEnvironmentCommandOfType(
  command: HostDaemonCommand,
  type: InFlightEnvironmentCommandType,
): command is InFlightEnvironmentCommand {
  return command.type === type;
}

/**
 * `attemptId` is a durable-queue artifact the owners registry never reads;
 * the commandId doubles as the single in-process "attempt".
 */
function toSideEffectReport(
  report: EngineCommandResultReport,
): CommandResultSideEffectReport {
  return report.ok
    ? { ...report, attemptId: report.commandId }
    : { ...report, attemptId: report.commandId };
}

function toWaiterResponse(
  report: EngineCommandResultReport,
): CommandResultWaiterResponse {
  if (report.ok) {
    return {
      commandId: report.commandId,
      ok: true,
      result: report.result,
      type: report.type,
    };
  }
  return {
    commandId: report.commandId,
    errorCode: report.errorCode,
    errorMessage: report.errorMessage,
    ok: false,
    type: report.type,
  };
}

export class EngineCommandDispatcher {
  private readonly inFlight = new Map<string, InFlightEngineCommand>();
  private readonly inFlightTasks = new Set<Promise<void>>();
  private bound: BindEngineCommandDispatcherArgs | null = null;

  /**
   * Late-bound because the dispatcher sits on `AppDeps` (every guard and
   * call site reaches it there) while its own settlement needs the full
   * `AppDeps` and the engine's router — both of which exist only after boot
   * composition. Registry lookups work unbound (an unbooted engine has
   * nothing in flight); dispatch/settlement before `bind` is a boot-order
   * bug and throws.
   */
  bind(args: BindEngineCommandDispatcherArgs): void {
    this.bound = args;
  }

  private requireBound(): BindEngineCommandDispatcherArgs {
    if (!this.bound) {
      throw new Error("Engine command dispatcher is not bound to an engine");
    }
    return this.bound;
  }

  /**
   * Dispatches one durable-type command into the engine's lane scheduler.
   * Fire-and-forget, like the queue it replaces: the result settles through
   * `settleCommandResult`, and waiters observe it via
   * `hub.waitForCommandResult(commandId)` exactly as before.
   */
  dispatch(args: DispatchEngineCommandArgs): EngineCommandDispatch {
    const { deps, router } = this.requireBound();
    const commandId = args.commandId ?? createHostDaemonCommandId();
    this.inFlight.set(commandId, {
      command: args.command,
      commandId,
      dispatchedAt: Date.now(),
    });
    const envelope: EngineCommandEnvelope = {
      command: args.command,
      commandId,
    };
    const task: Promise<void> = router
      .handleCommands([envelope])
      .catch((error) => {
        // The router reports handler failures as error results; reaching this
        // catch means result *delivery* machinery failed — already logged and
        // queued for retry by the router itself.
        deps.logger.error(
          {
            commandId,
            commandType: args.command.type,
            err: error,
          },
          "Engine command dispatch failed",
        );
      })
      .finally(() => {
        this.inFlight.delete(commandId);
        this.inFlightTasks.delete(task);
      });
    this.inFlightTasks.add(task);
    return { commandId };
  }

  /**
   * Executes a read-style command inline against the engine and returns its
   * parsed result — the in-process replacement for the daemon's online
   * host-RPC WS request/response. Errors thrown by the handler propagate to
   * the caller (`services/hosts/online-rpc.ts` maps them onto the existing
   * 502/504 API error taxonomy).
   */
  executeOnlineRpc<TCommand extends HostDaemonOnlineRpcCommand>(
    command: TCommand,
  ): Promise<HostDaemonOnlineRpcResultForCommand<TCommand>> {
    return this.requireBound().router.executeOnlineRpcCommand(command);
  }

  /**
   * The registry replacement for the `getCommand` state guards: an in-flight
   * dispatch is the daemon-era `pending|fetched`; anything else has settled
   * (or never dispatched — indistinguishable in-process, and no guard needs
   * the distinction).
   */
  isCommandInFlight(commandId: string | null): boolean {
    return commandId !== null && this.inFlight.has(commandId);
  }

  hasInFlightThreadCommand(args: HasInFlightThreadCommandArgs): boolean {
    for (const entry of this.inFlight.values()) {
      if (
        isThreadCommandOfType(entry.command, args.type) &&
        entry.command.threadId === args.threadId
      ) {
        return true;
      }
    }
    return false;
  }

  hasInFlightThreadArchiveCommand(
    args: HasInFlightThreadArchiveCommandArgs,
  ): boolean {
    for (const entry of this.inFlight.values()) {
      if (
        entry.command.type === "thread.archive" &&
        entry.command.threadId === args.threadId &&
        entry.command.providerId === args.providerId &&
        entry.command.providerThreadId === args.providerThreadId
      ) {
        return true;
      }
    }
    return false;
  }

  getInFlightEnvironmentCommandId(
    args: GetInFlightEnvironmentCommandIdArgs,
  ): string | null {
    for (const entry of this.inFlight.values()) {
      if (
        isEnvironmentCommandOfType(entry.command, args.type) &&
        entry.command.environmentId === args.environmentId
      ) {
        return entry.commandId;
      }
    }
    return null;
  }

  /**
   * Resolves once every dispatched command has settled. The engine's
   * `shutdown()` does not await in-flight dispatches, so the boot wiring
   * drains here first — the in-process equivalent of the daemon's
   * `commandFetchLoop.stopAndDrain()` before killing runtimes.
   */
  async drain(): Promise<void> {
    while (this.inFlightTasks.size > 0) {
      await Promise.allSettled([...this.inFlightTasks]);
    }
  }

  /**
   * The `DeliverCommandResult` port: a settlement transaction that fabricates
   * the `HostDaemonCommandRow` argument for the command-result owners
   * registry and the existing `settle*` functions, then resolves waiters via
   * `hub.recordCommandResult` — `handleCommandResult`'s row + attempt gating
   * died with the queue.
   */
  async settleCommandResult(report: EngineCommandResultReport): Promise<void> {
    const { deps } = this.requireBound();
    const entry = this.inFlight.get(report.commandId);
    if (!entry) {
      // The daemon settlement's "missing" outcome: nothing to settle against.
      // The dispatcher is the only result producer, so this is a bug, not a
      // race — surface it loudly but do not wedge the router's report chain.
      deps.logger.error(
        {
          commandId: report.commandId,
          commandType: report.type,
          reportOk: report.ok,
        },
        "Engine reported a result for a command the dispatcher never dispatched",
      );
      return;
    }

    const commandRow: HostDaemonCommandRow = {
      id: entry.commandId,
      hostId: LOCAL_HOST_ID,
      sessionId: LOCAL_ENGINE_SESSION_ID,
      // Fetch-cursor ordering died with the queue; settlement never reads it.
      cursor: 0,
      type: entry.command.type,
      payload: JSON.stringify(entry.command),
      state: "fetched",
      retryCount: 0,
      resultPayload: null,
      createdAt: entry.dispatchedAt,
      fetchedAt: entry.dispatchedAt,
      completedAt: null,
    };
    const sideEffectReport = toSideEffectReport(report);
    const notificationBuffer = new NotificationBuffer();
    const engineDispatches = new EngineDispatchBuffer();
    let sideEffects;
    try {
      sideEffects = deps.db.transaction(
        (tx) => {
          const settlementDeps = buildCommandResultSettlementDeps({
            db: tx,
            deps,
            engineDispatches,
            hub: notificationBuffer,
          });
          return handleCommandResultSideEffects(
            settlementDeps,
            sideEffectReport,
            commandRow,
          );
        },
        { behavior: "immediate" },
      );
    } catch (error) {
      deps.logger.error(
        {
          commandId: report.commandId,
          err: error,
          reportOk: report.ok,
          reportType: report.type,
        },
        "Engine command result settlement transaction failed",
      );
      // Rethrow so the router queues the report for retry on the next
      // completion, as it did when result delivery to the server failed.
      throw error;
    }

    notificationBuffer.flushInto(deps.hub);
    // Follow-up commands staged by the settle* owners (rename-after-start,
    // thread.deleted, provision-cancel) — fire-and-forget dispatches, safe
    // inline; only result *waits* must stay out of the router's report chain.
    engineDispatches.flushInto(this);
    deps.hub.recordCommandResult(report.commandId, toWaiterResponse(report));
    await dispatchCommandResultPostCommitActions({
      actions: sideEffects.postCommitActions,
      command: commandRow,
      deps,
      // Detached (setImmediate), never inline: a post-commit action may
      // dispatch and wait on another engine command, and the router's report
      // chain is serialized — running it inline would deadlock settlement.
      mode: "schedule-after-daemon-ingress",
    });
  }
}
