import { describe, expect, it } from "vitest";
import { DEMO_SERVER_URL_HEADER } from "./demo-state.js";
import worker, { type Env } from "./worker.js";

const ORIGIN = "https://demo.example.test";
const FIRST_ID = "a".repeat(64);
const SECOND_ID = "b".repeat(64);
const MINTED_ID = "c".repeat(64);

function durableObjectId(value: string): DurableObjectId {
  const id: DurableObjectId = {
    equals: (other) => other.toString() === value,
    toString: () => value,
  };
  return id;
}

function createEnv() {
  const forwarded: { id: string; request: Request }[] = [];
  const env: Env = {
    DEMO_STATE: {
      newUniqueId: () => durableObjectId(MINTED_ID),
      idFromString: (value) => {
        if (!/^[a-f0-9]{64}$/u.test(value)) throw new Error("Invalid id");
        return durableObjectId(value);
      },
      get: (id) => ({
        fetch: async (request) => {
          forwarded.push({ id: id.toString(), request });
          return new Response("forwarded");
        },
      }),
    },
  };
  return { env, forwarded };
}

describe("demo session routing", () => {
  it("mints an unguessable Durable Object id as a Direct URL", async () => {
    const { env } = createEnv();
    const response = await worker.fetch(
      new Request(`${ORIGIN}/demo`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
      env,
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      serverUrl: `${ORIGIN}/demo/${MINTED_ID}`,
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("routes HTTP and WebSocket traffic by credential, never client IP", async () => {
    const { env, forwarded } = createEnv();
    const sharedNetwork = { "cf-connecting-ip": "203.0.113.7" };

    await worker.fetch(
      new Request(`${ORIGIN}/demo/${FIRST_ID}/health`, {
        headers: sharedNetwork,
      }),
      env,
    );
    await worker.fetch(
      new Request(`${ORIGIN}/demo/${SECOND_ID}/api/v1/threads`, {
        headers: sharedNetwork,
      }),
      env,
    );
    await worker.fetch(
      new Request(`${ORIGIN}/demo/${FIRST_ID}/ws`, {
        headers: {
          ...sharedNetwork,
          origin: ORIGIN,
          upgrade: "websocket",
        },
      }),
      env,
    );

    expect(forwarded.map((entry) => entry.id)).toEqual([
      FIRST_ID,
      SECOND_ID,
      FIRST_ID,
    ]);
    expect(
      forwarded.map((entry) => new URL(entry.request.url).pathname),
    ).toEqual(["/health", "/api/v1/threads", "/ws"]);
    expect(
      forwarded.map((entry) =>
        entry.request.headers.get(DEMO_SERVER_URL_HEADER),
      ),
    ).toEqual([
      `${ORIGIN}/demo/${FIRST_ID}`,
      `${ORIGIN}/demo/${SECOND_ID}`,
      `${ORIGIN}/demo/${FIRST_ID}`,
    ]);
  });

  it("rejects missing credentials and cross-site browser origins", async () => {
    const { env, forwarded } = createEnv();
    const missing = await worker.fetch(
      new Request(`${ORIGIN}/api/v1/threads`),
      env,
    );
    const crossSiteWrite = await worker.fetch(
      new Request(`${ORIGIN}/demo/${FIRST_ID}/api/v1/threads`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://hostile.example",
        },
        body: "{}",
      }),
      env,
    );
    const crossSiteSocket = await worker.fetch(
      new Request(`${ORIGIN}/demo/${FIRST_ID}/ws`, {
        headers: {
          origin: "https://hostile.example",
          upgrade: "websocket",
        },
      }),
      env,
    );

    expect(missing.status).toBe(401);
    expect(crossSiteWrite.status).toBe(403);
    expect(crossSiteSocket.status).toBe(403);
    expect(forwarded).toEqual([]);
  });
});
