import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  sidebarNavigationQueryKey,
  systemConfigQueryKey,
  threadDetailBootstrapQueryKey,
  threadHostFilePreviewQueryKey,
  threadsQueryKey,
  threadTimelineQueryKey,
} from "@/hooks/queries/query-keys";
import {
  classifyPersistedQueryKey,
  collectLivePersistedQueryCacheEntries,
  parsePersistedQueryCache,
  PERSISTED_QUERY_CACHE_FORMAT_VERSION,
  PERSISTED_QUERY_CACHE_MAX_ENTRY_AGE_MS,
  restorePersistedQueryCache,
  restorePersistedQueryCacheIfEnabled,
  selectPersistedQueryCacheEntries,
  serializePersistedQueryCache,
  startPersistedQueryCachePersister,
  type PersistedQueryCacheEntry,
} from "./persisted-query-cache";
import {
  createMemoryPersistedQueryCacheStore,
  type PersistedQueryCacheStore,
} from "./persisted-query-cache-store";

const NOW = 1_700_000_000_000;

function entry(
  queryKey: ReadonlyArray<string>,
  dataUpdatedAt: number,
  data: unknown = { queryKey },
): PersistedQueryCacheEntry {
  return {
    queryKey: [...queryKey],
    dataUpdatedAt,
    data,
  };
}

function seedQuery(
  queryClient: QueryClient,
  queryKey: ReadonlyArray<unknown>,
  data: unknown,
  updatedAt: number,
): void {
  queryClient.setQueryData(queryKey, data, { updatedAt });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("classifyPersistedQueryKey", () => {
  it("accepts exactly the allowlisted shapes", () => {
    expect(classifyPersistedQueryKey(sidebarNavigationQueryKey())).toEqual({
      kind: "sidebarNavigation",
    });
    expect(classifyPersistedQueryKey(systemConfigQueryKey())).toEqual({
      kind: "systemConfig",
    });
    expect(
      classifyPersistedQueryKey(threadDetailBootstrapQueryKey("thr_1")),
    ).toEqual({ kind: "threadDetailBootstrap", threadId: "thr_1" });
    expect(classifyPersistedQueryKey(threadTimelineQueryKey("thr_1"))).toEqual({
      kind: "threadTimeline",
      threadId: "thr_1",
    });
  });

  it("rejects everything else, including near misses", () => {
    expect(classifyPersistedQueryKey(threadsQueryKey())).toBeNull();
    expect(
      classifyPersistedQueryKey(
        threadHostFilePreviewQueryKey("thr_1", "env_1", "/etc/passwd"),
      ),
    ).toBeNull();
    expect(
      classifyPersistedQueryKey(["sidebarNavigation", "extra"]),
    ).toBeNull();
    expect(classifyPersistedQueryKey(["threadTimeline"])).toBeNull();
    expect(classifyPersistedQueryKey(["threadTimeline", ""])).toBeNull();
    expect(classifyPersistedQueryKey(["threadTimeline", 42])).toBeNull();
    expect(classifyPersistedQueryKey(["plugin-settings", "p"])).toBeNull();
    expect(classifyPersistedQueryKey([])).toBeNull();
  });
});

describe("selectPersistedQueryCacheEntries", () => {
  it("keeps config and sidebar plus the N most recently updated threads", () => {
    const candidates = [
      entry(sidebarNavigationQueryKey(), NOW - 10),
      entry(systemConfigQueryKey(), NOW - 20),
      entry(threadDetailBootstrapQueryKey("old"), NOW - 5_000),
      entry(threadTimelineQueryKey("old"), NOW - 6_000),
      entry(threadDetailBootstrapQueryKey("mid"), NOW - 3_000),
      // The timeline alone can make a thread recent.
      entry(threadDetailBootstrapQueryKey("fresh"), NOW - 4_000),
      entry(threadTimelineQueryKey("fresh"), NOW - 1),
      entry(threadsQueryKey(), NOW),
    ];
    const selected = selectPersistedQueryCacheEntries(candidates, {
      now: NOW,
      maxThreads: 2,
    });
    expect(selected.map((e) => e.queryKey)).toEqual([
      systemConfigQueryKey(),
      sidebarNavigationQueryKey(),
      threadDetailBootstrapQueryKey("fresh"),
      threadTimelineQueryKey("fresh"),
      threadDetailBootstrapQueryKey("mid"),
    ]);
  });

  it("dedupes by query key keeping the newest and drops expired entries", () => {
    const stale = entry(sidebarNavigationQueryKey(), NOW - 100, { v: "old" });
    const fresh = entry(sidebarNavigationQueryKey(), NOW - 1, { v: "new" });
    const expired = entry(
      threadDetailBootstrapQueryKey("t"),
      NOW - PERSISTED_QUERY_CACHE_MAX_ENTRY_AGE_MS - 1,
    );
    expect(
      selectPersistedQueryCacheEntries([stale, fresh, expired], { now: NOW }),
    ).toEqual([fresh]);
    expect(
      selectPersistedQueryCacheEntries([fresh, stale, expired], { now: NOW }),
    ).toEqual([fresh]);
  });

  it("skips entries that would exceed the byte budget, keeping earlier ones", () => {
    const sidebar = entry(sidebarNavigationQueryKey(), NOW, { s: 1 });
    const bootstrap = entry(threadDetailBootstrapQueryKey("t"), NOW, { b: 1 });
    const timeline = entry(threadTimelineQueryKey("t"), NOW, {
      rows: "x".repeat(2_000),
    });
    const budget =
      JSON.stringify(sidebar).length + JSON.stringify(bootstrap).length + 10;
    expect(
      selectPersistedQueryCacheEntries([timeline, bootstrap, sidebar], {
        now: NOW,
        maxBytes: budget,
      }),
    ).toEqual([sidebar, bootstrap]);
  });
});

describe("serialize / parse", () => {
  it("round-trips entries and drops disallowed or expired ones on read", () => {
    const good = entry(systemConfigQueryKey(), NOW - 1, {
      generalSettings: {},
    });
    const raw = serializePersistedQueryCache(
      [
        good,
        entry(threadsQueryKey(), NOW),
        entry(
          threadTimelineQueryKey("t"),
          NOW - PERSISTED_QUERY_CACHE_MAX_ENTRY_AGE_MS - 1,
        ),
      ],
      NOW,
    );
    expect(parsePersistedQueryCache(raw, NOW)).toEqual([good]);
  });

  it("rejects malformed blobs and other format versions", () => {
    expect(parsePersistedQueryCache(null, NOW)).toBeNull();
    expect(parsePersistedQueryCache("{not json", NOW)).toBeNull();
    expect(parsePersistedQueryCache("[]", NOW)).toBeNull();
    expect(
      parsePersistedQueryCache(
        JSON.stringify({
          format: PERSISTED_QUERY_CACHE_FORMAT_VERSION + 1,
          savedAt: NOW,
          entries: [],
        }),
        NOW,
      ),
    ).toBeNull();
    expect(
      parsePersistedQueryCache(
        JSON.stringify({
          format: PERSISTED_QUERY_CACHE_FORMAT_VERSION,
          savedAt: NOW,
          entries: [{ queryKey: ["systemConfig"], data: {} }],
        }),
        NOW,
      ),
    ).toBeNull();
  });
});

describe("restorePersistedQueryCache", () => {
  it("hydrates entries with their original dataUpdatedAt so reconnect invalidation still applies", async () => {
    const queryClient = new QueryClient();
    const sidebar = entry(sidebarNavigationQueryKey(), NOW - 60_000, {
      sections: [],
    });
    const store = createMemoryPersistedQueryCacheStore(
      serializePersistedQueryCache([sidebar], NOW - 60_000),
    );

    await expect(
      restorePersistedQueryCache({ queryClient, store, now: NOW }),
    ).resolves.toEqual({ status: "hydrated", entryCount: 1 });

    const state = queryClient.getQueryState(sidebarNavigationQueryKey());
    expect(state?.data).toEqual({ sections: [] });
    expect(state?.status).toBe("success");
    expect(state?.fetchStatus).toBe("idle");
    expect(state?.dataUpdatedAt).toBe(NOW - 60_000);
  });

  it("does not overwrite fresher data already in the client", async () => {
    const queryClient = new QueryClient();
    seedQuery(queryClient, systemConfigQueryKey(), { v: "live" }, NOW);
    const store = createMemoryPersistedQueryCacheStore(
      serializePersistedQueryCache(
        [entry(systemConfigQueryKey(), NOW - 1, { v: "stale" })],
        NOW - 1,
      ),
    );
    await restorePersistedQueryCache({ queryClient, store, now: NOW });
    expect(queryClient.getQueryData(systemConfigQueryKey())).toEqual({
      v: "live",
    });
  });

  it("gives up after the timeout and ignores a late read", async () => {
    vi.useFakeTimers();
    const queryClient = new QueryClient();
    let resolveRead: (value: string | null) => void = () => {};
    const store: PersistedQueryCacheStore = {
      read: () =>
        new Promise((resolve) => {
          resolveRead = resolve;
        }),
      write: () => Promise.resolve(),
      clear: () => Promise.resolve(),
    };
    const restore = restorePersistedQueryCache({
      queryClient,
      store,
      now: NOW,
      timeoutMs: 50,
    });
    await vi.advanceTimersByTimeAsync(50);
    await expect(restore).resolves.toEqual({ status: "timeout" });
    resolveRead(
      serializePersistedQueryCache([entry(systemConfigQueryKey(), NOW)], NOW),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  });

  it("clears an invalid blob instead of hydrating it", async () => {
    const queryClient = new QueryClient();
    const store = createMemoryPersistedQueryCacheStore("garbage");
    await expect(
      restorePersistedQueryCache({ queryClient, store, now: NOW }),
    ).resolves.toEqual({ status: "invalid" });
    await Promise.resolve();
    expect(store.value).toBeNull();
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  });
});

describe("restorePersistedQueryCacheIfEnabled", () => {
  it("never touches storage while the local flag is off", async () => {
    const queryClient = new QueryClient();
    const createStore = vi.fn(() => createMemoryPersistedQueryCacheStore());
    await expect(
      restorePersistedQueryCacheIfEnabled({
        queryClient,
        isEnabled: () => false,
        createStore,
      }),
    ).resolves.toEqual({ status: "disabled" });
    expect(createStore).not.toHaveBeenCalled();
  });

  it("hydrates when the flag is on and swallows store failures", async () => {
    const queryClient = new QueryClient();
    await expect(
      restorePersistedQueryCacheIfEnabled({
        queryClient,
        isEnabled: () => true,
        now: NOW,
        createStore: () =>
          createMemoryPersistedQueryCacheStore(
            serializePersistedQueryCache(
              [entry(systemConfigQueryKey(), NOW - 1, { v: 1 })],
              NOW - 1,
            ),
          ),
      }),
    ).resolves.toEqual({ status: "hydrated", entryCount: 1 });
    expect(queryClient.getQueryData(systemConfigQueryKey())).toEqual({ v: 1 });

    await expect(
      restorePersistedQueryCacheIfEnabled({
        queryClient: new QueryClient(),
        isEnabled: () => true,
        createStore: () => {
          throw new Error("no indexedDB");
        },
      }),
    ).resolves.toEqual({ status: "invalid" });
  });
});

describe("startPersistedQueryCachePersister", () => {
  it("writes only allowlisted successful queries and merges the previous snapshot", async () => {
    const queryClient = new QueryClient();
    seedQuery(queryClient, sidebarNavigationQueryKey(), { s: 1 }, NOW - 5);
    seedQuery(queryClient, threadsQueryKey(), { never: true }, NOW - 5);
    seedQuery(
      queryClient,
      threadHostFilePreviewQueryKey("t", "env", "/secret"),
      { never: true },
      NOW - 5,
    );
    // A thread hydrated last launch and since garbage-collected from memory.
    const previous = entry(threadDetailBootstrapQueryKey("gcd"), NOW - 1_000, {
      id: "gcd",
    });
    const store = createMemoryPersistedQueryCacheStore(
      serializePersistedQueryCache([previous], NOW - 1_000),
    );
    const persister = startPersistedQueryCachePersister({
      queryClient,
      store,
      now: () => NOW,
    });

    await persister.flush();
    const written = parsePersistedQueryCache(store.value, NOW);
    expect(written?.map((e) => e.queryKey)).toEqual([
      sidebarNavigationQueryKey(),
      threadDetailBootstrapQueryKey("gcd"),
    ]);
    expect(
      collectLivePersistedQueryCacheEntries(queryClient).map((e) => e.queryKey),
    ).toEqual([sidebarNavigationQueryKey()]);

    // A later successful update is picked up on the next flush.
    seedQuery(queryClient, threadTimelineQueryKey("gcd"), { rows: [] }, NOW);
    await persister.flush();
    expect(
      parsePersistedQueryCache(store.value, NOW)?.map((e) => e.queryKey),
    ).toEqual([
      sidebarNavigationQueryKey(),
      threadDetailBootstrapQueryKey("gcd"),
      threadTimelineQueryKey("gcd"),
    ]);
    persister.stop();
  });

  it("debounces cache updates into one write and stops after stop()", async () => {
    vi.useFakeTimers();
    const queryClient = new QueryClient();
    const store = createMemoryPersistedQueryCacheStore();
    const write = vi.spyOn(store, "write");
    const persister = startPersistedQueryCachePersister({
      queryClient,
      store,
      now: () => NOW,
      debounceMs: 100,
    });
    seedQuery(queryClient, sidebarNavigationQueryKey(), { s: 1 }, NOW);
    seedQuery(queryClient, sidebarNavigationQueryKey(), { s: 2 }, NOW + 1);
    await vi.advanceTimersByTimeAsync(99);
    expect(write).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(write).toHaveBeenCalledTimes(1);
    expect(
      parsePersistedQueryCache(store.value, NOW + 1)?.map((e) => e.data),
    ).toEqual([{ s: 2 }]);

    persister.stop();
    seedQuery(queryClient, sidebarNavigationQueryKey(), { s: 3 }, NOW + 2);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("clears the store and disables itself on a quota error", async () => {
    const queryClient = new QueryClient();
    seedQuery(queryClient, sidebarNavigationQueryKey(), { s: 1 }, NOW);
    const store = createMemoryPersistedQueryCacheStore("stale-blob");
    const quotaError = new DOMException("full", "QuotaExceededError");
    const write = vi.spyOn(store, "write").mockRejectedValue(quotaError);
    const onDisabled = vi.fn();
    const persister = startPersistedQueryCachePersister({
      queryClient,
      store,
      now: () => NOW,
      onDisabled,
    });

    await persister.flush();
    expect(onDisabled).toHaveBeenCalledWith(quotaError);
    expect(store.value).toBeNull();

    seedQuery(queryClient, sidebarNavigationQueryKey(), { s: 2 }, NOW + 1);
    await persister.flush();
    expect(write).toHaveBeenCalledTimes(1);
    expect(onDisabled).toHaveBeenCalledTimes(1);
    persister.stop();
  });
});
