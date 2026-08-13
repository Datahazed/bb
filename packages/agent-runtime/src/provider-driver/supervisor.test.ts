import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  providerDriverInitializeParamsSchema,
  type ProviderDriverInitializeParams,
} from "@bb/provider-driver-contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderDriverSupervisor } from "./supervisor.js";

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
        protocolVersion: 1,
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
    supportedProtocolVersions: [1],
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
