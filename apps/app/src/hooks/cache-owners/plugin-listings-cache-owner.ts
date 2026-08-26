import type { QueryClient } from "@tanstack/react-query";
import { pluginListingsQueryKey } from "../queries/query-keys";

/** Refetch authored listing lifecycle state after consuming a notice. */
export function invalidatePluginListings(args: {
  queryClient: QueryClient;
}): Promise<void> {
  return args.queryClient.invalidateQueries({
    queryKey: pluginListingsQueryKey(),
  });
}
