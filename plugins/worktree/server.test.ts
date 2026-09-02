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
import { afterEach, describe, expect, it, vi } from "vitest";
import plugin from "./server.js";

type ThreadRow = Awaited<ReturnType<BbPluginApi["sdk"]["threads"]["list"]>>[number];
type EnvironmentRow = Awaited<
  ReturnType<BbPluginApi["sdk"]["environments"]["get"]>
>;

const CONFIGURATION = {
  hostId: "host-1",
  baseBranch: { kind: "named", name: "main" },
} satisfies JsonValue;

function provisionContext(
  configuration: JsonValue,
  thread: { id?: string; title?: string | null } = {},
): PluginEnvironmentProvisionContext {
  return {
    thread: makeThreadResponse({
      id: thread.id ?? "thread-1",
      projectId: "project-1",
      title: thread.title ?? null,
    }),
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

function makeEnvironmentRow(
  overrides: Partial<EnvironmentRow> = {},
): EnvironmentRow {
  return {
    id: "env-1",
    name: null,
    projectId: "project-1",
    hostId: "host-1",
    path: "/wt/repo",
    managed: false,
    isGitRepo: true,
    isWorktree: true,
    workspaceProvisionType: "unmanaged",
    branchName: "bb/thread-1",
    baseBranch: "main",
    defaultBranch: "main",
    mergeBaseBranch: null,
    status: "ready",
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function createBranchNames(
  host: ReturnType<typeof createFakePluginHost>,
): unknown[] {
  return host.harness.experimental_hostRpcCalls
    .filter((call) => call.method === "create")
    .map((call) => (call.input as { branchName: string }).branchName);
}

afterEach(() => {
  vi.useRealTimers();
});

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
      experimental_callHostRpc: () => ({
        path: "/hosts/worktrees/thread-1/repo",
        log: "worktree ready\nscripts/setup.sh completed",
      }),
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
        branchName: "bb/thread-1",
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
      log: "worktree ready\nscripts/setup.sh completed",
    });
    await expect(
      host.bb.storage.kv.get("worktree:host-1:/hosts/worktrees/thread-1/repo"),
    ).resolves.toEqual({ hostId: "host-1", path: "/hosts/worktrees/thread-1/repo" });
    await host.harness.dispose();
  });

  it("names the branch from the thread title, kebab-cased and capped", async () => {
    const host = createFakePluginHost({
      pluginId: "worktree",
      sdk: { projects: { get: async () => projectWithSource() } },
      experimental_callHostRpc: () => ({
        path: "/hosts/worktrees/thread-1/repo",
        log: "worktree ready\nscripts/setup.sh completed",
      }),
    });
    await plugin(host.bb);
    const target =
      host.harness.registrations.environmentTargets.get("worktree");

    await target!.provision(
      provisionContext(CONFIGURATION, {
        title: "  Fix the Login Flow!! (again) — and make it stick this time, please ",
      }),
    );
    await vi.waitFor(() => {
      expect(host.harness.recheckCount).toBe(1);
    });
    expect(createBranchNames(host)).toEqual([
      "bb/fix-the-login-flow-again-and-make-it-sti",
    ]);
    await host.harness.dispose();
  });

  it("honors the configured managed branch prefix", async () => {
    const host = createFakePluginHost({
      pluginId: "worktree",
      sdk: {
        projects: { get: async () => projectWithSource() },
        system: {
          config: async () => ({
            generalSettings: { managedBranchPrefix: "sawyer/wt-" },
          }),
        },
      },
      experimental_callHostRpc: () => ({
        path: "/hosts/worktrees/thread-1/repo",
        log: "",
      }),
    });
    await plugin(host.bb);
    const target =
      host.harness.registrations.environmentTargets.get("worktree");

    await target!.provision(
      provisionContext(CONFIGURATION, { title: "Fix Login Flow" }),
    );
    await vi.waitFor(() => {
      expect(host.harness.recheckCount).toBe(1);
    });
    expect(host.harness.experimental_hostRpcCalls[0]).toMatchObject({
      method: "create",
      input: { branchName: "sawyer/wt-fix-login-flow" },
    });
    await host.harness.dispose();
  });

  it("retries once with a thread-id suffix when the branch already exists", async () => {
    let createCalls = 0;
    const host = createFakePluginHost({
      pluginId: "worktree",
      sdk: { projects: { get: async () => projectWithSource() } },
      experimental_callHostRpc: ({ method }) => {
        if (method !== "create") return null;
        createCalls += 1;
        if (createCalls === 1) {
          throw new Error(
            "worktree-branch-exists: branch bb/fix-login-flow already exists in /checkouts/repo",
          );
        }
        return { path: "/hosts/worktrees/thread-abcd/repo", log: "" };
      },
    });
    await plugin(host.bb);
    const target =
      host.harness.registrations.environmentTargets.get("worktree");

    await target!.provision(
      provisionContext(CONFIGURATION, {
        id: "thread-abcd",
        title: "Fix Login Flow",
      }),
    );
    await vi.waitFor(() => {
      expect(host.harness.recheckCount).toBe(1);
    });
    expect(createBranchNames(host)).toEqual([
      "bb/fix-login-flow",
      "bb/fix-login-flow-abcd",
    ]);
    await expect(
      target!.provision(
        provisionContext(CONFIGURATION, {
          id: "thread-abcd",
          title: "Fix Login Flow",
        }),
      ),
    ).resolves.toMatchObject({ action: "ready" });
    await host.harness.dispose();
  });

  it("surfaces the failure when the suffixed branch also exists", async () => {
    const host = createFakePluginHost({
      pluginId: "worktree",
      sdk: { projects: { get: async () => projectWithSource() } },
      experimental_callHostRpc: ({ method }) => {
        if (method !== "create") return null;
        throw new Error("worktree-branch-exists: branch already exists");
      },
    });
    await plugin(host.bb);
    const target =
      host.harness.registrations.environmentTargets.get("worktree");

    await target!.provision(
      provisionContext(CONFIGURATION, {
        id: "thread-abcd",
        title: "Fix Login Flow",
      }),
    );
    await vi.waitFor(() => {
      expect(host.harness.recheckCount).toBe(1);
    });
    expect(createBranchNames(host)).toEqual([
      "bb/fix-login-flow",
      "bb/fix-login-flow-abcd",
    ]);
    await expect(
      host.bb.storage.kv.get("launch:thread-abcd"),
    ).resolves.toMatchObject({ phase: "failed" });
    await host.harness.dispose();
  });

  it("restarts a stale creating launch left behind by a server restart", async () => {
    const host = createFakePluginHost({
      pluginId: "worktree",
      sdk: { projects: { get: async () => projectWithSource() } },
      experimental_callHostRpc: () => ({
        path: "/hosts/worktrees/thread-1/repo",
        log: "worktree ready\nscripts/setup.sh completed",
      }),
    });
    await plugin(host.bb);
    await host.bb.storage.kv.set("launch:thread-1", {
      phase: "creating",
      progress: "Creating worktree…",
      branchName: "bb/recorded-name",
    });
    const target =
      host.harness.registrations.environmentTargets.get("worktree");

    await expect(
      target!.provision(provisionContext(CONFIGURATION)),
    ).resolves.toEqual({ action: "wait", reason: "Creating worktree…" });
    await vi.waitFor(() => {
      expect(host.harness.recheckCount).toBe(1);
    });
    expect(createBranchNames(host)).toEqual(["bb/recorded-name"]);
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
    expect(host.harness.experimental_hostRpcCalls).toHaveLength(1);
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

  it("writes a retire record on archive and tears down only after the grace window", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: 1_000_000 });
    const environment = makeEnvironmentRow();
    const liveThreads: Partial<ThreadRow>[] = [
      { id: "thread-2", environmentId: "env-1" },
    ];
    const host = createFakePluginHost({
      pluginId: "worktree",
      sdk: {
        environments: {
          get: async () => environment,
          list: async () => [environment],
          delete: async () => ({ ok: true }),
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
    await expect(host.bb.storage.kv.get("retire:env-1")).resolves.toBeUndefined();

    liveThreads.length = 0;
    await host.harness.emitThreadEvent("thread.archived", { thread: archived });
    expect(host.harness.experimental_hostRpcCalls).toHaveLength(0);
    await expect(host.bb.storage.kv.get("retire:env-1")).resolves.toMatchObject({
      at: 1_000_000,
      environmentId: "env-1",
      hostId: "host-1",
      path: "/wt/repo",
      projectId: "project-1",
    });

    await host.harness.runSchedule("retire-sweep");
    expect(host.harness.experimental_hostRpcCalls).toHaveLength(0);

    vi.setSystemTime(1_000_000 + 6 * 60_000);
    await host.harness.runSchedule("retire-sweep");
    expect(host.harness.experimental_hostRpcCalls).toEqual([
      expect.objectContaining({
        method: "teardown",
        hostId: "host-1",
        input: { path: "/wt/repo", teardownScript: "scripts/teardown.sh" },
      }),
    ]);
    expect(host.harness.sdk.callsTo("environments.delete")).toEqual([
      [{ environmentId: "env-1" }],
    ]);
    await expect(host.bb.storage.kv.get("retire:env-1")).resolves.toBeUndefined();
    await expect(
      host.bb.storage.kv.get("worktree:host-1:/wt/repo"),
    ).resolves.toBeUndefined();
    await host.harness.dispose();
  });

  it("drops the retire record without a teardown when a thread comes back", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: 1_000_000 });
    const environment = makeEnvironmentRow();
    const host = createFakePluginHost({
      pluginId: "worktree",
      sdk: {
        environments: {
          get: async () => environment,
          list: async () => [environment],
        },
        threads: {
          list: async () => [{ id: "thread-2", environmentId: "env-1" }],
        },
      },
      experimental_callHostRpc: () => null,
    });
    await plugin(host.bb);
    await host.bb.storage.kv.set("worktree:host-1:/wt/repo", {
      hostId: "host-1",
      path: "/wt/repo",
    });
    await host.bb.storage.kv.set("retire:env-1", {
      at: 1_000_000 - 6 * 60_000,
      environmentId: "env-1",
      hostId: "host-1",
      path: "/wt/repo",
      projectId: "project-1",
    });

    await host.harness.runSchedule("retire-sweep");
    expect(host.harness.experimental_hostRpcCalls).toHaveLength(0);
    await expect(host.bb.storage.kv.get("retire:env-1")).resolves.toBeUndefined();
    await expect(
      host.bb.storage.kv.get("worktree:host-1:/wt/repo"),
    ).resolves.toMatchObject({ path: "/wt/repo" });
    await host.harness.dispose();
  });

  it("drops the retire record when the environment row is gone", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: 1_000_000 });
    const host = createFakePluginHost({
      pluginId: "worktree",
      sdk: {
        environments: {
          get: async () => {
            throw new Error("environment_not_found");
          },
          list: async () => [],
        },
        threads: { list: async () => [] },
      },
      experimental_callHostRpc: () => null,
    });
    await plugin(host.bb);
    await host.bb.storage.kv.set("retire:env-1", {
      at: 1_000_000 - 6 * 60_000,
      environmentId: "env-1",
      hostId: "host-1",
      path: "/wt/repo",
      projectId: "project-1",
    });

    await host.harness.runSchedule("retire-sweep");
    expect(host.harness.experimental_hostRpcCalls).toHaveLength(0);
    await expect(host.bb.storage.kv.get("retire:env-1")).resolves.toBeUndefined();
    await host.harness.dispose();
  });

  it("tears down immediately when the last thread is deleted", async () => {
    const environment = makeEnvironmentRow();
    const host = createFakePluginHost({
      pluginId: "worktree",
      sdk: {
        environments: {
          get: async () => environment,
          delete: async () => ({ ok: true }),
        },
        threads: { list: async () => [] },
      },
      experimental_callHostRpc: () => null,
    });
    await plugin(host.bb);
    await host.bb.storage.kv.set("worktree:host-1:/wt/repo", {
      hostId: "host-1",
      path: "/wt/repo",
    });

    await host.harness.emitThreadEvent("thread.deleted", {
      thread: makeThreadResponse({
        id: "thread-1",
        projectId: "project-1",
        environmentId: "env-1",
      }),
    });
    expect(host.harness.experimental_hostRpcCalls).toEqual([
      expect.objectContaining({ method: "teardown", hostId: "host-1" }),
    ]);
    expect(host.harness.sdk.callsTo("environments.delete")).toEqual([
      [{ environmentId: "env-1" }],
    ]);
    await expect(
      host.bb.storage.kv.get("worktree:host-1:/wt/repo"),
    ).resolves.toBeUndefined();
    await host.harness.dispose();
  });

  it("keeps the ownership record when finalization is refused", async () => {
    const environment = makeEnvironmentRow();
    const host = createFakePluginHost({
      pluginId: "worktree",
      sdk: {
        environments: {
          get: async () => environment,
          delete: async () => {
            throw new Error("409 environment_has_live_threads");
          },
        },
        threads: { list: async () => [] },
      },
      experimental_callHostRpc: () => null,
    });
    await plugin(host.bb);
    await host.bb.storage.kv.set("worktree:host-1:/wt/repo", {
      hostId: "host-1",
      path: "/wt/repo",
    });

    await host.harness.emitThreadEvent("thread.deleted", {
      thread: makeThreadResponse({
        id: "thread-1",
        projectId: "project-1",
        environmentId: "env-1",
      }),
    });
    expect(host.harness.experimental_hostRpcCalls).toEqual([
      expect.objectContaining({ method: "teardown" }),
    ]);
    await expect(
      host.bb.storage.kv.get("worktree:host-1:/wt/repo"),
    ).resolves.toMatchObject({ path: "/wt/repo" });
    await host.harness.dispose();
  });

  it("adopts a core-managed worktree without an ownership record", async () => {
    const environment = makeEnvironmentRow({
      id: "env-managed",
      path: "/core/worktrees/thread-1/repo",
      managed: true,
      workspaceProvisionType: "managed-worktree",
    });
    const host = createFakePluginHost({
      pluginId: "worktree",
      sdk: {
        environments: {
          get: async () => environment,
          delete: async () => ({ ok: true }),
        },
        threads: { list: async () => [] },
      },
      experimental_callHostRpc: () => null,
    });
    await plugin(host.bb);

    await host.harness.emitThreadEvent("thread.deleted", {
      thread: makeThreadResponse({
        id: "thread-1",
        projectId: "project-1",
        environmentId: "env-managed",
      }),
    });
    expect(host.harness.experimental_hostRpcCalls).toEqual([
      expect.objectContaining({
        method: "teardown",
        input: expect.objectContaining({ path: "/core/worktrees/thread-1/repo" }),
      }),
    ]);
    expect(host.harness.sdk.callsTo("environments.delete")).toEqual([
      [{ environmentId: "env-managed" }],
    ]);
    await host.harness.dispose();
  });

  it("leaves unmanaged checkouts and personal workspaces alone", async () => {
    const rows = new Map<string, EnvironmentRow>([
      ["env-checkout", makeEnvironmentRow({ id: "env-checkout", path: "/existing" })],
      [
        "env-personal",
        makeEnvironmentRow({
          id: "env-personal",
          path: "/personal",
          managed: true,
          workspaceProvisionType: "personal",
        }),
      ],
    ]);
    const host = createFakePluginHost({
      pluginId: "worktree",
      sdk: {
        environments: {
          get: async ({ environmentId }: { environmentId: string }) =>
            rows.get(environmentId),
        },
        threads: { list: async () => [] },
      },
      experimental_callHostRpc: () => null,
    });
    await plugin(host.bb);

    for (const environmentId of ["env-checkout", "env-personal"]) {
      await host.harness.emitThreadEvent("thread.deleted", {
        thread: makeThreadResponse({ id: "thread-1", environmentId }),
      });
      await host.harness.emitThreadEvent("thread.archived", {
        thread: makeThreadResponse({ id: "thread-1", environmentId }),
      });
    }
    await host.harness.emitThreadEvent("thread.archived", {
      thread: makeThreadResponse({ id: "thread-1", environmentId: null }),
    });
    expect(host.harness.experimental_hostRpcCalls).toHaveLength(0);
    expect(await host.bb.storage.kv.list("retire:")).toEqual([]);
    await host.harness.dispose();
  });

  it("sweeps orphaned managed worktrees into retirement and tears them down after grace", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: 1_000_000 });
    const orphan = makeEnvironmentRow({
      id: "env-orphan",
      path: "/core/worktrees/thread-9/repo",
      managed: true,
      workspaceProvisionType: "managed-worktree",
    });
    const checkout = makeEnvironmentRow({ id: "env-checkout", path: "/existing" });
    const personal = makeEnvironmentRow({
      id: "env-personal",
      path: "/personal",
      managed: true,
      workspaceProvisionType: "personal",
    });
    const busy = makeEnvironmentRow({
      id: "env-busy",
      path: "/core/worktrees/thread-8/repo",
      managed: true,
      workspaceProvisionType: "managed-worktree",
    });
    const host = createFakePluginHost({
      pluginId: "worktree",
      sdk: {
        environments: {
          list: async () => [orphan, checkout, personal, busy],
          get: async ({ environmentId }: { environmentId: string }) => {
            if (environmentId !== "env-orphan") throw new Error("unexpected get");
            return orphan;
          },
          delete: async () => ({ ok: true }),
        },
        threads: {
          list: async () => [{ id: "thread-8", environmentId: "env-busy" }],
        },
      },
      experimental_callHostRpc: () => null,
    });
    await plugin(host.bb);

    await host.harness.runSchedule("retire-sweep");
    expect(await host.bb.storage.kv.list("retire:")).toEqual(["retire:env-orphan"]);
    expect(host.harness.experimental_hostRpcCalls).toHaveLength(0);

    vi.setSystemTime(1_000_000 + 6 * 60_000);
    await host.harness.runSchedule("retire-sweep");
    expect(host.harness.experimental_hostRpcCalls).toEqual([
      expect.objectContaining({
        method: "teardown",
        input: expect.objectContaining({ path: "/core/worktrees/thread-9/repo" }),
      }),
    ]);
    expect(host.harness.sdk.callsTo("environments.delete")).toEqual([
      [{ environmentId: "env-orphan" }],
    ]);
    await expect(
      host.bb.storage.kv.get("retire:env-orphan"),
    ).resolves.toBeUndefined();
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
        return { path: "/hosts/worktrees/thread-1/repo", log: "" };
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
