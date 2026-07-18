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

    const generation = store.beginSnapshot();
    store.applySnapshot({ thr_live: [viewer("bob", true)] }, generation);

    expect(store.getThreadViewers("thr_stale")).toEqual([]);
    expect(store.getSummaryHandles("thr_stale")).toEqual([]);
    expect(store.getThreadViewers("thr_live").map((v) => v.handle)).toEqual([
      "bob",
    ]);
    // Summary handles derive from the snapshot's viewer rosters.
    expect(store.getSummaryHandles("thr_live")).toEqual(["bob"]);
  });

  it("does not let an in-flight snapshot clobber a newer realtime update", () => {
    const store = new PresenceStore();
    const generation = store.beginSnapshot();
    // Arrives while the snapshot request is still in flight.
    store.setThreadViewers("thr_1", [viewer("carol", true)]);
    store.patchSummary({ thr_1: ["carol"] });

    // The (older) snapshot resolves afterward with stale data for thr_1.
    store.applySnapshot(
      { thr_1: [viewer("alice")], thr_2: [viewer("bob")] },
      generation,
    );

    expect(store.getThreadViewers("thr_1").map((v) => v.handle)).toEqual([
      "carol",
    ]);
    expect(store.getSummaryHandles("thr_1")).toEqual(["carol"]);
    // Untouched threads still seed from the snapshot.
    expect(store.getThreadViewers("thr_2").map((v) => v.handle)).toEqual([
      "bob",
    ]);
    expect(store.getSummaryHandles("thr_2")).toEqual(["bob"]);
  });

  it("does not let an in-flight snapshot resurrect a realtime removal", () => {
    const store = new PresenceStore();
    store.setThreadViewers("thr_1", [viewer("alice")]);
    store.patchSummary({ thr_1: ["alice"] });

    const generation = store.beginSnapshot();
    // The viewer leaves while the snapshot request is still in flight.
    store.setThreadViewers("thr_1", []);
    store.patchSummary({ thr_1: [] });

    // The (older) snapshot still lists the departed viewer.
    store.applySnapshot({ thr_1: [viewer("alice")] }, generation);

    expect(store.getThreadViewers("thr_1")).toEqual([]);
    expect(store.getSummaryHandles("thr_1")).toEqual([]);
  });

  it("guards viewer rosters and summaries independently", () => {
    const store = new PresenceStore();
    const generation = store.beginSnapshot();
    // Only the summary is touched while the snapshot is in flight.
    store.patchSummary({ thr_1: ["carol"] });

    store.applySnapshot({ thr_1: [viewer("alice")] }, generation);

    // The untouched roster seeds from the snapshot; the touched summary wins.
    expect(store.getThreadViewers("thr_1").map((v) => v.handle)).toEqual([
      "alice",
    ]);
    expect(store.getSummaryHandles("thr_1")).toEqual(["carol"]);
  });

  it("returns a stable reference for an unchanged roster", () => {
    const store = new PresenceStore();
    store.setThreadViewers("thr_1", [viewer("alice")]);
    const first = store.getThreadViewers("thr_1");
    store.setThreadViewers("thr_2", [viewer("bob")]);
    expect(store.getThreadViewers("thr_1")).toBe(first);
  });
});
