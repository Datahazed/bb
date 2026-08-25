import { z } from "zod";

export const MARKETPLACE_V2_SCHEMA_URL =
  "https://getbb.app/schemas/marketplace-v2.schema.json";

export const MARKETPLACE_CATEGORY_IDS = [
  "themes-and-appearance",
  "thread-lists-and-navigation",
  "thread-messages-and-timelines",
  "composer-and-prompts",
  "memory-and-context",
  "agent-tools",
  "security",
  "agents-and-providers",
  "token-usage-and-cost",
  "notifications-and-attention",
  "code-and-reviews",
  "files-and-viewers",
  "machines-and-hosts",
  "plugin-development",
  "task-tracking",
  "automation",
] as const;

const MARKETPLACE_MAX_ENTRIES = 256;
const MARKETPLACE_MAX_SCREENSHOTS = 6;
const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/u;
const TAG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const GITHUB_LOGIN_PATTERN = /^[A-Za-z0-9](?:-?[A-Za-z0-9]){0,38}$/u;
const HOST_ICON_PATTERN = /^[A-Za-z][A-Za-z0-9]*$/u;
const HTTPS_URL_PATTERN = /^https:\/\//u;
const ICON_URL_PATTERN =
  /^(?:(?![A-Za-z][A-Za-z0-9+.-]*:)|(?=[Hh][Tt][Tt][Pp][Ss]:))[^\s]*\.(?:[Ss][Vv][Gg]|[Pp][Nn][Gg]|[Ww][Ee][Bb][Pp])(?:[?#][^\s]*)?$/u;
const SCREENSHOT_URL_PATTERN =
  /^(?:(?![A-Za-z][A-Za-z0-9+.-]*:)|(?=[Hh][Tt][Tt][Pp][Ss]:))[^\s]*\.(?:[Pp][Nn][Gg]|[Jj][Pp][Ee]?[Gg]|[Ww][Ee][Bb][Pp])(?:[?#][^\s]*)?$/u;
const NPM_PACKAGE_PATTERN =
  /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/u;
const GIT_SUBDIR_PATTERN =
  /^(?![A-Za-z]:)(?!\/)(?!(?:[^/]+\/)*(?:\.|\.\.|\.git)(?:\/|$))[^/\\]+(?:\/[^/\\]+)*$/u;
const GIT_REF_PATTERN =
  /^(?!-)(?![\s\S]*\.\.)(?![\s\S]*@)(?![\s\S]*:)[\s\S]+$/u;
const GIT_TAG_PREFIX_PATTERN =
  /^(?!.*\.\.)(?!.*\/\/)(?!.*\/\.)(?![^/]*\.lock(?:\/|$))(?!.*\/[^/]*\.lock(?:\/|$))(?!.*\.$)[A-Za-z0-9][A-Za-z0-9._/-]*$/u;

const SEMVER_NUMBER = String.raw`(?:0|[1-9]\d*|[xX*])`;
const SEMVER_PRERELEASE = String.raw`(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?`;
const SEMVER_BUILD = String.raw`(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?`;
const SEMVER_VERSION = String.raw`v?${SEMVER_NUMBER}(?:\.${SEMVER_NUMBER}(?:\.${SEMVER_NUMBER})?)?${SEMVER_PRERELEASE}${SEMVER_BUILD}`;
const SEMVER_COMPARATOR = String.raw`(?:[<>]=?|=|~>?|\^)?\s*${SEMVER_VERSION}`;
const SEMVER_SET = String.raw`(?:\*|${SEMVER_VERSION}\s+-\s+${SEMVER_VERSION}|${SEMVER_COMPARATOR}(?:\s+${SEMVER_COMPARATOR})*|)`;

/** Kept exported so the contract-drift test can compare it with the public schema. */
export const MARKETPLACE_SEMVER_RANGE_PATTERN = new RegExp(
  String.raw`^\s*${SEMVER_SET}(?:\s*\|\|\s*${SEMVER_SET})*\s*$`,
  "u",
);

const marketplaceCategoryIdSchema = z.enum(MARKETPLACE_CATEGORY_IDS);
const semverRangeSchema = z
  .string()
  .min(1)
  .regex(MARKETPLACE_SEMVER_RANGE_PATTERN);
const httpsUrlSchema = z.string().regex(HTTPS_URL_PATTERN);

const marketplaceIconSchema = z.union([
  z.string().regex(HOST_ICON_PATTERN),
  z.object({ url: z.string().min(1).regex(ICON_URL_PATTERN) }).strict(),
]);

const marketplaceAuthorSchema = z
  .object({
    name: z.string().min(1),
    github: z.string().regex(GITHUB_LOGIN_PATTERN).optional(),
    url: httpsUrlSchema.optional(),
  })
  .strict();

const marketplaceNpmSourceSchema = z
  .object({
    npm: z
      .object({
        package: z.string().regex(NPM_PACKAGE_PATTERN),
        range: semverRangeSchema.optional(),
        tag: z
          .string()
          .regex(/^[A-Za-z][A-Za-z0-9._-]*$/u)
          .optional(),
        registry: httpsUrlSchema.optional(),
      })
      .strict()
      .refine((npm) => npm.range === undefined || npm.tag === undefined, {
        message: "range and tag are mutually exclusive",
      }),
  })
  .strict();

const gitSourceBase = {
  url: httpsUrlSchema,
  subdir: z.string().regex(GIT_SUBDIR_PATTERN).optional(),
};

const marketplaceGitSourceSchema = z.union([
  z
    .object({
      git: z
        .object({
          ...gitSourceBase,
          ref: z.string().regex(GIT_REF_PATTERN),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      git: z
        .object({
          ...gitSourceBase,
          range: semverRangeSchema,
          tagPrefix: z.string().regex(GIT_TAG_PREFIX_PATTERN).optional(),
        })
        .strict(),
    })
    .strict(),
]);

export const marketplaceV2EntrySchema = z
  .object({
    id: z.string().regex(NAME_PATTERN),
    displayName: z.string().min(1),
    description: z.string().min(1),
    icon: marketplaceIconSchema,
    category: marketplaceCategoryIdSchema,
    screenshots: z
      .array(z.string().min(1).regex(SCREENSHOT_URL_PATTERN))
      .max(MARKETPLACE_MAX_SCREENSHOTS)
      .optional(),
    installCount: z.number().int().nonnegative().optional(),
    publishedAt: z.iso.datetime({ offset: true }).optional(),
    updatedAt: z.iso.datetime({ offset: true }).optional(),
    tags: z.array(z.string().max(32).regex(TAG_PATTERN)).max(10).optional(),
    author: marketplaceAuthorSchema,
    source: z.union([marketplaceNpmSourceSchema, marketplaceGitSourceSchema]),
  })
  .strict();

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

export type MarketplaceCategoryId = z.infer<typeof marketplaceCategoryIdSchema>;
export type MarketplaceV2Entry = z.infer<typeof marketplaceV2EntrySchema>;
export type MarketplaceV2Source = MarketplaceV2Entry["source"];
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
