import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PROVIDER_DRIVER_ARTIFACT_ENTRYPOINT,
  PROVIDER_DRIVER_ARTIFACT_FORMAT_VERSION,
  PROVIDER_DRIVER_PROTOCOL_VERSION,
  type ProviderDriverArtifactDescriptor,
  type ProviderDriverArtifactMeta,
} from "@bb/provider-driver-contract";
import { create as createTar } from "tar";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProviderDriverArtifactCache } from "./provider-driver-artifact-cache.js";

function artifactMeta(
  overrides: Partial<ProviderDriverArtifactMeta> = {},
): ProviderDriverArtifactMeta {
  return {
    artifactFormatVersion: PROVIDER_DRIVER_ARTIFACT_FORMAT_VERSION,
    pluginId: "echo",
    pluginVersion: "1.0.0",
    driverId: "agent",
    providerDriverProtocolVersion: PROVIDER_DRIVER_PROTOCOL_VERSION,
    runtime: "node22",
    entrypoint: PROVIDER_DRIVER_ARTIFACT_ENTRYPOINT,
    builtWith: { bbVersion: "0.37.0" },
    ...overrides,
  };
}

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function responseBody(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

describe("ProviderDriverArtifactCache", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "bb-provider-driver-cache-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function buildArchive(
    args: {
      meta?: ProviderDriverArtifactMeta;
      symlinkEntrypoint?: boolean;
    } = {},
  ): Promise<{
    bytes: Uint8Array;
    descriptor: ProviderDriverArtifactDescriptor;
  }> {
    const sourceDir = join(root, `source-${Math.random()}`);
    await mkdir(sourceDir);
    if (args.symlinkEntrypoint) {
      await writeFile(join(sourceDir, "target.ts"), "export {};\n");
      await symlink(
        "target.ts",
        join(sourceDir, PROVIDER_DRIVER_ARTIFACT_ENTRYPOINT),
      );
    } else {
      await writeFile(
        join(sourceDir, PROVIDER_DRIVER_ARTIFACT_ENTRYPOINT),
        "export {};\n",
      );
    }
    const meta = args.meta ?? artifactMeta();
    await writeFile(
      join(sourceDir, "driver.meta.json"),
      `${JSON.stringify(meta)}\n`,
    );
    const archivePath = join(sourceDir, "driver.tgz");
    await createTar(
      {
        cwd: sourceDir,
        file: archivePath,
        gzip: true,
        portable: true,
        mtime: new Date(0),
      },
      [PROVIDER_DRIVER_ARTIFACT_ENTRYPOINT, "driver.meta.json"],
    );
    const bytes = await readFile(archivePath);
    return { bytes, descriptor: { digest: digest(bytes), meta } };
  }

  it("downloads, verifies, safely extracts, reuses, leases, and collects an artifact", async () => {
    const artifact = await buildArchive();
    let downloads = 0;
    const cache = new ProviderDriverArtifactCache({
      dataDir: root,
      downloadArtifact: async () => {
        downloads += 1;
        return new Response(responseBody(artifact.bytes), {
          headers: {
            "content-length": String(artifact.bytes.byteLength),
            "x-bb-artifact-digest": artifact.descriptor.digest,
          },
        });
      },
    });

    const [first, second] = await Promise.all([
      cache.acquire(artifact.descriptor),
      cache.acquire(artifact.descriptor),
    ]);
    expect(downloads).toBe(1);
    expect(await readFile(first.entrypointPath, "utf8")).toContain("export");
    expect((await stat(first.entrypointPath)).mode & 0o777).toBe(0o500);
    expect(await cache.collectGarbage(new Set())).toEqual([]);

    first.release();
    second.release();
    const reused = await cache.acquire(artifact.descriptor);
    expect(downloads).toBe(1);
    reused.release();
    expect(await cache.collectGarbage(new Set())).toEqual([
      artifact.descriptor.digest,
    ]);
  });

  it("rejects digest and metadata mismatches without publishing a cache entry", async () => {
    const artifact = await buildArchive();
    const cache = new ProviderDriverArtifactCache({
      dataDir: root,
      downloadArtifact: async () => new Response("corrupt"),
    });
    await expect(cache.acquire(artifact.descriptor)).rejects.toThrow(
      /digest mismatch/,
    );

    const wrongMeta = artifactMeta({ pluginId: "another-plugin" });
    const mismatched = await buildArchive({ meta: wrongMeta });
    const mismatchedDescriptor = {
      digest: mismatched.descriptor.digest,
      meta: artifactMeta(),
    };
    const metadataCache = new ProviderDriverArtifactCache({
      dataDir: join(root, "metadata"),
      downloadArtifact: async () =>
        new Response(responseBody(mismatched.bytes)),
    });
    await expect(metadataCache.acquire(mismatchedDescriptor)).rejects.toThrow(
      /metadata does not match/,
    );
    expect(await metadataCache.collectGarbage(new Set())).toEqual([]);
  });

  it.runIf(process.platform !== "win32")(
    "rejects symlinks before extraction",
    async () => {
      const artifact = await buildArchive({ symlinkEntrypoint: true });
      const cache = new ProviderDriverArtifactCache({
        dataDir: root,
        downloadArtifact: async () =>
          new Response(responseBody(artifact.bytes)),
      });
      await expect(cache.acquire(artifact.descriptor)).rejects.toThrow(
        /unsupported type SymbolicLink/,
      );
    },
  );
});
