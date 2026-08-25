import type { ThreadEvent } from "@bb/domain";
import { requireThreadEventScopeTurnId } from "@bb/domain";

interface PendingActiveTurnWaiter {
  resolve: (turnId: string | null) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface WaitForActiveTurnStateArgs {
  threadId: string;
  timeoutMs: number;
  /** Aborting it ends the wait with `null` and drops the waiter. */
  signal?: AbortSignal;
}

/**
 * Tracks the active turn per thread from observed turn lifecycle events and
 * lets callers await the next `turn/started` observation. Waiters resolve with
 * the turn id in the same tick `observe()` records it, with `null` on timeout,
 * with `null` when the thread goes idle (`clearThread`/`clear`), with `null`
 * when the runtime reports that the start they were waiting on ended without
 * a turn (`releaseWaiters`), and with `null` when the caller's own signal
 * aborts, so no caller ever has to poll this state, sit out its timeout on a
 * start that already failed, or keep waiting after its reason to wait is
 * gone.
 */
export class RuntimeTurnState {
  private readonly activeTurnIdByThreadId = new Map<string, string>();
  private readonly activeTurnWaitersByThreadId = new Map<
    string,
    Set<PendingActiveTurnWaiter>
  >();

  clear(): void {
    this.activeTurnIdByThreadId.clear();
    for (const threadId of [...this.activeTurnWaitersByThreadId.keys()]) {
      this.resolveWaiters(threadId, null);
    }
  }

  clearThread(threadId: string): void {
    this.activeTurnIdByThreadId.delete(threadId);
    this.resolveWaiters(threadId, null);
  }

  /**
   * Resolves every pending waiter for the thread with `null` and clears
   * their timers, leaving the active-turn record alone. The runtime calls
   * this when a pending start ends without a `turn/started` (the bridge
   * refused it, or reported a provider error before the turn opened): the
   * waiter is waiting on that start, and nothing later will resolve it.
   */
  releaseWaiters(threadId: string): void {
    this.resolveWaiters(threadId, null);
  }

  getActiveTurnId(threadId: string): string | null {
    return this.activeTurnIdByThreadId.get(threadId) ?? null;
  }

  getActiveThreadIds(): string[] {
    return [...this.activeTurnIdByThreadId.keys()];
  }

  waitForActiveTurn(args: WaitForActiveTurnStateArgs): Promise<string | null> {
    const activeTurnId = this.activeTurnIdByThreadId.get(args.threadId);
    if (activeTurnId !== undefined) {
      return Promise.resolve(activeTurnId);
    }
    if (args.signal?.aborted) {
      return Promise.resolve(null);
    }

    return new Promise((resolve) => {
      const waiters =
        this.activeTurnWaitersByThreadId.get(args.threadId) ??
        new Set<PendingActiveTurnWaiter>();
      this.activeTurnWaitersByThreadId.set(args.threadId, waiters);
      const waiter: PendingActiveTurnWaiter = {
        resolve: (turnId) => {
          args.signal?.removeEventListener("abort", abort);
          resolve(turnId);
        },
        timeout: setTimeout(() => {
          this.dropWaiter(args.threadId, waiter);
          waiter.resolve(null);
        }, args.timeoutMs),
      };
      const abort = (): void => {
        clearTimeout(waiter.timeout);
        this.dropWaiter(args.threadId, waiter);
        waiter.resolve(null);
      };
      args.signal?.addEventListener("abort", abort, { once: true });
      waiters.add(waiter);
    });
  }

  observe(event: ThreadEvent): void {
    if (event.type === "turn/started") {
      if (event.parentToolCallId) {
        return;
      }
      const turnId = requireThreadEventScopeTurnId({
        type: event.type,
        scope: event.scope,
      });
      this.activeTurnIdByThreadId.set(event.threadId, turnId);
      this.resolveWaiters(event.threadId, turnId);
      return;
    }

    if (event.type === "turn/completed") {
      const turnId = requireThreadEventScopeTurnId({
        type: event.type,
        scope: event.scope,
      });
      if (this.activeTurnIdByThreadId.get(event.threadId) === turnId) {
        this.activeTurnIdByThreadId.delete(event.threadId);
      }
    }
  }

  private dropWaiter(threadId: string, waiter: PendingActiveTurnWaiter): void {
    const waiters = this.activeTurnWaitersByThreadId.get(threadId);
    if (!waiters) {
      return;
    }
    waiters.delete(waiter);
    if (waiters.size === 0) {
      this.activeTurnWaitersByThreadId.delete(threadId);
    }
  }

  private resolveWaiters(threadId: string, turnId: string | null): void {
    const waiters = this.activeTurnWaitersByThreadId.get(threadId);
    if (!waiters) {
      return;
    }
    this.activeTurnWaitersByThreadId.delete(threadId);
    for (const waiter of waiters) {
      clearTimeout(waiter.timeout);
      waiter.resolve(turnId);
    }
  }
}
