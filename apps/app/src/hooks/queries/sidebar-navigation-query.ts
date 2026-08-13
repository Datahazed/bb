import { useQuery } from "@tanstack/react-query";
import {
  findLocalPathProjectSourceForHost,
  PERSONAL_PROJECT_ID,
} from "@bb/domain";
import type { SidebarBootstrapResponse } from "@bb/server-contract";
import { apiClient } from "@/lib/api-server";
import { request, requestOptions } from "@/lib/api";
import {
  useEnvironmentListRealtimeSubscription,
  useHostListRealtimeSubscription,
  useProjectListRealtimeSubscription,
  useThreadListRealtimeSubscription,
} from "@/hooks/useRealtimeSubscription";
import { REALTIME_OWNED_STATIC_CACHE_QUERY_POLICY } from "./query-policies";

export const SIDEBAR_NAVIGATION_QUERY_KEY = "sidebarNavigation";

export type SidebarNavigationQueryKey = readonly [
  typeof SIDEBAR_NAVIGATION_QUERY_KEY,
];

interface QueryOptions {
  enabled?: boolean;
}

export function sidebarNavigationQueryKey(): SidebarNavigationQueryKey {
  return [SIDEBAR_NAVIGATION_QUERY_KEY];
}

export function fetchSidebarNavigation(
  signal?: AbortSignal,
): Promise<SidebarBootstrapResponse> {
  return request<SidebarBootstrapResponse>(
    apiClient["sidebar-bootstrap"].$get(undefined, requestOptions(signal)),
  );
}

export function useSidebarNavigation(options?: QueryOptions) {
  const enabled = options?.enabled ?? true;
  useEnvironmentListRealtimeSubscription({ enabled });
  useHostListRealtimeSubscription({ enabled });
  useProjectListRealtimeSubscription({ enabled });
  useThreadListRealtimeSubscription({ enabled });

  return useQuery<SidebarBootstrapResponse>({
    queryKey: sidebarNavigationQueryKey(),
    queryFn: ({ signal }) => fetchSidebarNavigation(signal),
    enabled,
    ...REALTIME_OWNED_STATIC_CACHE_QUERY_POLICY,
  });
}

/**
 * Read the active project's name and host-specific root from the shared
 * sidebar-navigation cache. The sidebar owns the realtime subscriptions and
 * initial load. This hook only reads the cache so the follow-up composer can
 * identify the active workspace. Returns undefined until the cache is populated
 * or when the project is unknown.
 */
export function useProjectWorkspaceDisplay(
  projectId: string | undefined,
  hostId: string | undefined,
): { name: string; rootPath: string | undefined } | undefined {
  const { data } = useQuery<SidebarBootstrapResponse>({
    queryKey: sidebarNavigationQueryKey(),
    queryFn: ({ signal }) => fetchSidebarNavigation(signal),
    ...REALTIME_OWNED_STATIC_CACHE_QUERY_POLICY,
    // Nothing to resolve without a project id (e.g. personal threads), so don't
    // trigger the bootstrap fetch from this read-only selector.
    enabled: Boolean(projectId),
  });
  if (!data || !projectId) {
    return undefined;
  }
  const project =
    projectId === PERSONAL_PROJECT_ID
      ? data.personalProject
      : data.projects.find((candidate) => candidate.id === projectId);
  if (!project) {
    return undefined;
  }
  return {
    name: project.name,
    rootPath: hostId
      ? findLocalPathProjectSourceForHost(project.sources, hostId)?.path
      : undefined,
  };
}
