import type { QueryClient } from "@tanstack/react-query";
import {
  threadTimelineTurnSummaryDetailsQueryKey,
  type ThreadTimelineTurnSummaryDetailsQueryIdentity,
} from "../queries/query-keys";

export function invalidateActiveTurnSummaryDetails(args: {
  identity: ThreadTimelineTurnSummaryDetailsQueryIdentity;
  queryClient: QueryClient;
}): Promise<void> {
  return args.queryClient.invalidateQueries({
    exact: true,
    queryKey: threadTimelineTurnSummaryDetailsQueryKey(args.identity),
  });
}
