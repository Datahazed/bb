import type {
  BbPluginApi,
  PluginThreadEventPayloads,
} from "@get-bb/plugin-sdk";
import { z } from "zod";
import { baseBranchSpecSchema, worktreeHostContract } from "./contract.js";

const RETRY_DELAY_MS = 30_000;

const configurationSchema = z.object({
  hostId: z.string().min(1),
  baseBranch: baseBranchSpecSchema,
});

type WorktreeConfiguration = z.infer<typeof configurationSchema>;

type Launch =
  | { phase: "creating"; progress: string }
  | { phase: "ready"; hostId: string; path: string }
  | { phase: "failed"; error: string; failedAt: number };

function launchKey(threadId: string): string {
  return `launch:${threadId}`;
}

function worktreeKey(hostId: string, path: string): string {
  return `worktree:${hostId}:${path}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

  async function create(
    threadId: string,
    projectId: string,
    configuration: WorktreeConfiguration,
  ): Promise<void> {
    const key = launchKey(threadId);
    launchingThreadIds.add(threadId);
    try {
      await bb.storage.kv.set(key, {
        phase: "creating",
        progress: "Creating worktree…",
      } satisfies Launch);
      const { setupScript } = await settings.get();
      const sourcePath = await resolveSourcePath(
        projectId,
        configuration.hostId,
      );
      const { path } = await host.call(
        "create",
        {
          threadId,
          sourcePath,
          baseBranch: configuration.baseBranch,
          setupScript,
        },
        { hostId: configuration.hostId },
      );
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
          void create(thread.id, project.id, parsed.data);
        }
        return { action: "wait", reason: "Creating worktree…" };
      }
      switch (launch.phase) {
        case "creating":
          if (!launchingThreadIds.has(thread.id)) {
            void create(thread.id, project.id, parsed.data);
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
          };
      }
    },
  });

  async function teardownForThread(
    thread: PluginThreadEventPayloads["thread.archived"]["thread"],
  ): Promise<void> {
    await bb.storage.kv.delete(launchKey(thread.id));
    if (thread.environmentId === null) return;
    const environment = await bb.sdk.environments.get({
      environmentId: thread.environmentId,
    });
    if (environment.path === null) return;
    const key = worktreeKey(environment.hostId, environment.path);
    const owned = await bb.storage.kv.get(key);
    if (owned === undefined) return;
    const threads = await bb.sdk.threads.list({
      projectId: thread.projectId,
      archived: false,
    });
    if (threads.some((row) => row.environmentId === environment.id)) return;
    const { teardownScript } = await settings.get();
    await host.call(
      "teardown",
      { path: environment.path, teardownScript },
      { hostId: environment.hostId },
    );
    await bb.storage.kv.delete(key);
  }

  for (const event of ["thread.archived", "thread.deleted"] as const) {
    bb.events.on(event, async ({ thread }) => {
      try {
        await teardownForThread(thread);
      } catch (error) {
        bb.log.warn(
          `Could not tear down the worktree for thread ${thread.id}: ${errorMessage(error)}`,
        );
      }
    });
  }

  bb.events.on("message.cancelled", async ({ entry }) => {
    const launch = await bb.storage.kv.get<Launch>(launchKey(entry.threadId));
    if (launch?.phase === "creating") {
      await bb.storage.kv.delete(launchKey(entry.threadId));
    }
  });
}
