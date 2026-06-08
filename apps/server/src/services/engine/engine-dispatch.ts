/**
 * The in-process engine command dispatcher: direct dispatch into the engine's
 * lane-scheduling `CommandRouter`, plus the in-memory in-flight registry the
 * cross-cutting product guards read (`hasInFlightThreadCommand` for manager
 * system messages and nudge/queued-message double-submit gates,
 * `hasInFlightThreadArchiveCommand` for archive forwarding dedupe,
 * `getInFlightEnvironmentCommandId` for cleanup-preflight dedupe).
 *
 * Lifecycle modules (plan §6 Phase 2) call `execute()` and settle the typed
 * result as a straight-line continuation; the command-result owners registry
 * keeps only the non-lifecycle entries (interactive.resolve,
 * workspace.commit/squash_merge).
 *
 * Registered entries are removed only after the router's report chain has
 * settled the result (`handleCommands` awaits result reporting), so a guard
 * can never observe work that is neither settled nor in flight.
 */
import { createHostDaemonCommandId } from "@bb/db";
import type {
  HostDaemonCommand,
  HostDaemonOnlineRpcCommand,
  HostDaemonOnlineRpcResultForCommand,
} from "../../engine/contract/commands.js";
import { COMMAND_RESULT_CACHE_TTL_MS } from "../../constants.js";
import type { CommandRouter } from "../../engine/core/command-router.js";
import type {
  EngineCommandEnvelope,
  EngineCommandResultReport,
} from "../../engine/ports.js";
import {
  buildCommandResultSettlementDeps,
  type CommandResultSideEffectReport,
  type CommandResultWaiterResponse,
  type SettledEngineCommand,
} from "./command-result-side-effects.js";
import {
  dispatchCommandResultPostCommitActions,
  handleCommandResultSideEffects,
} from "./command-results.js";
import type { AppDeps } from "../../types.js";
import { NotificationBuffer } from "../lib/notification-buffer.js";
import { LOCAL_HOST_ID } from "../hosts/local-host.js";

interface InFlightEngineCommand {
  command: HostDaemonCommand;
  commandId: string;
  dispatchedAt: number;
}

export interface DispatchEngineCommandArgs {
  command: HostDaemonCommand;
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
  private readonly staged: HostDaemonCommand[] = [];

  stage(args: DispatchEngineCommandArgs): void {
    this.staged.push(args.command);
  }

  flushInto(dispatcher: EngineCommandDispatcher): void {
    for (const command of this.staged) {
      dispatcher.dispatch({ command });
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

interface CommandResultWaiter {
  reject: (reason: Error) => void;
  resolve: (result: CommandResultWaiterResponse) => void;
  timeout: ReturnType<typeof setTimeout>;
}

/**
 * The settled outcome of an `execute()` call: the engine's raw result report
 * plus the dispatch timestamp (provisioning settlement derives transcript
 * duration metadata from it). Unlike `waitForResult`, execution never times
 * out — lifecycle work (e.g. a worktree clone + setup script) is bounded by
 * the engine's own timeouts, not the caller's.
 */
export interface ExecutedEngineCommand {
  dispatchedAt: number;
  report: EngineCommandResultReport;
}

interface ExecutionWaiter {
  reject: (reason: Error) => void;
  resolve: (outcome: ExecutedEngineCommand) => void;
}

export class EngineCommandDispatcher {
  private readonly inFlight = new Map<string, InFlightEngineCommand>();
  private readonly inFlightTasks = new Set<Promise<void>>();
  private readonly resultCache = new Map<string, CommandResultWaiterResponse>();
  private readonly resultWaiters = new Map<string, Set<CommandResultWaiter>>();
  private readonly executionWaiters = new Map<string, ExecutionWaiter>();
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
   * `waitForResult(commandId)`.
   */
  dispatch(args: DispatchEngineCommandArgs): EngineCommandDispatch {
    const { deps, router } = this.requireBound();
    const { command } = args;
    const commandId = createHostDaemonCommandId();
    this.inFlight.set(commandId, {
      command,
      commandId,
      dispatchedAt: Date.now(),
    });
    const envelope: EngineCommandEnvelope = {
      command,
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
            commandType: command.type,
            err: error,
          },
          "Engine command dispatch failed",
        );
      })
      .finally(() => {
        this.inFlight.delete(commandId);
        this.inFlightTasks.delete(task);
        // A settled command always resolved its execution waiter inside
        // `settleCommandResult`; a waiter still registered here means result
        // delivery failed and the report will never arrive — reject so the
        // awaiting lifecycle task does not hang forever.
        const executionWaiter = this.executionWaiters.get(commandId);
        if (executionWaiter) {
          this.executionWaiters.delete(commandId);
          executionWaiter.reject(
            new Error(
              `Engine command ${command.type} (${commandId}) settled without delivering a result`,
            ),
          );
        }
      });
    this.inFlightTasks.add(task);
    return { commandId };
  }

  /**
   * Dispatches one durable-type command and awaits its settled engine report
   * inline — the lifecycle modules' replacement for the command-result owners
   * registry (plan §6 Phase 2): the in-flight registry stays truthful for the
   * cross-cutting product guards while the caller settles the typed result as
   * a straight-line continuation.
   */
  execute(args: DispatchEngineCommandArgs): Promise<ExecutedEngineCommand> {
    return new Promise<ExecutedEngineCommand>((resolve, reject) => {
      // Waiter registration happens after dispatch but in the same
      // synchronous frame — settlement runs on a later microtask at the
      // earliest, so the waiter can never miss its result. Going through
      // `dispatch()` keeps it the single dispatch choke point (the
      // integration harness's recording dispatcher overrides it).
      const { commandId } = this.dispatch(args);
      this.executionWaiters.set(commandId, { reject, resolve });
    });
  }

  /**
   * Executes a read-style command inline against the engine and returns its
   * parsed result — the in-process replacement for the daemon's online
   * host-RPC WS request/response. Errors thrown by the handler propagate to
   * the caller (`services/engine/online-rpc.ts` maps them onto the existing
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
   * Awaits the settled result of a dispatched command — the in-process
   * replacement for the hub's command-result waiter registry (the daemon-WS
   * half of result delivery died in P1c). Recently settled results are served
   * from a TTL cache so a waiter that registers just after settlement still
   * resolves, matching the old hub semantics.
   */
  async waitForResult(
    commandId: string,
    timeoutMs: number,
  ): Promise<CommandResultWaiterResponse> {
    const cached = this.resultCache.get(commandId);
    if (cached !== undefined) {
      return cached;
    }

    return new Promise<CommandResultWaiterResponse>((resolve, reject) => {
      const waiter: CommandResultWaiter = {
        reject,
        resolve,
        timeout: setTimeout(() => {
          this.deleteResultWaiter(commandId, waiter);
          reject(new Error("Timed out waiting for command result"));
        }, timeoutMs),
      };
      const waiters =
        this.resultWaiters.get(commandId) ?? new Set<CommandResultWaiter>();
      waiters.add(waiter);
      this.resultWaiters.set(commandId, waiters);
    });
  }

  private deleteResultWaiter(
    commandId: string,
    waiter: CommandResultWaiter,
  ): void {
    const waiters = this.resultWaiters.get(commandId);
    if (!waiters) {
      return;
    }
    clearTimeout(waiter.timeout);
    waiters.delete(waiter);
    if (waiters.size === 0) {
      this.resultWaiters.delete(commandId);
    }
  }

  private recordResult(
    commandId: string,
    result: CommandResultWaiterResponse,
  ): void {
    this.resultCache.set(commandId, result);
    const expiry = setTimeout(() => {
      this.resultCache.delete(commandId);
    }, COMMAND_RESULT_CACHE_TTL_MS);
    expiry.unref();

    const waiters = this.resultWaiters.get(commandId);
    if (!waiters) {
      return;
    }
    for (const waiter of waiters) {
      clearTimeout(waiter.timeout);
      waiter.resolve(result);
    }
    this.resultWaiters.delete(commandId);
  }

  /**
   * The `DeliverCommandResult` port: a settlement transaction that fabricates
   * the `SettledEngineCommand` argument for the command-result owners
   * registry and the existing `settle*` functions, then resolves result
   * waiters — `handleCommandResult`'s row + attempt gating died with the
   * queue.
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

    const settledCommand: SettledEngineCommand = {
      command: entry.command,
      dispatchedAt: entry.dispatchedAt,
      hostId: LOCAL_HOST_ID,
      id: entry.commandId,
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
            settledCommand,
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
    this.recordResult(report.commandId, toWaiterResponse(report));
    const executionWaiter = this.executionWaiters.get(report.commandId);
    if (executionWaiter) {
      this.executionWaiters.delete(report.commandId);
      executionWaiter.resolve({
        dispatchedAt: entry.dispatchedAt,
        report,
      });
    }
    await dispatchCommandResultPostCommitActions({
      actions: sideEffects.postCommitActions,
      deps,
      // Detached (setImmediate), never inline: a post-commit action may
      // dispatch and wait on another engine command, and the router's report
      // chain is serialized — running it inline would deadlock settlement.
      mode: "detached",
      settledCommand,
    });
  }
}
