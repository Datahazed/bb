import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createConnection, migrate, type DbConnection } from "../src/index.js";
import {
  captureFreshDatabaseSnapshot,
  restoreFreshDatabaseSnapshot,
} from "../src/fresh-database-snapshot.js";

interface SqliteMasterRow {
  type: string;
  name: string;
  tbl_name: string;
  sql: string | null;
}

interface NameRow {
  name: string;
}

function schemaObjects(db: DbConnection): SqliteMasterRow[] {
  return db.$client
    .prepare<[], SqliteMasterRow>(
      "SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name",
    )
    .all();
}

function tableNames(db: DbConnection): string[] {
  return db.$client
    .prepare<[], NameRow>(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    )
    .all()
    .map((row) => row.name);
}

type Row = Record<string, unknown>;

/**
 * Every row of every table, shadow and internal tables included. The seeded
 * personal project is stamped with the wall clock at migration time, which
 * the snapshot captures once per process, so those two columns are ignored.
 */
function tableContents(db: DbConnection): Record<string, Row[]> {
  const contents: Record<string, Row[]> = {};
  for (const name of tableNames(db)) {
    contents[name] = db.$client
      .prepare<[], Row>(`SELECT * FROM "${name}"`)
      .all()
      .map((row) =>
        name === "projects"
          ? { ...row, created_at: "<clock>", updated_at: "<clock>" }
          : row,
      );
  }
  return contents;
}

function searchRowids(db: DbConnection, query: string): number[] {
  return db.$client
    .prepare<[string], { rowid: number }>(
      "SELECT rowid FROM thread_search_segments_fts WHERE thread_search_segments_fts MATCH ? ORDER BY rowid",
    )
    .all(query)
    .map((row) => row.rowid);
}

/** Inserts a search segment without its parent thread; the FTS triggers fire all the same. */
function insertSearchSegment(db: DbConnection, text: string): void {
  db.$client.pragma("foreign_keys = OFF");
  try {
    db.$client
      .prepare(
        "INSERT INTO thread_search_segments (id, thread_id, source_kind, source_key, source_seq, text, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run("seg-1", "thread-1", "message", "message-1", 0, text, 1, 1);
  } finally {
    db.$client.pragma("foreign_keys = ON");
  }
}

describe("fresh in-memory database snapshot", () => {
  const connections: DbConnection[] = [];
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const db of connections.splice(0)) db.$client.close();
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true });
  });

  function openInMemory(): DbConnection {
    const db = createConnection(":memory:");
    connections.push(db);
    return db;
  }

  /** File-backed databases never use the snapshot, so they migrate in full. */
  function openOnDisk(): DbConnection {
    const dir = mkdtempSync(join(tmpdir(), "bb-db-snapshot-"));
    tempDirs.push(dir);
    const db = createConnection(join(dir, "reference.db"));
    connections.push(db);
    return db;
  }

  it("restores the same schema and rows as running the migrations", () => {
    const reference = openOnDisk();
    migrate(reference);

    // The first in-memory migration in this process captures the snapshot,
    // the second one is served from it; both must match the full migration.
    const first = openInMemory();
    migrate(first);
    const second = openInMemory();
    migrate(second);

    const expectedSchema = schemaObjects(reference);
    expect(expectedSchema.length).toBeGreaterThan(100);
    expect(schemaObjects(first)).toEqual(expectedSchema);
    expect(schemaObjects(second)).toEqual(expectedSchema);

    const expectedContents = tableContents(reference);
    expect(expectedContents.__drizzle_migrations.length).toBeGreaterThan(50);
    expect(tableContents(first)).toEqual(expectedContents);
    expect(tableContents(second)).toEqual(expectedContents);
  });

  it("honors deferDestructiveLegacyCleanup separately from the default", () => {
    const reference = openOnDisk();
    migrate(reference, { deferDestructiveLegacyCleanup: true });

    const deferred = openInMemory();
    migrate(deferred, { deferDestructiveLegacyCleanup: true });
    const restoredDeferred = openInMemory();
    migrate(restoredDeferred, { deferDestructiveLegacyCleanup: true });

    expect(tableContents(deferred)).toEqual(tableContents(reference));
    expect(tableContents(restoredDeferred)).toEqual(tableContents(reference));
  });

  it("keeps the full-text search triggers and index working after a restore", () => {
    const reference = openOnDisk();
    migrate(reference);
    const restored = openInMemory();
    migrate(restored);

    const exercise = (db: DbConnection) => {
      insertSearchSegment(db, "snapshot restore keeps search");
      db.$client
        .prepare("UPDATE thread_search_segments SET text = ? WHERE id = ?")
        .run("updated wording only", "seg-1");
    };
    exercise(reference);
    exercise(restored);

    expect(searchRowids(restored, "updated")).toEqual(
      searchRowids(reference, "updated"),
    );
    expect(searchRowids(restored, "updated")).toHaveLength(1);
    expect(searchRowids(restored, "snapshot")).toHaveLength(0);
  });

  it("does not snapshot a database whose virtual tables hold rows", () => {
    const db = openInMemory();
    migrate(db);
    insertSearchSegment(db, "indexed text");

    expect(captureFreshDatabaseSnapshot(db)).toBeNull();
  });

  it("only uses the snapshot for empty in-memory databases", () => {
    const source = openInMemory();
    migrate(source);
    const snapshot = captureFreshDatabaseSnapshot(source);
    expect(snapshot).not.toBeNull();

    const target = openInMemory();
    restoreFreshDatabaseSnapshot(target, snapshot!);
    expect(schemaObjects(target)).toEqual(schemaObjects(source));

    // A database that already has schema takes the regular, idempotent path.
    expect(() => migrate(target)).not.toThrow();
    expect(schemaObjects(target)).toEqual(schemaObjects(source));
  });
});
