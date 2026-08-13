import { PassThrough } from "node:stream";
import type { ThreadEvent } from "@bb/domain";
import {
  providerDriverInitializeParamsSchema,
  type ProviderSessionOpenParams,
} from "@bb/provider-driver-contract";
import {
  ProviderDriverServer,
  defineProviderDriver,
} from "@bb/provider-driver-sdk";
import { describe, expect, it, vi } from "vitest";
import type { ProviderDriverSessionOpenArgs } from "./connection.js";
import { CanonicalProcessProviderConnection } from "./canonical-process-connection.js";
import { ProcessProviderDriverConnection } from "./process-connection.js";

function execution() {
  return {
    model: "fake/model",
    reasoningLevel: "medium" as const,
    serviceTier: "default" as const,
    permissionMode: "full" as const,
    permissionScope: "full" as const,
    approvalReviewer: null,
    permissionEscalation: null,
    claudeCodeMockCliTraffic: {
      enabled: false,
      endpoint: "http://127.0.0.1:1",
    },
    workflowsEnabled: false,
    memoryEnabled: false,
    providerSubagentsEnabled: false,
    instructions: "Test instructions",
    envVars: { BB_THREAD_ID: "thread-1" },
  };
}

function openArgs(): ProviderDriverSessionOpenArgs {
  return {
    bbThreadId: "thread-1",
    cwd: "/workspace",
    mode: { kind: "start" },
    execution: execution(),
    dynamicTools: [
      {
        name: "test_tool",
        description: "Test tool",
        inputSchema: {
          type: "object",
          properties: { value: { type: "string" } },
        },
      },
    ],
    disallowedTools: ["dangerous"],
    instructionMode: "append",
  };
}

async function createConnection() {
  const hostToDriver = new PassThrough();
  const driverToHost = new PassThrough();
  let openParams: ProviderSessionOpenParams | null = null;
  let startCount = 0;
  const driver = defineProviderDriver({
    identity: { pluginId: "fake", driverId: "fake", providerId: "fake" },
    processCapabilities: { multiplexSessions: true },
    inspect: () => ({
      readiness: { status: "ready" },
      capabilities: {
        multiplexSessions: true,
        supportedSessionOperations: [],
        supportedPermissionModes: ["full"],
        supportsServiceTier: false,
        supportsSteering: true,
        supportsUserQuestions: false,
      },
      models: [],
      selectedOnlyModels: [],
      diagnostics: [],
    }),
    openSession: (params, context) => {
      openParams = params;
      context.events.emit({
        type: "session.context_window_usage_changed",
        attachmentId: params.attachmentId,
        contextWindowUsage: {
          usedTokens: 0,
          modelContextWindow: 100,
          estimated: false,
        },
      });
      return {
        providerSessionId: "provider-session-1",
        sessionFormatVersion: "fake-v1",
      };
    },
    detachSession: () => ({ providerCheckpointId: "detach-checkpoint" }),
    discardSession: () => {},
    submitTurn: (params, context) => {
      const turnId =
        params.mode === "start" ? params.turnId : params.expectedTurnId;
      if (params.mode === "steer") {
        return { outcome: "stale", activeTurnId: turnId };
      }
      startCount += 1;
      if (startCount === 1) {
        context.events.emit({
          type: "item.started",
          attachmentId: params.attachmentId,
          turnId,
          item: { type: "agentMessage", id: "message-1", text: "" },
        });
        context.events.emit({
          type: "item.delta",
          attachmentId: params.attachmentId,
          turnId,
          itemId: "message-1",
          channel: "assistant_text",
          delta: "Hello",
          reset: false,
        });
        context.events.emit({
          type: "item.completed",
          attachmentId: params.attachmentId,
          turnId,
          item: { type: "agentMessage", id: "message-1", text: "Hello" },
          outcome: "completed",
          error: null,
        });
        context.events.emit({
          type: "turn.settled",
          attachmentId: params.attachmentId,
          turnId,
          outcome: "completed",
          error: null,
          providerCheckpointId: "turn-checkpoint",
        });
      }
      return {
        outcome: "accepted",
        disposition: "started",
        turnId,
        providerTurnId: null,
      };
    },
    cancelTurn: (params, context) => {
      context.events.emit({
        type: "turn.settled",
        attachmentId: params.attachmentId,
        turnId: params.turnId,
        outcome: "cancelled",
        error: null,
        providerCheckpointId: "cancel-checkpoint",
      });
      return { outcome: "cancellation_requested" };
    },
  });
  const server = new ProviderDriverServer({
    driver,
    readable: hostToDriver,
    writable: driverToHost,
  });
  const peer = new ProcessProviderDriverConnection({
    readable: driverToHost,
    writable: hostToDriver,
  });
  await peer.initialize(
    providerDriverInitializeParamsSchema.parse({
      supportedProtocolVersions: [3],
      expected: {
        pluginId: "fake",
        driverId: "fake",
        providerId: "fake",
        artifactDigest: "a".repeat(64),
      },
      host: { platform: "darwin", architecture: "arm64" },
      paths: { providerDataDir: "/provider-data" },
      config: {},
    }),
  );
  const connection = new CanonicalProcessProviderConnection({
    additionalWorkspaceWriteRoots: ["/additional-root"],
    capabilities: {
      supportsArchive: false,
      supportsRename: false,
      supportsServiceTier: false,
      supportsUserQuestion: false,
      supportsFork: false,
      supportedPermissionModes: ["full"],
    },
    classifyExecutionSettingsChange: () => "unchanged",
    displayName: "Fake",
    processConnection: peer,
    providerId: "fake",
    resolveThreadStoragePath: (threadId) => `/thread-storage/${threadId}`,
  });
  await connection.initialize([
    {
      id: "pi-skills",
      providerId: "pi",
      skillDirectoryRootPath: "/skills",
    },
  ]);
  return {
    connection,
    getOpenParams: () => openParams,
    peer,
    server,
  };
}

describe("CanonicalProcessProviderConnection", () => {
  it("projects response-buffered session and turn events in canonical order", async () => {
    const { connection, getOpenParams, peer, server } =
      await createConnection();
    const liveEvents = vi.fn<(events: ThreadEvent[]) => void>();
    connection.onEvent(liveEvents);

    const opened = await connection.openSession(openArgs());
    expect(opened).toMatchObject({
      providerSessionId: "provider-session-1",
    });
    await vi.waitFor(() => {
      const projected = [
        ...opened.events,
        ...liveEvents.mock.calls.flatMap((call) => call[0]),
      ];
      expect(projected).toContainEqual(
        expect.objectContaining({
          type: "thread/contextWindowUsage/updated",
          scope: { kind: "thread" },
        }),
      );
    });
    liveEvents.mockClear();
    expect(getOpenParams()).toMatchObject({
      workspace: {
        additionalWriteRoots: ["/additional-root"],
        threadStoragePath: "/thread-storage/thread-1",
      },
      instructions: { mode: "append", text: "Test instructions" },
      skillSources: [{ id: "pi-skills", rootPath: "/skills" }],
      dynamicTools: [{ name: "test_tool" }],
      disallowedTools: ["dangerous"],
      shellEnvironment: { BB_THREAD_ID: "thread-1" },
    });

    const first = await connection.submitTurn({
      bbThreadId: "thread-1",
      providerSessionId: "provider-session-1",
      mode: { kind: "start" },
      input: [{ type: "text", text: "Hello", mentions: [] }],
      clientRequestId: "creq_23456789ab",
      execution: execution(),
    });
    expect(first).toEqual({ disposition: "accepted", events: [] });
    await vi.waitFor(() => {
      expect(
        liveEvents.mock.calls.flatMap((call) =>
          call[0].map((event) => event.type),
        ),
      ).toEqual([
        "turn/started",
        "turn/input/accepted",
        "item/started",
        "item/agentMessage/delta",
        "item/completed",
        "turn/completed",
      ]);
    });
    liveEvents.mockClear();

    const second = await connection.submitTurn({
      bbThreadId: "thread-1",
      providerSessionId: "provider-session-1",
      mode: { kind: "start" },
      input: [{ type: "text", text: "Again", mentions: [] }],
      clientRequestId: "creq_3456789abc",
      execution: execution(),
    });
    expect(second).toEqual({ disposition: "accepted", events: [] });
    const secondEvents = liveEvents.mock.calls.flatMap((call) => call[0]);
    const secondStarted = secondEvents.find(
      (event) => event.type === "turn/started",
    );
    if (secondStarted?.scope.kind !== "turn") {
      throw new Error("Expected a turn-scoped start event");
    }
    const activeTurnId = secondStarted.scope.turnId;
    liveEvents.mockClear();

    const stale = await connection.submitTurn({
      bbThreadId: "thread-1",
      providerSessionId: "provider-session-1",
      mode: { kind: "steer", expectedTurnId: activeTurnId },
      input: [{ type: "text", text: "Steer", mentions: [] }],
      clientRequestId: "creq_456789abcd",
      execution: execution(),
    });
    expect(stale).toEqual({
      disposition: "stale",
      activeTurnId,
      events: [],
    });

    await expect(
      connection.stopSession({
        bbThreadId: "thread-1",
        providerSessionId: "provider-session-1",
        activeTurnId,
      }),
    ).resolves.toMatchObject({
      disposition: "stopped",
      providerCheckpointId: "detach-checkpoint",
    });
    expect(liveEvents).toHaveBeenCalledWith([
      expect.objectContaining({
        type: "turn/completed",
        status: "interrupted",
      }),
    ]);

    await peer.shutdown();
    await server.finished;
  });
});
