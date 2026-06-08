import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createTurboBuildCommand,
  resolveSupervisorPidPath,
} from "../lib/dev-restart-utils.js";
import { readRunningPid } from "../lib/pid-file.js";
import { runScriptProcess } from "../lib/process-helpers.js";

// The merged single-host dev topology runs one restartable service: the
// server (the app dev server hot-reloads itself; dev-env is the restart
// broker). The daemon target and its protocol-version escalation died with
// the two-process split (plans/single-host-rebuild.md §5.7).
type RestartTarget = "server";

interface ReadRunningSupervisorPidArgs {
  pidPath?: string;
  serviceName: string;
}

export function parseTarget(value: string): RestartTarget {
  if (value === "server") {
    return value;
  }

  throw new Error('Expected "server"');
}

export async function readRunningSupervisorPid(
  args: ReadRunningSupervisorPidArgs,
): Promise<number> {
  const pidPath = args.pidPath ?? resolveSupervisorPidPath(args.serviceName);
  return readRunningPid({
    pidPath,
    serviceName: args.serviceName,
  });
}

async function runBuild(filters: string[]): Promise<boolean> {
  const buildCommand = createTurboBuildCommand(filters);
  const exitCode = await runScriptProcess({
    args: buildCommand.args,
    command: buildCommand.command,
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });
  return exitCode === 0;
}

export async function main(
  argv: string[] = process.argv.slice(2),
): Promise<void> {
  const target = parseTarget(argv[0] ?? "server");
  const supervisorPid = await readRunningSupervisorPid({
    serviceName: target,
  });

  process.stdout.write(`[dev] Building ${target} before restart.\n`);
  const buildSucceeded = await runBuild(["@bb/server"]);
  if (!buildSucceeded) {
    process.exitCode = 1;
    return;
  }

  process.kill(supervisorPid, "SIGUSR1");
  process.stdout.write(`[dev] Requested ${target} restart.\n`);
}

if (
  process.argv[1] != null &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  void main().catch((error) => {
    const message =
      error instanceof Error ? (error.stack ?? error.message) : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
