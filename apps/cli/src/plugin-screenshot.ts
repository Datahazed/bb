import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  detectPluginSurfaces,
  planPluginCapture,
  type PluginCaptureStep,
} from "@bb/domain";

/** Directories that never hold the plugin's own frontend source. */
const SKIPPED = new Set(["node_modules", "dist", "types", ".git", "coverage"]);
const SOURCE = /\.tsx?$/;
const MAX_DEPTH = 4;

/**
 * Concatenate a plugin's frontend source. The detector only needs the text of
 * the slot registrations, so reading files beats building the plugin: a
 * submission screenshot has to work before `dist/` exists.
 */
export async function readPluginFrontendSource(rootDir: string): Promise<string> {
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
