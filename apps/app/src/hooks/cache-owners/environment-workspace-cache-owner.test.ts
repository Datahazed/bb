import { describe, expect, it } from "vitest";
import type { Environment } from "@bb/domain";
import { createAppQueryClient } from "@/lib/query-client";
import {
  environmentQueryKey,
  threadSearchQueryKey,
} from "../queries/query-keys";
import { applyEnvironmentUpdateResult } from "./environment-workspace-cache-owner";

function createEnvironment(): Environment {
  return {
    baseBranch: null,
    branchName: "main",
    createdAt: 1000,
    defaultBranch: "main",
    hostId: "host_1",
    id: "env_1",
    isGitRepo: true,
    isWorktree: true,
    managed: true,
    mergeBaseBranch: null,
    name: "Renamed environment",
    path: "/tmp/project",
    projectId: "proj_1",
    status: "ready",
    updatedAt: 2000,
    workspaceProvisionType: "managed-worktree",
  };
}

describe("applyEnvironmentUpdateResult", () => {
  it("publishes the renamed environment to the composer and info cache", () => {
    const queryClient = createAppQueryClient({
      defaultOptions: {
        queries: {
          gcTime: Infinity,
          retry: false,
        },
      },
      showMutationErrorToasts: false,
    });
    const environment = createEnvironment();
    queryClient.setQueryData(environmentQueryKey(environment.id), {
      ...environment,
      name: null,
    });

    applyEnvironmentUpdateResult({ environment, queryClient });

    expect(
      queryClient.getQueryData<Environment>(environmentQueryKey(environment.id))
        ?.name,
    ).toBe("Renamed environment");
  });

  it("invalidates cached thread search rows that render environment metadata", () => {
    const queryClient = createAppQueryClient({
      defaultOptions: {
        queries: {
          gcTime: Infinity,
          retry: false,
        },
      },
      showMutationErrorToasts: false,
    });
    const threadSearchKey = threadSearchQueryKey({
      limitPerGroup: 20,
      query: "renamed",
    });
    queryClient.setQueryData(threadSearchKey, {
      active: { results: [], total: 0 },
      archived: { results: [], total: 0 },
    });

    applyEnvironmentUpdateResult({
      environment: createEnvironment(),
      queryClient,
    });

    expect(queryClient.getQueryState(threadSearchKey)?.isInvalidated).toBe(
      true,
    );
  });
});
