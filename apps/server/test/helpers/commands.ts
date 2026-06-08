/**
 * Engine-seam observation and settlement helpers (plan §6 Phase 1): tests
 * observe commands the server dispatched into the in-process engine via
 * `harness.engineRouting` (which records envelopes and holds them in flight)
 * and settle them through the dispatcher's settlement transaction — the
 * replacement for polling `host_daemon_commands` rows and POSTing
 * `/internal/session/command-result`.
 *
 * The daemon-era names (`QueuedCommand`, `waitForQueuedCommand`,
 * `reportQueuedCommandSuccess`) survive so the ~40 consumer suites port
 * mechanically; the whole helper dies with the suites' Phase 2 rewrite.
 */
import { setTimeout as sleep } from "node:timers/promises";
import {
  hostDaemonCommandResultSchemaByType,
  hostDaemonCommandSchema,
  hostDaemonOnlineRpcResultSchemaByType,
} from "../../src/engine/contract/commands.js";
import type {
  HostDaemonCommand,
  HostDaemonCommandResultByType,
  HostDaemonOnlineRpcCommand,
  HostDaemonOnlineRpcResultByType,
  HostDaemonOnlineRpcResultForCommand,
} from "../../src/engine/contract/commands.js";
import type {
  EngineCommandResultReport,
  EngineCommandSuccessReport,
} from "../../src/engine/ports.js";
import {
  LOCAL_ENGINE_SESSION_ID,
  LOCAL_HOST_ID,
} from "../../src/services/hosts/local-host.js";
import type { PendingOnlineRpc } from "./test-engine-routing.js";
import type { TestAppHarness } from "./test-app.js";

type QueuedCommandPayload = HostDaemonCommand | HostDaemonOnlineRpcCommand;
type QueuedCommandResult<TCommand extends QueuedCommandPayload> =
  TCommand extends HostDaemonCommand
    ? HostDaemonCommandResultByType[TCommand["type"]]
    : TCommand extends HostDaemonOnlineRpcCommand
      ? HostDaemonOnlineRpcResultByType[TCommand["type"]]
      : never;

/**
 * The slim engine-seam stand-in for the durable `host_daemon_commands` row:
 * `id` is the dispatch's commandId, `cursor` the dispatch order (1-based),
 * host/session ids are the single-host constants, and `state` collapses the
 * daemon-era ladder to the two states that exist in-process — `"pending"`
 * while the dispatch is in flight (or the RPC is awaiting a response),
 * `"completed"` once settled.
 */
export interface QueuedCommandRow {
  cursor: number;
  hostId: string;
  id: string;
  sessionId: string;
  state: "completed" | "pending";
}

export interface QueuedCommand<
  TCommand extends QueuedCommandPayload = QueuedCommandPayload,
> {
  command: TCommand;
  row: QueuedCommandRow;
  /** Present for captured online RPCs (answered inline, never dispatched). */
  rpcRequest?: PendingOnlineRpc;
}

type ManagedWorktreeEnvironmentProvisionCommand = Extract<
  HostDaemonCommand,
  { type: "environment.provision"; workspaceProvisionType: "managed-worktree" }
>;

export type ManagedWorktreeEnvironmentProvisionQueuedCommand =
  QueuedCommand<ManagedWorktreeEnvironmentProvisionCommand>;

export function isManagedWorktreeEnvironmentProvisionQueuedCommand(
  queued: QueuedCommand,
): queued is ManagedWorktreeEnvironmentProvisionQueuedCommand {
  return (
    queued.command.type === "environment.provision" &&
    queued.command.workspaceProvisionType === "managed-worktree"
  );
}

export function requireManagedWorktreeEnvironmentProvisionQueuedCommand(
  queued: QueuedCommand,
): ManagedWorktreeEnvironmentProvisionQueuedCommand {
  if (isManagedWorktreeEnvironmentProvisionQueuedCommand(queued)) {
    return queued;
  }
  throw new Error("Expected managed-worktree environment.provision command");
}

function listDispatchedQueuedCommands(harness: TestAppHarness): QueuedCommand[] {
  const dispatched = harness.engineRouting.dispatched.map(
    (envelope, index): QueuedCommand => ({
      command: envelope.command,
      row: {
        cursor: index + 1,
        hostId: LOCAL_HOST_ID,
        id: envelope.commandId,
        sessionId: LOCAL_ENGINE_SESSION_ID,
        state: harness.engineRouting.getDispatched(envelope.commandId)
          ? "pending"
          : "completed",
      },
    }),
  );
  const capturedRpcs = harness.engineRouting.pendingOnlineRpcs.map(
    (pending): QueuedCommand => ({
      command: pending.command,
      row: {
        // Fractionally above the durable dispatches that existed at capture
        // time, mirroring the daemon-era test cursor for RPC requests.
        cursor: pending.dispatchedCountAtCapture + pending.ordinal * 0.0001,
        hostId: LOCAL_HOST_ID,
        id: `rpc-${pending.ordinal}`,
        sessionId: LOCAL_ENGINE_SESSION_ID,
        state: "pending",
      },
      rpcRequest: pending,
    }),
  );
  return [...dispatched, ...capturedRpcs];
}

export function listQueuedThreadCommands(
  harness: TestAppHarness,
  type: HostDaemonCommand["type"],
  threadId: string,
): HostDaemonCommand[] {
  return harness.engineRouting.dispatched
    .map((envelope) => envelope.command)
    .filter(
      (command) =>
        command.type === type &&
        "threadId" in command &&
        command.threadId === threadId,
    );
}

export function listQueuedEnvironmentCommands(
  harness: TestAppHarness,
  type: HostDaemonCommand["type"],
  environmentId: string,
): HostDaemonCommand[] {
  return harness.engineRouting.dispatched
    .map((envelope) => envelope.command)
    .filter(
      (command) =>
        command.type === type &&
        "environmentId" in command &&
        command.environmentId === environmentId,
    );
}

export async function waitForQueuedCommand(
  harness: TestAppHarness,
  predicate: (queued: QueuedCommand) => boolean,
  timeoutMs = 1_000,
): Promise<QueuedCommand> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const match = listDispatchedQueuedCommands(harness).find(predicate);
    if (match) {
      return match;
    }
    await sleep(10);
  }

  // Message pinned: consumer suites assert it to distinguish "command never
  // dispatched" from other failures.
  throw new Error("Timed out waiting for queued command");
}

export async function waitForQueuedCommandAfter(
  harness: TestAppHarness,
  afterCursor: number,
  predicate: (queued: QueuedCommand) => boolean,
  timeoutMs = 1_000,
): Promise<QueuedCommand> {
  return waitForQueuedCommand(
    harness,
    (queued) => queued.row.cursor > afterCursor && predicate(queued),
    timeoutMs,
  );
}

/**
 * The per-type result schemas guarantee the runtime type/result pairing;
 * TypeScript cannot correlate the parsed union member back into the report
 * union, hence the localized cast.
 */
function buildSuccessReport(
  commandId: string,
  command: HostDaemonCommand,
  result: unknown,
): EngineCommandResultReport {
  const parsed = hostDaemonCommandResultSchemaByType[command.type].parse(result);
  return {
    commandId,
    completedAt: Date.now(),
    type: command.type,
    ok: true,
    result: parsed,
  } as EngineCommandSuccessReport;
}

export async function reportQueuedCommandSuccess<
  TCommand extends QueuedCommandPayload,
>(
  harness: TestAppHarness,
  queued: QueuedCommand<TCommand>,
  result: QueuedCommandResult<TCommand>,
): Promise<Response> {
  if (queued.rpcRequest) {
    const parsedResult = hostDaemonOnlineRpcResultSchemaByType[
      queued.rpcRequest.command.type
    ].parse(result);
    queued.rpcRequest.respond(
      parsedResult as HostDaemonOnlineRpcResultForCommand,
    );
    return new Response(null, { status: 200 });
  }

  const durableCommand = hostDaemonCommandSchema.parse(queued.command);
  await harness.engineRouting.settle(
    harness.deps.engineDispatch,
    buildSuccessReport(queued.row.id, durableCommand, result),
  );
  return new Response(null, { status: 200 });
}

/**
 * Carries the daemon-era RPC error code through the engine seam:
 * `callEngineOnlineRpc` maps handler failures onto the 502 taxonomy via
 * `getErrorCode`, which reads a string `code` property.
 */
class TestOnlineRpcError extends Error {
  readonly code: string;

  constructor(args: { errorCode: string; errorMessage: string }) {
    super(args.errorMessage);
    this.code = args.errorCode;
  }
}

export async function reportQueuedCommandError(
  harness: TestAppHarness,
  queued: QueuedCommand,
  args: { errorCode: string; errorMessage: string },
): Promise<Response> {
  if (queued.rpcRequest) {
    queued.rpcRequest.fail(new TestOnlineRpcError(args));
    return new Response(null, { status: 200 });
  }

  const durableCommand = hostDaemonCommandSchema.parse(queued.command);
  await harness.engineRouting.settle(harness.deps.engineDispatch, {
    commandId: queued.row.id,
    completedAt: Date.now(),
    type: durableCommand.type,
    ok: false,
    errorCode: args.errorCode,
    errorMessage: args.errorMessage,
  });
  return new Response(null, { status: 200 });
}
