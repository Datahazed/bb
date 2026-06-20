import {
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import type { ThreadComposerBootstrapResponse } from "@bb/server-contract";
import { apiClient } from "@/lib/api-server";
import { request, requestOptions } from "@/lib/api";
import { hydrateThreadComposerBootstrap } from "../cache-owners/composer-cache-owner";
import { requireEnabledQueryArg } from "./query-helpers";

export const THREAD_COMPOSER_BOOTSTRAP_QUERY_KEY = "threadComposerBootstrap";

export type ThreadComposerBootstrapQueryKey = readonly [
  typeof THREAD_COMPOSER_BOOTSTRAP_QUERY_KEY,
  string | null,
  string,
];
export type ThreadComposerBootstrapEnvironmentQueryKeyPrefix = readonly [
  typeof THREAD_COMPOSER_BOOTSTRAP_QUERY_KEY,
  string | null,
];

interface ThreadComposerBootstrapQueryOptions {
  enabled?: boolean;
  environmentId?: string;
  providerId?: string;
  refetchOnMount?: boolean | "always";
  staleTime?: number;
}

interface FetchAndHydrateThreadComposerBootstrapArgs {
  environmentId: string | null;
  providerId: string | null;
  queryClient: QueryClient;
  signal?: AbortSignal;
  threadId: string;
}

const THREAD_COMPOSER_BOOTSTRAP_STALE_TIME_MS = 10_000;
// Keep the composer bootstrap cached for the same window React Query retains the
// data it gates (default gcTime, 5 min). This query is the readiness gate for the
// composer + queued-message drawer (`hasData → ready`), so when its cache is
// evicted, switching back to a thread drops the gate (`enabled=false`, the queued
// query id collapses to "") and the expanded drawer empties and reloads after a
// fresh round-trip. A short eviction window made rapid thread switching — even
// returning to a just-visited thread — reload the drawer every time. Realtime
// cache-owner updates plus the staleTime-driven background refetch keep the
// retained cache fresh, so holding it longer is safe.
const THREAD_COMPOSER_BOOTSTRAP_GC_TIME_MS = 5 * 60_000;

function requireThreadId(id: string, hookName: string): string {
  return requireEnabledQueryArg({ value: id, hookName, argName: "thread id" });
}

export function threadComposerBootstrapQueryKey(
  threadId: string,
  environmentId: string | null,
): ThreadComposerBootstrapQueryKey {
  return [THREAD_COMPOSER_BOOTSTRAP_QUERY_KEY, environmentId, threadId];
}

export function threadComposerBootstrapEnvironmentQueryKeyPrefix(
  environmentId: string | null,
): ThreadComposerBootstrapEnvironmentQueryKeyPrefix {
  return [THREAD_COMPOSER_BOOTSTRAP_QUERY_KEY, environmentId];
}

export function fetchThreadComposerBootstrap(
  threadId: string,
  signal?: AbortSignal,
): Promise<ThreadComposerBootstrapResponse> {
  return request<ThreadComposerBootstrapResponse>(
    apiClient.threads[":id"]["composer-bootstrap"].$get(
      {
        param: { id: threadId },
      },
      requestOptions(signal),
    ),
  );
}

export async function fetchAndHydrateThreadComposerBootstrap({
  environmentId,
  providerId,
  queryClient,
  signal,
  threadId,
}: FetchAndHydrateThreadComposerBootstrapArgs): Promise<ThreadComposerBootstrapResponse> {
  const bootstrap = await fetchThreadComposerBootstrap(threadId, signal);
  hydrateThreadComposerBootstrap({
    bootstrap,
    environmentId,
    providerId,
    queryClient,
    threadId,
  });
  return bootstrap;
}

export function useThreadComposerBootstrap(
  id: string,
  options?: ThreadComposerBootstrapQueryOptions,
) {
  const queryClient = useQueryClient();
  const environmentId = options?.environmentId ?? null;
  const providerId = options?.providerId ?? null;

  return useQuery<ThreadComposerBootstrapResponse>({
    queryKey: threadComposerBootstrapQueryKey(id, environmentId),
    queryFn: ({ signal }) =>
      fetchAndHydrateThreadComposerBootstrap({
        environmentId,
        providerId,
        queryClient,
        signal,
        threadId: requireThreadId(id, "useThreadComposerBootstrap"),
      }),
    enabled: (options?.enabled ?? true) && Boolean(id),
    refetchOnMount: options?.refetchOnMount ?? true,
    refetchOnWindowFocus: false,
    staleTime: options?.staleTime ?? THREAD_COMPOSER_BOOTSTRAP_STALE_TIME_MS,
    gcTime: THREAD_COMPOSER_BOOTSTRAP_GC_TIME_MS,
  });
}
