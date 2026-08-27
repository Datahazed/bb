import {
  getLatestThreadSequence,
  listEnvironments,
  listThreads,
  upsertProjectExecutionDefaults,
} from "@bb/db";
import { describe, expect, it } from "vitest";
import { availableModelFixture } from "../helpers/available-models.js";
import {
  listQueuedCommands,
  waitForQueuedCommand,
} from "../helpers/commands.js";
import { registerProviderHostRpcResponder } from "../helpers/host-rpc.js";
import { readJson } from "../helpers/json.js";
import {
  seedEnvironment,
  seedHostSession,
  seedPrimaryHost,
  seedProjectWithSource,
  seedThread,
  seedThreadRuntimeState,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

function threadCreateBody(args: {
  environment:
    | { type: "reuse"; environmentId: string }
    | {
        type: "host";
        hostId: string;
        workspace: {
          type: "managed-worktree";
          baseBranch: { kind: "default" };
        };
      };
  model: string;
  projectId: string;
  reasoningLevel: "low" | "medium" | "high";
}) {
  return {
    origin: "cli",
    projectId: args.projectId,
    providerId: "claude-code",
    model: args.model,
    reasoningLevel: args.reasoningLevel,
    input: [{ type: "text", text: "Validate before doing work" }],
    environment: args.environment,
  };
}

describe("public thread execution-selection validation", () => {
  it("exposes the same typed target-aware policy for SDK/plugin preflights", async () => {
    await withTestHarness(async (harness) => {
      const primary = seedHostSession(harness.deps, {
        id: "host-sdk-primary",
      });
      const remote = seedHostSession(harness.deps, { id: "host-sdk-remote" });
      seedPrimaryHost(harness.deps, primary.host.id);
      const primaryResponder = registerProviderHostRpcResponder(harness, {
        hostId: primary.host.id,
        sessionId: primary.session.id,
        modelsByProviderId: {
          "claude-code": {
            models: [availableModelFixture({ model: "primary-model" })],
            selectedOnlyModels: [],
          },
        },
      });
      const remoteResponder = registerProviderHostRpcResponder(harness, {
        hostId: remote.host.id,
        sessionId: remote.session.id,
        restoreCommandCaptureAfterResponse: true,
        modelsByProviderId: {
          "claude-code": {
            models: [
              availableModelFixture({
                model: "remote-model",
                reasoningLevels: ["low"],
              }),
            ],
            selectedOnlyModels: [],
          },
        },
      });

      const response = await harness.app.request(
        "/api/v1/system/execution-selection/validate",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            hostId: remote.host.id,
            providerId: "claude-code",
            model: "remote-model",
            reasoningLevel: "medium",
          }),
        },
      );

      expect(response.status).toBe(400);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "reasoning_level_not_supported",
      });
      expect(primaryResponder.requests).toEqual([]);
      expect(
        remoteResponder.requests.map((request) => request.command.type),
      ).toEqual(["provider.list_models"]);
    });
  });

  it.each([
    {
      name: "a model absent from the authoritative catalog",
      model: "claude-does-not-exist-9",
      reasoningLevel: "low" as const,
      expectedCode: "model_not_available",
      expectedMessage: "claude-does-not-exist-9",
    },
    {
      name: "reasoning absent from the selected model contract",
      model: "claude-haiku-test",
      reasoningLevel: "medium" as const,
      expectedCode: "reasoning_level_not_supported",
      expectedMessage: "medium",
    },
  ])(
    "rejects $name before managed-environment and thread provisioning",
    async ({ model, reasoningLevel, expectedCode, expectedMessage }) => {
      await withTestHarness(async (harness) => {
        const { host, session } = seedHostSession(harness.deps);
        const responder = registerProviderHostRpcResponder(harness, {
          hostId: host.id,
          sessionId: session.id,
          restoreCommandCaptureAfterResponse: true,
          modelsByProviderId: {
            "claude-code": {
              models: [
                availableModelFixture({
                  model: "claude-haiku-test",
                  reasoningLevels: ["low"],
                  isDefault: true,
                }),
              ],
              selectedOnlyModels: [],
            },
          },
        });
        const { project } = seedProjectWithSource(harness.deps, {
          hostId: host.id,
          path: "/tmp/execution-selection-managed-source",
        });

        const response = await harness.app.request("/api/v1/threads", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            threadCreateBody({
              projectId: project.id,
              model,
              reasoningLevel,
              environment: {
                type: "host",
                hostId: host.id,
                workspace: {
                  type: "managed-worktree",
                  baseBranch: { kind: "default" },
                },
              },
            }),
          ),
        });

        expect(response.status).toBe(400);
        await expect(readJson(response)).resolves.toMatchObject({
          code: expectedCode,
          message: expect.stringContaining(expectedMessage),
        });
        expect(listThreads(harness.db, { projectId: project.id })).toEqual([]);
        expect(listEnvironments(harness.db, project.id)).toEqual([]);
        expect(
          responder.requests.map((request) => request.command.type),
        ).toEqual(["provider.list_models"]);
        expect(listQueuedCommands(harness, "environment.provision")).toEqual(
          [],
        );
        expect(listQueuedCommands(harness, "thread.start")).toEqual([]);
        expect(listQueuedCommands(harness, "turn.submit")).toEqual([]);
      });
    },
  );

  it("validates against the explicitly targeted remote machine catalog", async () => {
    await withTestHarness(async (harness) => {
      const primary = seedHostSession(harness.deps, {
        id: "host-selection-primary",
      });
      const remote = seedHostSession(harness.deps, {
        id: "host-selection-remote",
      });
      seedPrimaryHost(harness.deps, primary.host.id);
      const primaryResponder = registerProviderHostRpcResponder(harness, {
        hostId: primary.host.id,
        sessionId: primary.session.id,
        modelsByProviderId: {
          "claude-code": {
            models: [availableModelFixture({ model: "primary-only" })],
            selectedOnlyModels: [],
          },
        },
      });
      const remoteResponder = registerProviderHostRpcResponder(harness, {
        hostId: remote.host.id,
        sessionId: remote.session.id,
        restoreCommandCaptureAfterResponse: true,
        modelsByProviderId: {
          "claude-code": {
            models: [
              {
                ...availableModelFixture({
                  model: "remote-only",
                  reasoningLevels: ["high"],
                  defaultReasoningLevel: "high",
                }),
                id: "remote-alias",
              },
            ],
            selectedOnlyModels: [],
          },
        },
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: remote.host.id,
        path: "/tmp/execution-selection-remote-source",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: remote.host.id,
        projectId: project.id,
        path: "/tmp/execution-selection-remote-source",
      });

      const response = await harness.app.request("/api/v1/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          threadCreateBody({
            projectId: project.id,
            model: "remote-alias",
            reasoningLevel: "high",
            environment: {
              type: "reuse",
              environmentId: environment.id,
            },
          }),
        ),
      });

      expect(response.status).toBe(201);
      expect(primaryResponder.requests).toEqual([]);
      expect(
        remoteResponder.requests.map((request) => request.command.type),
      ).toEqual(["provider.list_models"]);
      const queuedStart = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "thread.start",
      );
      expect(queuedStart.command).toMatchObject({
        options: { model: "remote-only" },
      });
    });
  });

  it("rejects an invalid explicit send before appending or submitting a turn", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps);
      const responder = registerProviderHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        restoreCommandCaptureAfterResponse: true,
        modelsByProviderId: {
          "claude-code": {
            models: [
              availableModelFixture({
                model: "claude-valid",
                reasoningLevels: ["low"],
              }),
            ],
            selectedOnlyModels: [],
          },
        },
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/execution-selection-send",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/execution-selection-send",
      });
      const thread = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
        providerId: "claude-code",
        status: "idle",
      });
      seedThreadRuntimeState(harness.deps, {
        environmentId: environment.id,
        model: "claude-valid",
        providerThreadId: "provider-selection-send",
        reasoningLevel: "low",
        threadId: thread.id,
      });
      const sequenceBefore = getLatestThreadSequence(harness.db, {
        threadId: thread.id,
      });

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/send`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            mode: "auto",
            input: [{ type: "text", text: "Do not send this" }],
            model: "claude-does-not-exist-9",
            reasoningLevel: "low",
          }),
        },
      );

      expect(response.status).toBe(400);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "model_not_available",
      });
      expect(getLatestThreadSequence(harness.db, { threadId: thread.id })).toBe(
        sequenceBefore,
      );
      expect(responder.requests.map((request) => request.command.type)).toEqual(
        ["provider.list_models"],
      );
      expect(listQueuedCommands(harness, "turn.submit")).toEqual([]);
    });
  });

  it("keeps an inherited selected-only model valid after the active catalog changes", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps);
      registerProviderHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        restoreCommandCaptureAfterResponse: true,
        modelsByProviderId: {
          "claude-code": {
            models: [
              availableModelFixture({
                model: "claude-current",
                reasoningLevels: ["low"],
                isDefault: true,
              }),
            ],
            selectedOnlyModels: [
              availableModelFixture({
                model: "claude-remembered",
                reasoningLevels: ["low"],
              }),
            ],
          },
        },
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/execution-selection-remembered",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/execution-selection-remembered",
      });
      upsertProjectExecutionDefaults(harness.db, {
        projectId: project.id,
        providerId: "claude-code",
        model: "claude-remembered",
        reasoningLevel: "low",
        permissionMode: "auto",
        serviceTier: "default",
      });

      const response = await harness.app.request("/api/v1/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          origin: "cli",
          projectId: project.id,
          providerId: "claude-code",
          input: [{ type: "text", text: "Use the remembered model" }],
          environment: {
            type: "reuse",
            environmentId: environment.id,
          },
        }),
      });

      expect(response.status).toBe(201);
      const queuedStart = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "thread.start",
      );
      expect(queuedStart.command).toMatchObject({
        options: { model: "claude-remembered", reasoningLevel: "low" },
      });
    });
  });

  it("allows an operator-configured unlisted model from the effective catalog", async () => {
    await withTestHarness(
      {
        customModels: [
          {
            providerId: "claude-code",
            model: "claude-private-preview",
          },
        ],
      },
      async (harness) => {
        const { host, session } = seedHostSession(harness.deps);
        const responder = registerProviderHostRpcResponder(harness, {
          hostId: host.id,
          sessionId: session.id,
          restoreCommandCaptureAfterResponse: true,
          modelsByProviderId: {
            "claude-code": {
              models: [availableModelFixture({ model: "catalog-model" })],
              selectedOnlyModels: [],
            },
          },
        });
        const { project } = seedProjectWithSource(harness.deps, {
          hostId: host.id,
          path: "/tmp/execution-selection-custom-source",
        });
        const environment = seedEnvironment(harness.deps, {
          hostId: host.id,
          projectId: project.id,
          path: "/tmp/execution-selection-custom-source",
        });

        const response = await harness.app.request("/api/v1/threads", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            threadCreateBody({
              projectId: project.id,
              model: "claude-private-preview",
              reasoningLevel: "medium",
              environment: {
                type: "reuse",
                environmentId: environment.id,
              },
            }),
          ),
        });

        expect(response.status).toBe(201);
        expect(
          responder.requests.map((request) => request.command.type),
        ).toEqual(["provider.list_models"]);
      },
    );
  });
});
