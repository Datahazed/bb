import { describe, expect, it } from "vitest";
import {
  marketplaceAuthorEntrySchema,
  marketplaceEntryV1Schema,
  marketplaceEntryV2Schema,
} from "../src/plugin-marketplace-entry.js";

function v1Entry(): Record<string, unknown> {
  return {
    id: "author-tools",
    displayName: "Author tools",
    description: "Tools for plugin authors.",
    icon: "Toolbox",
    tags: ["plugin-development"],
    author: { name: "Author", github: "author" },
    source: {
      git: {
        url: "https://github.com/author/author-tools.git",
        range: "^1.0.0",
        tagPrefix: "author-tools/",
      },
    },
  };
}

function v2Entry(): Record<string, unknown> {
  return {
    ...v1Entry(),
    category: "plugin-development",
    screenshots: [],
  };
}

describe("marketplace entry schemas", () => {
  it("keeps v1 strict and free of discovery fields", () => {
    expect(marketplaceEntryV1Schema.parse(v1Entry())).toEqual(v1Entry());
    for (const field of [
      "category",
      "screenshots",
      "installCount",
      "publishedAt",
      "updatedAt",
    ]) {
      expect(
        marketplaceEntryV1Schema.safeParse({ ...v1Entry(), [field]: null })
          .success,
      ).toBe(false);
    }
  });

  it("requires a v2 category and keeps omitted registry dates absent", () => {
    const { category: _category, ...withoutCategory } = v2Entry();
    expect(marketplaceEntryV2Schema.safeParse(withoutCategory).success).toBe(
      false,
    );

    const parsed = marketplaceEntryV2Schema.parse(v2Entry());
    expect(parsed).not.toHaveProperty("installCount");
    expect(parsed).not.toHaveProperty("publishedAt");
    expect(parsed).not.toHaveProperty("updatedAt");
    expect(
      marketplaceEntryV2Schema.safeParse({ ...v2Entry(), installCount: 1 })
        .success,
    ).toBe(false);
  });

  it("enforces the public tag-prefix length constraint", () => {
    const sourceWithPrefix = (
      entry: Record<string, unknown>,
      tagPrefix: string,
    ) => ({
      ...entry,
      source: {
        git: {
          url: "https://github.com/author/author-tools.git",
          range: "^1.0.0",
          tagPrefix,
        },
      },
    });

    expect(
      marketplaceEntryV1Schema.safeParse(
        sourceWithPrefix(v1Entry(), "a".repeat(128)),
      ).success,
    ).toBe(true);
    expect(
      marketplaceEntryV2Schema.safeParse(
        sourceWithPrefix(v2Entry(), "a".repeat(128)),
      ).success,
    ).toBe(true);
    expect(
      marketplaceEntryV2Schema.safeParse(
        sourceWithPrefix(v2Entry(), "a".repeat(129)),
      ).success,
    ).toBe(false);
    expect(
      marketplaceEntryV1Schema.safeParse(
        sourceWithPrefix(v1Entry(), "a".repeat(129)),
      ).success,
    ).toBe(false);
  });
});

describe("marketplace author entry projection", () => {
  it("preserves draft normalization while deriving v2 validation", () => {
    const parsed = marketplaceAuthorEntrySchema.parse({
      ...v2Entry(),
      displayName: "  Author tools  ",
      description: "  Tools for plugin authors.  ",
      tags: ["  plugin-development  "],
      screenshots: ["  screenshots/author-tools.png  "],
      author: { name: "  Author  ", github: "author" },
      source: {
        git: {
          url: "https://github.com/author/author-tools.git",
          subdir: "  plugins/author-tools  ",
          range: "  ^1.0.0  ",
          tagPrefix: "  author-tools/  ",
        },
      },
    });

    expect(parsed).toMatchObject({
      displayName: "Author tools",
      description: "Tools for plugin authors.",
      tags: ["plugin-development"],
      screenshots: ["screenshots/author-tools.png"],
      author: { name: "Author" },
      source: {
        git: {
          subdir: "plugins/author-tools",
          range: "^1.0.0",
          tagPrefix: "author-tools/",
        },
      },
    });
  });

  it("requires screenshots and rejects registry-owned metrics", () => {
    const { screenshots: _screenshots, ...withoutScreenshots } = v2Entry();
    expect(
      marketplaceAuthorEntrySchema.safeParse(withoutScreenshots).success,
    ).toBe(false);
    expect(
      marketplaceAuthorEntrySchema.safeParse({
        ...v2Entry(),
        installCount: 1,
      }).success,
    ).toBe(false);
  });

  it.each([
    ["author URL", { author: { name: "Author", url: "https://" } }],
    [
      "npm registry",
      {
        source: {
          npm: { package: "bb-plugin-author-tools", registry: "https://" },
        },
      },
    ],
    ["git URL", { source: { git: { url: "https://", range: "^1.0.0" } } }],
  ])("rejects malformed %s values at the draft boundary", (_label, change) => {
    expect(
      marketplaceAuthorEntrySchema.safeParse({ ...v2Entry(), ...change })
        .success,
    ).toBe(false);
  });
});
