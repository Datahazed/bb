import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

const appDir = dirname(fileURLToPath(import.meta.url));

/**
 * Lazy routes whose own payload is worth guarding, keyed by the module the
 * route's `lazy(() => import(...))` points at.
 *
 * The thread page is here because it is the page bb opens most, and because a
 * single barrel import is enough to drag the diff renderer, Shiki or KaTeX
 * back onto it — a regression the boot budget cannot see, since none of that
 * code is on the boot path.
 */
const TRACKED_ROUTES = [
  { name: "thread", moduleSuffix: "src/views/SplitWorkspaceRoute.tsx" },
] as const;

export interface BundleBootChunk {
  fileName: string;
  bytes: number;
  /** npm package names whose code landed in this chunk. */
  packages: string[];
}

export interface BundleRoute {
  name: string;
  entry: string;
  /** The route chunk and its static-import closure, boot chunks included. */
  chunks: BundleBootChunk[];
}

export interface BundleStats {
  entry: string;
  bootChunks: BundleBootChunk[];
  routes: BundleRoute[];
}

/**
 * Writes `bundle-stats.json` describing the boot payload: the entry chunk and
 * its static-import closure, with the npm packages each one contains. It also
 * describes the same closure for each route in {@link TRACKED_ROUTES}.
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

      const routes: BundleRoute[] = [];
      for (const route of TRACKED_ROUTES) {
        const routeChunk = Object.values(bundle).find(
          (output) =>
            output.type === "chunk" &&
            output.facadeModuleId?.endsWith(route.moduleSuffix) === true,
        );
        if (routeChunk === undefined || routeChunk.type !== "chunk") continue;
        routes.push({
          name: route.name,
          entry: routeChunk.fileName,
          chunks: collectClosure(bundle, routeChunk.fileName),
        });
      }

      const stats: BundleStats = {
        entry: entry.fileName,
        bootChunks: collectClosure(bundle, entry.fileName),
        routes,
      };
      const target = resolve(appDir, "bundle-stats.json");
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, `${JSON.stringify(stats, null, 2)}\n`);
    },
  };
}

type OutputBundle = Parameters<
  Extract<NonNullable<Plugin["writeBundle"]>, (...args: never[]) => unknown>
>[1];

/** A chunk plus everything it can reach without crossing a dynamic import. */
function collectClosure(
  bundle: OutputBundle,
  rootFileName: string,
): BundleBootChunk[] {
  const fileNames = new Set<string>();
  const walk = (fileName: string): void => {
    if (fileNames.has(fileName)) return;
    fileNames.add(fileName);
    const chunk = bundle[fileName];
    if (chunk === undefined || chunk.type !== "chunk") return;
    for (const imported of chunk.imports) walk(imported);
  };
  walk(rootFileName);

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
}

/** `.../node_modules/@scope/name/dist/x.js` -> `@scope/name`; app code -> null. */
function packageNameOf(moduleId: string): string | null {
  const marker = moduleId.lastIndexOf("node_modules/");
  if (marker < 0) return null;
  const segments = moduleId.slice(marker + "node_modules/".length).split("/");
  const [first, second] = segments;
  if (first === undefined) return null;
  if (first.startsWith("@")) return second === undefined ? null : `${first}/${second}`;
  return first;
}
