import {
  MARKETPLACE_SEMVER_RANGE_PATTERN,
  PLUGIN_CATALOG_CATEGORY_IDS,
  marketplaceEntryV2Schema,
  type MarketplaceEntrySource,
  type MarketplaceEntryV2,
  type PluginCatalogCategoryId,
} from "@bb/domain";
import { z } from "zod";

export const MARKETPLACE_V2_SCHEMA_URL =
  "https://getbb.app/schemas/marketplace-v2.schema.json";

export const MARKETPLACE_CATEGORY_IDS = PLUGIN_CATALOG_CATEGORY_IDS;
export { MARKETPLACE_SEMVER_RANGE_PATTERN };

const MARKETPLACE_MAX_ENTRIES = 256;
const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/u;
export const marketplaceV2EntrySchema = marketplaceEntryV2Schema;

function rejectDuplicateEntries(
  entries: MarketplaceV2Entry[],
  ctx: z.RefinementCtx,
): void {
  const seen = new Set<string>();
  entries.forEach((entry, index) => {
    if (seen.has(entry.id)) {
      ctx.addIssue({
        code: "custom",
        path: [index, "id"],
        message: `duplicate plugin id ${JSON.stringify(entry.id)}`,
      });
    }
    seen.add(entry.id);
  });
}

export const marketplaceV2ManifestSchema = z
  .object({
    $schema: z.literal(MARKETPLACE_V2_SCHEMA_URL).optional(),
    schemaVersion: z.literal(2),
    name: z.string().max(64).regex(NAME_PATTERN),
    displayName: z.string().min(1),
    description: z.string().min(1).optional(),
    newAndNotable: z.array(z.string().regex(NAME_PATTERN)),
    plugins: z
      .array(marketplaceV2EntrySchema)
      .max(MARKETPLACE_MAX_ENTRIES)
      .superRefine(rejectDuplicateEntries),
  })
  .strict()
  .superRefine((manifest, ctx) => {
    const seen = new Set<string>();
    const entryIds = new Set(manifest.plugins.map((entry) => entry.id));
    manifest.newAndNotable.forEach((entryId, index) => {
      if (seen.has(entryId)) {
        ctx.addIssue({
          code: "custom",
          path: ["newAndNotable", index],
          message: `duplicate plugin id ${JSON.stringify(entryId)}`,
        });
      } else if (!entryIds.has(entryId)) {
        ctx.addIssue({
          code: "custom",
          path: ["newAndNotable", index],
          message: `unknown plugin id ${JSON.stringify(entryId)}`,
        });
      }
      seen.add(entryId);
    });
  });

export type MarketplaceCategoryId = PluginCatalogCategoryId;
export type MarketplaceV2Entry = MarketplaceEntryV2;
export type MarketplaceV2Source = MarketplaceEntrySource;
export type MarketplaceV2Manifest = z.infer<typeof marketplaceV2ManifestSchema>;

/**
 * Parse the public marketplace page boundary. A document is accepted whole or
 * rejected whole so the page never renders partially validated catalog data.
 */
export function parseMarketplaceV2Manifest(
  input: unknown,
): MarketplaceV2Manifest {
  const parsed = marketplaceV2ManifestSchema.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => {
        const path =
          issue.path.length === 0 ? "manifest" : issue.path.join(".");
        return `${path}: ${issue.message}`;
      })
      .join("; ");
    throw new Error(`Invalid marketplace v2 manifest: ${issues}`);
  }
  return parsed.data;
}
