import { z } from "zod";
import { pluginCatalogCategoryIdSchema } from "./plugin-catalog-category.js";

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

/** Public-schema-compatible semver range grammar used by v1 and v2 entries. */
export const MARKETPLACE_SEMVER_RANGE_PATTERN = new RegExp(
  String.raw`^\s*${SEMVER_SET}(?:\s*\|\|\s*${SEMVER_SET})*\s*$`,
  "u",
);

const semverRangeSchema = z
  .string()
  .min(1)
  .regex(MARKETPLACE_SEMVER_RANGE_PATTERN);
const httpsUrlSchema = z.string().regex(HTTPS_URL_PATTERN);

const marketplaceIconSchema = z.union([
  z.string().regex(HOST_ICON_PATTERN),
  z
    .object({
      url: z
        .string()
        .min(1)
        .regex(
          ICON_URL_PATTERN,
          "must be an https URL or relative .svg, .png, or .webp asset",
        ),
    })
    .strict(),
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
        package: z
          .string()
          .regex(
            NPM_PACKAGE_PATTERN,
            "must be an unambiguous npm package name",
          ),
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
          ref: z
            .string()
            .regex(
              GIT_REF_PATTERN,
              "git ref must round-trip through install syntax",
            ),
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
          tagPrefix: z
            .string()
            .max(128)
            .regex(GIT_TAG_PREFIX_PATTERN)
            .optional(),
        })
        .strict(),
    })
    .strict(),
]);

const marketplaceEntryIdentityShape = {
  id: z.string().regex(NAME_PATTERN),
  displayName: z.string().min(1),
  description: z.string().min(1),
  icon: marketplaceIconSchema,
};

const marketplaceEntryMetadataShape = {
  tags: z.array(z.string().max(32).regex(TAG_PATTERN)).max(10).optional(),
  author: marketplaceAuthorSchema,
  source: z.union([marketplaceNpmSourceSchema, marketplaceGitSourceSchema]),
};

/** Exact immutable entry accepted by marketplace/v1. Never add fields. */
export const marketplaceEntryV1Schema = z
  .object({
    ...marketplaceEntryIdentityShape,
    ...marketplaceEntryMetadataShape,
  })
  .strict();

/** Discovery entry accepted by marketplace/v2. */
export const marketplaceEntryV2Schema = z
  .object({
    ...marketplaceEntryIdentityShape,
    category: pluginCatalogCategoryIdSchema,
    screenshots: z
      .array(
        z
          .string()
          .min(1)
          .regex(
            SCREENSHOT_URL_PATTERN,
            "must be an https URL or relative .png, .jpg, .jpeg, or .webp asset",
          ),
      )
      .max(MARKETPLACE_MAX_SCREENSHOTS)
      .optional(),
    publishedAt: z.iso.datetime({ offset: true }).optional(),
    updatedAt: z.iso.datetime({ offset: true }).optional(),
    ...marketplaceEntryMetadataShape,
  })
  .strict();

export type MarketplaceEntryV1 = z.infer<typeof marketplaceEntryV1Schema>;
export type MarketplaceEntryV2 = z.infer<typeof marketplaceEntryV2Schema>;
export type MarketplaceEntrySource = MarketplaceEntryV1["source"];

const marketplaceAuthorEntryProjectionSchema = marketplaceEntryV2Schema
  .omit({
    publishedAt: true,
    updatedAt: true,
  })
  .extend({
    screenshots: marketplaceEntryV2Schema.shape.screenshots.unwrap(),
  })
  .superRefine((entry, ctx) => {
    const urls: { value: string | undefined; path: (string | number)[] }[] = [
      { value: entry.author.url, path: ["author", "url"] },
      {
        value: "npm" in entry.source ? entry.source.npm.registry : undefined,
        path: ["source", "npm", "registry"],
      },
      {
        value: "git" in entry.source ? entry.source.git.url : undefined,
        path: ["source", "git", "url"],
      },
    ];
    for (const url of urls) {
      if (url.value === undefined) continue;
      try {
        if (new URL(url.value).protocol === "https:") continue;
      } catch {
        // Report the same boundary failure below.
      }
      ctx.addIssue({
        code: "custom",
        path: url.path,
        message: "must be an https URL",
      });
    }
  });

const unknownRecordSchema = z.record(z.string(), z.unknown());

function trimRecordString(record: Record<string, unknown>, key: string): void {
  const value = record[key];
  if (typeof value === "string") record[key] = value.trim();
}

function copiedRecord(input: unknown): Record<string, unknown> | null {
  const parsed = unknownRecordSchema.safeParse(input);
  return parsed.success ? { ...parsed.data } : null;
}

/**
 * The listing request historically normalized author-entered copy before the
 * full marketplace validation ran. Keep that request-boundary behavior while
 * deriving every accepted field and constraint from the canonical v2 entry.
 */
function normalizeMarketplaceAuthorEntry(input: unknown): unknown {
  const entry = copiedRecord(input);
  if (entry === null) return input;

  trimRecordString(entry, "displayName");
  trimRecordString(entry, "description");

  const icon = copiedRecord(entry["icon"]);
  if (icon !== null) {
    trimRecordString(icon, "url");
    entry["icon"] = icon;
  }

  const author = copiedRecord(entry["author"]);
  if (author !== null) {
    trimRecordString(author, "name");
    entry["author"] = author;
  }

  if (Array.isArray(entry["tags"])) {
    entry["tags"] = entry["tags"].map((tag) =>
      typeof tag === "string" ? tag.trim() : tag,
    );
  }
  if (Array.isArray(entry["screenshots"])) {
    entry["screenshots"] = entry["screenshots"].map((screenshot) =>
      typeof screenshot === "string" ? screenshot.trim() : screenshot,
    );
  }

  const source = copiedRecord(entry["source"]);
  if (source !== null) {
    const npm = copiedRecord(source["npm"]);
    if (npm !== null) {
      trimRecordString(npm, "package");
      trimRecordString(npm, "range");
      trimRecordString(npm, "tag");
      source["npm"] = npm;
    }
    const git = copiedRecord(source["git"]);
    if (git !== null) {
      trimRecordString(git, "subdir");
      trimRecordString(git, "ref");
      trimRecordString(git, "range");
      trimRecordString(git, "tagPrefix");
      source["git"] = git;
    }
    entry["source"] = source;
  }

  return entry;
}

/**
 * Author-owned projection of a v2 entry. Registry metrics are excluded and
 * screenshots are required because the draft wire contract stores a complete
 * preview, including an explicit empty screenshot list.
 */
export const marketplaceAuthorEntrySchema = z.preprocess(
  normalizeMarketplaceAuthorEntry,
  marketplaceAuthorEntryProjectionSchema,
);
export type MarketplaceAuthorEntry = z.infer<
  typeof marketplaceAuthorEntrySchema
>;
