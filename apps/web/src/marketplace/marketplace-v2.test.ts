import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import { MARKETPLACE_V2_FIXTURE } from "./marketplace-v2.fixture.js";
import {
  MARKETPLACE_CATEGORY_IDS,
  MARKETPLACE_SEMVER_RANGE_PATTERN,
  MARKETPLACE_V2_SCHEMA_URL,
  type MarketplaceV2Manifest,
  marketplaceV2ManifestSchema,
  parseMarketplaceV2Manifest,
} from "./marketplace-v2.js";

const jsonSchemaShape = z
  .object({
    $id: z.string(),
    required: z.array(z.string()),
    properties: z
      .object({
        schemaVersion: z.object({ const: z.unknown() }).passthrough(),
        newAndNotable: z.object({ uniqueItems: z.boolean() }).passthrough(),
        plugins: z.object({ maxItems: z.number() }).passthrough(),
      })
      .passthrough(),
    $defs: z
      .object({
        entry: z
          .object({
            required: z.array(z.string()),
            properties: z
              .object({
                category: z.object({ enum: z.array(z.string()) }).passthrough(),
                screenshots: z.object({ maxItems: z.number() }).passthrough(),
                installCount: z
                  .object({ type: z.string(), minimum: z.number() })
                  .passthrough(),
                publishedAt: z
                  .object({ type: z.string(), format: z.string() })
                  .passthrough(),
                updatedAt: z
                  .object({ type: z.string(), format: z.string() })
                  .passthrough(),
              })
              .passthrough(),
          })
          .passthrough(),
        semverRange: z.object({ pattern: z.string() }).passthrough(),
      })
      .passthrough(),
  })
  .passthrough();

const generatedSchemaShape = z
  .object({
    required: z.array(z.string()),
    properties: z
      .object({
        schemaVersion: z.object({ const: z.unknown() }).passthrough(),
        newAndNotable: z.object({ type: z.string() }).passthrough(),
        plugins: z
          .object({
            maxItems: z.number(),
            items: z
              .object({
                required: z.array(z.string()),
                properties: z
                  .object({
                    category: z
                      .object({ enum: z.array(z.string()) })
                      .passthrough(),
                    screenshots: z
                      .object({ maxItems: z.number() })
                      .passthrough(),
                    installCount: z
                      .object({ type: z.string(), minimum: z.number() })
                      .passthrough(),
                    publishedAt: z
                      .object({ type: z.string(), format: z.string() })
                      .passthrough(),
                    updatedAt: z
                      .object({ type: z.string(), format: z.string() })
                      .passthrough(),
                  })
                  .passthrough(),
              })
              .passthrough(),
          })
          .passthrough(),
      })
      .passthrough(),
  })
  .passthrough();

const unknownRecordSchema = z.record(z.string(), z.unknown());
const stringLengthConstraintsSchema = z
  .object({
    minLength: z.number().optional(),
    maxLength: z.number().optional(),
  })
  .strip();

function findStringPropertyConstraints(
  schema: unknown,
  propertyName: string,
): z.infer<typeof stringLengthConstraintsSchema> {
  const pending: unknown[] = [schema];
  while (pending.length > 0) {
    const current = pending.pop();
    if (Array.isArray(current)) {
      pending.push(...current);
      continue;
    }
    const record = unknownRecordSchema.safeParse(current);
    if (!record.success) continue;
    const properties = unknownRecordSchema.safeParse(
      record.data["properties"],
    );
    if (properties.success && propertyName in properties.data) {
      return stringLengthConstraintsSchema.parse(
        properties.data[propertyName],
      );
    }
    pending.push(...Object.values(record.data));
  }
  throw new Error(`No JSON Schema property named ${propertyName}`);
}

function manifestWithOnlyPlugin(plugin: unknown): unknown {
  return {
    ...MARKETPLACE_V2_FIXTURE,
    newAndNotable: [],
    plugins: [plugin],
  };
}

describe("parseMarketplaceV2Manifest", () => {
  it("returns the exact typed v2 fixture and preserves curated order", () => {
    const parsed = parseMarketplaceV2Manifest(MARKETPLACE_V2_FIXTURE);

    expectTypeOf(parsed).toEqualTypeOf<MarketplaceV2Manifest>();
    expect(parsed).toEqual(MARKETPLACE_V2_FIXTURE);
    expect(parsed.schemaVersion).toBe(2);
    expect(parsed.newAndNotable).toEqual([
      "review-companion",
      "prompt-library",
    ]);
    expect(parsed.plugins[0]?.icon).toBe("Text");
    expect(parsed.plugins[1]?.icon).toEqual({
      url: "icons/review-companion.svg",
    });
    expect(parsed.plugins[0]?.source).toHaveProperty("npm");
    expect(parsed.plugins[1]?.source).toHaveProperty("git");
  });

  it("keeps omitted registry metrics absent instead of defaulting to zero", () => {
    const parsed = parseMarketplaceV2Manifest(MARKETPLACE_V2_FIXTURE);
    const entryWithoutMetrics = parsed.plugins[1];

    expect(entryWithoutMetrics?.installCount).toBeUndefined();
    expect(entryWithoutMetrics?.publishedAt).toBeUndefined();
    expect(entryWithoutMetrics?.updatedAt).toBeUndefined();
    expect(entryWithoutMetrics).not.toHaveProperty("installCount");
    expect(entryWithoutMetrics).not.toHaveProperty("publishedAt");
    expect(entryWithoutMetrics).not.toHaveProperty("updatedAt");
  });

  it("accepts schemaVersion exactly 2", () => {
    for (const schemaVersion of [1, 3, "2", undefined]) {
      expect(() =>
        parseMarketplaceV2Manifest({
          ...MARKETPLACE_V2_FIXTURE,
          schemaVersion,
        }),
      ).toThrow(/schemaVersion/u);
    }
  });

  it("rejects missing, Other, and unknown categories", () => {
    const { category: _category, ...pluginWithoutCategory } =
      MARKETPLACE_V2_FIXTURE.plugins[0];

    for (const plugin of [
      pluginWithoutCategory,
      { ...MARKETPLACE_V2_FIXTURE.plugins[0], category: "Other" },
      { ...MARKETPLACE_V2_FIXTURE.plugins[0], category: "other" },
    ]) {
      expect(() =>
        parseMarketplaceV2Manifest(manifestWithOnlyPlugin(plugin)),
      ).toThrow(/category/u);
    }
  });

  it.each([
    ["plain HTTP", ["http://cdn.example.com/plugin.png"]],
    ["unsupported format", ["screenshots/plugin.gif"]],
    ["whitespace", ["screenshots/plugin image.png"]],
    [
      "more than six",
      Array.from(
        { length: 7 },
        (_unused, index) => `screenshots/plugin-${index}.png`,
      ),
    ],
  ])("rejects malformed screenshots: %s", (_label, screenshots) => {
    expect(() =>
      parseMarketplaceV2Manifest(
        manifestWithOnlyPlugin({
          ...MARKETPLACE_V2_FIXTURE.plugins[0],
          screenshots,
        }),
      ),
    ).toThrow(/screenshots/u);
  });

  it.each([
    ["bad id", ["Prompt Library"], /newAndNotable/u],
    [
      "duplicate id",
      ["prompt-library", "prompt-library"],
      /duplicate plugin id/u,
    ],
    ["unknown id", ["not-in-plugins"], /unknown plugin id/u],
  ])("rejects %s in New & notable", (_label, newAndNotable, message) => {
    expect(() =>
      parseMarketplaceV2Manifest({
        ...MARKETPLACE_V2_FIXTURE,
        newAndNotable,
      }),
    ).toThrow(message);
  });

  it("rejects duplicate entry ids", () => {
    expect(() =>
      parseMarketplaceV2Manifest({
        ...MARKETPLACE_V2_FIXTURE,
        newAndNotable: ["prompt-library"],
        plugins: [
          MARKETPLACE_V2_FIXTURE.plugins[0],
          { ...MARKETPLACE_V2_FIXTURE.plugins[0] },
        ],
      }),
    ).toThrow(/duplicate plugin id/u);
  });

  it("rejects uncontracted manifest and entry fields", () => {
    expect(() =>
      parseMarketplaceV2Manifest({
        ...MARKETPLACE_V2_FIXTURE,
        telemetry: { enabled: true },
      }),
    ).toThrow(/Unrecognized key.*telemetry/u);

    expect(() =>
      parseMarketplaceV2Manifest(
        manifestWithOnlyPlugin({
          ...MARKETPLACE_V2_FIXTURE.plugins[0],
          compatibility: "latest",
        }),
      ),
    ).toThrow(/Unrecognized key.*compatibility/u);
  });
});

describe("marketplace v2 public-contract drift gate", () => {
  it("keeps the page parser aligned with the authoritative named fields", () => {
    const publicSchema = jsonSchemaShape.parse(
      JSON.parse(
        readFileSync(
          fileURLToPath(
            new URL(
              "../../public/schemas/marketplace-v2.schema.json",
              import.meta.url,
            ),
          ),
          "utf8",
        ),
      ),
    );
    const parserSchema = generatedSchemaShape.parse(
      z.toJSONSchema(marketplaceV2ManifestSchema),
    );
    const publicEntry = publicSchema.$defs.entry;
    const parserEntry = parserSchema.properties.plugins.items;

    expect(publicSchema.$id).toBe(MARKETPLACE_V2_SCHEMA_URL);
    expect(publicSchema.properties.schemaVersion.const).toBe(2);
    expect(parserSchema.properties.schemaVersion.const).toBe(2);
    expect(parserSchema.required).toEqual(publicSchema.required);
    expect(Object.keys(parserSchema.properties).sort()).toEqual(
      Object.keys(publicSchema.properties).sort(),
    );

    expect(publicEntry.required).toEqual([
      "id",
      "displayName",
      "description",
      "icon",
      "category",
      "author",
      "source",
    ]);
    expect(parserEntry.required).toEqual(publicEntry.required);
    expect(Object.keys(publicEntry.properties).sort()).toEqual(
      [
        "id",
        "displayName",
        "description",
        "icon",
        "category",
        "screenshots",
        "installCount",
        "publishedAt",
        "updatedAt",
        "tags",
        "author",
        "source",
      ].sort(),
    );
    expect(Object.keys(parserEntry.properties).sort()).toEqual(
      Object.keys(publicEntry.properties).sort(),
    );
    expect(publicEntry.properties.category.enum).toEqual(
      MARKETPLACE_CATEGORY_IDS,
    );
    expect(parserEntry.properties.category.enum).toEqual(
      publicEntry.properties.category.enum,
    );
    expect(publicEntry.properties.screenshots.maxItems).toBe(6);
    expect(parserEntry.properties.screenshots.maxItems).toBe(
      publicEntry.properties.screenshots.maxItems,
    );
    expect(publicEntry.properties.installCount).toMatchObject({
      type: "integer",
      minimum: 0,
    });
    expect(parserEntry.properties.installCount).toMatchObject({
      type: "integer",
      minimum: 0,
    });
    expect(publicEntry.properties.publishedAt).toMatchObject({
      type: "string",
      format: "date-time",
    });
    expect(publicEntry.properties.updatedAt).toMatchObject({
      type: "string",
      format: "date-time",
    });
    expect(parserEntry.properties.publishedAt).toMatchObject({
      type: "string",
      format: "date-time",
    });
    expect(parserEntry.properties.updatedAt).toMatchObject({
      type: "string",
      format: "date-time",
    });
    expect(publicSchema.properties.newAndNotable.uniqueItems).toBe(true);
    expect(publicSchema.properties.plugins.maxItems).toBe(256);
    expect(publicSchema.$defs.semverRange.pattern).toBe(
      MARKETPLACE_SEMVER_RANGE_PATTERN.source,
    );
    const publicTagPrefix = findStringPropertyConstraints(
      publicSchema,
      "tagPrefix",
    );
    const parserTagPrefix = findStringPropertyConstraints(
      parserSchema,
      "tagPrefix",
    );
    expect(publicTagPrefix.maxLength).toBe(128);
    expect(parserTagPrefix.minLength).toBe(publicTagPrefix.minLength);
    expect(parserTagPrefix.maxLength).toBe(publicTagPrefix.maxLength);
  });
});
