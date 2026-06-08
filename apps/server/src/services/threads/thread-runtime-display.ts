import {
  getEnvironment,
  type DbConnection,
  type ThreadWithPendingInteractionState,
} from "@bb/db";
import type {
  Thread,
  ThreadListEntry,
  ThreadRuntimeState,
  ThreadStatus,
  ThreadWithRuntime,
} from "@bb/domain";

interface ThreadRuntimeDisplayDeps {
  db: DbConnection;
}

interface ResolveThreadRuntimeStateArgs {
  environmentHostId: string | null;
  now?: number;
  status: ThreadStatus;
}

interface ToThreadResponseFromThreadArgs {
  now?: number;
  thread: Thread;
}

interface ToThreadResponseWithHostArgs extends ToThreadResponseFromThreadArgs {
  environmentHostId: string | null;
}

interface ToThreadListEntryResponsesArgs {
  now?: number;
  threads: readonly ThreadWithPendingInteractionState[];
}

function threadStatusRuntimeState(status: ThreadStatus): ThreadRuntimeState {
  switch (status) {
    case "created":
    case "provisioning":
    case "idle":
    case "active":
    case "error":
      return {
        displayStatus: status,
        hostReconnectGraceExpiresAt: null,
      };
  }
}

function toPublicThread(thread: Thread): Thread {
  return {
    id: thread.id,
    projectId: thread.projectId,
    environmentId: thread.environmentId,
    automationId: thread.automationId,
    providerId: thread.providerId,
    type: thread.type,
    title: thread.title,
    titleFallback: thread.titleFallback,
    status: thread.status,
    parentThreadId: thread.parentThreadId,
    archivedAt: thread.archivedAt,
    pinnedAt: thread.pinnedAt,
    stopRequestedAt: thread.stopRequestedAt,
    deletedAt: thread.deletedAt,
    lastReadAt: thread.lastReadAt,
    latestAttentionAt: thread.latestAttentionAt,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
  };
}

/**
 * Single-host runtime display: the engine runs in-process, so a thread's
 * runtime state is its status. The daemon-session-derived
 * `host-reconnecting`/`waiting-for-host` values stay in the domain types as
 * dead wire values (plan §4.2 dead-value rule) but are never emitted.
 */
export function resolveThreadRuntimeState(
  _deps: ThreadRuntimeDisplayDeps,
  args: ResolveThreadRuntimeStateArgs,
): ThreadRuntimeState {
  return threadStatusRuntimeState(args.status);
}

function resolveThreadEnvironmentHostId(
  deps: ThreadRuntimeDisplayDeps,
  thread: Thread,
): string | null {
  if (thread.environmentId === null) {
    return null;
  }
  return getEnvironment(deps.db, thread.environmentId)?.hostId ?? null;
}

export function toThreadResponseWithHost(
  deps: ThreadRuntimeDisplayDeps,
  args: ToThreadResponseWithHostArgs,
): ThreadWithRuntime {
  const thread = toPublicThread(args.thread);
  return {
    ...thread,
    runtime: resolveThreadRuntimeState(deps, {
      environmentHostId: args.environmentHostId,
      now: args.now,
      status: thread.status,
    }),
  };
}

export function toThreadResponseFromThread(
  deps: ThreadRuntimeDisplayDeps,
  args: ToThreadResponseFromThreadArgs,
): ThreadWithRuntime {
  return toThreadResponseWithHost(deps, {
    ...args,
    environmentHostId: resolveThreadEnvironmentHostId(deps, args.thread),
  });
}

export function toThreadListEntryResponses(
  deps: ThreadRuntimeDisplayDeps,
  args: ToThreadListEntryResponsesArgs,
): ThreadListEntry[] {
  return args.threads.map((entry) => {
    const thread = toPublicThread(entry);
    return {
      ...thread,
      pinSortKey: entry.pinSortKey,
      environmentBranchName: entry.environmentBranchName,
      environmentHostId: entry.environmentHostId,
      environmentWorkspaceDisplayKind: entry.environmentWorkspaceDisplayKind,
      hasPendingInteraction: entry.hasPendingInteraction,
      runtime: resolveThreadRuntimeState(deps, {
        environmentHostId: entry.environmentHostId,
        now: args.now,
        status: thread.status,
      }),
    };
  });
}
