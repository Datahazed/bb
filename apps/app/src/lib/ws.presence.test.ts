import { describe, expect, it, vi } from "vitest";
import { WebSocketManager } from "./ws";

describe("WebSocketManager presence routing", () => {
  it("dispatches thread-presence rosters with lenient per-viewer defaults", () => {
    const manager = new WebSocketManager();
    const received = vi.fn();
    manager.onThreadPresence(received);

    manager.handleIncomingMessage(
      JSON.stringify({
        type: "thread-presence",
        threadId: "thr_1",
        viewers: [
          {
            handle: "alice",
            displayName: "Alice",
            imageUrl: null,
            typing: true,
            // Additive field from a newer server must not drop the roster.
            futureField: "ignored",
          },
        ],
      }),
    );

    expect(received).toHaveBeenCalledTimes(1);
    expect(received.mock.calls[0]?.[0]).toEqual({
      type: "thread-presence",
      threadId: "thr_1",
      viewers: [
        { handle: "alice", displayName: "Alice", imageUrl: null, typing: true },
      ],
    });
  });

  it("dispatches presence-summary patches including empty-array removals", () => {
    const manager = new WebSocketManager();
    const received = vi.fn();
    manager.onPresenceSummary(received);

    manager.handleIncomingMessage(
      JSON.stringify({
        type: "presence-summary",
        threads: { thr_1: ["alice"], thr_2: [] },
      }),
    );

    expect(received).toHaveBeenCalledWith({
      type: "presence-summary",
      threads: { thr_1: ["alice"], thr_2: [] },
    });
  });

  it("does not misroute presence messages to changed-message subscribers", () => {
    const manager = new WebSocketManager();
    const changed = vi.fn();
    manager.onChanged(changed);

    manager.handleIncomingMessage(
      JSON.stringify({
        type: "thread-presence",
        threadId: "thr_1",
        viewers: [],
      }),
    );

    expect(changed).not.toHaveBeenCalled();
  });
});
