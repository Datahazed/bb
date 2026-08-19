import { EventEmitter } from "node:events";
import { createServer, type Server } from "node:http";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { WebSocket as NodeWebSocket } from "ws";
import { decodeFrame, encodeFrame, type Frame } from "@bb/tunnel-contract";
import { TunnelSession, isPrecompressedResponse } from "../src/session.js";

// The tunnel dial negotiates permessage-deflate. Static assets and API JSON
// arrive from the origin already brotli/gzip encoded; deflating those chunks
// again costs CPU per chunk and grows them. Only identity bodies (and every
// control frame) should ride the extension.

interface SentMessage {
  frame: Frame;
  compress: boolean | undefined;
}

class FakeTunnel extends EventEmitter {
  readyState: number = NodeWebSocket.OPEN;
  readonly sent: SentMessage[] = [];
  send(data: Uint8Array, options?: { compress?: boolean }): void {
    this.sent.push({ frame: decodeFrame(data), compress: options?.compress });
  }
  terminate(): void {
    this.readyState = NodeWebSocket.CLOSED;
  }
}

let server: Server;
let origin: string;

beforeAll(async () => {
  server = createServer((request, response) => {
    if (request.url === "/precompressed.js") {
      response.writeHead(200, {
        "content-type": "text/javascript",
        "content-encoding": "gzip",
      });
      response.end(gzipSync(Buffer.from("console.log('hi')".repeat(64))));
      return;
    }
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("plain body ".repeat(64));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("test server has no port");
  }
  origin = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function startSession(): FakeTunnel {
  const tunnel = new FakeTunnel();
  const session = new TunnelSession({
    // The session only uses the EventEmitter + send/readyState surface.
    tunnel: tunnel as unknown as NodeWebSocket,
    log: { info: vi.fn(), warn: vi.fn() },
    resolveOrigin: () => ({
      kind: "ok",
      resolved: { origin, publicOrigin: "https://sawyer.getbb.app" },
    }),
  });
  session.start();
  return tunnel;
}

async function relay(tunnel: FakeTunnel, path: string): Promise<SentMessage[]> {
  tunnel.emit(
    "message",
    Buffer.from(
      encodeFrame({
        type: "open-http",
        streamId: 1,
        method: "GET",
        path,
        headers: [],
        hasBody: false,
      }),
    ),
    true,
  );
  await vi.waitFor(() => {
    expect(tunnel.sent.some((m) => m.frame.type === "body-end")).toBe(true);
  });
  return tunnel.sent;
}

describe("TunnelSession body-chunk compression", () => {
  it("opts precompressed origin bodies out of permessage-deflate", async () => {
    const sent = await relay(startSession(), "/precompressed.js");
    const chunks = sent.filter((m) => m.frame.type === "body-chunk");
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every((m) => m.compress === false)).toBe(true);
    // Control frames still compress.
    const head = sent.find((m) => m.frame.type === "resp-head");
    expect(head?.compress).toBe(true);
    const end = sent.find((m) => m.frame.type === "body-end");
    expect(end?.compress).toBe(true);
  });

  it("keeps deflate for identity bodies", async () => {
    const sent = await relay(startSession(), "/plain.txt");
    const chunks = sent.filter((m) => m.frame.type === "body-chunk");
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every((m) => m.compress === true)).toBe(true);
  });
});

describe("isPrecompressedResponse", () => {
  it("treats only identity (or absent) encodings as compressible", () => {
    expect(isPrecompressedResponse(undefined)).toBe(false);
    expect(isPrecompressedResponse("identity")).toBe(false);
    expect(isPrecompressedResponse("")).toBe(false);
    expect(isPrecompressedResponse("br")).toBe(true);
    expect(isPrecompressedResponse("GZIP")).toBe(true);
    expect(isPrecompressedResponse("identity, gzip")).toBe(true);
    expect(isPrecompressedResponse(["gzip"])).toBe(true);
  });
});
