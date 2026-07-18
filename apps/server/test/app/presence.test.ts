import {
  presenceSummaryMessageSchema,
  threadPresenceMessageSchema,
} from "@bb/server-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  onClientSocketClose,
  onClientSocketMessage,
  onClientSocketOpen,
} from "../../src/ws/client-protocol.js";
import { NotificationHub } from "../../src/ws/hub.js";
import {
  registerSocketActor,
  releaseSocketActor,
} from "../../src/ws/socket-actors.js";
import { createMockHubSocket } from "../helpers/mock-hub-socket.js";

const sawyer = {
  handle: "sawyer",
  displayName: "Sawyer",
  imageUrl: null,
  clientId: "browser-1",
} as const;

function messages(socket: ReturnType<typeof createMockHubSocket>) {
  return socket.messages.map((message) => JSON.parse(message) as unknown);
}

function protocolDeps(hub: NotificationHub) {
  return {
    hub,
    watchInterests: {
      releaseSocket: vi.fn(),
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("thread presence", () => {
  it("broadcasts strict detail and partial-summary payloads on subscribe and unsubscribe", () => {
    const hub = new NotificationHub();
    const detailSocket = createMockHubSocket();
    const listSocket = createMockHubSocket();
    registerSocketActor(detailSocket, sawyer);
    hub.subscribe(listSocket, { kind: "thread-list" });

    hub.subscribe(detailSocket, {
      kind: "thread-detail",
      threadId: "thread-1",
    });

    const detail = threadPresenceMessageSchema.parse(messages(detailSocket)[0]);
    const summary = presenceSummaryMessageSchema.parse(messages(listSocket)[0]);
    expect(detail).toEqual({
      type: "thread-presence",
      threadId: "thread-1",
      viewers: [
        {
          handle: "sawyer",
          displayName: "Sawyer",
          imageUrl: null,
          typing: false,
        },
      ],
    });
    expect(summary).toEqual({
      type: "presence-summary",
      threads: { "thread-1": ["sawyer"] },
    });
    expect(hub.getPresenceSnapshot()).toEqual({
      threads: { "thread-1": detail.viewers },
    });

    hub.unsubscribe(detailSocket, {
      kind: "thread-detail",
      threadId: "thread-1",
    });

    expect(presenceSummaryMessageSchema.parse(messages(listSocket)[1])).toEqual(
      {
        type: "presence-summary",
        threads: { "thread-1": [] },
      },
    );
    expect(hub.getPresenceSnapshot()).toEqual({ threads: {} });
    releaseSocketActor(detailSocket);
  });

  it("skips presence broadcasts that fail the strict outgoing schemas", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    try {
      const hub = new NotificationHub();
      const socket = createMockHubSocket();
      registerSocketActor(socket, {
        ...sawyer,
        displayName: "",
      });

      hub.subscribe(socket, {
        kind: "thread-detail",
        threadId: "thread-1",
      });

      expect(socket.messages).toHaveLength(0);
      expect(consoleError).toHaveBeenCalledWith(
        "Skipping invalid realtime presence broadcast",
        expect.anything(),
      );
      hub.unregisterClient(socket);
      releaseSocketActor(socket);
    } finally {
      consoleError.mockRestore();
    }
  });

  it("dedupes a handle across sockets and removes it only after the last socket closes", () => {
    const hub = new NotificationHub();
    const firstSocket = createMockHubSocket();
    const secondSocket = createMockHubSocket();
    const listSocket = createMockHubSocket();
    registerSocketActor(firstSocket, sawyer);
    registerSocketActor(secondSocket, { ...sawyer, clientId: "browser-2" });
    hub.subscribe(listSocket, { kind: "thread-list" });
    hub.subscribe(firstSocket, {
      kind: "thread-detail",
      threadId: "thread-1",
    });
    firstSocket.messages.length = 0;
    listSocket.messages.length = 0;

    hub.subscribe(secondSocket, {
      kind: "thread-detail",
      threadId: "thread-1",
    });

    expect(messages(secondSocket)).toEqual([
      {
        type: "thread-presence",
        threadId: "thread-1",
        viewers: [
          {
            handle: "sawyer",
            displayName: "Sawyer",
            imageUrl: null,
            typing: false,
          },
        ],
      },
    ]);
    expect(firstSocket.messages).toHaveLength(0);
    expect(listSocket.messages).toHaveLength(0);

    hub.unregisterClient(firstSocket);
    expect(listSocket.messages).toHaveLength(0);
    expect(hub.getPresenceSnapshot().threads["thread-1"]).toHaveLength(1);

    hub.unregisterClient(secondSocket);
    expect(messages(listSocket)).toEqual([
      {
        type: "presence-summary",
        threads: { "thread-1": [] },
      },
    ]);
    expect(hub.getPresenceSnapshot()).toEqual({ threads: {} });
    releaseSocketActor(firstSocket);
    releaseSocketActor(secondSocket);
  });

  it("expires typing after the TTL and suppresses unchanged rebroadcasts", async () => {
    vi.useFakeTimers();
    const hub = new NotificationHub({ presenceTypingTtlMs: 50 });
    const detailSocket = createMockHubSocket();
    const listSocket = createMockHubSocket();
    registerSocketActor(detailSocket, sawyer);
    hub.subscribe(listSocket, { kind: "thread-list" });
    hub.subscribe(detailSocket, {
      kind: "thread-detail",
      threadId: "thread-1",
    });
    detailSocket.messages.length = 0;
    listSocket.messages.length = 0;

    hub.subscribe(detailSocket, {
      kind: "thread-detail",
      threadId: "thread-1",
    });
    expect(detailSocket.messages).toHaveLength(0);

    hub.setTyping(detailSocket, "thread-1", true);
    expect(
      threadPresenceMessageSchema.parse(messages(detailSocket)[0]).viewers[0]
        ?.typing,
    ).toBe(true);
    expect(listSocket.messages).toHaveLength(1);

    hub.setTyping(detailSocket, "thread-1", true);
    expect(detailSocket.messages).toHaveLength(1);
    expect(listSocket.messages).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(50);
    expect(
      threadPresenceMessageSchema.parse(messages(detailSocket)[1]).viewers[0]
        ?.typing,
    ).toBe(false);
    expect(listSocket.messages).toHaveLength(2);
    releaseSocketActor(detailSocket);
  });

  it("keeps a handle typing while another socket remains explicitly active", () => {
    const hub = new NotificationHub();
    const firstSocket = createMockHubSocket();
    const secondSocket = createMockHubSocket();
    registerSocketActor(firstSocket, sawyer);
    registerSocketActor(secondSocket, { ...sawyer, clientId: "browser-2" });
    hub.subscribe(firstSocket, {
      kind: "thread-detail",
      threadId: "thread-1",
    });
    hub.subscribe(secondSocket, {
      kind: "thread-detail",
      threadId: "thread-1",
    });

    hub.setTyping(firstSocket, "thread-1", true);
    hub.setTyping(secondSocket, "thread-1", true);
    hub.setTyping(firstSocket, "thread-1", false);
    expect(hub.getPresenceSnapshot().threads["thread-1"]?.[0]?.typing).toBe(
      true,
    );

    hub.setTyping(secondSocket, "thread-1", false);
    expect(hub.getPresenceSnapshot().threads["thread-1"]?.[0]?.typing).toBe(
      false,
    );
    hub.unregisterClient(firstSocket);
    hub.unregisterClient(secondSocket);
    releaseSocketActor(firstSocket);
    releaseSocketActor(secondSocket);
  });

  it("keeps a handle typing when one socket TTL expires before another", async () => {
    vi.useFakeTimers();
    const hub = new NotificationHub({ presenceTypingTtlMs: 50 });
    const firstSocket = createMockHubSocket();
    const secondSocket = createMockHubSocket();
    registerSocketActor(firstSocket, sawyer);
    registerSocketActor(secondSocket, { ...sawyer, clientId: "browser-2" });
    hub.subscribe(firstSocket, {
      kind: "thread-detail",
      threadId: "thread-1",
    });
    hub.subscribe(secondSocket, {
      kind: "thread-detail",
      threadId: "thread-1",
    });

    hub.setTyping(firstSocket, "thread-1", true);
    await vi.advanceTimersByTimeAsync(25);
    hub.setTyping(secondSocket, "thread-1", true);
    await vi.advanceTimersByTimeAsync(25);
    expect(hub.getPresenceSnapshot().threads["thread-1"]?.[0]?.typing).toBe(
      true,
    );

    await vi.advanceTimersByTimeAsync(25);
    expect(hub.getPresenceSnapshot().threads["thread-1"]?.[0]?.typing).toBe(
      false,
    );
    hub.unregisterClient(firstSocket);
    hub.unregisterClient(secondSocket);
    releaseSocketActor(firstSocket);
    releaseSocketActor(secondSocket);
  });

  it("folds typing protocol messages into presence and removes presence before releasing the actor", () => {
    const hub = new NotificationHub();
    const deps = protocolDeps(hub);
    const socket = createMockHubSocket();
    registerSocketActor(socket, sawyer);
    onClientSocketOpen(hub, socket);
    onClientSocketMessage(
      deps,
      socket,
      JSON.stringify({
        type: "subscribe",
        target: { kind: "thread-detail", threadId: "thread-1" },
      }),
    );
    socket.messages.length = 0;

    onClientSocketMessage(
      deps,
      socket,
      JSON.stringify({ type: "typing", threadId: "thread-1", typing: true }),
    );

    expect(
      threadPresenceMessageSchema.parse(messages(socket)[0]).viewers[0]?.typing,
    ).toBe(true);
    onClientSocketClose(deps, socket);
    expect(hub.getPresenceSnapshot()).toEqual({ threads: {} });
  });
});
