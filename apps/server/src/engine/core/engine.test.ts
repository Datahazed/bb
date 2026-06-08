import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AgentRuntime, AgentRuntimeOptions } from "@bb/agent-runtime";
import type {
  PendingInteractionCreate,
  ThreadEvent,
  ToolCallRequest,
  ToolCallResponse,
} from "@bb/domain";
import { turnScope } from "@bb/domain";
import type { HostDaemonInteractiveRequestResponse } from "../contract/session-types.js";
import type { HostWatcher } from "../watchers/host-watcher-types.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  EngineLogger,
  EnginePorts,
  EngineThreadEventInput,
  InterruptInteractiveRequestsArgs,
} from "../ports.js";
import { createEngine, type Engine } from "./engine.js";

interface RuntimeOptionsRef {
  current: AgentRuntimeOptions | null;
}

interface CreateEngineFixtureArgs {
  callToolError?: Error;
  interactiveRequestError?: Error;
  interactiveRequestResponse?: HostDaemonInteractiveRequestResponse;
}

interface EngineFixture {
  engine: Engine;
  logger: ReturnType<typeof createLogger>;
  portMocks: {
    callTool: ReturnType<typeof vi.fn>;
    emit: ReturnType<typeof vi.fn>;
    flush: ReturnType<typeof vi.fn>;
    interrupt: ReturnType<typeof vi.fn>;
    register: ReturnType<typeof vi.fn>;
  };
  runtimeOptions: RuntimeOptionsRef;
}

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function createLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } satisfies EngineLogger;
}

function createFakeRuntime(): AgentRuntime {
  return {
    async ensureProvider() {},
    async startThread() {
      return { providerThreadId: "provider-thread-engine-test" };
    },
    async resumeThread() {
      return { providerThreadId: "provider-thread-engine-test" };
    },
    async runTurn() {},
    async steerTurn() {
      return { status: "steered" };
    },
    async stopThread() {},
    async renameThread() {},
    async archiveThread() {},
    async unarchiveThread() {},
    async listModels() {
      return {
        models: [],
        selectedOnlyModels: [],
      };
    },
    listRunningProviders() {
      return [];
    },
    async shutdown() {},
  };
}

function createFakeHostWatcher(): HostWatcher {
  return {
    watchApplicationStorageRoot: vi.fn(() => () => undefined),
    watchWorkspace: vi.fn(() => () => undefined),
    watchThreadStorageRoot: vi.fn(() => () => undefined),
  } satisfies HostWatcher;
}

function createCommandApprovalRequest(): PendingInteractionCreate {
  return {
    threadId: "thr_engine_interactive",
    turnId: "turn_engine_interactive",
    providerId: "codex",
    providerThreadId: "provider-thread-engine-interactive",
    providerRequestId: "provider-request-engine-interactive",
    payload: {
      kind: "approval",
      subject: {
        kind: "command",
        itemId: "item-engine-interactive",
        command: "git status",
        cwd: "/tmp/project",
        actions: [],
        sessionGrant: null,
      },
      reason: "Needs approval",
      availableDecisions: ["allow_once", "deny"],
    },
  };
}

function createToolCallRequest(): ToolCallRequest {
  return {
    requestId: "provider-tool-request-engine-test",
    threadId: "thr_engine_tool",
    providerThreadId: "provider-thread-engine-tool",
    turnId: "turn_engine_tool",
    callId: "call-engine-tool",
    tool: "message_user",
    arguments: {
      text: "hello",
    },
  };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    tempDirs
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

async function createEngineFixture(
  args: CreateEngineFixtureArgs = {},
): Promise<EngineFixture> {
  const dataDir = await makeTempDir("bb-engine-core-test-");
  const logger = createLogger();
  const runtimeOptions: RuntimeOptionsRef = { current: null };
  const emit = vi.fn((_input: EngineThreadEventInput) => undefined);
  const flush = vi.fn(async () => undefined);
  const register = vi.fn(
    async (
      _request: PendingInteractionCreate,
    ): Promise<HostDaemonInteractiveRequestResponse> => {
      if (args.interactiveRequestError) {
        throw args.interactiveRequestError;
      }
      return (
        args.interactiveRequestResponse ?? {
          outcome: "created",
          interactionId: "pint_engine_test",
          status: "pending",
        }
      );
    },
  );
  const interrupt = vi.fn(
    async (_args: InterruptInteractiveRequestsArgs) => undefined,
  );
  const callTool = vi.fn(
    async (_request: ToolCallRequest): Promise<ToolCallResponse> => {
      if (args.callToolError) {
        throw args.callToolError;
      }
      return { contentItems: [], success: true };
    },
  );
  const ports: EnginePorts = {
    events: { emit, flush },
    interactiveRequests: { register, interrupt },
    callTool,
    appData: {
      publishChange: vi.fn(async () => undefined),
      publishResync: vi.fn(async () => undefined),
    },
    fetchProjectAttachment: vi.fn(async () => {
      throw new Error("Unexpected project attachment fetch");
    }),
    deliverCommandResult: vi.fn(async () => undefined),
    changes: {
      notifyEnvironmentChanged: vi.fn(),
      notifyApplicationStorageChanged: vi.fn(),
      notifyApplicationContentChanged: vi.fn(),
    },
    sendTerminalEvent: vi.fn(),
  };
  const engine = await createEngine({
    dataDir,
    ports,
    logger,
    hostWatcher: createFakeHostWatcher(),
    createRuntime: (options) => {
      runtimeOptions.current = options;
      return createFakeRuntime();
    },
  });

  return {
    engine,
    logger,
    portMocks: { callTool, emit, flush, interrupt, register },
    runtimeOptions,
  };
}

function firstInvocationOrder(mock: ReturnType<typeof vi.fn>): number {
  const order = mock.mock.invocationCallOrder[0];
  if (order === undefined) {
    throw new Error("Expected mock to have been called");
  }
  return order;
}

describe("createEngine", () => {
  it("emits runtime thread events through the event sink port", async () => {
    const { engine, portMocks, runtimeOptions } = await createEngineFixture();
    try {
      const workspacePath = await makeTempDir("bb-engine-events-workspace-");
      await engine.runtimeManager.ensureEnvironment({
        environmentId: "env-engine-events",
        workspacePath,
      });
      const onEvent = runtimeOptions.current?.onEvent;
      if (!onEvent) {
        throw new Error("Expected runtime event callback to be captured");
      }

      const event: ThreadEvent = {
        type: "turn/started",
        threadId: "thr_engine_events",
        providerThreadId: "provider-thread-engine-events",
        scope: turnScope("turn_engine_events"),
      };
      onEvent(event);

      expect(portMocks.emit).toHaveBeenCalledWith({
        threadId: "thr_engine_events",
        event,
      });
    } finally {
      await engine.shutdown();
    }
  });

  it("logs raw stderr for unexpected provider process exits", async () => {
    const { engine, logger, runtimeOptions } = await createEngineFixture();
    try {
      const workspacePath = await makeTempDir("bb-engine-exit-workspace-");
      await engine.runtimeManager.ensureEnvironment({
        environmentId: "env-engine-provider-exit-log",
        workspacePath,
      });
      const options = runtimeOptions.current;
      if (!options?.onProcessExit) {
        throw new Error("Expected process exit callback to be captured");
      }

      options.onProcessExit({
        providerId: "codex",
        threadIds: ["thr_provider_exit_log"],
        code: 1,
        expected: false,
        signal: null,
        stderr: "OPENAI_API_KEY=sk-test-secret\nUsage limit reached.",
      });

      expect(logger.warn).toHaveBeenCalledWith(
        {
          providerId: "codex",
          threadIds: ["thr_provider_exit_log"],
          code: 1,
          signal: null,
          stderr: "OPENAI_API_KEY=sk-test-secret\nUsage limit reached.",
        },
        "Unexpected provider process exited with stderr",
      );
    } finally {
      await engine.shutdown();
    }
  });

  it("interrupts pending interactive requests when a provider exit affects their threads", async () => {
    const { engine, portMocks, runtimeOptions } = await createEngineFixture();
    try {
      const workspacePath = await makeTempDir(
        "bb-engine-interactive-workspace-",
      );
      await engine.runtimeManager.ensureEnvironment({
        environmentId: "env-engine-interactive",
        workspacePath,
      });
      const options = runtimeOptions.current;
      if (!options?.onInteractiveRequest || !options.onProcessExit) {
        throw new Error("Expected runtime callbacks to be captured");
      }

      const request = createCommandApprovalRequest();
      const pending = options.onInteractiveRequest(request);
      await vi.waitFor(() => {
        expect(portMocks.register).toHaveBeenCalledTimes(1);
      });

      const pendingRejection = expect(pending).rejects.toThrow(
        'Provider "codex" exited while awaiting user interaction',
      );
      options.onProcessExit({
        providerId: "codex",
        threadIds: [request.threadId],
        code: null,
        expected: true,
        signal: "SIGTERM",
        stderr: null,
      });

      await pendingRejection;
      expect(portMocks.interrupt).toHaveBeenCalledWith({
        providerId: "codex",
        threadIds: [request.threadId],
        reason: 'Provider "codex" exited while awaiting user interaction',
      });
    } finally {
      await engine.shutdown();
    }
  });

  it("flushes thread events before registering interactive requests", async () => {
    const { engine, portMocks, runtimeOptions } = await createEngineFixture();
    try {
      const workspacePath = await makeTempDir(
        "bb-engine-interactive-flush-workspace-",
      );
      await engine.runtimeManager.ensureEnvironment({
        environmentId: "env-engine-interactive-flush",
        workspacePath,
      });
      const options = runtimeOptions.current;
      if (!options?.onInteractiveRequest || !options.onProcessExit) {
        throw new Error("Expected runtime callbacks to be captured");
      }

      const request = createCommandApprovalRequest();
      const pending = options.onInteractiveRequest(request);
      await vi.waitFor(() => {
        expect(portMocks.register).toHaveBeenCalledTimes(1);
      });
      expect(firstInvocationOrder(portMocks.flush)).toBeLessThan(
        firstInvocationOrder(portMocks.register),
      );

      // Tear down the still-pending wait so the test does not leak it.
      const pendingRejection = expect(pending).rejects.toThrow(
        'Provider "codex" exited while awaiting user interaction',
      );
      options.onProcessExit({
        providerId: "codex",
        threadIds: [request.threadId],
        code: null,
        expected: true,
        signal: "SIGTERM",
        stderr: null,
      });
      await pendingRejection;
    } finally {
      await engine.shutdown();
    }
  });

  it("flushes thread events before forwarding dynamic tool calls", async () => {
    const { engine, portMocks, runtimeOptions } = await createEngineFixture();
    try {
      const workspacePath = await makeTempDir("bb-engine-tool-workspace-");
      await engine.runtimeManager.ensureEnvironment({
        environmentId: "env-engine-tool-flush",
        workspacePath,
      });
      const options = runtimeOptions.current;
      if (!options?.onToolCall) {
        throw new Error("Expected tool call callback to be captured");
      }

      const response = await options.onToolCall(createToolCallRequest());

      expect(response).toEqual({ contentItems: [], success: true });
      expect(portMocks.callTool).toHaveBeenCalledTimes(1);
      expect(firstInvocationOrder(portMocks.flush)).toBeLessThan(
        firstInvocationOrder(portMocks.callTool),
      );
    } finally {
      await engine.shutdown();
    }
  });

  it("logs stack-bearing fields for dynamic tool forwarding failures", async () => {
    const { engine, logger, runtimeOptions } = await createEngineFixture({
      callToolError: new Error("Failed to call tool"),
    });
    try {
      const workspacePath = await makeTempDir(
        "bb-engine-tool-error-workspace-",
      );
      await engine.runtimeManager.ensureEnvironment({
        environmentId: "env-engine-tool",
        workspacePath,
      });
      const options = runtimeOptions.current;
      if (!options?.onToolCall) {
        throw new Error("Expected tool call callback to be captured");
      }

      const request = createToolCallRequest();
      await expect(options.onToolCall(request)).rejects.toThrow(
        "Failed to call tool",
      );

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          callId: request.callId,
          err: expect.any(Error),
          providerThreadId: request.providerThreadId,
          threadId: request.threadId,
          tool: request.tool,
          turnId: request.turnId,
        }),
        "Failed to forward dynamic tool call to server",
      );
    } finally {
      await engine.shutdown();
    }
  });

  it("logs stack-bearing fields for unexpected interactive forwarding failures and interrupts the thread", async () => {
    const registrationError = new Error("registration transport failed");
    const { engine, logger, portMocks, runtimeOptions } =
      await createEngineFixture({
        interactiveRequestError: registrationError,
      });
    try {
      const workspacePath = await makeTempDir(
        "bb-engine-interactive-error-workspace-",
      );
      await engine.runtimeManager.ensureEnvironment({
        environmentId: "env-engine-interactive-error",
        workspacePath,
      });
      const options = runtimeOptions.current;
      if (!options?.onInteractiveRequest) {
        throw new Error("Expected interactive request callback to be captured");
      }

      const request = createCommandApprovalRequest();
      await expect(options.onInteractiveRequest(request)).rejects.toThrow(
        "registration transport failed",
      );

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          err: registrationError,
          kind: request.payload.kind,
          providerRequestId: request.providerRequestId,
          providerThreadId: request.providerThreadId,
          threadId: request.threadId,
          turnId: request.turnId,
        }),
        "Failed to forward interactive provider request to server",
      );
      await vi.waitFor(() => {
        expect(portMocks.interrupt).toHaveBeenCalledWith({
          providerId: request.providerId,
          threadIds: [request.threadId],
          reason: `Failed to register interactive request while provider was waiting: ${registrationError.message}`,
        });
      });
    } finally {
      await engine.shutdown();
    }
  });

  it("logs rejected interactive request registrations with a structured code", async () => {
    const { engine, logger, portMocks, runtimeOptions } =
      await createEngineFixture({
        interactiveRequestResponse: {
          outcome: "rejected",
          reason: "Ask User Question feature is disabled",
        },
      });
    try {
      const workspacePath = await makeTempDir(
        "bb-engine-rejected-interactive-workspace-",
      );
      await engine.runtimeManager.ensureEnvironment({
        environmentId: "env-engine-rejected-interactive",
        workspacePath,
      });
      const options = runtimeOptions.current;
      if (!options?.onInteractiveRequest) {
        throw new Error("Expected interactive request callback to be captured");
      }

      const request = createCommandApprovalRequest();
      await expect(options.onInteractiveRequest(request)).rejects.toThrow(
        "Ask User Question feature is disabled",
      );

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          errorMessage: "Ask User Question feature is disabled",
          errorName: "InteractiveRequestRegistryError",
          interactiveRequestErrorCode: "interactive_request_rejected",
          kind: request.payload.kind,
          providerRequestId: request.providerRequestId,
          providerThreadId: request.providerThreadId,
          threadId: request.threadId,
          turnId: request.turnId,
        }),
        "Interactive provider request rejected by server",
      );
      expect(logger.error).not.toHaveBeenCalledWith(
        expect.anything(),
        "Failed to forward interactive provider request to server",
      );
      // A server-side rejection is not a registration transport failure —
      // nothing is pending on the server, so no interrupt is sent.
      expect(portMocks.interrupt).not.toHaveBeenCalled();
    } finally {
      await engine.shutdown();
    }
  });
});
