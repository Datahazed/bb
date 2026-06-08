import type { HostDaemonCommandResult } from "../contract/commands.js";
import {
  type CommandDispatchOptions,
  type CommandOf,
} from "../core/command-dispatch-support.js";
import { requireResolvedWorkspaceForCommand } from "../core/workspace-resolution.js";

export async function squashMerge(
  command: CommandOf<"workspace.squash_merge">,
  options: CommandDispatchOptions,
): Promise<HostDaemonCommandResult<"workspace.squash_merge">> {
  const entry = await requireResolvedWorkspaceForCommand({
    dataDir: options.dataDir,
    environmentId: command.environmentId,
    requireGit: true,
    requireManagedWorktree: true,
    runtimeManager: options.runtimeManager,
    workspaceContext: command.workspaceContext,
  });
  const result = await entry.workspace.squashMerge({
    targetBranch: command.targetBranch,
    commitMessage: command.commitMessage,
  });
  return {
    merged: result.merged,
    commitSha: result.commitSha,
    commitSubject: result.commitSubject,
  };
}
