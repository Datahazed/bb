import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import lockfile from "proper-lockfile";

const DEFAULT_LOCK_STALE_MS = 10_000;
const MINIMUM_LOCK_STALE_MS = 2_000;
const DEFAULT_LOCK_RETRY_INTERVAL_MS = 1_000;
const DEFAULT_LOCK_ACQUIRE_RETRIES = 13;
const LOCK_REACQUIRE_MAX_CYCLES = 20;

export interface DataDirectoryLockLogger {
  warn(fields: Record<string, unknown>, message: string): void;
  error(fields: Record<string, unknown>, message: string): void;
}

export interface AcquireDataDirectoryLockOptions {
  dataDir: string;
  lockFileName: string;
  ownerName: string;
  staleMs?: number;
  initialRetries?: number;
  reacquireRetries?: number;
  retryIntervalMs?: number;
  logger?: DataDirectoryLockLogger;
  onLockLost?: (error: unknown) => void;
}

export type ReleaseDataDirectoryLock = () => Promise<void>;

const consoleLockLogger: DataDirectoryLockLogger = {
  warn: (fields, message) => console.warn(message, fields),
  error: (fields, message) => console.error(message, fields),
};

function isErrorWithCode(
  error: unknown,
  code: string,
): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}

export async function acquireDataDirectoryLock(
  options: AcquireDataDirectoryLockOptions,
): Promise<ReleaseDataDirectoryLock> {
  await fs.mkdir(options.dataDir, { recursive: true });

  const lockPath = path.join(options.dataDir, options.lockFileName);
  await fs.writeFile(lockPath, "", { encoding: "utf8", flag: "a" });

  const lockDirPath = `${lockPath}.lock`;
  const staleMs = Math.max(
    options.staleMs ?? DEFAULT_LOCK_STALE_MS,
    MINIMUM_LOCK_STALE_MS,
  );
  const retryIntervalMs =
    options.retryIntervalMs ?? DEFAULT_LOCK_RETRY_INTERVAL_MS;
  const initialRetries = options.initialRetries ?? DEFAULT_LOCK_ACQUIRE_RETRIES;
  const reacquireRetries =
    options.reacquireRetries ?? DEFAULT_LOCK_ACQUIRE_RETRIES;
  const logger = options.logger ?? consoleLockLogger;
  const onLockLost = options.onLockLost ?? (() => process.exit(1));

  let released = false;
  let releasePromise: Promise<void> | null = null;
  let reacquiring = false;
  let holdsLock = false;
  let release: ReleaseDataDirectoryLock | null = null;

  function handleCompromised(error: Error): void {
    if (released || reacquiring) {
      return;
    }
    reacquiring = true;
    holdsLock = false;
    logger.warn(
      { err: error },
      `${options.ownerName} lock compromised; re-acquiring without restarting the process`,
    );
    void (async () => {
      try {
        for (let cycle = 1; !released; cycle += 1) {
          try {
            const reacquiredRelease = await lockDataDirectoryFile(
              reacquireRetries,
              true,
            );
            if (released) {
              await reacquiredRelease().catch(() => undefined);
              return;
            }
            release = reacquiredRelease;
            holdsLock = true;
            logger.warn(
              {},
              `${options.ownerName} lock re-acquired after compromise`,
            );
            return;
          } catch (acquireError) {
            if (released) {
              return;
            }
            if (isErrorWithCode(acquireError, "ELOCKED")) {
              logger.error(
                { err: acquireError },
                `${options.ownerName} lock is held by another live process; yielding the data directory`,
              );
              onLockLost(acquireError);
              return;
            }
            if (cycle >= LOCK_REACQUIRE_MAX_CYCLES) {
              logger.error(
                { err: acquireError, cycle },
                `${options.ownerName} lock could not be re-acquired after repeated attempts; yielding the data directory`,
              );
              onLockLost(acquireError);
              return;
            }
            logger.error(
              { err: acquireError, cycle },
              `Re-acquiring the compromised ${options.ownerName.toLowerCase()} lock failed; retrying`,
            );
            await sleep(retryIntervalMs, undefined, { ref: false });
          }
        }
      } finally {
        reacquiring = false;
      }
    })();
  }

  function lockDataDirectoryFile(
    retries: number,
    unrefRetries = false,
  ): Promise<ReleaseDataDirectoryLock> {
    return lockfile.lock(lockPath, {
      realpath: false,
      stale: staleMs,
      retries: {
        retries,
        factor: 1,
        minTimeout: retryIntervalMs,
        maxTimeout: retryIntervalMs,
        unref: unrefRetries,
      },
      lockfilePath: lockDirPath,
      onCompromised: handleCompromised,
    });
  }

  try {
    release = await lockDataDirectoryFile(initialRetries);
  } catch (error) {
    if (isErrorWithCode(error, "ELOCKED")) {
      throw new Error(
        `${options.ownerName} lock is already held for data directory ${options.dataDir}`,
        { cause: error },
      );
    }
    throw error;
  }
  holdsLock = true;

  const onExit = () => {
    if (!holdsLock) {
      return;
    }
    try {
      fsSync.rmSync(lockDirPath, { recursive: true, force: true });
    } catch {}
  };
  process.once("exit", onExit);

  return () => {
    if (releasePromise !== null) return releasePromise;
    released = true;
    releasePromise = (async () => {
      try {
        await release?.();
      } catch (error) {
        if (!isErrorWithCode(error, "ERELEASED")) {
          throw error;
        }
      } finally {
        holdsLock = false;
        process.removeListener("exit", onExit);
      }
    })();
    return releasePromise;
  };
}
