import {
  providerDriverEventSchema,
  providerDriverInitializeParamsSchema,
  providerSessionOpenParamsSchema,
  providerTurnSubmitParamsSchema,
  type ProviderDriverEvent,
} from "@bb/provider-driver-contract";
import type {
  ProviderDriverContext,
  ProviderDriverDefinition,
  ProviderDriverEventInput,
} from "@bb/provider-driver-sdk";
import { beforeAll, describe, expect, it, vi } from "vitest";

class FakePiSdkSession {
  static readonly instances: FakePiSdkSession[] = [];

  readonly closeGracefully = vi.fn(async () => "fake-checkpoint");
  readonly compact = vi.fn(async () => undefined);
  readonly prompt = vi.fn(async () => undefined);
  readonly start = vi.fn(async () => undefined);
  readonly steer = vi.fn(async () => undefined);

  constructor(
    readonly options: unknown,
    private readonly onEvent: (event: unknown) => void,
    private readonly onDone: (error?: unknown) => void,
  ) {
    FakePiSdkSession.instances.push(this);
  }

  emit(event: unknown): void {
    this.onEvent(event);
  }

  finish(error?: unknown): void {
    this.onDone(error);
  }

  getContextUsage() {
    return { tokens: 10, contextWindow: 100 };
  }

  getIsCompacting(): boolean {
    return false;
  }

  getProviderCheckpointId(): string {
    return "event-checkpoint";
  }
}

let piProviderDriver: ProviderDriverDefinition;

beforeAll(async () => {
  vi.doMock("./sdk-session.js", () => ({
    PiSdkSession: FakePiSdkSession,
  }));
  ({ piProviderDriver } = await import("./driver.js"));
});

function initializeParams() {
  return providerDriverInitializeParamsSchema.parse({
    supportedProtocolVersions: [3],
    expected: {
      pluginId: "pi",
      driverId: "pi",
      providerId: "pi",
      artifactDigest: "a".repeat(64),
    },
    host: { platform: "darwin", architecture: "arm64" },
    paths: { providerDataDir: "/provider-data" },
    config: {},
  });
}

function sessionParams() {
  return providerSessionOpenParamsSchema.parse({
    operationId: "open-1",
    attachmentId: "attachment-1",
    bbThreadId: "thread-1",
    mode: { kind: "start" },
    workspace: {
      cwd: "/workspace",
      additionalWriteRoots: [],
      threadStoragePath: "/thread-storage/thread-1",
    },
    execution: {
      model: "anthropic/fake-model",
      reasoningLevel: "medium",
      serviceTier: "default",
      permission: {
        permissionMode: "full",
        permissionScope: "full",
        approvalReviewer: null,
        permissionEscalation: null,
      },
      features: {
        workflowsEnabled: false,
        memoryEnabled: false,
        subagentsEnabled: true,
      },
      providerOptions: {},
    },
    instructions: { mode: "append", text: "Test instructions" },
    skillSources: [],
    dynamicTools: [],
    disallowedTools: [],
    outputSchema: null,
    shellEnvironment: { BB_THREAD_ID: "thread-1" },
  });
}

function turnParams(operationId: string, turnId: string) {
  return providerTurnSubmitParamsSchema.parse({
    operationId,
    clientRequestId:
      operationId === "turn-1" ? "creq_23456789ab" : "creq_3456789abc",
    attachmentId: "attachment-1",
    mode: "start",
    turnId,
    inputGroups: [[{ type: "text", text: "Hello", mentions: [] }]],
    execution: sessionParams().execution,
  });
}

function createContext() {
  const inputs: ProviderDriverEventInput[] = [];
  const context: ProviderDriverContext = {
    events: { emit: (event) => inputs.push(event) },
    host: {
      callTool: async () => ({ success: true, content: [] }),
      requestInteraction: async () => {
        throw new Error("Unexpected interaction");
      },
    },
    initialization: initializeParams(),
  };
  const events = (): ProviderDriverEvent[] =>
    inputs.map((event, index) =>
      providerDriverEventSchema.parse({ ...event, sequence: index + 1 }),
    );
  return { context, events };
}

describe("Pi canonical provider driver", () => {
  it("opens, runs, settles, cancels, and detaches a Pi session", async () => {
    const { context, events } = createContext();
    await expect(
      piProviderDriver.openSession(sessionParams(), context),
    ).resolves.toEqual({
      providerSessionId: "thread-1",
      sessionFormatVersion: "pi-jsonl-v1",
    });
    const session = FakePiSdkSession.instances.at(-1);
    if (!session) throw new Error("Pi session was not created");
    expect(session.start).toHaveBeenCalledTimes(1);

    await expect(
      piProviderDriver.submitTurn(
        turnParams("turn-1", "canonical-turn-1"),
        context,
      ),
    ).resolves.toMatchObject({
      outcome: "accepted",
      disposition: "started",
      turnId: "canonical-turn-1",
    });
    expect(session.prompt).toHaveBeenCalledTimes(1);

    session.emit({ type: "agent_start" });
    session.emit({
      type: "agent_end",
      messages: [
        {
          role: "assistant",
          content: [{ type: "text", text: "Done" }],
          stopReason: "stop",
          provider: "anthropic",
          model: "fake-model",
          usage: {
            input: 4,
            output: 2,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 6,
          },
        },
      ],
      willRetry: false,
    });
    expect(events()).toContainEqual(
      expect.objectContaining({
        type: "turn.settled",
        turnId: "canonical-turn-1",
        outcome: "completed",
        providerCheckpointId: "event-checkpoint",
      }),
    );

    await expect(
      piProviderDriver.submitTurn(
        turnParams("turn-2", "canonical-turn-2"),
        context,
      ),
    ).resolves.toMatchObject({ outcome: "accepted" });
    await expect(
      piProviderDriver.cancelTurn(
        {
          operationId: "cancel-1",
          attachmentId: "attachment-1",
          turnId: "canonical-turn-2",
        },
        context,
      ),
    ).resolves.toEqual({ outcome: "cancellation_requested" });
    expect(events()).toContainEqual(
      expect.objectContaining({
        type: "turn.settled",
        turnId: "canonical-turn-2",
        outcome: "cancelled",
        providerCheckpointId: "fake-checkpoint",
      }),
    );

    await expect(
      piProviderDriver.detachSession(
        { operationId: "detach-1", attachmentId: "attachment-1" },
        context,
      ),
    ).resolves.toEqual({ providerCheckpointId: "fake-checkpoint" });
  });
});
