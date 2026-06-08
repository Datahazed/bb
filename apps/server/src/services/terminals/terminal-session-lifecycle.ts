import { randomUUID } from "node:crypto";
import {
  createTerminalSession,
  getTerminalSessionForThread,
  listTerminalSessionsByEnvironment,
  listTerminalSessionsByThread,
  listVisibleTerminalSessionsByThread,
  markActiveTerminalSessionExited,
  markEnvironmentTerminalSessionsExited,
  markTerminalSessionExited,
  markTerminalSessionRunning,
  markTerminalSessionUserInput,
  markThreadTerminalSessionsExited,
  updateTerminalSessionSize,
  updateTerminalSessionTitle,
  type TerminalSessionRow,
} from "@bb/db";
import type { TerminalSessionCloseReason } from "@bb/domain";
import type {
  CloseThreadTerminalRequest,
  CreateThreadTerminalRequest,
  TerminalClientMessage,
  TerminalOutputChunk,
  TerminalSession,
  UpdateThreadTerminalRequest,
} from "@bb/server-contract";
import type {
  EngineTerminalCommand,
  EngineTerminalEvent,
} from "../../engine/ports.js";
import { ApiError } from "../../errors.js";
import type { AppDeps } from "../../types.js";
import {
  requirePublicThread,
  requireReadyEnvironment,
} from "../lib/entity-lookup.js";
import {
  threadEnvironmentUnavailableDetails,
  throwThreadEnvironmentUnavailable,
} from "../lib/lifecycle-api-errors.js";
import { requireWorkspaceCommandTarget } from "../environments/workspace-command-target.js";

const DEFAULT_TERMINAL_OPEN_TIMEOUT_MS = 10_000;

type TerminalOpenedMessage = Extract<
  EngineTerminalEvent,
  { type: "terminal.opened" }
>;
type TerminalErrorMessage = Extract<
  EngineTerminalEvent,
  { type: "terminal.error" }
>;
type TerminalReplayMessage = Extract<
  EngineTerminalEvent,
  { type: "terminal.replay" }
>;
type TerminalOutputMessage = Extract<
  EngineTerminalEvent,
  { type: "terminal.output" }
>;
type TerminalApiErrorStatus = ConstructorParameters<typeof ApiError>[0];
type RunningBrowserTerminalSession = TerminalSessionRow & {
  status: "running";
};

/**
 * The server→engine half of the terminal protocol: delivers one terminal
 * command to the in-process engine's `TerminalManager` (replacing
 * `hub.sendDaemonSessionMessage`'s WS send). Fire-and-forget — results come
 * back through `handleEngineTerminalEvent`.
 */
export type SendEngineTerminalCommand = (
  message: EngineTerminalCommand,
) => void;

interface TerminalClientSocket {
  close(code?: number, reason?: string): void;
  send(data: string): void;
}

interface PendingTerminalOpen {
  reject: (error: Error) => void;
  resolve: (message: TerminalOpenedMessage) => void;
  timeout: ReturnType<typeof setTimeout>;
  terminalId: string;
}

interface PendingTerminalAttach {
  socket: TerminalClientSocket;
  terminalId: string;
  threadId: string;
  timeout: ReturnType<typeof setTimeout>;
}

interface WaitForTerminalOpenArgs {
  requestId: string;
  terminalId: string;
}

interface WaitForTerminalAttachArgs {
  requestId: string;
  socket: TerminalClientSocket;
  terminalId: string;
  threadId: string;
}

interface RejectPendingOpenForTerminalArgs {
  code: string;
  message: string;
  status: TerminalApiErrorStatus;
  terminalId: string;
}

interface RequestTerminalClosesArgs {
  closeReason: TerminalSessionCloseReason;
  sessions: readonly TerminalSessionRow[];
}

interface PublishLifecycleTerminalExitsArgs {
  code: string;
  message: string;
  sessions: readonly TerminalSessionRow[];
}

interface NotifyExitedTerminalSessionArgs {
  code: string;
  message: string;
  session: TerminalSessionRow;
}

interface AttachBrowserTerminalArgs {
  socket: TerminalClientSocket;
  terminalId: string;
  threadId: string;
}

interface DetachBrowserTerminalArgs {
  socket: TerminalClientSocket;
  terminalId: string;
}

interface HandleBrowserTerminalMessageArgs {
  message: TerminalClientMessage;
  socket: TerminalClientSocket;
  terminalId: string;
  threadId: string;
}

interface GetRunningBrowserTerminalArgs {
  socket: TerminalClientSocket;
  terminalId: string;
  threadId: string;
}

interface SendTerminalSocketErrorArgs {
  code: string;
  message: string;
  socket: TerminalClientSocket;
}

interface RejectPendingAttachesForTerminalArgs {
  code: string;
  message: string;
  terminalId: string;
}

interface CloseStaleOpenedTerminalArgs {
  terminalId: string;
  threadId: string;
}

interface PublishLifecycleTerminalExitsForSessionsArgs {
  exitedSessions: TerminalSessionRow[];
  message: string;
}

interface CloseThreadTerminalsForLifecycleArgs {
  closeReason: TerminalSessionCloseReason;
  message: string;
  threadId: string;
}

interface TerminalSessionLifecycleOptions {
  attachTimeoutMs?: number;
  db: AppDeps["db"];
  hub: AppDeps["hub"];
  openTimeoutMs?: number;
}

interface CreateThreadTerminalArgs {
  payload: CreateThreadTerminalRequest;
  threadId: string;
}

interface RenameThreadTerminalArgs {
  payload: UpdateThreadTerminalRequest;
  terminalId: string;
  threadId: string;
}

interface CloseThreadTerminalArgs {
  payload: CloseThreadTerminalRequest;
  terminalId: string;
  threadId: string;
}

interface CloseDeletedThreadTerminalsArgs {
  threadId: string;
}

interface CloseArchivedThreadTerminalsArgs {
  threadId: string;
}

interface CloseDestroyedEnvironmentTerminalsArgs {
  environmentId: string;
}

function toTerminalOutputChunk(
  chunk: TerminalOutputMessage["chunk"],
): TerminalOutputChunk {
  return {
    seq: chunk.seq,
    dataBase64: chunk.dataBase64,
  };
}

/** True while the in-process engine still owns a live PTY for the row. */
function isEngineOwnedTerminalSession(row: TerminalSessionRow): boolean {
  return row.status === "starting" || row.status === "running";
}

function isRunningBrowserTerminalSession(
  row: TerminalSessionRow,
): row is RunningBrowserTerminalSession {
  return row.status === "running";
}

export function toTerminalSession(row: TerminalSessionRow): TerminalSession {
  return {
    id: row.id,
    threadId: row.threadId,
    environmentId: row.environmentId,
    hostId: row.hostId,
    title: row.title,
    initialCwd: row.initialCwd,
    currentCwd: row.currentCwd,
    cols: row.cols,
    rows: row.rows,
    status: row.status,
    exitCode: row.exitCode,
    closeReason: row.closeReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastUserInputAt: row.lastUserInputAt,
  };
}

export class TerminalSessionLifecycle {
  private readonly attachTimeoutMs: number;
  private readonly pendingAttaches = new Map<string, PendingTerminalAttach>();
  private readonly pendingOpens = new Map<string, PendingTerminalOpen>();
  private readonly openTimeoutMs: number;
  private sendEngineCommand: SendEngineTerminalCommand | null = null;

  constructor(private readonly options: TerminalSessionLifecycleOptions) {
    this.attachTimeoutMs =
      options.attachTimeoutMs ?? DEFAULT_TERMINAL_OPEN_TIMEOUT_MS;
    this.openTimeoutMs =
      options.openTimeoutMs ?? DEFAULT_TERMINAL_OPEN_TIMEOUT_MS;
  }

  /**
   * Late-bound like the engine command dispatcher: the lifecycle sits on
   * `AppDeps` while the engine's `TerminalManager` exists only after boot
   * composition (`startServerEngine`). Sending before `bindEngine` is a
   * boot-order bug and throws.
   */
  bindEngine(sendCommand: SendEngineTerminalCommand): void {
    this.sendEngineCommand = sendCommand;
  }

  private requireEngineSender(): SendEngineTerminalCommand {
    if (!this.sendEngineCommand) {
      throw new Error(
        "Terminal session lifecycle is not bound to an engine terminal manager",
      );
    }
    return this.sendEngineCommand;
  }

  listThreadTerminals(threadId: string): TerminalSession[] {
    requirePublicThread(this.options.db, threadId);
    return listVisibleTerminalSessionsByThread(this.options.db, threadId).map(
      toTerminalSession,
    );
  }

  async createThreadTerminal(
    args: CreateThreadTerminalArgs,
  ): Promise<TerminalSession> {
    const sendEngineCommand = this.requireEngineSender();
    const thread = requirePublicThread(this.options.db, args.threadId);
    if (!thread.environmentId) {
      throwThreadEnvironmentUnavailable(
        threadEnvironmentUnavailableDetails("never_attached", null),
      );
    }
    const environment = requireReadyEnvironment(
      this.options.db,
      thread.environmentId,
    );
    const target = requireWorkspaceCommandTarget(environment);
    const existingSessions = listTerminalSessionsByThread(
      this.options.db,
      thread.id,
    );
    const title = `Terminal ${existingSessions.length + 1}`;
    const startingSession = createTerminalSession(this.options.db, {
      cols: args.payload.cols,
      currentCwd: null,
      environmentId: environment.id,
      hostId: environment.hostId,
      initialCwd: environment.path,
      rows: args.payload.rows,
      status: "starting",
      threadId: thread.id,
      title,
    });
    const requestId = randomUUID();

    const pendingOpen = this.waitForTerminalOpen({
      requestId,
      terminalId: startingSession.id,
    });
    sendEngineCommand({
      type: "terminal.open",
      requestId,
      terminalId: startingSession.id,
      threadId: thread.id,
      environmentId: target.environmentId,
      workspaceContext: target.workspaceContext,
      cols: args.payload.cols,
      rows: args.payload.rows,
    });

    let opened: TerminalOpenedMessage;
    try {
      opened = await pendingOpen;
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.body.code === "terminal_open_timeout"
      ) {
        const exited = markTerminalSessionExited(this.options.db, {
          terminalId: startingSession.id,
          exitCode: null,
          closeReason: "open-timeout",
        });
        if (exited) {
          this.notifyThreadTerminalsChanged(exited.threadId);
        }
        sendEngineCommand({
          type: "terminal.close",
          terminalId: startingSession.id,
          reason: "open-timeout",
        });
      } else {
        const exited = markTerminalSessionExited(this.options.db, {
          terminalId: startingSession.id,
          exitCode: null,
          closeReason: "process-exit",
        });
        if (exited) {
          this.notifyThreadTerminalsChanged(exited.threadId);
        }
      }
      throw error;
    }

    const runningSession = markTerminalSessionRunning(this.options.db, {
      cols: opened.cols,
      currentCwd: opened.currentCwd,
      initialCwd: opened.initialCwd,
      rows: opened.rows,
      terminalId: startingSession.id,
      title: opened.title,
    });
    if (!runningSession) {
      this.closeStaleOpenedTerminal({
        terminalId: startingSession.id,
        threadId: thread.id,
      });
      throw new ApiError(
        409,
        "terminal_open_cancelled",
        "Terminal session was cancelled before it opened",
      );
    }
    this.notifyThreadTerminalsChanged(runningSession.threadId);
    return toTerminalSession(runningSession);
  }

  renameThreadTerminal(args: RenameThreadTerminalArgs): TerminalSession {
    requirePublicThread(this.options.db, args.threadId);
    const renamed = updateTerminalSessionTitle(this.options.db, {
      terminalId: args.terminalId,
      threadId: args.threadId,
      title: args.payload.title,
    });
    if (!renamed) {
      throw new ApiError(
        404,
        "terminal_not_found",
        "Terminal session not found",
      );
    }
    this.notifyThreadTerminalsChanged(renamed.threadId);
    const session = toTerminalSession(renamed);
    this.options.hub.sendTerminalClientMessage(renamed.id, {
      type: "session-updated",
      session,
    });
    return session;
  }

  closeThreadTerminal(args: CloseThreadTerminalArgs): TerminalSession {
    requirePublicThread(this.options.db, args.threadId);
    const current = getTerminalSessionForThread(this.options.db, {
      terminalId: args.terminalId,
      threadId: args.threadId,
    });
    if (!current) {
      throw new ApiError(
        404,
        "terminal_not_found",
        "Terminal session not found",
      );
    }
    if (current.status === "exited") {
      return toTerminalSession(current);
    }
    if (args.payload.mode === "if-clean" && current.lastUserInputAt !== null) {
      return toTerminalSession(current);
    }
    if (isEngineOwnedTerminalSession(current)) {
      this.requireEngineSender()({
        type: "terminal.close",
        terminalId: current.id,
        reason: args.payload.reason,
      });
    }
    const closed = markTerminalSessionExited(this.options.db, {
      terminalId: current.id,
      exitCode: current.exitCode,
      closeReason: args.payload.reason,
    });
    const session = closed ?? current;
    const terminalSession = toTerminalSession(session);
    this.notifyExitedTerminalSession({
      session,
      code: "terminal_closed",
      message: "Terminal session closed",
    });
    return terminalSession;
  }

  closeDeletedThreadTerminals(args: CloseDeletedThreadTerminalsArgs): void {
    this.closeThreadTerminalsForLifecycle({
      threadId: args.threadId,
      closeReason: "thread-deleted",
      message: "Terminal session closed because the thread was deleted",
    });
  }

  closeArchivedThreadTerminals(args: CloseArchivedThreadTerminalsArgs): void {
    this.closeThreadTerminalsForLifecycle({
      threadId: args.threadId,
      closeReason: "thread-archived",
      message: "Terminal session closed because the thread was archived",
    });
  }

  closeDestroyedEnvironmentTerminals(
    args: CloseDestroyedEnvironmentTerminalsArgs,
  ): void {
    const currentSessions = listTerminalSessionsByEnvironment(
      this.options.db,
      args.environmentId,
    );
    this.requestTerminalCloses({
      closeReason: "environment-destroyed",
      sessions: currentSessions,
    });
    const exitedSessions = markEnvironmentTerminalSessionsExited(
      this.options.db,
      {
        environmentId: args.environmentId,
        closeReason: "environment-destroyed",
      },
    );
    this.publishLifecycleTerminalExitsForSessions({
      exitedSessions,
      message: "Terminal session closed because the environment was destroyed",
    });
  }

  attachBrowserTerminal(args: AttachBrowserTerminalArgs): void {
    requirePublicThread(this.options.db, args.threadId);
    const current = getTerminalSessionForThread(this.options.db, {
      terminalId: args.terminalId,
      threadId: args.threadId,
    });
    if (!current) {
      throw new ApiError(
        404,
        "terminal_not_found",
        "Terminal session not found",
      );
    }

    this.options.hub.registerTerminalClient(current.id, args.socket);
    const session = toTerminalSession(current);
    if (!isRunningBrowserTerminalSession(current)) {
      this.options.hub.sendTerminalSocketMessage(args.socket, {
        type: "attached",
        session,
        nextSeq: 0,
      });
      if (current.status === "exited") {
        this.options.hub.sendTerminalSocketMessage(args.socket, {
          type: "exited",
          session,
        });
      } else {
        this.sendTerminalSocketError({
          socket: args.socket,
          code: "terminal_not_running",
          message: "Terminal session is not running",
        });
      }
      return;
    }

    const requestId = randomUUID();
    this.waitForTerminalAttach({
      requestId,
      socket: args.socket,
      terminalId: current.id,
      threadId: args.threadId,
    });
    this.requireEngineSender()({
      type: "terminal.attach",
      requestId,
      terminalId: current.id,
      sinceSeq: 0,
    });
  }

  detachBrowserTerminal(args: DetachBrowserTerminalArgs): void {
    this.options.hub.unregisterTerminalClient(args.terminalId, args.socket);
    for (const [requestId, pending] of this.pendingAttaches) {
      if (
        pending.terminalId === args.terminalId &&
        pending.socket === args.socket
      ) {
        clearTimeout(pending.timeout);
        this.pendingAttaches.delete(requestId);
      }
    }
  }

  handleBrowserTerminalMessage(args: HandleBrowserTerminalMessageArgs): void {
    switch (args.message.type) {
      case "ping":
        this.options.hub.sendTerminalSocketMessage(args.socket, {
          type: "pong",
        });
        return;
      case "input":
        this.forwardBrowserTerminalInput(args);
        return;
      case "resize":
        this.resizeBrowserTerminal(args);
        return;
      case "close":
        this.closeThreadTerminal({
          threadId: args.threadId,
          terminalId: args.terminalId,
          payload: { mode: "force", reason: args.message.reason },
        });
        return;
    }
  }

  /**
   * The engine→server half of the terminal protocol (the daemon→server WS
   * messages, now delivered in-process through the engine's
   * `sendTerminalEvent` port).
   */
  handleEngineTerminalEvent(message: EngineTerminalEvent): void {
    switch (message.type) {
      case "terminal.opened":
        this.resolvePendingOpen(message);
        return;
      case "terminal.error":
        this.rejectPendingOpen(message);
        this.rejectPendingAttach(message);
        return;
      case "terminal.exited": {
        const exited = markActiveTerminalSessionExited(this.options.db, {
          terminalId: message.terminalId,
          exitCode: message.exitCode,
          closeReason: message.closeReason,
        });
        if (exited) {
          this.notifyThreadTerminalsChanged(exited.threadId);
          const session = toTerminalSession(exited);
          this.options.hub.sendTerminalClientMessage(exited.id, {
            type: "exited",
            session,
          });
          this.rejectPendingAttachesForTerminal({
            terminalId: exited.id,
            code: "terminal_exited",
            message: "Terminal session exited",
          });
        }
        return;
      }
      case "terminal.output":
        this.options.hub.sendTerminalClientMessage(message.terminalId, {
          type: "output",
          chunk: toTerminalOutputChunk(message.chunk),
        });
        return;
      case "terminal.replay":
        this.resolvePendingAttach(message);
        return;
    }
  }

  private closeThreadTerminalsForLifecycle(
    args: CloseThreadTerminalsForLifecycleArgs,
  ): void {
    const currentSessions = listTerminalSessionsByThread(
      this.options.db,
      args.threadId,
    );
    this.requestTerminalCloses({
      closeReason: args.closeReason,
      sessions: currentSessions,
    });
    const exitedSessions = markThreadTerminalSessionsExited(this.options.db, {
      threadId: args.threadId,
      closeReason: args.closeReason,
    });
    this.publishLifecycleTerminalExitsForSessions({
      exitedSessions,
      message: args.message,
    });
  }

  private publishLifecycleTerminalExitsForSessions(
    args: PublishLifecycleTerminalExitsForSessionsArgs,
  ): void {
    this.publishLifecycleTerminalExits({
      code: "terminal_closed",
      message: args.message,
      sessions: args.exitedSessions,
    });
  }

  private requestTerminalCloses(args: RequestTerminalClosesArgs): void {
    for (const session of args.sessions) {
      if (!isEngineOwnedTerminalSession(session)) {
        continue;
      }
      this.requireEngineSender()({
        type: "terminal.close",
        terminalId: session.id,
        reason: args.closeReason,
      });
    }
  }

  private closeStaleOpenedTerminal(args: CloseStaleOpenedTerminalArgs): void {
    const current = getTerminalSessionForThread(this.options.db, {
      terminalId: args.terminalId,
      threadId: args.threadId,
    });
    this.requireEngineSender()({
      type: "terminal.close",
      terminalId: args.terminalId,
      reason: current?.closeReason ?? "daemon-disconnect",
    });
  }

  private publishLifecycleTerminalExits(
    args: PublishLifecycleTerminalExitsArgs,
  ): void {
    for (const session of args.sessions) {
      this.rejectPendingOpenForTerminal({
        terminalId: session.id,
        status: 409,
        code: args.code,
        message: args.message,
      });
      this.notifyExitedTerminalSession({
        session,
        code: args.code,
        message: args.message,
      });
    }
  }

  private notifyExitedTerminalSession(
    args: NotifyExitedTerminalSessionArgs,
  ): void {
    this.notifyThreadTerminalsChanged(args.session.threadId);
    this.options.hub.sendTerminalClientMessage(args.session.id, {
      type: "exited",
      session: toTerminalSession(args.session),
    });
    this.rejectPendingAttachesForTerminal({
      terminalId: args.session.id,
      code: args.code,
      message: args.message,
    });
  }

  private forwardBrowserTerminalInput(
    args: HandleBrowserTerminalMessageArgs,
  ): void {
    if (args.message.type !== "input") {
      return;
    }
    const current = this.getRunningBrowserTerminal(args);
    if (!current) {
      return;
    }
    const markedInput = markTerminalSessionUserInput(this.options.db, {
      terminalId: current.id,
      threadId: args.threadId,
    });
    if (markedInput) {
      const session = toTerminalSession(markedInput);
      this.notifyThreadTerminalsChanged(markedInput.threadId);
      this.options.hub.sendTerminalClientMessage(markedInput.id, {
        type: "session-updated",
        session,
      });
    }
    this.requireEngineSender()({
      type: "terminal.input",
      terminalId: current.id,
      dataBase64: args.message.dataBase64,
    });
  }

  private resizeBrowserTerminal(args: HandleBrowserTerminalMessageArgs): void {
    if (args.message.type !== "resize") {
      return;
    }
    const current = this.getRunningBrowserTerminal(args);
    if (!current) {
      return;
    }
    if (
      current.cols !== args.message.cols ||
      current.rows !== args.message.rows
    ) {
      const resized = updateTerminalSessionSize(this.options.db, {
        cols: args.message.cols,
        rows: args.message.rows,
        terminalId: current.id,
        threadId: args.threadId,
      });
      if (resized) {
        const session = toTerminalSession(resized);
        this.notifyThreadTerminalsChanged(resized.threadId);
        this.options.hub.sendTerminalClientMessage(resized.id, {
          type: "session-updated",
          session,
        });
      }
    }
    this.requireEngineSender()({
      type: "terminal.resize",
      terminalId: current.id,
      cols: args.message.cols,
      rows: args.message.rows,
    });
  }

  private getRunningBrowserTerminal(
    args: GetRunningBrowserTerminalArgs,
  ): RunningBrowserTerminalSession | null {
    requirePublicThread(this.options.db, args.threadId);
    const current = getTerminalSessionForThread(this.options.db, {
      terminalId: args.terminalId,
      threadId: args.threadId,
    });
    if (!current) {
      this.sendTerminalSocketError({
        socket: args.socket,
        code: "terminal_not_found",
        message: "Terminal session not found",
      });
      return null;
    }
    if (!isRunningBrowserTerminalSession(current)) {
      this.sendTerminalSocketError({
        socket: args.socket,
        code: "terminal_not_running",
        message: "Terminal session is not running",
      });
      return null;
    }
    return current;
  }

  private waitForTerminalOpen(
    args: WaitForTerminalOpenArgs,
  ): Promise<TerminalOpenedMessage> {
    return new Promise<TerminalOpenedMessage>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingOpens.delete(args.requestId);
        reject(
          new ApiError(
            504,
            "terminal_open_timeout",
            "Timed out opening terminal session",
          ),
        );
      }, this.openTimeoutMs);
      this.pendingOpens.set(args.requestId, {
        reject,
        resolve,
        timeout,
        terminalId: args.terminalId,
      });
    });
  }

  private waitForTerminalAttach(args: WaitForTerminalAttachArgs): void {
    const timeout = setTimeout(() => {
      this.pendingAttaches.delete(args.requestId);
      this.sendTerminalSocketError({
        socket: args.socket,
        code: "terminal_attach_timeout",
        message: "Timed out attaching terminal session",
      });
    }, this.attachTimeoutMs);
    this.pendingAttaches.set(args.requestId, {
      socket: args.socket,
      terminalId: args.terminalId,
      threadId: args.threadId,
      timeout,
    });
  }

  private resolvePendingOpen(message: TerminalOpenedMessage): void {
    const pending = this.pendingOpens.get(message.requestId);
    if (!pending || pending.terminalId !== message.terminalId) {
      return;
    }
    clearTimeout(pending.timeout);
    this.pendingOpens.delete(message.requestId);
    pending.resolve(message);
  }

  private resolvePendingAttach(message: TerminalReplayMessage): void {
    const pending = this.pendingAttaches.get(message.requestId);
    if (!pending || pending.terminalId !== message.terminalId) {
      return;
    }
    clearTimeout(pending.timeout);
    this.pendingAttaches.delete(message.requestId);

    const current = getTerminalSessionForThread(this.options.db, {
      terminalId: pending.terminalId,
      threadId: pending.threadId,
    });
    if (!current) {
      this.sendTerminalSocketError({
        socket: pending.socket,
        code: "terminal_not_found",
        message: "Terminal session not found",
      });
      return;
    }

    this.options.hub.sendTerminalSocketMessage(pending.socket, {
      type: "attached",
      session: toTerminalSession(current),
      nextSeq: message.nextSeq,
    });
    for (const chunk of message.chunks) {
      this.options.hub.sendTerminalSocketMessage(pending.socket, {
        type: "output",
        chunk: toTerminalOutputChunk(chunk),
      });
    }
  }

  private rejectPendingOpen(message: TerminalErrorMessage): void {
    const pending = this.pendingOpens.get(message.requestId);
    if (!pending || pending.terminalId !== message.terminalId) {
      return;
    }
    clearTimeout(pending.timeout);
    this.pendingOpens.delete(message.requestId);
    pending.reject(
      new ApiError(
        502,
        message.code,
        `Terminal failed to open: ${message.message}`,
      ),
    );
  }

  private rejectPendingAttach(message: TerminalErrorMessage): void {
    const pending = this.pendingAttaches.get(message.requestId);
    if (!pending || pending.terminalId !== message.terminalId) {
      return;
    }
    clearTimeout(pending.timeout);
    this.pendingAttaches.delete(message.requestId);
    this.sendTerminalSocketError({
      socket: pending.socket,
      code: message.code,
      message: message.message,
    });
  }

  private rejectPendingOpenForTerminal(
    args: RejectPendingOpenForTerminalArgs,
  ): void {
    for (const [requestId, pending] of this.pendingOpens) {
      if (pending.terminalId !== args.terminalId) {
        continue;
      }
      clearTimeout(pending.timeout);
      this.pendingOpens.delete(requestId);
      pending.reject(new ApiError(args.status, args.code, args.message));
    }
  }

  private rejectPendingAttachesForTerminal(
    args: RejectPendingAttachesForTerminalArgs,
  ): void {
    for (const [requestId, pending] of this.pendingAttaches) {
      if (pending.terminalId !== args.terminalId) {
        continue;
      }
      clearTimeout(pending.timeout);
      this.pendingAttaches.delete(requestId);
      this.sendTerminalSocketError({
        socket: pending.socket,
        code: args.code,
        message: args.message,
      });
    }
  }

  private sendTerminalSocketError(args: SendTerminalSocketErrorArgs): void {
    this.options.hub.sendTerminalSocketMessage(args.socket, {
      type: "error",
      code: args.code,
      message: args.message,
    });
  }

  private notifyThreadTerminalsChanged(threadId: string): void {
    this.options.hub.notifyThread(threadId, ["terminals-changed"]);
  }
}
