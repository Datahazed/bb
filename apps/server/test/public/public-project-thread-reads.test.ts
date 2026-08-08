import { describe, expect, it, vi } from "vitest";
import { DatabaseReadUnavailableError } from "../../src/services/database/database-read-service.js";
import { withTestHarness } from "../helpers/test-app.js";

describe("project thread reads", () => {
  for (const path of [
    "/api/v1/projects?include=threads",
    "/api/v1/sidebar-bootstrap",
  ]) {
    it(`serves health checks while ${path} waits for thread data`, async () => {
      await withTestHarness(async (harness) => {
        let finishRead!: () => void;
        let markReadStarted!: () => void;
        const readStarted = new Promise<void>((resolve) => {
          markReadStarted = resolve;
        });
        const readFinished = new Promise<void>((resolve) => {
          finishRead = resolve;
        });
        let requestSignal: AbortSignal | undefined;
        if (path.includes("sidebar-bootstrap")) {
          const getSidebarBootstrap =
            harness.deps.databaseReads.getSidebarBootstrap.bind(
              harness.deps.databaseReads,
            );
          harness.deps.databaseReads.getSidebarBootstrap = async (context) => {
            requestSignal = context?.signal;
            markReadStarted();
            await readFinished;
            return getSidebarBootstrap(context);
          };
        } else {
          const listProjectsWithThreads =
            harness.deps.databaseReads.listProjectsWithThreads.bind(
              harness.deps.databaseReads,
            );
          harness.deps.databaseReads.listProjectsWithThreads = async (
            options,
            context,
          ) => {
            requestSignal = context?.signal;
            markReadStarted();
            await readFinished;
            return listProjectsWithThreads(options, context);
          };
        }

        const projectRead = harness.app.request(path);
        await readStarted;
        const healthResponse = await harness.app.request("/health");

        expect(requestSignal).toBeInstanceOf(AbortSignal);
        expect(healthResponse.status).toBe(200);
        await expect(healthResponse.json()).resolves.toEqual({ ok: true });
        finishRead();
        await expect(projectRead).resolves.toMatchObject({ status: 200 });
      });
    });
  }

  it("returns a retryable unavailable response when the read queue is full", async () => {
    await withTestHarness(async (harness) => {
      harness.deps.databaseReads.listProjectsWithThreads = async () => {
        throw new DatabaseReadUnavailableError(
          "The database read queue is full. Try again later.",
        );
      };

      const response = await harness.app.request(
        "/api/v1/projects?include=threads",
      );

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({
        code: "database_read_unavailable",
        message: "The database read queue is full. Try again later.",
        retryable: true,
      });
    });
  });

  it("uses one database read for the sidebar bootstrap", async () => {
    await withTestHarness(async (harness) => {
      const getSidebarBootstrap = vi.spyOn(
        harness.deps.databaseReads,
        "getSidebarBootstrap",
      );

      const response = await harness.app.request("/api/v1/sidebar-bootstrap");

      expect(response.status).toBe(200);
      expect(getSidebarBootstrap).toHaveBeenCalledOnce();
      expect(getSidebarBootstrap).toHaveBeenCalledWith({
        signal: expect.any(AbortSignal),
      });
    });
  });
});
