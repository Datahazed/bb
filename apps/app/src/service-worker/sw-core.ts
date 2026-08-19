/**
 * The app service worker's behaviour, written against a small structural
 * subset of `ServiceWorkerGlobalScope` so it can run under vitest with a fake
 * scope. `sw.ts` is the thin production entry that binds it to `self`.
 *
 * Why this exists: a cold PWA launch on a phone (through bb connect) pays one
 * tunnel round trip for index.html and then ~40 asset fetches whenever iOS has
 * evicted the HTTP cache or the phone lands on a new edge colo. Precaching the
 * boot closure, the thread-route closure and the latin font in Cache Storage
 * turns that into one HTML round trip.
 *
 * Deliberate limits:
 *  - Navigations stay network-first. The precached shell is served only when
 *    the fetch itself fails, never on an HTTP error, so the connect sign-in
 *    gate and the connect offline page keep working unchanged.
 *  - Nothing under `/api`, `/ws`, `/internal`, `/__` or plugin assets is ever
 *    intercepted (see sw-routing.ts).
 *  - Every cache is namespaced by build id and dropped on activate of the next
 *    build, so `bb update` (which rotates every asset hash) cannot leave the
 *    worker serving a mixed build.
 */
import type { ServiceWorkerPrecacheManifest } from "./sw-manifest.js";
import {
  APP_SHELL_URL_PATH,
  classifyServiceWorkerRequest,
} from "./sw-routing.js";

/** Text that only the real app shell contains; a sign-in or offline page
 * proxied by connect never does, so a shell precache that lacks it is refused. */
export const APP_SHELL_MARKER = 'class="bb-app-shell"';

const CACHE_NAME_PREFIX = "bb-app-";

export function appShellCacheName(buildId: string): string {
  return `${CACHE_NAME_PREFIX}${buildId}`;
}

export interface ExtendableEventLike {
  waitUntil(promise: Promise<unknown>): void;
}

export interface FetchEventLike extends ExtendableEventLike {
  request: Request;
  respondWith(response: Response | Promise<Response>): void;
}

/** The parts of the Cache API the worker uses; `caches` satisfies it. */
export interface CacheLike {
  match(
    request: RequestInfo | URL,
    options?: CacheQueryOptions,
  ): Promise<Response | undefined>;
  put(request: RequestInfo | URL, response: Response): Promise<void>;
}

export interface CacheStorageLike {
  delete(cacheName: string): Promise<boolean>;
  keys(): Promise<string[]>;
  open(cacheName: string): Promise<CacheLike>;
}

export interface ServiceWorkerEventMapLike {
  activate: ExtendableEventLike;
  fetch: FetchEventLike;
  install: ExtendableEventLike;
}

export interface ServiceWorkerScopeLike {
  addEventListener<K extends keyof ServiceWorkerEventMapLike>(
    type: K,
    listener: (event: ServiceWorkerEventMapLike[K]) => void,
  ): void;
  caches: CacheStorageLike;
  clients: { claim(): Promise<void> };
  fetch(input: Request | string, init?: RequestInit): Promise<Response>;
  location: { origin: string };
  skipWaiting(): Promise<void>;
}

const MATCH_OPTIONS: CacheQueryOptions = { ignoreVary: true };

/**
 * A hashed asset response is worth caching only when it is a success that is
 * not an HTML document: a captive portal, or a proxy gate that answers every
 * path with a page, must never be stored under a chunk URL, because that entry
 * would then be served for the life of the build.
 */
export function isCacheableAssetResponse(response: Response): boolean {
  if (!response.ok || response.redirected) return false;
  const contentType = response.headers.get("content-type") ?? "";
  return !/^\s*text\/html\b/iu.test(contentType);
}

async function precacheAppShell(
  scope: ServiceWorkerScopeLike,
  cache: CacheLike,
): Promise<void> {
  // `no-store` on the request keeps a stale HTTP-cached copy out of the
  // precache; the server marks index.html uncacheable anyway.
  const response = await scope.fetch(APP_SHELL_URL_PATH, {
    cache: "no-store",
    credentials: "same-origin",
  });
  if (!response.ok) {
    throw new Error(`app shell precache failed: HTTP ${response.status}`);
  }
  const html = await response.clone().text();
  if (!html.includes(APP_SHELL_MARKER)) {
    throw new Error("app shell precache refused: response is not the app");
  }
  await cache.put(APP_SHELL_URL_PATH, response);
}

async function precacheAssets(
  scope: ServiceWorkerScopeLike,
  cache: CacheLike,
  assetUrls: string[],
): Promise<void> {
  // Assets are content-hashed and immutable, so the default cache mode lets
  // the browser reuse the bytes the page just downloaded instead of pulling
  // the whole boot closure through the tunnel a second time.
  await Promise.all(
    assetUrls.map(async (url) => {
      const response = await scope.fetch(url, { credentials: "same-origin" });
      if (!isCacheableAssetResponse(response)) {
        throw new Error(
          `asset precache failed: ${url} HTTP ${response.status} ${response.headers.get("content-type") ?? ""}`,
        );
      }
      await cache.put(url, response);
    }),
  );
}

async function deleteStaleCaches(
  scope: ServiceWorkerScopeLike,
  keep: string,
): Promise<void> {
  const names = await scope.caches.keys();
  await Promise.all(
    names
      .filter((name) => name.startsWith(CACHE_NAME_PREFIX) && name !== keep)
      .map((name) => scope.caches.delete(name)),
  );
}

async function respondToNavigation(
  scope: ServiceWorkerScopeLike,
  cacheName: string,
  request: Request,
): Promise<Response> {
  try {
    return await scope.fetch(request);
  } catch (error) {
    const cache = await scope.caches.open(cacheName);
    const shell = await cache.match(APP_SHELL_URL_PATH, MATCH_OPTIONS);
    if (shell !== undefined) return shell;
    throw error;
  }
}

async function respondToAsset(
  scope: ServiceWorkerScopeLike,
  cacheName: string,
  request: Request,
): Promise<Response> {
  const cache = await scope.caches.open(cacheName);
  const cached = await cache.match(request, MATCH_OPTIONS);
  if (cached !== undefined) return cached;
  const response = await scope.fetch(request);
  // A 404 here is a stale hash after `bb update`; the page's preload-error
  // handler reloads for it, and it must not be pinned in the cache.
  if (isCacheableAssetResponse(response)) {
    // Fire-and-forget: the response goes to the page first.
    void cache.put(request, response.clone()).catch(() => undefined);
  }
  return response;
}

export function installAppServiceWorker(
  scope: ServiceWorkerScopeLike,
  manifest: ServiceWorkerPrecacheManifest,
): void {
  const cacheName = appShellCacheName(manifest.buildId);
  const scopeOrigin = scope.location.origin;

  scope.addEventListener("install", (event) => {
    event.waitUntil(
      (async () => {
        const cache = await scope.caches.open(cacheName);
        await Promise.all([
          precacheAppShell(scope, cache),
          precacheAssets(scope, cache, manifest.assetUrls),
        ]);
        // A new build takes over immediately; the page's chunk-load-failure
        // handler covers the (already possible) window where an old page asks
        // for a hash the updated server no longer has.
        await scope.skipWaiting();
      })(),
    );
  });

  scope.addEventListener("activate", (event) => {
    event.waitUntil(
      (async () => {
        await deleteStaleCaches(scope, cacheName);
        await scope.clients.claim();
      })(),
    );
  });

  scope.addEventListener("fetch", (event) => {
    const requestClass = classifyServiceWorkerRequest({
      method: event.request.method,
      mode: event.request.mode,
      scopeOrigin,
      url: event.request.url,
    });
    if (requestClass === "navigation") {
      event.respondWith(respondToNavigation(scope, cacheName, event.request));
    } else if (requestClass === "asset") {
      event.respondWith(respondToAsset(scope, cacheName, event.request));
    }
    // passthrough: no respondWith, the browser fetches as if no worker ran.
  });
}
