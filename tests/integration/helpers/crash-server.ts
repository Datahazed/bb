/**
 * Crash harness for the kill-9 boot-reconciliation suite: spawns the merged
 * server as a real child process (`crash-server-entry.ts`) against an
 * on-disk data dir, SIGKILLs it mid-flight, and restarts it against the same
 * state. The in-process `withHarness` cannot model this — a hard kill of the
 * test process is the test runner's death — so crash-restart is the one
 * scenario that runs out of process (plan §6 Phase 2, §8 kill-9 matrix).
 */
import { execFile as execFileCallback, spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { buildNodeScriptArgs } from "@bb/agent-runtime/test";
import { createPublicApiClient } from "@bb/server-contract";
import { removePathWithRetry } from "./remove-path.js";
import { createTestGitRepo, type TestRepoFile } from "./seed.js";
import { scaleTimeoutMs } from "./time.js";

const execFile = promisify(execFileCallback);

const READY_LINE_PREFIX = "CRASH_SERVER_READY ";
const READY_TIMEOUT_MS = scaleTimeoutMs(60_000);
const STDERR_TAIL_LIMIT = 50;

const entryPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "crash-server-entry.ts",
);

type PublicApiClient = ReturnType<typeof createPublicApiClient>;

export interface ServerChildProcessInfo {
  command: string;
  pid: number;
}

export interface CrashServerHarness {
  api: PublicApiClient;
  /** Always `'local'` — the single synthetic host (plan Decision 4). */
  hostId: string;
  repoDir: string;
  dataDir: string;
  serverPid: number;
  /** SIGKILLs the running server and waits for the process to exit. */
  crash(): Promise<void>;
  /** Boots a fresh server process against the same on-disk state. */
  restart(): Promise<void>;
  /** Direct children of the RUNNING server process (providers, ptys, setup shells). */
  listServerChildren(): Promise<ServerChildProcessInfo[]>;
  cleanup(): Promise<void>;
}

export interface CreateCrashServerHarnessOptions {
  /** Extra files committed into the test git repo (e.g. `.bb-env-setup.sh`). */
  repoFiles?: TestRepoFile[];
}

interface RunningCrashServer {
  baseUrl: string;
  child: ChildProcess;
  port: number;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function listChildProcesses(
  parentPid: number,
): Promise<ServerChildProcessInfo[]> {
  const { stdout } = await execFile("ps", [
    "-axo",
    "pid=,ppid=,command=",
  ]);
  const children: ServerChildProcessInfo[] = [];
  for (const line of stdout.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (!match) {
      continue;
    }
    const [, pidText, ppidText, command] = match;
    if (Number(ppidText) === parentPid && pidText && command) {
      children.push({ command, pid: Number(pidText) });
    }
  }
  return children;
}

export function isFakeProviderProcess(info: ServerChildProcessInfo): boolean {
  return info.command.includes("fake-provider-script");
}

/**
 * Polls until every pid is gone. Orphaned fake providers exit on their own
 * once their stdin pipe collapses (idle providers immediately; one with a
 * pending turn timer when the timer fires into the broken pipe).
 */
export async function waitForProcessesGone(
  pids: readonly number[],
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let alive = pids.filter(isProcessAlive);
  while (alive.length > 0) {
    if (Date.now() > deadline) {
      throw new Error(
        `Processes still alive after ${timeoutMs}ms: ${alive.join(", ")}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
    alive = alive.filter(isProcessAlive);
  }
}

async function waitForExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  await new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
  });
}

function spawnCrashServer(dataDir: string): {
  child: ChildProcess;
  ready: Promise<number>;
} {
  const child = spawn(
    process.execPath,
    buildNodeScriptArgs(entryPath),
    {
      env: {
        ...process.env,
        BB_CRASH_DATA_DIR: dataDir,
        BB_CRASH_SWEEP_INTERVAL_MS: "500",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  const stderrTail: string[] = [];
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => {
    for (const line of chunk.split("\n")) {
      if (!line.trim()) {
        continue;
      }
      stderrTail.push(line);
      if (stderrTail.length > STDERR_TAIL_LIMIT) {
        stderrTail.shift();
      }
    }
  });

  const ready = new Promise<number>((resolve, reject) => {
    let buffered = "";
    const timeout = setTimeout(() => {
      reject(
        new Error(
          `Crash server did not become ready within ${READY_TIMEOUT_MS}ms\n${stderrTail.join("\n")}`,
        ),
      );
    }, READY_TIMEOUT_MS);
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      buffered += chunk;
      const lines = buffered.split("\n");
      buffered = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith(READY_LINE_PREFIX)) {
          continue;
        }
        const payload: unknown = JSON.parse(
          line.slice(READY_LINE_PREFIX.length),
        );
        if (
          typeof payload === "object" &&
          payload !== null &&
          "port" in payload &&
          typeof payload.port === "number"
        ) {
          clearTimeout(timeout);
          resolve(payload.port);
          return;
        }
        clearTimeout(timeout);
        reject(new Error(`Malformed crash-server ready line: ${line}`));
        return;
      }
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      reject(
        new Error(
          `Crash server exited before ready (code ${code}, signal ${signal})\n${stderrTail.join("\n")}`,
        ),
      );
    });
  });

  return { child, ready };
}

async function startCrashServer(dataDir: string): Promise<RunningCrashServer> {
  const { child, ready } = spawnCrashServer(dataDir);
  const port = await ready;
  return { baseUrl: `http://127.0.0.1:${port}`, child, port };
}

export async function createCrashServerHarness(
  options: CreateCrashServerHarnessOptions = {},
): Promise<CrashServerHarness> {
  const tmpRoot = await fs.mkdtemp(path.join(tmpdir(), "bb-crash-"));
  const dataDir = path.join(tmpRoot, "data");
  await fs.mkdir(dataDir, { recursive: true });
  const repoDir = await createTestGitRepo({
    repoDir: path.join(tmpRoot, "repos", "test-project"),
    ...(options.repoFiles ? { files: options.repoFiles } : {}),
  });

  let running = await startCrashServer(dataDir);
  let api = createPublicApiClient(running.baseUrl);
  let cleanedUp = false;

  return {
    get api(): PublicApiClient {
      return api;
    },
    hostId: "local",
    repoDir,
    dataDir,
    get serverPid(): number {
      const pid = running.child.pid;
      if (!pid) {
        throw new Error("Crash server has no pid");
      }
      return pid;
    },
    async crash(): Promise<void> {
      running.child.kill("SIGKILL");
      await waitForExit(running.child);
    },
    async restart(): Promise<void> {
      running = await startCrashServer(dataDir);
      api = createPublicApiClient(running.baseUrl);
    },
    async listServerChildren(): Promise<ServerChildProcessInfo[]> {
      const pid = running.child.pid;
      if (!pid) {
        throw new Error("Crash server has no pid");
      }
      return listChildProcesses(pid);
    },
    async cleanup(): Promise<void> {
      if (cleanedUp) {
        return;
      }
      cleanedUp = true;
      const children = await listChildProcesses(
        running.child.pid ?? -1,
      ).catch(() => []);
      running.child.kill("SIGKILL");
      await waitForExit(running.child);
      // Reap stragglers the killed server cannot clean up itself.
      for (const child of children) {
        try {
          process.kill(child.pid, "SIGKILL");
        } catch {
          // Already gone.
        }
      }
      await removePathWithRetry(tmpRoot);
    },
  };
}

export async function withCrashServerHarness<T>(
  options: CreateCrashServerHarnessOptions,
  run: (harness: CrashServerHarness) => Promise<T>,
): Promise<T> {
  const harness = await createCrashServerHarness(options);
  try {
    return await run(harness);
  } finally {
    await harness.cleanup();
  }
}
