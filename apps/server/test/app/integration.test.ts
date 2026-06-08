import type { RawData } from "ws";
import { WebSocket } from "ws";
import { createBrowserBbSdk, type AppRealtimeEvent } from "@bb/sdk/browser";
import { wrapNodeWsWebsocket } from "@bb/sdk/node-websocket";
import {
  turnScope,
  type SystemChangeKind,
  type ThreadChangeKind,
} from "@bb/domain";
import { describe, expect, it } from "vitest";
import { notifyGlobalAppsChanged } from "../../src/routes/apps.js";
import { createThreadEventAppender } from "../../src/services/threads/event-append.js";
import { seedThreadFixture } from "../helpers/seed.js";
import { startTestServer } from "../helpers/test-app.js";

function waitForOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
}

interface AppBroadcastHub {
  notifyAppsChanged(): void;
}

interface SystemBroadcastHub {
  notifySystem(changes: SystemChangeKind[]): void;
}

interface ThreadBroadcastHub {
  notifyThread(threadId: string, changes: ThreadChangeKind[]): void;
}

interface ChangedBroadcast {
  changes: string[];
  entity: string;
  id?: string;
}

interface ChangedBroadcastMatchArgs {
  entity: string;
  /** Omitted means "any id" — list-level broadcasts carry none. */
  id?: string;
  kind: string;
}

function isChangedBroadcastFor(
  args: ChangedBroadcastMatchArgs,
): (message: unknown) => message is ChangedBroadcast {
  return (message): message is ChangedBroadcast =>
    typeof message === "object" &&
    message !== null &&
    "entity" in message &&
    message.entity === args.entity &&
    (args.id === undefined || ("id" in message && message.id === args.id)) &&
    "changes" in message &&
    Array.isArray(message.changes) &&
    message.changes.includes(args.kind);
}

interface WaitForSdkAppSubscriptionArgs {
  hub: AppBroadcastHub;
  waitForNextAppMessage: () => Promise<AppRealtimeEvent>;
}

interface BroadcastUntilObservedArgs {
  fire: () => void;
  observed: Promise<unknown>;
}

/**
 * Subscriptions register asynchronously server-side, so a single broadcast
 * can land before the subscription exists: keep re-firing every 25ms until
 * the observer sees one.
 */
async function broadcastUntilObserved(
  args: BroadcastUntilObservedArgs,
): Promise<void> {
  const interval = setInterval(args.fire, 25);
  try {
    args.fire();
    await args.observed;
  } finally {
    clearInterval(interval);
  }
}

function waitForClose(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once("close", () => resolve());
    socket.once("error", reject);
  });
}

function waitForMatchingMessage<T>(
  socket: WebSocket,
  matches: (message: unknown) => message is T,
  timeoutMs = 3_000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off("message", onMessage);
      socket.off("error", onError);
      reject(new Error("Timed out waiting for websocket message"));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timeout);
      socket.off("message", onMessage);
      socket.off("error", onError);
    };

    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    const onMessage = (data: RawData) => {
      const message = JSON.parse(data.toString("utf8")) as unknown;
      if (!matches(message)) {
        return;
      }
      cleanup();
      resolve(message);
    };

    socket.on("message", onMessage);
    socket.on("error", onError);
  });
}

async function waitForThreadSubscription(
  hub: ThreadBroadcastHub,
  socket: WebSocket,
  threadId: string,
): Promise<void> {
  await broadcastUntilObserved({
    fire: () => hub.notifyThread(threadId, ["status-changed"]),
    observed: waitForMatchingMessage(
      socket,
      isChangedBroadcastFor({
        entity: "thread",
        id: threadId,
        kind: "status-changed",
      }),
      2_000,
    ),
  });
}

async function waitForSystemSubscription(
  hub: SystemBroadcastHub,
  socket: WebSocket,
): Promise<void> {
  await broadcastUntilObserved({
    fire: () => hub.notifySystem(["config-changed"]),
    observed: waitForMatchingMessage(
      socket,
      isChangedBroadcastFor({ entity: "system", kind: "config-changed" }),
      2_000,
    ),
  });
}

async function waitForSdkAppSubscription(
  args: WaitForSdkAppSubscriptionArgs,
): Promise<void> {
  await broadcastUntilObserved({
    fire: () => args.hub.notifyAppsChanged(),
    observed: args.waitForNextAppMessage(),
  });
}

describe("server integration", () => {
  it("closes active websocket clients during server shutdown", async () => {
    const server = await startTestServer();
    let serverClosed = false;

    try {
      const socket = new WebSocket(
        `${server.baseUrl.replace("http", "ws")}/ws`,
      );
      await waitForOpen(socket);

      const closePromise = waitForClose(socket);
      await server.close();
      serverClosed = true;
      await closePromise;

      expect(socket.readyState).toBe(WebSocket.CLOSED);
    } finally {
      if (!serverClosed) {
        await server.close();
      }
    }
  });

  it("sends events-appended websocket notifications when the append module ingests events", async () => {
    const server = await startTestServer();
    try {
      const { thread } = seedThreadFixture(server);

      const ws = new WebSocket(`${server.baseUrl.replace("http", "ws")}/ws`);
      await waitForOpen(ws);
      ws.send(
        JSON.stringify({ type: "subscribe", entity: "thread", id: thread.id }),
      );
      await waitForThreadSubscription(server.hub, ws, thread.id);

      const messagePromise = waitForMatchingMessage(
        ws,
        isChangedBroadcastFor({
          entity: "thread",
          id: thread.id,
          kind: "events-appended",
        }),
      );
      // The event append module is the ingest path now (plan §3): runtime
      // callbacks emit directly; the hub notification per appended batch is
      // the surface the frozen client relies on.
      const appender = createThreadEventAppender(server.deps);
      appender.emit({
        threadId: thread.id,
        event: {
          type: "turn/started",
          threadId: thread.id,
          providerThreadId: "provider-thread",
          scope: turnScope("turn-1"),
        },
      });
      await appender.flush();

      const message = await messagePromise;
      expect(message.changes).toContain("events-appended");
      ws.close();
    } finally {
      await server.close();
    }
  });

  it("delivers server app broadcasts to SDK bb.on consumers", async () => {
    const server = await startTestServer();
    let unsubscribeConnection: () => void = () => {};
    let unsubscribeApp: () => void = () => {};
    try {
      const sdk = createBrowserBbSdk({
        baseUrl: server.baseUrl,
        websocket: wrapNodeWsWebsocket,
      });
      const connected = new Promise<void>((resolve) => {
        unsubscribeConnection = sdk.on({
          event: "realtime:connection",
          callback(event) {
            if (event.state === "connected") {
              resolve();
            }
          },
        });
      });
      const appMessageResolvers: Array<(event: AppRealtimeEvent) => void> = [];
      const waitForNextAppMessage = () =>
        new Promise<AppRealtimeEvent>((resolve) => {
          appMessageResolvers.push(resolve);
        });
      unsubscribeApp = sdk.on({
        event: "app:changed",
        callback(event) {
          const resolve = appMessageResolvers.shift();
          if (!resolve) {
            return;
          }
          resolve(event);
        },
      });

      await connected;
      await waitForSdkAppSubscription({
        hub: server.hub,
        waitForNextAppMessage,
      });
      const received = waitForNextAppMessage();
      server.hub.notifyAppsChanged();

      await expect(received).resolves.toEqual({
        type: "changed",
        entity: "app",
        changes: ["apps-changed"],
      });
    } finally {
      unsubscribeApp();
      unsubscribeConnection();
      await server.close();
    }
  });

  it("broadcasts apps-changed to system and app subscribers via notifyGlobalAppsChanged", async () => {
    const server = await startTestServer();
    try {
      const wsUrl = `${server.baseUrl.replace("http", "ws")}/ws`;
      const systemWs = new WebSocket(wsUrl);
      const appWs = new WebSocket(wsUrl);
      await Promise.all([waitForOpen(systemWs), waitForOpen(appWs)]);

      systemWs.send(JSON.stringify({ type: "subscribe", entity: "system" }));
      appWs.send(JSON.stringify({ type: "subscribe", entity: "app" }));
      // Messages on a socket are handled in order, so confirming this later
      // "system" subscription also confirms the earlier "app" one.
      appWs.send(JSON.stringify({ type: "subscribe", entity: "system" }));
      await waitForSystemSubscription(server.hub, systemWs);
      await waitForSystemSubscription(server.hub, appWs);

      const systemMessage = waitForMatchingMessage(
        systemWs,
        isChangedBroadcastFor({ entity: "system", kind: "apps-changed" }),
      );
      const appMessage = waitForMatchingMessage(
        appWs,
        isChangedBroadcastFor({ entity: "app", kind: "apps-changed" }),
      );

      await notifyGlobalAppsChanged(server.deps);

      await expect(systemMessage).resolves.toEqual({
        type: "changed",
        entity: "system",
        changes: ["apps-changed"],
      });
      await expect(appMessage).resolves.toEqual({
        type: "changed",
        entity: "app",
        changes: ["apps-changed"],
      });

      systemWs.close();
      appWs.close();
    } finally {
      await server.close();
    }
  });

});
