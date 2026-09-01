import path from "node:path";
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { createWorktree, removeWorktree } from "@bb/host-workspace";
import { worktreeHostContract } from "./contract.js";

const LIFECYCLE_SCRIPT_TIMEOUT_MS = 15 * 60 * 1000;

interface WorktreeHostDependencies {
  createWorktree: typeof createWorktree;
  removeWorktree: typeof removeWorktree;
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
        return deps.createWorktree({
          sourcePath,
          targetPath,
          branchName: `bb/${input.threadId}`,
          baseBranch:
            input.baseBranch.kind === "named" ? input.baseBranch.name : null,
          timeoutMs: LIFECYCLE_SCRIPT_TIMEOUT_MS,
          setupScriptName,
          pruneEmptyParent: true,
          signal: context.signal,
        });
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

export default createWorktreeHostEntry({ createWorktree, removeWorktree });
