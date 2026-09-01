import {
  claimQueuedThreadMessageGroup,
  getThread,
  listQueuedThreadMessages,
} from "@bb/db";
import type { JsonValue } from "@bb/domain";
import type {
  PluginEnvironmentProvisionContext,
  PluginEnvironmentProvisionDecision,
} from "@get-bb/plugin-sdk";
import { afterEach, describe, expect, it } from "vitest";
import { ApiError } from "../../src/errors.js";
import {
  setPluginEnvironmentTargetProvider,
  type PluginEnvironmentTargetRecord,
} from "../../src/services/plugins/plugin-environment-target-registry.js";
import {
  setPluginHookProvider,
  type PluginHookRegistration,
} from "../../src/services/plugins/plugin-hook-registry.js";
import { attemptDispatch } from "../../src/services/threads/dispatch-attempt.js";
import { createThreadFromRequest } from "../../src/services/threads/thread-create.js";
import { textInput } from "../helpers/prompt-input.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

const WORKSPACE_PATH = "/tmp/environment-targets-project";
const PLUGIN_ID = "sandbox";
const TARGET_ID = "container";

interface FakeTarget {
  provision: (
    context: PluginEnvironmentProvisionContext,
  ) => PluginEnvironmentProvisionDecision | Promise<PluginEnvironmentProvisionDecision>;
  hostScoped?: boolean;
}

function installTarget(fake: FakeTarget | null): void {
  const records: PluginEnvironmentTargetRecord[] =
    fake === null
      ? []
      : [
          {
            pluginId: PLUGIN_ID,
            target: {
              id: TARGET_ID,
              title: "Fake container",
              icon: null,
              hostScoped: fake.hostScoped ?? false,
              defaultConfiguration: null,
              provision: fake.provision,
            },
          },
        ];
  setPluginEnvironmentTargetProvider({
    listEnvironmentTargets: () => records,
    getEnvironmentTarget: (pluginId, targetId) =>
      records.find(
        (record) =>
          record.pluginId === pluginId && record.target.id === targetId,
      ),
    invokeTarget: async (_pluginId, _label, run) => {
      try {
        return { ok: true, value: await run() };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
    decisionTimeoutMs: 10_000,
  });
}

afterEach(() => {
  setPluginEnvironmentTargetProvider(undefined);
  setPluginHookProvider(undefined);
});

function seedTargetFixture(harness: TestAppHarness, hostId: string) {
  const { host } = seedHostSession(harness.deps, { id: hostId });
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: host.id,
    path: WORKSPACE_PATH,
  });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
    path: WORKSPACE_PATH,
  });
  return { environment, host, project };
}

function createTargetThread(
  harness: TestAppHarness,
  args: {
    projectId: string;
    configuration?: JsonValue;
    model?: string | undefined;
  },
) {
  const model = "model" in args ? args.model : "requested-model";
  return createThreadFromRequest(harness.deps, {
    environment: {
      type: "plugin-target",
      pluginId: PLUGIN_ID,
      targetId: TARGET_ID,
      configuration: args.configuration ?? null,
    },
    input: textInput("Do the thing"),
    origin: "app",
    projectId: args.projectId,
    providerId: "codex",
    ...(model !== undefined ? { model } : {}),
    startedOnBehalfOf: null,
  });
}

function onlyQueuedRow(harness: TestAppHarness, threadId: string) {
  const rows = listQueuedThreadMessages(harness.db, threadId);
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

describe("plugin environment targets at the dispatch checkpoint", () => {
  it("queues the first message on the target's wait, with the thread pending and no environment", async () => {
    await withTestHarness(async (harness) => {
      const contexts: PluginEnvironmentProvisionContext[] = [];
      installTarget({
        provision: (context) => {
          contexts.push(context);
          return { action: "wait", reason: "Starting container…" };
        },
      });
      const { project } = seedTargetFixture(harness, "host-target-wait");
      const created = await createTargetThread(harness, {
        projectId: project.id,
        configuration: { image: "img" },
      });

      const thread = getThread(harness.db, created.id);
      expect(thread?.status).toBe("pending");
      expect(thread?.environmentId).toBeNull();
      const row = onlyQueuedRow(harness, created.id);
      expect(JSON.parse(row.waitingOn ?? "null")).toEqual({
        kind: "plugin",
        pluginId: PLUGIN_ID,
        reason: "Starting container…",
      });
      expect(contexts).toHaveLength(1);
      expect(contexts[0]?.thread.id).toBe(created.id);
      expect(contexts[0]?.configuration).toEqual({ image: "img" });
      expect(contexts[0]?.queuedMessage).toBeNull();
    });
  });

  it("carries the target's sendAt onto the row as the retry timer", async () => {
    await withTestHarness(async (harness) => {
      const retryAt = Date.now() + 30_000;
      installTarget({
        provision: () => ({
          action: "wait",
          reason: "Failed: no capacity",
          sendAt: retryAt,
        }),
      });
      const { project } = seedTargetFixture(harness, "host-target-retry");
      const created = await createTargetThread(harness, {
        projectId: project.id,
      });
      expect(onlyQueuedRow(harness, created.id).sendAt).toBe(retryAt);
    });
  });

  it("resolves a ready answer through placement and admits through the hook pass", async () => {
    await withTestHarness(async (harness) => {
      const hookEnvironments: Array<string | null> = [];
      const registry: {
        "message.dispatch": PluginHookRegistration<"message.dispatch">[];
      } = { "message.dispatch": [] };
      registry["message.dispatch"].push({
        pluginId: "observer",
        handler: (context) => {
          hookEnvironments.push(context.environment?.id ?? null);
          return { action: "proceed" } as const;
        },
      });
      setPluginHookProvider({
        listHooks: (hook) => registry[hook],
        invokeHook: async (_pluginId, _label, run) => ({
          ok: true,
          value: await run(),
        }),
        decisionTimeoutMs: 10_000,
      });
      const { environment, host, project } = seedTargetFixture(
        harness,
        "host-target-ready",
      );
      installTarget({
        provision: () => ({
          action: "ready",
          environment: {
            type: "host",
            hostId: host.id,
            workspace: { type: "unmanaged", path: WORKSPACE_PATH },
          },
        }),
      });
      const created = await createTargetThread(harness, {
        projectId: project.id,
      });

      const thread = getThread(harness.db, created.id);
      expect(thread?.status).toBe("starting");
      expect(thread?.environmentId).toBe(environment.id);
      expect(listQueuedThreadMessages(harness.db, created.id)).toHaveLength(0);
      expect(hookEnvironments).toEqual([environment.id]);
    });
  });

  it("re-asks on a drain and dispatches once the target answers ready", async () => {
    await withTestHarness(async (harness) => {
      let phase: "wait" | "ready" = "wait";
      const asks: Array<PluginEnvironmentProvisionContext> = [];
      const { environment, host, project } = seedTargetFixture(
        harness,
        "host-target-drain",
      );
      installTarget({
        provision: (context) => {
          asks.push(context);
          if (phase === "wait") {
            return { action: "wait", reason: "Enrolling…" };
          }
          return {
            action: "ready",
            environment: {
              type: "host",
              hostId: host.id,
              workspace: { type: "unmanaged", path: WORKSPACE_PATH },
            },
          };
        },
      });
      const created = await createTargetThread(harness, {
        projectId: project.id,
      });
      const row = onlyQueuedRow(harness, created.id);
      phase = "ready";

      const claimed = claimQueuedThreadMessageGroup(
        harness.db,
        harness.deps.hub,
        row.id,
      );
      expect(claimed).not.toBeNull();
      const pending = getThread(harness.db, created.id);
      if (!pending) throw new Error("expected the pending thread");
      const outcome = await attemptDispatch(harness.deps, {
        thread: pending,
        payload: { input: textInput("Do the thing"), mode: "start" },
        source: { kind: "drain", claimed: claimed!, sendNow: false },
        queuePayload: { kind: "inline" },
        origin: null,
        originPluginId: null,
        startedOnBehalfOf: null,
        trigger: "auto-dispatch",
      });

      expect(outcome.kind).toBe("dispatched");
      expect(getThread(harness.db, created.id)?.status).toBe("starting");
      expect(getThread(harness.db, created.id)?.environmentId).toBe(
        environment.id,
      );
      expect(asks).toHaveLength(2);
      expect(asks[1]?.queuedMessage?.id).toBe(row.id);
    });
  });

  it("refuses the create when the target rejects, leaving nothing behind", async () => {
    await withTestHarness(async (harness) => {
      installTarget({
        provision: () => ({
          action: "reject",
          message: "Choose a container image.",
        }),
      });
      const { project } = seedTargetFixture(harness, "host-target-reject");
      const refused = await createTargetThread(harness, {
        projectId: project.id,
      }).then(
        () => null,
        (error: unknown) => error,
      );
      expect(refused).toBeInstanceOf(ApiError);
      expect((refused as ApiError).body.code).toBe("dispatch_rejected");
      expect((refused as ApiError).body.message).toBe(
        "Choose a container image.",
      );
    });
  });

  it("fails the attempt with the plugin named when provision throws", async () => {
    await withTestHarness(async (harness) => {
      installTarget({
        provision: () => {
          throw new Error("docker daemon unreachable");
        },
      });
      const { project } = seedTargetFixture(harness, "host-target-throw");
      const failed = await createTargetThread(harness, {
        projectId: project.id,
      }).then(
        () => null,
        (error: unknown) => error,
      );
      expect(failed).toBeInstanceOf(ApiError);
      expect((failed as ApiError).body.code).toBe("environment_target_failed");
      expect((failed as ApiError).body.message).toContain(PLUGIN_ID);
      expect((failed as ApiError).body.message).toContain(
        "docker daemon unreachable",
      );
    });
  });

  it("waits with a core-authored reason and backoff when the target is not registered", async () => {
    await withTestHarness(async (harness) => {
      installTarget(null);
      const { project } = seedTargetFixture(harness, "host-target-missing");
      const before = Date.now();
      const created = await createTargetThread(harness, {
        projectId: project.id,
      });
      const row = onlyQueuedRow(harness, created.id);
      const waitingOn = JSON.parse(row.waitingOn ?? "null") as {
        kind: string;
        pluginId: string;
        reason: string;
      };
      expect(waitingOn.kind).toBe("plugin");
      expect(waitingOn.pluginId).toBe(PLUGIN_ID);
      expect(waitingOn.reason).toContain("not available");
      expect(row.sendAt).toBeGreaterThanOrEqual(before + 30_000);
    });
  });

  it("requires an explicit model when the target names no machine", async () => {
    await withTestHarness(async (harness) => {
      installTarget({ provision: () => ({ action: "wait", reason: "…" }) });
      const { project } = seedTargetFixture(harness, "host-target-model");
      const failed = await createTargetThread(harness, {
        projectId: project.id,
        model: undefined,
      }).then(
        () => null,
        (error: unknown) => error,
      );
      expect(failed).toBeInstanceOf(ApiError);
      expect((failed as ApiError).body.code).toBe("model_required");
    });
  });

  it("resolves the model catalog through configuration.hostId for a host-scoped selection", async () => {
    await withTestHarness(async (harness) => {
      installTarget({
        hostScoped: true,
        provision: () => ({ action: "wait", reason: "Creating worktree…" }),
      });
      const { host, project } = seedTargetFixture(harness, "host-target-scoped");
      const created = await createTargetThread(harness, {
        projectId: project.id,
        configuration: { hostId: host.id },
        model: undefined,
      });
      expect(getThread(harness.db, created.id)?.status).toBe("pending");
      expect(onlyQueuedRow(harness, created.id)).toBeDefined();
    });
  });

  it("survives a restart: a fresh attempt reads the intent back and resolves it", async () => {
    await withTestHarness(async (harness) => {
      let phase: "wait" | "ready" = "wait";
      const { environment, host, project } = seedTargetFixture(
        harness,
        "host-target-restart",
      );
      installTarget({
        provision: () =>
          phase === "wait"
            ? { action: "wait", reason: "Provisioning…" }
            : {
                action: "ready",
                environment: {
                  type: "host",
                  hostId: host.id,
                  workspace: { type: "unmanaged", path: WORKSPACE_PATH },
                },
              },
      });
      const created = await createTargetThread(harness, {
        projectId: project.id,
      });
      phase = "ready";

      const stale = getThread(harness.db, created.id);
      if (!stale) throw new Error("expected the pending thread");
      const outcome = await attemptDispatch(harness.deps, {
        thread: stale,
        payload: { input: textInput("Follow-up"), mode: "start" },
        source: { kind: "inline" },
        queuePayload: { kind: "inline" },
        origin: null,
        originPluginId: null,
        startedOnBehalfOf: null,
        trigger: "user",
      });

      expect(outcome.kind).toBe("dispatched");
      expect(getThread(harness.db, created.id)?.environmentId).toBe(
        environment.id,
      );
    });
  });
});
