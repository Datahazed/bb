import type {
  BbPluginApi,
  PluginThreadEventPayloads,
} from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  BRANCH_EXISTS_ERROR_MARKER,
  baseBranchSpecSchema,
  worktreeHostContract,
} from "./contract.js";

const RETRY_DELAY_MS = 30_000;
const RETIRE_GRACE_MS = 5 * 60_000;
const BRANCH_SLUG_MAX_LENGTH = 40;

const configurationSchema = z.object({
  hostId: z.string().min(1),
  baseBranch: baseBranchSpecSchema,
});

type WorktreeConfiguration = z.infer<typeof configurationSchema>;

type Launch =
  | { phase: "creating"; progress: string; branchName?: string }
  | { phase: "ready"; hostId: string; path: string; log?: string }
  | { phase: "failed"; error: string; failedAt: number };

interface BranchNamePlan {
  primary: string;
  retry: string | null;
}

interface RetireRecord {
  at: number;
  environmentId: string;
  hostId: string;
  path: string;
  projectId: string;
}

type EnvironmentRow = Awaited<
  ReturnType<BbPluginApi["sdk"]["environments"]["get"]>
>;

function launchKey(threadId: string): string {
  return `launch:${threadId}`;
}

function worktreeKey(hostId: string, path: string): string {
  return `worktree:${hostId}:${path}`;
}

function retireKey(environmentId: string): string {
  return `retire:${environmentId}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function slugFromTitle(title: string | null): string | null {
  if (title === null) return null;
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, BRANCH_SLUG_MAX_LENGTH)
    .replace(/-+$/, "");
  return slug.length > 0 ? slug : null;
}

interface BranchNameSubject {
  id: string;
  title: string | null;
  titleFallback: string | null;
}

function branchNamesForThread(
  thread: BranchNameSubject,
  branchPrefix: string,
): BranchNamePlan {
  const slug = slugFromTitle(thread.title ?? thread.titleFallback);
  if (slug === null) {
    return { primary: `${branchPrefix}${thread.id}`, retry: null };
  }
  return {
    primary: `${branchPrefix}${slug}`,
    retry: `${branchPrefix}${slug}-${thread.id.slice(-4)}`,
  };
}

function isBranchExistsError(error: unknown): boolean {
  return errorMessage(error).includes(BRANCH_EXISTS_ERROR_MARKER);
}

export default async function worktreePlugin(bb: BbPluginApi): Promise<void> {
  const settings = bb.settings.define({
    setupScript: {
      type: "string",
      label: "Setup script",
      default: ".bb-env-setup.sh",
      description:
        "Path relative to the worktree root, run after the worktree is created.",
    },
    teardownScript: {
      type: "string",
      label: "Teardown script",
      default: ".bb-env-teardown.sh",
      description:
        "Path relative to the worktree root, run before the worktree is removed.",
    },
  });
  const host = bb.hosts.experimental_client({ contract: worktreeHostContract });
  const launchingThreadIds = new Set<string>();

  async function resolveSourcePath(
    projectId: string,
    hostId: string,
  ): Promise<string> {
    const project = await bb.sdk.projects.get({ projectId });
    const source = project.sources.find(
      (candidate) =>
        candidate.type === "local_path" && candidate.hostId === hostId,
    );
    if (source === undefined) {
      throw new Error("This project has no checkout on the selected machine.");
    }
    return source.path;
  }

  async function branchPrefix(): Promise<string> {
    try {
      const config = await bb.sdk.system.config();
      return config.generalSettings.managedBranchPrefix;
    } catch (error) {
      bb.log.warn(
        `Could not read the configured branch prefix, using bb/: ${errorMessage(error)}`,
      );
      return "bb/";
    }
  }

  async function create(
    threadId: string,
    projectId: string,
    configuration: WorktreeConfiguration,
    thread: BranchNameSubject,
    recordedBranchName: string | undefined,
  ): Promise<void> {
    const key = launchKey(threadId);
    launchingThreadIds.add(threadId);
    try {
      const computed = branchNamesForThread(thread, await branchPrefix());
      const branchNames: BranchNamePlan =
        recordedBranchName === undefined
          ? computed
          : {
              primary: recordedBranchName,
              retry:
                computed.retry === recordedBranchName ? null : computed.retry,
            };
      await bb.storage.kv.set(key, {
        phase: "creating",
        progress: "Creating worktree…",
        branchName: branchNames.primary,
      } satisfies Launch);
      const { setupScript } = await settings.get();
      const sourcePath = await resolveSourcePath(
        projectId,
        configuration.hostId,
      );
      const attempt = (branchName: string) =>
        host.call(
          "create",
          {
            threadId,
            sourcePath,
            baseBranch: configuration.baseBranch,
            setupScript,
            branchName,
          },
          { hostId: configuration.hostId },
        );
      let path: string;
      let log: string;
      try {
        ({ path, log } = await attempt(branchNames.primary));
      } catch (error) {
        if (
          branchNames.retry === null ||
          branchNames.retry === branchNames.primary ||
          !isBranchExistsError(error)
        ) {
          throw error;
        }
        await bb.storage.kv.set(key, {
          phase: "creating",
          progress: "Creating worktree…",
          branchName: branchNames.retry,
        } satisfies Launch);
        ({ path, log } = await attempt(branchNames.retry));
      }
      const pending = await bb.storage.kv.get<Launch>(key);
      if (pending === undefined) {
        const { teardownScript } = await settings.get();
        await host.call(
          "teardown",
          { path, teardownScript },
          { hostId: configuration.hostId },
        );
        return;
      }
      await bb.storage.kv.set(key, {
        phase: "ready",
        hostId: configuration.hostId,
        path,
        log,
      } satisfies Launch);
      await bb.storage.kv.set(worktreeKey(configuration.hostId, path), {
        hostId: configuration.hostId,
        path,
      });
    } catch (error) {
      bb.log.warn(
        `Could not create a worktree for thread ${threadId}: ${errorMessage(error)}`,
      );
      await bb.storage.kv.set(key, {
        phase: "failed",
        error: errorMessage(error),
        failedAt: Date.now(),
      } satisfies Launch);
    } finally {
      launchingThreadIds.delete(threadId);
    }
    await bb.experimental_environments.recheck();
  }

  bb.experimental_environments.registerTarget({
    id: "worktree",
    title: "New worktree",
    icon: "GitBranch",
    hostScoped: true,
    defaultConfiguration: null,
    provision: async ({ thread, project, configuration }) => {
      const parsed = configurationSchema.safeParse(configuration);
      if (!parsed.success) {
        return { action: "reject", message: "Choose a machine and base branch." };
      }
      const launch = await bb.storage.kv.get<Launch>(launchKey(thread.id));
      if (launch === undefined) {
        if (!launchingThreadIds.has(thread.id)) {
          void create(thread.id, project.id, parsed.data, thread, undefined);
        }
        return { action: "wait", reason: "Creating worktree…" };
      }
      switch (launch.phase) {
        case "creating":
          if (!launchingThreadIds.has(thread.id)) {
            void create(
              thread.id,
              project.id,
              parsed.data,
              thread,
              launch.branchName,
            );
          }
          return { action: "wait", reason: launch.progress };
        case "failed":
          return {
            action: "wait",
            reason: `Failed: ${launch.error}`,
            sendAt: launch.failedAt + RETRY_DELAY_MS,
          };
        case "ready":
          return {
            action: "ready",
            environment: {
              type: "host",
              hostId: launch.hostId,
              workspace: { type: "unmanaged", path: launch.path },
            },
            ...(launch.log !== undefined && launch.log.length > 0
              ? { log: launch.log }
              : {}),
          };
      }
    },
  });

  async function isOwnedEnvironment(
    environment: EnvironmentRow,
  ): Promise<boolean> {
    if (environment.path === null) return false;
    if (environment.workspaceProvisionType === "personal") return false;
    const record = await bb.storage.kv.get(
      worktreeKey(environment.hostId, environment.path),
    );
    if (record !== undefined) return true;
    return (
      environment.managed &&
      environment.workspaceProvisionType === "managed-worktree"
    );
  }

  async function environmentHasLiveThreads(
    projectId: string,
    environmentId: string,
  ): Promise<boolean> {
    const threads = await bb.sdk.threads.list({
      projectId,
      archived: false,
    });
    return threads.some((row) => row.environmentId === environmentId);
  }

  async function teardownEnvironment(
    environment: EnvironmentRow,
  ): Promise<void> {
    if (environment.path === null) return;
    const { teardownScript } = await settings.get();
    await host.call(
      "teardown",
      { path: environment.path, teardownScript },
      { hostId: environment.hostId },
    );
    await bb.storage.kv.delete(retireKey(environment.id));
    try {
      await bb.sdk.environments.delete({ environmentId: environment.id });
    } catch (error) {
      bb.log.warn(
        `Could not record environment ${environment.id} as destroyed: ${errorMessage(error)}`,
      );
      return;
    }
    await bb.storage.kv.delete(
      worktreeKey(environment.hostId, environment.path),
    );
  }

  async function scheduleRetire(
    environment: EnvironmentRow,
    projectId: string,
  ): Promise<void> {
    if (environment.path === null) return;
    await bb.storage.kv.set(retireKey(environment.id), {
      at: Date.now(),
      environmentId: environment.id,
      hostId: environment.hostId,
      path: environment.path,
      projectId,
    } satisfies RetireRecord);
  }

  async function teardownForThread(
    thread: PluginThreadEventPayloads["thread.archived"]["thread"],
    mode: "immediate" | "grace",
  ): Promise<void> {
    await bb.storage.kv.delete(launchKey(thread.id));
    if (thread.environmentId === null) return;
    const environment = await bb.sdk.environments.get({
      environmentId: thread.environmentId,
    });
    if (environment.status === "destroyed") return;
    if (!(await isOwnedEnvironment(environment))) return;
    if (await environmentHasLiveThreads(thread.projectId, environment.id)) {
      return;
    }
    if (mode === "immediate") {
      await teardownEnvironment(environment);
      return;
    }
    await scheduleRetire(environment, thread.projectId);
  }

  bb.events.on("thread.archived", async ({ thread }) => {
    try {
      await teardownForThread(thread, "grace");
    } catch (error) {
      bb.log.warn(
        `Could not retire the worktree for thread ${thread.id}: ${errorMessage(error)}`,
      );
    }
  });

  bb.events.on("thread.deleted", async ({ thread }) => {
    try {
      await teardownForThread(thread, "immediate");
    } catch (error) {
      bb.log.warn(
        `Could not tear down the worktree for thread ${thread.id}: ${errorMessage(error)}`,
      );
    }
  });

  async function adoptOrphanedWorktrees(
    liveThreads: (projectId: string, environmentId: string) => Promise<boolean>,
  ): Promise<void> {
    const environments = await bb.sdk.environments.list();
    for (const environment of environments) {
      if (environment.status === "destroyed") continue;
      if (!(await isOwnedEnvironment(environment))) continue;
      const existing = await bb.storage.kv.get<RetireRecord>(
        retireKey(environment.id),
      );
      if (existing !== undefined) continue;
      if (await liveThreads(environment.projectId, environment.id)) continue;
      await scheduleRetire(environment, environment.projectId);
    }
  }

  async function processRetireRecords(
    liveThreads: (projectId: string, environmentId: string) => Promise<boolean>,
  ): Promise<void> {
    const now = Date.now();
    for (const key of await bb.storage.kv.list("retire:")) {
      const record = await bb.storage.kv.get<RetireRecord>(key);
      if (record === undefined) continue;
      if (now - record.at < RETIRE_GRACE_MS) continue;
      let environment: EnvironmentRow;
      try {
        environment = await bb.sdk.environments.get({
          environmentId: record.environmentId,
        });
      } catch {
        await bb.storage.kv.delete(key);
        continue;
      }
      if (environment.status === "destroyed" || environment.path === null) {
        await bb.storage.kv.delete(key);
        continue;
      }
      if (await liveThreads(record.projectId, environment.id)) {
        await bb.storage.kv.delete(key);
        continue;
      }
      try {
        await teardownEnvironment(environment);
      } catch (error) {
        bb.log.warn(
          `Could not tear down worktree environment ${environment.id}: ${errorMessage(error)}`,
        );
      }
    }
  }

  bb.background.schedule("retire-sweep", "* * * * *", async () => {
    const liveByProject = new Map<string, Promise<Set<string>>>();
    const liveThreads = async (
      projectId: string,
      environmentId: string,
    ): Promise<boolean> => {
      let pending = liveByProject.get(projectId);
      if (pending === undefined) {
        pending = bb.sdk.threads
          .list({ projectId, archived: false })
          .then(
            (rows) =>
              new Set(
                rows.flatMap((row) =>
                  row.environmentId === null ? [] : [row.environmentId],
                ),
              ),
          );
        liveByProject.set(projectId, pending);
      }
      return (await pending).has(environmentId);
    };
    await adoptOrphanedWorktrees(liveThreads);
    await processRetireRecords(liveThreads);
  });

  bb.events.on("message.cancelled", async ({ entry }) => {
    const launch = await bb.storage.kv.get<Launch>(launchKey(entry.threadId));
    if (launch?.phase === "creating") {
      await bb.storage.kv.delete(launchKey(entry.threadId));
    }
  });
}
