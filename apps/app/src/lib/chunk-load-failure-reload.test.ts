import { describe, expect, it, vi } from "vitest";
import {
  CHUNK_LOAD_FAILURE_RELOAD_WINDOW_MS,
  createChunkLoadFailureHandler,
} from "./chunk-load-failure-reload";

function fakeEvent() {
  const event = {
    defaultPrevented: false,
    payload: new Error("Failed to fetch dynamically imported module"),
    preventDefault() {
      event.defaultPrevented = true;
    },
  };
  return event;
}

function createStorage(): Pick<Storage, "getItem" | "setItem"> {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

describe("createChunkLoadFailureHandler", () => {
  it("reloads once and swallows the error, then lets a repeat inside the window propagate", () => {
    let now = 1_000_000;
    const storage = createStorage();
    const reload = vi.fn();
    const deps = { now: () => now, reload, storage, warn: () => undefined };

    // First failure on a fresh tab: reload and prevent the throw.
    const first = fakeEvent();
    createChunkLoadFailureHandler(deps)(first);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(first.defaultPrevented).toBe(true);

    // The reloaded page fails again seconds later (broken deploy / offline):
    // no second reload, the error reaches the boundary.
    now += 5_000;
    const second = fakeEvent();
    createChunkLoadFailureHandler(deps)(second);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(second.defaultPrevented).toBe(false);

    // Well after the window a new update may legitimately break chunks again.
    now += CHUNK_LOAD_FAILURE_RELOAD_WINDOW_MS + 1;
    const third = fakeEvent();
    createChunkLoadFailureHandler(deps)(third);
    expect(reload).toHaveBeenCalledTimes(2);
    expect(third.defaultPrevented).toBe(true);
  });

  it("collapses concurrent failures of one page into a single reload", () => {
    const reload = vi.fn();
    const handler = createChunkLoadFailureHandler({
      now: () => 42,
      reload,
      storage: null,
      warn: () => undefined,
    });
    const first = fakeEvent();
    const second = fakeEvent();
    handler(first);
    handler(second);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(second.defaultPrevented).toBe(true);
  });
});
