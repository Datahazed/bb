import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { initDb } from "../../src/db.js";
import {
  createDirectDatabaseReadService,
  createWorkerDatabaseReadService,
} from "../../src/services/database/database-read-service.js";
import { testLogger, withTestHarness } from "../helpers/test-app.js";

describe("public thread list worker", () => {
  it("returns the same response bytes as the direct database path", async () => {
    await withTestHarness(async (harness) => {
      const dataDir = await mkdtemp(join(tmpdir(), "bb-thread-list-worker-"));
      const databasePath = join(dataDir, "bb.db");
      const db = initDb(databasePath);
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
          'thr_worker_route',
          'proj_personal',
          'codex',
          'idle',
          1,
          1,
          1,
          'visible'
        )
      `);
      const directReads = createDirectDatabaseReadService({
        db,
        hub: harness.hub,
      });
      const workerReads = await createWorkerDatabaseReadService({
        databasePath,
        hub: harness.hub,
        logger: testLogger,
      });
      harness.deps.databaseReads = workerReads;

      try {
        const directEntries = await directReads.listThreadEntries({});
        const response = await harness.app.request("/api/v1/threads");

        expect(response.status).toBe(200);
        await expect(response.text()).resolves.toBe(
          JSON.stringify(directEntries),
        );
      } finally {
        await workerReads.close();
        db.$client.close();
        await rm(dataDir, { force: true, recursive: true });
      }
    });
  }, 15_000);

  it("keeps sidebar response bytes equal to the direct database path", async () => {
    await withTestHarness(async (harness) => {
      const dataDir = await mkdtemp(join(tmpdir(), "bb-sidebar-worker-"));
      const databasePath = join(dataDir, "bb.db");
      const db = initDb(databasePath);
      const directReads = createDirectDatabaseReadService({
        db,
        hub: harness.hub,
      });
      const workerReads = await createWorkerDatabaseReadService({
        databasePath,
        hub: harness.hub,
        logger: testLogger,
      });
      harness.deps.databaseReads = workerReads;

      try {
        const directResponse = await directReads.getSidebarBootstrap();
        const response = await harness.app.request("/api/v1/sidebar-bootstrap");

        expect(response.status).toBe(200);
        await expect(response.text()).resolves.toBe(
          JSON.stringify(directResponse),
        );
      } finally {
        await workerReads.close();
        db.$client.close();
        await rm(dataDir, { force: true, recursive: true });
      }
    });
  }, 15_000);

  it("rejects unsafe list bounds at the HTTP boundary", async () => {
    await withTestHarness(async (harness) => {
      const response = await harness.app.request(
        `/api/v1/threads?limit=${String(Number.MAX_SAFE_INTEGER + 1)}`,
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        code: "invalid_request",
      });
    });
  });
});
