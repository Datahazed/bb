import { execFile as execFileCallback } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  buildServerRestartCommand,
  buildStandaloneRuntimeEnv,
  buildStandaloneShellExports,
  resolveStandaloneParentPid,
  STANDALONE_OPENAI_API_KEY_ENV,
  STANDALONE_PARENT_PID_ENV,
} from "../src/shared.js";

const RESTART_PROVIDER_ENV_BLOCK =
  'case "${BB_QA_OPENAI_API_KEY-}" in *[![:space:]]*) OPENAI_API_KEY="$BB_QA_OPENAI_API_KEY"; export OPENAI_API_KEY ;; *) unset OPENAI_API_KEY ;; esac';
const SERVER_ENV_BLOCK_PREFIX = "; BB_DATA_DIR=";

function buildTestRestartCommand(): string {
  return buildServerRestartCommand({
    dataDir: "/tmp/bb root",
    entrypoint: "/repo/apps/server/dist/index.js",
    envFilePath: "/repo/.env",
    instanceId: "instance-123",
    logPath: "/tmp/bb logs/server.log",
    parentPid: 789,
    serverPid: 123,
    serverPort: 3334,
    serverUrl: "http://127.0.0.1:3334",
  });
}

function extractProviderEnvBlock(command: string): string {
  const blockStart = command.indexOf(RESTART_PROVIDER_ENV_BLOCK);
  if (blockStart < 0) {
    throw new Error("restart command is missing provider env block");
  }
  const blockEnd = command.indexOf(SERVER_ENV_BLOCK_PREFIX, blockStart);
  if (blockEnd < 0) {
    throw new Error("restart command is missing server env block");
  }
  return command.slice(blockStart, blockEnd);
}

async function runRestartProviderEnvBlock(
  block: string,
  env: NodeJS.ProcessEnv,
): Promise<string> {
  const script =
    `${block}; ` +
    'if [ "${OPENAI_API_KEY+x}" = x ]; then printf \'set:%s\' "$OPENAI_API_KEY"; else printf unset; fi';
  return new Promise((resolve, reject) => {
    execFileCallback(
      "sh",
      ["-c", script],
      {
        encoding: "utf8",
        env: {
          PATH: process.env.PATH ?? "",
          ...env,
        },
      },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(stdout);
      },
    );
  });
}

function buildTestRestartProviderEnvBlock(): string {
  const block = extractProviderEnvBlock(buildTestRestartCommand());
  expect(block).toBe(RESTART_PROVIDER_ENV_BLOCK);
  return block;
}

describe("standalone restart command", () => {
  it("prefers a caller-provided parent pid for orphan cleanup ownership", () => {
    expect(
      resolveStandaloneParentPid({
        env: {
          [STANDALONE_PARENT_PID_ENV]: "4242",
        },
        fallbackPid: 1111,
      }),
    ).toBe(4242);
  });

  it("falls back to the current parent pid when the configured owner is absent", () => {
    expect(
      resolveStandaloneParentPid({
        env: {
          [STANDALONE_PARENT_PID_ENV]: "not-a-pid",
        },
        fallbackPid: 1111,
      }),
    ).toBe(1111);
  });

  it("clears inherited thread context from env-format setup output", () => {
    expect(
      buildStandaloneShellExports({
        BB_PROJECT_ID: "proj_standalone",
        BB_SERVER_URL: "http://127.0.0.1:3333",
      }).split("\n"),
    ).toEqual([
      "unset BB_THREAD_ID",
      "unset BB_ENVIRONMENT_ID",
      "unset BB_THREAD_STORAGE",
      "export BB_PROJECT_ID='proj_standalone'",
      "export BB_SERVER_URL='http://127.0.0.1:3333'",
    ]);
  });

  it("strips inherited thread context so the daemon derives its own storage root", () => {
    expect(
      buildStandaloneRuntimeEnv({
        baseEnv: {
          BB_ENVIRONMENT_ID: "env_parent",
          BB_THREAD_ID: "thr_parent",
          BB_THREAD_STORAGE: "/home/user/.bb/thread-storage/thr_parent",
          PATH: "/usr/bin",
        },
        overrides: {
          BB_DATA_DIR: "/tmp/standalone/bb-root",
        },
      }),
    ).toEqual({
      BB_DATA_DIR: "/tmp/standalone/bb-root",
      PATH: "/usr/bin",
    });
  });

  it("does not inherit OPENAI_API_KEY into standalone runtime env by default", () => {
    expect(
      buildStandaloneRuntimeEnv({
        baseEnv: {
          OPENAI_API_KEY: "ambient-openai-key",
          PATH: "/usr/bin",
        },
        overrides: {},
      }),
    ).toEqual({
      PATH: "/usr/bin",
    });
  });

  it("maps the QA OpenAI opt-in key into standalone runtime env", () => {
    expect(
      buildStandaloneRuntimeEnv({
        baseEnv: {
          OPENAI_API_KEY: "ambient-openai-key",
          PATH: "/usr/bin",
          [STANDALONE_OPENAI_API_KEY_ENV]: "qa-openai-key",
        },
        overrides: {},
      }),
    ).toEqual({
      OPENAI_API_KEY: "qa-openai-key",
      PATH: "/usr/bin",
      [STANDALONE_OPENAI_API_KEY_ENV]: "qa-openai-key",
    });
  });

  it("reloads the env file without embedding provider secrets", () => {
    const command = buildTestRestartCommand();

    expect(command).toContain("(kill '123' >/dev/null 2>&1 || true)");
    expect(command).toContain("[ ! -f '/repo/.env' ] || . '/repo/.env'");
    expect(command).toContain(RESTART_PROVIDER_ENV_BLOCK);
    expect(command).toContain("BB_DATA_DIR='/tmp/bb root'");
    expect(command).toContain("BB_SERVER_PORT='3334'");
    expect(command).toContain("BB_STANDALONE_INSTANCE='instance-123'");
    expect(command).toContain("BB_STANDALONE_PARENT_PID='789'");
    expect(command).toContain("exec node '/repo/apps/server/dist/index.js'");
    expect(command).toContain(">> '/tmp/bb logs/server.log' 2>&1) &");
    expect(command).toContain("'http://127.0.0.1:3334/api/v1/system/config'");
    expect(command).toContain('[ "$ready" = 1 ]');
    expect(command).not.toContain("&;");
    expect(command).not.toContain("do; if");
    expect(command).not.toContain("test-openai-key");
  });

  it("does not map whitespace-only QA OpenAI opt-in restart keys", async () => {
    await expect(
      runRestartProviderEnvBlock(buildTestRestartProviderEnvBlock(), {
        OPENAI_API_KEY: "ambient-openai-key",
        [STANDALONE_OPENAI_API_KEY_ENV]: " \t ",
      }),
    ).resolves.toBe("unset");
  });

  it("keeps OpenAI unset during restart when ambient and opt-in keys are absent", async () => {
    await expect(
      runRestartProviderEnvBlock(buildTestRestartProviderEnvBlock(), {}),
    ).resolves.toBe("unset");
  });

  it("maps a non-empty QA OpenAI opt-in key during restart", async () => {
    await expect(
      runRestartProviderEnvBlock(buildTestRestartProviderEnvBlock(), {
        OPENAI_API_KEY: "ambient-openai-key",
        [STANDALONE_OPENAI_API_KEY_ENV]: "qa-openai-key",
      }),
    ).resolves.toBe("set:qa-openai-key");
  });

  it("uses a no-op env loader when no env file exists", () => {
    const command = buildServerRestartCommand({
      dataDir: "/tmp/bb-data",
      entrypoint: "/repo/apps/server/dist/index.js",
      envFilePath: null,
      instanceId: "instance-123",
      logPath: "/tmp/server.log",
      parentPid: 789,
      serverPid: null,
      serverPort: 3334,
      serverUrl: "http://127.0.0.1:3334",
    });

    expect(command).toContain("(set -a; :; set +a;");
    expect(command).not.toContain("kill");
  });
});
