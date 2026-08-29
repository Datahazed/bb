import { describe, expect, it } from "vitest";

import {
  MARKETPLACE_STATS_FIXTURE,
  MARKETPLACE_V2_FIXTURE,
} from "./marketplace-v2.fixture.js";
import {
  filterMarketplaceEntries,
  marketplaceAssetUrl,
  marketplaceInstallCommand,
  marketplaceShelves,
  newAndNotableEntries,
  sortMarketplaceEntries,
} from "./marketplace-view-model.js";

describe("public marketplace view model", () => {
  it("orders shelves and preserves the curated New & notable order", () => {
    expect(marketplaceShelves(MARKETPLACE_V2_FIXTURE.plugins)).toHaveLength(2);
    expect(
      newAndNotableEntries(MARKETPLACE_V2_FIXTURE).map((entry) => entry.id),
    ).toEqual(MARKETPLACE_V2_FIXTURE.newAndNotable);
  });

  it("searches plugin copy, authors, tags, and category labels", () => {
    const entries = MARKETPLACE_V2_FIXTURE.plugins;
    expect(filterMarketplaceEntries(entries, "Acme")).toEqual([entries[1]]);
    expect(filterMarketplaceEntries(entries, "Code & Reviews")).toEqual([
      entries[1],
    ]);
    expect(filterMarketplaceEntries(entries, "templates")).toEqual([
      entries[0],
    ]);
  });

  it("sorts unknown install counts after known counts", () => {
    const [known, unknown] = MARKETPLACE_V2_FIXTURE.plugins;
    expect(
      sortMarketplaceEntries(
        [unknown!, known!],
        "most-installed",
        MARKETPLACE_STATS_FIXTURE,
      ).map((entry) => entry.id),
    ).toEqual([known!.id, unknown!.id]);
  });

  it("exposes only the CLI install command and resolves v2 assets", () => {
    expect(marketplaceInstallCommand("prompt-library")).toBe(
      "bb plugin install prompt-library",
    );
    expect(marketplaceAssetUrl("icons/prompt.svg")).toBe(
      "/marketplace/v2/icons/prompt.svg",
    );
  });
});
