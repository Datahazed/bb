declare module "proper-lockfile" {
  export interface LockRetryOptions {
    retries?: number;
    factor?: number;
    minTimeout?: number;
    maxTimeout?: number;
    randomize?: boolean;
  }

  export interface LockOptions {
    realpath?: boolean;
    retries?: number | LockRetryOptions;
    /** Lock is treated as stale once its mtime is older than this many ms. */
    stale?: number;
    /** Interval at which the held lock's mtime is refreshed. */
    update?: number;
    lockfilePath?: string;
  }

  export type ReleaseFn = () => Promise<void>;

  export function lock(file: string, options?: LockOptions): Promise<ReleaseFn>;

  const lockfile: {
    lock: typeof lock;
  };

  export default lockfile;
}
