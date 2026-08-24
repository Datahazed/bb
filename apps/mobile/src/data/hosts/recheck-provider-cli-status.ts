import type { HostProviderCliStatusResponse } from "@bb/server-contract";
import type { QueryClient } from "@tanstack/react-query";
import { hostProviderCliStatusQueryKey } from "@/lib/query/query-keys";
import type { ProfileClient } from "@/lib/sdk/client-registry";

/** The slice of a profile client a forced CLI status re-probe needs. */
export interface ProviderCliStatusClient {
  sdk: { hosts: Pick<ProfileClient["sdk"]["hosts"], "providerCliStatus"> };
}

/**
 * A manual "Recheck provider CLIs" / "Check for updates". The server memoizes
 * each host's CLI status for minutes, so a plain refetch or invalidation would
 * get the memoized answer back; this fetch carries `force` to re-probe the
 * host. It writes into the same Query `useHostProviderCliStatus` observes
 * (spinner and error state follow), and swallows the rejection so one
 * unreachable host does not fail a fleet-wide check.
 */
export async function recheckHostProviderCliStatus(
  client: ProviderCliStatusClient,
  queryClient: QueryClient,
  hostId: string,
): Promise<void> {
  const queryKey = hostProviderCliStatusQueryKey(hostId);
  // fetchQuery joins a fetch already in flight instead of starting its own,
  // so a check tapped while the screen's plain fetch (or a realtime
  // invalidation refetch) is pending would never send `force` and would
  // report that fetch's memoized answer as a fresh probe. Cancel the plain
  // fetch first (its request carries the abort signal); observers keep
  // following the same Query.
  await queryClient.cancelQueries({ queryKey });
  return queryClient
    .fetchQuery<HostProviderCliStatusResponse>({
      queryKey,
      queryFn: ({ signal }) =>
        client.sdk.hosts.providerCliStatus({ hostId, force: true, signal }),
      staleTime: 0,
    })
    .then(
      () => undefined,
      () => undefined,
    );
}
