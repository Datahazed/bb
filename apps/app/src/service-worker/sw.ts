/**
 * Production entry of the app service worker. Built by vite-service-worker.ts
 * as a single classic script at `/sw.js`; the precache manifest is injected as
 * the `__BB_SW_MANIFEST__` constant at build time. Registered from main.tsx via
 * lib/service-worker-registration.ts.
 */
import {
  installAppServiceWorker,
  type ServiceWorkerScopeLike,
} from "./sw-core.js";
import type { ServiceWorkerPrecacheManifest } from "./sw-manifest.js";

declare const __BB_SW_MANIFEST__: ServiceWorkerPrecacheManifest;
// Module-scoped shadow of the DOM `self`: this file runs in a worker global,
// which the app tsconfig (DOM lib) has no declaration for.
declare const self: ServiceWorkerScopeLike;

installAppServiceWorker(self, __BB_SW_MANIFEST__);
