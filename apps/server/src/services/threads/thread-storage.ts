import path from "node:path";
import type { WorkSessionDeps } from "../../types.js";

export interface ResolveThreadStorageRootPathArgs {
  dataDir: string;
  env?: NodeJS.ProcessEnv;
}

export interface RequireThreadStoragePathArgs {
  threadId: string;
}

export interface ResolveThreadStoragePathFromRootArgs {
  threadId: string;
  threadStorageRootPath: string;
}

export interface ThreadStorageContext {
  dataDir: string;
  threadStoragePath: string;
}

const THREAD_STORAGE_ENV_VAR = "BB_THREAD_STORAGE";

export function resolveThreadStorageRootPath(
  args: ResolveThreadStorageRootPathArgs,
): string {
  const env = args.env ?? process.env;
  const configuredRoot = env[THREAD_STORAGE_ENV_VAR];
  if (configuredRoot && configuredRoot.trim().length > 0) {
    return path.resolve(configuredRoot);
  }
  return path.join(args.dataDir, "thread-storage");
}

export function resolveThreadStoragePathFromRoot(
  args: ResolveThreadStoragePathFromRootArgs,
): string {
  return path.join(args.threadStorageRootPath, args.threadId);
}

/**
 * Thread storage lives in the server's own data dir now (plan §3 — server and
 * daemon data dirs merged): the daemon-session indirection (resolve the
 * connected daemon, read ITS dataDir) died with the transport. The root here
 * is the same `config.threadStorageRootPath` the engine watches and writes.
 */
export function requireThreadStorageContext(
  deps: Pick<WorkSessionDeps, "config">,
  args: RequireThreadStoragePathArgs,
): ThreadStorageContext {
  return {
    dataDir: deps.config.dataDir,
    threadStoragePath: resolveThreadStoragePathFromRoot({
      threadStorageRootPath: deps.config.threadStorageRootPath,
      threadId: args.threadId,
    }),
  };
}

export function requireThreadStoragePath(
  deps: Pick<WorkSessionDeps, "config">,
  args: RequireThreadStoragePathArgs,
): string {
  return requireThreadStorageContext(deps, args).threadStoragePath;
}
