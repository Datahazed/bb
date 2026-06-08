import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  buildServerRestartCommand,
  buildStandaloneRuntimeEnv,
  buildStandaloneShellExports,
  cleanupStandaloneOrphans,
  createProject,
  createTestGitRepo,
  fetchLocalHost,
  killProcess,
  loadDotEnv,
  repoRoot,
  reservePort,
  resolveStandaloneParentPid,
  shellQuote,
  startQaServer,
  STANDALONE_INSTANCE_ENV,
  STANDALONE_PARENT_PID_ENV,
} from "../shared.js";

function parseArgs() {
  let format = "json";

  for (let index = 2; index < process.argv.length; index += 1) {
    const arg = process.argv[index];
    if (arg === "--format") {
      const nextArg = process.argv[index + 1];
      if (nextArg !== "env" && nextArg !== "json") {
        throw new Error(
          "Usage: pnpm --filter @bb/qa standalone:start --format json|env",
        );
      }
      format = nextArg;
      index += 1;
      continue;
    }

    throw new Error(
      "Usage: pnpm --filter @bb/qa standalone:start --format json|env",
    );
  }

  return { format };
}
async function main() {
  const { format } = parseArgs();
  await cleanupStandaloneOrphans();
  const envFile = await loadDotEnv();
  const instanceId = randomUUID();
  const parentPid = resolveStandaloneParentPid({
    env: process.env,
    fallbackPid: process.ppid,
  });

  const tmpRoot = await fs.mkdtemp(path.join(tmpdir(), "bb-standalone-"));
  const logsDir = path.join(tmpRoot, "logs");
  const dataDir = path.join(tmpRoot, "data");
  const projectRoot = path.join(tmpRoot, "repos", "test-project");
  const statePath = path.join(tmpRoot, "standalone-state.json");
  const serverLogPath = path.join(logsDir, "server.log");

  await fs.mkdir(logsDir, { recursive: true });
  await createTestGitRepo(projectRoot);

  const serverPort = await reservePort();
  const serverUrl = `http://127.0.0.1:${serverPort}`;

  let serverProcess;

  try {
    const standaloneBaseEnv = buildStandaloneRuntimeEnv({
      baseEnv: process.env,
      overrides: {
        [STANDALONE_INSTANCE_ENV]: instanceId,
        [STANDALONE_PARENT_PID_ENV]: String(parentPid),
      },
    });
    const qaServer = await startQaServer({
      dataDir,
      env: standaloneBaseEnv,
      logPath: serverLogPath,
      port: serverPort,
    });
    serverProcess = qaServer.process;
    if (!serverProcess) {
      throw new Error(
        "Standalone QA server unexpectedly reused an existing server",
      );
    }

    const host = await fetchLocalHost(serverUrl);
    const project = await createProject(serverUrl, {
      name: "Standalone QA Project",
      source: { type: "local_path", hostId: host.id, path: projectRoot },
    });

    const cleanupCommand =
      `pnpm --silent --dir ${shellQuote(repoRoot)} --filter @bb/qa standalone:stop ` +
      `--state ${shellQuote(statePath)} && ` +
      `pnpm --silent --dir ${shellQuote(repoRoot)} --filter @bb/qa standalone:cleanup`;
    const restartServerCommand = buildServerRestartCommand({
      dataDir,
      entrypoint: path.join(repoRoot, "apps/server/dist/index.js"),
      envFilePath: envFile.path,
      instanceId,
      logPath: serverLogPath,
      parentPid,
      serverPid: serverProcess.pid,
      serverPort,
      serverUrl,
    });

    const cliEnv = {
      BB_PROJECT_ID: project.id,
      BB_SERVER_URL: serverUrl,
    };

    const setupEnv = {
      ...cliEnv,
      CLEANUP_COMMAND: cleanupCommand,
      HOST_ID: host.id,
      LOGS_DIR: logsDir,
      PROJECT_ROOT: projectRoot,
      RESTART_SERVER_COMMAND: restartServerCommand,
      SERVER_PID: String(serverProcess.pid),
      STATE_PATH: statePath,
    };

    const state = {
      cliEnv,
      commands: {
        cleanup: cleanupCommand,
        restartServer: restartServerCommand,
      },
      instanceId,
      parentPid,
      paths: {
        dataDir,
        envFilePath: envFile.path,
        logsDir,
        projectRoot,
        statePath,
        tmpRoot,
      },
      project: {
        hostId: host.id,
        id: project.id,
      },
      server: {
        dataDir,
        logPath: serverLogPath,
        pid: serverProcess.pid,
        port: serverPort,
        url: serverUrl,
      },
    };

    await fs.writeFile(statePath, JSON.stringify(state, null, 2), "utf8");
    const output =
      format === "env"
        ? buildStandaloneShellExports(setupEnv)
        : JSON.stringify(state, null, 2);
    process.stdout.write(`${output}\n`);
  } catch (error) {
    await killProcess(serverProcess?.pid).catch(() => undefined);
    await fs.rm(tmpRoot, { recursive: true, force: true });
    throw error;
  }
}

void main().catch((error) => {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
