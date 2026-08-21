import { describe, expect, it, vi } from "vitest";
import type { ThreadTimelineResponse } from "@bb/server-contract";
import type { ThreadTimelinePageRequest } from "../../../src/services/threads/timeline-pagination.js";
import {
  buildThreadTimelineParamsKey,
  createThreadTimelineCache,
  type ThreadTimelineCacheKeyArgs,
} from "../../../src/services/threads/timeline-cache.js";

function makeResponse(rowCount: number): ThreadTimelineResponse {
  return {
    rows: Array.from({ length: rowCount }, (_, index) => ({
      id: `row-${index}`,
      kind: "system",
      threadId: "thr_x",
      turnId: null,
      sourceSeqStart: index,
      sourceSeqEnd: index,
      startedAt: 0,
      createdAt: 0,
      systemKind: "debug",
      title: "t",
      detail: null,
      status: null,
    })),
    activePromptMode: null,
    activeThinking: null,
    activeWorkflows: [],
    activeBackgroundCommands: [],
    pendingTodos: null,
    goal: null,
    modelFallback: null,
    maxSeq: 0,
    timelinePage: {
      kind: "latest",
      segmentLimit: 20,
      returnedSegmentCount: 0,
      hasOlderRows: false,
      olderCursor: null,
    },
  };
}

const latestPage: ThreadTimelinePageRequest = {
  kind: "latest",
  segmentLimit: 20,
};

const baseKeyArgs: ThreadTimelineCacheKeyArgs = {
  threadId: "thr_x",
  status: "idle",
  environmentId: null,
  page: latestPage,
  includeNestedRows: false,
  summaryOnly: false,
  includeProviderUnhandledOperations: false,
};

const k = (paramsKey: string, maxSeq = 1) => ({ paramsKey, maxSeq });

describe("createThreadTimelineCache", () => {
  it("builds once for the same shape and revision and serves cached on repeat", () => {
    const cache = createThreadTimelineCache();
    const build = vi.fn(() => makeResponse(3));

    const first = cache.getOrBuild(k("k"), build);
    const second = cache.getOrBuild(k("k"), build);

    expect(build).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    expect(cache.size).toBe(1);
  });

  it("rebuilds on a new maxSeq and replaces the prior revision of the same shape", () => {
    const cache = createThreadTimelineCache();
    const build = vi.fn(() => makeResponse(3));

    cache.getOrBuild(k("k", 10), build);
    cache.getOrBuild(k("k", 11), build);

    expect(build).toHaveBeenCalledTimes(2);
    expect(cache.size).toBe(1);
  });

  it("never returns a newer revision to a request for an older maxSeq", () => {
    const cache = createThreadTimelineCache();
    const newer = makeResponse(2);
    cache.getOrBuild(k("k", 11), () => newer);
    const rebuilt = makeResponse(1);
    const served = cache.getOrBuild(k("k", 10), () => rebuilt);
    expect(served).toBe(rebuilt);
  });

  it("retains separate request shapes independently", () => {
    const cache = createThreadTimelineCache();
    const build = vi.fn(() => makeResponse(3));

    cache.getOrBuild(k("latest", 10), build);
    cache.getOrBuild(k("older:5", 10), build);

    expect(cache.size).toBe(2);
  });

  it("does not cache responses above the row cap (streaming expanded turns)", () => {
    const cache = createThreadTimelineCache({ maxCacheableRows: 5 });
    const build = vi.fn(() => makeResponse(50));

    cache.getOrBuild(k("k"), build);
    cache.getOrBuild(k("k"), build);

    expect(build).toHaveBeenCalledTimes(2);
    expect(cache.size).toBe(0);
  });

  it("drops a cached revision when its replacement is above the row cap", () => {
    const cache = createThreadTimelineCache({ maxCacheableRows: 5 });

    cache.getOrBuild(k("k", 1), () => makeResponse(3));
    expect(cache.size).toBe(1);
    cache.getOrBuild(k("k", 2), () => makeResponse(50));
    expect(cache.size).toBe(0);
  });

  it("evicts least-recently-used entries beyond maxEntries", () => {
    const cache = createThreadTimelineCache({ maxEntries: 2 });
    const build = vi.fn(() => makeResponse(1));

    cache.getOrBuild(k("a"), build); // [a]
    cache.getOrBuild(k("b"), build); // [a,b]
    cache.getOrBuild(k("a"), build); // touch a -> [b,a]
    cache.getOrBuild(k("c"), build); // evict b -> [a,c]

    expect(cache.size).toBe(2);
    const buildAgain = vi.fn(() => makeResponse(1));
    cache.getOrBuild(k("a"), buildAgain); // still cached
    cache.getOrBuild(k("b"), buildAgain); // evicted -> rebuild
    expect(buildAgain).toHaveBeenCalledTimes(1);
  });
});

describe("buildThreadTimelineParamsKey", () => {
  it("differs when any projection input differs", () => {
    const base = buildThreadTimelineParamsKey(baseKeyArgs);
    const variants: ThreadTimelineCacheKeyArgs[] = [
      { ...baseKeyArgs, status: "active" },
      { ...baseKeyArgs, environmentId: "env_1" },
      { ...baseKeyArgs, includeNestedRows: true },
      { ...baseKeyArgs, summaryOnly: true },
      { ...baseKeyArgs, includeProviderUnhandledOperations: true },
      {
        ...baseKeyArgs,
        page: {
          kind: "older",
          segmentLimit: 20,
          beforeCursor: { anchorSeq: 5, anchorId: "a5" },
        },
      },
    ];
    for (const variant of variants) {
      expect(buildThreadTimelineParamsKey(variant)).not.toBe(base);
    }
  });

  it("distinguishes older-page cursors", () => {
    const cursorA = buildThreadTimelineParamsKey({
      ...baseKeyArgs,
      page: {
        kind: "older",
        segmentLimit: 20,
        beforeCursor: { anchorSeq: 5, anchorId: "a5" },
      },
    });
    const cursorB = buildThreadTimelineParamsKey({
      ...baseKeyArgs,
      page: {
        kind: "older",
        segmentLimit: 20,
        beforeCursor: { anchorSeq: 6, anchorId: "a6" },
      },
    });
    expect(cursorA).not.toBe(cursorB);
  });
});
