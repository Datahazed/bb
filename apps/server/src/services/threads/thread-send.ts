import { getThread, transitionThreadStatusInTransaction } from "@bb/db";
import type { DbConnection, DbTransaction } from "@bb/db";
import type {
  ClientTurnRequestId,
  Environment,
  PromptInput,
  ResolvedThreadExecutionOptions,
  Thread,
  ThreadTurnInitiator,
  TurnRequestTarget,
} from "@bb/domain";
import type { SendMessageRequest } from "@bb/server-contract";
import { renderTemplate } from "@bb/templates";
import type {
  AppDeps,
  LoggedPendingInteractionWorkSessionDeps,
} from "../../types.js";
import { ApiError } from "../../errors.js";
import {
  addRequestIdToTurnSubmitCommandPayload,
  buildExecutionOptions,
  ensureThreadNativeArchiveSettled,
  prepareTurnSubmitCommandPayload,
  queueTurnSubmitCommandInTransaction,
  type QueuedTurnSubmitCommandDispatch,
} from "./thread-commands.js";
import {
  appendPreparedClientTurnRequestedEventWithNotificationInTransaction,
  type AppendedClientTurnRequestWithNotification,
  createClientTurnRequestId,
  getActiveTurnId,
} from "./thread-events.js";
import type { QueuedReadyThreadTurnDispatch } from "../lifecycle/thread-runtime-lifecycle.js";
import {
  queueTurnDuringReprovision,
  requireReadyThreadEnvironment,
} from "./thread-turn-dispatch.js";
import {
  prependManagerPreferencesSystemMessageIfChanged,
  recordManagerDynamicFileDelivery,
  recordManagerDynamicFileDeliveryInTransaction,
  type ManagerDynamicFileDeliveryStateUpdate,
  withManagerPreferencesDeliveryLock,
} from "./manager-dynamic-file-delivery.js";
import { resolvePermissionEscalation } from "./thread-runtime-config.js";
import { recordAcceptedPromptHistoryEntry } from "../prompt-history.js";
import {
  threadNotWritableReasonForStatus,
  throwSenderThreadInvalid,
  throwThreadNotWritable,
} from "../lib/lifecycle-api-errors.js";

type SendThreadMessageMode = SendMessageRequest["mode"];
type TextPromptInput = Extract<PromptInput, { type: "text" }>;
export type SendThreadMessageTrigger = "auto-dispatch" | "user";

export interface SendThreadMessageArgs {
  environment: Environment;
  payload: SendMessageRequest;
  thread: Thread;
  trigger: SendThreadMessageTrigger;
}

interface ResolveMessageSenderArgs {
  senderThreadId?: string;
  targetThread: Thread;
}

interface FormatAgentThreadInputArgs {
  input: PromptInput[];
  senderThreadId: string;
}

interface BuildAgentThreadMessageTextArgs {
  messageText: string;
  senderThreadId: string;
}

interface SendThreadMessageTransactionPreflightArgs {
  tx: DbTransaction;
}

interface SendThreadMessageQueueRequestArgs {
  requestEventSequence: number;
  tx: DbTransaction;
}

interface SendThreadMessageQueueRequestResult {
  threadBecameActive: boolean;
}

interface SendThreadMessageTransactionPreflight {
  (args: SendThreadMessageTransactionPreflightArgs): void;
}

interface SendThreadMessageQueueRequest {
  (args: SendThreadMessageQueueRequestArgs): SendThreadMessageQueueRequestResult;
}

interface AppendAndQueueSendThreadMessageArgs {
  beforeAppendInTransaction?: SendThreadMessageTransactionPreflight;
  db: DbConnection;
  environmentId: string | null;
  execution: ResolvedThreadExecutionOptions;
  initiator: ThreadTurnInitiator;
  input: PromptInput[];
  queueInTransaction: SendThreadMessageQueueRequest;
  requestId: ClientTurnRequestId;
  senderThreadId: string | null;
  stateUpdate: ManagerDynamicFileDeliveryStateUpdate | null;
  target: TurnRequestTarget;
  thread: Thread;
}

interface AppendAndQueueSendThreadMessageResult {
  request: AppendedClientTurnRequestWithNotification;
  threadBecameActive: boolean;
}

export function ensureThreadIsNotAwaitingUserInteraction(
  deps: Pick<AppDeps, "pendingInteractions">,
  threadId: string,
): void {
  if (!deps.pendingInteractions.hasPendingThreadInteraction(threadId)) {
    return;
  }

  throw new ApiError(
    409,
    "awaiting_user_interaction",
    "Thread is awaiting user interaction. Resolve the pending interaction before sending another prompt.",
  );
}

export function ensureThreadIsWritable(thread: Thread): void {
  if (thread.archivedAt) {
    throwThreadNotWritable(thread, "archived", "Thread is archived");
  }
  if (thread.stopRequestedAt !== null) {
    throwThreadNotWritable(thread, "stopping", "Thread is stopping");
  }
  if (thread.deletedAt !== null) {
    throwThreadNotWritable(thread, "deleted", "Thread is deleted");
  }
}

function resolveSendMode(
  thread: Thread,
  requestedMode: SendThreadMessageMode,
): "start" | "auto" | "steer" {
  if (requestedMode === "start") {
    if (thread.status === "active") {
      throwThreadNotWritable(
        thread,
        "already_active",
        "Thread is already active",
      );
    }
    return "start";
  }
  if (requestedMode === "steer") {
    if (thread.status === "active") {
      return "steer";
    }
    if (thread.status === "idle") {
      return "start";
    }
    throwThreadNotWritable(
      thread,
      threadNotWritableReasonForStatus(thread.status),
      "Thread is not active",
    );
  }
  if (thread.status === "active") {
    return "auto";
  }
  return "start";
}

function resolveMessageSenderThreadId(
  deps: Pick<AppDeps, "db">,
  args: ResolveMessageSenderArgs,
): string | null {
  if (!args.senderThreadId || args.senderThreadId === args.targetThread.id) {
    return null;
  }

  const senderThread = getThread(deps.db, args.senderThreadId);
  if (!senderThread) {
    throwSenderThreadInvalid("not_found");
  }
  if (senderThread.deletedAt !== null) {
    throwSenderThreadInvalid("deleted");
  }

  return senderThread.id;
}

function buildAgentThreadMessageText(
  args: BuildAgentThreadMessageTextArgs,
): string {
  return renderTemplate("agentThreadMessage", {
    messageText: args.messageText,
    senderThreadId: args.senderThreadId,
  });
}

function formatAgentThreadInput(
  args: FormatAgentThreadInputArgs,
): PromptInput[] {
  const firstTextIndex = args.input.findIndex((item) => item.type === "text");
  if (firstTextIndex === -1) {
    const textItem: TextPromptInput = {
      type: "text",
      text: buildAgentThreadMessageText({
        messageText: "",
        senderThreadId: args.senderThreadId,
      }),
    };
    return [textItem, ...args.input];
  }

  return args.input.map((item, index) => {
    if (index !== firstTextIndex || item.type !== "text") {
      return item;
    }
    return {
      ...item,
      text: buildAgentThreadMessageText({
        messageText: item.text,
        senderThreadId: args.senderThreadId,
      }),
    };
  });
}

function appendAndQueueSendThreadMessageInTransaction({
  beforeAppendInTransaction,
  db,
  environmentId,
  execution,
  initiator,
  input,
  queueInTransaction,
  requestId,
  senderThreadId,
  stateUpdate,
  target,
  thread,
}: AppendAndQueueSendThreadMessageArgs): AppendAndQueueSendThreadMessageResult {
  let threadBecameActive = false;
  const request = db.transaction(
    (tx) => {
      beforeAppendInTransaction?.({ tx });
      const appended =
        appendPreparedClientTurnRequestedEventWithNotificationInTransaction(
          tx,
          {
            threadId: thread.id,
            environmentId,
            type: "client/turn/requested",
            input,
            execution,
            initiator,
            senderThreadId,
            requestMethod: "turn/start",
            source: "tell",
            target,
            requestId,
          },
        );
      recordAcceptedPromptHistoryEntry(
        { db: tx },
        {
          thread,
          input,
          initiator,
          target,
          requestSequence: appended.sequence,
        },
      );
      const queueResult = queueInTransaction({
        requestEventSequence: appended.sequence,
        tx,
      });
      threadBecameActive = queueResult.threadBecameActive;
      recordManagerDynamicFileDeliveryInTransaction(tx, stateUpdate);
      return appended;
    },
    { behavior: "immediate" },
  );
  return {
    request,
    threadBecameActive,
  };
}

export type SendThreadMessageDeps = LoggedPendingInteractionWorkSessionDeps;

export async function sendThreadMessage(
  deps: SendThreadMessageDeps,
  args: SendThreadMessageArgs,
): Promise<void> {
  const { environment, payload, thread } = args;
  ensureThreadIsWritable(thread);
  ensureThreadNativeArchiveSettled(deps, { thread });
  if (args.trigger === "user") {
    ensureThreadIsNotAwaitingUserInteraction(deps, thread.id);
  }
  const mode = resolveSendMode(thread, payload.mode);
  if (mode === "start") {
    deps.threadLifecycle.ensureThreadCanQueueStartRequest(thread);
  }
  const senderThreadId = resolveMessageSenderThreadId(deps, {
    senderThreadId: payload.senderThreadId,
    targetThread: thread,
  });
  const input = senderThreadId
    ? formatAgentThreadInput({
        input: payload.input,
        senderThreadId,
      })
    : payload.input;
  // Agent-originated CLI sends still appear as normal turn requests in the
  // timeline, while initiator lets policy distinguish the source.
  const initiator: ThreadTurnInitiator = senderThreadId ? "agent" : "user";
  const expectedSteerTurnId =
    mode === "auto" || mode === "steer"
      ? getActiveTurnId(deps, thread.id)
      : null;
  const execution = await buildExecutionOptions(
    deps,
    payload,
    {
      threadId: thread.id,
    },
    "client/turn/requested",
  );
  const permissionEscalation = resolvePermissionEscalation({
    thread,
    initiator,
  });

  await withManagerPreferencesDeliveryLock({ thread }, async () => {
    const preparedInput = await prependManagerPreferencesSystemMessageIfChanged(
      deps,
      {
        hostId: environment.hostId,
        input,
        thread,
      },
    );

    if (
      await queueTurnDuringReprovision({
        deps,
        environment,
        execution,
        initiator,
        input: preparedInput.input,
        senderThreadId,
        thread,
      })
    ) {
      recordManagerDynamicFileDelivery(deps, preparedInput.stateUpdate);
      return;
    }
    const readyEnvironment = requireReadyThreadEnvironment(environment);
    let target: TurnRequestTarget;
    if (mode === "start") {
      target = { kind: "new-turn" };
    } else {
      target = {
        kind: mode,
        expectedTurnId: expectedSteerTurnId,
      };
    }

    const requestId = createClientTurnRequestId();

    if (mode === "start") {
      const command = await deps.threadLifecycle.prepareReadyThreadTurnCommand({
        thread,
        input: preparedInput.input,
        requestId,
        execution,
        permissionEscalation,
        environment: {
          id: readyEnvironment.id,
          hostId: readyEnvironment.hostId,
          cleanupRequestedAt: readyEnvironment.cleanupRequestedAt,
          path: readyEnvironment.path,
          status: readyEnvironment.status,
          workspaceProvisionType: readyEnvironment.workspaceProvisionType,
        },
        projectId: thread.projectId,
        providerId: thread.providerId,
      });
      let queuedDispatch: QueuedReadyThreadTurnDispatch | null = null;
      const queuedRequest = appendAndQueueSendThreadMessageInTransaction({
        beforeAppendInTransaction: () => {
          deps.threadLifecycle.ensureThreadCanQueueStartRequest(thread);
        },
        db: deps.db,
        environmentId: thread.environmentId,
        execution,
        initiator,
        input: preparedInput.input,
        queueInTransaction: ({ requestEventSequence, tx }) => {
          const queuedTurn =
            deps.threadLifecycle.queuePreparedReadyThreadTurnCommandInTransaction(
              tx,
              {
                command,
                requestEventSequence,
                thread,
              },
            );
          queuedDispatch = queuedTurn;
          if (queuedTurn.mode === "turn.submit") {
            transitionThreadStatusInTransaction(tx, {
              id: thread.id,
              newStatus: "active",
            });
            return { threadBecameActive: true };
          }
          return { threadBecameActive: false };
        },
        requestId,
        senderThreadId,
        stateUpdate: preparedInput.stateUpdate,
        target,
        thread,
      });
      deps.hub.notifyThread(
        thread.id,
        queuedRequest.request.notificationChanges,
        queuedRequest.request.notificationMetadata,
      );
      if (queuedDispatch) {
        deps.threadLifecycle.dispatchQueuedReadyThreadTurn(queuedDispatch);
      }
      if (queuedRequest.threadBecameActive) {
        deps.hub.notifyThread(thread.id, ["status-changed"], {
          projectId: thread.projectId,
        });
      }
      return;
    }

    const preparedCommand = await prepareTurnSubmitCommandPayload(deps, {
      thread,
      input: preparedInput.input,
      execution,
      permissionEscalation,
      target: {
        mode,
        expectedTurnId: expectedSteerTurnId,
      },
      environment: {
        id: readyEnvironment.id,
        hostId: readyEnvironment.hostId,
        cleanupRequestedAt: readyEnvironment.cleanupRequestedAt,
        path: readyEnvironment.path,
        status: readyEnvironment.status,
        workspaceProvisionType: readyEnvironment.workspaceProvisionType,
      },
    });
    const command = addRequestIdToTurnSubmitCommandPayload({
      preparedCommand,
      requestId,
    });
    let queuedDispatch: QueuedTurnSubmitCommandDispatch | null = null;
    const queuedRequest = appendAndQueueSendThreadMessageInTransaction({
      db: deps.db,
      environmentId: thread.environmentId,
      execution,
      initiator,
      input: preparedInput.input,
      queueInTransaction: ({ requestEventSequence, tx }) => {
        queuedDispatch = queueTurnSubmitCommandInTransaction(tx, {
          command,
          requestEventSequence,
        });
        return { threadBecameActive: false };
      },
      requestId,
      senderThreadId,
      stateUpdate: preparedInput.stateUpdate,
      target,
      thread,
    });
    deps.hub.notifyThread(
      thread.id,
      queuedRequest.request.notificationChanges,
      queuedRequest.request.notificationMetadata,
    );
    if (queuedDispatch) {
      deps.threadLifecycle.dispatchTurnSubmit(queuedDispatch);
    }
  });
}
