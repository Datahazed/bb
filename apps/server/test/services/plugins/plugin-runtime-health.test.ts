import { mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  createConnection,
  getInstalledPlugin,
  migrate,
  upsertInstalledPlugin,
  type DbConnection,
} from "@bb/db";
import { createLogger } from "@bb/logger";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAiServiceRegistry } from "../../../src/services/ai/ai-service-registry.js";
import { createPluginRuntime } from "../../../src/services/plugins/plugin-runtime.js";
import { createNoopTelemetryService } from "../../../src/services/system/telemetry.js";

function installPlugin(db: DbConnection, rootDir: string): void {
  upsertInstalledPlugin(db, {
    id: "demo",
    source: `path:${rootDir}`,
    provenance: { kind: "direct" },
    sourceIntent: { kind: "path", canonicalPath: rootDir },
    exactResolution: { kind: "path" },
    updateState: {
      lastCheckAt: null,
      availableCompatibleVersion: null,
      newestIncompatibleVersion: null,
      statusDetail: null,
    },
    activeArtifactId: null,
    rootDir,
    version: "0.1.0",
    enabled: true,
  });
}

describe("plugin runtime health", () => {
  let db: DbConnection;
  let dataDir: string;

  beforeEach(async () => {
    db = createConnection(":memory:");
    migrate(db);
    dataDir = await mkdtemp(join(tmpdir(), "bb-plugin-runtime-health-"));
    installPlugin(db, join(dataDir, "plugins", "demo"));
  });

  afterEach(async () => {
    db.$client.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  function createRuntime(settingsChanged: () => void = () => {}) {
    return createPluginRuntime({
      deps: {
        db,
        hub: {
          getDaemonSessionIdForHost: () => null,
          notifyPluginSignal: () => 0,
          notifySystem: () => {},
        },
        logger: createLogger({
          component: "plugin-runtime-health-test",
          dataDir,
          transportMode: "stream",
        }),
        aiServices: createAiServiceRegistry(),
        telemetry: createNoopTelemetryService(),
        dataDir,
        appVersion: "0.9.0",
        now: () => 1234,
      },
      settingsChanged,
      nextCronRunAt: () => Number.MAX_SAFE_INTEGER,
      settledWithin: async () => true,
    });
  }

  it("stores compact status problems and excludes disabled details", () => {
    let changeCount = 0;
    const runtime = createRuntime(() => {
      changeCount += 1;
    });
    const rootDir = join(dataDir, "plugins", "demo");
    runtime.setStatus(
      "demo",
      "missing",
      `missing at ${rootDir} and ${join(homedir(), "private.txt")}\nstack`,
    );

    expect(getInstalledPlugin(db, "demo")).toMatchObject({
      lastProblemClass: "missing",
      lastProblemMessage: "missing at ~/plugins/demo and ~/private.txt",
      lastProblemAt: 1234,
    });
    expect(changeCount).toBe(1);

    runtime.setStatus("demo", "disabled", "disabled detail");
    expect(getInstalledPlugin(db, "demo")?.lastProblemClass).toBe("missing");
    expect(changeCount).toBe(1);

    runtime.setStatus("demo", "error", "x".repeat(600));
    expect(getInstalledPlugin(db, "demo")?.lastProblemMessage).toBe(
      `${"x".repeat(499)}…`,
    );
    expect(changeCount).toBe(2);
  });

  it("increments the stored handler error count and redacts its message", async () => {
    let changeCount = 0;
    const runtime = createRuntime(() => {
      changeCount += 1;
    });
    await runtime.invokeWrapped("demo", "event handler", () => {
      throw new Error(`failed at ${join(homedir(), "private.txt")}\nstack`);
    });

    expect(getInstalledPlugin(db, "demo")).toMatchObject({
      handlerErrorCount: 1,
      lastProblemClass: "error",
      lastProblemMessage: "failed at ~/private.txt",
      lastProblemAt: 1234,
    });
    expect(runtime.handlerStats.get("demo")?.errorCount).toBe(1);
    expect(changeCount).toBe(1);
  });
});
