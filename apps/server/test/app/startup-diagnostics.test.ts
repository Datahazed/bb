import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadServerConfig } from "@bb/config/server";
import { describe, expect, it } from "vitest";
import { startHttpListener } from "../../src/start-server.js";

const testDir = dirname(fileURLToPath(import.meta.url));

async function readServerEntrypoint(): Promise<string> {
  return readFile(resolve(testDir, "../../src/index.ts"), "utf8");
}

async function readServerPackageJson(): Promise<string> {
  return readFile(resolve(testDir, "../../package.json"), "utf8");
}

async function waitWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timeout: NodeJS.Timeout | null = null;
  const result = await Promise.race([
    promise.then((value): { kind: "result"; value: T } => ({
      kind: "result",
      value,
    })),
    new Promise<{ kind: "timeout" }>((resolveTimeout) => {
      timeout = setTimeout(
        () => resolveTimeout({ kind: "timeout" }),
        timeoutMs,
      );
    }),
  ]);
  if (timeout !== null) {
    clearTimeout(timeout);
  }
  if (result.kind === "timeout") {
    throw new Error(message);
  }
  return result.value;
}

function waitForChildClose(
  child: ReturnType<typeof spawn>,
): Promise<number | null> {
  return once(child, "close").then(([code]) =>
    typeof code === "number" ? code : null,
  );
}

describe("server startup diagnostics", () => {
  it("installs safe diagnostics before loading the startup module", async () => {
    const source = await readServerEntrypoint();
    const installCallIndex = source.indexOf("installSafeProcessDiagnostics({");
    const startupImportIndex = source.indexOf('import("./start-server.js")');

    expect(installCallIndex).toBeGreaterThanOrEqual(0);
    expect(startupImportIndex).toBeGreaterThan(installCallIndex);
    expect(source).not.toContain('from "./db.js"');
    expect(source).not.toContain('from "./server.js"');
    expect(source).not.toContain("process.report");
  });

  it("keeps the startup bundle external to the production bootstrap", async () => {
    const packageJson = await readServerPackageJson();

    expect(packageJson).toContain("--external ./start-server.js");
    expect(packageJson).toContain("src/start-server.ts dist/start-server.js");
  });

  it("closes the database worker after a later startup failure", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "bb-startup-failure-test-"));
    const databasePath = join(dataDir, "bb.db");
    const startServerUrl = pathToFileURL(
      resolve(testDir, "../../src/start-server.ts"),
    ).href;
    const databaseReadServiceUrl = pathToFileURL(
      resolve(testDir, "../../src/services/database/database-read-service.ts"),
    ).href;
    const databaseUrl = pathToFileURL(resolve(testDir, "../../src/db.ts")).href;
    const hubUrl = pathToFileURL(resolve(testDir, "../../src/ws/hub.ts")).href;
    const source = `
      import { initDb } from ${JSON.stringify(databaseUrl)};
      import { createWorkerDatabaseReadService } from ${JSON.stringify(databaseReadServiceUrl)};
      import { runStartupWithDatabaseReads } from ${JSON.stringify(startServerUrl)};
      import { NotificationHub } from ${JSON.stringify(hubUrl)};
      const databasePath = process.env.BB_STARTUP_FAILURE_TEST_DATABASE_PATH;
      if (databasePath === undefined) throw new Error("The test database path is missing");
      const db = initDb(databasePath);
      db.$client.close();
      const logger = { debug() {}, error() {}, info() {}, warn() {} };
      const databaseReads = await createWorkerDatabaseReadService({
        databasePath,
        hub: new NotificationHub(),
        logger,
      });
      process.stdout.write("worker-ready\\n");
      await runStartupWithDatabaseReads(databaseReads, async () => {
        throw new Error("Test startup failure");
      });
      `;

    let child: ReturnType<typeof spawn> | null = null;
    try {
      child = spawn(
        process.execPath,
        [
          "--conditions=source",
          "--import",
          "tsx",
          "--input-type=module",
          "-e",
          source,
        ],
        {
          cwd: resolve(testDir, "../../../.."),
          env: {
            ...process.env,
            BB_STARTUP_FAILURE_TEST_DATABASE_PATH: databasePath,
          },
          stdio: ["ignore", "pipe", "ignore"],
        },
      );
      if (child.stdout === null) {
        throw new Error("The child process output is not available");
      }
      const childClose = waitForChildClose(child);
      const workerReady = new Promise<void>((resolveReady) => {
        child?.stdout?.on("data", (chunk: Buffer) => {
          if (chunk.includes("worker-ready\n")) {
            resolveReady();
          }
        });
      });

      await waitWithTimeout(
        workerReady,
        25_000,
        "The database worker did not become ready",
      );
      await expect(
        waitWithTimeout(
          childClose,
          5_000,
          "The server startup failure kept the child process alive",
        ),
      ).resolves.toBe(1);
    } finally {
      if (
        child !== null &&
        child.exitCode === null &&
        child.signalCode === null
      ) {
        const childClose = once(child, "close");
        child.kill("SIGKILL");
        await childClose;
      }
      await rm(dataDir, { force: true, recursive: true });
    }
  }, 35_000);

  it("binds the default server listener to IPv4 loopback", async () => {
    const serverConfig = loadServerConfig({
      env: {
        BB_DATA_DIR: "/tmp/bb-server-listener-test",
        BB_HOST_DAEMON_PORT: "49162",
        BB_SERVER_PORT: "49161",
        NODE_ENV: "development",
      },
    });
    const server = startHttpListener({
      fetch: () => new Response("ok"),
      serverConfig: { ...serverConfig, BB_SERVER_PORT: 0 },
    });

    try {
      if (!server.listening) {
        await once(server, "listening");
      }
      expect(server.address()).toMatchObject({ address: "127.0.0.1" });
    } finally {
      await new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => {
          if (error) {
            rejectClose(error);
            return;
          }
          resolveClose();
        });
      });
    }
  });
});
