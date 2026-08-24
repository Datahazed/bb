// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ProjectWithThreadsResponse } from "@bb/server-contract";
import { sdk } from "@/lib/sdk";
import { makeThreadListEntry } from "@/test/fixtures/thread-list-entries";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  stripProjectThreads,
  useProjectSourceBranches,
} from "./project-queries";
import { projectSourceBranchesQueryKeyPrefix } from "./query-keys";

vi.mock("@/lib/sdk", () => ({
  sdk: { projects: { branches: vi.fn() } },
}));

vi.mock("@/hooks/useRealtimeSubscription", () => ({
  useProjectDetailRealtimeSubscription: vi.fn(),
}));

describe("useProjectSourceBranches", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("does not re-run the daemon branch RPC on window focus while the list is fresh", async () => {
    const { wrapper, queryClient } = createQueryClientTestHarness();
    vi.mocked(sdk.projects.branches).mockResolvedValue({
      branches: ["main"],
      branchesTruncated: false,
      checkout: { kind: "branch", branchName: "main", headSha: null },
      defaultBranch: "main",
      defaultBranchRelation: "equal",
      defaultWorktreeBaseBranch: null,
      hasUncommittedChanges: false,
      operation: { kind: "none" },
      originDefaultBranch: "main",
      remoteBranches: [],
      remoteBranchesTruncated: false,
      selectedBranch: null,
    });

    renderHook(() => useProjectSourceBranches("project-1", "host-1"), {
      wrapper,
    });
    await waitFor(() => {
      expect(sdk.projects.branches).toHaveBeenCalledTimes(1);
    });

    const [query] = queryClient.getQueryCache().findAll({
      queryKey: projectSourceBranchesQueryKeyPrefix("project-1"),
    });
    expect(query?.options).toEqual(
      expect.objectContaining({
        refetchOnWindowFocus: false,
        staleTime: 30_000,
      }),
    );
  });
});

describe("stripProjectThreads", () => {
  function makeProjectWithThreads(): ProjectWithThreadsResponse {
    return {
      id: "proj_1",
      kind: "standard",
      name: "One",
      gitRemoteUrl: null,
      sources: [],
      createdAt: 0,
      updatedAt: 0,
      threads: [makeThreadListEntry({ id: "thr_1", projectId: "proj_1" })],
      defaultExecutionOptions: null,
    };
  }

  it("returns the same project for the same payload object", () => {
    // React Query structurally shares the sidebar payload, so a project whose
    // fields and threads did not change keeps its object across refetches;
    // the stripped project has to keep its identity too, or every project
    // row sees a new project on every sidebar update.
    const payload = makeProjectWithThreads();
    const stripped = stripProjectThreads(payload);

    expect(stripProjectThreads(payload)).toBe(stripped);
    expect("threads" in stripped).toBe(false);
    expect(stripped).toEqual({
      id: "proj_1",
      kind: "standard",
      name: "One",
      gitRemoteUrl: null,
      sources: [],
      createdAt: 0,
      updatedAt: 0,
      defaultExecutionOptions: null,
    });
  });

  it("returns a new project for a new payload object", () => {
    const stripped = stripProjectThreads(makeProjectWithThreads());
    const next = stripProjectThreads(makeProjectWithThreads());

    expect(next).not.toBe(stripped);
    expect(next).toEqual(stripped);
  });
});
