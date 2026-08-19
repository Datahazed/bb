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
