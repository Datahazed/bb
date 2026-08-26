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

/** Immutable contract consumed by released v1 clients and registry CI. */
export const MARKETPLACE_V1_SCHEMA_URL =
  "https://getbb.app/schemas/marketplace.schema.json";
/** Discovery contract consumed by clients that fetch marketplace v2. */
export const MARKETPLACE_V2_SCHEMA_URL =
  "https://getbb.app/schemas/marketplace-v2.schema.json";

/** Reserved name of the marketplace BB itself curates. */
export const CURATED_MARKETPLACE_NAME = CURATED_PLUGIN_MARKETPLACE_NAME;

/**
 * Publisher shown for plugins that ship inside the app. They come from the
 * build, not from a marketplace refresh, so they keep their own label even
 * though the store groups them under the official marketplace.
 */
export const BUILTIN_PUBLISHER_LABEL = "BB Official";

/**
 * Grouping identity of those plugins. It is not a marketplace name, and a
 * marketplace cannot be called this: names are lowercase kebab-case.
 */
export const BUILTIN_PUBLISHER_KEY = "builtin";

/**
 * Entries one manifest may list. The 1 MiB document limit alone still allows
 * thousands of entries, and each entry costs an icon request and an icon row.
 */
const MARKETPLACE_MAX_ENTRIES = 256;

const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/u;
/**
 * A marketplace's own name is the handle every route and command addresses it
 * by, so the manifest must accept exactly what those contracts accept. A name
 * bb stored but could not refresh or remove by name would be unmanageable.
 */
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
/** Common internal view; v1 entries have no discovery fields. */
export type MarketplaceEntry = MarketplaceEntryV1 &
  Partial<
    Pick<
      MarketplaceEntryV2,
      "category" | "screenshots" | "installCount" | "publishedAt" | "updatedAt"
    >
  >;

/** V1 has no curated discovery shelf. */
export function marketplaceNewAndNotable(
  manifest: MarketplaceManifest,
): readonly string[] {
  return manifest.schemaVersion === 2 ? manifest.newAndNotable : [];
}

/**
 * Parse a marketplace manifest. The document is rejected whole: consumers see
 * either a fully validated catalog or the previous last-known-good one.
 */
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

/** The entry's declared host icon name, or null when it ships an image. */
export function entryIconName(entry: MarketplaceEntry): string | null {
  return typeof entry.icon === "string" ? entry.icon : null;
}

/**
 * Browser-usable screenshot URLs. Relative assets resolve beside an HTTPS
 * manifest, matching the registry's icon convention. Git/path marketplaces
 * must publish absolute HTTPS screenshot URLs because their local checkout is
 * discarded after refresh and no browser can read it.
 */
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

/**
 * Whether BB masks a cached image icon with the surrounding text color. Only
 * an SVG is tinted; see {@link iconSchema}. `contentType` is the validated
 * type BB serves the cached bytes as.
 */
export function entryIconTinted(contentType: string): boolean {
  return contentType === "image/svg+xml";
}

/**
 * Where an entry's icon is read from. A marketplace bb fetched over HTTPS
 * resolves relative icons against the manifest URL; one bb read from a git
 * checkout or a directory resolves them beside the manifest on disk.
 */
export type MarketplaceIconBase =
  | { kind: "url"; manifestUrl: string }
  | { kind: "dir"; root: string };

export type MarketplaceIconLocation =
  | { kind: "remote"; url: string }
  | { kind: "local"; path: string; relativePath: string };

/**
 * Where an entry's image icon lives, or null when the entry names a host icon
 * instead. Absolute URLs are always https and always remote; relative URLs
 * follow the manifest's own base.
 */
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
  // A local base reads the icon beside the manifest, which sits at the
  // checkout root. Resolving through URL drops any query or fragment and
  // collapses "." and ".." against that root, so the result names a path
  // inside the checkout; realPathInside enforces the same bound at read time.
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

/**
 * Where a person can read an entry's code before an install. A git entry
 * links its repository; a subdirectory links the directory on GitHub, and the
 * repository root elsewhere, because only GitHub's tree URL shape is known. An
 * npm entry on the default registry links its public package page. A private
 * registry has no public page bb can name, so that entry gets null.
 */
export function entryRepositoryUrl(entry: MarketplaceEntry): string | null {
  if ("npm" in entry.source) {
    return entry.source.npm.registry === undefined
      ? `https://www.npmjs.com/package/${entry.source.npm.package}`
      : null;
  }
  const git = entry.source.git;
  const repository = git.url.replace(/\.git$/u, "");
  if (git.subdir === undefined) return repository;
  // The schema accepts `#` and `?` in a subdirectory; raw interpolation would
  // turn them into a fragment or a query, so each segment is encoded.
  const path = git.subdir.split("/").map(encodeURIComponent).join("/");
  return new URL(repository).host === "github.com"
    ? `${repository}/tree/HEAD/${path}`
    : repository;
}

/** Human-readable source of an entry, shown before anything is installed. */
export function entrySourceDisplay(entry: MarketplaceEntry): string {
  if ("npm" in entry.source) {
    const spec = entry.source.npm.range ?? entry.source.npm.tag ?? "";
    // A listing that pins its own registry replaces the host's npm
    // configuration, so the confirmation must name that registry.
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
  /** Install-pipeline source spec. */
  source: string;
  /** Which plugin of the source the entry lists. */
  selection: PluginSourceSelection;
  /** Registry override for npm entries that name one. */
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

/**
 * The shared entry schemas own the public manifest grammar. Translation into
 * install-pipeline inputs adds the deeper parser and normalization safeguards
 * that depend on server-only source machinery.
 */
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

/** Translate an entry's source into install-pipeline inputs. */
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
    // A range entry always uses the explicit `semver:` spec: the listing said
    // range, so a repository that also has a ref of that name must not win.
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
