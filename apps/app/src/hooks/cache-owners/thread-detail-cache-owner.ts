import type { QueryClient } from "@tanstack/react-query";
import type { Host } from "@bb/domain";
import type {
  ThreadResponse,
  ThreadWithIncludesResponse,
} from "@bb/server-contract";
import {
  environmentQueryKey,
  hostQueryKey,
  hostsQueryKey,
  threadDefaultExecutionOptionsQueryKey,
  threadPendingInteractionsQueryKey,
  threadPromptHistoryQueryKey,
  threadQueryKey,
  threadQueuedMessagesQueryKey,
  threadTabsQueryKey,
} from "../queries/query-keys";

type HostList = Host[];
type HostListQueryData = HostList | undefined;

interface UpsertHostListArgs {
  host: Host;
  hosts: HostListQueryData;
}

export interface ThreadDetailBootstrapIngestionArgs {
  queryClient: QueryClient;
  thread: ThreadWithIncludesResponse;
  /**
   * When the bootstrap did not just arrive from the network (a slice hydrated
   * from the persisted query cache), stamp the derived entries with the
   * bootstrap's own fetch time so their staleTime and the reconnect
   * invalidation treat them as exactly that old. Omit for a live response.
   */
  updatedAt?: number;
}

function stripThreadIncludes(
  thread: ThreadWithIncludesResponse,
): ThreadResponse {
  const {
    environment,
    host,
    pendingInteractions,
    queuedMessages,
    promptHistory,
    defaultExecutionOptions,
    tabs,
    ...threadResponse
  } = thread;
  return threadResponse;
}

function upsertHostList({ host, hosts }: UpsertHostListArgs): HostList {
  if (!hosts) {
    return [host];
  }

  let found = false;
  const nextHosts = hosts.map((candidate) => {
    if (candidate.id !== host.id) {
      return candidate;
    }
    found = true;
    return host;
  });

  return found ? nextHosts : [...hosts, host];
}

export function ingestThreadDetailBootstrap({
  queryClient,
  thread,
  updatedAt,
}: ThreadDetailBootstrapIngestionArgs): void {
  const setOptions = updatedAt === undefined ? undefined : { updatedAt };
  queryClient.setQueryData(
    threadQueryKey(thread.id),
    stripThreadIncludes(thread),
    setOptions,
  );

  if (thread.environment) {
    queryClient.setQueryData(
      environmentQueryKey(thread.environment.id),
      thread.environment,
      setOptions,
    );
  }

  if (thread.host) {
    const host = thread.host;
    queryClient.setQueryData(hostQueryKey(host.id), host, setOptions);
    queryClient.setQueryData<HostList>(
      hostsQueryKey(),
      (hosts) => upsertHostList({ host, hosts }),
      setOptions,
    );
  }

  // Bundled per-thread reads. Each field is present only when the bootstrap
  // requested it, and each seeds the cache its stand-alone hook reads so the
  // hook mounts with data instead of issuing its own request.
  if (thread.pendingInteractions !== undefined) {
    queryClient.setQueryData(
      threadPendingInteractionsQueryKey(thread.id),
      thread.pendingInteractions,
    );
  }
  if (thread.queuedMessages !== undefined) {
    queryClient.setQueryData(
      threadQueuedMessagesQueryKey(thread.id),
      thread.queuedMessages,
    );
  }
  if (thread.promptHistory !== undefined) {
    queryClient.setQueryData(
      threadPromptHistoryQueryKey(thread.id),
      thread.promptHistory,
    );
  }
  if (thread.defaultExecutionOptions !== undefined) {
    queryClient.setQueryData(
      threadDefaultExecutionOptionsQueryKey(thread.id),
      thread.defaultExecutionOptions,
    );
  }
  if (thread.tabs !== undefined) {
    queryClient.setQueryData(threadTabsQueryKey(thread.id), thread.tabs);
  }
}
