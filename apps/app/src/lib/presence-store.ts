import { useSyncExternalStore } from "react";
import type { PresenceViewer } from "@bb/server-contract";
import { apiClient } from "./api-server";
import { request } from "./api";
import type { PresenceSnapshotResponse } from "@bb/server-contract";
import { wsManager, type WebSocketManager } from "./ws";

/**
 * Client-side presence read model, fed by the realtime socket:
 * - `thread-presence` replaces one thread's full viewer roster (empty removes)
 * - `presence-summary` is a partial patch of threadId -> viewer handles for
 *   the sidebar (an empty handle array removes the entry)
 * - the GET /api/v1/presence snapshot re-seeds everything on (re)connect,
 *   flushing rosters that went stale while the socket was down.
 *
 * All state is ephemeral — nothing persists across reloads.
 */

const EMPTY_VIEWERS: readonly PresenceViewer[] = [];
const EMPTY_HANDLES: readonly string[] = [];

export class PresenceStore {
  private viewersByThreadId = new Map<string, readonly PresenceViewer[]>();
  private summaryHandlesByThreadId = new Map<string, readonly string[]>();
  private listeners = new Set<() => void>();
  // Ordering guard for the async snapshot: every applied realtime message
  // bumps `generation` and stamps the thread ids it touched. The snapshot
  // captures the generation before its HTTP request and, when it resolves,
  // skips any thread a newer realtime message already updated or removed —
  // live broadcasts always beat the older snapshot.
  private generation = 0;
  private viewerTouchGeneration = new Map<string, number>();
  private summaryTouchGeneration = new Map<string, number>();

  attach(manager: WebSocketManager): () => void {
    const unsubscribePresence = manager.onThreadPresence((message) => {
      this.setThreadViewers(message.threadId, message.viewers);
    });
    const unsubscribeSummary = manager.onPresenceSummary((message) => {
      this.patchSummary(message.threads);
    });
    const unsubscribeConnected = manager.onConnected(() => {
      void this.seedFromSnapshot();
    });
    return () => {
      unsubscribePresence();
      unsubscribeSummary();
      unsubscribeConnected();
    };
  }

  private async seedFromSnapshot(): Promise<void> {
    const sinceGeneration = this.beginSnapshot();
    let snapshot: PresenceSnapshotResponse;
    try {
      snapshot = await request<PresenceSnapshotResponse>(
        apiClient.presence.$get(),
      );
    } catch {
      // Presence is cosmetic; a failed seed just waits for live broadcasts.
      return;
    }
    this.applySnapshot(snapshot.threads, sinceGeneration);
  }

  /** Capture before requesting a snapshot; pass the result to applySnapshot. */
  beginSnapshot(): number {
    return this.generation;
  }

  /**
   * Apply the HTTP snapshot (complete current rosters): flush entries absent
   * from it and replace the rest — except threads a realtime message touched
   * after `sinceGeneration`, whose newer live state (including removal) wins.
   */
  applySnapshot(
    threads: Record<string, readonly PresenceViewer[]>,
    sinceGeneration: number,
  ): void {
    const untouched = (touches: Map<string, number>, threadId: string) =>
      (touches.get(threadId) ?? 0) <= sinceGeneration;
    for (const threadId of [...this.viewersByThreadId.keys()]) {
      if (
        !(threadId in threads) &&
        untouched(this.viewerTouchGeneration, threadId)
      ) {
        this.viewersByThreadId.delete(threadId);
      }
    }
    for (const threadId of [...this.summaryHandlesByThreadId.keys()]) {
      if (
        !(threadId in threads) &&
        untouched(this.summaryTouchGeneration, threadId)
      ) {
        this.summaryHandlesByThreadId.delete(threadId);
      }
    }
    for (const [threadId, viewers] of Object.entries(threads)) {
      if (untouched(this.viewerTouchGeneration, threadId)) {
        if (viewers.length === 0) {
          this.viewersByThreadId.delete(threadId);
        } else {
          this.viewersByThreadId.set(threadId, viewers);
        }
      }
      if (untouched(this.summaryTouchGeneration, threadId)) {
        if (viewers.length === 0) {
          this.summaryHandlesByThreadId.delete(threadId);
        } else {
          this.summaryHandlesByThreadId.set(
            threadId,
            viewers.map((viewer) => viewer.handle),
          );
        }
      }
    }
    this.notify();
  }

  setThreadViewers(
    threadId: string,
    viewers: readonly PresenceViewer[],
  ): void {
    this.generation += 1;
    this.viewerTouchGeneration.set(threadId, this.generation);
    if (viewers.length === 0) {
      this.viewersByThreadId.delete(threadId);
    } else {
      this.viewersByThreadId.set(threadId, viewers);
    }
    this.notify();
  }

  patchSummary(threads: Record<string, readonly string[]>): void {
    this.generation += 1;
    for (const [threadId, handles] of Object.entries(threads)) {
      this.summaryTouchGeneration.set(threadId, this.generation);
      if (handles.length === 0) {
        this.summaryHandlesByThreadId.delete(threadId);
      } else {
        this.summaryHandlesByThreadId.set(threadId, handles);
      }
    }
    this.notify();
  }

  getThreadViewers(threadId: string): readonly PresenceViewer[] {
    return this.viewersByThreadId.get(threadId) ?? EMPTY_VIEWERS;
  }

  getSummaryHandles(threadId: string): readonly string[] {
    return this.summaryHandlesByThreadId.get(threadId) ?? EMPTY_HANDLES;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

// Singleton mirroring the wsManager pattern — preserved across Vite HMR so
// presence state and its socket listeners survive module re-evaluation.
function createOrReuse(): PresenceStore {
  if (import.meta.hot?.data) {
    const existing = import.meta.hot.data.presenceStore as
      | PresenceStore
      | undefined;
    if (existing) return existing;
    const instance = new PresenceStore();
    instance.attach(wsManager);
    import.meta.hot.data.presenceStore = instance;
    return instance;
  }
  const instance = new PresenceStore();
  instance.attach(wsManager);
  return instance;
}

export const presenceStore = createOrReuse();

/** Live viewer roster for one thread (stable reference until it changes). */
export function useThreadPresenceViewers(
  threadId: string,
): readonly PresenceViewer[] {
  return useSyncExternalStore(
    presenceStore.subscribe,
    () => presenceStore.getThreadViewers(threadId),
    () => EMPTY_VIEWERS,
  );
}

/** Sidebar-summary viewer handles for one thread. */
export function useThreadPresenceSummaryHandles(
  threadId: string,
): readonly string[] {
  return useSyncExternalStore(
    presenceStore.subscribe,
    () => presenceStore.getSummaryHandles(threadId),
    () => EMPTY_HANDLES,
  );
}
