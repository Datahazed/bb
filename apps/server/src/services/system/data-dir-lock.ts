/**
 * Single-owner lock on the server data dir, taken at boot (plan §3, §5.5):
 * the daemon's `daemon.lock` pattern moved up into the server, adapted from
 * `apps/host-daemon/src/lock.ts` (the daemon copy dies in P1c). Two server
 * processes pointed at one `<dataDir>` would race SQLite writes, watcher
 * state, and provider sessions — the second boot must fail fast instead.
 */
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import lockfile from "proper-lockfile";

export const SERVER_LOCK_FILE_NAME = "server.lock";

// proper-lockfile refreshes the held lock's mtime while the holder is alive.
// A lock older than the stale window is therefore an abandoned server lock.
const SERVER_LOCK_STALE_MS = 10_000;
const SERVER_LOCK_RETRY_INTERVAL_MS = 1_000;
const SERVER_LOCK_ACQUIRE_RETRIES = 13;

interface AcquireDataDirLockOptions {
  /** Lock is treated as stale once its mtime is older than this many ms. */
  staleMs?: number;
  /** How many times to retry acquisition while a lock exists. */
  retries?: number;
  /** Fixed delay between acquisition retries. */
  retryIntervalMs?: number;
}

export async function acquireDataDirLock(
  dataDir: string,
  options: AcquireDataDirLockOptions = {},
): Promise<() => Promise<void>> {
  await fs.mkdir(dataDir, { recursive: true });

  const lockPath = path.join(dataDir, SERVER_LOCK_FILE_NAME);
  await fs.writeFile(lockPath, "", { encoding: "utf8", flag: "a" });

  // proper-lockfile creates a directory at `<path>.lock` to hold the lock.
  // We pass lockfilePath explicitly so the exit handler below doesn't rely
  // on an undocumented default.
  const lockDirPath = `${lockPath}.lock`;
  const retryIntervalMs =
    options.retryIntervalMs ?? SERVER_LOCK_RETRY_INTERVAL_MS;
  const release = await lockfile.lock(lockPath, {
    realpath: false,
    stale: options.staleMs ?? SERVER_LOCK_STALE_MS,
    retries: {
      retries: options.retries ?? SERVER_LOCK_ACQUIRE_RETRIES,
      factor: 1,
      minTimeout: retryIntervalMs,
      maxTimeout: retryIntervalMs,
    },
    lockfilePath: lockDirPath,
  });

  // Synchronous fallback: if the process exits before the async release
  // completes, remove the lock directory so the next startup isn't blocked.
  const onExit = () => {
    try {
      fsSync.rmSync(lockDirPath, { recursive: true, force: true });
    } catch {
      // Best-effort — nothing we can do if this fails during exit.
    }
  };
  process.once("exit", onExit);

  let released = false;
  return async () => {
    if (released) {
      return;
    }
    released = true;
    process.removeListener("exit", onExit);
    await release();
  };
}
