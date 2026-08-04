import {
  ensureEnvironmentStatusSnapshotRows,
  getEnvironment,
  getEnvironmentGitStatusSnapshot,
  getEnvironmentPullRequestStatusSnapshot,
  getLatestSessionForHost,
  getSessionById,
  listActiveBackgroundTaskCountsByThreadIds,
  listLatestGoalEventRowsByThreadIds,
  listLatestSessionsForHosts,
  listOpenTurnInputAcceptedRowsByThreadIds,
  listStoredClientTurnRequestRowsByKeys,
  markEnvironmentStatusSnapshotsDue,
  type DbConnection,
  type HostDaemonSessionRow,
  type StoredEventRow,
  type ThreadClientTurnRequestKey,
  type ThreadWithPendingInteractionState,
} from "@bb/db";
import {
  threadEnvironmentGitStatusSnapshotSchema,
  threadPullRequestSchema,
} from "@bb/domain";
import type {
  Thread,
  ThreadActivityState,
  ThreadEnvironmentGitStatusSignal,
  ThreadEnvironmentPullRequestStatusSignal,
  ThreadEnvironmentStatusSummary,
  ThreadListEntry,
  ThreadRuntimeState,
  ThreadStatus,
  ThreadWithRuntime,
} from "@bb/domain";
import {
  extractThreadTimelineActivePlanTurn,
  extractThreadTimelineGoal,
  type ThreadEventWithMeta,
} from "@bb/thread-view";
import type { ThreadResponse } from "@bb/server-contract";
import { DAEMON_ACTIVE_WORK_DISCONNECT_GRACE_MS } from "../../constants.js";
import type { NotificationHub } from "../../ws/hub.js";
import { parseStoredEvent } from "./thread-data.js";
import { canThreadSpawnChild } from "./thread-parent.js";

type ThreadRuntimeDisplayHub = Pick<
  NotificationHub,
  "getDaemonSessionIdForHost"
>;

interface ThreadRuntimeDisplayDeps {
  db: DbConnection;
  hub: ThreadRuntimeDisplayHub;
}

interface ResolveThreadRuntimeStateArgs {
  environmentHostId: string | null;
  now?: number;
  status: ThreadStatus;
}

interface ResolveThreadRuntimeStateFromLatestSessionArgs {
  environmentHostId: string | null;
  hostConnected: boolean;
  latestSession: HostDaemonSessionRow | null;
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

interface ToThreadListEntryResponseFromLatestSessionArgs {
  activity: ThreadActivityState;
  hostConnected: boolean;
  latestSession: HostDaemonSessionRow | null;
  now?: number;
  thread: ThreadWithPendingInteractionState;
}

interface PromptBannerActivityState extends Pick<
  ThreadActivityState,
  "activeGoalCount" | "activePlanModeCount"
> {
  activePlanTurnId: string | null;
}

const EMPTY_THREAD_ACTIVITY: ThreadActivityState = {
  activeBackgroundAgentCount: 0,
  activeBackgroundCommandCount: 0,
  activeGoalCount: 0,
  activePlanModeCount: 0,
  activeWorkflowCount: 0,
};

interface ThreadEnvironmentStatusSnapshotFields {
  environmentId: string | null;
  gitStatusSnapshotJson: string | null;
  gitStatusSnapshotErrorCode: string | null;
  gitStatusSnapshotErrorMessage: string | null;
  gitStatusSnapshotRefreshedAt: number | null;
  gitStatusSnapshotStatus: string | null;
  pullRequestStatusSnapshotJson: string | null;
  pullRequestStatusSnapshotErrorCode: string | null;
  pullRequestStatusSnapshotErrorMessage: string | null;
  pullRequestStatusSnapshotRefreshedAt: number | null;
  pullRequestStatusSnapshotStatus: string | null;
  updatedAt: number;
}

type SnapshotStatus =
  | "available"
  | "not_applicable"
  | "pending"
  | "unavailable";

function threadStatusRuntimeState(status: ThreadStatus): ThreadRuntimeState {
  switch (status) {
    case "starting":
    case "idle":
    case "active":
    case "stopping":
    case "error":
      return {
        displayStatus: status,
        hostReconnectGraceExpiresAt: null,
      };
  }
}

/**
 * Only computed for `active` threads: an active turn survives a daemon
 * disconnect until the active-work grace elapses, so that is the reconnect
 * window the DTO advertises. The shorter DAEMON_DISCONNECT_GRACE_MS window
 * only settles pending interactions and background tasks.
 */
function getDaemonDisconnectGraceExpiresAt(
  session: HostDaemonSessionRow,
): number | null {
  if (session.status !== "closed") {
    return null;
  }
  if (session.closeReason !== "daemon-disconnect") {
    return null;
  }
  if (session.closedAt === null) {
    return null;
  }
  return session.closedAt + DAEMON_ACTIVE_WORK_DISCONNECT_GRACE_MS;
}

function hasOpenDaemonSessionForHost(
  deps: ThreadRuntimeDisplayDeps,
  hostId: string,
): boolean {
  const sessionId = deps.hub.getDaemonSessionIdForHost(hostId);
  if (!sessionId) {
    return false;
  }
  const session = getSessionById(deps.db, { sessionId });
  return session?.hostId === hostId && session.status === "active";
}

function toPublicThread(thread: Thread): Thread {
  return {
    id: thread.id,
    projectId: thread.projectId,
    environmentId: thread.environmentId,
    providerId: thread.providerId,
    title: thread.title,
    titleFallback: thread.titleFallback,
    sectionId: thread.sectionId,
    status: thread.status,
    parentThreadId: thread.parentThreadId,
    sourceThreadId: thread.sourceThreadId,
    originKind: thread.originKind,
    childOrigin: thread.originKind ?? thread.childOrigin,
    originPluginId: thread.originPluginId,
    visibility: thread.visibility,
    archivedAt: thread.archivedAt,
    pinnedAt: thread.pinnedAt,
    deletedAt: thread.deletedAt,
    lastReadAt: thread.lastReadAt,
    latestAttentionAt: thread.latestAttentionAt,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
  };
}

export function resolveThreadRuntimeState(
  deps: ThreadRuntimeDisplayDeps,
  args: ResolveThreadRuntimeStateArgs,
): ThreadRuntimeState {
  if (args.status !== "active" || args.environmentHostId === null) {
    return threadStatusRuntimeState(args.status);
  }

  const hostConnected = hasOpenDaemonSessionForHost(
    deps,
    args.environmentHostId,
  );
  const latestSession = hostConnected
    ? null
    : getLatestSessionForHost(deps.db, {
        hostId: args.environmentHostId,
      });
  return resolveThreadRuntimeStateFromLatestSession({
    environmentHostId: args.environmentHostId,
    hostConnected,
    latestSession,
    now: args.now,
    status: args.status,
  });
}

function resolveThreadRuntimeStateFromLatestSession(
  args: ResolveThreadRuntimeStateFromLatestSessionArgs,
): ThreadRuntimeState {
  if (args.status !== "active" || args.environmentHostId === null) {
    return threadStatusRuntimeState(args.status);
  }

  if (args.hostConnected) {
    return threadStatusRuntimeState("active");
  }

  const now = args.now ?? Date.now();
  const latestSession = args.latestSession;
  if (latestSession) {
    const graceExpiresAt = getDaemonDisconnectGraceExpiresAt(latestSession);
    if (graceExpiresAt !== null && graceExpiresAt > now) {
      return {
        displayStatus: "host-reconnecting",
        hostReconnectGraceExpiresAt: graceExpiresAt,
      };
    }
  }

  return {
    displayStatus: "waiting-for-host",
    hostReconnectGraceExpiresAt: null,
  };
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
): ThreadResponse {
  const threadWithRuntime = toThreadResponseWithHost(deps, {
    ...args,
    environmentHostId: resolveThreadEnvironmentHostId(deps, args.thread),
  });
  return {
    ...threadWithRuntime,
    canSpawnChild: canThreadSpawnChild(deps, { thread: args.thread }),
    environmentStatusSummary: resolveThreadEnvironmentStatusSummaryForThread(
      deps,
      args,
    ),
  };
}

function toThreadEventWithMeta(row: StoredEventRow): ThreadEventWithMeta {
  return {
    event: parseStoredEvent(row),
    meta: {
      id: row.id,
      seq: row.sequence,
      createdAt: row.createdAt,
    },
  };
}

function getThreadPromptBannerActivityState(
  thread: Thread,
  events: readonly ThreadEventWithMeta[],
): PromptBannerActivityState {
  const activePlanTurn = extractThreadTimelineActivePlanTurn({
    events,
    providerId: thread.providerId,
    threadStatus: thread.status,
  });
  const goal = extractThreadTimelineGoal(events);

  return {
    activeGoalCount: goal?.status === "active" ? 1 : 0,
    activePlanModeCount: activePlanTurn === null ? 0 : 1,
    activePlanTurnId: activePlanTurn?.turnId ?? null,
  };
}

function canThreadShowActivePlanMode(thread: Thread): boolean {
  return (
    thread.status === "active" &&
    (thread.providerId === "claude-code" || thread.providerId === "codex")
  );
}

function listPromptBannerActivityCandidateRows(
  deps: ThreadRuntimeDisplayDeps,
  threads: readonly Thread[],
): StoredEventRow[] {
  const latestGoalRows = listLatestGoalEventRowsByThreadIds(deps.db, {
    threadIds: threads.map((thread) => thread.id),
  });
  const openAcceptedRows = listOpenTurnInputAcceptedRowsByThreadIds(deps.db, {
    threadIds: threads
      .filter((thread) => canThreadShowActivePlanMode(thread))
      .map((thread) => thread.id),
  });
  const openAcceptedEvents = openAcceptedRows.map(toThreadEventWithMeta);
  const requestKeys: ThreadClientTurnRequestKey[] = openAcceptedEvents.flatMap(
    ({ event }) =>
      event.type === "turn/input/accepted"
        ? [{ requestId: event.clientRequestId, threadId: event.threadId }]
        : [],
  );
  const requestRows = listStoredClientTurnRequestRowsByKeys(deps.db, {
    keys: requestKeys,
  });

  return [...latestGoalRows, ...openAcceptedRows, ...requestRows].sort(
    (left, right) =>
      left.threadId.localeCompare(right.threadId) ||
      left.sequence - right.sequence,
  );
}

function buildThreadPromptBannerActivityByThreadId(
  deps: ThreadRuntimeDisplayDeps,
  threads: readonly Thread[],
): Map<string, PromptBannerActivityState> {
  const rows = listPromptBannerActivityCandidateRows(deps, threads);
  const eventsByThreadId = new Map<string, ThreadEventWithMeta[]>();
  for (const row of rows) {
    const threadEvents = eventsByThreadId.get(row.threadId);
    const event = toThreadEventWithMeta(row);
    if (threadEvents) {
      threadEvents.push(event);
    } else {
      eventsByThreadId.set(row.threadId, [event]);
    }
  }

  const result = new Map<string, PromptBannerActivityState>();
  for (const thread of threads) {
    const activity = getThreadPromptBannerActivityState(
      thread,
      eventsByThreadId.get(thread.id) ?? [],
    );
    if (activity.activeGoalCount > 0 || activity.activePlanModeCount > 0) {
      result.set(thread.id, activity);
    }
  }
  return result;
}

export function getThreadPromptBannerActivity(
  deps: ThreadRuntimeDisplayDeps,
  thread: Thread,
): PromptBannerActivityState {
  return (
    buildThreadPromptBannerActivityByThreadId(deps, [thread]).get(
      thread.id,
    ) ?? {
      activeGoalCount: 0,
      activePlanModeCount: 0,
      activePlanTurnId: null,
    }
  );
}

export function toThreadListEntryResponses(
  deps: ThreadRuntimeDisplayDeps,
  args: ToThreadListEntryResponsesArgs,
): ThreadListEntry[] {
  ensureSnapshotRowsForThreadListDemand(deps, args);
  const backgroundTaskActivityByThreadId = new Map(
    listActiveBackgroundTaskCountsByThreadIds(deps.db, {
      threadIds: args.threads.map((thread) => thread.id),
    }).map((activity) => [activity.threadId, activity]),
  );
  const promptBannerActivityByThreadId =
    buildThreadPromptBannerActivityByThreadId(deps, args.threads);
  const activeHostIds = [
    ...new Set(
      args.threads.flatMap((thread) =>
        thread.status === "active" && thread.environmentHostId !== null
          ? [thread.environmentHostId]
          : [],
      ),
    ),
  ];
  const connectedActiveHostIds = new Set(
    activeHostIds.filter((hostId) => hasOpenDaemonSessionForHost(deps, hostId)),
  );
  const latestSessionByHostId = new Map(
    listLatestSessionsForHosts(deps.db, {
      hostIds: activeHostIds.filter(
        (hostId) => !connectedActiveHostIds.has(hostId),
      ),
    }).map((session) => [session.hostId, session]),
  );

  return args.threads.map((thread) => {
    const backgroundActivity = backgroundTaskActivityByThreadId.get(thread.id);
    const promptBannerActivity = promptBannerActivityByThreadId.get(thread.id);
    return toThreadListEntryResponseFromLatestSession({
      activity: {
        activeBackgroundAgentCount:
          backgroundActivity?.activeBackgroundAgentCount ??
          EMPTY_THREAD_ACTIVITY.activeBackgroundAgentCount,
        activeBackgroundCommandCount:
          backgroundActivity?.activeBackgroundCommandCount ??
          EMPTY_THREAD_ACTIVITY.activeBackgroundCommandCount,
        activeGoalCount:
          promptBannerActivity?.activeGoalCount ??
          EMPTY_THREAD_ACTIVITY.activeGoalCount,
        activePlanModeCount:
          promptBannerActivity?.activePlanModeCount ??
          EMPTY_THREAD_ACTIVITY.activePlanModeCount,
        activeWorkflowCount:
          backgroundActivity?.activeWorkflowCount ??
          EMPTY_THREAD_ACTIVITY.activeWorkflowCount,
      },
      hostConnected:
        thread.environmentHostId !== null &&
        connectedActiveHostIds.has(thread.environmentHostId),
      latestSession:
        thread.environmentHostId === null
          ? null
          : (latestSessionByHostId.get(thread.environmentHostId) ?? null),
      now: args.now,
      thread,
    });
  });
}

function ensureSnapshotRowsForThreadListDemand(
  deps: ThreadRuntimeDisplayDeps,
  args: ToThreadListEntryResponsesArgs,
): void {
  const environmentIds = args.threads.flatMap((thread) =>
    thread.environmentId !== null &&
    thread.archivedAt === null &&
    thread.deletedAt === null
      ? [thread.environmentId]
      : [],
  );
  const now = args.now ?? Date.now();
  ensureEnvironmentStatusSnapshotRows(deps.db, {
    environmentIds,
    now,
  });
  markEnvironmentStatusSnapshotsDue(deps.db, {
    environmentIds,
    now,
  });
}

function ensureSnapshotRowsForThreadDemand(
  deps: ThreadRuntimeDisplayDeps,
  args: ToThreadResponseFromThreadArgs,
): void {
  const environmentId =
    args.thread.environmentId !== null &&
    args.thread.archivedAt === null &&
    args.thread.deletedAt === null
      ? args.thread.environmentId
      : null;
  if (environmentId === null) {
    return;
  }

  const now = args.now ?? Date.now();
  ensureEnvironmentStatusSnapshotRows(deps.db, {
    environmentIds: [environmentId],
    now,
  });
}

function normalizeSnapshotStatus(status: string | null): SnapshotStatus {
  switch (status) {
    case "available":
    case "not_applicable":
    case "pending":
    case "unavailable":
      return status;
    case null:
      return "pending";
    default:
      return "unavailable";
  }
}

function snapshotUnavailableReason(args: {
  code: string | null;
  message: string | null;
}) {
  return {
    code: args.code ?? "snapshot_unavailable",
    message: args.message ?? "Environment status snapshot is unavailable",
  };
}

function parseSnapshotJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function toThreadEnvironmentGitStatusSignal(
  thread: ThreadEnvironmentStatusSnapshotFields,
): ThreadEnvironmentGitStatusSignal {
  const status = normalizeSnapshotStatus(thread.gitStatusSnapshotStatus);
  switch (status) {
    case "pending":
      return { state: "pending" };
    case "not_applicable":
      return thread.gitStatusSnapshotRefreshedAt === null
        ? { state: "pending" }
        : {
            state: "not_applicable",
            refreshedAt: thread.gitStatusSnapshotRefreshedAt,
          };
    case "unavailable":
      return thread.gitStatusSnapshotRefreshedAt === null
        ? { state: "pending" }
        : {
            state: "unavailable",
            refreshedAt: thread.gitStatusSnapshotRefreshedAt,
            reason: snapshotUnavailableReason({
              code: thread.gitStatusSnapshotErrorCode,
              message: thread.gitStatusSnapshotErrorMessage,
            }),
          };
    case "available": {
      if (
        thread.gitStatusSnapshotJson === null ||
        thread.gitStatusSnapshotRefreshedAt === null
      ) {
        return { state: "pending" };
      }
      const parsed = threadEnvironmentGitStatusSnapshotSchema.safeParse(
        parseSnapshotJson(thread.gitStatusSnapshotJson),
      );
      if (!parsed.success) {
        return {
          state: "unavailable",
          refreshedAt: thread.gitStatusSnapshotRefreshedAt,
          reason: {
            code: "invalid_snapshot",
            message: "Stored git status snapshot is invalid",
          },
        };
      }
      return {
        state: "available",
        refreshedAt: thread.gitStatusSnapshotRefreshedAt,
        snapshot: parsed.data,
      };
    }
  }
}

function toThreadEnvironmentPullRequestStatusSignal(
  thread: ThreadEnvironmentStatusSnapshotFields,
): ThreadEnvironmentPullRequestStatusSignal {
  const status = normalizeSnapshotStatus(
    thread.pullRequestStatusSnapshotStatus,
  );
  switch (status) {
    case "pending":
      return { state: "pending" };
    case "not_applicable":
      return thread.pullRequestStatusSnapshotRefreshedAt === null
        ? { state: "pending" }
        : {
            state: "not_applicable",
            refreshedAt: thread.pullRequestStatusSnapshotRefreshedAt,
          };
    case "unavailable":
      return thread.pullRequestStatusSnapshotRefreshedAt === null
        ? { state: "pending" }
        : {
            state: "unavailable",
            refreshedAt: thread.pullRequestStatusSnapshotRefreshedAt,
            reason: snapshotUnavailableReason({
              code: thread.pullRequestStatusSnapshotErrorCode,
              message: thread.pullRequestStatusSnapshotErrorMessage,
            }),
          };
    case "available": {
      if (thread.pullRequestStatusSnapshotRefreshedAt === null) {
        return { state: "pending" };
      }
      if (thread.pullRequestStatusSnapshotJson === null) {
        return {
          state: "available",
          refreshedAt: thread.pullRequestStatusSnapshotRefreshedAt,
          pullRequest: null,
        };
      }
      const parsed = threadPullRequestSchema.safeParse(
        parseSnapshotJson(thread.pullRequestStatusSnapshotJson),
      );
      if (!parsed.success) {
        return {
          state: "unavailable",
          refreshedAt: thread.pullRequestStatusSnapshotRefreshedAt,
          reason: {
            code: "invalid_snapshot",
            message: "Stored pull request status snapshot is invalid",
          },
        };
      }
      return {
        state: "available",
        refreshedAt: thread.pullRequestStatusSnapshotRefreshedAt,
        pullRequest: parsed.data,
      };
    }
  }
}

function toThreadEnvironmentStatusSummary(
  thread: ThreadEnvironmentStatusSnapshotFields,
): ThreadEnvironmentStatusSummary {
  if (thread.environmentId === null) {
    return {
      git: { state: "not_applicable", refreshedAt: thread.updatedAt },
      pullRequest: { state: "not_applicable", refreshedAt: thread.updatedAt },
    };
  }

  return {
    git: toThreadEnvironmentGitStatusSignal(thread),
    pullRequest: toThreadEnvironmentPullRequestStatusSignal(thread),
  };
}

function toPendingThreadEnvironmentStatusSnapshotFields(
  thread: Thread,
): ThreadEnvironmentStatusSnapshotFields {
  return {
    environmentId: thread.environmentId,
    gitStatusSnapshotJson: null,
    gitStatusSnapshotErrorCode: null,
    gitStatusSnapshotErrorMessage: null,
    gitStatusSnapshotRefreshedAt: null,
    gitStatusSnapshotStatus: "pending",
    pullRequestStatusSnapshotJson: null,
    pullRequestStatusSnapshotErrorCode: null,
    pullRequestStatusSnapshotErrorMessage: null,
    pullRequestStatusSnapshotRefreshedAt: null,
    pullRequestStatusSnapshotStatus: "pending",
    updatedAt: thread.updatedAt,
  };
}

function resolveThreadEnvironmentStatusSummaryForThread(
  deps: ThreadRuntimeDisplayDeps,
  args: ToThreadResponseFromThreadArgs,
): ThreadEnvironmentStatusSummary {
  const thread = args.thread;
  if (thread.environmentId === null) {
    return toThreadEnvironmentStatusSummary(
      toPendingThreadEnvironmentStatusSnapshotFields(thread),
    );
  }

  ensureSnapshotRowsForThreadDemand(deps, args);
  const gitSnapshot = getEnvironmentGitStatusSnapshot(
    deps.db,
    thread.environmentId,
  );
  const pullRequestSnapshot = getEnvironmentPullRequestStatusSnapshot(
    deps.db,
    thread.environmentId,
  );

  return toThreadEnvironmentStatusSummary({
    environmentId: thread.environmentId,
    gitStatusSnapshotJson: gitSnapshot?.gitStatusJson ?? null,
    gitStatusSnapshotErrorCode: gitSnapshot?.errorCode ?? null,
    gitStatusSnapshotErrorMessage: gitSnapshot?.errorMessage ?? null,
    gitStatusSnapshotRefreshedAt: gitSnapshot?.refreshedAt ?? null,
    gitStatusSnapshotStatus: gitSnapshot?.status ?? null,
    pullRequestStatusSnapshotJson: pullRequestSnapshot?.pullRequestJson ?? null,
    pullRequestStatusSnapshotErrorCode: pullRequestSnapshot?.errorCode ?? null,
    pullRequestStatusSnapshotErrorMessage:
      pullRequestSnapshot?.errorMessage ?? null,
    pullRequestStatusSnapshotRefreshedAt:
      pullRequestSnapshot?.refreshedAt ?? null,
    pullRequestStatusSnapshotStatus: pullRequestSnapshot?.status ?? null,
    updatedAt: thread.updatedAt,
  });
}

function toThreadListEntryResponseFromLatestSession(
  args: ToThreadListEntryResponseFromLatestSessionArgs,
): ThreadListEntry {
  const thread = toPublicThread(args.thread);
  return {
    ...thread,
    activity: args.activity,
    pinSortKey: args.thread.pinSortKey,
    environmentBranchName: args.thread.environmentBranchName,
    environmentHostId: args.thread.environmentHostId,
    environmentName: args.thread.environmentName,
    environmentStatusSummary: toThreadEnvironmentStatusSummary(args.thread),
    environmentWorkspaceDisplayKind:
      args.thread.environmentWorkspaceDisplayKind,
    hasPendingInteraction: args.thread.hasPendingInteraction,
    runtime: resolveThreadRuntimeStateFromLatestSession({
      environmentHostId: args.thread.environmentHostId,
      hostConnected: args.hostConnected,
      latestSession: args.latestSession,
      now: args.now,
      status: thread.status,
    }),
  };
}
