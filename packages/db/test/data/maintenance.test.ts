import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createConnection } from "../../src/connection.js";
import type { DbConnection } from "../../src/connection.js";
import { migrate } from "../../src/migrate.js";
import { noopNotifier } from "../../src/notifier.js";
import {
  compactDatabase,
  DATABASE_INCREMENTAL_VACUUM_MIN_FREELIST_PAGES,
  getDatabaseAutoVacuumMode,
  getDatabaseFreelistStats,
  getDatabaseMaintenanceActivity,
  isDatabaseMaintenanceIdle,
  runIncrementalVacuum,
  shouldCompactDatabase,
  shouldRunIncrementalVacuum,
} from "../../src/data/maintenance.js";
import { createProject } from "../../src/data/projects.js";
import { createThread, markThreadDeleted } from "../../src/data/threads.js";

const TEST_INCREMENTAL_VACUUM_MAX_PAGES = 128;

interface TempDatabasePath {
  dbPath: string;
  cleanup(): void;
}

interface PreservedValueRow {
  value: string;
}

function setup() {
  const db = createConnection(":memory:");
  migrate(db);
  const host = { id: "local" };
  const { project } = createProject(db, noopNotifier, {
    name: "maintenance-project",
    source: { type: "local_path", hostId: host.id, path: "/tmp/project" },
  });
  return { db, host, project };
}

function createTempDatabasePath(): TempDatabasePath {
  const dir = mkdtempSync(join(tmpdir(), "bb-db-maintenance-"));
  return {
    cleanup(): void {
      rmSync(dir, { force: true, recursive: true });
    },
    dbPath: join(dir, "bb.db"),
  };
}

function createLegacyDatabaseWithPreservedData(dbPath: string): void {
  const rawDb = new Database(dbPath);
  try {
    rawDb.exec("PRAGMA journal_mode = WAL");
    rawDb.exec(
      "CREATE TABLE preserved_rows (id INTEGER PRIMARY KEY, value TEXT NOT NULL)",
    );
    rawDb
      .prepare("INSERT INTO preserved_rows (id, value) VALUES (1, ?)")
      .run("survives-vacuum");
  } finally {
    rawDb.close();
  }
}

function readPreservedValue(db: DbConnection): string | undefined {
  return db.$client
    .prepare<[], PreservedValueRow>(
      "SELECT value FROM preserved_rows WHERE id = 1",
    )
    .get()?.value;
}

describe("database maintenance", () => {
  it("detects active work that should block compaction", () => {
    const { db, project } = setup();
    const idleActivity = getDatabaseMaintenanceActivity(db);
    expect(isDatabaseMaintenanceIdle(idleActivity)).toBe(true);

    const activeThread = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
      status: "active",
    });
    const threadActivity = getDatabaseMaintenanceActivity(db);
    expect(threadActivity.activeThreadCount).toBe(1);
    expect(isDatabaseMaintenanceIdle(threadActivity)).toBe(false);

    markThreadDeleted(db, noopNotifier, { threadId: activeThread.id });
    expect(isDatabaseMaintenanceIdle(getDatabaseMaintenanceActivity(db))).toBe(
      true,
    );
  });

  it("creates databases in incremental auto-vacuum mode", () => {
    const { db } = setup();
    expect(getDatabaseAutoVacuumMode(db)).toBe("incremental");
  });

  it("keeps fresh file-backed databases in incremental auto-vacuum mode after reopen", () => {
    const tempDatabase = createTempDatabasePath();
    try {
      const db = createConnection(tempDatabase.dbPath);
      try {
        migrate(db);
        expect(getDatabaseAutoVacuumMode(db)).toBe("incremental");
      } finally {
        db.$client.close();
      }

      const reopenedDb = createConnection(tempDatabase.dbPath);
      try {
        migrate(reopenedDb);
        expect(getDatabaseAutoVacuumMode(reopenedDb)).toBe("incremental");
      } finally {
        reopenedDb.$client.close();
      }
    } finally {
      tempDatabase.cleanup();
    }
  });

  it("converts legacy databases to incremental auto-vacuum during compaction while preserving data", () => {
    const tempDatabase = createTempDatabasePath();
    try {
      createLegacyDatabaseWithPreservedData(tempDatabase.dbPath);

      const db = createConnection(tempDatabase.dbPath);
      try {
        migrate(db);
        expect(getDatabaseAutoVacuumMode(db)).toBe("none");
        expect(readPreservedValue(db)).toBe("survives-vacuum");

        compactDatabase(db);

        expect(getDatabaseAutoVacuumMode(db)).toBe("incremental");
        expect(readPreservedValue(db)).toBe("survives-vacuum");
      } finally {
        db.$client.close();
      }
    } finally {
      tempDatabase.cleanup();
    }
  });

  it("reclaims freed pages incrementally without a full VACUUM", () => {
    const { db } = setup();
    expect(getDatabaseAutoVacuumMode(db)).toBe("incremental");

    // Build a freelist: insert several pages of data, then delete it. Under
    // incremental auto-vacuum the freed pages stay in the file until an
    // explicit incremental_vacuum, so the freelist is non-empty afterward.
    db.$client.exec(
      "CREATE TABLE scratch_blobs (id INTEGER PRIMARY KEY, blob TEXT)",
    );
    const insert = db.$client.prepare(
      "INSERT INTO scratch_blobs (blob) VALUES (?)",
    );
    const blob = "x".repeat(8 * 1024);
    const insertMany = db.$client.transaction((count: number) => {
      for (let index = 0; index < count; index += 1) {
        insert.run(blob);
      }
    });
    insertMany(3_000);
    db.$client.exec("DELETE FROM scratch_blobs");

    const before = getDatabaseFreelistStats(db);
    expect(before.freelistCount).toBeGreaterThan(0);

    const result = runIncrementalVacuum(db, {
      maxPages: TEST_INCREMENTAL_VACUUM_MAX_PAGES,
    });
    const reclaimedPages =
      result.before.freelistCount - result.after.freelistCount;

    expect(result.before.freelistCount).toBe(before.freelistCount);
    expect(result.after.freelistCount).toBeLessThan(before.freelistCount);
    expect(reclaimedPages).toBeLessThanOrEqual(
      TEST_INCREMENTAL_VACUUM_MAX_PAGES,
    );
    expect(getDatabaseFreelistStats(db).freelistCount).toBeLessThan(
      before.freelistCount,
    );
    // Reclaiming pages must not change the auto-vacuum mode.
    expect(getDatabaseAutoVacuumMode(db)).toBe("incremental");
  });

  it("does not schedule incremental vacuum for internal fragmentation without enough freelist pages", () => {
    const freelistStats = {
      databaseBytes: 1_000,
      freelistBytes: 0,
      freelistCount: DATABASE_INCREMENTAL_VACUUM_MIN_FREELIST_PAGES - 1,
      pageCount: 10,
      pageSize: 100,
    };

    expect(
      shouldRunIncrementalVacuum({
        minFreelistPages: DATABASE_INCREMENTAL_VACUUM_MIN_FREELIST_PAGES,
        stats: freelistStats,
      }),
    ).toBe(false);
    expect(
      shouldCompactDatabase({
        minReclaimableBytes: 100,
        minReclaimableRatio: 0.2,
        stats: {
          ...freelistStats,
          reclaimableBytes: 250,
          unusedBytes: 250,
        },
      }),
    ).toBe(true);
  });

  it("requires both reclaimable bytes and ratio before compacting", () => {
    expect(
      shouldCompactDatabase({
        minReclaimableBytes: 100,
        minReclaimableRatio: 0.2,
        stats: {
          databaseBytes: 1_000,
          freelistBytes: 0,
          freelistCount: 0,
          pageCount: 10,
          pageSize: 100,
          reclaimableBytes: 250,
          unusedBytes: 250,
        },
      }),
    ).toBe(true);
    expect(
      shouldCompactDatabase({
        minReclaimableBytes: 300,
        minReclaimableRatio: 0.2,
        stats: {
          databaseBytes: 1_000,
          freelistBytes: 0,
          freelistCount: 0,
          pageCount: 10,
          pageSize: 100,
          reclaimableBytes: 250,
          unusedBytes: 250,
        },
      }),
    ).toBe(false);
    expect(
      shouldCompactDatabase({
        minReclaimableBytes: 100,
        minReclaimableRatio: 0.3,
        stats: {
          databaseBytes: 1_000,
          freelistBytes: 0,
          freelistCount: 0,
          pageCount: 10,
          pageSize: 100,
          reclaimableBytes: 250,
          unusedBytes: 250,
        },
      }),
    ).toBe(false);
  });
});
