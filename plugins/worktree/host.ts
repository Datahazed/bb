import fs from "node:fs/promises";
import path from "node:path";
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { createWorktree, removeWorktree, runGit } from "@bb/host-workspace";
import { BRANCH_EXISTS_ERROR_MARKER, worktreeHostContract } from "./contract.js";

const LIFECYCLE_SCRIPT_TIMEOUT_MS = 15 * 60 * 1000;
const LOG_MAX_CHARS = 16_384;

interface BranchExistsArgs {
  sourcePath: string;
  branchName: string;
  signal: AbortSignal;
}

interface WorktreeHostDependencies {
  createWorktree: typeof createWorktree;
  removeWorktree: typeof removeWorktree;
  branchExists: (args: BranchExistsArgs) => Promise<boolean>;
}

async function branchExistsInSource(args: BranchExistsArgs): Promise<boolean> {
  const result = await runGit(
    ["rev-parse", "--verify", "--quiet", `refs/heads/${args.branchName}`],
    { cwd: args.sourcePath, allowFailure: true, signal: args.signal },
  );
  return result.exitCode === 0;
}

async function pathExists(candidate: string): Promise<boolean> {
  try {
    await fs.stat(candidate);
    return true;
  } catch {
    return false;
  }
}

function resolveScriptName(workspacePath: string, script: string): string {
  const root = path.resolve(workspacePath);
  const resolved = path.resolve(root, script);
  if (!resolved.startsWith(root + path.sep)) {
    throw new Error(`Script path escapes the worktree root: ${script}`);
  }
  return path.relative(root, resolved);
}

export function createWorktreeHostEntry(deps: WorktreeHostDependencies) {
  return experimental_defineHostEntry({
    contract: worktreeHostContract,
    handlers: {
      async create(input, context) {
        const sourcePath = path.resolve(input.sourcePath);
        const targetPath = path.join(
          context.experimental_paths.dataDir,
          "worktrees",
          input.threadId,
          path.basename(sourcePath),
        );
        const setupScriptName = resolveScriptName(
          targetPath,
          input.setupScript,
        );
        if (
          !(await pathExists(targetPath)) &&
          (await deps.branchExists({
            sourcePath,
            branchName: input.branchName,
            signal: context.signal,
          }))
        ) {
          throw new Error(
            `${BRANCH_EXISTS_ERROR_MARKER}: branch ${input.branchName} already exists in ${sourcePath}`,
          );
        }
        const logLines: string[] = [];
        const { path: createdPath } = await deps.createWorktree({
          sourcePath,
          targetPath,
          branchName: input.branchName,
          baseBranch:
            input.baseBranch.kind === "named" ? input.baseBranch.name : null,
          timeoutMs: LIFECYCLE_SCRIPT_TIMEOUT_MS,
          setupScriptName,
          pruneEmptyParent: true,
          signal: context.signal,
          onProgress: (entry) => {
            if (entry.text.length > 0) {
              logLines.push(entry.text);
            }
          },
        });
        return {
          path: createdPath,
          log: logLines.join("\n").slice(-LOG_MAX_CHARS),
        };
      },
      async teardown(input) {
        const teardownScriptName = resolveScriptName(
          input.path,
          input.teardownScript,
        );
        await deps.removeWorktree({
          path: input.path,
          timeoutMs: LIFECYCLE_SCRIPT_TIMEOUT_MS,
          teardownScriptName,
          force: true,
          pruneEmptyParent: true,
        });
        return null;
      },
    },
  });
}

export default createWorktreeHostEntry({
  createWorktree,
  removeWorktree,
  branchExists: branchExistsInSource,
});
