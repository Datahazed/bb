// One Durable Object per client: its DemoWorld plus the WebSockets that
// receive the world's change notices. HTTP and the socket share the object,
// so a sent message and the notice that announces it cannot disagree.

import { DemoWorld } from "./demo-world.js";

/** Reconnect overlap is normal; more sockets only amplify a public session. */
export const MAX_SESSION_SOCKETS = 4;

/** Realtime messages are pings and subscriptions, both far smaller than this. */
export const MAX_SOCKET_FRAME_BYTES = 16 * 1024;

interface DemoStateContext {
  acceptWebSocket(socket: WebSocket): void;
  getWebSockets(): WebSocket[];
}

const TEXT_ENCODER = new TextEncoder();

export class DemoStateDO {
  private readonly world = new DemoWorld();

  constructor(private readonly state: DemoStateContext) {
    this.world.onChanged((message) => {
      const raw = JSON.stringify(message);
      for (const socket of this.state.getWebSockets()) {
        try {
          socket.send(raw);
        } catch {
          try {
            socket.close(1011, "Failed to send demo update");
          } catch {
            // The hibernation API drops dead sockets from getWebSockets().
          }
        }
      }
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.replace(/\/+$/u, "") === "/ws") {
      return this.handleWebSocket(request);
    }
    return this.world.handle(request);
  }

  private handleWebSocket(request: Request): Response {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected a WebSocket upgrade", { status: 426 });
    }
    if (this.state.getWebSockets().length >= MAX_SESSION_SOCKETS) {
      return new Response(
        JSON.stringify({
          code: "too_many_connections",
          message: `A demo session accepts at most ${MAX_SESSION_SOCKETS} WebSocket connections`,
        }),
        {
          status: 429,
          headers: { "content-type": "application/json" },
        },
      );
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.state.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): void {
    if (typeof message !== "string") {
      socket.close(
        message.byteLength > MAX_SOCKET_FRAME_BYTES ? 1009 : 1003,
        message.byteLength > MAX_SOCKET_FRAME_BYTES
          ? "Demo WebSocket frame is too large"
          : "Demo WebSocket accepts text frames only",
      );
      return;
    }
    if (
      message.length > MAX_SOCKET_FRAME_BYTES ||
      TEXT_ENCODER.encode(message).byteLength > MAX_SOCKET_FRAME_BYTES
    ) {
      socket.close(1009, "Demo WebSocket frame is too large");
      return;
    }
    const reply = this.world.socketReply(message);
    if (reply !== null) socket.send(reply);
  }

  webSocketClose(socket: WebSocket, code: number, reason: string): void {
    try {
      socket.close(code, reason);
    } catch {
      // The peer may already have completed the close handshake.
    }
  }

  webSocketError(socket: WebSocket): void {
    try {
      socket.close(1011, "Demo WebSocket error");
    } catch {
      // The runtime will discard a socket that is already gone.
    }
  }
}
