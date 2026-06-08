import fs from "node:fs/promises";
import path from "node:path";
import parcelWatcher from "@parcel/watcher";
import { calculateExponentialBackoffDelay } from "@bb/domain";
import { createDebouncedCallbackScheduler } from "./watch-callback-scheduler.js";
import { pathExists } from "./path-exists.js";
import {
  collectWorkspaceStatusChanges,
  resolveMetadataWatchSpecs,
  type WatchSubscriptionSpec,
} from "./watch-specs.js";
import {
  WORKSPACE_STATUS_WATCH_CHANGE_KINDS,
  type WorkspaceStatusWatchChangeKind,
  type WorkspaceStatusWatchArgs,
  type WorkspaceStatusWatchError,
} from "./watch-status-types.js";

const WORKSPACE_STATUS_WATCH_DEBOUNCE_MS = 75;
const WORKSPACE_STATUS_WATCH_MAX_WAIT_MS = 500;
const WORKSPACE_STATUS_WATCH_RETRY_DELAY_MS = 250;
const WORKSPACE_STATUS_WATCH_MAX_RETRY_DELAY_MS = 30_000;
const FSEVENTS_DROPPED_EVENTS_RESCAN_MESSAGE = "File system must be re-scanned";

type ParcelWatcherSubscribe = typeof parcelWatcher.subscribe;
type ParcelWatcherCallback = Parameters<ParcelWatcherSubscribe>[1];
type ParcelWatcherAsyncSubscription = Awaited<
  ReturnType<ParcelWatcherSubscribe>
>;
type ParcelWatcherError = Parameters<ParcelWatcherCallback>[0];
type ParcelWatcherEventBatch = Parameters<ParcelWatcherCallback>[1];

interface WorkspaceStatusWatcherArgs extends WorkspaceStatusWatchArgs {
  cwd: string;
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

function isDroppedEventsRescanRequiredMessage(message: string): boolean {
  // Parcel's FSEvents backend uses this phrase for every dropped-events variant.
  return message.includes(FSEVENTS_DROPPED_EVENTS_RESCAN_MESSAGE);
}

function createWorkspaceStatusCallbackError(
  cwd: string,
  error: unknown,
): WorkspaceStatusWatchError {
  return {
    message: `Workspace status callback failed: ${toErrorMessage(error)}`,
    rootPath: cwd,
  };
}

function createWorkspaceRootWatchSpec(cwd: string): WatchSubscriptionSpec {
  return {
    kind: "workspace-root",
    options: {
      ignore: [".git"],
    },
    rootPath: cwd,
  };
}

async function resolveWatchRootPath(rootPath: string): Promise<string> {
  try {
    return await fs.realpath(rootPath);
  } catch {
    return rootPath;
  }
}

export class WorkspaceStatusWatcher {
  private readonly changedPaths = new Set<string>();
  private readonly changeKinds = new Set<WorkspaceStatusWatchChangeKind>();
  private disposed = false;
  private metadataRetryAttempt = 0;
  private metadataStartRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly pendingRecoveryRescanRootPaths = new Set<string>();
  private readonly pendingSubscriptionStarts = new Set<Promise<void>>();
  private readonly pendingSubscriptionStops = new Set<Promise<void>>();
  private readonly retryAttempts = new Map<string, number>();
  private readonly retryTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  private readonly subscriptions = new Map<
    string,
    ParcelWatcherAsyncSubscription
  >();
  private readonly warnedRootPaths = new Set<string>();
  private readonly changeScheduler;

  constructor(private readonly args: WorkspaceStatusWatcherArgs) {
    this.changeScheduler = createDebouncedCallbackScheduler({
      debounceMs: args.debounceMs,
      maxWaitMs: args.maxWaitMs,
      onFlush: () => {
        if (this.disposed) {
          return;
        }
        try {
          const changedPaths = Array.from(this.changedPaths).sort();
          const changeKinds = Array.from(this.changeKinds);
          this.changedPaths.clear();
          this.changeKinds.clear();
          if (changedPaths.length === 0 || changeKinds.length === 0) {
            return;
          }
          this.args.onChange({
            changedPaths,
            changeKinds,
          });
        } catch (error) {
          this.args.onWatchError(
            createWorkspaceStatusCallbackError(this.args.cwd, error),
          );
        }
      },
    });
  }

  start(): void {
    void this.startAsync();
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.changeScheduler.dispose();
    this.changedPaths.clear();
    this.changeKinds.clear();
    this.pendingRecoveryRescanRootPaths.clear();
    if (this.metadataStartRetryTimer !== null) {
      clearTimeout(this.metadataStartRetryTimer);
      this.metadataStartRetryTimer = null;
    }
    for (const retryTimer of this.retryTimers.values()) {
      clearTimeout(retryTimer);
    }
    this.retryTimers.clear();
    await Promise.all(
      [...this.subscriptions.keys()].map((rootPath) =>
        this.stopSubscription(rootPath),
      ),
    );
    await this.awaitPendingSubscriptionStarts();
    await this.awaitPendingSubscriptionStops();
  }

  private async awaitPendingSubscriptionStarts(): Promise<void> {
    while (this.pendingSubscriptionStarts.size > 0) {
      await Promise.all([...this.pendingSubscriptionStarts]);
    }
  }

  private async awaitPendingSubscriptionStops(): Promise<void> {
    while (this.pendingSubscriptionStops.size > 0) {
      await Promise.all([...this.pendingSubscriptionStops]);
    }
  }

  private async startAsync(): Promise<void> {
    if (!(await pathExists(path.join(this.args.cwd, ".git")))) {
      return;
    }
    if (this.disposed) {
      return;
    }
    this.startWatchSubscription(
      createWorkspaceRootWatchSpec(await resolveWatchRootPath(this.args.cwd)),
    );
    this.startMetadataWatchSubscriptions();
  }

  private async stopSubscription(rootPath: string): Promise<void> {
    const retryTimer = this.retryTimers.get(rootPath);
    if (retryTimer !== undefined) {
      clearTimeout(retryTimer);
      this.retryTimers.delete(rootPath);
    }
    const subscription = this.subscriptions.get(rootPath);
    if (!subscription) {
      return;
    }
    this.subscriptions.delete(rootPath);
    await this.unsubscribeSubscription(subscription);
  }

  private unsubscribeSubscription(
    subscription: ParcelWatcherAsyncSubscription,
  ): Promise<void> {
    const pendingStop = subscription
      .unsubscribe()
      .catch(() => {
        // Ignore unsubscribe failures during watcher teardown.
      })
      .finally(() => {
        this.pendingSubscriptionStops.delete(pendingStop);
      });
    this.pendingSubscriptionStops.add(pendingStop);
    return pendingStop;
  }

  private resetWatchRetryState(rootPath: string): void {
    this.retryAttempts.delete(rootPath);
    this.warnedRootPaths.delete(rootPath);
  }

  private reportWatchError(spec: WatchSubscriptionSpec, error: unknown): void {
    if (this.warnedRootPaths.has(spec.rootPath)) {
      return;
    }
    this.warnedRootPaths.add(spec.rootPath);
    this.args.onWatchError({
      message: toErrorMessage(error),
      rootPath: spec.rootPath,
    });
  }

  private scheduleMetadataWatchRetry(): void {
    if (this.disposed || this.metadataStartRetryTimer !== null) {
      return;
    }
    this.metadataRetryAttempt += 1;
    this.metadataStartRetryTimer = setTimeout(
      () => {
        this.metadataStartRetryTimer = null;
        this.startMetadataWatchSubscriptions();
      },
      calculateExponentialBackoffDelay({
        attempt: this.metadataRetryAttempt,
        baseDelayMs: this.args.retryDelayMs,
        maxDelayMs: this.args.maxRetryDelayMs,
      }),
    );
  }

  private scheduleWatchRetry(spec: WatchSubscriptionSpec): void {
    if (
      this.disposed ||
      this.subscriptions.has(spec.rootPath) ||
      this.retryTimers.has(spec.rootPath)
    ) {
      return;
    }
    const retryAttempt = (this.retryAttempts.get(spec.rootPath) ?? 0) + 1;
    this.retryAttempts.set(spec.rootPath, retryAttempt);
    const retryTimer = setTimeout(
      () => {
        this.retryTimers.delete(spec.rootPath);
        if (this.disposed) {
          return;
        }
        this.startWatchSubscription(spec);
      },
      calculateExponentialBackoffDelay({
        attempt: retryAttempt,
        baseDelayMs: this.args.retryDelayMs,
        maxDelayMs: this.args.maxRetryDelayMs,
      }),
    );
    this.retryTimers.set(spec.rootPath, retryTimer);
  }

  private handleWatchFailure(spec: WatchSubscriptionSpec): void {
    void this.stopSubscription(spec.rootPath);
    this.scheduleWatchRetry(spec);
  }

  private queueConservativeWorkspaceStatusChange(
    spec: WatchSubscriptionSpec,
  ): void {
    this.changedPaths.add(spec.rootPath);
    for (const changeKind of WORKSPACE_STATUS_WATCH_CHANGE_KINDS) {
      this.changeKinds.add(changeKind);
    }
    this.changeScheduler.schedule();
  }

  private queueDroppedEventsRecovery(spec: WatchSubscriptionSpec): void {
    this.pendingRecoveryRescanRootPaths.add(spec.rootPath);
    this.queueConservativeWorkspaceStatusChange(spec);
  }

  private startWatchSubscription(spec: WatchSubscriptionSpec): void {
    const pendingStart = this.startWatchSubscriptionAsync(spec).finally(() => {
      this.pendingSubscriptionStarts.delete(pendingStart);
    });
    this.pendingSubscriptionStarts.add(pendingStart);
  }

  private async startWatchSubscriptionAsync(
    spec: WatchSubscriptionSpec,
  ): Promise<void> {
    if (this.disposed || this.subscriptions.has(spec.rootPath)) {
      return;
    }
    if (!(await pathExists(spec.rootPath))) {
      this.scheduleWatchRetry(spec);
      return;
    }
    try {
      const subscription = await parcelWatcher.subscribe(
        spec.rootPath,
        (error: ParcelWatcherError, events: ParcelWatcherEventBatch) => {
          if (this.disposed) {
            return;
          }
          if (error) {
            const errorMessage = toErrorMessage(error);
            if (isDroppedEventsRescanRequiredMessage(errorMessage)) {
              // Dropped events are recoverable for workspace status: rescan
              // now and after recovery instead of surfacing a watch warning.
              this.queueDroppedEventsRecovery(spec);
              this.handleWatchFailure(spec);
              return;
            }
            this.reportWatchError(spec, error);
            this.handleWatchFailure(spec);
            return;
          }
          if (events.length === 0) {
            return;
          }
          const changeEvent = collectWorkspaceStatusChanges({
            events,
            spec,
          });
          if (!changeEvent) {
            return;
          }
          for (const changedPath of changeEvent.changedPaths) {
            this.changedPaths.add(changedPath);
          }
          for (const changeKind of changeEvent.changeKinds) {
            this.changeKinds.add(changeKind);
          }
          this.changeScheduler.schedule();
        },
        spec.options,
      );
      if (this.disposed) {
        await this.unsubscribeSubscription(subscription);
        return;
      }
      if (this.subscriptions.has(spec.rootPath)) {
        await this.unsubscribeSubscription(subscription);
        return;
      }
      this.resetWatchRetryState(spec.rootPath);
      this.subscriptions.set(spec.rootPath, subscription);
      if (this.pendingRecoveryRescanRootPaths.delete(spec.rootPath)) {
        this.queueConservativeWorkspaceStatusChange(spec);
      }
    } catch (error) {
      if (this.disposed) {
        return;
      }
      const errorMessage = toErrorMessage(error);
      if (isDroppedEventsRescanRequiredMessage(errorMessage)) {
        this.queueDroppedEventsRecovery(spec);
        this.scheduleWatchRetry(spec);
        return;
      }
      this.reportWatchError(spec, error);
      this.scheduleWatchRetry(spec);
    }
  }

  private startMetadataWatchSubscriptions(
    metadataSpecs?: WatchSubscriptionSpec[] | null,
  ): void {
    void this.startMetadataWatchSubscriptionsAsync(metadataSpecs);
  }

  private async startMetadataWatchSubscriptionsAsync(
    metadataSpecs?: WatchSubscriptionSpec[] | null,
  ): Promise<void> {
    try {
      const resolvedMetadataSpecs =
        metadataSpecs ?? (await resolveMetadataWatchSpecs(this.args.cwd));
      if (this.disposed) {
        return;
      }
      if (!resolvedMetadataSpecs) {
        this.scheduleMetadataWatchRetry();
        return;
      }
      this.metadataRetryAttempt = 0;
      for (const spec of resolvedMetadataSpecs) {
        this.startWatchSubscription(spec);
      }
    } catch {
      if (this.disposed) {
        return;
      }
      this.scheduleMetadataWatchRetry();
    }
  }
}

export function createWorkspaceStatusWatcher(
  args: WorkspaceStatusWatchArgs & { cwd: string },
): WorkspaceStatusWatcher {
  return new WorkspaceStatusWatcher({
    cwd: args.cwd,
    debounceMs: WORKSPACE_STATUS_WATCH_DEBOUNCE_MS,
    maxRetryDelayMs: WORKSPACE_STATUS_WATCH_MAX_RETRY_DELAY_MS,
    maxWaitMs: WORKSPACE_STATUS_WATCH_MAX_WAIT_MS,
    onChange: args.onChange,
    onWatchError: args.onWatchError,
    retryDelayMs: WORKSPACE_STATUS_WATCH_RETRY_DELAY_MS,
  });
}
