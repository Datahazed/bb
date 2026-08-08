import { describe, expect, it } from "vitest";
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
        harness.deps.databaseReads.listThreadEntriesForProjects = async () => {
          markReadStarted();
          await readFinished;
          return [];
        };

        const projectRead = harness.app.request(path);
        await readStarted;
        const healthResponse = await harness.app.request("/health");

        expect(healthResponse.status).toBe(200);
        await expect(healthResponse.json()).resolves.toEqual({ ok: true });
        finishRead();
        await expect(projectRead).resolves.toMatchObject({ status: 200 });
      });
    });
  }
});
