import path from "node:path";

interface ResolvePersonalTargetPathArgs {
  dataDir: string;
  environmentId: string;
}

export function resolvePersonalTargetPath(
  args: ResolvePersonalTargetPathArgs,
): string {
  return path.posix.join(
    args.dataDir,
    "personal-workspaces",
    args.environmentId,
  );
}

export function isBbManagedWorkspacePath(args: {
  dataDir: string;
  path: string;
}): boolean {
  return [
    path.posix.join(args.dataDir, "worktrees"),
    path.posix.join(args.dataDir, "personal-workspaces"),
  ].some((root) => args.path === root || args.path.startsWith(`${root}/`));
}
