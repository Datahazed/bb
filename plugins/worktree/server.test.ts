import type {
  BbPluginApi,
  JsonValue,
  PluginEnvironmentProvisionContext,
} from "@get-bb/plugin-sdk";
import {
  createFakePluginHost,
  makeQueueEntry,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import { describe, expect, it, vi } from "vitest";
import plugin from "./server.js";

type ThreadRow = Awaited<ReturnType<BbPluginApi["sdk"]["threads"]["list"]>>[number];

const CONFIGURATION = {
  hostId: "host-1",
  baseBranch: { kind: "named", name: "main" },
} satisfies JsonValue;

function provisionContext(
  configuration: JsonValue,
  threadId = "thread-1",
): PluginEnvironmentProvisionContext {
  return {
    thread: makeThreadResponse({ id: threadId, projectId: "project-1" }),
    project: {
      id: "project-1",
      kind: "standard",
      name: "Project",
      gitRemoteUrl: null,
      createdAt: 0,
      updatedAt: 0,
    },
    configuration,
    queuedMessage: null,
  };
}

function projectWithSource() {
  return {
    id: "project-1",
    sources: [
      {
        id: "source-1",
        projectId: "project-1",
        type: "local_path",
        hostId: "host-1",
        path: "/checkouts/repo",
        isDefault: true,
        createdAt: 0,
        updatedAt: 0,
      },
    ],
  };
}

describe("worktree server entry", () => {
  it("rejects a configuration without a machine or base branch", async () => {
    const host = createFakePluginHost({ pluginId: "worktree" });
    await plugin(host.bb);
    const target = host.harness.registrations.environmentTargets.get("worktree");
    expect(target).toMatchObject({
      id: "worktree",
      title: "New worktree",
      icon: "GitBranch",
      hostScoped: true,
      defaultConfiguration: null,
    });

    const badConfigurations: JsonValue[] = [
      null,
      { hostId: "host-1" },
      { baseBranch: { kind: "default" } },
      { hostId: "", baseBranch: { kind: "default" } },
      { hostId: "host-1", baseBranch: { kind: "named", name: "" } },
    ];
    for (const configuration of badConfigurations) {
      await expect(
        target?.provision(provisionContext(configuration)),
      ).resolves.toEqual({
        action: "reject",
        message: "Choose a machine and base branch.",
      });
    }
    expect(host.harness.experimental_hostRpcCalls).toHaveLength(0);
    await host.harness.dispose();
  });

  it("starts exactly one host create carrying the configured setup script, then answers ready", async () => {
    const host = createFakePluginHost({
      pluginId: "worktree",
      sdk: { projects: { get: async () => projectWithSource() } },
      experimental_callHostRpc: () => ({ path: "/hosts/worktrees/thread-1/repo" }),
    });
    await plugin(host.bb);
    await host.harness.setSettings({ setupScript: "scripts/setup.sh" });
    const target =
      host.harness.registrations.environmentTargets.get("worktree");

    const [first, second] = await Promise.all([
      target!.provision(provisionContext(CONFIGURATION)),
      target!.provision(provisionContext(CONFIGURATION)),
    ]);
    expect(first).toEqual({ action: "wait", reason: "Creating worktree…" });
    expect(second).toEqual({ action: "wait", reason: "Creating worktree…" });

    await vi.waitFor(() => {
      expect(host.harness.recheckCount).toBe(1);
    });
    expect(host.harness.experimental_hostRpcCalls).toHaveLength(1);
    expect(host.harness.experimental_hostRpcCalls[0]).toMatchObject({
      method: "create",
      hostId: "host-1",
      input: {
        threadId: "thread-1",
        sourcePath: "/checkouts/repo",
        baseBranch: { kind: "named", name: "main" },
        setupScript: "scripts/setup.sh",
      },
    });

    await expect(
      target!.provision(provisionContext(CONFIGURATION)),
    ).resolves.toEqual({
      action: "ready",
      environment: {
        type: "host",
        hostId: "host-1",
        workspace: { type: "unmanaged", path: "/hosts/worktrees/thread-1/repo" },
      },
    });
    await expect(
      host.bb.storage.kv.get("worktree:host-1:/hosts/worktrees/thread-1/repo"),
    ).resolves.toEqual({ hostId: "host-1", path: "/hosts/worktrees/thread-1/repo" });
    await host.harness.dispose();
  });

  it("restarts a stale creating launch left behind by a server restart", async () => {
    const host = createFakePluginHost({
      pluginId: "worktree",
      sdk: { projects: { get: async () => projectWithSource() } },
      experimental_callHostRpc: () => ({ path: "/hosts/worktrees/thread-1/repo" }),
    });
    await plugin(host.bb);
    await host.bb.storage.kv.set("launch:thread-1", {
      phase: "creating",
      progress: "Creating worktree…",
    });
    const target =
      host.harness.registrations.environmentTargets.get("worktree");

    await expect(
      target!.provision(provisionContext(CONFIGURATION)),
    ).resolves.toEqual({ action: "wait", reason: "Creating worktree…" });
    await vi.waitFor(() => {
      expect(host.harness.recheckCount).toBe(1);
    });
    expect(host.harness.experimental_hostRpcCalls).toHaveLength(1);
    await expect(
      target!.provision(provisionContext(CONFIGURATION)),
    ).resolves.toMatchObject({ action: "ready" });
    await host.harness.dispose();
  });

  it("answers a retryable wait after the host create fails", async () => {
    const host = createFakePluginHost({
      pluginId: "worktree",
      sdk: { projects: { get: async () => projectWithSource() } },
      experimental_callHostRpc: () => {
        throw new Error("disk full");
      },
    });
    await plugin(host.bb);
    const target =
      host.harness.registrations.environmentTargets.get("worktree");

    await target!.provision(provisionContext(CONFIGURATION));
    await vi.waitFor(() => {
      expect(host.harness.recheckCount).toBe(1);
    });
    const launch = await host.bb.storage.kv.get<{
      phase: string;
      failedAt: number;
    }>("launch:thread-1");
    expect(launch?.phase).toBe("failed");

    const decision = await target!.provision(provisionContext(CONFIGURATION));
    expect(decision).toMatchObject({ action: "wait" });
    if (decision.action !== "wait") throw new Error("expected wait");
    expect(decision.reason).toContain("Failed:");
    expect(decision.reason).toContain("disk full");
    expect(decision.sendAt).toBe(launch!.failedAt + 30_000);
    await host.harness.dispose();
  });

  it("fails the launch when the project has no source on the chosen machine", async () => {
    const host = createFakePluginHost({
      pluginId: "worktree",
      sdk: { projects: { get: async () => ({ id: "project-1", sources: [] }) } },
    });
    await plugin(host.bb);
    const target =
      host.harness.registrations.environmentTargets.get("worktree");

    await target!.provision(provisionContext(CONFIGURATION));
    await vi.waitFor(() => {
      expect(host.harness.recheckCount).toBe(1);
    });
    expect(host.harness.experimental_hostRpcCalls).toHaveLength(0);
    await expect(host.bb.storage.kv.get("launch:thread-1")).resolves.toMatchObject({
      phase: "failed",
      error: "This project has no checkout on the selected machine.",
    });
    await host.harness.dispose();
  });

  it("tears the worktree down only when the last live thread on its environment goes", async () => {
    const liveThreads: Partial<ThreadRow>[] = [
      { id: "thread-2", environmentId: "env-1" },
    ];
    const host = createFakePluginHost({
      pluginId: "worktree",
      sdk: {
        environments: {
          get: async () => ({ id: "env-1", hostId: "host-1", path: "/wt/repo" }),
        },
        threads: { list: async () => liveThreads },
      },
      experimental_callHostRpc: () => null,
    });
    await plugin(host.bb);
    await host.harness.setSettings({ teardownScript: "scripts/teardown.sh" });
    await host.bb.storage.kv.set("worktree:host-1:/wt/repo", {
      hostId: "host-1",
      path: "/wt/repo",
    });
    const archived = makeThreadResponse({
      id: "thread-1",
      projectId: "project-1",
      environmentId: "env-1",
    });

    await host.harness.emitThreadEvent("thread.archived", { thread: archived });
    expect(host.harness.experimental_hostRpcCalls).toHaveLength(0);

    liveThreads.length = 0;
    await host.harness.emitThreadEvent("thread.archived", { thread: archived });
    expect(host.harness.experimental_hostRpcCalls).toEqual([
      expect.objectContaining({
        method: "teardown",
        hostId: "host-1",
        input: { path: "/wt/repo", teardownScript: "scripts/teardown.sh" },
      }),
    ]);
    await expect(
      host.bb.storage.kv.get("worktree:host-1:/wt/repo"),
    ).resolves.toBeUndefined();

    await host.harness.emitThreadEvent("thread.deleted", { thread: archived });
    expect(host.harness.experimental_hostRpcCalls).toHaveLength(1);
    await host.harness.dispose();
  });

  it("leaves environments it did not create alone", async () => {
    const host = createFakePluginHost({
      pluginId: "worktree",
      sdk: {
        environments: {
          get: async () => ({ id: "env-9", hostId: "host-1", path: "/existing" }),
        },
        threads: { list: async () => [] },
      },
      experimental_callHostRpc: () => null,
    });
    await plugin(host.bb);

    await host.harness.emitThreadEvent("thread.archived", {
      thread: makeThreadResponse({ id: "thread-1", environmentId: "env-9" }),
    });
    await host.harness.emitThreadEvent("thread.archived", {
      thread: makeThreadResponse({ id: "thread-1", environmentId: null }),
    });
    expect(host.harness.experimental_hostRpcCalls).toHaveLength(0);
    await host.harness.dispose();
  });

  it("drops a creating launch when its queued message is cancelled", async () => {
    const host = createFakePluginHost({ pluginId: "worktree" });
    await plugin(host.bb);
    await host.bb.storage.kv.set("launch:thread-1", {
      phase: "creating",
      progress: "Creating worktree…",
    });
    await host.bb.storage.kv.set("launch:thread-2", {
      phase: "ready",
      hostId: "host-1",
      path: "/wt/repo",
    });

    await host.harness.emitThreadEvent("message.cancelled", {
      entry: makeQueueEntry({ threadId: "thread-1" }),
    });
    await host.harness.emitThreadEvent("message.cancelled", {
      entry: makeQueueEntry({ threadId: "thread-2" }),
    });

    await expect(host.bb.storage.kv.get("launch:thread-1")).resolves.toBeUndefined();
    await expect(host.bb.storage.kv.get("launch:thread-2")).resolves.toMatchObject({
      phase: "ready",
    });
    await host.harness.dispose();
  });

  it("tears down a worktree whose launch was cancelled while creating", async () => {
    let releaseCreate = (): void => {};
    const created = new Promise<void>((resolve) => {
      releaseCreate = resolve;
    });
    const host = createFakePluginHost({
      pluginId: "worktree",
      sdk: { projects: { get: async () => projectWithSource() } },
      experimental_callHostRpc: async ({ method }) => {
        if (method === "teardown") return null;
        await created;
        return { path: "/hosts/worktrees/thread-1/repo" };
      },
    });
    await plugin(host.bb);
    const target =
      host.harness.registrations.environmentTargets.get("worktree");

    await target!.provision(provisionContext(CONFIGURATION));
    await vi.waitFor(async () => {
      await expect(host.bb.storage.kv.get("launch:thread-1")).resolves.toMatchObject(
        { phase: "creating" },
      );
    });
    await host.harness.emitThreadEvent("message.cancelled", {
      entry: makeQueueEntry({ threadId: "thread-1" }),
    });
    releaseCreate();

    await vi.waitFor(() => {
      expect(
        host.harness.experimental_hostRpcCalls.filter(
          (call) => call.method === "teardown",
        ),
      ).toHaveLength(1);
    });
    await expect(host.bb.storage.kv.get("launch:thread-1")).resolves.toBeUndefined();
    await expect(
      host.bb.storage.kv.get("worktree:host-1:/hosts/worktrees/thread-1/repo"),
    ).resolves.toBeUndefined();
    await host.harness.dispose();
  });
});
