import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import {
  PROVIDER_DRIVER_ARTIFACT_ENTRYPOINT,
  PROVIDER_DRIVER_ARTIFACT_MAX_ARCHIVE_BYTES,
  PROVIDER_DRIVER_ARTIFACT_MAX_EXTRACTED_BYTES,
  providerDriverArtifactDescriptorSchema,
  providerDriverArtifactMetaSchema,
  type ProviderDriverArtifactDescriptor,
} from "@bb/provider-driver-contract";
import { extract as extractTar, list as listTar } from "tar";

const ALLOWED_ARTIFACT_FILES = new Set([
  PROVIDER_DRIVER_ARTIFACT_ENTRYPOINT,
  "driver.js.map",
  "driver.meta.json",
]);
const REQUIRED_ARTIFACT_FILES = [
  PROVIDER_DRIVER_ARTIFACT_ENTRYPOINT,
  "driver.meta.json",
] as const;
const COMPLETE_FILE_NAME = ".complete.json";
const MAX_ARCHIVE_ENTRIES = 16;

export interface ProviderDriverArtifactLease {
  descriptor: ProviderDriverArtifactDescriptor;
  entrypointPath: string;
  release(): void;
}

export interface ProviderDriverArtifactCacheOptions {
  dataDir: string;
  downloadArtifact: (digest: string) => Promise<Response>;
}

interface InspectedArchive {
  files: Set<string>;
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function descriptorsEqual(
  left: ProviderDriverArtifactDescriptor,
  right: ProviderDriverArtifactDescriptor,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function parseContentLength(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

async function inspectArchive(archivePath: string): Promise<InspectedArchive> {
  const files = new Set<string>();
  let extractedBytes = 0;
  let entries = 0;
  let problem: Error | null = null;
  const reject = (message: string): void => {
    problem ??= new Error(message);
  };
  await listTar({
    file: archivePath,
    strict: true,
    onReadEntry(entry) {
      entries += 1;
      if (entries > MAX_ARCHIVE_ENTRIES) {
        reject(
          `provider driver archive exceeds the ${MAX_ARCHIVE_ENTRIES}-entry limit`,
        );
        return;
      }
      const path = entry.path;
      if (
        path.startsWith("/") ||
        path.includes("\\") ||
        path.split("/").some((segment) => segment === "..") ||
        !ALLOWED_ARTIFACT_FILES.has(path)
      ) {
        reject(`provider driver archive contains unsafe path "${path}"`);
        return;
      }
      if (entry.type !== "File") {
        reject(
          `provider driver archive entry "${path}" has unsupported type ${entry.type}`,
        );
        return;
      }
      if (files.has(path)) {
        reject(`provider driver archive contains duplicate path "${path}"`);
        return;
      }
      if (!Number.isSafeInteger(entry.size) || entry.size < 0) {
        reject(`provider driver archive entry "${path}" has an invalid size`);
        return;
      }
      files.add(path);
      extractedBytes += entry.size;
      if (extractedBytes > PROVIDER_DRIVER_ARTIFACT_MAX_EXTRACTED_BYTES) {
        reject(
          `provider driver archive exceeds the ${PROVIDER_DRIVER_ARTIFACT_MAX_EXTRACTED_BYTES}-byte extracted limit`,
        );
      }
    },
  });
  if (problem !== null) throw problem;
  for (const required of REQUIRED_ARTIFACT_FILES) {
    if (!files.has(required)) {
      throw new Error(`provider driver archive is missing ${required}`);
    }
  }
  return { files };
}

async function assertRegularFile(path: string, label: string): Promise<void> {
  let fileStat;
  try {
    fileStat = await lstat(path);
  } catch {
    throw new Error(`${label} is missing`);
  }
  if (!fileStat.isFile()) throw new Error(`${label} must be a regular file`);
}

export class ProviderDriverArtifactCache {
  private readonly artifactsRoot: string;
  private readonly stagingRoot: string;
  private readonly pending = new Map<string, Promise<string>>();
  private readonly leaseCounts = new Map<string, number>();

  constructor(private readonly options: ProviderDriverArtifactCacheOptions) {
    this.artifactsRoot = join(options.dataDir, "provider-drivers", "artifacts");
    this.stagingRoot = join(options.dataDir, "provider-drivers", "staging");
  }

  async acquire(
    rawDescriptor: ProviderDriverArtifactDescriptor,
  ): Promise<ProviderDriverArtifactLease> {
    const descriptor =
      providerDriverArtifactDescriptorSchema.parse(rawDescriptor);
    const artifactDir = await this.ensure(descriptor);
    const digest = descriptor.digest;
    this.leaseCounts.set(digest, (this.leaseCounts.get(digest) ?? 0) + 1);
    let released = false;
    return {
      descriptor,
      entrypointPath: join(artifactDir, descriptor.meta.entrypoint),
      release: () => {
        if (released) return;
        released = true;
        const next = (this.leaseCounts.get(digest) ?? 1) - 1;
        if (next === 0) this.leaseCounts.delete(digest);
        else this.leaseCounts.set(digest, next);
      },
    };
  }

  async collectGarbage(retainDigests: ReadonlySet<string>): Promise<string[]> {
    let entries;
    try {
      entries = await readdir(this.artifactsRoot, { withFileTypes: true });
    } catch (error) {
      if (isErrnoException(error) && error.code === "ENOENT") return [];
      throw error;
    }
    const removed: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const digest = entry.name;
      if (retainDigests.has(digest) || this.leaseCounts.has(digest)) continue;
      await rm(join(this.artifactsRoot, digest), {
        recursive: true,
        force: true,
      });
      removed.push(digest);
    }
    return removed.sort();
  }

  private async ensure(
    descriptor: ProviderDriverArtifactDescriptor,
  ): Promise<string> {
    const existing = this.pending.get(descriptor.digest);
    if (existing !== undefined) return existing;
    const operation = this.ensureUnshared(descriptor).finally(() => {
      if (this.pending.get(descriptor.digest) === operation) {
        this.pending.delete(descriptor.digest);
      }
    });
    this.pending.set(descriptor.digest, operation);
    return operation;
  }

  private async ensureUnshared(
    descriptor: ProviderDriverArtifactDescriptor,
  ): Promise<string> {
    const finalDir = join(this.artifactsRoot, descriptor.digest);
    if (await this.isComplete(finalDir, descriptor)) return finalDir;
    await rm(finalDir, { recursive: true, force: true });
    await mkdir(this.artifactsRoot, { recursive: true, mode: 0o700 });
    await mkdir(this.stagingRoot, { recursive: true, mode: 0o700 });
    const stageDir = join(
      this.stagingRoot,
      `${descriptor.digest}.${process.pid}.${randomUUID()}`,
    );
    const archivePath = join(stageDir, "artifact.tgz");
    const extractDir = join(stageDir, "extracted");
    await mkdir(extractDir, { recursive: true, mode: 0o700 });
    try {
      await this.download(descriptor.digest, archivePath);
      const inspected = await inspectArchive(archivePath);
      await extractTar({
        file: archivePath,
        cwd: extractDir,
        strict: true,
        preservePaths: false,
        filter: (path) => inspected.files.has(path),
      });
      await this.validateExtracted(extractDir, descriptor);
      await chmod(join(extractDir, descriptor.meta.entrypoint), 0o500);
      await chmod(join(extractDir, "driver.meta.json"), 0o400);
      if (inspected.files.has("driver.js.map")) {
        await chmod(join(extractDir, "driver.js.map"), 0o400);
      }
      await writeFile(
        join(extractDir, COMPLETE_FILE_NAME),
        `${JSON.stringify(descriptor)}\n`,
        { mode: 0o400 },
      );
      try {
        await rename(extractDir, finalDir);
      } catch (error) {
        if (!isErrnoException(error) || error.code !== "EEXIST") throw error;
        if (!(await this.isComplete(finalDir, descriptor))) throw error;
      }
      return finalDir;
    } finally {
      await rm(stageDir, { recursive: true, force: true });
    }
  }

  private async download(digest: string, destination: string): Promise<void> {
    const response = await this.options.downloadArtifact(digest);
    if (!response.ok) {
      throw new Error(
        `provider driver artifact download failed: ${response.status} ${response.statusText}`,
      );
    }
    const declaredDigest = response.headers.get("x-bb-artifact-digest");
    if (declaredDigest !== null && declaredDigest !== digest) {
      throw new Error(
        `provider driver artifact response digest mismatch: expected ${digest}, got ${declaredDigest}`,
      );
    }
    const contentLength = parseContentLength(
      response.headers.get("content-length"),
    );
    if (
      contentLength !== null &&
      contentLength > PROVIDER_DRIVER_ARTIFACT_MAX_ARCHIVE_BYTES
    ) {
      throw new Error(
        `provider driver artifact exceeds the ${PROVIDER_DRIVER_ARTIFACT_MAX_ARCHIVE_BYTES}-byte archive limit`,
      );
    }
    const file = await open(destination, "wx", 0o600);
    const hash = createHash("sha256");
    let receivedBytes = 0;
    try {
      if (response.body !== null) {
        const reader = response.body.getReader();
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          receivedBytes += chunk.value.byteLength;
          if (receivedBytes > PROVIDER_DRIVER_ARTIFACT_MAX_ARCHIVE_BYTES) {
            throw new Error(
              `provider driver artifact exceeds the ${PROVIDER_DRIVER_ARTIFACT_MAX_ARCHIVE_BYTES}-byte archive limit`,
            );
          }
          hash.update(chunk.value);
          await file.write(chunk.value);
        }
      }
    } finally {
      await file.close();
    }
    if (contentLength !== null && receivedBytes !== contentLength) {
      throw new Error(
        `provider driver artifact size mismatch: expected ${contentLength}, received ${receivedBytes}`,
      );
    }
    const receivedDigest = hash.digest("hex");
    if (receivedDigest !== digest) {
      throw new Error(
        `provider driver artifact digest mismatch: expected ${digest}, got ${receivedDigest}`,
      );
    }
  }

  private async validateExtracted(
    artifactDir: string,
    descriptor: ProviderDriverArtifactDescriptor,
  ): Promise<void> {
    await assertRegularFile(
      join(artifactDir, descriptor.meta.entrypoint),
      "provider driver entrypoint",
    );
    await assertRegularFile(
      join(artifactDir, "driver.meta.json"),
      "provider driver metadata",
    );
    const meta = providerDriverArtifactMetaSchema.parse(
      JSON.parse(await readFile(join(artifactDir, "driver.meta.json"), "utf8")),
    );
    if (!descriptorsEqual({ digest: descriptor.digest, meta }, descriptor)) {
      throw new Error(
        "provider driver artifact metadata does not match launch descriptor",
      );
    }
  }

  private async isComplete(
    artifactDir: string,
    descriptor: ProviderDriverArtifactDescriptor,
  ): Promise<boolean> {
    try {
      const recorded = providerDriverArtifactDescriptorSchema.parse(
        JSON.parse(
          await readFile(join(artifactDir, COMPLETE_FILE_NAME), "utf8"),
        ),
      );
      if (!descriptorsEqual(recorded, descriptor)) return false;
      await this.validateExtracted(artifactDir, descriptor);
      return true;
    } catch {
      return false;
    }
  }
}
