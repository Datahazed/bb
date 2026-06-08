import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { publishedMigrationWhensByTag } from "../src/migration-history.js";
import {
  createConnection,
  migrate,
  type DbConnection,
  type MigrationWarningLogger,
} from "../src/index.js";

type InsertMigrationParameters = [string, number];
type DeleteMigrationParameters = [number];
type TableNameParameters = [string];
type QueuedMessageMigrationInsertParameters = [string, string, number, number];
type ProjectSortKeyMigrationInsertParameters = [string, string, number, number];
type ThreadSortKeyMigrationInsertParameters = [string, string, string, number];

interface IndexNameRow {
  name: string;
}

interface MigrationCreatedAtRow {
  createdAt: number;
}

interface LatestMigrationCreatedAtRow {
  createdAt: number | null;
}

interface MigratedQueuedMessageRow {
  id: string;
  sortKey: string;
  threadId: string;
}

interface MigratedProjectRow {
  id: string;
  sortKey: string;
}

interface MigratedThreadSortKeyRow {
  id: string;
  sortKey: string | null;
}

interface PersonalProjectMigrationRow {
  count: number;
}

interface TableInfoRow {
  name: string;
  notnull: number;
}

interface ReadIndexNamesArgs {
  db: DbConnection;
  tableName: string;
}

interface ReplaceAppliedMigrationHashArgs {
  db: DbConnection;
  createdAt: number;
  hash: string;
}

const __dirname = dirname(fileURLToPath(import.meta.url));

function requirePublishedMigrationWhen(tag: string): number {
  const when = publishedMigrationWhensByTag.get(tag);
  if (when === undefined) {
    throw new Error(`No published migration timestamp for ${tag}`);
  }

  return when;
}

const baselineWhen = requirePublishedMigrationWhen("0000_baseline");
const publishedTerminalSessionUserInputWhen = requirePublishedMigrationWhen(
  "0001_terminal_session_user_input",
);
const closedSessionPruneIndexesWhen = requirePublishedMigrationWhen(
  "0002_closed_session_prune_indexes",
);
const threadDynamicContextFileStatesWhen = 1779139400002;
const commandLookupIndexesWhen = 1779943370189;
const threadPinningMigrationWhen = 1779990051923;
const queuedMessageSortKeyMigrationPath = resolve(
  __dirname,
  "..",
  "drizzle",
  "0004_wild_justice.sql",
);
const sidebarOrderingMigrationPath = resolve(
  __dirname,
  "..",
  "drizzle",
  "0005_strong_exodus.sql",
);
const threadPinningMigrationPath = resolve(
  __dirname,
  "..",
  "drizzle",
  "0008_thread_pinning.sql",
);

function closeConnection(db: DbConnection): void {
  db.$client.close();
}

function readIndexNames(args: ReadIndexNamesArgs): string[] {
  return args.db.$client
    .prepare<TableNameParameters, IndexNameRow>(
      `
        SELECT name
        FROM sqlite_master
        WHERE type = 'index'
          AND tbl_name = ?
        ORDER BY name
      `,
    )
    .all(args.tableName)
    .map((row) => row.name);
}

function readLatestAppliedMigrationCreatedAt(db: DbConnection): number {
  const row = db.$client
    .prepare<[], LatestMigrationCreatedAtRow>(
      `
        SELECT MAX(created_at) AS createdAt
        FROM __drizzle_migrations
      `,
    )
    .get();
  const createdAt = row?.createdAt;
  if (typeof createdAt !== "number") {
    throw new Error("Expected at least one applied migration timestamp");
  }
  return createdAt;
}

function replaceAppliedMigrationHash(
  args: ReplaceAppliedMigrationHashArgs,
): void {
  args.db.$client
    .prepare<DeleteMigrationParameters>(
      `
        DELETE FROM __drizzle_migrations
        WHERE created_at = ?
      `,
    )
    .run(args.createdAt);
  args.db.$client
    .prepare<InsertMigrationParameters>(
      `
        INSERT INTO __drizzle_migrations (hash, created_at)
        VALUES (?, ?)
      `,
    )
    .run(args.hash, args.createdAt);
}

function runQueuedMessageSortKeyMigration(db: DbConnection): void {
  const migrationSql = readFileSync(queuedMessageSortKeyMigrationPath, "utf-8");
  const statements = migrationSql
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);

  for (const statement of statements) {
    db.$client.exec(statement);
  }
}

function runSidebarOrderingMigration(db: DbConnection): void {
  const migrationSql = readFileSync(sidebarOrderingMigrationPath, "utf-8");
  const statements = migrationSql
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);

  for (const statement of statements) {
    db.$client.exec(statement);
  }
}

function runThreadPinningMigration(db: DbConnection): void {
  const migrationSql = readFileSync(threadPinningMigrationPath, "utf-8");
  const statements = migrationSql
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);

  for (const statement of statements) {
    db.$client.exec(statement);
  }
}

describe("migrate", () => {
  it("provisions the singleton personal project", () => {
    const db = createConnection(":memory:");

    try {
      migrate(db);

      const personalProject = db.$client
        .prepare<[], PersonalProjectMigrationRow>(
          `
            SELECT COUNT(*) AS count
            FROM projects
            WHERE id = 'proj_personal'
              AND kind = 'personal'
              AND name = 'Personal'
          `,
        )
        .get();
      expect(personalProject?.count).toBe(1);

      expect(() =>
        db.$client
          .prepare(
            `
              INSERT INTO projects (id, kind, name, sort_key, created_at, updated_at)
              VALUES ('proj_second_personal', 'personal', 'Second personal', 'V', 1, 1)
            `,
          )
          .run(),
      ).toThrow();
    } finally {
      closeConnection(db);
    }
  });

  it("warns when applied migration timestamps are in the future", () => {
    const db = createConnection(":memory:");
    const logger = {
      warn: vi.fn(),
    } satisfies MigrationWarningLogger;

    try {
      migrate(db);
      const latestMigrationCreatedAt = readLatestAppliedMigrationCreatedAt(db);
      vi.useFakeTimers();
      vi.setSystemTime(latestMigrationCreatedAt + 10_000);

      migrate(db, { logger });
      expect(logger.warn).not.toHaveBeenCalled();

      const futureCreatedAt = Date.now() + 60_000;
      db.$client
        .prepare<InsertMigrationParameters>(
          `
            INSERT INTO __drizzle_migrations (hash, created_at)
            VALUES (?, ?)
          `,
        )
        .run("future-migration-hash", futureCreatedAt);

      migrate(db, { logger });

      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(
        {
          migrations: [
            {
              createdAt: futureCreatedAt,
              hash: "future-migration-hash",
            },
          ],
          now: expect.any(Number),
        },
        "Applied database migrations have future timestamps",
      );
    } finally {
      closeConnection(db);
      vi.useRealTimers();
    }
  });

  it("applies 0002 after a database already applied main's 0001 timestamp", () => {
    const db = createConnection(":memory:");

    try {
      migrate(db);

      db.$client.prepare("DROP INDEX host_daemon_commands_session_idx").run();
      db.$client
        .prepare("DROP INDEX host_daemon_sessions_closed_prune_idx")
        .run();
      db.$client
        .prepare(
          "DROP INDEX thread_dynamic_context_file_states_thread_file_idx",
        )
        .run();
      db.$client.prepare("DROP INDEX projects_sort_idx").run();
      db.$client.prepare("DROP INDEX projects_personal_singleton_idx").run();
      db.$client.prepare("DROP INDEX threads_project_type_sort_idx").run();
      db.$client
        .prepare("DROP INDEX host_daemon_commands_host_type_state_idx")
        .run();
      db.$client
        .prepare("DROP INDEX host_daemon_commands_type_state_idx")
        .run();
      db.$client.prepare("DROP INDEX threads_pin_sort_idx").run();
      db.$client.prepare("DROP TABLE thread_dynamic_context_file_states").run();
      db.$client.prepare("DROP TABLE client_turn_requests").run();
      db.$client.prepare("DELETE FROM projects WHERE kind = 'personal'").run();
      db.$client.prepare("ALTER TABLE projects DROP COLUMN kind").run();
      db.$client.prepare("ALTER TABLE projects DROP COLUMN sort_key").run();
      db.$client.prepare("ALTER TABLE threads DROP COLUMN sort_key").run();
      db.$client.prepare("ALTER TABLE threads DROP COLUMN pinned_at").run();
      db.$client.prepare("ALTER TABLE threads DROP COLUMN pin_sort_key").run();
      db.$client
        .prepare("ALTER TABLE threads DROP COLUMN model_override")
        .run();
      db.$client
        .prepare("ALTER TABLE threads DROP COLUMN reasoning_level_override")
        .run();
      db.$client.prepare("DROP TABLE host_daemon_command_attempts").run();
      // 0014 drops these two baseline columns; the main-0001 schema this
      // block reconstructs still had them (0013's table rebuilds copy them).
      db.$client
        .prepare(
          "ALTER TABLE pending_interactions ADD COLUMN resolving_command_id text REFERENCES host_daemon_commands(id) ON DELETE SET NULL",
        )
        .run();
      db.$client
        .prepare(
          "CREATE INDEX pending_interactions_resolving_command_idx ON pending_interactions (resolving_command_id)",
        )
        .run();
      db.$client
        .prepare(
          "ALTER TABLE terminal_sessions ADD COLUMN daemon_session_id text REFERENCES host_daemon_sessions(id) ON DELETE SET NULL",
        )
        .run();
      db.$client
        .prepare(
          "CREATE INDEX terminal_sessions_daemon_session_idx ON terminal_sessions (daemon_session_id)",
        )
        .run();
      db.$client.prepare("DELETE FROM __drizzle_migrations").run();
      db.$client
        .prepare<InsertMigrationParameters>(
          `
            INSERT INTO __drizzle_migrations (hash, created_at)
            VALUES (?, ?)
          `,
        )
        .run("baseline-hash", baselineWhen);
      db.$client
        .prepare<InsertMigrationParameters>(
          `
            INSERT INTO __drizzle_migrations (hash, created_at)
            VALUES (?, ?)
          `,
        )
        .run("main-0001-hash", publishedTerminalSessionUserInputWhen);

      expect(
        readIndexNames({ db, tableName: "host_daemon_commands" }),
      ).not.toContain("host_daemon_commands_session_idx");
      expect(
        readIndexNames({ db, tableName: "host_daemon_sessions" }),
      ).not.toContain("host_daemon_sessions_closed_prune_idx");

      migrate(db);

      expect(
        readIndexNames({ db, tableName: "host_daemon_commands" }),
      ).toContain("host_daemon_commands_session_idx");
      expect(
        readIndexNames({ db, tableName: "host_daemon_sessions" }),
      ).toContain("host_daemon_sessions_closed_prune_idx");

      const migrationCreatedAts = db.$client
        .prepare<[], MigrationCreatedAtRow>(
          `
            SELECT created_at AS createdAt
            FROM __drizzle_migrations
            ORDER BY created_at
          `,
        )
        .all()
        .map((row) => row.createdAt);
      expect(migrationCreatedAts).toContain(closedSessionPruneIndexesWhen);
      expect(migrationCreatedAts).toContain(threadDynamicContextFileStatesWhen);
      expect(migrationCreatedAts).toContain(commandLookupIndexesWhen);
      expect(migrationCreatedAts).toContain(threadPinningMigrationWhen);
    } finally {
      closeConnection(db);
    }
  });

  it("throws when an applied migration hash is missing behind the latest timestamp", () => {
    const db = createConnection(":memory:");

    try {
      migrate(db);
      db.$client
        .prepare<DeleteMigrationParameters>(
          `
            DELETE FROM __drizzle_migrations
            WHERE created_at = ?
          `,
        )
        .run(threadPinningMigrationWhen);

      expect(() => migrate(db)).toThrow(
        /Missing applied migration timestamps: 0008_thread_pinning/,
      );
    } finally {
      closeConnection(db);
    }
  });

  it("accepts a published migration row with a released timestamp and historical hash", () => {
    const db = createConnection(":memory:");

    try {
      migrate(db);
      replaceAppliedMigrationHash({
        db,
        createdAt: closedSessionPruneIndexesWhen,
        hash: "published-0002-historical-hash",
      });

      expect(() => migrate(db)).not.toThrow();
    } finally {
      closeConnection(db);
    }
  });

  it("fails clearly before provider-request uniqueness migration when pending interaction duplicates exist", () => {
    const db = createConnection(":memory:");

    try {
      db.$client.exec(`
        CREATE TABLE pending_interactions (
          provider_id text NOT NULL,
          provider_thread_id text NOT NULL,
          provider_request_id text NOT NULL,
          session_id text NOT NULL
        );
        INSERT INTO pending_interactions (
          provider_id,
          provider_thread_id,
          provider_request_id,
          session_id
        )
        VALUES
          ('codex', 'provider-thread-1', 'request-1', 'session-1'),
          ('codex', 'provider-thread-1', 'request-1', 'session-2');
      `);

      expect(() => migrate(db)).toThrow(
        /duplicate provider requests already exist/,
      );
    } finally {
      closeConnection(db);
    }
  });

  it("rejects a non-published migration row with a matching timestamp and wrong hash", () => {
    const db = createConnection(":memory:");

    try {
      migrate(db);
      replaceAppliedMigrationHash({
        db,
        createdAt: threadPinningMigrationWhen,
        hash: "non-published-0008-wrong-hash",
      });

      expect(() => migrate(db)).toThrow(
        /Mismatched applied migration hashes: 0008_thread_pinning/,
      );
    } finally {
      closeConnection(db);
    }
  });

  it("backfills queued message sort keys in existing created order", () => {
    const db = createConnection(":memory:");

    try {
      db.$client.exec(`
        CREATE TABLE threads (
          id text PRIMARY KEY NOT NULL
        );
        CREATE TABLE queued_thread_messages (
          id text PRIMARY KEY NOT NULL,
          thread_id text NOT NULL,
          content text NOT NULL,
          model text NOT NULL,
          reasoning_level text NOT NULL,
          permission_mode text NOT NULL,
          service_tier text NOT NULL,
          claimed_at integer,
          claim_token text,
          created_at integer NOT NULL,
          updated_at integer NOT NULL,
          FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE cascade
        );
      `);
      db.$client
        .prepare("INSERT INTO threads (id) VALUES (?), (?)")
        .run("thr_a", "thr_b");
      const insertQueuedMessage =
        db.$client.prepare<QueuedMessageMigrationInsertParameters>(
          `
          INSERT INTO queued_thread_messages (
            id,
            thread_id,
            content,
            model,
            reasoning_level,
            permission_mode,
            service_tier,
            created_at,
            updated_at
          )
          VALUES (?, ?, '[]', 'gpt-5', 'medium', 'full', 'default', ?, ?)
        `,
        );
      insertQueuedMessage.run("qmsg_b", "thr_a", 1_000, 1_000);
      insertQueuedMessage.run("qmsg_a", "thr_a", 1_000, 1_000);
      insertQueuedMessage.run("qmsg_c", "thr_a", 2_000, 2_000);
      insertQueuedMessage.run("qmsg_other", "thr_b", 500, 500);

      runQueuedMessageSortKeyMigration(db);

      expect(
        db.$client
          .prepare<[], MigratedQueuedMessageRow>(
            `
              SELECT id, thread_id AS threadId, sort_key AS sortKey
              FROM queued_thread_messages
              ORDER BY thread_id, sort_key
            `,
          )
          .all(),
      ).toEqual([
        { id: "qmsg_a", threadId: "thr_a", sortKey: "0000000000000001" },
        { id: "qmsg_b", threadId: "thr_a", sortKey: "0000000000000002" },
        { id: "qmsg_c", threadId: "thr_a", sortKey: "0000000000000003" },
        {
          id: "qmsg_other",
          threadId: "thr_b",
          sortKey: "0000000000000001",
        },
      ]);
    } finally {
      closeConnection(db);
    }
  });

  it("backfills project and manager thread sort keys", () => {
    const db = createConnection(":memory:");

    try {
      db.$client.exec(`
        CREATE TABLE projects (
          id text PRIMARY KEY NOT NULL,
          name text NOT NULL,
          created_at integer NOT NULL,
          updated_at integer NOT NULL
        );
        CREATE TABLE threads (
          id text PRIMARY KEY NOT NULL,
          project_id text NOT NULL,
          type text NOT NULL,
          created_at integer NOT NULL
        );
      `);
      const insertProject =
        db.$client.prepare<ProjectSortKeyMigrationInsertParameters>(
          `
            INSERT INTO projects (id, name, created_at, updated_at)
            VALUES (?, ?, ?, ?)
          `,
        );
      insertProject.run("proj_b", "Project B", 1_000, 1_000);
      insertProject.run("proj_a", "Project A", 1_000, 1_000);
      insertProject.run("proj_c", "Project C", 2_000, 2_000);

      const insertThread =
        db.$client.prepare<ThreadSortKeyMigrationInsertParameters>(
          `
            INSERT INTO threads (id, project_id, type, created_at)
            VALUES (?, ?, ?, ?)
          `,
        );
      insertThread.run("thr_manager_b", "proj_a", "manager", 1_000);
      insertThread.run("thr_manager_a", "proj_a", "manager", 2_000);
      insertThread.run("thr_standard", "proj_a", "standard", 3_000);
      insertThread.run("thr_other", "proj_b", "manager", 500);

      runSidebarOrderingMigration(db);

      expect(
        db.$client
          .prepare<[], MigratedProjectRow>(
            `
              SELECT id, sort_key AS sortKey
              FROM projects
              ORDER BY sort_key
            `,
          )
          .all(),
      ).toEqual([
        { id: "proj_a", sortKey: "0000000000000001" },
        { id: "proj_b", sortKey: "0000000000000002" },
        { id: "proj_c", sortKey: "0000000000000003" },
      ]);
      expect(
        db.$client
          .prepare<[], MigratedThreadSortKeyRow>(
            `
              SELECT id, sort_key AS sortKey
              FROM threads
              WHERE project_id = 'proj_a'
              ORDER BY sort_key
            `,
          )
          .all(),
      ).toEqual([
        { id: "thr_standard", sortKey: null },
        { id: "thr_manager_a", sortKey: "0000000000000001" },
        { id: "thr_manager_b", sortKey: "0000000000000002" },
      ]);
    } finally {
      closeConnection(db);
    }
  });

  it("adds nullable thread pinning columns and index", () => {
    const db = createConnection(":memory:");

    try {
      db.$client.exec(`
        CREATE TABLE threads (
          id text PRIMARY KEY NOT NULL,
          project_id text NOT NULL,
          archived_at integer,
          deleted_at integer
        );
      `);

      runThreadPinningMigration(db);

      const columns = db.$client
        .prepare<[], TableInfoRow>("PRAGMA table_info(threads)")
        .all();
      const columnsByName = new Map(
        columns.map((column) => [column.name, column]),
      );
      expect(columnsByName.get("pinned_at")?.notnull).toBe(0);
      expect(columnsByName.get("pin_sort_key")?.notnull).toBe(0);
      expect(readIndexNames({ db, tableName: "threads" })).toContain(
        "threads_pin_sort_idx",
      );
    } finally {
      closeConnection(db);
    }
  });
});
