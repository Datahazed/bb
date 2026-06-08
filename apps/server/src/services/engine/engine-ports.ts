/**
 * Server-side implementation of the engine ports (`src/engine/ports.ts`) —
 * each member is the direct in-process call that replaces one daemon
 * transport surface (plan §6 Phase 1 "daemon→server ingress flows become
 * direct calls"):
 *
 * - `events` → the P1a append module (`services/threads/event-append.ts`),
 *   replacing the event-buffer spool + `POST /internal/session/events`.
 * - `interactiveRequests` → `PendingInteractionLifecycle`, replacing
 *   `POST /internal/session/interactive-request[/interrupt]`. The ingress
 *   503 turn-ordering retry is NOT ported: the engine flushes the event sink
 *   before registering, so a missing turn/started is an engine bug and
 *   throws (handoff notes 3–4).
 * - `callTool` → `appendThreadEvent`, replacing `POST /internal/session/tool-call`.
 * - `appData` → `hub.notifyAppData`, replacing
 *   `POST /internal/session/app-data-{change,resync}`.
 * - `fetchProjectAttachment` → bounded `<dataDir>/attachments` read,
 *   replacing `GET /internal/session/project-attachment-content`.
 * - `changes` / `sendTerminalEvent` → hub + terminal lifecycle calls,
 *   replacing the non-RPC daemon WS messages.
 * - `deliverCommandResult` → the dispatch shim's settlement
 *   (`engine-dispatch.ts`), replacing `POST /internal/session/command-result`.
 */
import { getEnvironment, getThread, hasStoredTurnStarted } from "@bb/db";
import { messageUserToolArgumentsSchema, turnScope } from "@bb/domain";
import type {
  AppDataChangeSink,
  CallServerTool,
  DeliverCommandResult,
  EnginePorts,
  FetchProjectAttachment,
  InteractiveRequestGateway,
  RuntimeChangeNotifier,
  SendTerminalEvent,
} from "../../engine/ports.js";
import { ApiError } from "../../errors.js";
import type { AppDeps } from "../../types.js";
import { notifyGlobalAppsChanged } from "../../routes/apps.js";
import { requirePublicThreadEnvironment } from "../lib/entity-lookup.js";
import { runtimeErrorLogFields } from "../lib/error-log-fields.js";
import { parseValue } from "../lib/validation.js";
import { readAttachmentWithinLimit } from "../projects/attachments.js";
import { createThreadEventAppender } from "../threads/event-append.js";
import { queueManagedThreadNeedsAttentionNotificationBestEffort } from "../threads/managed-thread-notifications.js";
import { appendThreadEvent } from "../threads/thread-events.js";
import { LOCAL_ENGINE_SESSION_ID } from "../hosts/local-host.js";

export interface BuildEnginePortsArgs {
  deliverCommandResult: DeliverCommandResult;
  deps: AppDeps;
}

/**
 * Mirrors the daemon ingress route's needs-attention side effect
 * (`internal/interactive-requests.ts`): a newly created interaction on a
 * managed thread nudges its manager. Deferred off the registration critical
 * path — the provider process blocks on the registration response, exactly
 * as it blocked on the ingress HTTP response.
 */
function queueManagedThreadNeedsAttentionDetached(
  deps: AppDeps,
  managedThreadId: string,
): void {
  const managedThread = getThread(deps.db, managedThreadId);
  if (!managedThread?.parentThreadId) {
    return;
  }
  const managerThreadId = managedThread.parentThreadId;
  setImmediate(() => {
    void queueManagedThreadNeedsAttentionNotificationBestEffort(deps, {
      managedThreadId: managedThread.id,
      managerThreadId,
      title: managedThread.title,
    });
  });
}

function buildInteractiveRequestGateway(
  deps: AppDeps,
): InteractiveRequestGateway {
  return {
    async register(request) {
      // The engine awaits `ThreadEventSink.flush()` before every registration
      // attempt (ports contract), so the turn/started for this interaction is
      // already durably stored. A miss here is an engine ordering bug — the
      // daemon's 503 `turn_start_not_ready` retry ladder is deliberately not
      // ported (plan R5, handoff note 3).
      const turnStarted = hasStoredTurnStarted(deps.db, {
        threadId: request.threadId,
        turnId: request.turnId,
      });
      if (!turnStarted) {
        throw new Error(
          `Interactive request for thread ${request.threadId} arrived before its turn/started event was stored`,
        );
      }

      const registered = deps.pendingInteractions.registerPendingInteraction({
        interaction: request,
        sessionId: LOCAL_ENGINE_SESSION_ID,
      });
      if (registered.outcome === "rejected") {
        return { outcome: "rejected", reason: registered.reason };
      }
      if (registered.outcome === "created") {
        queueManagedThreadNeedsAttentionDetached(
          deps,
          registered.interaction.threadId,
        );
      }
      return {
        outcome: registered.outcome,
        interactionId: registered.interaction.id,
        status: registered.interaction.status,
      };
    },
    // Effectively infallible in-process (handoff note 4): a plain DB update.
    // The daemon's durable pending-interrupt queue and retry timer died with
    // the transport; boot reconciliation owns interrupt recovery.
    async interrupt(args) {
      deps.pendingInteractions.interruptPendingInteractionsForThreads({
        providerId: args.providerId,
        reason: args.reason,
        threadIds: args.threadIds,
      });
    },
  };
}

function buildCallServerTool(deps: AppDeps): CallServerTool {
  return async (request) => {
    if (request.tool === "message_user") {
      const args = parseValue(
        request.arguments ?? {},
        messageUserToolArgumentsSchema,
      );
      appendThreadEvent(deps, {
        threadId: request.threadId,
        scope: turnScope(request.turnId),
        type: "system/manager/user_message",
        data: {
          text: args.text,
          toolCallId: request.callId,
          turnId: request.turnId,
        },
      });
      return {
        success: true,
        contentItems: [{ type: "inputText", text: "Message delivered" }],
      };
    }

    return {
      success: false,
      contentItems: [
        { type: "inputText", text: `Unsupported tool: ${request.tool}` },
      ],
    };
  };
}

function buildFetchProjectAttachment(deps: AppDeps): FetchProjectAttachment {
  return async (args) => {
    const { thread } = requirePublicThreadEnvironment(deps.db, args.threadId);
    // Attachment paths are project-scoped upload tokens, so cross-check
    // projectId before reading bytes even though threadId identifies a thread.
    if (thread.projectId !== args.projectId) {
      throw new ApiError(403, "forbidden", "Thread does not belong to project");
    }
    const content = await readAttachmentWithinLimit(
      deps.config.dataDir,
      args.projectId,
      args.path,
      {
        ...(args.expectedSizeBytes !== undefined
          ? { expectedSizeBytes: args.expectedSizeBytes }
          : {}),
        maxBytes: args.maxBytes,
      },
    );
    return { bytes: new Uint8Array(content) };
  };
}

function buildRuntimeChangeNotifier(deps: AppDeps): RuntimeChangeNotifier {
  return {
    notifyEnvironmentChanged(payload) {
      // The daemon ingress also policed host ownership; in-process only the
      // destroyed-environment guard survives.
      const environment = getEnvironment(deps.db, payload.environmentId);
      if (!environment || environment.status === "destroyed") {
        return;
      }
      deps.hub.notifyEnvironment(environment.id, [payload.change]);
    },
    notifyApplicationStorageChanged() {
      void notifyGlobalAppsChanged(deps).catch((error) => {
        deps.logger.warn(
          runtimeErrorLogFields(deps.config, error),
          "Failed to refresh global app list after engine storage change",
        );
      });
    },
    notifyApplicationContentChanged(args) {
      deps.hub.notifyAppContentChanged(args.applicationId);
    },
  };
}

function buildAppDataChangeSink(deps: AppDeps): AppDataChangeSink {
  return {
    async publishChange(change) {
      deps.hub.notifyAppData({
        type: "app-data.changed",
        applicationId: change.applicationId,
        path: change.path,
        value: change.value,
        deleted: change.deleted,
        version: change.version,
      });
    },
    async publishResync(resync) {
      deps.hub.notifyAppData({
        type: "app-data.resync",
        applicationId: resync.applicationId,
      });
    },
  };
}

function buildSendTerminalEvent(deps: AppDeps): SendTerminalEvent {
  return (message) => {
    deps.terminalSessions.handleEngineTerminalEvent(message);
  };
}

export function buildEnginePorts(args: BuildEnginePortsArgs): EnginePorts {
  const { deps } = args;
  return {
    events: createThreadEventAppender(deps),
    interactiveRequests: buildInteractiveRequestGateway(deps),
    callTool: buildCallServerTool(deps),
    appData: buildAppDataChangeSink(deps),
    fetchProjectAttachment: buildFetchProjectAttachment(deps),
    deliverCommandResult: args.deliverCommandResult,
    changes: buildRuntimeChangeNotifier(deps),
    sendTerminalEvent: buildSendTerminalEvent(deps),
  };
}
