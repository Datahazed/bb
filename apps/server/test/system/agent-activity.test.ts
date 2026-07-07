import { describe, expect, it } from "vitest";
import { projects, threads } from "@bb/db";
import type { ThreadStatus } from "@bb/domain";
import { readJson } from "../helpers/json.js";
import { withTestHarness } from "../helpers/test-app.js";

describe("GET /api/v1/system/agents/activity", () => {
  it("counts only live busy threads", async () => {
    await withTestHarness({}, async (harness) => {
      const now = Date.now();
      harness.db
        .insert(projects)
        .values({ id: "proj_1", name: "Test", createdAt: now, updatedAt: now })
        .run();
      const thread = (
        id: string,
        status: ThreadStatus,
        deletedAt: number | null,
      ) =>
        harness.db
          .insert(threads)
          .values({
            id,
            projectId: "proj_1",
            providerId: "test-provider",
            status,
            deletedAt,
            latestAttentionAt: now,
            createdAt: now,
            updatedAt: now,
          })
          .run();
      thread("thr_active", "active", null);
      thread("thr_starting", "starting", null);
      thread("thr_stopping", "stopping", null);
      thread("thr_idle", "idle", null);
      thread("thr_error", "error", null);
      thread("thr_deleted", "active", now);

      const response = await harness.app.request(
        "/api/v1/system/agents/activity",
      );
      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toEqual({
        busyThreadCount: 3,
        queuedThreadCount: 0,
      });
    });
  });
});
