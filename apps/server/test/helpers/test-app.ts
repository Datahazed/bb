import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import type { AddressInfo } from "node:net";
import type { DbConnection } from "@bb/db";
import { defaultFeatureFlags } from "@bb/domain";
import { initDb } from "../../src/db.js";
import { createApp } from "../../src/server.js";
import { EngineCommandDispatcher } from "../../src/services/engine/engine-dispatch.js";
import { PendingInteractionLifecycle } from "../../src/services/interactions/pending-interactions.js";
import {
  createAppVersionService,
  type AppVersionService,
} from "../../src/services/system/app-version.js";
import { createBbAppManagedConfigReloader } from "../../src/services/system/bb-app-managed-config.js";
import { TerminalSessionLifecycle } from "../../src/services/terminals/terminal-session-lifecycle.js";
import { resolveThreadStorageRootPath } from "../../src/services/threads/thread-storage.js";
import { createLifecycleDedupers } from "../../src/lifecycle-dedupers.js";
import type { ServerAppDeps, ServerRuntimeConfig } from "../../src/types.js";
import type { NotificationHub } from "../../src/ws/hub.js";
import { NotificationHub as NotificationHubImpl } from "../../src/ws/hub.js";
import { TestEngineRouting } from "./test-engine-routing.js";

const TEST_SERVER_HOST = "127.0.0.1";

export interface TestAppHarness {
  app: ReturnType<typeof createApp>["app"];
  config: ServerRuntimeConfig;
  db: DbConnection;
  deps: ServerAppDeps;
  /** Fake engine the dispatch shim is bound to; records dispatches. */
  engineRouting: TestEngineRouting;
  hub: NotificationHub;
  cleanup(): Promise<void>;
}

export interface RunningTestServer extends TestAppHarness {
  baseUrl: string;
  close(): Promise<void>;
}

export type TestAppHarnessConfigOverrides = Partial<ServerRuntimeConfig> & {
  appVersionService?: AppVersionService;
};

export const testLogger = {
  debug(): void {},
  error(): void {},
  info(): void {},
  warn(): void {},
};

export async function createTestAppHarness(
  overrides: TestAppHarnessConfigOverrides = {},
): Promise<TestAppHarness> {
  const { appVersionService, ...configOverrides } = overrides;
  const dataDir = await mkdtemp(join(tmpdir(), "bb-server-test-"));
  const db = initDb(":memory:");
  const hub = new NotificationHubImpl();
  const engineDispatch = new EngineCommandDispatcher();
  const engineRouting = new TestEngineRouting();
  const pendingInteractions = new PendingInteractionLifecycle({
    db,
    engineDispatch,
    hub,
    logger: testLogger,
  });
  const terminalSessions = new TerminalSessionLifecycle({
    attachTimeoutMs: 50,
    db,
    hub,
    openTimeoutMs: 50,
  });
  pendingInteractions.start();
  const lifecycleDedupers = createLifecycleDedupers();
  const config: ServerRuntimeConfig = {
    appVersion: "0.0.0-test",
    builtinSkillsRootPath: join(dataDir, "builtin-skills"),
    customModels: [],
    dataDir,
    featureFlags: defaultFeatureFlags,
    inferenceModel: "test/mock-model",
    isDevelopment: true,
    openAiApiKey: "test-openai-key",
    serverPort: 3334,
    threadStorageRootPath: resolveThreadStorageRootPath({
      dataDir,
      env: {},
    }),
    transcriptionModel: "test/mock-transcription",
    appUrl: "https://bb.example.test",
    ...configOverrides,
  };
  const bbAppManagedConfig = await createBbAppManagedConfigReloader({
    config,
    hub,
    logger: testLogger,
  });
  const appVersion =
    appVersionService ??
    createAppVersionService({
      config,
      logger: testLogger,
    });
  const deps: ServerAppDeps = {
    appVersion,
    bbAppManagedConfig,
    config,
    db,
    engineDispatch,
    hub,
    lifecycleDedupers,
    logger: testLogger,
    pendingInteractions,
    terminalSessions,
  };
  engineDispatch.bind({ deps, router: engineRouting });
  const { app } = createApp(deps);

  return {
    app,
    config,
    db,
    deps,
    engineRouting,
    hub,
    async cleanup(): Promise<void> {
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

export async function withTestHarness<T>(
  run: (harness: TestAppHarness) => Promise<T>,
): Promise<T>;
export async function withTestHarness<T>(
  overrides: TestAppHarnessConfigOverrides,
  run: (harness: TestAppHarness) => Promise<T>,
): Promise<T>;
export async function withTestHarness<T>(
  overridesOrRun:
    | TestAppHarnessConfigOverrides
    | ((harness: TestAppHarness) => Promise<T>),
  maybeRun?: (harness: TestAppHarness) => Promise<T>,
): Promise<T> {
  const overrides: TestAppHarnessConfigOverrides =
    typeof overridesOrRun === "function" ? {} : overridesOrRun;
  const run =
    typeof overridesOrRun === "function" ? overridesOrRun : maybeRun;
  if (!run) {
    throw new Error("withTestHarness requires a run callback");
  }
  const harness = await createTestAppHarness(overrides);
  try {
    return await run(harness);
  } finally {
    await harness.cleanup();
  }
}

export async function startTestServer(
  overrides: TestAppHarnessConfigOverrides = {},
): Promise<RunningTestServer> {
  const harness = await createTestAppHarness(overrides);
  let addressInfo: AddressInfo | null = null;
  const { app, closeWebSockets, injectWebSocket } = createApp(harness.deps);
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
      addressInfo = info;
    },
  );
  injectWebSocket(server);

  while (!addressInfo) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  const resolvedAddress: AddressInfo = addressInfo;
  harness.config.serverPort = resolvedAddress.port;

  return {
    ...harness,
    app,
    baseUrl: `http://${TEST_SERVER_HOST}:${resolvedAddress.port}`,
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
      await harness.cleanup();
    },
  };
}
