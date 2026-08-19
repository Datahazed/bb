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
}: ThreadDetailBootstrapIngestionArgs): void {
  queryClient.setQueryData(
    threadQueryKey(thread.id),
    stripThreadIncludes(thread),
  );

  if (thread.environment) {
    queryClient.setQueryData(
      environmentQueryKey(thread.environment.id),
      thread.environment,
    );
  }

  if (thread.host) {
    const host = thread.host;
    queryClient.setQueryData(hostQueryKey(host.id), host);
    queryClient.setQueryData<HostList>(hostsQueryKey(), (hosts) =>
      upsertHostList({ host, hosts }),
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
