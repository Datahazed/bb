import { createThread, getThread } from "@bb/db";
import {
  type ResolvedThreadExecutionOptions,
  threadSchema,
  turnScope,
} from "@bb/domain";
import { groupHostDaemonEvents } from "@bb/host-daemon-contract";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  internalAuthHeaders,
  listQueuedThreadCommands,
  reportQueuedCommandError,
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
  waitForQueuedCommandAfter,
} from "../helpers/commands.js";
import { readJson } from "../helpers/json.js";
import { textInput } from "../helpers/prompt-input.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedTurnStarted,
} from "../helpers/seed.js";
import { createTestAppHarness, withTestHarness } from "../helpers/test-app.js";
import { AiServiceCallError } from "../../src/services/ai/ai-service-call.js";
import { createThreadFromRequest } from "../../src/services/threads/thread-create.js";
import {
  advanceThreadProvisioning,
  requestThreadProvision,
} from "../../src/services/threads/thread-provisioning.js";
import { generateThreadMetadataWithOutcome } from "../../src/services/threads/title-generation.js";

const piAiMocks = vi.hoisted(() => ({
  complete: vi.fn(),
  getModel: vi.fn(),
}));

interface MockThreadMetadata {
  title?: string;
}

function mockThreadMetadataCompletion(metadata: MockThreadMetadata) {
  return {
    content: [
      {
        arguments: metadata,
        id: "tool_result",
        name: "result",
        type: "toolCall",
      },
    ],
  };
}

vi.mock("@earendil-works/pi-ai/providers/all", () => ({
  builtinModels: () => ({
    complete: piAiMocks.complete,
    getModel: piAiMocks.getModel,
    getProviders: () => [],
  }),
}));

function mockThreadMetadata(metadata: MockThreadMetadata): void {
  piAiMocks.getModel.mockReturnValue({ provider: "test" });
  piAiMocks.complete.mockResolvedValue(mockThreadMetadataCompletion(metadata));
}

const THREAD_START_EXECUTION = {
  model: "gpt-5",
  serviceTier: "default",
  reasoningLevel: "medium",
  permissionMode: "accept-edits",
  source: "client/turn/requested",
} satisfies ResolvedThreadExecutionOptions;

describe("generated thread titles", () => {
  beforeEach(() => {
    piAiMocks.complete.mockReset();
    piAiMocks.getModel.mockReset();
  });

  it("queues a daemon rename after a generated title thread starts", async () => {
    mockThreadMetadata({
      title: "Generated Rename Title",
    });
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-generated-title-rename",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/generated-title-rename-project",
      });

      const response = await harness.app.request("/api/v1/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          origin: "app",
          projectId: project.id,
          providerId: "codex",
          model: "gpt-5",
          input: [
            {
              type: "text",
              text: "Generate a title then sync it after startup",
            },
          ],
          environment: {
            type: "host",
            hostId: host.id,
            workspace: {
              type: "unmanaged",
              path: "/tmp/generated-title-rename-workspace",
            },
          },
        }),
      });

      expect(response.status).toBe(201);
      const thread = threadSchema.parse(await readJson(response));
      const provision = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "environment.provision",
      );
      await reportQueuedCommandSuccess(
        harness,
        provision,
        {
          path: "/tmp/generated-title-rename-workspace",
          branchName: "main",
          defaultBranch: "main",
          isGitRepo: true,
          isWorktree: false,
          transcript: [],
        },
        { hostId: host.id },
      );
      const start = await waitForQueuedCommandAfter(
        harness,
        provision.row.cursor,
        ({ command }) =>
          command.type === "thread.start" && command.threadId === thread.id,
      );
      await reportQueuedCommandSuccess(
        harness,
        start,
        { providerThreadId: "provider-generated-title-rename" },
        { hostId: host.id },
      );

      const rename = await waitForQueuedCommandAfter(
        harness,
        start.row.cursor,
        ({ command }) =>
          command.type === "thread.rename" && command.threadId === thread.id,
      );
      expect(rename.command).toMatchObject({
        type: "thread.rename",
        threadId: thread.id,
        title: "Generated Rename Title",
      });
    });
  });

  it("generates titles for submitted fork threads", async () => {
    mockThreadMetadata({ title: "Generated Fork Title" });

    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-generated-fork-title",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/generated-fork-title-project",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/generated-fork-title-project",
        status: "ready",
        workspaceProvisionType: "unmanaged",
      });
      const sourceThread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
      });
      seedTurnStarted(harness.deps, {
        threadId: sourceThread.id,
        turnId: "turn-generated-fork-title-source",
        providerThreadId: "provider-generated-fork-title-source",
      });

      const input = textInput("Continue this fork and generate a useful title");
      const fork = await createThreadFromRequest(harness.deps, {
        environment: { type: "reuse", environmentId: environment.id },
        input,
        model: "gpt-5",
        origin: "app",
        originKind: "fork",
        projectId: project.id,
        providerId: "codex",
        sourceThreadId: sourceThread.id,
        startedOnBehalfOf: null,
      });

      expect(getThread(harness.db, fork.id)?.titleFallback).toBe(
        "Continue this fork and generate a useful title",
      );

      const start = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.start" && command.threadId === fork.id,
      );
      if (start.command.type !== "thread.start") {
        throw new Error("Expected a thread.start command");
      }
      expect(start.command.input).toEqual(input);
      expect(start.command.fork).toEqual({
        sourceProviderThreadId: "provider-generated-fork-title-source",
      });

      await reportQueuedCommandSuccess(
        harness,
        start,
        { providerThreadId: "provider-generated-fork-title" },
        { hostId: host.id },
      );

      await vi.waitFor(() => {
        expect(getThread(harness.db, fork.id)?.title).toBe(
          "Generated Fork Title",
        );
      });
    });
  });

  it("does not queue a daemon rename for user-supplied titles", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-user-title-no-rename",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/user-title-no-rename-project",
      });

      const response = await harness.app.request("/api/v1/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          origin: "app",
          projectId: project.id,
          providerId: "codex",
          model: "gpt-5",
          title: "User Picked Title",
          input: [
            {
              type: "text",
              text: "Use the user supplied title without daemon rename",
            },
          ],
          environment: {
            type: "host",
            hostId: host.id,
            workspace: {
              type: "unmanaged",
              path: "/tmp/user-title-no-rename-workspace",
            },
          },
        }),
      });

      expect(response.status).toBe(201);
      const thread = threadSchema.parse(await readJson(response));
      const provision = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "environment.provision",
      );
      await reportQueuedCommandSuccess(
        harness,
        provision,
        {
          path: "/tmp/user-title-no-rename-workspace",
          branchName: "main",
          defaultBranch: "main",
          isGitRepo: true,
          isWorktree: false,
          transcript: [],
        },
        { hostId: host.id },
      );
      const start = await waitForQueuedCommandAfter(
        harness,
        provision.row.cursor,
        ({ command }) =>
          command.type === "thread.start" && command.threadId === thread.id,
      );
      await reportQueuedCommandSuccess(
        harness,
        start,
        { providerThreadId: "provider-user-title-no-rename" },
        { hostId: host.id },
      );

      await expect(
        waitForQueuedCommandAfter(
          harness,
          start.row.cursor,
          ({ command }) =>
            command.type === "thread.rename" && command.threadId === thread.id,
          100,
        ),
      ).rejects.toThrow("Timed out waiting for queued command");
    });
  });

  it("uses the fallback model and renames an idle non-managed thread", async () => {
    let resolveMetadata: (metadata: MockThreadMetadata) => void = () => {
      throw new Error("Metadata inference was not started");
    };
    piAiMocks.getModel.mockReturnValue({ provider: "test" });
    piAiMocks.complete
      .mockRejectedValueOnce(
        new AiServiceCallError(
          "codex",
          "service_unavailable",
          "Our servers are currently overloaded. Please try again later.",
        ),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveMetadata = (metadata) => {
              resolve(mockThreadMetadataCompletion(metadata));
            };
          }),
      );

    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-idle-late-title-rename",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/idle-late-title-rename-project",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/idle-late-title-rename-workspace",
        status: "ready",
        workspaceProvisionType: "unmanaged",
      });
      const thread = createThread(harness.db, harness.hub, {
        projectId: project.id,
        environmentId: environment.id,
        providerId: "codex",
        status: "starting",
        title: null,
        titleFallback: "Idle late title rename",
      });

      const context = requestThreadProvision(harness.deps, {
        launchEntries: [],
      environmentIntent: {
          type: "reuse",
          environmentId: environment.id,
        },
        execution: THREAD_START_EXECUTION,
        fork: null,
        input: textInput("Generate a title for this non-managed reuse thread"),
        startedOnBehalfOf: null,
        thread,
        titleProvided: false,
      });
      await advanceThreadProvisioning(harness.deps, {
        context,
        threadId: thread.id,
      });

      const start = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.start" && command.threadId === thread.id,
      );
      await reportQueuedCommandSuccess(
        harness,
        start,
        { providerThreadId: "provider-idle-late-title" },
        { hostId: host.id },
      );
      expect(getThread(harness.db, thread.id)?.status).toBe("active");
      expect(getThread(harness.db, thread.id)?.title).toBeNull();

      const eventsResponse = await harness.app.request(
        "/internal/session/events",
        {
          method: "POST",
          headers: internalAuthHeaders(harness),
          body: JSON.stringify({
            sessionId: session.id,
            eventGroups: groupHostDaemonEvents([
              {
                threadId: thread.id,
                event: {
                  type: "turn/started",
                  threadId: thread.id,
                  providerThreadId: "provider-idle-late-title",
                  scope: turnScope("turn-idle-late-title"),
                },
              },
              {
                threadId: thread.id,
                event: {
                  type: "turn/completed",
                  threadId: thread.id,
                  providerThreadId: "provider-idle-late-title",
                  scope: turnScope("turn-idle-late-title"),
                  status: "completed",
                },
              },
            ]),
          }),
        },
      );
      expect(eventsResponse.status).toBe(200);
      expect(getThread(harness.db, thread.id)?.status).toBe("idle");

      await vi.waitFor(() => {
        expect(piAiMocks.complete).toHaveBeenCalledTimes(2);
      });

      resolveMetadata({ title: "Late Idle Title" });

      const rename = await waitForQueuedCommandAfter(
        harness,
        start.row.cursor,
        ({ command }) =>
          command.type === "thread.rename" && command.threadId === thread.id,
      );
      expect(rename.command).toMatchObject({
        type: "thread.rename",
        threadId: thread.id,
        title: "Late Idle Title",
      });
      expect(getThread(harness.db, thread.id)?.title).toBe("Late Idle Title");
      expect(piAiMocks.getModel).toHaveBeenNthCalledWith(
        1,
        "test",
        "mock-model",
      );
      expect(piAiMocks.getModel).toHaveBeenNthCalledWith(
        2,
        "test",
        "mock-fallback-model",
      );
    });
  });

  it("does not rename a non-managed thread that errored before its title landed", async () => {
    let resolveMetadata: (metadata: MockThreadMetadata) => void = () => {
      throw new Error("Metadata inference was not started");
    };
    piAiMocks.getModel.mockReturnValue({ provider: "test" });
    piAiMocks.complete.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveMetadata = (metadata) => {
            resolve(mockThreadMetadataCompletion(metadata));
          };
        }),
    );

    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-errored-late-title-no-rename",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/errored-late-title-no-rename-project",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/errored-late-title-no-rename-workspace",
        status: "ready",
        workspaceProvisionType: "unmanaged",
      });
      const thread = createThread(harness.db, harness.hub, {
        projectId: project.id,
        environmentId: environment.id,
        providerId: "codex",
        status: "starting",
        title: null,
        titleFallback: "Errored late title no rename",
      });

      const context = requestThreadProvision(harness.deps, {
        launchEntries: [],
      environmentIntent: {
          type: "reuse",
          environmentId: environment.id,
        },
        execution: THREAD_START_EXECUTION,
        fork: null,
        input: textInput("Generate a title for this non-managed reuse thread"),
        startedOnBehalfOf: null,
        thread,
        titleProvided: false,
      });
      await advanceThreadProvisioning(harness.deps, {
        context,
        threadId: thread.id,
      });

      const start = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.start" && command.threadId === thread.id,
      );
      await reportQueuedCommandError(
        harness,
        start,
        {
          errorCode: "thread_start_failed",
          errorMessage: "Thread start failed",
        },
        { hostId: host.id },
      );
      expect(getThread(harness.db, thread.id)?.status).toBe("error");

      resolveMetadata({ title: "Errored Late Title" });

      await expect(
        waitForQueuedCommandAfter(
          harness,
          start.row.cursor,
          ({ command }) =>
            command.type === "thread.rename" && command.threadId === thread.id,
          100,
        ),
      ).rejects.toThrow("Timed out waiting for queued command");
      expect(
        listQueuedThreadCommands(harness, "thread.rename", thread.id),
      ).toEqual([]);
    });
  });

  it("returns no metadata when inference times out", async () => {
    piAiMocks.getModel.mockReturnValue({ provider: "test" });
    piAiMocks.complete.mockReturnValue(new Promise(() => undefined));
    const harness = await createTestAppHarness();
    const infoSpy = vi.spyOn(harness.deps.logger, "info");
    try {
      await expect(
        generateThreadMetadataWithOutcome(harness.deps, {
          input: textInput("Improve timed out metadata generation behavior"),
          threadId: "thr_timeout",
          timeoutMs: 1,
        }),
      ).resolves.toMatchObject({
        metadata: null,
        reason: "timeout",
      });
      expect(piAiMocks.complete).toHaveBeenCalledTimes(1);
      expect(infoSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          attempts: 1,
          threadId: "thr_timeout",
          timeoutMs: 1,
        }),
        "Thread metadata inference timed out",
      );
    } finally {
      infoSpy.mockRestore();
      await harness.cleanup();
    }
  });

  it("retries once when metadata inference times out", async () => {
    piAiMocks.getModel.mockReturnValue({ provider: "test" });
    piAiMocks.complete
      .mockReturnValueOnce(new Promise(() => undefined))
      .mockResolvedValueOnce(
        mockThreadMetadataCompletion({
          title: "Recovered Metadata",
        }),
      );
    const harness = await createTestAppHarness();
    const infoSpy = vi.spyOn(harness.deps.logger, "info");
    try {
      await expect(
        generateThreadMetadataWithOutcome(harness.deps, {
          input: textInput("Improve timed out metadata generation behavior"),
          threadId: "thr_retry_timeout",
          timeoutMaxAttempts: 2,
          timeoutMs: 1,
        }),
      ).resolves.toMatchObject({
        metadata: {
          title: "Recovered Metadata",
        },
      });
      expect(piAiMocks.complete).toHaveBeenCalledTimes(2);
      expect(piAiMocks.getModel).toHaveBeenNthCalledWith(
        1,
        "test",
        "mock-model",
      );
      expect(piAiMocks.getModel).toHaveBeenNthCalledWith(
        2,
        "test",
        "mock-fallback-model",
      );
      expect(infoSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          attempt: 1,
          fallbackModel: "test/mock-fallback-model",
          maxAttempts: 2,
          threadId: "thr_retry_timeout",
          timeoutMs: 1,
        }),
        "Thread metadata inference failed transiently; using fallback model",
      );
      expect(infoSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          attempts: 2,
          threadId: "thr_retry_timeout",
        }),
        "Thread metadata inference completed with fallback model",
      );
    } finally {
      infoSpy.mockRestore();
      await harness.cleanup();
    }
  });

  it("retries transient Codex service failures", async () => {
    piAiMocks.getModel.mockReturnValue({ provider: "test" });
    piAiMocks.complete
      .mockRejectedValueOnce(
        new AiServiceCallError(
          "codex",
          "service_unavailable",
          "Our servers are currently overloaded. Please try again later.",
        ),
      )
      .mockResolvedValueOnce(
        mockThreadMetadataCompletion({
          title: "Recovered Metadata",
        }),
      );

    await withTestHarness(async (harness) => {
      await expect(
        generateThreadMetadataWithOutcome(harness.deps, {
          input: textInput("Recover transient metadata provider failures"),
          threadId: "thr_retry_service_unavailable",
          timeoutMaxAttempts: 2,
          timeoutMs: 1_000,
        }),
      ).resolves.toMatchObject({
        metadata: {
          title: "Recovered Metadata",
        },
      });
      expect(piAiMocks.complete).toHaveBeenCalledTimes(2);
      expect(piAiMocks.getModel).toHaveBeenNthCalledWith(
        1,
        "test",
        "mock-model",
      );
      expect(piAiMocks.getModel).toHaveBeenNthCalledWith(
        2,
        "test",
        "mock-fallback-model",
      );
    });
  });

  it("does not retry non-transient metadata inference failures", async () => {
    piAiMocks.getModel.mockReturnValue({ provider: "test" });
    piAiMocks.complete.mockRejectedValue(new Error("metadata failed"));
    await withTestHarness(async (harness) => {
      await expect(
        generateThreadMetadataWithOutcome(harness.deps, {
          input: textInput("Improve failed metadata generation behavior"),
          threadId: "thr_failed_metadata",
          timeoutMaxAttempts: 2,
          timeoutMs: 1,
        }),
      ).resolves.toMatchObject({
        metadata: null,
        reason: "failed",
      });
      expect(piAiMocks.complete).toHaveBeenCalledTimes(1);
    });
  });
});
