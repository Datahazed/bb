import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import {
  createAgentRuntimeWithAdapters,
  createFakeAdapter,
  type ProviderAdapterFactory,
} from "@bb/agent-runtime/test";
import type { DbConnection } from "@bb/db";
import { defaultFeatureFlags } from "@bb/domain";
import { initDb } from "../../../apps/server/src/db.js";
import { createLifecycleDedupers } from "../../../apps/server/src/lifecycle-dedupers.js";
import { createApp } from "../../../apps/server/src/server.js";
import type { Engine } from "../../../apps/server/src/engine/core/engine.js";
import {
  startServerEngine,
  type ServerEngine,
} from "../../../apps/server/src/services/engine/server-engine.js";
import { LOCAL_HOST_ID } from "../../../apps/server/src/services/hosts/local-host.js";
import { PendingInteractionLifecycle } from "../../../apps/server/src/services/interactions/pending-interactions.js";
import { createAppVersionService } from "../../../apps/server/src/services/system/app-version.js";
import { createBbAppManagedConfigReloader } from "../../../apps/server/src/services/system/bb-app-managed-config.js";
import { TerminalSessionLifecycle } from "../../../apps/server/src/services/terminals/terminal-session-lifecycle.js";
import type {
  AppDeps,
  ServerLogger,
  ServerRuntimeConfig,
} from "../../../apps/server/src/types.js";
import { NotificationHub } from "../../../apps/server/src/ws/hub.js";
import { createPublicApiClient } from "@bb/server-contract";
import { waitForHostConnected } from "./assertions.js";
import { RecordingEngineCommandDispatcher } from "./engine-commands.js";
import { removePathWithRetry } from "./remove-path.js";
import { createTestGitRepo } from "./seed.js";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const TEST_SERVER_HOST = "127.0.0.1";

let loadedProjectEnvPath: string | null | undefined;

type PublicApiClient = ReturnType<typeof createPublicApiClient>;

const testLogger: ServerLogger = {
  debug(): void {},
  error(): void {},
  info(): void {},
  warn(): void {},
};

export interface RunningTestServer {
  baseUrl: string;
  close(): Promise<void>;
  config: ServerRuntimeConfig;
  db: DbConnection;
  hub: NotificationHub;
}

export interface IntegrationHarness {
  api: PublicApiClient;
  cleanup(): Promise<void>;
  db: DbConnection;
  /** The in-process engine (runtime manager, lane router, terminals). */
  engine: Engine;
  /**
   * The server's dispatch shim, wrapped to record every dispatched engine
   * command — the observation seam that replaced the durable-queue rows.
   */
  engineDispatch: RecordingEngineCommandDispatcher;
  /** Always `'local'` — the single synthetic host (plan Decision 4). */
  hostId: string;
  hub: NotificationHub;
  /**
   * Base URL of the local API (the :38887 surface in production). The merged
   * server serves it from its own port at root paths (plan §4.3, Decision 5),
   * so this is simply the server's base URL.
   */
  localApiBaseUrl(): string;
  repoDir: string;
  server: RunningTestServer;
  serverUrl: string;
  threadStorageRootPath: string;
}

export interface CreateHarnessOptions {
  adapterFactory?: ProviderAdapterFactory;
}

export type WithHarnessCallback<T> = (
  harness: IntegrationHarness,
) => Promise<T>;
type WithHarnessInvocation<T> = CreateHarnessOptions | WithHarnessCallback<T>;

interface ListeningAddress {
  port: number;
}

interface StartedIntegrationServer {
  server: RunningTestServer;
  deps: AppDeps;
  engineDispatch: RecordingEngineCommandDispatcher;
}

function requireListeningAddress(
  address: ListeningAddress | null,
): ListeningAddress {
  if (!address) {
    throw new Error("Server address was not assigned");
  }
  return address;
}

function hasAdapterFactoryOverride(options: CreateHarnessOptions): boolean {
  return Object.prototype.hasOwnProperty.call(options, "adapterFactory");
}

function resolveAdapterFactory(
  options: CreateHarnessOptions,
): ProviderAdapterFactory | undefined {
  if (hasAdapterFactoryOverride(options)) {
    return options.adapterFactory;
  }
  return () => createFakeAdapter();
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}

async function resolveProjectEnvCandidates(): Promise<string[]> {
  const candidates = new Set<string>([path.join(repoRoot, ".env")]);
  const gitMetadataPath = path.join(repoRoot, ".git");

  try {
    const gitMetadata = await fs.stat(gitMetadataPath);
    if (!gitMetadata.isFile()) {
      return [...candidates];
    }

    const gitdirPointer = await fs.readFile(gitMetadataPath, "utf8");
    const match = /^gitdir:\s*(.+)\s*$/m.exec(gitdirPointer);
    if (!match?.[1]) {
      return [...candidates];
    }

    const worktreeGitDir = path.resolve(repoRoot, match[1]);
    const commonGitDir = path.dirname(path.dirname(worktreeGitDir));
    candidates.add(path.join(path.dirname(commonGitDir), ".env"));
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [...candidates];
    }
    throw error;
  }

  return [...candidates];
}

export async function loadProjectEnvFile(): Promise<string | null> {
  if (loadedProjectEnvPath !== undefined) {
    return loadedProjectEnvPath;
  }

  for (const candidate of await resolveProjectEnvCandidates()) {
    try {
      await fs.access(candidate);
      process.loadEnvFile(candidate);
      loadedProjectEnvPath = candidate;
      return candidate;
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        continue;
      }
      throw error;
    }
  }

  loadedProjectEnvPath = null;
  return loadedProjectEnvPath;
}

async function startIntegrationServer(
  dataDir: string,
  threadStorageRootPath: string,
): Promise<StartedIntegrationServer> {
  await fs.mkdir(dataDir, { recursive: true });

  const db = initDb(":memory:");
  const hub = new NotificationHub();
  // Created unbound (it sits on AppDeps); bound to the engine's router by
  // startServerEngine below, once the port is known.
  const engineDispatch = new RecordingEngineCommandDispatcher();
  const pendingInteractions = new PendingInteractionLifecycle({
    db,
    engineDispatch,
    hub,
    logger: testLogger,
  });
  const terminalSessions = new TerminalSessionLifecycle({
    db,
    hub,
  });
  pendingInteractions.start();
  const config: ServerRuntimeConfig = {
    appVersion: "0.0.0-dev",
    builtinSkillsRootPath: path.join(dataDir, "builtin-skills"),
    customModels: [],
    dataDir,
    featureFlags: defaultFeatureFlags,
    inferenceModel: "test/mock-model",
    openAiApiKey: process.env.OPENAI_API_KEY ?? "test-openai-key",
    appUrl: "https://bb.example.test",
    serverPort: 0,
    threadStorageRootPath,
    transcriptionModel: "test/mock-transcription",
    isDevelopment: false,
  };
  const lifecycleDedupers = createLifecycleDedupers();
  const bbAppManagedConfig = await createBbAppManagedConfigReloader({
    config,
    hub,
    logger: testLogger,
  });
  const appVersion = createAppVersionService({
    config,
    logger: testLogger,
  });
  const appDeps: AppDeps = {
    config,
    db,
    engineDispatch,
    hub,
    lifecycleDedupers,
    logger: testLogger,
    pendingInteractions,
    terminalSessions,
  };
  const { app, closeWebSockets, injectWebSocket } = createApp({
    ...appDeps,
    appVersion,
    bbAppManagedConfig,
  });

  let addressInfo: ListeningAddress | null = null;
  const server = serve(
    {
      // The client always connects to 127.0.0.1, so bind the test server to
      // 127.0.0.1 too. If we leave the host unspecified, this server can end
      // up on ::1 while another local process owns 127.0.0.1 on the same
      // port, and the client will hit that other process instead.
      hostname: TEST_SERVER_HOST,
      port: 0,
      fetch: app.fetch,
    },
    (info) => {
      addressInfo = { port: info.port };
    },
  );
  injectWebSocket(server);

  while (!addressInfo) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  const { port } = requireListeningAddress(addressInfo);
  config.serverPort = port;
  const baseUrl = `http://${TEST_SERVER_HOST}:${port}`;

  return {
    deps: appDeps,
    engineDispatch,
    server: {
      baseUrl,
      config,
      db,
      hub,
      async close(): Promise<void> {
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
      },
    },
  };
}

async function startHarnessEngine(
  started: StartedIntegrationServer,
  options: CreateHarnessOptions,
): Promise<ServerEngine> {
  const adapterFactory = resolveAdapterFactory(options);
  return startServerEngine({
    deps: started.deps,
    serverPort: started.server.config.serverPort,
    serverUrl: started.server.baseUrl,
    ...(adapterFactory
      ? {
          createRuntime: (runtimeOptions) =>
            createAgentRuntimeWithAdapters({
              ...runtimeOptions,
              adapterFactory,
            }),
        }
      : {}),
  });
}

export async function createIntegrationHarness(
  options: CreateHarnessOptions = {},
): Promise<IntegrationHarness> {
  await loadProjectEnvFile();
  const tmpRoot = await fs.mkdtemp(path.join(tmpdir(), "bb-integration-"));
  await fs.writeFile(
    path.join(tmpRoot, "parent.pid"),
    `${process.pid}\n`,
    "utf8",
  );
  const reposRoot = path.join(tmpRoot, "repos");
  const dataDir = path.join(tmpRoot, "data");
  const threadStorageRootPath = path.join(dataDir, "thread-storage");
  await fs.mkdir(threadStorageRootPath, { recursive: true });
  const repoDir = await createTestGitRepo({
    repoDir: path.join(reposRoot, "test-project"),
  });

  let started: StartedIntegrationServer | null = null;
  let serverEngine: ServerEngine | null = null;
  let cleanedUp = false;

  async function cleanup(): Promise<void> {
    if (cleanedUp) {
      return;
    }
    cleanedUp = true;

    await started?.server.close().catch(() => undefined);
    await serverEngine?.shutdown().catch(() => undefined);
    await removePathWithRetry(tmpRoot);
  }

  try {
    started = await startIntegrationServer(dataDir, threadStorageRootPath);
    serverEngine = await startHarnessEngine(started, options);
    const runningServer = started.server;
    const api = createPublicApiClient(runningServer.baseUrl);
    await waitForHostConnected(api);

    return {
      api,
      cleanup,
      db: runningServer.db,
      engine: serverEngine.engine,
      engineDispatch: started.engineDispatch,
      hostId: LOCAL_HOST_ID,
      hub: runningServer.hub,
      localApiBaseUrl: () => runningServer.baseUrl,
      repoDir,
      server: runningServer,
      serverUrl: runningServer.baseUrl,
      threadStorageRootPath,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

export async function withHarness<T>(run: WithHarnessCallback<T>): Promise<T>;
export async function withHarness<T>(
  options: CreateHarnessOptions,
  run: WithHarnessCallback<T>,
): Promise<T>;
export async function withHarness<T>(
  arg1: WithHarnessInvocation<T>,
  arg2?: WithHarnessCallback<T>,
): Promise<T> {
  const options = typeof arg1 === "function" ? {} : arg1;
  const run = typeof arg1 === "function" ? arg1 : arg2;
  if (!run) {
    throw new Error("withHarness requires a callback");
  }

  const harness = await createIntegrationHarness(options);
  try {
    return await run(harness);
  } finally {
    await harness.cleanup();
  }
}
