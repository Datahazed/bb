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

/** Directories that never hold the plugin's own frontend source. */
const SKIPPED = new Set(["node_modules", "dist", "types", ".git", "coverage"]);
const SOURCE = /\.tsx?$/;
const MAX_DEPTH = 4;

export function resolvePluginCaptureHarnessPath(moduleDir: string): string {
  return resolve(moduleDir, "../../../desktop/scripts/plugin-capture.cjs");
}

/**
 * Concatenate a plugin's frontend source. The detector only needs the text of
 * the slot registrations, so reading files beats building the plugin: a
 * submission screenshot has to work before `dist/` exists.
 */
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
  /** Surfaces found that a shot needs the shared fixture to reach. */
  readonly needsFixture: string[];
}

/**
 * Work out what a listing for this plugin can show.
 *
 * `fixtureThreadId` is what the shared capture fixture seeds. Without it the
 * fixture-only surfaces are reported through `needsFixture` rather than
 * planned, so the caller can say what a screenshot would still need instead of
 * silently photographing an empty app.
 */
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

/**
 * Where the desktop package's Electron lives. In a checkout that is the
 * workspace dependency; a packaged CLI can point BB_ELECTRON at any Electron.
 */
export function resolveElectronBinary(
  env: NodeJS.ProcessEnv,
  harnessPath: string,
): string | null {
  if (env["BB_ELECTRON"] !== undefined && env["BB_ELECTRON"] !== "") {
    return env["BB_ELECTRON"];
  }
  try {
    // Resolve from beside the harness: Electron is the desktop package's
    // dependency, not the CLI's, and requiring "electron" under plain node
    // returns the binary path.
    const requireFromHarness = createRequire(harnessPath);
    const resolved: unknown = requireFromHarness("electron");
    return typeof resolved === "string" ? resolved : null;
  } catch {
    return null;
  }
}

/**
 * Drive the capture harness against the author's running bb. Which surfaces
 * the plugin registered is read from the live app in the harness itself —
 * the plan here only supplies the catalog (routes and file stems).
 */
export async function runPluginCapture(args: {
  /** Origin serving the app shell — the server for a packaged bb, Vite's port for a source dev instance. */
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
