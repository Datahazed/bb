import type {
  HostDaemonOnlineRpcCommand,
  HostDaemonOnlineRpcResultForCommand,
} from "@bb/host-daemon-contract";
import type {
  EngineCommandEnvelope,
  EngineCommandResultReport,
} from "../../src/engine/ports.js";
import type {
  EngineCommandDispatcher,
  EngineCommandRouting,
} from "../../src/services/engine/engine-dispatch.js";

type OnlineRpcHandler = (
  command: HostDaemonOnlineRpcCommand,
) => Promise<HostDaemonOnlineRpcResultForCommand>;

interface PendingEngineDispatch {
  envelope: EngineCommandEnvelope;
  release: () => void;
}

/**
 * An online RPC captured while no handler is bound: the command stays pending
 * (the caller's route awaits) until the test responds — the in-process
 * analogue of the daemon-era RPC capture socket, where `seedSession`
 * registered a capture and the test answered via `reportQueuedCommandSuccess`.
 */
export interface PendingOnlineRpc {
  command: HostDaemonOnlineRpcCommand;
  /** How many durable dispatches existed when this RPC was captured. */
  dispatchedCountAtCapture: number;
  /** Monotonic capture ordinal, unique per routing instance. */
  ordinal: number;
  respond(result: HostDaemonOnlineRpcResultForCommand): void;
  fail(error: Error): void;
}

/**
 * Fake engine routing for unit tests: records dispatched envelopes and keeps
 * them in flight (registry-visible) until the test settles or releases them —
 * the in-process analogue of the deleted daemon-WS/command-row test helpers.
 */
export class TestEngineRouting implements EngineCommandRouting {
  readonly dispatched: EngineCommandEnvelope[] = [];
  /** Captured online RPCs awaiting a test-provided response. */
  readonly pendingOnlineRpcs: PendingOnlineRpc[] = [];
  private readonly pending = new Map<string, PendingEngineDispatch>();
  private nextRpcOrdinal = 1;
  private onlineRpcHandler: OnlineRpcHandler | null = null;

  async handleCommands(commands: EngineCommandEnvelope[]): Promise<void> {
    await Promise.all(
      commands.map(
        (envelope) =>
          new Promise<void>((resolve) => {
            this.dispatched.push(envelope);
            this.pending.set(envelope.commandId, {
              envelope,
              release: resolve,
            });
          }),
      ),
    );
  }

  executeOnlineRpcCommand<TCommand extends HostDaemonOnlineRpcCommand>(
    command: TCommand,
  ): Promise<HostDaemonOnlineRpcResultForCommand<TCommand>> {
    const handler = this.onlineRpcHandler;
    if (handler) {
      return handler(command) as Promise<
        HostDaemonOnlineRpcResultForCommand<TCommand>
      >;
    }
    return new Promise((resolve, reject) => {
      const entry: PendingOnlineRpc = {
        command,
        dispatchedCountAtCapture: this.dispatched.length,
        ordinal: this.nextRpcOrdinal,
        respond: (result) => {
          this.removePendingOnlineRpc(entry);
          resolve(result as HostDaemonOnlineRpcResultForCommand<TCommand>);
        },
        fail: (error) => {
          this.removePendingOnlineRpc(entry);
          reject(error);
        },
      };
      this.nextRpcOrdinal += 1;
      this.pendingOnlineRpcs.push(entry);
    });
  }

  bindOnlineRpcHandler(handler: OnlineRpcHandler): void {
    this.onlineRpcHandler = handler;
  }

  /** Restores the default capture behavior for online RPCs. */
  unbindOnlineRpcHandler(): void {
    this.onlineRpcHandler = null;
  }

  getDispatched(commandId: string): EngineCommandEnvelope | null {
    return this.pending.get(commandId)?.envelope ?? null;
  }

  /**
   * Settles one in-flight dispatch through the dispatcher's settlement
   * transaction (owners registry + waiter resolution), then releases its
   * `handleCommands` promise so the registry entry clears — the same order
   * the real router guarantees.
   */
  async settle(
    dispatcher: EngineCommandDispatcher,
    report: EngineCommandResultReport,
  ): Promise<void> {
    const entry = this.pending.get(report.commandId);
    if (!entry) {
      throw new Error(`No in-flight dispatch for ${report.commandId}`);
    }
    await dispatcher.settleCommandResult(report);
    this.pending.delete(report.commandId);
    entry.release();
  }

  /** Releases a dispatch without settling (a command that dies unreported). */
  release(commandId: string): void {
    const entry = this.pending.get(commandId);
    if (!entry) {
      return;
    }
    this.pending.delete(commandId);
    entry.release();
  }

  releaseAll(): void {
    for (const commandId of [...this.pending.keys()]) {
      this.release(commandId);
    }
  }

  private removePendingOnlineRpc(entry: PendingOnlineRpc): void {
    const index = this.pendingOnlineRpcs.indexOf(entry);
    if (index >= 0) {
      this.pendingOnlineRpcs.splice(index, 1);
    }
  }
}
