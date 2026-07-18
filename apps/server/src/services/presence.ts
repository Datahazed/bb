import type { ClaimedIdentity, PresenceViewer } from "@bb/domain";
import { getSocketActor } from "../ws/socket-actors.js";

export const PRESENCE_TYPING_TTL_MS = 6_000;

interface ViewerState {
  actorsBySocket: Map<object, ClaimedIdentity>;
  typingTimeoutsBySocket: Map<object, ReturnType<typeof setTimeout>>;
}

interface PresenceServiceArgs {
  onThreadChanged(threadId: string, viewers: readonly PresenceViewer[]): void;
  typingTtlMs?: number;
}

export interface PresenceSnapshot {
  threads: Record<string, readonly PresenceViewer[]>;
}

export type PresenceSubscriptionResult = "changed" | "ignored" | "unchanged";

/**
 * Ephemeral presence derived from thread-detail subscriptions. The service
 * retains one entry per handle and reference-counts that handle's sockets, so
 * multiple tabs or devices still render as one viewer.
 */
export class PresenceService {
  private readonly handlesByThreadBySocket = new WeakMap<
    object,
    Map<string, string>
  >();
  private readonly lastEmittedRosterByThread = new Map<string, string>();
  private readonly onThreadChanged: PresenceServiceArgs["onThreadChanged"];
  private readonly typingTtlMs: number;
  private readonly viewersByThread = new Map<
    string,
    Map<string, ViewerState>
  >();

  constructor(args: PresenceServiceArgs) {
    this.onThreadChanged = args.onThreadChanged;
    this.typingTtlMs = args.typingTtlMs ?? PRESENCE_TYPING_TTL_MS;
  }

  subscribe(threadId: string, socket: object): PresenceSubscriptionResult {
    const actor = getSocketActor(socket);
    if (actor === null) {
      return "ignored";
    }

    const handlesByThread =
      this.handlesByThreadBySocket.get(socket) ?? new Map<string, string>();
    if (handlesByThread.has(threadId)) {
      return "ignored";
    }
    handlesByThread.set(threadId, actor.handle);
    this.handlesByThreadBySocket.set(socket, handlesByThread);

    const viewers =
      this.viewersByThread.get(threadId) ?? new Map<string, ViewerState>();
    const viewer = viewers.get(actor.handle) ?? {
      actorsBySocket: new Map<object, ClaimedIdentity>(),
      typingTimeoutsBySocket: new Map<object, ReturnType<typeof setTimeout>>(),
    };
    viewer.actorsBySocket.set(socket, actor);
    viewers.set(actor.handle, viewer);
    this.viewersByThread.set(threadId, viewers);
    return this.emitIfChanged(threadId) ? "changed" : "unchanged";
  }

  unsubscribe(threadId: string, socket: object): void {
    const handlesByThread = this.handlesByThreadBySocket.get(socket);
    if (handlesByThread === undefined) {
      return;
    }
    const handle = handlesByThread.get(threadId);
    if (handle === undefined) {
      return;
    }
    handlesByThread.delete(threadId);
    if (handlesByThread.size === 0) {
      this.handlesByThreadBySocket.delete(socket);
    }

    const viewers = this.viewersByThread.get(threadId);
    const viewer = viewers?.get(handle);
    if (viewer === undefined || viewers === undefined) {
      return;
    }
    this.clearSocketTyping(viewer, socket);
    viewer.actorsBySocket.delete(socket);
    if (viewer.actorsBySocket.size === 0) {
      viewers.delete(handle);
    }
    if (viewers.size === 0) {
      this.viewersByThread.delete(threadId);
    }
    this.emitIfChanged(threadId);
  }

  setTyping(socket: object, threadId: string, typing: boolean): void {
    const handle = this.handlesByThreadBySocket.get(socket)?.get(threadId);
    if (handle === undefined) {
      return;
    }
    const viewer = this.viewersByThread.get(threadId)?.get(handle);
    if (viewer === undefined) {
      return;
    }

    const wasTyping = viewer.typingTimeoutsBySocket.size > 0;
    this.clearSocketTyping(viewer, socket);
    if (!typing) {
      if (wasTyping && viewer.typingTimeoutsBySocket.size === 0) {
        this.emitIfChanged(threadId);
      }
      return;
    }

    const typingTimeout = setTimeout(() => {
      if (viewer.typingTimeoutsBySocket.get(socket) !== typingTimeout) {
        return;
      }
      viewer.typingTimeoutsBySocket.delete(socket);
      if (viewer.typingTimeoutsBySocket.size === 0) {
        this.emitIfChanged(threadId);
      }
    }, this.typingTtlMs);
    typingTimeout.unref();
    viewer.typingTimeoutsBySocket.set(socket, typingTimeout);

    if (!wasTyping) {
      this.emitIfChanged(threadId);
    }
  }

  snapshot(): PresenceSnapshot {
    const threads: Record<string, readonly PresenceViewer[]> = {};
    for (const threadId of [...this.viewersByThread.keys()].sort()) {
      const viewers = this.rosterForThread(threadId);
      if (viewers.length > 0) {
        threads[threadId] = viewers;
      }
    }
    return { threads };
  }

  private clearSocketTyping(viewer: ViewerState, socket: object): void {
    const typingTimeout = viewer.typingTimeoutsBySocket.get(socket);
    if (typingTimeout === undefined) {
      return;
    }
    clearTimeout(typingTimeout);
    viewer.typingTimeoutsBySocket.delete(socket);
  }

  private emitIfChanged(threadId: string): boolean {
    const roster = this.rosterForThread(threadId);
    const serialized = JSON.stringify(roster);
    if (this.lastEmittedRosterByThread.get(threadId) === serialized) {
      return false;
    }
    this.lastEmittedRosterByThread.set(threadId, serialized);
    this.onThreadChanged(threadId, roster);
    return true;
  }

  private rosterForThread(threadId: string): readonly PresenceViewer[] {
    const viewers = this.viewersByThread.get(threadId);
    if (viewers === undefined) {
      return [];
    }
    return [...viewers.entries()]
      .sort(([leftHandle], [rightHandle]) =>
        leftHandle.localeCompare(rightHandle),
      )
      .map(([handle, viewer]) => {
        const actor = this.firstActor(viewer);
        return {
          handle,
          displayName: actor.displayName,
          imageUrl: actor.imageUrl,
          typing: viewer.typingTimeoutsBySocket.size > 0,
        };
      });
  }

  private firstActor(viewer: ViewerState): ClaimedIdentity {
    for (const actor of viewer.actorsBySocket.values()) {
      return actor;
    }
    throw new Error("Presence viewer has no subscribed sockets");
  }
}
