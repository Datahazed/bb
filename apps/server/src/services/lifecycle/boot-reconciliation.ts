/**
 * Boot reconciliation (plan §3, Decisions 1/2): the crash-durability story of
 * the in-memory lifecycle world. Runs synchronously after the database and
 * engine boot and BEFORE the server starts accepting requests, so no client
 * ever observes pre-reconciliation state. Nothing resumes; everything settles
 * cleanly:
 *
 * 1. Terminal sessions that were open are marked exited (the runtimes died
 *    with the old process).
 * 2. Threads that were `active` are interrupted with reason
 *    `server-restarted` (turn/completed{interrupted} on the open turn +
 *    system/thread/interrupted + status → idle), pending client turn
 *    requests settle canceled/provider_restarted, pending interactions are
 *    interrupted.
 * 3. Provisioning environments and threads fail with the standard
 *    thread_provisioning_failed events and a failed transcript entry — the
 *    in-memory provision context died with the process (accepted, plan R4).
 *    Stop-requested ones finalize instead (step 5).
 * 4. Environments stuck `destroying` are restored to ready|error;
 *    `cleanupRequestedAt` is preserved so the archive-cleanup sweep re-drives
 *    the destroy.
 * 5. Threads with `stopRequestedAt` set finalize — the user's stop completes
 *    via this pass since all runtimes are dead.
 * 6. Tombstoned (`deletedAt`) threads finalize: thread.deleted engine
 *    notification, hard delete, environment cleanup request.
 * 7. Detached kicks: cleanup advance for every cleanupRequestedAt candidate
 *    and the project-deletion drain.
 */
import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import {
  clientTurnRequests,
  environments,
  events,
  sweepManagedEnvironments,
  terminalSessions,
  threads,
  type DbConnection,
  type DbQueryConnection,
} from "@bb/db";
import { setEnvironmentStatus } from "@bb/db/internal-environment-lifecycle";
import {
  systemThreadProvisioningEventDataSchema,
  threadScope,
  type ProvisioningTranscriptEntry,
} from "@bb/domain";
import { NotificationBuffer } from "../lib/notification-buffer.js";
import {
  appendSystemErrorEventInTransaction,
  appendThreadProvisioningEventInTransaction,
} from "../threads/thread-events.js";
import { tryTransitionInTransaction } from "../threads/thread-transitions.js";
import type { EnvironmentLifecycle } from "./environment-lifecycle.js";
import type { ProjectLifecycle } from "./project-lifecycle.js";
import type { ThreadRuntimeLifecycle } from "./thread-runtime-lifecycle.js";
import type { LifecycleServiceDeps } from "./shared.js";

export interface BootReconciliationDeps {
  deps: LifecycleServiceDeps;
  environmentLifecycle: EnvironmentLifecycle;
  projectLifecycle: ProjectLifecycle;
  threadLifecycle: ThreadRuntimeLifecycle;
}

const BOOT_PROVISIONING_FAILURE_DETAIL =
  "Server restarted while the workspace was provisioning";

function buildBootProvisioningFailureEntry(): ProvisioningTranscriptEntry {
  return {
    type: "step",
    key: "workspace-failed",
    text: "Workspace setup failed",
    status: "failed",
    startedAt: Date.now(),
  };
}

/**
 * The crashed pipeline's in-memory provisioningId is gone; recover it from
 * the thread's latest provisioning event so the failure entry closes the
 * open transcript instead of rendering as a detached block.
 */
function latestProvisioningIdForThread(
  db: DbQueryConnection,
  threadId: string,
): string | null {
  const row = db
    .select({ data: events.data })
    .from(events)
    .where(
      and(
        eq(events.threadId, threadId),
        eq(events.type, "system/thread-provisioning"),
      ),
    )
    .orderBy(desc(events.sequence))
    .limit(1)
    .get();
  if (!row) {
    return null;
  }
  const parsed = systemThreadProvisioningEventDataSchema.safeParse(
    JSON.parse(row.data),
  );
  return parsed.success ? parsed.data.provisioningId : null;
}

function exitOpenTerminalSessions(db: DbConnection): number {
  const now = Date.now();
  return db
    .update(terminalSessions)
    .set({
      status: "exited",
      // The frozen wire value the engine shutdown already uses; an honest
      // 'server-restarted' enum value would have to clear the frozen FE zod
      // schema first (plan §4.2 dead-value rule).
      closeReason: "daemon-disconnect",
      updatedAt: now,
      exitedAt: now,
    })
    .where(
      inArray(terminalSessions.status, ["starting", "running", "disconnected"]),
    )
    .returning({ id: terminalSessions.id })
    .all().length;
}

function interruptActiveThreadsAtBoot(args: BootReconciliationDeps): number {
  const activeThreads = args.deps.db
    .select({
      environmentId: threads.environmentId,
      id: threads.id,
    })
    .from(threads)
    .where(
      and(
        eq(threads.status, "active"),
        isNull(threads.deletedAt),
        isNull(threads.stopRequestedAt),
      ),
    )
    .all();

  args.threadLifecycle.interruptActiveThreads({
    reason: "server-restarted",
    threads: activeThreads.map((thread) => ({
      environmentId: thread.environmentId,
      threadId: thread.id,
    })),
  });
  return activeThreads.length;
}

function failProvisioningAtBoot(args: BootReconciliationDeps): {
  environments: number;
  threads: number;
} {
  const { deps } = args;
  const notificationBuffer = new NotificationBuffer();
  const failureEntry = buildBootProvisioningFailureEntry();
  let failedEnvironments = 0;
  let failedThreads = 0;

  deps.db.transaction(
    (tx) => {
      const provisioningEnvironments = tx
        .select({ id: environments.id })
        .from(environments)
        .where(eq(environments.status, "provisioning"))
        .all();
      for (const environment of provisioningEnvironments) {
        setEnvironmentStatus(tx, notificationBuffer, environment.id, {
          status: "error",
        });
        failedEnvironments += 1;
      }

      // Every provisioning thread lost its in-memory pipeline with the crash;
      // stop-requested ones are finalized by the stop pass instead.
      const provisioningThreads = tx
        .select({
          environmentId: threads.environmentId,
          id: threads.id,
        })
        .from(threads)
        .where(
          and(
            eq(threads.status, "provisioning"),
            isNull(threads.deletedAt),
            isNull(threads.archivedAt),
            isNull(threads.stopRequestedAt),
          ),
        )
        .all();
      for (const thread of provisioningThreads) {
        const provisioningId = latestProvisioningIdForThread(tx, thread.id);
        if (thread.environmentId !== null && provisioningId !== null) {
          appendThreadProvisioningEventInTransaction(tx, {
            threadId: thread.id,
            environmentId: thread.environmentId,
            provisioningId,
            status: "failed",
            entries: [failureEntry],
          });
          notificationBuffer.notifyThread(thread.id, ["events-appended"], {
            eventTypes: ["system/thread-provisioning"],
          });
        }
        appendSystemErrorEventInTransaction(
          { db: tx, hub: notificationBuffer },
          {
            threadId: thread.id,
            environmentId: thread.environmentId,
            code: "thread_provisioning_failed",
            message: "Provisioning thread failed",
            detail: BOOT_PROVISIONING_FAILURE_DETAIL,
            scope: threadScope(),
          },
        );
        tryTransitionInTransaction(tx, notificationBuffer, thread.id, "error");
        failedThreads += 1;
      }
    },
    { behavior: "immediate" },
  );

  notificationBuffer.flushInto(deps.hub);
  return { environments: failedEnvironments, threads: failedThreads };
}

function restoreDestroyingEnvironments(args: BootReconciliationDeps): number {
  const { deps } = args;
  const notificationBuffer = new NotificationBuffer();
  let restored = 0;
  deps.db.transaction(
    (tx) => {
      const destroying = tx
        .select({ id: environments.id, path: environments.path })
        .from(environments)
        .where(eq(environments.status, "destroying"))
        .all();
      for (const environment of destroying) {
        // cleanupRequestedAt is preserved: the archive-cleanup sweep
        // re-drives the destroy once the workspace passes preflight again.
        setEnvironmentStatus(tx, notificationBuffer, environment.id, {
          status: environment.path ? "ready" : "error",
        });
        restored += 1;
      }
    },
    { behavior: "immediate" },
  );
  notificationBuffer.flushInto(deps.hub);
  return restored;
}

function finalizeStopRequestedThreads(args: BootReconciliationDeps): number {
  const stopRequested = args.deps.db
    .select({ id: threads.id })
    .from(threads)
    .where(and(isNotNull(threads.stopRequestedAt), isNull(threads.deletedAt)))
    .all();
  for (const thread of stopRequested) {
    args.threadLifecycle.finalizeStoppedThreadAndRequestCleanupAdvance({
      threadId: thread.id,
    });
  }
  return stopRequested.length;
}

function drainDeletedThreads(args: BootReconciliationDeps): number {
  const deleted = args.deps.db
    .select({ id: threads.id })
    .from(threads)
    .where(isNotNull(threads.deletedAt))
    .all();
  for (const thread of deleted) {
    args.threadLifecycle.finalizeStoppedThreadAndRequestCleanupAdvance({
      threadId: thread.id,
    });
  }
  return deleted.length;
}

/**
 * Any request still pending at boot can never be accepted — the dispatch that
 * would settle it died with the old process. Threads interrupted in step 2
 * already settled theirs; this catches the rest (e.g. starts dispatched for
 * threads that never went active).
 */
function settleDanglingClientTurnRequests(args: BootReconciliationDeps): number {
  const now = Date.now();
  return args.deps.db
    .update(clientTurnRequests)
    .set({
      message: "Server restarted before provider accepted the request",
      reasonCode: "provider_restarted",
      settledAt: now,
      status: "canceled",
    })
    .where(eq(clientTurnRequests.status, "pending"))
    .returning({ requestId: clientTurnRequests.requestId })
    .all().length;
}

function kickDetachedCleanup(args: BootReconciliationDeps): void {
  for (const environment of sweepManagedEnvironments(args.deps.db)) {
    args.environmentLifecycle.requestCleanupAdvance({
      environmentId: environment.id,
    });
  }
  for (const projectId of args.projectLifecycle.listProjectsPendingDeletion()) {
    args.projectLifecycle.requestDeletionAdvance({ projectId });
  }
}

export function runBootReconciliation(args: BootReconciliationDeps): void {
  const exitedTerminals = exitOpenTerminalSessions(args.deps.db);
  const interruptedThreads = interruptActiveThreadsAtBoot(args);
  const failedProvisioning = failProvisioningAtBoot(args);
  const restoredDestroying = restoreDestroyingEnvironments(args);
  const finalizedStops = finalizeStopRequestedThreads(args);
  const drainedDeleted = drainDeletedThreads(args);
  const settledRequests = settleDanglingClientTurnRequests(args);
  kickDetachedCleanup(args);

  args.deps.logger.info(
    {
      drainedDeletedThreads: drainedDeleted,
      exitedTerminalSessions: exitedTerminals,
      failedProvisioningEnvironments: failedProvisioning.environments,
      failedProvisioningThreads: failedProvisioning.threads,
      finalizedStopRequestedThreads: finalizedStops,
      interruptedActiveThreads: interruptedThreads,
      restoredDestroyingEnvironments: restoredDestroying,
      settledDanglingTurnRequests: settledRequests,
    },
    "Boot reconciliation complete",
  );
}
