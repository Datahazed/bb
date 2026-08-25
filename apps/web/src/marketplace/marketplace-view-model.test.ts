import { describe, expect, it, vi } from "vitest";

import { MARKETPLACE_V2_FIXTURE } from "./marketplace-v2.fixture.js";
import {
  attemptMarketplaceInstall,
  filterMarketplaceEntries,
  marketplaceInstallCommand,
  marketplaceInstallDeepLink,
  marketplaceShelves,
  newAndNotableEntries,
  sortMarketplaceEntries,
} from "./marketplace-view-model.js";

describe("public marketplace view model", () => {
  it("orders category shelves by size and keeps curated order", () => {
    const shelves = marketplaceShelves(MARKETPLACE_V2_FIXTURE.plugins);
    expect(shelves[0]?.entries.length).toBeGreaterThanOrEqual(
      shelves.at(-1)?.entries.length ?? 0,
    );
    expect(
      newAndNotableEntries(MARKETPLACE_V2_FIXTURE).map(({ id }) => id),
    ).toEqual(MARKETPLACE_V2_FIXTURE.newAndNotable);
  });

  it("searches copy, author, tags, and category labels", () => {
    const entries = MARKETPLACE_V2_FIXTURE.plugins;
    expect(
      filterMarketplaceEntries(entries, entries[0]!.author.name),
    ).toContain(entries[0]);
    expect(filterMarketplaceEntries(entries, entries[0]!.category)).toContain(
      entries[0],
    );
  });

  it("sorts missing metrics after known values rather than treating them as zero", () => {
    const [known, unknown] = MARKETPLACE_V2_FIXTURE.plugins;
    expect(known?.installCount).toBeTypeOf("number");
    expect(unknown?.installCount).toBeUndefined();
    expect(
      sortMarketplaceEntries([unknown!, known!], "most-installed").map(
        ({ id }) => id,
      ),
    ).toEqual([known!.id, unknown!.id]);
  });

  it("attempts the app deeplink before revealing the exact CLI fallback", () => {
    const calls: string[] = [];
    const openDeepLink = vi.fn((href: string) => calls.push(`open:${href}`));
    const revealFallback = vi.fn((command: string) =>
      calls.push(`fallback:${command}`),
    );

    attemptMarketplaceInstall({
      entryId: "thread-hover-cards",
      openDeepLink,
      revealFallback,
    });

    expect(marketplaceInstallDeepLink("thread-hover-cards")).toBe(
      "bb://extensions/plugins/thread-hover-cards?install=1",
    );
    expect(marketplaceInstallCommand("thread-hover-cards")).toBe(
      "bb plugin install thread-hover-cards",
    );
    expect(calls).toEqual([
      "open:bb://extensions/plugins/thread-hover-cards?install=1",
      "fallback:bb plugin install thread-hover-cards",
    ]);
  });
});
