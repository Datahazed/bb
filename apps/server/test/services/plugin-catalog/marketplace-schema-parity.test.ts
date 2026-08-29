import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { parseMarketplaceManifest } from "../../../src/services/plugin-catalog/marketplace-manifest.js";

const V1_SCHEMA_PATH = fileURLToPath(
  new URL(
    "../../../../web/public/schemas/marketplace.schema.json",
    import.meta.url,
  ),
);
const V2_SCHEMA_PATH = fileURLToPath(
  new URL(
    "../../../../web/public/schemas/marketplace-v2.schema.json",
    import.meta.url,
  ),
);

const publishedSchemaSchema = z.record(z.string(), z.unknown());

async function compilePublishedSchema(
  path: string,
): Promise<(value: unknown) => boolean> {
  const schema = publishedSchemaSchema.parse(
    JSON.parse(await readFile(path, "utf8")),
  );
  const ajv = new Ajv2020({ strict: false });
  ajv.addFormat("date-time", {
    type: "string",
    validate: (value: string) =>
      z.iso.datetime({ offset: true }).safeParse(value).success,
  });
  return ajv.compile(schema);
}

function manifestV2With(
  entry: Record<string, unknown>,
  newAndNotable: string[] = [],
): Record<string, unknown> {
  const v1 = manifestWith(entry);
  return {
    ...v1,
    schemaVersion: 2,
    newAndNotable,
    plugins: (v1.plugins as Record<string, unknown>[]).map((plugin) => ({
      category: "thread-content",
      screenshots: [],
      ...plugin,
    })),
  };
}

interface Fixture {
  readonly label: string;
  readonly valid: boolean;
  readonly manifest: unknown;
}

function manifestWith(entry: Record<string, unknown>): Record<string, unknown> {
  return {
    schemaVersion: 1,
    name: "acme",
    displayName: "Acme plugins",
    plugins: [
      {
        id: "acme-plugin",
        displayName: "Acme",
        description: "An Acme plugin.",
        icon: "ZoomIn",
        author: { name: "Acme" },
        source: { npm: { package: "bb-plugin-acme" } },
        ...entry,
      },
    ],
  };
}

function iconFixture(label: string, url: string, valid: boolean): Fixture {
  return { label, valid, manifest: manifestWith({ icon: { url } }) };
}

function rangeFixture(label: string, range: string, valid: boolean): Fixture {
  return {
    label,
    valid,
    manifest: manifestWith({
      source: { npm: { package: "bb-plugin-acme", range } },
    }),
  };
}

function enginesFixture(label: string, engines: unknown): Fixture {
  return { label, valid: false, manifest: manifestWith({ engines }) };
}

const fixtures: readonly Fixture[] = [
  { label: "minimal npm entry", valid: true, manifest: manifestWith({}) },
  {
    label: "git entry",
    valid: true,
    manifest: manifestWith({
      source: {
        git: {
          url: "https://example.com/acme/plugin.git",
          ref: "v1.2.3",
          subdir: "plugins/acme",
        },
      },
    }),
  },
  {
    label: "git semver range entry",
    valid: true,
    manifest: manifestWith({
      source: {
        git: {
          url: "https://example.com/acme/plugin.git",
          range: "^1.2.3",
          tagPrefix: "acme/",
          subdir: "plugins/acme",
        },
      },
    }),
  },
  {
    label: "git tag prefix at the public limit",
    valid: true,
    manifest: manifestWith({
      source: {
        git: {
          url: "https://example.com/acme/plugin.git",
          range: "^1.2.3",
          tagPrefix: "a".repeat(128),
        },
      },
    }),
  },
  {
    label: "git tag prefix past the public limit",
    valid: false,
    manifest: manifestWith({
      source: {
        git: {
          url: "https://example.com/acme/plugin.git",
          range: "^1.2.3",
          tagPrefix: "a".repeat(129),
        },
      },
    }),
  },
  {
    label: "invalid git semver range",
    valid: false,
    manifest: manifestWith({
      source: {
        git: {
          url: "https://example.com/acme/plugin.git",
          range: "latest",
        },
      },
    }),
  },
  {
    label: "unknown entry field",
    valid: false,
    manifest: manifestWith({ surprise: true }),
  },
  {
    label: "npm range and tag together",
    valid: false,
    manifest: manifestWith({
      source: {
        npm: { package: "bb-plugin-acme", range: "^1.0.0", tag: "beta" },
      },
    }),
  },

  iconFixture("absolute https icon", "https://cdn.example.com/a.svg", true),
  iconFixture("relative icon", "icons/acme.png", true),
  iconFixture("dot-relative icon", "./acme.webp", true),
  iconFixture("uppercase extension", "https://cdn.example.com/A.PNG", true),
  iconFixture(
    "query after the extension",
    "https://cdn.example.com/a.svg?v=2",
    true,
  ),
  iconFixture("ftp icon", "ftp://host.example.com/icon.svg", false),
  iconFixture("plain http icon", "http://cdn.example.com/a.svg", false),
  iconFixture("data URL icon", "data:image/svg+xml,a.svg", false),
  iconFixture("javascript URL icon", "javascript:a.svg", false),
  iconFixture("unsupported extension", "https://cdn.example.com/a.gif", false),
  iconFixture("no extension", "https://cdn.example.com/a", false),
  {
    label: "unknown icon field",
    valid: false,
    manifest: manifestWith({ icon: { url: "./acme.svg", logo: true } }),
  },

  rangeFixture("caret range", "^1.2.3", true),
  rangeFixture("comparator pair", ">=1.0.0 <2.0.0", true),
  rangeFixture("hyphen range", "1.2.3 - 2.3.4", true),
  rangeFixture("alternatives", "1.x || >=2.5.0", true),
  rangeFixture("prerelease comparator", ">1.2.3-alpha.3", true),
  rangeFixture("star", "*", true),
  rangeFixture("prose", "latest", false),
  rangeFixture("bare operator", ">=", false),
  rangeFixture("four segments", "1.2.3.4", false),
  rangeFixture("garbage alternative", "1.0.0 || garbage", false),

  enginesFixture("engines.bb range", { bb: ">=0.30.0" }),
  enginesFixture("engines.bbPluginSdk range", { bbPluginSdk: "^0.5.0" }),
  enginesFixture("empty engines object", {}),

  {
    label: "marketplace name at the route limit",
    valid: true,
    manifest: { ...manifestWith({}), name: "a".repeat(64) },
  },
  {
    label: "marketplace name past the route limit",
    valid: false,
    manifest: { ...manifestWith({}), name: "a".repeat(65) },
  },
];

const v2Fixtures: readonly Fixture[] = [
  {
    label: "required discovery fields",
    valid: true,
    manifest: manifestV2With({}),
  },
  {
    label: "category and relative screenshots",
    valid: true,
    manifest: manifestV2With({
      category: "thread-content",
      screenshots: [
        "./screenshots/acme.png",
        "https://cdn.example.com/acme-dark.webp",
      ],
    }),
  },
  {
    label: "registry publication timestamps",
    valid: true,
    manifest: manifestV2With({
      publishedAt: "2026-08-20T09:30:00Z",
      updatedAt: "2026-08-24T16:45:00+02:00",
    }),
  },
  {
    label: "invalid published timestamp",
    valid: false,
    manifest: manifestV2With({ publishedAt: "yesterday" }),
  },
  {
    label: "invalid updated timestamp",
    valid: false,
    manifest: manifestV2With({ updatedAt: "2026-02-30T09:30:00Z" }),
  },
  {
    label: "omitted required category",
    valid: false,
    manifest: {
      ...manifestV2With({}),
      plugins: [(manifestWith({}).plugins as unknown[])[0]],
    },
  },
  {
    label: "unknown category",
    valid: false,
    manifest: manifestV2With({ category: "interface" }),
  },
  {
    label: "plain http screenshot",
    valid: false,
    manifest: manifestV2With({
      screenshots: ["http://cdn.example.com/acme.png"],
    }),
  },
  {
    label: "unsupported screenshot format",
    valid: false,
    manifest: manifestV2With({ screenshots: ["./screenshots/acme.gif"] }),
  },
  {
    label: "too many screenshots",
    valid: false,
    manifest: manifestV2With({
      screenshots: Array.from(
        { length: 7 },
        (_unused, index) => `./screenshots/${index}.png`,
      ),
    }),
  },
  {
    label: "ordered New & notable ids",
    valid: true,
    manifest: manifestV2With({}, ["acme-plugin"]),
  },
  {
    label: "duplicate New & notable ids",
    valid: false,
    manifest: manifestV2With({}, ["acme-plugin", "acme-plugin"]),
  },
];

async function expectParity(
  path: string,
  parityFixtures: readonly Fixture[],
): Promise<void> {
  const validate = await compilePublishedSchema(path);
  const disagreements = parityFixtures.flatMap((fixture) => {
    const published = validate(fixture.manifest);
    let runtime = true;
    try {
      parseMarketplaceManifest(fixture.manifest, "fixture");
    } catch {
      runtime = false;
    }
    return published === fixture.valid && runtime === fixture.valid
      ? []
      : [
          `${fixture.label}: expected ${fixture.valid ? "valid" : "invalid"}, published schema said ${published}, runtime parser said ${runtime}`,
        ];
  });
  expect(disagreements).toEqual([]);
}

describe("published marketplace schema parity", () => {
  it("agrees with the runtime parser for immutable v1 fixtures", async () => {
    await expectParity(V1_SCHEMA_PATH, fixtures);
  });

  it("agrees with the runtime parser for discovery v2 fixtures", async () => {
    await expectParity(V2_SCHEMA_PATH, v2Fixtures);
  });

  it("caps the entry count in both contracts", async () => {
    const validateV1 = await compilePublishedSchema(V1_SCHEMA_PATH);
    const validateV2 = await compilePublishedSchema(V2_SCHEMA_PATH);
    const oversize = {
      schemaVersion: 1,
      name: "acme",
      displayName: "Acme plugins",
      plugins: Array.from({ length: 257 }, (_unused, index) => ({
        id: `acme-plugin-${index}`,
        displayName: "Acme",
        description: "An Acme plugin.",
        icon: "ZoomIn",
        author: { name: "Acme" },
        source: { npm: { package: `bb-plugin-acme-${index}` } },
      })),
    };

    expect(validateV1(oversize)).toBe(false);
    expect(() => parseMarketplaceManifest(oversize, "fixture")).toThrow(
      /at most 256 plugins/u,
    );
    const oversizeV2 = {
      ...oversize,
      schemaVersion: 2,
      newAndNotable: [],
      plugins: oversize.plugins.map((plugin) => ({
        ...plugin,
        category: "thread-content",
        screenshots: [],
      })),
    };
    expect(validateV2(oversizeV2)).toBe(false);
    expect(() => parseMarketplaceManifest(oversizeV2, "fixture")).toThrow(
      /at most 256 plugins/u,
    );
  });
});
