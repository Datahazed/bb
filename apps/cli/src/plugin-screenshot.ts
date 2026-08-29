import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  detectPluginSurfaces,
  planPluginCapture,
  PLUGIN_CAPTURE_SURFACES,
  type PluginCaptureStep,
} from "@bb/domain";

const SKIPPED = new Set(["node_modules", "dist", "types", ".git", "coverage"]);
const SOURCE = /\.tsx?$/;
const MAX_DEPTH = 4;

export function resolvePluginCaptureHarnessPath(moduleDir: string): string {
  return resolve(moduleDir, "../../../desktop/scripts/plugin-capture.cjs");
}

export async function readPluginFrontendSource(
  rootDir: string,
): Promise<string> {
  const parts: string[] = [];
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > MAX_DEPTH) return;
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (SKIPPED.has(entry)) continue;
      const path = join(dir, entry);
      const info = await stat(path).catch(() => null);
      if (info === null) continue;
      if (info.isDirectory()) {
        await walk(path, depth + 1);
      } else if (SOURCE.test(entry) && !entry.endsWith(".d.ts")) {
        parts.push(await readFile(path, "utf8"));
      }
    }
  };
  await walk(rootDir, 0);
  return parts.join("\n");
}

export interface PluginCapturePlanResult {
  readonly pluginId: string;
  readonly slots: string[];
  readonly steps: PluginCaptureStep[];
  readonly needsFixture: string[];
}

export async function planPluginScreenshots(args: {
  rootDir: string;
  pluginId: string;
  fixtureThreadId?: string;
}): Promise<PluginCapturePlanResult> {
  const source = await readPluginFrontendSource(args.rootDir);
  const found = detectPluginSurfaces(source);
  const steps = planPluginCapture({
    pluginId: args.pluginId,
    slots: found.slots,
    panelPaths: found.panelPaths,
    ...(args.fixtureThreadId === undefined
      ? {}
      : { fixtureThreadId: args.fixtureThreadId }),
  });
  const planned = new Set(steps.map((step) => step.slot));
  return {
    pluginId: args.pluginId,
    slots: found.slots,
    steps,
    needsFixture: found.slots.filter((slot) => !planned.has(slot)),
  };
}

export interface CaptureRunResult {
  readonly pluginId: string;
  readonly written: ReadonlyArray<{ slot: string; url: string; file: string }>;
}

export function resolveElectronBinary(
  env: NodeJS.ProcessEnv,
  harnessPath: string,
): string | null {
  if (env["BB_ELECTRON"] !== undefined && env["BB_ELECTRON"] !== "") {
    return env["BB_ELECTRON"];
  }
  try {
    const requireFromHarness = createRequire(harnessPath);
    const resolved: unknown = requireFromHarness("electron");
    return typeof resolved === "string" ? resolved : null;
  } catch {
    return null;
  }
}

export async function runPluginCapture(args: {
  appUrl: string;
  pluginId: string;
  outDir: string;
  harnessPath: string;
  electronBinary: string;
  fixtureThreadId?: string;
}): Promise<CaptureRunResult> {
  const planDir = await mkdtemp(join(tmpdir(), "bb-plugin-capture-"));
  const planPath = join(planDir, "plan.json");
  await writeFile(
    planPath,
    JSON.stringify({
      appUrl: args.appUrl,
      pluginId: args.pluginId,
      outDir: args.outDir,
      surfaces: PLUGIN_CAPTURE_SURFACES,
      ...(args.fixtureThreadId === undefined
        ? {}
        : { fixtureThreadId: args.fixtureThreadId }),
    }),
  );
  return await new Promise<CaptureRunResult>((resolvePromise, reject) => {
    const child = spawn(args.electronBinary, [args.harnessPath, planPath], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk: Buffer) => (out += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (err += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`capture harness exited ${code}: ${err.trim()}`));
        return;
      }
      try {
        resolvePromise(JSON.parse(out) as CaptureRunResult);
      } catch {
        reject(new Error(`capture harness wrote no report: ${out.trim()}`));
      }
    });
  });
}
