import { pongMessageSchema } from "@bb/domain";
import { describe, expect, it, vi } from "vitest";
import {
  DemoStateDO,
  MAX_SESSION_SOCKETS,
  MAX_SOCKET_FRAME_BYTES,
} from "./demo-state.js";
import { DEMO_THREADS } from "./fixtures/timelines.js";

const ORIGIN = "https://demo.example.test";
const THREAD_ID = DEMO_THREADS[0].id;

function fakeSocket() {
  const send = vi.fn();
  const close = vi.fn();
  return {
    socket: { send, close } as unknown as WebSocket,
    send,
    close,
  };
}

function createState(sockets: WebSocket[]) {
  const acceptWebSocket = vi.fn();
  const getWebSockets = vi.fn(() => sockets);
  return {
    object: new DemoStateDO({ acceptWebSocket, getWebSockets }),
    acceptWebSocket,
    getWebSockets,
  };
}

describe("demo Durable Object resource boundaries", () => {
  it("fans changes out through the hibernation API's live socket list", async () => {
    const live = fakeSocket();
    const { object, getWebSockets } = createState([live.socket]);
    const response = await object.fetch(
      new Request(`${ORIGIN}/api/v1/threads/${THREAD_ID}/queued-messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          input: [{ type: "text", text: "Later.", mentions: [] }],
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(getWebSockets).toHaveBeenCalledOnce();
    expect(live.send).toHaveBeenCalledOnce();
    expect(JSON.parse(live.send.mock.calls[0][0])).toMatchObject({
      type: "changed",
      entity: "thread",
      id: THREAD_ID,
      changes: ["queue-changed"],
    });
  });

  it("rejects a WebSocket upgrade once the small session cap is reached", async () => {
    const sockets = Array.from(
      { length: MAX_SESSION_SOCKETS },
      () => fakeSocket().socket,
    );
    const { object, acceptWebSocket } = createState(sockets);
    const response = await object.fetch(
      new Request(`${ORIGIN}/ws`, {
        headers: { upgrade: "WebSocket" },
      }),
    );

    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({
      code: "too_many_connections",
    });
    expect(acceptWebSocket).not.toHaveBeenCalled();
  });

  it("closes oversized frames before parsing them", () => {
    const peer = fakeSocket();
    const { object } = createState([]);

    object.webSocketMessage(
      peer.socket,
      "x".repeat(MAX_SOCKET_FRAME_BYTES + 1),
    );
    expect(peer.close).toHaveBeenCalledWith(
      1009,
      "Demo WebSocket frame is too large",
    );
    expect(peer.send).not.toHaveBeenCalled();

    peer.close.mockClear();
    object.webSocketMessage(peer.socket, JSON.stringify({ type: "ping" }));
    expect(peer.close).not.toHaveBeenCalled();
    expect(peer.send).toHaveBeenCalledOnce();
    pongMessageSchema.parse(JSON.parse(peer.send.mock.calls[0][0]));
  });
});
