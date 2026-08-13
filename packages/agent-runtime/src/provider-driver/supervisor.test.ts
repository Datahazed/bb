import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  providerDriverInitializeParamsSchema,
  providerSessionOpenParamsSchema,
  providerTurnSubmitParamsSchema,
  type ProviderDriverEvent,
  type ProviderDriverInitializeParams,
  type ProviderSessionOpenParams,
  type ProviderTurnSubmitParams,
} from "@bb/provider-driver-contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderDriverSupervisor } from "./supervisor.js";

const SDK_FAKE_DRIVER_PATH = fileURLToPath(
  new URL("../../test/provider-driver/sdk-fake-driver.ts", import.meta.url),
);

const FAKE_DRIVER_SOURCE = String.raw`
import fs from "node:fs";

const input = fs.createReadStream(null, { fd: 3, autoClose: false });
const output = fs.createWriteStream(null, { fd: 4, autoClose: false });
let buffered = Buffer.alloc(0);

function send(message, done) {
  const payload = Buffer.from(JSON.stringify(message));
  const header = Buffer.alloc(4);
  header.writeUInt32BE(payload.length);
  output.write(Buffer.concat([header, payload]), done);
}

function handle(message) {
  if (message.method === "driver.initialize") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: 5,
        identity: {
          pluginId: message.params.expected.pluginId,
          driverId: message.params.expected.driverId,
          providerId: message.params.expected.providerId,
        },
        processCapabilities: { multiplexSessions: true },
      },
    });
    return;
  }
  if (message.method === "driver.inspect") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        readiness: { status: "ready" },
        capabilities: {
          multiplexSessions: true,
          supportedSessionOperations: ["fork"],
          supportedPermissionModes: ["full"],
          supportsServiceTier: false,
          supportsSteering: true,
          supportsUserQuestions: false,
        },
        models: [],
        selectedOnlyModels: [],
        diagnostics: [],
      },
    });
    return;
  }
  if (message.method === "driver.shutdown") {
    send({ jsonrpc: "2.0", id: message.id, result: {} }, () => {
      process.exit(0);
    });
  }
}

process.stdout.write('{"jsonrpc":"2.0","method":"stdout-is-diagnostic"}\n');
process.stderr.write("fake driver diagnostic\n");
if (process.env.FAKE_DRIVER_SCENARIO === "diagnostic-flood") {
  process.stdout.write("flood\n".repeat(1_100));
}

if (process.env.FAKE_DRIVER_SCENARIO === "oversized") {
  const header = Buffer.alloc(4);
  header.writeUInt32BE(0xffffffff);
  output.write(header);
} else {
  input.on("data", (chunk) => {
    buffered = Buffer.concat([buffered, chunk]);
    while (buffered.length >= 4) {
      const size = buffered.readUInt32BE(0);
      if (buffered.length < 4 + size) break;
      const payload = buffered.subarray(4, 4 + size);
      buffered = buffered.subarray(4 + size);
      handle(JSON.parse(payload.toString("utf8")));
    }
  });
}
`;

function makeInitializeParams(): ProviderDriverInitializeParams {
  return providerDriverInitializeParamsSchema.parse({
    supportedProtocolVersions: [5],
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

function makeSessionOpenParams(): ProviderSessionOpenParams {
  return providerSessionOpenParamsSchema.parse({
    operationId: "open-1",
    attachmentId: "attachment-1",
    bbThreadId: "thread-1",
    mode: { kind: "start" },
    workspace: {
      cwd: "/tmp/workspace",
      additionalWriteRoots: [],
      threadStoragePath: "/tmp/thread-storage",
    },
    execution: {
      model: "fake/model",
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

function makeTurnSubmitParams(): ProviderTurnSubmitParams {
  return providerTurnSubmitParamsSchema.parse({
    operationId: "submit-1",
    clientRequestId: "creq_23456789ab",
    attachmentId: "attachment-1",
    mode: "start",
    turnId: "turn-1",
    inputGroups: [[{ type: "text", text: "Hello", mentions: [] }]],
    execution: makeSessionOpenParams().execution,
  });
}

describe("ProviderDriverSupervisor", () => {
  let directory: string;
  let scriptPath: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "bb-provider-driver-"));
    scriptPath = join(directory, "fake-driver.mjs");
    writeFileSync(scriptPath, FAKE_DRIVER_SOURCE);
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it("uses dedicated protocol fds and deduplicates launches by process key", async () => {
    const supervisor = new ProviderDriverSupervisor();
    const diagnostics: Array<{ stream: string; line: string }> = [];
    const launch = {
      processKey: "test-driver",
      initialize: makeInitializeParams(),
      launch: {
        command: process.execPath,
        args: [scriptPath],
        cwd: directory,
        env: {},
      },
      onDiagnostic: (diagnostic: { stream: string; line: string }) =>
        diagnostics.push(diagnostic),
    };

    const [first, second] = await Promise.all([
      supervisor.launch(launch),
      supervisor.launch(launch),
    ]);
    expect(first).toBe(second);
    await expect(
      first.connection.inspect({ cwd: null, operation: null }),
    ).resolves.toMatchObject({ readiness: { status: "ready" } });
    expect(diagnostics).toContainEqual({
      stream: "stdout",
      line: '{"jsonrpc":"2.0","method":"stdout-is-diagnostic"}',
    });
    expect(diagnostics).toContainEqual({
      stream: "stderr",
      line: "fake driver diagnostic",
    });

    await first.stop();
    const relaunched = await supervisor.launch(launch);
    expect(relaunched).not.toBe(first);

    await supervisor.shutdown();
  });

  it("bounds diagnostic floods without affecting protocol traffic", async () => {
    const supervisor = new ProviderDriverSupervisor();
    const diagnostics: Array<{ stream: string; line: string }> = [];
    const driver = await supervisor.launch({
      processKey: "diagnostic-driver",
      initialize: makeInitializeParams(),
      launch: {
        command: process.execPath,
        args: [scriptPath],
        cwd: directory,
        env: { FAKE_DRIVER_SCENARIO: "diagnostic-flood" },
      },
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });

    await expect(
      driver.connection.inspect({ cwd: null, operation: null }),
    ).resolves.toMatchObject({ readiness: { status: "ready" } });
    const stdoutDiagnostics = diagnostics.filter(
      (diagnostic) => diagnostic.stream === "stdout",
    );
    expect(stdoutDiagnostics).toHaveLength(1_001);
    expect(stdoutDiagnostics.at(-1)?.line).toContain("diagnostics truncated");

    await supervisor.shutdown();
  });

  it("runs an SDK-defined driver with acceptance buffering and replay", async () => {
    const supervisor = new ProviderDriverSupervisor();
    const driver = await supervisor.launch({
      processKey: "sdk-driver",
      initialize: makeInitializeParams(),
      launch: {
        command: process.execPath,
        args: ["--import", "tsx/esm", SDK_FAKE_DRIVER_PATH],
        cwd: process.cwd(),
        env: {},
      },
    });
    await expect(
      driver.connection.openSession(makeSessionOpenParams()),
    ).resolves.toMatchObject({ providerSessionId: "sdk-provider-session" });

    const event = new Promise<ProviderDriverEvent>((resolve) => {
      const unsubscribe = driver.connection.onEvent((received) => {
        unsubscribe();
        resolve(received);
      });
    });
    const submit = makeTurnSubmitParams();
    await expect(driver.connection.submitTurn(submit)).resolves.toMatchObject({
      outcome: "accepted",
      turnId: "turn-1",
    });
    await expect(event).resolves.toMatchObject({
      type: "turn.settled",
      turnId: "turn-1",
      sequence: 1,
    });
    await expect(driver.connection.submitTurn(submit)).resolves.toMatchObject({
      outcome: "accepted",
      turnId: "turn-1",
    });

    await supervisor.shutdown();
  });

  it("contains malformed framed traffic and terminates the driver", async () => {
    const supervisor = new ProviderDriverSupervisor();
    const onExit = vi.fn();
    const onProtocolError = vi.fn();

    await expect(
      supervisor.launch({
        processKey: "malformed-driver",
        initialize: makeInitializeParams(),
        launch: {
          command: process.execPath,
          args: [scriptPath],
          cwd: directory,
          env: { FAKE_DRIVER_SCENARIO: "oversized" },
        },
        onExit,
        onProtocolError,
        requestTimeoutMs: 1_000,
      }),
    ).rejects.toThrow();
    expect(onProtocolError).toHaveBeenCalledTimes(1);
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(onExit.mock.calls[0]?.[0]).toMatchObject({
      lifecycle: { activeAttachments: [] },
    });
    expect(onProtocolError.mock.calls[0]?.[0]).toMatchObject({
      message: expect.stringContaining("maximum"),
    });

    await supervisor.shutdown();
  });
});
