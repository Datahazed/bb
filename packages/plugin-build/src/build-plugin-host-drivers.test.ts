import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PROVIDER_DRIVER_PROTOCOL_VERSION } from "@bb/provider-driver-contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { list as listTar } from "tar";
import {
  buildPluginHostDrivers,
  resolvePluginBuildToolchain,
  validatePluginHostDriverArtifactMeta,
} from "./index.js";

const TEST_BB_VERSION = "0.9.0-test";

function testToolchain() {
  return resolvePluginBuildToolchain(join(tmpdir(), "bb-toolchain-unused"));
}

function packageJson(drivers: Array<{ id: string; entry: string }>) {
  return JSON.stringify({
    name: "bb-plugin-driver-fixture",
    version: "0.1.0",
    type: "module",
    bb: {
      name: "Driver fixture",
      description: "Plugin host driver build fixture.",
      branding: { icon: "Zap" },
      server: "./server.ts",
      experimental_hostDrivers: drivers,
    },
  });
}

describe("buildPluginHostDrivers", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "bb-plugin-host-driver-build-"));
    await writeFile(
      join(root, "server.ts"),
      "export default function plugin() {}\n",
    );
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("builds isolated driver bundles, metadata, and archives", async () => {
    await writeFile(
      join(root, "package.json"),
      packageJson([{ id: "echo", entry: "./echo-driver.ts" }]),
    );
    await writeFile(
      join(root, "echo-driver.ts"),
      'console.error("HOST_DRIVER_MARKER");\n',
    );

    const [result] = await buildPluginHostDrivers(
      root,
      TEST_BB_VERSION,
      await testToolchain(),
    );

    expect(result?.driverId).toBe("echo");
    if (result === undefined) throw new Error("driver result missing");
    expect(await readFile(result.jsPath, "utf8")).toContain(
      "HOST_DRIVER_MARKER",
    );
    const rawMeta = await readFile(result.metaPath, "utf8");
    expect(JSON.parse(rawMeta)).toEqual({
      artifactFormatVersion: 1,
      pluginId: "driver-fixture",
      pluginVersion: "0.1.0",
      driverId: "echo",
      providerDriverProtocolVersion: PROVIDER_DRIVER_PROTOCOL_VERSION,
      runtime: "node22",
      entrypoint: "driver.js",
      builtWith: { bbVersion: TEST_BB_VERSION },
    });
    expect(
      validatePluginHostDriverArtifactMeta({
        raw: rawMeta,
        pluginId: "driver-fixture",
        pluginVersion: "0.1.0",
        driverId: "echo",
      }),
    ).toBeNull();
    expect(
      validatePluginHostDriverArtifactMeta({
        raw: rawMeta,
        pluginId: "another-plugin",
        pluginVersion: "0.1.0",
        driverId: "echo",
      }),
    ).toContain("pluginId");

    const entries: string[] = [];
    await listTar({
      file: result.archivePath,
      onReadEntry: (entry) => entries.push(entry.path),
    });
    expect(entries.sort()).toEqual([
      "driver.js",
      "driver.js.map",
      "driver.meta.json",
    ]);

    const firstArchive = await readFile(result.archivePath);
    const [rebuilt] = await buildPluginHostDrivers(
      root,
      TEST_BB_VERSION,
      await testToolchain(),
    );
    if (rebuilt === undefined) throw new Error("rebuilt driver result missing");
    expect(await readFile(rebuilt.archivePath)).toEqual(firstArchive);
  });

  it("keeps the previous complete host artifact set when a rebuild fails", async () => {
    await writeFile(
      join(root, "package.json"),
      packageJson([{ id: "echo", entry: "./echo-driver.ts" }]),
    );
    await writeFile(join(root, "echo-driver.ts"), 'console.error("FIRST");\n');
    const [first] = await buildPluginHostDrivers(
      root,
      TEST_BB_VERSION,
      await testToolchain(),
    );
    if (first === undefined) throw new Error("driver result missing");
    const before = await readFile(first.jsPath, "utf8");

    await writeFile(
      join(root, "echo-driver.ts"),
      "export function broken( {\n",
    );
    await expect(
      buildPluginHostDrivers(root, TEST_BB_VERSION, await testToolchain()),
    ).rejects.toThrow();

    expect(await readFile(first.jsPath, "utf8")).toBe(before);
  });
});
