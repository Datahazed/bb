import { describe, expect, it } from "vitest";

import {
  MARKETPLACE_STATS_FIXTURE,
  MARKETPLACE_V2_FIXTURE,
} from "./marketplace-v2.fixture.js";
import {
  marketplaceEntryInstalls,
  parseMarketplaceStats,
} from "./marketplace-stats.js";

describe("public marketplace install stats", () => {
  it("reads counts from the sidecar without adding them to v2 entries", () => {
    const [counted, uncounted] = MARKETPLACE_V2_FIXTURE.plugins;
    expect(marketplaceEntryInstalls(counted!, MARKETPLACE_STATS_FIXTURE)).toBe(
      1_204,
    );
    expect(
      marketplaceEntryInstalls(uncounted!, MARKETPLACE_STATS_FIXTURE),
    ).toBeUndefined();
    expect(counted).not.toHaveProperty("installCount");
  });

  it("matches the server's forward-compatible all-or-nothing parser", () => {
    expect(
      parseMarketplaceStats({
        ...MARKETPLACE_STATS_FIXTURE,
        futureField: true,
        plugins: {
          ...MARKETPLACE_STATS_FIXTURE.plugins,
          "future-plugin": { installs: 2, futureField: true },
          "Bad Plugin": { installs: 99 },
        },
      }),
    ).toEqual({
      ...MARKETPLACE_STATS_FIXTURE,
      plugins: {
        ...MARKETPLACE_STATS_FIXTURE.plugins,
        "future-plugin": { installs: 2 },
      },
    });
    expect(() =>
      parseMarketplaceStats({
        ...MARKETPLACE_STATS_FIXTURE,
        plugins: { "prompt-library": { installs: -1 } },
      }),
    ).toThrow();
  });
});
