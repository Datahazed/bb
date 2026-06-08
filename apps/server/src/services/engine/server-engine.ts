/**
 * Boot composition for the in-process engine (plan §6 Phase 1): builds the
 * port implementations, constructs the engine, binds the dispatch shim, and
 * seeds the watchers the daemon used to seed from its session-open payload.
 *
 * Both the production boot (`start-server.ts`) and tests construct the
 * engine through this seam — tests pass in-memory-SQLite `deps`, a fake
 * `hostWatcher`, and a `createRuntime` backed by the fake provider adapter
 * from `@bb/agent-runtime/test` (plan Decision 10).
 */
import { resolveAppsRootPath } from "@bb/config/app-storage-paths";
import { listTrackedThreadStorageTargets } from "@bb/db";
import type { HostWatcher } from "@bb/host-watcher";
import {
  createEngine,
  type CreateEngineOptions,
  type Engine,
} from "../../engine/core/engine.js";
import {
  prepareRuntimeShellEnv,
  resolveLocalBbExecutableDirectory,
} from "../../engine/environment/runtime-shell-env.js";
import type { AppDeps } from "../../types.js";
import { buildEnginePorts } from "./engine-ports.js";

export interface StartServerEngineOptions {
  deps: AppDeps;
  /**
   * The server's own listening port. Injected into runtime shells as
   * `BB_HOST_DAEMON_PORT` (plan §5.9 — the injected `bb` CLI keeps
   * discovering the local API through that name, now served by the server).
   */
  serverPort: number;
  /** The server's own origin, injected into runtime shells as `BB_SERVER_URL`. */
  serverUrl: string;
  /** `BB_CLI_DIR` override; defaults to resolving the built `@bb/cli` bin. */
  bbExecutableDirectory?: string;
  /** `BB_BRIDGE_DIR`; undefined lets the agent runtime resolve its default. */
  bridgeBundleDir?: string;
  /** Test seam: fake-adapter runtimes (`@bb/agent-runtime/test`). */
  createRuntime?: CreateEngineOptions["createRuntime"];
  devReplayCapture?: boolean;
  /** Test seam: fake filesystem watcher. */
  hostWatcher?: HostWatcher;
}

export interface ServerEngine {
  engine: Engine;
  /**
   * Joins the server's graceful shutdown: drains in-flight dispatches first
   * (the engine's `shutdown` does not await them — killing runtimes with
   * work outstanding kills provider processes mid-command), then runs the
   * engine's own shutdown (abort replays → close terminals → shut down
   * runtimes WITHOUT destroying managed workspaces → final event flush).
   */
  shutdown(): Promise<void>;
}

export async function startServerEngine(
  options: StartServerEngineOptions,
): Promise<ServerEngine> {
  const { deps } = options;
  const bbExecutableDirectory =
    options.bbExecutableDirectory ??
    (await resolveLocalBbExecutableDirectory());
  const runtimeShellEnv = prepareRuntimeShellEnv({
    appsRootPath: resolveAppsRootPath(deps.config.dataDir),
    bbExecutableDirectory,
    serverPort: options.serverPort,
    serverUrl: options.serverUrl,
  });

  // The dispatcher arrives on AppDeps (call sites and guards reach it there)
  // and is bound to the router below, once the engine exists.
  const dispatcher = deps.engineDispatch;
  const ports = buildEnginePorts({
    deps,
    deliverCommandResult: (report) => dispatcher.settleCommandResult(report),
  });
  const engine = await createEngine({
    dataDir: deps.config.dataDir,
    ports,
    logger: deps.logger,
    ...(options.bridgeBundleDir !== undefined
      ? { bridgeBundleDir: options.bridgeBundleDir }
      : {}),
    ...(options.hostWatcher !== undefined
      ? { hostWatcher: options.hostWatcher }
      : {}),
    ...(options.createRuntime !== undefined
      ? { createRuntime: options.createRuntime }
      : {}),
    runtimeShellEnv,
    threadStorageRootPath: deps.config.threadStorageRootPath,
    devReplayCapture: options.devReplayCapture ?? false,
  });
  dispatcher.bind({ deps, router: engine.router });
  // Terminal commands flow straight into the engine's terminal manager (the
  // server→daemon WS half of the terminal protocol, now in-process). Events
  // come back through the `sendTerminalEvent` port → `handleEngineTerminalEvent`.
  deps.terminalSessions.bindEngine((message) => {
    void engine.terminalManager.handleMessage(message).catch((error) => {
      deps.logger.error(
        { err: error, messageType: message.type },
        "Engine terminal command failed",
      );
    });
  });

  // Watcher seeding (engine boot requirement): the daemon seeded
  // thread-storage watching from its session-open payload; in-process the
  // live-thread list comes straight from the DB. App-data targets are seeded
  // inside `createEngine` (the engine scans its own apps root).
  engine.runtimeManager.replaceTrackedThreadStorageTargets(
    listTrackedThreadStorageTargets(deps.db),
  );

  return {
    engine,
    shutdown: async () => {
      await dispatcher.drain();
      await engine.shutdown();
    },
  };
}
