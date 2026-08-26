import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createConnection } from "../src/index.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("plugin health migration", () => {
  it("upgrades a previously persisted plugin without fabricating a problem", () => {
    const db = createConnection(":memory:");
    try {
      // The released table already has the plugin identity. This focused
      // upgrade fixture intentionally contains only the column the additive
      // migration needs in order to prove its defaults and null semantics.
      db.$client.exec(`
        CREATE TABLE plugins (id text PRIMARY KEY NOT NULL);
        INSERT INTO plugins (id) VALUES ('legacy-plugin');
      `);
      const sql = readFileSync(
        resolve(packageRoot, "drizzle/0110_broken_ultimo.sql"),
        "utf8",
      ).replaceAll("--> statement-breakpoint", "");
      db.$client.exec(sql);

      expect(
        db.$client
          .prepare<
            [],
            {
              handlerErrorCount: number;
              lastProblemAt: number | null;
              lastProblemClass: string | null;
              lastProblemMessage: string | null;
            }
          >(
            `
            SELECT
              handler_error_count AS handlerErrorCount,
              last_problem_class AS lastProblemClass,
              last_problem_message AS lastProblemMessage,
              last_problem_at AS lastProblemAt
            FROM plugins WHERE id = 'legacy-plugin'
          `,
          )
          .get(),
      ).toEqual({
        handlerErrorCount: 0,
        lastProblemClass: null,
        lastProblemMessage: null,
        lastProblemAt: null,
      });
    } finally {
      db.$client.close();
    }
  });
});
