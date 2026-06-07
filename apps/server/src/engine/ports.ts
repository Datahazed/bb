/**
 * Engine ports — the complete interface set the in-process engine
 * (`apps/server/src/engine/`, the adapted copy of the host-daemon's living
 * modules) needs from the server.
 *
 * Phase 1a: these are type-only seams. Nothing in the server implements or
 * constructs them yet; engine code and engine unit tests are the only
 * consumers. Phase 1b implements every member with direct in-process calls
 * (the dispatch shim, the new event append module in
 * `services/threads/event-append.ts`, the pending-interactions service, the
 * notification hub, attachment file reads) and deletes the daemon transport
 * (`server-client.ts`, `event-buffer.ts`, `server-connection.ts`,
 * `/internal/*` routes) that each member replaces.
 *
 * Rules for this file:
 * - Leaf module: imports only from shared packages, never from other engine
 *   files or server services.
 * - Every member documents the daemon mechanism it replaces.
 */
import type {
  ApplicationId,
  PendingInteractionCreate,
  ThreadEvent,
  ToolCallRequest,
  ToolCallResponse,
} from "@bb/domain";
import type {
  HostDaemonAppDataChangePayload,
  HostDaemonAppDataResyncPayload,
  HostDaemonCommand,
  HostDaemonCommandResult,
  HostDaemonDaemonWsMessage,
  HostDaemonDurableCommandType,
  HostDaemonEnvironmentChangePayload,
  HostDaemonInteractiveRequestResponse,
  HostDaemonServerWsMessage,
} from "@bb/host-daemon-contract";
import type { Logger } from "@bb/logger";

/**
 * Replaces the daemon's `HostDaemonLogger` (`apps/host-daemon/src/logger.ts`);
 * the server passes its own component logger when constructing the engine.
 */
export type EngineLogger = Pick<Logger, "debug" | "info" | "warn" | "error">;

/**
 * One thread-event emission from engine runtime code. Replaces the daemon's
 * `BufferedEventInput` (`event-buffer.ts`); the spool envelope fields
 * (`producerEventId`, `payloadHash`, `localOrder`) are durable-transport
 * artifacts and do not cross this seam.
 */
export interface EngineThreadEventInput {
  threadId: string;
  event: ThreadEvent;
}

export interface ThreadEventSink {
  /**
   * Replaces `eventBuffer.push()` + the batched daemon upload
   * (`POST /internal/session/events`). Fire-and-forget; the P1b
   * implementation (the append module, `services/threads/event-append.ts`)
   * appends in emit order: per-thread monotonic sequence and
   * turn/started-before-turn-scoped-events are enforced inside the append
   * transaction; hub notify and event effects run after that transaction
   * commits, mirroring the live ingress.
   *
   * P1b requirement: the implementation must tolerate emits arriving after
   * `Engine.shutdown()` — the daemon swallowed `EventBufferDisposedError`
   * for runtime events received after spool disposal
   * (`apps/host-daemon/src/app.ts:527-545`); the engine emits
   * unconditionally, so a late provider event must be dropped (logged), not
   * crash the server.
   */
  emit(input: EngineThreadEventInput): void;
  /**
   * Replaces both `eventBuffer.flush()` and `eventBuffer.flushRequired()`:
   * resolves once every previously emitted event is durably appended. The
   * engine awaits it before reporting command results
   * (`shouldFlushEventsBeforeReportingCommandResult` ordering), before
   * registering interactive requests, and before forwarding tool calls —
   * the in-process replacement for the daemon's flush barriers and the
   * ingress 503-retry ordering guard (plan R5).
   */
  flush(): Promise<void>;
}

/**
 * Replaces `interruptInteractiveRequests` args
 * (`server-client.ts` / `interactive-request-registry.ts`).
 */
export interface InterruptInteractiveRequestsArgs {
  providerId: string;
  reason: string;
  threadIds: readonly string[];
}

export interface InteractiveRequestGateway {
  /**
   * Replaces `serverClient.registerInteractiveRequest`
   * (`POST /internal/session/interactive-request`) including its
   * `503 turn_start_not_ready` pRetry ladder and the
   * flush-before-attempt hook: the engine awaits `ThreadEventSink.flush()`
   * before calling, so the turn/started event is already stored. P1b calls
   * `pendingInteractions.registerPendingInteraction` directly.
   */
  register(
    request: PendingInteractionCreate,
  ): Promise<HostDaemonInteractiveRequestResponse>;
  /**
   * Replaces `serverClient.interruptInteractiveRequests`
   * (`POST /internal/session/interactive-request/interrupt`) plus the
   * daemon app's `pendingInteractiveInterrupts` queue and retry timer —
   * in-process the call is direct, so the durable retry machinery dies.
   * The daemon ignored the response's interactionIds; this returns void.
   */
  interrupt(args: InterruptInteractiveRequestsArgs): Promise<void>;
}

/**
 * Replaces `serverClient.callTool` (`POST /internal/session/tool-call`):
 * dynamic provider tool calls (e.g. `message_user`) that the server answers
 * by appending thread events and returning content items. The engine awaits
 * `ThreadEventSink.flush()` first (the daemon's
 * `flushThreadEventsBeforeToolCall`).
 */
export type CallServerTool = (
  request: ToolCallRequest,
) => Promise<ToolCallResponse>;

export interface AppDataChangeSink {
  /**
   * Replaces `AppDataChangeReporter`'s `postAppDataChange`
   * (`POST /internal/session/app-data-change`); P1b calls
   * `hub.notifyAppData({type: "app-data.changed", ...})` directly.
   */
  publishChange(change: HostDaemonAppDataChangePayload): Promise<void>;
  /**
   * Replaces `AppDataChangeReporter`'s `postAppDataResync`
   * (`POST /internal/session/app-data-resync`); P1b calls
   * `hub.notifyAppData({type: "app-data.resync", ...})` directly.
   */
  publishResync(resync: HostDaemonAppDataResyncPayload): Promise<void>;
}

/**
 * Replaces `FetchProjectAttachmentArgs` (`project-attachments.ts`); the
 * `expectedSizeBytes`/`maxBytes` checks survive as read-size validation.
 */
export interface FetchProjectAttachmentArgs {
  expectedSizeBytes?: number;
  maxBytes: number;
  path: string;
  projectId: string;
  threadId: string;
}

export interface FetchedProjectAttachment {
  bytes: Uint8Array;
}

/**
 * Replaces `serverClient.fetchProjectAttachment`
 * (`GET /internal/session/project-attachment-content`); P1b reads
 * `<dataDir>/attachments/<projectId>/` directly via
 * `services/projects/attachments.ts` and the route dies.
 *
 * P1b requirement: the implementation must enforce `maxBytes` before or
 * while reading (stat-before-read or a bounded read), not only on the
 * returned bytes — the daemon enforced the limit mid-stream
 * (`server-client.ts:286-350`); the engine handler keeps only the
 * pre/post-fetch size checks (`handlers/prompt-attachments.ts`), so an
 * implementation that reads the whole file first would buffer an oversized
 * attachment into memory before rejecting it.
 */
export type FetchProjectAttachment = (
  args: FetchProjectAttachmentArgs,
) => Promise<FetchedProjectAttachment>;

/**
 * Replaces `HostDaemonCommandEnvelope` (`{id, attemptId, cursor, command}`):
 * `attemptId` and `cursor` are durable-queue artifacts that die with the
 * queue. `commandId` is synthesized by the P1b dispatch shim and threaded
 * through the surviving op-table `'queued'` writes and `client_turn_requests`
 * rows (plan §6 Phase 1).
 */
export interface EngineCommandEnvelope {
  commandId: string;
  command: HostDaemonCommand;
}

/**
 * Replaces `HostDaemonCommandResultReportWithoutSession` minus `attemptId`
 * (attempt gating dies with `handleCommandResult`'s row+attempt checks).
 * `completedAt` is Unix epoch milliseconds, as in the daemon report.
 */
interface EngineCommandReportBase {
  commandId: string;
  completedAt: number;
}

type EngineCommandSuccessReportByType = {
  [TType in HostDaemonDurableCommandType]: EngineCommandReportBase & {
    type: TType;
    ok: true;
    result: HostDaemonCommandResult<TType>;
  };
};

export type EngineCommandSuccessReport =
  EngineCommandSuccessReportByType[HostDaemonDurableCommandType];

export interface EngineCommandErrorReport extends EngineCommandReportBase {
  type: HostDaemonDurableCommandType;
  ok: false;
  errorCode: string;
  errorMessage: string;
}

export type EngineCommandResultReport =
  | EngineCommandSuccessReport
  | EngineCommandErrorReport;

/**
 * Replaces `CommandRouter.reportResult` → `serverClient.reportCommandResult`
 * (`POST /internal/session/command-result`, pRetry) and the
 * `handleCommandResult` settlement transaction's stored-row + active-attempt
 * gating. P1b implements it as a new settlement transaction that fabricates
 * the `commandRow` argument for the command-result owners registry and the
 * existing `settle*` functions (plan §6 Phase 1, verification finding
 * [phase1-feasibility]/settlement). The engine flushes the event sink before
 * delivering results for commands where
 * `shouldFlushEventsBeforeReportingCommandResult` is true, preserving the
 * transcript/events-before-result ordering.
 */
export type DeliverCommandResult = (
  report: EngineCommandResultReport,
) => Promise<void>;

/** Replaces the WS `{type: "application-content-changed"}` payload. */
export interface ApplicationContentChangedArgs {
  applicationId: ApplicationId;
}

export interface RuntimeChangeNotifier {
  /**
   * Replaces the daemon WS `{type: "environment-change"}` message
   * (work-status-changed / git-refs-changed / thread-storage-changed fan-out
   * from `RuntimeManager.onWorkspaceStatusChanged` /
   * `onThreadStorageChanged`); P1b calls `hub.notifyEnvironment` directly.
   */
  notifyEnvironmentChanged(payload: HostDaemonEnvironmentChangePayload): void;
  /**
   * Replaces the daemon WS `{type: "application-storage-changed"}` message
   * emitted after the engine refreshes its tracked app-data targets.
   */
  notifyApplicationStorageChanged(): void;
  /**
   * Replaces the daemon WS `{type: "application-content-changed"}` message
   * (an app's served `public/` files changed on disk); P1b broadcasts the
   * per-app `content-changed` realtime message via the hub.
   */
  notifyApplicationContentChanged(args: ApplicationContentChangedArgs): void;
}

/**
 * Terminal messages the engine emits (the daemon→server WS half of the
 * terminal protocol). Replaces the `HostDaemonDaemonWsMessage` terminal
 * variants; P1b feeds them to
 * `terminal-session-lifecycle.handleDaemonTerminalMessage` semantics
 * directly (DB session updates + client WS fan-out).
 */
export type EngineTerminalEvent = Extract<
  HostDaemonDaemonWsMessage,
  {
    type:
      | "terminal.opened"
      | "terminal.output"
      | "terminal.replay"
      | "terminal.exited"
      | "terminal.error";
  }
>;

/**
 * Terminal operations the server issues to the engine (the server→daemon WS
 * half). Replaces `HostDaemonServerTerminalMessage`
 * (`server-connection-support.ts`); P1b calls
 * `terminalManager.handleMessage` with these directly.
 */
export type EngineTerminalCommand = Extract<
  HostDaemonServerWsMessage,
  {
    type:
      | "terminal.open"
      | "terminal.attach"
      | "terminal.input"
      | "terminal.resize"
      | "terminal.close";
  }
>;

/**
 * Replaces `TerminalManagerOptions.sendMessage`'s WS send (whose boolean
 * "connection up" result the daemon never consumed — in-process delivery is
 * unconditional, so this returns void).
 */
export type SendTerminalEvent = (message: EngineTerminalEvent) => void;

/**
 * Everything the engine composition root takes from the server. P1b
 * constructs this once in the server boot path; engine unit tests construct
 * fakes. Config values (dataDir, bridgeBundleDir, serverUrl/port, logger,
 * host watcher) are engine constructor options, not ports — they are inputs,
 * not server behavior.
 */
export interface EnginePorts {
  /** Event emission/barrier — replaces the event-buffer spool + `/internal/session/events`. */
  events: ThreadEventSink;
  /** Interactive register/interrupt — replaces `/internal/session/interactive-request[/interrupt]`. */
  interactiveRequests: InteractiveRequestGateway;
  /** Dynamic tool calls — replaces `/internal/session/tool-call`. */
  callTool: CallServerTool;
  /** App-data change/resync notify — replaces `/internal/session/app-data-{change,resync}`. */
  appData: AppDataChangeSink;
  /** Attachment content access — replaces `/internal/session/project-attachment-content`. */
  fetchProjectAttachment: FetchProjectAttachment;
  /** Command-result settlement delivery — replaces `/internal/session/command-result`. */
  deliverCommandResult: DeliverCommandResult;
  /** Environment/app change hints — replaces the non-terminal daemon WS messages. */
  changes: RuntimeChangeNotifier;
  /** Terminal protocol emissions — replaces the terminal daemon WS messages. */
  sendTerminalEvent: SendTerminalEvent;
}
