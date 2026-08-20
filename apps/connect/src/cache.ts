// Edge-cache layer for the tunnel gate. Immutable, content-hashed assets from a
// production bb build are cached at the Cloudflare edge so repeat requests skip
// the tunnel round-trip entirely — turning a page's hundreds of asset requests
// into a handful of dynamic API calls plus edge hits.
//
// Only called AFTER the gate has verified the requester owns the label. Server
// cache namespaces remain the bare/full host label exactly as on main; new
// machine labels include their ownership generation. Caching is opt-in via the
// ORIGIN's Cache-Control, so a dev server is proxied uncached while a bundled
// immutable build is cached.

import { rebuiltResponse } from "./response-encoding.js";

// Tightening cache admission must also change this host so entries admitted by
// older code become unreachable without a global Cloudflare purge.
const CACHE_HOST = "https://bb-connect-asset-cache-v2.internal";
const MIN_CACHEABLE_MAX_AGE = 300;

interface CacheControlDirective {
  quoted: boolean;
  value: string | null;
}

const CACHE_CONTROL_TOKEN_CHARACTER = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]$/u;

function isTokenCharacter(character: string | undefined): boolean {
  return (
    character !== undefined && CACHE_CONTROL_TOKEN_CHARACTER.test(character)
  );
}

function isQuotedTextCharacter(character: string): boolean {
  const code = character.charCodeAt(0);
  return code === 0x09 || (code >= 0x20 && code !== 0x7f);
}

/** Parse Cache-Control's comma list without treating quoted commas as syntax. */
function parseCacheControl(
  header: string,
): Map<string, CacheControlDirective> | null {
  const directives = new Map<string, CacheControlDirective>();
  let offset = 0;

  while (offset < header.length) {
    while (header[offset] === " " || header[offset] === "\t") offset++;

    const nameStart = offset;
    while (isTokenCharacter(header[offset])) offset++;
    if (offset === nameStart) return null;
    const name = header.slice(nameStart, offset).toLowerCase();

    let quoted = false;
    let value: string | null = null;
    if (header[offset] === "=") {
      offset++;
      if (header[offset] === '"') {
        quoted = true;
        offset++;
        const valueStart = offset;
        let closed = false;
        while (offset < header.length) {
          const character = header[offset];
          if (character === '"') {
            value = header.slice(valueStart, offset);
            offset++;
            closed = true;
            break;
          }
          if (character === "\\") {
            offset++;
            if (offset === header.length) return null;
          }
          if (!isQuotedTextCharacter(header[offset])) return null;
          offset++;
        }
        if (!closed) return null;
      } else {
        const valueStart = offset;
        while (isTokenCharacter(header[offset])) offset++;
        if (offset === valueStart) return null;
        value = header.slice(valueStart, offset);
      }
    }

    while (header[offset] === " " || header[offset] === "\t") offset++;
    if (directives.has(name)) return null;
    directives.set(name, { quoted, value });
    if (offset === header.length) break;
    if (header[offset] !== ",") return null;
    offset++;
    if (offset === header.length) return null;
  }

  return directives;
}

/** Build the edge-cache Request key for a namespace label + visitor URL. */
export function cacheKey(namespace: string, url: URL): Request {
  return new Request(`${CACHE_HOST}/${namespace}${url.pathname}${url.search}`, {
    method: "GET",
  });
}

function isCacheable(resp: Response): boolean {
  if (!resp.ok) return false;
  if (resp.headers.has("set-cookie")) return false;
  const directives = parseCacheControl(resp.headers.get("cache-control") ?? "");
  if (directives === null) return false;
  if (
    directives.has("no-store") ||
    directives.has("no-cache") ||
    directives.has("private")
  ) {
    return false;
  }
  const immutable = directives.get("immutable");
  if (immutable === undefined || immutable.value !== null) return false;
  const maxAge = directives.get("max-age");
  if (
    maxAge === undefined ||
    maxAge.quoted ||
    maxAge.value === null ||
    !/^\d+$/u.test(maxAge.value)
  ) {
    return false;
  }
  return Number(maxAge.value) >= MIN_CACHEABLE_MAX_AGE;
}

/**
 * Serve `request` from the edge cache when possible, else run `fetchOrigin`
 * (the tunnel) and populate the cache when the response is cacheable.
 *
 * `namespace` is the server label or generation-isolated machine routing key,
 * plus the optional share target.
 */
export async function serveWithCache(
  request: Request,
  namespace: string,
  ctx: ExecutionContext,
  fetchOrigin: () => Promise<Response>,
): Promise<Response> {
  if (request.method !== "GET") return fetchOrigin();

  const url = new URL(request.url);
  const key = cacheKey(namespace, url);
  const cache = caches.default;

  const hit = await cache.match(key);
  if (hit) {
    // The cache stores the origin's bytes still encoded, so `hit.body` is raw
    // gzip/br whenever the origin compressed — it must be rebuilt as
    // pre-encoded (see response-encoding.ts) or the visitor gets raw gzip
    // labelled text/html. This is NOT symmetric with the miss path below.
    const r = rebuiltResponse(hit.body, hit);
    r.headers.set("x-bb-cache", "hit");
    return r;
  }

  const resp = await fetchOrigin();
  if (isCacheable(resp)) {
    // clone() before the body is consumed by the returned response.
    ctx.waitUntil(cache.put(key, resp.clone()));
    // Subrequest bodies are the opposite case: workerd content-decodes a
    // tunnelled response as it is read here, so `resp.body` is already plain
    // bytes and the default (automatic) encoding is the correct one. Marking
    // this one pre-encoded would advertise a gzip body that isn't gzipped.
    const r = new Response(resp.body, resp);
    r.headers.set("x-bb-cache", "miss");
    return r;
  }
  return resp;
}
