import { describe, expect, it } from "vitest";

import {
  loadPublicMarketplace,
  MARKETPLACE_STATS_PATH,
  MARKETPLACE_V2_MANIFEST_PATH,
} from "./marketplace-data.js";
import {
  MARKETPLACE_STATS_FIXTURE,
  MARKETPLACE_V2_FIXTURE,
} from "./marketplace-v2.fixture.js";

describe("loadPublicMarketplace", () => {
  it("returns an explicit unavailable state when v2 cannot load", async () => {
    await expect(
      loadPublicMarketplace(async () => {
        throw new Error("offline");
      }),
    ).resolves.toEqual({ status: "unavailable" });
  });

  it("keeps the catalog available when only stats fail", async () => {
    await expect(
      loadPublicMarketplace(async (path) => {
        if (path === MARKETPLACE_V2_MANIFEST_PATH) {
          return MARKETPLACE_V2_FIXTURE;
        }
        throw new Error("stats offline");
      }),
    ).resolves.toEqual({
      status: "available",
      manifest: MARKETPLACE_V2_FIXTURE,
      stats: null,
    });
  });

  it("loads v2 and the install-count sidecar from separate paths", async () => {
    const paths: string[] = [];
    const data = await loadPublicMarketplace(async (path) => {
      paths.push(path);
      return path === MARKETPLACE_STATS_PATH
        ? MARKETPLACE_STATS_FIXTURE
        : MARKETPLACE_V2_FIXTURE;
    });
    expect(paths).toEqual([
      MARKETPLACE_V2_MANIFEST_PATH,
      MARKETPLACE_STATS_PATH,
    ]);
    expect(data).toEqual({
      status: "available",
      manifest: MARKETPLACE_V2_FIXTURE,
      stats: MARKETPLACE_STATS_FIXTURE,
    });
  });
});
