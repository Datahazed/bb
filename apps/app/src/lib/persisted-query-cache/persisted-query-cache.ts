/**
 * Persisted TanStack query cache for instant cold launches (mobile-perf J2).
 *
 * On a cold PWA launch every paint waits for the sidebar bootstrap, system
 * config and the thread's bootstrap + timeline to round-trip the network.
 * When the `persistedQueryCache` experiment is on, an allowlisted slice of the
 * query cache is written to IndexedDB and hydrated back into the client before
 * the first render, so the app paints from the last visit while fresh data
 * loads.
 *
 * Staleness is reconciled by mechanisms that already exist: hydrated entries
 * keep their original `dataUpdatedAt`, so `staleTime`-bounded queries refetch on
 * mount, the WebSocket initial-connect pass invalidates every realtime-owned
 * query with `dataUpdatedAt < connectedAt`, and a hydrated timeline window lets
 * `fetchThreadTimeline` ask for a delta instead of a full window.
 *
 * What is persisted is a closed allowlist (see {@link classifyPersistedQueryKey}):
 * the sidebar bootstrap, `/system/config`, and the bootstrap + latest timeline
 * window of the most recently updated threads. Nothing else — in particular no
 * per-plugin data, credentials, or host file previews — is ever written.
 */
import {
  hashKey,
  hydrate,
  type QueryClient,
  type QueryState,
} from "@tanstack/react-query";
import { z } from "zod";
import type { ThreadWithIncludesResponse } from "@bb/server-contract";
import { ingestThreadDetailBootstrap } from "@/hooks/cache-owners/thread-detail-cache-owner";
import {
  SIDEBAR_NAVIGATION_QUERY_KEY,
  SYSTEM_CONFIG_QUERY_KEY,
  THREAD_DETAIL_BOOTSTRAP_QUERY_KEY,
  THREAD_TIMELINE_QUERY_KEY,
} from "@/hooks/queries/query-keys";
import type { PersistedQueryCacheStore } from "./persisted-query-cache-store";

/** Bump when the envelope shape below changes; older blobs are discarded. */
export const PERSISTED_QUERY_CACHE_FORMAT_VERSION = 1;
/** Entries older than this are dropped on read and on write. */
export const PERSISTED_QUERY_CACHE_MAX_ENTRY_AGE_MS = 24 * 60 * 60_000;
/** Most recently updated threads whose bootstrap + timeline are kept. */
export const PERSISTED_QUERY_CACHE_MAX_THREADS = 5;
/**
 * Upper bound on the serialized blob (UTF-16 code units, which is what iOS
 * quota accounting approximates for strings). Well under Safari's per-origin
 * IndexedDB allowance so a full cache never trips the quota on its own.
 */
export const PERSISTED_QUERY_CACHE_MAX_BYTES = 4 * 1024 * 1024;
/** How long to wait for IndexedDB before rendering without a cache. */
export const PERSISTED_QUERY_CACHE_RESTORE_TIMEOUT_MS = 400;
/** Coalesce bursts of cache updates (a streaming turn) into one write. */
export const PERSISTED_QUERY_CACHE_WRITE_DEBOUNCE_MS = 1_500;

export type PersistedQueryKind =
  | { kind: "systemConfig" }
  | { kind: "sidebarNavigation" }
  | { kind: "threadDetailBootstrap"; threadId: string }
  | { kind: "threadTimeline"; threadId: string };

/**
 * The allowlist. Returns null for every query key that must not be persisted.
 * Keys are matched by exact shape, not prefix, so a future sub-key (for
 * example a filtered sidebar variant) is excluded until it is added here.
 */
export function classifyPersistedQueryKey(
  queryKey: ReadonlyArray<unknown>,
): PersistedQueryKind | null {
  const [head, second] = queryKey;
  if (queryKey.length === 1) {
    if (head === SYSTEM_CONFIG_QUERY_KEY) return { kind: "systemConfig" };
    if (head === SIDEBAR_NAVIGATION_QUERY_KEY) {
      return { kind: "sidebarNavigation" };
    }
    return null;
  }
  if (queryKey.length === 2 && typeof second === "string" && second !== "") {
    if (head === THREAD_DETAIL_BOOTSTRAP_QUERY_KEY) {
      return { kind: "threadDetailBootstrap", threadId: second };
    }
    if (head === THREAD_TIMELINE_QUERY_KEY) {
      return { kind: "threadTimeline", threadId: second };
    }
  }
  return null;
}

const persistedQueryCacheEntrySchema = z.object({
  queryKey: z.array(z.string()),
  dataUpdatedAt: z.number().int().nonnegative(),
  // Response payloads are treated as opaque here, exactly as TanStack's own
  // hydrate does. Shape drift across app versions is bounded by the format
  // version, the 24 h entry age, and the refetch every hydrated query gets.
  data: z.unknown(),
});

export type PersistedQueryCacheEntry = z.infer<
  typeof persistedQueryCacheEntrySchema
>;

const persistedQueryCacheEnvelopeSchema = z.object({
  format: z.literal(PERSISTED_QUERY_CACHE_FORMAT_VERSION),
  savedAt: z.number().int().nonnegative(),
  entries: z.array(persistedQueryCacheEntrySchema),
});

export interface SelectPersistedQueryCacheEntriesOptions {
  now: number;
  maxThreads?: number;
  maxBytes?: number;
  maxAgeMs?: number;
}

interface ClassifiedEntry {
  entry: PersistedQueryCacheEntry;
  kind: PersistedQueryKind;
}

function isPersistableQueryKey(
  queryKey: ReadonlyArray<unknown>,
): queryKey is string[] {
  return queryKey.every((part) => typeof part === "string");
}

/**
 * Apply the allowlist, age limit, thread cap and byte budget to a candidate
 * list. Candidates may repeat a query key (live cache plus the previous
 * snapshot); the newest `dataUpdatedAt` wins. Output order is the write order:
 * system config, sidebar, then threads newest first with the bootstrap ahead
 * of its timeline, so a byte budget trims the least valuable data first.
 */
export function selectPersistedQueryCacheEntries(
  candidates: ReadonlyArray<PersistedQueryCacheEntry>,
  {
    now,
    maxThreads = PERSISTED_QUERY_CACHE_MAX_THREADS,
    maxBytes = PERSISTED_QUERY_CACHE_MAX_BYTES,
    maxAgeMs = PERSISTED_QUERY_CACHE_MAX_ENTRY_AGE_MS,
  }: SelectPersistedQueryCacheEntriesOptions,
): PersistedQueryCacheEntry[] {
  const newestByHash = new Map<string, ClassifiedEntry>();
  for (const entry of candidates) {
    if (entry.data === undefined) continue;
    if (now - entry.dataUpdatedAt > maxAgeMs) continue;
    const kind = classifyPersistedQueryKey(entry.queryKey);
    if (kind === null) continue;
    const existing = newestByHash.get(hashKey(entry.queryKey));
    if (existing && existing.entry.dataUpdatedAt >= entry.dataUpdatedAt) {
      continue;
    }
    newestByHash.set(hashKey(entry.queryKey), { entry, kind });
  }

  let systemConfig: ClassifiedEntry | null = null;
  let sidebar: ClassifiedEntry | null = null;
  const threads = new Map<
    string,
    { bootstrap: ClassifiedEntry | null; timeline: ClassifiedEntry | null }
  >();
  for (const classified of newestByHash.values()) {
    switch (classified.kind.kind) {
      case "systemConfig":
        systemConfig = classified;
        break;
      case "sidebarNavigation":
        sidebar = classified;
        break;
      case "threadDetailBootstrap":
      case "threadTimeline": {
        const threadId = classified.kind.threadId;
        const group = threads.get(threadId) ?? {
          bootstrap: null,
          timeline: null,
        };
        if (classified.kind.kind === "threadDetailBootstrap") {
          group.bootstrap = classified;
        } else {
          group.timeline = classified;
        }
        threads.set(threadId, group);
        break;
      }
    }
  }

  const rankedThreads = [...threads.values()]
    .map((group) => ({
      group,
      recency: Math.max(
        group.bootstrap?.entry.dataUpdatedAt ?? 0,
        group.timeline?.entry.dataUpdatedAt ?? 0,
      ),
    }))
    .sort((a, b) => b.recency - a.recency)
    .slice(0, Math.max(0, maxThreads));

  const ordered: ClassifiedEntry[] = [];
  if (systemConfig) ordered.push(systemConfig);
  if (sidebar) ordered.push(sidebar);
  for (const { group } of rankedThreads) {
    if (group.bootstrap) ordered.push(group.bootstrap);
    if (group.timeline) ordered.push(group.timeline);
  }

  const selected: PersistedQueryCacheEntry[] = [];
  let usedBytes = 0;
  for (const classified of ordered) {
    const serialized = JSON.stringify(classified.entry);
    if (usedBytes + serialized.length > maxBytes) continue;
    usedBytes += serialized.length;
    selected.push(classified.entry);
  }
  return selected;
}

export function serializePersistedQueryCache(
  entries: ReadonlyArray<PersistedQueryCacheEntry>,
  savedAt: number,
): string {
  return JSON.stringify({
    format: PERSISTED_QUERY_CACHE_FORMAT_VERSION,
    savedAt,
    entries,
  });
}

/**
 * Parse a stored blob. Returns null when the blob is missing, malformed, or
 * from another format version. Individual entries that fail the allowlist or
 * the age limit are dropped rather than failing the whole read.
 */
export function parsePersistedQueryCache(
  raw: string | null,
  now: number,
): PersistedQueryCacheEntry[] | null {
  if (raw === null) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = persistedQueryCacheEnvelopeSchema.safeParse(json);
  if (!parsed.success) return null;
  return parsed.data.entries.filter(
    (entry) =>
      entry.data !== undefined &&
      classifyPersistedQueryKey(entry.queryKey) !== null &&
      now - entry.dataUpdatedAt <= PERSISTED_QUERY_CACHE_MAX_ENTRY_AGE_MS,
  );
}

function hydratedQueryState(
  entry: PersistedQueryCacheEntry,
): QueryState<unknown, Error> {
  return {
    data: entry.data,
    dataUpdateCount: 1,
    dataUpdatedAt: entry.dataUpdatedAt,
    error: null,
    errorUpdateCount: 0,
    errorUpdatedAt: 0,
    fetchFailureCount: 0,
    fetchFailureReason: null,
    fetchMeta: null,
    isInvalidated: false,
    status: "success",
    fetchStatus: "idle",
  };
}

export function collectLivePersistedQueryCacheEntries(
  queryClient: QueryClient,
): PersistedQueryCacheEntry[] {
  const entries: PersistedQueryCacheEntry[] = [];
  for (const query of queryClient.getQueryCache().getAll()) {
    if (query.state.status !== "success" || query.state.data === undefined) {
      continue;
    }
    if (!isPersistableQueryKey(query.queryKey)) continue;
    if (classifyPersistedQueryKey(query.queryKey) === null) continue;
    entries.push({
      queryKey: [...query.queryKey],
      dataUpdatedAt: query.state.dataUpdatedAt,
      data: query.state.data,
    });
  }
  return entries;
}

export type RestorePersistedQueryCacheResult =
  | { status: "hydrated"; entryCount: number }
  | { status: "empty" }
  | { status: "invalid" }
  | { status: "timeout" };

export interface RestorePersistedQueryCacheArgs {
  queryClient: QueryClient;
  store: PersistedQueryCacheStore;
  now?: number;
  timeoutMs?: number;
}

/**
 * Hydrate the client from the store, bounded by `timeoutMs` so a slow or hung
 * IndexedDB never delays first paint. A read that lands after the timeout is
 * ignored: by then observers are fetching and a late hydrate would only race
 * them. Invalid blobs are cleared so the next launch does not re-parse them.
 */
export async function restorePersistedQueryCache({
  queryClient,
  store,
  now = Date.now(),
  timeoutMs = PERSISTED_QUERY_CACHE_RESTORE_TIMEOUT_MS,
}: RestorePersistedQueryCacheArgs): Promise<RestorePersistedQueryCacheResult> {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<"timeout">((resolve) => {
    timeoutHandle = setTimeout(() => resolve("timeout"), timeoutMs);
  });
  let raw: string | null | "timeout";
  try {
    raw = await Promise.race([store.read(), timeout]);
  } catch {
    raw = null;
  } finally {
    if (timeoutHandle !== null) clearTimeout(timeoutHandle);
  }
  if (raw === "timeout") return { status: "timeout" };
  if (raw === null) return { status: "empty" };

  const entries = parsePersistedQueryCache(raw, now);
  if (entries === null) {
    void store.clear();
    return { status: "invalid" };
  }
  if (entries.length === 0) return { status: "empty" };

  hydrate(queryClient, {
    mutations: [],
    queries: entries.map((entry) => ({
      queryKey: entry.queryKey,
      queryHash: hashKey(entry.queryKey),
      state: hydratedQueryState(entry),
    })),
  });
  ingestHydratedThreadDetailBootstraps(queryClient, entries);
  return { status: "hydrated", entryCount: entries.length };
}

/**
 * The live bootstrap query seeds the `thread`, `environment` and `host` caches
 * from inside its queryFn, and the thread route reads the thread from those —
 * a hydrated bootstrap alone would still leave the page on "Loading…" until
 * `useThread` round-trips. Re-run that ingestion for every bootstrap the
 * hydrate call actually landed (fresher live data is left alone), stamped with
 * the bootstrap's own fetch time so the derived entries stay exactly as stale.
 */
function ingestHydratedThreadDetailBootstraps(
  queryClient: QueryClient,
  entries: ReadonlyArray<PersistedQueryCacheEntry>,
): void {
  for (const entry of entries) {
    if (
      classifyPersistedQueryKey(entry.queryKey)?.kind !==
      "threadDetailBootstrap"
    ) {
      continue;
    }
    const state = queryClient.getQueryState<ThreadWithIncludesResponse>(
      entry.queryKey,
    );
    if (
      state === undefined ||
      state.data === undefined ||
      state.dataUpdatedAt !== entry.dataUpdatedAt
    ) {
      continue;
    }
    ingestThreadDetailBootstrap({
      queryClient,
      thread: state.data,
      updatedAt: state.dataUpdatedAt,
    });
  }
}

export interface RestorePersistedQueryCacheIfEnabledArgs {
  queryClient: QueryClient;
  /** The local mirror of the experiment; false skips storage entirely. */
  isEnabled: () => boolean;
  /** Storage factory, called only when the mirror says the cache is on. */
  createStore: () => PersistedQueryCacheStore | null;
  now?: number;
  timeoutMs?: number;
}

/**
 * The boot-time gate: hydrate only when the last visit left the experiment on
 * and a store is available. Never throws — a failure here must not cost the
 * app its first render.
 */
export async function restorePersistedQueryCacheIfEnabled({
  queryClient,
  isEnabled,
  createStore,
  now,
  timeoutMs,
}: RestorePersistedQueryCacheIfEnabledArgs): Promise<
  RestorePersistedQueryCacheResult | { status: "disabled" }
> {
  if (!isEnabled()) return { status: "disabled" };
  try {
    const store = createStore();
    if (store === null) return { status: "disabled" };
    return await restorePersistedQueryCache({
      queryClient,
      store,
      ...(now === undefined ? {} : { now }),
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    });
  } catch {
    return { status: "invalid" };
  }
}

export interface PersistedQueryCachePersister {
  /** Write the current allowlisted cache now (also runs on pagehide). */
  flush(): Promise<void>;
  /** Stop observing the cache and drop any pending write. */
  stop(): void;
}

export interface StartPersistedQueryCachePersisterArgs {
  queryClient: QueryClient;
  store: PersistedQueryCacheStore;
  now?: () => number;
  debounceMs?: number;
  /** Called once when the persister disables itself after a storage failure. */
  onDisabled?: (error: unknown) => void;
}

function isQuotaExceededError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "QuotaExceededError"
  );
}

/**
 * Observe the query cache and write the allowlisted slice to the store after
 * each successful update, debounced. Writes are read-modify-write against the
 * store so entries hydrated on a previous launch and since garbage-collected
 * from memory survive until the age limit or the thread cap evicts them.
 * Any storage failure (iOS quota, private mode, a blocked database) disables
 * the persister for the rest of the session; a quota failure also clears the
 * store so the next launch does not hydrate a blob that can no longer be
 * refreshed.
 */
export function startPersistedQueryCachePersister({
  queryClient,
  store,
  now = () => Date.now(),
  debounceMs = PERSISTED_QUERY_CACHE_WRITE_DEBOUNCE_MS,
  onDisabled,
}: StartPersistedQueryCachePersisterArgs): PersistedQueryCachePersister {
  let disabled = false;
  let stopped = false;
  let dirty = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let writeChain: Promise<void> = Promise.resolve();
  // What the store held the last time we looked. Read from IndexedDB once
  // (entries hydrated on a previous launch may since have been garbage-
  // collected from memory and must survive), then carried forward from our
  // own writes so a streaming turn does not re-read and re-parse the whole
  // blob on every debounce tick.
  let previousEntries: PersistedQueryCacheEntry[] | null = null;

  const cancelTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const disable = (error: unknown) => {
    if (disabled) return;
    disabled = true;
    cancelTimer();
    onDisabled?.(error);
  };

  const writeOnce = async () => {
    if (disabled || stopped || !dirty) return;
    dirty = false;
    const timestamp = now();
    try {
      if (previousEntries === null) {
        previousEntries =
          parsePersistedQueryCache(await store.read(), timestamp) ?? [];
        // stop() may have landed during the read; the caller is gone.
        if (disabled || stopped) return;
      }
      const selected = selectPersistedQueryCacheEntries(
        [
          ...collectLivePersistedQueryCacheEntries(queryClient),
          ...previousEntries,
        ],
        { now: timestamp },
      );
      await store.write(serializePersistedQueryCache(selected, timestamp));
      previousEntries = selected;
    } catch (error) {
      previousEntries = null;
      if (isQuotaExceededError(error)) {
        await store.clear();
      }
      disable(error);
    }
  };

  const flush = (): Promise<void> => {
    cancelTimer();
    writeChain = writeChain.then(writeOnce, writeOnce);
    return writeChain;
  };

  const schedule = () => {
    if (disabled || stopped) return;
    dirty = true;
    if (timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, debounceMs);
  };

  const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== "updated" || event.action.type !== "success") return;
    if (classifyPersistedQueryKey(event.query.queryKey) === null) return;
    schedule();
  });

  const handlePageHide = () => {
    if (dirty) void flush();
  };
  const handleVisibilityChange = () => {
    if (document.visibilityState === "hidden") handlePageHide();
  };
  const hasWindow =
    typeof window !== "undefined" && typeof document !== "undefined";
  if (hasWindow) {
    window.addEventListener("pagehide", handlePageHide);
    document.addEventListener("visibilitychange", handleVisibilityChange);
  }

  // Seed the store with whatever the cache already holds (for example the
  // sidebar fetched before config resolved and turned the experiment on).
  schedule();

  return {
    flush,
    stop() {
      stopped = true;
      cancelTimer();
      unsubscribe();
      if (hasWindow) {
        window.removeEventListener("pagehide", handlePageHide);
        document.removeEventListener(
          "visibilitychange",
          handleVisibilityChange,
        );
      }
    },
  };
}
