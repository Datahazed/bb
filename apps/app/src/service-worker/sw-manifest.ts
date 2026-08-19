/**
 * Contract between the build (vite-service-worker.ts computes it from the
 * bundle graph and inlines it as `__BB_SW_MANIFEST__`) and the worker
 * (sw-core.ts precaches it). Kept import-free so both tsconfig projects can
 * list it.
 */
export interface ServiceWorkerPrecacheManifest {
  /** Stable hash of the precache list + shell html; namespaces one build's caches. */
  buildId: string;
  /** Root-relative URLs of the immutable assets to precache (`/assets/...`). */
  assetUrls: string[];
}

/**
 * Text that only the real app shell contains (the `<body>` class in
 * apps/app/index.html). The build refuses to emit a worker whose shell lacks
 * it, and the worker refuses to precache a shell response without it, so a
 * connect sign-in or offline page proxied at the app URL is never installed
 * as the offline fallback.
 */
export const APP_SHELL_MARKER = 'class="bb-app-shell"';
