// Relays a gzip-encoded origin response through the real TunnelDO and the real
// edge-cache layer inside a real workerd (miniflare).
//
// Why not a plain unit test: `encodeBody` exists only in workerd. Under Node,
// `new Response(gzipBytes, { headers: { "content-encoding": "gzip" } })` is
// inert, so a Node test passes identically with and without this fix. In
// workerd the default (`encodeBody: "automatic"`) means "this body is identity
// and I own the encoding", so it drops the header and ships compressed bytes
// labelled text/html — the browser then renders raw gzip. That is the
// corruption that forced the revert of #909, and reproducing it needs the real
// runtime.
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decodeFrame, encodeFrame, type Frame } from "@bb/tunnel-contract";

const HTML = `<!doctype html><title>bb</title>${"<p>relayed body</p>".repeat(50)}`;
const GZIP = gzipSync(Buffer.from(HTML));
const IMMUTABLE = "public, max-age=31536000, immutable";

function cacheControlForPolicy(policy: string | null): string {
  switch (policy) {
    case "1":
      return IMMUTABLE;
    case "mutable":
      return "public, max-age=300";
    case "quoted-immutable":
      return 'public, extension="a,immutable,b", max-age=300';
    case "quoted-max-age":
      return 'public, immutable, extension="max-age=300"';
    case "prefixed-max-age":
      return "public, immutable, not-max-age=300";
    default:
      return "no-store";
  }
}

type ClientWebSocket = NonNullable<
  Awaited<ReturnType<Miniflare["dispatchFetch"]>>["webSocket"]
>;

let mf: Miniflare;
/** Kept open for the whole file: the DO only proxies while a tunnel is live. */
let tunnel: ClientWebSocket;

async function bundleFixture(): Promise<string> {
  const result = await build({
    entryPoints: [
      fileURLToPath(new URL("../test/encoding-fixture.ts", import.meta.url)),
    ],
    bundle: true,
    format: "esm",
    target: "esnext",
    conditions: ["workerd", "worker", "browser"],
    write: false,
  });
  return result.outputFiles[0].text;
}

/**
 * Minimal stand-in for the bb tunnel client: answers every relayed request with
 * the origin's gzip bytes forwarded verbatim, which is what the client does
 * since #909 stopped stripping accept-encoding.
 */
function serveOriginOverTunnel(ws: ClientWebSocket): void {
  // Copy into a plain ArrayBuffer-backed view: send() rejects the encoder's
  // ArrayBufferLike-typed result.
  const send = (frame: Frame) => ws.send(new Uint8Array(encodeFrame(frame)));
  ws.addEventListener("message", (event) => {
    if (typeof event.data === "string") return;
    const frame = decodeFrame(event.data as ArrayBuffer);
    if (frame.type !== "open-http") return;
    const cachePolicy = new URL(
      frame.path,
      "http://origin.local",
    ).searchParams.get("cacheable");
    send({
      type: "resp-head",
      streamId: frame.streamId,
      status: 200,
      headers: [
        ["content-type", "text/html; charset=utf-8"],
        ["content-encoding", "gzip"],
        ["content-length", String(GZIP.byteLength)],
        ["cache-control", cacheControlForPolicy(cachePolicy)],
      ],
    });
    send({
      type: "body-chunk",
      streamId: frame.streamId,
      data: new Uint8Array(GZIP),
    });
    send({ type: "body-end", streamId: frame.streamId });
  });
}

/** Bytes as they left workerd, after the client's own content-decoding. */
async function get(
  path: string,
): Promise<{ status: number; encoding: string | null; body: Buffer }> {
  const res = await mf.dispatchFetch(`https://relay.test${path}`, {
    headers: { "accept-encoding": "gzip" },
  });
  return {
    status: res.status,
    encoding: res.headers.get("content-encoding"),
    body: Buffer.from(await res.arrayBuffer()),
  };
}

beforeAll(async () => {
  mf = new Miniflare({
    modules: [
      {
        type: "ESModule",
        path: "/fixture.js",
        contents: await bundleFixture(),
      },
    ],
    modulesRoot: "/",
    scriptPath: "/fixture.js",
    compatibilityDate: "2026-06-11",
    compatibilityFlags: ["nodejs_compat"],
    durableObjects: { TUNNEL_DO: "TunnelDO" },
    d1Databases: { DB: "fixture-db" },
    bindings: {
      BASE_DOMAIN: "relay.test",
      BETTER_AUTH_SECRET: "fixture-secret",
      GZIP_BODY_B64: GZIP.toString("base64"),
    },
  });
  await mf.ready;

  const dial = await mf.dispatchFetch("https://relay.test/__tunnel", {
    headers: { Upgrade: "websocket" },
  });
  if (!dial.webSocket) throw new Error(`tunnel dial failed: ${dial.status}`);
  tunnel = dial.webSocket;
  tunnel.accept();
  serveOriginOverTunnel(tunnel);
}, 60_000);

afterAll(async () => {
  tunnel?.close();
  await mf?.dispose();
});

describe("relaying a gzip-encoded origin response", () => {
  it("hands the visitor a body that decodes back to the origin's HTML", async () => {
    const res = await get("/index.html");

    expect(res.status).toBe(200);
    // The client content-decodes, so an intact gzip response arrives as the
    // original HTML; the corruption shows up as the compressed bytes instead.
    expect(res.body.toString("utf8")).toBe(HTML);
  });

  it("would corrupt the response if it were rebuilt with workerd's default encoding", async () => {
    const res = await get("/legacy-relay");

    // Pins the runtime behaviour the fix exists for: content-encoding dropped,
    // compressed bytes delivered as text/html.
    expect(res.encoding).toBeNull();
    expect(res.body.subarray(0, 2)).toEqual(Buffer.from([0x1f, 0x8b]));
    expect(res.body.toString("utf8")).not.toBe(HTML);
    expect(gunzipSync(res.body).toString("utf8")).toBe(HTML);
  });
});

describe("edge cache", () => {
  it("does not read mutable entries stored under the legacy cache key", async () => {
    const target = "/legacy-personalized";
    const seeded = await mf.dispatchFetch(
      `https://relay.test/seed-legacy-cache?for=${encodeURIComponent(target)}`,
    );
    expect(seeded.status).toBe(204);

    const response = await mf.dispatchFetch(`https://relay.test${target}`);
    expect(response.headers.get("x-bb-cache")).toBeNull();
    expect(await response.text()).toBe(HTML);
  });

  it.each([
    ["a max-age response without immutable", "mutable"],
    ["immutable text inside a quoted extension", "quoted-immutable"],
    ["max-age text inside a quoted extension", "quoted-max-age"],
    ["a prefixed max-age directive", "prefixed-max-age"],
  ])("does not cache %s", async (_description, policy) => {
    const url = `https://relay.test/rejected-${policy}?cacheable=${policy}`;

    const first = await mf.dispatchFetch(url);
    expect(first.headers.get("x-bb-cache")).toBeNull();

    const second = await mf.dispatchFetch(url);
    expect(second.headers.get("x-bb-cache")).toBeNull();
  });

  it("caches a valid immutable asset", async () => {
    const url = "https://relay.test/valid-asset.js?cacheable=1";

    const miss = await mf.dispatchFetch(url);
    expect(miss.headers.get("x-bb-cache")).toBe("miss");
    expect(await miss.text()).toBe(HTML);

    const hit = await mf.dispatchFetch(url);
    expect(hit.headers.get("x-bb-cache")).toBe("hit");
    expect(hit.headers.get("cache-control")).toBe(IMMUTABLE);
  });

  it("keeps the body decodable on both the miss and the hit", async () => {
    const miss = await get("/asset.js?cacheable=1");
    expect(miss.body.toString("utf8")).toBe(HTML);

    // The hit is the dangerous one: the cache keeps the origin's bytes
    // compressed, so this Response is rebuilt around raw gzip.
    const hit = await get("/asset.js?cacheable=1");
    expect(hit.status).toBe(200);
    expect(hit.body.toString("utf8")).toBe(HTML);
  });

  it("content-decodes a relayed body as the gate reads it", async () => {
    // The invariant behind the miss/hit asymmetry: a body read out of a
    // subrequest is already plain even though content-encoding still says gzip,
    // so the miss path must stay on automatic encoding.
    const res = await mf.dispatchFetch("https://relay.test/subrequest-bytes");

    expect(await res.json()).toEqual({
      byteLength: HTML.length,
      firstBytes: [...Buffer.from(HTML.slice(0, 2))],
      contentEncoding: "gzip",
    });
  });

  it("would serve raw gzip if a hit were rebuilt the pre-fix way", async () => {
    await get("/legacy-asset.js?cacheable=1");

    const res = await get(
      `/legacy-cache-hit?for=${encodeURIComponent("/legacy-asset.js?cacheable=1")}`,
    );

    expect(res.status).toBe(200);
    expect(res.encoding).toBeNull();
    expect(res.body.subarray(0, 2)).toEqual(Buffer.from([0x1f, 0x8b]));
    expect(gunzipSync(res.body).toString("utf8")).toBe(HTML);
  });

  it("preserves status and headers when serving from the cache", async () => {
    await get("/headers.js?cacheable=1");
    const res = await mf.dispatchFetch(
      "https://relay.test/headers.js?cacheable=1",
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("x-bb-cache")).toBe("hit");
    expect(res.headers.get("cache-control")).toBe(IMMUTABLE);
  });
});
