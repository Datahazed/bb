import type { AgentRuntimeOptions } from "@bb/agent-runtime";
import { resolveDataDirSkillsRootPath } from "@bb/config/app-storage-paths";
import { createHostWatcher, type HostWatcher } from "@bb/host-watcher";
import { createReplayCaptureService } from "@bb/replay-capture/writer";
import { AppDataChangeReporter } from "../environment/app-data-change-reporter.js";
import {
  ensureAppDataRootPath,
  ensureAppsRootPath,
  listApplicationDataTargetsFromRoot,
} from "../environment/app-data-files.js";
import { cleanupInjectedSkillStagingDirs } from "../environment/injected-skills.js";
import { ensureThreadStorageRoot } from "../environment/thread-storage-root.js";
import type {
  EngineLogger,
  EnginePorts,
  InterruptInteractiveRequestsArgs,
} from "../ports.js";
import { TerminalManager } from "../terminals/terminal-manager.js";
import { CommandRouter } from "./command-router.js";
import {
  defaultListModels,
  shutdownDefaultListModelsRuntimes,
  type ReplayTaskRegistry,
} from "./command-dispatch-support.js";
import { runtimeErrorLogFields, summarizeError } from "./error-utils.js";
import {
  InteractiveRequestRegistry,
  InteractiveRequestRegistryError,
} from "./interactive-request-registry.js";
import {
  RuntimeManager,
  type RuntimeManagerOptions,
} from "./runtime-manager.js";

/**
 * Inputs to the engine composition root — the in-process adaptation of the
 * daemon's `CreateHostDaemonAppOptions`. Transport identity (hostKey/hostId/
 * instanceId), the local-API config, and the server URL died with the daemon
 * process; everything the engine needs from the server arrives through
 * `ports` (see `../ports.ts`). Plain config values stay constructor options.
 */
export interface CreateEngineOptions {
  dataDir: string;
  ports: EnginePorts;
  logger: EngineLogger;
  /** Bridge bundle location; P1b boot wiring feeds it from BB_BRIDGE_DIR. */
  bridgeBundleDir?: string;
  /**
   * Filesystem watcher; defaults to the real parcel watcher. Tests inject a
   * fake. (`hostType` is pinned to `"persistent"` — the single synthetic
   * local host is always a persistent host.)
   */
  hostWatcher?: HostWatcher;
  createRuntime?: RuntimeManagerOptions["createRuntime"];
  /**
   * Prepared shell env injected into provider runtimes and terminals
   * (PATH with the bb CLI, BB_SERVER_URL, …). P1b boot wiring builds it via
   * `prepareRuntimeShellEnv` from BB_CLI_DIR + the server's own URL/port,
   * exactly as the daemon's `start-host-daemon.ts` did.
   */
  runtimeShellEnv?: AgentRuntimeOptions["shellEnv"];
  threadStorageRootPath?: string;
  devReplayCapture?: boolean;
}

export interface Engine {
  router: CommandRouter;
  runtimeManager: RuntimeManager;
  terminalManager: TerminalManager;
  /**
   * P1b requirement: the dispatch shim must drain in-flight
   * `router.handleCommands` work before calling this — the daemon ran
   * `commandFetchLoop.stopAndDrain()` before killing runtimes
   * (`apps/host-daemon/src/app.ts:874`); `shutdown` itself does not await
   * in-flight dispatches, so calling it with work outstanding kills provider
   * processes mid-command.
   */
  shutdown: () => Promise<void>;
}

/**
 * Builds the in-process engine: runtime manager + lane-scheduling command
 * router + terminal manager, wired to the server through `EnginePorts`.
 * Adapted from the daemon's `createHostDaemonApp` — the command fetch loop,
 * server WS connection, durable event spool, and pending-interrupt retry
 * timer are all gone; their roles are direct port calls.
 *
 * The server's boot composition (`services/engine/server-engine.ts`) is the
 * only production caller; engine unit tests construct fakes.
 *
 * Boot requirement — watcher seeding: the daemon seeded its watchers from
 * the session-open payload (`app.ts:818-826`). App-data targets are seeded
 * here (the engine scans its own apps root before returning); thread-storage
 * targets must be seeded by the boot wiring via
 * `runtimeManager.replaceTrackedThreadStorageTargets` with the live threads
 * from the DB (`services/engine/server-engine.ts`) — otherwise pre-existing
 * threads lose watching until they are next touched.
 */
export async function createEngine(
  options: CreateEngineOptions,
): Promise<Engine> {
  const { logger, ports } = options;
  const threadStorageRootPath = await ensureThreadStorageRoot(
    options.dataDir,
    options.threadStorageRootPath
      ? { env: { BB_THREAD_STORAGE: options.threadStorageRootPath } }
      : {},
  );
  const appsRootPath = await ensureAppsRootPath(options.dataDir);
  const appDataRootPath = await ensureAppDataRootPath(options.dataDir);
  const dataDirSkillsRootPath = resolveDataDirSkillsRootPath(options.dataDir);
  await cleanupInjectedSkillStagingDirs({
    dataDir: options.dataDir,
    keepCatalogHashes: [],
    logger,
  });
  const hostWatcher =
    options.hostWatcher ??
    (await createHostWatcher({ hostType: "persistent" }));

  const replayTasks: ReplayTaskRegistry = new Map();
  async function abortReplayTasks(): Promise<void> {
    const tasks = [...replayTasks.values()];
    for (const task of tasks) {
      task.abort.abort();
    }
    await Promise.allSettled(tasks.map((task) => task.done));
  }
  const replayCapture = createReplayCaptureService({
    dataDir: options.dataDir,
    enabled: options.devReplayCapture ?? false,
    logger,
  });

  // Tells the server to interrupt its pending interactions. In-process the
  // call is direct — the daemon's durable pending-interrupt queue and retry
  // timer (`enqueueInteractiveInterrupt`) are gone; a failure is logged and
  // the boot reconciliation pass owns any leftover server-side state.
  function interruptServerInteractions(
    args: InterruptInteractiveRequestsArgs,
  ): void {
    void ports.interactiveRequests.interrupt(args).catch((error) => {
      logger.warn(
        {
          providerId: args.providerId,
          threadIds: args.threadIds,
          ...runtimeErrorLogFields(error),
        },
        "Failed to interrupt pending interactive requests",
      );
    });
  }

  // Rejects local waiters, then tells the server to interrupt its pending
  // interactions — the daemon's provider-exit handling (`app.ts:718-724`).
  function interruptInteractiveThreads(
    args: InterruptInteractiveRequestsArgs,
  ): void {
    interactiveRequestRegistry.interruptThreads(args);
    interruptServerInteractions(args);
  }

  const interactiveRequestRegistry = new InteractiveRequestRegistry({
    registerRequest: async (request) => {
      // Interactive registration creates server-owned turn-scoped timeline
      // state, so the append module must first observe the provider
      // turn/started for that turn.
      await ports.events.flush();
      return ports.interactiveRequests.register(request);
    },
    onRegistrationFailure: ({ error, request }) => {
      // Server-side interrupt only, as in the daemon (`app.ts:503-509`): the
      // registry rejects the failing waiter itself, and sibling local
      // waiters stay pending — the server's interrupt settles them through
      // the normal `interactive.resolve` path.
      interruptServerInteractions({
        providerId: request.providerId,
        reason: `Failed to register interactive request while provider was waiting: ${error.message}`,
        threadIds: [request.threadId],
      });
    },
  });

  const appDataChangeReporter = new AppDataChangeReporter({
    logger,
    postAppDataChange: (payload) => ports.appData.publishChange(payload),
    postAppDataResync: (payload) => ports.appData.publishResync(payload),
  });

  async function refreshTrackedApplicationDataTargets(): Promise<void> {
    const targets = await listApplicationDataTargetsFromRoot({ appsRootPath });
    runtimeManager.replaceTrackedApplicationDataTargets(targets);
    await appDataChangeReporter.replaceTrackedApplications({ targets });
  }

  const runtimeManager: RuntimeManager = new RuntimeManager({
    bridgeBundleDir: options.bridgeBundleDir,
    createRuntime: options.createRuntime,
    dataDir: options.dataDir,
    dataDirSkillsRootPath,
    hostWatcher,
    logger,
    shellEnv: options.runtimeShellEnv,
    appsRootPath,
    appDataRootPath,
    onCapture: (entry) => {
      replayCapture?.recordRuntimeCaptureEntry(entry);
    },
    onEvent: ({ environmentId, event }) => {
      ports.events.emit({
        threadId: event.threadId,
        event,
      });
      replayCapture?.recordThreadEvent({
        environmentId,
        threadId: event.threadId,
        event,
      });
    },
    onThreadStorageChanged: ({ environmentId }) => {
      ports.changes.notifyEnvironmentChanged({
        environmentId,
        change: "thread-storage-changed",
      });
    },
    onApplicationStorageTargetsChanged: () => {
      void refreshTrackedApplicationDataTargets()
        .then(() => {
          ports.changes.notifyApplicationStorageChanged();
        })
        .catch((error) => {
          logger.warn(
            {
              appsRootPath,
              ...runtimeErrorLogFields(error),
            },
            "Failed to refresh tracked app data targets",
          );
        });
    },
    onApplicationDataChanged: (change) => {
      void appDataChangeReporter.observe(change);
    },
    onApplicationDataResync: (change) => {
      void appDataChangeReporter.requestResync(change);
    },
    onApplicationContentChanged: ({ applicationId }) => {
      ports.changes.notifyApplicationContentChanged({ applicationId });
    },
    onInjectedSkillsChanged: (change) => {
      logger.debug(
        {
          applicationId: change.applicationId,
          changedPaths: change.changedPaths,
          sourceType: change.sourceType,
        },
        "Injected skills changed; future runtime launches will rescan",
      );
    },
    onApplicationStorageWatchError: ({ error }) => {
      logger.warn(
        {
          rootPath: error.rootPath,
          watchError: error.message,
        },
        "Application storage watch unavailable; retrying in background",
      );
    },
    onDataDirSkillsWatchError: ({ error }) => {
      logger.warn(
        {
          rootPath: error.rootPath,
          watchError: error.message,
        },
        "Data-dir skills watch unavailable; retrying in background",
      );
    },
    onThreadStorageWatchError: ({ error }) => {
      logger.warn(
        {
          rootPath: error.rootPath,
          watchError: error.message,
        },
        "Thread storage watch unavailable; retrying in background",
      );
    },
    onWorkspaceStatusChanged: ({ environmentId, changeKinds }) => {
      for (const change of changeKinds) {
        ports.changes.notifyEnvironmentChanged({
          environmentId,
          change,
        });
      }
    },
    onWorkspaceStatusWatchError: ({ error }) => {
      logger.warn(
        {
          environmentId: error.environmentId,
          rootPath: error.rootPath,
          watchError: error.message,
        },
        "Workspace status watch unavailable; retrying in background",
      );
    },
    onToolCall: async (request) => {
      try {
        // Dynamic tool calls can append server-owned turn-scoped events, so
        // the append module must first observe any provider turn/started
        // already emitted.
        await ports.events.flush();
        return await ports.callTool(request);
      } catch (error) {
        logger.error(
          {
            tool: request.tool,
            threadId: request.threadId,
            providerThreadId: request.providerThreadId,
            turnId: request.turnId,
            callId: request.callId,
            err: error,
          },
          "Failed to forward dynamic tool call to server",
        );
        throw error;
      }
    },
    onInteractiveRequest: async (request) => {
      try {
        return await interactiveRequestRegistry.registerAndWait(request);
      } catch (error) {
        if (
          error instanceof InteractiveRequestRegistryError &&
          error.code === "interactive_request_rejected"
        ) {
          logger.warn(
            {
              interactiveRequestErrorCode: error.code,
              ...summarizeError(error),
              threadId: request.threadId,
              providerThreadId: request.providerThreadId,
              turnId: request.turnId,
              providerRequestId: request.providerRequestId,
              kind: request.payload.kind,
            },
            "Interactive provider request rejected by server",
          );
          throw error;
        }
        logger.error(
          {
            threadId: request.threadId,
            providerThreadId: request.providerThreadId,
            turnId: request.turnId,
            providerRequestId: request.providerRequestId,
            kind: request.payload.kind,
            err: error,
          },
          "Failed to forward interactive provider request to server",
        );
        throw error;
      }
    },
    onProcessExit: (info) => {
      if (!info.expected && info.stderr) {
        logger.warn(
          {
            providerId: info.providerId,
            threadIds: info.threadIds,
            code: info.code,
            signal: info.signal,
            stderr: info.stderr,
          },
          "Unexpected provider process exited with stderr",
        );
      }
      if (info.threadIds.length === 0) {
        return;
      }
      interruptInteractiveThreads({
        providerId: info.providerId,
        threadIds: info.threadIds,
        reason: `Provider "${info.providerId}" exited while awaiting user interaction`,
      });
    },
    threadStorageRootPath,
  });

  // Seed app-data watching at construction — the daemon seeded it from the
  // session-open payload's tracked targets; in-process the engine scans the
  // apps root directly. Thread-storage seeding stays with the boot wiring
  // (the live-thread list lives in the server DB).
  await refreshTrackedApplicationDataTargets();

  const terminalManager = new TerminalManager({
    dataDir: options.dataDir,
    logger,
    runtimeManager,
    sendMessage: ports.sendTerminalEvent,
  });

  const router = new CommandRouter({
    dataDir: options.dataDir,
    eventSink: ports.events,
    fetchProjectAttachment: ports.fetchProjectAttachment,
    listModels: (args) =>
      defaultListModels(args, {
        bridgeBundleDir: options.bridgeBundleDir,
      }),
    logger,
    recordReplayCaptureThreadMetadata: (metadata) =>
      replayCapture?.recordThreadMetadata(metadata),
    recordReplayCaptureTurnRequest: (input) =>
      replayCapture?.recordTurnRequest(input),
    replayTasks,
    reportResult: ports.deliverCommandResult,
    resolveInteractiveRequest: async (request) => {
      interactiveRequestRegistry.resolve(request);
    },
    runtimeManager,
    terminalManager,
    threadStorageRootPath,
  });

  return {
    router,
    runtimeManager,
    terminalManager,
    shutdown: async () => {
      await abortReplayTasks();
      // "daemon-disconnect" is the frozen wire value for terminals dying with
      // the owning process (plan §4.2 keeps disconnect-flavored close reasons).
      await terminalManager.shutdownAll("daemon-disconnect");
      await runtimeManager.shutdownAll();
      // Everything emitted before shutdown must be durably appended before
      // the process (or P1b caller) proceeds — the in-process replacement for
      // the daemon's final event-buffer flush.
      await ports.events.flush();
      await shutdownDefaultListModelsRuntimes();
      await replayCapture?.drain();
    },
  };
}
