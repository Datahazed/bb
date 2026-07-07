import { useQuery } from "@tanstack/react-query";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import type { ThreadListEntry } from "@bb/domain";
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

function isWorkingThread(thread: ThreadListEntry): boolean {
  return (
    thread.status === "starting" ||
    thread.status === "active" ||
    thread.status === "stopping"
  );
}

/**
 * Whether any agent is working, derived from the same push-updated
 * sidebar-navigation cache that renders the sidebar's running spinners — so
 * surfaces like the update toast always agree with what the sidebar shows,
 * with no polling. Returns undefined until the cache is populated.
 *
 * This is a view, not global truth: the bootstrap excludes side-chats and
 * archived threads, so hidden work can be missed. Callers must map an "idle"
 * reading to behavior the server re-checks authoritatively (e.g. mode
 * "when-idle", whose at-rest gate counts every thread) rather than to
 * anything destructive.
 */
export function useAnyAgentWorking(options?: QueryOptions): boolean | undefined {
  const enabled = options?.enabled ?? true;
  const { data } = useQuery<SidebarBootstrapResponse>({
    queryKey: sidebarNavigationQueryKey(),
    queryFn: ({ signal }) => fetchSidebarNavigation(signal),
    ...REALTIME_OWNED_STATIC_CACHE_QUERY_POLICY,
    enabled,
  });
  if (!data) {
    return undefined;
  }
  return (
    data.personalProject.threads.some(isWorkingThread) ||
    data.projects.some((project) => project.threads.some(isWorkingThread))
  );
}

/**
 * Read the active project's display name from the shared sidebar-navigation
 * cache. The sidebar owns the realtime subscriptions and initial load; this only
 * reads the cached projects (no extra subscriptions) so surfaces like the
 * follow-up composer footer can label the current project. Returns undefined
 * until the cache is populated or when the project is unknown.
 */
export function useProjectDisplayName(
  projectId: string | undefined,
): string | undefined {
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
  if (projectId === PERSONAL_PROJECT_ID) {
    return data.personalProject.name;
  }
  return data.projects.find((project) => project.id === projectId)?.name;
}
