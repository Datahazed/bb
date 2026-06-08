import {
  listLiveThreadsInEnvironment,
  listUnarchivedAssignedChildThreads,
} from "@bb/db";
import type { Environment, Thread } from "@bb/domain";
import type { AppDeps } from "../../types.js";
import {
  pruneThreadEventHistoryBestEffort,
  resetActiveThreadEventPruningState,
} from "../system/event-pruning.js";
import { archiveThreadAndReleaseChildren } from "./thread-ownership.js";
import { requireThreadHostCommandEnvironment } from "./thread-command-environment.js";

interface ArchiveThreadWithLifecycleEffectsArgs {
  environment: {
    hostId: string;
    id: string;
  };
  thread: Pick<Thread, "environmentId" | "id" | "status" | "stopRequestedAt">;
}

interface ArchiveEnvironmentThreadsArgs {
  environment: Environment;
}

interface ArchiveManagerThreadsArgs {
  managerThread: Thread;
}

export function archiveThreadWithLifecycleEffects(
  deps: AppDeps,
  args: ArchiveThreadWithLifecycleEffectsArgs,
): Thread | null {
  const archivedThread = archiveThreadAndReleaseChildren(deps, {
    threadId: args.thread.id,
  });
  if (!archivedThread) {
    return null;
  }

  deps.terminalSessions.closeArchivedThreadTerminals({
    threadId: archivedThread.id,
  });
  // Archive only stops active runtime work; manual stop is the pre-start
  // provisioning cancellation entrypoint.
  deps.threadLifecycle.requestActiveRuntimeThreadStopIfNeeded(
    archivedThread,
    args.environment,
  );
  deps.threadLifecycle.queueSettledArchivedThreadProviderArchiveCommand({
    threadId: archivedThread.id,
  });
  resetActiveThreadEventPruningState(archivedThread.id);
  pruneThreadEventHistoryBestEffort(deps, {
    mode: "archived",
    threadId: archivedThread.id,
  });

  return archivedThread;
}

export function archiveEnvironmentThreads(
  deps: AppDeps,
  args: ArchiveEnvironmentThreadsArgs,
): string[] {
  const threads = listLiveThreadsInEnvironment(deps.db, {
    environmentId: args.environment.id,
  });
  const archivedThreadIds: string[] = [];

  for (const thread of threads) {
    const result = archiveThreadWithLifecycleEffects(deps, {
      environment: args.environment,
      thread,
    });
    if (!result) {
      continue;
    }
    archivedThreadIds.push(result.id);
  }

  if (
    archivedThreadIds.length > 0 &&
    deps.environmentLifecycle.wouldCleanup({
      environmentId: args.environment.id,
    })
  ) {
    deps.environmentLifecycle.requestCleanup({
      environmentId: args.environment.id,
    });
    deps.environmentLifecycle.requestCleanupAdvance({
      environmentId: args.environment.id,
    });
  }

  return archivedThreadIds;
}

export function archiveManagerThreads(
  deps: AppDeps,
  args: ArchiveManagerThreadsArgs,
): string[] {
  const childThreads = listUnarchivedAssignedChildThreads(deps.db, {
    parentThreadId: args.managerThread.id,
  });
  const threads: ArchiveThreadWithLifecycleEffectsArgs["thread"][] =
    childThreads.filter((thread) => thread.id !== args.managerThread.id);
  if (args.managerThread.archivedAt === null) {
    threads.push(args.managerThread);
  }
  const archivedThreadIds: string[] = [];
  const affectedEnvironmentIds = new Set<string>();

  for (const thread of threads) {
    const environment = requireThreadHostCommandEnvironment({
      db: deps.db,
      thread,
    });
    const result = archiveThreadWithLifecycleEffects(deps, {
      environment,
      thread,
    });
    if (!result) {
      continue;
    }
    archivedThreadIds.push(result.id);
    affectedEnvironmentIds.add(environment.id);
  }

  for (const environmentId of affectedEnvironmentIds) {
    if (
      deps.environmentLifecycle.wouldCleanup({
        environmentId,
      })
    ) {
      deps.environmentLifecycle.requestCleanup({ environmentId });
      deps.environmentLifecycle.requestCleanupAdvance({ environmentId });
    }
  }

  return archivedThreadIds;
}
