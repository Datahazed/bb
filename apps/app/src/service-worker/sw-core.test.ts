import { describe, expect, it } from "vitest";
import {
  APP_SHELL_MARKER,
  appShellCacheName,
  installAppServiceWorker,
  type CacheLike,
  type CacheStorageLike,
  type ServiceWorkerEventMapLike,
  type ServiceWorkerScopeLike,
} from "./sw-core.js";

const ORIGIN = "https://bee.getbb.app";
const SHELL_HTML = `<!doctype html><html><body ${APP_SHELL_MARKER}><div id="root"></div></body></html>`;
const SIGN_IN_HTML =
  "<!doctype html><html><body><h1>Sign in to bb</h1></body></html>";

function keyOf(request: RequestInfo | URL): string {
  if (typeof request === "string") return new URL(request, ORIGIN).href;
  if (request instanceof URL) return request.href;
  return request.url;
}

class FakeCache implements CacheLike {
  readonly entries = new Map<string, Response>();
  async match(request: RequestInfo | URL): Promise<Response | undefined> {
    return this.entries.get(keyOf(request))?.clone();
  }
  async put(request: RequestInfo | URL, response: Response): Promise<void> {
    this.entries.set(keyOf(request), response);
  }
}

class FakeCacheStorage implements CacheStorageLike {
  readonly caches = new Map<string, FakeCache>();
  async delete(cacheName: string): Promise<boolean> {
    return this.caches.delete(cacheName);
  }
  async keys(): Promise<string[]> {
    return [...this.caches.keys()];
  }
  async open(cacheName: string): Promise<CacheLike> {
    let cache = this.caches.get(cacheName);
    if (cache === undefined) {
      cache = new FakeCache();
      this.caches.set(cacheName, cache);
    }
    return cache;
  }
}

type FetchImpl = (
  input: Request | string,
  init?: RequestInit,
) => Promise<Response>;

interface Harness {
  scope: ServiceWorkerScopeLike;
  cacheStorage: FakeCacheStorage;
  fetchLog: string[];
  skipWaitingCalls: number;
  claimCalls: number;
  dispatchInstall(): Promise<void>;
  dispatchActivate(): Promise<void>;
  /** Returns the worker's response, or `null` when it did not call respondWith. */
  dispatchFetch(request: Request): Promise<Response | null>;
}

function createHarness(fetchImpl: FetchImpl): Harness {
  const listeners: {
    [K in keyof ServiceWorkerEventMapLike]: Array<
      (event: ServiceWorkerEventMapLike[K]) => void
    >;
  } = { activate: [], fetch: [], install: [] };
  const cacheStorage = new FakeCacheStorage();
  const fetchLog: string[] = [];
  const harness: Harness = {
    cacheStorage,
    claimCalls: 0,
    fetchLog,
    skipWaitingCalls: 0,
    scope: {
      addEventListener(type, listener) {
        listeners[type].push(listener);
      },
      caches: cacheStorage,
      clients: {
        claim: async () => {
          harness.claimCalls += 1;
        },
      },
      fetch: (input, init) => {
        fetchLog.push(typeof input === "string" ? input : input.url);
        return fetchImpl(input, init);
      },
      location: { origin: ORIGIN },
      skipWaiting: async () => {
        harness.skipWaitingCalls += 1;
      },
    },
    async dispatchInstall() {
      const pending: Promise<unknown>[] = [];
      for (const listener of listeners.install) {
        listener({ waitUntil: (promise) => pending.push(promise) });
      }
      await Promise.all(pending);
    },
    async dispatchActivate() {
      const pending: Promise<unknown>[] = [];
      for (const listener of listeners.activate) {
        listener({ waitUntil: (promise) => pending.push(promise) });
      }
      await Promise.all(pending);
    },
    async dispatchFetch(request) {
      let responded: Promise<Response> | null = null;
      for (const listener of listeners.fetch) {
        listener({
          request,
          respondWith: (response) => {
            responded = Promise.resolve(response);
          },
          waitUntil: () => undefined,
        });
      }
      return responded === null ? null : await responded;
    },
  };
  return harness;
}

function navigationRequest(url: string): Request {
  // `new Request(..., { mode: "navigate" })` is not constructible per spec;
  // shadow the accessor on the instance the way the browser reports it.
  const request = new Request(url);
  Object.defineProperty(request, "mode", { value: "navigate" });
  return request;
}

const MANIFEST = {
  assetUrls: ["/assets/index-AAA.js", "/assets/inter-latin-BBB.woff2"],
  buildId: "build0000000001",
};

function okServer(overrides: Record<string, () => Response> = {}): FetchImpl {
  return async (input) => {
    const url = new URL(typeof input === "string" ? input : input.url, ORIGIN);
    const override = overrides[url.pathname];
    if (override !== undefined) return override();
    if (url.pathname === "/index.html") {
      return new Response(SHELL_HTML, {
        headers: { "content-type": "text/html" },
      });
    }
    if (url.pathname.startsWith("/assets/")) {
      return new Response(`asset ${url.pathname}`, {
        headers: { "content-type": "application/javascript" },
      });
    }
    return new Response("not found", { status: 404 });
  };
}

describe("app service worker", () => {
  it("precaches the shell and the manifest assets on install, then takes over", async () => {
    const harness = createHarness(okServer());
    installAppServiceWorker(harness.scope, MANIFEST);
    await harness.dispatchInstall();

    const cache = harness.cacheStorage.caches.get(
      appShellCacheName(MANIFEST.buildId),
    );
    expect(cache).toBeDefined();
    expect([...(cache?.entries.keys() ?? [])].sort()).toEqual([
      `${ORIGIN}/assets/index-AAA.js`,
      `${ORIGIN}/assets/inter-latin-BBB.woff2`,
      `${ORIGIN}/index.html`,
    ]);
    expect(harness.skipWaitingCalls).toBe(1);
  });

  it("refuses to install when the shell fetch returns something other than the app", async () => {
    // Through bb connect an expired session answers /index.html with the
    // sign-in page (HTTP 200). Precaching that would brick offline launches.
    const harness = createHarness(
      okServer({
        "/index.html": () =>
          new Response(SIGN_IN_HTML, {
            headers: { "content-type": "text/html" },
          }),
      }),
    );
    installAppServiceWorker(harness.scope, MANIFEST);
    await expect(harness.dispatchInstall()).rejects.toThrow(/not the app/u);
    expect(harness.skipWaitingCalls).toBe(0);
  });

  it("fails install when any precached asset is missing", async () => {
    const harness = createHarness(
      okServer({
        "/assets/inter-latin-BBB.woff2": () =>
          new Response("gone", { status: 404 }),
      }),
    );
    installAppServiceWorker(harness.scope, MANIFEST);
    await expect(harness.dispatchInstall()).rejects.toThrow(/HTTP 404/u);
  });

  it("serves navigations from the network and falls back to the shell only when the fetch fails", async () => {
    let online = true;
    const harness = createHarness(async (input, init) => {
      if (!online) throw new TypeError("Failed to fetch");
      return okServer({
        "/threads/thr_1": () =>
          new Response(SIGN_IN_HTML, {
            headers: { "content-type": "text/html" },
          }),
        "/api/v1/threads": () => new Response("{}", { status: 503 }),
      })(input, init);
    });
    installAppServiceWorker(harness.scope, MANIFEST);
    await harness.dispatchInstall();

    // Online: whatever the server (or the connect gate) says wins, even a
    // sign-in page, so an expired session is never masked by the cache.
    const gated = await harness.dispatchFetch(
      navigationRequest(`${ORIGIN}/threads/thr_1`),
    );
    expect(await gated?.text()).toBe(SIGN_IN_HTML);

    // A navigation to a non-app path is not the worker's business at all.
    expect(
      await harness.dispatchFetch(
        navigationRequest(`${ORIGIN}/api/v1/threads`),
      ),
    ).toBeNull();
    expect(
      await harness.dispatchFetch(navigationRequest(`${ORIGIN}/__tunnel`)),
    ).toBeNull();

    // Offline: the precached shell boots the app.
    online = false;
    const offline = await harness.dispatchFetch(
      navigationRequest(`${ORIGIN}/threads/thr_1`),
    );
    expect(await offline?.text()).toBe(SHELL_HTML);
  });

  it("serves precached assets from the cache and caches other hashed assets on first load", async () => {
    const harness = createHarness(
      okServer({
        "/assets/old-DDD.js": () => new Response("gone", { status: 404 }),
      }),
    );
    installAppServiceWorker(harness.scope, MANIFEST);
    await harness.dispatchInstall();
    harness.fetchLog.length = 0;

    const precached = await harness.dispatchFetch(
      new Request(`${ORIGIN}/assets/index-AAA.js`),
    );
    expect(await precached?.text()).toBe("asset /assets/index-AAA.js");
    expect(harness.fetchLog).toEqual([]);

    const lazy = await harness.dispatchFetch(
      new Request(`${ORIGIN}/assets/mermaid-CCC.js`),
    );
    expect(await lazy?.text()).toBe("asset /assets/mermaid-CCC.js");
    expect(harness.fetchLog).toEqual([`${ORIGIN}/assets/mermaid-CCC.js`]);
    // Second load of the lazy chunk is a cache hit.
    await Promise.resolve();
    const again = await harness.dispatchFetch(
      new Request(`${ORIGIN}/assets/mermaid-CCC.js`),
    );
    expect(await again?.text()).toBe("asset /assets/mermaid-CCC.js");
    expect(harness.fetchLog).toEqual([`${ORIGIN}/assets/mermaid-CCC.js`]);

    // A stale hash after `bb update` (404) is returned but never cached.
    const stale = await harness.dispatchFetch(
      new Request(`${ORIGIN}/assets/old-DDD.js`),
    );
    expect(stale?.status).toBe(404);
    const cache = harness.cacheStorage.caches.get(
      appShellCacheName(MANIFEST.buildId),
    );
    expect(cache?.entries.has(`${ORIGIN}/assets/old-DDD.js`)).toBe(false);
  });

  it("never stores an HTML page under an asset URL (captive portal, proxy gate)", async () => {
    const portal = () =>
      new Response("<html>Sign in to the airport wifi</html>", {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    const harness = createHarness(okServer({ "/assets/lazy-EEE.js": portal }));
    installAppServiceWorker(harness.scope, MANIFEST);
    await harness.dispatchInstall();

    const response = await harness.dispatchFetch(
      new Request(`${ORIGIN}/assets/lazy-EEE.js`),
    );
    expect(response?.status).toBe(200);
    await Promise.resolve();
    const cache = harness.cacheStorage.caches.get(
      appShellCacheName(MANIFEST.buildId),
    );
    expect(cache?.entries.has(`${ORIGIN}/assets/lazy-EEE.js`)).toBe(false);

    // Same at install: a precache that would pin a portal page must fail.
    const poisoned = createHarness(
      okServer({ "/assets/index-AAA.js": portal }),
    );
    installAppServiceWorker(poisoned.scope, MANIFEST);
    await expect(poisoned.dispatchInstall()).rejects.toThrow(
      /asset precache failed/u,
    );
  });

  it("leaves API, websocket, plugin-asset, cross-origin and non-GET requests to the browser", async () => {
    const harness = createHarness(okServer());
    installAppServiceWorker(harness.scope, MANIFEST);
    await harness.dispatchInstall();
    harness.fetchLog.length = 0;

    for (const url of [
      `${ORIGIN}/api/v1/threads`,
      `${ORIGIN}/api/v1/plugins/tasks/assets/app.js`,
      `${ORIGIN}/ws`,
      `${ORIGIN}/sw.js`,
      `${ORIGIN}/manifest.webmanifest`,
      "https://cdn.example.com/assets/index-AAA.js",
    ]) {
      expect(await harness.dispatchFetch(new Request(url))).toBeNull();
    }
    expect(
      await harness.dispatchFetch(
        new Request(`${ORIGIN}/assets/index-AAA.js`, { method: "POST" }),
      ),
    ).toBeNull();
    expect(harness.fetchLog).toEqual([]);
  });

  it("drops the caches of previous builds on activate and claims open pages", async () => {
    const harness = createHarness(okServer());
    await harness.cacheStorage.open(appShellCacheName("build-previous"));
    await harness.cacheStorage.open("unrelated-cache");
    installAppServiceWorker(harness.scope, MANIFEST);
    await harness.dispatchInstall();
    await harness.dispatchActivate();

    expect((await harness.cacheStorage.keys()).sort()).toEqual([
      appShellCacheName(MANIFEST.buildId),
      "unrelated-cache",
    ]);
    expect(harness.claimCalls).toBe(1);
  });
});
