import type { QueryClient } from "@tanstack/react-query";
import { pluginListingsQueryKey } from "../queries/query-keys";

export function invalidatePluginListings(args: {
  queryClient: QueryClient;
}): Promise<void> {
  return args.queryClient.invalidateQueries({
    queryKey: pluginListingsQueryKey(),
  });
}
