import { experimental_createHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";
import { describe, expect, it } from "vitest";
import { createWorktreeHostEntry } from "./host.js";

type HostWorkspaceModule = typeof import("@bb/host-workspace");
type CreateWorktreeFn = HostWorkspaceModule["createWorktree"];
type RemoveWorktreeFn = HostWorkspaceModule["removeWorktree"];
type CreateWorktreeArgs = Parameters<CreateWorktreeFn>[0];
type RemoveWorktreeArgs = Parameters<RemoveWorktreeFn>[0];

function makeDeps() {
  const createCalls: CreateWorktreeArgs[] = [];
  const removeCalls: RemoveWorktreeArgs[] = [];
  const createWorktree: CreateWorktreeFn = async (args) => {
    createCalls.push(args);
    return { path: args.targetPath };
  };
  const removeWorktree: RemoveWorktreeFn = async (args) => {
    removeCalls.push(args);
  };
  return { createCalls, removeCalls, deps: { createWorktree, removeWorktree } };
}

describe("worktree host entry", () => {
  it("creates the worktree under the plugin data dir with the thread branch", async () => {
    const { createCalls, deps } = makeDeps();
    const harness = experimental_createHostEntryHarness(
      createWorktreeHostEntry(deps),
    );

    await expect(
      harness.experimental_call("create", {
        threadId: "thread-9",
        sourcePath: "/Users/me/repo",
        baseBranch: { kind: "named", name: "release" },
        setupScript: "scripts/setup.sh",
      }),
    ).resolves.toEqual({
      path: "/test/plugin-data/worktrees/thread-9/repo",
    });
    expect(createCalls).toHaveLength(1);
    expect(createCalls[0]).toMatchObject({
      sourcePath: "/Users/me/repo",
      targetPath: "/test/plugin-data/worktrees/thread-9/repo",
      branchName: "bb/thread-9",
      baseBranch: "release",
      setupScriptName: "scripts/setup.sh",
      pruneEmptyParent: true,
    });
    await harness.experimental_dispose();
  });

  it("maps the default base branch to the source default", async () => {
    const { createCalls, deps } = makeDeps();
    const harness = experimental_createHostEntryHarness(
      createWorktreeHostEntry(deps),
    );

    await harness.experimental_call("create", {
      threadId: "thread-9",
      sourcePath: "/Users/me/repo",
      baseBranch: { kind: "default" },
      setupScript: ".bb-env-setup.sh",
    });
    expect(createCalls[0]?.baseBranch).toBeNull();
    await harness.experimental_dispose();
  });

  it("rejects lifecycle script paths that escape the worktree root", async () => {
    const { createCalls, removeCalls, deps } = makeDeps();
    const harness = experimental_createHostEntryHarness(
      createWorktreeHostEntry(deps),
    );

    await expect(
      harness.experimental_call("create", {
        threadId: "thread-9",
        sourcePath: "/Users/me/repo",
        baseBranch: { kind: "default" },
        setupScript: "../evil.sh",
      }),
    ).rejects.toThrow(/escapes the worktree root/);
    await expect(
      harness.experimental_call("create", {
        threadId: "thread-9",
        sourcePath: "/Users/me/repo",
        baseBranch: { kind: "default" },
        setupScript: "/etc/evil.sh",
      }),
    ).rejects.toThrow(/escapes the worktree root/);
    await expect(
      harness.experimental_call("teardown", {
        path: "/wt/repo",
        teardownScript: "sub/../../evil.sh",
      }),
    ).rejects.toThrow(/escapes the worktree root/);
    expect(createCalls).toHaveLength(0);
    expect(removeCalls).toHaveLength(0);
    await harness.experimental_dispose();
  });

  it("runs the teardown script and removes the worktree", async () => {
    const { removeCalls, deps } = makeDeps();
    const harness = experimental_createHostEntryHarness(
      createWorktreeHostEntry(deps),
    );

    await expect(
      harness.experimental_call("teardown", {
        path: "/wt/repo",
        teardownScript: "scripts/teardown.sh",
      }),
    ).resolves.toBeNull();
    expect(removeCalls).toEqual([
      {
        path: "/wt/repo",
        timeoutMs: 15 * 60 * 1000,
        teardownScriptName: "scripts/teardown.sh",
        force: true,
        pruneEmptyParent: true,
      },
    ]);
    await harness.experimental_dispose();
  });
});
