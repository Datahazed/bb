import { join } from "node:path";
import {
  marketplaceEntryV1Schema,
  marketplaceEntryV2Schema,
  type MarketplaceEntryV1 as DomainMarketplaceEntryV1,
  type MarketplaceEntryV2 as DomainMarketplaceEntryV2,
} from "@bb/domain";
import {
  CURATED_PLUGIN_MARKETPLACE_NAME,
  pluginMarketplaceNameSchema,
  ROOT_PLUGIN_SOURCE_SELECTION,
  type PluginSourceSelection,
} from "@bb/server-contract";
import semver from "semver";
import { z } from "zod";
import { formatIssues } from "../plugins/collection-manifest.js";
import {
  gitRangeSourceSpec,
  gitSemverTagName,
  normalizeGitTagPrefix,
  normalizePluginSubdirectory,
  parsePluginSource,
} from "../plugins/install-sources.js";

export const MARKETPLACE_V1_SCHEMA_URL =
  "https://getbb.app/schemas/marketplace.schema.json";
export const MARKETPLACE_V2_SCHEMA_URL =
  "https://getbb.app/schemas/marketplace-v2.schema.json";

export const CURATED_MARKETPLACE_NAME = CURATED_PLUGIN_MARKETPLACE_NAME;

export const BUILTIN_PUBLISHER_LABEL = "BB Official";

export const BUILTIN_PUBLISHER_KEY = "builtin";

const MARKETPLACE_MAX_ENTRIES = 256;

const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/u;
const manifestNameSchema = pluginMarketplaceNameSchema;

function uniqueMarketplaceEntries<T extends { id: string }>(
  entries: T[],
  ctx: z.RefinementCtx,
): void {
  const seen = new Set<string>();
  entries.forEach((entry, index) => {
    if (seen.has(entry.id)) {
      ctx.addIssue({
        code: "custom",
        path: [index, "id"],
        message: `duplicate plugin id "${entry.id}"`,
      });
    }
    seen.add(entry.id);
  });
}

const marketplaceManifestV1Schema = z
  .object({
    $schema: z.literal(MARKETPLACE_V1_SCHEMA_URL).optional(),
    schemaVersion: z.literal(1),
    name: manifestNameSchema,
    displayName: z.string().min(1),
    description: z.string().min(1).optional(),
    plugins: z
      .array(marketplaceEntryV1Schema)
      .max(
        MARKETPLACE_MAX_ENTRIES,
        `a marketplace may list at most ${MARKETPLACE_MAX_ENTRIES} plugins`,
      )
      .superRefine(uniqueMarketplaceEntries),
  })
  .strict();

const marketplaceManifestV2Schema = z
  .object({
    $schema: z.literal(MARKETPLACE_V2_SCHEMA_URL).optional(),
    schemaVersion: z.literal(2),
    name: manifestNameSchema,
    displayName: z.string().min(1),
    description: z.string().min(1).optional(),
    newAndNotable: z.array(z.string().regex(NAME_PATTERN)),
    plugins: z
      .array(marketplaceEntryV2Schema)
      .max(
        MARKETPLACE_MAX_ENTRIES,
        `a marketplace may list at most ${MARKETPLACE_MAX_ENTRIES} plugins`,
      )
      .superRefine(uniqueMarketplaceEntries),
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

export type MarketplaceManifestV1 = z.infer<typeof marketplaceManifestV1Schema>;
export type MarketplaceManifestV2 = z.infer<typeof marketplaceManifestV2Schema>;
export type MarketplaceManifest = MarketplaceManifestV1 | MarketplaceManifestV2;
export type MarketplaceEntryV1 = DomainMarketplaceEntryV1;
export type MarketplaceEntryV2 = DomainMarketplaceEntryV2;
export type MarketplaceEntry = MarketplaceEntryV1 &
  Partial<
    Pick<
      MarketplaceEntryV2,
      "category" | "screenshots" | "publishedAt" | "updatedAt"
    >
  >;

export function marketplaceNewAndNotable(
  manifest: MarketplaceManifest,
): readonly string[] {
  return manifest.schemaVersion === 2 ? manifest.newAndNotable : [];
}

export function parseMarketplaceManifest(
  input: unknown,
  location: string,
): MarketplaceManifest {
  if (
    typeof input === "object" &&
    input !== null &&
    "schemaVersion" in input &&
    input.schemaVersion !== 1 &&
    input.schemaVersion !== 2
  ) {
    throw new Error(
      `invalid ${location}: unknown schemaVersion ${JSON.stringify(input.schemaVersion)}; supported values are 1 and 2`,
    );
  }
  const schema =
    typeof input === "object" &&
    input !== null &&
    "schemaVersion" in input &&
    input.schemaVersion === 2
      ? marketplaceManifestV2Schema
      : marketplaceManifestV1Schema;
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new Error(`invalid ${location}: ${formatIssues(parsed.error)}`);
  }
  return parsed.data;
}

export function parseMarketplaceManifestJson(
  raw: string,
  location: string,
): MarketplaceManifest {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `invalid ${location}: not valid JSON (${error instanceof Error ? error.message : String(error)})`,
    );
  }
  return parseMarketplaceManifest(json, location);
}

export function entryIconName(entry: MarketplaceEntry): string | null {
  return typeof entry.icon === "string" ? entry.icon : null;
}

export function entryScreenshotUrls(
  entry: MarketplaceEntry,
  base: MarketplaceIconBase,
): string[] {
  return (entry.screenshots ?? []).map((declared) => {
    const absolute = /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(declared);
    if (absolute) return new URL(declared).toString();
    if (base.kind !== "url") {
      throw new Error(
        `relative screenshot URL ${JSON.stringify(declared)} requires an https marketplace manifest`,
      );
    }
    return new URL(declared, base.manifestUrl).toString();
  });
}

const INHERITED_PAINT_KEYWORDS = new Set([
  "",
  "none",
  "currentcolor",
  "inherit",
  "transparent",
  "context-fill",
  "context-stroke",
]);

export function svgAdoptsTextColor(bytes: Uint8Array): boolean {
  const document = new TextDecoder("utf-8", { fatal: false })
    .decode(bytes)
    .replace(/<!--[\s\S]*?-->/gu, "");
  if (/<(?:linearGradient|radialGradient|pattern|image)\b/iu.test(document)) {
    return false;
  }
  for (const declaration of document.matchAll(
    /\b(?:fill|stroke|stop-color|flood-color|lighting-color)\s*[=:]\s*["']?\s*([^"';>\s]*)/giu,
  )) {
    if (!INHERITED_PAINT_KEYWORDS.has(declaration[1].toLowerCase())) {
      return false;
    }
  }
  return true;
}

export function entryIconTinted(
  contentType: string,
  bytes: Uint8Array,
): boolean {
  return contentType === "image/svg+xml" && svgAdoptsTextColor(bytes);
}

export type MarketplaceIconBase =
  | { kind: "url"; manifestUrl: string }
  | { kind: "dir"; root: string };

export type MarketplaceIconLocation =
  | { kind: "remote"; url: string }
  | { kind: "local"; path: string; relativePath: string };

export function resolveEntryIcon(
  entry: MarketplaceEntry,
  base: MarketplaceIconBase,
): MarketplaceIconLocation | null {
  if (typeof entry.icon === "string") return null;
  const declared = entry.icon.url;
  const absolute = /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(declared);
  if (base.kind === "url" || absolute) {
    const resolved = new URL(
      declared,
      base.kind === "url" ? base.manifestUrl : "https://marketplace.invalid/",
    );
    if (resolved.protocol !== "https:") {
      throw new Error(
        `icon URL ${JSON.stringify(declared)} resolves to a non-https URL`,
      );
    }
    return { kind: "remote", url: resolved.toString() };
  }
  const resolved = new URL(declared, "https://marketplace.invalid/");
  const relativePath = normalizePluginSubdirectory(
    decodeURIComponent(resolved.pathname).replace(/^\/+/u, ""),
  );
  return {
    kind: "local",
    path: join(base.root, ...relativePath.split("/")),
    relativePath,
  };
}

export function entryRepositoryUrl(entry: MarketplaceEntry): string | null {
  if ("npm" in entry.source) {
    return entry.source.npm.registry === undefined
      ? `https://www.npmjs.com/package/${entry.source.npm.package}`
      : null;
  }
  const git = entry.source.git;
  const repository = git.url.replace(/\.git$/u, "");
  if (git.subdir === undefined) return repository;
  const path = git.subdir.split("/").map(encodeURIComponent).join("/");
  return new URL(repository).host === "github.com"
    ? `${repository}/tree/HEAD/${path}`
    : repository;
}

export function entrySourceDisplay(entry: MarketplaceEntry): string {
  if ("npm" in entry.source) {
    const spec = entry.source.npm.range ?? entry.source.npm.tag ?? "";
    const registry =
      entry.source.npm.registry === undefined
        ? ""
        : ` (registry ${entry.source.npm.registry})`;
    return `npm:${entry.source.npm.package}${spec.length === 0 ? "" : `@${spec}`}${registry}`;
  }
  const git = entry.source.git;
  const subdir = git.subdir === undefined ? "" : `#${git.subdir}`;
  if ("ref" in git) return `git:${git.url}@${git.ref}${subdir}`;
  const prefix = git.tagPrefix ?? "";
  return `git:${git.url}@${git.range}${subdir} (tags ${gitSemverTagName(prefix, "X.Y.Z")})`;
}

interface ResolvedEntrySource {
  source: string;
  selection: PluginSourceSelection;
  npmRegistry?: string;
}

function assertHttpsUrl(value: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("must be an https URL");
  }
  if (parsed.protocol !== "https:") throw new Error("must be an https URL");
}

function assertTranslatableEntrySource(entry: MarketplaceEntry): void {
  if ("npm" in entry.source) {
    const npm = entry.source.npm;
    const parsed = parsePluginSource(`npm:${npm.package}`);
    if (
      parsed.kind !== "npm" ||
      parsed.name !== npm.package ||
      parsed.spec.length !== 0
    ) {
      throw new Error("package name is ambiguous");
    }
    if (npm.range !== undefined && semver.validRange(npm.range) === null) {
      throw new Error("must be a valid semver range");
    }
    if (npm.registry !== undefined) assertHttpsUrl(npm.registry);
    return;
  }

  const git = entry.source.git;
  assertHttpsUrl(git.url);
  if (git.subdir !== undefined) normalizePluginSubdirectory(git.subdir);
  if ("ref" in git) {
    const parsed = parsePluginSource(
      `git:https://marketplace.invalid/plugin.git@${git.ref}`,
    );
    if (
      parsed.kind !== "git" ||
      parsed.selector.kind !== "ref" ||
      parsed.selector.ref !== git.ref
    ) {
      throw new Error("git ref is ambiguous");
    }
    return;
  }

  if (semver.validRange(git.range) === null) {
    throw new Error("must be a valid semver range");
  }
  if (git.tagPrefix !== undefined) normalizeGitTagPrefix(git.tagPrefix);
}

export function resolvedEntrySource(
  entry: MarketplaceEntry,
): ResolvedEntrySource {
  assertTranslatableEntrySource(entry);
  if ("npm" in entry.source) {
    const spec = entry.source.npm.range ?? entry.source.npm.tag ?? "";
    return {
      source: `npm:${entry.source.npm.package}${spec.length === 0 ? "" : `@${spec}`}`,
      selection: ROOT_PLUGIN_SOURCE_SELECTION,
      ...(entry.source.npm.registry === undefined
        ? {}
        : { npmRegistry: entry.source.npm.registry }),
    };
  }
  const git = entry.source.git;
  return {
    source:
      "ref" in git
        ? `git:${git.url}@${git.ref}`
        : gitRangeSourceSpec({
            url: git.url,
            range: git.range,
            tagPrefix: git.tagPrefix ?? "",
          }),
    selection:
      git.subdir === undefined
        ? ROOT_PLUGIN_SOURCE_SELECTION
        : { kind: "subdirectory", path: git.subdir },
  };
}
