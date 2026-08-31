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
  it("uses the declared GitHub login while keeping marketplaces separate", () => {
    expect(
      pluginMarketplaceAuthorId(
        entry("first", {
          name: "Pat Lee",
          github: "PatLee",
          url: "https://patlee.dev",
        }),
      ),
    ).toBe("5:first:github:patlee");
    expect(
      pluginMarketplaceAuthorId(
        entry("second", {
          name: "Patricia Lee",
          github: "patlee",
          url: null,
        }),
      ),
    ).toBe("6:second:github:patlee");
  });

  it("ignores arbitrary URLs and scopes name fallbacks by marketplace", () => {
    expect(
      pluginMarketplaceAuthorId(
        entry("first", {
          name: "Acme",
          github: null,
          url: "https://acme.test/team/",
        }),
      ),
    ).toBe("5:first:name:acme");
    expect(
      pluginMarketplaceAuthorId(
        entry("first", { name: "  Pat   Lee ", github: null, url: null }),
      ),
    ).toBe("5:first:name:pat lee");
    expect(
      pluginMarketplaceAuthorId(
        entry("second", { name: "Pat Lee", github: null, url: null }),
      ),
    ).toBe("6:second:name:pat lee");
  });

  it("groups only entries with the same canonical author", () => {
    const entries = [
      {
        marketplace: "first",
        author: { name: "Pat Lee", github: null, url: "https://one.test" },
        pluginId: "one",
      },
      {
        marketplace: "first",
        author: { name: " PAT LEE ", github: null, url: "https://two.test" },
        pluginId: "two",
      },
      {
        marketplace: "second",
        author: { name: "Pat Lee", github: null, url: null },
        pluginId: "three",
      },
    ];

    expect(entriesByMarketplaceAuthor(entries, "5:first:name:pat lee")).toEqual(
      entries.slice(0, 2),
    );
  });
});
