import path from "node:path";
import parcelWatcher from "@parcel/watcher";
import { calculateExponentialBackoffDelay } from "@bb/domain";
import { createDebouncedCallbackScheduler } from "./watch-callback-scheduler.js";
import { pathExists } from "./path-exists.js";
import type {
  PathChangeEvent,
  PathChangeCallback,
  PathChangeWatchArgs,
  PathChangeWatchError,
  PathChangeWatchErrorCallback,
} from "./watch-path-types.js";

const PATH_CHANGE_WATCH_DEBOUNCE_MS = 75;
const PATH_CHANGE_WATCH_MAX_WAIT_MS = 500;
const PATH_CHANGE_WATCH_RETRY_DELAY_MS = 250;
const PATH_CHANGE_WATCH_MAX_RETRY_DELAY_MS = 30_000;

type ParcelWatcherSubscribe = typeof parcelWatcher.subscribe;
type ParcelWatcherCallback = Parameters<ParcelWatcherSubscribe>[1];
type ParcelWatcherAsyncSubscription = Awaited<
  ReturnType<ParcelWatcherSubscribe>
>;
type ParcelWatcherError = Parameters<ParcelWatcherCallback>[0];
type ParcelWatcherEventBatch = Parameters<ParcelWatcherCallback>[1];

interface PathChangeWatcherArgs extends PathChangeWatchArgs {
  path: string;
  debounceMs: number;
  maxRetryDelayMs: number;
  maxWaitMs: number;
  retryDelayMs: number;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return "Unknown watch error";
}

function createPathChangeCallbackError(
  watchedPath: string,
  error: unknown,
): PathChangeWatchError {
  return {
    message: `Path change callback failed: ${toErrorMessage(error)}`,
    rootPath: watchedPath,
  };
}

function isPathWithinTarget(
  targetPath: string,
  candidatePath: string,
): boolean {
  const relativePath = path.relative(targetPath, candidatePath);
  return (
    relativePath.length === 0 ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  );
}

function resolveEventPath(watchedPath: string, eventPath: string): string {
  return path.isAbsolute(eventPath)
    ? path.normalize(eventPath)
    : path.resolve(watchedPath, eventPath);
}

function collectTouchedTargetPaths(
  targetPath: string,
  events: ParcelWatcherEventBatch,
): string[] {
  const touchedPaths = new Set<string>();
  for (const event of events) {
    const candidatePath = resolveEventPath(targetPath, event.path);
    if (isPathWithinTarget(targetPath, candidatePath)) {
      touchedPaths.add(candidatePath);
    }
  }
  return Array.from(touchedPaths).sort();
}

class PathChangeWatcher {
  private disposed = false;
  private readonly changedPaths = new Set<string>();
  private missingTargetWarningReported = false;
  private readonly pendingStarts = new Set<Promise<void>>();
  private readonly pendingStops = new Set<Promise<void>>();
  private retryAttempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private subscription: ParcelWatcherAsyncSubscription | null = null;
  private readonly changeScheduler;
  private readonly targetPath;

  constructor(private readonly args: PathChangeWatcherArgs) {
    this.targetPath = path.resolve(args.path);
    this.changeScheduler = createDebouncedCallbackScheduler({
      debounceMs: args.debounceMs,
      maxWaitMs: args.maxWaitMs,
      onFlush: () => {
        if (this.disposed) {
          return;
        }
        try {
          const changedPaths = Array.from(this.changedPaths).sort();
          this.changedPaths.clear();
          if (changedPaths.length === 0) {
            return;
          }
          this.args.onChange({ changedPaths });
        } catch (error) {
          this.args.onWatchError(
            createPathChangeCallbackError(this.targetPath, error),
          );
        }
      },
    });
  }

  start(): void {
    const pendingStart = this.startAsync().finally(() => {
      this.pendingStarts.delete(pendingStart);
    });
    this.pendingStarts.add(pendingStart);
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.changeScheduler.dispose();
    this.changedPaths.clear();
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.subscription !== null) {
      const subscription = this.subscription;
      this.subscription = null;
      await this.stopSubscription(subscription);
    }
    await Promise.all([...this.pendingStarts]);
    await this.awaitPendingStops();
  }

  private async awaitPendingStops(): Promise<void> {
    while (this.pendingStops.size > 0) {
      await Promise.all([...this.pendingStops]);
    }
  }

  private stopSubscription(
    subscription: ParcelWatcherAsyncSubscription,
  ): Promise<void> {
    const pendingStop = subscription
      .unsubscribe()
      .catch(() => {
        // Ignore unsubscribe failures during watcher teardown.
      })
      .finally(() => {
        this.pendingStops.delete(pendingStop);
      });
    this.pendingStops.add(pendingStop);
    return pendingStop;
  }

  private scheduleRetry(): void {
    if (
      this.disposed ||
      this.retryTimer !== null ||
      this.subscription !== null
    ) {
      return;
    }
    this.retryAttempt += 1;
    this.retryTimer = setTimeout(
      () => {
        this.retryTimer = null;
        this.start();
      },
      calculateExponentialBackoffDelay({
        attempt: this.retryAttempt,
        baseDelayMs: this.args.retryDelayMs,
        maxDelayMs: this.args.maxRetryDelayMs,
      }),
    );
  }

  private async startAsync(): Promise<void> {
    if (this.disposed || this.subscription !== null) {
      return;
    }

    if (!(await pathExists(this.targetPath))) {
      if (!this.missingTargetWarningReported) {
        this.missingTargetWarningReported = true;
        this.args.onWatchError({
          message: `Watched path does not exist yet: ${this.targetPath}`,
          rootPath: this.targetPath,
        });
      }
      this.scheduleRetry();
      return;
    }
    if (this.disposed) {
      return;
    }

    try {
      const subscription = await parcelWatcher.subscribe(
        this.targetPath,
        (error: ParcelWatcherError, events: ParcelWatcherEventBatch) => {
          if (this.disposed) {
            return;
          }
          if (error) {
            this.args.onWatchError({
              message: toErrorMessage(error),
              rootPath: this.targetPath,
            });
            this.handleSubscriptionFailure();
            return;
          }
          const touchedPaths = collectTouchedTargetPaths(
            this.targetPath,
            events,
          );
          if (touchedPaths.length === 0) {
            return;
          }
          for (const touchedPath of touchedPaths) {
            this.changedPaths.add(touchedPath);
          }
          this.changeScheduler.schedule();
        },
      );
      if (this.disposed) {
        await this.stopSubscription(subscription);
        return;
      }
      this.missingTargetWarningReported = false;
      this.retryAttempt = 0;
      this.subscription = subscription;
    } catch (error) {
      if (this.disposed) {
        return;
      }
      this.args.onWatchError({
        message: toErrorMessage(error),
        rootPath: this.targetPath,
      });
      this.scheduleRetry();
    }
  }

  private handleSubscriptionFailure(): void {
    if (this.subscription !== null) {
      const subscription = this.subscription;
      this.subscription = null;
      void this.stopSubscription(subscription);
    }
    this.scheduleRetry();
  }
}

export type {
  PathChangeEvent,
  PathChangeCallback,
  PathChangeWatchArgs,
  PathChangeWatchError,
  PathChangeWatchErrorCallback,
};

export function watchPathChanges(
  watchedPath: string,
  args: PathChangeWatchArgs,
): () => Promise<void> {
  const watcher = new PathChangeWatcher({
    path: watchedPath,
    debounceMs: PATH_CHANGE_WATCH_DEBOUNCE_MS,
    maxRetryDelayMs: PATH_CHANGE_WATCH_MAX_RETRY_DELAY_MS,
    maxWaitMs: PATH_CHANGE_WATCH_MAX_WAIT_MS,
    onChange: args.onChange,
    onWatchError: args.onWatchError,
    retryDelayMs: PATH_CHANGE_WATCH_RETRY_DELAY_MS,
  });
  watcher.start();
  return () => watcher.dispose();
}
