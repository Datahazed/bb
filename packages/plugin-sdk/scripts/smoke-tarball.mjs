import { spawn } from "node:child_process";
import { strict as assert } from "node:assert";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptsDir, "..");
const repositoryRoot = resolve(packageRoot, "../..");
const tempRoot = await mkdtemp(join(tmpdir(), "bb-plugin-sdk-tarball-"));
const packDir = join(tempRoot, "pack");
const consumerDir = join(tempRoot, "consumer");
const releaseDir = join(repositoryRoot, ".tmp", "plugin-sdk-release");
const releaseTarball = join(releaseDir, "bb-plugin-sdk.tgz");

function collectProcessOutput(childProcess) {
  const output = { stderr: "", stdout: "" };
  childProcess.stdout?.on("data", (chunk) => {
    output.stdout += chunk.toString("utf8");
  });
  childProcess.stderr?.on("data", (chunk) => {
    output.stderr += chunk.toString("utf8");
  });
  return output;
}

function waitForProcessExit(childProcess) {
  return new Promise((resolvePromise) => {
    childProcess.once("exit", (code, signal) => {
      resolvePromise({ code, signal });
    });
  });
}

async function runCommand({ args, command, cwd, label }) {
  const childProcess = spawn(command, args, {
    cwd,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = collectProcessOutput(childProcess);
  const result = await waitForProcessExit(childProcess);
  if (result.code !== 0) {
    throw new Error(
      `${label} failed with ${result.code ?? result.signal}\n` +
        `stdout:\n${output.stdout}\n\nstderr:\n${output.stderr}`,
    );
  }
  return output.stdout;
}

function assertNoWorkspaceDependencies(manifest) {
  for (const field of [
    "dependencies",
    "optionalDependencies",
    "peerDependencies",
  ]) {
    const serialized = JSON.stringify(manifest[field] ?? {});
    assert(!serialized.includes("workspace:"), `${field} contains workspace:`);
  }
}

const backendTest = `
import { describe, expect, it } from "vitest";
import { createFakePluginHost } from "@bb/plugin-sdk/testing";

describe("packed backend harness", () => {
  it("runs every external backend dependency from a clean install", async () => {
    const host = createFakePluginHost({ pluginId: "packed-smoke" });
    const db = host.bb.storage.database();
    host.bb.storage.migrate(db, [
      "CREATE TABLE checks (value TEXT NOT NULL)",
    ]);
    db.prepare("INSERT INTO checks (value) VALUES (?)").run("sqlite");
    expect(db.prepare("SELECT value FROM checks").get()).toEqual({
      value: "sqlite",
    });

    let scheduleRuns = 0;
    host.bb.background.schedule("sync", "*/5 * * * *", () => {
      scheduleRuns += 1;
    });
    await host.harness.runSchedule("sync");
    expect(scheduleRuns).toBe(1);

    host.bb.http.route(
      "GET",
      "/health",
      (context) => context.json({ ok: true }),
      { auth: "none" },
    );
    const response = await host.harness.fetchHttp("GET", "/health");
    expect(await response.json()).toEqual({ ok: true });
    await host.harness.lifecycle.dispose();
  });
});
`;

const appModule = `
import React from "react";
import { definePluginApp } from "@bb/plugin-sdk/app";

function PackedPanel() {
  return React.createElement("p", null, "packed app works");
}

export default definePluginApp((app) => {
  app.slots.homepageSection({
    id: "packed-smoke",
    title: "Packed smoke",
    component: PackedPanel,
  });
});
`;

const frontendTest = `
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@bb/plugin-sdk/testing/app";

describe("packed frontend harness", () => {
  it("loads and renders an app from a clean install", async () => {
    const app = await loadPluginApp(() => import("./app.mjs"));
    const slot = renderSlot(
      app.homepageSections[0],
      { projectId: "proj_smoke" },
      {
        context: { projectId: "proj_smoke", threadId: null },
        rpc: {},
      },
    );
    expect(slot.getByText("packed app works")).toBeTruthy();
    slot.lifecycle.unmount();
  });
});
`;

try {
  await mkdir(packDir, { recursive: true });
  await mkdir(consumerDir, { recursive: true });
  await rm(releaseDir, { recursive: true, force: true });

  const packJson = await runCommand({
    args: ["pack", "--json", "--pack-destination", packDir],
    command: "npm",
    cwd: packageRoot,
    label: "npm pack",
  });
  const packJsonMatch = packJson.match(/(?:^|\n)(\[\s*\{[\s\S]*\}\s*\])\s*$/u);
  assert(packJsonMatch, "npm pack did not return a JSON result");
  const packResults = JSON.parse(packJsonMatch[1]);
  assert.equal(packResults.length, 1, "npm pack must produce one tarball");
  const packResult = packResults[0];
  const tarball = join(packDir, packResult.filename);
  const packedFiles = new Set(packResult.files.map((file) => file.path));
  assert(packedFiles.has("package.json"), "tarball is missing package.json");
  assert(packedFiles.has("README.md"), "tarball is missing README.md");
  assert(
    ![...packedFiles].some(
      (path) => path.startsWith("src/") || path.startsWith("scripts/"),
    ),
    "tarball contains source or release scripts",
  );

  const sourceManifest = JSON.parse(
    await readFile(join(packageRoot, "package.json"), "utf8"),
  );
  assert.equal(sourceManifest.publishConfig?.access, "public");
  assert.deepEqual(sourceManifest.dependencies, {
    "cron-parser": "^5.5.0",
    hono: "^4.11.9",
  });
  assertNoWorkspaceDependencies(sourceManifest);
  for (const entry of Object.values(sourceManifest.exports)) {
    for (const condition of ["import", "types"]) {
      const path = entry[condition].replace(/^\.\//u, "");
      assert(packedFiles.has(path), `tarball is missing export target ${path}`);
    }
  }

  await writeFile(
    join(consumerDir, "package.json"),
    `${JSON.stringify({ name: "plugin-sdk-smoke", private: true, type: "module" }, null, 2)}\n`,
  );
  await runCommand({
    args: [
      "install",
      "--save-dev",
      "--no-audit",
      "--no-fund",
      tarball,
      "vitest",
      "better-sqlite3",
      "zod",
      "@types/better-sqlite3",
    ],
    command: "npm",
    cwd: consumerDir,
    label: "documented backend install",
  });
  await runCommand({
    args: [
      "install",
      "--save-dev",
      "--no-audit",
      "--no-fund",
      "react",
      "react-dom",
      "@testing-library/react",
      "jsdom",
      "@types/react",
    ],
    command: "npm",
    cwd: consumerDir,
    label: "documented frontend install",
  });

  const installedManifest = JSON.parse(
    await readFile(
      join(consumerDir, "node_modules", "@bb", "plugin-sdk", "package.json"),
      "utf8",
    ),
  );
  assert.equal(installedManifest.version, sourceManifest.version);
  assert.deepEqual(installedManifest.dependencies, sourceManifest.dependencies);
  assertNoWorkspaceDependencies(installedManifest);

  await writeFile(join(consumerDir, "backend-smoke.test.mjs"), backendTest);
  await writeFile(join(consumerDir, "app.mjs"), appModule);
  await writeFile(join(consumerDir, "frontend-smoke.test.mjs"), frontendTest);
  await runCommand({
    args: [
      join(consumerDir, "node_modules", "vitest", "vitest.mjs"),
      "run",
      "backend-smoke.test.mjs",
      "frontend-smoke.test.mjs",
    ],
    command: process.execPath,
    cwd: consumerDir,
    label: "packed consumer tests",
  });

  await mkdir(releaseDir, { recursive: true });
  await copyFile(tarball, releaseTarball);
  console.log(`Validated release tarball: ${releaseTarball}`);
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
