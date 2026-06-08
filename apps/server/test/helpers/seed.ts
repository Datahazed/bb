import {
  createEnvironment,
  createQueuedThreadMessage,
  deriveStoredEventItemFields,
  getLatestThreadSequence,
  hasStoredTurnStarted,
  insertEvents,
  createProject,
  createThread,
} from "@bb/db";
import {
  encodeClientTurnRequestIdNumber,
  parseStoredThreadEvent,
  threadScope,
  turnScope,
} from "@bb/domain";
import type {
  EnvironmentStatus,
  PermissionMode,
  PromptInput,
  StoredThreadEventDataForType,
  ThreadEventScope,
  ThreadEventItemType,
  ThreadEventType,
  WorkspaceProvisionType,
} from "@bb/domain";
import {
  LOCAL_ENGINE_SESSION_ID,
  LOCAL_HOST_ID,
} from "../../src/services/hosts/local-host.js";
import type { AppDeps } from "../../src/types.js";

export interface SeedEventArgs<TType extends ThreadEventType> {
  createdAt?: number;
  data: StoredThreadEventDataForType<TType>;
  environmentId?: string | null;
  providerThreadId?: string | null;
  scope: ThreadEventScope;
  sequence: number;
  threadId: string;
  type: TType;
}

export interface SeedStoredEventArgs {
  createdAt?: number;
  data: Record<string, unknown>;
  environmentId?: string | null;
  itemId?: string | null;
  itemKind?: ThreadEventItemType | null;
  providerThreadId?: string | null;
  scope: ThreadEventScope;
  sequence: number;
  threadId: string;
  type: ThreadEventType;
}

export interface SeedTurnStartedArgs {
  environmentId?: string | null;
  providerThreadId?: string;
  sequence?: number;
  threadId: string;
  turnId: string;
}

export interface SeededHost {
  id: string;
  name: string;
  type: "persistent";
}

export interface SeededEngineSession {
  hostId: string;
  id: string;
}

/**
 * The hosts table died with the daemon transport (P1c): the synthetic
 * `'local'` host is pure code. Seeding is now a stub that hands fixtures the
 * id routes accept (plan Decision 4); tests exercising an unknown-host id
 * pass an explicit `id`.
 */
export function seedHost(
  _deps: Pick<AppDeps, "db" | "hub">,
  args: { id?: string; name?: string; type?: "persistent" } = {},
): SeededHost {
  return {
    id: args.id ?? LOCAL_HOST_ID,
    name: args.name ?? "Test Host",
    type: args.type ?? "persistent",
  };
}

export function seedHostSession(
  deps: Pick<AppDeps, "db" | "hub">,
  args: { id?: string; name?: string; type?: "persistent" } = {},
) {
  const host = seedHost(deps, args);
  const session = seedSession(deps, host.id);
  return { host, session };
}

/**
 * Daemon sessions died with the transport; the in-process engine is the one
 * implicit "session" (`LOCAL_ENGINE_SESSION_ID`). The stub keeps the
 * session-shaped fixture that pending-interaction tests thread through
 * `registerPendingInteraction({sessionId})`.
 */
export function seedSession(
  _deps: Pick<AppDeps, "db" | "hub">,
  hostId: string,
): SeededEngineSession {
  return { hostId, id: LOCAL_ENGINE_SESSION_ID };
}

export function seedProjectWithSource(
  deps: Pick<AppDeps, "db" | "hub">,
  args: { hostId: string; name?: string; path?: string },
) {
  const { project, source } = createProject(deps.db, deps.hub, {
    name: args.name ?? "Test Project",
    source: {
      type: "local_path",
      hostId: args.hostId,
      path: args.path ?? "/tmp/test-project",
    },
  });
  if (source.type !== "local_path") {
    throw new Error("seedProjectWithSource expected a local_path source");
  }
  return { project, source };
}

export function seedEnvironment(
  deps: Pick<AppDeps, "db" | "hub">,
  args: {
    hostId: string;
    projectId: string;
    path?: string;
    status?: EnvironmentStatus;
    managed?: boolean;
    workspaceProvisionType?: WorkspaceProvisionType;
    isGitRepo?: boolean;
    isWorktree?: boolean;
    branchName?: string | null;
    baseBranch?: string | null;
    defaultBranch?: string | null;
    mergeBaseBranch?: string | null;
  },
) {
  return createEnvironment(deps.db, deps.hub, {
    projectId: args.projectId,
    hostId: args.hostId,
    path: args.path ?? "/tmp/test-environment",
    status: args.status ?? "ready",
    managed: args.managed ?? false,
    isGitRepo: args.isGitRepo ?? args.workspaceProvisionType !== "personal",
    isWorktree:
      args.isWorktree ?? args.workspaceProvisionType === "managed-worktree",
    workspaceProvisionType: args.workspaceProvisionType ?? "unmanaged",
    branchName: args.branchName !== undefined ? args.branchName : "bb/test",
    baseBranch: args.baseBranch !== undefined ? args.baseBranch : null,
    defaultBranch:
      args.defaultBranch !== undefined ? args.defaultBranch : "main",
    mergeBaseBranch: args.mergeBaseBranch ?? null,
  });
}

export function seedThread(
  deps: Pick<AppDeps, "db" | "hub">,
  args: {
    projectId: string;
    environmentId?: string | null;
    providerId?: string;
    status?: "created" | "provisioning" | "idle" | "active" | "error";
    type?: "standard" | "manager";
    title?: string | null;
    parentThreadId?: string | null;
    titleFallback?: string | null;
  },
) {
  return createThread(deps.db, deps.hub, {
    projectId: args.projectId,
    environmentId: args.environmentId ?? null,
    providerId: args.providerId ?? "codex",
    status: args.status ?? "idle",
    type: args.type ?? "standard",
    title: args.title ?? "Test Thread",
    titleFallback: args.titleFallback ?? "Test Thread",
    parentThreadId: args.parentThreadId ?? null,
  });
}

export function seedThreadFixture(
  harness: { deps: Pick<AppDeps, "db" | "hub"> },
  args: {
    session?: Parameters<typeof seedHostSession>[1];
    environment?: Omit<
      Parameters<typeof seedEnvironment>[1],
      "hostId" | "projectId"
    >;
    thread?: Omit<
      Parameters<typeof seedThread>[1],
      "projectId" | "environmentId"
    >;
  } = {},
) {
  const { host, session } = seedHostSession(harness.deps, args.session);
  const { project } = seedProjectWithSource(harness.deps, { hostId: host.id });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
    ...args.environment,
  });
  const thread = seedThread(harness.deps, {
    projectId: project.id,
    environmentId: environment.id,
    ...args.thread,
  });
  return { host, session, project, environment, thread };
}

export function seedQueuedMessage(
  deps: Pick<AppDeps, "db" | "hub">,
  args: {
    content: PromptInput[];
    threadId: string;
    model?: string;
    reasoningLevel?: string;
    permissionMode?: PermissionMode;
    serviceTier?: string;
  },
) {
  return createQueuedThreadMessage(deps.db, deps.hub, {
    threadId: args.threadId,
    content: args.content,
    model: args.model ?? "gpt-5",
    reasoningLevel: args.reasoningLevel ?? "medium",
    permissionMode: args.permissionMode ?? "full",
    serviceTier: args.serviceTier ?? "default",
  });
}

export function seedEvent(
  deps: Pick<AppDeps, "db" | "hub">,
  args: SeedEventArgs<ThreadEventType>,
): void;
export function seedEvent<TType extends ThreadEventType>(
  deps: Pick<AppDeps, "db" | "hub">,
  args: SeedEventArgs<TType>,
): void {
  const event = parseStoredThreadEvent({
    data: args.data,
    providerThreadId: args.providerThreadId ?? null,
    scope: args.scope,
    threadId: args.threadId,
    type: args.type,
  });
  insertEvents(deps.db, deps.hub, [
    {
      createdAt: args.createdAt,
      threadId: args.threadId,
      environmentId: args.environmentId ?? null,
      providerThreadId: args.providerThreadId ?? null,
      scope: args.scope,
      sequence: args.sequence,
      type: args.type,
      ...deriveStoredEventItemFields(event),
      data: JSON.stringify(args.data),
    },
  ]);
}

/**
 * Seeds a stored provider turn for tests that exercise server-side behavior
 * after daemon ingestion has already persisted turn/started.
 */
export function seedTurnStarted(
  deps: Pick<AppDeps, "db" | "hub">,
  args: SeedTurnStartedArgs,
): void {
  if (
    hasStoredTurnStarted(deps.db, {
      threadId: args.threadId,
      turnId: args.turnId,
    })
  ) {
    return;
  }

  const providerThreadId = args.providerThreadId ?? `provider-${args.turnId}`;
  seedEvent(deps, {
    threadId: args.threadId,
    environmentId: args.environmentId ?? null,
    providerThreadId,
    sequence:
      args.sequence ??
      getLatestThreadSequence(deps.db, { threadId: args.threadId }) + 1,
    type: "turn/started",
    scope: turnScope(args.turnId),
    data: { providerThreadId },
  });
}

export function seedThreadRuntimeState(
  deps: Pick<AppDeps, "db" | "hub">,
  args: {
    environmentId: string | null;
    inputText?: string;
    model?: string;
    providerThreadId: string;
    permissionMode?: PermissionMode;
    reasoningLevel?: string;
    sequenceStart?: number;
    serviceTier?: string;
    threadId: string;
  },
): void {
  const sequenceStart = args.sequenceStart ?? 1;
  seedEvent(deps, {
    threadId: args.threadId,
    environmentId: args.environmentId,
    providerThreadId: args.providerThreadId,
    sequence: sequenceStart,
    type: "thread/identity",
    scope: threadScope(),
    data: {},
  });
  seedEvent(deps, {
    threadId: args.threadId,
    environmentId: args.environmentId,
    providerThreadId: args.providerThreadId,
    sequence: sequenceStart + 1,
    type: "client/turn/requested",
    scope: threadScope(),
    data: {
      direction: "outbound",
      requestId: encodeClientTurnRequestIdNumber({ value: sequenceStart }),
      input: [
        {
          type: "text",
          text: args.inputText ?? "Prior task",
        },
      ],
      target: { kind: "new-turn" },
      execution: {
        model: args.model ?? "gpt-5",
        serviceTier: args.serviceTier ?? "default",
        reasoningLevel: args.reasoningLevel ?? "medium",
        permissionMode: args.permissionMode ?? "full",
        source: "client/turn/requested",
      },
      initiator: "user",
      senderThreadId: null,
      request: {
        method: "turn/start",
        params: {},
      },
      source: "tell",
    },
  });
}

export function seedStoredEvent(
  deps: Pick<AppDeps, "db" | "hub">,
  args: SeedStoredEventArgs,
): void {
  insertEvents(deps.db, deps.hub, [
    {
      createdAt: args.createdAt,
      threadId: args.threadId,
      environmentId: args.environmentId ?? null,
      providerThreadId: args.providerThreadId ?? null,
      scope: args.scope,
      sequence: args.sequence,
      type: args.type,
      itemId: args.itemId ?? null,
      itemKind: args.itemKind ?? null,
      data: JSON.stringify(args.data),
    },
  ]);
}
