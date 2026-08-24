import type { SystemVersionResponse } from "@bb/server-contract";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { useProfileClient } from "@/app-shell/ProfilesProvider";
import {
  systemCliSkillsQueryKey,
  systemVersionQueryKey,
} from "@/lib/query/query-keys";
import {
  useHosts,
  useHostsProviderCliStatus,
  useServerProtocolVersion,
} from "../hosts/host-queries";
import { recheckHostProviderCliStatus } from "../hosts/recheck-provider-cli-status";
import { useSystemConfig, useSystemVersion } from "../system/system-queries";
import {
  buildUpdateInventory,
  type UpdateInventory,
} from "./update-inventory-model";

interface UseUpdateInventoryOptions {
  enabled?: boolean;
}

export interface UpdateInventoryState extends UpdateInventory {
  isLoading: boolean;
}

/**
 * bb-app version + provider CLI inventory of every connected machine (see
 * `buildUpdateInventory`). The per-machine status queries are session-static;
 * `useCheckForUpdates` and a finished install refresh them.
 */
export function useUpdateInventory(
  options?: UseUpdateInventoryOptions,
): UpdateInventoryState {
  const enabled = options?.enabled ?? true;
  const versionQuery = useSystemVersion({ enabled });
  const configQuery = useSystemConfig({ enabled });
  const hostsQuery = useHosts({ enabled });
  const serverProtocolVersion = useServerProtocolVersion({ enabled });
  const hosts = useMemo(() => hostsQuery.data ?? [], [hostsQuery.data]);
  const connectedHostIds = useMemo(
    () => hosts.filter((host) => host.status === "connected").map((h) => h.id),
    [hosts],
  );
  const providerStatuses = useHostsProviderCliStatus(connectedHostIds, {
    enabled,
  });
  const primaryHostId = configQuery.data?.primaryHostId ?? null;
  const inventory = useMemo(
    () =>
      buildUpdateInventory({
        hosts,
        primaryHostId,
        systemVersion: versionQuery.data,
        systemVersionUpdatedAt: versionQuery.dataUpdatedAt,
        serverProtocolVersion,
        providerStatuses,
      }),
    [
      hosts,
      primaryHostId,
      versionQuery.data,
      versionQuery.dataUpdatedAt,
      serverProtocolVersion,
      providerStatuses,
    ],
  );
  return {
    ...inventory,
    isLoading: versionQuery.isPending || hostsQuery.isPending,
  };
}

/**
 * "Check for updates": bypass the server's npm cache
 * (`GET /system/version?force=true`), write the answer into the version
 * cache, re-probe every connected machine's provider CLIs past the server's
 * status memo (`?force=true`), and re-ask for CLI skills.
 */
export function useCheckForUpdates() {
  const client = useProfileClient();
  const queryClient = useQueryClient();
  return useMutation<SystemVersionResponse, Error, readonly string[]>({
    meta: { errorMessage: "The update check did not complete." },
    mutationFn: async (connectedHostIds) => {
      const version = await client.sdk.system.version({ force: true });
      queryClient.setQueryData(systemVersionQueryKey(), version);
      await Promise.all([
        ...connectedHostIds.map((hostId) =>
          recheckHostProviderCliStatus(client, queryClient, hostId),
        ),
        queryClient.invalidateQueries({ queryKey: systemCliSkillsQueryKey() }),
      ]);
      return version;
    },
  });
}
