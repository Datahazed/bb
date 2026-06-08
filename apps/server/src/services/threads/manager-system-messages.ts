import {
  getThread,
  transitionThreadStatusInTransaction,
  type DbTransaction,
} from "@bb/db";
import type {
  PromptInput,
  ResolvedThreadExecutionOptions,
  Thread,
} from "@bb/domain";
import type {
  AppDeps,
  LoggedPendingInteractionWorkSessionDeps,
} from "../../types.js";

type ManagerSystemMessageDeps = LoggedPendingInteractionWorkSessionDeps;
import { requireThreadEnvironment } from "../lib/entity-lookup.js";
import {
  addRequestIdToTurnSubmitCommandPayload,
  buildExecutionOptions,
  ensureThreadNativeArchiveSettled,
  prepareTurnSubmitCommandPayload,
  queueTurnSubmitCommandInTransaction,
  type PreparedTurnSubmitCommandPayload,
  type QueuedTurnSubmitCommandDispatch,
} from "./thread-commands.js";
import {
  appendClientTurnEventInTransaction,
  appendPreparedClientTurnRequestedEventInTransaction,
  createClientTurnRequestId,
  getActiveTurnId,
} from "./thread-events.js";
import {
  queueTurnDuringReprovision,
  requireReadyThreadEnvironment,
  type ReadyThreadEnvironment,
} from "./thread-turn-dispatch.js";
import {
  type ManagerDynamicFileDeliveryStateUpdate,
  prependManagerPreferencesSystemMessageIfChanged,
  recordManagerDynamicFileDelivery,
  recordManagerDynamicFileDeliveryInTransaction,
  withManagerPreferencesDeliveryLock,
} from "./manager-dynamic-file-delivery.js";
import { resolvePermissionEscalation } from "./thread-runtime-config.js";

const MANAGER_SYSTEM_MESSAGE_SOURCE = "tell";

interface QueueManagerSystemMessageArgs {
  managerThreadId: string;
  messageText: string;
}

interface QueueReadyManagerSystemMessageArgs {
  environment: ReadyThreadEnvironment;
  execution: ResolvedThreadExecutionOptions;
  input: PromptInput[];
  stateUpdate: ManagerDynamicFileDeliveryStateUpdate | null;
  thread: Thread;
}

interface QueueActiveManagerSystemMessageInTransactionArgs
  extends QueueReadyManagerSystemMessageArgs {
  engineDispatch: AppDeps["engineDispatch"];
  preparedCommand: PreparedTurnSubmitCommandPayload;
}

function buildSystemInput(messageText: string): PromptInput[] {
  return [{ type: "text", text: messageText }];
}

function hasPendingActiveManagerCommand(
  engineDispatch: AppDeps["engineDispatch"],
  args: QueueReadyManagerSystemMessageArgs,
): boolean {
  return (
    engineDispatch.hasInFlightThreadCommand({
      threadId: args.thread.id,
      type: "turn.submit",
    }) ||
    engineDispatch.hasInFlightThreadCommand({
      threadId: args.thread.id,
      type: "thread.archive",
    }) ||
    engineDispatch.hasInFlightThreadCommand({
      threadId: args.thread.id,
      type: "thread.stop",
    })
  );
}

function queueActiveManagerSystemMessageInTransaction(
  tx: DbTransaction,
  args: QueueActiveManagerSystemMessageInTransactionArgs,
): QueuedTurnSubmitCommandDispatch | null {
  const currentThread = getThread(tx, args.thread.id);
  if (
    !currentThread ||
    currentThread.type !== "manager" ||
    currentThread.environmentId !== args.environment.id ||
    currentThread.status !== "active" ||
    currentThread.archivedAt !== null ||
    currentThread.deletedAt !== null ||
    currentThread.stopRequestedAt !== null ||
    hasPendingActiveManagerCommand(args.engineDispatch, args)
  ) {
    return null;
  }

  const expectedSteerTurnId = getActiveTurnId({ db: tx }, args.thread.id);
  const request = appendClientTurnEventInTransaction(tx, {
    threadId: args.thread.id,
    environmentId: args.environment.id,
    type: "client/turn/requested",
    input: args.input,
    execution: args.execution,
    initiator: "system",
    senderThreadId: null,
    requestMethod: "turn/start",
    source: MANAGER_SYSTEM_MESSAGE_SOURCE,
    target: {
      kind: "auto",
      expectedTurnId: expectedSteerTurnId,
    },
  });
  recordManagerDynamicFileDeliveryInTransaction(tx, args.stateUpdate);
  return queueTurnSubmitCommandInTransaction(tx, {
    command: addRequestIdToTurnSubmitCommandPayload({
      requestId: request.requestId,
      preparedCommand: {
        ...args.preparedCommand,
        target: {
          mode: "auto",
          expectedTurnId: expectedSteerTurnId,
        },
      },
    }),
    requestEventSequence: request.sequence,
  });
}

async function queueActiveManagerSystemMessage(
  deps: ManagerSystemMessageDeps,
  args: QueueReadyManagerSystemMessageArgs,
): Promise<boolean> {
  const expectedSteerTurnId = getActiveTurnId(deps, args.thread.id);
  const permissionEscalation = resolvePermissionEscalation({
    thread: args.thread,
    initiator: "system",
  });
  const preparedCommand = await prepareTurnSubmitCommandPayload(deps, {
    thread: args.thread,
    input: args.input,
    execution: args.execution,
    permissionEscalation,
    target: {
      mode: "auto",
      expectedTurnId: expectedSteerTurnId,
    },
    environment: {
      id: args.environment.id,
      hostId: args.environment.hostId,
      cleanupRequestedAt: args.environment.cleanupRequestedAt,
      path: args.environment.path,
      status: args.environment.status,
      workspaceProvisionType: args.environment.workspaceProvisionType,
    },
  });

  const envelope = deps.db.transaction(
    (tx) =>
      queueActiveManagerSystemMessageInTransaction(tx, {
        ...args,
        engineDispatch: deps.engineDispatch,
        preparedCommand,
      }),
    { behavior: "immediate" },
  );
  if (!envelope) {
    return false;
  }

  deps.hub.notifyThread(args.thread.id, ["events-appended"], {
    eventTypes: ["client/turn/requested"],
  });
  deps.threadLifecycle.dispatchTurnSubmit(envelope);
  return true;
}

async function queueReadyManagerSystemMessage(
  deps: ManagerSystemMessageDeps,
  args: QueueReadyManagerSystemMessageArgs,
): Promise<boolean> {
  if (args.thread.status === "active") {
    return queueActiveManagerSystemMessage(deps, args);
  }

  const permissionEscalation = resolvePermissionEscalation({
    thread: args.thread,
    initiator: "system",
  });
  const requestId = createClientTurnRequestId();

  const command = await deps.threadLifecycle.prepareReadyThreadTurnCommand({
    thread: args.thread,
    input: args.input,
    requestId,
    execution: args.execution,
    permissionEscalation,
    environment: {
      id: args.environment.id,
      hostId: args.environment.hostId,
      cleanupRequestedAt: args.environment.cleanupRequestedAt,
      path: args.environment.path,
      status: args.environment.status,
      workspaceProvisionType: args.environment.workspaceProvisionType,
    },
    projectId: args.thread.projectId,
    providerId: args.thread.providerId,
  });
  let transitioned = false;
  const queued = deps.db.transaction(
    (tx) => {
      deps.threadLifecycle.ensureThreadCanQueueStartRequest(args.thread);
      const request = appendPreparedClientTurnRequestedEventInTransaction(tx, {
        threadId: args.thread.id,
        environmentId: args.environment.id,
        type: "client/turn/requested",
        input: args.input,
        execution: args.execution,
        initiator: "system",
        senderThreadId: null,
        requestMethod: "turn/start",
        source: MANAGER_SYSTEM_MESSAGE_SOURCE,
        target: { kind: "new-turn" },
        requestId,
      });
      const queuedTurn =
        deps.threadLifecycle.queuePreparedReadyThreadTurnCommandInTransaction(
          tx,
          {
            command,
            requestEventSequence: request.sequence,
            thread: args.thread,
          },
        );
      if (queuedTurn.mode === "turn.submit") {
        transitionThreadStatusInTransaction(tx, {
          id: args.thread.id,
          newStatus: "active",
        });
        transitioned = true;
      }
      recordManagerDynamicFileDeliveryInTransaction(tx, args.stateUpdate);
      return queuedTurn;
    },
    { behavior: "immediate" },
  );
  deps.hub.notifyThread(args.thread.id, ["events-appended"], {
    eventTypes: ["client/turn/requested"],
  });
  deps.threadLifecycle.dispatchQueuedReadyThreadTurn(queued);
  if (transitioned) {
    deps.hub.notifyThread(args.thread.id, ["status-changed"], {
      projectId: args.thread.projectId,
    });
  }
  return true;
}

export async function queueManagerSystemMessage(
  deps: ManagerSystemMessageDeps,
  args: QueueManagerSystemMessageArgs,
): Promise<boolean> {
  const managerThread = getThread(deps.db, args.managerThreadId);
  if (
    !managerThread ||
    managerThread.type !== "manager" ||
    managerThread.archivedAt !== null ||
    managerThread.deletedAt !== null
  ) {
    return false;
  }
  if (deps.pendingInteractions.hasPendingThreadInteraction(managerThread.id)) {
    return false;
  }

  const { environment } = requireThreadEnvironment(
    deps.db,
    args.managerThreadId,
  );
  ensureThreadNativeArchiveSettled(deps, {
    thread: managerThread,
  });
  const input = buildSystemInput(args.messageText);
  const execution = await buildExecutionOptions(
    deps,
    {},
    {
      threadId: managerThread.id,
    },
    "client/turn/requested",
  );
  return await withManagerPreferencesDeliveryLock(
    { thread: managerThread },
    async () => {
      const preparedInput =
        await prependManagerPreferencesSystemMessageIfChanged(deps, {
          hostId: environment.hostId,
          input,
          thread: managerThread,
        });

      if (
        await queueTurnDuringReprovision({
          deps,
          environment,
          execution,
          initiator: "system",
          input: preparedInput.input,
          senderThreadId: null,
          thread: managerThread,
        })
      ) {
        recordManagerDynamicFileDelivery(deps, preparedInput.stateUpdate);
        return true;
      }

      const readyEnvironment = requireReadyThreadEnvironment(environment);
      return await queueReadyManagerSystemMessage(deps, {
        thread: managerThread,
        input: preparedInput.input,
        stateUpdate: preparedInput.stateUpdate,
        execution,
        environment: readyEnvironment,
      });
    },
  );
}
