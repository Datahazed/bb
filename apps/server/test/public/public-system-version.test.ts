import { describe, expect, it, vi } from "vitest";
import type { SystemVersionResponse } from "@bb/server-contract";
import type { AppVersionGetSystemVersionArgs } from "../../src/services/system/app-version.js";
import { readJson } from "../helpers/json.js";
import { withTestHarness } from "../helpers/test-app.js";

function createStubAppVersionService(response: SystemVersionResponse) {
  const getSystemVersion = vi.fn(
    async (
      _args: AppVersionGetSystemVersionArgs,
    ): Promise<SystemVersionResponse> => response,
  );
  return {
    getSystemVersion,
  };
}

describe("GET /api/v1/system/version", () => {
  it("reports updateAvailable=false in development mode", async () => {
    await withTestHarness(
      {
        appVersion: "0.0.5",
        appVersionService: createStubAppVersionService({
          currentVersion: "0.0.5",
          latestVersion: null,
          source: "npm",
          updateAvailable: false,
          isDevelopment: true,
          build: null,
          upgradeCommand: "npx bb-app@latest",
        }),
        isDevelopment: true,
      },
      async (harness) => {
        const response = await harness.app.request("/api/v1/system/version");
        expect(response.status).toBe(200);
        const body = (await readJson(response)) as SystemVersionResponse;
        expect(body.isDevelopment).toBe(true);
        expect(body.updateAvailable).toBe(false);
        expect(body.latestVersion).toBeNull();
      },
    );
  });

  it("can omit the npm update lookup for a build-only read", async () => {
    const appVersionService = createStubAppVersionService({
      currentVersion: "0.0.5",
      latestVersion: null,
      source: "npm",
      updateAvailable: false,
      isDevelopment: false,
      build: null,
      upgradeCommand: "npx bb-app@latest",
    });
    await withTestHarness(
      { appVersionService, isDevelopment: false },
      async (harness) => {
        const response = await harness.app.request(
          "/api/v1/system/version?includeUpdates=false",
        );
        expect(response.status).toBe(200);
        expect(appVersionService.getSystemVersion).toHaveBeenCalledWith({
          forceRefresh: false,
          includeUpdates: false,
        });
      },
    );
  });
});
