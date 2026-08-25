import {
  acquireDataDirectoryLock,
  type AcquireDataDirectoryLockOptions,
} from "@bb/process-utils/data-directory-lock";

export const DAEMON_LOCK_FILE_NAME = "daemon.lock";

type AcquireDaemonLockOptions = Pick<
  AcquireDataDirectoryLockOptions,
  "logger" | "onLockLost" | "retryIntervalMs" | "staleMs"
> & {
  retries?: number;
};

export async function acquireDaemonLock(
  dataDir: string,
  options: AcquireDaemonLockOptions = {},
): Promise<() => Promise<void>> {
  const { retries, ...lockOptions } = options;
  return acquireDataDirectoryLock({
    dataDir,
    lockFileName: DAEMON_LOCK_FILE_NAME,
    ownerName: "Daemon",
    ...lockOptions,
    ...(retries === undefined
      ? {}
      : {
          initialRetries: retries,
          reacquireRetries: retries,
        }),
  });
}
