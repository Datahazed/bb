import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BB_SELF_UPDATE_EXIT_CODE,
  formatSelfUpdateSentinelPath,
  formatSelfUpdateStagingDir,
  formatStagedPackageRoot,
} from "@bb/config/self-update";
import {
  environments,
  hosts,
  projects,
  queuedThreadMessages,
  threads,
} from "@bb/db";
import type { ThreadStatus } from "@bb/domain";
import type { SystemVersionInfo } from "@bb/server-contract";
import { initDb } from "../../src/db.js";
import { ApiError } from "../../src/errors.js";
import {
  createSelfUpdateService,
  type CreateSelfUpdateServiceArgs,
  type StagingInstallArgs,
} from "../../src/services/system/self-update.js";
import { testLogger } from "../helpers/test-app.js";

const CURRENT_VERSION = "0.0.10";
const TARGET_VERSION = "0.0.11";

interface HarnessOverrides {
  latestVersion?: string | null;
  quietPeriodMs?: number;
  selfUpdateProtocol?: boolean;
  runStagingInstall?: (args: StagingInstallArgs) => Promise<void>;
}

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop()?.();
  }
});

function createStubAppVersionService(latestVersion: string | null) {
  return {
    async getSystemVersion(): Promise<SystemVersionInfo> {
      return {
        currentVersion: CURRENT_VERSION,
        latestVersion,
        source: "npm",
        updateAvailable:
          latestVersion !== null && latestVersion !== CURRENT_VERSION,
        isDevelopment: false,
        upgradeCommand: "npx bb-app@latest",
      };
    },
  };
}

async function writeStagedPackage(
  dataDir: string,
  version: string,
): Promise<void> {
  const stagedPackageRoot = formatStagedPackageRoot(dataDir, version);
  await mkdir(stagedPackageRoot, { recursive: true });
  await writeFile(
    join(stagedPackageRoot, "package.json"),
    JSON.stringify({ name: "bb-app", version }),
    "utf8",
  );
}

async function createHarness(overrides: HarnessOverrides = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), "bb-self-update-test-"));
  cleanups.push(() => rm(dataDir, { force: true, recursive: true }));
  const db = initDb(":memory:");
  const now = Date.now();
  db.insert(projects)
    .values({ id: "proj_1", name: "Test", createdAt: now, updatedAt: now })
    .run();

  const exitProcess = vi.fn();
  const prepareShutdown = vi.fn(() => Promise.resolve());
  const runStagingInstall =
    overrides.runStagingInstall ??
    (async (args: StagingInstallArgs) => {
      const version = args.packageSpec.split("@")[1];
      await writeStagedPackage(dataDir, version);
    });

  const serviceArgs: CreateSelfUpdateServiceArgs = {
    appVersion: createStubAppVersionService(
      overrides.latestVersion === undefined
        ? TARGET_VERSION
        : overrides.latestVersion,
    ),
    config: {
      appVersion: CURRENT_VERSION,
      dataDir,
      isDevelopment: false,
      selfUpdateProtocol: overrides.selfUpdateProtocol ?? true,
    },
    db,
    logger: testLogger,
    prepareShutdown,
    exitProcess,
    pollIntervalMs: 5,
    quietPeriodMs: overrides.quietPeriodMs ?? 25,
    runStagingInstall,
  };
  const service = createSelfUpdateService(serviceArgs);
  cleanups.push(async () => service.stop());

  function insertThread(
    id: string,
    status: ThreadStatus,
    environmentId?: string,
  ): void {
    db.insert(threads)
      .values({
        id,
        projectId: "proj_1",
        providerId: "test-provider",
        status,
        environmentId: environmentId ?? null,
        latestAttentionAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }

  /** An idle thread holding a queued follow-up the auto-send sweep would start. */
  function insertIdleThreadWithQueuedMessage(threadId: string): void {
    db.insert(hosts)
      .values({
        id: "host_1",
        name: "Test Host",
        type: "persistent",
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .run();
    db.insert(environments)
      .values({
        id: `env_${threadId}`,
        projectId: "proj_1",
        hostId: "host_1",
        workspaceProvisionType: "unmanaged",
        createdAt: now,
        updatedAt: now,
      })
      .run();
    insertThread(threadId, "idle", `env_${threadId}`);
    db.insert(queuedThreadMessages)
      .values({
        id: `qmsg_${threadId}`,
        threadId,
        content: "queued follow-up",
        model: "test/mock-model",
        reasoningLevel: "medium",
        permissionMode: "workspace-write",
        serviceTier: "standard",
        sortKey: "V",
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }

  function setThreadStatus(id: string, status: ThreadStatus): void {
    db.update(threads).set({ status }).where(eq(threads.id, id)).run();
  }

  return {
    dataDir,
    db,
    exitProcess,
    insertIdleThreadWithQueuedMessage,
    insertThread,
    prepareShutdown,
    service,
    serviceArgs,
    setThreadStatus,
  };
}

async function waitForWaitingPhase(
  service: Awaited<ReturnType<typeof createHarness>>["service"],
): Promise<void> {
  await vi.waitFor(() => {
    expect(service.getState().scheduled?.phase).toBe("waiting");
  });
}

describe("self-update service", () => {
  it("stages, writes the sentinel, and exits immediately when nothing is running or queued", async () => {
    // A quiet period far longer than the test proves the at-rest fast path.
    const harness = await createHarness({ quietPeriodMs: 60_000 });
    const state = await harness.service.schedule("when-idle");
    expect(state.scheduled).toEqual({
      targetVersion: TARGET_VERSION,
      phase: "staging",
      mode: "when-idle",
    });

    await waitForWaitingPhase(harness.service);
    await expect(
      stat(formatSelfUpdateSentinelPath(harness.dataDir)),
    ).resolves.toBeDefined();

    await vi.waitFor(() => {
      expect(harness.exitProcess).toHaveBeenCalledWith(
        BB_SELF_UPDATE_EXIT_CODE,
      );
    });
    expect(harness.prepareShutdown).toHaveBeenCalledTimes(1);
  });

  it("does not skip the quiet period while a queued follow-up is pending", async () => {
    const harness = await createHarness({ quietPeriodMs: 60_000 });
    harness.insertIdleThreadWithQueuedMessage("thr_queued");
    await harness.service.schedule("when-idle");
    await waitForWaitingPhase(harness.service);

    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(harness.exitProcess).not.toHaveBeenCalled();
  });

  it("mode now applies straight after staging even while agents are busy", async () => {
    const harness = await createHarness({ quietPeriodMs: 60_000 });
    harness.insertThread("thr_busy", "active");
    const state = await harness.service.schedule("now");
    expect(state.scheduled?.mode).toBe("now");

    await vi.waitFor(() => {
      expect(harness.exitProcess).toHaveBeenCalledWith(
        BB_SELF_UPDATE_EXIT_CODE,
      );
    });
    await expect(
      stat(formatSelfUpdateSentinelPath(harness.dataDir)),
    ).resolves.toBeDefined();
  });

  it("update-now escalates a deferred schedule that is waiting on agents", async () => {
    const harness = await createHarness({ quietPeriodMs: 60_000 });
    harness.insertThread("thr_busy", "active");
    await harness.service.schedule("when-idle");
    await waitForWaitingPhase(harness.service);
    expect(harness.exitProcess).not.toHaveBeenCalled();

    const state = await harness.service.schedule("now");
    expect(state.scheduled?.mode).toBe("now");
    await vi.waitFor(() => {
      expect(harness.exitProcess).toHaveBeenCalledWith(
        BB_SELF_UPDATE_EXIT_CODE,
      );
    });
  });

  it("does not skip the quiet period once agents have been seen working", async () => {
    const harness = await createHarness({ quietPeriodMs: 60_000 });
    harness.insertThread("thr_busy", "active");
    await harness.service.schedule("when-idle");
    await waitForWaitingPhase(harness.service);

    harness.setThreadStatus("thr_busy", "idle");
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(harness.exitProcess).not.toHaveBeenCalled();
  });

  it("waits for busy threads to finish before exiting", async () => {
    const harness = await createHarness();
    harness.insertThread("thr_busy", "active");
    await harness.service.schedule("when-idle");
    await waitForWaitingPhase(harness.service);

    // Comfortably past the quiet period while the thread is still active.
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(harness.exitProcess).not.toHaveBeenCalled();

    harness.setThreadStatus("thr_busy", "idle");
    await vi.waitFor(() => {
      expect(harness.exitProcess).toHaveBeenCalledWith(
        BB_SELF_UPDATE_EXIT_CODE,
      );
    });
  });

  it("does not exit while any agent is busy, even across handoffs", async () => {
    const harness = await createHarness();
    harness.insertThread("thr_gate", "active");
    await harness.service.schedule("when-idle");
    await waitForWaitingPhase(harness.service);

    // One agent finishes while another starts in the same instant: the
    // watcher must never observe an idle server.
    harness.setThreadStatus("thr_gate", "idle");
    harness.insertThread("thr_late", "starting");
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(harness.exitProcess).not.toHaveBeenCalled();

    harness.setThreadStatus("thr_late", "idle");
    await vi.waitFor(() => {
      expect(harness.exitProcess).toHaveBeenCalledWith(
        BB_SELF_UPDATE_EXIT_CODE,
      );
    });
  });

  it("cancel removes the sentinel and staged install and stops the watcher", async () => {
    const harness = await createHarness();
    harness.insertThread("thr_busy", "active");
    await harness.service.schedule("when-idle");
    await waitForWaitingPhase(harness.service);

    const state = await harness.service.cancel();
    expect(state.scheduled).toBeNull();
    await expect(
      stat(formatSelfUpdateSentinelPath(harness.dataDir)),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      stat(formatSelfUpdateStagingDir(harness.dataDir, TARGET_VERSION)),
    ).rejects.toMatchObject({ code: "ENOENT" });

    harness.setThreadStatus("thr_busy", "idle");
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(harness.exitProcess).not.toHaveBeenCalled();
  });

  it("records a staging failure without leaving a sentinel behind", async () => {
    const harness = await createHarness({
      runStagingInstall: async () => {
        throw new Error("npm exploded");
      },
    });
    await harness.service.schedule("when-idle");
    await vi.waitFor(() => {
      expect(harness.service.getState().scheduled).toBeNull();
    });
    expect(harness.service.getState().lastError).toContain("npm exploded");
    await expect(
      stat(formatSelfUpdateSentinelPath(harness.dataDir)),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects scheduling when no update is available or when not capable", async () => {
    const upToDate = await createHarness({ latestVersion: CURRENT_VERSION });
    await expect(upToDate.service.schedule("when-idle")).rejects.toMatchObject({
      body: { code: "no_update_available" },
    });

    const incapable = await createHarness({ selfUpdateProtocol: false });
    await expect(incapable.service.schedule("when-idle")).rejects.toBeInstanceOf(ApiError);
    expect(incapable.service.getState().capable).toBe(false);
  });

  it("resumes a pending schedule from the sentinel on boot", async () => {
    const harness = await createHarness();
    harness.insertThread("thr_busy", "active");
    await writeStagedPackage(harness.dataDir, TARGET_VERSION);
    await writeFile(
      formatSelfUpdateSentinelPath(harness.dataDir),
      JSON.stringify({
        targetVersion: TARGET_VERSION,
        stagedPackageRoot: formatStagedPackageRoot(
          harness.dataDir,
          TARGET_VERSION,
        ),
        requestedAt: new Date().toISOString(),
      }),
      "utf8",
    );

    await harness.service.resume();
    expect(harness.service.getState().scheduled).toEqual({
      targetVersion: TARGET_VERSION,
      phase: "waiting",
      mode: "when-idle",
    });

    harness.setThreadStatus("thr_busy", "idle");
    await vi.waitFor(() => {
      expect(harness.exitProcess).toHaveBeenCalledWith(
        BB_SELF_UPDATE_EXIT_CODE,
      );
    });
  });

  it("discards a stale sentinel targeting the running version and prunes staging", async () => {
    const harness = await createHarness();
    // Simulate a completed update: the sentinel targets the version that is
    // now running, and an older staged install is still on disk.
    await writeStagedPackage(harness.dataDir, CURRENT_VERSION);
    await writeStagedPackage(harness.dataDir, "0.0.9");
    await writeFile(
      formatSelfUpdateSentinelPath(harness.dataDir),
      JSON.stringify({
        targetVersion: CURRENT_VERSION,
        stagedPackageRoot: formatStagedPackageRoot(
          harness.dataDir,
          CURRENT_VERSION,
        ),
        requestedAt: new Date().toISOString(),
      }),
      "utf8",
    );

    await harness.service.resume();
    expect(harness.service.getState().scheduled).toBeNull();
    await expect(
      stat(formatSelfUpdateSentinelPath(harness.dataDir)),
    ).rejects.toMatchObject({ code: "ENOENT" });
    // The running version's staged install survives (we may be running from
    // it); the older one is pruned.
    await expect(
      stat(formatSelfUpdateStagingDir(harness.dataDir, CURRENT_VERSION)),
    ).resolves.toBeDefined();
    await expect(
      stat(formatSelfUpdateStagingDir(harness.dataDir, "0.0.9")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("resolveNpmInvocation", () => {
  it("uses real npm from npm_execpath but never pnpm/yarn", async () => {
    const { resolveNpmInvocation } = await import(
      "../../src/services/system/self-update.js"
    );
    expect(
      resolveNpmInvocation({ npm_execpath: "/usr/lib/node_modules/npm/bin/npm-cli.js" }),
    ).toEqual({
      command: process.execPath,
      argsPrefix: ["/usr/lib/node_modules/npm/bin/npm-cli.js"],
    });
    // pnpm sets npm_execpath to its own CLI, which rejects npm's flags.
    expect(
      resolveNpmInvocation({ npm_execpath: "/x/pnpm/bin/pnpm.cjs" }),
    ).toEqual({ command: "npm", argsPrefix: [] });
    expect(resolveNpmInvocation({})).toEqual({ command: "npm", argsPrefix: [] });
  });
});
