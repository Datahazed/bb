import { PassThrough } from "node:stream";
import {
  ProviderDriverFrameDecoder,
  encodeProviderDriverFrame,
  providerDriverInitializeParamsSchema,
  providerDriverInitializeResultSchema,
  providerDriverRequestSchema,
  providerSessionOpenParamsSchema,
  providerSessionOpenResultSchema,
  providerTurnSubmitParamsSchema,
  providerTurnSubmitResultSchema,
  type ProviderDriverInitializeParams,
  type ProviderDriverInitializeResult,
  type ProviderDriverRequest,
  type ProviderSessionOpenParams,
  type ProviderSessionOpenResult,
  type ProviderTurnSubmitParams,
  type ProviderTurnSubmitResult,
} from "@bb/provider-driver-contract";
import { describe, expect, it, vi } from "vitest";
import {
  ProcessProviderDriverConnection,
  ProviderDriverProtocolError,
} from "./process-connection.js";

class FakeDriverPeer {
  readonly messages: unknown[] = [];
  onRequest: (request: ProviderDriverRequest) => void = () => {};
  private readonly decoder = new ProviderDriverFrameDecoder();

  constructor(
    private readonly hostToDriver: PassThrough,
    private readonly driverToHost: PassThrough,
  ) {
    this.hostToDriver.on("data", (chunk: Buffer) => {
      for (const message of this.decoder.push(chunk)) {
        this.messages.push(message);
        const request = providerDriverRequestSchema.safeParse(message);
        if (request.success) {
          this.onRequest(request.data);
        }
      }
    });
  }

  send(message: unknown): void {
    this.driverToHost.write(encodeProviderDriverFrame(message));
  }

  sendTogether(messages: unknown[]): void {
    this.driverToHost.write(
      Buffer.concat(
        messages.map((message) => encodeProviderDriverFrame(message)),
      ),
    );
  }
}

function makeInitializeParams(): ProviderDriverInitializeParams {
  return providerDriverInitializeParamsSchema.parse({
    supportedProtocolVersions: [4],
    expected: {
      pluginId: "test-plugin",
      driverId: "test-driver",
      providerId: "test-provider",
      artifactDigest: "a".repeat(64),
    },
    host: { platform: "darwin", architecture: "arm64" },
    paths: { providerDataDir: "/tmp/provider-data/test" },
    config: {},
  });
}

function makeInitializeResult(): ProviderDriverInitializeResult {
  return providerDriverInitializeResultSchema.parse({
    protocolVersion: 4,
    identity: {
      pluginId: "test-plugin",
      driverId: "test-driver",
      providerId: "test-provider",
    },
    processCapabilities: { multiplexSessions: true },
  });
}

function makeSessionOpenParams(): ProviderSessionOpenParams {
  return providerSessionOpenParamsSchema.parse({
    operationId: "operation-open-1",
    attachmentId: "attachment-1",
    bbThreadId: "thread-1",
    mode: { kind: "start" },
    workspace: {
      cwd: "/tmp/workspace",
      additionalWriteRoots: [],
      threadStoragePath: "/tmp/thread-storage/thread-1",
    },
    execution: {
      model: "test/model",
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
        subagentsEnabled: false,
      },
      providerOptions: {},
    },
    instructions: { mode: "append", text: "Test instructions" },
    skillSources: [],
    dynamicTools: [],
    disallowedTools: [],
    outputSchema: null,
    shellEnvironment: {},
  });
}

function makeSessionOpenResult(): ProviderSessionOpenResult {
  return providerSessionOpenResultSchema.parse({
    providerSessionId: "provider-session-1",
    sessionFormatVersion: null,
  });
}

function makeTurnSubmitParams(): ProviderTurnSubmitParams {
  return providerTurnSubmitParamsSchema.parse({
    operationId: "operation-turn-1",
    clientRequestId: "creq_23456789ab",
    attachmentId: "attachment-1",
    mode: "start",
    turnId: "turn-1",
    inputGroups: [[{ type: "text", text: "Hello", mentions: [] }]],
    execution: makeSessionOpenParams().execution,
  });
}

function makeTurnSubmitResult(): ProviderTurnSubmitResult {
  return providerTurnSubmitResultSchema.parse({
    outcome: "accepted",
    disposition: "started",
    turnId: "turn-1",
    providerTurnId: null,
  });
}

function makeSettledEvent(sequence: number) {
  return {
    jsonrpc: "2.0",
    method: "driver.event",
    params: {
      type: "turn.settled",
      attachmentId: "attachment-1",
      sequence,
      turnId: "turn-1",
      outcome: "completed",
      error: null,
      providerCheckpointId: null,
    },
  };
}

function createHarness(args?: {
  callTool?: () => Promise<{
    success: boolean;
    content: Array<{ type: "text"; text: string }>;
  }>;
  requestTimeoutMs?: number;
}) {
  const hostToDriver = new PassThrough();
  const driverToHost = new PassThrough();
  const protocolErrors: Error[] = [];
  const connection = new ProcessProviderDriverConnection({
    hostHandlers:
      args?.callTool !== undefined ? { callTool: args.callTool } : undefined,
    onProtocolError: (error) => protocolErrors.push(error),
    readable: driverToHost,
    requestTimeoutMs: args?.requestTimeoutMs,
    writable: hostToDriver,
  });
  const driver = new FakeDriverPeer(hostToDriver, driverToHost);
  return { connection, driver, protocolErrors };
}

function installHappyPathDriver(driver: FakeDriverPeer): void {
  driver.onRequest = (request) => {
    switch (request.method) {
      case "driver.initialize":
        driver.send({
          jsonrpc: "2.0",
          id: request.id,
          result: makeInitializeResult(),
        });
        return;
      case "session.open":
        driver.send({
          jsonrpc: "2.0",
          id: request.id,
          result: makeSessionOpenResult(),
        });
        return;
      case "turn.submit":
        driver.send({
          jsonrpc: "2.0",
          id: request.id,
          result: makeTurnSubmitResult(),
        });
        return;
      default:
        throw new Error(`Unexpected fake driver request ${request.method}`);
    }
  };
}

async function initializeAndOpen(
  connection: ProcessProviderDriverConnection,
): Promise<void> {
  await connection.initialize(makeInitializeParams());
  await connection.openSession(makeSessionOpenParams());
}

async function nextMicrotask(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

describe("ProcessProviderDriverConnection", () => {
  it("records acceptance before handling a following event in the same chunk", async () => {
    const { connection, driver, protocolErrors } = createHarness();
    const events: unknown[] = [];
    connection.onEvent((event) => events.push(event));
    installHappyPathDriver(driver);
    await initializeAndOpen(connection);

    driver.onRequest = (request) => {
      if (request.method !== "turn.submit") {
        throw new Error(`Unexpected fake driver request ${request.method}`);
      }
      driver.sendTogether([
        {
          jsonrpc: "2.0",
          id: request.id,
          result: makeTurnSubmitResult(),
        },
        makeSettledEvent(1),
      ]);
    };

    await expect(
      connection.submitTurn(makeTurnSubmitParams()),
    ).resolves.toEqual(makeTurnSubmitResult());
    expect(events).toHaveLength(1);
    expect(protocolErrors).toEqual([]);
  });

  it("accepts an exact operation replay without duplicating attachment state", async () => {
    const { connection, driver, protocolErrors } = createHarness();
    installHappyPathDriver(driver);
    await connection.initialize(makeInitializeParams());
    const params = makeSessionOpenParams();

    await connection.openSession(params);
    await connection.openSession(params);
    expect(protocolErrors).toEqual([]);
  });

  it("closes the protocol when an event arrives before turn acceptance", async () => {
    const { connection, driver, protocolErrors } = createHarness();
    installHappyPathDriver(driver);
    await initializeAndOpen(connection);

    driver.onRequest = (request) => {
      if (request.method === "turn.submit") {
        driver.sendTogether([
          makeSettledEvent(1),
          {
            jsonrpc: "2.0",
            id: request.id,
            result: makeTurnSubmitResult(),
          },
        ]);
      }
    };

    await expect(
      connection.submitTurn(makeTurnSubmitParams()),
    ).rejects.toBeInstanceOf(ProviderDriverProtocolError);
    expect(protocolErrors).toHaveLength(1);
    expect(protocolErrors[0]?.message).toContain("no accepted active turn");
  });

  it("rejects duplicate settlement without crashing the host", async () => {
    const { connection, driver, protocolErrors } = createHarness();
    installHappyPathDriver(driver);
    await initializeAndOpen(connection);

    driver.onRequest = (request) => {
      if (request.method === "turn.submit") {
        driver.sendTogether([
          {
            jsonrpc: "2.0",
            id: request.id,
            result: makeTurnSubmitResult(),
          },
          makeSettledEvent(1),
          makeSettledEvent(2),
        ]);
      }
    };

    await connection.submitTurn(makeTurnSubmitParams());
    expect(protocolErrors).toHaveLength(1);
    expect(protocolErrors[0]?.message).toContain("already settled");
  });

  it("rejects an event scoped to the wrong attachment", async () => {
    const { connection, driver, protocolErrors } = createHarness();
    installHappyPathDriver(driver);
    await initializeAndOpen(connection);

    driver.onRequest = (request) => {
      if (request.method === "turn.submit") {
        driver.sendTogether([
          {
            jsonrpc: "2.0",
            id: request.id,
            result: makeTurnSubmitResult(),
          },
          {
            ...makeSettledEvent(1),
            params: {
              ...makeSettledEvent(1).params,
              attachmentId: "attachment-other",
            },
          },
        ]);
      }
    };

    await connection.submitTurn(makeTurnSubmitParams());
    expect(protocolErrors).toHaveLength(1);
    expect(protocolErrors[0]?.message).toContain("Unknown driver attachment");
  });

  it("reports accepted but unsettled turns when the process exits", async () => {
    const { connection, driver } = createHarness();
    installHappyPathDriver(driver);
    await initializeAndOpen(connection);
    await connection.submitTurn(makeTurnSubmitParams());

    const exit = connection.recordProcessExit({ code: 42, signal: null });
    expect(exit.lifecycle.activeAttachments).toEqual([
      {
        activeTurnId: "turn-1",
        attachmentId: "attachment-1",
        providerSessionId: "provider-session-1",
      },
    ]);
  });

  it("rejects a pending request when the process exits before acceptance", async () => {
    const { connection, driver } = createHarness();
    installHappyPathDriver(driver);
    await initializeAndOpen(connection);
    driver.onRequest = (request) => {
      if (request.method === "turn.submit") {
        connection.recordProcessExit({ code: 23, signal: null });
      }
    };

    await expect(connection.submitTurn(makeTurnSubmitParams())).rejects.toThrow(
      "exited (code 23)",
    );
  });

  it("routes canonical host tool requests and validates the result", async () => {
    const callTool = vi.fn(async () => ({
      success: true,
      content: [{ type: "text" as const, text: "tool result" }],
    }));
    const { connection, driver } = createHarness({ callTool });
    installHappyPathDriver(driver);
    await initializeAndOpen(connection);
    await connection.submitTurn(makeTurnSubmitParams());

    driver.send({
      jsonrpc: "2.0",
      id: "driver-request-1",
      method: "host.tool.call",
      params: {
        attachmentId: "attachment-1",
        turnId: "turn-1",
        callId: "call-1",
        tool: "test_tool",
        arguments: {},
      },
    });
    await nextMicrotask();

    expect(callTool).toHaveBeenCalledTimes(1);
    expect(driver.messages).toContainEqual({
      jsonrpc: "2.0",
      id: "driver-request-1",
      result: {
        success: true,
        content: [{ type: "text", text: "tool result" }],
      },
    });
  });

  it("returns invalid-params for a malformed host request", async () => {
    const callTool = vi.fn(async () => ({
      success: true,
      content: [{ type: "text" as const, text: "tool result" }],
    }));
    const { connection, driver, protocolErrors } = createHarness({ callTool });
    installHappyPathDriver(driver);
    await initializeAndOpen(connection);
    await connection.submitTurn(makeTurnSubmitParams());

    driver.send({
      jsonrpc: "2.0",
      id: "malformed-host-request",
      method: "host.tool.call",
      params: {
        attachmentId: "attachment-1",
        turnId: "turn-1",
        callId: "call-1",
        tool: "test_tool",
      },
    });
    await nextMicrotask();

    expect(callTool).not.toHaveBeenCalled();
    expect(driver.messages).toContainEqual({
      jsonrpc: "2.0",
      id: "malformed-host-request",
      error: {
        code: -32602,
        message: "Invalid params for host.tool.call",
        data: null,
      },
    });
    expect(protocolErrors).toEqual([]);
  });

  it("times out an unanswered request", async () => {
    const { connection, driver } = createHarness({ requestTimeoutMs: 10 });
    driver.onRequest = () => {};

    await expect(connection.initialize(makeInitializeParams())).rejects.toThrow(
      "request timed out: driver.initialize",
    );
  });

  it("supports tighter startup timeouts than long-running mutations", async () => {
    const { connection, driver } = createHarness({ requestTimeoutMs: 5_000 });
    connection.configureRequestTimeouts({ driverInitializeMs: 10 });
    driver.onRequest = () => {};

    await expect(connection.initialize(makeInitializeParams())).rejects.toThrow(
      "request timed out: driver.initialize",
    );
  });
});
