import type { QueryClient } from "@tanstack/react-query";
import { sdk } from "@/lib/sdk";
import { hostProviderCliStatusQueryKey } from "../queries/query-keys";

interface HostProviderCliStatusCacheArgs {
  queryClient: QueryClient;
  hostId: string;
}

/** Re-fetch a host's provider CLI health after an install/update. */
export function invalidateHostProviderCliStatus(
  args: HostProviderCliStatusCacheArgs,
): Promise<void> {
  return args.queryClient.invalidateQueries({
    queryKey: hostProviderCliStatusQueryKey(args.hostId),
  });
}

/**
 * A manual check ("Check for updates", "Check this machine's CLIs again").
 * The server memoizes each host's CLI status for minutes, so a plain
 * invalidation would re-ask and get the same memoized answer; this fetch
 * carries `force` to re-probe the host. It writes into the same Query the
 * inventory observers read, so `isFetching` and error state follow, and a
 * rejection is swallowed: one unreachable host must not fail the whole check,
 * which invalidation never did either.
 */
export async function recheckHostProviderCliStatus(
  args: HostProviderCliStatusCacheArgs,
): Promise<void> {
  const queryKey = hostProviderCliStatusQueryKey(args.hostId);
  // fetchQuery joins a fetch already in flight instead of starting its own,
  // so a check issued while the plain boot/mount fetch is pending would never
  // send `force` and would report that fetch's memoized answer as a fresh
  // probe. Cancel the plain fetch first (its request carries the abort
  // signal); observers keep following the same Query.
  await args.queryClient.cancelQueries({ queryKey });
  return args.queryClient
    .fetchQuery({
      queryKey,
      queryFn: ({ signal }) =>
        sdk.hosts.providerCliStatus({
          hostId: args.hostId,
          force: true,
          signal,
        }),
      staleTime: 0,
    })
    .then(
      () => undefined,
      () => undefined,
    );
}
