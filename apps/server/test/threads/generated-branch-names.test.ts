import { getThread } from "@bb/db";
import { threadSchema } from "@bb/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  requireManagedWorktreeEnvironmentProvisionQueuedCommand,
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
  waitForQueuedCommandAfter,
} from "../helpers/commands.js";
import { readJson } from "../helpers/json.js";
import { seedHostSession, seedProjectWithSource } from "../helpers/seed.js";
import { createTestAppHarness, withTestHarness } from "../helpers/test-app.js";
import { InferenceTimeoutError } from "../../src/services/ai/inference.js";
import { generateThreadMetadataWithOutcome } from "../../src/services/threads/title-generation.js";

const piAiMocks = vi.hoisted(() => ({
  complete: vi.fn(),
  getModel: vi.fn(),
}));

interface MockThreadMetadata {
  branchSlug?: string;
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

vi.mock("@mariozechner/pi-ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mariozechner/pi-ai")>();
  return {
    ...actual,
    complete: piAiMocks.complete,
    getModel: piAiMocks.getModel,
  };
});

function mockThreadMetadata(metadata: MockThreadMetadata): void {
  piAiMocks.getModel.mockReturnValue({ provider: "test" });
  piAiMocks.complete.mockResolvedValue(mockThreadMetadataCompletion(metadata));
}

describe("generated managed branch names", () => {
  beforeEach(() => {
    piAiMocks.complete.mockReset();
    piAiMocks.getModel.mockReset();
  });

  it("uses generated branch slugs for managed worktree provisioning", async () => {
    mockThreadMetadata({
      branchSlug: "unrelated-slug",
      title: "Improve Branch Names",
    });
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/generated-branch-project",
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
              text: "Improve the generated branch naming path",
            },
          ],
          environment: {
            type: "host",
            hostId: host.id,
            workspace: {
              type: "managed-worktree",
              baseBranch: { kind: "default" },
            },
          },
        }),
      });

      expect(response.status).toBe(201);
      const thread = threadSchema.parse(await readJson(response));
      expect(thread.title).toBeNull();

      const queued = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "environment.provision",
      );
      expect(getThread(harness.db, thread.id)?.title).toBe(
        "Improve Branch Names",
      );
      const managedCommand =
        requireManagedWorktreeEnvironmentProvisionQueuedCommand(queued);
      expect(managedCommand.command.branchName).toBe(
        `bb/improve-branch-names-${thread.id}`,
      );
      expect(piAiMocks.complete).toHaveBeenCalledTimes(1);
    });
  });

  it("uses two timeout attempts for managed worktree metadata inference", async () => {
    piAiMocks.getModel.mockReturnValue({ provider: "test" });
    piAiMocks.complete
      .mockRejectedValueOnce(new InferenceTimeoutError({ timeoutMs: 2_500 }))
      .mockResolvedValueOnce(
        mockThreadMetadataCompletion({
          title: "Recovered Managed Metadata",
        }),
      );
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/managed-metadata-retry-project",
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
              text: "Recover managed metadata after transient timeout",
            },
          ],
          environment: {
            type: "host",
            hostId: host.id,
            workspace: {
              type: "managed-worktree",
              baseBranch: { kind: "default" },
            },
          },
        }),
      });

      expect(response.status).toBe(201);
      const thread = threadSchema.parse(await readJson(response));
      const queued = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "environment.provision",
      );
      const managedCommand =
        requireManagedWorktreeEnvironmentProvisionQueuedCommand(queued);
      expect(managedCommand.command.branchName).toBe(
        `bb/recovered-managed-metadata-${thread.id}`,
      );
      expect(piAiMocks.complete).toHaveBeenCalledTimes(2);
    });
  });

  it("queues a daemon rename after a generated title thread starts", async () => {
    mockThreadMetadata({
      branchSlug: "generated-rename-branch",
      title: "Generated Rename Title",
    });
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
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
              type: "managed-worktree",
              baseBranch: { kind: "default" },
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
      if (
        provision.command.type !== "environment.provision" ||
        provision.command.workspaceProvisionType === "unmanaged"
      ) {
        throw new Error("Expected environment.provision command");
      }
      await reportQueuedCommandSuccess(
        harness,
        provision,
        {
          path: "/tmp/generated-title-rename-project/.bb-worktrees/thread",
          branchName: `bb/generated-rename-title-${thread.id}`,
          defaultBranch: "main",
          isGitRepo: true,
          isWorktree: true,
          transcript: [],
        },
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

  it("does not queue a daemon rename for user-supplied titles", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
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
              type: "managed-worktree",
              baseBranch: { kind: "default" },
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
      const managedProvision =
        requireManagedWorktreeEnvironmentProvisionQueuedCommand(provision);
      expect(managedProvision.command.branchName).toBe(
        `bb/user-picked-title-${thread.id}`,
      );
      await reportQueuedCommandSuccess(
        harness,
        provision,
        {
          path: "/tmp/user-title-no-rename-project/.bb-worktrees/thread",
          branchName: `bb/user-picked-title-${thread.id}`,
          defaultBranch: "main",
          isGitRepo: true,
          isWorktree: true,
          transcript: [],
        },
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

  it("falls back to the thread ID when no title is returned", async () => {
    mockThreadMetadata({
      branchSlug: "Slug Only Branch",
    });
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/generated-branch-slug-only-project",
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
              text: "Improve branch names using slug only metadata path",
            },
          ],
          environment: {
            type: "host",
            hostId: host.id,
            workspace: {
              type: "managed-worktree",
              baseBranch: { kind: "default" },
            },
          },
        }),
      });

      expect(response.status).toBe(201);
      const thread = threadSchema.parse(await readJson(response));
      expect(thread.title).toBeNull();

      const queued = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "environment.provision",
      );
      const managedCommand =
        requireManagedWorktreeEnvironmentProvisionQueuedCommand(queued);
      expect(managedCommand.command.branchName).toBe(`bb/${thread.id}`);
      expect(piAiMocks.complete).toHaveBeenCalledTimes(1);
    });
  });

  it("falls back to thread ID branch names when inference is unavailable", async () => {
    await withTestHarness({
      inferenceModel: "openai/gpt-4o-mini",
      openAiApiKey: "",
    }, async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/generated-branch-fallback-project",
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
              text: "Improve the generated branch naming fallback path",
            },
          ],
          environment: {
            type: "host",
            hostId: host.id,
            workspace: {
              type: "managed-worktree",
              baseBranch: { kind: "default" },
            },
          },
        }),
      });

      expect(response.status).toBe(201);
      const thread = threadSchema.parse(await readJson(response));
      const queued = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "environment.provision",
      );
      const managedCommand =
        requireManagedWorktreeEnvironmentProvisionQueuedCommand(queued);
      expect(managedCommand.command.branchName).toBe(`bb/${thread.id}`);
      expect(piAiMocks.getModel).toHaveBeenCalledWith("openai", "gpt-4o-mini");
      expect(piAiMocks.complete).not.toHaveBeenCalled();
    });
  });

  it("ignores independently generated branch slugs when a title is available", async () => {
    mockThreadMetadata({
      branchSlug: "wrong-slug",
      title: "Canonical Generated Title",
    });
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/generated-branch-invalid-project",
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
              text: "Improve invalid generated branch slug handling",
            },
          ],
          environment: {
            type: "host",
            hostId: host.id,
            workspace: {
              type: "managed-worktree",
              baseBranch: { kind: "default" },
            },
          },
        }),
      });

      expect(response.status).toBe(201);
      const thread = threadSchema.parse(await readJson(response));
      expect(thread.title).toBeNull();
      const queued = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "environment.provision",
      );
      expect(getThread(harness.db, thread.id)?.title).toBe(
        "Canonical Generated Title",
      );
      const managedCommand =
        requireManagedWorktreeEnvironmentProvisionQueuedCommand(queued);
      expect(managedCommand.command.branchName).toBe(
        `bb/canonical-generated-title-${thread.id}`,
      );
      expect(piAiMocks.complete).toHaveBeenCalledTimes(1);
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
          input: [
            {
              type: "text",
              text: "Improve timed out metadata generation behavior",
            },
          ],
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
          input: [
            {
              type: "text",
              text: "Improve timed out metadata generation behavior",
            },
          ],
          threadId: "thr_retry_timeout",
          timeoutMaxAttempts: 2,
          timeoutMs: 1,
        }),
      ).resolves.toMatchObject({
        metadata: {
          branchSlug: "recovered-metadata",
          title: "Recovered Metadata",
        },
      });
      expect(piAiMocks.complete).toHaveBeenCalledTimes(2);
      expect(infoSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          attempt: 1,
          maxAttempts: 2,
          threadId: "thr_retry_timeout",
          timeoutMs: 1,
        }),
        "Thread metadata inference timed out; retrying",
      );
      expect(infoSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          attempts: 2,
          threadId: "thr_retry_timeout",
        }),
        "Thread metadata inference completed after timeout retry",
      );
    } finally {
      infoSpy.mockRestore();
      await harness.cleanup();
    }
  });

  it("does not retry non-timeout metadata inference failures", async () => {
    piAiMocks.getModel.mockReturnValue({ provider: "test" });
    piAiMocks.complete.mockRejectedValue(new Error("metadata failed"));
    await withTestHarness(async (harness) => {
      await expect(
        generateThreadMetadataWithOutcome(harness.deps, {
          input: [
            {
              type: "text",
              text: "Improve failed metadata generation behavior",
            },
          ],
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
