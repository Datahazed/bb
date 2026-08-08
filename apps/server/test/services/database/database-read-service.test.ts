import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Worker } from "node:worker_threads";
import { afterEach, describe, expect, it } from "vitest";
import type { DbConnection } from "@bb/db";
import { initDb } from "../../../src/db.js";
import { createWorkerDatabaseReadService } from "../../../src/services/database/database-read-service.js";
import type { DatabaseReadService } from "../../../src/services/database/database-read-service.js";
import { testLogger } from "../../helpers/test-app.js";
import { NotificationHub } from "../../../src/ws/hub.js";

const BULK_THREAD_COUNT = 250_000;

let dataDir: string | null = null;
let databaseReads: DatabaseReadService | null = null;
let db: DbConnection | null = null;

afterEach(async () => {
  await databaseReads?.close();
  db?.$client.close();
  if (dataDir !== null) {
    await rm(dataDir, { force: true, recursive: true });
  }
  dataDir = null;
  databaseReads = null;
  db = null;
});

describe("worker database reads", () => {
  it("reports an initialization failure before the service becomes ready", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "bb-database-read-worker-test-"));

    await expect(
      createWorkerDatabaseReadService({
        databasePath: join(dataDir, "missing", "bb.db"),
        hub: new NotificationHub(),
        logger: testLogger,
      }),
    ).rejects.toThrow();
  });

  it("restarts the worker after an unexpected exit", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "bb-database-read-worker-test-"));
    const databasePath = join(dataDir, "bb.db");
    db = initDb(databasePath);
    const workers: Worker[] = [];
    databaseReads = await createWorkerDatabaseReadService({
      databasePath,
      hub: new NotificationHub(),
      logger: testLogger,
      onWorkerCreated(worker): void {
        workers.push(worker);
      },
    });
    const firstWorker = workers[0];
    if (firstWorker === undefined) {
      throw new Error("The database read worker was not created");
    }

    const exit = once(firstWorker, "exit");
    void firstWorker.terminate();
    await exit;

    await expect(
      databaseReads.listThreadEntriesForProjects({
        projectIds: ["proj_personal"],
      }),
    ).resolves.toEqual([]);
    expect(workers).toHaveLength(2);
  }, 15_000);

  it("keeps the event loop available during a slow thread-list query", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "bb-database-read-worker-test-"));
    const databasePath = join(dataDir, "bb.db");
    db = initDb(databasePath);
    db.$client.exec(`
      WITH RECURSIVE thread_numbers(value) AS (
        VALUES(1)
        UNION ALL
        SELECT value + 1
        FROM thread_numbers
        WHERE value < ${BULK_THREAD_COUNT}
      )
      INSERT INTO threads (
        id,
        project_id,
        provider_id,
        status,
        latest_attention_at,
        created_at,
        updated_at,
        visibility
      )
      SELECT
        printf('thr_worker_%07d', value),
        'proj_personal',
        'codex',
        'idle',
        0,
        value,
        value,
        'visible'
      FROM thread_numbers
    `);
    databaseReads = await createWorkerDatabaseReadService({
      databasePath,
      hub: new NotificationHub(),
      logger: testLogger,
    });

    const timer = new Promise<"timer">((resolve) => {
      setTimeout(() => resolve("timer"), 0);
    });
    const read = databaseReads.listThreadEntries({
      limit: 1,
      projectId: "proj_personal",
    });

    expect(await Promise.race([timer, read.then(() => "read" as const)])).toBe(
      "timer",
    );
    await expect(read).resolves.toMatchObject([
      { id: `thr_worker_${String(BULK_THREAD_COUNT).padStart(7, "0")}` },
    ]);
  }, 15_000);
});
