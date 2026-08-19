import { useQuery } from "@tanstack/react-query";
import type { ThreadTabsResponse } from "@bb/server-contract";
import { sdk } from "@/lib/sdk";
import { threadTabsQueryKey } from "./query-keys";
import { RESUME_REFETCH_QUERY_POLICY } from "./query-policies";
import { THREAD_DETAIL_SEEDED_STALE_TIME_MS } from "./query-helpers";

interface ThreadTabsQueryOptions {
  enabled?: boolean;
}

export function useThreadTabs(
  threadId: string,
  options?: ThreadTabsQueryOptions,
) {
  const enabled = (options?.enabled ?? true) && threadId.length > 0;

  return useQuery<ThreadTabsResponse>({
    queryKey: threadTabsQueryKey(threadId),
    queryFn: ({ signal }) => sdk.threads.tabs.get({ threadId, signal }),
    enabled,
    ...RESUME_REFETCH_QUERY_POLICY,
    staleTime: THREAD_DETAIL_SEEDED_STALE_TIME_MS,
  });
}
