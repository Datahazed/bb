import ReconnectingWebSocket from "partysocket/ws";
import {
  changedMessageLenientSchema,
  pluginSignalLenientSchema,
  presenceSummaryMessageLenientSchema,
  realtimeSubscriptionTargetKey,
  threadOpenSignalLenientSchema,
  threadPaneActionSignalLenientSchema,
  threadPresenceMessageLenientSchema,
} from "@bb/server-contract";
import type {
  ClientMessage,
  ChangedMessage,
  PluginSignal,
  PresenceSummaryMessage,
  RealtimeSubscriptionTarget,
  ThreadOpenFile,
  ThreadOpenSignal,
  ThreadPaneActionSignal,
  ThreadPresenceMessage,
} from "@bb/server-contract";
import { buildDevWebSocketUrl } from "./dev-websocket-url";
import {
  getClaimedIdentityHeaderValue,
  subscribeClaimedIdentity,
} from "./claimed-identity-store";

type ChangeCallback = (message: ChangedMessage) => void;
type ThreadOpenCallback = (signal: ThreadOpenSignal) => void;
type ThreadPaneActionCallback = (signal: ThreadPaneActionSignal) => void;
type PluginSignalCallback = (signal: PluginSignal) => void;
type ThreadPresenceCallback = (message: ThreadPresenceMessage) => void;
type PresenceSummaryCallback = (message: PresenceSummaryMessage) => void;
type ConnectedCallback = (event: { reconnected: boolean }) => void;
type ConnectionStateCallback = () => void;
export type WebSocketConnectionState =
  | "connecting"
  | "connected"
  | "reconnecting";

interface ActiveSubscription {
  count: number;
  target: RealtimeSubscriptionTarget;
}

export class WebSocketManager {
  private socket: ReconnectingWebSocket | null = null;
  private subscriptions = new Map<string, ActiveSubscription>();
  private callbacks = new Set<ChangeCallback>();
  private threadOpenCallbacks = new Set<ThreadOpenCallback>();
  private threadPaneActionCallbacks = new Set<ThreadPaneActionCallback>();
  private pluginSignalCallbacks = new Set<PluginSignalCallback>();
  private threadPresenceCallbacks = new Set<ThreadPresenceCallback>();
  private presenceSummaryCallbacks = new Set<PresenceSummaryCallback>();
  // Ephemeral "open this file in the secondary panel" intents, keyed by thread.
  // Held in memory only (cleared on reload) so a thread that is not currently
  // viewed opens the file when it is next viewed. Last write wins per thread.
  private pendingOpenFileByThreadId = new Map<string, ThreadOpenFile>();
  private connectedCallbacks = new Set<ConnectedCallback>();
  private connectionStateCallbacks = new Set<ConnectionStateCallback>();
  private hasConnected = false;
  private connectionState: WebSocketConnectionState = "connecting";
  private unsubscribeIdentity: (() => void) | null = null;
  private lastIdentityHeaderValue: string | null = null;

  connect(): void {
    if (this.socket) return;

    // In dev mode, connect directly to the server to bypass Vite's WS proxy
    // which does not handle reconnection after backend restarts.
    // In production, use the same origin (server serves the app).
    // A URL provider (not a string) so every reconnect re-reads the claimed
    // identity — an identity claimed after connect rides the next upgrade.
    const buildUrl = () => {
      const url =
        buildDevWebSocketUrl({ path: "/ws" }) ??
        `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/ws`;
      const identity = getClaimedIdentityHeaderValue();
      return identity === null
        ? url
        : `${url}?identity=${encodeURIComponent(identity)}`;
    };

    this.socket = new ReconnectingWebSocket(buildUrl, undefined, {
      minReconnectionDelay: 1000,
      maxReconnectionDelay: 30000,
      reconnectionDelayGrowFactor: 1.5,
      connectionTimeout: 10000,
      maxRetries: Infinity,
    });

    this.socket.onopen = () => {
      const reconnected = this.hasConnected;
      this.hasConnected = true;
      this.setConnectionState("connected");
      // Re-subscribe to all active subscriptions
      for (const subscription of this.subscriptions.values()) {
        this.sendMessage({ type: "subscribe", target: subscription.target });
      }
      for (const callback of this.connectedCallbacks) {
        callback({ reconnected });
      }
    };

    this.socket.onmessage = (event: MessageEvent) => {
      if (typeof event.data !== "string") return;
      this.handleIncomingMessage(event.data);
    };

    this.socket.onclose = () => {
      this.setConnectionState(
        this.hasConnected ? "reconnecting" : "connecting",
      );
    };

    // The claimed identity is bound at upgrade time via ?identity=, so a
    // save/edit/clear after connect must rebind the live socket. Reconnect
    // through partysocket's own machinery: the URL provider re-reads the
    // identity, and onopen re-subscribes and reseeds presence as usual.
    this.lastIdentityHeaderValue = getClaimedIdentityHeaderValue();
    this.unsubscribeIdentity = subscribeClaimedIdentity(() => {
      const next = getClaimedIdentityHeaderValue();
      if (next === this.lastIdentityHeaderValue) {
        return;
      }
      this.lastIdentityHeaderValue = next;
      this.socket?.reconnect();
    });
  }

  /**
   * Parse and dispatch one raw server message. Public only so tests can
   * exercise the routing without a live socket.
   */
  handleIncomingMessage(data: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      // Ignore malformed messages
      return;
    }

    // Ephemeral thread-open broadcast. Notify layout listeners immediately;
    // when it includes a file, buffer that file per thread until the target
    // pane's secondary panel is ready to consume it.
    const threadOpen = threadOpenSignalLenientSchema.safeParse(parsed);
    if (threadOpen.success) {
      if (threadOpen.data.file !== null) {
        this.pendingOpenFileByThreadId.set(
          threadOpen.data.threadId,
          threadOpen.data.file,
        );
      }
      for (const cb of this.threadOpenCallbacks) {
        cb(threadOpen.data);
      }
      return;
    }

    const threadPaneAction =
      threadPaneActionSignalLenientSchema.safeParse(parsed);
    if (threadPaneAction.success) {
      for (const cb of this.threadPaneActionCallbacks) {
        cb(threadPaneAction.data);
      }
      return;
    }

    // Ephemeral plugin realtime signal (bb.realtime.publish). Not buffered:
    // only live useRealtime subscribers care, and V1 has no replay.
    const pluginSignal = pluginSignalLenientSchema.safeParse(parsed);
    if (pluginSignal.success) {
      for (const cb of this.pluginSignalCallbacks) {
        cb(pluginSignal.data);
      }
      return;
    }

    // Ephemeral presence broadcasts: per-thread viewer rosters and the compact
    // sidebar summary. Lenient parse — additive per-viewer fields from a newer
    // server degrade to defaults instead of dropping the roster.
    const threadPresence = threadPresenceMessageLenientSchema.safeParse(parsed);
    if (threadPresence.success) {
      for (const cb of this.threadPresenceCallbacks) {
        cb(threadPresence.data);
      }
      return;
    }

    const presenceSummary = presenceSummaryMessageLenientSchema.safeParse(parsed);
    if (presenceSummary.success) {
      for (const cb of this.presenceSummaryCallbacks) {
        cb(presenceSummary.data);
      }
      return;
    }

    // Lenient parse: tolerate a newer server (unknown fields stripped,
    // unknown change kinds filtered) instead of dropping whole messages
    // on additive contract changes.
    const msg = changedMessageLenientSchema.safeParse(parsed);
    if (msg.success) {
      for (const cb of this.callbacks) {
        cb(msg.data);
      }
    } else {
      console.error("Ignored invalid realtime message", msg.error);
    }
  }

  disconnect(): void {
    this.unsubscribeIdentity?.();
    this.unsubscribeIdentity = null;
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this.setConnectionState("connecting");
  }

  subscribe(target: RealtimeSubscriptionTarget): void {
    const key = realtimeSubscriptionTargetKey(target);
    const existing = this.subscriptions.get(key);
    if (existing) {
      existing.count += 1;
      return;
    }

    this.subscriptions.set(key, { count: 1, target });
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.sendMessage({ type: "subscribe", target });
    }
  }

  unsubscribe(target: RealtimeSubscriptionTarget): void {
    const key = realtimeSubscriptionTargetKey(target);
    const existing = this.subscriptions.get(key);
    if (!existing) {
      return;
    }
    if (existing.count > 1) {
      existing.count -= 1;
      return;
    }

    this.subscriptions.delete(key);
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.sendMessage({ type: "unsubscribe", target });
    }
  }

  onChanged(callback: ChangeCallback): () => void {
    this.callbacks.add(callback);
    return () => {
      this.callbacks.delete(callback);
    };
  }

  onThreadOpen(callback: ThreadOpenCallback): () => void {
    this.threadOpenCallbacks.add(callback);
    return () => {
      this.threadOpenCallbacks.delete(callback);
    };
  }

  onThreadPaneAction(callback: ThreadPaneActionCallback): () => void {
    this.threadPaneActionCallbacks.add(callback);
    return () => {
      this.threadPaneActionCallbacks.delete(callback);
    };
  }

  onPluginSignal(callback: PluginSignalCallback): () => void {
    this.pluginSignalCallbacks.add(callback);
    return () => {
      this.pluginSignalCallbacks.delete(callback);
    };
  }

  onThreadPresence(callback: ThreadPresenceCallback): () => void {
    this.threadPresenceCallbacks.add(callback);
    return () => {
      this.threadPresenceCallbacks.delete(callback);
    };
  }

  onPresenceSummary(callback: PresenceSummaryCallback): () => void {
    this.presenceSummaryCallbacks.add(callback);
    return () => {
      this.presenceSummaryCallbacks.delete(callback);
    };
  }

  /**
   * Ephemeral composer-typing signal; the server holds it under a short TTL,
   * so callers re-send `typing: true` while typing continues. Dropped silently
   * when the socket is down — presence is cosmetic.
   */
  sendTyping(threadId: string, typing: boolean): void {
    this.sendMessage({ type: "typing", threadId, typing });
  }

  /**
   * Return and clear the buffered "open file" intent for a thread, if any. The
   * secondary panel calls this when the thread becomes visible so the file
   * opens exactly once and is not re-opened on a later visit.
   */
  consumePendingOpenFile(threadId: string): ThreadOpenFile | null {
    const pending = this.pendingOpenFileByThreadId.get(threadId);
    if (!pending) {
      return null;
    }
    this.pendingOpenFileByThreadId.delete(threadId);
    return pending;
  }

  onConnected(callback: ConnectedCallback): () => void {
    this.connectedCallbacks.add(callback);
    return () => {
      this.connectedCallbacks.delete(callback);
    };
  }

  onConnectionStateChange(callback: ConnectionStateCallback): () => void {
    this.connectionStateCallbacks.add(callback);
    return () => {
      this.connectionStateCallbacks.delete(callback);
    };
  }

  getConnectionState(): WebSocketConnectionState {
    return this.connectionState;
  }

  private sendMessage(msg: ClientMessage): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(msg));
    }
  }

  private setConnectionState(nextState: WebSocketConnectionState): void {
    if (this.connectionState === nextState) {
      return;
    }
    this.connectionState = nextState;
    for (const callback of this.connectionStateCallbacks) {
      callback();
    }
  }
}

// Singleton instance — preserved across Vite HMR so the WebSocket connection
// and its state survive module re-evaluation during dev rebuilds.
function createOrReuse(): WebSocketManager {
  if (import.meta.hot?.data) {
    const existing = import.meta.hot.data.wsManager as
      | WebSocketManager
      | undefined;
    if (existing) return existing;
    const instance = new WebSocketManager();
    import.meta.hot.data.wsManager = instance;
    return instance;
  }
  return new WebSocketManager();
}

export const wsManager = createOrReuse();
