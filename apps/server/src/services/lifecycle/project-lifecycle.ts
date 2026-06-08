/**
 * Project deletion drain (Phase 2 rewrite).
 *
 * Deletion intent is durable product state: `beginDeletion` stamps
 * `projects.deleteRequestedAt` (an internal column, never emitted on the
 * wire — the exact analog of the sanctioned `cleanupRequestedAt` pattern) and
 * tombstones every project thread in one transaction. The drain
 * (`advanceDeletion`) is re-entrant: it finalizes threads, requests + drives
 * managed environment cleanup, and deletes the project row + attachments once
 * nothing remains. The product sweep re-drives pending deletions across
 * restarts via `listProjectsPendingDeletion`; boot reconciliation kicks the
 * drain after a crash.
 */
import {
  deleteProject,
  getProject,
  listEnvironments,
  listProjectIdsWithDeleteRequested,
  markProjectDeleteRequested,
  markThreadDeleted,
  threads,
  type DbQueryConnection,
} from "@bb/db";
import { eq } from "drizzle-orm";
import type { Environment, ThreadStatus } from "@bb/domain";
import { deleteProjectAttachments } from "../projects/attachments.js";
import { NotificationBuffer } from "../lib/notification-buffer.js";
import { scheduleDetachedWork } from "../lib/detached-work.js";
import type { EnvironmentLifecycle } from "./environment-lifecycle.js";
import type { ThreadRuntimeLifecycle } from "./thread-runtime-lifecycle.js";
import type { LifecycleServiceDeps } from "./shared.js";

export interface ProjectDeletionArgs {
  projectId: string;
}

interface ProjectDeletionThread {
  deletedAt: number | null;
  environmentId: string | null;
  id: string;
  status: ThreadStatus;
  stopRequestedAt: number | null;
}

function listProjectDeletionThreads(
  db: DbQueryConnection,
  args: ProjectDeletionArgs,
): ProjectDeletionThread[] {
  return db
    .select({
      deletedAt: threads.deletedAt,
      environmentId: threads.environmentId,
      id: threads.id,
      status: threads.status,
      stopRequestedAt: threads.stopRequestedAt,
    })
    .from(threads)
    .where(eq(threads.projectId, args.projectId))
    .all();
}

function hasRemainingManagedEnvironments(environments: Environment[]): boolean {
  return environments.some(
    (environment) => environment.managed && environment.status !== "destroyed",
  );
}

export class ProjectLifecycle {
  constructor(
    private readonly deps: LifecycleServiceDeps,
    private readonly threadLifecycle: ThreadRuntimeLifecycle,
    private readonly environmentLifecycle: EnvironmentLifecycle,
  ) {}

  /**
   * Records durable deletion intent and tombstones every project thread in
   * one transaction, then stops active runtime threads. `advanceDeletion`
   * (request-driven and sweep-driven) owns the rest of the drain.
   */
  beginDeletion(args: ProjectDeletionArgs): void {
    if (!getProject(this.deps.db, args.projectId)) {
      return;
    }

    const projectEnvironments = listEnvironments(this.deps.db, args.projectId);
    const environmentsById = new Map(
      projectEnvironments.map((environment) => [environment.id, environment]),
    );

    const notificationBuffer = new NotificationBuffer();
    const projectThreads = this.deps.db.transaction(
      (tx) => {
        markProjectDeleteRequested(tx, { projectId: args.projectId });
        const threadsForDeletion = listProjectDeletionThreads(tx, args);
        for (const thread of threadsForDeletion) {
          if (thread.deletedAt === null) {
            markThreadDeleted(tx, notificationBuffer, { threadId: thread.id });
          }
        }
        return threadsForDeletion;
      },
      { behavior: "immediate" },
    );
    notificationBuffer.flushInto(this.deps.hub);

    for (const thread of projectThreads) {
      const environment = thread.environmentId
        ? (environmentsById.get(thread.environmentId) ?? null)
        : null;
      if (environment) {
        // Deletion finalization owns non-runtime cleanup; only active runtime
        // work needs an engine stop request here.
        this.threadLifecycle.requestActiveRuntimeThreadStopIfNeeded(
          thread,
          environment,
        );
      }
    }
  }

  requestDeletionAdvance(args: ProjectDeletionArgs): void {
    scheduleDetachedWork({
      config: this.deps.config,
      context: {
        projectId: args.projectId,
      },
      logger: this.deps.logger,
      name: "Project deletion advance request",
      work: async () => {
        await this.advanceDeletion(args);
      },
    });
  }

  /**
   * Re-entrant drain: marks remaining threads deleted, closes their
   * terminals, stops active runtime work, finalizes, drives managed
   * environment cleanup, and deletes the project once zero threads and zero
   * managed environments remain. Returns true when the project is gone.
   */
  async advanceDeletion(args: ProjectDeletionArgs): Promise<boolean> {
    const project = getProject(this.deps.db, args.projectId);
    if (!project) {
      return true;
    }
    if (project.deleteRequestedAt === null) {
      return false;
    }

    const projectEnvironments = listEnvironments(this.deps.db, args.projectId);
    const environmentsById = new Map(
      projectEnvironments.map((environment) => [environment.id, environment]),
    );
    const projectThreads = listProjectDeletionThreads(this.deps.db, {
      projectId: args.projectId,
    });
    for (const thread of projectThreads) {
      const environment = thread.environmentId
        ? (environmentsById.get(thread.environmentId) ?? null)
        : null;

      if (thread.deletedAt === null) {
        markThreadDeleted(this.deps.db, this.deps.hub, { threadId: thread.id });
      }
      this.deps.terminalSessions.closeDeletedThreadTerminals({
        threadId: thread.id,
      });
      if (environment) {
        this.threadLifecycle.requestActiveRuntimeThreadStopIfNeeded(
          thread,
          environment,
        );
      }
      this.threadLifecycle.finalizeStoppedThread({
        threadId: thread.id,
      });
    }

    for (const environment of projectEnvironments) {
      if (!environment.managed || environment.status === "destroyed") {
        continue;
      }

      this.environmentLifecycle.requestCleanup({
        environmentId: environment.id,
      });
      await this.environmentLifecycle.advanceCleanup({
        environmentId: environment.id,
      });
    }

    const refreshedEnvironments = listEnvironments(this.deps.db, args.projectId);
    if (
      this.hasRemainingProjectThreads(args.projectId) ||
      hasRemainingManagedEnvironments(refreshedEnvironments)
    ) {
      return false;
    }

    deleteProject(this.deps.db, this.deps.hub, args.projectId);
    await deleteProjectAttachments(this.deps.config.dataDir, args.projectId);
    return true;
  }

  listProjectsPendingDeletion(): string[] {
    return listProjectIdsWithDeleteRequested(this.deps.db);
  }

  private hasRemainingProjectThreads(projectId: string): boolean {
    return (
      this.deps.db
        .select({ id: threads.id })
        .from(threads)
        .where(eq(threads.projectId, projectId))
        .get() !== undefined
    );
  }
}
