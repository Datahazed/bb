import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { MARKETPLACE_V2_FIXTURE } from "./marketplace-v2.fixture.js";
import {
  MARKETPLACE_CATEGORY_IDS,
  MARKETPLACE_V2_SCHEMA_URL,
  parseMarketplaceV2Manifest,
} from "./marketplace-v2.js";

const publishedSchemaShape = z.object({
  $id: z.string(),
  $defs: z.object({
    entry: z.object({
      properties: z.object({
        category: z.object({ enum: z.array(z.string()) }),
      }),
    }),
  }),
});

describe("parseMarketplaceV2Manifest", () => {
  it("preserves the strict v2 contract", () => {
    expect(parseMarketplaceV2Manifest(MARKETPLACE_V2_FIXTURE)).toEqual(
      MARKETPLACE_V2_FIXTURE,
    );
  });

  it("rejects missing categories, duplicate ids, and uncontracted fields", () => {
    const [entry] = MARKETPLACE_V2_FIXTURE.plugins;
    const { category: _category, ...withoutCategory } = entry!;
    expect(() =>
      parseMarketplaceV2Manifest({
        ...MARKETPLACE_V2_FIXTURE,
        newAndNotable: [],
        plugins: [withoutCategory],
      }),
    ).toThrow(/category/u);
    expect(() =>
      parseMarketplaceV2Manifest({
        ...MARKETPLACE_V2_FIXTURE,
        newAndNotable: [entry!.id],
        plugins: [entry, entry],
      }),
    ).toThrow(/duplicate plugin id/u);
    expect(() =>
      parseMarketplaceV2Manifest({
        ...MARKETPLACE_V2_FIXTURE,
        telemetry: true,
      }),
    ).toThrow(/telemetry/u);
  });

  it("requires New & notable ids to exist in the catalog", () => {
    expect(() =>
      parseMarketplaceV2Manifest({
        ...MARKETPLACE_V2_FIXTURE,
        newAndNotable: ["missing-plugin"],
      }),
    ).toThrow(/unknown plugin id/u);
  });

  it("keeps the public JSON Schema aligned with the runtime category contract", () => {
    const schema = publishedSchemaShape.parse(
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
    expect(schema.$id).toBe(MARKETPLACE_V2_SCHEMA_URL);
    expect(schema.$defs.entry.properties.category.enum).toEqual(
      MARKETPLACE_CATEGORY_IDS,
    );
  });
});
