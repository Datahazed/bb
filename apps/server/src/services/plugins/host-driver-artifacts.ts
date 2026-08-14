/* eslint-disable no-restricted-imports -- immutable plugin artifacts are server-owned storage, not workspace files. */
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  chmod,
  copyFile,
  link,
  lstat,
  mkdir,
  readFile,
  realpath,
  rm,
} from "node:fs/promises";
import { join } from "node:path";
import {
  PROVIDER_DRIVER_ARTIFACT_MAX_ARCHIVE_BYTES,
  providerDriverArtifactDigestSchema,
  providerDriverArtifactMetaSchema,
  type ProviderDriverArtifactDescriptor,
} from "@bb/provider-driver-contract";
import { validatePluginHostDriverArtifactMeta } from "@bb/plugin-build";
import type { PluginManifest } from "./manifest.js";

const HOST_DRIVER_META_MAX_BYTES = 64 * 1024;

export interface MaterializedPluginHostDriverArtifact {
  archivePath: string;
  descriptor: ProviderDriverArtifactDescriptor;
  sizeBytes: number;
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

async function assertConfinedRegularFile(args: {
  path: string;
  rootDir: string;
  label: string;
  maxBytes: number;
}): Promise<number> {
  let fileStat;
  try {
    fileStat = await lstat(args.path);
  } catch {
    throw new Error(`${args.label} is missing`);
  }
  if (!fileStat.isFile()) {
    throw new Error(`${args.label} must be a regular file`);
  }
  if (fileStat.size > args.maxBytes) {
    throw new Error(`${args.label} exceeds the ${args.maxBytes}-byte limit`);
  }
  const [realRoot, realFile] = await Promise.all([
    realpath(args.rootDir),
    realpath(args.path),
  ]);
  if (realFile !== realRoot && !realFile.startsWith(`${realRoot}/`)) {
    throw new Error(`${args.label} escapes the plugin directory`);
  }
  return fileStat.size;
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function materializeArchive(args: {
  archivePath: string;
  cacheRoot: string;
  digest: string;
}): Promise<string> {
  await mkdir(args.cacheRoot, { recursive: true, mode: 0o700 });
  const targetPath = join(args.cacheRoot, `${args.digest}.tgz`);
  try {
    if ((await sha256File(targetPath)) === args.digest) return targetPath;
    await rm(targetPath, { force: true });
  } catch (error) {
    if (!isErrnoException(error) || error.code !== "ENOENT") throw error;
  }

  const stagedPath = join(
    args.cacheRoot,
    `.${args.digest}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    await copyFile(args.archivePath, stagedPath);
    await chmod(stagedPath, 0o600);
    const stagedDigest = await sha256File(stagedPath);
    if (stagedDigest !== args.digest) {
      throw new Error(
        `host driver archive changed while materializing: expected ${args.digest}, got ${stagedDigest}`,
      );
    }
    try {
      await link(stagedPath, targetPath);
    } catch (error) {
      if (!isErrnoException(error) || error.code !== "EEXIST") throw error;
      if ((await sha256File(targetPath)) !== args.digest) {
        throw new Error(
          `cached host driver artifact ${args.digest} failed digest verification`,
        );
      }
    }
    return targetPath;
  } finally {
    await rm(stagedPath, { force: true });
  }
}

/** Validate and copy one plugin load's immutable host artifacts into server storage. */
export async function materializePluginHostDriverArtifacts(args: {
  dataDir: string;
  manifest: PluginManifest;
}): Promise<MaterializedPluginHostDriverArtifact[]> {
  const artifacts: MaterializedPluginHostDriverArtifact[] = [];
  for (const driver of args.manifest.hostDrivers) {
    const driverDir = join(args.manifest.rootDir, "dist", "host", driver.id);
    const archiveSourcePath = join(driverDir, "driver.tgz");
    const metaPath = join(driverDir, "driver.meta.json");
    const sizeBytes = await assertConfinedRegularFile({
      path: archiveSourcePath,
      rootDir: args.manifest.rootDir,
      label: `host driver archive "${driver.id}"`,
      maxBytes: PROVIDER_DRIVER_ARTIFACT_MAX_ARCHIVE_BYTES,
    });
    await assertConfinedRegularFile({
      path: metaPath,
      rootDir: args.manifest.rootDir,
      label: `host driver metadata "${driver.id}"`,
      maxBytes: HOST_DRIVER_META_MAX_BYTES,
    });
    const rawMeta = await readFile(metaPath, "utf8");
    const metadataProblem = validatePluginHostDriverArtifactMeta({
      raw: rawMeta,
      pluginId: args.manifest.id,
      pluginVersion: args.manifest.version,
      driverId: driver.id,
    });
    if (metadataProblem !== null) throw new Error(metadataProblem);
    const meta = providerDriverArtifactMetaSchema.parse(JSON.parse(rawMeta));
    const digest = providerDriverArtifactDigestSchema.parse(
      await sha256File(archiveSourcePath),
    );
    const archivePath = await materializeArchive({
      archivePath: archiveSourcePath,
      cacheRoot: join(args.dataDir, "provider-drivers", "artifacts"),
      digest,
    });
    artifacts.push({
      archivePath,
      descriptor: { digest, meta },
      sizeBytes,
    });
  }
  return artifacts;
}
