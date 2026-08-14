import { spawn } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { extract as extractTar } from "tar";
import {
  createProviderDriverSmokePeer,
  driverArtifactDigest,
} from "./provider-driver-smoke-peer.mjs";

const HTTP_WAIT_TIMEOUT_MS = 60_000;
const HTTP_WAIT_INTERVAL_MS = 250;
const PLUGIN_LOAD_TIMEOUT_MS = 60_000;
const PLUGIN_LOAD_INTERVAL_MS = 1_000;
// Auto-installed, default-enabled builtins (apps/server/src/services/plugins/
// builtin-registry.ts). Each must reach "running" in the packed tarball —
// bundles that pass health checks can still fail to load (0.0.31 shipped with
// every builtin unable to resolve @bb/plugin-sdk at import time).
const EXPECTED_RUNNING_BUILTIN_PLUGINS = [
  "acp",
  "automations",
  "claude-code",
  "codex",
  "connect",
  "custom-instructions",
  "inline-vis",
  "pi",
  "secrets",
];
const PROCESS_STOP_TIMEOUT_MS = 5_000;
const DEFAULT_HOST_DAEMON_LOCAL_BIND_HOST = "127.0.0.1";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptsDir, "..");
const piConfigExtensionFixturePath = resolve(
  scriptsDir,
  "fixtures",
  "pi-config-extension.ts",
);
const tempRoot = await mkdtemp(join(tmpdir(), "bb-app-tarball-"));
const smokeProcessEnv = {
  BB_TELEMETRY: "false",
};

function delay(ms) {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

function formatProcessOutput(output) {
  const sections = [];
  if (output.stdout.trim()) {
    sections.push(`stdout:\n${output.stdout}`);
  }
  if (output.stderr.trim()) {
    sections.push(`stderr:\n${output.stderr}`);
  }
  return sections.join("\n\n");
}

function collectProcessOutput(childProcess) {
  const output = {
    stderr: "",
    stdout: "",
  };
  childProcess.stdout?.on("data", (chunk) => {
    output.stdout += chunk.toString("utf8");
  });
  childProcess.stderr?.on("data", (chunk) => {
    output.stderr += chunk.toString("utf8");
  });
  return output;
}

function isRecord(value) {
  return typeof value === "object" && value !== null;
}

function waitForProcessExit(childProcess) {
  return new Promise((resolvePromise) => {
    childProcess.once("exit", (code, signal) => {
      resolvePromise({ code, signal });
    });
  });
}

async function runCommand({ args, command, cwd = tempRoot, env = {}, label }) {
  const childProcess = spawn(command, args, {
    cwd,
    env: {
      ...process.env,
      ...env,
      ...smokeProcessEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = collectProcessOutput(childProcess);
  const result = await waitForProcessExit(childProcess);
  if (result.code !== 0) {
    throw new Error(
      `${label} failed with ${result.code ?? result.signal}\n${formatProcessOutput(output)}`,
    );
  }
  return output.stdout;
}

function spawnManagedProcess({ args, command, env = {}, label }) {
  const detached = process.platform !== "win32";
  const childProcess = spawn(command, args, {
    cwd: tempRoot,
    detached,
    env: {
      ...process.env,
      ...env,
      ...smokeProcessEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = collectProcessOutput(childProcess);
  return {
    childProcess,
    detached,
    label,
    output,
  };
}

function reserveFreePort() {
  return new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(new Error("Expected TCP server address with a port"));
        return;
      }
      resolvePromise({ port: address.port, server });
    });
  });
}

async function getFreePorts(count) {
  const reservations = [];
  try {
    // Keep every listener open until the whole set is allocated. Closing each
    // one immediately lets the OS hand the same port to the next request.
    for (let index = 0; index < count; index += 1) {
      reservations.push(await reserveFreePort());
    }
    return reservations.map(({ port }) => port);
  } finally {
    await Promise.all(
      reservations.map(
        ({ server }) =>
          new Promise((resolvePromise, reject) => {
            server.close((error) => {
              if (error) {
                reject(error);
                return;
              }
              resolvePromise();
            });
          }),
      ),
    );
  }
}

async function waitForHttp({ label, processRef, url }) {
  const deadline = Date.now() + HTTP_WAIT_TIMEOUT_MS;
  while (Date.now() <= deadline) {
    if (
      processRef.childProcess.exitCode !== null ||
      processRef.childProcess.signalCode !== null
    ) {
      throw new Error(
        `${label} exited before ${url} became healthy\n${formatProcessOutput(processRef.output)}`,
      );
    }
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Retry until timeout.
    }
    await delay(HTTP_WAIT_INTERVAL_MS);
  }
  throw new Error(
    `Timed out waiting for ${label} at ${url}\n${formatProcessOutput(processRef.output)}`,
  );
}

async function stopManagedProcess(processRef) {
  if (processRef.detached) {
    try {
      process.kill(-processRef.childProcess.pid, "SIGINT");
    } catch (error) {
      if (
        !(error instanceof Error && "code" in error && error.code === "ESRCH")
      ) {
        throw error;
      }
    }
  }

  if (
    processRef.childProcess.exitCode !== null ||
    processRef.childProcess.signalCode !== null
  ) {
    return;
  }
  if (!processRef.detached) {
    processRef.childProcess.kill("SIGINT");
  }
  const stopped = await Promise.race([
    waitForProcessExit(processRef.childProcess).then(() => true),
    delay(PROCESS_STOP_TIMEOUT_MS).then(() => false),
  ]);
  if (!stopped) {
    if (processRef.detached) {
      process.kill(-processRef.childProcess.pid, "SIGTERM");
    } else {
      processRef.childProcess.kill("SIGTERM");
    }
    await waitForProcessExit(processRef.childProcess);
  }
}

function createNpxArgs(tarballPath, bin, args) {
  return ["--yes", "--package", tarballPath, "--", bin, ...args];
}

async function packTarball() {
  const stdout = await runCommand({
    args: ["pack", packageRoot, "--pack-destination", tempRoot, "--json"],
    command: "npm",
    label: "npm pack",
  });
  const packed = JSON.parse(stdout);
  if (!Array.isArray(packed) || packed.length !== 1) {
    throw new Error(`Unexpected npm pack output: ${stdout}`);
  }
  const [entry] = packed;
  if (
    typeof entry !== "object" ||
    entry === null ||
    !("filename" in entry) ||
    typeof entry.filename !== "string"
  ) {
    throw new Error(`Unexpected npm pack entry: ${stdout}`);
  }
  return join(tempRoot, entry.filename);
}

async function extractBuiltinProviderDriver(packageDir, pluginId, driverId) {
  const driverDir = join(
    packageDir,
    "server",
    "dist",
    "builtin-plugins",
    pluginId,
    "dist",
    "host",
    driverId,
  );
  const extractedDir = join(
    tempRoot,
    "installed-provider-drivers",
    pluginId,
    driverId,
  );
  await mkdir(extractedDir, { recursive: true });
  await extractTar({
    cwd: extractedDir,
    file: join(driverDir, "driver.tgz"),
    strict: true,
  });
  return join(extractedDir, "driver.ts");
}

async function smokeProviderDriverBundles(packageDir) {
  for (const driverId of ["acp", "claude-code", "codex", "pi"]) {
    const hostDriverDir = join(
      packageDir,
      "server",
      "dist",
      "builtin-plugins",
      driverId,
      "dist",
      "host",
      driverId,
    );
    await access(join(hostDriverDir, "driver.meta.json"));
    await access(join(hostDriverDir, "driver.tgz"));
  }
}

async function smokeCodexCanonicalDriver(packageDir) {
  const testRoot = join(tempRoot, "codex-canonical-driver");
  const workspaceDir = join(testRoot, "workspace");
  await mkdir(workspaceDir, { recursive: true });
  const label = "Codex installed-package canonical driver";
  const driverPath = await extractBuiltinProviderDriver(
    packageDir,
    "codex",
    "codex",
  );
  const childProcess = spawn(process.execPath, [driverPath], {
    cwd: workspaceDir,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe", "pipe", "pipe"],
  });
  const output = collectProcessOutput(childProcess);
  const peer = createProviderDriverSmokePeer({ childProcess, label, output });
  try {
    const initialized = await peer.request("driver.initialize", {
      supportedProtocolVersions: [peer.protocolVersion],
      expected: {
        pluginId: "codex",
        driverId: "codex",
        providerId: "codex",
        artifactDigest: await driverArtifactDigest(driverPath),
      },
      host: { platform: process.platform, architecture: process.arch },
      paths: { providerDataDir: join(testRoot, "provider-data") },
      config: {},
    });
    if (initialized.identity?.providerId !== "codex") {
      throw new Error(`${label} returned the wrong identity`);
    }
    const inspected = await peer.request("driver.inspect", {
      cwd: workspaceDir,
      operation: null,
    });
    if (
      inspected.readiness?.status !== "ready" &&
      inspected.readiness?.status !== "unavailable"
    ) {
      throw new Error(
        `${label} returned invalid readiness: ${JSON.stringify(inspected)}`,
      );
    }
    await peer.request("driver.shutdown", {});
  } finally {
    peer.close();
    if (childProcess.exitCode === null) childProcess.kill("SIGKILL");
  }
}

async function smokeClaudeCanonicalDriver(packageDir) {
  const testRoot = join(tempRoot, "claude-canonical-driver");
  const workspaceDir = join(testRoot, "workspace");
  await mkdir(workspaceDir, { recursive: true });
  const label = "Claude Code installed-package canonical driver";
  const driverPath = await extractBuiltinProviderDriver(
    packageDir,
    "claude-code",
    "claude-code",
  );
  const childProcess = spawn(process.execPath, [driverPath], {
    cwd: workspaceDir,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe", "pipe", "pipe"],
  });
  const output = collectProcessOutput(childProcess);
  const peer = createProviderDriverSmokePeer({ childProcess, label, output });
  try {
    const initialized = await peer.request("driver.initialize", {
      supportedProtocolVersions: [peer.protocolVersion],
      expected: {
        pluginId: "claude-code",
        driverId: "claude-code",
        providerId: "claude-code",
        artifactDigest: await driverArtifactDigest(driverPath),
      },
      host: { platform: process.platform, architecture: process.arch },
      paths: { providerDataDir: join(testRoot, "provider-data") },
      config: {},
    });
    if (initialized.identity?.providerId !== "claude-code") {
      throw new Error(`${label} returned the wrong identity`);
    }
    const inspected = await peer.request("driver.inspect", {
      cwd: workspaceDir,
      operation: null,
    });
    if (
      inspected.readiness?.status !== "ready" &&
      inspected.readiness?.status !== "unavailable"
    ) {
      throw new Error(
        `${label} returned invalid readiness: ${JSON.stringify(inspected)}`,
      );
    }
    await peer.request("driver.shutdown", {});
  } finally {
    peer.close();
    if (childProcess.exitCode === null) childProcess.kill("SIGKILL");
  }
}

async function smokeAcpCanonicalDriver(packageDir) {
  const testRoot = join(tempRoot, "acp-canonical-driver");
  const workspaceDir = join(testRoot, "workspace");
  await mkdir(workspaceDir, { recursive: true });
  const label = "ACP installed-package canonical driver";
  const driverPath = await extractBuiltinProviderDriver(
    packageDir,
    "acp",
    "acp",
  );
  const childProcess = spawn(process.execPath, [driverPath], {
    cwd: workspaceDir,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe", "pipe", "pipe"],
  });
  const output = collectProcessOutput(childProcess);
  const peer = createProviderDriverSmokePeer({ childProcess, label, output });
  try {
    const initialized = await peer.request("driver.initialize", {
      supportedProtocolVersions: [peer.protocolVersion],
      expected: {
        pluginId: "acp",
        driverId: "acp",
        providerId: "acp",
        artifactDigest: await driverArtifactDigest(driverPath),
      },
      host: { platform: process.platform, architecture: process.arch },
      paths: { providerDataDir: join(testRoot, "provider-data") },
      config: {
        displayName: "ACP smoke agent",
        command: process.execPath,
        args: [
          join(
            import.meta.dirname,
            "..",
            "..",
            "agent-runtime",
            "src",
            "acp",
            "fake-acp-agent.mjs",
          ),
        ],
        env: {},
      },
    });
    if (initialized.identity?.providerId !== "acp") {
      throw new Error(`${label} returned the wrong identity`);
    }
    const inspected = await peer.request("driver.inspect", {
      cwd: workspaceDir,
      operation: null,
    });
    if (inspected.readiness?.status !== "ready") {
      throw new Error(
        `${label} returned invalid readiness: ${JSON.stringify(inspected)}`,
      );
    }
    await peer.request("driver.shutdown", {});
  } finally {
    peer.close();
    if (childProcess.exitCode === null) childProcess.kill("SIGKILL");
  }
}

async function smokePiUserConfiguration(packageDir) {
  const testRoot = join(tempRoot, "pi-user-config");
  const agentDir = join(testRoot, "agent");
  const workspaceDir = join(testRoot, "workspace");
  const maintenanceDir = join(testRoot, "provider-maintenance-workspace");
  const projectConfigDir = join(workspaceDir, ".pi");
  const extensionPath = join(testRoot, "configured-extension.ts");
  const sessionMarkerPath = join(testRoot, "session-marker.json");
  const toolMarkerPath = join(testRoot, "tool-marker.txt");
  const threadStoragePath = join(testRoot, "thread-storage");
  await mkdir(agentDir, { recursive: true });
  await mkdir(projectConfigDir, { recursive: true });
  await mkdir(maintenanceDir, { recursive: true });
  await mkdir(threadStoragePath, { recursive: true });
  const trustedWorkspaceDir = await realpath(workspaceDir);
  await writeFile(
    extensionPath,
    await readFile(piConfigExtensionFixturePath, "utf8"),
  );
  await writeFile(
    join(agentDir, "settings.json"),
    JSON.stringify({ defaultProjectTrust: "ask" }, null, 2),
  );
  await writeFile(
    join(agentDir, "trust.json"),
    JSON.stringify({ [trustedWorkspaceDir]: true }, null, 2),
  );
  await writeFile(
    join(projectConfigDir, "settings.json"),
    JSON.stringify(
      {
        defaultModel: "bb-config-e2e-model",
        defaultProvider: "bb-config-e2e",
        defaultThinkingLevel: "high",
        extensions: [extensionPath],
      },
      null,
      2,
    ),
  );

  const label = "Pi installed-package canonical driver E2E";
  const driverPath = await extractBuiltinProviderDriver(packageDir, "pi", "pi");
  const childProcess = spawn(process.execPath, [driverPath], {
    cwd: maintenanceDir,
    env: {
      ...process.env,
      BB_PI_DRIVER_SESSION_DIR: join(testRoot, "sessions"),
      BB_PI_E2E_SESSION_MARKER: sessionMarkerPath,
      BB_PI_E2E_TOOL_MARKER: toolMarkerPath,
      PI_CODING_AGENT_DIR: agentDir,
      PI_OFFLINE: "1",
    },
    // Node's fs stream wrappers require bidirectional pipe handles even though
    // the canonical protocol assigns one direction to each fd.
    stdio: ["ignore", "pipe", "pipe", "pipe", "pipe"],
  });
  const output = collectProcessOutput(childProcess);
  const peer = createProviderDriverSmokePeer({ childProcess, label, output });

  try {
    const initialized = await peer.request("driver.initialize", {
      supportedProtocolVersions: [peer.protocolVersion],
      expected: {
        pluginId: "pi",
        driverId: "pi",
        providerId: "pi",
        artifactDigest: await driverArtifactDigest(driverPath),
      },
      host: { platform: process.platform, architecture: process.arch },
      paths: { providerDataDir: join(testRoot, "provider-data") },
      config: {},
    });
    if (initialized.identity?.providerId !== "pi") {
      throw new Error(`${label} returned the wrong identity`);
    }

    const inspected = await peer.request("driver.inspect", {
      cwd: workspaceDir,
      operation: null,
    });
    if (
      !Array.isArray(inspected.models) ||
      !inspected.models.some(
        (model) => model.id === "bb-config-e2e/bb-config-e2e-model",
      )
    ) {
      throw new Error(
        `${label} did not add the extension provider to discovery: ${JSON.stringify(inspected)}`,
      );
    }

    const execution = {
      model: "bb-config-e2e/bb-config-e2e-model",
      reasoningLevel: "high",
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
    };
    await peer.request("session.open", {
      operationId: "op-pi-smoke-open",
      attachmentId: "attachment-pi-smoke",
      bbThreadId: "pi-config-e2e-thread",
      mode: { kind: "start" },
      workspace: {
        cwd: workspaceDir,
        additionalWriteRoots: [],
        threadStoragePath,
      },
      execution,
      instructions: { mode: "append", text: "" },
      skillSources: [],
      dynamicTools: [
        {
          name: "bb_dynamic_tool",
          description: "A tool provided by BB.",
          inputSchema: {
            type: "object",
            properties: { value: { type: "string" } },
            required: ["value"],
          },
          statusLabels: null,
        },
      ],
      disallowedTools: [],
      outputSchema: null,
      shellEnvironment: {},
    });

    const toolRequest = peer.handleHostRequests(async (message) => {
      if (
        message.method !== "host.tool.call" ||
        message.params.tool !== "bb_dynamic_tool" ||
        message.params.arguments?.value !== "BB tool input"
      ) {
        throw new Error(`${label} received invalid host request`);
      }
      return {
        success: true,
        content: [{ type: "text", text: "BB tool result" }],
      };
    });
    await peer.request("turn.submit", {
      operationId: "op-pi-smoke-turn",
      clientRequestId: "creq_23456789ab",
      attachmentId: "attachment-pi-smoke",
      mode: "start",
      turnId: "turn-pi-smoke",
      inputGroups: [
        [{ type: "text", text: "Run both configured tools.", mentions: [] }],
      ],
      execution,
    });
    await toolRequest;
    await peer.waitFor({
      predicate: (event) =>
        event.type === "turn.settled" && event.turnId === "turn-pi-smoke",
    });

    const completedTools = peer.notifications
      .filter((event) => event.type === "item.completed")
      .map((event) => event.item?.tool)
      .filter(Boolean);
    if (
      !completedTools.includes("configured_tool") ||
      !completedTools.includes("bb_dynamic_tool")
    ) {
      throw new Error(`${label} did not complete both tools`);
    }

    const sessionMarker = JSON.parse(await readFile(sessionMarkerPath, "utf8"));
    if (
      sessionMarker.provider !== "bb-config-e2e" ||
      sessionMarker.model !== "bb-config-e2e-model" ||
      sessionMarker.thinkingLevel !== "high"
    ) {
      throw new Error(
        `${label} did not apply project settings: ${JSON.stringify(sessionMarker)}`,
      );
    }
    if ((await readFile(toolMarkerPath, "utf8")) !== "extension tool input") {
      throw new Error(`${label} did not execute the configured extension tool`);
    }

    await peer.request("session.detach", {
      operationId: "op-pi-smoke-detach",
      attachmentId: "attachment-pi-smoke",
    });
    await peer.request("driver.shutdown", {});
  } finally {
    peer.close();
    if (childProcess.exitCode === null && childProcess.signalCode === null) {
      const exited = await Promise.race([
        waitForProcessExit(childProcess).then(() => true),
        delay(PROCESS_STOP_TIMEOUT_MS).then(() => false),
      ]);
      if (!exited) {
        childProcess.kill("SIGTERM");
        await waitForProcessExit(childProcess);
      }
    }
  }
}

async function smokeHelpCommands(tarballPath) {
  await runCommand({
    args: createNpxArgs(tarballPath, "bb-app", ["--help"]),
    command: "npx",
    label: "bb-app help",
  });
  await runCommand({
    args: createNpxArgs(tarballPath, "bb", ["--help"]),
    command: "npx",
    label: "bb cli help",
  });
  await runCommand({
    args: createNpxArgs(tarballPath, "bb-server", ["--help"]),
    command: "npx",
    label: "bb-server help",
  });
  await runCommand({
    args: createNpxArgs(tarballPath, "bb-host-daemon", ["--help"]),
    command: "npx",
    label: "bb-host-daemon help",
  });
}

async function smokeConfigCommand(tarballPath) {
  const dataDir = join(tempRoot, "config-command-data");
  await runCommand({
    args: createNpxArgs(tarballPath, "bb-app", [
      "--data-dir",
      dataDir,
      "env",
      "set",
      "OPENAI_API_KEY",
      "test-openai-key",
    ]),
    command: "npx",
    label: "bb-app env OPENAI_API_KEY",
  });
  await runCommand({
    args: createNpxArgs(tarballPath, "bb-app", [
      "--data-dir",
      dataDir,
      "config",
      "set",
      "BB_APP_URL",
      "https://bb.example.test",
    ]),
    command: "npx",
    label: "bb-app config BB_APP_URL",
  });

  const configJson = JSON.parse(
    await readFile(join(dataDir, "config.json"), "utf8"),
  );
  const envJson = JSON.parse(await readFile(join(dataDir, "env.json"), "utf8"));
  if (envJson.env?.OPENAI_API_KEY !== "test-openai-key") {
    throw new Error("Expected bb-app env to persist OPENAI_API_KEY");
  }
  if (configJson.config?.BB_APP_URL !== "https://bb.example.test") {
    throw new Error("Expected bb-app config to persist BB_APP_URL");
  }
}

async function smokeSdkPackage(tarballPath) {
  const sdkDir = join(tempRoot, "sdk-import");
  await mkdir(sdkDir, { recursive: true });
  await writeFile(
    join(sdkDir, "package.json"),
    JSON.stringify({ type: "module", private: true }, null, 2),
  );
  await runCommand({
    args: [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      tarballPath,
    ],
    command: "npm",
    cwd: sdkDir,
    label: "install bb-app SDK smoke package",
  });
  await runCommand({
    args: [
      "--input-type=module",
      "-e",
      'import { BBSdk } from "bb-app"; if (typeof BBSdk !== "function") process.exit(1);',
    ],
    command: "node",
    cwd: sdkDir,
    label: "bb-app SDK JavaScript import",
  });
  await writeFile(
    join(sdkDir, "sdk-smoke.ts"),
    [
      'import { BBSdk, BbHttpError } from "bb-app";',
      "",
      'const bb = new BBSdk({ baseUrl: "http://127.0.0.1:38886" });',
      "const error: typeof BbHttpError = BbHttpError;",
      "void bb.status.get();",
      "void error;",
      "",
    ].join("\n"),
  );
  await runCommand({
    args: [
      "--yes",
      "--package",
      "typescript",
      "--",
      "tsc",
      "--module",
      "NodeNext",
      "--moduleResolution",
      "NodeNext",
      "--target",
      "ES2022",
      "--noEmit",
      "sdk-smoke.ts",
    ],
    command: "npx",
    cwd: sdkDir,
    label: "bb-app SDK TypeScript import",
  });
  return sdkDir;
}

async function smokeBuiltinPluginsRunning({ cliEnv, tarballPath }) {
  const deadline = Date.now() + PLUGIN_LOAD_TIMEOUT_MS;
  let lastSummary = "no plugin list output yet";
  // Plugins load after the HTTP server starts listening, so poll until every
  // expected builtin settles into "running".
  while (Date.now() <= deadline) {
    const stdout = await runCommand({
      args: createNpxArgs(tarballPath, "bb", ["plugin", "list", "--json"]),
      command: "npx",
      env: cliEnv,
      label: "bb plugin list",
    });
    const plugins = JSON.parse(stdout).plugins ?? [];
    const byId = new Map(plugins.map((plugin) => [plugin.id, plugin]));
    const errored = plugins.filter((plugin) => plugin.status === "error");
    if (errored.length > 0) {
      throw new Error(
        `Builtin plugins failed to load:\n${errored
          .map((plugin) => `- ${plugin.id}: ${plugin.statusDetail}`)
          .join("\n")}`,
      );
    }
    const pending = EXPECTED_RUNNING_BUILTIN_PLUGINS.filter(
      (id) => byId.get(id)?.status !== "running",
    );
    if (pending.length === 0) {
      return;
    }
    lastSummary = pending
      .map((id) => `${id}=${byId.get(id)?.status ?? "missing"}`)
      .join(", ");
    await delay(PLUGIN_LOAD_INTERVAL_MS);
  }
  throw new Error(
    `Timed out waiting for builtin plugins to run: ${lastSummary}`,
  );
}

async function smokeFullStack(tarballPath, sdkDir) {
  const dataDir = join(tempRoot, "full-stack-data");
  const [serverPort, daemonPort] = await getFreePorts(2);
  const serverUrl = `http://127.0.0.1:${serverPort}`;
  const stack = spawnManagedProcess({
    args: createNpxArgs(tarballPath, "bb-app", [
      "--data-dir",
      dataDir,
      "--server-port",
      String(serverPort),
      "--host-daemon-port",
      String(daemonPort),
    ]),
    command: "npx",
    env: {
      BB_LOG_LEVEL: "warn",
    },
    label: "bb-app full stack",
  });

  try {
    await waitForHttp({
      label: stack.label,
      processRef: stack,
      url: `${serverUrl}/health`,
    });
    await waitForHttp({
      label: stack.label,
      processRef: stack,
      url: `http://${DEFAULT_HOST_DAEMON_LOCAL_BIND_HOST}:${daemonPort}/health`,
    });
    const cliEnv = {
      BB_DATA_DIR: dataDir,
      BB_HOST_DAEMON_PORT: String(daemonPort),
      BB_SERVER_URL: serverUrl,
    };
    await runCommand({
      args: createNpxArgs(tarballPath, "bb", ["status"]),
      command: "npx",
      env: cliEnv,
      label: "bb cli status",
    });
    await smokeBuiltinPluginsRunning({ cliEnv, tarballPath });
    await runCommand({
      args: [
        "--input-type=module",
        "-e",
        [
          'import { BBSdk } from "bb-app";',
          "const bb = new BBSdk({ baseUrl: process.env.BB_SERVER_URL });",
          "await bb.status.get();",
          "const providers = await bb.providers.list();",
          'if (providers.filter(({ id }) => id === "pi").length !== 1) throw new Error("Pi provider plugin was not registered exactly once");',
          'const options = await bb.providers.models({ providerId: "pi" });',
          'if (!options.providers.some(({ id }) => id === "pi")) throw new Error("Pi provider model discovery did not return Pi");',
        ].join("\n"),
      ],
      command: "node",
      cwd: sdkDir,
      env: {
        BB_SERVER_URL: serverUrl,
      },
      label: "bb-app SDK provider artifact execution",
    });
    const cachedProviderArtifacts = await readdir(
      join(dataDir, "provider-drivers", "artifacts"),
    );
    if (cachedProviderArtifacts.length === 0) {
      throw new Error(
        "Provider model discovery did not populate the daemon artifact cache",
      );
    }
  } finally {
    await stopManagedProcess(stack);
  }
}

async function smokeDaemonJoin(tarballPath) {
  const serverDataDir = join(tempRoot, "join-server-data");
  const daemonDataDir = join(tempRoot, "join-daemon-data");
  const [serverPort, daemonPort, staleEnvPort] = await getFreePorts(3);
  const serverUrl = `http://127.0.0.1:${serverPort}`;
  const staleEnvServerUrl = `http://127.0.0.1:${staleEnvPort}`;
  const server = spawnManagedProcess({
    args: createNpxArgs(tarballPath, "bb-server", [
      "--data-dir",
      serverDataDir,
      "--server-port",
      String(serverPort),
      "--host-daemon-port",
      String(daemonPort),
    ]),
    command: "npx",
    env: {
      BB_LOG_LEVEL: "warn",
    },
    label: "bb-server",
  });

  let daemon;
  try {
    await waitForHttp({
      label: server.label,
      processRef: server,
      url: `${serverUrl}/health`,
    });
    daemon = spawnManagedProcess({
      args: createNpxArgs(tarballPath, "bb-app", [
        "host-daemon",
        "join",
        "--data-dir",
        daemonDataDir,
        "--server-url",
        serverUrl,
        "--host-daemon-port",
        String(daemonPort),
      ]),
      command: "npx",
      env: {
        BB_LOG_LEVEL: "warn",
        BB_SERVER_URL: staleEnvServerUrl,
      },
      label: "bb-app host-daemon join",
    });
    await waitForHttp({
      label: daemon.label,
      processRef: daemon,
      url: `http://${DEFAULT_HOST_DAEMON_LOCAL_BIND_HOST}:${daemonPort}/health`,
    });
    const configJson = JSON.parse(
      await readFile(join(daemonDataDir, "config.json"), "utf8"),
    );
    if (configJson.serverUrl !== serverUrl) {
      throw new Error(
        `Expected persisted server URL ${serverUrl}, received ${configJson.serverUrl}`,
      );
    }
  } finally {
    if (daemon) {
      await stopManagedProcess(daemon);
    }
    await stopManagedProcess(server);
  }
}

try {
  const tarballPath = await packTarball();
  await smokeHelpCommands(tarballPath);
  await smokeConfigCommand(tarballPath);
  const sdkDir = await smokeSdkPackage(tarballPath);
  const installedPackageDir = join(sdkDir, "node_modules", "bb-app");
  await smokeProviderDriverBundles(installedPackageDir);
  await smokeCodexCanonicalDriver(installedPackageDir);
  await smokeClaudeCanonicalDriver(installedPackageDir);
  await smokeAcpCanonicalDriver(installedPackageDir);
  await smokePiUserConfiguration(installedPackageDir);
  await smokeFullStack(tarballPath, sdkDir);
  await smokeDaemonJoin(tarballPath);
  process.stdout.write("bb-app tarball smoke passed\n");
} finally {
  await rm(tempRoot, { force: true, recursive: true });
}
