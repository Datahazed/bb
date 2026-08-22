import type { DbConnection } from "./connection.js";

/**
 * A fully migrated, otherwise empty database captured as replayable SQL:
 * every `sqlite_master` entry's original DDL plus the rows the migrations
 * seeded (the migration ledger, default projects, …). Restoring it into an
 * empty database yields the same `sqlite_master` text and the same rows as
 * running the migrations, without re-executing 100+ migration files.
 *
 * Tests open hundreds of `:memory:` databases per run and migrate each from
 * scratch; that full migration is ~125ms, which dwarfs the tests themselves.
 *
 * Rows are copied verbatim, so a value a migration derives from the wall
 * clock (the seeded personal project's timestamps) reflects the capture,
 * not the restore. The snapshot only lives for one process, so the
 * difference is bounded by that process's lifetime.
 */
export interface FreshDatabaseSnapshot {
  /** `sqlite_master.sql`, ordered so every statement's dependencies precede it. */
  statements: string[];
  tables: SnapshotTableRows[];
}

interface SnapshotTableRows {
  columns: string[];
  name: string;
  rows: unknown[][];
}

interface SqliteMasterRow {
  name: string;
  sql: string | null;
  type: string;
}

interface CountRow {
  count: number;
}

interface TableInfoRow {
  name: string;
}

const VIRTUAL_TABLE_SQL = /^\s*CREATE\s+VIRTUAL\s+TABLE/iu;

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function isSqliteInternalObject(name: string): boolean {
  return name.startsWith("sqlite_");
}

function countRows(db: DbConnection, tableName: string): number {
  return db.$client
    .prepare<[], CountRow>(
      `SELECT count(*) AS count FROM ${quoteIdentifier(tableName)}`,
    )
    .get()!.count;
}

/**
 * Whether `db` is an empty in-memory database, i.e. one whose migrated state
 * is fully determined by the migration files.
 */
export function isEmptyInMemoryDatabase(db: DbConnection): boolean {
  if (!db.$client.memory) {
    return false;
  }
  return (
    db.$client
      .prepare<[], CountRow>("SELECT count(*) AS count FROM sqlite_master")
      .get()!.count === 0
  );
}

/**
 * Captures `db`, which must have just been migrated from empty. Returns
 * `null` when the database holds state this snapshot format cannot carry
 * (rows inside a virtual table), so callers fall back to migrating normally.
 */
export function captureFreshDatabaseSnapshot(
  db: DbConnection,
): FreshDatabaseSnapshot | null {
  const objects = db.$client
    .prepare<[], SqliteMasterRow>(
      "SELECT type, name, sql FROM sqlite_master ORDER BY rowid",
    )
    .all();

  // Virtual tables (FTS5) own shadow tables that `CREATE VIRTUAL TABLE`
  // recreates, structural rows included. They are neither replayed nor copied;
  // the virtual table itself must therefore be empty for the snapshot to be
  // faithful.
  const virtualTableNames = objects
    .filter(
      (object) =>
        object.type === "table" &&
        object.sql !== null &&
        VIRTUAL_TABLE_SQL.test(object.sql),
    )
    .map((object) => object.name);
  const isShadowTable = (name: string) =>
    virtualTableNames.some((virtualTableName) =>
      name.startsWith(`${virtualTableName}_`),
    );
  if (virtualTableNames.some((name) => countRows(db, name) > 0)) {
    return null;
  }

  const replayable = objects.filter(
    (object) =>
      object.sql !== null &&
      !isSqliteInternalObject(object.name) &&
      !isShadowTable(object.name),
  );
  // Tables first in creation order, then the objects that reference them.
  // `sqlite_master` rowid order alone is not enough: a table rebuilt by a
  // later migration sorts after the triggers and indexes created on its
  // predecessor... which SQLite dropped with it, so in practice only the
  // type grouping matters, but it keeps the replay order robust.
  const typeOrder: Record<string, number> = { table: 0, index: 1, trigger: 2 };
  const statements = replayable
    .map((object, index) => ({ object, index }))
    .sort(
      (a, b) =>
        (typeOrder[a.object.type] ?? 3) - (typeOrder[b.object.type] ?? 3) ||
        a.index - b.index,
    )
    .map(({ object }) => object.sql!);

  const tables: SnapshotTableRows[] = [];
  for (const object of objects) {
    if (object.type !== "table" || isShadowTable(object.name)) continue;
    if (virtualTableNames.includes(object.name)) continue;
    const columns = db.$client
      .prepare<[], TableInfoRow>(
        `PRAGMA table_info(${quoteIdentifier(object.name)})`,
      )
      .all()
      .map((column) => column.name);
    const rows = db.$client
      .prepare(`SELECT * FROM ${quoteIdentifier(object.name)}`)
      .raw(true)
      .all() as unknown[][];
    if (rows.length > 0) {
      tables.push({ columns, name: object.name, rows });
    }
  }

  return { statements, tables };
}

/** Replays `snapshot` into `db`, which must be an empty database. */
export function restoreFreshDatabaseSnapshot(
  db: DbConnection,
  snapshot: FreshDatabaseSnapshot,
): void {
  const sqlite = db.$client;
  sqlite.transaction(() => {
    for (const statement of snapshot.statements) {
      sqlite.exec(statement);
    }
    for (const table of snapshot.tables) {
      const insert = sqlite.prepare(
        `INSERT INTO ${quoteIdentifier(table.name)} (${table.columns
          .map(quoteIdentifier)
          .join(", ")}) VALUES (${table.columns.map(() => "?").join(", ")})`,
      );
      for (const row of table.rows) {
        insert.run(...row);
      }
    }
  })();
}
