/**
 * Request classification for the app service worker. Pure so the strategy
 * table can be unit-tested without a service-worker global.
 *
 * Only two request classes are handled by the worker:
 *  - `navigation`: a top-level document load for an app route. Network-first
 *    so the connect sign-in gate, the connect offline page and a freshly
 *    updated index.html always win; the precached shell is served only when
 *    the network itself fails.
 *  - `asset`: an immutable content-hashed file under `/assets/`. Cache-first
 *    from the precache (boot + thread route closure + latin font) with an
 *    on-demand runtime cache for lazily loaded chunks.
 *
 * Everything else — `/api`, `/ws`, host daemon `/internal`, plugin assets
 * (`/api/v1/plugins/*`), the connect `/__*` namespace, the install script,
 * root PWA files, the worker script itself and every non-GET or cross-origin
 * request — is `passthrough`: the worker does not call `respondWith`, so the
 * request behaves exactly as if no worker were installed.
 */
export type ServiceWorkerRequestClass = "navigation" | "asset" | "passthrough";

export const APP_SHELL_URL_PATH = "/index.html";
export const SERVICE_WORKER_URL_PATH = "/sw.js";
export const IMMUTABLE_ASSET_URL_PREFIX = "/assets/";

/**
 * Navigations to these prefixes are never answered from the shell: they are
 * API/tunnel/host endpoints or connect-owned pages, not client routes.
 */
const NON_APP_NAVIGATION_PREFIXES = [
  "/api/",
  "/ws",
  "/internal",
  "/__",
  "/install",
] as const;

export interface ClassifyRequestArgs {
  method: string;
  mode: string;
  /** Origin of the worker's own scope, e.g. `https://bee.getbb.app`. */
  scopeOrigin: string;
  url: string;
}

export function isNonAppNavigationPath(pathname: string): boolean {
  if (pathname === "/api") return true;
  return NON_APP_NAVIGATION_PREFIXES.some((prefix) =>
    pathname.startsWith(prefix),
  );
}

export function classifyServiceWorkerRequest(
  args: ClassifyRequestArgs,
): ServiceWorkerRequestClass {
  if (args.method !== "GET") return "passthrough";
  let url: URL;
  try {
    url = new URL(args.url);
  } catch {
    return "passthrough";
  }
  if (url.origin !== args.scopeOrigin) return "passthrough";
  if (args.mode === "navigate") {
    return isNonAppNavigationPath(url.pathname) ? "passthrough" : "navigation";
  }
  if (
    url.pathname.startsWith(IMMUTABLE_ASSET_URL_PREFIX) &&
    url.pathname.length > IMMUTABLE_ASSET_URL_PREFIX.length
  ) {
    return "asset";
  }
  return "passthrough";
}
