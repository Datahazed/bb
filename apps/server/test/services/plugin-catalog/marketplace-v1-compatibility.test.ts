import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  BUNDLED_CURATED_MARKETPLACE_SOURCE,
  projectCuratedMarketplaceV1,
  projectCuratedMarketplaceV2,
} from "../../../src/services/plugin-catalog/curated-marketplace.js";
import { parseMarketplaceManifest as parseWithDesktopV039 } from "../../fixtures/marketplace-v1-parser-desktop-v0.39.0.js";

const V1_SCHEMA_SHA256 =
  "90334400e96ea6ce0bd0a91f9a422166b63f27741c144b9bb324d2e8f0aafd8e";

describe("marketplace v1 released-client compatibility", () => {
  it("keeps the published v1 schema byte-for-byte frozen", async () => {
    const schema = await readFile(
      new URL(
        "../../../../web/public/schemas/marketplace.schema.json",
        import.meta.url,
      ),
    );
    expect(createHash("sha256").update(schema).digest("hex")).toBe(
      V1_SCHEMA_SHA256,
    );
  });

  it("projects one source model into a v1 document accepted by desktop-v0.39.0", () => {
    const v1 = projectCuratedMarketplaceV1(BUNDLED_CURATED_MARKETPLACE_SOURCE);
    expect(() =>
      parseWithDesktopV039(v1, "generated v1 marketplace"),
    ).not.toThrow();
    expect(v1).not.toHaveProperty("newAndNotable");
    for (const entry of v1.plugins) {
      expect(entry).not.toHaveProperty("category");
      expect(entry).not.toHaveProperty("screenshots");
      expect(entry).not.toHaveProperty("installCount");
      expect(entry).not.toHaveProperty("publishedAt");
      expect(entry).not.toHaveProperty("updatedAt");
    }
  });

  it("projects discovery only into v2, which the released v1 parser rejects", () => {
    const v2 = projectCuratedMarketplaceV2(BUNDLED_CURATED_MARKETPLACE_SOURCE);
    expect(v2).toMatchObject({
      schemaVersion: 2,
      newAndNotable: ["prompt-shaper", "thread-hover-cards"],
    });
    expect(
      v2.plugins.every((entry) => (entry.screenshots ?? []).length === 0),
    ).toBe(true);
    expect(() => parseWithDesktopV039(v2, "v2 marketplace")).toThrow(
      /unknown schemaVersion 2/u,
    );
  });
});
