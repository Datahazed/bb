import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { events, threads } from "@bb/db";
import { turnRequestEventDataSchema } from "@bb/domain";
import type { HostDaemonOnlineRpcCommand } from "@bb/host-daemon-contract";
import {
  createReplayCaptureId,
  type ReplayCaptureManifest,
  type ReplayCaptureSummary,
} from "@bb/replay-capture";
import { describe, expect, it } from "vitest";
import {
  reportQueuedCommandError,
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
  type QueuedCommand,
} from "../helpers/commands.js";
import { readJson } from "../helpers/json.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import {
  type TestAppHarness,
  withTestHarness,
} from "../helpers/test-app.js";

const replayListResponseSchema = z.object({
  captures: z.array(z.object({ captureId: z.string(), hostId: z.string() })),
});

const replayRunResponseSchema = z.object({
  runId: z.string(),
  projectId: z.string(),
  replayThreadId: z.string(),
});

const REPLAY_CAPTURE_ROUTE = "/api/v1/development-only/replay/captures";

type ReplayCaptureGetCommand = Extract<
  HostDaemonOnlineRpcCommand,
  { type: "development.replay"; operation: "capture-get" }
>;
type ReplayCaptureListCommand = Extract<
  HostDaemonOnlineRpcCommand,
  { type: "development.replay"; operation: "capture-list" }
>;
type ReplayCaptureDeleteCommand = Extract<
  HostDaemonOnlineRpcCommand,
  { type: "development.replay"; operation: "capture-delete" }
>;
type ReplayRunCommand = Extract<
  HostDaemonOnlineRpcCommand,
  { type: "development.replay"; operation: "run" }
>;

function captureManifest(args: {
  captureId: string;
  environmentId: string;
  projectId: string;
  threadId: string;
}): ReplayCaptureManifest {
  return {
    schemaVersion: 3,
    captureId: args.captureId,
    capturedAt: 1_000,
    completedAt: 1_100,
    source: "live-dev-capture",
    providerId: "codex",
    projectId: args.projectId,
    environmentId: args.environmentId,
    threadId: args.threadId,
    providerThreadId: "provider-thread-1",
    title: "Original thread",
    kind: "thread-start",
    turns: [
      {
        turnId: "turn-1",
        userInput: [{ type: "text", text: "Original prompt" }],
        createdAt: 1_000,
      },
    ],
    userInputPreview: "Original prompt",
    execution: {
      model: "gpt-5",
      reasoningLevel: "medium",
      permissionMode: "full",
      serviceTier: "default",
      source: "client/turn/requested",
    },
    eventCounts: {
      rawProviderEvents: 1,
      droppedRecords: 0,
    },
    errorMessage: null,
  };
}

function captureSummary(manifest: ReplayCaptureManifest): ReplayCaptureSummary {
  return {
    captureId: manifest.captureId,
    capturedAt: manifest.capturedAt,
    completedAt: manifest.completedAt,
    providerId: manifest.providerId,
    projectId: manifest.projectId,
    environmentId: manifest.environmentId,
    threadId: manifest.threadId,
    title: manifest.title,
    kind: manifest.kind,
    userInputPreview: manifest.userInputPreview,
    execution: manifest.execution,
    eventCounts: manifest.eventCounts,
    errorMessage: manifest.errorMessage,
  };
}

async function waitForReplayCaptureListCommand(
  harness: TestAppHarness,
  hostId: string,
): Promise<QueuedCommand<ReplayCaptureListCommand>> {
  const queued = await waitForQueuedCommand(
    harness,
    ({ command, row }) =>
      row.hostId === hostId &&
      command.type === "development.replay" &&
      command.operation === "capture-list",
  );
  if (
    queued.command.type !== "development.replay" ||
    queued.command.operation !== "capture-list"
  ) {
    throw new Error("Expected development replay capture-list RPC");
  }
  return {
    command: queued.command,
    row: queued.row,
    rpcRequest: queued.rpcRequest,
  };
}

async function waitForReplayCaptureGetCommand(
  harness: TestAppHarness,
  hostId: string,
): Promise<QueuedCommand<ReplayCaptureGetCommand>> {
  const queued = await waitForQueuedCommand(
    harness,
    ({ command, row }) =>
      row.hostId === hostId &&
      command.type === "development.replay" &&
      command.operation === "capture-get",
  );
  if (
    queued.command.type !== "development.replay" ||
    queued.command.operation !== "capture-get"
  ) {
    throw new Error("Expected development replay capture-get RPC");
  }
  return {
    command: queued.command,
    row: queued.row,
    rpcRequest: queued.rpcRequest,
  };
}

async function waitForReplayCaptureDeleteCommand(
  harness: TestAppHarness,
  hostId: string,
): Promise<QueuedCommand<ReplayCaptureDeleteCommand>> {
  const queued = await waitForQueuedCommand(
    harness,
    ({ command, row }) =>
      row.hostId === hostId &&
      command.type === "development.replay" &&
      command.operation === "capture-delete",
  );
  if (
    queued.command.type !== "development.replay" ||
    queued.command.operation !== "capture-delete"
  ) {
    throw new Error("Expected development replay capture-delete RPC");
  }
  return {
    command: queued.command,
    row: queued.row,
    rpcRequest: queued.rpcRequest,
  };
}

async function waitForReplayRunCommand(
  harness: TestAppHarness,
  hostId: string,
): Promise<QueuedCommand<ReplayRunCommand>> {
  const queued = await waitForQueuedCommand(
    harness,
    ({ command, row }) =>
      row.hostId === hostId &&
      command.type === "development.replay" &&
      command.operation === "run",
  );
  if (
    queued.command.type !== "development.replay" ||
    queued.command.operation !== "run"
  ) {
    throw new Error("Expected development replay run RPC");
  }
  return {
    command: queued.command,
    row: queued.row,
    rpcRequest: queued.rpcRequest,
  };
}

describe("public development-only replay routes", () => {
  it("serves replay routes without requiring capture recording to be enabled", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const responsePromise = harness.app.request(REPLAY_CAPTURE_ROUTE);
      const queued = await waitForReplayCaptureListCommand(harness, host.id);
      await reportQueuedCommandSuccess(harness, queued, { captures: [] });

      const response = await responsePromise;
      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toMatchObject({
        captures: [],
      });
      expect(harness.engineRouting.dispatched).toHaveLength(0);
    });
  });

  it("returns 404 when the server is not running in development mode", async () => {
    await withTestHarness({ isDevelopment: false }, async (harness) => {
      const response = await harness.app.request(REPLAY_CAPTURE_ROUTE);

      expect(response.status).toBe(404);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "not_found",
      });
      expect(harness.engineRouting.dispatched).toHaveLength(0);
    });
  });

  it("rejects malformed capture ids before queueing daemon commands", async () => {
    await withTestHarness(async (harness) => {
      const response = await harness.app.request(
        `${REPLAY_CAPTURE_ROUTE}/not-a-cap`,
        { method: "DELETE" },
      );

      expect(response.status).toBe(400);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "invalid_request",
      });
      expect(harness.engineRouting.dispatched).toHaveLength(0);
    });
  });

  it("rejects removed replay mode fields before queueing daemon commands", async () => {
    await withTestHarness(async (harness) => {
      const captureId = createReplayCaptureId(1_000, "abc123zz");
      const response = await harness.app.request(
        `${REPLAY_CAPTURE_ROUTE}/${captureId}/runs`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            mode: "raw-provider",
            speed: 1,
          }),
        },
      );

      expect(response.status).toBe(400);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "invalid_request",
      });
      expect(harness.engineRouting.dispatched).toHaveLength(0);
    });
  });

  it("lists captures from connected host daemons with host ids", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/replay-list",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/replay-list",
      });
      const thread = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
      });
      const captureId = createReplayCaptureId(1_000, "abc123zz");
      const manifest = captureManifest({
        captureId,
        environmentId: environment.id,
        projectId: project.id,
        threadId: thread.id,
      });
      const responsePromise = harness.app.request(REPLAY_CAPTURE_ROUTE);
      const queued = await waitForReplayCaptureListCommand(harness, host.id);
      const reportResponse = await reportQueuedCommandSuccess(
        harness,
        queued,
        {
          captures: [captureSummary(manifest)],
        },
      );
      expect(reportResponse.status).toBe(200);

      const response = await responsePromise;

      expect(response.status).toBe(200);
      const rawBody = await readJson(response);
      expect(rawBody).toMatchObject({
        captures: [
          {
            captureId,
            hostId: host.id,
            title: "Test Thread",
            projectName: "Test Project",
          },
        ],
      });
      const body = replayListResponseSchema.parse(rawBody);
      expect(body.captures).toEqual([
        {
          captureId,
          hostId: host.id,
        },
      ]);
    });
  });

  it("deletes a capture on the host that owns it", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const captureId = createReplayCaptureId(1_000, "abc123zz");
      const responsePromise = harness.app.request(
        `${REPLAY_CAPTURE_ROUTE}/${captureId}`,
        { method: "DELETE" },
      );
      const queued = await waitForReplayCaptureDeleteCommand(harness, host.id);
      expect(queued.command).toEqual({
        type: "development.replay",
        operation: "capture-delete",
        captureId,
      });
      const reportResponse = await reportQueuedCommandSuccess(
        harness,
        queued,
        {},
      );
      expect(reportResponse.status).toBe(200);

      const response = await responsePromise;

      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toEqual({ ok: true });
    });
  });

  it("returns 404 when the engine does not know the capture", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const captureId = createReplayCaptureId(1_000, "abc123zz");
      const responsePromise = harness.app.request(
        `${REPLAY_CAPTURE_ROUTE}/${captureId}`,
        { method: "DELETE" },
      );
      const queued = await waitForReplayCaptureDeleteCommand(harness, host.id);
      await reportQueuedCommandError(harness, queued, {
        errorCode: "replay_capture_not_found",
        errorMessage: "Replay capture not found",
      });

      const response = await responsePromise;
      expect(response.status).toBe(404);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "replay_capture_not_found",
      });
    });
  });

  it("rejects replay runs when capture project differs from the environment project", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project: environmentProject } = seedProjectWithSource(
        harness.deps,
        {
          hostId: host.id,
          path: "/tmp/replay-project-mismatch-env",
        },
      );
      const { project: captureProject } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/replay-project-mismatch-capture",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: environmentProject.id,
        path: "/tmp/replay-project-mismatch-env",
      });
      const captureId = createReplayCaptureId(1_000, "abc123zz");
      const manifest = captureManifest({
        captureId,
        environmentId: environment.id,
        projectId: captureProject.id,
        threadId: "thr-project-mismatch",
      });
      const responsePromise = harness.app.request(
        `${REPLAY_CAPTURE_ROUTE}/${captureId}/runs`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            speed: 1,
          }),
        },
      );
      const queued = await waitForReplayCaptureGetCommand(harness, host.id);
      const reportResponse = await reportQueuedCommandSuccess(
        harness,
        queued,
        manifest,
      );
      expect(reportResponse.status).toBe(200);

      const response = await responsePromise;

      expect(response.status).toBe(409);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "replay_capture_project_mismatch",
      });
      // Replay flows are RPC-only; nothing reaches the durable dispatch path.
      expect(harness.engineRouting.dispatched).toHaveLength(0);
    });
  });

  it("creates a replay thread and starts replay from capture metadata", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/replay-run",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/replay-run",
      });
      const thread = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
      });
      const captureId = createReplayCaptureId(1_000, "abc123zz");
      const manifest = captureManifest({
        captureId,
        environmentId: environment.id,
        projectId: project.id,
        threadId: thread.id,
      });
      const responsePromise = harness.app.request(
        `${REPLAY_CAPTURE_ROUTE}/${captureId}/runs`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            speed: 10,
          }),
        },
      );
      const getCommand = await waitForReplayCaptureGetCommand(harness, host.id);
      const reportResponse = await reportQueuedCommandSuccess(
        harness,
        getCommand,
        manifest,
      );
      expect(reportResponse.status).toBe(200);

      const replayCommand = await waitForReplayRunCommand(harness, host.id);
      expect(replayCommand.command).toMatchObject({
        type: "development.replay",
        operation: "run",
        captureId,
        environmentId: environment.id,
        speed: 10,
      });
      const replayThread = harness.db
        .select()
        .from(threads)
        .where(eq(threads.id, replayCommand.command.threadId))
        .get();
      expect(replayThread).toMatchObject({
        projectId: project.id,
        environmentId: environment.id,
        providerId: manifest.providerId,
        status: "created",
      });
      expect(replayThread?.title).toMatch(/^\[Replay\]/u);
      const replayRequestRow = harness.db
        .select()
        .from(events)
        .where(
          and(
            eq(events.threadId, replayCommand.command.threadId),
            eq(events.type, "client/turn/requested"),
          ),
        )
        .get();
      if (!replayRequestRow) {
        throw new Error("Expected replay request event");
      }
      const replayRequestData = turnRequestEventDataSchema.parse(
        JSON.parse(replayRequestRow.data),
      );
      expect(replayRequestData.input).toEqual([
        { type: "text", text: "Original prompt" },
      ]);
      expect(replayCommand.command.requestId).toBe(
        replayRequestData.requestId,
      );
      const runReportResponse = await reportQueuedCommandSuccess(
        harness,
        replayCommand,
        {},
      );
      expect(runReportResponse.status).toBe(200);

      const response = await responsePromise;

      expect(response.status).toBe(201);
      const body = replayRunResponseSchema.parse(await readJson(response));
      expect(body).toEqual({
        runId: replayRequestData.requestId,
        replayThreadId: replayCommand.command.threadId,
        projectId: project.id,
      });
      // Replay flows are RPC-only; nothing reaches the durable dispatch path.
      expect(harness.engineRouting.dispatched).toHaveLength(0);
    });
  });

  it("rejects replay runs when the capture environment does not exist", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/replay-missing-env",
      });
      const thread = seedThread(harness.deps, {
        environmentId: null,
        projectId: project.id,
      });
      const captureId = createReplayCaptureId(1_000, "abc123zz");
      const manifest = captureManifest({
        captureId,
        environmentId: "env_missing_replay",
        projectId: project.id,
        threadId: thread.id,
      });

      const responsePromise = harness.app.request(
        `${REPLAY_CAPTURE_ROUTE}/${captureId}/runs`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            speed: 1,
          }),
        },
      );
      const getCommand = await waitForReplayCaptureGetCommand(harness, host.id);
      const reportResponse = await reportQueuedCommandSuccess(
        harness,
        getCommand,
        manifest,
      );
      expect(reportResponse.status).toBe(200);

      const response = await responsePromise;

      expect(response.status).toBe(404);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "environment_not_found",
      });
      // Replay flows are RPC-only; nothing reaches the durable dispatch path.
      expect(harness.engineRouting.dispatched).toHaveLength(0);
    });
  });

});
