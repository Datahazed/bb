import { describe, expect, it } from "vitest";
import type {
  SystemVersionInfo,
  SystemVersionResponse,
} from "@bb/server-contract";
import { readJson } from "../helpers/json.js";
import { withTestHarness } from "../helpers/test-app.js";

function createStubAppVersionService(response: SystemVersionInfo) {
  return {
    async getSystemVersion(): Promise<SystemVersionInfo> {
      return response;
    },
  };
}

describe("GET /api/v1/system/version", () => {
  it("returns the app-version info plus the self-update state", async () => {
    const versionInfo: SystemVersionInfo = {
      currentVersion: "0.0.5",
      latestVersion: "0.0.6",
      source: "npm",
      updateAvailable: true,
      isDevelopment: false,
      upgradeCommand: "npx bb-app@latest",
    };
    await withTestHarness({
      appVersion: "0.0.5",
      appVersionService: createStubAppVersionService(versionInfo),
      isDevelopment: false,
    }, async (harness) => {
      const response = await harness.app.request("/api/v1/system/version");
      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toEqual({
        ...versionInfo,
        selfUpdate: { capable: false, scheduled: null, lastError: null },
      });
    });
  });

  it("reports updateAvailable=false in development mode", async () => {
    await withTestHarness({
      appVersion: "0.0.5",
      appVersionService: createStubAppVersionService({
        currentVersion: "0.0.5",
        latestVersion: null,
        source: "npm",
        updateAvailable: false,
        isDevelopment: true,
        upgradeCommand: "npx bb-app@latest",
      }),
      isDevelopment: true,
    }, async (harness) => {
      const response = await harness.app.request("/api/v1/system/version");
      expect(response.status).toBe(200);
      const body = (await readJson(response)) as SystemVersionResponse;
      expect(body.isDevelopment).toBe(true);
      expect(body.updateAvailable).toBe(false);
      expect(body.latestVersion).toBeNull();
      expect(body.selfUpdate.capable).toBe(false);
    });
  });
});
