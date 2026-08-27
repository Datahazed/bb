import { listEvents } from "@bb/db";
import {
  threadQueuedMessageSchema,
  threadSchema,
  turnRequestEventDataSchema,
} from "@bb/domain";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { readAttachment } from "../../src/services/projects/attachments.js";
import { registerHostRpcResponder } from "../helpers/host-rpc.js";
import { readJson } from "../helpers/json.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedThreadRuntimeState,
  seedTurnStarted,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

function registerRemoteImageResponder(
  harness: TestAppHarness,
  args: {
    hostId: string;
    paths: readonly string[];
    restoreCommandCaptureAfterResponse?: boolean;
    sessionId: string;
  },
): void {
  registerHostRpcResponder(harness, {
    hostId: args.hostId,
    sessionId: args.sessionId,
    restoreCommandCaptureAfterResponse: args.restoreCommandCaptureAfterResponse,
    handle: ({ command }) => {
      if (
        command.type !== "host.read_file" ||
        !args.paths.includes(command.path)
      ) {
        throw new Error(`Unexpected host RPC ${command.type}`);
      }
      return {
        ok: true,
        result: {
          path: command.path,
          content: ONE_PIXEL_PNG.toString("base64"),
          contentEncoding: "base64",
          mimeType: "image/png",
          sha256: createHash("sha256").update(ONE_PIXEL_PNG).digest("hex"),
          sizeBytes: ONE_PIXEL_PNG.byteLength,
        },
      };
    },
  });
}

function persistedImages(harness: TestAppHarness, threadId: string) {
  return listEvents(harness.db, { threadId })
    .filter((event) => event.type === "client/turn/requested")
    .flatMap((event) => {
      const request = turnRequestEventDataSchema.parse(JSON.parse(event.data));
      return request.input.filter((input) => input.type === "localImage");
    });
}

describe("public thread prompt attachments", () => {
  it("persists a CLI absolute image from the execution host as a durable project attachment", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-cli-absolute-image",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/remote/project",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/remote/project",
      });
      const absoluteImagePath = "/remote/references/reference.png";
      registerRemoteImageResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        paths: [absoluteImagePath],
        restoreCommandCaptureAfterResponse: true,
      });

      const response = await harness.app.request("/api/v1/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          origin: "cli",
          projectId: project.id,
          providerId: "codex",
          model: "gpt-5",
          input: [
            { type: "text", text: "Inspect this reference", mentions: [] },
            { type: "localImage", path: absoluteImagePath },
          ],
          environment: {
            type: "reuse",
            environmentId: environment.id,
          },
        }),
      });

      expect(response.status).toBe(201);
      const thread = threadSchema.parse(await readJson(response));
      const storedImage = persistedImages(harness, thread.id)[0];
      expect(storedImage).toBeDefined();
      if (storedImage?.type !== "localImage") {
        throw new Error("Expected persisted local image input");
      }
      expect(storedImage.path).toMatch(/^reference-\d+-[a-z0-9]{6}\.png$/u);
      await expect(
        readAttachment(harness.config.dataDir, project.id, storedImage.path),
      ).resolves.toMatchObject({ content: ONE_PIXEL_PNG });
    });
  });

  it("normalizes absolute images sent to an existing thread before event persistence", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-tell-absolute-image",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/remote/project",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/remote/project",
      });
      const thread = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
        status: "idle",
      });
      seedThreadRuntimeState(harness.deps, {
        environmentId: environment.id,
        providerThreadId: "provider-tell-image",
        threadId: thread.id,
      });
      const absoluteImagePath = "/remote/references/tell.png";
      registerRemoteImageResponder(harness, {
        hostId: host.id,
        paths: [absoluteImagePath],
        restoreCommandCaptureAfterResponse: true,
        sessionId: session.id,
      });

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/send`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            input: [
              { type: "text", text: "Inspect this follow-up", mentions: [] },
              { type: "localImage", path: absoluteImagePath },
            ],
            mode: "auto",
          }),
        },
      );

      expect(response.status).toBe(200);
      const storedImage = persistedImages(harness, thread.id).at(-1);
      expect(storedImage?.path).toMatch(/^tell-\d+-[a-z0-9]{6}\.png$/u);
      await expect(
        readAttachment(
          harness.config.dataDir,
          project.id,
          storedImage?.path ?? "missing",
        ),
      ).resolves.toMatchObject({ content: ONE_PIXEL_PNG });
    });
  });

  it("normalizes absolute images when queued messages are created and updated", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-queue-absolute-image",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/remote/project",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/remote/project",
      });
      const thread = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
        status: "active",
      });
      const createdPath = "/remote/references/queued.png";
      const updatedPath = "/remote/references/updated.png";
      registerRemoteImageResponder(harness, {
        hostId: host.id,
        paths: [createdPath, updatedPath],
        sessionId: session.id,
      });

      const createResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/queued-messages`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            input: [{ type: "localImage", path: createdPath }],
            model: "gpt-5",
          }),
        },
      );
      expect(createResponse.status).toBe(201);
      const created = threadQueuedMessageSchema.parse(
        await readJson(createResponse),
      );
      expect(created.content[0]).toMatchObject({
        type: "localImage",
        path: expect.stringMatching(/^queued-\d+-[a-z0-9]{6}\.png$/u),
      });

      const updateResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/queued-messages/${created.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            expectedUpdatedAt: created.updatedAt,
            input: [{ type: "localImage", path: updatedPath }],
          }),
        },
      );
      expect(updateResponse.status).toBe(200);
      const updated = threadQueuedMessageSchema.parse(
        await readJson(updateResponse),
      );
      expect(updated.content[0]).toMatchObject({
        type: "localImage",
        path: expect.stringMatching(/^updated-\d+-[a-z0-9]{6}\.png$/u),
      });
    });
  });

  it("normalizes an absolute image in a fork prompt on the source execution host", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-fork-absolute-image",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/remote/project",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/remote/project",
      });
      const sourceThread = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
        status: "idle",
      });
      seedThreadRuntimeState(harness.deps, {
        environmentId: environment.id,
        providerThreadId: "provider-fork-image",
        threadId: sourceThread.id,
      });
      seedTurnStarted(harness.deps, {
        environmentId: environment.id,
        providerThreadId: "provider-fork-image",
        sequence: 3,
        threadId: sourceThread.id,
        turnId: "turn-fork-image",
      });
      const absoluteImagePath = "/remote/references/fork.png";
      registerRemoteImageResponder(harness, {
        hostId: host.id,
        paths: [absoluteImagePath],
        restoreCommandCaptureAfterResponse: true,
        sessionId: session.id,
      });

      const response = await harness.app.request("/api/v1/threads/fork", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceThreadId: sourceThread.id,
          workspace: "reuse",
          origin: "cli",
          input: [
            { type: "text", text: "Inspect the fork image", mentions: [] },
            { type: "localImage", path: absoluteImagePath },
          ],
        }),
      });

      expect(response.status).toBe(201);
      const fork = threadSchema.parse(await readJson(response));
      const storedImage = persistedImages(harness, fork.id)[0];
      expect(storedImage?.path).toMatch(/^fork-\d+-[a-z0-9]{6}\.png$/u);
      await expect(
        readAttachment(
          harness.config.dataDir,
          project.id,
          storedImage?.path ?? "missing",
        ),
      ).resolves.toMatchObject({ content: ONE_PIXEL_PNG });
    });
  });
});
