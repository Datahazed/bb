import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toRecord } from "@bb/core-ui";
import type {
  SystemAgentActivityResponse,
  SystemConfigResponse,
  SystemExecutionOptionsResponse,
  SystemSelfUpdateMode,
  SystemSelfUpdateState,
  SystemVersionResponse,
} from "@bb/server-contract";
import type { ProviderCliStatusResponse } from "@bb/host-daemon-contract";
import type { ProviderUsageResponse } from "@bb/host-daemon-contract";
import * as api from "@/lib/api";
import { applySelfUpdateStateToVersionCache } from "@/hooks/cache-owners/system-version-cache-owner";
import { useSystemRealtimeSubscription } from "@/hooks/useRealtimeSubscription";
import {
  hostProviderCliStatusQueryKey,
  systemAgentActivityQueryKey,
  systemConfigQueryKey,
  systemExecutionOptionsQueryKey,
  systemUsageLimitsQueryKey,
  systemVersionQueryKey,
} from "./query-keys";
import { requireEnabledQueryArg } from "./query-helpers";
import {
  FOCUS_OWNED_LIVE_QUERY_POLICY,
  SERVER_SESSION_QUERY_POLICY,
  SESSION_STATIC_QUERY_POLICY,
} from "./query-policies";

export interface UseSystemExecutionOptionsArgs {
  enabled?: boolean;
  environmentId?: string;
  providerId?: string;
}

interface QueryOptions {
  enabled?: boolean;
}

const SYSTEM_EXECUTION_OPTIONS_RETRY_DELAY_MS = 250;
const SYSTEM_EXECUTION_OPTIONS_RETRY_COUNT = 1;

function isAbortLikeError(error: unknown): boolean {
  return toRecord(error)?.name === "AbortError";
}

function shouldRetrySystemExecutionOptions(
  failureCount: number,
  error: unknown,
): boolean {
  if (failureCount >= SYSTEM_EXECUTION_OPTIONS_RETRY_COUNT) {
    return false;
  }

  if (isAbortLikeError(error)) {
    return false;
  }

  if (error instanceof api.HttpError) {
    return (
      error.status === 408 || error.status === 429 || error.status >= 500
    );
  }

  return true;
}

export function useSystemExecutionOptions(
  args: UseSystemExecutionOptionsArgs = {},
) {
  const environmentId = args.environmentId ?? null;
  const providerId = args.providerId ?? null;
  const enabled = args.enabled ?? true;
  useSystemRealtimeSubscription({ enabled });

  return useQuery<SystemExecutionOptionsResponse>({
    queryKey: systemExecutionOptionsQueryKey({ environmentId, providerId }),
    queryFn: ({ signal }) =>
      api.getSystemExecutionOptions({
        environmentId: args.environmentId,
        providerId: args.providerId,
        signal,
      }),
    enabled,
    staleTime: 60_000,
    retry: shouldRetrySystemExecutionOptions,
    retryDelay: SYSTEM_EXECUTION_OPTIONS_RETRY_DELAY_MS,
  });
}

export function useSystemConfig(options?: QueryOptions) {
  const enabled = options?.enabled ?? true;
  useSystemRealtimeSubscription({ enabled });

  return useQuery<SystemConfigResponse>({
    queryKey: systemConfigQueryKey(),
    queryFn: ({ signal }) => api.getSystemConfig(signal),
    enabled,
    staleTime: 60_000,
  });
}

/** Poll cadence while a scheduled self-update is pending, so the UI notices
 * staging failures and the post-update version bump. */
const SCHEDULED_SELF_UPDATE_REFETCH_MS = 30_000;

export function useSystemVersion(options?: QueryOptions) {
  return useQuery<SystemVersionResponse>({
    queryKey: systemVersionQueryKey(),
    queryFn: ({ signal }) => api.getSystemVersion(signal),
    enabled: options?.enabled ?? true,
    ...SERVER_SESSION_QUERY_POLICY,
    refetchInterval: (query) =>
      query.state.data?.selfUpdate.scheduled != null
        ? SCHEDULED_SELF_UPDATE_REFETCH_MS
        : false,
  });
}

/**
 * Poll cadence for the update toast's busy/idle action label. 1s keeps the
 * label effectively live; the endpoint is a single indexed count on a small
 * table, and the poll only runs while the update choice is on screen (an
 * update is available, capable, and not yet scheduled or dismissed).
 */
const AGENT_ACTIVITY_REFETCH_MS = 1_000;

/**
 * Live agent load, used to pick "Update now" vs "Update when agents finish"
 * on the update toast. Unlike the sidebar's thread cache this counts every
 * thread — side-chats and archived included — so the label is global truth.
 */
export function useSystemAgentActivity(options?: QueryOptions) {
  return useQuery<SystemAgentActivityResponse>({
    queryKey: systemAgentActivityQueryKey(),
    queryFn: ({ signal }) => api.getSystemAgentActivity(signal),
    enabled: options?.enabled ?? true,
    refetchInterval: AGENT_ACTIVITY_REFETCH_MS,
    staleTime: 0,
  });
}

/**
 * Busy/idle for the update toasts, with the shared safe default: unknown
 * activity reads as busy, since deferring is always the harmless choice.
 * Queued follow-ups count as busy — an update would orphan them, so
 * "Update now" would not actually be immediate.
 */
export function useAgentsBusy(options?: QueryOptions): boolean {
  const { data } = useSystemAgentActivity(options);
  return data === undefined
    ? true
    : data.busyThreadCount > 0 || data.queuedThreadCount > 0;
}

function useApplySelfUpdateState() {
  const queryClient = useQueryClient();
  return (selfUpdate: SystemSelfUpdateState): void => {
    applySelfUpdateStateToVersionCache({ queryClient, selfUpdate });
  };
}

export function useScheduleSelfUpdate() {
  const applySelfUpdateState = useApplySelfUpdateState();
  return useMutation({
    mutationFn: (mode: SystemSelfUpdateMode) => api.scheduleSelfUpdate(mode),
    onSuccess: applySelfUpdateState,
  });
}

export function useCancelSelfUpdate() {
  const applySelfUpdateState = useApplySelfUpdateState();
  return useMutation({
    mutationFn: () => api.cancelSelfUpdate(),
    onSuccess: applySelfUpdateState,
  });
}

export interface UseHostProviderCliStatusArgs {
  hostId: string | null;
  enabled?: boolean;
}

export function useHostProviderCliStatus({
  hostId,
  enabled,
}: UseHostProviderCliStatusArgs) {
  return useQuery<ProviderCliStatusResponse>({
    queryKey: hostProviderCliStatusQueryKey(hostId),
    queryFn: ({ signal }) =>
      api.fetchHostProviderCliStatus(
        requireEnabledQueryArg({
          value: hostId,
          hookName: "useHostProviderCliStatus",
          argName: "hostId",
        }),
        signal,
      ),
    enabled: (enabled ?? true) && hostId !== null,
    ...SESSION_STATIC_QUERY_POLICY,
  });
}

export function useSystemUsageLimits(options?: QueryOptions) {
  return useQuery<ProviderUsageResponse>({
    queryKey: systemUsageLimitsQueryKey(),
    queryFn: ({ signal }) => api.getSystemUsageLimits(signal),
    enabled: options?.enabled ?? true,
    ...FOCUS_OWNED_LIVE_QUERY_POLICY,
  });
}
