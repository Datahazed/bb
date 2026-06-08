import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { z } from "zod";

const execFileAsync = promisify(execFile);

// The merged single-host dev topology has one restartable service: the
// server (plans/single-host-rebuild.md §5.7). The app dev server hot-reloads
// itself and dev-env is the restart broker.
export const devServiceNameValues = ["server"] as const;
export type DevServiceName = (typeof devServiceNameValues)[number];
export type RestartTarget = DevServiceName;

interface ComputeServiceFingerprintArgs {
  repoRoot: string;
  serviceName: DevServiceName;
}

interface FindJsonObjectResult {
  end: number;
  start: number;
}

const servicePackageNames: Record<DevServiceName, string> = {
  server: "@bb/server",
};

const turboDryRunSchema = z.object({
  tasks: z.array(
    z.object({
      hash: z.string().min(1),
      taskId: z.string().min(1),
    }),
  ),
});

function findJsonObject(rawOutput: string): FindJsonObjectResult {
  const start = rawOutput.indexOf("{");
  if (start < 0) {
    throw new Error("Turbo dry-run did not return JSON output");
  }

  let depth = 0;
  let escaped = false;
  let inString = false;
  for (let index = start; index < rawOutput.length; index += 1) {
    const character = rawOutput[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        return { end: index + 1, start };
      }
    }
  }

  throw new Error("Turbo dry-run JSON output was incomplete");
}

function extractJsonObject(rawOutput: string): string {
  const location = findJsonObject(rawOutput);
  return rawOutput.slice(location.start, location.end);
}

export function parseTurboFingerprint(rawOutput: string): string {
  const parsed = turboDryRunSchema.parse(
    JSON.parse(extractJsonObject(rawOutput)),
  );

  const hash = createHash("sha256");
  for (const task of parsed.tasks.sort((left, right) =>
    left.taskId.localeCompare(right.taskId),
  )) {
    hash.update(task.taskId);
    hash.update("\0");
    hash.update(task.hash);
    hash.update("\0");
  }
  return hash.digest("hex");
}

export async function computeServiceFingerprint(
  args: ComputeServiceFingerprintArgs,
): Promise<string> {
  const result = await execFileAsync(
    "pnpm",
    [
      "exec",
      "turbo",
      "run",
      "build",
      "--filter",
      servicePackageNames[args.serviceName],
      "--dry-run=json",
      "--summarize=false",
      "--no-update-notifier",
      "--log-prefix=none",
      "--output-logs=none",
    ],
    {
      cwd: args.repoRoot,
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
    },
  );
  return parseTurboFingerprint(result.stdout);
}
