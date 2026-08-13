import type { CanUseTool } from "@anthropic-ai/claude-agent-sdk";
import type {
  ProviderDriverContext,
  ProviderDriverDefinition,
  ProviderDriverEventInput,
} from "@bb/provider-driver-sdk";
import {
  providerDriverEventSchema,
  providerDriverInitializeParamsSchema,
  providerSessionOpenParamsSchema,
  providerTurnSubmitParamsSchema,
  type ProviderDriverEvent,
} from "@bb/provider-driver-contract";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

class FakeClaudeSdkSession {
  static readonly instances: FakeClaudeSdkSession[] = [];

  readonly applyMutableSettings = vi.fn(async () => undefined);
  readonly closeGracefully = vi.fn(async () => undefined);
  readonly setModel = vi.fn(async () => undefined);
  readonly setPermissionMode = vi.fn(async () => undefined);
  readonly start = vi.fn(() => undefined);
  readonly stop = vi.fn(() => undefined);
  private sessionId: string | undefined;

  constructor(
    readonly options: { canUseTool?: CanUseTool; sessionId?: string },
    private readonly onMessage: (message: unknown) => void,
    private readonly onDone: (error?: unknown) => void,
  ) {
    this.sessionId = options.sessionId;
    FakeClaudeSdkSession.instances.push(this);
  }

  canPushInput(): boolean {
    return true;
  }

  getSessionId(): string | undefined {
    return this.sessionId;
  }

  pushInput = vi.fn(async () => undefined);

  emit(message: unknown): void {
    this.onMessage(message);
  }

  finish(error?: unknown): void {
    this.onDone(error);
  }
}

let driver: ProviderDriverDefinition;

beforeAll(async () => {
  vi.doMock("./sdk-session.js", () => ({ SdkSession: FakeClaudeSdkSession }));
  vi.doMock("./driver-model-list.js", () => ({
    listClaudeCodeDriverModels: async () => ({
      models: [
        {
          id: "claude-sonnet-4-6",
          model: "claude-sonnet-4-6",
          displayName: "Sonnet",
          description: "Test model",
          supportedReasoningEfforts: [
            { reasoningEffort: "medium", description: "Medium" },
          ],
          defaultReasoningEffort: "medium",
          isDefault: true,
        },
      ],
      selectedOnlyModels: [],
    }),
  }));
  ({ claudeCodeProviderDriver: driver } = await import("./driver.js"));
});

function initializeParams() {
  return providerDriverInitializeParamsSchema.parse({
    supportedProtocolVersions: [4],
    expected: {
      pluginId: "claude-code",
      driverId: "claude-code",
      providerId: "claude-code",
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
      model: "claude-sonnet-4-6",
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
        memoryEnabled: true,
        subagentsEnabled: true,
      },
      providerOptions: {
        claudeCodeMockCliTraffic: {
          enabled: false,
          endpoint: "http://127.0.0.1:1",
        },
      },
    },
    instructions: { mode: "append", text: "Test instructions" },
    skillSources: [],
    dynamicTools: [],
    disallowedTools: [],
    outputSchema: null,
    shellEnvironment: {},
  });
}

function turnParams() {
  return providerTurnSubmitParamsSchema.parse({
    operationId: "turn-1",
    clientRequestId: "creq_23456789ab",
    attachmentId: "attachment-1",
    mode: "start",
    turnId: "canonical-turn-1",
    inputGroups: [[{ type: "text", text: "Hello", mentions: [] }]],
    execution: sessionParams().execution,
  });
}

function context(
  requestInteraction: ProviderDriverContext["host"]["requestInteraction"] = async () => ({
    resolution: { decision: "deny" },
  }),
) {
  const inputs: ProviderDriverEventInput[] = [];
  const value: ProviderDriverContext = {
    events: { emit: (event) => inputs.push(event) },
    host: {
      callTool: async () => ({ success: true, content: [] }),
      requestInteraction,
    },
    initialization: initializeParams(),
  };
  const events = (): ProviderDriverEvent[] =>
    inputs.map((event, index) =>
      providerDriverEventSchema.parse({ ...event, sequence: index + 1 }),
    );
  return { value, events };
}

describe("Claude Code canonical provider driver", () => {
  beforeEach(() => {
    FakeClaudeSdkSession.instances.length = 0;
  });

  it("routes permission requests through canonical host interactions", async () => {
    const requestInteraction = vi.fn(async () => ({
      resolution: {
        decision: "allow_once" as const,
        grantedPermissions: null,
      },
    }));
    const { value } = context(requestInteraction);
    const interactiveSession = providerSessionOpenParamsSchema.parse({
      ...sessionParams(),
      execution: {
        ...sessionParams().execution,
        permission: {
          permissionMode: "accept-edits",
          permissionScope: "workspace",
          approvalReviewer: "user",
          permissionEscalation: "ask",
        },
      },
    });
    await driver.openSession(interactiveSession, value);
    await driver.submitTurn(
      providerTurnSubmitParamsSchema.parse({
        ...turnParams(),
        execution: interactiveSession.execution,
      }),
      value,
    );
    const session = FakeClaudeSdkSession.instances.at(-1);
    const canUseTool = session?.options.canUseTool;
    if (!canUseTool) throw new Error("Claude canUseTool was not configured");

    await expect(
      canUseTool(
        "Bash",
        { command: "echo hi" },
        {
          signal: new AbortController().signal,
          toolUseID: "tool-1",
          decisionReason: "Run a command",
        },
      ),
    ).resolves.toMatchObject({
      behavior: "allow",
      decisionClassification: "user_temporary",
      toolUseID: "tool-1",
    });
    expect(requestInteraction).toHaveBeenCalledWith(
      expect.objectContaining({
        attachmentId: "attachment-1",
        turnId: "canonical-turn-1",
        requestId: "tool-1",
        payload: expect.objectContaining({ kind: "approval" }),
      }),
    );
  });

  it("opens, accepts, settles, resumes the stream, and cancels", async () => {
    const { value, events } = context();
    const opened = await driver.openSession(sessionParams(), value);
    expect(opened.providerSessionId).toBeTruthy();
    const first = FakeClaudeSdkSession.instances.at(-1);
    if (!first) throw new Error("Claude session was not created");

    await expect(driver.submitTurn(turnParams(), value)).resolves.toMatchObject(
      {
        outcome: "accepted",
        disposition: "started",
        turnId: "canonical-turn-1",
      },
    );
    expect(first.pushInput).toHaveBeenCalledWith("Hello", expect.any(String));

    first.emit({
      type: "result",
      subtype: "success",
      duration_ms: 1,
      duration_api_ms: 1,
      is_error: false,
      num_turns: 1,
      result: "done",
      session_id: opened.providerSessionId,
      total_cost_usd: 0,
      usage: {
        input_tokens: 1,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        output_tokens: 1,
      },
      modelUsage: {},
    });
    expect(events()).toContainEqual(
      expect.objectContaining({
        type: "turn.settled",
        outcome: "completed",
        turnId: "canonical-turn-1",
      }),
    );

    first.finish();
    await expect(
      driver.submitTurn(
        providerTurnSubmitParamsSchema.parse({
          ...turnParams(),
          operationId: "turn-2",
          clientRequestId: "creq_3456789abc",
          turnId: "canonical-turn-2",
        }),
        value,
      ),
    ).resolves.toMatchObject({ outcome: "accepted" });
    expect(FakeClaudeSdkSession.instances).toHaveLength(2);

    await expect(
      driver.cancelTurn(
        {
          operationId: "cancel-1",
          attachmentId: "attachment-1",
          turnId: "canonical-turn-2",
        },
        value,
      ),
    ).resolves.toEqual({ outcome: "cancellation_requested" });
    expect(events()).toContainEqual(
      expect.objectContaining({
        type: "turn.settled",
        outcome: "cancelled",
        turnId: "canonical-turn-2",
      }),
    );
  });
});
