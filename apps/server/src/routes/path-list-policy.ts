import type { PathListPolicy } from "@bb/host-daemon-contract";
import type { PathListIncludeQueryValue } from "@bb/server-contract";

/**
 * Product policy for listing a workspace (quick-open, @-mentions, file trees,
 * `bb file paths`): dot paths are real files the user can open, so they are
 * listed; `node_modules` never is; and a git worktree is listed through its
 * own ignore rules so `.venv`, `.next`, `.turbo` and friends stay out of the
 * walk. Filled in once here and sent explicitly to the daemon.
 */
const WORKSPACE_PATH_LIST_EXCLUDE_NAMES: readonly string[] = ["node_modules"];

interface WorkspacePathListPolicyArgs {
  /** Caller override; omitted means the product default (hidden paths shown). */
  includeHidden: boolean | undefined;
}

export function workspacePathListPolicy(
  args: WorkspacePathListPolicyArgs,
): PathListPolicy {
  return {
    includeHidden: args.includeHidden ?? true,
    excludeNames: [...WORKSPACE_PATH_LIST_EXCLUDE_NAMES],
    respectGitignore: true,
  };
}

/**
 * Thread storage is a bb-owned directory under the server data dir, not a
 * workspace: gitignore semantics do not apply to it, so it always takes the
 * capped disk walk.
 */
export function threadStoragePathListPolicy(): PathListPolicy {
  return {
    includeHidden: true,
    excludeNames: [...WORKSPACE_PATH_LIST_EXCLUDE_NAMES],
    respectGitignore: false,
  };
}

export function parseIncludeHiddenQueryValue(
  value: PathListIncludeQueryValue | undefined,
): boolean | undefined {
  return value === undefined ? undefined : value === "true";
}
