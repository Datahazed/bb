import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Worker } from "node:worker_threads";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DbConnection } from "@bb/db";
import { initDb } from "../../../src/db.js";
import {
  createDirectDatabaseReadService,
  createWorkerDatabaseReadService,
  DatabaseReadAbortedError,
  DatabaseReadTimeoutError,
  DatabaseReadUnavailableError,
} from "../../../src/services/database/database-read-service.js";
import type { DatabaseReadService } from "../../../src/services/database/database-read-service.js";
import { errorToResponse } from "../../../src/errors.js";
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
  it("returns valid entries without restarting for an invalid database row", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "bb-database-read-worker-test-"));
    const databasePath = join(dataDir, "bb.db");
    db = initDb(databasePath);
    db.$client.exec(`
      INSERT INTO threads (
        id,
        project_id,
        provider_id,
        status,
        origin_kind,
        latest_attention_at,
        created_at,
        updated_at,
        visibility
      ) VALUES
        ('thr_valid', 'proj_personal', 'codex', 'idle', NULL, 1, 1, 1, 'visible'),
        ('thr_invalid', 'proj_personal', 'codex', 'idle', 'future', 2, 2, 2, 'visible')
    `);
    const workers: Worker[] = [];
    const logger = { ...testLogger, warn: vi.fn() };
    databaseReads = await createWorkerDatabaseReadService({
      databasePath,
      hub: new NotificationHub(),
      logger,
      onWorkerCreated(worker): void {
        workers.push(worker);
      },
    });

    await expect(
      databaseReads.listThreadEntries({ projectId: "proj_personal" }),
    ).resolves.toMatchObject([{ id: "thr_valid" }]);
    await expect(
      databaseReads.listThreadEntries({ projectId: "proj_personal" }),
    ).resolves.toMatchObject([{ id: "thr_valid" }]);
    expect(workers).toHaveLength(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: expect.any(Number) }),
      "Dropped an invalid thread entry from a database read worker result",
    );
  }, 15_000);

  it("keeps worker response bytes equal to direct response bytes", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "bb-database-read-worker-test-"));
    const databasePath = join(dataDir, "bb.db");
    db = initDb(databasePath);
    db.$client.exec(`
      INSERT INTO threads (
        id,
        project_id,
        provider_id,
        status,
        latest_attention_at,
        created_at,
        updated_at,
        visibility
      ) VALUES (
        'thr_response_order',
        'proj_personal',
        'codex',
        'idle',
        1,
        1,
        1,
        'visible'
      )
    `);
    const hub = new NotificationHub();
    const directReads = createDirectDatabaseReadService({ db, hub });
    databaseReads = await createWorkerDatabaseReadService({
      databasePath,
      hub,
      logger: testLogger,
    });
    const options = { projectId: "proj_personal" };

    const directResponse = await directReads.listThreadEntries(options);
    const workerResponse = await databaseReads.listThreadEntries(options);

    expect(JSON.stringify(workerResponse)).toBe(JSON.stringify(directResponse));
  }, 15_000);

  it("maps an aborted read to a silent client-closed response", async () => {
    const logger = { ...testLogger, error: vi.fn() };

    const response = errorToResponse(new DatabaseReadAbortedError(), logger);

    expect(response.status).toBe(499);
    await expect(response.text()).resolves.toBe("");
    expect(logger.error).not.toHaveBeenCalled();
  });

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

  it("returns a retryable error when a worker exits during a read", async () => {
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

    const read = databaseReads.listThreadEntries({
      projectId: "proj_personal",
    });
    void firstWorker.terminate();

    await expect(read).rejects.toMatchObject({
      body: { retryable: true },
      status: 503,
    });
    await expect(
      databaseReads.listThreadEntries({ projectId: "proj_personal" }),
    ).resolves.toEqual([]);
    expect(workers).toHaveLength(2);
  }, 15_000);

  it("rejects invalid options without restarting the worker", async () => {
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

    await expect(
      databaseReads.listThreadEntries({
        limit: Number.MAX_SAFE_INTEGER + 1,
      }),
    ).rejects.toThrow();
    await expect(databaseReads.listThreadEntries({})).resolves.toEqual([]);
    expect(workers).toHaveLength(1);
  }, 15_000);

  it("rejects a read that waits for a replacement when the service closes", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "bb-database-read-worker-test-"));
    const databasePath = join(dataDir, "bb.db");
    db = initDb(databasePath);
    const workers: Worker[] = [];
    let replacementReady = false;
    databaseReads = await createWorkerDatabaseReadService({
      databasePath,
      hub: new NotificationHub(),
      logger: testLogger,
      onWorkerCreated(worker): void {
        workers.push(worker);
        if (workers.length === 2) {
          worker.once("message", () => {
            replacementReady = true;
          });
        }
      },
    });
    const firstWorker = workers[0];
    if (firstWorker === undefined) {
      throw new Error("The database read worker was not created");
    }

    const exit = once(firstWorker, "exit");
    void firstWorker.terminate();
    await exit;
    expect(workers).toHaveLength(2);
    expect(replacementReady).toBe(false);

    const read = databaseReads.listThreadEntries({
      projectId: "proj_personal",
    });
    const readResult = expect(read).rejects.toThrow(
      "The database read service stopped",
    );
    await databaseReads.close();

    await readResult;
  }, 15_000);

  it("rejects reads above the pending request limit", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "bb-database-read-worker-test-"));
    const databasePath = join(dataDir, "bb.db");
    db = initDb(databasePath);
    databaseReads = await createWorkerDatabaseReadService({
      databasePath,
      hub: new NotificationHub(),
      logger: testLogger,
      maxPendingReads: 1,
    });

    const firstRead = databaseReads.listThreadEntries({
      projectId: "proj_personal",
    });
    await expect(
      databaseReads.listThreadEntries({ projectId: "proj_personal" }),
    ).rejects.toBeInstanceOf(DatabaseReadUnavailableError);
    await expect(firstRead).resolves.toEqual([]);
  }, 15_000);

  it("removes an aborted read from the pending queue", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "bb-database-read-worker-test-"));
    const databasePath = join(dataDir, "bb.db");
    db = initDb(databasePath);
    databaseReads = await createWorkerDatabaseReadService({
      databasePath,
      hub: new NotificationHub(),
      logger: testLogger,
      maxPendingReads: 2,
    });
    const abortController = new AbortController();

    const firstRead = databaseReads.listThreadEntries({
      projectId: "proj_personal",
    });
    const abortedRead = databaseReads.listThreadEntries(
      { projectId: "proj_personal" },
      { signal: abortController.signal },
    );
    const abortedResult = expect(abortedRead).rejects.toBeInstanceOf(
      DatabaseReadAbortedError,
    );
    abortController.abort();
    const replacementRead = databaseReads.listThreadEntries({
      projectId: "proj_personal",
    });

    await abortedResult;
    await expect(firstRead).resolves.toEqual([]);
    await expect(replacementRead).resolves.toEqual([]);
  }, 15_000);

  it("rejects a read after its deadline", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "bb-database-read-worker-test-"));
    const databasePath = join(dataDir, "bb.db");
    db = initDb(databasePath);
    databaseReads = await createWorkerDatabaseReadService({
      databasePath,
      hub: new NotificationHub(),
      logger: testLogger,
      requestTimeoutMs: 0,
    });

    await expect(
      databaseReads.listThreadEntries({ projectId: "proj_personal" }),
    ).rejects.toMatchObject({
      body: { retryable: false },
      name: "DatabaseReadTimeoutError",
      status: 503,
    });
  }, 15_000);

  it("replaces the worker when an active read exceeds its deadline", async () => {
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
        printf('thr_timeout_%07d', value),
        'proj_personal',
        'codex',
        'idle',
        0,
        value,
        value,
        'visible'
      FROM thread_numbers
    `);
    const workers: Worker[] = [];
    databaseReads = await createWorkerDatabaseReadService({
      databasePath,
      hub: new NotificationHub(),
      logger: testLogger,
      onWorkerCreated(worker): void {
        workers.push(worker);
      },
      requestTimeoutMs: 1_000,
    });

    await expect(
      databaseReads.listThreadEntries({ projectId: "proj_personal" }),
    ).rejects.toBeInstanceOf(DatabaseReadTimeoutError);
    await expect(
      databaseReads.listThreadEntries({ projectId: "proj_missing" }),
    ).resolves.toEqual([]);
    expect(workers).toHaveLength(2);
  }, 15_000);

  it("replaces the worker when an active read is aborted", async () => {
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
        printf('thr_abort_%07d', value),
        'proj_personal',
        'codex',
        'idle',
        0,
        value,
        value,
        'visible'
      FROM thread_numbers
    `);
    const workers: Worker[] = [];
    databaseReads = await createWorkerDatabaseReadService({
      databasePath,
      hub: new NotificationHub(),
      logger: testLogger,
      onWorkerCreated(worker): void {
        workers.push(worker);
      },
    });
    const abortController = new AbortController();
    const read = databaseReads.listThreadEntries(
      { projectId: "proj_personal" },
      { signal: abortController.signal },
    );
    await new Promise<void>((resolve) => setImmediate(resolve));

    abortController.abort();

    await expect(read).rejects.toBeInstanceOf(DatabaseReadAbortedError);
    await expect(
      databaseReads.listThreadEntries({ projectId: "proj_missing" }),
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
