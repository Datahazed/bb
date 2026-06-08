import { createReplayRawProviderEventTranslator } from "@bb/agent-runtime";
import {
  getThreadEventScopeTurnId,
  requireThreadEventScopeTurnId,
  threadScope,
  turnScope,
  type ThreadEvent,
  type ThreadEventTurnStatus,
} from "@bb/domain";
import type { HostDaemonOnlineRpcCommand } from "../contract/commands.js";
import { replayRawProviderEventsPath } from "@bb/replay-capture";
import {
  deleteReplayCapture,
  listReplayCaptureSummaries,
  readReplayCaptureManifest,
  requireReplayCaptureFile,
  streamRawProviderRecords,
  type ReplayCaptureReadArgs,
} from "@bb/replay-capture/reader";
import type {
  ReplayCaptureDaemonListResponse,
  ReplayCaptureManifest,
} from "@bb/replay-capture/schema";
import {
  ReplayPlaybackAbortError,
  remapReplayThreadEvent,
  replayTerminalIdentifiers,
  streamRawProviderReplayEvents,
  waitForReplayTime,
  type ReplayEventRecord,
  type ReplayTerminalIdentifiers,
  type ReplayTimingState,
} from "@bb/replay-capture/playback";
import type { ReplayTaskHandle } from "../core/command-dispatch-support.js";
import { CommandDispatchError } from "../core/command-dispatch-support.js";
import { normalizeCaughtError } from "../core/error-utils.js";
import type { ThreadEventSink } from "../ports.js";

export interface ReplayCommandOptions {
  dataDir: string;
  eventSink?: ThreadEventSink;
  replayTasks?: Map<string, ReplayTaskHandle>;
}

interface ReplayTranslatedEventsArgs {
  command: ReplayRunCommand;
  events: AsyncIterable<ReplayEventRecord>;
  eventSink: ThreadEventSink;
  terminal: ReplayTerminalIdentifiers;
  timing: ReplayTimingState;
  signal: AbortSignal;
}

interface ReplayPlan {
  events: () => AsyncIterable<ReplayEventRecord>;
  terminal: ReplayTerminalIdentifiers;
}

type ReplayCaptureGetCommand = Extract<
  HostDaemonOnlineRpcCommand,
  { type: "development.replay"; operation: "capture-get" }
>;
type ReplayCaptureDeleteCommand = Extract<
  HostDaemonOnlineRpcCommand,
  { type: "development.replay"; operation: "capture-delete" }
>;
type ReplayRunCommand = Extract<
  HostDaemonOnlineRpcCommand,
  { type: "development.replay"; operation: "run" }
>;
type EmptyReplayResult = Record<string, never>;

export async function listReplayCaptures(
  options: ReplayCommandOptions,
): Promise<ReplayCaptureDaemonListResponse> {
  return {
    captures: await listReplayCaptureSummaries(options.dataDir),
  };
}

export async function getReplayCapture(
  command: ReplayCaptureGetCommand,
  options: ReplayCommandOptions,
): Promise<ReplayCaptureManifest> {
  return readReplayCaptureManifest({
    captureId: command.captureId,
    dataDir: options.dataDir,
  });
}

export async function removeReplayCapture(
  command: ReplayCaptureDeleteCommand,
  options: ReplayCommandOptions,
): Promise<EmptyReplayResult> {
  await deleteReplayCapture({
    captureId: command.captureId,
    dataDir: options.dataDir,
  });
  return {};
}

function terminalEvent(args: {
  command: ReplayRunCommand;
  terminal: ReplayTerminalIdentifiers;
  status: ThreadEventTurnStatus;
  errorMessage?: string;
}): ThreadEvent {
  return {
    type: "turn/completed",
    threadId: args.command.threadId,
    providerThreadId: args.terminal.providerThreadId,
    scope: turnScope(args.terminal.turnId),
    status: args.status,
    ...(args.errorMessage ? { error: { message: args.errorMessage } } : {}),
  };
}

function emitReplaySystemError(args: {
  command: ReplayRunCommand;
  error: Error;
  eventSink: ThreadEventSink;
}): void {
  args.eventSink.emit({
    threadId: args.command.threadId,
    event: {
      type: "system/error",
      threadId: args.command.threadId,
      scope: threadScope(),
      code: "replay_failed",
      message: args.error.message,
    },
  });
}

function emitReplayTerminal(args: {
  command: ReplayRunCommand;
  eventSink: ThreadEventSink;
  status: ThreadEventTurnStatus;
  terminal: ReplayTerminalIdentifiers;
  errorMessage?: string;
}): void {
  args.eventSink.emit({
    threadId: args.command.threadId,
    event: terminalEvent(args),
  });
}

async function replayTranslatedEvents(
  args: ReplayTranslatedEventsArgs,
): Promise<void> {
  let emittedTerminal = false;
  let pendingInputAcceptedRequestId: typeof args.command.requestId | null =
    args.command.requestId;
  for await (const replayEvent of args.events) {
    const { event, relativeMs } = replayEvent;
    await waitForReplayTime({
      relativeMs,
      signal: args.signal,
      timing: args.timing,
    });
    const remappedEvent = remapReplayThreadEvent({
      event,
      providerThreadId: args.terminal.providerThreadId,
      threadId: args.command.threadId,
    });
    args.terminal.turnId =
      getThreadEventScopeTurnId(remappedEvent.scope) ?? args.terminal.turnId;
    args.eventSink.emit({
      threadId: args.command.threadId,
      event: remappedEvent,
    });
    if (
      pendingInputAcceptedRequestId !== null &&
      remappedEvent.type === "turn/started"
    ) {
      const turnId = requireThreadEventScopeTurnId({
        type: remappedEvent.type,
        scope: remappedEvent.scope,
      });
      args.eventSink.emit({
        threadId: args.command.threadId,
        event: {
          type: "turn/input/accepted",
          threadId: args.command.threadId,
          providerThreadId: remappedEvent.providerThreadId,
          scope: turnScope(turnId),
          clientRequestId: pendingInputAcceptedRequestId,
        },
      });
      pendingInputAcceptedRequestId = null;
    }
    emittedTerminal ||= remappedEvent.type === "turn/completed";
  }

  if (!emittedTerminal) {
    emitReplayTerminal({
      command: args.command,
      eventSink: args.eventSink,
      status: "completed",
      terminal: args.terminal,
    });
  }
  await args.eventSink.flush();
}

export async function runReplay(
  command: ReplayRunCommand,
  options: ReplayCommandOptions,
): Promise<EmptyReplayResult> {
  const eventSink = options.eventSink;
  if (!eventSink) {
    throw new CommandDispatchError(
      "replay_unavailable",
      "Replay requires an event sink",
    );
  }
  const replayTasks = options.replayTasks;
  if (!replayTasks) {
    throw new CommandDispatchError(
      "replay_unavailable",
      "Replay requires a task registry",
    );
  }
  if (replayTasks.has(command.threadId)) {
    throw new CommandDispatchError(
      "replay_already_running",
      "Replay is already running",
    );
  }

  const readArgs: ReplayCaptureReadArgs = {
    captureId: command.captureId,
    dataDir: options.dataDir,
  };
  let plan: ReplayPlan;
  try {
    plan = await buildReplayPlan(command, readArgs);
  } catch (error) {
    const failure = normalizeCaughtError(error);
    await emitReplayFailure({
      command,
      eventSink,
      error: failure,
      terminal: {
        providerThreadId: `replay:${command.captureId}`,
        turnId: `replay:${command.captureId}`,
      },
    });
    throw error;
  }

  const abort = new AbortController();
  const task: ReplayTaskHandle = {
    abort,
    done: Promise.resolve(),
  };
  replayTasks.set(command.threadId, task);
  task.done = runReplayTask({
    command,
    eventSink,
    plan,
    signal: abort.signal,
  }).finally(() => {
    replayTasks.delete(command.threadId);
  });

  return {};
}

async function buildReplayPlan(
  command: ReplayRunCommand,
  readArgs: ReplayCaptureReadArgs,
): Promise<ReplayPlan> {
  const manifest = await readReplayCaptureManifest(readArgs);
  const terminal = replayTerminalIdentifiers(manifest);

  await requireReplayCaptureFile(
    replayRawProviderEventsPath(readArgs.dataDir, readArgs.captureId),
  );
  const translator = createReplayRawProviderEventTranslator({
    bbThreadId: command.threadId,
    providerId: manifest.providerId,
  });
  return {
    events: () =>
      streamRawProviderReplayEvents({
        records: streamRawProviderRecords(readArgs),
        translator,
      }),
    terminal,
  };
}

async function runReplayTask(args: {
  command: ReplayRunCommand;
  eventSink: ThreadEventSink;
  plan: ReplayPlan;
  signal: AbortSignal;
}): Promise<void> {
  const timing: ReplayTimingState = {
    previousRelativeMs: 0,
    speed: args.command.speed,
  };

  try {
    await replayTranslatedEvents({
      command: args.command,
      eventSink: args.eventSink,
      events: args.plan.events(),
      signal: args.signal,
      terminal: args.plan.terminal,
      timing,
    });
  } catch (error) {
    if (error instanceof ReplayPlaybackAbortError || args.signal.aborted) {
      emitReplayTerminal({
        command: args.command,
        eventSink: args.eventSink,
        status: "interrupted",
        terminal: args.plan.terminal,
      });
      await args.eventSink.flush();
      return;
    }

    const failure = normalizeCaughtError(error);
    await emitReplayFailure({
      command: args.command,
      eventSink: args.eventSink,
      error: failure,
      terminal: args.plan.terminal,
    });
  }
}

async function emitReplayFailure(args: {
  command: ReplayRunCommand;
  error: Error;
  eventSink: ThreadEventSink;
  terminal: ReplayTerminalIdentifiers;
}): Promise<void> {
  emitReplaySystemError(args);
  emitReplayTerminal({
    command: args.command,
    eventSink: args.eventSink,
    status: "failed",
    terminal: args.terminal,
    errorMessage: args.error.message,
  });
  await args.eventSink.flush();
}
