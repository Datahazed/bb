/**
 * Local mirror of the `persistedQueryCache` experiment.
 *
 * The experiment itself is server-owned (Settings → Experiments, `/system/config`),
 * but hydration has to happen before the first render — before `/system/config`
 * can possibly have loaded. So the app mirrors the last known value into
 * localStorage; the boot path reads the mirror to decide whether to touch
 * IndexedDB at all, and `usePersistedQueryCacheSync` reconciles the mirror with
 * the server value once config resolves. The mirror is a hint, never a source of
 * truth: a stale "on" only costs one wasted hydration, after which config turns
 * it off and clears the store.
 */

export const PERSISTED_QUERY_CACHE_FLAG_STORAGE_KEY = "bb.persistedQueryCache";

export function readPersistedQueryCacheFlag(): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    return localStorage.getItem(PERSISTED_QUERY_CACHE_FLAG_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writePersistedQueryCacheFlag(enabled: boolean): void {
  if (typeof localStorage === "undefined") return;
  try {
    if (enabled) {
      localStorage.setItem(PERSISTED_QUERY_CACHE_FLAG_STORAGE_KEY, "1");
    } else {
      localStorage.removeItem(PERSISTED_QUERY_CACHE_FLAG_STORAGE_KEY);
    }
  } catch {
    // Storage can be full or blocked (private mode); the mirror is best-effort.
  }
}
