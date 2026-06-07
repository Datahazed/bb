/**
 * Ported near-verbatim from `apps/host-daemon/src/thread-storage-root.ts`
 * (P1a engine scaffold; the daemon copy dies in P1c). The `BB_THREAD_STORAGE`
 * override survives the single-host merge (plan §3).
 */
import fs from "node:fs/promises";
import path from "node:path";

interface ThreadStorageRootPathOptions {
  env?: NodeJS.ProcessEnv;
}

const THREAD_STORAGE_ENV_VAR = "BB_THREAD_STORAGE";

export function threadStorageRootPath(
  dataDir: string,
  options: ThreadStorageRootPathOptions = {},
): string {
  const configuredRoot = (options.env ?? process.env)[THREAD_STORAGE_ENV_VAR];
  if (configuredRoot && configuredRoot.trim().length > 0) {
    return path.resolve(configuredRoot);
  }
  return path.join(dataDir, "thread-storage");
}

export async function ensureThreadStorageRoot(
  dataDir: string,
  options: ThreadStorageRootPathOptions = {},
): Promise<string> {
  const rootPath = threadStorageRootPath(dataDir, options);
  await fs.mkdir(rootPath, { recursive: true });
  return rootPath;
}
