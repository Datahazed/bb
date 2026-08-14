import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { derivePluginId, type PluginPackageJson } from "@bb/domain";
import {
  PROVIDER_DRIVER_ARTIFACT_ENTRYPOINT,
  PROVIDER_DRIVER_ARTIFACT_FORMAT_VERSION,
  PROVIDER_DRIVER_ARTIFACT_RUNTIME,
  PROVIDER_DRIVER_PROTOCOL_VERSION,
  providerDriverArtifactMetaSchema,
  type ProviderDriverArtifactMeta,
} from "@bb/provider-driver-contract";
import { create as createTar } from "tar";
import { NODE_ESM_REQUIRE_BANNER } from "./node-esm-banner.js";
import { validatePluginBuildManifest } from "./plugin-manifest.js";
import type { PluginBuildToolchain } from "./toolchain.js";

export type PluginHostDriverArtifactMeta = ProviderDriverArtifactMeta;

export interface PluginHostDriverBuildResult {
  driverId: string;
  archivePath: string;
  jsPath: string;
  mapPath: string;
  metaPath: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

async function readManifest(rootDir: string): Promise<PluginPackageJson> {
  const packageJsonPath = join(rootDir, "package.json");
  let raw: string;
  try {
    raw = await readFile(packageJsonPath, "utf8");
  } catch {
    throw new Error(`no readable package.json at ${packageJsonPath}`);
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(`package.json is not valid JSON at ${packageJsonPath}`);
  }
  if (!isRecord(value) || !isRecord(value.bb)) {
    throw new Error(`invalid plugin package.json at ${packageJsonPath}`);
  }
  return validatePluginBuildManifest(value, rootDir, packageJsonPath);
}

function resolveDriverEntry(
  rootDir: string,
  driverId: string,
  entry: string,
): string {
  const label = `bb.experimental_hostDrivers.${driverId}.entry`;
  if (isAbsolute(entry)) {
    throw new Error(`manifest ${label} must be relative, got "${entry}"`);
  }
  const entryPath = resolve(rootDir, entry);
  if (entryPath !== rootDir && !entryPath.startsWith(rootDir + "/")) {
    throw new Error(
      `manifest ${label} escapes the plugin directory: "${entry}"`,
    );
  }
  return entryPath;
}

function createMeta(args: {
  packageName: string;
  pluginVersion: string;
  driverId: string;
  bbVersion: string;
}): PluginHostDriverArtifactMeta {
  return {
    artifactFormatVersion: PROVIDER_DRIVER_ARTIFACT_FORMAT_VERSION,
    pluginId: derivePluginId(args.packageName),
    pluginVersion: args.pluginVersion,
    driverId: args.driverId,
    providerDriverProtocolVersion: PROVIDER_DRIVER_PROTOCOL_VERSION,
    runtime: PROVIDER_DRIVER_ARTIFACT_RUNTIME,
    entrypoint: PROVIDER_DRIVER_ARTIFACT_ENTRYPOINT,
    builtWith: { bbVersion: args.bbVersion },
  };
}

export function validatePluginHostDriverArtifactMeta(args: {
  raw: string;
  pluginId: string;
  pluginVersion: string;
  driverId: string;
}): string | null {
  let value: unknown;
  try {
    value = JSON.parse(args.raw);
  } catch {
    return `host driver artifact metadata for "${args.driverId}" is not valid JSON`;
  }
  const parsed = providerDriverArtifactMetaSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return `host driver artifact metadata for "${args.driverId}" is invalid${issue ? ` at ${issue.path.join(".") || "(root)"}: ${issue.message}` : ""}`;
  }
  const expected: Array<
    [
      keyof Pick<
        ProviderDriverArtifactMeta,
        "pluginId" | "pluginVersion" | "driverId"
      >,
      string,
    ]
  > = [
    ["pluginId", args.pluginId],
    ["pluginVersion", args.pluginVersion],
    ["driverId", args.driverId],
  ];
  for (const [field, expectedValue] of expected) {
    if (parsed.data[field] !== expectedValue) {
      return `host driver artifact metadata for "${args.driverId}" has ${field}=${JSON.stringify(parsed.data[field])}; expected ${JSON.stringify(expectedValue)}`;
    }
  }
  return null;
}

/**
 * Build every `bb.experimental_hostDrivers` entry into an isolated, portable
 * Node bundle plus a deterministic gzip tar archive under `dist/host/`.
 * All entries stage before the previous host artifact set is replaced.
 */
export async function buildPluginHostDrivers(
  rootDir: string,
  bbVersion: string,
  toolchain: PluginBuildToolchain,
): Promise<PluginHostDriverBuildResult[]> {
  const manifest = await readManifest(rootDir);
  const declarations = manifest.bb.experimental_hostDrivers ?? [];
  const distDir = join(rootDir, "dist");
  const hostDir = join(distDir, "host");
  await mkdir(distDir, { recursive: true });

  if (declarations.length === 0) {
    await rm(hostDir, { recursive: true, force: true });
    return [];
  }

  const stageRoot = await mkdtemp(join(distDir, ".host-stage-"));
  const stagedHostDir = join(stageRoot, "host");
  const backupRoot = await mkdtemp(join(distDir, ".host-backup-"));
  const backupHostDir = join(backupRoot, "host");
  let previousMoved = false;
  try {
    const esbuild = (await import(
      toolchain.esbuild
    )) as typeof import("esbuild");
    for (const declaration of declarations) {
      const driverDir = join(stagedHostDir, declaration.id);
      await mkdir(driverDir, { recursive: true });
      // The bundle is JavaScript. Artifact format 2 deliberately keeps a .ts
      // entrypoint so extension runtimes can select their embedded TS module
      // shims without depending on host node_modules.
      const jsPath = join(driverDir, PROVIDER_DRIVER_ARTIFACT_ENTRYPOINT);
      await esbuild.build({
        entryPoints: [
          resolveDriverEntry(rootDir, declaration.id, declaration.entry),
        ],
        outfile: jsPath,
        bundle: true,
        format: "esm",
        platform: "node",
        target: "node22",
        sourcemap: true,
        banner: { js: NODE_ESM_REQUIRE_BANNER },
        logLevel: "error",
      });
      const meta = createMeta({
        packageName: manifest.name,
        pluginVersion: manifest.version,
        driverId: declaration.id,
        bbVersion,
      });
      await writeFile(
        join(driverDir, "driver.meta.json"),
        `${JSON.stringify(meta, null, 2)}\n`,
      );
      await createTar(
        {
          cwd: driverDir,
          file: join(driverDir, "driver.tgz"),
          gzip: true,
          portable: true,
          mtime: new Date(0),
        },
        [
          PROVIDER_DRIVER_ARTIFACT_ENTRYPOINT,
          `${PROVIDER_DRIVER_ARTIFACT_ENTRYPOINT}.map`,
          "driver.meta.json",
        ],
      );
    }

    try {
      await rename(hostDir, backupHostDir);
      previousMoved = true;
    } catch (error) {
      if (!isErrnoException(error) || error.code !== "ENOENT") throw error;
    }
    try {
      await rename(stagedHostDir, hostDir);
    } catch (error) {
      if (previousMoved) await rename(backupHostDir, hostDir);
      throw error;
    }

    return declarations.map((declaration) => {
      const driverDir = join(hostDir, declaration.id);
      return {
        driverId: declaration.id,
        archivePath: join(driverDir, "driver.tgz"),
        jsPath: join(driverDir, PROVIDER_DRIVER_ARTIFACT_ENTRYPOINT),
        mapPath: join(driverDir, `${PROVIDER_DRIVER_ARTIFACT_ENTRYPOINT}.map`),
        metaPath: join(driverDir, "driver.meta.json"),
      };
    });
  } finally {
    await rm(stageRoot, { recursive: true, force: true });
    await rm(backupRoot, { recursive: true, force: true });
  }
}
