/**
 * Child-process entry for the kill-9 boot-reconciliation suite
 * (`fake/recovery/`): boots the merged single-process server — the same
 * composition as `startIntegrationServer` in `harness.ts` — against an
 * ON-DISK SQLite database so a SIGKILL + restart exercises real crash
 * recovery (plan §6 Phase 2, §8 kill-9 matrix).
 *
 * Differences from the in-process harness, all crash-suite-specific:
 * - on-disk `bb.db` under `BB_CRASH_DATA_DIR` (state must survive the kill),
 * - `runBootReconciliation` before reporting readiness (the code under test),
 * - the product sweep scheduler on a fast interval (cleanup re-derivation),
 * - the fake adapter with user questions enabled (pending-approval scenario).
 *
 * Spawned via `node --conditions=source --import tsx` (the dev-server launch
 * mechanism); prints `CRASH_SERVER_READY {"port":N}` on stdout once the
 * server accepts requests post-reconciliation.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { serve } from "@hono/node-server";
import {
  createAgentRuntimeWithAdapters,
  createFakeAdapter,
} from "@bb/agent-runtime/test";
import { defaultFeatureFlags } from "@bb/domain";
import { initDb } from "../../../apps/server/src/db.js";
import { createLifecycleDedupers } from "../../../apps/server/src/lifecycle-dedupers.js";
import { createApp } from "../../../apps/server/src/server.js";
import { EngineCommandDispatcher } from "../../../apps/server/src/services/engine/engine-dispatch.js";
import { startServerEngine } from "../../../apps/server/src/services/engine/server-engine.js";
import { PendingInteractionLifecycle } from "../../../apps/server/src/services/interactions/pending-interactions.js";
import { runBootReconciliation } from "../../../apps/server/src/services/lifecycle/boot-reconciliation.js";
import { createLifecycles } from "../../../apps/server/src/services/lifecycle/create-lifecycles.js";
import { runProductSweeps } from "../../../apps/server/src/services/lifecycle/product-sweeps.js";
import { createAppVersionService } from "../../../apps/server/src/services/system/app-version.js";
import { createBbAppManagedConfigReloader } from "../../../apps/server/src/services/system/bb-app-managed-config.js";
import { TerminalSessionLifecycle } from "../../../apps/server/src/services/terminals/terminal-session-lifecycle.js";
import type {
  AppDeps,
  ServerLogger,
  ServerRuntimeConfig,
} from "../../../apps/server/src/types.js";
import { NotificationHub } from "../../../apps/server/src/ws/hub.js";

const READY_LINE_PREFIX = "CRASH_SERVER_READY ";

function formatLogContext(context: unknown): string {
  try {
    return JSON.stringify(context);
  } catch {
    return String(context);
  }
}

function writeStderrLog(level: string, args: readonly unknown[]): void {
  const rendered = args
    .map((arg) => (typeof arg === "string" ? arg : formatLogContext(arg)))
    .join(" ");
  process.stderr.write(`[crash-server ${level}] ${rendered}\n`);
}

/** Warnings/errors go to stderr so the spawning harness can surface them. */
const stderrLogger: ServerLogger = {
  debug(): void {},
  info(): void {},
  warn(...args: unknown[]): void {
    writeStderrLog("warn", args);
  },
  error(...args: unknown[]): void {
    writeStderrLog("error", args);
  },
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

async function main(): Promise<void> {
  const dataDir = requireEnv("BB_CRASH_DATA_DIR");
  const sweepIntervalMs = Number(process.env.BB_CRASH_SWEEP_INTERVAL_MS ?? 500);
  const threadStorageRootPath = path.join(dataDir, "thread-storage");
  await fs.mkdir(threadStorageRootPath, { recursive: true });

  const db = initDb(path.join(dataDir, "bb.db"), { logger: stderrLogger });
  const hub = new NotificationHub();
  const engineDispatch = new EngineCommandDispatcher();
  const pendingInteractions = new PendingInteractionLifecycle({
    db,
    engineDispatch,
    hub,
    logger: stderrLogger,
  });
  const terminalSessions = new TerminalSessionLifecycle({ db, hub });
  pendingInteractions.start();
  const config: ServerRuntimeConfig = {
    appVersion: "0.0.0-crash-test",
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
    logger: stderrLogger,
  });
  const appVersion = createAppVersionService({ config, logger: stderrLogger });
  const lifecycles = createLifecycles({
    config,
    db,
    engineDispatch,
    hub,
    lifecycleDedupers,
    logger: stderrLogger,
    pendingInteractions,
    terminalSessions,
  });
  const appDeps: AppDeps = {
    config,
    db,
    engineDispatch,
    ...lifecycles,
    hub,
    lifecycleDedupers,
    logger: stderrLogger,
    pendingInteractions,
    terminalSessions,
  };
  const { app, injectWebSocket } = createApp({
    ...appDeps,
    appVersion,
    bbAppManagedConfig,
  });

  let port: number | null = null;
  const server = serve(
    { hostname: "127.0.0.1", port: 0, fetch: app.fetch },
    (info) => {
      port = info.port;
    },
  );
  injectWebSocket(server);
  while (port === null) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  config.serverPort = port;

  await startServerEngine({
    deps: appDeps,
    serverUrl: `http://127.0.0.1:${port}`,
    createRuntime: (runtimeOptions) =>
      createAgentRuntimeWithAdapters({
        ...runtimeOptions,
        adapterFactory: (providerId) =>
          createFakeAdapter({
            displayName: providerId,
            id: providerId,
            supportsUserQuestion: true,
          }),
      }),
  });

  // The code under test: settle everything the killed process left behind
  // BEFORE accepting the suite's requests (plan §3).
  runBootReconciliation({
    deps: appDeps,
    environmentLifecycle: lifecycles.environmentLifecycle,
    projectLifecycle: lifecycles.projectLifecycle,
    threadLifecycle: lifecycles.threadLifecycle,
  });

  setInterval(() => {
    void runProductSweeps(appDeps);
  }, sweepIntervalMs);

  process.stdout.write(`${READY_LINE_PREFIX}${JSON.stringify({ port })}\n`);
}

main().catch((error) => {
  process.stderr.write(`[crash-server fatal] ${String(error)}\n`);
  process.exit(1);
});
