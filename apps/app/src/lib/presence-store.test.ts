import { describe, expect, it } from "vitest";
import type { PresenceViewer } from "@bb/server-contract";
import { PresenceStore } from "./presence-store";

function viewer(handle: string, typing = false): PresenceViewer {
  return { handle, displayName: handle, imageUrl: null, typing };
}

describe("PresenceStore", () => {
  it("replaces a thread roster and removes it when the roster empties", () => {
    const store = new PresenceStore();
    store.setThreadViewers("thr_1", [viewer("alice"), viewer("bob")]);
    expect(store.getThreadViewers("thr_1").map((v) => v.handle)).toEqual([
      "alice",
      "bob",
    ]);

    store.setThreadViewers("thr_1", [viewer("alice")]);
    expect(store.getThreadViewers("thr_1").map((v) => v.handle)).toEqual([
      "alice",
    ]);

    store.setThreadViewers("thr_1", []);
    expect(store.getThreadViewers("thr_1")).toEqual([]);
  });

  it("patches the summary partially: merge entries, empty array removes", () => {
    const store = new PresenceStore();
    store.patchSummary({ thr_1: ["alice"], thr_2: ["bob"] });
    // A later partial patch must not disturb untouched threads.
    store.patchSummary({ thr_2: ["bob", "carol"] });
    expect(store.getSummaryHandles("thr_1")).toEqual(["alice"]);
    expect(store.getSummaryHandles("thr_2")).toEqual(["bob", "carol"]);

    store.patchSummary({ thr_1: [] });
    expect(store.getSummaryHandles("thr_1")).toEqual([]);
    expect(store.getSummaryHandles("thr_2")).toEqual(["bob", "carol"]);
  });

  it("snapshot replace flushes rosters that went stale while disconnected", () => {
    const store = new PresenceStore();
    store.setThreadViewers("thr_stale", [viewer("alice")]);
    store.patchSummary({ thr_stale: ["alice"] });

    store.replaceAll({ thr_live: [viewer("bob", true)] });

    expect(store.getThreadViewers("thr_stale")).toEqual([]);
    expect(store.getSummaryHandles("thr_stale")).toEqual([]);
    expect(store.getThreadViewers("thr_live").map((v) => v.handle)).toEqual([
      "bob",
    ]);
    // Summary handles derive from the snapshot's viewer rosters.
    expect(store.getSummaryHandles("thr_live")).toEqual(["bob"]);
  });

  it("returns a stable reference for an unchanged roster", () => {
    const store = new PresenceStore();
    store.setThreadViewers("thr_1", [viewer("alice")]);
    const first = store.getThreadViewers("thr_1");
    store.setThreadViewers("thr_2", [viewer("bob")]);
    expect(store.getThreadViewers("thr_1")).toBe(first);
  });
});
