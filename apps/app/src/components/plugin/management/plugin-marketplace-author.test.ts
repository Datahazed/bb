import { describe, expect, it } from "vitest";
import type { PluginCatalogSearchEntry } from "@/hooks/queries/plugin-catalog-queries";
import {
  entriesByMarketplaceAuthor,
  pluginMarketplaceAuthorId,
} from "./plugin-marketplace-author";

function entry(
  marketplace: string,
  author: PluginCatalogSearchEntry["author"],
): Pick<PluginCatalogSearchEntry, "author" | "marketplace"> {
  return { marketplace, author };
}

describe("plugin marketplace author identity", () => {
  it("prefers a canonical GitHub login while keeping marketplaces separate", () => {
    expect(
      pluginMarketplaceAuthorId(
        entry("first", {
          name: "Pat Lee",
          url: "https://www.github.com/PatLee/",
        }),
      ),
    ).toBe("5:first:github:patlee");
    expect(
      pluginMarketplaceAuthorId(
        entry("second", {
          name: "Patricia Lee",
          url: "https://github.com/patlee",
        }),
      ),
    ).toBe("6:second:github:patlee");
  });

  it("canonicalizes explicit URLs and scopes name-only fallbacks by marketplace", () => {
    expect(
      pluginMarketplaceAuthorId(
        entry("first", { name: "Acme", url: "https://ACME.test/team/" }),
      ),
    ).toBe("5:first:url:https://acme.test/team");
    expect(
      pluginMarketplaceAuthorId(
        entry("first", { name: "  Pat   Lee ", url: null }),
      ),
    ).toBe("5:first:name:pat lee");
    expect(
      pluginMarketplaceAuthorId(
        entry("second", { name: "Pat Lee", url: null }),
      ),
    ).toBe("6:second:name:pat lee");
  });

  it("groups only entries with the same canonical author", () => {
    const entries = [
      {
        marketplace: "first",
        author: { name: "Pat Lee", url: null },
        pluginId: "one",
      },
      {
        marketplace: "first",
        author: { name: " PAT LEE ", url: null },
        pluginId: "two",
      },
      {
        marketplace: "second",
        author: { name: "Pat Lee", url: null },
        pluginId: "three",
      },
    ];

    expect(entriesByMarketplaceAuthor(entries, "5:first:name:pat lee")).toEqual(
      entries.slice(0, 2),
    );
  });
});
