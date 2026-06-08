import { and, eq, sql } from "drizzle-orm";
import {
  archiveThread,
  getAutomation,
  getThread,
  listCompletedTurnsByThreadIds,
  events as storedEvents,
  updateThread,
} from "@bb/db";
import { requireThreadEventScopeTurnId } from "@bb/domain";
import type {
  ThreadEvent,
  ThreadEventTurnStatus,
  ThreadEventType,
  ThreadStatus,
} from "@bb/domain";
import type {
  AppDeps,
  LoggedPendingInteractionWorkSessionDeps,
} from "../../types.js";
import {
  isActivePruneTriggerThreadEventType,
  pruneThreadEventHistoryBestEffort,
  resetActiveThreadEventPruningState,
} from "../system/event-pruning.js";
import { syncManagerThreadSchedules } from "../scheduling/manager-schedule-sync.js";
import {
  isCommandTimeoutError,
  runtimeErrorLogFields,
} from "../lib/error-log-fields.js";
import { queueManagedThreadTurnNotificationBestEffort } from "./managed-thread-notifications.js";
import { runQueuedMessageAutoSendForThread } from "./queued-messages.js";
import { isPreStartThreadStatus } from "./thread-status.js";
import { tryTransition } from "./thread-transitions.js";

/**
 * Effect application for the in-process thread-event append path
 * (`event-append.ts`).
 *
 * Adapted from the daemon-ingress effect batch (the
 * `POST /internal/session/events` route, deleted with the transport in P1c) —
 * this is the sole effect-application path now.
 *
 * Adaptations vs the ingress originals:
 * - Inputs are plain `{threadId, event}` emissions. The spool envelope
 *   (`producerEventId`, payload-hash dedupe) and host-ownership accept/reject
 *   batching died with the transport, so every event in a batch is inserted
 *   and the inserted-index bookkeeping collapses. Only the
 *   turn-already-completed guard on `turn/started` effects survives in
 *   `resolveEventsToApply`.
 * - `deferEventFollowUpBatch`'s `scheduleDetachedWork` deferral
 *   becomes run-after-commit: `runEventFollowUpBatchDetached` fires once the
 *   append transaction has committed and effects have been applied, detached
 *   from the append chain so command waits inside follow-ups never stall
 *   event persistence.
 */

/**
 * One thread-event emission entering the in-process append path. Structurally
 * identical to the engine seam's `EngineThreadEventInput`
 * (`src/engine/ports.ts`) — kept separate so the engine stays unreachable
 * from `services/` until P1b binds the appender behind `ThreadEventSink`.
 */
export interface ThreadEventAppendInput {
  threadId: string;
  event: ThreadEvent;
}

interface ArchiveCompletedAutomationThreadIfNeededArgs {
  latestThread: NonNullable<ReturnType<typeof getThread>>;
  turnStatus: ThreadEventTurnStatus;
}

interface TurnKeyArgs {
  threadId: string;
  turnId: string;
}

interface HasThreadCommandFailureSystemErrorForTurnDeps {
  db: AppDeps["db"];
}

interface HasThreadCommandFailureSystemErrorForTurnArgs {
  threadId: string;
  turnId: string;
}

interface ShouldApplyEventEffectArgs {
  completedTurnKeyLookup: Set<string>;
  entry: ThreadEventAppendInput;
}

interface ManagerScheduleSyncFollowUp {
  kind: "manager-schedule-sync";
  threadId: string;
}

interface ManagerTurnNotificationFollowUp {
  kind: "manager-turn-notification";
  managedThreadId: string;
  managerThreadId: string;
  title: string | null;
  turnStatus: ThreadEventTurnStatus;
}

interface QueuedMessageAutoSendFollowUp {
  kind: "queued-message-auto-send";
  threadId: string;
}

export type EventEffectFollowUp =
  | ManagerScheduleSyncFollowUp
  | ManagerTurnNotificationFollowUp
  | QueuedMessageAutoSendFollowUp;

export interface ActivePruneCandidate {
  latestPrunableSequence: number;
  threadId: string;
}

interface ResolveActivePruneCandidatesArgs {
  inputs: readonly ThreadEventAppendInput[];
  sequences: readonly number[];
}

interface ApplyTurnCompletedEventResult {
  nextStatus: ThreadStatus | null;
  thread: ReturnType<typeof getThread>;
}

function toTurnKey(args: TurnKeyArgs): string {
  return `${args.threadId}:${args.turnId}`;
}

// Adopted from the deleted daemon-ingress `turn-completed-events.ts`;
// exported for the event-pruning regression tests.
export function applyTurnCompletedEvent(
  deps: Pick<AppDeps, "db" | "hub" | "logger">,
  payload: Extract<ThreadEvent, { type: "turn/completed" }>,
): ApplyTurnCompletedEventResult {
  const thread = getThread(deps.db, payload.threadId);
  if (!thread) {
    return { nextStatus: null, thread: null };
  }

  let nextStatus: ThreadStatus | null = null;
  if (payload.status === "failed") {
    if (thread.stopRequestedAt === null) {
      nextStatus = "error";
    }
  } else if (payload.status === "interrupted") {
    nextStatus = "idle";
  } else if (
    isPreStartThreadStatus(thread.status) ||
    thread.status === "active" ||
    thread.status === "error"
  ) {
    nextStatus = "idle";
  }

  try {
    if (nextStatus) {
      tryTransition(deps.db, deps.hub, payload.threadId, nextStatus);
    }
  } catch {
    // Ignore invalid transitions from concurrent changes.
  }

  if (nextStatus) {
    resetActiveThreadEventPruningState(payload.threadId);
  }

  if (nextStatus === "idle") {
    pruneThreadEventHistoryBestEffort(deps, {
      mode: "idle",
      threadId: payload.threadId,
    });
  }

  return { nextStatus, thread };
}

function hasThreadCommandFailureSystemErrorForTurn(
  deps: HasThreadCommandFailureSystemErrorForTurnDeps,
  args: HasThreadCommandFailureSystemErrorForTurnArgs,
): boolean {
  return (
    deps.db
      .select({ id: storedEvents.id })
      .from(storedEvents)
      .where(
        and(
          eq(storedEvents.threadId, args.threadId),
          eq(storedEvents.turnId, args.turnId),
          eq(storedEvents.scopeKind, "turn"),
          eq(storedEvents.type, "system/error"),
          sql`json_extract(${storedEvents.data}, '$.code') = 'thread_command_failed'`,
        ),
      )
      .limit(1)
      .get() !== undefined
  );
}

function listCompletedTurnKeysForStartedEvents(
  db: AppDeps["db"],
  inputs: readonly ThreadEventAppendInput[],
): Set<string> {
  const startedTurnKeys = new Set<string>();
  const threadIds = new Set<string>();

  for (const entry of inputs) {
    if (entry.event.type !== "turn/started") {
      continue;
    }
    startedTurnKeys.add(
      toTurnKey({
        threadId: entry.threadId,
        turnId: requireThreadEventScopeTurnId({
          type: entry.event.type,
          scope: entry.event.scope,
        }),
      }),
    );
    threadIds.add(entry.threadId);
  }

  if (startedTurnKeys.size === 0 || threadIds.size === 0) {
    return new Set<string>();
  }

  const completedTurnKeys = new Set<string>();
  for (const row of listCompletedTurnsByThreadIds(db, [...threadIds])) {
    const turnKey = toTurnKey({
      threadId: row.threadId,
      turnId: row.turnId,
    });
    if (startedTurnKeys.has(turnKey)) {
      completedTurnKeys.add(turnKey);
    }
  }
  return completedTurnKeys;
}

function shouldApplyEventEffect(args: ShouldApplyEventEffectArgs): boolean {
  const { entry } = args;

  // A `turn/started` re-emitted for an already-completed turn must not flip
  // the thread back to active (the ingress original additionally gated
  // `turn/completed` on producer-id dedupe, which has no in-process analogue:
  // every batch event is inserted).
  if (entry.event.type === "turn/started") {
    return !args.completedTurnKeyLookup.has(
      toTurnKey({
        threadId: entry.threadId,
        turnId: requireThreadEventScopeTurnId({
          type: entry.event.type,
          scope: entry.event.scope,
        }),
      }),
    );
  }

  return true;
}

export function resolveEventsToApply(
  db: AppDeps["db"],
  inputs: readonly ThreadEventAppendInput[],
): ThreadEventAppendInput[] {
  const completedTurnKeyLookup = listCompletedTurnKeysForStartedEvents(
    db,
    inputs,
  );

  return inputs.filter((entry) =>
    shouldApplyEventEffect({
      completedTurnKeyLookup,
      entry,
    }),
  );
}

async function archiveCompletedAutomationThreadIfNeeded(
  deps: Pick<
    AppDeps,
    "db" | "engineDispatch" | "environmentLifecycle" | "hub" | "threadLifecycle"
  >,
  args: ArchiveCompletedAutomationThreadIfNeededArgs,
): Promise<void> {
  if (args.turnStatus !== "completed" || !args.latestThread.automationId) {
    return;
  }

  const automation = getAutomation(deps.db, args.latestThread.automationId);
  if (automation?.autoArchive) {
    const shouldRequestCleanup = deps.environmentLifecycle.wouldCleanup({
      environmentId: args.latestThread.environmentId,
      ...(args.latestThread.id ? { excludeThreadId: args.latestThread.id } : {}),
    });
    const archivedThread = archiveThread(
      deps.db,
      deps.hub,
      args.latestThread.id,
    );
    if (!archivedThread) {
      return;
    }
    deps.threadLifecycle.queueSettledArchivedThreadProviderArchiveCommand({
      threadId: archivedThread.id,
    });
    if (shouldRequestCleanup) {
      deps.environmentLifecycle.requestCleanup({
        environmentId: args.latestThread.environmentId,
      });
    }
  }
}

export async function applyEventEffects(
  deps: LoggedPendingInteractionWorkSessionDeps,
  inputs: readonly ThreadEventAppendInput[],
): Promise<EventEffectFollowUp[]> {
  // Apply event-owned state changes before the append barrier resolves so
  // appended events and immediately visible thread state agree. Follow-ups
  // that may queue further engine work stay out of the append chain
  // (`runEventFollowUpBatchDetached`).
  const followUps: EventEffectFollowUp[] = [];
  for (const entry of inputs) {
    try {
      const event = entry.event;
      if (event.type === "turn/started") {
        const thread = getThread(deps.db, entry.threadId);
        if (!thread) {
          continue;
        }
        if (thread.stopRequestedAt !== null) {
          continue;
        }
        if (
          isPreStartThreadStatus(thread.status) ||
          thread.status === "idle" ||
          thread.status === "error"
        ) {
          tryTransition(deps.db, deps.hub, thread.id, "active");
        }
        continue;
      }

      if (event.type === "turn/completed") {
        const turnCompleted = applyTurnCompletedEvent(deps, event);
        if (turnCompleted.thread?.parentThreadId) {
          // Command-result failures already notify managers for failed turns
          // without terminal events; late terminal events still own status
          // effects.
          const alreadyHandledByCommandFailure =
            event.status === "failed" &&
            hasThreadCommandFailureSystemErrorForTurn(deps, {
              threadId: turnCompleted.thread.id,
              turnId: requireThreadEventScopeTurnId({
                type: event.type,
                scope: event.scope,
              }),
            });
          if (!alreadyHandledByCommandFailure) {
            followUps.push({
              kind: "manager-turn-notification",
              managedThreadId: turnCompleted.thread.id,
              managerThreadId: turnCompleted.thread.parentThreadId,
              turnStatus: event.status,
              title: turnCompleted.thread.title,
            });
          }
        }
        if (event.status === "completed") {
          followUps.push({
            kind: "queued-message-auto-send",
            threadId: entry.threadId,
          });
        }
        if (turnCompleted.nextStatus === "idle" && turnCompleted.thread) {
          const latestThread = getThread(deps.db, turnCompleted.thread.id);
          if (latestThread?.status === "idle") {
            if (latestThread.type === "manager") {
              followUps.push({
                kind: "manager-schedule-sync",
                threadId: latestThread.id,
              });
            }
            await archiveCompletedAutomationThreadIfNeeded(deps, {
              latestThread,
              turnStatus: event.status,
            });
          }
        }
        continue;
      }

      if (
        event.type === "system/error" &&
        event.code === "provider_process_exited"
      ) {
        const thread = getThread(deps.db, entry.threadId);
        if (!thread) {
          continue;
        }
        deps.pendingInteractions.interruptPendingInteractionsForThreadIds({
          threadIds: [entry.threadId],
          reason:
            "Provider process exited while awaiting user interaction; retry the thread to continue",
        });
        if (thread.stopRequestedAt !== null) {
          continue;
        }
        tryTransition(deps.db, deps.hub, entry.threadId, "error");
        continue;
      }

      if (event.type === "thread/name/updated") {
        updateThread(deps.db, deps.hub, entry.threadId, {
          title: event.threadName,
        });
      }
    } catch (error) {
      deps.logger.error(
        {
          err: error,
          eventType: entry.event.type,
          threadId: entry.threadId,
        },
        "Failed to apply event side effects",
      );
    }
  }
  return followUps;
}

async function executeEventFollowUpBestEffort(
  deps: LoggedPendingInteractionWorkSessionDeps,
  followUp: EventEffectFollowUp,
): Promise<void> {
  try {
    switch (followUp.kind) {
      case "manager-schedule-sync":
        await syncManagerThreadSchedules(deps, {
          threadId: followUp.threadId,
        });
        return;
      case "manager-turn-notification":
        await queueManagedThreadTurnNotificationBestEffort(deps, {
          managedThreadId: followUp.managedThreadId,
          managerThreadId: followUp.managerThreadId,
          turnStatus: followUp.turnStatus,
          title: followUp.title,
        });
        return;
      case "queued-message-auto-send":
        await runQueuedMessageAutoSendForThread(deps, {
          threadId: followUp.threadId,
        });
        return;
    }
  } catch (error) {
    if (isCommandTimeoutError(error)) {
      deps.logger.warn(
        {
          followUp,
          ...runtimeErrorLogFields(deps.config, error),
        },
        "Event follow-up deferred by host timeout",
      );
      return;
    }
    deps.logger.error(
      {
        err: error,
        followUp,
      },
      "Failed to run event follow-up",
    );
  }
}

/**
 * Run-after-commit replacement for the ingress `deferEventFollowUpBatch` +
 * `scheduleDetachedWork`: by the time this is called the append
 * transaction has committed and effects have been applied, so the follow-ups
 * (which may wait on engine commands) run detached from the append chain.
 * `executeEventFollowUpBestEffort` never rejects.
 */
export function runEventFollowUpBatchDetached(
  deps: LoggedPendingInteractionWorkSessionDeps,
  followUps: readonly EventEffectFollowUp[],
): void {
  if (followUps.length === 0) {
    return;
  }

  void Promise.all(
    followUps.map((followUp) => executeEventFollowUpBestEffort(deps, followUp)),
  );
}

export function resolveActivePruneCandidates(
  args: ResolveActivePruneCandidatesArgs,
): ActivePruneCandidate[] {
  const latestPrunableSequenceByThreadId = new Map<string, number>();

  for (const [index, input] of args.inputs.entries()) {
    if (!isActivePruneTriggerThreadEventType(input.event.type)) {
      continue;
    }
    const sequence = args.sequences[index];
    if (sequence === undefined) {
      throw new Error("Missing appended event sequence for prune candidate");
    }

    const previousSequence = latestPrunableSequenceByThreadId.get(
      input.threadId,
    );
    if (previousSequence === undefined || sequence > previousSequence) {
      latestPrunableSequenceByThreadId.set(input.threadId, sequence);
    }
  }

  return [...latestPrunableSequenceByThreadId.entries()].map(
    ([threadId, latestPrunableSequence]) => ({
      threadId,
      latestPrunableSequence,
    }),
  );
}

export function notifyAppendedEventThreads(
  deps: Pick<AppDeps, "hub">,
  inputs: readonly ThreadEventAppendInput[],
): void {
  const eventTypesByThreadId = new Map<string, Set<ThreadEventType>>();
  for (const input of inputs) {
    const eventTypes =
      eventTypesByThreadId.get(input.threadId) ?? new Set<ThreadEventType>();
    eventTypes.add(input.event.type);
    eventTypesByThreadId.set(input.threadId, eventTypes);
  }
  for (const [threadId, eventTypes] of eventTypesByThreadId) {
    deps.hub.notifyThread(threadId, ["events-appended"], {
      eventTypes: Array.from(eventTypes),
    });
  }
}
