import { serve } from "@hono/node-server";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadHostDaemonEntrypointConfig } from "@bb/config/host-daemon-entrypoint";
import type { ServerConfig } from "@bb/config/server";
import { toOptionalString } from "@bb/config/strings";
import { createLogger } from "@bb/logger";
import { initDb } from "./db.js";
import { createApp } from "./server.js";
import { migrateAppDataLayout } from "./services/apps/app-data-layout-migration.js";
import { EngineCommandDispatcher } from "./services/engine/engine-dispatch.js";
import { startServerEngine } from "./services/engine/server-engine.js";
import { PendingInteractionLifecycle } from "./services/interactions/pending-interactions.js";
import { createMachineAuthService } from "./services/machine-auth.js";
import { resolveBuiltinSkillsRootPath } from "./services/skills/builtin-skills-copy.js";
import { createAppVersionService } from "./services/system/app-version.js";
import { createBbAppManagedConfigReloader } from "./services/system/bb-app-managed-config.js";
import { acquireDataDirLock } from "./services/system/data-dir-lock.js";
import { startEventLoopStallMonitor } from "./services/system/event-loop-stall-monitor.js";
import { runPeriodicSweeps } from "./services/system/periodic-sweeps.js";
import { TerminalSessionLifecycle } from "./services/terminals/terminal-session-lifecycle.js";
import { resolveThreadStorageRootPath } from "./services/threads/thread-storage.js";
import { createLifecycleDedupers } from "./lifecycle-dedupers.js";
import type { AppDeps, ServerRuntimeConfig } from "./types.js";
import { NotificationHub } from "./ws/hub.js";

export async function runServer(serverConfig: ServerConfig): Promise<void> {
  // Single owner per data dir (plan §5.5): the daemon's lock pattern moved up.
  const releaseDataDirLock = await acquireDataDirLock(serverConfig.BB_DATA_DIR);
  try {
    await runLockedServer(serverConfig, releaseDataDirLock);
  } catch (error) {
    await releaseDataDirLock().catch(() => undefined);
    throw error;
  }
}

async function runLockedServer(
  serverConfig: ServerConfig,
  releaseDataDirLock: () => Promise<void>,
): Promise<void> {
  const logger = createLogger({
    component: "server",
    dataDir: serverConfig.BB_DATA_DIR,
  });
  const db = initDb(serverConfig.databasePath, { logger });
  await migrateAppDataLayout({ dataDir: serverConfig.BB_DATA_DIR, logger });
  const hub = new NotificationHub();
  // Created unbound so it can sit on AppDeps; bound to the engine's router
  // inside startServerEngine once the engine exists.
  const engineDispatch = new EngineCommandDispatcher();
  const pendingInteractions = new PendingInteractionLifecycle({
    db,
    engineDispatch,
    hub,
    logger,
  });
  const terminalSessions = new TerminalSessionLifecycle({
    db,
    hub,
  });
  pendingInteractions.start();
  const lifecycleDedupers = createLifecycleDedupers();
  const appUrl = toOptionalString(serverConfig.BB_APP_URL);
  const threadStorageRootPath = resolveThreadStorageRootPath({
    dataDir: serverConfig.BB_DATA_DIR,
  });

  const selfDir = dirname(fileURLToPath(import.meta.url));
  const appDistDir = resolve(selfDir, "../../app/dist");
  const isProduction = process.env.NODE_ENV === "production";
  const staticDir =
    isProduction && existsSync(appDistDir) ? appDistDir : undefined;
  const runtimeConfig: ServerRuntimeConfig = {
    appVersion: serverConfig.BB_APP_VERSION,
    builtinSkillsRootPath: resolveBuiltinSkillsRootPath(),
    customModels: [],
    dataDir: serverConfig.BB_DATA_DIR,
    featureFlags: serverConfig.featureFlags,
    inferenceModel: serverConfig.BB_INFERENCE,
    isDevelopment: !isProduction,
    openAiApiKey: serverConfig.OPENAI_API_KEY,
    serverPort: serverConfig.BB_SERVER_PORT,
    threadStorageRootPath,
    transcriptionModel: serverConfig.BB_TRANSCRIPTION,
  };

  if (appUrl !== undefined) {
    runtimeConfig.appUrl = appUrl;
  }
  if (serverConfig.BB_DEV_APP_PORT !== undefined) {
    runtimeConfig.devAppPort = serverConfig.BB_DEV_APP_PORT;
  }
  const bbAppManagedConfig = await createBbAppManagedConfigReloader({
    config: runtimeConfig,
    hub,
    logger,
  });

  const machineAuth = await createMachineAuthService({
    dataDir: serverConfig.BB_DATA_DIR,
    db,
    logger,
  });
  await machineAuth.ensureReady();

  const appVersion = createAppVersionService({
    config: runtimeConfig,
    logger,
  });

  const appDeps: AppDeps = {
    config: runtimeConfig,
    db,
    engineDispatch,
    hub,
    lifecycleDedupers,
    logger,
    machineAuth,
    pendingInteractions,
    terminalSessions,
  };

  // Boot the in-process engine (plan §6 Phase 1). Runtime shells reach the
  // server itself over loopback; `BB_BRIDGE_DIR`/`BB_CLI_DIR` consumption is
  // rehomed here from the daemon entrypoint (plan §5.9).
  const engineEntrypointConfig = loadHostDaemonEntrypointConfig();
  const serverEngine = await startServerEngine({
    deps: appDeps,
    serverPort: serverConfig.BB_SERVER_PORT,
    serverUrl: `http://127.0.0.1:${serverConfig.BB_SERVER_PORT}`,
    ...(engineEntrypointConfig.BB_CLI_DIR !== undefined
      ? { bbExecutableDirectory: engineEntrypointConfig.BB_CLI_DIR }
      : {}),
    ...(engineEntrypointConfig.BB_BRIDGE_DIR !== undefined
      ? { bridgeBundleDir: engineEntrypointConfig.BB_BRIDGE_DIR }
      : {}),
    devReplayCapture: serverConfig.BB_DEV_REPLAY_CAPTURE,
  });

  const { app, closeWebSockets, injectWebSocket } = createApp(
    {
      ...appDeps,
      appVersion,
      bbAppManagedConfig,
    },
    { staticDir },
  );
  const eventLoopStallMonitor = startEventLoopStallMonitor({ logger });

  const server = serve({
    port: serverConfig.BB_SERVER_PORT,
    fetch: app.fetch,
  });
  injectWebSocket(server);

  logger.info(
    {
      port: serverConfig.BB_SERVER_PORT,
      dataDir: serverConfig.BB_DATA_DIR,
    },
    "Server listening",
  );

  const sweepInterval = setInterval(() => {
    void runPeriodicSweeps(appDeps);
  }, 10_000);
  sweepInterval.unref();

  let shutdownPromise: Promise<void> | null = null;
  const runShutdown = (): Promise<void> => {
    if (shutdownPromise) {
      return shutdownPromise;
    }
    shutdownPromise = (async () => {
      eventLoopStallMonitor.stop();
      clearInterval(sweepInterval);
      const closeServer = new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
      await closeWebSockets();
      await closeServer;
      // With request intake closed, drain in-flight engine work, then shut
      // the engine down (terminals → runtimes, managed workspaces preserved).
      await serverEngine.shutdown();
      await releaseDataDirLock();
    })();
    return shutdownPromise;
  };

  process.once("SIGINT", () => {
    void runShutdown().finally(() => process.exit(0));
  });
  process.once("SIGTERM", () => {
    void runShutdown().finally(() => process.exit(0));
  });
}
