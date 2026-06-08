import { getThread } from "@bb/db";
import type { AppendStoredThreadEventArgs } from "@bb/db";
import type {
  ThreadEvent,
  ThreadEventScope,
  ThreadEventScopeKind,
  ThreadEventType,
} from "@bb/domain";
import type { LoggedPendingInteractionWorkSessionDeps } from "../../types.js";
import type { LoggableError } from "../lib/error-log-fields.js";
import { maybePruneActiveThreadEventHistory } from "../system/event-pruning.js";
import {
  applyEventEffects,
  notifyAppendedEventThreads,
  resolveActivePruneCandidates,
  resolveEventsToApply,
  runEventFollowUpBatchDetached,
} from "./event-append-effects.js";
import type { ThreadEventAppendInput } from "./event-append-effects.js";
import { appendThreadEventsInTransaction } from "./thread-events.js";

export type { ThreadEventAppendInput } from "./event-append-effects.js";

/**
 * The single-writer thread-event append module (plan §3 "event append
 * module", risk R5): the in-process replacement for both halves of the
 * daemon event transport —
 *
 * - the daemon spool (`apps/host-daemon/src/event-buffer.ts`): `emit` is the
 *   spool's `push` (one serialized FIFO append chain replaces `localOrder`
 *   global ordering), `flush` is the single barrier strength replacing both
 *   `flush` and `flushRequired` (the required-vs-debounced classification in
 *   `shouldFlushThreadEventImmediately` died with the batching);
 * - the daemon ingress route (`POST /internal/session/events`, deleted in
 *   P1c): each drain appends one batch in an
 *   immediate transaction via `appendThreadEventsInTransaction` (per-thread
 *   monotonic sequence assignment stays owned by `thread-events.ts`), then
 *   notifies the hub once per thread per batch and applies event effects.
 *
 * Deliberately NOT ported (they die with the transport): `producerEventId` +
 * payload-hash dedupe, host-ownership accept/reject batching, the durable
 * SQLite spool and restart re-send, zero-ack/fail-closed retry budgets, and
 * the ingress 409/503 retry ladder — in-process, a turn-scoped event emitted
 * before its `turn/started` is an engine bug and THROWS
 * (`TurnStartGuardError` from `assertStoredTurnStartedForEvents`, including
 * same-batch ordered satisfaction).
 *
 * The public surface is signature-compatible with the engine seam's
 * `ThreadEventSink` (`src/engine/ports.ts`) without importing it: P1b
 * constructs this appender and binds it behind that port; nothing in the
 * runtime reaches this module in P1a. Transcript-before-result ordering is
 * NOT this module's job — the engine's router awaits `flush()` before
 * delivering command results, registering interactive requests, and
 * forwarding tool calls.
 */
export interface ThreadEventAppender {
  /**
   * Enqueue one event onto the serialized append chain. Fire-and-forget;
   * synchronous bursts coalesce into one batch. Emit order is append order:
   * per-thread sequences are assigned in the order events were emitted, and a
   * `turn/started` emitted earlier in the same batch satisfies the turn-start
   * guard for later turn-scoped events.
   */
  emit(input: ThreadEventAppendInput): void;
  /**
   * Resolves once every previously emitted event's transaction has committed
   * and its event effects have been applied. Rejects if any covered batch
   * failed to append (plan R4/R5: append failures are loud — the failed
   * batch is dropped after logging, every in-flight flush waiter fails, and
   * subsequent emissions keep flowing).
   */
  flush(): Promise<void>;
}

interface FlushWaiter {
  drainId: number;
  reject(error: Error): void;
  resolve(): void;
}

interface AppendedThreadEventLogSummary {
  eventType: ThreadEventType;
  scopeKind: ThreadEventScopeKind;
  threadId: string;
}

interface ToAppendThreadEventArgsInput<TEvent extends ThreadEvent> {
  environmentId: string | null;
  event: TEvent;
}

interface AppendThreadEventArgsFromEvent<TEvent extends ThreadEvent> {
  data: Omit<TEvent, "scope" | "threadId" | "type">;
  environmentId: string | null;
  providerThreadId: string | null;
  scope: ThreadEventScope;
  threadId: string;
  type: TEvent["type"];
}

/**
 * Replaces the ingress `resolveProviderIdentifiers` switch: every event type
 * that carries a provider thread id exposes it as a `providerThreadId`
 * property, so the stored-column value is a plain property read.
 */
function resolveEventProviderThreadId(event: ThreadEvent): string | null {
  return "providerThreadId" in event ? (event.providerThreadId ?? null) : null;
}

// The generic implementation keeps `type` correlated with `data` while
// destructuring; the single public signature presents the result as the
// stored-args union for callers holding a plain `ThreadEvent` (same shape
// trick as `buildThreadEventRow` in `@bb/domain`).
function toAppendThreadEventArgs(
  args: ToAppendThreadEventArgsInput<ThreadEvent>,
): AppendStoredThreadEventArgs;
function toAppendThreadEventArgs<TEvent extends ThreadEvent>(
  args: ToAppendThreadEventArgsInput<TEvent>,
): AppendThreadEventArgsFromEvent<TEvent> {
  const { scope, threadId, type, ...data } = args.event;
  return {
    data,
    environmentId: args.environmentId,
    providerThreadId: resolveEventProviderThreadId(args.event),
    scope,
    threadId,
    type,
  };
}

function summarizeAppendInputs(
  inputs: readonly ThreadEventAppendInput[],
): AppendedThreadEventLogSummary[] {
  return inputs.map((input) => ({
    eventType: input.event.type,
    scopeKind: input.event.scope.kind,
    threadId: input.threadId,
  }));
}

function toAppendFailure(error: LoggableError): Error {
  return error instanceof Error
    ? error
    : new Error(`Thread event append failed: ${String(error)}`);
}

export function createThreadEventAppender(
  deps: LoggedPendingInteractionWorkSessionDeps,
): ThreadEventAppender {
  const pending: ThreadEventAppendInput[] = [];
  const flushWaiters = new Set<FlushWaiter>();
  // Serialized FIFO append chain — the in-process analogue of the spool's
  // `localOrder` global ordering. Drain outcomes are routed to flush waiters,
  // never rejected through the chain itself, so one failed batch cannot wedge
  // subsequent appends.
  let appendChain: Promise<void> = Promise.resolve();
  let drainScheduled = false;
  let lastScheduledDrainId = 0;
  let lastSettledDrainId = 0;

  function appendBatchInTransaction(
    batch: readonly ThreadEventAppendInput[],
  ): number[] {
    return deps.db.transaction(
      (tx) => {
        // Canonical environmentId stamping — the surviving half of the
        // ingress `resolvePostableEventBatchEntries` (its host-ownership
        // accept/reject half died with the transport).
        const environmentIdByThreadId = new Map<string, string | null>();
        const eventArgs = batch.map((input) => {
          let environmentId = environmentIdByThreadId.get(input.threadId);
          if (environmentId === undefined) {
            environmentId =
              getThread(tx, input.threadId)?.environmentId ?? null;
            environmentIdByThreadId.set(input.threadId, environmentId);
          }
          return toAppendThreadEventArgs({
            environmentId,
            event: input.event,
          });
        });
        return appendThreadEventsInTransaction(tx, eventArgs);
      },
      { behavior: "immediate" },
    );
  }

  async function drainPending(): Promise<void> {
    const batch = pending.splice(0);
    if (batch.length === 0) {
      return;
    }

    let sequences: number[];
    try {
      sequences = appendBatchInTransaction(batch);
    } catch (error) {
      // Plan R4/R5: never drop silently. The whole batch transaction rolled
      // back (the daemon batch behaved identically: one bad event failed the
      // whole POST), so log every dropped event before failing the waiters.
      deps.logger.error(
        {
          droppedEvents: summarizeAppendInputs(batch),
          err: error,
        },
        "Failed to append thread events; dropping batch and failing in-flight flush waiters",
      );
      throw error;
    }

    notifyAppendedEventThreads(deps, batch);

    const followUps = await applyEventEffects(
      deps,
      resolveEventsToApply(deps.db, batch),
    );
    for (const candidate of resolveActivePruneCandidates({
      inputs: batch,
      sequences,
    })) {
      maybePruneActiveThreadEventHistory(deps, candidate);
    }
    runEventFollowUpBatchDetached(deps, followUps);
  }

  function settleDrainSuccess(drainId: number): void {
    lastSettledDrainId = drainId;
    for (const waiter of flushWaiters) {
      if (waiter.drainId <= drainId) {
        flushWaiters.delete(waiter);
        waiter.resolve();
      }
    }
  }

  function settleDrainFailure(drainId: number, error: LoggableError): void {
    lastSettledDrainId = drainId;
    const failure = toAppendFailure(error);
    for (const waiter of flushWaiters) {
      flushWaiters.delete(waiter);
      waiter.reject(failure);
    }
  }

  function scheduleDrain(): void {
    if (drainScheduled) {
      return;
    }
    drainScheduled = true;
    lastScheduledDrainId += 1;
    const drainId = lastScheduledDrainId;
    appendChain = appendChain.then(async () => {
      drainScheduled = false;
      try {
        await drainPending();
        settleDrainSuccess(drainId);
      } catch (error) {
        settleDrainFailure(drainId, error);
      }
    });
  }

  function emit(input: ThreadEventAppendInput): void {
    if (input.event.threadId !== input.threadId) {
      // Ported from the spool's insert guard: a threadId mismatch is an
      // engine bug, surfaced at the emit boundary.
      throw new Error(
        "Emitted thread event threadId does not match payload threadId",
      );
    }
    pending.push(input);
    scheduleDrain();
  }

  function flush(): Promise<void> {
    if (lastScheduledDrainId === lastSettledDrainId && pending.length === 0) {
      return Promise.resolve();
    }
    const drainId = lastScheduledDrainId;
    return new Promise<void>((resolve, reject) => {
      flushWaiters.add({ drainId, reject, resolve });
    });
  }

  return { emit, flush };
}
