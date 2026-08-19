import { hashKey, useQueryClient } from "@tanstack/react-query";
import { useCallback, useSyncExternalStore } from "react";
import { threadDetailBootstrapQueryKey } from "./query-keys";

/**
 * True while the thread-detail bootstrap (`GET /threads/:id?include=`) for
 * this thread is still pending, so a per-thread hook the bootstrap seeds can
 * wait for the bundle instead of issuing its own request in parallel.
 *
 * `useQuery` decides whether to fetch when its observer subscribes, using the
 * `enabled` value computed during render. Hooks that mount in the same commit
 * as `useThreadDetailBootstrap` (thread tabs, the layout's pending-interaction
 * probe) therefore cannot see the bootstrap fetch start; they only see the
 * bootstrap query already sitting in the cache with `status: "pending"`.
 * That is the signal read here.
 *
 * Only gate hooks that always render underneath an active
 * `useThreadDetailBootstrap` for the same thread (the thread-detail tree). A
 * bootstrap query left `pending` in the cache with no active observer would
 * otherwise keep the gated hook disabled until it is garbage collected.
 */
export function useIsThreadDetailBootstrapPending(threadId: string): boolean {
  const queryClient = useQueryClient();
  const queryHash =
    threadId.length > 0
      ? hashKey(threadDetailBootstrapQueryKey(threadId))
      : null;
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (queryHash === null) {
        return () => {};
      }
      return queryClient.getQueryCache().subscribe((event) => {
        if (event.query.queryHash === queryHash) {
          onStoreChange();
        }
      });
    },
    [queryClient, queryHash],
  );
  const getSnapshot = useCallback(
    () =>
      queryHash !== null &&
      queryClient.getQueryCache().get(queryHash)?.state.status === "pending",
    [queryClient, queryHash],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
