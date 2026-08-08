import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

const appDir = dirname(fileURLToPath(import.meta.url));

export interface BundleBootChunk {
  fileName: string;
  bytes: number;
  /** npm package names whose code landed in this chunk. */
  packages: string[];
}

export interface BundleStats {
  entry: string;
  bootChunks: BundleBootChunk[];
  workspaceRouteEntry: string;
  workspaceRouteChunks: BundleBootChunk[];
  workspaceCheckoutDisplayChunk: BundleBootChunk;
}

/**
 * Writes `bundle-stats.json` describing the boot payload: the entry chunk and
 * its static-import closure, with the npm packages each one contains.
 *
 * scripts/check-bundle-budget.mjs reads this instead of pattern-matching
 * minified output, so the budget check knows exactly which packages block
 * first paint.
 */
export function bundleStats(): Plugin {
  return {
    name: "bb:bundle-stats",
    apply: "build",
    async writeBundle(_options, bundle) {
      const entry = Object.values(bundle).find(
        (output) => output.type === "chunk" && output.isEntry,
      );
      if (entry === undefined || entry.type !== "chunk") return;

      const collectStaticChunkClosure = (rootFileName: string): Set<string> => {
        const fileNames = new Set<string>();
        const walk = (fileName: string): void => {
          if (fileNames.has(fileName)) return;
          fileNames.add(fileName);
          const chunk = bundle[fileName];
          if (chunk === undefined || chunk.type !== "chunk") return;
          for (const imported of chunk.imports) walk(imported);
        };
        walk(rootFileName);
        return fileNames;
      };

      const describeChunks = (fileNames: Set<string>): BundleBootChunk[] => {
        const chunks: BundleBootChunk[] = [];
        for (const fileName of [...fileNames].sort()) {
          const chunk = bundle[fileName];
          if (chunk === undefined || chunk.type !== "chunk") continue;
          const packages = new Set<string>();
          for (const moduleId of chunk.moduleIds ?? []) {
            const name = packageNameOf(moduleId);
            if (name !== null) packages.add(name);
          }
          chunks.push({
            fileName,
            bytes: Buffer.byteLength(chunk.code),
            packages: [...packages].sort(),
          });
        }
        return chunks;
      };

      const bootChunks = describeChunks(
        collectStaticChunkClosure(entry.fileName),
      );
      const workspaceRouteEntry = Object.values(bundle).find(
        (output) =>
          output.type === "chunk" &&
          output.facadeModuleId
            ?.replaceAll("\\", "/")
            .endsWith("/src/views/SplitWorkspaceRoute.tsx"),
      );
      if (
        workspaceRouteEntry === undefined ||
        workspaceRouteEntry.type !== "chunk"
      ) {
        this.error("Could not find the SplitWorkspaceRoute build entry");
      }
      const workspaceRouteChunks = describeChunks(
        collectStaticChunkClosure(workspaceRouteEntry.fileName),
      );
      const workspaceCheckoutDisplayOutput = Object.values(bundle).find(
        (output) =>
          output.type === "chunk" &&
          output.moduleIds.some((moduleId) =>
            moduleId
              .replaceAll("\\", "/")
              .endsWith("/src/lib/workspace-checkout-display.ts"),
          ),
      );
      if (
        workspaceCheckoutDisplayOutput === undefined ||
        workspaceCheckoutDisplayOutput.type !== "chunk"
      ) {
        this.error("Could not find the workspace checkout display chunk");
      }
      const workspaceCheckoutDisplayChunk = describeChunks(
        new Set([workspaceCheckoutDisplayOutput.fileName]),
      )[0];
      if (workspaceCheckoutDisplayChunk === undefined) {
        this.error("Could not describe the workspace checkout display chunk");
      }

      const stats: BundleStats = {
        entry: entry.fileName,
        bootChunks,
        workspaceRouteEntry: workspaceRouteEntry.fileName,
        workspaceRouteChunks,
        workspaceCheckoutDisplayChunk,
      };
      const target = resolve(appDir, "bundle-stats.json");
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, `${JSON.stringify(stats, null, 2)}\n`);
    },
  };
}

/** `.../node_modules/@scope/name/dist/x.js` -> `@scope/name`; app code -> null. */
function packageNameOf(moduleId: string): string | null {
  const marker = moduleId.lastIndexOf("node_modules/");
  if (marker < 0) return null;
  const segments = moduleId.slice(marker + "node_modules/".length).split("/");
  const [first, second] = segments;
  if (first === undefined) return null;
  if (first.startsWith("@"))
    return second === undefined ? null : `${first}/${second}`;
  return first;
}
