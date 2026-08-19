import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSystemConfig } from "@/hooks/queries/system-queries";
import {
  readPersistedQueryCacheFlag,
  writePersistedQueryCacheFlag,
} from "@/lib/persisted-query-cache/persisted-query-cache-flag";
import { startPersistedQueryCachePersister } from "@/lib/persisted-query-cache/persisted-query-cache";
import {
  createIndexedDbPersistedQueryCacheStore,
  isIndexedDbAvailable,
} from "@/lib/persisted-query-cache/persisted-query-cache-store";

/**
 * Reconcile the `persistedQueryCache` experiment with this browser: mirror the
 * server value into localStorage (so the next launch knows whether to hydrate
 * before `/system/config` can load), run the persister while the experiment is
 * on, and clear the store when it turns off. Hydration itself happens in
 * `main.tsx` before the first render.
 */
export function usePersistedQueryCacheSync(): void {
  const queryClient = useQueryClient();
  const { data } = useSystemConfig();
  const enabled = data?.experiments.persistedQueryCache;

  useEffect(() => {
    if (enabled === undefined || !isIndexedDbAvailable()) return;
    const wasEnabled = readPersistedQueryCacheFlag();
    writePersistedQueryCacheFlag(enabled);
    const store = createIndexedDbPersistedQueryCacheStore();
    if (!enabled) {
      if (wasEnabled) void store.clear();
      return;
    }
    const persister = startPersistedQueryCachePersister({
      queryClient,
      store,
      onDisabled: (error) => {
        console.warn(
          "[bb] persisted query cache disabled for this session",
          error,
        );
      },
    });
    return () => persister.stop();
  }, [enabled, queryClient]);
}
