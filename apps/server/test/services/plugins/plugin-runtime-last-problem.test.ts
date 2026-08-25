import { homedir } from "node:os";
import { join } from "node:path";
import {
  createConnection,
  getInstalledPlugin,
  migrate,
  upsertInstalledPlugin,
  type DbConnection,
} from "@bb/db";
import type { Logger } from "@bb/logger";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAiServiceRegistry } from "../../../src/services/ai/ai-service-registry.js";
import { createPluginRuntime } from "../../../src/services/plugins/plugin-runtime.js";
import { createNoopTelemetryService } from "../../../src/services/system/telemetry.js";

function installPathPlugin(
  db: DbConnection,
  id: string,
  rootDir: string,
): void {
  upsertInstalledPlugin(db, {
    id,
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

describe("persisted plugin runtime problems", () => {
  let db: DbConnection;
  let warn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    db = createConnection(":memory:");
    migrate(db);
    warn = vi.fn();
  });

  afterEach(() => db.$client.close());

  function createRuntime(dataDir: string) {
    return createPluginRuntime({
      deps: {
        db,
        hub: {
          getDaemonSessionIdForHost: () => null,
          notifyPluginSignal: () => 0,
          notifySystem: () => {},
        },
        logger: {
          debug: vi.fn(),
          error: vi.fn(),
          info: vi.fn(),
          warn,
        } as unknown as Logger,
        aiServices: createAiServiceRegistry(),
        telemetry: createNoopTelemetryService(),
        dataDir,
        appVersion: "0.9.0",
      },
      nextCronRunAt: () => Number.MAX_SAFE_INTEGER,
      settledWithin: async () => true,
    });
  }

  it("redacts data and home paths without rewriting partial sibling prefixes", () => {
    const dataDir = join(homedir(), ".bb-private-data");
    const rootDir = join(dataDir, "plugins", "demo");
    const runtime = createRuntime(dataDir);
    installPathPlugin(db, "demo", rootDir);

    runtime.setStatus(
      "demo",
      "error",
      [
        `failed at ${rootDir}`,
        `while reading ${join(homedir(), "Documents", "private.txt")}`,
        `beside ${dataDir}-backup and ${homedir()}-shared`,
      ].join("; "),
    );

    expect(getInstalledPlugin(db, "demo")?.lastProblemMessage).toBe(
      [
        "failed at ~/plugins/demo",
        "while reading ~/Documents/private.txt",
        `beside ~/.bb-private-data-backup and ${homedir()}-shared`,
      ].join("; "),
    );

    runtime.setStatus("demo", "error", "failure without a private path");
    expect(getInstalledPlugin(db, "demo")?.lastProblemMessage).toBe(
      "failure without a private path",
    );
  });

  it("sanitizes a real missing-plugin persistence path but keeps logs diagnostic", async () => {
    const dataDir = join(homedir(), ".bb-private-data");
    const rootDir = join(dataDir, "plugins", "missing");
    const runtime = createRuntime(dataDir);
    installPathPlugin(db, "missing", rootDir);

    await runtime.loadOne(getInstalledPlugin(db, "missing")!);

    expect(warn).toHaveBeenCalledWith(expect.stringContaining(rootDir));
    expect(getInstalledPlugin(db, "missing")?.lastProblemMessage).toBe(
      "plugin directory not found: ~/plugins/missing (reinstall)",
    );
  });
});
