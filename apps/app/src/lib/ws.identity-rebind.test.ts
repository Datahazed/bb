import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Fake socket that records its URL provider and reconnect() calls so the
// tests can assert the identity rides the next upgrade URL.
const fakeSocketState = vi.hoisted(() => {
  type UrlProvider = () => string;

  class FakeReconnectingWebSocket {
    onclose: (() => void) | null = null;
    onmessage: ((event: MessageEvent) => void) | null = null;
    onopen: (() => void) | null = null;
    readyState = 1;
    readonly sentMessages: string[] = [];
    reconnectCalls = 0;
    private readonly urlProvider: UrlProvider;

    constructor(urlProvider: UrlProvider) {
      this.urlProvider = urlProvider;
      instances.push(this);
    }

    close(): void {
      this.readyState = 3;
      this.onclose?.();
    }

    open(): void {
      this.readyState = 1;
      this.onopen?.();
    }

    send(data: string): void {
      this.sentMessages.push(data);
    }

    reconnect(): void {
      this.reconnectCalls += 1;
      this.close();
      this.open();
    }

    nextUpgradeUrl(): string {
      return this.urlProvider();
    }
  }

  const instances: FakeReconnectingWebSocket[] = [];

  return { FakeReconnectingWebSocket, instances };
});

// Controllable claimed-identity fake: the real store suppresses identities on
// localhost (the test origin), so the manager's rebind path could never fire.
const identityState = vi.hoisted(() => {
  const state = {
    value: null as string | null,
    listeners: new Set<() => void>(),
    set(next: string | null): void {
      state.value = next;
      for (const listener of state.listeners) {
        listener();
      }
    },
  };
  return state;
});

vi.mock("partysocket/ws", () => ({
  default: fakeSocketState.FakeReconnectingWebSocket,
}));

vi.mock("./dev-websocket-url", () => ({
  buildDevWebSocketUrl: () => "ws://bb.test/ws",
}));

vi.mock("./claimed-identity-store", () => ({
  getClaimedIdentityHeaderValue: () => identityState.value,
  subscribeClaimedIdentity: (listener: () => void) => {
    identityState.listeners.add(listener);
    return () => {
      identityState.listeners.delete(listener);
    };
  },
}));

import { WebSocketManager } from "./ws";

function getOnlySocket() {
  const socket = fakeSocketState.instances[0];
  if (!socket) {
    throw new Error("Expected websocket to be created");
  }
  return socket;
}

describe("WebSocketManager claimed-identity rebind", () => {
  const originalWebSocket = globalThis.WebSocket;

  beforeEach(() => {
    fakeSocketState.instances.length = 0;
    identityState.value = null;
    identityState.listeners.clear();
    Object.defineProperty(globalThis, "WebSocket", {
      configurable: true,
      value: { OPEN: 1 },
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "WebSocket", {
      configurable: true,
      value: originalWebSocket,
    });
  });

  it("reconnects exactly once when an identity is claimed, with ?identity= on the next URL", () => {
    const manager = new WebSocketManager();
    manager.connect();
    const socket = getOnlySocket();
    socket.open();

    expect(socket.nextUpgradeUrl()).toBe("ws://bb.test/ws");

    identityState.set("alice-encoded");

    expect(socket.reconnectCalls).toBe(1);
    expect(fakeSocketState.instances).toHaveLength(1);
    expect(socket.nextUpgradeUrl()).toBe(
      "ws://bb.test/ws?identity=alice-encoded",
    );
  });

  it("rebinds again on edit and drops ?identity= on clear", () => {
    const manager = new WebSocketManager();
    manager.connect();
    const socket = getOnlySocket();
    socket.open();

    identityState.set("alice-encoded");
    identityState.set("alice+cooper");
    expect(socket.reconnectCalls).toBe(2);
    expect(socket.nextUpgradeUrl()).toBe(
      "ws://bb.test/ws?identity=alice%2Bcooper",
    );

    identityState.set(null);
    expect(socket.reconnectCalls).toBe(3);
    expect(socket.nextUpgradeUrl()).toBe("ws://bb.test/ws");
  });

  it("ignores store notifications that leave the identity unchanged", () => {
    const manager = new WebSocketManager();
    manager.connect();
    const socket = getOnlySocket();
    socket.open();

    identityState.set(null);
    identityState.set(null);

    expect(socket.reconnectCalls).toBe(0);
  });

  it("resubscribes active targets over the rebound socket", () => {
    const manager = new WebSocketManager();
    manager.connect();
    const socket = getOnlySocket();
    socket.open();
    manager.subscribe({ kind: "project-list" });
    socket.sentMessages.length = 0;

    identityState.set("alice-encoded");

    expect(
      socket.sentMessages.map((message) => JSON.parse(message) as unknown),
    ).toEqual([{ type: "subscribe", target: { kind: "project-list" } }]);
  });

  it("stops listening for identity changes after disconnect", () => {
    const manager = new WebSocketManager();
    manager.connect();
    const socket = getOnlySocket();
    socket.open();
    manager.disconnect();

    identityState.set("alice-encoded");

    expect(socket.reconnectCalls).toBe(0);
  });
});
