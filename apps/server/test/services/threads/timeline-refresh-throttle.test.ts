import { describe, expect, it } from "vitest";
import type { ThreadTimelineResponse } from "@bb/server-contract";
import { createTimelineRefreshThrottle } from "../../../src/services/threads/timeline-refresh-throttle.js";

function response(maxSeq: number): ThreadTimelineResponse {
  return {
    maxSeq,
    rows: [],
    activePromptMode: null,
    activeThinking: null,
    activeWorkflows: [],
    activeBackgroundCommands: [],
    pendingTodos: null,
    goal: null,
    modelFallback: null,
    timelinePage: {
      kind: "latest",
      segmentLimit: 20,
      returnedSegmentCount: 0,
      hasOlderRows: false,
      olderCursor: null,
    },
  };
}

describe("timeline refresh throttle", () => {
  it("never throttles cheap builds", () => {
    const throttle = createTimelineRefreshThrottle();
    throttle.record("key", response(10), 50, 1_000);
    expect(throttle.getStale("key", 1_001)).toBeNull();
  });

  it("holds an expensive build for a few build costs, then releases", () => {
    const throttle = createTimelineRefreshThrottle();
    const held = response(10);
    throttle.record("key", held, 500, 1_000);
    expect(throttle.getStale("key", 1_100)).toBe(held);
    expect(throttle.getStale("key", 2_999)).toBe(held);
    expect(throttle.getStale("key", 3_001)).toBeNull();
  });

  it("caps the hold at ten seconds however slow the build", () => {
    const throttle = createTimelineRefreshThrottle();
    const held = response(10);
    throttle.record("key", held, 60_000, 1_000);
    expect(throttle.getStale("key", 10_999)).toBe(held);
    expect(throttle.getStale("key", 11_001)).toBeNull();
  });

  it("keys entries by params key", () => {
    const throttle = createTimelineRefreshThrottle();
    throttle.record("key-a", response(10), 500, 1_000);
    expect(throttle.getStale("key-b", 1_001)).toBeNull();
  });
});
