import type { QueryClient } from "@tanstack/react-query";
import type {
  SystemSelfUpdateState,
  SystemVersionResponse,
} from "@bb/server-contract";
import { systemVersionQueryKey } from "../queries/query-keys";

export interface ApplySelfUpdateStateToVersionCacheArgs {
  queryClient: QueryClient;
  selfUpdate: SystemSelfUpdateState;
}

/** Fold a schedule/cancel mutation result into the cached version response. */
export function applySelfUpdateStateToVersionCache(
  args: ApplySelfUpdateStateToVersionCacheArgs,
): void {
  args.queryClient.setQueryData<SystemVersionResponse>(
    systemVersionQueryKey(),
    (previous) =>
      previous === undefined
        ? previous
        : { ...previous, selfUpdate: args.selfUpdate },
  );
}
