import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build, type Plugin } from "vite";
import {
  APP_SHELL_MARKER,
  type ServiceWorkerPrecacheManifest,
} from "./src/service-worker/sw-manifest.js";

const appDir = dirname(fileURLToPath(import.meta.url));

/**
 * The structural subset of Vite's `OutputBundle` the manifest builder reads.
 * Declared locally so tests can hand in small literal bundles.
 */
export interface ManifestBundleChunk {
  type: "chunk";
  fileName: string;
  isEntry: boolean;
  facadeModuleId: string | null;
  imports: string[];
  dynamicImports: string[];
  viteMetadata?: { importedCss: Set<string> } | undefined;
}

export interface ManifestBundleAsset {
  type: "asset";
  fileName: string;
}

export type ManifestBundle = Record<
  string,
  ManifestBundleChunk | ManifestBundleAsset
>;

export interface BuildPrecacheManifestOptions {
  /**
   * Absolute module ids of lazily imported route modules whose static-import
   * closure joins the precache (the thread route). Other `lazy()` views stay
   * on demand and are cached at runtime the first time they load.
   */
  routeModuleIds: string[];
  /** Emitted assets (not chunks) to precache, matched by output file name. */
  assetFileNamePatterns: RegExp[];
  /** Built `index.html` text; folded into the build id so a shell-only change
   * still rolls the worker. */
  indexHtml: string;
}

function stripQuery(moduleId: string): string {
  const queryStart = moduleId.indexOf("?");
  return queryStart === -1 ? moduleId : moduleId.slice(0, queryStart);
}

/**
 * Precache = the entry chunk's static-import closure (the boot payload the
 * page modulepreloads anyway) + the static closure of each configured route
 * module + the CSS those chunks import + explicitly listed assets.
 */
export function buildServiceWorkerPrecacheManifest(
  bundle: ManifestBundle,
  options: BuildPrecacheManifestOptions,
): ServiceWorkerPrecacheManifest {
  if (!options.indexHtml.includes(APP_SHELL_MARKER)) {
    // The worker only installs a shell that carries this marker; a build
    // whose index.html lost it would ship a worker that silently never
    // installs. Fail loudly here instead.
    throw new Error(
      `service worker precache: index.html does not contain ${APP_SHELL_MARKER}`,
    );
  }
  const chunks = Object.values(bundle).filter(
    (output): output is ManifestBundleChunk => output.type === "chunk",
  );
  const entry = chunks.find((chunk) => chunk.isEntry);
  if (entry === undefined) {
    throw new Error("service worker precache: bundle has no entry chunk");
  }
  const byFileName = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));

  const roots = [entry];
  const wantedRouteIds = new Set(options.routeModuleIds.map(stripQuery));
  for (const chunk of chunks) {
    if (chunk.facadeModuleId === null) continue;
    if (wantedRouteIds.delete(stripQuery(chunk.facadeModuleId))) {
      roots.push(chunk);
    }
  }
  if (wantedRouteIds.size > 0) {
    throw new Error(
      `service worker precache: no chunk for route module(s) ${[...wantedRouteIds].join(", ")}`,
    );
  }

  const files = new Set<string>();
  const walk = (chunk: ManifestBundleChunk): void => {
    if (files.has(chunk.fileName)) return;
    files.add(chunk.fileName);
    for (const css of chunk.viteMetadata?.importedCss ?? []) files.add(css);
    for (const imported of chunk.imports) {
      const next = byFileName.get(imported);
      if (next !== undefined) walk(next);
    }
  };
  for (const root of roots) walk(root);

  for (const output of Object.values(bundle)) {
    if (output.type !== "asset") continue;
    if (
      options.assetFileNamePatterns.some((pattern) =>
        pattern.test(output.fileName),
      )
    ) {
      files.add(output.fileName);
    }
  }

  const assetUrls = [...files].sort().map((fileName) => `/${fileName}`);
  const buildId = createHash("sha256")
    .update(JSON.stringify(assetUrls))
    .update("\0")
    .update(options.indexHtml)
    .digest("hex")
    .slice(0, 16);
  return { buildId, assetUrls };
}

export interface ServiceWorkerPluginOptions {
  routeModuleIds: string[];
  assetFileNamePatterns: RegExp[];
}

/**
 * Builds `dist/sw.js` after the app bundle is written: computes the precache
 * manifest from the bundle graph, then compiles src/service-worker/sw.ts as a
 * single classic script with the manifest inlined. Runs `enforce: "post"` so
 * the html plugin has already emitted the final index.html.
 */
export function serviceWorker(options: ServiceWorkerPluginOptions): Plugin {
  return {
    name: "bb:service-worker",
    apply: "build",
    enforce: "post",
    async writeBundle(outputOptions, bundle) {
      const hasEntry = Object.values(bundle).some(
        (output) => output.type === "chunk" && output.isEntry,
      );
      if (!hasEntry) return;
      const outDir = outputOptions.dir ?? resolve(appDir, "dist");
      const indexHtml = await readFile(resolve(outDir, "index.html"), "utf8");
      const manifest = buildServiceWorkerPrecacheManifest(bundle, {
        assetFileNamePatterns: options.assetFileNamePatterns,
        indexHtml,
        routeModuleIds: options.routeModuleIds,
      });
      await build({
        configFile: false,
        envFile: false,
        logLevel: "warn",
        publicDir: false,
        root: appDir,
        define: { __BB_SW_MANIFEST__: JSON.stringify(manifest) },
        build: {
          copyPublicDir: false,
          emptyOutDir: false,
          lib: {
            entry: resolve(appDir, "src/service-worker/sw.ts"),
            fileName: () => "sw.js",
            formats: ["iife"],
            name: "bbServiceWorker",
          },
          outDir,
          reportCompressedSize: false,
          sourcemap: false,
        },
      });
    },
  };
}
