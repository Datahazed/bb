import type { HostDaemonOnlineRpcResult } from "@bb/host-daemon-contract";
import { makeWorkspaceStatus } from "@bb/test-helpers";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceStatusCache } from "./workspace-status-cache.js";

const WORKSPACE_CONTEXT = {
  workspacePath: "/tmp/env-1",
  workspaceProvisionType: "managed-worktree",
} as const;

function availableStatus(): HostDaemonOnlineRpcResult<"workspace.status"> {
  return {
    outcome: "available",
    workspaceStatus: makeWorkspaceStatus(),
  };
}

describe("WorkspaceStatusCache", () => {
  it("coalesces concurrent reads and reuses the result within the TTL", async () => {
    let now = 1_000;
    const cache = new WorkspaceStatusCache({ nowMs: () => now, ttlMs: 5_000 });
    const load = vi.fn(async () => availableStatus());
    const args = {
      environmentId: "env-1",
      load,
      mergeBaseBranch: "main",
      workspaceContext: WORKSPACE_CONTEXT,
    };

    const [first, second] = await Promise.all([
      cache.getOrLoad(args),
      cache.getOrLoad(args),
    ]);
    now += 4_999;
    const third = await cache.getOrLoad(args);

    expect(load).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
    expect(third).toEqual(first);

    now += 2;
    await cache.getOrLoad(args);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("drops an environment result immediately when invalidated", async () => {
    const cache = new WorkspaceStatusCache();
    const load = vi.fn(async () => availableStatus());
    const args = {
      environmentId: "env-1",
      load,
      workspaceContext: WORKSPACE_CONTEXT,
    };

    await cache.getOrLoad(args);
    cache.invalidateEnvironment("env-1");
    await cache.getOrLoad(args);

    expect(load).toHaveBeenCalledTimes(2);
  });

  it("drops matching workspace results when a nested path changes", async () => {
    const cache = new WorkspaceStatusCache();
    const load = vi.fn(async () => availableStatus());
    const args = {
      environmentId: "env-1",
      load,
      workspaceContext: WORKSPACE_CONTEXT,
    };

    await cache.getOrLoad(args);
    cache.invalidatePath("/tmp/env-1/src/file.ts");
    await cache.getOrLoad(args);

    expect(load).toHaveBeenCalledTimes(2);
  });

  it("does not restore an in-flight result after invalidation", async () => {
    let resolveLoad!: (value: ReturnType<typeof availableStatus>) => void;
    const firstLoad = new Promise<ReturnType<typeof availableStatus>>(
      (resolve) => {
        resolveLoad = resolve;
      },
    );
    const cache = new WorkspaceStatusCache();
    const load = vi
      .fn<() => Promise<ReturnType<typeof availableStatus>>>()
      .mockReturnValueOnce(firstLoad)
      .mockResolvedValue(availableStatus());
    const args = {
      environmentId: "env-1",
      load,
      workspaceContext: WORKSPACE_CONTEXT,
    };

    const staleRead = cache.getOrLoad(args);
    cache.invalidateEnvironment("env-1");
    resolveLoad(availableStatus());
    await staleRead;
    await cache.getOrLoad(args);

    expect(load).toHaveBeenCalledTimes(2);
  });
});
